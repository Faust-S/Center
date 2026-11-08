import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateReleaseInput, verifyReleaseArtifact, RELEASE_INPUT_SCHEMA } from '../src/release-verification.mjs';

const original = Buffer.from('publisher-verification-exact-binary-test\u0000\u0001');
const digest = (v) => createHash('sha256').update(v).digest('hex');
function claim(bytes = original) {
  return {
    schema: RELEASE_INPUT_SCHEMA,
    productId: 'IWXA_ADMIN_CENTER',
    version: '0.2.0',
    platform: 'windows-x64',
    source: {
      repository: 'Faust-S/Center',
      commit: 'a'.repeat(40),
      tree: 'b'.repeat(40),
    },
    artifact: { name: 'IWXA Center Setup.exe', size: bytes.length, sha256: digest(bytes) },
  };
}

async function fixture(t, bytes = original) {
  const dir = await mkdtemp(join(tmpdir(), 'iwxa-publisher-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'IWXA Center Setup.exe');
  await writeFile(file, bytes);
  return { dir, file };
}

test('checks exact real artifact bytes, with no license, source or release authority implied', async (t) => {
  const { file } = await fixture(t);
  const result = await verifyReleaseArtifact(claim(), file);
  assert.equal(result.outcome, 'BYTE_MATCH');
  assert.equal(result.artifact.sha256, digest(original));
  assert.equal(result.releaseApproval, false);
  assert.equal(result.signaturePresent, false);
  assert.equal(result.sourceClaim, 'NOT_INDEPENDENTLY_VERIFIED');
});

test('same byte content at two distribution mirrors yields identical content checks', async (t) => {
  const { dir, file } = await fixture(t);
  await mkdir(join(dir, 'mirror'));
  const mirror = join(dir, 'mirror', 'IWXA Center Setup.exe');
  await writeFile(mirror, original);
  assert.deepEqual(await verifyReleaseArtifact(claim(), file), await verifyReleaseArtifact(claim(), mirror));
});

test('rejects modified bytes even when exact size remains unchanged', async (t) => {
  const tampered = Buffer.from(original);
  tampered[tampered.length - 1] ^= 0xff;
  const { file } = await fixture(t, tampered);
  await assert.rejects(verifyReleaseArtifact(claim(), file), { code: 'ARTIFACT_SHA256_MISMATCH' });
});

test('rejects mismatched size and wrong selected filename', async (t) => {
  const { file } = await fixture(t);
  await assert.rejects(verifyReleaseArtifact(claim(Buffer.concat([original, Buffer.from('x')])), file), { code: 'ARTIFACT_SIZE_MISMATCH' });
  const wrong = { ...claim(), artifact: { ...claim().artifact, name: 'Different.exe' } };
  await assert.rejects(verifyReleaseArtifact(wrong, file), { code: 'ARTIFACT_FILENAME_MISMATCH' });
});

test('rejects invalid source revisions, extra fields, bogus digests and traversal names', () => {
  const c = claim();
  assert.throws(() => validateReleaseInput({ ...c, source: { ...c.source, commit: 'main' } }), { code: 'SOURCE_COMMIT_INVALID' });
  assert.throws(() => validateReleaseInput({ ...c, secret: 'private-key' }), { code: 'RELEASE_INPUT_FIELDS' });
  assert.throws(() => validateReleaseInput({ ...c, artifact: { ...c.artifact, name: '../setup.exe' } }), { code: 'ARTIFACT_NAME_INVALID' });
  assert.throws(() => validateReleaseInput({ ...c, artifact: { ...c.artifact, sha256: '0'.repeat(63) } }), { code: 'ARTIFACT_DIGEST_INVALID' });
  assert.throws(() => validateReleaseInput({ ...c, platform: 'browser-admin-portal' }), { code: 'PLATFORM_INVALID' });
});

test('CLI validates actual files and rejects manifest claims that do not match bytes', async (t) => {
  const { dir, file } = await fixture(t);
  const manifest = join(dir, 'manifest.json');
  await writeFile(manifest, JSON.stringify(claim()));
  const run = () => spawnSync(process.execPath, ['publisher/bin/verify-release.mjs', manifest, file], { cwd: process.cwd(), encoding: 'utf8' });
  const accepted = run();
  assert.equal(accepted.status, 0, accepted.stderr);
  assert.equal(JSON.parse(accepted.stdout).outcome, 'BYTE_MATCH');
  await writeFile(manifest, JSON.stringify({ ...claim(), artifact: { ...claim().artifact, sha256: '0'.repeat(64) } }));
  const rejected = run();
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /ARTIFACT_SHA256_MISMATCH/);
});
