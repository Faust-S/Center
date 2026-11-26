import json
from pathlib import Path
import subprocess
import pytest
import admit
import qualify_retry as r


def git(*args):
    return subprocess.check_output(['git',*args],stderr=subprocess.DEVNULL,text=True).strip()


def put(path,value):
    path=Path(path);path.parent.mkdir(parents=True,exist_ok=True)
    path.write_text(json.dumps(value)+'\n')


@pytest.fixture
def request_commit(tmp_path,monkeypatch):
    monkeypatch.chdir(tmp_path)
    git('init','-q');git('config','user.email','fixture@example.invalid');git('config','user.name','Fixture')
    prepared={'candidate':r.CANDIDATE_PIN,'tree':r.CANDIDATE_TREE,'baseline':r.BASELINE_PIN,
              'baseline_tree':r.BASELINE_TREE,'scope':r.SCOPE,'reason':r.REASON,'installed_gui':'NOT_RUN'}
    put(admit.PREPARED,prepared);git('add','.');git('commit','-qm','prepare');parent=git('rev-parse','HEAD')
    request={**prepared,'workflow':admit.WORKFLOW,'prepared_sha':parent}
    put(admit.REQUEST,request);git('add','.');git('commit','-qm','request');head=git('rev-parse','HEAD')
    ref=admit.PREFIX+parent
    env={'GITHUB_REPOSITORY':'Faust-S/Center','GITHUB_EVENT_NAME':'push','GITHUB_REF':ref,
         'GITHUB_SHA':head,'PRIVATE_PIN':r.CANDIDATE_PIN,'PRIVATE_TREE':r.CANDIDATE_TREE,'QUALIFICATION_GROUP':'python'}
    event={'created':False,'deleted':False,'forced':False,'ref':ref,'before':parent,'after':head}
    return env,event,request


def test_exact_request_admits_only_two_groups(request_commit):
    env,event,_=request_commit
    assert admit.admit(env,event)==env['GITHUB_SHA']
    assert admit.admit({**env,'QUALIFICATION_GROUP':'desktop'},event)==env['GITHUB_SHA']
    with pytest.raises(ValueError):admit.admit({**env,'QUALIFICATION_GROUP':'all'},event)


@pytest.mark.parametrize('change',[{'created':True},{'forced':True},{'deleted':True},{'before':'0'*40}])
def test_invalid_event_rejected(request_commit,change):
    env,event,_=request_commit
    with pytest.raises(ValueError):admit.admit(env,{**event,**change})


def test_tampered_pins_and_request_rejected(request_commit):
    env,event,request=request_commit
    with pytest.raises(ValueError):admit.admit({**env,'PRIVATE_PIN':'0'*40},event)
    with pytest.raises(ValueError):admit.admit({**env,'PRIVATE_TREE':'0'*40},event)
    put(admit.REQUEST,{**request,'baseline':'0'*40})
    with pytest.raises(ValueError):admit.admit(env,event)


def test_extra_file_in_request_commit_denied(request_commit):
    env,event,_=request_commit
    Path('extra.txt').write_text('not part of the request');git('add','.');git('commit','--amend','-qm','wrong request')
    head=git('rev-parse','HEAD')
    with pytest.raises(ValueError):admit.admit({**env,'GITHUB_SHA':head},{**event,'after':head})
