"""Bounded exact-source diagnosis; no Android rebuild or raw private logs."""
import base64
import os
import json
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import shutil
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
        # Qualify the precise source payload intended for Android, not imports
        # accidentally resolved against the private development checkout.
        archive=root/"original-core.zip"
        p=run([py,"mobile/scripts/stage-original-python-core.py","--source",str(source),
               "--revision",pin,"--tree",tree,"--output",str(archive)],timeout=120)
        if p.returncode or not archive.is_file():
            status("ORIGINAL_ARCHIVE","FAIL");return 1
        receipt=json.loads(p.stdout)
        if receipt["revision"]!=pin or receipt["tree"]!=tree:
            status("ORIGINAL_ARCHIVE","IDENTITY_FAIL");return 1
        target=root/"original"
        target.mkdir()
        extractor=source/"mobile/native/android/python/iwxa_original_core_source.py"
        script="import runpy,sys;from pathlib import Path; f=runpy.run_path(sys.argv[1]); n=f['extract_original'](Path(sys.argv[2]),Path(sys.argv[3]),sys.argv[4],sys.argv[5],sys.argv[6]); assert n==int(sys.argv[7]); print('ARCHIVE_VERIFIED')"
        p=run([py,"-I","-c",script,str(extractor),str(archive),str(target),receipt["archive_sha256"],pin,tree,str(receipt["files"])],timeout=120)
        if p.returncode or p.stdout.strip()!=b"ARCHIVE_VERIFIED":
            status("ORIGINAL_ARCHIVE","VERIFY_FAIL");return 1
        status("ORIGINAL_ARCHIVE","PASS")
        status("ORIGINAL_ARCHIVE_FILES",receipt["files"])
        isolated={**env,"IWXA_ORIGINAL_TASK_ROOT":str(target)}
        report=root/"mobile.xml"
        test=source/"mobile/qualification/python-core-product/test_original_task_integration.py"
        p=run([py,"-I","-m","pytest","-q","--noconftest","--import-mode=importlib",
               "--rootdir="+str(root),"--junitxml="+str(report),str(test),str(test.with_name("test_mobile_work_port.py"))],cwd=root,custom=isolated,timeout=240)
        if not report.is_file():
            status("MOBILE_TASK_ARCHIVE","REPORT_MISSING")
            return 1
        cases=list(ET.parse(report).getroot().iter("testcase"))
        failed=[c for c in cases if c.find("failure") is not None or c.find("error") is not None]
        skipped=sum(c.find("skipped") is not None for c in cases)
        status("MOBILE_TASK_ARCHIVE_TESTS",len(cases))
        status("MOBILE_TASK_ARCHIVE_FAILURES",len(failed))
        status("MOBILE_TASK_ARCHIVE_SKIPS",skipped)
        allowed={
            "test_original_archive_import_identity","test_complete_original_task_and_human_review",
            "test_result_survives_lost_scheduler_ack_without_replay",
            "test_native_binding_failure_retry_reuses_original_task",
            "test_invalid_or_empty_output_is_never_a_result","test_no_implicit_source_access",
            "test_action_candidates_are_not_authorized_by_inference",
            "test_direct_model_port_cannot_bypass_original_invocation_authority",
            "test_stale_scheduler_claim_cannot_invoke",
            "test_schedule_is_exact_original_job","test_execute_selected_job_without_consuming_older_job",
            "test_original_foreign_job_cannot_be_claimed","test_stale_job_revision_never_invokes",
            "test_future_job_never_consumes_attempt","test_native_model_change_pauses_original_job",
            "test_cold_result_and_human_review_are_original","test_review_cannot_substitute_another_jobs_task",
            "test_input_rejects_model_text_injection_and_bad_schedule","test_recurring_job_preserves_first_result_and_next_occurrence",
        }
        for case in failed:
            if case.get("name") in allowed:status("MOBILE_TASK_FAIL_TEST",case.get("name"))
            failure=case.find("failure")
            if failure is None:failure=case.find("error")
            raw=((failure.get("message") or "")+"\n"+(failure.text or "")) if failure is not None else ""
            for code in ("AssertionError","ValueError","ValidationError","ImportError","ModuleNotFoundError",
                         "AttributeError","TypeError","KeyError","FileNotFoundError","TaskCellError",
                         "MOBILE_TASK_CONTEXT_TOO_LARGE","MOBILE_TASK_MODEL_RESPONSE_CHANGED",
                         "MOBILE_TASK_MODEL_RESPONSE_INVALID","MOBILE_TASK_SESSION_NOT_ACTIVE",
                         "MOBILE_TASK_SOURCE_ROUTE_UNAVAILABLE","MOBILE_TASK_RESULT_CHANGED",
                         "MOBILE_TASK_ROUTE_UNAVAILABLE","MOBILE_TASK_MODEL_REQUIRED","automation_claim_mismatch"):
                if code in raw:status("MOBILE_TASK_FAIL_CLASS",code)
        mobile_ok=p.returncode==0 and len(cases)==19 and not failed and not skipped
        status("MOBILE_TASK_ARCHIVE","PASS" if mobile_ok else "FAIL")
        package=run([py,"mobile/qualification/test_original_python_qa.py"],timeout=180)
        package_ok=package.returncode==0
        status("ARCHIVE_REGRESSION","PASS" if package_ok else "FAIL")
        compiler=shutil.which("kotlinc")
        kotlin_ok=False
        if compiler and shutil.which("java"):
            jar=root/"identity-tests.jar"
            p=run([compiler,"mobile/native/android/ModelFileIntegrity.kt",
                   "mobile/qualification/ModelFileIntegrityTest.kt","-include-runtime","-d",str(jar)],timeout=180)
            status("MODEL_IDENTITY_COMPILE","PASS" if p.returncode==0 else "FAIL")
            if p.returncode==0:
                p=run(["java","-jar",str(jar)],timeout=120)
                kotlin_ok=p.returncode==0 and re.findall(rb"(?m)^MODEL_FILE_INTEGRITY=(\d+)/27; SKIPPED=0\s*$",p.stdout)==[b"27"]
                status("MODEL_IDENTITY_TESTS","27/27" if kotlin_ok else "FAIL")
        else:
            status("MODEL_IDENTITY_COMPILE","TOOL_UNAVAILABLE")
        suites=(
            ("M23_DISPATCH",["tests/test_automation_task_dispatch.py"]),
            ("ORIGINAL_SCHEDULER",["tests/test_durable_automation_retry_budget.py","tests/test_interactive_task_retry_claim.py"]),
            ("ORIGINAL_TASK_WORK_AREA",["tests/cells/test_task_goal_board_automation_session_skill.py",
                                        "-k","automation or scheduled_followup or task_lifecycle_uses_cell_writes"]),
        )
        passed=mobile_ok and package_ok and kotlin_ok
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
                    "test_stale_claim_cannot_enter_task_dispatch","test_created_task_is_not_an_automation_result"}:
                    status(name+"_FAIL_TEST",test)
                failure=c.find("failure")
                if failure is None:failure=c.find("error")
                raw=((failure.get("message") or "")+"\n"+(failure.text or "")) if failure is not None else ""
                for code in ("AssertionError","ValueError","ValidationError","ImportError","ModuleNotFoundError","AttributeError",
                             "automation_occurrence_task_binding_mismatch","automation_occurrence_work_area_changed",
                             "automation_claim_mismatch","unknown_or_incomplete_skill","unknown_session_task"):
                    if code in raw:status(name+"_FAIL_CLASS",code)
            ok=p.returncode==0 and bool(cases) and not failed and not skipped and (name!="M23_DISPATCH" or len(cases)==7)
            status(name,"PASS" if ok else "FAIL");passed=passed and ok
        status("M23_HOST","PASS" if passed else "FAIL")
        return 0 if passed else 1
if __name__=="__main__":
    try:code=main()
    except (OSError,ValueError,KeyError,subprocess.TimeoutExpired,ET.ParseError):
        status("DIAGNOSTIC","UNCLASSIFIED_FAILURE");code=1
    status("RUNNER_CLEANUP","CHECKOUT_SCOPE_EXITED")
    sys.exit(code)
