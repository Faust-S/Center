"""Execute one isolated source-level model experiment; no installer or release."""
import os
from pathlib import Path
import sys
import tempfile

from admit import CANDIDATE_PIN, CANDIDATE_TREE, SCOPE, GROUPS
from model_probe import RESULTS
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'agent065-modeling'))
from qualify import Qualification, cleanup_private, status


def main():
    token = os.environ.pop('IWXA_TEMP_READ_TOKEN', '')
    root = None
    complete = False
    try:
        if (SCOPE != 'B066_MODEL_CONTRACT_EXPERIMENT' or GROUPS != ('model',)
                or os.environ.get('QUALIFICATION_GROUP') != 'model'
                or (os.environ.get('PRIVATE_PIN'), os.environ.get('PRIVATE_TREE')) != (CANDIDATE_PIN, CANDIDATE_TREE)):
            return 1
        root = Path(tempfile.mkdtemp(prefix='agent066-model-', dir=os.environ['RUNNER_TEMP']))
        q = Qualification(root)
        if q.checkout(token, CANDIDATE_PIN, CANDIDATE_TREE):
            token = ''
            code, data = q.run('B066_MODEL_PROBE', [sys.executable, Path(__file__).with_name('model_probe.py'), q.src, root/'experiment'],
                               report=False, timeout=1800)
            allowed = {'MODEL_CATALOG=PASS', 'MODEL_REAL_QWEN=READY', 'MODEL_DIAGNOSTIC_COMPLETE=PASS', 'MODEL_DIAGNOSTIC_COMPLETE=FAIL'}
            allowed.update('MODEL_STAGE='+s for s in ('ORIGINAL_MCP_CATALOG','PINNED_MODEL','CURRENT','COMPACT'))
            allowed.update('MODEL_'+name+'='+result for name in ('CURRENT','COMPACT') for result in RESULTS)
            rows = [line for line in data.splitlines() if line in allowed]
            for line in rows:
                print(line, flush=True)
            complete = (code == 0 and rows[-1:] == ['MODEL_DIAGNOSTIC_COMPLETE=PASS']
                        and rows.count('MODEL_CATALOG=PASS') == 1 and rows.count('MODEL_REAL_QWEN=READY') == 1
                        and all(sum(line.startswith('MODEL_'+name+'=') for line in rows)==1 for name in ('CURRENT','COMPACT')))
    except Exception:
        status('MODEL_INTERNAL', 'FAIL')
    finally:
        token = ''
        if root is not None:
            clean = cleanup_private(root)
            status('PRIVATE_CLEANUP','PASS' if clean else 'FAIL')
            complete = complete and clean
    status('SOURCE_MODEL_EXPERIMENT','COMPLETE' if complete else 'FAIL')
    status('INSTALLED_BROWSER','NOT_RUN')
    status('PRODUCT_ACCEPTED','false')
    return 0 if complete else 1


if __name__ == '__main__':
    sys.exit(main())
