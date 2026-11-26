"""Public request admission. No private credentials are read here."""
import json
import os
from pathlib import Path
import re
import subprocess
import sys

WORKFLOW = 'agent065-modeling'
PREFIX = 'refs/heads/ci/once/' + WORKFLOW + '/'
REQUEST = '.github/ci-requests/' + WORKFLOW + '.json'
PREPARED = '.ci/agent065-modeling/request.json'
SHA = re.compile(r'[0-9a-f]{40}\Z')


def require(ok):
    if not ok:
        raise ValueError('ADMISSION_DENIED')


def git(*args):
    return subprocess.check_output(['git', *args], stderr=subprocess.DEVNULL).decode('utf-8').strip()


def read_json(path):
    p = Path(path)
    require(p.is_file() and not p.is_symlink() and p.stat().st_size <= 8192)
    def unique(pairs):
        result = {}
        for key, val in pairs:
            require(key not in result)
            result[key] = val
        return result
    return json.loads(p.read_text(encoding='utf-8'), object_pairs_hook=unique)


def admit(env, event):
    require(env.get('GITHUB_REPOSITORY') == 'Faust-S/Center')
    require(env.get('GITHUB_EVENT_NAME') == 'push')
    require(all(event.get(k) is False for k in ('created','deleted','forced')))
    ref, head = env.get('GITHUB_REF',''), git('rev-parse','HEAD')
    require(ref.startswith(PREFIX))
    parent = ref[len(PREFIX):]
    require(SHA.fullmatch(parent) and SHA.fullmatch(head) and head == env.get('GITHUB_SHA'))
    require(event.get('ref') == ref and event.get('before') == parent and event.get('after') == head)
    require(git('rev-list','--parents','-n','1',head).split() == [head,parent])
    require(git('diff-tree','--no-commit-id','--name-status','-r',parent,head) == 'A\t' + REQUEST)
    require(git('ls-tree',head,'--',REQUEST).split(' ',1)[0] == '100644')
    expected = read_json(PREPARED)
    require(set(expected) == {'candidate','tree','scope','reason','installed_gui'})
    require(expected['candidate'] == env.get('PRIVATE_PIN') and expected['tree'] == env.get('PRIVATE_TREE'))
    require(all(SHA.fullmatch(expected[k]) for k in ('candidate','tree')))
    require(expected['scope'] == 'I14_6_GROUPED_DESKTOP_RETRY' and expected['reason'] == 'NATIVE_REGISTRY_WINDOWS_UNAVAILABLE_LOCALLY')
    require(expected['installed_gui'] == 'NOT_RUN')
    require(read_json(REQUEST) == {**expected,'workflow':WORKFLOW,'prepared_sha':parent})
    require(env.get('QUALIFICATION_GROUP') == 'desktop')
    return head


def main():
    try:
        event_path = Path(os.environ['GITHUB_EVENT_PATH'])
        require(event_path.is_file() and event_path.stat().st_size <= 2_000_000)
        event = json.loads(event_path.read_text(encoding='utf-8'))
        head = admit(os.environ, event)
    except (OSError, ValueError, KeyError, TypeError, subprocess.SubprocessError):
        print('CI_REQUEST_ADMISSION=FAIL',flush=True)
        return 1
    print('CI_REQUEST_ADMISSION=PASS',flush=True)
    print('CI_REQUEST_HEAD=' + head,flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
