"""Public direct Android CLI CPU experiment. No application source or credentials."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import tempfile
import time
import uuid

from qualify import (ENGINE_REV, ENGINE_TREE, GGML_REV, MODEL_SHA, MODEL_BYTES, X86_FEATURES,
                     SIZE, SEED, STEPS, PROMPTS, build, checkout, download_model, inspect_png,
                     require, verify_source, ndk_identity)
from qualify_acceleration import write_json, sampling_evidence

WORKFLOW = "agent-mobile-public-image-android-cpu"
REQUEST = Path(".github/ci-requests/" + WORKFLOW + ".json")
AVD = "iwxa_image_cpu_ci"
LIMIT = 1200


def expected_request(prepared):
    require(re.fullmatch(r"[a-f0-9]{40}", prepared), "PREPARED_SHA")
    return {"workflow": WORKFLOW, "prepared_sha": prepared, "engine": ENGINE_REV,
            "engine_tree": ENGINE_TREE, "ggml": GGML_REV, "base_model_sha256": MODEL_SHA,
            "scope": "ANDROID_X86_64_KVM_DIRECT_CLI_SIMD_RESEARCH_ONLY"}


def common_flags(cpuinfo):
    rows = [set(line.split()) for line in re.findall(r"(?m)^flags\s*:\s*([^\r\n]+)$", cpuinfo)]
    require(bool(rows), "ANDROID_CPU_FLAGS")
    return set.intersection(*rows)


def command_args(directory, profile):
    require(re.fullmatch(r"/data/local/tmp/iwxa-image-cpu-[a-f0-9]{32}", directory), "ANDROID_QA_PATH")
    require(profile in ("portable", "simd"), "ANDROID_CPU_PROFILE")
    return ["timeout", "-s", "KILL", str(LIMIT), directory + "/sd-" + profile,
            "-m", directory + "/model.gguf", "--prompt-file", directory + "/prompt.txt",
            "--width", str(SIZE), "--height", str(SIZE), "--steps", str(STEPS),
            "--seed", str(SEED), "--cfg-scale", "7", "--threads", "4",
            "--sampling-method", "euler_a", "--scheduler", "discrete",
            "--disable-image-metadata", "-v", "-o", directory + "/" + profile + ".png"]


def observed_steps(log):
    # Match the original progress records, not weight-loading byte counters.
    clean = re.sub(r"\x1b\[[0-9;]*[mK]", "", log)
    if not re.search(r"sampling started: method=euler_a, steps=12 --- sampling\.cpp:\d+", clean):
        return []
    part = clean.split("sampling started: method=euler_a, steps=12", 1)[1]
    rows = [int(n) for n in re.findall(r"\|[=> ]{50}\|\s+(\d{1,2})/12 -\s+[0-9.]+(?:s/it|it/s)", part)]
    return sorted({n for n in rows if 1 <= n <= STEPS})


def comparison(rows):
    require(len(rows) == 2 and {x["profile"] for x in rows} == {"portable", "simd"}, "ANDROID_CPU_PAIR")
    a, b = (next(x for x in rows if x["profile"] == name) for name in ("portable", "simd"))
    if a["status"] == b["status"] == "PASS":
        return {"status": "PAIRED_PASS", "speedup": round(a["durationMs"] / b["durationMs"], 3)}
    return {"status": "PARTIAL", "portableStatus": a["status"], "simdStatus": b["status"], "speedup": None}


def run(adb, args, timeout=60, required=True):
    p = subprocess.run([str(adb), *map(str, args)], stdout=subprocess.PIPE,
                       stderr=subprocess.STDOUT, text=True, errors="replace", timeout=timeout)
    if required:
        require(p.returncode == 0, "ANDROID_ADB")
    return p


def qualify(result, ndk, adb):
    require(os.environ.get("CI") == "true", "ANDROID_DISPOSABLE_CI_REQUIRED")
    require(ndk_identity(ndk), "NDK_REVISION")
    devices = [line.split() for line in run(adb, ["devices"]).stdout.splitlines()[1:] if line.strip()]
    require(len(devices) == 1 and len(devices[0]) == 2 and devices[0][1] == "device" and
            re.fullmatch(r"emulator-\d+", devices[0][0]), "ANDROID_DISPOSABLE_DEVICE")
    serial = devices[0][0]
    def call(*args, timeout=60, required=True):
        return run(adb, ["-s", serial, *args], timeout, required)
    def shell(*args, timeout=60, required=True):
        return call("shell", *args, timeout=timeout, required=required)
    require(call("emu", "avd", "name").stdout.splitlines()[0].strip() == AVD and
            shell("getprop", "ro.kernel.qemu").stdout.strip() == "1" and
            shell("getprop", "ro.product.cpu.abi").stdout.strip() == "x86_64", "ANDROID_DISPOSABLE_AVD")
    available = common_flags(shell("cat", "/proc/cpuinfo").stdout)
    required = set(X86_FEATURES.values())
    result.mkdir(parents=True, exist_ok=False)
    receipt = {"experiment": "ANDROID_X86_CPU_SIMD", "engineRevision": ENGINE_REV, "engineTree": ENGINE_TREE,
               "ggmlRevision": GGML_REV, "baseModelSha256": MODEL_SHA, "abi": "x86_64",
               "androidApi": shell("getprop", "ro.build.version.sdk").stdout.strip(),
               "requiredFlags": sorted(required), "observedFlags": sorted(required & available),
               "images": [], "status": "RUNNING", "physicalDevice": "NOT_RUN",
               "installedApplication": "NOT_RUN", "semanticQuality": "NOT_RUN"}
    write_json(result / "receipt.json", receipt)
    if not required <= available:
        receipt["status"] = "SIMD_UNAVAILABLE"
        write_json(result / "receipt.json", receipt)
        print("ANDROID_CPU_SIMD_UNAVAILABLE", flush=True)
        return
    directory = "/data/local/tmp/iwxa-image-cpu-" + uuid.uuid4().hex
    shell("mkdir", "-m", "700", directory)
    try:
        with tempfile.TemporaryDirectory(prefix="iwxa-android-image-cpu-") as tmp:
            root = Path(tmp)
            source = root / "source"
            checkout(source)
            model = root / "model.gguf"
            download_model(model)
            prompt = root / "prompt.txt"
            prompt.write_text(PROMPTS[0], encoding="utf-8")
            call("push", model, directory + "/model.gguf", timeout=300)
            call("push", prompt, directory + "/prompt.txt")
            require(shell("sha256sum", directory + "/model.gguf", timeout=180).stdout.split() ==
                    [MODEL_SHA, directory + "/model.gguf"], "ANDROID_MODEL_READBACK")
            for profile, optimized in (("simd", True), ("portable", False)):
                out = root / ("build-" + profile)
                exe = build(source, out, ndk, "x86_64", x86_simd=optimized)
                digest = hashlib.sha256(exe.read_bytes()).hexdigest()
                target = directory + "/sd-" + profile
                call("push", exe, target, timeout=300)
                shell("chmod", "700", target)
                require(shell("sha256sum", target).stdout.split() == [digest, target], "ANDROID_EXECUTABLE_READBACK")
                shutil.rmtree(out)
                print("ANDROID_CPU_BUILD=" + profile + ":PASS", flush=True)
            shell("cmd", "connectivity", "airplane-mode", "enable")
            shell("svc", "wifi", "disable")
            shell("svc", "data", "disable")
            require(shell("settings", "get", "global", "airplane_mode_on").stdout.strip() == "1", "ANDROID_AIRPLANE")
            receipt["airplaneMode"] = "OBSERVED"
            # Optimized first: preserve a useful result even if the portable baseline times out.
            for profile in ("simd", "portable"):
                started = time.monotonic()
                args = command_args(directory, profile)
                print("ANDROID_CPU_GENERATION=" + profile + ":START", flush=True)
                p = shell(shlex.join(args), timeout=LIMIT + 120, required=False)
                elapsed = round((time.monotonic() - started) * 1000)
                print(p.stdout[-16000:], flush=True)
                row = {"profile": profile, "durationMs": elapsed, "exitCode": p.returncode,
                       "observedSteps": observed_steps(p.stdout), "status": "PROCESS_EXIT"}
                if p.returncode == 0:
                    sampling_evidence(p.stdout, "baseline")
                    target = result / (profile + ".png")
                    call("pull", directory + "/" + profile + ".png", target, timeout=120)
                    row.update(inspect_png(target))
                    row.update({"status": "PASS", "file": target.name})
                elif elapsed >= LIMIT * 1000 and p.returncode in (124, 137):
                    row["status"] = "TIME_LIMIT"
                receipt["images"].append(row)
                write_json(result / "receipt.json", receipt)
                print("ANDROID_CPU_GENERATION=" + profile + ":" + row["status"], flush=True)
            receipt["comparison"] = comparison(receipt["images"])
            receipt["status"] = receipt["comparison"]["status"]
            verify_source(source)
            write_json(result / "receipt.json", receipt)
    except Exception as exc:
        receipt["status"] = "FAIL"
        receipt["failure"] = str(exc) if isinstance(exc, ValueError) and re.fullmatch(r"[A-Z_]+", str(exc)) else type(exc).__name__
        write_json(result / "receipt.json", receipt)
        raise
    finally:
        try:
            shell("rm", "-rf", directory)
        finally:
            shell("cmd", "connectivity", "airplane-mode", "disable")
            shell("svc", "wifi", "enable")
            shell("svc", "data", "enable")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--prepared-sha", required=True)
    parser.add_argument("--ndk", required=True, type=Path)
    parser.add_argument("--adb", required=True, type=Path)
    parser.add_argument("--result", required=True, type=Path)
    args = parser.parse_args()
    require(json.loads(REQUEST.read_text()) == expected_request(args.prepared_sha), "REQUEST_MISMATCH")
    qualify(args.result.resolve(), args.ndk.resolve(), args.adb.resolve())
