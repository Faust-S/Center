"""Deliver the exact qualified Agent 0.6.6 installer using the existing owner envelope."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import urllib.request

from admit import CANDIDATE_PIN as PIN, CANDIDATE_TREE as TREE, BASELINE_PIN, BASELINE_TREE, GROUPS, SHA, require, git, read_json

WORKFLOW = 'agent066-delivery'
PREFIX = 'refs/heads/ci/once/' + WORKFLOW + '/'
REQUEST = '.github/ci-requests/' + WORKFLOW + '.json'
KEY_PATH = '.ci/agent066-browser-source/delivery-recipient.pem'
QUALIFICATION_RUN = 46004029924
QUALIFICATION_HEAD = 'ee488216cf48eaba30ee0223e5cf7f23afbd258c'
QUALIFICATION_BRANCH = 'ci/once/agent066-browser-source/3b3eb2354d2a1ae41fb6838bdc172e2f280bab2d'
REPOSITORY = 'Faust-S/Center'
RECIPIENT = 'b9f6f34b406311981ccf68184c1eb7ca958d2893357879f201739195f0e22b60'
EXPECTED = {'candidate': PIN, 'tree': TREE, 'qualification_run': QUALIFICATION_RUN,
            'qualification_head': QUALIFICATION_HEAD, 'recipient_sha256': RECIPIENT,
            'scope': 'ENCRYPTED_OWNER_QUALIFIED_CANDIDATE', 'format': 'IWXAENC1',
            'release_status': 'QUALIFIED_CANDIDATE_NOT_OWNER_ACCEPTED'}
NAME = 'IWXA-Personal-Agent-0.6.6-' + PIN[:8] + '.iwxae'
CIPHER_DIR = 'iwxa-agent066-delivery-cipher'


def qualification_passed(run, jobs):
    if not isinstance(run, dict) or not isinstance(jobs, dict):
        return False
    if (run.get('id') != QUALIFICATION_RUN or run.get('head_sha') != QUALIFICATION_HEAD
            or run.get('head_branch') != QUALIFICATION_BRANCH
            or run.get('path') != '.github/workflows/agent066-browser-source.yml'
            or run.get('event') != 'push' or run.get('status') != 'completed'
            or run.get('conclusion') != 'success'
            or not isinstance(run.get('repository'), dict)
            or run['repository'].get('full_name') != REPOSITORY):
        return False
    rows = jobs.get('jobs')
    expected = {'qualify / ' + group for group in GROUPS}
    return (isinstance(rows, list) and jobs.get('total_count') == len(expected) == len(rows)
            and all(isinstance(row, dict) and isinstance(row.get('name'), str)
                    and row.get('run_id') == QUALIFICATION_RUN
                    and row.get('head_sha') == QUALIFICATION_HEAD
                    and row.get('status') == 'completed' and row.get('conclusion') == 'success'
                    for row in rows)
            and {row['name'] for row in rows} == expected)


def verify_qualification(token):
    base = 'https://api.github.com/repos/' + REPOSITORY + '/actions/runs/' + str(QUALIFICATION_RUN)
    def get(suffix):
        headers = {'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'}
        if token:
            headers['Authorization'] = 'Bearer ' + token
        req = urllib.request.Request(base + suffix, headers=headers)
        with urllib.request.urlopen(req, timeout=30) as response:
            return json.loads(response.read(2_000_001))
    return qualification_passed(get(''), get('/jobs?filter=latest&per_page=100'))


def public_key():
    key = Path(KEY_PATH)
    require(key.is_file() and not key.is_symlink() and key.stat().st_size <= 8192)
    pem = key.read_text(encoding='ascii').encode('ascii')
    require(hashlib.sha256(pem).hexdigest() == RECIPIENT)
    return pem


def admit_delivery(env, event):
    require(env.get('GITHUB_REPOSITORY') == REPOSITORY and env.get('GITHUB_EVENT_NAME') == 'push')
    require(all(event.get(k) is False for k in ('created', 'deleted', 'forced')))
    ref = env.get('GITHUB_REF', '')
    require(ref.startswith(PREFIX))
    parent, head = ref[len(PREFIX):], git('rev-parse', 'HEAD')
    require(SHA.fullmatch(parent) and SHA.fullmatch(head) and head == env.get('GITHUB_SHA'))
    require(event.get('ref') == ref and event.get('before') == parent and event.get('after') == head)
    require(git('rev-list', '--parents', '-n', '1', head).split() == [head, parent])
    require(git('diff-tree', '--no-commit-id', '--name-status', '-r', parent, head) == 'A\t' + REQUEST)
    require(git('ls-tree', head, '--', REQUEST).split(' ', 1)[0] == '100644')
    require(read_json(REQUEST) == {**EXPECTED, 'workflow': WORKFLOW, 'prepared_sha': parent})
    require((env.get('PRIVATE_PIN'), env.get('PRIVATE_TREE'), env.get('QUALIFICATION_GROUP')) == (PIN, TREE, 'desktop'))
    public_key()
    require(verify_qualification(env.get('GITHUB_TOKEN', '')))
    return head


def status(key, value):
    print(key + '=' + str(value), flush=True)


def build_delivery():
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'agent065-modeling'))
    from qualify import Qualification, cleanup_private
    from installed_gate import installed_gate, build_identity, NAME as SETUP_NAME
    from delivery_crypto import encrypt_file
    token = os.environ.pop('IWXA_TEMP_READ_TOKEN', '')
    root = cipher = None
    complete = cipher_created = False
    try:
        require((os.environ.get('PRIVATE_PIN'), os.environ.get('PRIVATE_TREE')) == (PIN, TREE))
        pem = public_key()
        runner = Path(os.environ['RUNNER_TEMP']).resolve(strict=True)
        cipher = runner / CIPHER_DIR
        require(not cipher.exists() and not cipher.is_symlink())
        root = Path(tempfile.mkdtemp(prefix='iwxa-agent065-agent066-delivery-', dir=runner))
        q = Qualification(root)
        require(q.checkout(token, PIN, TREE))
        token = ''
        require(installed_gate(q, PIN, TREE, None, BASELINE_PIN, BASELINE_TREE, upgrade=False))
        out = root / 'setup-output'
        setup = out / SETUP_NAME
        require(setup.is_file() and not setup.is_symlink() and build_identity(out, PIN, TREE, '0.6.6'))
        cipher.mkdir(); cipher_created = True
        plain_sha, sealed_sha = encrypt_file(setup, cipher / NAME, pem)
        require(tuple(p.name for p in cipher.iterdir()) == (NAME,))
        status('DELIVERY_INSTALLED_GUI', 'PASS')
        status('DELIVERY_RELEASE_STATUS', EXPECTED['release_status'])
        status('DELIVERY_SETUP_SHA256', plain_sha)
        status('DELIVERY_ENCRYPTED_SHA256', sealed_sha)
        complete = True
    except Exception:
        status('DELIVERY_INTERNAL', 'FAIL')
    finally:
        token = ''
        if root is not None:
            clean = cleanup_private(root)
            status('DELIVERY_PRIVATE_CLEANUP', 'PASS' if clean else 'FAIL')
            complete = complete and clean
        if not complete and cipher_created:
            shutil.rmtree(cipher, ignore_errors=True)
    status('DELIVERY_ENCRYPTED_PACKAGE', 'PASS' if complete else 'FAIL')
    return 0 if complete else 1


def main():
    if sys.argv[1:] == ['--build']:
        return build_delivery()
    if sys.argv[1:] != ['--admit']:
        return 1
    try:
        path = Path(os.environ['GITHUB_EVENT_PATH'])
        require(path.is_file() and path.stat().st_size <= 2_000_000)
        head = admit_delivery(os.environ, json.loads(path.read_text(encoding='utf-8')))
    except Exception:
        status('DELIVERY_ADMISSION', 'FAIL')
        return 1
    status('DELIVERY_ADMISSION', 'PASS')
    status('DELIVERY_QUALIFICATION', 'PASS')
    status('DELIVERY_REQUEST_HEAD', head)
    return 0


if __name__ == '__main__':
    sys.exit(main())
