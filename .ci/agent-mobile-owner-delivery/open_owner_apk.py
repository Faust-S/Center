"""Open an exact owner candidate locally; the private key never goes to Center."""
import argparse
import hashlib
import os
from pathlib import Path
import tempfile
from getpass import getpass

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from delivery_crypto import HEADER, MAGIC, PIN, TREE, BLOCK, MAX_SIZE, OAEP, finish_output


def decrypt_file(source, output, key):
    source, output = Path(source), Path(output)
    if output.exists() or output.is_symlink():
        raise ValueError('output already exists')
    if not isinstance(key, rsa.RSAPrivateKey) or key.key_size != 3072:
        raise ValueError('recipient key invalid')
    tmp = None
    try:
        with source.open('rb') as src:
            header = src.read(HEADER.size)
            if len(header) != HEADER.size:
                raise ValueError('envelope header invalid')
            magic, pin, tree, size, expected, nonce, wrapped = HEADER.unpack(header)
            if (magic, pin, tree) != (MAGIC, PIN.encode(), TREE.encode()) or not 1 <= size <= MAX_SIZE:
                raise ValueError('candidate identity invalid')
            if os.fstat(src.fileno()).st_size != HEADER.size + size + 16:
                raise ValueError('envelope length invalid')
            src.seek(HEADER.size + size)
            tag = src.read(16)
            src.seek(HEADER.size)
            session_key = key.decrypt(wrapped, OAEP)
            dec = Cipher(algorithms.AES(session_key), modes.GCM(nonce, tag)).decryptor()
            dec.authenticate_additional_data(header)
            remaining = size
            check = hashlib.sha256()
            with tempfile.NamedTemporaryFile(mode='wb', dir=output.parent, prefix='.iwxa-', suffix='.part', delete=False) as dst:
                tmp = Path(dst.name)
                while remaining:
                    block = src.read(min(BLOCK, remaining))
                    if not block:
                        raise ValueError('envelope truncated')
                    remaining -= len(block)
                    data = dec.update(block)
                    check.update(data)
                    dst.write(data)
                tail = dec.finalize()
                check.update(tail)
                dst.write(tail)
                if check.digest() != expected or dst.tell() != size:
                    raise ValueError('APK identity invalid')
                dst.flush()
                os.fsync(dst.fileno())
        finish_output(tmp, output)
        tmp = None
        return expected.hex()
    finally:
        if tmp is not None:
            tmp.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description='Open the encrypted IWXA ARM64 owner candidate on your own computer.')
    parser.add_argument('envelope', type=Path)
    parser.add_argument('output_apk', type=Path)
    parser.add_argument('--key', required=True, type=Path)
    args = parser.parse_args()
    pem = args.key.read_bytes()
    try:
        key = serialization.load_pem_private_key(pem, password=None)
    except TypeError:
        key = serialization.load_pem_private_key(pem, password=getpass('Private key passphrase: ').encode())
    print('APK_SHA256=' + decrypt_file(args.envelope, args.output_apk, key))


if __name__ == '__main__':
    main()
