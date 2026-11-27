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


if __name__ == '__main__':
    unittest.main()
