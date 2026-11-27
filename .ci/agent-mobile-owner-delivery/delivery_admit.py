"""Admit a single exact encrypted-candidate delivery before reading private data."""
from pathlib import Path
import hashlib
import json
import os
import re
import subprocess
import sys

WORKFLOW='agent-mobile-owner-delivery'
PREFIX='refs/heads/ci/once/'+WORKFLOW+'/'
REQUEST='.github/ci-requests/'+WORKFLOW+'.json'
PREPARED='.ci/agent-mobile-owner-delivery/delivery-request.json'
KEY_PATH='.ci/agent-mobile-owner-delivery/delivery-recipient.pem'
EXPECTED={
  "candidate": "68042c7974503c234dc5bd938925520d1a82780c",
  "tree": "ce7e14670d0b9c2f79ca0215baef0fbf7a3600f3",
  "original_t3": "1e5d54bba065f0e82cc506a5443b96079d070608",
  "original_t3_tree": "80f724d21d2acca0394e3694ae4a9a7fd65317bc",
  "recipient_sha256": "b9f6f34b406311981ccf68184c1eb7ca958d2893357879f201739195f0e22b60",
  "scope": "ENCRYPTED_ARM64_OWNER_TEST_CANDIDATE",
  "format": "IWXAENC1",
  "release_status": "CANDIDATE_NOT_ACCEPTED"
}
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
    require(env.get('T3_PIN')==EXPECTED['original_t3'] and env.get('T3_TREE')==EXPECTED['original_t3_tree'])
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
