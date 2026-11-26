import subprocess
import sys
from pathlib import Path
import pytest
from report_evidence import node_counts, node_accepted, skip_report
from retry_scope import read_outcomes


def run_node(tmp_path, body):
    source = tmp_path / 'case.test.mjs'
    source.write_text("import test from 'node:test';\n" + body)
    proc = subprocess.run(['node', '--test', '--test-reporter=tap', str(source)],
                          capture_output=True, text=True, timeout=30)
    return proc.returncode, proc.stdout + proc.stderr


@pytest.mark.parametrize('body, expected', [
    ("test('real pass',()=>{});", True),
    ("test('real skip',{skip:true},()=>{});", False),
    ("test('real todo',{todo:true},()=>{throw Error('private');});", False),
    ("test('real failure',()=>{throw Error('private');});", False),
    ("test('real cancel',()=>new Promise(()=>{}));", False),
    ("test('suite',async t=>{await t.test('nested pass',()=>{});});", True),
])
def test_original_node_footer(tmp_path, body, expected):
    code, output = run_node(tmp_path, body)
    counts = node_counts(output)
    assert counts is not None
    assert node_accepted(code, True, counts) is expected
    assert not node_accepted(code, False, counts)


@pytest.mark.parametrize('change', [
    lambda s: s.replace('# todo 0\n', ''),
    lambda s: s + '# tests 1\n',
    lambda s: s.replace('# pass 1', '# pass 2'),
    lambda s: s.replace('# cancelled 0', '# cancelled -1'),
    lambda s: s.replace('# skipped 0', '# skipped 00'),
    lambda s: s.replace('# fail 0', '# fail 1000000000'),
])
def test_malformed_node_footer(tmp_path, change):
    code, output = run_node(tmp_path, "test('pass',()=>{});")
    assert node_accepted(code, True, node_counts(output))
    assert not node_accepted(code, True, node_counts(change(output)))


def test_node_rejects_no_tests_and_nonzero_exit():
    counts = node_counts('# tests 0\n# suites 0\n# pass 0\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n')
    assert counts is not None and not node_accepted(0, True, counts)
    counts.update(tests=1, **{'pass': 1})
    assert not node_accepted(1, True, counts)
    assert not node_accepted(False, True, counts)


def test_real_pytest_skip_kinds_and_catalog_ordinals(tmp_path):
    tests = tmp_path / 'tests'
    tests.mkdir()
    (tests / '__init__.py').write_text('')
    (tests / 'test_private_collection.py').write_text("import pytest\npytest.skip('PRIVATE_COLLECTION', allow_module_level=True)\n")
    (tests / 'test_private_mixed.py').write_text("import pytest\n@pytest.mark.skip(reason='PRIVATE_SKIP')\ndef test_private_skip(): pass\n@pytest.mark.xfail(reason='PRIVATE_XFAIL')\ndef test_private_failure(): assert False\ndef test_pass(): pass\n")
    files = ['tests/test_private_collection.py', 'tests/test_private_mixed.py']
    catalog = ['tests/test_a.py', *files]
    report = tmp_path / 'actual.xml'
    proc = subprocess.run([sys.executable, '-m', 'pytest', '-q', *files, '-o', 'junit_family=xunit1', '--junitxml=' + str(report)], cwd=tmp_path, capture_output=True, timeout=30)
    assert proc.returncode == 0
    emitted = []
    callback = skip_report('CORE', catalog, lambda k,v: emitted.append((k,v)))
    rows = read_outcomes(report, files, skip_diagnostic=callback)
    assert rows is not None and list(rows.values()).count('SKIP') == 3
    assert emitted == [('CORE_SKIP_MODULE','2:COLLECTION:1'), ('CORE_SKIP_MODULE','3:CASE_SKIP:1'), ('CORE_SKIP_MODULE','3:EXPECTED_FAILURE:1')]
    assert 'private' not in str(emitted).lower()
    emitted.clear()
    assert read_outcomes(report, catalog, skip_diagnostic=callback) is None
    assert not emitted


def test_skip_unknown_kind_and_duplicate_identity(tmp_path):
    report = tmp_path / 'fake.xml'
    case = '<testcase file="tests/test_a.py" classname="tests.test_a" name="test_private"><skipped type="PRIVATE_VALUE" message="PRIVATE_REASON"/></testcase>'
    files = ['tests/test_a.py']
    emitted = []
    callback = skip_report('CORE', files, lambda k,v: emitted.append((k,v)))
    report.write_text('<testsuite>' + case + '</testsuite>')
    assert read_outcomes(report, files, skip_diagnostic=callback) is not None
    assert emitted == [('CORE_SKIP_MODULE','1:OTHER_SKIP:1')]
    emitted.clear()
    report.write_text('<testsuite>' + case + case + '</testsuite>')
    assert read_outcomes(report, files, skip_diagnostic=callback) is None
    assert not emitted


def test_skip_reporting_rejects_nonfinite_or_unadmitted_data():
    with pytest.raises(ValueError):
        skip_report('CORE', ['a','a'], print)
    callback = skip_report('CORE', ['a'], lambda *_: pytest.fail('unexpected emission'))
    for value in [('secret','CASE_SKIP',1), ('a','PRIVATE',1), ('a','CASE_SKIP',True), ('a','CASE_SKIP',0)]:
        with pytest.raises(ValueError):
            callback(*value)
