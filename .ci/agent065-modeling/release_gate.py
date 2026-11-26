"""Use the original OCR and Setup Core owners in a single grouped qualification."""
import hashlib
import json
import os
from pathlib import Path
import sys

OCR_MODULE = 'tests/test_agent06_pdf_ocr_direct_real_e2e.py'
OCR_PIN = '17.14.2'
SETUP_PIN = 'c10e193846a0ea4c73cabe3744aa7db82439d54e'
SETUP_TREE = 'f94c6cf728af3484716cdab3e624169d83db483f'
SETUP_STATUS = 'PRIVATE_NATIVE_WINDOW_CORE_REPAIR_UNINSTALL_PASS'
SETUP_REQUIRED = ('installed_runtime_launch_accepted', 'native_gui_window_accepted',
                  'native_same_version_repair_rollback_accepted',
                  'native_clean_install_and_repair_accepted',
                  'installed_native_modeling_verified',
                  'installed_native_modeling_cold_readback_verified',
                  'installed_native_modeling_gui_verified')


def verdict(q, label, good):
    q.results[label] = bool(good)
    print(label + '=' + ('PASS' if good else 'FAIL'), flush=True)
    return bool(good)


def split_core(selected):
    if selected.count(OCR_MODULE) != 1 or len(selected) != len(set(selected)):
        raise ValueError('CORE_OCR_SCOPE_CHANGED')
    return [p for p in selected if p != OCR_MODULE], [OCR_MODULE]


def ocr_gate(q):
    """Native OCR is mandatory, not a skip in the Windows test group."""
    from retry_scope import read_outcomes
    if not sys.platform.startswith('linux') or OCR_MODULE not in q.files:
        q.block('REAL_OCR_E2E'); return False
    if q.run('OCR_APT_INDEX', ['sudo', '-n', 'apt-get', 'update'],
             cwd=q.root, timeout=600)[0]:
        q.block('REAL_OCR_E2E'); return False
    if q.run('OCR_SYSTEM_DEPENDENCIES', ['sudo', '-n', 'apt-get', 'install', '-y',
             'ghostscript', 'tesseract-ocr'], cwd=q.root, timeout=600)[0]:
        q.block('REAL_OCR_E2E'); return False
    python = q.venv('ocrqa', ['requirements-ci.txt', 'requirements.txt'])
    if python is None or q.run('OCR_PYTHON_DEPENDENCY', [python, '-m', 'pip', 'install',
            'ocrmypdf==' + OCR_PIN], timeout=600)[0]:
        q.block('REAL_OCR_E2E'); return False
    q.env['PATH'] = str(Path(python).parent) + os.pathsep + q.env.get('PATH', '')
    for label, cmd in (('OCRMY_PDF_VERSION', ['ocrmypdf', '--version']),
                       ('GHOSTSCRIPT_VERSION', ['gs', '--version']),
                       ('TESSERACT_VERSION', ['tesseract', '--version'])):
        code, data = q.run(label, cmd, timeout=60, report=False)
        if not verdict(q, label, code == 0 and bool(data.strip()) and
                       (label != 'OCRMY_PDF_VERSION' or data.strip() == OCR_PIN)):
            q.block('REAL_OCR_E2E'); return False
    good = q.pytest('REAL_OCR_E2E', python, [OCR_MODULE], native=True, timeout=600)
    rows = read_outcomes(q.logs / 'REAL_OCR_E2E.xml', [OCR_MODULE])
    exact = rows is not None and len(rows) == 1 and set(rows.values()) == {'PASS'}
    evidence = verdict(q, 'REAL_OCR_EVIDENCE', exact)
    return good and evidence and all(q.results.values())


def file_sha256(path):
    h = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def read_json(path):
    # PowerShell 5.1 redirected receipts may be UTF-16LE with a BOM.
    raw = path.read_bytes()
    if len(raw) > 2_000_000:
        raise ValueError('SETUP_RECEIPT_OVERSIZED')
    return json.loads(raw.decode('utf-16' if raw.startswith((b'\xff\xfe', b'\xfe\xff')) else 'utf-8-sig'))


def verify_setup_build(out, pin, tree):
    setup = out / 'IWXA-Private-SetupCore-Candidate.exe'
    try:
        receipt = read_json(out / 'logs' / 'private-setup-core-build.json')
        return (setup.is_file() and receipt.get('status') == 'BUILT_UNQUALIFIED'
                and receipt.get('private_source_commit') == pin
                and receipt.get('private_source_tree') == tree
                and receipt.get('public_setup_core_commit') == SETUP_PIN
                and receipt.get('version') == '0.6.5'
                and receipt.get('setup_sha256') == file_sha256(setup))
    except (OSError, ValueError, TypeError, AttributeError):
        return False


def verify_setup_result(data, out, pin, tree):
    try:
        result = json.loads(data)
        setup = out / 'IWXA-Private-SetupCore-Candidate.exe'
        return (result.get('status') == SETUP_STATUS and result.get('version') == '0.6.5'
                and result.get('source_commit') == pin and result.get('source_tree') == tree
                and result.get('setup_core_commit') == SETUP_PIN
                and result.get('private_artifacts_uploaded_to_public') is False
                and all(result.get(name) is True for name in SETUP_REQUIRED)
                and result.get('setup_sha256') == file_sha256(setup))
    except (OSError, ValueError, TypeError, AttributeError):
        return False


# Finite public diagnostics only. Never print a private witness record,
# raw exception, source path, task identifier, or output.
MODELING_FAILURES = frozenset((
    'INTERACTION_ENVELOPE','INTERACTION_REVISION','INTERACTION_ACK','PROGRAM_HISTORY',
    'RESULT_FILES','RESULT_FILE_DIGEST','RUST4PM_MEASUREMENTS','RUST4PM_VARIANTS',
    'MESA_MEASUREMENTS','SIMPY_MEASUREMENTS','PROGRAM_UNKNOWN','RESULT_DIGEST',
    'RESULT_IDENTITY','NATIVE_OBSERVATION','RESULT_SOURCE','ARTIFACT_CATALOGUE',
    'ARTIFACT_SET','ARTIFACT_DESCRIPTOR','ARTIFACT_PAGE','ARTIFACT_OFFSET','ARTIFACT_BYTES',
    'PROCESS_DRILLDOWN','PROGRAM_DISCOVERY','PROGRAM_CONNECTION','SOLARA_DEPENDENCY_ADMISSION',
    'TASK_DRAFT','TASK_DRAFT_READBACK','EARLY_EXECUTION','EXECUTION_RECEIPT','PROOF_CATALOGUE',
    'COLD_OUTPUT_CHANGED','COLD_RECEIPT_CHANGED','WINDOWS_REQUIRED','EXTERNAL_INTERPRETER_REQUIRED',
    'INSTALLED_OWNER_REQUIRED','LOCAL_SESSION_REQUIRED','PROOF_EXISTS','PROOF_SCHEMA',
    'OWNER_OR_ENVIRONMENT','T3_MODE_READBACK','T3_MODE_RESTORE','HTTP_400','HTTP_401','HTTP_403',
    'HTTP_404','HTTP_409','HTTP_422','HTTP_429','HTTP_500','HTTP_503','HTTP_OTHER'))
GUI_FAILURES = frozenset(('PROOF','PROGRAMS','BPMN_REVIEW','DMN_REVIEW','RUST4PM_RESULT',
    'RUST4PM_INSPECTION','PROPEL_GRAPH','MESA_RESULT','SIMPY_RESULT','RECEIPT'))
MODELING_OPERATIONS = frozenset(('STATUS','UI_PREFERENCES','UI_PREFERENCES_UPDATE','PUBLIC_PROGRAMS',
    'PROVIDER_SWITCH','PUBLIC_PROGRAM_CONNECT','PUBLIC_PROGRAM_TASK_DRAFT','PUBLIC_PROGRAM_TASK_STATUS',
    'REVIEW_TASK','TOOL_PREPARE','TOOL_APPROVE','TOOL_EXECUTE','PUBLIC_PROGRAM_RESULT',
    'PUBLIC_MODELING_RESULT_ARTIFACTS','PUBLIC_MODELING_PROCESS_INSPECTION'))
WITNESS_PHASES = frozenset(('SHORTCUT_READBACK','COLD_GUI_BOOT','FIRST_CORE','CORE_QUERIES',
    'DRAFT_CREATE','GUI_DRAFT_EDIT','GUI_DRAFT_READBACK','QWEN_EXECUTE','COLD_RESTART','COLD_CORE_QUERIES',
    'GUI_DRAFT_REOPEN','QWEN_COLD_IMPORT','GUI_RESULT','GUI_TASK_SUBMIT','GUI_TASK_RESULT',
    'GUI_TASK_REVIEW','GUI_TASK_REVIEW_READBACK','GUI_COLD_RESTART','GUI_COLD_IMPORT',
    'MODELING_EXECUTE','MODELING_COLD_RESTART','MODELING_COLD_READBACK','MODELING_GUI',
    'MODELING_AFTER_GUI_READBACK','K03_TASK_EXECUTE','K03_TASK_COLD_RESTART','K03_TASK_COLD_READBACK',
    'CLEAN_STOP','WITNESS_RECEIPT'))


def witness_diagnostics(out):
    try:
        value = read_json(out / 'temporary-installed-fixture' / 'installed-witness.json')
        if type(value) is not dict or value.get('status') != 'FAIL':
            return {}
        phase = value.get('phase')
        if type(phase) is not str or phase not in WITNESS_PHASES:
            return {}
        result = {'SETUP_WITNESS_PHASE': phase}
        code = value.get('failure_code')
        operation = value.get('last_operation')
        if phase == 'MODELING_GUI' and type(code) is str and code in GUI_FAILURES:
            result['SETUP_WITNESS_FAILURE_CODE'] = code
        if phase in ('MODELING_EXECUTE','MODELING_COLD_READBACK','MODELING_AFTER_GUI_READBACK'):
            if type(code) is str and code in MODELING_FAILURES:
                result['SETUP_WITNESS_FAILURE_CODE'] = code
            if type(operation) is str and operation in MODELING_OPERATIONS:
                result['SETUP_WITNESS_OPERATION'] = operation
        return result
    except (OSError,ValueError,TypeError,AttributeError):
        return {}


def checkout_setup_owner(q):
    owner = q.root / 'setup-owner'
    owner.mkdir()
    commands = (('SETUP_OWNER_INIT', ['git', 'init', '-q']),
        ('SETUP_OWNER_FETCH', ['git', 'fetch', '--no-tags', '--depth', '1',
                              'https://github.com/Faust-S/Center.git', SETUP_PIN]),
        ('SETUP_OWNER_CHECKOUT', ['git', 'checkout', '--detach', '-q', SETUP_PIN]))
    for label, args in commands:
        if q.run(label, args, cwd=owner, timeout=300)[0]:
            return None
    for label, args, expected in (
            ('SETUP_OWNER_PIN', ['git', 'rev-parse', 'HEAD'], SETUP_PIN),
            ('SETUP_OWNER_TREE', ['git', 'rev-parse', 'HEAD^{tree}'], SETUP_TREE),
            ('SETUP_OWNER_CLEAN', ['git', 'status', '--porcelain'], '')):
        code, data = q.run(label, args, cwd=owner, report=False, timeout=60)
        if not verdict(q, label, code == 0 and data.strip() == expected):
            return None
    return owner


def setup_gate(q, pin, tree):
    """Build and install through the existing private Setup Core pipeline."""
    from release_preflight import committed_lock
    if not committed_lock(q, 'COMMITTED_NATIVE_LOCK_BEFORE'):
        return False
    owner = checkout_setup_owner(q)
    if owner is None:
        q.block('SETUP_RELEASE'); return False
    native_python = q.venv('installedmodelqa', ['qualification/modeling-preparation/requirements.txt'])
    if native_python is None:
        q.block('SETUP_RELEASE'); return False
    out = q.root / 'setup-output'
    env = dict(q.env)
    env['PATH'] = str(Path(native_python).parent) + os.pathsep + env.get('PATH', '')
    env['IWXA_AGENT065_MODELING_PYTHON'] = str(native_python)
    env['IWXA_AGENT06_QUALIFICATION_SCOPE'] = 'PERSONAL_RELEASE'
    env.pop('CARGO_TARGET_DIR', None)
    command = ['powershell.exe', '-NoLogo', '-NoProfile', '-NonInteractive',
        '-ExecutionPolicy', 'Bypass', '-File', q.src / 'tools/build_setup_core_windows_candidate.ps1',
        '-CenterRoot', owner, '-CenterCommit', SETUP_PIN,
        '-ReleaseCacheRoot', q.root / 'release-cache', '-OutputRoot', out]
    code, data = q.run('SETUP_RELEASE', command, env=env, report=False, timeout=7200)
    built = verdict(q, 'SETUP_BUILT', verify_setup_build(out, pin, tree))
    accepted = verdict(q, 'SETUP_RELEASE', code == 0 and built and verify_setup_result(data, out, pin, tree))
    if not accepted:
        q.diagnostics('SETUP_RELEASE', data)
        for name,value in witness_diagnostics(out).items():
            print(name + '=' + value, flush=True)
        # Allowlisted stage markers only; never print source, output or paths.
        for marker in ('native_candidate_desktop_source_stage_failed',
                       'native_candidate_desktop_source_stage_identity_invalid',
                       'native_candidate_modeling_stage_failed',
                       'native_candidate_modeling_dependencies_failed',
                       'native_candidate_tauri_build_failed',
                       'native_candidate_package_build_failed',
                       'private_setup_native_product_package_build_failed',
                       'private_setup_core_package_build_failed',
                       'private_setup_core_local_acceptance_failed',
                       'private_setup_core_installed_runtime_not_verified',
                       'private_setup_core_installed_modeling_not_verified',
                       'private_setup_witness_source_missing',
                       'private_setup_witness_powershell_parse_failed',
                       'agent_setup_witness_modeling_gui_failed',
                       'agent_setup_witness_modeling_after_gui_readback_failed',
                       'agent_setup_witness_modeling_execute_failed',
                       'agent_setup_witness_modeling_cold_restart_failed',
                       'agent_setup_witness_modeling_cold_readback_failed',
                       'private_setup_core_rollback_failed'):
            if marker in data:
                print('SETUP_FAILURE_CODE=' + marker.upper(), flush=True)
    print('INSTALLED_GUI=' + ('PASS' if accepted else 'NOT_CONFIRMED'), flush=True)
    print('MODELING_INSTALLED_CORE=' + ('PASS' if accepted else 'NOT_CONFIRMED'), flush=True)
    print('MODELING_INSTALLED_GUI=' + ('PASS' if accepted else 'NOT_CONFIRMED'), flush=True)
    print('UPGRADE_064_TO_065=NOT_RUN', flush=True)
    unchanged = committed_lock(q, 'COMMITTED_NATIVE_LOCK_AFTER')
    return accepted and unchanged and all(q.results.values())
