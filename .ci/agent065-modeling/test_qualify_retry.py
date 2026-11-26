from pathlib import Path
from types import SimpleNamespace
import subprocess
import sys
import pytest
import qualify_retry as r
import native_probe as n


class FixtureQualification:
    def __init__(self, root):
        self.root = root
        self.src = root/'source'; self.src.mkdir()
        self.logs = root/'logs'; self.logs.mkdir()
        self.files = []
        self.results = {}
        self.pytest_exit_codes = {}
        self.calls = []
    def checkout(self,token,pin,tree,*,status_prefix=''):
        assert (pin,tree,status_prefix) == (r.BASELINE_PIN,r.BASELINE_TREE,'BASELINE_')
        assert token == 'test-read-token'
        (self.src/'requirements-ci.txt').write_text('pytest\n')
        (self.src/'test_same.py').write_text('def test_same(): assert False\ndef test_regression(): assert True\n')
        self.files = ['test_same.py']
        return True
    def run(self,label,args,**kw):
        self.calls.append((label,args,kw))
        proc = subprocess.run(args,cwd=self.src,capture_output=True,text=True,timeout=kw.get('timeout',60))
        if kw.get('report',True): self.results[label] = proc.returncode == 0
        return proc.returncode,proc.stdout+proc.stderr
    def pytest(self,label,python,files,**kw):
        code,_ = self.run(label,[python,'-m','pytest','-q',*files,'-o','junit_family=xunit1',
            '--junitxml='+str(self.logs/(label+'.xml'))],report=False,**kw)
        self.pytest_exit_codes[label] = code
        self.results[label] = code == 0
        return code == 0


def test_baseline_comparison_runs_real_tests_and_preserves_candidate_failure(tmp_path,capsys):
    q = FixtureQualification(tmp_path)
    (q.src/'requirements-ci.txt').write_text('pytest\n')
    (q.src/'test_same.py').write_text('def test_same(): assert False\ndef test_regression(): assert False\n')
    files=['test_same.py']; before=r.fingerprint(q,sys.executable,'BEFORE')
    assert not q.pytest('CORE_RETRY',sys.executable,files)
    rows=r.read_outcomes(q.logs/'CORE_RETRY.xml',files)
    assert r.baseline_evidence(q,FixtureQualification,'test-read-token',sys.executable,files,rows,before)
    assert not q.results['CORE_RETRY']
    out=capsys.readouterr().out
    assert 'CORE_BOTH_FAILED=1' in out and 'CORE_BASELINE_PASSED=1' in out
    assert 'CORE_BASELINE_COMPARISON=MATCHED_CASE_IDENTITIES' in out
    assert 'test-read-token' not in out and 'test_same.py' not in out


def test_unverified_or_changed_dependency_evidence_never_classified(tmp_path,capsys):
    q=FixtureQualification(tmp_path); files=['test_same.py']
    rows={(files[0],'module','case'):'FAIL'}
    def never(*args): pytest.fail('baseline must not be fetched')
    assert not r.baseline_evidence(q,never,'token',sys.executable,files,None,None)
    assert not r.baseline_evidence(q,never,'token',sys.executable,files,rows,'0'*64)
    out=capsys.readouterr().out
    assert 'CORE_BASELINE_COMPARISON=UNAVAILABLE' in out and 'CORE_BASELINE_COMPARISON=DEPENDENCIES_CHANGED' in out


def test_probe_reports_only_known_public_names_or_hashes(capsys):
    def missing(name):
        def run(): raise ModuleNotFoundError('PRIVATE TEXT',name=name)
        return run
    assert not n.stage('OFFLINE_VIEW',missing('matplotlib'))
    assert not n.stage('OFFLINE_VIEW',missing('private.module.secret'))
    out=capsys.readouterr().out
    assert 'IWXA_NATIVE_MISSING=matplotlib' in out and 'IWXA_NATIVE_MISSING_SHA256=' in out
    assert 'private.module.secret' not in out and 'PRIVATE TEXT' not in out


def test_probe_fails_on_missing_or_duplicate_stage(tmp_path,capsys):
    q=FixtureQualification(tmp_path)
    lines=[f'IWXA_NATIVE_STAGE={stage}:PASS:None' for stage in r.STAGES]
    q.run=lambda *a,**k:(0,'\n'.join(lines+['IWXA_NATIVE_MISSING=private.module.secret','PRIVATE_LOG']))
    assert r.native_probe(q,sys.executable)
    assert q.results['NATIVE_PROBE_COMPLETE'] and q.results['NATIVE_VERSION_CHECK']
    lines.append(lines[0]); assert not r.native_probe(q,sys.executable)
    lines.pop();lines.pop(); assert not r.native_probe(q,sys.executable)
    assert 'private.module.secret' not in capsys.readouterr().out


def test_addressed_scope_never_claims_full_python_regression(tmp_path,monkeypatch,capsys):
    q=FixtureQualification(tmp_path)
    from release_gate import OCR_MODULE
    core=([f'tests/test_a_{i:04}.py' for i in range(100)] + [OCR_MODULE] +
          [f'tests/test_z_{i:04}.py' for i in range(r.CORE_COUNT-101)])
    modeling=[f'tests/test_modeling_{i:04}.py' for i in range(r.MODELING_COUNT)]
    q.files=sorted(core+modeling)
    q.venv=lambda name,requirements: sys.executable
    def run(label,args,**kw):
        q.calls.append((label,args,kw)); q.results[label]=True
        return 0, 'a'*64 if 'DEPS_' in label else ''
    q.run=run
    def run_tests(label,python,files,**kw):
        q.calls.append((label,files,kw));q.results[label]=True;q.pytest_exit_codes[label]=0
        from xml.etree.ElementTree import Element,SubElement,ElementTree
        root=Element('testsuite')
        for f in files: SubElement(root,'testcase',file=f,classname='fixture',name='test_case')
        ElementTree(root).write(q.logs/(label+'.xml'))
        return True
    q.pytest=run_tests
    monkeypatch.setattr(r,'sys',SimpleNamespace(version_info=(3,12),executable=sys.executable))
    monkeypatch.setattr(r,'native_probe',lambda *args:True)
    assert r.python_retry(q,lambda *_: pytest.fail('unneeded baseline'),'token')
    calls={label:(args,kw) for label,args,kw in q.calls}
    assert calls['CORE_RETRY'][0]==[core[i-1] for i in r.CORE_RETRY if core[i-1]!=OCR_MODULE]
    assert OCR_MODULE not in calls['CORE_RETRY'][0]
    assert calls['MODELING_NATIVE_RETRY'][0]==[modeling[i-1] for i in r.MODELING_RETRY]
    assert calls['MODELING_NATIVE_RETRY'][1]['native'] is True
    assert 'FULL_PYTHON_REGRESSION=NOT_RUN' in capsys.readouterr().out
