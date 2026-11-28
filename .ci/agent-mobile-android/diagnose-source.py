"""Bounded exact-source diagnosis; no Android rebuild or raw private logs."""
import base64
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import xml.etree.ElementTree as ET

def status(name,value):
    print(name+"="+str(value),flush=True)

def main():
    pin,tree=os.environ["PRIVATE_PIN"],os.environ["PRIVATE_TREE"]
    token=os.environ.pop("IWXA_TEMP_READ_TOKEN","")
    if not token:
        status("PRIVATE_READ","TOKEN_UNAVAILABLE");return 1
    with tempfile.TemporaryDirectory(prefix="iwxa-mobile-source-diagnosis-",dir=os.environ["RUNNER_TEMP"]) as tmp:
        root=Path(tmp);source=root/"source";source.mkdir()
        env=dict(os.environ)
        env.update({"GIT_TERMINAL_PROMPT":"0","GIT_LFS_SKIP_SMUDGE":"1","npm_config_cache":str(root/"npm")})
        def run(args,cwd=source,custom=None,timeout=300):
            return subprocess.run(args,cwd=cwd,env=env if custom is None else custom,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
        if run(["git","init","-q"]).returncode:
            status("GIT_INIT","FAIL");return 1
        auth=dict(env)
        auth.update({"GIT_CONFIG_COUNT":"1","GIT_CONFIG_KEY_0":"http.https://github.com/.extraheader",
                     "GIT_CONFIG_VALUE_0":"AUTHORIZATION: basic "+base64.b64encode(("x-access-token:"+token).encode()).decode()})
        fetched=run(["git","fetch","--no-tags","--depth","1","https://github.com/Faust-S/iwxa-personal-agent.git",pin],custom=auth,timeout=180)
        del token,auth
        if fetched.returncode or run(["git","checkout","--detach","-q",pin]).returncode:
            status("PRIVATE_READ","FAIL");return 1
        if run(["git","rev-parse","HEAD"]).stdout.decode().strip()!=pin or run(["git","rev-parse","HEAD^{tree}"]).stdout.decode().strip()!=tree:
            status("SOURCE_IDENTITY","FAIL");return 1
        status("SOURCE_IDENTITY","PASS")
        venv=root/"venv"
        p=run([sys.executable,"-m","venv",str(venv)],timeout=120)
        status("HOST_VENV","PASS" if p.returncode==0 else "FAIL")
        if p.returncode:return 1
        py=str(venv/"bin/python")
        p=run([py,"-m","pip","install","--disable-pip-version-check","--no-cache-dir","-r","requirements.txt","pytest==9.0.2"],timeout=240)
        status("HOST_DEPENDENCIES","PASS" if p.returncode==0 else "FAIL")
        if p.returncode:return 1
        suites=(
            ("M23_DISPATCH",["tests/test_automation_task_dispatch.py"]),
            ("ORIGINAL_SCHEDULER",["tests/test_durable_automation_retry_budget.py","tests/test_interactive_task_retry_claim.py"]),
            ("ORIGINAL_TASK_WORK_AREA",["tests/cells/test_task_goal_board_automation_session_skill.py",
                                        "-k","automation or scheduled_followup or task_lifecycle_uses_cell_writes"]),
        )
        passed=True
        for name,args in suites:
            report=root/(name+".xml")
            p=run([py,"-m","pytest","-q","--junitxml="+str(report),*args],timeout=300)
            if not report.is_file() or report.stat().st_size>16*1024*1024:
                status(name,"REPORT_MISSING");passed=False;continue
            cases=list(ET.parse(report).getroot().iter("testcase"))
            failed=[(i,c) for i,c in enumerate(cases,1) if c.find("failure") is not None or c.find("error") is not None]
            skipped=sum(c.find("skipped") is not None for c in cases)
            status(name+"_TESTS",len(cases));status(name+"_FAILURES",len(failed));status(name+"_SKIPS",skipped)
            for i,c in failed:
                status(name+"_FAIL_INDEX",i)
                # Report only test names from our own six explicitly authored tests.
                test=c.get("name","")
                if name=="M23_DISPATCH" and test in {
                    "test_first_claim_creates_original_task_and_scheduler_receipt",
                    "test_cold_claim_recovery_reads_original_result_without_model_replay",
                    "test_awaiting_result_uses_original_retry_route_only",
                    "test_changed_objective_refuses_recovery_before_any_model_call",
                    "test_unlinked_existing_task_cannot_be_claimed_by_a_different_area",
                    "test_stale_claim_cannot_enter_task_dispatch"}:
                    status(name+"_FAIL_TEST",test)
                failure=c.find("failure")
                if failure is None:failure=c.find("error")
                raw=((failure.get("message") or "")+"\n"+(failure.text or "")) if failure is not None else ""
                for code in ("AssertionError","ValueError","ValidationError","ImportError","ModuleNotFoundError","AttributeError",
                             "automation_occurrence_task_binding_mismatch","automation_occurrence_work_area_changed",
                             "automation_claim_mismatch","unknown_or_incomplete_skill","unknown_session_task"):
                    if code in raw:status(name+"_FAIL_CLASS",code)
            ok=p.returncode==0 and bool(cases) and not failed and not skipped and (name!="M23_DISPATCH" or len(cases)==6)
            status(name,"PASS" if ok else "FAIL");passed=passed and ok
        status("M23_HOST","PASS" if passed else "FAIL")
        return 0 if passed else 1
if __name__=="__main__":
    try:code=main()
    except (OSError,ValueError,KeyError,subprocess.TimeoutExpired,ET.ParseError):
        status("DIAGNOSTIC","UNCLASSIFIED_FAILURE");code=1
    status("RUNNER_CLEANUP","CHECKOUT_SCOPE_EXITED")
    sys.exit(code)
