"""Pinned private source, independent native installation and upgrade qualification."""
import os
from pathlib import Path
import sys
import tempfile
import subprocess

from admit import CANDIDATE_PIN, CANDIDATE_TREE, BASELINE_PIN, BASELINE_TREE, WITNESS_PIN, WITNESS_TREE, GROUPS, SCOPE
from reuse_evidence import verify_witness_checkouts
from bundle_evidence import summarize
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'agent065-modeling'))
from qualify import Qualification, cleanup_private, status
from release_gate import ocr_gate
from installed_gate import installed_gate

# Only fixed public result labels and existing harness diagnostics leave the runner.
def core(q):
    # Reuse the full Core and native-modeling regression of the accepted baseline.
    q.run('B066_PYTHON_COMPILE', [sys.executable, '-m', 'compileall', '-q', 'runtime', 'adapters', 'tools', 'tests'], timeout=300)
    return q.python(delegate_ocr=True) and all(q.results.values())


def bundle(q):
    code, _ = q.run('B066_UPSTREAM_ARCHIVES',
                    [sys.executable, '-B', 'tools/stage_browser_mcp.py', '--cache', str(q.root/'archive-cache')],
                    timeout=360)
    if code:
        return False
    code, out = q.run('B066_ORIGINAL_BUNDLE',
                      [sys.executable, '-B', 'tools/verify_browser_mcp_bundle.py',
                       '--cache', str(q.root/'archive-cache'), '--output', str(q.root/'browser-probe')],
                      timeout=300, report=False)
    ok, summary = summarize(code, out)
    for key, value in summary.items():
        status(key, value)
    q.results['B066_ORIGINAL_BUNDLE'] = ok
    status('B066_ORIGINAL_BUNDLE', 'PASS' if ok else 'FAIL')
    return all(q.results.values())


def browser_witness_preflight(q):
    if q.run('B066_PREVIEW_WITNESS_SYNTAX', ['powershell.exe', '-NoProfile', '-NonInteractive', '-Command',
        "$tokens=$null;$errors=$null;$null=[System.Management.Automation.Language.Parser]::ParseFile((Join-Path (Get-Location) 'tools/qualify_setup_core_browser_gui.ps1'),[ref]$tokens,[ref]$errors);if($errors.Count -ne 0){exit 1}"], timeout=60)[0]:
        return False
    python = q.venv('browserwitnessqa', ['requirements-ci.txt'])
    if python is None:
        q.block('B066_BROWSER_WITNESS_TEST')
        return False
    return q.pytest('B066_BROWSER_WITNESS_TEST', python,
                    ['tests/test_setup_core_browser_installed.py','tests/test_setup_core_browser_actions.py',
                     'tests/test_setup_core_browser_development.py','tests/test_browser_model_proposals.py',
                     'tests/test_browser_document_actions.py','tests/test_agent066_browser_core_integration.py'], timeout=600)


def main():
    token = os.environ.pop('IWXA_TEMP_READ_TOKEN', '')
    pin = os.environ.get('PRIVATE_PIN', '')
    tree = os.environ.get('PRIVATE_TREE', '')
    group = os.environ.get('QUALIFICATION_GROUP', '')
    root = None
    passed = False
    try:
        if ((pin, tree) != (CANDIDATE_PIN, CANDIDATE_TREE) or group != 'upgrade' or group not in GROUPS
                or (os.environ.get('BASELINE_PIN'), os.environ.get('BASELINE_TREE')) != (BASELINE_PIN, BASELINE_TREE)
                or (os.environ.get('WITNESS_PIN'), os.environ.get('WITNESS_TREE')) != (WITNESS_PIN, WITNESS_TREE)):
            status('B066_REQUEST', 'FAIL')
            return 1
        root = Path(tempfile.mkdtemp(prefix='iwxa-agent065-agent066-', dir=os.environ['RUNNER_TEMP']))
        q = Qualification(root)
        if q.checkout(token, pin, tree):
            old_root = root / 'baseline'
            old_root.mkdir()
            baseline = Qualification(old_root)
            witness_root = root / 'witness'
            witness_root.mkdir()
            witness = Qualification(witness_root)
            ready = (baseline.checkout(token, BASELINE_PIN, BASELINE_TREE, status_prefix='BASELINE_')
                     and witness.checkout(token, WITNESS_PIN, WITNESS_TREE, status_prefix='WITNESS_'))
            token = ''
            if ready:
                verify_witness_checkouts(q, witness)
                status('WITNESS_ONLY_SOURCE_DIFF', 'PASS')
                if browser_witness_preflight(witness) and all(witness.results.values()):
                    # Product and baseline builds retain their original pins.
                    # Only the independent qualification script uses witness.src.
                    verify_witness_checkouts(q, witness)
                    passed = installed_gate(q, pin, tree, baseline, BASELINE_PIN, BASELINE_TREE,
                                            upgrade=True, witness=witness)
                else:
                    q.block('UPGRADE_WITNESS_PREFLIGHT')
            else:
                q.block('UPGRADE_BASELINE_OR_WITNESS_CHECKOUT')
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        status('B066_INTERNAL', 'FAIL')
    finally:
        token = ''
        if root is not None:
            clean = cleanup_private(root)
            status('PRIVATE_CLEANUP', 'PASS' if clean else 'FAIL')
            passed = passed and clean
    status('REMAINING_NATIVE_DEVELOPMENT', 'PASS' if passed else 'FAIL')
    status('INSTALLED_BROWSER', 'NOT_RUN')
    status('PRODUCT_ACCEPTED', 'false')
    status('GROUP_QUALIFICATION', 'NOT_RUN')
    return 0 if passed else 1


if __name__ == '__main__':
    sys.exit(main())
