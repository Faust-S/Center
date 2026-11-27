import hashlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from PIL import Image
import qualify as q


class Response(io.BytesIO):
    def __init__(self, data, url='https://example.invalid/model'):
        super().__init__(data)
        self.url = url

    def geturl(self):
        return self.url


class QualificationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.model = self.root / 'model.gguf'
        self.data = b'GGUF' + bytes(range(64))

    def get(self, data=None, *, url='https://example.invalid/model', size=None, sha=None):
        data = self.data if data is None else data
        with patch.object(q.urllib.request, 'urlopen', return_value=Response(data, url)):
            q.download_model(self.model, url='https://example.invalid/model',
                             size=len(self.data) if size is None else size,
                             digest=hashlib.sha256(self.data).hexdigest() if sha is None else sha)

    def test_exact_model(self):
        self.get()
        self.assertEqual(self.model.read_bytes(), self.data)
        self.assertFalse(self.model.with_suffix('.gguf.part').exists())

    def reject(self, reason, **kwargs):
        with self.assertRaisesRegex(ValueError, reason):
            self.get(**kwargs)
        self.assertFalse(self.model.exists())
        self.assertFalse(self.model.with_suffix('.gguf.part').exists())

    def test_oversize(self):
        self.reject('MODEL_SIZE', data=self.data + b'x')

    def test_short(self):
        self.reject('MODEL_IDENTITY', data=self.data[:-1])

    def test_wrong_hash(self):
        self.reject('MODEL_IDENTITY', data=self.data[:-1] + b'x')

    def test_wrong_magic(self):
        data = b'TEST' + self.data[4:]
        self.reject('MODEL_FORMAT', data=data, sha=hashlib.sha256(data).hexdigest())

    def test_insecure_redirect(self):
        self.reject('MODEL_PROTOCOL', url='http://example.invalid/model')

    def test_existing_output_is_retained(self):
        self.model.write_bytes(b'prior')
        with self.assertRaisesRegex(ValueError, 'MODEL_DEST_EXISTS'):
            self.get()
        self.assertEqual(self.model.read_bytes(), b'prior')

    def test_existing_partial_is_retained(self):
        part = self.model.with_suffix('.gguf.part')
        part.write_bytes(b'prior')
        with self.assertRaisesRegex(ValueError, 'MODEL_DEST_EXISTS'):
            self.get()
        self.assertEqual(part.read_bytes(), b'prior')

    def image(self, size=(512, 512), varied=True, mode='RGB', fmt='PNG'):
        path = self.root / 'image.png'
        image = Image.new(mode, size, 0)
        if varied:
            image.paste('white', (0, 0, size[0] // 2, size[1]))
        image.save(path, format=fmt)
        return path

    def test_png_receipt(self):
        path = self.image()
        r = q.inspect_png(path)
        self.assertEqual(r['width'], 512)
        self.assertEqual(r['sha256'], hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertGreater(r['maxChannelStddev'], 5)
        self.assertEqual(len(r['pixelSha256']), 64)

    def test_blank_png(self):
        with self.assertRaisesRegex(ValueError, 'IMAGE_EMPTY'):
            q.inspect_png(self.image(varied=False))

    def test_wrong_size(self):
        with self.assertRaisesRegex(ValueError, 'IMAGE_FORMAT'):
            q.inspect_png(self.image(size=(256, 512)))

    def test_wrong_format(self):
        with self.assertRaisesRegex(ValueError, 'IMAGE_FORMAT'):
            q.inspect_png(self.image(fmt='JPEG'))

    def test_truncated_png(self):
        path = self.image()
        path.write_bytes(path.read_bytes()[:60])
        with self.assertRaises((OSError, SyntaxError, ValueError)):
            q.inspect_png(path)

    def test_host_and_android_receipts_are_independent(self):
        host = self.root / 'host'
        android = self.root / 'android'
        fake_exe = self.root / 'fake-executable'
        fake_exe.write_bytes(b'executable fixture')
        images = [{"pixelSha256": "a" * 64}, {"pixelSha256": "b" * 64}]
        with patch.object(q, 'checkout'), patch.object(q, 'build', return_value=fake_exe) as build, \
                patch.object(q, 'download_model') as download, patch.object(q, 'generate', side_effect=images), \
                patch.object(q, 'verify_source'), patch.object(q, 'ndk_identity', return_value={'Pkg.Revision': q.NDK_REVISION}), \
                patch.object(q, 'run', side_effect=['Machine: AArch64', '']):
            q.qualify(host, 'host')
            self.assertEqual(len(build.call_args.args), 2)
            self.assertEqual(download.call_count, 1)
            q.qualify(android, 'android', self.root / 'ndk')
            self.assertEqual(download.call_count, 1)
        import json
        h = json.loads((host / 'receipt.json').read_text())
        a = json.loads((android / 'receipt.json').read_text())
        self.assertEqual(h['hostCpuGeneration'], 'PASS')
        self.assertNotIn('androidBuild', h)
        self.assertEqual(a['androidBuild'], 'PASS')
        self.assertEqual(a['abi'], 'arm64-v8a')
        self.assertEqual(a['ndkRevision'], q.NDK_REVISION)
        self.assertNotIn('hostCpuGeneration', a)
        self.assertEqual(a['androidExecution'], 'NOT_RUN')

    def test_android_requires_ndk_before_creating_result(self):
        target = self.root / 'unavailable'
        with self.assertRaisesRegex(ValueError, 'NDK_REQUIRED'):
            q.qualify(target, 'android')
        self.assertFalse(target.exists())


    def ndk(self, properties):
        root = self.root / 'ndk'
        tool = root / 'build/cmake/android.toolchain.cmake'
        tool.parent.mkdir(parents=True, exist_ok=True)
        tool.write_text('fixture only')
        (root / 'source.properties').write_text(properties)
        return root

    def test_exact_beta_ndk_metadata(self):
        root = self.ndk('Pkg.Desc = Android NDK\nPkg.Revision = 29.0.13113456-beta1\n'
                        'Pkg.BaseRevision = 29.0.13113456\nPkg.ReleaseName = r29-beta1\n')
        self.assertEqual(q.ndk_identity(root)['Pkg.Revision'], '29.0.13113456-beta1')

    def test_ndk_base_number_does_not_replace_full_preview_identity(self):
        root = self.ndk('Pkg.Revision = 29.0.13113456\nPkg.BaseRevision = 29.0.13113456\nPkg.ReleaseName = r29-beta1\n')
        with self.assertRaisesRegex(ValueError, 'NDK_REVISION'):
            q.ndk_identity(root)

    def test_wrong_preview_or_release_name_and_duplicates(self):
        valid = 'Pkg.Revision = 29.0.13113456-beta1\nPkg.BaseRevision = 29.0.13113456\nPkg.ReleaseName = r29-beta1\n'
        for text in (valid.replace('-beta1', '-beta2', 1), valid.replace('r29-beta1', 'r29'),
                     valid + 'Pkg.Revision = 29.0.13113456-beta1\n', valid.replace('Pkg.BaseRevision', 'Other')):
            with self.subTest(text=text), self.assertRaisesRegex(ValueError, 'NDK_REVISION'):
                q.ndk_identity(self.ndk(text))

    def test_x86_64_uses_its_exact_abi_and_independent_receipt(self):
        fake = self.root / 'cli'
        fake.write_bytes(b'fixture')
        result = self.root / 'x86'
        with patch.object(q, 'checkout'), patch.object(q, 'build', return_value=fake) as build, \
                patch.object(q, 'ndk_identity', return_value={'Pkg.Revision': q.NDK_REVISION}), \
                patch.object(q, 'verify_source'), patch.object(q, 'run', side_effect=['Machine: Advanced Micro Devices X86-64', '']):
            q.qualify(result, 'android', self.root / 'ndk', 'x86_64')
        self.assertEqual(build.call_args.args[-1], 'x86_64')
        import json
        self.assertEqual(json.loads((result / 'receipt.json').read_text())['abi'], 'x86_64')

if __name__ == '__main__':
    unittest.main()
