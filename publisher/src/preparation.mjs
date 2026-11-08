export const PUBLISHER_DRAFT_FORMAT = 'iwxa.publisher.preparation';
export const PUBLISHER_DRAFT_VERSION = 1;
export class PublisherDraftError extends Error {
  constructor(code) { super(code); this.name = 'PublisherDraftError'; this.code = code; }
}
const reject = code => { throw new PublisherDraftError(code); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function shape(value, keys, code) {
  if (!plain(value) || Object.keys(value).length !== keys.length || keys.some(k => !Object.hasOwn(value, k))) reject(code);
}
function clean(value, limit, code) {
  if (typeof value !== 'string' || value.length < 1 || value.length > limit || value !== value.trim() || /[\u0000-\u001f]/u.test(value)) reject(code);
}
const id = value => { clean(value, 90, 'ID_INVALID'); if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/.test(value)) reject('ID_INVALID'); };
const utc = value => { if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) reject('DATE_INVALID'); };
const unique = (values, code) => { if (new Set(values).size !== values.length) reject(code); };
function validateProduct(p) {
  shape(p, ['id', 'name', 'version'], 'PRODUCT_FIELDS_INVALID');
  if (!/^[A-Z][A-Z0-9_]{2,63}$/.test(p.id)) reject('PRODUCT_ID_INVALID');
  clean(p.name, 130, 'PRODUCT_NAME_INVALID');
  if (typeof p.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(p.version)) reject('PRODUCT_VERSION_INVALID');
}
function validateHolder(h) {
  shape(h, ['id', 'name', 'type'], 'HOLDER_FIELDS_INVALID'); id(h.id); clean(h.name, 130, 'HOLDER_NAME_INVALID');
  if (h.type !== 'PERSON' && h.type !== 'ORGANIZATION') reject('HOLDER_TYPE_INVALID');
}
function validateProposal(p) {
  shape(p, ['id','holderId','productId','features','termDays','createdAt','status'], 'PROPOSAL_FIELDS_INVALID');
  id(p.id); id(p.holderId); id(p.productId);
  if (!Array.isArray(p.features) || p.features.length > 30) reject('FEATURES_INVALID');
  p.features.forEach(feature => id(feature));
  unique(p.features, 'DUPLICATE_FEATURE');
  if (!Number.isSafeInteger(p.termDays) || p.termDays < 1 || p.termDays > 3650) reject('TERM_INVALID');
  utc(p.createdAt);
  if (p.status !== 'DRAFT_NOT_ISSUED') reject('UNAUTHORIZED_LICENSE_STATUS');
}
function validateArtifact(a) {
  shape(a, ['id','productId','version','platform','sourceRepository','sourceCommit','sourceTree','name','size','sha256','createdAt','status'], 'ARTIFACT_FIELDS_INVALID');
  id(a.id); id(a.productId);
  if (typeof a.version !== 'string' || !/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(a.version)) reject('ARTIFACT_VERSION_INVALID');
  if (!['windows-x64','windows-arm64','linux-x64','linux-arm64','macos-x64','macos-arm64'].includes(a.platform)) reject('PLATFORM_INVALID');
  if (typeof a.sourceRepository !== 'string' || !/^[a-zA-Z0-9_.-]{1,80}\/[a-zA-Z0-9_.-]{1,100}$/.test(a.sourceRepository)) reject('SOURCE_REPOSITORY_INVALID');
  if (!/^[a-f0-9]{40}$/.test(a.sourceCommit) || !/^[a-f0-9]{40}$/.test(a.sourceTree)) reject('SOURCE_REVISION_INVALID');
  clean(a.name, 240, 'ARTIFACT_NAME_INVALID');
  if (/[/\\<>:"|?*]/.test(a.name)) reject('ARTIFACT_NAME_INVALID');
  if (!Number.isSafeInteger(a.size) || a.size < 1) reject('ARTIFACT_SIZE_INVALID');
  if (typeof a.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(a.sha256)) reject('ARTIFACT_HASH_INVALID');
  utc(a.createdAt);
  if (a.status !== 'BYTES_INSPECTED_NOT_APPROVED') reject('UNAUTHORIZED_RELEASE_STATUS');
}
export function emptyPublisherDraft() {
  return {format:PUBLISHER_DRAFT_FORMAT,version:PUBLISHER_DRAFT_VERSION,products:[],holders:[],proposals:[],artifacts:[],updatedAt:new Date().toISOString()};
}
export function validatePublisherDraft(draft) {
  shape(draft, ['format','version','products','holders','proposals','artifacts','updatedAt'], 'DRAFT_FIELDS_INVALID');
  if (draft.format !== PUBLISHER_DRAFT_FORMAT || draft.version !== PUBLISHER_DRAFT_VERSION) reject('DRAFT_VERSION_INVALID');
  utc(draft.updatedAt);
  for (const key of ['products','holders','proposals','artifacts'])
    if (!Array.isArray(draft[key]) || draft[key].length > 250) reject('DRAFT_COLLECTION_INVALID');
  draft.products.forEach(validateProduct);
  draft.holders.forEach(validateHolder);
  draft.proposals.forEach(validateProposal);
  draft.artifacts.forEach(validateArtifact);
  unique(draft.products.map(v=>v.id), 'DUPLICATE_PRODUCT');
  unique(draft.holders.map(v=>v.id), 'DUPLICATE_HOLDER');
  unique(draft.proposals.map(v=>v.id), 'DUPLICATE_PROPOSAL');
  unique(draft.artifacts.map(v=>v.id), 'DUPLICATE_ARTIFACT');
  for (const p of draft.proposals) {
    if (!draft.products.some(v=>v.id===p.productId) || !draft.holders.some(v=>v.id===p.holderId)) reject('PROPOSAL_REFERENCE_MISSING');
  }
  for (const a of draft.artifacts) if (!draft.products.some(v=>v.id===a.productId)) reject('ARTIFACT_PRODUCT_MISSING');
  return structuredClone(draft);
}
export function encodePublisherDraft(draft) {
  const s = JSON.stringify(validatePublisherDraft(draft));
  if (new TextEncoder().encode(s).length > 524288) reject('DRAFT_SIZE_INVALID');
  return s;
}
export function decodePublisherDraft(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > 524288) reject('DRAFT_SIZE_INVALID');
  let value;
  try { value = JSON.parse(text); } catch { reject('DRAFT_JSON_INVALID'); }
  return validatePublisherDraft(value);
}
export function applyPublisherDraftCommand(draft, command) {
  const next = validatePublisherDraft(draft);
  if (!plain(command) || typeof command.kind !== 'string') reject('COMMAND_INVALID');
  if (command.kind === 'addProduct') {
    next.products.push({id:command.id, name:command.name, version:command.version});
  } else if (command.kind === 'addHolder') {
    next.holders.push({id:command.id, name:command.name, type:command.type});
  } else if (command.kind === 'addProposal') {
    next.proposals.push({id:'proposal:'+crypto.randomUUID(), holderId:command.holderId, productId:command.productId,features:command.features,termDays:command.termDays,createdAt:new Date().toISOString(),status:'DRAFT_NOT_ISSUED'});
  } else if (command.kind === 'addArtifact') {
    next.artifacts.push({id:'artifact:'+crypto.randomUUID(), productId:command.productId,version:command.version,platform:command.platform,sourceRepository:command.sourceRepository,sourceCommit:command.sourceCommit,sourceTree:command.sourceTree,name:command.name,size:command.size,sha256:command.sha256,createdAt:new Date().toISOString(),status:'BYTES_INSPECTED_NOT_APPROVED'});
  } else if (command.kind === 'removeProposal') {
    if (!next.proposals.some(v=>v.id===command.id)) reject('PROPOSAL_NOT_FOUND');
    next.proposals = next.proposals.filter(v=>v.id!==command.id);
  } else reject('COMMAND_INVALID');
  next.updatedAt = new Date().toISOString();
  return validatePublisherDraft(next);
}
