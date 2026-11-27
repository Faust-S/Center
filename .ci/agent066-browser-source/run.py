"""Private source verification only. Existing public qualification harness, no installed acceptance."""
import os
from pathlib import Path
import sys
import tempfile
import subprocess

from admit import CANDIDATE_PIN, CANDIDATE_TREE, GROUPS
from bundle_evidence import summarize
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'agent065-modeling'))
from qualify import Qualification, cleanup_private, status

# Only fixed public result labels and existing harness diagnostics leave the runner.
def core(q):
    # Reuse the full Core and native-modeling regression of the accepted baseline.
    q.run('B066_PYTHON_COMPILE', [sys.executable, '-m', 'compileall', '-q', 'runtime', 'adapters', 'tools', 'tests'], timeout=300)
    return q.python() and all(q.results.values())


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


def main():
    token = os.environ.pop('IWXA_TEMP_READ_TOKEN', '')
    pin = os.environ.get('PRIVATE_PIN', '')
    tree = os.environ.get('PRIVATE_TREE', '')
    group = os.environ.get('QUALIFICATION_GROUP', '')
    root = None
    passed = False
    try:
        if (pin, tree) != (CANDIDATE_PIN, CANDIDATE_TREE) or group not in GROUPS:
            status('B066_REQUEST', 'FAIL')
            return 1
        root = Path(tempfile.mkdtemp(prefix='iwxa-agent065-agent066-', dir=os.environ['RUNNER_TEMP']))
        q = Qualification(root)
        if q.checkout(token, pin, tree):
            token = ''
            if group == 'core':
                passed = core(q)
            elif group == 'desktop-source':
                passed = q.desktop(build=True)
            elif group == 'bundle':
                passed = bundle(q)
    except (OSError, ValueError, TypeError, KeyError, subprocess.SubprocessError):
        status('B066_INTERNAL', 'FAIL')
    finally:
        token = ''
        if root is not None:
            clean = cleanup_private(root)
            status('PRIVATE_CLEANUP', 'PASS' if clean else 'FAIL')
            passed = passed and clean
    status('INSTALLED_GUI', 'NOT_RUN')
    status('PRODUCT_ACCEPTED', 'false')
    status('GROUP_QUALIFICATION', 'PASS' if passed else 'FAIL')
    return 0 if passed else 1

if __name__ == '__main__':
    sys.exit(main())
