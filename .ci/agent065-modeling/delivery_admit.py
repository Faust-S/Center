"""Admit a single exact encrypted-candidate delivery before reading private data."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import sys

WORKFLOW='agent065-delivery'
PREFIX='refs/heads/ci/once/'+WORKFLOW+'/'
REQUEST='.github/ci-requests/'+WORKFLOW+'.json'
PREPARED='.ci/agent065-modeling/delivery-request.json'
KEY_PATH='.ci/agent065-modeling/delivery-recipient.pem'
EXPECTED={'candidate':'68128b4c9a2c7140ec3503ff0f775e5bcb50743e',
          'tree':'73c17aa7fcdbe5182f278a2fe49eb3d8c93294e2',
          'recipient_sha256':'b9f6f34b406311981ccf68184c1eb7ca958d2893357879f201739195f0e22b60',
          'scope':'ENCRYPTED_OWNER_CANDIDATE_DELIVERY',
          'format':'IWXAENC1','release_status':'CANDIDATE_NOT_ACCEPTED'}
SHA=re.compile(r'[0-9a-f]{40}\Z')

def require(ok):
    if not ok: raise ValueError('DELIVERY_ADMISSION_DENIED')

def git(*args):
    return subprocess.check_output(['git',*args],stderr=subprocess.DEVNULL).decode('utf-8').strip()

def read_json(path):
    p=Path(path);require(p.is_file() and not p.is_symlink() and p.stat().st_size<=8192)
    def unique(items):
        d={}
        for k,v in items:
            require(k not in d);d[k]=v
        return d
    return json.loads(p.read_text(encoding='utf-8'),object_pairs_hook=unique)

def admit(env,event):
    require(env.get('GITHUB_REPOSITORY')=='Faust-S/Center')
    require(env.get('GITHUB_EVENT_NAME')=='push')
    require(all(event.get(k) is False for k in ('created','deleted','forced')))
    ref=env.get('GITHUB_REF','');require(ref.startswith(PREFIX))
    parent=ref[len(PREFIX):];head=git('rev-parse','HEAD')
    require(SHA.fullmatch(parent) and SHA.fullmatch(head) and head==env.get('GITHUB_SHA'))
    require(event.get('ref')==ref and event.get('before')==parent and event.get('after')==head)
    require(git('rev-list','--parents','-n','1',head).split()==[head,parent])
    require(git('diff-tree','--no-commit-id','--name-status','-r',parent,head)=='A\t'+REQUEST)
    require(git('ls-tree',head,'--',REQUEST).split(' ',1)[0]=='100644')
    require(read_json(PREPARED)==EXPECTED)
    require(read_json(REQUEST)=={**EXPECTED,'workflow':WORKFLOW,'prepared_sha':parent})
    require(env.get('PRIVATE_PIN')==EXPECTED['candidate'] and env.get('PRIVATE_TREE')==EXPECTED['tree'])
    key=Path(KEY_PATH);require(key.is_file() and not key.is_symlink() and key.stat().st_size<=8192)
    require(hashlib.sha256(key.read_text(encoding='ascii').encode('ascii')).hexdigest()==EXPECTED['recipient_sha256'])
    return head

def main():
    try:
        p=Path(os.environ['GITHUB_EVENT_PATH']);require(p.is_file() and p.stat().st_size<=2_000_000)
        head=admit(os.environ,json.loads(p.read_text(encoding='utf-8')))
    except (OSError,ValueError,TypeError,KeyError,subprocess.SubprocessError):
        print('DELIVERY_ADMISSION=FAIL',flush=True);return 1
    print('DELIVERY_ADMISSION=PASS',flush=True)
    print('DELIVERY_REQUEST_HEAD='+head,flush=True);return 0

if __name__=='__main__': sys.exit(main())
