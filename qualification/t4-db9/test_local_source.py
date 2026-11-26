import hashlib
import os
import pathlib
import subprocess
import tempfile
import unittest
from unittest.mock import patch
from local_source import materialize_local_source, LocalSourceError, blob_oid


class LocalSnapshotTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = pathlib.Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.prefix = 't2/current/final-successor'
        self.subtree = self.repo / self.prefix
        self.subtree.mkdir(parents=True)
        self.git('init', '-q')
        self.git('config', 'user.email', 'fixture@example.invalid')
        self.git('config', 'user.name', 'fixture')
        (self.subtree / 'bin.dat').write_bytes(b'\x00\xff\n')
        (self.subtree / 'script.mjs').write_text('export const value = 1;\n')
        (self.repo / 'outside.txt').write_text('outside')
        self.git('add', '.')
        self.git('commit', '-qm', 'fixture')
        self.pin = self.git('rev-parse', 'HEAD').strip()
        self.tree = self.git('rev-parse', 'HEAD^{tree}').strip()
        self.output = self.root / 'snapshot'

    def git(self, *args):
        return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True)

    def export(self, **kw):
        return materialize_local_source(self.repo, self.output, pin=kw.get('pin', self.pin), tree=kw.get('tree', self.tree), prefix=kw.get('prefix', self.prefix))

    def test_exact_blobs_only(self):
        result = self.export()
        self.assertEqual(result['files'], 2)
        self.assertEqual((self.output / self.prefix / 'bin.dat').read_bytes(), b'\x00\xff\n')
        self.assertFalse((self.output / '.git').exists())
        self.assertFalse((self.output / 'outside.txt').exists())

    def test_dirty_and_new_head_do_not_change_snapshot(self):
        (self.subtree / 'script.mjs').write_text('dirty')
        self.git('add', '.')
        self.git('commit', '-qm', 'other head')
        (self.subtree / 'script.mjs').write_text('uncommitted')
        self.export()
        self.assertEqual((self.output / self.prefix / 'script.mjs').read_text(), 'export const value = 1;\n')
        self.assertEqual((self.subtree / 'script.mjs').read_text(), 'uncommitted')

    def test_wrong_tree_rejected_before_output(self):
        with self.assertRaisesRegex(LocalSourceError, 'TREE_MISMATCH'):
            self.export(tree='0'*40)
        self.assertFalse(self.output.exists())

    def test_missing_commit_rejected(self):
        with self.assertRaisesRegex(LocalSourceError, 'GIT_READ_FAILED'):
            self.export(pin='1'*40)
        self.assertFalse(self.output.exists())

    def test_existing_output_preserved(self):
        self.output.mkdir()
        marker = self.output / 'keep'
        marker.write_bytes(b'keep')
        with self.assertRaisesRegex(LocalSourceError, 'PATH_INVALID'):
            self.export()
        self.assertEqual(marker.read_bytes(), b'keep')

    def test_output_inside_checkout_rejected(self):
        self.output = self.repo / 'output'
        with self.assertRaisesRegex(LocalSourceError, 'OUTPUT_OVERLAP'):
            self.export()
        self.assertFalse(self.output.exists())

    def test_symlink_in_pinned_tree_rejected(self):
        (self.subtree / 'link').symlink_to('bin.dat')
        self.git('add', '.')
        self.git('commit', '-qm', 'symlink')
        with self.assertRaises(LocalSourceError):
            self.export(pin=self.git('rev-parse', 'HEAD').strip(), tree=self.git('rev-parse', 'HEAD^{tree}').strip())
        self.assertFalse(self.output.exists())

    def test_alias_paths_rejected(self):
        (self.subtree / 'BIN.dat').write_bytes(b'other')
        self.git('add', '.')
        self.git('commit', '-qm', 'case collision')
        with self.assertRaisesRegex(LocalSourceError, 'TREE_PATH_CONFLICT'):
            self.export(pin=self.git('rev-parse', 'HEAD').strip(), tree=self.git('rev-parse', 'HEAD^{tree}').strip())
        self.assertFalse(self.output.exists())

    def test_caller_git_environment_not_inherited(self):
        with patch.dict(os.environ, {'GIT_DIR':'/nonexistent', 'GIT_CONFIG_COUNT':'1', 'GIT_CONFIG_KEY_0':'core.bare', 'GIT_CONFIG_VALUE_0':'true'}):
            self.assertEqual(self.export()['files'], 2)

    def test_blob_hash_includes_binary_size(self):
        self.assertEqual(blob_oid(b'\x00\xff\n'), hashlib.sha1(b'blob 3\0\x00\xff\n').hexdigest())

    def test_prefix_missing_rejected(self):
        with self.assertRaisesRegex(LocalSourceError, 'SOURCE_EMPTY'):
            self.export(prefix='not-present')
        self.assertFalse(self.output.exists())

    def test_export_ignore_does_not_omit_blob(self):
        (self.repo / '.gitattributes').write_text('t2/current/final-successor/bin.dat export-ignore\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'archive attributes')
        result = self.export(pin=self.git('rev-parse', 'HEAD').strip(), tree=self.git('rev-parse', 'HEAD^{tree}').strip())
        self.assertEqual(result['files'], 2)
        self.assertEqual((self.output / self.prefix / 'bin.dat').read_bytes(), b'\x00\xff\n')


if __name__ == '__main__':
    unittest.main()
