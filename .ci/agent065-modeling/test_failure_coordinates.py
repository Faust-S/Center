from pathlib import Path
import subprocess
import shutil
from failure_coordinates import coordinate,structured_locations,python_trace_locations


def test_windows_structured_path():
    root=r'D:\a\Center\_temp\iwxa-agent065-fixture\src'
    inv={'desktop/tests/example.test.mjs':17}
    for path in [root+r'\desktop\tests\example.test.mjs',r'D:\\a\\Center\\_temp\\iwxa-agent065-fixture\\src\\desktop\\tests\\example.test.mjs','file:///D:/a/Center/_temp/iwxa-agent065-fixture/src/desktop/tests/example.test.mjs','desktop/tests/example.test.mjs','tests/example.test.mjs',r'\\?\D:\a\Center\_temp\iwxa-agent065-fixture\src\desktop\tests\example.test.mjs']:
        assert coordinate(path,3,1,root,inv,cwd='desktop')=='17:3:1'
    assert coordinate(r'D:\other\desktop\tests\example.test.mjs',3,1,root,inv,cwd='desktop') is None
    assert coordinate('tests/example.test.mjs','secret',1,root,inv,cwd='desktop') is None


def test_real_node_structured_failure(tmp_path):
    src=tmp_path/'src';tests=src/'desktop'/'tests';tests.mkdir(parents=True)
    testfile=tests/'example.test.mjs'
    testfile.write_text("import test from 'node:test';\ntest('PRIVATE_TITLE',()=>{throw Error('PRIVATE_VALUE')});\n")
    report=tmp_path/'report.jsonl'
    reporter=Path(__file__).with_name('node-failures.mjs').resolve().as_uri()
    run=subprocess.run([shutil.which('node'),'--test','--test-reporter=tap','--test-reporter='+reporter,'--test-reporter-destination=stdout','--test-reporter-destination='+str(report),str(testfile)],capture_output=True,text=True,cwd=src/'desktop')
    assert run.returncode==1
    assert 'PRIVATE_TITLE' in run.stdout
    assert structured_locations(report,src,{'desktop/tests/example.test.mjs':17},cwd='desktop')=={'17:2:1'}
    assert 'PRIVATE_TITLE' not in report.read_text() and 'PRIVATE_VALUE' not in report.read_text()


def test_private_python_trace_coordinates():
    root=r'D:\a\private\source'
    inv={'tests/test_fixture.py':17,'runtime/owner.py':32}
    data='tests/test_fixture.py:2: in test_case\n'+root+r'\runtime\owner.py'+':7: ValueError: PRIVATE_MESSAGE\nD:/other/private.py:11: in secret\n'
    assert python_trace_locations(data,root,inv)==['17:2:1','32:7:1']
