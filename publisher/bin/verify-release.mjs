#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { verifyReleaseArtifact } from '../src/release-verification.mjs';

const [manifestPath, artifactPath, ...extra] = process.argv.slice(2);
if (!manifestPath || !artifactPath || extra.length) {
  process.stderr.write('Usage: node publisher/bin/verify-release.mjs <manifest.json> <artifact-file>\n');
  process.exitCode = 2;
} else {
  try {
    const raw = await readFile(manifestPath);
    if (raw.length > 32768) throw new Error('RELEASE_MANIFEST_TOO_LARGE');
    const release = JSON.parse(raw.toString('utf8'));
    const result = await verifyReleaseArtifact(release, artifactPath);
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
  } catch (e) {
    process.stderr.write('PUBLISHER_ARTIFACT_REJECTED: ' + (e.code || e.message || 'UNKNOWN_ERROR') + '\n');
    process.exitCode = 1;
  }
}
