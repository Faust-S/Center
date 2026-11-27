#!/usr/bin/env python3
"""Run the exact existing K036/One Core qualification from authorized local Git objects.

Linux/WSL, Python 3.11, Node 22.16.0. No Actions or private source export.
The existing original qualification body is used, not an alternative Kernel.
"""
import argparse
import json
import os
from pathlib import Path
import re
import signal
import subprocess
import sys
import tempfile

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 't4-db9'))
from local_source import LocalSourceError, git, materialize_local_source

T2 = ('c28e01876f3230307b7f20449f7ef54374367c93',
      '3d774222c9aaa1521ded9eb23d2f5fcdb55b8cbd',
      't2/current/final-successor')
T3 = ('378a2e8ca6de662b5e28562e334c2a97a00ed331',
      '08d3e6e2bbb9101f2b6f26313a74c5551986705f',
      ('access-control', 'interop', 'reconciliation', 'tests', 'package.json'))
CORE = ('9a23201b7fc21c59abcf1818689bf655937baa0a',
        'f34bf5da634a8de2f598541fae5a123c297b55cd', 'packages')
T2_PARENT = '4e4ad5c5e566a74f24243b9d0744a6d64652a199'
PACKAGING = 't2/current/final-successor/kernel-successors/k036-canonical-event-merge-20261125/'
PACKAGING_PATHS = {PACKAGING + name for name in (
    'prepare_k036_candidate_archive.py', 'test_prepare_k036_candidate_archive.py')}
OWNER_TESTS = ('tests/original-native-network-vault.test.mjs',
               'tests/original-native-network-vault-port.test.mjs',
               'tests/original-native-network-transport.test.mjs',
               'tests/original-native-network-grant.test.mjs',
               'tests/original-network-bootstrap.test.mjs',
               'tests/admin-native-vault-composition.test.mjs',
               'tests/original-product-network-registry.test.mjs',
               'tests/optional-mutation-grants.test.mjs',
               'tests/original-admin-network-registry.test.mjs',
               'tests/t3-signed-workspace-exchange-owner.test.mjs',
               'tests/t3-d1-control-loopback-invalidation.test.mjs')

PEER_TESTS = ('tests/network/original-native-peer-startup.test.mjs',
              'tests/network/original-peer-history-tls.test.mjs',
              'tests/original-native-network-product-activation.test.mjs',
              'tests/original-installed-fixed-profile.test.mjs',
              'tests/original-native-host-network-owner.test.mjs',
              'tests/original-network-key-lifecycle.test.mjs',
              '../t3-core/tests/t3-d3-independent-employee-original-enrollment.test.mjs',
              '../t3-core/tests/t3-d1-original-kernel-registry.test.mjs',
              'tests/original-installed-control-factories.test.mjs',
              'tests/original-installed-control-http.test.mjs',
              '../t3-core/tests/t3-d1-original-control-http.test.mjs')


class QualificationError(Exception):
    pass


def need(ok, code):
    if not ok:
        raise QualificationError('K036_LOCAL_' + code)


def emit(key, value):
    print(key + '=' + (json.dumps(value, separators=(',', ':'))
                       if isinstance(value, dict) else str(value)), flush=True)


def check_parent(repo):
    parents = git(repo, 'rev-list', '--parents', '-n', '1', T2[0]).decode('ascii').split()
    need(parents == [T2[0], T2_PARENT], 'SOURCE_PARENT_MISMATCH')
    changed = git(repo, 'diff-tree', '--no-commit-id', '--name-only', '-r', '-z',
                  T2_PARENT, T2[0]).decode('utf-8').split('\0')
    need(set(filter(None, changed)) == PACKAGING_PATHS, 'PACKAGING_ONLY_SOURCE_DRIFT')


def source(repo, destination, spec):
    pin, tree, prefix = spec
    result = materialize_local_source(repo, destination, pin=pin, tree=tree, prefix=prefix)
    need(result['commit'] == pin and result['tree'] == tree and
         result['working_tree_used'] is False and result['private_source_exported'] is False,
         'SOURCE_EVIDENCE_INVALID')
    return result


def local_environment(top):
    # Same credential-free local build environment as the DB9 witness.
    home = top / 'home'
    home.mkdir(mode=0o700)
    for name in ('cache', 'config', 'tmp'):
        (home / name).mkdir(mode=0o700)
    env = {k: os.environ[k] for k in ('PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ') if k in os.environ}
    env.update(HOME=str(home), XDG_CACHE_HOME=str(home / 'cache'),
               XDG_CONFIG_HOME=str(home / 'config'), TMPDIR=str(home / 'tmp'),
               NPM_CONFIG_USERCONFIG=os.devnull, NPM_CONFIG_GLOBALCONFIG=os.devnull,
               NPM_CONFIG_CACHE=str(home / 'cache' / 'npm'), CI='true',
               GIT_TERMINAL_PROMPT='0', GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull,
               PYTHONDONTWRITEBYTECODE='1')
    return env


def run_checked(command, cwd, env, timeout):
    try:
        child = subprocess.Popen(command, cwd=cwd, env=env, stdout=subprocess.PIPE,
                                 stderr=subprocess.PIPE, text=True, start_new_session=True)
    except OSError as error:
        raise QualificationError('K036_LOCAL_PROCESS_UNAVAILABLE') from error
    try:
        stdout, stderr = child.communicate(timeout=timeout)
        return subprocess.CompletedProcess(command, child.returncode, stdout, stderr)
    except (subprocess.TimeoutExpired, KeyboardInterrupt):
        try:
            os.killpg(child.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        child.communicate()
        raise QualificationError('K036_LOCAL_PROCESS_UNAVAILABLE')


def owner_tests(root, env):
    result = run_checked(['node', '--test', '--test-reporter=tap', '--test-timeout=120000',
                          *OWNER_TESTS], root, env, 240)
    counts = {key: int(value) for key, value in re.findall(
        r'^# (tests|pass|fail|cancelled|skipped) (\d+)\s*$', result.stdout, re.MULTILINE)}
    emit('K036_LOCAL_NATIVE_OWNER_COUNTS', counts)
    need(result.returncode == 0 and counts.get('tests', 0) >= 50 and
         counts.get('pass') == counts['tests'] and
         all(counts.get(k) == 0 for k in ('fail', 'cancelled', 'skipped')),
         'NATIVE_OWNER_TESTS_FAILED')
    emit('K036_LOCAL_NATIVE_OWNER_SOURCE', 'PASS')


def peer_tests(root, env):
    result = run_checked(['node', '--experimental-strip-types', '--test', '--test-reporter=tap', '--test-timeout=120000',
                          *PEER_TESTS], root / 'packages/t4-network', env, 240)
    counts = {key: int(value) for key, value in re.findall(
        r'^# (tests|pass|fail|cancelled|skipped) (\d+)\s*$', result.stdout, re.MULTILINE)}
    emit('K036_LOCAL_PEER_COUNTS', counts)
    need(result.returncode == 0 and counts.get('tests', 0) >= 48 and
         counts.get('pass') == counts['tests'] and
         all(counts.get(k) == 0 for k in ('fail', 'cancelled', 'skipped')),
         'PEER_TLS_TESTS_FAILED')
    emit('K036_LOCAL_PEER_TLS', 'PASS')
    emit('K036_LOCAL_NATIVE_ACTIVATION', 'PASS')


def run_local(t2_repo, t3_repo, core_repo, *, preflight_only):
    need(sys.platform.startswith('linux') and os.environ.get('GITHUB_ACTIONS') != 'true',
         'LINUX_OR_WSL_REQUIRED')
    with tempfile.TemporaryDirectory(prefix='iwxa-t4-native-k036-local-') as tmp:
        top = Path(tmp).resolve()
        top.chmod(0o700)
        check_parent(t2_repo)
        t2, t3, core = top / 't2', top / 't3', top / 'core'
        evidence = {'schema': 'IWXA_K036_LOCAL_EXACT_INPUTS/1', 't2': source(t2_repo, t2, T2),
                    't3': source(t3_repo, t3, T3), 'core': source(core_repo, core, CORE),
                    'sourceParent': T2_PARENT, 'packagingOnly': True}
        for name in ('t2', 't3', 'core'):
            emit('K036_LOCAL_' + name.upper() + '_SOURCE', evidence[name])
        emit('K036_LOCAL_PREFLIGHT', 'PASS')
        if preflight_only:
            emit('K036_LOCAL_NATIVE_OWNER_SOURCE', 'NOT_RUN')
            emit('K036_LOCAL_PEER_TLS', 'NOT_RUN')
            emit('K036_LOCAL_NATIVE_ACTIVATION', 'NOT_RUN')
            emit('K036_LOCAL_PRODUCT_RECIPES', 'NOT_RUN')
        else:
            need(sys.version_info[:2] == (3, 11), 'PYTHON_311_REQUIRED')
            env = local_environment(top)
            version = run_checked(['node', '--version'], top, env, 15)
            need(version.returncode == 0 and version.stdout.strip() == 'v22.16.0', 'NODE_22160_REQUIRED')
            python_version = run_checked(['python', '--version'], top, env, 15)
            need(python_version.returncode == 0 and re.fullmatch(r'Python 3\.11\.\d+', python_version.stdout.strip()),
                 'PYTHON_311_REQUIRED')
            owner_tests(t3, env)
            peer_tests(core, env)
            descriptor = top / 'inputs.json'
            descriptor.write_text(json.dumps(evidence) + '\n', encoding='utf-8')
            descriptor.chmod(0o600)
            command = ['node', str(HERE / 'qualify-original-k036.mjs'), '--local-exact',
                       str(t2), str(core), str(top / 'iwxa-k036-canonical-event-merge'), str(descriptor)]
            # Only the existing witness's bounded machine-readable output.
            # Never stream raw private build/test output or local paths.
            result = run_checked(command, top, env, 1800)
            for line in result.stdout.splitlines():
                if re.fullmatch(r'K036_[A-Z0-9_]{3,120}(?:=(?:PASS|PASS_NOT_RELEASED|[A-Z0-9_]{1,120}|[0-9]{1,9}))?', line):
                    emit('K036_LOCAL_WITNESS', line)
                elif re.fullmatch(r'K036_[A-Z0-9_]+_COUNTS=\{["a-zA-Z0-9,:_]+\}', line):
                    emit('K036_LOCAL_WITNESS', line)
            need(result.returncode == 0 and
                 'K036_LOCAL_PRODUCT_RECIPES=PASS_NOT_RELEASED' in result.stdout.splitlines(),
                 'PRODUCT_RECIPES_FAILED')
            emit('K036_LOCAL_PRODUCT_RECIPES', 'PASS_NOT_RELEASED')
    emit('K036_LOCAL_PRIVATE_TEMP_CLEANUP', 'PASS')
    emit('K036_LOCAL_RELEASE_ACCEPTED', 'false')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ('t2', 't3', 'core'):
        parser.add_argument('--' + name + '-checkout', required=True)
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--preflight-only', action='store_true')
    mode.add_argument('--qualify', action='store_true')
    args = parser.parse_args(argv)
    try:
        run_local(args.t2_checkout, args.t3_checkout, args.core_checkout,
                  preflight_only=args.preflight_only)
        return 0
    except (LocalSourceError, QualificationError) as error:
        emit('K036_LOCAL_RESULT', str(error))
    except Exception:
        emit('K036_LOCAL_RESULT', 'UNCLASSIFIED_FAILURE')
    emit('K036_LOCAL_RELEASE_ACCEPTED', 'false')
    return 1


if __name__ == '__main__':
    sys.exit(main())
