"""Build the existing owner ARM64 path and seal only the APK for its recipient."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile

from delivery_admit import EXPECTED, KEY_PATH
from delivery_crypto import PIN, TREE, encrypt_file

NAME = "IWXA-Mobile-Agent-ARM64-owner-68042c79.apk.iwxae"
CIPHER_DIR = "iwxa-mobile-owner-cipher"


def status(key, value):
    print(key + "=" + str(value), flush=True)


def require(ok, code):
    if not ok:
        raise ValueError(code)


def checked(args, cwd, env, timeout=600, stdin=None):
    return subprocess.run(args, cwd=cwd, env=env, input=stdin, stdout=subprocess.PIPE,
                          stderr=subprocess.STDOUT, timeout=timeout, check=False)


def stage(label, args, cwd, env, timeout=600, stdin=None):
    result = checked(args, cwd, env, timeout, stdin)
    status(label, "PASS" if result.returncode == 0 else "FAIL")
    require(result.returncode == 0, label + "_FAIL")
    return result.stdout.decode("utf-8", errors="replace")


def exact_checkout(label, url, pin, tree, dest, env, auth=None):
    dest.mkdir()
    stage(label + "_INIT", ["git", "init", "-q"], dest, env, 60)
    stage(label + "_FETCH", ["git", "fetch", "--no-tags", "--depth", "1", url, pin], dest, auth or env, 240)
    stage(label + "_CHECKOUT", ["git", "checkout", "--detach", "-q", pin], dest, env, 120)
    require(checked(["git", "rev-parse", "HEAD"], dest, env).stdout.decode().strip() == pin and
            checked(["git", "rev-parse", "HEAD^{tree}"], dest, env).stdout.decode().strip() == tree,
            label + "_PIN_MISMATCH")
    status(label + "_PIN", "PASS")


def assembly_receipt(report):
    lines = report.splitlines()
    required = ("OWNER_ARM64_CANDIDATE_BUILT; PHYSICAL_EXECUTION_AND_RELEASE_SIGNING_NOT_RUN",
                "IMAGE_OWNER_ARM64_APK_IDENTITY=PASS", "IMAGE_PACKAGING_TESTS=PASS",
                "IMAGE_GENERATION_COMPOSITION=12/12 PASS", "ANDROID_GRADLE_CONFIGURATION_PASS",
                "SPEECH_AAR_VERIFIED", "IMAGE_X86_CPU_PROFILE=AVX_F16C_SSE42")
    require(all(lines.count(marker) == 1 for marker in required), "OWNER_ASSEMBLY_RECEIPT")
    require(len(re.findall(r"(?m)^MOBILE_T3_APK_ASSETS_STAGED=[1-9][0-9]{0,3}\s*$", report)) == 1,
            "OWNER_T3_ASSETS_RECEIPT")
    for label, expected in (("tests", "806"), ("pass", "806"), ("fail", "0"), ("skipped", "0"), ("todo", "0")):
        require(re.findall(r"(?m)^# " + label + r" (\d+)\s*$", report) == [expected], "OWNER_NODE_RECEIPT")
    require(re.search(r"(?m)^Ran 14 tests? in [0-9.]+s\s*$", report) is not None, "OWNER_IMAGE_POLICY_RECEIPT")
    require(not any("INSTALLED_AGENT_DEBUG_TRUST_PREPARED" in line or
                    "QA_IMAGE_NATIVE_INPUTS_PREPARED" in line for line in lines), "OWNER_QA_FIXTURE")
    status("OWNER_NODE_TESTS", 806)
    status("OWNER_IMAGE_POLICY", "14/14")
    status("OWNER_APK_IDENTITY", "PASS")


def package_receipt(badging):
    require(re.findall(r"(?m)^package: name='([^']+)'", badging) == ["ru.iwxa.agent.mobile"],
            "OWNER_PACKAGE_IDENTITY")
    require(re.findall(r"(?m)^native-code:\s*([^\r\n]+)$", badging) == ["'arm64-v8a'"],
            "OWNER_PACKAGE_ABI")
    require(re.search(r"(?m)^application-debuggable\s*$", badging) is not None,
            "OWNER_PACKAGE_DEBUG_IDENTITY")


def main():
    token = os.environ.pop("IWXA_TEMP_READ_TOKEN", "")
    require(bool(token) and PIN == EXPECTED["candidate"] and TREE == EXPECTED["tree"], "OWNER_PIN_OR_TOKEN")
    require(os.environ.get("PRIVATE_PIN") == PIN and os.environ.get("PRIVATE_TREE") == TREE and
            os.environ.get("T3_PIN") == EXPECTED["original_t3"] and
            os.environ.get("T3_TREE") == EXPECTED["original_t3_tree"], "OWNER_PIN_OR_TOKEN")
    public = Path(KEY_PATH).read_text(encoding="ascii").encode("ascii")
    require(hashlib.sha256(public).hexdigest() == EXPECTED["recipient_sha256"], "OWNER_RECIPIENT")
    runner = Path(os.environ["RUNNER_TEMP"]).resolve(strict=True)
    cipher = runner / CIPHER_DIR
    require(not cipher.exists() and not cipher.is_symlink(), "OWNER_OUTPUT_EXISTS")
    created = False
    complete = False
    try:
        with tempfile.TemporaryDirectory(prefix="iwxa-owner-arm64-", dir=runner) as temporary:
            root = Path(temporary)
            source, shared = root / "source", root / "one-core-source"
            env = dict(os.environ)
            require(not env.get("IWXA_MOBILE_INSTALLED_QA_CA"), "OWNER_QA_TRUST_ENV")
            env.update({"GIT_TERMINAL_PROMPT": "0", "GIT_LFS_SKIP_SMUDGE": "1",
                        "GRADLE_USER_HOME": str(root / "gradle"), "npm_config_cache": str(root / "npm-cache")})
            if env.get("JAVA_HOME_21_X64"):
                env["JAVA_HOME"] = env["JAVA_HOME_21_X64"]
                env["PATH"] = str(Path(env["JAVA_HOME"]) / "bin") + os.pathsep + env["PATH"]
            auth = dict(env)
            auth.update({"GIT_CONFIG_COUNT": "1", "GIT_CONFIG_KEY_0": "http.https://github.com/.extraheader",
                         "GIT_CONFIG_VALUE_0": "AUTHORIZATION: basic " + base64.b64encode(("x-access-token:" + token).encode()).decode()})
            exact_checkout("OWNER_SOURCE", "https://github.com/Faust-S/iwxa-personal-agent.git", PIN, TREE, source, env, auth)
            del auth, token
            mobile = source / "mobile"
            manifest = json.loads((mobile / "package.json").read_text())
            lock = json.loads((mobile / "package-lock.json").read_text())
            require(lock.get("lockfileVersion") == 3 and all(lock.get(k) == manifest[k] and
                    lock.get("packages", {}).get("", {}).get(k) == manifest[k] for k in ("name", "version")) and
                    all(lock.get("packages", {}).get("", {}).get(k) == manifest[k] for k in
                        ("dependencies", "devDependencies", "engines")), "OWNER_LOCK")
            stage("OWNER_NPM_CI", ["npm", "ci", "--no-audit", "--no-fund"], mobile, env, 600)
            t3pin, t3tree = EXPECTED["original_t3"], EXPECTED["original_t3_tree"]
            t3spec = json.loads((mobile / "product/t3-source.json").read_text())
            require((t3spec.get("repository"), t3spec.get("revision"), t3spec.get("tree")) ==
                    ("Faust-S/knowledge", t3pin, t3tree), "OWNER_T3_PIN")
            exact_checkout("OWNER_T3_SOURCE", "https://github.com/Faust-S/knowledge.git", t3pin, t3tree, shared, env)
            t3build = root / "original-t3-build"
            report = stage("OWNER_T3_BUILD", [sys.executable, "mobile/scripts/prepare-original-t3.py",
                           str(shared), str(t3build)], source, env, 1800)
            require("MOBILE_T3_ONE_DIST=PASS" in report.splitlines(), "OWNER_T3_RECEIPT")
            env["IWXA_MOBILE_T3_BUILD_ROOT"] = str(t3build)
            env["IWXA_MOBILE_T3_REQUIRED"] = "1"
            android = Path(env.get("ANDROID_HOME") or env.get("ANDROID_SDK_ROOT") or "/usr/local/lib/android/sdk")
            env["ANDROID_HOME"] = env["ANDROID_SDK_ROOT"] = str(android)
            sdk = shutil.which("sdkmanager", path=env["PATH"])
            if not sdk:
                candidates = [android / "cmdline-tools/latest/bin/sdkmanager",
                              *sorted(android.glob("cmdline-tools/*/bin/sdkmanager"), reverse=True)]
                sdk = next((str(p) for p in candidates if p.is_file() and os.access(p, os.X_OK)), None)
            require(bool(sdk), "OWNER_SDKMANAGER")
            native = json.loads((mobile / "native/llama-source.json").read_text())
            require(native["revision"] == "5220a2d4040aa75f52678ebf52d77a0fba85de9f" and
                    native["ndk"] == "29.0.13113456" and native["cmake"] == "3.31.6", "OWNER_NATIVE_TOOLCHAIN")
            stage("OWNER_SDK_INPUTS", [sdk, "--install", "--channel=3", "platforms;android-36", "build-tools;36.0.0",
                  "ndk;" + native["ndk"], "cmake;" + native["cmake"]], source, env, 1200, b"y\n" * 100)
            result = checked(["npm", "run", "qualify:release", "--", "--owner-arm64", "--fetch-public-inputs"],
                             mobile, env, 5400)
            report = result.stdout.decode("utf-8", errors="replace")
            status("OWNER_ASSEMBLY", "PASS" if result.returncode == 0 else "FAIL")
            if result.returncode:
                # Reuse the existing bounded public diagnostic categories, not raw compiler output.
                sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "agent-mobile-android"))
                from gradle_diagnostics import failure_kinds, http_statuses
                for kind in failure_kinds(report):
                    status("OWNER_GRADLE_FAILURE_KIND", kind)
                for code in http_statuses(report):
                    status("OWNER_GRADLE_HTTP_STATUS", code)
                for flag in ("ANDROID_GRADLE_WRAPPER_PASS", "ANDROID_GRADLE_CONFIGURATION_PASS",
                             "ANDROID_GRADLE_ASSEMBLY_STARTED", "IMAGE_OWNER_ARM64_APK_IDENTITY=PASS"):
                    if flag in report.splitlines():
                        status("OWNER_OBSERVED", flag)
                require(False, "OWNER_ASSEMBLY_FAIL")
            assembly_receipt(report)
            apk = mobile / "android/app/build/outputs/apk/debug/app-debug.apk"
            require(apk.is_file() and not apk.is_symlink() and apk.stat().st_size > 0, "OWNER_APK_MISSING")
            tools = android / "build-tools/36.0.0"
            stage("OWNER_APK_SIGNATURE", [str(tools / "apksigner"), "verify", "--verbose", str(apk)], mobile, env, 120)
            package_receipt(stage("OWNER_APK_BADGING", [str(tools / "aapt"), "dump", "badging", str(apk)], mobile, env, 120))
            status("OWNER_ABI", "arm64-v8a")
            status("OWNER_APK_BYTES", apk.stat().st_size)
            cipher.mkdir()
            created = True
            plain_sha, sealed_sha = encrypt_file(apk, cipher / NAME, public)
            require(tuple(p.name for p in cipher.iterdir()) == (NAME,), "OWNER_CIPHER_OUTPUT")
            status("OWNER_APK_SHA256", plain_sha)
            status("OWNER_CIPHER_SHA256", sealed_sha)
        complete = True
        status("OWNER_DELIVERY", "ENCRYPTED_CANDIDATE_NOT_ACCEPTED")
        status("PHYSICAL_ARM64", "NOT_RUN")
        return 0
    finally:
        if created and not complete:
            shutil.rmtree(cipher, ignore_errors=True)


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError) as error:
        code = str(error)
        status("OWNER_DELIVERY_FAILURE", code if re.fullmatch(r"OWNER_[A-Z0-9_]{1,100}", code) else type(error).__name__)
        sys.exit(1)
