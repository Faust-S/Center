"""Test the public orchestration without running a private checkout or installer."""
from pathlib import Path
from types import SimpleNamespace
import hashlib
import json
import pytest
import release_preflight as p


@pytest.fixture
def lock(tmp_path,monkeypatch):
    raw=b'{"fixture":"test-lock"}\n'
    monkeypatch.setattr(p,'LOCK_SHA256',hashlib.sha256(raw).hexdigest())
    monkeypatch.setattr(p,'LOCK_BLOB',hashlib.sha1(('blob '+str(len(raw))+'\0').encode('ascii')+raw).hexdigest())
    monkeypatch.setattr(p,'LOCK_BYTES',len(raw))
    file=tmp_path/'source'/p.LOCK_PATH;file.parent.mkdir(parents=True);file.write_bytes(raw)
    return file,raw


def test_missing_untracked_or_changed_lock_fails(lock,capsys):
    file,raw=lock
    q=SimpleNamespace(src=file.parents[2],files=[p.LOCK_PATH],results={})
    assert p.committed_lock(q,'BEFORE')
    q.files=[]
    assert not p.committed_lock(q,'UNTRACKED')
    q.files=[p.LOCK_PATH];file.write_bytes(raw.replace(b'test',b'fake'))
    assert not p.committed_lock(q,'CHANGED')
    file.unlink();assert not p.committed_lock(q,'MISSING')
    assert 'test-lock' not in capsys.readouterr().out


def test_receipt_requires_exact_hash_count_and_status():
    good={'status':'READY','files':p.STAGE_INPUT_COUNT,'lock_sha256':p.LOCK_SHA256}
    assert p.stage_receipt(0,json.dumps(good))
    assert not p.stage_receipt(1,json.dumps(good))
    for changes in ({'files':0},{'status':'PASS'},{'lock_sha256':'0'*64},{'private_extra':'x'}):
        assert not p.stage_receipt(0,json.dumps({**good,**changes}))
    assert not p.stage_receipt(0,'invalid')


def test_desktop_requires_preflight_and_post_lock(lock,monkeypatch):
    file,raw=lock; calls=[]
    q=SimpleNamespace(src=file.parents[2],files=[p.LOCK_PATH],results={})
    monkeypatch.setattr(p,'release_preflight',lambda q:calls.append('preflight') or True)
    def build():
        calls.append('desktop');return True
    q.desktop=build
    assert p.desktop_retry(q) and calls==['preflight','desktop']
    file.write_bytes(raw.replace(b'test',b'fake'));calls.clear()
    assert not p.desktop_retry(q) and not calls
    file.write_bytes(raw);q.results.clear()
    def mutate():
        file.write_bytes(raw.replace(b'test',b'fake'));return True
    q.desktop=mutate
    assert not p.desktop_retry(q) and not q.results['COMMITTED_NATIVE_LOCK_AFTER']


def test_stage_failure_never_runs_build(lock,monkeypatch):
    file,_=lock
    q=SimpleNamespace(src=file.parents[2],files=[p.LOCK_PATH],results={})
    monkeypatch.setattr(p,'release_preflight',lambda q:False)
    q.desktop=lambda:pytest.fail('build must not run after stage failure')
    assert not p.desktop_retry(q)
