// K01: stateless, host-neutral context projection. No storage or network access.
import { sha256, utf8ByteLength } from './hash.mjs';
export { sha256 } from './hash.mjs';
import { fingerprintContextRequest } from './request-binding.mjs';

export const CONTRACT_VERSION = '0.2.9';
const MAX_ITEMS = 4096;
const MAX_EXCERPT_BYTES = 65536;
const identifier = value => typeof value === 'string' && value.length > 0 && value.length <= 512 && value.trim() === value && !/[\x00-\x1f]/.test(value);
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;

function checkItem(item) {
  if (!item || !identifier(item.id) || !identifier(item.sourceRef) || !identifier(item.revision)
      || !identifier(item.type) || !['observed', 'reported', 'inferred', 'target'].includes(item.epistemic)
      || !Number.isSafeInteger(item.estimatedTokens) || item.estimatedTokens < 0
      || (item.keywords !== undefined && (!Array.isArray(item.keywords) || item.keywords.some(k => !identifier(k))))) {
    throw new TypeError('invalid KnowledgeItem');
  }
  return item;
}

function normalize(request) {
  if (!request || !identifier(request.taskId) || !Array.isArray(request.terms)
      || !Array.isArray(request.allowedSources) || !Number.isSafeInteger(request.maxTokens)
      || request.maxTokens < 0 || request.terms.length > 128 || request.allowedSources.length > 4096
      || (request.profile !== undefined && !identifier(request.profile))
      || (request.scopeRevision !== undefined && !(identifier(request.scopeRevision)
        || Number.isSafeInteger(request.scopeRevision) && request.scopeRevision >= 0))
      || (request.allowInferred !== undefined && typeof request.allowInferred !== 'boolean')) {
    throw new TypeError('invalid ContextRequest');
  }
  const terms = [...new Set(request.terms.map(term => {
    if (!identifier(term)) throw new TypeError('invalid term');
    return term.toLowerCase();
  }))].sort(compare);
  const allowedSources = [...new Set(request.allowedSources.map(ref => {
    if (!identifier(ref)) throw new TypeError('invalid allowed source');
    return ref;
  }))].sort(compare);
  return { taskId: request.taskId, terms, allowedSources, maxTokens: request.maxTokens,
    allowInferred: request.allowInferred === true, profile: request.profile,
    scopeRevision: request.scopeRevision };
}

function relevance(item, terms) {
  const indexed = [item.type, ...(item.keywords ?? [])].join(' ').toLowerCase();
  return terms.reduce((total, term) => total + Number(indexed.includes(term)), 0);
}

export async function selectContext(request, observationPort) {
  const req = normalize(request);
  if (!observationPort || typeof observationPort.query !== 'function' || typeof observationPort.observe !== 'function') {
    throw new TypeError('observationPort requires query and observe');
  }
  const items = await observationPort.query({ taskId: req.taskId, terms: req.terms,
    allowedSources: req.allowedSources, profile: req.profile });
  if (!Array.isArray(items) || items.length > MAX_ITEMS) throw new TypeError('invalid query result');
  const allowed = new Set(req.allowedSources);
  const seen = new Set();
  const candidates = [];
  for (const raw of items) {
    const item = checkItem(raw);
    if (!allowed.has(item.sourceRef)) continue;
    const key = JSON.stringify([item.sourceRef, item.id]);
    if (seen.has(key)) throw new TypeError('ambiguous duplicate KnowledgeItem');
    seen.add(key);
    const rank = relevance(item, req.terms);
    if (rank > 0) candidates.push({ item, rank });
  }
  // One source cannot be represented by incompatible pinned revisions in a single projection.
  const declaredRevisions = new Map();
  for (const { item } of candidates) {
    if (item.epistemic === 'inferred' && !req.allowInferred) continue;
    const pinnedRevision = declaredRevisions.get(item.sourceRef);
    if (pinnedRevision !== undefined && pinnedRevision !== item.revision) {
      throw new TypeError('conflicting pinned revisions for source');
    }
    declaredRevisions.set(item.sourceRef, item.revision);
  }
  candidates.sort((a, b) => b.rank - a.rank || compare(a.item.sourceRef, b.item.sourceRef)
    || compare(a.item.id, b.item.id) || compare(a.item.revision, b.item.revision));

  const selected = [];
  const omissions = [];
  const changedSources = new Map();
  let estimatedTokens = 0;
  for (const { item, rank } of candidates) {
    const omit = (reason, additional = {}) => omissions.push({ id: item.id, sourceRef: item.sourceRef, reason, ...additional });
    if (item.epistemic === 'inferred' && !req.allowInferred) { omit('inferred_excluded'); continue; }
    // A later stale observation invalidates earlier excerpts of the same source.
    if (changedSources.has(item.sourceRef)) {
      omit('stale', { requestedRevision: item.revision, currentRevision: changedSources.get(item.sourceRef) });
      continue;
    }
    if (item.estimatedTokens > req.maxTokens - estimatedTokens) { omit('budget_exceeded'); continue; }
    const observation = await observationPort.observe({ sourceRef: item.sourceRef,
      requestedRevision: item.revision, itemId: item.id });
    if (!observation || observation.sourceRef !== item.sourceRef || !identifier(observation.currentRevision)
        || observation.complete !== true) { omit('incomplete_source'); continue; }
    if (observation.currentRevision !== item.revision) {
      changedSources.set(item.sourceRef, observation.currentRevision);
      omit('stale', { requestedRevision: item.revision, currentRevision: observation.currentRevision });
      continue;
    }
    if (typeof observation.excerpt !== 'string' || !observation.excerpt
        || !identifier(observation.evidenceRef) || typeof observation.sha256 !== 'string') {
      omit('unverified_evidence'); continue;
    }
    const bytes = utf8ByteLength(observation.excerpt);
    if (bytes > MAX_EXCERPT_BYTES || sha256(observation.excerpt) !== observation.sha256) {
      omit('unverified_evidence'); continue;
    }
    // Host estimate may undercount; this lower-bound heuristic is not an LLM-token guarantee.
    const cost = Math.max(item.estimatedTokens, Math.ceil(bytes / 4));
    if (cost > req.maxTokens - estimatedTokens) { omit('budget_exceeded'); continue; }
    selected.push({ id: item.id, type: item.type, sourceRef: item.sourceRef, revision: item.revision,
      epistemic: item.epistemic, evidenceRef: observation.evidenceRef, sha256: observation.sha256,
      excerpt: observation.excerpt, estimatedTokens: cost, relevance: rank,
      inclusionReason: 'term_match_pinned_verified_source' });
    estimatedTokens += cost;
  }
  // Do not return an earlier successful excerpt if the source changed later in this selection.
  const coherent = selected.filter(entry => {
    if (!changedSources.has(entry.sourceRef)) return true;
    omissions.push({ id: entry.id, sourceRef: entry.sourceRef, reason: 'stale',
      requestedRevision: entry.revision, currentRevision: changedSources.get(entry.sourceRef) });
    return false;
  });
  omissions.sort((a, b) => compare(a.sourceRef, b.sourceRef) || compare(a.id, b.id)
    || compare(a.reason, b.reason));
  return { contractVersion: CONTRACT_VERSION, taskId: req.taskId,
    requestBinding: fingerprintContextRequest(req), selected: coherent, omissions,
    estimatedTokens: coherent.reduce((sum, entry) => sum + entry.estimatedTokens, 0),
    missing: req.terms.length > 0 && coherent.length === 0 };
}

export function traceEvidence(projection) {
  if (!projection || !Array.isArray(projection.selected)) throw new TypeError('invalid ContextProjection');
  return projection.selected.map(({ id, sourceRef, revision, epistemic, evidenceRef, sha256: digest }) =>
    ({ id, sourceRef, revision, epistemic, evidenceRef, sha256: digest }));
}

export function summarizeMemory(readonlyItems, constraints) {
  if (!Array.isArray(readonlyItems) || readonlyItems.length > MAX_ITEMS || !constraints
      || !Number.isSafeInteger(constraints.maxTokens) || constraints.maxTokens < 0) {
    throw new TypeError('invalid memory summary input');
  }
  const items = readonlyItems.map(checkItem).sort((a, b) => compare(a.sourceRef, b.sourceRef)
    || compare(a.id, b.id) || compare(a.revision, b.revision));
  const selected = [];
  let estimatedTokens = 0;
  const seen = new Set();
  for (const item of items) {
    const key = JSON.stringify([item.sourceRef, item.id]);
    if (seen.has(key)) throw new TypeError('ambiguous duplicate KnowledgeItem');
    seen.add(key);
    if (item.epistemic === 'inferred' && constraints.allowInferred !== true) continue;
    if (item.estimatedTokens > constraints.maxTokens - estimatedTokens) continue;
    estimatedTokens += item.estimatedTokens;
    selected.push({ id: item.id, sourceRef: item.sourceRef, revision: item.revision,
      epistemic: item.epistemic, type: item.type });
  }
  return { contractVersion: CONTRACT_VERSION, selected, estimatedTokens };
}

export { revalidateProjection } from './revalidation.mjs';
