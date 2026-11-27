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
NDK_REVISION = NDK_VERSION + "-beta1"
NDK_RELEASE = "r29-beta1"
ANDROID_ABIS = {"arm64-v8a": "AArch64", "x86_64": "Advanced Micro Devices X86-64"}
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


def ndk_identity(ndk):
    require((ndk / "build/cmake/android.toolchain.cmake").is_file(), "NDK_TOOLCHAIN")
    properties = (ndk / "source.properties").read_text()
    expected = {"Pkg.Revision": NDK_REVISION, "Pkg.BaseRevision": NDK_VERSION, "Pkg.ReleaseName": NDK_RELEASE}
    for key, value in expected.items():
        matches = re.findall(r"(?m)^" + re.escape(key) + r"[ \t]*=[ \t]*([^\r\n]*)", properties)
        require([m.strip() for m in matches] == [value], "NDK_REVISION")
    return expected


X86_FEATURES = {"GGML_SSE42": "sse4_2", "GGML_AVX": "avx", "GGML_AVX2": "avx2",
                "GGML_FMA": "fma", "GGML_F16C": "f16c", "GGML_BMI2": "bmi2"}


def x86_flags(simd):
    require(type(simd) is bool, "ANDROID_SIMD_MODE")
    return [f"-D{option}={'ON' if simd else 'OFF'}" for option in X86_FEATURES]


def build(src, out, ndk=None, abi="arm64-v8a", *, x86_simd=False):
    require(not x86_simd or (ndk is not None and abi == "x86_64"), "ANDROID_SIMD_ABI")
    args = ["cmake", "-S", src, "-B", out, "-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release",
            "-DSD_BUILD_EXAMPLES=ON", "-DSD_SERVER_BUILD_FRONTEND=OFF", "-DSD_WEBP=OFF", "-DSD_WEBM=OFF",
            "-DSD_BUILD_SHARED_LIBS=OFF", "-DSD_BUILD_SHARED_GGML_LIB=OFF", "-DSD_OPENCL=OFF",
            "-DGGML_NATIVE=OFF", "-DGGML_OPENMP=OFF"]
    if ndk is not None:
        require(abi in ANDROID_ABIS, "ANDROID_ABI")
        ndk_identity(ndk)
        args += ["-DCMAKE_TOOLCHAIN_FILE=" + str(ndk / "build/cmake/android.toolchain.cmake"),
                 "-DANDROID_ABI=" + abi, "-DANDROID_PLATFORM=android-33", "-DANDROID_STL=c++_static"]
        if abi == "x86_64":
            args += x86_flags(x86_simd)
    run(args)
    if ndk is not None and abi == "x86_64":
        cache = (out / "CMakeCache.txt").read_text()
        for option in X86_FEATURES:
            require(re.findall(r"(?m)^" + option + r":BOOL=(ON|OFF)$", cache) ==
                    ["ON" if x86_simd else "OFF"], "ANDROID_SIMD_CACHE")
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


def qualify(result, mode, ndk=None, abi="arm64-v8a"):
    require(mode in ("host", "android"), "QUALIFICATION_MODE")
    require(mode == "host" or ndk is not None, "NDK_REQUIRED")
    require(abi in ANDROID_ABIS, "ANDROID_ABI")
    result.mkdir(parents=True, exist_ok=False)
    with tempfile.TemporaryDirectory(prefix="iwxa-public-image-") as tmp:
        root = Path(tmp)
        src = root / "source"
        checkout(src)
        print("ORIGINAL_IMAGE_SOURCE=PASS", flush=True)
        receipt = {"engineRevision": ENGINE_REV, "engineTree": ENGINE_TREE, "ggmlRevision": GGML_REV,
                   "androidExecution": "NOT_RUN", "physicalDevice": "NOT_RUN", "semanticQuality": "NOT_RUN"}
        if mode == "host":
            host = build(src, root / "host")
            print("ORIGINAL_IMAGE_HOST_BUILD=PASS", flush=True)
            model = root / "model.gguf"
            download_model(model)
            print("ORIGINAL_IMAGE_MODEL_IDENTITY=PASS", flush=True)
            images = [generate(host, model, result, i, p) for i, p in enumerate(PROMPTS, 1)]
            require(images[0]["pixelSha256"] != images[1]["pixelSha256"], "IMAGE_REPEAT")
            receipt.update({"modelSha256": MODEL_SHA, "modelBytes": MODEL_BYTES,
                            "hostCpuGeneration": "PASS", "images": images})
            print("ORIGINAL_IMAGE_CPU_GENERATION=PASS", flush=True)
        else:
            identity = ndk_identity(ndk)
            print("ORIGINAL_IMAGE_NDK_REVISION=" + identity["Pkg.Revision"], flush=True)
            arm = build(src, root / abi, ndk, abi)
            elf = run(["readelf", "-hW", arm], capture=True)
            require(re.search(r"(?m)^\s*Machine:\s+" + re.escape(ANDROID_ABIS[abi]) + r"\s*$", elf), "ANDROID_ELF_ARCH")
            dependencies = run(["readelf", "-dW", arm], capture=True)
            require(not re.search(r"Shared library: \[(?:libggml|libstable-diffusion|libc\+\+_shared)", dependencies), "ANDROID_SHARED_RUNTIME")
            verify_source(src)
            receipt.update({"ndk": NDK_VERSION, "ndkRevision": identity["Pkg.Revision"], "abi": abi,
                            "androidBuild": "PASS", "androidCliSha256": hashlib.sha256(arm.read_bytes()).hexdigest()})
            print("ORIGINAL_IMAGE_ANDROID_BUILD=" + abi + ":PASS", flush=True)
        (result / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
        print("PUBLIC_IMAGE_" + mode.upper() + "=PASS", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--result", required=True, type=Path)
    parser.add_argument("--mode", required=True, choices=("host", "android"))
    parser.add_argument("--ndk", type=Path)
    parser.add_argument("--abi", choices=tuple(ANDROID_ABIS), default="arm64-v8a")
    args = parser.parse_args()
    qualify(args.result.resolve(), args.mode, args.ndk.resolve() if args.ndk else None, args.abi)
