// Pure ESM SHA-256 for Node and WebView; no new storage or network access.
import { sha256 as nobleSha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

export const utf8ByteLength = value => utf8ToBytes(value).length;
export function sha256(input) {
  const bytes = typeof input === 'string' ? utf8ToBytes(input) : input;
  if (!(bytes instanceof Uint8Array)) throw new TypeError('sha256 expects text or bytes');
  return bytesToHex(nobleSha256(bytes));
}
