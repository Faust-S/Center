"""Public-only original image runtime qualification. No product credentials or code."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.request
from PIL import Image, ImageStat

ENGINE = "https://github.com/leejet/stable-diffusion.cpp.git"
ENGINE_REV = "e637c7bccd35aa8841d67fb942ba72918176826c"
ENGINE_TREE = "1e65ac8902d729a62e0720056090d1a498bbec04"
GGML_REV = "eeda9ec48fc84a3df0bb9dcc19ae9053075a2539"
MODEL_URL = "https://huggingface.co/gpustack/stable-diffusion-v1-5-GGUF/resolve/dcac270609fffc0ce7c7d41a3c0e752721859f7c/stable-diffusion-v1-5-Q4_0.gguf"
MODEL_BYTES = 1747190784
MODEL_SHA = "c2f6e92f9d08d69cc673a1003528ac8199274b3c0eaec88d5fbefe5af67bd42b"
NDK_VERSION = "29.0.13113456"
SIZE = 512
STEPS = 12
SEED = 42
PROMPTS = ("A bright red apple on a plain white table, studio photograph", "A blue sailboat on a calm lake at sunrise, landscape photograph")


def require(ok, reason):
    if not ok:
        raise ValueError(reason)


def run(args, *, cwd=None, timeout=1800, capture=False):
    result = subprocess.run([str(a) for a in args], cwd=cwd, check=True,
                            timeout=timeout, text=True, stdout=subprocess.PIPE if capture else None)
    return result.stdout.strip() if capture else None


def checkout(src):
    run(["git", "init", "-q", src])
    run(["git", "-C", src, "fetch", "--depth=1", ENGINE, ENGINE_REV])
    run(["git", "-C", src, "checkout", "--detach", "FETCH_HEAD"])
    require(run(["git", "-C", src, "rev-parse", "HEAD^{tree}"], capture=True) == ENGINE_TREE, "ENGINE_TREE")
    require(run(["git", "-C", src, "rev-parse", "HEAD:ggml"], capture=True) == GGML_REV, "GGML_GITLINK")
    run(["git", "-C", src, "submodule", "update", "--init", "--depth=1", "--", "ggml"])
    require(run(["git", "-C", src / "ggml", "rev-parse", "HEAD"], capture=True) == GGML_REV, "GGML_REVISION")
    verify_source(src)


def verify_source(src):
    require(run(["git", "-C", src, "rev-parse", "HEAD"], capture=True) == ENGINE_REV, "ENGINE_REVISION")
    require(run(["git", "-C", src / "ggml", "rev-parse", "HEAD"], capture=True) == GGML_REV, "GGML_REVISION")
    require(not run(["git", "-C", src, "status", "--porcelain", "--untracked-files=no"], capture=True), "ENGINE_DIRTY")
    require(not run(["git", "-C", src / "ggml", "status", "--porcelain", "--untracked-files=no"], capture=True), "GGML_DIRTY")


def download_model(dest, url=MODEL_URL, size=MODEL_BYTES, digest=MODEL_SHA):
    h = hashlib.sha256()
    count = 0
    part = dest.with_suffix(dest.suffix + ".part")
    require(not dest.exists() and not part.exists(), "MODEL_DEST_EXISTS")
    try:
        with urllib.request.urlopen(url, timeout=120) as source, part.open("xb") as out:
            require(source.geturl().startswith("https://"), "MODEL_PROTOCOL")
            while chunk := source.read(1024 * 1024):
                count += len(chunk)
                require(count <= size, "MODEL_SIZE")
                h.update(chunk)
                out.write(chunk)
            require(count == size and h.hexdigest() == digest, "MODEL_IDENTITY")
        with part.open("rb") as check:
            require(check.read(4) == b"GGUF", "MODEL_FORMAT")
        part.rename(dest)
    finally:
        part.unlink(missing_ok=True)


def build(src, out, ndk=None):
    args = ["cmake", "-S", src, "-B", out, "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release",
            "-DSD_BUILD_EXAMPLES=ON", "-DSD_SERVER_BUILD_FRONTEND=OFF", "-DSD_WEBP=OFF", "-DSD_WEBM=OFF",
            "-DSD_BUILD_SHARED_LIBS=OFF", "-DSD_BUILD_SHARED_GGML_LIB=OFF", "-DSD_OPENCL=OFF",
            "-DGGML_NATIVE=OFF", "-DGGML_OPENMP=OFF"]
    if ndk is not None:
        require((ndk / "build/cmake/android.toolchain.cmake").is_file(), "NDK_TOOLCHAIN")
        require(re.search(r"(?m)^Pkg.Revision\s*=\s*" + re.escape(NDK_VERSION) + r"\s*$",
                          (ndk / "source.properties").read_text()), "NDK_REVISION")
        args += ["-DCMAKE_TOOLCHAIN_FILE=" + str(ndk / "build/cmake/android.toolchain.cmake"),
                 "-DANDROID_ABI=arm64-v8a", "-DANDROID_PLATFORM=android-33", "-DANDROID_STL=c++_static"]
    run(args)
    run(["cmake", "--build", out, "--target", "sd-cli", "--parallel", "2"], timeout=2400)
    exe = out / "bin/sd-cli"
    require(exe.is_file() and os.access(exe, os.X_OK), "SD_CLI_MISSING")
    verify_source(src)
    return exe


def inspect_png(path):
    require(path.is_file() and 0 < path.stat().st_size <= 8 * 1024 * 1024, "IMAGE_SIZE")
    with Image.open(path) as image:
        require(image.format == "PNG" and image.size == (SIZE, SIZE) and image.mode in ("RGB", "RGBA"), "IMAGE_FORMAT")
        image.verify()
    with Image.open(path) as image:
        rgb = image.convert("RGB")
        deviations = ImageStat.Stat(rgb).stddev
        require(max(deviations) >= 5, "IMAGE_EMPTY")
        return {"sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
                "pixelSha256": hashlib.sha256(rgb.tobytes()).hexdigest(), "width": SIZE, "height": SIZE,
                "bytes": path.stat().st_size, "maxChannelStddev": round(max(deviations), 3)}


def generate(exe, model, result, index, prompt):
    target = result / ("image-%d.png" % index)
    metric = result / ("image-%d.time" % index)
    require(not target.exists() and not metric.exists(), "OUTPUT_EXISTS")
    # Privileged creation of an isolated network namespace, then execution as the runner user.
    prefix = ["sudo", "-n", "unshare", "--net", "--", "runuser", "-u", run(["id", "-un"], capture=True), "--"]
    # Inspect the same network namespace that will execute the original CLI.
    prefix += ["sh", "-eu", "-c", 'test "$(ip -o link show | wc -l)" -eq 1; ip link show dev lo >/dev/null; exec "$@"', "image-qa"]
    started = time.monotonic()
    run(prefix + ["/usr/bin/time", "-f", "%M", "-o", metric, exe, "-m", model, "-p", prompt,
                  "--width", SIZE, "--height", SIZE, "--steps", STEPS, "--seed", SEED,
                  "--cfg-scale", "7", "--threads", "4", "--disable-image-metadata", "-o", target], timeout=1200)
    observed = inspect_png(target)
    observed.update({"durationMs": round((time.monotonic() - started) * 1000),
                     "peakRssKiB": int(metric.read_text().strip()), "prompt": prompt, "seed": SEED, "steps": STEPS})
    require(observed["peakRssKiB"] > 0, "RSS_MISSING")
    metric.unlink()
    return observed


def qualify(result, ndk):
    result.mkdir(parents=True, exist_ok=False)
    with tempfile.TemporaryDirectory(prefix="iwxa-public-image-") as tmp:
        root = Path(tmp)
        src = root / "source"
        checkout(src)
        print("ORIGINAL_IMAGE_SOURCE=PASS", flush=True)
        host = build(src, root / "host")
        print("ORIGINAL_IMAGE_HOST_BUILD=PASS", flush=True)
        model = root / "model.gguf"
        download_model(model)
        print("ORIGINAL_IMAGE_MODEL_IDENTITY=PASS", flush=True)
        images = [generate(host, model, result, i, p) for i, p in enumerate(PROMPTS, 1)]
        require(images[0]["pixelSha256"] != images[1]["pixelSha256"], "IMAGE_REPEAT")
        print("ORIGINAL_IMAGE_CPU_GENERATION=PASS", flush=True)
        arm = build(src, root / "arm64", ndk)
        elf = run(["readelf", "-h", arm], capture=True)
        require(re.search(r"Machine:\s+AArch64\b", elf), "ANDROID_ELF_ARCH")
        dependencies = run(["readelf", "-d", arm], capture=True)
        require(not re.search(r"Shared library: \[(?:libggml|libstable-diffusion|libc\+\+_shared)", dependencies), "ANDROID_SHARED_RUNTIME")
        verify_source(src)
        print("ORIGINAL_IMAGE_ANDROID_ARM64_BUILD=PASS", flush=True)
        receipt = {"engineRevision": ENGINE_REV, "engineTree": ENGINE_TREE, "ggmlRevision": GGML_REV,
                   "modelSha256": MODEL_SHA, "modelBytes": MODEL_BYTES, "ndk": NDK_VERSION,
                   "hostCpuGeneration": "PASS", "androidArm64Build": "PASS", "androidExecution": "NOT_RUN",
                   "physicalDevice": "NOT_RUN", "semanticQuality": "NOT_RUN", "images": images,
                   "androidCliSha256": hashlib.sha256(arm.read_bytes()).hexdigest()}
        (result / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
        print("PUBLIC_IMAGE_PREFLIGHT=PASS", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--result", required=True, type=Path)
    parser.add_argument("--ndk", required=True, type=Path)
    args = parser.parse_args()
    qualify(args.result.resolve(), args.ndk.resolve())
