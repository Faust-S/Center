"""Preserve the exact successfully installed Setup, never a second build."""
import hashlib
import os
from pathlib import Path
import shutil
import sys

from admit import CANDIDATE_PIN as PIN, CANDIDATE_TREE as TREE
from delivery_crypto import MAGIC, HEADER, MAX_SIZE, digest_stream, encrypt_file

RECIPIENT = 'b9f6f34b406311981ccf68184c1eb7ca958d2893357879f201739195f0e22b60'
KEY_PATH = Path(__file__).with_name('delivery-recipient.pem')
NAME = 'IWXA-Personal-Agent-0.6.6-' + PIN[:8] + '.iwxae'
CIPHER_DIR = 'iwxa-agent066-delivery-cipher'
SETUP_NAME = 'IWXA-Private-SetupCore-Candidate.exe'
REQUIRED = ('SETUP_RELEASE', 'SETUP_BUILT', 'MODELING_RECEIPT_PREFLIGHT',
            'COMMITTED_NATIVE_LOCK_BEFORE', 'COMMITTED_NATIVE_LOCK_AFTER')


def ready_to_seal(q, pin, tree, verify_build):
    out = q.root / 'setup-output'
    setup = out / SETUP_NAME
    return ((pin, tree) == (PIN, TREE) and all(q.results.get(k) is True for k in REQUIRED)
            and all(q.results.values()) and setup.is_file() and not setup.is_symlink()
            and verify_build(out, pin, tree, '0.6.6'))


def verify_envelope(folder):
    folder = Path(folder)
    envelope, receipt = folder / NAME, folder / (NAME + '.sha256')
    if (not folder.is_dir() or folder.is_symlink()
            or {p.name for p in folder.iterdir()} != {envelope.name, receipt.name}
            or any(not p.is_file() or p.is_symlink() for p in (envelope, receipt))
            or receipt.stat().st_size != 65):
        raise ValueError('delivery_files_invalid')
    expected = receipt.read_text(encoding='ascii').strip()
    with envelope.open('rb') as f:
        magic, pin, tree, size, _plain_sha, _nonce, _wrapped = HEADER.unpack(f.read(HEADER.size))
        if (magic != MAGIC or pin != PIN.encode('ascii') or tree != TREE.encode('ascii')
                or not 1 <= size <= MAX_SIZE or os.fstat(f.fileno()).st_size != HEADER.size + size + 16):
            raise ValueError('delivery_header_invalid')
        f.seek(0)
        actual = digest_stream(f)
    if actual != expected:
        raise ValueError('delivery_digest_invalid')
    return actual


def seal_clean_install(q, pin, tree):
    from installed_gate import build_identity
    cipher = None
    created = complete = False
    try:
        if not ready_to_seal(q, pin, tree, build_identity):
            raise ValueError('delivery_setup_not_confirmed')
        if not KEY_PATH.is_file() or KEY_PATH.is_symlink() or KEY_PATH.stat().st_size > 8192:
            raise ValueError('delivery_recipient_invalid')
        pem = KEY_PATH.read_text(encoding='ascii').encode('ascii')
        if hashlib.sha256(pem).hexdigest() != RECIPIENT:
            raise ValueError('delivery_recipient_invalid')
        runner = Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
        cipher = runner / CIPHER_DIR
        cipher.mkdir(); created = True
        plain, sealed = encrypt_file(q.root / 'setup-output' / SETUP_NAME, cipher / NAME, pem)
        (cipher / (NAME + '.sha256')).write_bytes((sealed + '\n').encode('ascii'))
        if verify_envelope(cipher) != sealed:
            raise ValueError('delivery_digest_invalid')
        print('DELIVERY_SETUP_SHA256=' + plain, flush=True)
        print('DELIVERY_ENCRYPTED_SHA256=' + sealed, flush=True)
        complete = True
    except Exception:
        # Public output contains only fixed verdicts, never private paths or errors.
        pass
    finally:
        if created and not complete:
            shutil.rmtree(cipher, ignore_errors=True)
    print('DELIVERY_ENCRYPTED_CANDIDATE=' + ('PASS' if complete else 'FAIL'), flush=True)
    return complete


if __name__ == '__main__':
    try:
        if len(sys.argv) != 2:
            raise ValueError('delivery_input_invalid')
        digest = verify_envelope(sys.argv[1])
    except Exception:
        print('DELIVERY_ENCRYPTED_PACKAGE=FAIL', flush=True)
        sys.exit(1)
    print('DELIVERY_ENCRYPTED_SHA256=' + digest, flush=True)
    print('DELIVERY_ENCRYPTED_PACKAGE=PASS', flush=True)
    print('DELIVERY_RELEASE_STATUS=QUALIFIED_CANDIDATE_NOT_OWNER_ACCEPTED', flush=True)
