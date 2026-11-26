import importlib.util, pathlib, subprocess, json, os, hashlib, shutil, sys
import pytest
p=pathlib.Path(__file__).with_name('qualify.py')
spec=importlib.util.spec_from_file_location('qualify',p);qmod=importlib.util.module_from_spec(spec);spec.loader.exec_module(qmod)
@pytest.fixture
def q(tmp_path):
 return qmod.Qualification(tmp_path)

def test_manifest_identity(q,capsys):
 path=q.src/'package.json'; raw=b'{"dependencies":{"fixture":"1.2.3"}}\n';path.write_bytes(raw)
 h=subprocess.check_output(['git','hash-object',str(path)]).decode().strip()
 assert h==qmod.git_blob(raw)
 assert q.manifest_identity('BEFORE',path,h,{'fixture':'1.2.3'})
 path.write_bytes(b'{"dependencies":{"fixture":"^1.2.3"},"private_marker":"UNSAFE_TEXT"}')
 assert not q.manifest_identity('AFTER',path,h,{'fixture':'1.2.3'})
 out=capsys.readouterr().out
 assert 'AFTER_CHANGED_DIRECT_PINS=1' in out and 'AFTER=FAIL' in out and 'UNSAFE_TEXT' not in out

def test_real_node_failure_coordinate(q,capsys):
 path=q.src/'desktop'/'tests'/'sample.test.mjs';path.parent.mkdir(parents=True);path.write_text("import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('PRIVATE_TEST_NAME',()=>assert.equal('PRIVATE_TEXT','other'));\n")
 q.coordinates={'desktop/tests/sample.test.mjs':17}
 code,out=q.run('NODE_FIXTURE',[shutil.which('node'),'--test','--test-reporter=tap',path],report=False)
 assert code==1
 q.node_locations(out);published=capsys.readouterr().out
 assert 'NODE_FAILED_LOCATION=17:3:1' in published
 assert 'PRIVATE_TEST_NAME' not in published and 'PRIVATE_TEXT' not in published and str(q.src) not in published

def test_relative_coordinate(q):
 q.coordinates={'desktop/tests/sample.test.mjs':4,'tests/sample.test.mjs':5}
 assert q.coordinate('tests/sample.test.mjs','3','1',cwd='desktop')=='4:3:1'
 assert q.coordinate('secret/path','1','1',cwd='desktop') is None

def test_cleanup_readonly_nested(tmp_path):
 root=tmp_path/'iwxa-agent065-fixture';root.mkdir();d=root/'deep';d.mkdir();p=d/'data';p.write_text('secret');p.chmod(0o400)
 assert qmod.cleanup_private(root) and not root.exists()
 assert not qmod.cleanup_private(tmp_path) and tmp_path.exists()

def test_temp_inside_root(q):
 assert pathlib.Path(q.env['TEMP']).is_relative_to(q.root)
 assert pathlib.Path(q.env['TEMP']).is_dir()

def test_rust_override_and_no_release_on_diagnostic(q,monkeypatch,capsys):
 # Actual orchestrator; tool executions are explicit fixtures, not Rust tests.
 desktop=q.src/'desktop';native=desktop/'modeling-native';native.mkdir(parents=True)
 raw=b'{"dependencies":{"fixture":"1.2.3"}}\n';(native/'package.json').write_bytes(raw)
 (native/'package-lock.json').write_text('{}')
 q.files=['desktop/modeling-native/package-lock.json'];q.coordinates={}
 npm=q.root/'tools'/'npm.cmd';npm.parent.mkdir();(npm.parent/'node_modules/npm/bin').mkdir(parents=True);(npm.parent/'node_modules/npm/bin/npm-cli.js').touch()
 monkeypatch.setattr(qmod.shutil,'which',lambda name:str(npm) if name=='npm.cmd' else name)
 seen=[]
 def run(label,args,**kw):
  seen.append((label,args,kw));
  if label=='NATIVE_MANIFEST_GIT':return 0,'100644 blob '+qmod.git_blob(raw)+'\tdesktop/modeling-native/package.json\n'
  if label=='NATIVE_BUILD_GATE':q.results[label]=False;return 1,'fixture failure'
  if label=='NODE_REGRESSION':return 0,'# tests 1\n# pass 1\n# fail 0\n# skipped 0\n# cancelled 0\n'
  if label=='CORE_ONLY_DESKTOP_BUILD':
   d=desktop/'dist-core-check';d.mkdir();(d/'index.html').touch()
  q.results[label]=True;return 0,''
 monkeypatch.setattr(q,'run',run)
 assert not q.desktop()
 rust=next(x for x in seen if x[0]=='RUST_TESTS')
 assert json.loads(rust[2]['env']['TAURI_CONFIG'])=={'build':{'frontendDist':'../dist-core-check'}}
 assert not any(x[0]=='TAURI_BUILD' for x in seen)
 assert 'TAURI_BUILD=BLOCKED' in capsys.readouterr().out
