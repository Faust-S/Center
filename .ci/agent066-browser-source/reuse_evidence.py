"""Reuse exact prior qualification and owner ciphertext; no private source is published."""
import json
import os
from pathlib import Path
import subprocess
import sys
from urllib.request import Request, urlopen

from admit import CANDIDATE_PIN, CANDIDATE_TREE, PRIOR_RUN, PRIOR_ATTEMPT, PRIOR_ARTIFACT

PRIOR_HEAD = '13ee3cf183cd02593c4408bb06a2da8b2b06a6ac'
PRIOR_BRANCH = 'ci/once/agent066-browser-source/77bc11dcfb2b481d827f67c99758d055498170fc'
REPO_ID = 1444864852
WORKFLOW_ID = 432495794
ARTIFACT_NAME = 'IWXA-Agent-0.6.6-clean-candidate-fdc0a706-encrypted'
ARTIFACT_SIZE = 70411225
ARTIFACT_DIGEST = 'sha256:7f1f460b7bc6f122bfbe093c4af18e98decbf586841acdf7f26ac064aaa1e8d4'
SETUP_SHA = 'b4cd2a2c992caf41d608a57f80ba566270e9c5db91fb45c6f1f33ce6b8e8cb3a'
SEALED_SHA = 'ead91e8dbffce945949f36c2381470168b6ee6f197fd725562b938163a30781a'
JOBS = {
    'qualify / core': (140940468751, 'success'),
    'qualify / ocr': (140940468817, 'success'),
    'qualify / desktop-source': (140940468744, 'success'),
    'qualify / bundle': (140940468779, 'success'),
    'qualify / desktop': (140940468901, 'success'),
    'qualify / upgrade': (140940468560, 'failure'),
    'delivery / qualified owner package': (140947366587, 'skipped'),
}
WITNESS_PARENT = 'f4a2a85f59702151172404df5525d5b9bafe9eaf'
WITNESS_CHANGES = {
    b'tests/test_setup_core_browser_actions.py': ('3fec1d7a445dd33639423b8928c78775b51619f5','f36c7e8645bfaab4dc96ffbdf191efb1d9641aa8'),
    b'tests/test_setup_core_browser_development.py': ('4ce0d3a2bc0904f7cece260af21c9638e35980bd','59dfd75fd9d21d37adcfc370389a890b75d38bfa'),
    b'tests/test_setup_core_browser_installed.py': ('655bc770eb7844f330133b3c9f88d6672754435c','5947134612b9f8a05927a0c8bec484873ccfaf2a'),
    b'tools/qualify_setup_core_browser_actions.py': ('04f9cc7a88a72b4da86b01a10fb3ec8724f62bdf','30f494658b37505187967f1a94582c17679333cc'),
    b'tools/qualify_setup_core_browser_actions_flow.py': ('d1fdedb39aa3c19c2e947f8a9858c2183459a03e','8e2777797875370b38a455f717f0c7ecdcc69c36'),
    b'tools/qualify_setup_core_browser_development.py': ('7fe2e4d63fed7059ba76c28674fb1321aa29f352','ec419c7269be24a1f2d6d540a9b82a9f0d9e0dbe'),
    b'tools/qualify_setup_core_browser_gui.ps1': ('b07a7031f84c93228761a4af7ae00efd04f1bf2b','f86a47493a59fc7230353464002b66baae812230'),
    b'tools/qualify_setup_core_browser_installed.py': ('2a9e2946d6875c0985b4e9285c27b0f009e16a44','dec7b867ab6e0c6d0542772b18e88ffece394714'),
}

def require(ok):
    if not ok:
        raise ValueError('REUSE_EVIDENCE_INVALID')


def matches(row, expected):
    return isinstance(row, dict) and all(type(row.get(k)) is type(v) and row.get(k) == v for k,v in expected.items())


def step_ok(row, name, conclusion):
    steps = [s for s in row.get('steps', []) if s.get('name') == name]
    return len(steps) == 1 and matches(steps[0], {'status':'completed','conclusion':conclusion})


def verify_prior(run, jobs, artifacts):
    require(matches(run, {'id':PRIOR_RUN,'run_attempt':PRIOR_ATTEMPT,'workflow_id':WORKFLOW_ID,
                          'head_sha':PRIOR_HEAD,'head_branch':PRIOR_BRANCH,'status':'completed','conclusion':'failure',
                          'path':'.github/workflows/agent066-browser-source.yml'}))
    require(matches(run.get('repository'), {'id':REPO_ID}) and matches(run.get('head_repository'), {'id':REPO_ID}))
    require(jobs.get('total_count') == len(JOBS) and len(jobs.get('jobs', [])) == len(JOBS))
    seen = set()
    for row in jobs['jobs']:
        name = row.get('name')
        require(name in JOBS and name not in seen)
        seen.add(name)
        ident, conclusion = JOBS[name]
        require(matches(row, {'id':ident,'status':'completed','conclusion':conclusion,
                              'run_attempt':PRIOR_ATTEMPT,'head_sha':PRIOR_HEAD}))
        if name.startswith('qualify / '):
            require(step_ok(row,'Admit exact one-time request before private access','success'))
            require(step_ok(row,'Grouped verification on temporary private checkout',conclusion))
            require(step_ok(row,'Preserve encrypted clean-installed candidate','success' if name == 'qualify / desktop' else 'skipped'))
    require(seen == set(JOBS))
    require(artifacts.get('total_count') == 1 and len(artifacts.get('artifacts', [])) == 1)
    artifact = artifacts['artifacts'][0]
    require(matches(artifact, {'id':PRIOR_ARTIFACT,'name':ARTIFACT_NAME,'size_in_bytes':ARTIFACT_SIZE,
                               'digest':ARTIFACT_DIGEST,'expired':False}))
    require(matches(artifact.get('workflow_run'), {'id':PRIOR_RUN,'repository_id':REPO_ID,'head_repository_id':REPO_ID,
                                                   'head_branch':PRIOR_BRANCH,'head_sha':PRIOR_HEAD}))


def prior_from_api(token):
    require(isinstance(token,str) and bool(token))
    base = 'https://api.github.com/repos/Faust-S/Center/actions/runs/'+str(PRIOR_RUN)
    def fetch(suffix):
        req = Request(base+suffix,headers={'Accept':'application/vnd.github+json','Authorization':'Bearer '+token,
                                         'X-GitHub-Api-Version':'2022-11-28','User-Agent':'IWXA-release-evidence'})
        with urlopen(req,timeout=30) as res:
            require(res.status == 200 and res.geturl().startswith(base))
            data = res.read(4_000_001)
        require(len(data) <= 4_000_000)
        return json.loads(data)
    verify_prior(fetch(''),fetch('/attempts/'+str(PRIOR_ATTEMPT)+'/jobs?per_page=100'),fetch('/artifacts?per_page=100'))


def tree_entries(raw):
    require(isinstance(raw,bytes) and raw.endswith(b'\0'))
    rows = {}
    for line in raw[:-1].split(b'\0'):
        ident,path = line.split(b'\t',1)
        require(bool(path) and path not in rows)
        rows[path] = ident
    return rows


def verify_witness_trees(before, after, parents):
    require(parents == [WITNESS_PARENT])
    require(len(before) == len(after) == 3356 and set(before) == set(after))
    changed = {p for p in before if before[p] != after[p]}
    require(changed == set(WITNESS_CHANGES))
    for path,(old,new) in WITNESS_CHANGES.items():
        require(before[path] == ('100644 blob '+old).encode('ascii') and after[path] == ('100644 blob '+new).encode('ascii'))


def verify_witness_checkouts(candidate, witness):
    def git(q,*args):
        return subprocess.check_output(['git',*args],cwd=q.src,env=q.env,stderr=subprocess.DEVNULL,timeout=90)
    before = tree_entries(git(candidate,'ls-tree','-r','-z','HEAD'))
    after = tree_entries(git(witness,'ls-tree','-r','-z','HEAD'))
    parents = [line[7:].decode('ascii') for line in git(witness,'cat-file','-p','HEAD').split(b'\n\n',1)[0].splitlines() if line.startswith(b'parent ')]
    verify_witness_trees(before,after,parents)


def verify_delivery(folder):
    from delivery import NAME, HEADER, verify_envelope
    folder = Path(folder)
    require(verify_envelope(folder) == SEALED_SHA)
    with (folder/NAME).open('rb') as stream:
        _,pin,tree,_,plain_sha,_,_ = HEADER.unpack(stream.read(HEADER.size))
    require(pin == CANDIDATE_PIN.encode('ascii') and tree == CANDIDATE_TREE.encode('ascii') and plain_sha.hex() == SETUP_SHA)


def main():
    try:
        if sys.argv[1:] == ['prior']:
            prior_from_api(os.environ.pop('GH_TOKEN',''))
            print('PRIOR_FIVE_GROUPS=PASS',flush=True)
            print('PRIOR_CLEAN_INSTALLER_ARTIFACT='+str(PRIOR_ARTIFACT),flush=True)
        elif len(sys.argv) == 3 and sys.argv[1] == 'delivery':
            verify_delivery(sys.argv[2])
            print('DELIVERY_SETUP_SHA256='+SETUP_SHA,flush=True)
            print('DELIVERY_ENCRYPTED_SHA256='+SEALED_SHA,flush=True)
            print('DELIVERY_ENCRYPTED_PACKAGE=PASS',flush=True)
            print('DELIVERY_RELEASE_STATUS=QUALIFIED_CANDIDATE_NOT_OWNER_ACCEPTED',flush=True)
        else:
            raise ValueError('invalid input')
    except Exception:
        print('REUSE_EVIDENCE=FAIL',flush=True)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
