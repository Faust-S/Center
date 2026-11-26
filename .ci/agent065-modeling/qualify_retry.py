"""I14.13: addressed Core/native OCR plus the original personal Setup pipeline."""
import hashlib
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile

from retry_scope import (CORE_COUNT, CORE_RETRY, MODELING_COUNT, MODELING_RETRY,
                         BASELINE_PIN, BASELINE_TREE, select_modules,
                         read_outcomes, failed_modules, compare_failures)

CANDIDATE_PIN = '4b37ea4a7a306a861931898762f44c53be75605e'
CANDIDATE_TREE = '42f20c19dbca78cbabbfb95f40b7b5f415634317'
SCOPE = 'I14_15_NATIVE_MODELING_GUI_AND_FULL_CORE_COVERAGE'
REASON = 'WITNESS_REPAIR_T3_BOUNDARY_GUI_AND_REMAINING_CORE'
GROUPS = ('python','core-remaining','ocr','desktop')
CATALOGUE = re.compile(r'tests/(?:[A-Za-z0-9_]+/)*test_[A-Za-z0-9_]+\.py')
MODELING = re.compile(r'^tests/test_(?:modeling_.*|mesa_live_.*|mesa_ordinary_native_regression|agent065_modeling_.*)\.py$')
FINGERPRINT = "from importlib.metadata import distributions; import hashlib,json; print(hashlib.sha256(json.dumps(sorted((d.metadata['Name'].lower(),d.version) for d in distributions()),separators=(',',':')).encode()).hexdigest())"
from native_probe import STAGES, PUBLIC_MISSING, ERRORS as PROBE_ERRORS
from release_gate import split_core, ocr_gate, setup_gate


def status(key, value):
    print(key + '=' + str(value), flush=True)


def fingerprint(q, python, label):
    code, data = q.run(label, [python, '-c', FINGERPRINT], report=False, timeout=60)
    value = data.strip()
    return value if code == 0 and re.fullmatch(r'[0-9a-f]{64}', value) else None


def native_probe(q, python):
    # Execute the probe with the private checkout as cwd (same import owner as
    # pytest). The child has no private token and its raw output stays temporary.
    script = Path(__file__).with_name('native_probe.py').read_text(encoding='utf-8')
    code, data = q.run('NATIVE_VERSION_CHECK', [python, '-c', script], report=False, timeout=120)
    seen = {}
    duplicate = False
    for line in data.splitlines():
        match = re.fullmatch(r'IWXA_NATIVE_STAGE=([A-Z0-9_]+):(PASS|FAIL):([A-Za-z]+)', line)
        if match and match[1] in STAGES and (match.groups()[1:] == ('PASS','None') or
                match[2] == 'FAIL' and match[3] in (*PROBE_ERRORS, 'Other')):
            status('NATIVE_PROBE_STAGE', ':'.join(match.groups()))
            if match[1] in seen: duplicate = True
            seen[match[1]] = match[2]
        match = re.fullmatch(r'IWXA_NATIVE_MISSING=([A-Za-z0-9_.]+)', line)
        if match and match[1] in PUBLIC_MISSING:
            status('NATIVE_PROBE_MISSING_PUBLIC_MODULE', match[1])
        match = re.fullmatch(r'IWXA_NATIVE_MISSING_SHA256=([0-9a-f]{64})', line)
        if match:
            status('NATIVE_PROBE_MISSING_SHA256', match[1])
    complete = not duplicate and set(seen) == set(STAGES)
    passed = complete and code == 0 and all(v == 'PASS' for v in seen.values())
    q.results['NATIVE_VERSION_CHECK'] = passed
    q.results['NATIVE_PROBE_COMPLETE'] = complete
    status('NATIVE_PROBE_COMPLETE', 'PASS' if complete else 'FAIL')
    status('NATIVE_VERSION_CHECK', 'PASS' if passed else 'TIMEOUT' if code == -2 else 'FAIL')
    return passed


def baseline_evidence(q, factory, token, python, files, candidate, before):
    """A matched failure is evidence of recurrence, not proof of root cause."""
    if candidate is None or not any(v == 'FAIL' for v in candidate.values()):
        status('CORE_BASELINE_COMPARISON','UNAVAILABLE'); return False
    after = fingerprint(q, python, 'CORE_DEPS_AFTER')
    if before is None or after != before:
        status('CORE_BASELINE_COMPARISON','DEPENDENCIES_CHANGED'); return False
    root = q.root / 'baseline'
    root.mkdir()
    baseline = factory(root)
    if not baseline.checkout(token, BASELINE_PIN, BASELINE_TREE, status_prefix='BASELINE_'):
        status('CORE_BASELINE_COMPARISON','BASELINE_READ_FAILED'); return False
    # Same test interpreter, separate source / temp directories. Verify the
    # dependency declaration and installed distribution names/versions.
    req = 'requirements-ci.txt'
    if (baseline.src / req).read_bytes() != (q.src / req).read_bytes():
        status('CORE_BASELINE_COMPARISON','DEPENDENCY_DECLARATION_CHANGED'); return False
    selected = failed_modules(candidate, files)
    if not all(p in baseline.files for p in selected):
        status('CORE_BASELINE_COMPARISON','BASELINE_CATALOGUE_CHANGED'); return False
    status('CORE_BASELINE_SELECTED_MODULES',len(selected))
    status('CORE_BASELINE_PIN',BASELINE_PIN)
    baseline.pytest('CORE_BASELINE_RETRY', python, selected, timeout=1200)
    baseline_rows = read_outcomes(baseline.logs/'CORE_BASELINE_RETRY.xml',selected)
    if baseline.pytest_exit_codes.get('CORE_BASELINE_RETRY') not in (0,1):
        baseline_rows = None
    final = fingerprint(baseline, python, 'CORE_BASELINE_DEPS_AFTER')
    if final != before:
        status('CORE_BASELINE_COMPARISON','DEPENDENCIES_CHANGED'); return False
    counts = compare_failures(candidate, baseline_rows)
    if counts is None:
        status('CORE_BASELINE_COMPARISON','UNAVAILABLE'); return False
    for key, count in counts.items():
        status('CORE_'+key,count)
    status('CORE_BASELINE_COMPARISON','MATCHED_CASE_IDENTITIES')
    return True


def python_retry(q, factory, token):
    status('FULL_PYTHON_REGRESSION','PARTITIONED')
    status('PYTHON_RETRY_SOURCE',CANDIDATE_PIN)
    status('PYTHON_BASELINE','3.12' if sys.version_info[:2]==(3,12) else 'UNEXPECTED')
    if sys.version_info[:2] != (3,12): return False
    catalog = [p for p in q.files if CATALOGUE.fullmatch(p)]
    core = select_modules([p for p in catalog if not MODELING.fullmatch(p)],CORE_COUNT,CORE_RETRY)
    core, ocr = split_core(core)
    status('CORE_NATIVE_OCR_DELEGATED_TO_REQUIRED_GROUP', len(ocr))
    modeling = select_modules([p for p in catalog if MODELING.fullmatch(p)],MODELING_COUNT,MODELING_RETRY)
    status('CORE_RETRY_SELECTED_MODULES',len(core))
    status('MODELING_RETRY_SELECTED_MODULES',len(modeling))
    q.run('PYTHON_COMPILE',[sys.executable,'-m','compileall','-q','adapters','runtime','cells','providers','surfaces'],timeout=180)
    core_python = q.venv('coreqa',['requirements-ci.txt'])
    if core_python is None:
        q.block('CORE_RETRY'); status('CORE_BASELINE_COMPARISON','UNAVAILABLE')
    else:
        good = q.pytest('CORE_RETRY',core_python,core,timeout=1500)
        rows = read_outcomes(q.logs/'CORE_RETRY.xml',core)
        if q.pytest_exit_codes.get('CORE_RETRY') not in (0,1): rows = None
        q.results['CORE_RETRY_EVIDENCE'] = rows is not None
        status('CORE_RETRY_EVIDENCE','PASS' if rows is not None else 'UNAVAILABLE')
        if good and rows is not None:
            status('CORE_BASELINE_COMPARISON','NOT_NEEDED')
        else:
            # The exact baseline comparison already ran in 45817956729.
            # Do not reclassify present failures or waive their failed gate.
            status('CORE_BASELINE_COMPARISON','PRIOR_RUN_NOT_REPEATED')
            status('CORE_BASELINE_EVIDENCE_RUN','45817956729')
    native_python = q.venv('modelqa',['requirements-ci.txt','qualification/modeling-preparation/requirements.txt'])
    if native_python is None:
        q.block('NATIVE_VERSION_CHECK','MODELING_NATIVE_RETRY')
    else:
        native_probe(q,native_python)
        q.pytest('MODELING_NATIVE_RETRY',native_python,modeling,native=True,timeout=1200)
        evidence = (q.pytest_exit_codes.get('MODELING_NATIVE_RETRY') in (0,1) and
                    read_outcomes(q.logs/'MODELING_NATIVE_RETRY.xml',modeling) is not None)
        q.results['MODELING_RETRY_EVIDENCE'] = evidence
        status('MODELING_RETRY_EVIDENCE','PASS' if evidence else 'UNAVAILABLE')
    status('INSTALLED_GUI','NOT_RUN')
    return all(q.results.values())


def core_remaining(q):
    """Disjoint remainder: all Core modules outside the retry and real OCR."""
    if sys.version_info[:2] != (3,12):
        return False
    catalog = [p for p in q.files if CATALOGUE.fullmatch(p)]
    core = [p for p in catalog if not MODELING.fullmatch(p)]
    selected = select_modules(core, CORE_COUNT, CORE_RETRY)
    retry, ocr = split_core(selected)
    remaining = [p for p in core if p not in selected]
    if (len(remaining) != CORE_COUNT-len(CORE_RETRY) or
            set(remaining) & set(retry+ocr) or len(ocr) != 1 or
            set(remaining+retry+ocr) != set(core)):
        raise ValueError('CORE_PARTITION_INVALID')
    status('CORE_REMAINING_SELECTED_MODULES',len(remaining))
    python = q.venv('remainingqa',['requirements-ci.txt'])
    if python is None:
        q.block('CORE_REMAINING'); return False
    good = q.pytest('CORE_REMAINING',python,remaining,timeout=3300)
    rows = read_outcomes(q.logs/'CORE_REMAINING.xml',remaining)
    evidence = q.pytest_exit_codes.get('CORE_REMAINING') in (0,1) and rows is not None
    status('CORE_REMAINING_EVIDENCE','PASS' if evidence else 'UNAVAILABLE')
    return good and evidence and all(q.results.values())


def main():
    from qualify import Qualification, cleanup_private
    token = os.environ.pop('IWXA_TEMP_READ_TOKEN','')
    pin, tree = os.environ.get('PRIVATE_PIN',''), os.environ.get('PRIVATE_TREE','')
    group = os.environ.get('QUALIFICATION_GROUP','')
    root = None
    result = False
    try:
        if (pin,tree) != (CANDIDATE_PIN,CANDIDATE_TREE) or group not in GROUPS:
            status('QUALIFICATION_INTERNAL','PIN_OR_SCOPE_DENIED'); return 1
        root = Path(tempfile.mkdtemp(prefix='iwxa-agent065-',dir=os.environ['RUNNER_TEMP']))
        q = Qualification(root)
        if q.checkout(token,pin,tree):
            status('QUALIFICATION_SCOPE',SCOPE)
            if group == 'python':
                result = python_retry(q,Qualification,token)
            elif group == 'core-remaining':
                token = ''
                result = core_remaining(q)
            elif group == 'ocr':
                token = ''
                result = ocr_gate(q)
            else:
                token = ''
                result = setup_gate(q,pin,tree)
    except (OSError,ValueError,TypeError,KeyError,subprocess.SubprocessError):
        status('QUALIFICATION_INTERNAL','FAIL')
    finally:
        token = ''
        if root is not None:
            clean = cleanup_private(root)
            status('PRIVATE_CLEANUP','PASS' if clean else 'FAIL')
            result = result and clean
    status('GROUP_QUALIFICATION','PASS' if result else 'FAIL')
    return 0 if result else 1


if __name__ == '__main__':
    sys.exit(main())
