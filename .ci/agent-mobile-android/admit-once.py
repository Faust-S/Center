"""Public qualification admission. Does not read or use private credentials."""
import json
import os
import pathlib
import re
import subprocess
import sys

WORKFLOW = 'agent-mobile-android'
REQUEST = '.github/ci-requests/' + WORKFLOW + '.json'
PREPARED = '.ci/agent-mobile-android/request.json'
SHA = re.compile(r'[0-9a-f]{40}\Z')


def require(condition, code):
    if not condition:
        raise ValueError(code)


def git(*args):
    return subprocess.check_output(['git', *args], stderr=subprocess.DEVNULL).decode('utf-8').strip()


def read_json(path):
    require(pathlib.Path(path).is_file() and not pathlib.Path(path).is_symlink(), 'REQUEST_MISSING')
    require(pathlib.Path(path).stat().st_size <= 8192, 'REQUEST_SIZE')
    def unique(pairs):
        result = {}
        for key, value in pairs:
            require(key not in result, 'REQUEST_DUPLICATE_KEY')
            result[key] = value
        return result
    return json.loads(pathlib.Path(path).read_text(encoding='utf-8'), object_pairs_hook=unique)


def admit(event_name, event, env):
    require(env.get('GITHUB_REPOSITORY') == 'Faust-S/Center', 'REPOSITORY')
    expected = {'candidate': env.get('PRIVATE_PIN'), 'tree': env.get('PRIVATE_TREE'),
                'original_t3': env.get('T3_PIN'), 'original_t3_tree': env.get('T3_TREE')}
    require(all(isinstance(v, str) and SHA.fullmatch(v) for v in expected.values()), 'PINS')
    prepared = read_json(PREPARED)
    require(isinstance(prepared, dict) and all(prepared.get(k) == v for k, v in expected.items()), 'PREPARED_PINS')
    require(set(prepared) == set(expected) | {'scope', 'reason', 'physical'}, 'PREPARED_FIELDS')
    require(prepared['physical'] == 'NOT_RUN' and all(isinstance(prepared[k], str) and re.fullmatch(r'[A-Z0-9_]{1,200}', prepared[k]) for k in ('scope', 'reason')), 'PREPARED_PROFILE')
    head = git('rev-parse', 'HEAD')
    require(head == env.get('GITHUB_SHA') and SHA.fullmatch(head), 'HEAD')
    ref = env.get('GITHUB_REF', '')
    if event_name == 'workflow_dispatch':
        require(ref == 'refs/heads/work/2026-11-25-agent-mobile-android-qualification' and not pathlib.Path(REQUEST).exists(), 'MANUAL_REF')
        return head
    require(event_name == 'push', 'EVENT')
    require(all(event.get(k) is False for k in ('created', 'deleted', 'forced')), 'PUSH_FLAGS')
    prefix = 'refs/heads/ci/once/' + WORKFLOW + '/'
    require(ref.startswith(prefix), 'REF')
    parent = ref[len(prefix):]
    require(SHA.fullmatch(parent) and event.get('ref') == ref and event.get('before') == parent and event.get('after') == head, 'EVENT_PINS')
    require(git('rev-list', '--parents', '-n', '1', head).split() == [head, parent], 'PARENT')
    require(git('diff-tree', '--no-commit-id', '--name-status', '-r', parent, head) == 'A\t' + REQUEST, 'DIFF')
    require(git('ls-tree', head, '--', REQUEST).split(' ', 1)[0] == '100644', 'REQUEST_MODE')
    request = read_json(REQUEST)
    require(request == {**prepared, 'workflow': WORKFLOW, 'prepared_sha': parent}, 'REQUEST_PINS')
    return head


def main():
    try:
        event = json.loads(pathlib.Path(os.environ['GITHUB_EVENT_PATH']).read_text(encoding='utf-8'))
        head = admit(os.environ['GITHUB_EVENT_NAME'], event, os.environ)
        print('CI_REQUEST_ADMISSION=PASS', flush=True)
        print('CI_REQUEST_HEAD=' + head, flush=True)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError):
        print('CI_REQUEST_ADMISSION=FAIL', flush=True)
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
