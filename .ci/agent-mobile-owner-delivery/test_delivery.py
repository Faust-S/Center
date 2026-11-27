import hashlib
from pathlib import Path
import tempfile
import unittest
import zipfile
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.exceptions import InvalidTag
from delivery_crypto import encrypt_file, HEADER, PIN, TREE, MAGIC
from open_owner_apk import decrypt_file

class DeliveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key=rsa.generate_private_key(public_exponent=65537,key_size=3072)
        cls.pub=cls.key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo)
        cls.other=rsa.generate_private_key(public_exponent=65537,key_size=3072)
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory(); self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.apk=self.root/'fixture.apk'; self.enc=self.root/'fixture.iwxae'; self.out=self.root/'output.apk'
        with zipfile.ZipFile(self.apk,'w') as z:
            z.writestr('lib/arm64-v8a/libiwxa_sd_cli.so',b'A'*(2*1024*1024+17))
            z.writestr('AndroidManifest.xml',b'fixture, not real apk')
        self.plain_sha,self.enc_sha=encrypt_file(self.apk,self.enc,self.pub)
    def reject(self,enc=None,key=None):
        with self.assertRaises((ValueError,InvalidTag)):
            decrypt_file(enc or self.enc,self.out,key or self.key)
        self.assertFalse(self.out.exists())
        self.assertEqual(list(self.root.glob('.iwxa-*.part')),[])
    def test_roundtrip_multiple_blocks(self):
        self.assertEqual(decrypt_file(self.enc,self.out,self.key),self.plain_sha)
        self.assertEqual(self.apk.read_bytes(),self.out.read_bytes())
        self.assertEqual(hashlib.sha256(self.enc.read_bytes()).hexdigest(),self.enc_sha)
        magic,pin,tree,size,sha,nonce,wrapped=HEADER.unpack(self.enc.read_bytes()[:HEADER.size])
        self.assertEqual((magic,pin,tree,size,sha.hex()),(MAGIC,PIN.encode(),TREE.encode(),self.apk.stat().st_size,self.plain_sha))
    def test_tamper_ciphertext(self):
        data=bytearray(self.enc.read_bytes()); data[HEADER.size+8]^=1; self.enc.write_bytes(data); self.reject()
    def test_tamper_tag(self):
        data=bytearray(self.enc.read_bytes()); data[-1]^=1; self.enc.write_bytes(data); self.reject()
    def test_tamper_identity(self):
        data=bytearray(self.enc.read_bytes()); data[8]^=1; self.enc.write_bytes(data); self.reject()
    def test_truncation(self):
        self.enc.write_bytes(self.enc.read_bytes()[:-1]); self.reject()
    def test_wrong_recipient(self):
        self.reject(key=self.other)
    def test_no_overwrite_plain_or_cipher(self):
        self.out.write_bytes(b'previous user file')
        with self.assertRaises(ValueError): decrypt_file(self.enc,self.out,self.key)
        self.assertEqual(self.out.read_bytes(),b'previous user file')
        with self.assertRaises(ValueError): encrypt_file(self.apk,self.enc,self.pub)
        self.assertEqual(hashlib.sha256(self.enc.read_bytes()).hexdigest(),self.enc_sha)

if __name__=='__main__': unittest.main(verbosity=2)
