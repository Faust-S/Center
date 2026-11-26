"""Check the committed dependency graph and actual disposable Setup inputs.

No registry resolution, private artifact publication or installed GUI claim.
"""
import hashlib
import json
from pathlib import Path

LOCK_PATH = 'desktop/modeling-native/package-lock.json'
LOCK_SHA256 = '7fb7f2d53c1ca85380babb5f05dd87b01cea809b096ed4f3d8b8535455ba089c'
LOCK_BLOB = 'cfdfa5354dfb130047e1132bb58b1a852c5b572b'
LOCK_BYTES = 201572
STAGE_INPUT_COUNT = 12


def exact_lock(path):
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size != LOCK_BYTES:
            return False
        raw = path.read_bytes()
        blob = hashlib.sha1(('blob '+str(len(raw))+'\0').encode('ascii')+raw).hexdigest()
        return hashlib.sha256(raw).hexdigest() == LOCK_SHA256 and blob == LOCK_BLOB
    except OSError:
        return False


def verdict(q, label, ok):
    q.results[label] = bool(ok)
    print(label+'='+('PASS' if ok else 'FAIL'), flush=True)
    return bool(ok)


def committed_lock(q, label):
    return verdict(q, label, LOCK_PATH in q.files and exact_lock(q.src/LOCK_PATH))


def stage_receipt(code, output):
    if code != 0:
        return False
    try:
        return json.loads(output) == {'status':'READY','files':STAGE_INPUT_COUNT,'lock_sha256':LOCK_SHA256}
    except (ValueError, TypeError):
        return False


def release_preflight(q):
    target=q.root/'setup-inputs'
    target.mkdir()
    native=q.src/'desktop/modeling-native'
    helper=native/'stage-release.mjs'
    for mode,label in (('stage','SETUP_NATIVE_INPUT_STAGE'),('verify','SETUP_NATIVE_INPUT_VERIFY')):
        code,output=q.run(label,['node',helper,mode,native,target],report=False,timeout=120)
        if not verdict(q,label,stage_receipt(code,output) and exact_lock(target/'modeling-native/package-lock.json')):
            return False
    script=("$tokens=$null;$errors=$null;[void][System.Management.Automation.Language.Parser]::ParseFile("
            "(Join-Path (Get-Location) 'qualification/phase1/build_native_windows_setup_candidate.ps1'),"
            "[ref]$tokens,[ref]$errors);if($errors.Count -ne 0){exit 1};exit 0")
    return q.run('SETUP_NATIVE_PS_PARSE',['powershell.exe','-NoProfile','-NonInteractive','-Command',script],timeout=120)[0]==0


def desktop_retry(q):
    if not committed_lock(q,'COMMITTED_NATIVE_LOCK_BEFORE'):
        return False
    if not release_preflight(q):
        return False
    result=q.desktop()
    unchanged=committed_lock(q,'COMMITTED_NATIVE_LOCK_AFTER')
    return result and unchanged and all(q.results.values())
