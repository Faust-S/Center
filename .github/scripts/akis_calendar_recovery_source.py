"""Read-only private source qualification. Publish no private source or raw logs."""
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

PACKAGE = "research/akis/qualitative_mesa"
PIN = "be596488aae6f2337f573570694bf39338982a98"
TREE = "5746cfb4303695633b3be62b0e7b1d46f7277ddd"


def emit(label, value):
    print(label+"="+str(value), flush=True)


def digest(value):
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def main():
    token = os.environ.pop("IWXA_TEMP_READ_TOKEN", "")
    if not token:
        emit("PRIVATE_READ", "TOKEN_UNAVAILABLE")
        return 1
    clean = dict(os.environ, GIT_TERMINAL_PROMPT="0", GIT_LFS_SKIP_SMUDGE="1", PYTHONUTF8="1")
    with tempfile.TemporaryDirectory(prefix="akis-private-", dir=os.environ.get("RUNNER_TEMP")) as td:
        source = Path(td)/"source"
        source.mkdir()
        def run(args, env=clean, timeout=1200):
            return subprocess.run(args, cwd=source, env=env, stdout=subprocess.PIPE,
                                  stderr=subprocess.STDOUT, timeout=timeout)
        if run(["git","init","-q"]).returncode:
            emit("PRIVATE_READ","INIT_FAIL"); return 1
        auth = dict(clean, GIT_CONFIG_COUNT="1",
                    GIT_CONFIG_KEY_0="http.https://github.com/.extraheader",
                    GIT_CONFIG_VALUE_0="AUTHORIZATION: basic "+base64.b64encode(
                        ("x-access-token:"+token).encode()).decode())
        fetch = run(["git","fetch","--no-tags","--depth","1",
                     "https://github.com/Faust-S/iwxa.git",PIN],env=auth,timeout=300)
        del auth, token
        if fetch.returncode or run(["git","checkout","--detach","-q",PIN]).returncode:
            emit("PRIVATE_READ","FETCH_FAIL"); return 1
        if (run(["git","rev-parse","HEAD"]).stdout.decode().strip()!=PIN
                or run(["git","rev-parse","HEAD^{tree}"]).stdout.decode().strip()!=TREE):
            emit("PRIVATE_READ","PIN_MISMATCH"); return 1
        emit("PRIVATE_READ","PASS"); emit("SOURCE_PIN",PIN)
        if run([sys.executable,"-m","pip","install","--disable-pip-version-check",
                "mesa==3.5.2","pytest>=8,<10"],timeout=420).returncode:
            emit("PYTHON_DEPS","FAIL"); return 1
        if run([sys.executable,"-c","import mesa; assert mesa.__version__ == '3.5.2'"]).returncode:
            emit("MESA_VERSION","FAIL"); return 1
        emit("MESA_VERSION","3.5.2")
        if run([sys.executable,"-m","compileall","-q",PACKAGE]).returncode:
            emit("COMPILE","FAIL"); return 1
        emit("COMPILE","PASS")
        if os.environ["QUALIFY_SCOPE"]=="regression":
            child = Path(td)/"pytest_gate.py"
            child.write_text('''import hashlib,json,sys,os
import pytest
sys.path.insert(0,os.getcwd())
counts={"passed":0,"failed":0,"skipped":0,"collection_errors":0}
failures=[]
class Gate:
    def pytest_runtest_logreport(self,report):
        if report.when=="call" and report.passed: counts["passed"]+=1
        if report.skipped: counts["skipped"]+=1
        if report.failed:
            counts["failed"]+=1
            crash=getattr(report.longrepr,"reprcrash",None)
            msg=str(getattr(crash,"message","") or "")
            failures.append({"test":hashlib.sha256(report.nodeid.encode()).hexdigest()[:16],
                "phase":report.when,"line":int(getattr(crash,"lineno",0) or 0),
                "message_sha256":hashlib.sha256(msg.encode()).hexdigest()})
    def pytest_collectreport(self,report):
        if report.failed: counts["collection_errors"]+=1
result=pytest.main(sys.argv[2:]+["-q","--tb=no","-p","no:cacheprovider"],plugins=[Gate()])
open(sys.argv[1],"w",encoding="utf-8").write(json.dumps({"counts":counts,"failures":failures,"exit":int(result)}))
sys.exit(int(result))
''',encoding="utf-8")
            for label, path in (("HETEROGENEITY",PACKAGE+"/tests/test_original_network_heterogeneity_mesa.py"),
                                ("RECOVERY",PACKAGE+"/tests/test_original_network_calendar_recovery_mesa.py"),
                                ("FULL",PACKAGE+"/tests")):
                output=Path(td)/(label+".json")
                result=run([sys.executable,str(child),str(output),path],timeout=1800)
                emit(label,output.read_text(encoding="utf-8") if output.exists() else "NO_RESULT")
                if result.returncode: return 1
            return 0
        child=Path(td)/"experiment.py"
        child.write_text('''import hashlib,json,os,sys,traceback
sys.path.insert(0,os.getcwd())
from research.akis.qualitative_mesa.experiments.export_original_network_calendar_recovery import compare_calendar_recovery
try:
    r=compare_calendar_recovery(int(sys.argv[2]),int(sys.argv[3]),seed=int(sys.argv[4]),direct_mode=sys.argv[5],fee=sys.argv[6],direct_tool_cost=sys.argv[7])
    payload=json.dumps(r,sort_keys=True,separators=(",",":"),allow_nan=False)
    summary={"sha256":hashlib.sha256(payload.encode()).hexdigest(),"recovery_cost":r["additional_declared_recovery_cost_both_organizations"],"recovery_economic_effects":r["recovery_economic_effects"]}
    for condition in ("normal","restored_after_disturbance"):
        x=r[condition]
        summary[condition]={"economic_contrast":x["economic_contrast"],"work_periods":x["original_work_period_contributions"],"reserve_contrast":x["independent_declared_reserve_contrast"],"with_akis":x["with_akis"],"without_akis":x["without_akis_direct_contracts"]}
    with open(sys.argv[1],"w",encoding="utf-8") as f: json.dump(summary,f,sort_keys=True)
except Exception as exc:
    frames=traceback.extract_tb(exc.__traceback__)
    with open(sys.argv[1],"w",encoding="utf-8") as f: json.dump({"failure":type(exc).__name__,"line":frames[-1].lineno if frames else 0,"message_sha256":hashlib.sha256(str(exc).encode()).hexdigest()},f)
    sys.exit(1)
''',encoding="utf-8")
        out=Path(td)/"summary.json"
        args=[os.environ[key] for key in ("ENTERPRISES","PERIODS","SEED","DIRECT_MODE","FEE","TOOL_COST")]
        result=run([sys.executable,str(child),str(out),*args],timeout=3000)
        emit("AGGREGATE_RESULT",out.read_text(encoding="utf-8") if out.exists() else "NO_RESULT")
        return int(result.returncode!=0)


if __name__=="__main__":
    try:
        sys.exit(main())
    except subprocess.TimeoutExpired:
        emit("QUALIFICATION","TIMEOUT")
        sys.exit(1)
