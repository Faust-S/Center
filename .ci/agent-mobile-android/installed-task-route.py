"""Three cold-process witnesses of installed Task, original native model and Result.

Only fixed public test observations leave this disposable emulator.
No raw instrumentation logs, user data, model output or private artifacts.
"""
import argparse
import json
import os
from pathlib import Path
import re
import subprocess
import time
import uuid

APP="ru.iwxa.agent.mobile"
TEST=APP+".OriginalTaskProductInstalledTest"
EXPECTED={
    "create":("ORIGINAL_SCHEDULE_AND_MODEL_PIN","RESIDENT_CHAT_PRESERVED_NO_CLAIM",
              "REAL_LLAMA_ORIGINAL_RESULT","CHAT_REOPENS_AFTER_TASK"),
    "recover":("COLD_RESULT_WITH_MODEL_REMOVED","ORIGINAL_HUMAN_REVIEW"),
    "reviewed":("COLD_ORIGINAL_REVIEW",),
}
ERRORS=frozenset(("OFFLINE","WEBVIEW_TIMEOUT","READY","BRIDGE","CHAT_BRIDGE","CHAT_TURN",
                  "FIXTURE_DIR","FIXTURE_FRESH","FIXTURE_DIGEST","DEBUG_ONLY","ARGUMENTS",
                  "SCHEDULE","MODEL_PIN","RESIDENT","RESIDENT_DEFER","RESIDENT_ID",
                  "RESIDENT_TURNS","RESIDENT_TOKENS","NO_ATTEMPT","EXECUTION","COMPLETED",
                  "RESULT","RESULT_EMPTY","PROVIDER","MODEL","EXTERNAL_EFFECT","NO_APPROVAL",
                  "RELEASE","FIXTURE_CLEANUP","COLD_RESULT","COLD_JOB","NO_REPLAY",
                  "STALE_REVIEW","HUMAN_REVIEW","COLD_REVIEW"))
NATIVE_ERRORS=frozenset(("LOCAL_TASK_WORKER_REQUIRED","LOCAL_TASK_BUSY","LOCAL_TASK_CONVERSATION_RESIDENT",
                  "LOCAL_TASK_ENGINE_UNAVAILABLE","LOCAL_TASK_LEASE_INVALID","LOCAL_TASK_REQUEST_INVALID",
                  "LOCAL_TASK_CONTEXT_INVALID","LOCAL_TASK_GENERATION_INCOMPLETE","LOCAL_TASK_TIMEOUT",
                  "LOCAL_TASK_INFERENCE_FAILED","LOCAL_MODEL_HASH_MISMATCH","MOBILE_TASK_MODEL_RESPONSE_CHANGED",
                  "MOBILE_TASK_MODEL_RESPONSE_INVALID","MOBILE_WORK_RESULT_BINDING_INVALID",
                  "MOBILE_TASK_NATIVE_MODEL_REQUIRED","MOBILE_WORK_JOB_CHANGED","MOBILE_TASK_RESULT_CHANGED",
                  "PYTHON_PRODUCT_NOT_INITIALIZED","LOCAL_CONTEXT_LIMIT"))

def require(condition, code):
    if not condition:
        raise RuntimeError(code)

def command(args,timeout=60):
    return subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout,check=False)

def quiet(args):
    p=command(args)
    require(p.returncode==0,"ADB_FAILED")
    return p.stdout.decode("utf-8","replace")

def status(key,value):
    print(key+"="+str(value),flush=True)

def parse(raw,phase,returncode):
    def field(name,pattern):
        return re.findall(r"(?m)^INSTRUMENTATION_STATUS: iwxa_task_"+name+"=("+pattern+r")\s*$",raw)
    checks=tuple(field("check",r"[A-Z0-9_]+"))
    terminal=field("phase",r"[A-Z_]+")
    job=field("job",r"JOB-[A-Za-z0-9_-]{1,100}")
    result=field("result",r"[0-9a-f]{64}")
    pid=field("pid",r"[1-9][0-9]{0,9}")
    if (returncode==0 and checks==EXPECTED[phase] and terminal==[phase.upper()+"_PASS"] and
            len(job)==len(result)==len(pid)==1 and re.search(r"(?m)^OK \(1 test\)\s*$",raw) and
            re.search(r"(?m)^INSTRUMENTATION_CODE: -1\s*$",raw)):
        return job[0],result[0],pid[0]
    return None

def run(adb,receipt):
    require(os.environ.get("CI")=="true","DISPOSABLE_CI_REQUIRED")
    rows=[line.split() for line in quiet([adb,"devices"]).splitlines()[1:] if line.strip()]
    require(len(rows)==1 and len(rows[0])==2 and rows[0][1]=="device" and
            re.fullmatch(r"emulator-[0-9]+",rows[0][0]),"DISPOSABLE_EMULATOR_REQUIRED")
    prefix=[adb,"-s",rows[0][0]]
    def shell(*args):return quiet(prefix+["shell",*args])
    require(quiet(prefix+["emu","avd","name"]).splitlines()[0].strip()=="iwxa_mobile_ci" and
            shell("getprop","ro.kernel.qemu").strip()=="1","DISPOSABLE_AVD_REQUIRED")
    require(receipt.get("scope")=="MEMORY_AUTOMATION_PRODUCT_PORT" and receipt.get("release_variant") is True and
            re.fullmatch(r"[0-9a-f]{40}",receipt.get("revision","")) and
            re.fullmatch(r"[0-9a-f]{40}",receipt.get("tree","")) and
            re.fullmatch(r"[0-9a-f]{64}",receipt.get("archive_sha256","")) and
            receipt.get("files")==175,"TASK_PRODUCT_BUILD_RECEIPT")
    require(shell("pm","path",APP).strip().startswith("package:") and
            shell("pm","path",APP+".test").strip().startswith("package:"),"TASK_PRODUCT_NOT_INSTALLED")
    def cold():
        shell("am","force-stop",APP)
        p=command(prefix+["shell","pidof",APP])
        require(p.returncode==1 and not p.stdout.strip(),"PROCESS_NOT_STOPPED")
    case=uuid.uuid4().hex
    pids=set()
    identity=None
    try:
        cold()
        shell("cmd","connectivity","airplane-mode","enable")
        shell("svc","wifi","disable");shell("svc","data","disable")
        require(shell("settings","get","global","airplane_mode_on").strip()=="1","OFFLINE_NOT_ENABLED")
        time.sleep(3)
        for phase in EXPECTED:
            cold()
            status("TASK_PRODUCT_PHASE",phase)
            extras=[] if identity is None else ["-e","iwxa_task_job",identity[0],"-e","iwxa_task_result",identity[1]]
            p=command(prefix+["shell","am","instrument","-w","-r","-e","class",TEST,
                "-e","iwxa_task_phase",phase,"-e","iwxa_task_case",case,*extras,
                APP+".test/androidx.test.runner.AndroidJUnitRunner"],timeout=600)
            raw=p.stdout.decode("utf-8","replace")
            parsed=parse(raw,phase,p.returncode)
            if parsed is None:
                # Fixed allowlists only, never the raw test response.
                for code in sorted(set(re.findall(r"\bTASK_PRODUCT_([A-Z0-9_]+)\b",raw))&ERRORS):
                    status("TASK_PRODUCT_FAILURE_CODE",code)
                for code in sorted(set(re.findall(r"\b(?:LOCAL|MOBILE|PYTHON)_[A-Z0-9_]+\b",raw))&NATIVE_ERRORS):
                    status("TASK_PRODUCT_FAILURE_CODE",code)
                for check in re.findall(r"(?m)^INSTRUMENTATION_STATUS: iwxa_task_check=([A-Z0-9_]+)\s*$",raw):
                    if check in EXPECTED[phase]:status("TASK_PRODUCT_CHECK",check)
                raise RuntimeError("TASK_PRODUCT_INSTRUMENTATION_FAILED")
            job,result,pid=parsed
            require(pid not in pids,"TASK_PRODUCT_PROCESS_REUSED")
            pids.add(pid)
            if identity is None:identity=(job,result)
            require(identity==(job,result),"TASK_PRODUCT_RESULT_CHANGED")
            for check in EXPECTED[phase]:status("TASK_PRODUCT_CHECK",check)
            status("TASK_PRODUCT_"+phase.upper(),"PASS")
    finally:
        cold()
        shell("cmd","connectivity","airplane-mode","disable")
        shell("svc","wifi","enable");shell("svc","data","enable")
    status("TASK_PRODUCT_INSTALLED","PASS")

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--adb",required=True)
    p.add_argument("--receipt",type=Path,required=True)
    args=p.parse_args()
    try:run(args.adb,json.loads(args.receipt.read_text(encoding="utf-8")))
    except RuntimeError as e:
        code=str(e)
        status("TASK_PRODUCT_FAILURE",code if re.fullmatch(r"[A-Z0-9_]{1,100}",code) else "UNCLASSIFIED")
        return 1
    except subprocess.TimeoutExpired:
        status("TASK_PRODUCT_FAILURE","TIMEOUT")
        return 1
    except Exception:
        status("TASK_PRODUCT_FAILURE","UNCLASSIFIED")
        return 1
    return 0

if __name__=="__main__":
    raise SystemExit(main())
