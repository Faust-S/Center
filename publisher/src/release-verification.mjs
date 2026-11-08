import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { basename } from 'node:path';

export const RELEASE_INPUT_SCHEMA = 'IWXA_PUBLISHER_RELEASE_INPUT/1';
export const ARTIFACT_CHECK_SCHEMA = 'IWXA_PUBLISHER_ARTIFACT_CHECK/1';

export class ReleaseInputError extends Error {
  constructor(code) {
    super(code);
    this.name = 'ReleaseInputError';
    this.code = code;
  }
}

const fail = (code) => { throw new ReleaseInputError(code); };
const plain = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;
function fields(v, required, error) {
  if (!plain(v) || Object.keys(v).length !== required.length || required.some((k) => !Object.hasOwn(v, k))) fail(error);
}
function stringMatches(value, pattern, error) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(error);
}

/**
 * Strictly checks an untrusted source/artifact CLAIM. It does not endorse the
 * claimant, qualify the source, issue a license, or authorize publication.
 */
export function validateReleaseInput(input) {
  fields(input, ['schema', 'productId', 'version', 'platform', 'source', 'artifact'], 'RELEASE_INPUT_FIELDS');
  if (input.schema !== RELEASE_INPUT_SCHEMA) fail('RELEASE_INPUT_SCHEMA');
  stringMatches(input.productId, /^[A-Z][A-Z0-9_]{2,63}$/, 'PRODUCT_ID_INVALID');
  stringMatches(input.version, /^\d+\.\d+\.\d+(?:-[a-zA-Z0-9][a-zA-Z0-9.-]{0,63})?$/, 'VERSION_INVALID');
  if (!['windows-x64', 'windows-arm64', 'linux-x64', 'linux-arm64', 'macos-x64', 'macos-arm64'].includes(input.platform)) fail('PLATFORM_INVALID');
  fields(input.source, ['repository', 'commit', 'tree'], 'SOURCE_FIELDS');
  stringMatches(input.source.repository, /^[a-zA-Z0-9_.-]{1,80}\/[a-zA-Z0-9_.-]{1,100}$/, 'SOURCE_REPOSITORY_INVALID');
  stringMatches(input.source.commit, /^[a-f0-9]{40}$/, 'SOURCE_COMMIT_INVALID');
  stringMatches(input.source.tree, /^[a-f0-9]{40}$/, 'SOURCE_TREE_INVALID');
  fields(input.artifact, ['name', 'size', 'sha256'], 'ARTIFACT_FIELDS');
  const name = input.artifact.name;
  if (typeof name !== 'string' || name.length < 1 || name.length > 240 || name === '.' || name === '..' || name !== name.trim() || /[\\/<>:"|?*\u0000-\u001f]/u.test(name)) fail('ARTIFACT_NAME_INVALID');
  if (!Number.isSafeInteger(input.artifact.size) || input.artifact.size < 1) fail('ARTIFACT_SIZE_INVALID');
  stringMatches(input.artifact.sha256, /^[0-9a-f]{64}$/, 'ARTIFACT_DIGEST_INVALID');
  return structuredClone(input);
}

/**
 * Hashes a real selected artifact through a bounded-memory file descriptor.
 * The result deliberately says BYTE_MATCH, not RELEASE_APPROVED or SIGNED.
 */
export async function verifyReleaseArtifact(input, filePath) {
  const release = validateReleaseInput(input);
  if (typeof filePath !== 'string' || filePath.length === 0 || basename(filePath) !== release.artifact.name) fail('ARTIFACT_FILENAME_MISMATCH');
  const handle = await open(filePath, 'r');
  try {
    const before = await handle.stat();
    if (!before.isFile()) fail('ARTIFACT_NOT_A_FILE');
    if (before.size !== release.artifact.size) fail('ARTIFACT_SIZE_MISMATCH');
    const h = createHash('sha256');
    const buf = Buffer.allocUnsafe(1024 * 1024);
    let pos = 0;
    for (;;) {
      const { bytesRead } = await handle.read(buf, 0, buf.length, pos);
      if (bytesRead === 0) break;
      h.update(buf.subarray(0, bytesRead));
      pos += bytesRead;
    }
    const after = await handle.stat();
    if (after.size !== before.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs || pos !== before.size) fail('ARTIFACT_CHANGED_DURING_READ');
    const observed = h.digest('hex');
    if (observed !== release.artifact.sha256) fail('ARTIFACT_SHA256_MISMATCH');
    return Object.freeze({
      schema: ARTIFACT_CHECK_SCHEMA,
      outcome: 'BYTE_MATCH',
      sourceClaim: 'NOT_INDEPENDENTLY_VERIFIED',
      releaseApproval: false,
      signaturePresent: false,
      productId: release.productId,
      version: release.version,
      platform: release.platform,
      source: release.source,
      artifact: { name: release.artifact.name, size: pos, sha256: observed },
    });
  } finally {
    await handle.close();
  }
}
