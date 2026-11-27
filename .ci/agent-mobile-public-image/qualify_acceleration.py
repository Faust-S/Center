"""Public CPU experiment: pinned original SD1.5 vs its original LCM-LoRA."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.request

from qualify import (ENGINE_REV, ENGINE_TREE, GGML_REV, MODEL_SHA, MODEL_BYTES,
                     PROMPTS, SEED, SIZE, build, checkout, download_model,
                     inspect_png, require, run, verify_source)

LORA_REV = "a260c1aa72149ce7a22636e834f52f5e2701da7f"
LORA_SHA = "8f90d840e075ff588a58e22c6586e2ae9a6f7922996ee6649a7f01072333afe4"
LORA_BYTES = 134621556
LORA_NAME = "lcm-lora-sdv1-5"
LORA_URL = ("https://huggingface.co/latent-consistency/lcm-lora-sdv1-5/resolve/"
            + LORA_REV + "/pytorch_lora_weights.safetensors")
PROFILES = {"baseline": (12, "7"), "lcm": (4, "1")}
REQUEST = Path(".github/ci-requests/agent-mobile-public-image-performance.json")


def expected_request(prepared):
    require(re.fullmatch(r"[a-f0-9]{40}", prepared), "PREPARED_SHA")
    return {"workflow": "agent-mobile-public-image-performance", "prepared_sha": prepared,
            "engine": ENGINE_REV, "engine_tree": ENGINE_TREE, "ggml": GGML_REV,
            "base_model_sha256": MODEL_SHA, "lora_revision": LORA_REV,
            "lora_sha256": LORA_SHA, "scope": "HOST_CPU_PAIRED_LCM_RESEARCH_ONLY"}


def validate_request(path, prepared):
    require(json.loads(path.read_text()) == expected_request(prepared), "REQUEST_MISMATCH")


def verify_lora_header(path):
    with path.open("rb") as f:
        n = int.from_bytes(f.read(8), "little")
        require(2 <= n <= 1024 * 1024 and 8 + n < path.stat().st_size, "LORA_HEADER_SIZE")
        header = json.loads(f.read(n))
    require(isinstance(header, dict), "LORA_HEADER_TYPE")
    tensors = {k: v for k, v in header.items() if k != "__metadata__"}
    require(bool(tensors) and any("lora" in k.lower() for k in tensors), "LORA_TENSORS")
    payload = path.stat().st_size - 8 - n
    ranges = []
    for v in tensors.values():
        require(isinstance(v, dict), "LORA_TENSOR_TYPE")
        offsets = v.get("data_offsets")
        require(isinstance(offsets, list) and len(offsets) == 2 and
                all(type(i) is int for i in offsets), "LORA_OFFSETS")
        a, b = offsets
        require(0 <= a < b <= payload, "LORA_OFFSETS")
        ranges.append((a, b))
    ranges.sort()
    require(ranges[0][0] == 0 and ranges[-1][1] == payload and
            all(x[1] == y[0] for x, y in zip(ranges, ranges[1:])), "LORA_PAYLOAD")
    return len(tensors)


def download_lora(dest, url=LORA_URL, size=LORA_BYTES, digest=LORA_SHA):
    part = dest.with_suffix(dest.suffix + ".part")
    require(not dest.exists() and not part.exists(), "LORA_DEST_EXISTS")
    h = hashlib.sha256()
    count = 0
    try:
        with urllib.request.urlopen(url, timeout=120) as source, part.open("xb") as out:
            require(source.geturl().startswith("https://"), "LORA_PROTOCOL")
            while chunk := source.read(1024 * 1024):
                count += len(chunk)
                require(count <= size, "LORA_SIZE")
                h.update(chunk)
                out.write(chunk)
            require(count == size and h.hexdigest() == digest, "LORA_IDENTITY")
        tensors = verify_lora_header(part)
        part.rename(dest)
        return tensors
    finally:
        part.unlink(missing_ok=True)


def profile_args(profile, model, lora, prompt, target):
    require(profile in PROFILES and prompt in PROMPTS, "PROFILE_OR_PROMPT")
    steps, cfg = PROFILES[profile]
    args = ["-m", model, "--width", SIZE, "--height", SIZE, "--steps", steps,
            "--seed", SEED, "--cfg-scale", cfg, "--threads", "4", "--sampling-method", "euler_a",
            "--scheduler", "discrete", "--disable-image-metadata", "-v", "-o", target]
    if profile == "lcm":
        require(lora.name == LORA_NAME + ".safetensors", "LORA_FILENAME")
        args += ["--lora-model-dir", lora.parent, "--lora-apply-mode", "at_runtime"]
        prompt += "<lora:" + LORA_NAME + ":1>"
    return [str(x) for x in args + ["-p", prompt]]


def lora_evidence(log, lora):
    clean = re.sub(r"\x1b\[[0-9;]*m", "", log)
    require(not re.search(r"skip incompatible LoRA|LoRA graph execution failed|\([1-9]\d* / \d+\) incompatible LoRA tensors", clean), "LORA_INCOMPATIBLE")
    # Original logger appends a source location, not part of the adapter path.
    pattern = (r"(?m)\((\d+) / (\d+)\) LoRA tensors have been applied, lora_file_path = "
               r"([^\r\n]+?)(?: --- lora\.hpp:[1-9][0-9]*)?[ \t]*\r?$")
    observed = []
    for a, b, path in re.findall(pattern, clean):
        if Path(path.strip()).resolve() != lora.resolve():
            continue
        a, b = int(a), int(b)
        require(0 <= a <= b and b > 0, "LORA_COUNTS")
        observed.append({"applied": a, "compatible": b})
    require(any(x["applied"] > 0 for x in observed), "LORA_APPLICATION_MISSING")
    return {"observations": observed,
            "fullCoverageObserved": any(x["applied"] == x["compatible"] for x in observed)}


def generate_profile(exe, model, lora, result, index, prompt, profile):
    target = result / f"{index}-{profile}.png"
    metric = target.with_suffix(".time")
    require(not target.exists() and not metric.exists(), "OUTPUT_EXISTS")
    prefix = ["sudo", "-n", "unshare", "--net", "--", "runuser", "-u", run(["id", "-un"], capture=True), "--"]
    prefix += ["sh", "-eu", "-c", 'test "$(ip -o link show | wc -l)" -eq 1; ip link show dev lo >/dev/null; exec "$@"', "image-qa"]
    command = prefix + ["/usr/bin/time", "-f", "%M", "-o", str(metric), str(exe)] + profile_args(profile, model, lora, prompt, target)
    started = time.monotonic()
    try:
        process = subprocess.run(command, timeout=1200, text=True, errors="replace",
                                 stdout=subprocess.PIPE, stderr=subprocess.STDOUT, check=False)
        elapsed = round((time.monotonic() - started) * 1000)
        print(process.stdout[-12000:], flush=True)
        require(process.returncode == 0, "GENERATION_FAILED")
        evidence = lora_evidence(process.stdout, lora) if profile == "lcm" else None
        observed = inspect_png(target)
        rss = int(metric.read_text().strip())
        require(elapsed > 0 and rss > 0, "MEASUREMENTS_MISSING")
        observed.update({"file": target.name, "profile": profile, "durationMs": elapsed,
                         "peakRssKiB": rss, "prompt": prompt, "seed": SEED,
                         "steps": PROFILES[profile][0], "cfg": PROFILES[profile][1],
                         "loraApplication": evidence})
        return observed
    finally:
        metric.unlink(missing_ok=True)


def compare(rows):
    require(len(rows) == 2 * len(PROMPTS), "PAIR_COUNT")
    pairs = []
    for prompt in PROMPTS:
        pair = [r for r in rows if r["prompt"] == prompt]
        require(len(pair) == 2 and {r["profile"] for r in pair} == set(PROFILES), "PAIR_IDENTITY")
        a, b = (next(r for r in pair if r["profile"] == profile) for profile in PROFILES)
        for r in (a, b):
            require(r["seed"] == SEED and (r["width"], r["height"]) == (SIZE, SIZE) and
                    (r["steps"], r["cfg"]) == PROFILES[r["profile"]], "PAIR_CONFIGURATION")
            require(type(r["durationMs"]) is int and r["durationMs"] > 0 and
                    type(r["peakRssKiB"]) is int and r["peakRssKiB"] > 0, "PAIR_MEASUREMENTS")
        require(a["pixelSha256"] != b["pixelSha256"], "PAIR_IDENTICAL_PIXELS")
        require(a["loraApplication"] is None and b["loraApplication"] is not None and
                b["loraApplication"]["fullCoverageObserved"] is True, "PAIR_LORA_EVIDENCE")
        pairs.append({"prompt": prompt, "baselineMs": a["durationMs"], "lcmMs": b["durationMs"],
                      "speedup": round(a["durationMs"] / b["durationMs"], 3),
                      "baselinePeakRssKiB": a["peakRssKiB"], "lcmPeakRssKiB": b["peakRssKiB"],
                      "lcmFullCoverageObserved": b["loraApplication"]["fullCoverageObserved"]})
    for profile in PROFILES:
        require(len({r["pixelSha256"] for r in rows if r["profile"] == profile}) == len(PROMPTS), "PROFILE_REPEAT")
    return pairs


def write_json(path, value):
    part = path.with_suffix(path.suffix + ".part")
    try:
        with part.open("x", encoding="utf-8") as out:
            out.write(json.dumps(value, indent=2) + "\n")
        part.replace(path)
    finally:
        part.unlink(missing_ok=True)


def qualify_acceleration(result):
    result.mkdir(parents=True, exist_ok=False)
    rows = []
    progress = {"status": "RUNNING", "engineRevision": ENGINE_REV,
                "baseModelSha256": MODEL_SHA, "loraSha256": LORA_SHA,
                "active": None, "verifiedImages": rows}
    write_json(result / "progress.json", progress)
    try:
        with tempfile.TemporaryDirectory(prefix="iwxa-image-lcm-") as tmp:
            root = Path(tmp)
            src = root / "source"
            checkout(src)
            exe = build(src, root / "host")
            model = root / "model.gguf"
            download_model(model)
            lora = root / "loras" / (LORA_NAME + ".safetensors")
            lora.parent.mkdir()
            tensors = download_lora(lora)
            print("PUBLIC_LCM_MODEL_IDENTITY=PASS", flush=True)
            # Alternate execution order between prompts, on a single runner.
            for index, prompt in enumerate(PROMPTS, 1):
                order = tuple(PROFILES) if index % 2 else tuple(reversed(PROFILES))
                for profile in order:
                    progress["active"] = {"index": index, "profile": profile}
                    write_json(result / "progress.json", progress)
                    print(f"PUBLIC_LCM_EXPERIMENT={index}:{profile}:START", flush=True)
                    rows.append(generate_profile(exe, model, lora, result, index, prompt, profile))
                    progress["active"] = None
                    write_json(result / "progress.json", progress)
                    print(f"PUBLIC_LCM_EXPERIMENT={index}:{profile}:PASS", flush=True)
            pairs = compare(rows)
            verify_source(src)
            receipt = {"engineRevision": ENGINE_REV, "engineTree": ENGINE_TREE, "ggmlRevision": GGML_REV,
                       "baseModelSha256": MODEL_SHA, "baseModelBytes": MODEL_BYTES,
                       "loraRevision": LORA_REV, "loraSha256": LORA_SHA, "loraBytes": LORA_BYTES,
                       "loraTensors": tensors, "loraApplyMode": "at_runtime", "sampler": "euler_a",
                       "scheduler": "discrete", "threads": 4, "network": "ISOLATED_PER_GENERATION",
                       "sameRunnerPairs": pairs, "images": rows, "hostExperiment": "PASS",
                       "semanticQuality": "NOT_RUN", "androidExecution": "NOT_RUN", "productAdoption": "NOT_RUN"}
            write_json(result / "receipt.json", receipt)
            progress["status"] = "PASS"
            write_json(result / "progress.json", progress)
            print("PUBLIC_LCM_PAIRED_CPU=PASS", flush=True)
    except Exception as exc:
        # Preserve already verified pairs. Any remaining PNG is diagnostic only.
        progress["status"] = "FAIL"
        progress["failureType"] = type(exc).__name__
        if isinstance(exc, ValueError) and re.fullmatch(r"[A-Z_]+", str(exc)):
            progress["failureCode"] = str(exc)
        write_json(result / "progress.json", progress)
        raise


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--result", required=True, type=Path)
    parser.add_argument("--prepared-sha", required=True)
    args = parser.parse_args()
    validate_request(REQUEST, args.prepared_sha)
    qualify_acceleration(args.result.resolve())
