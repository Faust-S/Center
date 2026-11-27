"""Delivery-only tests. No product or Windows PASS is inferred from fixtures."""
from copy import deepcopy
from pathlib import Path
import hashlib
import tempfile
import unittest
from cryptography.exceptions import InvalidTag
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
import delivery as d
import delivery_crypto as c

def accepted():
    run = dict(id=d.QUALIFICATION_RUN, head_sha=d.QUALIFICATION_HEAD,
               head_branch=d.QUALIFICATION_BRANCH, path='.github/workflows/agent066-browser-source.yml',
               event='push', status='completed', conclusion='success', repository={'full_name':d.REPOSITORY})
    rows = [dict(name='qualify / '+group,run_id=d.QUALIFICATION_RUN,head_sha=d.QUALIFICATION_HEAD,
                 status='completed',conclusion='success') for group in d.GROUPS]
    return run, {'total_count': len(rows), 'jobs': rows}


class QualificationTest(unittest.TestCase):
    def test_all_six_pass(self):
        self.assertTrue(d.qualification_passed(*accepted()))

    def test_pending(self):
        r,j=accepted();r['status']='in_progress';r['conclusion']=None
        self.assertFalse(d.qualification_passed(r,j))

    def test_failed_run(self):
        r,j=accepted();r['conclusion']='failure'
        self.assertFalse(d.qualification_passed(r,j))

    def test_failed_job(self):
        r,j=accepted();j['jobs'][0]['conclusion']='failure'
        self.assertFalse(d.qualification_passed(r,j))

    def test_missing_job(self):
        r,j=accepted();j['jobs'].pop();j['total_count']-=1
        self.assertFalse(d.qualification_passed(r,j))

    def test_duplicate_job(self):
        r,j=accepted();j['jobs'][-1]=deepcopy(j['jobs'][0])
        self.assertFalse(d.qualification_passed(r,j))

    def test_wrong_head(self):
        r,j=accepted();r['head_sha']='0'*40
        self.assertFalse(d.qualification_passed(r,j))

    def test_wrong_job_head(self):
        r,j=accepted();j['jobs'][0]['head_sha']='0'*40
        self.assertFalse(d.qualification_passed(r,j))

    def test_other_repository(self):
        r,j=accepted();r['repository']={'full_name':'other/Center'}
        self.assertFalse(d.qualification_passed(r,j))

    def test_other_run(self):
        r,j=accepted();r['id']+=1
        self.assertFalse(d.qualification_passed(r,j))

    def test_wrong_branch(self):
        r,j=accepted();r['head_branch']='main'
        self.assertFalse(d.qualification_passed(r,j))


class EnvelopeTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.key=rsa.generate_private_key(public_exponent=65537,key_size=3072)
        cls.public=cls.key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo)

    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root=Path(self.temp.name)
        self.source=self.root/'candidate.exe'
        self.output=self.root/'candidate.iwxae'
        self.data=b'MZ' + bytes(range(256))*5000
        self.source.write_bytes(self.data)

    def open_envelope(self, raw):
        header=raw[:c.HEADER.size]
        magic,pin,tree,size,sha,nonce,wrapped=c.HEADER.unpack(header)
        key=self.key.decrypt(wrapped,c.OAEP)
        plaintext=AESGCM(key).decrypt(nonce,raw[c.HEADER.size:],header)
        return magic,pin,tree,size,sha,plaintext

    def test_exact_roundtrip(self):
        plain,sealed=c.encrypt_file(self.source,self.output,self.public)
        raw=self.output.read_bytes()
        self.assertEqual(plain,hashlib.sha256(self.data).hexdigest())
        self.assertEqual(sealed,hashlib.sha256(raw).hexdigest())
        self.assertEqual(self.open_envelope(raw),(c.MAGIC,d.PIN.encode(),d.TREE.encode(),len(self.data),bytes.fromhex(plain),self.data))

    def test_tamper_rejected(self):
        c.encrypt_file(self.source,self.output,self.public)
        raw=bytearray(self.output.read_bytes());raw[-1]^=1
        with self.assertRaises(InvalidTag): self.open_envelope(raw)

    def test_wrong_recipient_rejected(self):
        key=rsa.generate_private_key(public_exponent=65537,key_size=2048)
        pem=key.public_key().public_bytes(serialization.Encoding.PEM,serialization.PublicFormat.SubjectPublicKeyInfo)
        with self.assertRaises(ValueError): c.encrypt_file(self.source,self.output,pem)
        self.assertFalse(self.output.exists())

    def test_no_overwrite(self):
        self.output.write_bytes(b'old')
        with self.assertRaises(ValueError): c.encrypt_file(self.source,self.output,self.public)
        self.assertEqual(self.output.read_bytes(),b'old')

    def test_empty_file_rejected(self):
        self.source.write_bytes(b'')
        with self.assertRaises(ValueError): c.encrypt_file(self.source,self.output,self.public)
        self.assertFalse(self.output.exists())


if __name__=='__main__': unittest.main()
