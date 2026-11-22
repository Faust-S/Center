// Synchronous Node crypto/Buffer subset required by the pinned K02/K04 owner sources.
// Runs in WebView and Node with the SHA-256 already used by the Desktop build.
// This module does not provide an executor, store, model selector or authority.
import {sha256 as nobleSha256} from '@noble/hashes/sha2.js';
import {bytesToHex, utf8ToBytes} from '@noble/hashes/utils.js';

export function utf8ByteLength(value, encoding = 'utf8') {
  if (typeof value !== 'string' || !['utf8','utf-8'].includes(encoding))
    throw new TypeError('UTF-8 string required');
  return utf8ToBytes(value).length;
}

export function createHash(algorithm) {
  if (algorithm !== 'sha256') throw new TypeError('Only SHA-256 is supported');
  const state = nobleSha256.create();
  return {
    update(value) {
      const bytes = typeof value === 'string' ? utf8ToBytes(value) : value;
      if (!(bytes instanceof Uint8Array)) throw new TypeError('SHA-256 input must be bytes or text');
      state.update(bytes);
      return this;
    },
    digest(format) {
      if (format !== 'hex') throw new TypeError('Only hex digests are supported');
      return bytesToHex(state.digest());
    },
  };
}
