"""Build the exact original installer, then publish ONLY its encrypted envelope."""
import hashlib
import os
from pathlib import Path
import shutil
import sys
import tempfile
from delivery_admit import EXPECTED, KEY_PATH
from delivery_crypto import PIN,TREE,encrypt_file

NAME='IWXA-Personal-Agent-0.6.5-candidate-68128b4c.iwxae'
CIPHER_DIR='iwxa-agent065-delivery-cipher'

def status(key,value): print(key+'='+str(value),flush=True)

def publishable(q,out,verify_build,verify_preflight,exact_lock):
    # Do not turn an installation failure into a release PASS. A requested
    # candidate may be delivered only from the original verified build.
    source=out/'IWXA-Private-SetupCore-Candidate.exe'
    return (not source.is_symlink() and source.is_file()
            and q.results.get('SETUP_BUILT') is True
            and q.results.get('MODELING_RECEIPT_PREFLIGHT') is True
            and q.results.get('COMMITTED_NATIVE_LOCK_BEFORE') is True
            and q.results.get('COMMITTED_NATIVE_LOCK_AFTER') is True
            and exact_lock(q.src/'desktop/modeling-native/package-lock.json')
            and verify_build(out,PIN,TREE) and verify_preflight(out))

def main():
    from qualify import Qualification,cleanup_private
    from release_gate import setup_gate,verify_setup_build,verify_receipt_preflight
    from release_preflight import exact_lock
    token=os.environ.pop('IWXA_TEMP_READ_TOKEN','')
    root=None; cipher=None; complete=False; cipher_created=False
    try:
        if ((os.environ.get('PRIVATE_PIN'),os.environ.get('PRIVATE_TREE'))!=(PIN,TREE)
                or (PIN,TREE)!=(EXPECTED['candidate'],EXPECTED['tree'])):
            raise ValueError('PIN_MISMATCH')
        public=Path(KEY_PATH).read_text(encoding='ascii').encode('ascii')
        if hashlib.sha256(public).hexdigest()!=EXPECTED['recipient_sha256']:
            raise ValueError('RECIPIENT_MISMATCH')
        runner=Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
        cipher=runner/CIPHER_DIR
        if cipher.exists() or cipher.is_symlink(): raise ValueError('CIPHER_DIRECTORY_NOT_EMPTY')
        root=Path(tempfile.mkdtemp(prefix='iwxa-agent065-',dir=runner))
        q=Qualification(root)
        if not q.checkout(token,PIN,TREE): raise ValueError('PRIVATE_READ_DENIED')
        token=''
        # Original build + installed witness; no modified or synthetic build.
        accepted=setup_gate(q,PIN,TREE)
        out=root/'setup-output'
        if not publishable(q,out,verify_setup_build,verify_receipt_preflight,exact_lock):
            raise ValueError('SETUP_BUILD_NOT_CONFIRMED')
        cipher.mkdir();cipher_created=True
        plain_sha,encrypted_sha=encrypt_file(out/'IWXA-Private-SetupCore-Candidate.exe',cipher/NAME,public)
        if tuple(p.name for p in cipher.iterdir())!=(NAME,): raise ValueError('CIPHER_OUTPUT_INVALID')
        status('DELIVERY_INSTALLED_GUI','PASS' if accepted else 'NOT_CONFIRMED')
        status('DELIVERY_RELEASE_STATUS','CANDIDATE_NOT_ACCEPTED')
        status('DELIVERY_SETUP_SHA256',plain_sha)
        status('DELIVERY_ENCRYPTED_SHA256',encrypted_sha)
        complete=True
    except Exception:
        # Do not output exception text, paths, private evidence or credentials.
        status('DELIVERY_INTERNAL','FAIL')
    finally:
        token=''
        if root is not None:
            clean=cleanup_private(root)
            status('DELIVERY_PRIVATE_CLEANUP','PASS' if clean else 'FAIL')
            complete=complete and clean
        if not complete and cipher_created:
            shutil.rmtree(cipher,ignore_errors=True)
    status('DELIVERY_ENCRYPTED_PACKAGE','PASS' if complete else 'FAIL')
    return 0 if complete else 1

if __name__=='__main__': sys.exit(main())
