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
