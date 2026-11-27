"""Public-only original Android ARM64 OpenCL cross-build, never GPU execution evidence."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import tempfile

from qualify import (ENGINE_REV, ENGINE_TREE, GGML_REV, checkout, ndk_identity,
                     require, run, verify_source)

HEADERS = ("https://github.com/KhronosGroup/OpenCL-Headers.git",
           "6fe718c31a45fe25151362a72ef041c3a1047cbd", "185dae17ab1e5bf078e50a42a2f851ae868465d0")
LOADER = ("https://github.com/KhronosGroup/OpenCL-ICD-Loader.git",
          "b7bd2803acc779c03d96588e9ca9e9568a18698a", "992f5bd721d4460224aa2a3d3885ddc1ac72b3c9")
REQUEST = Path(".github/ci-requests/agent-mobile-public-image-opencl.json")
WORKFLOW = "agent-mobile-public-image-opencl"


def expected_request(prepared):
    require(re.fullmatch(r"[a-f0-9]{40}", prepared), "PREPARED_SHA")
    return {"workflow": WORKFLOW, "prepared_sha": prepared, "engine": ENGINE_REV,
            "engine_tree": ENGINE_TREE, "ggml": GGML_REV,
            "headers": HEADERS[1], "headers_tree": HEADERS[2],
            "loader": LOADER[1], "loader_tree": LOADER[2],
            "scope": "ANDROID_ARM64_OPENCL_CROSS_BUILD_ONLY"}


def verify_dependency(path, spec):
    require(run(["git", "-C", path, "rev-parse", "HEAD"], capture=True) == spec[1], "DEPENDENCY_REVISION")
    require(run(["git", "-C", path, "rev-parse", "HEAD^{tree}"], capture=True) == spec[2], "DEPENDENCY_TREE")
    require(not run(["git", "-C", path, "status", "--porcelain", "--untracked-files=no"], capture=True), "DEPENDENCY_DIRTY")


def fetch_dependency(path, spec):
    run(["git", "init", "-q", path])
    run(["git", "-C", path, "fetch", "--depth=1", spec[0], spec[1]])
    run(["git", "-C", path, "checkout", "--detach", "FETCH_HEAD"])
    verify_dependency(path, spec)


def android_args(ndk):
    return ["-G", "Ninja", "-DCMAKE_BUILD_TYPE=Release",
            "-DCMAKE_TOOLCHAIN_FILE=" + str(ndk / "build/cmake/android.toolchain.cmake"),
            "-DANDROID_ABI=arm64-v8a", "-DANDROID_PLATFORM=android-33", "-DANDROID_STL=c++_static"]


def loader_args(src, out, headers, ndk):
    return ["cmake", "-S", src, "-B", out] + android_args(ndk) + [
        "-DOPENCL_ICD_LOADER_HEADERS_DIR=" + str(headers),
        "-DOPENCL_ICD_LOADER_BUILD_SHARED_LIBS=ON", "-DBUILD_TESTING=OFF",
        "-DOPENCL_ICD_LOADER_BUILD_TESTING=OFF", "-DENABLE_OPENCL_LAYERS=OFF"]


def engine_args(src, out, headers, loader, ndk):
    # Use FindOpenCL's explicit inputs; do not overwrite the SDK sysroot.
    return ["cmake", "-S", src, "-B", out] + android_args(ndk) + [
        "-DSD_BUILD_EXAMPLES=ON", "-DSD_SERVER_BUILD_FRONTEND=OFF", "-DSD_WEBP=OFF", "-DSD_WEBM=OFF",
        "-DSD_BUILD_SHARED_LIBS=OFF", "-DSD_BUILD_SHARED_GGML_LIB=OFF", "-DGGML_NATIVE=OFF",
        "-DGGML_OPENMP=OFF", "-DSD_OPENCL=ON", "-DSD_VULKAN=OFF",
        "-DGGML_OPENCL_EMBED_KERNELS=ON", "-DGGML_OPENCL_USE_ADRENO_KERNELS=ON",
        "-DOpenCL_INCLUDE_DIR=" + str(headers), "-DOpenCL_LIBRARY=" + str(loader)]


def arm64_elf(header):
    require(re.search(r"(?m)^\s*Class:\s+ELF64\s*$", header) and
            re.search(r"(?m)^\s*Machine:\s+AArch64\s*$", header), "OPENCL_ELF_ARCH")


def verify_binary_evidence(cli_header, loader_header, cli_dynamic, loader_dynamic, loader_symbols):
    arm64_elf(cli_header)
    arm64_elf(loader_header)
    soname = re.findall(r"Library soname: \[([^\]]+)\]", loader_dynamic)
    require(len(soname) == 1 and re.fullmatch(r"libOpenCL\.so(?:\.\d+)*", soname[0]), "OPENCL_LOADER_SONAME")
    deps = re.findall(r"Shared library: \[([^\]]+)\]", cli_dynamic)
    require(soname[0] in deps, "OPENCL_LINK_MISSING")
    require(not any(x.startswith(("libggml", "libstable-diffusion", "libc++_shared")) for x in deps), "OPENCL_UNEXPECTED_RUNTIME")
    for symbol in ("clGetPlatformIDs", "clGetDeviceIDs"):
        require(any(re.search(r"\b" + symbol + r"(?:@@?\S+)?\s*$", line) and " UND " not in line
                    for line in loader_symbols.splitlines()), "OPENCL_LOADER_EXPORTS")
    return {"loaderSoname": soname[0], "cliDependencies": deps}


def qualify(result, ndk):
    identity = ndk_identity(ndk)
    result.mkdir(parents=True, exist_ok=False)
    with tempfile.TemporaryDirectory(prefix="iwxa-image-opencl-") as tmp:
        root = Path(tmp)
        src, headers, loader_src = (root / x for x in ("source", "headers", "loader-source"))
        checkout(src)
        fetch_dependency(headers, HEADERS)
        fetch_dependency(loader_src, LOADER)
        print("PUBLIC_OPENCL_SOURCE=PASS", flush=True)
        loader_build = root / "loader-build"
        run(loader_args(loader_src, loader_build, headers, ndk))
        run(["cmake", "--build", loader_build, "--target", "OpenCL", "--parallel", "2"])
        loader = (loader_build / "libOpenCL.so").resolve(strict=True)
        require(loader.is_file(), "OPENCL_LOADER_MISSING")
        print("PUBLIC_OPENCL_LOADER_BUILD=PASS", flush=True)
        out = root / "engine-build"
        run(engine_args(src, out, headers, loader, ndk))
        run(["cmake", "--build", out, "--target", "sd-cli", "--parallel", "2"], timeout=3600)
        cli = out / "bin/sd-cli"
        require(cli.is_file(), "OPENCL_CLI_MISSING")
        evidence = verify_binary_evidence(
            run(["readelf", "-hW", cli], capture=True), run(["readelf", "-hW", loader], capture=True),
            run(["readelf", "-dW", cli], capture=True), run(["readelf", "-dW", loader], capture=True),
            run(["readelf", "--dyn-syms", "-W", loader], capture=True))
        verify_source(src)
        verify_dependency(headers, HEADERS)
        verify_dependency(loader_src, LOADER)
        receipt = {"engineRevision": ENGINE_REV, "engineTree": ENGINE_TREE, "ggmlRevision": GGML_REV,
                   "headersRevision": HEADERS[1], "headersTree": HEADERS[2],
                   "loaderRevision": LOADER[1], "loaderTree": LOADER[2],
                   "ndkRevision": identity["Pkg.Revision"], "abi": "arm64-v8a", "androidApi": 33,
                   "backend": "ORIGINAL_OPENCL_ADRENO", "loaderSha256": hashlib.sha256(loader.read_bytes()).hexdigest(),
                   "cliSha256": hashlib.sha256(cli.read_bytes()).hexdigest(), **evidence,
                   "crossBuild": "PASS", "apkPackaging": "NOT_RUN", "vendorDriverAccess": "NOT_RUN",
                   "physicalDevice": "NOT_RUN", "gpuInference": "NOT_RUN", "performance": "NOT_RUN"}
        (result / "receipt.json").write_text(json.dumps(receipt, indent=2) + "\n")
        print("PUBLIC_OPENCL_ARM64_BUILD=PASS", flush=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--result", type=Path, required=True)
    parser.add_argument("--ndk", type=Path, required=True)
    parser.add_argument("--prepared-sha", required=True)
    args = parser.parse_args()
    require(json.loads(REQUEST.read_text()) == expected_request(args.prepared_sha), "REQUEST_MISMATCH")
    qualify(args.result.resolve(), args.ndk.resolve())
