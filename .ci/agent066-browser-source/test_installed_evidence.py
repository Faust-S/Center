import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from installed_evidence import (SETUP_PIN, SETUP_REQUIRED, UPGRADE_REQUIRED, BROWSER_REQUIRED,
                                BROWSER_STATES, clean_result, upgrade_result, lock_ok)

OLD, OT, NEW, NT, OH, NH = 'a'*40, 'b'*40, 'c'*40, 'd'*40, 'e'*64, 'f'*64

class EvidenceTests(unittest.TestCase):
    def clean(self):
        return {'status':'PRIVATE_NATIVE_WINDOW_CORE_REPAIR_UNINSTALL_PASS', 'version':'0.6.6',
                'source_commit':NEW, 'source_tree':NT, 'setup_core_commit':SETUP_PIN, 'setup_sha256':NH,
                'private_artifacts_uploaded_to_public':False, **dict.fromkeys(SETUP_REQUIRED,True)}

    def upgrade(self):
        return {'schema':'IWXA_AGENT066_REBUILT_SOURCE_UPGRADE/1','status':'PASS',
                'baseline_kind':'REBUILT_FROM_FROZEN_SOURCE', 'old_source':OLD,'old_tree':OT,
                'new_source':NEW,'new_tree':NT,'old_setup_sha256':OH,'new_setup_sha256':NH,
                'preserved_storage_roots':4, **dict.fromkeys(UPGRADE_REQUIRED,True),
                'new_install_witness':{**BROWSER_STATES,**dict.fromkeys(BROWSER_REQUIRED,True)}}

    def test_clean_exact(self):
        self.assertTrue(clean_result(self.clean(),NEW,NT,NH))

    def test_clean_each_flag_and_pin(self):
        for key in self.clean():
            for invalid in (None,1,'NOT_RUN'):
                with self.subTest(key=key,invalid=invalid):
                    self.assertFalse(clean_result({**self.clean(),key:invalid},NEW,NT,NH))

    def test_upgrade_exact(self):
        self.assertTrue(upgrade_result(self.upgrade(),OLD,OT,NEW,NT,OH,NH))

    def test_upgrade_each_field(self):
        for key in self.upgrade():
            for invalid in (None,1,'NOT_RUN'):
                with self.subTest(key=key,invalid=invalid):
                    self.assertFalse(upgrade_result({**self.upgrade(),key:invalid},OLD,OT,NEW,NT,OH,NH))

    def test_browser_each_field(self):
        for key in self.upgrade()['new_install_witness']:
            for invalid in (None,1,'NOT_RUN'):
                with self.subTest(key=key,invalid=invalid):
                    r=self.upgrade(); r['new_install_witness'][key]=invalid
                    self.assertFalse(upgrade_result(r,OLD,OT,NEW,NT,OH,NH))

    def test_reused_hash(self):
        self.assertFalse(upgrade_result(self.upgrade(),OLD,OT,NEW,NT,OH,OH))

    def test_no_mock_or_gui_only_claim(self):
        r=self.upgrade(); r['new_install_witness']['browser_action_review_surface']='GUI_ONLY'
        self.assertFalse(upgrade_result(r,OLD,OT,NEW,NT,OH,NH))

    def test_lock_exact_and_mutation(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'lock.json'; raw=b'{"version":"0.6.6","packages":{"":{"version":"0.6.6"}}}'
            p.write_bytes(raw); blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
            self.assertTrue(lock_ok(p,blob,'0.6.6'))
            self.assertFalse(lock_ok(p,blob,'0.6.5'))
            p.write_bytes(raw+b' '); self.assertFalse(lock_ok(p,blob,'0.6.6'))
            p.unlink(); self.assertFalse(lock_ok(p,blob,'0.6.6'))

if __name__=='__main__': unittest.main()
