#!/usr/bin/env python3
"""Run the existing original DB9 qualification from a local authorized T2 clone.

Linux/WSL only. No Actions, no credential transfer, no release acceptance.
"""
import argparse
import os
import pathlib
import sys
import tempfile

import qualify
from local_source import LocalSourceError, materialize_local_source, PIN, TREE, ROOT


def local_environment(top):
    # Private source commands receive a clean home and package-manager cache,
    # not the owner's SSH agent, cloud credentials, PATs or npm user settings.
    home = top / 'home'
    home.mkdir(mode=0o700)
    for name in ('cache', 'config', 'tmp'):
        (home / name).mkdir(mode=0o700)
    env = {k: os.environ[k] for k in ('PATH', 'LANG', 'LC_ALL', 'LC_CTYPE', 'TZ') if k in os.environ}
    env.update(HOME=str(home), XDG_CACHE_HOME=str(home / 'cache'),
               XDG_CONFIG_HOME=str(home / 'config'), TMPDIR=str(home / 'tmp'),
               NPM_CONFIG_USERCONFIG=os.devnull, NPM_CONFIG_GLOBALCONFIG=os.devnull,
               NPM_CONFIG_CACHE=str(home / 'cache' / 'npm'), CI='true',
               GIT_TERMINAL_PROMPT='0', GIT_CONFIG_NOSYSTEM='1', GIT_CONFIG_GLOBAL=os.devnull)
    return env


def run_local(repo, *, preflight_only):
    qualify.need(sys.platform.startswith('linux') and os.environ.get('GITHUB_ACTIONS') != 'true',
                 'DB9_LOCAL_LINUX_OR_WSL_REQUIRED')
    qualify.need((PIN, TREE, ROOT) == (qualify.PIN, qualify.TREE, qualify.ROOT), 'DB9_LOCAL_PIN_MISMATCH')
    with tempfile.TemporaryDirectory(prefix='iwxa-t4-db9-local-') as tmp:
        top = pathlib.Path(tmp)
        top.chmod(0o700)
        checkout = top / 't2'
        evidence = materialize_local_source(repo, checkout)
        qualify.need(evidence['commit'] == PIN and evidence['tree'] == TREE and
                     evidence['working_tree_used'] is False, 'DB9_LOCAL_SOURCE_EVIDENCE_INVALID')
        qualify.emit('DB9_EXACT_SOURCE_PIN', PIN)
        qualify.emit('DB9_LOCAL_SOURCE_TREE', TREE)
        qualify.emit('DB9_LOCAL_SOURCE_FILES', evidence['files'])
        qualify.emit('DB9_LOCAL_SOURCE_BYTES', evidence['bytes'])
        qualify.emit('DB9_LOCAL_SOURCE_PREFLIGHT', 'PASS')
        if preflight_only:
            qualify.emit('DB9_FOCUSED_QUALIFICATION', 'NOT_RUN')
            qualify.emit('DB9_RELEASE_ACCEPTED', 'false')
        else:
            previous = qualify.ENV
            try:
                qualify.ENV = local_environment(top)
                # Same original materialization, lock, build, focused tests
                # and native IndexedDB witness as the Center qualification.
                qualify.qualify_exact_source(checkout, top)
            finally:
                qualify.ENV = previous
    qualify.emit('DB9_PRIVATE_TEMP_CLEANUP', 'PASS')


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--t2-checkout', required=True, help='Existing authorized local T2 Git repository')
    mode = parser.add_mutually_exclusive_group(required=True)
    mode.add_argument('--preflight-only', action='store_true', help='Verify exact original blobs only; do not build')
    mode.add_argument('--qualify', action='store_true', help='Execute the existing DB9 qualification; locked npm install may need registry access')
    args = parser.parse_args(argv)
    try:
        run_local(args.t2_checkout, preflight_only=args.preflight_only)
        return 0
    except (qualify.GateError, LocalSourceError) as error:
        qualify.emit('DB9_RESULT', str(error))
    except Exception:
        qualify.emit('DB9_RESULT', 'UNCLASSIFIED_FAILURE')
    return 1


if __name__ == '__main__':
    sys.exit(main())
