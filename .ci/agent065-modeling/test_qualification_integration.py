"""Local Git and pytest: exercise the original qualifier, no network or native claim."""
from pathlib import Path
import subprocess
import sys
from qualify import Qualification, cleanup_private
from retry_scope import read_outcomes
import qualify_retry as r


def git(root,*args):
    return subprocess.check_output(['git','-C',str(root),*args],stderr=subprocess.DEVNULL,text=True).strip()


def source(root,fail_second):
    root.mkdir()
    git(root,'init','-q');git(root,'config','user.email','fixture@example.invalid');git(root,'config','user.name','Fixture')
    (root/'requirements-ci.txt').write_text('pytest\n')
    (root/'test_same.py').write_text('def test_both(): assert False\ndef test_regression(): assert '+str(not fail_second)+'\n')
    git(root,'add','.');git(root,'commit','-qm','fixture')
    return git(root,'rev-parse','HEAD'),git(root,'rev-parse','HEAD^{tree}')


def local_factory(repo):
    def make(root):
        q=Qualification(root);original=q.run
        def run(label,args,**kw):
            if label=='PRIVATE_FETCH':
                # Same real Git execution, only the transport is local.
                assert 'GIT_CONFIG_VALUE_0' in kw['env']
                args=[*args[:-2],str(repo),args[-1]]
                kw['env']={k:v for k,v in kw['env'].items() if not k.startswith('GIT_CONFIG_')}
            return original(label,args,**kw)
        q.run=run
        return q
    return make


def test_original_qualifier_baseline_and_private_cleanup(tmp_path,monkeypatch,capsys):
    old=tmp_path/'old';new=tmp_path/'new'
    old_pin,old_tree=source(old,False);pin,tree=source(new,True)
    root=tmp_path/'iwxa-agent065-real-qualifier';root.mkdir()
    monkeypatch.setattr(r,'BASELINE_PIN',old_pin);monkeypatch.setattr(r,'BASELINE_TREE',old_tree)
    q=local_factory(new)(root)
    assert q.checkout('fixture-token',pin,tree)
    files=['test_same.py'];before=r.fingerprint(q,sys.executable,'BEFORE')
    assert not q.pytest('CORE_RETRY',sys.executable,files)
    assert q.pytest_exit_codes['CORE_RETRY']==1
    rows=read_outcomes(q.logs/'CORE_RETRY.xml',files)
    assert r.baseline_evidence(q,local_factory(old),'fixture-token',sys.executable,files,rows,before)
    out=capsys.readouterr().out
    assert 'SOURCE_PIN='+pin in out and 'BASELINE_SOURCE_PIN='+old_pin in out
    assert 'CORE_BOTH_FAILED=1' in out and 'CORE_BASELINE_PASSED=1' in out
    assert 'fixture-token' not in out and str(root) not in out and 'test_same.py' not in out
    assert q.results['CORE_RETRY'] is False
    assert cleanup_private(root) and not root.exists()
    assert old.exists() and new.exists()


def test_original_qualifier_native_skip_is_not_pass(tmp_path,capsys):
    q=Qualification(tmp_path)
    (q.src/'test_skip.py').write_text('import pytest\ndef test_skip(): pytest.skip("fixture")\n')
    assert not q.pytest('NATIVE',sys.executable,['test_skip.py'],native=True)
    assert q.pytest_exit_codes['NATIVE']==0
    assert 'NATIVE_SKIP=1' in capsys.readouterr().out


def test_original_qualifier_python_trace_is_private(tmp_path,capsys):
    q=Qualification(tmp_path)
    (q.src/'owner.py').write_text('def execute():\n    raise ValueError("PRIVATE_MESSAGE")\n')
    (q.src/'test_fixture.py').write_text('from owner import execute\ndef test_private_case(): execute()\n')
    q.coordinates={'owner.py':1,'test_fixture.py':2}
    assert not q.pytest('TRACE',sys.executable,['test_fixture.py'])
    out=capsys.readouterr().out
    assert 'TRACE_FAILED_TRACE=2:2:1' in out and 'TRACE_FAILED_TRACE=1:2:1' in out
    for text in ('PRIVATE_MESSAGE','test_private_case','owner.py','test_fixture.py',str(tmp_path)):
        assert text not in out
