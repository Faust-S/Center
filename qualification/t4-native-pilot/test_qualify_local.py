import contextlib
import io
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import qualify_local as q
from local_source import materialize_local_source, LocalSourceError


class LocalQualificationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.name', 'fixture')
        self.git('config', 'user.email', 'fixture@example.invalid')
        (self.repo / 'interop').mkdir()
        (self.repo / 'interop' / 'a.mjs').write_text('original')
        (self.repo / 'package.json').write_text('{}')
        (self.repo / 'excluded.txt').write_text('excluded')
        self.git('add', '.')
        self.git('commit', '-qm', 'first')
        self.pin = self.git('rev-parse', 'HEAD').strip()
        self.tree = self.git('rev-parse', 'HEAD^{tree}').strip()

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True)

    def extract(self, paths):
        return materialize_local_source(self.repo, self.root / 'out', pin=self.pin,
                                        tree=self.tree, prefix=paths)

    def test_exact_multiple_paths_including_root_file(self):
        (self.repo / 'interop' / 'a.mjs').write_text('dirty')
        result = self.extract(('interop', 'package.json'))
        self.assertEqual(result['files'], 2)
        self.assertEqual((self.root / 'out/interop/a.mjs').read_text(), 'original')
        self.assertEqual((self.root / 'out/package.json').read_text(), '{}')
        self.assertFalse((self.root / 'out/excluded.txt').exists())
        self.assertFalse((self.root / 'out/.git').exists())

    def test_partial_selector_is_not_accepted(self):
        with self.assertRaisesRegex(LocalSourceError, 'SOURCE_SELECTION_INCOMPLETE'):
            self.extract(('interop', 'missing'))
        self.assertFalse((self.root / 'out').exists())

    def test_packaging_parent_exact_changed_files(self):
        (self.repo / 'package.json').write_text('{"new":true}')
        self.git('add', '.')
        self.git('commit', '-qm', 'packaging')
        head = self.git('rev-parse', 'HEAD').strip()
        with patch.object(q, 'T2', (head, self.tree, 'interop')), patch.object(q, 'T2_PARENT', self.pin):
            with patch.object(q, 'PACKAGING_PATHS', {'package.json'}):
                q.check_parent(self.repo)
            with patch.object(q, 'PACKAGING_PATHS', {'wrong'}):
                with self.assertRaisesRegex(q.QualificationError, 'PACKAGING_ONLY_SOURCE_DRIFT'):
                    q.check_parent(self.repo)

    def test_local_environment_excludes_secrets_and_ci_authority(self):
        with patch.dict(os.environ, {'GITHUB_TOKEN':'secret','SSH_AUTH_SOCK':'secret','NPM_TOKEN':'secret',
                                     'GITHUB_ACTIONS':'true','AWS_ACCESS_KEY_ID':'secret'}):
            env = q.local_environment(self.root)
        self.assertFalse(any('secret' in str(v) for v in env.values()))
        self.assertNotIn('GITHUB_ACTIONS', env)
        self.assertEqual(env['NPM_CONFIG_USERCONFIG'], os.devnull)

    def test_preflight_only_uses_exact_git_snapshots_and_cleanup(self):
        spec = (self.pin, self.tree, ('interop', 'package.json'))
        seen = []
        def capture(repo, dest, specification):
            seen.append(dest)
            return materialize_local_source(repo, dest, pin=spec[0], tree=spec[1], prefix=spec[2])
        with patch.object(q, 'check_parent'), patch.object(q, 'source', side_effect=capture), \
                patch.object(q, 'owner_tests') as owner, patch.object(q, 'run_checked') as run:
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                q.run_local(self.repo, self.repo, self.repo, preflight_only=True)
            self.assertEqual(len(seen), 3)
            self.assertTrue(all(not p.exists() for p in seen))
            owner.assert_not_called()
            run.assert_not_called()
            self.assertIn('K036_LOCAL_PRODUCT_RECIPES=NOT_RUN', out.getvalue())
            self.assertIn('K036_LOCAL_RELEASE_ACCEPTED=false', out.getvalue())

    def test_failed_source_cleans_up_preceding_snapshots(self):
        spec = (self.pin, self.tree, ('interop', 'package.json'))
        seen = []
        def capture(repo, dest, specification):
            seen.append(dest)
            if len(seen) == 2:
                raise LocalSourceError('missing')
            return materialize_local_source(repo, dest, pin=spec[0], tree=spec[1], prefix=spec[2])
        with patch.object(q, 'check_parent'), patch.object(q, 'source', side_effect=capture):
            with self.assertRaises(LocalSourceError):
                q.run_local(self.repo, self.repo, self.repo, preflight_only=True)
        self.assertTrue(all(not p.exists() for p in seen))

    def test_owner_counts_require_all_tests_without_raw_logs(self):
        valid = '# tests 11\n# pass 11\n# fail 0\n# cancelled 0\n# skipped 0\nprivate path secret\n'
        with patch.object(q, 'run_checked', return_value=subprocess.CompletedProcess([],0,valid,'secret')):
            out=io.StringIO()
            with contextlib.redirect_stdout(out):
                q.owner_tests(self.repo,{})
            self.assertNotIn('secret',out.getvalue())
        with patch.object(q, 'run_checked', return_value=subprocess.CompletedProcess([],0,valid.replace('# pass 11','# pass 10'),'')):
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(q.QualificationError,'NATIVE_OWNER_TESTS_FAILED'):
                q.owner_tests(self.repo,{})

    def test_peer_counts_require_exact_test_paths_and_no_skips(self):
        valid = '# tests 11\n# pass 11\n# fail 0\n# cancelled 0\n# skipped 0\n'
        with patch.object(q, 'run_checked', return_value=subprocess.CompletedProcess([],0,valid,'private')) as run:
            out = io.StringIO()
            with contextlib.redirect_stdout(out):
                q.peer_tests(self.repo,{})
            self.assertIn('K036_LOCAL_PEER_TLS=PASS',out.getvalue())
            self.assertNotIn('private',out.getvalue())
            self.assertEqual(run.call_args.args[0][-2:],list(q.PEER_TESTS))
            self.assertEqual(run.call_args.args[1],self.repo/'packages/t4-network')
        for report in (valid.replace('# skipped 0','# skipped 1'),valid.replace('11','10')):
            with patch.object(q,'run_checked',return_value=subprocess.CompletedProcess([],0,report,'')):
                with contextlib.redirect_stdout(io.StringIO()), self.assertRaisesRegex(q.QualificationError,'PEER_TLS_TESTS_FAILED'):
                    q.peer_tests(self.repo,{})

    def test_local_ci_mode_is_rejected(self):
        with patch.dict(os.environ, {'GITHUB_ACTIONS':'true'}):
            with self.assertRaisesRegex(q.QualificationError,'LINUX_OR_WSL_REQUIRED'):
                q.run_local(self.repo,self.repo,self.repo,preflight_only=True)

    def test_timeout_terminates_local_process_group(self):
        import sys
        with self.assertRaisesRegex(q.QualificationError,'PROCESS_UNAVAILABLE'):
            q.run_checked([sys.executable,'-c','import time; time.sleep(10)'], self.repo, os.environ.copy(), 0.1)


if __name__ == '__main__':
    unittest.main()
