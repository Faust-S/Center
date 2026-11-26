import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
import pytest
import release_gate as gate

PIN = 'a'*40
TREE = 'b'*40


def test_scope_partitions_exact_ocr_and_refuses_ambiguous_scope():
    other = ['tests/test_one.py', 'tests/test_two.py']
    assert gate.split_core([other[0], gate.OCR_MODULE, other[1]]) == (other, [gate.OCR_MODULE])
    for bad in (other, [gate.OCR_MODULE]*2, [other[0]]*2 + [gate.OCR_MODULE]):
        with pytest.raises(ValueError): gate.split_core(bad)


@pytest.fixture
def setup(tmp_path):
    exe = tmp_path / 'IWXA-Private-SetupCore-Candidate.exe'
    exe.write_bytes(b'fixture binary')
    sha = hashlib.sha256(exe.read_bytes()).hexdigest()
    log = tmp_path / 'logs'; log.mkdir()
    receipt = {'status': 'BUILT_UNQUALIFIED', 'version': '0.6.5',
               'private_source_commit': PIN, 'private_source_tree': TREE,
               'public_setup_core_commit': gate.SETUP_PIN, 'setup_sha256': sha}
    path = log / 'private-setup-core-build.json'
    path.write_text(json.dumps(receipt), encoding='utf-16')
    result = {'status': gate.SETUP_STATUS, 'version': '0.6.5',
              'source_commit': PIN, 'source_tree': TREE, 'setup_core_commit': gate.SETUP_PIN,
              'setup_sha256': sha, 'private_artifacts_uploaded_to_public': False,
              **dict.fromkeys(gate.SETUP_REQUIRED, True)}
    return tmp_path, exe, path, receipt, result


def test_real_receipt_decoder_and_digest_binding(setup):
    out, exe, path, receipt, result = setup
    assert gate.verify_setup_build(out, PIN, TREE)
    assert gate.verify_setup_result(json.dumps(result), out, PIN, TREE)
    exe.write_bytes(b'changed')
    assert not gate.verify_setup_build(out, PIN, TREE)
    assert not gate.verify_setup_result(json.dumps(result), out, PIN, TREE)


@pytest.mark.parametrize('key,value', [('status','FAIL'), ('version','0.6.4'),
    ('private_source_commit','c'*40), ('private_source_tree','c'*40),
    ('public_setup_core_commit','c'*40), ('setup_sha256','0'*64)])
def test_setup_build_rejects_wrong_receipt(setup, key, value):
    out, exe, path, receipt, result = setup
    path.write_text(json.dumps({**receipt, key:value}), encoding='utf-8')
    assert not gate.verify_setup_build(out, PIN, TREE)


@pytest.mark.parametrize('key', gate.SETUP_REQUIRED + ('private_artifacts_uploaded_to_public',))
def test_setup_acceptance_requires_each_original_witness(setup, key):
    out, exe, path, receipt, result = setup
    result.pop(key)
    assert not gate.verify_setup_result(json.dumps(result), out, PIN, TREE)


def test_setup_receipt_rejects_malformed_or_missing_output(setup):
    out, exe, path, receipt, result = setup
    assert not gate.verify_setup_result('not json', out, PIN, TREE)
    assert not gate.verify_setup_result('[]', out, PIN, TREE)
    path.write_text('[]')
    assert not gate.verify_setup_build(out, PIN, TREE)
    exe.unlink()
    assert not gate.verify_setup_result(json.dumps(result), out, PIN, TREE)


@pytest.mark.parametrize('phase,code,operation,expected', [
    ('MODELING_EXECUTE','HTTP_409','PUBLIC_PROGRAM_CONNECT',
     {'SETUP_WITNESS_PHASE':'MODELING_EXECUTE','SETUP_WITNESS_FAILURE_CODE':'HTTP_409',
      'SETUP_WITNESS_OPERATION':'PUBLIC_PROGRAM_CONNECT'}),
    ('MODELING_GUI','PROPEL_GRAPH','PRIVATE_SECRET',
     {'SETUP_WITNESS_PHASE':'MODELING_GUI','SETUP_WITNESS_FAILURE_CODE':'PROPEL_GRAPH'}),
    ('MODELING_EXECUTE','private file path','arbitrary secret',
     {'SETUP_WITNESS_PHASE':'MODELING_EXECUTE'}),
    ('QWEN_EXECUTE','private output','private operation',{'SETUP_WITNESS_PHASE':'QWEN_EXECUTE'}),
    ('arbitrary phase','PROOF','STATUS',{}),
    (['MODELING_GUI'],'PROOF','STATUS',{}),
])
def test_witness_diagnostics_only_admit_finite_public_codes(tmp_path,phase,code,operation,expected):
    target=tmp_path/'temporary-installed-fixture'/'installed-witness.json'
    target.parent.mkdir()
    target.write_text(json.dumps({'status':'FAIL','phase':phase,'failure_code':code,
                                  'last_operation':operation,'secret':'must never escape'}),encoding='utf-8')
    assert gate.witness_diagnostics(tmp_path)==expected


def test_baseline_build_uses_its_exact_own_version(setup):
    out, exe, path, receipt, _ = setup
    path.write_text(json.dumps({**receipt,'version':'0.6.4'}),encoding='utf-8')
    assert gate.verify_setup_build(out,PIN,TREE,'0.6.4')
    assert not gate.verify_setup_build(out,PIN,TREE)


def test_upgrade_receipt_binds_both_installers(tmp_path):
    from retry_scope import BASELINE_PIN, BASELINE_TREE
    old,new,root=[tmp_path/name for name in ('old','new','upgrade')]
    for p in (old,new,root):p.mkdir()
    exe='IWXA-Private-SetupCore-Candidate.exe'
    (old/exe).write_bytes(b'old-fixture')
    (new/exe).write_bytes(b'new-fixture')
    value={'schema':'IWXA_AGENT065_REBUILT_SOURCE_UPGRADE/1','status':'PASS',
           'baseline_kind':'REBUILT_FROM_FROZEN_SOURCE','old_source':BASELINE_PIN,
           'old_tree':BASELINE_TREE,'new_source':PIN,'new_tree':TREE,
           'old_setup_sha256':gate.file_sha256(old/exe),'new_setup_sha256':gate.file_sha256(new/exe),
           'preserved_storage_roots':4,'old_native_core_draft_created':True,
           'new_native_core_draft_readback':True,'start_menu_shortcut_preserved':True,
           'upgrade_confirmed':True,'uninstall_preserved_user_data':True}
    path=root/'upgrade-witness.json'
    path.write_text(json.dumps(value),encoding='utf-8')
    assert gate.verify_upgrade_result(root,old,new,PIN,TREE)
    for key in value:
        path.write_text(json.dumps({k:v for k,v in value.items() if k!=key}),encoding='utf-8')
        assert not gate.verify_upgrade_result(root,old,new,PIN,TREE)


@pytest.mark.parametrize('phase,code,last,expected',[
    ('MODELING_GUI','GUI_TIMEOUT','MESA_HISTORY',{'SETUP_WITNESS_PHASE':'MODELING_GUI','SETUP_WITNESS_FAILURE_CODE':'GUI_TIMEOUT','SETUP_WITNESS_GUI_PHASE':'MESA_HISTORY'}),
    ('MODELING_GUI','GUI_RECEIPT_INVALID','RECEIPT',{'SETUP_WITNESS_PHASE':'MODELING_GUI','SETUP_WITNESS_FAILURE_CODE':'GUI_RECEIPT_INVALID','SETUP_WITNESS_GUI_PHASE':'RECEIPT'}),
    ('MODELING_GUI','SIMPY_RESULT','SIMPY_RESULT',{'SETUP_WITNESS_PHASE':'MODELING_GUI','SETUP_WITNESS_FAILURE_CODE':'SIMPY_RESULT','SETUP_WITNESS_GUI_PHASE':'SIMPY_RESULT'}),
    ('MODELING_GUI','untrusted diagnostic','private path',{'SETUP_WITNESS_PHASE':'MODELING_GUI'}),
    ('MODELING_GUI',None,['MESA_HISTORY'],{'SETUP_WITNESS_PHASE':'MODELING_GUI'}),
    ('MODELING_EXECUTE','MODEL_DOCUMENT_WRITE_RECEIPT','MESA_HISTORY',{'SETUP_WITNESS_PHASE':'MODELING_EXECUTE','SETUP_WITNESS_FAILURE_CODE':'MODEL_DOCUMENT_WRITE_RECEIPT','SETUP_WITNESS_OPERATION':'PUBLIC_MODELING_DOCUMENT_DRAFT'}),
])
def test_bounded_gui_and_document_diagnostics(tmp_path,phase,code,last,expected):
    target=tmp_path/'temporary-installed-fixture'/'installed-witness.json'
    target.parent.mkdir()
    target.write_text(json.dumps({'status':'FAIL','phase':phase,'failure_code':code,
                                  'last_gui_phase':last,'last_operation':'PUBLIC_MODELING_DOCUMENT_DRAFT',
                                  'secret':'must never escape'}),encoding='utf-8')
    assert gate.witness_diagnostics(tmp_path)==expected


def test_live_failure_diagnostics_are_finite(tmp_path):
    import release_gate as gate
    out=tmp_path/'temporary-installed-fixture'
    out.mkdir()
    path=out/'installed-witness.json'
    path.write_text(json.dumps({'status':'FAIL','phase':'MODELING_LIVE_EXECUTE',
        'failure_code':'MESA_LIVE_GUI_LIVE_STEP_2','last_operation':'AUTOMATION_JOBS'}))
    assert gate.witness_diagnostics(tmp_path)=={'SETUP_WITNESS_PHASE':'MODELING_LIVE_EXECUTE',
        'SETUP_WITNESS_FAILURE_CODE':'MESA_LIVE_GUI_LIVE_STEP_2','SETUP_WITNESS_OPERATION':'AUTOMATION_JOBS'}
    path.write_text(json.dumps({'status':'FAIL','phase':'MODELING_LIVE_READBACK',
        'failure_code':'untrusted private path','last_operation':'untrusted detail'}))
    assert gate.witness_diagnostics(tmp_path)=={'SETUP_WITNESS_PHASE':'MODELING_LIVE_READBACK'}


def test_model_file_connection_diagnostics_are_bounded(tmp_path):
    target=tmp_path/'temporary-installed-fixture'/'installed-witness.json'
    target.parent.mkdir()
    target.write_text(json.dumps({'status':'FAIL','phase':'MODELING_EXECUTE',
        'failure_code':'MODEL_DOCUMENT_FOLDER_READBACK','last_operation':'PROVIDER_CONNECTION_CONFIGURE',
        'folder':'private path'}),encoding='utf-8')
    assert gate.witness_diagnostics(tmp_path)=={'SETUP_WITNESS_PHASE':'MODELING_EXECUTE',
        'SETUP_WITNESS_FAILURE_CODE':'MODEL_DOCUMENT_FOLDER_READBACK',
        'SETUP_WITNESS_OPERATION':'PROVIDER_CONNECTION_CONFIGURE'}


@pytest.mark.parametrize('encoding',['utf-8','utf-8-sig','utf-16'])
def test_modeling_receipt_preflight_exact_completion(tmp_path,encoding):
    folder=tmp_path/'logs'
    folder.mkdir()
    marker=folder/'modeling-receipt-preflight.status'
    assert not gate.verify_receipt_preflight(tmp_path)
    marker.write_text('MODELING_RECEIPT_PREFLIGHT=PASS\n',encoding=encoding)
    assert gate.verify_receipt_preflight(tmp_path)
    for value in ('MODELING_RECEIPT_PREFLIGHT=FAIL','MODELING_RECEIPT_PREFLIGHT=PASS\nMODELING_RECEIPT_PREFLIGHT=PASS',
                  'private log\nMODELING_RECEIPT_PREFLIGHT=PASS'):
        marker.write_text(value+'\n',encoding=encoding)
        assert not gate.verify_receipt_preflight(tmp_path)


@pytest.mark.parametrize('phase,code,last',[
    ('MODELING_GUI','RECEIPT_WRITE','RECEIPT_WRITE'),
    ('MODELING_GUI','GUI_EXIT_FAILED','RECEIPT_COMPLETE'),
    ('MODELING_LIVE_EXECUTE','MESA_LIVE_GUI_LIVE_RECEIPT_READBACK',None)])
def test_receipt_failure_is_located_without_private_exception(tmp_path,phase,code,last):
    target=tmp_path/'temporary-installed-fixture'/'installed-witness.json'
    target.parent.mkdir()
    target.write_text(json.dumps({'status':'FAIL','phase':phase,'failure_code':code,
                                  'last_gui_phase':last,'secret':'private'}),encoding='utf-8')
    expected={'SETUP_WITNESS_PHASE':phase,'SETUP_WITNESS_FAILURE_CODE':code}
    if last:expected['SETUP_WITNESS_GUI_PHASE']=last
    assert gate.witness_diagnostics(tmp_path)==expected


def test_upgrade_failure_diagnostics_are_allowlisted():
    data='AGENT065_UPGRADE_PHASE=BUILD_IDENTITY\r\nAGENT065_UPGRADE_FAILURE_CODE=RECEIPT_UNREADABLE\r\nAGENT065_REBUILT_SOURCE_UPGRADE_FAIL\r\n'
    assert gate.upgrade_diagnostics(data)=={'UPGRADE_WITNESS_PHASE':'BUILD_IDENTITY','UPGRADE_WITNESS_FAILURE_CODE':'RECEIPT_UNREADABLE'}
    assert gate.upgrade_diagnostics(data+'AGENT065_UPGRADE_FAILURE_CODE=RECEIPT_UNREADABLE\n')=={'UPGRADE_WITNESS_PHASE':'BUILD_IDENTITY'}
    assert gate.upgrade_diagnostics('AGENT065_UPGRADE_PHASE=private path\nAGENT065_UPGRADE_FAILURE_CODE=private error')=={}
    assert gate.upgrade_diagnostics('prefix AGENT065_UPGRADE_PHASE=BUILD_IDENTITY')=={}


@pytest.mark.parametrize('upgrade_only,build_ok,expected', [
    (True,True,True),(True,False,False),(False,True,True),(False,False,False)])
def test_independent_upgrade_and_gui_group_require_distinct_evidence(tmp_path,monkeypatch,upgrade_only,build_ok,expected):
    import release_preflight
    calls=[]
    class Qualification:
        root=tmp_path
        src=tmp_path/'source'
        env={'PATH':'fixture'}
        def __init__(self):self.results={}
        def venv(self,name,requirements):return str(tmp_path/'python.exe')
        def run(self,label,command,**kwargs):
            calls.append(('build',label,command))
            return (0 if build_ok else 1,
                    'AGENT065_UPGRADE_CANDIDATE_BUILT_UNQUALIFIED' if upgrade_only else 'full installed receipt')
        def block(self,*labels):
            self.results.update(dict.fromkeys(labels,False))
        def diagnostics(self,*args):pass
    q=Qualification()
    monkeypatch.setattr(release_preflight,'committed_lock',lambda *args:True)
    monkeypatch.setattr(gate,'checkout_setup_owner',lambda q:tmp_path/'owner')
    monkeypatch.setattr(gate,'verify_receipt_preflight',lambda out:True)
    monkeypatch.setattr(gate,'verify_setup_build',lambda *args:True)
    monkeypatch.setattr(gate,'witness_diagnostics',lambda out:{})
    def gui(*args):
        calls.append(('gui',))
        return True
    def upgrade(*args):
        calls.append(('upgrade',))
        return True
    monkeypatch.setattr(gate,'verify_setup_result',gui)
    monkeypatch.setattr(gate,'upgrade_gate',upgrade)
    baseline=object() if upgrade_only else None
    assert gate.setup_gate(q,PIN,TREE,baseline,upgrade_only=upgrade_only) is expected
    assert ('-QualificationBuildOnly' in calls[0][2]) is upgrade_only
    assert (('upgrade',) in calls) is (upgrade_only and build_ok)
    assert (('gui',) in calls) is (not upgrade_only and build_ok)
    assert ('SETUP_RELEASE' in q.results) is not upgrade_only


def test_upgrade_group_requires_baseline_before_build(tmp_path):
    class Q:
        def __init__(self):self.results={}
        def block(self,*labels):self.results.update(dict.fromkeys(labels,False))
    q=Q()
    assert gate.setup_gate(q,PIN,TREE,None,upgrade_only=True) is False
    assert q.results=={'UPGRADE_064_TO_065':False}

@pytest.mark.parametrize('phase',['LIVE_OPEN_READBACK','LIVE_OPEN_REJECTED'])
def test_live_open_native_ack_diagnostics(tmp_path,phase):
    out=tmp_path/'temporary-installed-fixture';out.mkdir()
    (out/'installed-witness.json').write_text(json.dumps({
        'status':'FAIL','phase':'MODELING_LIVE_EXECUTE',
        'failure_code':'MESA_LIVE_GUI_'+phase,'last_operation':'AUTOMATION_JOBS'
    }),encoding='utf-8')
    assert gate.witness_diagnostics(tmp_path)=={
        'SETUP_WITNESS_PHASE':'MODELING_LIVE_EXECUTE',
        'SETUP_WITNESS_FAILURE_CODE':'MESA_LIVE_GUI_'+phase,
        'SETUP_WITNESS_OPERATION':'AUTOMATION_JOBS'}
