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
                    'browser_action_review_gui', 'browser_action_execution_gui',
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
MANUAL_GUI_STAGES = ('window','open','open_preview','open_preview_control','open_preview_missing','open_preview_disabled','open_preview_offscreen','open_preview_ambiguous','open_preview_invalid','open_preview_bootstrap','open_preview_session','open_preview_render','open_preview_activate','open_preview_foreground','open_preview_ready','open_preview_readback','open_preview_readback_expanded','open_preview_readback_collapsed','open_preview_readback_pane_offscreen','open_preview_readback_ready','open_preview_readback_disabled','open_preview_readback_unobserved','open_control','open_native','open_native_error',
                     'open_native_profile','open_native_create','open_native_shell','open_native_layout',
                     'open_native_state','navigation','navigation_address_control','navigation_address_focus','navigation_address_input','navigation_address_readback','navigation_go','navigation_initial_page','navigation_initial_covered','navigation_initial_address','navigation_link','navigation_link_page','navigation_link_covered','navigation_link_address','navigation_back','navigation_back_page','navigation_back_covered','navigation_back_address','navigation_forward','navigation_forward_page','navigation_forward_covered','navigation_forward_address','navigation_reload','navigation_reload_page','navigation_reload_covered','navigation_reload_address','navigation_return','tab_isolation','tab_first_edit','tab_create','tab_count','tab_new_selected','tab_new_address_empty','tab_new_navigate','tab_new_value_empty','tab_second_edit','tab_select_first','tab_first_value','tab_select_second','tab_second_value','form','form_second_submit','form_second_accepted','form_select_first','form_first_value','form_first_submit','form_first_accepted','form_return','popup','popup_cancel_request','popup_cancel_proposal','popup_cancel_click','popup_cancel_gone','popup_cancel_count','popup_cancel_page','popup_accept_request','popup_accept_proposal','popup_accept_click','popup_accept_count','popup_new_selected','popup_close_first','popup_close_first_count','popup_close_second','popup_close_second_count','popup_last_close_disabled','popup_page','popup_covered','popup_address','reopen','reopen_close','reopen_absent','reopen_open','reopen_initial_tab','reopen_empty','reopen_final_close','reopen_final_absent','receipt','unknown')
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


# Project the existing owner's finite Qwen failure receipt, not its raw log.
QWEN_FAILURE_CODES = frozenset((
    'PROOF_EXISTS','DOWNLOAD_MODE','CORE_NOT_READY','PREFS_READBACK',
    'PREFS_NOT_CONFIRMED','RUNTIME_PLAN','MODEL_PLAN','MODEL_DOWNLOAD','MODEL_NOT_READY',
    'INFERENCE','TASK_SUBMIT','TASK_STOPPED','TASK_TIMEOUT','RESULT_READBACK',
    'REVIEW_READBACK','EXCHANGE_EXPORT','MODEL_PROCESS_FAILED','MODEL_FINAL_OUTPUT_UNAVAILABLE',
    'MODEL_CLI_ARGUMENT_INVALID','MODEL_CLI_INPUT_UNAVAILABLE','MODEL_LOAD_FAILED',
    'MODEL_CLI_EXIT_1','MODEL_CLI_EXIT_2','MODEL_NATIVE_MEMORY_UNAVAILABLE',
    'MODEL_NATIVE_DEPENDENCY_UNAVAILABLE','MODEL_NATIVE_INSTRUCTION_UNSUPPORTED',
    'MODEL_NATIVE_CRASH','MODEL_TIMED_OUT','MODEL_ALREADY_BUSY','MODEL_EFFORT_INVALID',
    'MODEL_START_FAILED','MODEL_TOKEN_LIMIT_INVALID','MODEL_BINARY_CHANGED','MODEL_PROMPT_INVALID',
    'OTHER_RUNTIME','OTHER_HTTP','OTHER_NETWORK','OTHER_TIMEOUT','OTHER_VALUE',
    'OTHER_KEY','OTHER_TYPE','OTHER_OS','HTTP_400','HTTP_401','HTTP_403','HTTP_404',
    'HTTP_409','HTTP_422','HTTP_429','HTTP_500','HTTP_502','HTTP_503','HTTP_504','OTHER',
))
QWEN_OPERATIONS = frozenset((
    'UI_PREFS_READ','UI_PREFS_SAVE','RUNTIME_PLAN','RUNTIME_INSTALL','MODEL_PLAN',
    'MODEL_DOWNLOAD','MODEL_SELECT','MODEL_CONTROL','PROVIDER_LIMITS','PROVIDER_SWITCH',
    'MODEL_STATUS','MODEL_TRY','WORK_AREAS','TASK_SUBMIT','TASK_POLL','TASK_READ',
    'TASKS_READ','HUMAN_REVIEW','EXCHANGE_PREVIEW','EXCHANGE_EXPORT','EXCHANGE_INSPECT','SNAPSHOT',
))
QWEN_CHECKPOINTS = frozenset(('NONE_OBSERVED', *('AGENT_REAL_QWEN_'+stage for stage in (
    'CORE_SESSION_READY','DOWNLOAD_MODE_READY','VERIFIED_RUNTIME_READY','MODEL_PLAN_READY',
    'VERIFIED_WEIGHTS_READY','MODEL_ACTIVE_READY','INFERENCE_PASS','TASK_ACCEPTED',
    'RESULT_IMPORTED','TASK_HUMAN_REVIEW_PASS','IWXA_EXPORT_INSPECT_PASS',
))))


def qwen_failure_diagnostics(row):
    if type(row) is not dict or row.get('status') != 'FAIL' or row.get('phase') != 'QWEN_EXECUTE':
        return {}
    result = {}
    for field, name, allowed in (
        ('failure_code', 'SETUP_WITNESS_FAILURE_CODE', QWEN_FAILURE_CODES),
        ('last_operation', 'SETUP_WITNESS_OPERATION', QWEN_OPERATIONS),
        ('last_checkpoint', 'SETUP_WITNESS_CHECKPOINT', QWEN_CHECKPOINTS),
    ):
        value = row.get(field)
        if type(value) is str and value in allowed:
            result[name] = value
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
            elif checkpoint == 'RUNTIME_WITNESS' and state == 'UNCONFIRMED':
                result.update(qwen_failure_diagnostics(row))
            return result
    # All expected status strings exist; the exact owner postconditions or
    # caller verification still failed. Do not assign a synthetic PASS.
    result.update(SETUP_CLEAN_UNCONFIRMED_CHECKPOINT='OWNER_POSTCONDITIONS',
                  SETUP_CLEAN_CHECKPOINT_STATE='UNCONFIRMED')
    return result


PREVIEW_DOM_STATES = frozenset(('SHELL_MISSING','CLOSED','PANE_MISSING','PANE_HIDDEN','PANE_ZERO','PANE_CLIPPED','PANE_OCCLUDED','PANE_PARTIAL','PANE_VISIBLE','UNAVAILABLE'))
PREVIEW_DOM_CONTROLS = frozenset(('CONTROL_MISSING','CONTROL_VISIBLE','CONTROL_NOT_VISIBLE','UNAVAILABLE'))


def preview_dom_diagnostics(data):
    """Return only fixed renderer observations from a failed upgrade."""
    result = {}
    for key, allowed in (('STATE',PREVIEW_DOM_STATES),('BROWSER_CONTROL',PREVIEW_DOM_CONTROLS)):
        prefix = 'AGENT066_PREVIEW_DOM_' + key + '='
        rows = [line[len(prefix):] for line in data.splitlines() if line.startswith(prefix)]
        if len(rows) == 1 and rows[0] in allowed:
            result['PREVIEW_DOM_' + key] = rows[0]
    return result

def navigation_http_diagnostics(data):
    """Only fixture request occurrence categories may leave the private runner."""
    result = {}
    for page in ('A','B','POPUP','FORM_A','FORM_B','FORM_AI','REJECTED_POST'):
        prefix = 'AGENT066_NAVIGATION_HTTP_' + page + '='
        rows = [line[len(prefix):] for line in data.splitlines() if line.startswith(prefix)]
        if len(rows) == 1 and rows[0] in ('NONE','ONCE','MULTIPLE'):
            result['NAVIGATION_HTTP_' + page] = rows[0]
    return result


GUEST_UIA_STATES = frozenset(('NOT_OBSERVED','SLOT_MISSING','SLOT_INVALID','NO_OWNED_HIT',
    'NO_MATCH','PROVIDER_UNAVAILABLE','DOCUMENT_ONLY','OFFSCREEN_OR_DISABLED','OUTSIDE_SLOT','AMBIGUOUS','FOUND'))
GUEST_HWND_STATES = frozenset(('NOT_OBSERVED','NO_OWNED_HIT','OWNED_SLOT_CHILD','OWNED_SHELL_HIT','HIT_RECT_UNAVAILABLE'))
GUEST_DOM_STATES = frozenset(('VISIBLE','HIDDEN','ZERO','MARKER_MISSING','NOT_READY','WRONG_DOCUMENT','TARGET_NOT_UNIQUE','UNAVAILABLE'))

GUEST_VALUE_STATES = frozenset(('NOT_OBSERVED','EMPTY','A','B','AI','OTHER'))
GUEST_EDIT_STATES = frozenset(('NOT_OBSERVED','FIND','PATTERN','DISPATCH','READBACK','CONFIRMED'))
GUEST_SELECTION_STATES = frozenset(('NOT_OBSERVED','MISSING','SELECTED','UNSELECTED','INDETERMINATE','UNSUPPORTED'))

GUEST_TAB_SWITCH_STATES = frozenset(('NOT_OBSERVED','FIND','PRECHECK','DISPATCH','READBACK','CONFIRMED'))
GUEST_TAB_DISPATCH_STATES = frozenset(('NOT_OBSERVED','SELECT','TOGGLE','INVOKE','PHYSICAL'))

GUEST_SCROLL_STATES = frozenset(('NOT_OBSERVED','FIND','ALREADY_VISIBLE','UNSUPPORTED','SCROLL_ITEM','READBACK','CONFIRMED'))


def guest_observations(data):
    """Only bounded observations of the installed disposable native guest."""
    result = {}
    for key, allowed in (('UIA',GUEST_UIA_STATES),('HWND',GUEST_HWND_STATES),('DOM',GUEST_DOM_STATES),
                         ('VALUE',GUEST_VALUE_STATES),('EDIT',GUEST_EDIT_STATES),('SELECTION',GUEST_SELECTION_STATES),
                         ('TAB_SWITCH',GUEST_TAB_SWITCH_STATES),('TAB_DISPATCH',GUEST_TAB_DISPATCH_STATES),('SCROLL',GUEST_SCROLL_STATES)):
        for scope in ('','SNAPSHOT_','FILES_','ACTIONS_'):
            prefix = 'AGENT066_GUEST_' + scope + key + '='
            rows = [line[len(prefix):] for line in data.splitlines() if line.startswith(prefix)]
            if len(rows) == 1 and rows[0] in allowed:
                result['GUEST_' + scope + key] = rows[0]
    return result

def browser_flow_diagnostics(data, allowed_codes):
    """Project failed diagnostic flow outcomes, never release acceptance."""
    result = {}
    lines = data.splitlines()
    for name in ('MANUAL','SNAPSHOT','FILES','ACTIONS'):
        prefix = 'AGENT066_BROWSER_FLOW_' + name
        states = [line[len(prefix)+1:] for line in lines if line.startswith(prefix+'=')]
        if len(states) != 1 or states[0] not in ('PASS','FAIL','NOT_RUN'):
            continue
        result['BROWSER_FLOW_' + name] = states[0]
        if states[0] != 'FAIL':
            continue
        failure = prefix + '_FAILURE='
        codes = [line[len(failure):] for line in lines if line.startswith(failure)]
        if len(codes) == 1 and (codes[0] in allowed_codes or codes[0] == 'OWNER_OR_ENVIRONMENT'):
            result['BROWSER_FLOW_' + name + '_FAILURE'] = codes[0]
    return result
