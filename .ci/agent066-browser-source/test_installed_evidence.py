import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from installed_evidence import (SETUP_PIN, SETUP_REQUIRED, UPGRADE_REQUIRED, BROWSER_REQUIRED,
                                BROWSER_STATES, clean_result, upgrade_result, lock_ok,
                                CLEAN_CHECKPOINTS, ROLLBACK_CHECKPOINTS, MANUAL_GUI_STAGES,
                                clean_setup_diagnostics, diagnostic_status, preview_dom_diagnostics,
                                PREVIEW_DOM_STATES, PREVIEW_DOM_CONTROLS, navigation_http_diagnostics)

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

    def test_api_only_review_does_not_qualify_complete_gui(self):
        r=self.upgrade()
        del r['new_install_witness']['browser_action_review_gui']
        self.assertFalse(upgrade_result(r,OLD,OT,NEW,NT,OH,NH))
        r=self.upgrade()
        r['new_install_witness']['browser_action_execution_gui']=False
        self.assertFalse(upgrade_result(r,OLD,OT,NEW,NT,OH,NH))

    def test_lock_exact_and_mutation(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'lock.json'; raw=b'{"version":"0.6.6","packages":{"":{"version":"0.6.6"}}}'
            p.write_bytes(raw); blob=hashlib.sha1(b'blob '+str(len(raw)).encode()+b'\0'+raw).hexdigest()
            self.assertTrue(lock_ok(p,blob,'0.6.6'))
            self.assertFalse(lock_ok(p,blob,'0.6.5'))
            p.write_bytes(raw+b' '); self.assertFalse(lock_ok(p,blob,'0.6.6'))
            p.unlink(); self.assertFalse(lock_ok(p,blob,'0.6.6'))

class CleanDiagnosticTests(unittest.TestCase):
    def create(self, base, phase, sequence, limit=None):
        logs=base/'logs'; logs.mkdir()
        (logs/'clean-setup-phase.status').write_bytes(phase.encode('ascii'))
        root=base/('temporary-rollback-fixture' if phase.startswith('ROLLBACK') else 'temporary-installed-fixture')
        root.mkdir()
        for _,filename,status in sequence[:limit]:
            (root/filename).write_text(json.dumps({'status':status,'private_value':'never copy'}),encoding='utf-8')
        return root

    def test_first_incomplete_checkpoint_for_every_owner_stage(self):
        for phase,sequence in (('LOCAL_ACCEPTANCE',CLEAN_CHECKPOINTS),('ROLLBACK',ROLLBACK_CHECKPOINTS)):
            for index,(checkpoint,filename,_) in enumerate(sequence):
                with self.subTest(phase=phase,checkpoint=checkpoint), tempfile.TemporaryDirectory() as d:
                    out=Path(d); root=self.create(out,phase,sequence,index)
                    actual=clean_setup_diagnostics(out)
                    self.assertEqual(actual,{'SETUP_CLEAN_LAST_ATTEMPTED_PHASE':phase,
                                     'SETUP_CLEAN_UNCONFIRMED_CHECKPOINT':checkpoint,
                                     'SETUP_CLEAN_CHECKPOINT_STATE':'MISSING'})
                    (root/filename).write_text('{"status":"FAIL","reason":"private content"}')
                    self.assertEqual(clean_setup_diagnostics(out)['SETUP_CLEAN_CHECKPOINT_STATE'],'UNCONFIRMED')

    def test_full_status_chain_is_not_acceptance(self):
        for phase,sequence in (('LOCAL_ACCEPTANCE_READBACK',CLEAN_CHECKPOINTS),('ROLLBACK_READBACK',ROLLBACK_CHECKPOINTS)):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as d:
                out=Path(d); self.create(out,phase,sequence)
                self.assertEqual(clean_setup_diagnostics(out),{'SETUP_CLEAN_LAST_ATTEMPTED_PHASE':phase,
                                 'SETUP_CLEAN_UNCONFIRMED_CHECKPOINT':'OWNER_POSTCONDITIONS',
                                 'SETUP_CLEAN_CHECKPOINT_STATE':'UNCONFIRMED'})

    def test_invalid_duplicate_and_encoded_receipts(self):
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'receipt.json'
            p.write_bytes('{"status":"PASS"}'.encode('utf-16'))
            self.assertEqual(diagnostic_status(p,'PASS'),'REPORTED')
            for raw in (b'{"status":"FAIL","status":"PASS"}',b'{"status":true}',b'[]',b'\xff',b''):
                p.write_bytes(raw); self.assertEqual(diagnostic_status(p,'PASS'),'INVALID')
            p.write_bytes(b'x'*2_000_001)
            self.assertEqual(diagnostic_status(p,'PASS'),'INVALID')

    def test_unknown_phase_or_later_receipt_cannot_leak_or_skip(self):
        with tempfile.TemporaryDirectory() as d:
            out=Path(d); root=self.create(out,'LOCAL_ACCEPTANCE',CLEAN_CHECKPOINTS)
            (out/'logs'/'clean-setup-phase.status').write_bytes(b'PRIVATE_PATH')
            (root/'identity.json').unlink()
            self.assertEqual(clean_setup_diagnostics(out),{'SETUP_CLEAN_LAST_ATTEMPTED_PHASE':'UNAVAILABLE',
                             'SETUP_CLEAN_UNCONFIRMED_CHECKPOINT':'INSPECTION','SETUP_CLEAN_CHECKPOINT_STATE':'MISSING'})

    def test_final_receipt_and_all_new_manual_stages(self):
        with tempfile.TemporaryDirectory() as d:
            out=Path(d); self.create(out,'FINAL_RECEIPT',())
            self.assertEqual(clean_setup_diagnostics(out),{'SETUP_CLEAN_LAST_ATTEMPTED_PHASE':'FINAL_RECEIPT',
                             'SETUP_CLEAN_UNCONFIRMED_CHECKPOINT':'FINAL_RECEIPT','SETUP_CLEAN_CHECKPOINT_STATE':'UNCONFIRMED'})
        self.assertTrue(set('open_native_'+kind for kind in ('error','profile','create','shell','layout','state'))<=set(MANUAL_GUI_STAGES))
        self.assertTrue({'open_preview_control','open_preview_readback',
                         'open_preview_missing','open_preview_disabled','open_preview_offscreen','open_preview_ambiguous','open_preview_invalid','open_preview_bootstrap','open_preview_session','open_preview_render','open_preview_activate','open_preview_foreground','open_preview_ready'} <= set(MANUAL_GUI_STAGES))
        self.assertTrue({'open_preview_readback_expanded','open_preview_readback_collapsed','open_preview_readback_pane_offscreen','open_preview_readback_ready','open_preview_readback_disabled','open_preview_readback_unobserved'} <= set(MANUAL_GUI_STAGES))
        self.assertEqual(len(MANUAL_GUI_STAGES),len(set(MANUAL_GUI_STAGES)))

    def test_owner_repair_error_projection(self):
        for phase, sequence, checkpoint in (
            ('LOCAL_ACCEPTANCE', CLEAN_CHECKPOINTS, 'REPAIR'),
            ('ROLLBACK', ROLLBACK_CHECKPOINTS, 'ROLLBACK_REPAIR'),
        ):
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as d:
                out=Path(d); root=self.create(out,phase,sequence)
                p=root/'repair.json'
                p.write_text(json.dumps({'status':'ERROR','reason':'SETUP_UNOWNED_FILE_PRESENT',
                    'unownedCategory':'WEBVIEW2_PROFILE','path':'private-user-file'}))
                self.assertEqual(clean_setup_diagnostics(out),{
                    'SETUP_CLEAN_LAST_ATTEMPTED_PHASE':phase,
                    'SETUP_CLEAN_UNCONFIRMED_CHECKPOINT':checkpoint,
                    'SETUP_CLEAN_CHECKPOINT_STATE':'UNCONFIRMED',
                    'SETUP_CLEAN_OWNER_FAILURE_CODE':'SETUP_UNOWNED_FILE_PRESENT',
                    'SETUP_CLEAN_UNOWNED_CATEGORY':'WEBVIEW2_PROFILE'})
                for reason in ('SETUP_APP_STILL_RUNNING','SETUP_REPAIR_BLOCKED_APPLICATION_RUNNING',
                               'SETUP_OWNED_FILES_MISSING'):
                    p.write_text(json.dumps({'status':'ERROR','reason':reason,
                        'unownedCategory':'WEBVIEW2_PROFILE'}))
                    self.assertEqual(clean_setup_diagnostics(out)['SETUP_CLEAN_OWNER_FAILURE_CODE'],reason)
                    self.assertNotIn('SETUP_CLEAN_UNOWNED_CATEGORY',clean_setup_diagnostics(out))

    def test_unknown_owner_values_never_cross_boundary(self):
        with tempfile.TemporaryDirectory() as d:
            out=Path(d); root=self.create(out,'LOCAL_ACCEPTANCE',CLEAN_CHECKPOINTS)
            p=root/'repair.json'
            for reason in (None, [], {}, 42, 'SETUP_REPAIR_BLOCKED_PRIVATE_PATH', 'private exception',
                           'SETUP_UNOWNED_FILE_PRESENT\nSECRET=YES'):
                p.write_text(json.dumps({'status':'ERROR','reason':reason,'unownedCategory':'PRIVATE'}))
                self.assertEqual(clean_setup_diagnostics(out)['SETUP_CLEAN_OWNER_FAILURE_CODE'],'OTHER')
                self.assertNotIn('SETUP_CLEAN_UNOWNED_CATEGORY',clean_setup_diagnostics(out))
            for category in (None, [], {}, 'private path', 'WEBVIEW2_PROFILE\nSECRET=YES'):
                p.write_text(json.dumps({'status':'ERROR','reason':'SETUP_UNOWNED_FILE_PRESENT',
                                         'unownedCategory':category}))
                self.assertEqual(clean_setup_diagnostics(out)['SETUP_CLEAN_OWNER_FAILURE_CODE'],
                                 'SETUP_UNOWNED_FILE_PRESENT')
                self.assertNotIn('SETUP_CLEAN_UNOWNED_CATEGORY',clean_setup_diagnostics(out))
            p.write_text('{"status":"ERROR","reason":"SETUP_APP_STILL_RUNNING","reason":"private"}')
            self.assertEqual(clean_setup_diagnostics(out)['SETUP_CLEAN_CHECKPOINT_STATE'],'INVALID')
            self.assertNotIn('SETUP_CLEAN_OWNER_FAILURE_CODE',clean_setup_diagnostics(out))
            p.write_text('{"status":"FAIL","reason":"SETUP_APP_STILL_RUNNING"}')
            self.assertNotIn('SETUP_CLEAN_OWNER_FAILURE_CODE',clean_setup_diagnostics(out))
            (root/'installed-witness.json').unlink()
            p.write_text('{"status":"ERROR","reason":"SETUP_APP_STILL_RUNNING"}')
            self.assertEqual(clean_setup_diagnostics(out)['SETUP_CLEAN_UNCONFIRMED_CHECKPOINT'],'RUNTIME_WITNESS')
            self.assertNotIn('SETUP_CLEAN_OWNER_FAILURE_CODE',clean_setup_diagnostics(out))

    def test_qwen_owner_failure_projection(self):
        from installed_evidence import QWEN_FAILURE_CODES, QWEN_OPERATIONS, QWEN_CHECKPOINTS
        with tempfile.TemporaryDirectory() as d:
            out=Path(d); root=self.create(out,'LOCAL_ACCEPTANCE',CLEAN_CHECKPOINTS)
            p=root/'installed-witness.json'
            base={'status':'FAIL','phase':'QWEN_EXECUTE','private_value':'never copy'}
            expected={'SETUP_CLEAN_LAST_ATTEMPTED_PHASE':'LOCAL_ACCEPTANCE',
                      'SETUP_CLEAN_UNCONFIRMED_CHECKPOINT':'RUNTIME_WITNESS',
                      'SETUP_CLEAN_CHECKPOINT_STATE':'UNCONFIRMED'}
            for field,key,allowed in (
                ('failure_code','SETUP_WITNESS_FAILURE_CODE',QWEN_FAILURE_CODES),
                ('last_operation','SETUP_WITNESS_OPERATION',QWEN_OPERATIONS),
                ('last_checkpoint','SETUP_WITNESS_CHECKPOINT',QWEN_CHECKPOINTS),
            ):
                for value in sorted(allowed):
                    p.write_text(json.dumps({**base,field:value}))
                    self.assertEqual(clean_setup_diagnostics(out),{**expected,key:value})
                for invalid in (None,True,42,[],{},'PRIVATE_PATH','MODEL_TIMED_OUT\nSECRET=YES'):
                    p.write_text(json.dumps({**base,field:invalid}))
                    self.assertEqual(clean_setup_diagnostics(out),expected)
            p.write_text(json.dumps({**base,'failure_code':'MODEL_TIMED_OUT',
                'last_operation':'MODEL_TRY','last_checkpoint':'AGENT_REAL_QWEN_MODEL_ACTIVE_READY'}))
            self.assertEqual(clean_setup_diagnostics(out),{**expected,
                'SETUP_WITNESS_FAILURE_CODE':'MODEL_TIMED_OUT',
                'SETUP_WITNESS_OPERATION':'MODEL_TRY',
                'SETUP_WITNESS_CHECKPOINT':'AGENT_REAL_QWEN_MODEL_ACTIVE_READY'})
            (root/'identity.json').unlink()
            self.assertEqual(clean_setup_diagnostics(out)['SETUP_CLEAN_UNCONFIRMED_CHECKPOINT'],'INSPECTION')
            self.assertNotIn('SETUP_WITNESS_FAILURE_CODE',clean_setup_diagnostics(out))

    def test_qwen_projection_rejects_non_failure_wrong_phase_and_invalid_receipt(self):
        with tempfile.TemporaryDirectory() as d:
            out=Path(d); root=self.create(out,'LOCAL_ACCEPTANCE',CLEAN_CHECKPOINTS)
            p=root/'installed-witness.json'
            for value in ({'status':'PASS','phase':'QWEN_EXECUTE'},
                          {'status':'ERROR','phase':'QWEN_EXECUTE'},
                          {'status':'FAIL','phase':'MODELING_EXECUTE'},
                          {'status':'FAIL','phase':[]},
                          {'status':'FAIL','phase':'QWEN_EXECUTE\nPRIVATE'}):
                p.write_text(json.dumps({**value,'failure_code':'INFERENCE','last_operation':'MODEL_TRY',
                    'last_checkpoint':'NONE_OBSERVED'}))
                self.assertFalse(any(k.startswith('SETUP_WITNESS_') for k in clean_setup_diagnostics(out)))
            p.write_text('{"status":"FAIL","phase":"QWEN_EXECUTE","failure_code":"INFERENCE","failure_code":"HTTP_500"}')
            self.assertEqual(clean_setup_diagnostics(out)['SETUP_CLEAN_CHECKPOINT_STATE'],'INVALID')
            self.assertNotIn('SETUP_WITNESS_FAILURE_CODE',clean_setup_diagnostics(out))

    def test_preview_dom_diagnostic_is_exact_and_bounded(self):
        for state in PREVIEW_DOM_STATES:
            self.assertEqual(preview_dom_diagnostics('AGENT066_PREVIEW_DOM_STATE='+state),{'PREVIEW_DOM_STATE':state})
        for control in PREVIEW_DOM_CONTROLS:
            self.assertEqual(preview_dom_diagnostics('AGENT066_PREVIEW_DOM_BROWSER_CONTROL='+control),
                             {'PREVIEW_DOM_BROWSER_CONTROL':control})
        for bad in ('private','PANE_VISIBLE\nAGENT066_PREVIEW_DOM_STATE=PANE_VISIBLE','PANE_VISIBLE '):
            self.assertEqual(preview_dom_diagnostics('AGENT066_PREVIEW_DOM_STATE='+bad),{})
        self.assertEqual(preview_dom_diagnostics('prefix AGENT066_PREVIEW_DOM_STATE=PANE_VISIBLE'),{})

    def test_navigation_stage_and_http_projection(self):
        self.assertTrue({'navigation_address_control','navigation_address_focus','navigation_address_input','navigation_address_readback','navigation_go','navigation_initial_page','navigation_initial_address','navigation_link','navigation_link_page','navigation_link_address','navigation_back','navigation_back_page','navigation_back_address','navigation_forward','navigation_forward_page','navigation_forward_address','navigation_reload','navigation_reload_page','navigation_reload_address','navigation_return'} <= set(MANUAL_GUI_STAGES))
        for page in ('A','B'):
            for value in ('NONE','ONCE','MULTIPLE'):
                self.assertEqual(navigation_http_diagnostics('AGENT066_NAVIGATION_HTTP_'+page+'='+value),
                                 {'NAVIGATION_HTTP_'+page:value})
        for invalid in ('private','ONCE ','1','ONCE\nAGENT066_NAVIGATION_HTTP_A=ONCE'):
            self.assertEqual(navigation_http_diagnostics('AGENT066_NAVIGATION_HTTP_A='+invalid),{})
        self.assertEqual(navigation_http_diagnostics('prefix AGENT066_NAVIGATION_HTTP_A=ONCE'),{})

if __name__=='__main__': unittest.main()
