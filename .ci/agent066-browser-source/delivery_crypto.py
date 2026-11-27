"""Streaming hybrid envelope for a single exact IWXA installer candidate."""
from pathlib import Path
import hashlib
import os
import re
import secrets
import struct
import tempfile
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

MAGIC=b'IWXAENC1'
from admit import CANDIDATE_PIN as PIN, CANDIDATE_TREE as TREE
HEADER=struct.Struct('>8s40s40sQ32s12s384s')
LABEL=b'IWXA_AGENT065_DELIVERY_V1'
BLOCK=1024*1024
MAX_SIZE=8*1024**3
OAEP=padding.OAEP(mgf=padding.MGF1(hashes.SHA256()),algorithm=hashes.SHA256(),label=LABEL)

def digest_stream(f):
    result=hashlib.sha256()
    while block:=f.read(BLOCK): result.update(block)
    return result.hexdigest()

def finish_output(temp, output):
    # Never overwrite a previous installer, including if it appeared while decrypting.
    if os.name=='nt':
        os.rename(temp, output)
    else:
        os.link(temp, output)
        os.unlink(temp)

def encrypt_file(source, output, public_pem):
    source,output=Path(source),Path(output)
    if output.exists() or output.is_symlink(): raise ValueError('output already exists')
    public=serialization.load_pem_public_key(public_pem)
    if not isinstance(public,rsa.RSAPublicKey) or public.key_size!=3072: raise ValueError('recipient key invalid')
    session_key=secrets.token_bytes(32)
    nonce=secrets.token_bytes(12)
    wrapped=public.encrypt(session_key,OAEP)
    tmp=None
    try:
        with source.open('rb') as f:
            size=os.fstat(f.fileno()).st_size
            if not 1<=size<=MAX_SIZE: raise ValueError('installer size invalid')
            sha=digest_stream(f)
            f.seek(0)
            header=HEADER.pack(MAGIC,PIN.encode(),TREE.encode(),size,bytes.fromhex(sha),nonce,wrapped)
            enc=Cipher(algorithms.AES(session_key),modes.GCM(nonce)).encryptor()
            enc.authenticate_additional_data(header)
            check=hashlib.sha256(); length=0
            with tempfile.NamedTemporaryFile(mode='wb',dir=output.parent,prefix='.iwxa-',suffix='.part',delete=False) as dst:
                tmp=Path(dst.name);dst.write(header)
                while block:=f.read(BLOCK):
                    length+=len(block)
                    if length>size: raise ValueError('installer changed')
                    check.update(block);dst.write(enc.update(block))
                dst.write(enc.finalize());dst.write(enc.tag);dst.flush();os.fsync(dst.fileno())
            if length!=size or check.hexdigest()!=sha: raise ValueError('installer changed')
        finish_output(tmp,output);tmp=None
        with output.open('rb') as f: sealed_sha=digest_stream(f)
        return sha,sealed_sha
    finally:
        if tmp is not None: tmp.unlink(missing_ok=True)

