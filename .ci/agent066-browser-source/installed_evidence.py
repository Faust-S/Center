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


# Diagnostic projection only. The original owner validates all semantic
# postconditions; a reported receipt status alone is never a release PASS.
CLEAN_PHASES = frozenset(('LOCAL_ACCEPTANCE','LOCAL_ACCEPTANCE_READBACK',
                          'NATIVE_RUNTIME_READBACK','ROLLBACK','ROLLBACK_READBACK','FINAL_RECEIPT'))
MANUAL_GUI_STAGES = ('window','open','open_preview','open_preview_control','open_preview_readback','open_control','open_native','open_native_error',
                     'open_native_profile','open_native_create','open_native_shell','open_native_layout',
                     'open_native_state','navigation','tab_isolation','form','popup','reopen','receipt','unknown')
CLEAN_CHECKPOINTS = (
    ('INSPECTION','identity.json','VERIFIED'),
    ('PREFLIGHT','preflight.json','READY_FOR_FIRST_INSTALL'),
    ('INSTALL','installed.json','INSTALLED_NOT_LAUNCHED'),
    ('INSTALLED_FILES','verified.json','OWNED_FILES_VERIFIED'),
    ('LOCATIONS','locations-readback.json','LOCATIONS_VERIFIED'),
    ('RUNTIME_WITNESS','installed-witness.json','PASS'),
    ('REPAIR','repair.json','REPAIRED_BACKUP_RETAINED'),
    ('REPAIR_FILES','verified-after-repair.json','OWNED_FILES_VERIFIED'),
    ('CONFIRM','confirmed.json','UPGRADE_CONFIRMED_OLD_RELEASE_REMOVED'),
    ('UNINSTALL','removed.json','UNINSTALLED_USER_DATA_PRESERVED'),
)
ROLLBACK_CHECKPOINTS = (
    ('ROLLBACK_INSPECTION','inspect.json','VERIFIED'),
    ('ROLLBACK_PREFLIGHT','preflight.json','READY_FOR_FIRST_INSTALL'),
    ('ROLLBACK_INSTALL','installed.json','INSTALLED_NOT_LAUNCHED'),
    ('ROLLBACK_INSTALLED_FILES','before.json','OWNED_FILES_VERIFIED'),
    ('ROLLBACK_REPAIR','repair.json','REPAIRED_BACKUP_RETAINED'),
    ('ROLLBACK_REPAIR_FILES','repaired.json','OWNED_FILES_VERIFIED'),
    ('ROLLBACK_RESTORE','rollback.json','ROLLBACK_RESTORED_PREVIOUS'),
    ('ROLLBACK_RESTORED_FILES','restored.json','OWNED_FILES_VERIFIED'),
    ('ROLLBACK_UNINSTALL','uninstalled.json','UNINSTALLED_USER_DATA_PRESERVED'),
    ('ROLLBACK_WITNESS','rollback-witness.json','PASS'),
)

# The owner exposes exact reason strings and a bounded unowned-file category
# in its repair/upgrade ERROR receipt. Project only published owner codes;
# arbitrary exception messages, filenames, paths and receipt data stay private.
OWNER_REPAIR_FAILURES = frozenset((
    'SETUP_APP_STILL_RUNNING', 'SETUP_CANNOT_CONFIRM_APPLICATION_CLOSED',
    'SETUP_CONFIRM_CANDIDATE_MISMATCH', 'SETUP_ENTRYPOINT_CHANGE_REQUIRES_EXPLICIT_MIGRATION',
    'SETUP_INSTALL_ALREADY_RUNNING', 'SETUP_INSTALL_AUTHORITY_MISMATCH',
    'SETUP_OWNED_FILES_INVALID', 'SETUP_OWNED_FILES_MISSING', 'SETUP_OWNED_LINK_FOUND',
    'SETUP_OWNED_ROOT_INVALID', 'SETUP_OWNED_UNINSTALLER_MISSING', 'SETUP_OWNERSHIP_MISMATCH',
    'SETUP_PREVIOUS_RELEASE_NOT_FOUND', 'SETUP_RECOVERY_AUTHORITY_MISSING',
    'SETUP_RECOVERY_BACKUP_MISSING', 'SETUP_RECOVERY_OWNERSHIP_MISMATCH',
    'SETUP_ROLLBACK_AUTHORITY_MISMATCH', 'SETUP_ROLLBACK_AUTHORITY_MISSING',
    'SETUP_ROLLBACK_CANDIDATE_MISMATCH', 'SETUP_UNOWNED_FILE_PRESENT',
    'SETUP_UPGRADE_RECOVERY_REQUIRED',
)) | frozenset('SETUP_REPAIR_BLOCKED_' + reason for reason in (
    'INSTALL_OPERATION_BUSY', 'ARCHITECTURE_UNSUPPORTED', 'REPAIR_PENDING_CONFIRMATION_NO_ROLLBACK',
    'AGENT_PREVIOUS_INSTALL_PENDING', 'UPGRADE_RECOVERY_REQUIRED', 'AGENT_INTERRUPTED_FILES_REINSTALL',
    'LEGACY_MIGRATION_HOLD', 'UNOWNED_INSTALL_ROOT', 'NO_OWNED_INSTALLATION', 'OWNERSHIP_MISMATCH',
    'WEBVIEW2_MISSING', 'SAME_VERSION_DIFFERENT_PACKAGE', 'LEGACY_MIGRATION_REVIEW_REQUIRED',
    'LEGACY_MIGRATION_PENDING_GUI_READBACK', 'LEGACY_DEFAULT_ACTIVE_NSIS_PRESERVED',
    'LEGACY_SWITCH_RECOVERY_REQUIRED', 'LEGACY_SHORTCUT_SWITCH_PENDING', 'LEGACY_SHORTCUT_RESTORE_PENDING',
    'APPLICATION_RUNNING', 'VERSION_UNSUPPORTED', 'DOWNGRADE_BLOCKED', 'UPGRADE_CANDIDATE_NOT_ACTIVATED',
))
OWNER_UNOWNED_CATEGORIES = frozenset((
    'WEBVIEW2_PROFILE','PYTHON_BYTECODE','DESKTOP_RUNTIME','PYTHON_OR_MODEL_RUNTIME',
    'APPLICATION_STATE','OTHER',
))


def diagnostic_document(path):
    try:
        if path.is_symlink() or path.parent.is_symlink():
            return 'INVALID', None
        if not path.exists():
            return 'MISSING', None
        if not path.is_file() or not 0 < path.stat().st_size <= 2_000_000:
            return 'INVALID', None
        raw = path.read_bytes()
        if len(raw) > 2_000_000:
            return 'INVALID', None
        def unique(pairs):
            result = {}
            for key, value in pairs:
                if key in result:
                    raise ValueError('duplicate field')
                result[key] = value
            return result
        value = json.loads(raw.decode('utf-16' if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig'),
                           object_pairs_hook=unique)
        if type(value) is not dict or type(value.get('status')) is not str:
            return 'INVALID', None
        return 'REPORTED', value
    except (OSError, ValueError, TypeError, UnicodeError):
        return 'INVALID', None


def diagnostic_status(path, expected):
    state, row = diagnostic_document(path)
    return 'UNCONFIRMED' if state == 'REPORTED' and row['status'] != expected else state


def owner_repair_failure(row):
    if row is None or row['status'] != 'ERROR':
        return {}
    reason = row.get('reason')
    if type(reason) is not str or reason not in OWNER_REPAIR_FAILURES:
        return {'SETUP_CLEAN_OWNER_FAILURE_CODE':'OTHER'}
    result = {'SETUP_CLEAN_OWNER_FAILURE_CODE':reason}
    if reason == 'SETUP_UNOWNED_FILE_PRESENT':
        category = row.get('unownedCategory')
        if type(category) is str and category in OWNER_UNOWNED_CATEGORIES:
            result['SETUP_CLEAN_UNOWNED_CATEGORY'] = category
    return result


def clean_setup_diagnostics(out):
    phase = 'UNAVAILABLE'
    marker = out/'logs'/'clean-setup-phase.status'
    try:
        if not marker.is_symlink() and not marker.parent.is_symlink() and 0 < marker.stat().st_size <= 64:
            raw = marker.read_bytes()
            for allowed in CLEAN_PHASES:
                if raw == allowed.encode('ascii'):
                    phase = allowed
                    break
    except OSError:
        pass
    result = {'SETUP_CLEAN_LAST_ATTEMPTED_PHASE':phase}
    if phase in ('ROLLBACK','ROLLBACK_READBACK'):
        root, checkpoints = out/'temporary-rollback-fixture', ROLLBACK_CHECKPOINTS
    elif phase in ('LOCAL_ACCEPTANCE','LOCAL_ACCEPTANCE_READBACK','NATIVE_RUNTIME_READBACK','UNAVAILABLE'):
        root, checkpoints = out/'temporary-installed-fixture', CLEAN_CHECKPOINTS
    else:
        result.update(SETUP_CLEAN_UNCONFIRMED_CHECKPOINT='FINAL_RECEIPT', SETUP_CLEAN_CHECKPOINT_STATE='UNCONFIRMED')
        return result
    for checkpoint, filename, status in checkpoints:
        state, row = diagnostic_document(root/filename)
        if state == 'REPORTED' and row['status'] != status:
            state = 'UNCONFIRMED'
        if state != 'REPORTED':
            result.update(SETUP_CLEAN_UNCONFIRMED_CHECKPOINT=checkpoint,SETUP_CLEAN_CHECKPOINT_STATE=state)
            if checkpoint in ('REPAIR','ROLLBACK_REPAIR') and state == 'UNCONFIRMED':
                result.update(owner_repair_failure(row))
            return result
    # All expected status strings exist; the exact owner postconditions or
    # caller verification still failed. Do not assign a synthetic PASS.
    result.update(SETUP_CLEAN_UNCONFIRMED_CHECKPOINT='OWNER_POSTCONDITIONS',
                  SETUP_CLEAN_CHECKPOINT_STATE='UNCONFIRMED')
    return result
