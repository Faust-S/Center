"""Finite release evidence validation; never print private receipt content."""
import hashlib
import json
import re

HEX = re.compile(r'[0-9a-f]{40}\Z')
HASH = re.compile(r'[0-9a-f]{64}\Z')
SETUP_PIN = 'c10e193846a0ea4c73cabe3744aa7db82439d54e'
SETUP_REQUIRED = ('installed_runtime_launch_accepted', 'native_gui_window_accepted',
                  'native_same_version_repair_rollback_accepted',
                  'native_clean_install_and_repair_accepted',
                  'installed_native_modeling_verified',
                  'installed_native_modeling_cold_readback_verified',
                  'installed_native_modeling_gui_verified',
                  'installed_native_modeling_live_verified')
UPGRADE_REQUIRED = ('old_native_core_draft_created', 'new_native_core_draft_readback',
                    'start_menu_shortcut_preserved', 'upgrade_confirmed',
                    'uninstall_preserved_user_data')
BROWSER_REQUIRED = ('installed_browser_bundle_verified', 'browser_manual_http_verified',
                    'browser_snapshot_t3_revocation', 'browser_snapshot_cold_readback',
                    'browser_download_one_shot', 'browser_download_collision_preserved',
                    'browser_upload_verified', 'browser_file_cold_readback',
                    'browser_action_real_model', 'browser_action_ui_submit',
                    'browser_action_fill_verified', 'browser_action_duplicate_receipt',
                    'browser_action_stale_tab_denied', 'browser_action_cold_readback')
BROWSER_STATES = {'status':'PASS','browser_gui':'MANUAL_PASS','browser_ai_snapshot':'PASS',
                  'browser_files':'PASS','browser_actions':'PASS',
                  'browser_action_review_surface':'INSTALLED_INTERACTION_SURFACE'}


def exact(row, expected, flags=()):
    return (type(row) is dict and all(type(row.get(k)) is type(v) and row[k] == v
                                     for k,v in expected.items())
            and all(row.get(k) is True for k in flags))


def hex_value(v, pattern):
    return type(v) is str and pattern.fullmatch(v) is not None


def lock_ok(path, blob, version):
    try:
        if path.is_symlink() or not path.is_file() or path.stat().st_size > 2_000_000:
            return False
        raw = path.read_bytes()
        digest = hashlib.sha1(('blob '+str(len(raw))+'\0').encode('ascii')+raw).hexdigest()
        data = json.loads(raw)
        return digest == blob and data['version'] == version and data['packages']['']['version'] == version
    except (OSError, ValueError, TypeError, KeyError):
        return False


def clean_result(row, pin, tree, setup_hash):
    return (all(hex_value(x,HEX) for x in (pin,tree)) and hex_value(setup_hash,HASH)
            and exact(row, {'status':'PRIVATE_NATIVE_WINDOW_CORE_REPAIR_UNINSTALL_PASS',
                            'version':'0.6.6','source_commit':pin,'source_tree':tree,
                            'setup_core_commit':SETUP_PIN,'setup_sha256':setup_hash,
                            'private_artifacts_uploaded_to_public':False}, SETUP_REQUIRED))


def upgrade_result(row, old_pin, old_tree, new_pin, new_tree, old_hash, new_hash):
    return (all(hex_value(x,HEX) for x in (old_pin,old_tree,new_pin,new_tree))
            and old_pin != new_pin and old_tree != new_tree and old_hash != new_hash
            and all(hex_value(x,HASH) for x in (old_hash,new_hash))
            and exact(row, {'schema':'IWXA_AGENT066_REBUILT_SOURCE_UPGRADE/1', 'status':'PASS',
                            'baseline_kind':'REBUILT_FROM_FROZEN_SOURCE',
                            'old_source':old_pin,'old_tree':old_tree,'new_source':new_pin,'new_tree':new_tree,
                            'old_setup_sha256':old_hash,'new_setup_sha256':new_hash,
                            'preserved_storage_roots':4}, UPGRADE_REQUIRED)
            and exact(row.get('new_install_witness'), BROWSER_STATES, BROWSER_REQUIRED))
