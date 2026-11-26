#!/usr/bin/env python3
"""Read-only qualification of the pinned original Kernel on a disposable Center runner.
No source, private diagnostics, credentials, runtime bundles or artifacts leave the runner.
"""
import base64, hashlib, json, os, pathlib, re, shutil, subprocess, sys, tempfile, urllib.error, urllib.request

PIN = "ba821f351f95b2c986e9d748a156daf7bddc2acc"
TREE = "52d51591b10cbbc9fd88e4d7ee12a8571dd49dcf"
BRANCH = "ci/once/t4-db9/ba821f351f95b2c986e9d748a156daf7bddc2acc"
REPO = "Faust-S/T2"
ROOT = "t2/current/final-successor"
TOKEN_NAMES = ("T2_SCOPED", "SOURCE_SCOPED", "DOMAIN_SCOPED")
class GateError(Exception):
    pass

def need(condition, code):
    if not condition:
        raise GateError(code)

def emit(label, value):
    print(label + "=" + str(value), flush=True)

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def clean_env():
    # No repository credentials are inherited by private build/test processes.
    env = dict(os.environ)
    for k in list(env):
        if k in TOKEN_NAMES or k.startswith(("GIT_CONFIG_", "GIT_ASKPASS", "SSH_ASKPASS", "ACTIONS_RUNTIME_", "ACTIONS_ID_TOKEN_")) or k in (
            "GH_TOKEN", "GITHUB_TOKEN", "NODE_AUTH_TOKEN", "NPM_TOKEN"):
            env.pop(k, None)
    env.update(CI="true", GIT_TERMINAL_PROMPT="0")
    return env

ENV = clean_env()
def run(label, args, cwd, timeout=300, env=None, required=True):
    # Always suppress stdout/stderr of exact private source commands, even on error.
    try:
        p = subprocess.run(args, cwd=cwd, env=ENV if env is None else env,
                           stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                           timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        emit(label, "TIMEOUT")
        if required: raise GateError(label+"_TIMEOUT")
        return None
    except OSError:
        emit(label, "UNAVAILABLE")
        if required: raise GateError(label+"_UNAVAILABLE")
        return None
    if p.returncode:
        emit(label, "FAIL")
        # Whitelisted machine codes, not source paths, snippets, exception messages or logs.
        codes = sorted(set(re.findall(rb"\b(?:TS[0-9]{4,5}|K036_EVENT_COMMIT_ORDER_[A-Z0-9_]{3,75}|DB9_WITNESS_[A-Z0-9_]{3,60})\b", p.stdout)))
        if codes: emit(label+"_CODES", ",".join(c.decode("ascii") for c in codes[:15]))
        if required: raise GateError(label+"_FAILED")
        return None
    emit(label, "PASS")
    return p.stdout

def choose_read_token():
    # Test each existing owner-provisioned scoped credential against only
    # this immutable T2 pin; a configured but stale token must not mask a valid one.
    api = "https://api.github.com/repos/" + REPO + "/commits/" + PIN
    for name in TOKEN_NAMES:
        value = os.environ.get(name, "")
        if not value:
            emit("DB9_READ_"+name, "NOT_CONFIGURED"); continue
        req = urllib.request.Request(api, headers={"Authorization":"Bearer "+value,
            "Accept":"application/vnd.github+json", "User-Agent":"IWXA-Center-DB9"})
        try:
            with urllib.request.urlopen(req, timeout=20) as response:
                info = json.load(response)
                if info.get("sha") == PIN and info.get("commit", {}).get("tree", {}).get("sha") == TREE:
                    emit("DB9_READ_"+name, "PASS"); return value
                emit("DB9_READ_"+name,"PIN_MISMATCH")
        except urllib.error.HTTPError as e:
            emit("DB9_READ_"+name, "HTTP_"+str(e.code))
        except Exception:
            emit("DB9_READ_"+name,"UNAVAILABLE")
    raise GateError("DB9_EXACT_SOURCE_READ_BLOCKED")

def main():
    need(os.environ.get("GITHUB_ACTIONS")=="true" and os.environ.get("GITHUB_REPOSITORY")=="Faust-S/Center"
         and os.environ.get("GITHUB_REF")=="refs/heads/"+BRANCH
         and os.environ.get("RUNNER_ENVIRONMENT")=="github-hosted" and bool(os.environ.get("RUNNER_TEMP")),
         "DB9_CENTER_EPHEMERAL_RUNNER_REQUIRED")
    token=choose_read_token()
    with tempfile.TemporaryDirectory(prefix="iwxa-t4-db9-", dir=os.environ["RUNNER_TEMP"]) as tmp:
        top=pathlib.Path(tmp); top.chmod(0o700)
        checkout=top/"t2"; checkout.mkdir(mode=0o700)
        run("DB9_INIT",["git","init","-q"],checkout)
        auth=dict(ENV)
        auth.update(GIT_CONFIG_COUNT="1",GIT_CONFIG_KEY_0="http.https://github.com/.extraheader",
                    GIT_CONFIG_VALUE_0="Authorization: Basic "+base64.b64encode(("x-access-token:"+token).encode()).decode())
        run("DB9_EXACT_FETCH",["git","fetch","--quiet","--no-tags","--depth=1","https://github.com/"+REPO+".git",PIN],
            checkout,timeout=300,env=auth)
        auth.clear(); token=None
        for name in TOKEN_NAMES: os.environ.pop(name,None)
        run("DB9_EXACT_CHECKOUT",["git","checkout","--quiet","--detach","FETCH_HEAD"],checkout)
        for arg,expected in [("HEAD",PIN),("HEAD^{tree}",TREE)]:
            actual=run("DB9_PIN_CHECK",["git","rev-parse",arg],checkout)
            need(actual.decode().strip()==expected,"DB9_CHECKOUT_PIN_MISMATCH")
        need(not run("DB9_CLEAN_CHECK",["git","status","--porcelain"],checkout).strip(),"DB9_DIRTY_CHECKOUT")
        emit("DB9_EXACT_SOURCE_PIN",PIN)
        root=checkout/ROOT; canonical=root/"canonical-source"; scripts=canonical/"scripts"
        predecessor=top/"k035"; atomic=top/"k036"; timestamp=top/"timestamp"; old=top/"db8"; db9=top/"db9"
        run("DB9_RECONSTRUCT_K035",["node",str(scripts/"materialize-k035-atomic-graph-successor.mjs"),
            str(root/"canonical-source-inputs/k035-rc20/SOURCE_AUTHORITY.json"),str(checkout),str(predecessor)],canonical)
        run("DB9_RECONSTRUCT_K036",["node",str(scripts/"materialize-k036-atomic-graph-qualified.mjs"),str(predecessor),str(atomic)],canonical)
        run("DB9_RECONSTRUCT_TIMESTAMP",["node",str(scripts/"create-k036-import-time-candidate.mjs"),str(atomic),str(timestamp)],canonical)
        run("DB9_RECONSTRUCT_LEGACY",["node",str(scripts/"create-k036-canonical-event-merge-candidate.mjs"),str(timestamp),str(old)],canonical)
        run("DB9_MATERIALIZE",["node",str(scripts/"create-k036-event-commit-order-candidate.mjs"),str(timestamp),str(db9)],canonical)
        receipt=json.loads((db9/"EVENT_COMMIT_ORDER_CANDIDATE.json").read_text())
        need(receipt.get("schema")=="IWXA_K036_EVENT_COMMIT_ORDER_CANDIDATE_V1" and
             receipt.get("localStoreVersion")==9 and receipt.get("kernelInternalVersion")=="0.3.6" and
             receipt.get("existingPublicContract")=="1.3.0" and receipt.get("productionActivation") is False,
             "DB9_MATERIALIZED_RECEIPT_INVALID")
        def safe_file(base, relative):
            p=(base/relative).resolve()
            need(p.is_relative_to(base.resolve()) and p.is_file(),"DB9_RECEIPT_PATH_INVALID")
            return p
        for row in receipt["changedFiles"]:
            need(digest(safe_file(old,row["path"]))==row["beforeSha256"] and
                 digest(safe_file(db9,row["path"]))==row["afterSha256"],"DB9_CHANGED_FILE_HASH_MISMATCH")
        for row in receipt["addedFiles"]:
            need(digest(safe_file(db9,row["path"]))==row["sha256"],"DB9_ADDED_FILE_HASH_MISMATCH")
        emit("DB9_EXACT_PATCH_IDENTITY","PASS")
        emit("DB9_CHANGED_FILES",len(receipt["changedFiles"])); emit("DB9_ADDED_FILES",len(receipt["addedFiles"]))
        # Hash the whole materialized source tree before adding dependencies.
        entries=[]
        for p in sorted(db9.rglob("*")):
            if p.is_symlink(): raise GateError("DB9_SOURCE_SYMLINK")
            if p.is_file(): entries.append(p.relative_to(db9).as_posix()+"\0"+digest(p)+"\n")
        emit("DB9_MATERIALIZED_TREE_SHA256",hashlib.sha256("".join(entries).encode()).hexdigest())
        node=run("DB9_NODE",["node","--version"],db9).decode().strip()
        npm=run("DB9_NPM",["npm","--version"],db9).decode().strip()
        emit("DB9_NODE_VERSION",node); emit("DB9_NPM_VERSION",npm)
        need(node=="v24.18.1" and npm=="11.16.0","DB9_TOOLCHAIN_MISMATCH")
        run("DB9_LOCKED_INSTALL",["npm","ci","--no-audit","--no-fund"],db9,timeout=480)
        # Independent stage outcomes: a typecheck failure does not hide
        # a native storage regression, but it prevents qualification.
        typecheck=run("DB9_TYPECHECK",["npm","run","typecheck"],db9,timeout=300,required=False)
        built=run("DB9_BUILD",["npm","run","build"],db9,timeout=300,required=False)
        report=top/"focused.json"
        tests=["tests/event-commit-order.test.ts","tests/object-catalog-window.test.ts",
               "tests/same-store-event-history.test.ts","tests/same-workspace-event-merge.test.ts",
               "tests/local-store-migration-4.test.ts"]
        need(all((db9/p).is_file() for p in tests),"DB9_FOCUSED_TEST_INPUT_MISSING")
        focused=run("DB9_FOCUSED_TESTS",["node","node_modules/vitest/vitest.mjs","run",*tests,
            "--reporter=json","--outputFile="+str(report)],db9,timeout=360,required=False)
        if report.is_file():
            obj=json.loads(report.read_text())
            for k in ("numTotalTests","numPassedTests","numFailedTests","numPendingTests","numTodoTests"):
                v=obj.get(k)
                if isinstance(v,int): emit("DB9_"+k,v)
            if obj.get("numTotalTests",0)==0 or obj.get("numFailedTests",1)!=0 or obj.get("numPendingTests",0)!=0 or obj.get("numTodoTests",0)!=0:
                focused=None
        else: focused=None
        witness=pathlib.Path(__file__).resolve().with_name("native-idb-witness.mjs")
        native=run("DB9_NATIVE_INDEXEDDB",["node",str(witness),str(old),str(db9),str(top/"browser")],
                   top,timeout=240,required=False)
        if native is not None:
            try:
                result=json.loads(native.decode().strip())
                expected={"db7To9","db8To9","commitOrder","transactionAbort","catalog","coldBrowserReopen"}
                need(result.get("nativeIndexedDB") is True and set(result.get("passed",[]))==expected and
                     len(result["passed"])==len(expected),"DB9_NATIVE_WITNESS_INCOMPLETE")
                for name in sorted(expected): emit("DB9_NATIVE_"+name,"PASS")
            except (ValueError,GateError,KeyError,TypeError):
                native=None; emit("DB9_NATIVE_WITNESS","INVALID")
        need(all(x is not None for x in (typecheck,built,focused,native)),"DB9_QUALIFICATION_INCOMPLETE")
        emit("DB9_FOCUSED_QUALIFICATION","PASS")
        emit("DB9_RELEASE_ACCEPTED","false")
    emit("DB9_PRIVATE_TEMP_CLEANUP","PASS")

if __name__ == "__main__":
    try: main()
    except GateError as e:
        emit("DB9_RESULT", str(e)); sys.exit(1)
    except Exception:
        emit("DB9_RESULT","UNCLASSIFIED_FAILURE"); sys.exit(1)
