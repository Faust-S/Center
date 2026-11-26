from pathlib import Path
import subprocess
import sys
import pytest
from retry_scope import *


def test_selection():
    c=[f'tests/test_{i:04}.py' for i in range(CORE_COUNT)]
    assert len(select_modules(c,CORE_COUNT,CORE_RETRY))==29
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


def test_finite_evidence_diagnostics(tmp_path):
    r=tmp_path/'r.xml'
    row='<testcase file="t.py" classname="m" name="a"/>'
    for body,files,reason in [('', ['t.py'], 'EMPTY_REPORT'),
            (row, ['other.py'], 'UNMAPPED_FILE'),
            (row.replace('classname="m"','classname=""'), ['t.py'], 'EMPTY_IDENTITY'),
            (row+row, ['t.py'], 'DUPLICATE_IDENTITY'),
            (row, ['t.py','other.py'], 'MISSING_MODULE')]:
        r.write_text('<testsuite>'+body+'</testsuite>')
        assert parse_outcomes(r,files)==(None,reason)
        assert read_outcomes(r,files) is None
    r.write_text('<invalid>')
    assert parse_outcomes(r,['t.py'])==(None,'INVALID_REPORT')
    r.write_text('<testsuite>'+row+'</testsuite>')
    assert parse_outcomes(r,['t.py'])==({('t.py','m','a'):'PASS'},'EXACT')
