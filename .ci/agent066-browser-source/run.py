"""Private source verification only. Existing public qualification harness, no installed acceptance."""
import os
from pathlib import Path
import re
import sys
import tempfile
import subprocess

from admit import CANDIDATE_PIN, CANDIDATE_TREE, GROUPS
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'agent065-modeling'))
from qualify import Qualification, cleanup_private, status

# Only fixed public result labels and existing harness diagnostics leave the runner.
def core(q):
    patterns = ('browser', 'mcp', 'tool_provider', 'workspace_composer',
                'workspace_context', 'build_explorer_package', 'package_hygiene',
                'windows_setup_bundle', 'setup_core_upgrade')
    selected = [name for name in q.files
                if re.fullmatch(r'tests/test_[a-zA-Z0-9_]+\.py', name)
                and any(pattern in name for pattern in patterns)]
    if not selected:
        q.block('B066_CORE_SELECTION')
        return False
    status('B066_CORE_MODULES', len(selected))
    py = q.venv('browser-core', ['requirements-ci.txt'])
    if py is None:
        return False
    q.run('B066_PYTHON_COMPILE', [py, '-m', 'compileall', '-q', 'runtime', 'adapters', 'tools', 'tests'], timeout=300)
    q.pytest('B066_CORE', py, selected, timeout=2400)
    return all(q.results.values())

def bundle(q):
    # Fetch and materialize through the pinned implementation, not via npm install.
    code, _ = q.run('B066_UPSTREAM_ARCHIVES',
                    [sys.executable, '-B', 'tools/stage_browser_mcp.py', '--cache', str(q.root/'archive-cache')],
                    timeout=360)
    if code:
        return False
    probe = """
from pathlib import Path
import subprocess, sys
from tools.stage_browser_mcp import materialize
from runtime import browser_mcp_bundle as pin
root = Path(sys.argv[1])
dest = root/'browser-bundle'
materialize(root/'archive-cache', dest)
node = dest/'node.exe'
entry = dest/pin.MCP_ENTRY
def run(*args):
    p = subprocess.run([str(node), *map(str,args)], check=True, capture_output=True, text=True, timeout=60, env=pin.browser_process_env())
    return p.stdout.strip()
assert run('--version') == 'v'+pin.NODE_VERSION
assert pin.MCP_VERSION in run(entry, '--version')
help_text = run(entry, '--help')
assert all(flag in help_text for flag in ('autoConnect', 'user-data-dir', 'experimentalInteropTools'))
"""
    q.run('B066_ORIGINAL_BUNDLE', [sys.executable, '-B', '-c', probe, str(q.root)], timeout=240)
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
