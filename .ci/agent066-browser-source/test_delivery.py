"""Exercise delivery only; no fixture substitutes for native Setup acceptance."""
from pathlib import Path
from types import SimpleNamespace
import hashlib
import tempfile
import unittest
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import delivery as d
import delivery_crypto as c


class SetupSealTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.q = SimpleNamespace(root=Path(self.tmp.name), results=dict.fromkeys(d.REQUIRED, True))
        out = self.q.root / 'setup-output'
        out.mkdir()
        self.setup = out / d.SETUP_NAME
        self.setup.write_bytes(b'MZ fixture')

    def check(self, pin=d.PIN, tree=d.TREE, valid=True):
        return d.ready_to_seal(self.q, pin, tree, lambda *args: valid)

    def test_exact_successful_setup(self):
        self.assertTrue(self.check())

    def test_each_missing_or_failed_gate(self):
        for name in d.REQUIRED:
            with self.subTest(name=name):
                self.q.results.pop(name)
                self.assertFalse(self.check())
                self.q.results[name] = False
                self.assertFalse(self.check())
                self.q.results[name] = True

    def test_wrong_identity(self):
        self.assertFalse(self.check(pin='0'*40))
        self.assertFalse(self.check(tree='0'*40))
        self.assertFalse(self.check(valid=False))

    def test_other_gate_failure(self):
        self.q.results['OTHER'] = False
        self.assertFalse(self.check())

    def test_missing_setup(self):
        self.setup.unlink()
        self.assertFalse(self.check())


class EnvelopeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=3072)
        cls.public = cls.key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo)

    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.source = self.root / 'candidate.exe'
        self.folder = self.root / 'cipher'
        self.folder.mkdir()
        self.output = self.folder / d.NAME
        self.receipt = self.folder / (d.NAME + '.sha256')
        self.data = b'MZ' + bytes(range(256)) * 5000
        self.source.write_bytes(self.data)

    def seal(self):
        plain, sealed = c.encrypt_file(self.source, self.output, self.public)
        self.receipt.write_bytes((sealed + '\n').encode('ascii'))
        return plain, sealed

    def test_roundtrip_and_delivery_readback(self):
        plain, sealed = self.seal()
        raw = self.output.read_bytes()
        header = raw[:c.HEADER.size]
        magic,pin,tree,size,sha,nonce,wrapped = c.HEADER.unpack(header)
        key = self.key.decrypt(wrapped,c.OAEP)
        self.assertEqual(AESGCM(key).decrypt(nonce,raw[c.HEADER.size:],header),self.data)
        self.assertEqual((magic,pin,tree,size,sha),(c.MAGIC,d.PIN.encode(),d.TREE.encode(),len(self.data),bytes.fromhex(plain)))
        self.assertEqual(d.verify_envelope(self.folder),sealed)
        self.assertEqual(plain,hashlib.sha256(self.data).hexdigest())

    def test_tamper_rejected(self):
        self.seal()
        raw = bytearray(self.output.read_bytes()); raw[-1] ^= 1
        self.output.write_bytes(raw)
        with self.assertRaises(ValueError): d.verify_envelope(self.folder)
        header = raw[:c.HEADER.size]
        *_,nonce,wrapped = c.HEADER.unpack(header)
        with self.assertRaises(InvalidTag): AESGCM(self.key.decrypt(wrapped,c.OAEP)).decrypt(nonce,raw[c.HEADER.size:],header)

    def test_wrong_header_rejected_even_with_new_digest(self):
        self.seal()
        raw = bytearray(self.output.read_bytes()); raw[8:48] = b'0'*40
        self.output.write_bytes(raw)
        self.receipt.write_bytes((hashlib.sha256(raw).hexdigest()+'\n').encode('ascii'))
        with self.assertRaises(ValueError): d.verify_envelope(self.folder)

    def test_truncated_package(self):
        self.seal()
        self.output.write_bytes(self.output.read_bytes()[:-1])
        with self.assertRaises(ValueError): d.verify_envelope(self.folder)

    def test_no_extra_files(self):
        self.seal()
        (self.folder/'extra').write_bytes(b'x')
        with self.assertRaises(ValueError): d.verify_envelope(self.folder)

    def test_wrong_recipient(self):
        key = rsa.generate_private_key(public_exponent=65537,key_size=2048)
        pem = key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo)
        with self.assertRaises(ValueError): c.encrypt_file(self.source,self.output,pem)
        self.assertFalse(self.output.exists())

    def test_no_overwrite(self):
        self.output.write_bytes(b'old')
        with self.assertRaises(ValueError): c.encrypt_file(self.source,self.output,self.public)
        self.assertEqual(self.output.read_bytes(),b'old')

    def test_empty_file(self):
        self.source.write_bytes(b'')
        with self.assertRaises(ValueError): c.encrypt_file(self.source,self.output,self.public)
        self.assertFalse(self.output.exists())


if __name__ == '__main__': unittest.main()
