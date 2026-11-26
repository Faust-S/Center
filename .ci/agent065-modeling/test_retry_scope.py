from pathlib import Path
import subprocess
import sys
import pytest
from retry_scope import *


def test_selection():
    c=[f'tests/test_{i:04}.py' for i in range(CORE_COUNT)]
    assert len(select_modules(c,CORE_COUNT,CORE_RETRY))==31
    assert c[80] in select_modules(c,CORE_COUNT,CORE_RETRY)
    m=[f'tests/test_modeling_{i:04}.py' for i in range(MODELING_COUNT)]
    assert select_modules(m,MODELING_COUNT,MODELING_RETRY)==m
    assert select_modules(c,CORE_COUNT,CORE_RETRY)[0]==c[14]
    for catalog,ordinals in [(c[:-1],CORE_RETRY),(c[::-1],CORE_RETRY),(c,(15,15)),(c,(0,)),(c,(True,)),(c,(CORE_COUNT+1,))]:
        with pytest.raises(ValueError):select_modules(catalog,CORE_COUNT,ordinals)


def test_real_junit_comparison(tmp_path):
    name='test_fixture.py'; source=tmp_path/name; report=tmp_path/'candidate.xml'
    source.write_text('def test_a(): assert False\ndef test_b(): assert False\ndef test_c(): assert True\n')
    cmd=[sys.executable,'-m','pytest','-q',name,'-o','junit_family=xunit1','--junitxml=']
    assert subprocess.run([*cmd[:-1],cmd[-1]+str(report)],cwd=tmp_path,capture_output=True).returncode==1
    candidate=read_outcomes(report,[name]); assert candidate is not None
    assert failed_modules(candidate,[name])==[name]
    source.write_text('def test_a(): assert False\ndef test_b(): assert True\ndef test_c(): assert True\n')
    report2=tmp_path/'baseline.xml'
    assert subprocess.run([*cmd[:-1],cmd[-1]+str(report2)],cwd=tmp_path,capture_output=True).returncode==1
    baseline=read_outcomes(report2,[name]);assert compare_failures(candidate,baseline)=={'BOTH_FAILED':1,'BASELINE_PASSED':1,'BASELINE_SKIPPED':0,'BASELINE_UNMATCHED':0}
    assert read_outcomes(report,['other.py']) is None
    assert compare_failures(candidate,None) is None


def test_unmatched_skip_and_duplicate(tmp_path):
    r=tmp_path/'r.xml'; r.write_text('<testsuite><testcase file="t.py" classname="m" name="a"><failure/></testcase><testcase file="t.py" classname="m" name="b"><failure/></testcase></testsuite>')
    c=read_outcomes(r,['t.py']); b={('t.py','m','a'):'SKIP'}
    assert compare_failures(c,b)=={'BOTH_FAILED':0,'BASELINE_PASSED':0,'BASELINE_SKIPPED':1,'BASELINE_UNMATCHED':1}
    r.write_text('<testsuite><testcase file="t.py" classname="m" name="a"/><testcase file="t.py" classname="m" name="a"/></testsuite>')
    assert read_outcomes(r,['t.py']) is None
    assert failed_modules(None,['t.py'])==['t.py']


def test_imported_cases_belong_to_selected_collector(tmp_path):
    tests=tmp_path/'tests'
    tests.mkdir()
    (tests/'__init__.py').write_text('')
    (tests/'test_source.py').write_text('def test_shared(): pass\n')
    (tests/'test_import.py').write_text('from tests.test_source import test_shared\n')
    report=tmp_path/'out.xml'
    files=['tests/test_import.py','tests/test_source.py']
    command=[sys.executable,'-m','pytest','-q',*files,'-o','junit_family=xunit1','--junitxml='+str(report)]
    assert subprocess.run(command,cwd=tmp_path,capture_output=True).returncode==0
    rows=read_outcomes(report,files)
    assert rows=={('tests/test_import.py','tests.test_import','test_shared'):'PASS',
                  ('tests/test_source.py','tests.test_source','test_shared'):'PASS'}
    # Also valid when the definition's module was not selected in this shard.
    command=[sys.executable,'-m','pytest','-q',files[0],'-o','junit_family=xunit1','--junitxml='+str(report)]
    assert subprocess.run(command,cwd=tmp_path,capture_output=True).returncode==0
    assert read_outcomes(report,files[:1])=={('tests/test_import.py','tests.test_import','test_shared'):'PASS'}
    diagnostic=[]
    assert read_outcomes(report,files,lambda r,n:diagnostic.append((r,n))) is None
    assert diagnostic==[('MODULE_NOT_COLLECTED',2)]


def test_unknown_or_ambiguous_report_identity_is_not_evidence(tmp_path):
    report=tmp_path/'out.xml'
    files=['tests/test_selected.py']
    for path,cls in [('../test_escape.py','tests.test_selected'),
                     ('tests/test_other.py','tests.test_other')]:
        report.write_text(f'<testsuite><testcase file="{path}" classname="{cls}" name="test_a"/></testsuite>')
        diagnostic=[]
        assert read_outcomes(report,files,lambda r,n:diagnostic.append((r,n))) is None
        assert diagnostic[0][0]=='UNKNOWN_DEFINITION'
