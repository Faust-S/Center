import contextlib
import io
import os
import pathlib
import tempfile
import unittest
from unittest.mock import patch

import qualify
import qualify_local as local


class LocalQualificationTests(unittest.TestCase):
    def setUp(self):
        self.paths = []
        self.old_env = qualify.ENV

    def source(self, repo, dest):
        self.paths.append(dest.parent)
        dest.mkdir()
        (dest / 'fixture').write_bytes(b'not original Kernel')
        return {'commit': local.PIN, 'tree': local.TREE, 'files': 1, 'bytes': 19, 'working_tree_used': False}

    def call(self, preflight, callback, source=None):
        out = io.StringIO()
        with patch.object(local, 'materialize_local_source', side_effect=source or self.source), \
             patch.object(qualify, 'qualify_exact_source', side_effect=callback) as shared, \
             patch.dict(os.environ, {'GITHUB_ACTIONS':'false', 'GH_TOKEN':'fixture-token', 'SSH_AUTH_SOCK':'fixture-socket', 'NPM_TOKEN':'fixture-npm'}), \
             contextlib.redirect_stdout(out):
            result = local.main(['--t2-checkout', '/fixture', '--preflight-only' if preflight else '--qualify'])
        self.assertIs(qualify.ENV, self.old_env)
        self.assertTrue(all(not path.exists() for path in self.paths))
        return result, out.getvalue(), shared.call_count

    def test_preflight_does_not_run_shared_qualification(self):
        result, out, count = self.call(True, lambda *a: self.fail('build invoked'))
        self.assertEqual((result, count), (0, 0))
        self.assertIn('DB9_FOCUSED_QUALIFICATION=NOT_RUN', out)
        self.assertIn('DB9_RELEASE_ACCEPTED=false', out)
        self.assertIn('DB9_PRIVATE_TEMP_CLEANUP=PASS', out)

    def test_full_calls_same_qualification_with_private_environment(self):
        def shared(checkout, top):
            self.assertEqual(checkout.parent, top)
            self.assertTrue((checkout / 'fixture').exists())
            self.assertTrue(pathlib.Path(qualify.ENV['HOME']).is_relative_to(top))
            for name in ('GH_TOKEN', 'SSH_AUTH_SOCK', 'NPM_TOKEN'):
                self.assertNotIn(name, qualify.ENV)
            self.assertEqual(qualify.ENV['NPM_CONFIG_USERCONFIG'], os.devnull)
            qualify.emit('DB9_FOCUSED_QUALIFICATION', 'PASS')
            qualify.emit('DB9_RELEASE_ACCEPTED', 'false')
        result, out, count = self.call(False, shared)
        self.assertEqual((result, count), (0, 1))
        self.assertIn('DB9_FOCUSED_QUALIFICATION=PASS', out)
        self.assertIn('DB9_RELEASE_ACCEPTED=false', out)
        self.assertIn('DB9_PRIVATE_TEMP_CLEANUP=PASS', out)

    def test_failure_is_not_pass_and_temp_removed(self):
        def shared(*args):
            raise qualify.GateError('DB9_TEST_FAILURE')
        result, out, count = self.call(False, shared)
        self.assertEqual((result, count), (1, 1))
        self.assertIn('DB9_RESULT=DB9_TEST_FAILURE', out)
        self.assertNotIn('DB9_FOCUSED_QUALIFICATION=PASS', out)

    def test_invalid_source_evidence_never_runs_qualifier(self):
        def wrong(repo, dest):
            return {**self.source(repo, dest), 'tree':'0'*40}
        result, out, count = self.call(False, lambda *a: self.fail('build invoked'), source=wrong)
        self.assertEqual((result, count), (1, 0))
        self.assertIn('DB9_LOCAL_SOURCE_EVIDENCE_INVALID', out)

    def test_not_a_ci_bypass(self):
        with patch.dict(os.environ, {'GITHUB_ACTIONS':'true'}), patch.object(local, 'materialize_local_source') as source:
            with self.assertRaisesRegex(qualify.GateError, 'LINUX_OR_WSL_REQUIRED'):
                local.run_local('/fixture', preflight_only=True)
            source.assert_not_called()


if __name__ == '__main__':
    unittest.main()
