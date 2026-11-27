"""Pinned private source, independent native installation and upgrade qualification."""
import os
from pathlib import Path
import sys
import tempfile
import subprocess

from admit import CANDIDATE_PIN, CANDIDATE_TREE, BASELINE_PIN, BASELINE_TREE, GROUPS
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
                    ['tests/test_setup_core_browser_installed.py'], timeout=180)


def main():
    token = os.environ.pop('IWXA_TEMP_READ_TOKEN', '')
    pin = os.environ.get('PRIVATE_PIN', '')
    tree = os.environ.get('PRIVATE_TREE', '')
    group = os.environ.get('QUALIFICATION_GROUP', '')
    root = None
    passed = False
    try:
        if ((pin, tree) != (CANDIDATE_PIN, CANDIDATE_TREE) or group not in GROUPS
                or (os.environ.get('BASELINE_PIN'), os.environ.get('BASELINE_TREE')) != (BASELINE_PIN, BASELINE_TREE)):
            status('B066_REQUEST', 'FAIL')
            return 1
        root = Path(tempfile.mkdtemp(prefix='iwxa-agent065-agent066-', dir=os.environ['RUNNER_TEMP']))
        q = Qualification(root)
        if q.checkout(token, pin, tree):
            baseline = None
            baseline_ready = True
            if group == 'upgrade':
                old_root = root / 'baseline'
                old_root.mkdir()
                baseline = Qualification(old_root)
                baseline_ready = baseline.checkout(token, BASELINE_PIN, BASELINE_TREE, status_prefix='BASELINE_')
            token = ''
            if group == 'core':
                passed = core(q)
            elif group == 'ocr':
                passed = ocr_gate(q)
            elif group == 'desktop-source':
                passed = q.desktop(build=True)
            elif group == 'bundle':
                passed = bundle(q)
            elif group in ('desktop','upgrade'):
                if baseline_ready and browser_witness_preflight(q):
                    passed = installed_gate(q, pin, tree, baseline, BASELINE_PIN, BASELINE_TREE, upgrade=(group=='upgrade'))
                    if passed and group == 'desktop':
                        from delivery import seal_clean_install
                        passed = seal_clean_install(q, pin, tree)
                else:
                    q.block('UPGRADE_BASELINE_OR_WITNESS_PREFLIGHT')
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        status('B066_INTERNAL', 'FAIL')
    finally:
        token = ''
        if root is not None:
            clean = cleanup_private(root)
            status('PRIVATE_CLEANUP', 'PASS' if clean else 'FAIL')
            passed = passed and clean
    if group == 'desktop':
        status('INSTALLED_GUI', 'PASS' if passed else 'NOT_CONFIRMED')
    elif group == 'upgrade':
        status('INSTALLED_BROWSER', 'PASS' if passed else 'NOT_CONFIRMED')
    else:
        status('INSTALLED_GUI', 'NOT_RUN')
    status('PRODUCT_ACCEPTED', 'false')
    status('GROUP_QUALIFICATION', 'PASS' if passed else 'FAIL')
    return 0 if passed else 1

if __name__ == '__main__':
    sys.exit(main())
