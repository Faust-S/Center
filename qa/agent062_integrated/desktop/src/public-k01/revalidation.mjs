// Checks selected evidence at the host's point of use. No persistence, authorization or apply.
import { CONTRACT_VERSION } from './index.mjs';
import { sha256, utf8ByteLength } from './hash.mjs';
import { fingerprintContextRequest } from './request-binding.mjs';

const id = value => typeof value === 'string' && value.length > 0 && value.length <= 512
  && value.trim() === value && !/[\x00-\x1f]/.test(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const compare = (a,b) => a < b ? -1 : a > b ? 1 : 0;
const MAX_ITEMS = 4096;
const MAX_EXCERPT_BYTES = 65536;

export async function revalidateProjection(projection, observationPort, expectedRequest) {
  if (!projection || projection.contractVersion !== CONTRACT_VERSION || !id(projection.taskId)
      || !Array.isArray(projection.selected) || projection.selected.length > MAX_ITEMS
      || !observationPort || typeof observationPort.observe !== 'function') {
    throw new TypeError('invalid projection or observation port');
  }
  // Validate/snapshot the entire input before any asynchronous host observation.
  const seen = new Set();
  const entries = projection.selected.map(item => {
    if (!item || !id(item.id) || !id(item.type) || !id(item.sourceRef)
        || !id(item.revision) || !id(item.evidenceRef) || !digest(item.sha256)
        || !['observed', 'reported', 'inferred', 'target'].includes(item.epistemic)
        || typeof item.excerpt !== 'string' || !item.excerpt
        || !Number.isSafeInteger(item.estimatedTokens) || item.estimatedTokens < 0) {
      throw new TypeError('invalid projection selection');
    }
    const key = JSON.stringify([item.sourceRef, item.id]);
    if (seen.has(key)) throw new TypeError('duplicate projection selection');
    seen.add(key);
    return { id: item.id, type: item.type, sourceRef: item.sourceRef,
      revision: item.revision, epistemic: item.epistemic, evidenceRef: item.evidenceRef,
      sha256: item.sha256, excerpt: item.excerpt, estimatedTokens: item.estimatedTokens };
  });
  const failures = [];
  // For a restored projection, the host must pass its current Task and source constraints.
  // Keep the third argument optional for existing 0.2.x callers, but without it no Task binding is verified.
  if (expectedRequest !== undefined) {
    if (!expectedRequest || !id(expectedRequest.taskId)
        || !Array.isArray(expectedRequest.allowedSources)
        || expectedRequest.allowedSources.length > MAX_ITEMS
        || expectedRequest.allowedSources.some(source => !id(source))
        || !Number.isSafeInteger(expectedRequest.maxTokens) || expectedRequest.maxTokens < 0
        || (expectedRequest.allowInferred !== undefined && typeof expectedRequest.allowInferred !== 'boolean')
        || (expectedRequest.requireNoOmissions !== undefined && typeof expectedRequest.requireNoOmissions !== 'boolean')
        || (expectedRequest.requireRequestMatch !== undefined && typeof expectedRequest.requireRequestMatch !== 'boolean')
        || (expectedRequest.terms !== undefined && (!Array.isArray(expectedRequest.terms)
          || expectedRequest.terms.length > 128))
        || (expectedRequest.profile !== undefined && !id(expectedRequest.profile))
        || (expectedRequest.scopeRevision !== undefined
          && !(id(expectedRequest.scopeRevision)
            || Number.isSafeInteger(expectedRequest.scopeRevision)
              && expectedRequest.scopeRevision >= 0))) {
      throw new TypeError('invalid host ContextUseRequest');
    }
    if (projection.taskId !== expectedRequest.taskId) failures.push({ reason: 'task_mismatch' });
    if (expectedRequest.requireRequestMatch === true && expectedRequest.terms === undefined) {
      throw new TypeError('invalid host ContextUseRequest: terms required for binding');
    }
    // Optional strict check: the same task can be revised to ask a different question.
    // Matching a hash does not authenticate a host-owned projection.
    if (expectedRequest.terms !== undefined) {
      let expectedBinding;
      try { expectedBinding = fingerprintContextRequest(expectedRequest); }
      catch { throw new TypeError('invalid host ContextUseRequest'); }
      if (!digest(projection.requestBinding) || projection.requestBinding !== expectedBinding) {
        failures.push({ reason: 'request_mismatch' });
      }
    }
    const allowed = new Set(expectedRequest.allowedSources);
    for (const item of entries) {
      if (!allowed.has(item.sourceRef)) {
        failures.push({ id: item.id, sourceRef: item.sourceRef, reason: 'source_not_allowed' });
      }
      if (item.epistemic === 'inferred' && expectedRequest.allowInferred !== true) {
        failures.push({ id: item.id, sourceRef: item.sourceRef, reason: 'inferred_not_allowed' });
      }
    }
    const cost = entries.reduce((sum, item) => sum + item.estimatedTokens, 0);
    if (!Number.isSafeInteger(projection.estimatedTokens)
        || cost !== projection.estimatedTokens || !Number.isSafeInteger(cost)) {
      failures.push({ reason: 'projection_inconsistent' });
    }
    if (cost > expectedRequest.maxTokens) failures.push({ reason: 'budget_exceeded' });
    if (expectedRequest.requireNoOmissions === true
        && (!Array.isArray(projection.omissions) || projection.omissions.length !== 0)) {
      failures.push({ reason: 'context_incomplete' });
    }
    if (failures.length > 0) {
      failures.sort((a, b) => compare(a.sourceRef ?? '', b.sourceRef ?? '')
        || compare(a.id ?? '', b.id ?? '') || compare(a.reason, b.reason));
      return { contractVersion: CONTRACT_VERSION, taskId: projection.taskId,
        allCurrent: false, checked: 0, failures };
    }
  }
  let checked = 0;
  for (const entry of entries) {
    const fail = (reason, details = {}) =>
      failures.push({ id: entry.id, sourceRef: entry.sourceRef, reason, ...details });
    if (utf8ByteLength(entry.excerpt) > MAX_EXCERPT_BYTES
        || sha256(entry.excerpt) !== entry.sha256) {
      fail('projection_modified');
      continue;
    }
    let observation;
    try {
      observation = await observationPort.observe({ sourceRef: entry.sourceRef,
        itemId: entry.id, requestedRevision: entry.revision });
    } catch {
      // Host exception details can include credentials or private file paths.
      fail('observation_failed');
      continue;
    }
    checked++;
    if (!observation || observation.sourceRef !== entry.sourceRef
        || !id(observation.currentRevision) || observation.complete !== true) {
      fail('incomplete_source');
      continue;
    }
    if (observation.currentRevision !== entry.revision) {
      fail('stale', { requestedRevision: entry.revision, currentRevision: observation.currentRevision });
      continue;
    }
    if (typeof observation.excerpt !== 'string' || !observation.excerpt
        || utf8ByteLength(observation.excerpt) > MAX_EXCERPT_BYTES
        || !id(observation.evidenceRef) || !digest(observation.sha256)
        || sha256(observation.excerpt) !== observation.sha256) {
      fail('unverified_evidence');
      continue;
    }
    if (observation.evidenceRef !== entry.evidenceRef || observation.sha256 !== entry.sha256) {
      fail('evidence_changed');
    }
  }
  if (entries.length === 0) failures.push({ reason: 'empty_projection' });
  failures.sort((a,b) => compare(a.sourceRef ?? '', b.sourceRef ?? '')
    || compare(a.id ?? '', b.id ?? '') || compare(a.reason,b.reason));
  return { contractVersion: CONTRACT_VERSION, taskId: projection.taskId,
    allCurrent: failures.length === 0, checked, failures };
}
