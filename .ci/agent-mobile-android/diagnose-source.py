"""Bounded exact-source diagnosis; no Android rebuild or raw private logs."""
import base64
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

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
        mobile=source/"mobile"
        p=run(["npm","ci","--no-audit","--no-fund"],mobile,timeout=240)
        status("NPM_CI","PASS" if p.returncode==0 else "FAIL")
        if p.returncode:return 1
        qualification=(mobile/"scripts/qualify-release.mjs").read_text(encoding="utf-8")
        allowed=set(re.findall(r"'(qualification/[a-z0-9.-]+\.test\.mjs)'",qualification))
        allowed.update(("scripts/qualify-release.mjs","qualification/prototype-smoke.cjs","qualification/python-core-product/test_memory_port.py",
                        "product/main.mjs","product/original-memory.mjs","product/knowledge-screen.mjs","product/memory-screen.mjs","product/memory-actions.mjs"))
        def safe_location(line):
            # Only fixed file identifiers admitted from this exact pinned suite, never absolute paths or arbitrary text.
            for name in sorted(allowed):
                m=re.search(re.escape(name)+r":(\d{1,5})(?::(\d{1,4}))?",line)
                if m:
                    return name+":"+m[1]+":"+(m[2] or "0")
            return None
        p=run(["node","--experimental-strip-types","--test","qualification/remote-draft-navigation.test.mjs","qualification/original-memory.test.mjs","qualification/memory-actions.test.mjs"],mobile,timeout=180)
        raw=p.stdout.decode("utf-8","replace")
        for line in raw.splitlines():
            m=re.fullmatch(r"# (tests|pass|fail|cancelled|skipped|todo) (\d{1,6})\s*",line)
            if m:status("NODE_"+m[1].upper(),m[2])
            m=re.match(r"^\s*not ok (\d{1,6})(?:\s|$)",line)
            if m:status("FAILED_TEST_INDEX",m[1])
            m=re.fullmatch(r"\s*failureType: '(testCodeFailure|testFailure|subtestsFailed|hookFailed|uncaughtException|unhandledRejection|cancelledByParent|testTimeoutFailure|parentAlreadyFinished)'\s*",line)
            if m:status("FAILURE_TYPE",m[1])
            m=re.fullmatch(r"\s*(?:name|code): '?([A-Za-z0-9_]{1,80})'?\s*",line)
            if m and m[1] in {"AssertionError","TypeError","SyntaxError","ReferenceError","Error","ERR_ASSERTION","ERR_MODULE_NOT_FOUND","ERR_TEST_FAILURE","ERR_INVALID_ARG_TYPE","MODULE_NOT_FOUND"}:
                status("ERROR_CLASS",m[1])
            if ("location:" in line or "at " in line or line.startswith("file:")):
                loc=safe_location(line)
                if loc and ("location:" in line or "qualification/" in loc):
                    # Stack entries are useful only near a failing TAP block.
                    if "location:" in line or "at TestContext" in line:status("FAIL_LOCATION",loc)
            if "RELEASE_STAGE_FAILED:" in line:
                for name in ("qualification/prototype-smoke.cjs","--experimental-strip-types","qualification/python-core-product/test_memory_port.py"):
                    if name in line:status("RELEASE_FAILURE_STAGE",name)
        for kind,pattern in (("PYTHON_IMPORT",r"ModuleNotFoundError|ImportError"),("PYTHON_ASSERTION",r"AssertionError:"),
                             ("NODE_SYNTAX",r"SyntaxError:"),("NODE_RESOLUTION",r"ERR_MODULE_NOT_FOUND|Cannot find module"),
                             ("NODE_ASSERTION",r"ERR_ASSERTION")):
            if re.search(pattern,raw):status("OBSERVED_ERROR",kind)
        # Check the modified Python port suite separately if the Node process aborted.
        t=run([sys.executable,"qualification/python-core-product/test_memory_port.py"],mobile)
        status("PORT_TEST", "PASS" if t.returncode==0 else "FAIL")
        m=re.search(rb"(?m)^Ran (\d+) tests? in ",t.stdout)
        if m:status("PORT_TEST_COUNT",m[1].decode())
        if t.returncode:
            for kind in ("ModuleNotFoundError","ImportError","AssertionError","SyntaxError"):
                if kind.encode() in t.stdout:status("PORT_FAILURE_CLASS",kind)
        ok=p.returncode==0 and t.returncode==0 and re.findall(r"(?m)^# tests (\d+)\s*$",raw)==["164"] and re.findall(r"(?m)^# pass (\d+)\s*$",raw)==["164"]
        status("TARGETED_SOURCE","PASS" if ok else "FAIL")
        return 0 if ok else 1
if __name__=="__main__":
    try:code=main()
    except (OSError,ValueError,KeyError,subprocess.TimeoutExpired):
        status("DIAGNOSTIC","UNCLASSIFIED_FAILURE");code=1
    status("RUNNER_CLEANUP","CHECKOUT_SCOPE_EXITED")
    sys.exit(code)
