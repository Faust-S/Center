"""One admitted private checkout; only fixed observations leave the runner."""
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
import time
import xml.etree.ElementTree as ET
import zipfile

def status(name,value):
    print(name+"="+str(value),flush=True)

class StageFailure(Exception):
    pass

def main():
    pin,tree=os.environ["PRIVATE_PIN"],os.environ["PRIVATE_TREE"]
    token=os.environ.pop("IWXA_TEMP_READ_TOKEN","")
    if not token:
        status("PRIVATE_READ","TOKEN_UNAVAILABLE")
        return 1
    with tempfile.TemporaryDirectory(prefix="iwxa-python-qa-",dir=os.environ["RUNNER_TEMP"]) as tmp:
        root=Path(tmp)
        source=root/"source"
        source.mkdir()
        env=dict(os.environ)
        env.update({"GIT_TERMINAL_PROMPT":"0","GIT_LFS_SKIP_SMUDGE":"1",
                    "GRADLE_USER_HOME":str(root/"gradle"),"npm_config_cache":str(root/"npm"),
                    "ANDROID_AVD_HOME":str(root/"avd"),"ANDROID_EMULATOR_HOME":str(root/"emulator-home")})
        sdkroot=Path(env.get("ANDROID_HOME") or env.get("ANDROID_SDK_ROOT") or "/usr/local/lib/android/sdk")
        env["ANDROID_HOME"]=env["ANDROID_SDK_ROOT"]=str(sdkroot)
        emulator=None
        def run(args,cwd=source,timeout=600,custom=None,stdin=None):
            return subprocess.run(args,cwd=cwd,env=custom if custom is not None else env,
                                  input=stdin,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
        def diagnose(label,output):
            # Do not reveal private compiler text, test names, payloads or paths.
            text=output.decode("utf-8","replace")
            for key,pattern in (
                ("GRADLE_CONFIGURATION",r"Could not compile|Could not find method|Could not get unknown property|A problem occurred evaluating"),
                ("DEPENDENCY_RESOLUTION",r"No matching distribution found|Could not find com\.chaquo|Could not resolve|ResolutionImpossible"),
                ("NATIVE_LINK",r"UnsatisfiedLinkError|dlopen failed|undefined reference"),
                ("COMPILE",r"cannot find symbol|Unresolved reference|incompatible types|error:"),
                ("ANDROID_INSTALL",r"INSTALL_FAILED_|InstallException"),
                ("ASSERTION",r"AssertionError|AssertionFailedError"),
                ("PYTHON_EXCEPTION",r"PyException|Traceback"),
            ):
                if re.search(pattern,text,re.IGNORECASE):status(label+"_CLASS",key)
            for code in sorted(set(re.findall(r"\bPYTHON_(?:QA|SOURCE|DEPENDENCIES|SCHEMA)_[A-Z0-9_]{2,80}\b",text))):
                # Fixed public QA codes, not arbitrary private exception contents.
                if code in {"PYTHON_QA_WHEELHOUSE_INCOMPLETE","PYTHON_QA_WHEEL_RECEIPT","PYTHON_QA_GRADLE_TEMPLATE",
                            "PYTHON_QA_PROJECT_NOT_CLEAN","PYTHON_QA_GENERATED_ANDROID_REQUIRED","PYTHON_QA_WHEEL_VERSION",
                            "PYTHON_SOURCE_INCOMPLETE","PYTHON_SOURCE_PIN_INVALID","PYTHON_SOURCE_TREE_MISMATCH",
                            "PYTHON_SOURCE_REVISION_MISMATCH","PYTHON_DEPENDENCIES_CHANGED","PYTHON_SCHEMA_INVALID"}:
                    status(label+"_CODE",code)
            for line in text.splitlines():
                m=re.search(r"(OriginalMemoryProductInstalledTest\.java|OriginalTaskProductInstalledTest\.java|OriginalMemoryPlugin\.java|OriginalPythonCoreRuntime\.java|OriginalTaskModel\.kt|NativeModelAdmission\.kt|ModelFileIntegrity\.kt|LocalModelPlugin\.kt)(?::|\s*:)\(?(\d{1,4})(?:[:,]\s*(\d{1,3}))?",line)
                if m and ("error:" in line or line.startswith("e:")):
                    status(label+"_LOCATION",m[1]+":"+m[2]+":"+(m[3] or "0"))
                    if "keySet" in line:status(label+"_CODE","ANDROID_JSON_KEYSET")
        def stage(label,args,cwd=source,timeout=600,stdin=None):
            status("STAGE_STARTED",label)
            try:
                p=run(args,cwd,timeout,stdin=stdin)
            except subprocess.TimeoutExpired:
                status(label,"TIMEOUT");raise StageFailure(label)
            if p.returncode:
                diagnose(label,p.stdout);status(label,"FAIL");raise StageFailure(label)
            status(label,"PASS")
            return p.stdout
        def check(condition,label):
            if not condition:
                status(label,"FAIL");raise StageFailure(label)
        def tool(name):
            found=shutil.which(name,path=env["PATH"])
            if found:return found
            for path in (sdkroot/"cmdline-tools/latest/bin"/name,*sorted(sdkroot.glob("cmdline-tools/*/bin/"+name),reverse=True)):
                if path.is_file():return str(path)
            raise StageFailure("SDK_TOOL_MISSING")
        try:
            stage("GIT_INIT",["git","init","-q"])
            auth=dict(env)
            auth.update({"GIT_CONFIG_COUNT":"1","GIT_CONFIG_KEY_0":"http.https://github.com/.extraheader",
                         "GIT_CONFIG_VALUE_0":"AUTHORIZATION: basic "+base64.b64encode(("x-access-token:"+token).encode()).decode()})
            fetched=run(["git","fetch","--no-tags","--depth","1","https://github.com/Faust-S/iwxa-personal-agent.git",pin],custom=auth,timeout=180)
            del auth,token
            check(fetched.returncode==0,"PRIVATE_READ")
            stage("PRIVATE_CHECKOUT",["git","checkout","--detach","-q",pin])
            check(run(["git","rev-parse","HEAD"]).stdout.decode().strip()==pin and
                  run(["git","rev-parse","HEAD^{tree}"]).stdout.decode().strip()==tree,"PRIVATE_PIN")
            status("PRIVATE_READ","PASS");status("SOURCE_PIN",pin)
            mobile=source/"mobile"
            status("PRIOR_SOURCE_PASS_RUN","46132772783")
            status("EXACT_NATIVE_ONLY_DELTA","TWO_ANDROID_FILES")
            source_archive=root/"source.zip"
            raw=stage("ORIGINAL_PYTHON_STAGE",[sys.executable,"mobile/scripts/stage-original-python-core.py",
                      "--source",str(source),"--revision",pin,"--tree",tree,"--output",str(source_archive)],timeout=180)
            receipt=json.loads(raw)
            check(receipt.get("revision")==pin and receipt.get("tree")==tree and
                  receipt.get("archive_sha256")==hashlib.sha256(source_archive.read_bytes()).hexdigest(),
                  "ORIGINAL_SOURCE_RECEIPT")
            status("ORIGINAL_PYTHON_FILES",receipt["files"])
            py=sys.executable
            stage("NPM_CI",["npm","ci","--no-audit","--no-fund"],mobile)
            t3pin,t3tree=env["T3_PIN"],env["T3_TREE"]
            spec=json.loads((mobile/"product/t3-source.json").read_text())
            check(spec.get("repository")=="Faust-S/knowledge" and spec.get("revision")==t3pin and spec.get("tree")==t3tree,"T3_PIN")
            shared=root/"t3";shared.mkdir()
            stage("T3_INIT",["git","init","-q"],shared)
            stage("T3_FETCH",["git","fetch","--no-tags","--depth","1","https://github.com/Faust-S/knowledge.git",t3pin],shared,240)
            stage("T3_CHECKOUT",["git","checkout","--detach","-q",t3pin],shared)
            check(run(["git","rev-parse","HEAD^{tree}"],shared).stdout.decode().strip()==t3tree,"T3_TREE")
            t3build=root/"t3-build"
            stage("ORIGINAL_T3_BUILD",[py,"mobile/scripts/prepare-original-t3.py",str(shared),str(t3build)],timeout=1800)
            env["IWXA_MOBILE_T3_BUILD_ROOT"]=str(t3build);env["IWXA_MOBILE_T3_REQUIRED"]="1"
            native=json.loads((mobile/"native/llama-source.json").read_text())
            sdk=tool("sdkmanager");avd=tool("avdmanager")
            stage("SDK_BUILD_INPUTS",[sdk,"--install","--channel=3","platforms;android-36","build-tools;36.0.0",
                   "ndk;"+native["ndk"],"cmake;"+native["cmake"]],timeout=1200,stdin=b"y\n"*100)
            stage("ANDROID_CONFIGURATION",["node","scripts/prepare-android.mjs","--configuration-only"],mobile,180)
            stage("PYTHON_QA_PREPARE",[sys.executable,"mobile/scripts/prepare-original-python-qa.py",
                  "--product","--source",str(source),"--revision",pin,"--tree",tree,"--wheelhouse",
                  str(Path(env["RUNNER_TEMP"])/"iwxa-python-wheels")],timeout=180)
            app=mobile/"android/app"
            build_receipt=app/"iwxa-original-python-product-receipt.json"
            build=json.loads(build_receipt.read_text())
            check(build.get("archive_sha256")==receipt["archive_sha256"] and build.get("wheel_count")==7 and
                  build.get("release_variant") is True and build.get("scope")=="MEMORY_AUTOMATION_PRODUCT_PORT","PYTHON_PRODUCT_BUILD_RECEIPT")
            stage("PYTHON_GRADLE_CONFIGURATION",["bash","./gradlew","help","--no-daemon","--console=plain"],mobile/"android",600)
            stage("LLAMA_NATIVE_INPUTS",["node","scripts/prepare-llama.mjs","--fetch"],mobile,2400)
            stage("SPEECH_NATIVE_INPUTS",["node","scripts/prepare-speech.mjs","--fetch"],mobile,600)
            stage("PUBLIC_QA_MODEL_INPUT",["node","scripts/prepare-qa-model.mjs","--fetch"],mobile,300)
            stage("ANDROID_NATIVE_INPUTS",["node","scripts/prepare-android.mjs","--native-inputs-only","--device"],mobile,600)
            stage("ANDROID_TARGETED_KOTLIN_JAVA_COMPILE",["bash","./gradlew",":app:compileDebugKotlin",":app:compileDebugJavaWithJavac","--no-daemon","--console=plain"],mobile/"android",1200)
            stage("PYTHON_PRODUCT_APK",["bash","./gradlew",":app:assembleDebug",":app:assembleDebugAndroidTest",":app:assembleRelease","--no-daemon","--console=plain"],mobile/"android",3000)
            apk=app/"build/outputs/apk/debug/app-debug.apk"
            testapk=app/"build/outputs/apk/androidTest/debug/app-debug-androidTest.apk"
            check(apk.is_file() and testapk.is_file(),"PYTHON_QA_APK_OUTPUT")
            with zipfile.ZipFile(testapk) as test_archive:
                qa_model=test_archive.read("assets/qa-model.gguf")
                check(hashlib.sha256(qa_model).hexdigest()==native["fixture"]["sha256"],"QA_MODEL_APK_IDENTITY")
                del qa_model
            status("QA_MODEL_APK_IDENTITY","PASS")
            releases=list((app/"build/outputs/apk/release").glob("app-release*.apk"))
            check(len(releases)==1 and releases[0].is_file(),"PYTHON_PRODUCT_RELEASE_OUTPUT")
            for kind,package in (("DEBUG",apk),("RELEASE",releases[0])):
                with zipfile.ZipFile(package) as archive:
                    names=set(archive.namelist())
                    expected={"assets/iwxa-original-python-core.zip","assets/iwxa-original-python-core-receipt.json",
                              "assets/public/app.js","lib/arm64-v8a/libpython3.13.so","lib/x86_64/libpython3.13.so"}
                    check(expected<=names and "assets/qa-model.gguf" not in names,"PYTHON_PRODUCT_"+kind+"_CONTENTS")
                    check(hashlib.sha256(archive.read("assets/iwxa-original-python-core.zip")).hexdigest()==receipt["archive_sha256"] and
                          json.loads(archive.read("assets/iwxa-original-python-core-receipt.json"))==build,
                          "PYTHON_PRODUCT_"+kind+"_IDENTITY")
                status("PYTHON_PRODUCT_"+kind+"_APK_BYTES",package.stat().st_size)
                status("PYTHON_PRODUCT_"+kind+"_ORIGINAL_CORE","PASS")
            image="system-images;android-35;google_apis;x86_64"
            stage("SDK_EMULATOR_INPUTS",[sdk,"--install","emulator",image],timeout=900,stdin=b"y\n"*100)
            if not Path("/dev/kvm").exists():
                run(["sudo","modprobe","kvm"],timeout=20)
                run(["sudo","modprobe","kvm_intel"],timeout=20)
            accelerated=Path("/dev/kvm").exists()
            if accelerated:stage("KVM",["sudo","chmod","a+rw","/dev/kvm"])
            Path(env["ANDROID_AVD_HOME"]).mkdir();Path(env["ANDROID_EMULATOR_HOME"]).mkdir()
            stage("AVD_CREATE",[avd,"create","avd","-n","iwxa_mobile_ci","-k",image,"--force"],stdin=b"no\n")
            adb=str(sdkroot/"platform-tools/adb")
            with (root/"emulator.log").open("wb") as elog:
                emulator=subprocess.Popen([str(sdkroot/"emulator/emulator"),"-avd","iwxa_mobile_ci","-no-window",
                    "-no-boot-anim","-no-snapshot","-gpu","swiftshader_indirect","-accel","on" if accelerated else "off",
                    "-memory","4096","-cores","4","-partition-size","8192"],env=env,stdout=elog,stderr=subprocess.STDOUT)
                end=time.monotonic()+(300 if accelerated else 600)
                ready=False
                while time.monotonic()<end and emulator.poll() is None:
                    try:
                        if run([adb,"shell","getprop","sys.boot_completed"],timeout=10).stdout.strip()==b"1":
                            if b"package:" in run([adb,"shell","pm","path","android"],timeout=10).stdout:
                                ready=True;break
                    except subprocess.TimeoutExpired:pass
                    time.sleep(5)
                check(ready,"ANDROID_EMULATOR")
                status("ANDROID_EMULATOR","PASS")
                stage("PYTHON_QA_INSTALL_APP",[adb,"install",str(apk)],timeout=180)
                stage("PYTHON_QA_INSTALL_TEST",[adb,"install",str(testapk)],timeout=180)
                outcome=run([py,"mobile/qualification/installed-memory-product-route.py","--adb",adb,
                             "--receipt",str(build_receipt)],timeout=1500)
                for line in outcome.stdout.decode("utf-8","replace").splitlines():
                    if re.fullmatch(r"MEMORY_PRODUCT_(?:PHASE=(?:create|recover|forgotten)|(?:CREATE|RECOVER|FORGOTTEN|INSTALLED)=PASS|CHECK=[A-Z0-9_]{1,80}|FAILURE(?:_CODE)?=[A-Z0-9_]{1,100})",line):
                        status(*line.split("=",1))
                check(outcome.returncode==0 and b"MEMORY_PRODUCT_INSTALLED=PASS" in outcome.stdout,"MEMORY_PRODUCT_INSTALLED")
                status("PRODUCT_MEMORY_UI","PASS")
                # Public runner has no access token and reads only fixed
                # instrumentation receipts. It never prints Task content,
                # model output, run identifiers or raw device logs.
                witness=Path(__file__).resolve().with_name("installed-task-route.py")
                outcome=run([py,str(witness),"--adb",adb,"--receipt",str(build_receipt)],timeout=1800)
                for line in outcome.stdout.decode("utf-8","replace").splitlines():
                    if re.fullmatch(r"TASK_PRODUCT_(?:PHASE=(?:create|recover|reviewed)|(?:CREATE|RECOVER|REVIEWED|INSTALLED)=PASS|CHECK=[A-Z0-9_]{1,80}|FAILURE(?:_CODE)?=[A-Z0-9_]{1,100})",line):
                        status(*line.split("=",1))
                check(outcome.returncode==0 and b"TASK_PRODUCT_INSTALLED=PASS" in outcome.stdout,
                      "TASK_PRODUCT_INSTALLED")
                status("NATIVE_ORIGINAL_TASK","PASS")
            status("PHYSICAL_ARM64","NOT_RUN")
            return 0
        except StageFailure as e:
            status("QUALIFICATION_FAILED_STAGE",str(e))
            return 1
        finally:
            if emulator is not None:
                emulator.terminate()
                try:emulator.wait(timeout=20)
                except subprocess.TimeoutExpired:emulator.kill();emulator.wait()

if __name__=="__main__":
    try:
        code=main()
    except (OSError,ValueError,KeyError,subprocess.TimeoutExpired,ET.ParseError):
        status("QUALIFICATION_HOST_FAILURE","UNCLASSIFIED")
        code=1
    status("RUNNER_CLEANUP","CHECKOUT_SCOPE_EXITED")
    sys.exit(code)
