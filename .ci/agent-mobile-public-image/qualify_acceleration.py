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
MEMORY_PROFILES = {"lcm": (4, "1"), "lcm-tiled": (4, "1")}
SAMPLER_PROFILES = {"lcm": (4, "1"), "lcm-native4": (4, "1"), "lcm-native8": (8, "1")}
ALL_PROFILES = PROFILES | MEMORY_PROFILES | SAMPLER_PROFILES
LORA_PROFILES = set(MEMORY_PROFILES) | set(SAMPLER_PROFILES)


def sampling_config(profile):
    require(profile in ALL_PROFILES, "PROFILE_OR_PROMPT")
    return ("lcm", "lcm") if profile in ("lcm-native4", "lcm-native8") else ("euler_a", "discrete")

TILE_FLAGS = ["--vae-tiling", "--vae-tile-size", "256x256", "--vae-tile-overlap", "0.5"]
REQUEST = Path(".github/ci-requests/agent-mobile-public-image-performance.json")
MEMORY_REQUEST = Path(".github/ci-requests/agent-mobile-public-image-memory.json")
SAMPLER_REQUEST = Path(".github/ci-requests/agent-mobile-public-image-sampler.json")


def expected_request(prepared, memory=False, sampler=False):
    require(re.fullmatch(r"[a-f0-9]{40}", prepared), "PREPARED_SHA")
    require(not (memory and sampler), "EXPERIMENT")
    workflow = "agent-mobile-public-image-sampler" if sampler else "agent-mobile-public-image-memory" if memory else "agent-mobile-public-image-performance"
    return {"workflow": workflow, "prepared_sha": prepared,
            "engine": ENGINE_REV, "engine_tree": ENGINE_TREE, "ggml": GGML_REV,
            "base_model_sha256": MODEL_SHA, "lora_revision": LORA_REV,
            "lora_sha256": LORA_SHA, "scope": "HOST_CPU_LCM_SAMPLER_QUALITY_RESEARCH_ONLY" if sampler else "HOST_CPU_PAIRED_LCM_TILING_RESEARCH_ONLY" if memory else "HOST_CPU_PAIRED_LCM_RESEARCH_ONLY"}


def validate_request(path, prepared, memory=False, sampler=False):
    require(json.loads(path.read_text()) == expected_request(prepared, memory, sampler), "REQUEST_MISMATCH")


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
    require(profile in ALL_PROFILES and prompt in PROMPTS, "PROFILE_OR_PROMPT")
    steps, cfg = ALL_PROFILES[profile]
    method, scheduler = sampling_config(profile)
    args = ["-m", model, "--width", SIZE, "--height", SIZE, "--steps", steps,
            "--seed", SEED, "--cfg-scale", cfg, "--threads", "4", "--sampling-method", method,
            "--scheduler", scheduler, "--disable-image-metadata", "-v", "-o", target]
    if profile in LORA_PROFILES:
        require(lora.name == LORA_NAME + ".safetensors", "LORA_FILENAME")
        args += ["--lora-model-dir", lora.parent, "--lora-apply-mode", "at_runtime"]
        prompt += "<lora:" + LORA_NAME + ":1>"
    if profile == "lcm-tiled":
        args += TILE_FLAGS
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


def tiling_evidence(log, profile):
    clean = re.sub(r"\x1b\[[0-9;]*m", "", log)
    observed = re.findall(r"VAE decode tile size: (\d+)x(\d+) pixels \(\d+x\d+ latent\)", clean)
    if profile == "lcm-tiled":
        require(observed and all(pair == ("256", "256") for pair in observed), "VAE_TILING_NOT_CONFIRMED")
        return {"width": 256, "height": 256, "requestedOverlap": "0.5", "decodeObserved": True}
    require(not observed, "UNEXPECTED_VAE_TILING")
    return None


def sampling_evidence(log, profile):
    clean = re.sub(r"\x1b\[[0-9;]*[mK]", "", log)
    method, scheduler = sampling_config(profile)
    steps, _ = ALL_PROFILES[profile]
    observed = re.findall(r"sampling started: method=([a-zA-Z0-9_+.-]+), steps=(\d+) --- sampling\.cpp:\d+", clean)
    require(observed == [(method, str(steps))], "SAMPLING_NOT_CONFIRMED")
    require(re.search(r"sampling completed, taking [0-9.]+s --- sampling\.cpp:\d+", clean), "SAMPLING_NOT_COMPLETED")
    # The engine confirms method and actual step count. Scheduler is the exact CLI input.
    return {"methodObserved": method, "stepsObserved": steps, "schedulerRequested": scheduler}


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
        evidence = lora_evidence(process.stdout, lora) if profile in LORA_PROFILES else None
        sampling = sampling_evidence(process.stdout, profile)
        tiling = tiling_evidence(process.stdout, profile)
        observed = inspect_png(target)
        rss = int(metric.read_text().strip())
        require(elapsed > 0 and rss > 0, "MEASUREMENTS_MISSING")
        observed.update({"file": target.name, "profile": profile, "durationMs": elapsed,
                         "peakRssKiB": rss, "prompt": prompt, "seed": SEED,
                         "steps": ALL_PROFILES[profile][0], "cfg": ALL_PROFILES[profile][1],
                         "loraApplication": evidence, "vaeTiling": tiling, "sampling": sampling})
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


def compare_memory(rows):
    require(len(rows) == 2 * len(PROMPTS), "PAIR_COUNT")
    pairs = []
    expected_tile = {"width": 256, "height": 256, "requestedOverlap": "0.5", "decodeObserved": True}
    for prompt in PROMPTS:
        pair = [r for r in rows if r["prompt"] == prompt]
        require(len(pair) == 2 and {r["profile"] for r in pair} == set(MEMORY_PROFILES), "PAIR_IDENTITY")
        a, b = (next(r for r in pair if r["profile"] == profile) for profile in MEMORY_PROFILES)
        for r in (a, b):
            require(r["seed"] == SEED and (r["width"], r["height"]) == (SIZE, SIZE) and
                    (r["steps"], r["cfg"]) == MEMORY_PROFILES[r["profile"]], "PAIR_CONFIGURATION")
            require(type(r["durationMs"]) is int and r["durationMs"] > 0 and
                    type(r["peakRssKiB"]) is int and r["peakRssKiB"] > 0, "PAIR_MEASUREMENTS")
            require((r.get("loraApplication") or {}).get("fullCoverageObserved") is True, "PAIR_LORA_EVIDENCE")
        require(a.get("vaeTiling") is None and b.get("vaeTiling") == expected_tile, "PAIR_TILING_EVIDENCE")
        pairs.append({"prompt": prompt, "untiledMs": a["durationMs"], "tiledMs": b["durationMs"],
                      "untiledPeakRssKiB": a["peakRssKiB"], "tiledPeakRssKiB": b["peakRssKiB"],
                      "savedRssKiB": a["peakRssKiB"] - b["peakRssKiB"],
                      "memoryReductionPercent": round(100 * (1 - b["peakRssKiB"] / a["peakRssKiB"]), 2),
                      "latencyRatio": round(b["durationMs"] / a["durationMs"], 3),
                      "identicalPixels": a["pixelSha256"] == b["pixelSha256"]})
    for profile in MEMORY_PROFILES:
        require(len({r["pixelSha256"] for r in rows if r["profile"] == profile}) == len(PROMPTS), "PROFILE_REPEAT")
    return pairs


def compare_sampler(rows):
    require(len(rows) == len(PROMPTS) * len(SAMPLER_PROFILES), "PAIR_COUNT")
    pairs = []
    for prompt in PROMPTS:
        group = [row for row in rows if row["prompt"] == prompt]
        require(len(group) == len(SAMPLER_PROFILES) and {row["profile"] for row in group} == set(SAMPLER_PROFILES), "PAIR_IDENTITY")
        for row in group:
            profile = row["profile"]
            steps, cfg = SAMPLER_PROFILES[profile]
            method, scheduler = sampling_config(profile)
            require(row["seed"] == SEED and (row["width"], row["height"]) == (SIZE, SIZE) and
                    (row["steps"], row["cfg"]) == (steps, cfg), "PAIR_CONFIGURATION")
            require(type(row["durationMs"]) is int and row["durationMs"] > 0 and
                    type(row["peakRssKiB"]) is int and row["peakRssKiB"] > 0, "PAIR_MEASUREMENTS")
            require(row.get("sampling") == {"methodObserved": method, "stepsObserved": steps,
                                            "schedulerRequested": scheduler}, "PAIR_SAMPLING_EVIDENCE")
            require((row.get("loraApplication") or {}).get("fullCoverageObserved") is True and row.get("vaeTiling") is None,
                    "PAIR_LORA_OR_VAE_EVIDENCE")
        control = next(row for row in group if row["profile"] == "lcm")
        candidates = []
        for profile in ("lcm-native4", "lcm-native8"):
            row = next(row for row in group if row["profile"] == profile)
            candidates.append({"profile": profile, "durationMs": row["durationMs"],
                               "peakRssKiB": row["peakRssKiB"],
                               "latencyRatio": round(row["durationMs"] / control["durationMs"], 3),
                               "memoryReductionPercent": round(100 * (1 - row["peakRssKiB"] / control["peakRssKiB"]), 2),
                               "identicalPixels": row["pixelSha256"] == control["pixelSha256"]})
        pairs.append({"prompt": prompt, "controlMs": control["durationMs"],
                      "controlPeakRssKiB": control["peakRssKiB"], "candidates": candidates})
    for profile in SAMPLER_PROFILES:
        require(len({row["pixelSha256"] for row in rows if row["profile"] == profile}) == len(PROMPTS), "PROFILE_REPEAT")
    return pairs


def write_json(path, value):
    part = path.with_suffix(path.suffix + ".part")
    try:
        with part.open("x", encoding="utf-8") as out:
            out.write(json.dumps(value, indent=2) + "\n")
        part.replace(path)
    finally:
        part.unlink(missing_ok=True)


def qualify_acceleration(result, memory=False, sampler=False):
    require(not (memory and sampler), "EXPERIMENT")
    profiles = SAMPLER_PROFILES if sampler else MEMORY_PROFILES if memory else PROFILES
    result.mkdir(parents=True, exist_ok=False)
    rows = []
    progress = {"status": "RUNNING", "engineRevision": ENGINE_REV,
                "baseModelSha256": MODEL_SHA, "loraSha256": LORA_SHA,
                "active": None, "verifiedImages": rows, "experiment": "LCM_SAMPLER" if sampler else "VAE_TILING" if memory else "LCM_ACCELERATION"}
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
                order = tuple(profiles) if index % 2 else tuple(reversed(profiles))
                for profile in order:
                    progress["active"] = {"index": index, "profile": profile}
                    write_json(result / "progress.json", progress)
                    print(f"PUBLIC_LCM_EXPERIMENT={index}:{profile}:START", flush=True)
                    rows.append(generate_profile(exe, model, lora, result, index, prompt, profile))
                    progress["active"] = None
                    write_json(result / "progress.json", progress)
                    print(f"PUBLIC_LCM_EXPERIMENT={index}:{profile}:PASS", flush=True)
            pairs = compare_sampler(rows) if sampler else compare_memory(rows) if memory else compare(rows)
            verify_source(src)
            receipt = {"engineRevision": ENGINE_REV, "engineTree": ENGINE_TREE, "ggmlRevision": GGML_REV,
                       "baseModelSha256": MODEL_SHA, "baseModelBytes": MODEL_BYTES,
                       "loraRevision": LORA_REV, "loraSha256": LORA_SHA, "loraBytes": LORA_BYTES,
                       "loraTensors": tensors, "loraApplyMode": "at_runtime", "sampler": "PER_PROFILE" if sampler else "euler_a",
                       "scheduler": "PER_PROFILE" if sampler else "discrete", "threads": 4, "network": "ISOLATED_PER_GENERATION",
                       "experiment": progress["experiment"], "sameRunnerPairs": pairs, "images": rows, "hostExperiment": "PASS",
                       "semanticQuality": "NOT_RUN", "androidExecution": "NOT_RUN", "productAdoption": "NOT_RUN"}
            write_json(result / "receipt.json", receipt)
            progress["status"] = "PASS"
            write_json(result / "progress.json", progress)
            print("PUBLIC_LCM_SAMPLER_CPU=PASS" if sampler else "PUBLIC_LCM_TILING_PAIRED_CPU=PASS" if memory else "PUBLIC_LCM_PAIRED_CPU=PASS", flush=True)
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
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument("--memory", action="store_true")
    mode.add_argument("--sampler", action="store_true")
    args = parser.parse_args()
    validate_request(SAMPLER_REQUEST if args.sampler else MEMORY_REQUEST if args.memory else REQUEST, args.prepared_sha, args.memory, args.sampler)
    qualify_acceleration(args.result.resolve(), args.memory, args.sampler)
