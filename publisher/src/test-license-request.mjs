import { validatePublisherDraft } from './preparation.mjs';

export const TEST_LICENSE_REQUEST_SCHEMA = 'IWXA_PUBLISHER_TEST_LICENSE_REQUEST/1';
export const TEST_LICENSE_REQUEST_LIMIT = 32768;

export class TestLicenseRequestError extends Error {
  constructor(code) { super(code); this.name = 'TestLicenseRequestError'; this.code = code; }
}
const reject = code => { throw new TestLicenseRequestError(code); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function fields(value, required, code) {
  if (!plain(value) || Object.keys(value).length !== required.length || required.some(k => !Object.hasOwn(value,k))) reject(code);
}
const validId = value => typeof value === 'string' && value.length < 130 && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value);
const validVersion = value => typeof value === 'string' && /^\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(value);
const validIso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;

// This is a transportable UNSIGNED request for an owner-held issuer. It has no
// credential, licenseId, issuer authority or capability to create entitlements.
// The existing T3 IWXA_T3_LICENSE/1 format licenses D01-D12 domains, NOT products.
export function validateTestLicenseRequest(value) {
  fields(value, ['schema','kind','requestId','requestedAt','environment','subject','product','featureIds','termDays','seats','status'], 'TEST_REQUEST_FIELDS_INVALID');
  if (value.schema !== TEST_LICENSE_REQUEST_SCHEMA || value.kind !== 'TEST_LICENSE_REQUEST' || value.status !== 'UNSIGNED_REQUEST' || value.environment !== 'TEST')
    reject('TEST_REQUEST_SCHEMA_OR_STATUS_INVALID');
  if (!validId(value.requestId) || !validIso(value.requestedAt)) reject('TEST_REQUEST_ID_OR_TIME_INVALID');
  fields(value.subject, ['type','id','name'], 'TEST_REQUEST_SUBJECT_INVALID');
  if (value.subject.type !== 'ORGANIZATION' || !validId(value.subject.id) || value.subject.id.startsWith('holder:') ||
      typeof value.subject.name !== 'string' || value.subject.name.length < 1 || value.subject.name.length > 130)
    reject('TEST_REQUEST_SUBJECT_INVALID');
  fields(value.product, ['id','version'], 'TEST_REQUEST_PRODUCT_INVALID');
  if (value.product.id !== 'IWXA_ADMIN_CENTER' || !validVersion(value.product.version))
    reject('TEST_REQUEST_PRODUCT_INVALID');
  if (!Array.isArray(value.featureIds) || value.featureIds.length < 1 || value.featureIds.length > 30 ||
      value.featureIds.some(v=>!validId(v)) || new Set(value.featureIds).size !== value.featureIds.length)
    reject('TEST_REQUEST_FEATURES_INVALID');
  if (!Number.isSafeInteger(value.termDays) || value.termDays < 1 || value.termDays > 3650)
    reject('TEST_REQUEST_TERM_INVALID');
  if (!Number.isSafeInteger(value.seats) || value.seats < 1 || value.seats > 10000)
    reject('TEST_REQUEST_SEATS_INVALID');
  return structuredClone(value);
}

export function prepareTestLicenseRequest(draft, { proposalId, seats }) {
  const state = validatePublisherDraft(draft);
  if (!validId(proposalId)) reject('TEST_REQUEST_PROPOSAL_ID_INVALID');
  const proposal = state.proposals.find(p=>p.id===proposalId);
  if (!proposal || proposal.status !== 'DRAFT_NOT_ISSUED') reject('TEST_REQUEST_PROPOSAL_NOT_FOUND');
  const subject = state.holders.find(h=>h.id===proposal.holderId);
  const product = state.products.find(p=>p.id===proposal.productId);
  if (!subject || !product) reject('TEST_REQUEST_UNRESOLVED_DRAFT');
  if (subject.type !== 'ORGANIZATION' || product.id !== 'IWXA_ADMIN_CENTER')
    reject('TEST_REQUEST_SCOPE_NOT_SUPPORTED');
  if (subject.id.startsWith('holder:')) reject('TEST_REQUEST_SOURCE_ORGANIZATION_ID_REQUIRED');
  if(proposal.tariffSnapshot&&seats>proposal.tariffSnapshot.productSeats)reject('TEST_REQUEST_SEATS_EXCEED_TARIFF');
  return validateTestLicenseRequest({
    schema: TEST_LICENSE_REQUEST_SCHEMA,
    kind: 'TEST_LICENSE_REQUEST',
    requestId: proposal.id,
    requestedAt: proposal.createdAt,
    environment: 'TEST',
    subject: { type: 'ORGANIZATION', id: subject.id, name: subject.name },
    product: { id: product.id, version: proposal.productVersion||product.version },
    featureIds: [...proposal.features],
    termDays: proposal.termDays,
    seats,
    status: 'UNSIGNED_REQUEST'
  });
}

export function encodeTestLicenseRequest(request) {
  const encoded=JSON.stringify(validateTestLicenseRequest(request));
  if (new TextEncoder().encode(encoded).length > TEST_LICENSE_REQUEST_LIMIT) reject('TEST_REQUEST_SIZE_INVALID');
  return encoded;
}
export function decodeTestLicenseRequest(text) {
  if (typeof text !== 'string' || new TextEncoder().encode(text).length > TEST_LICENSE_REQUEST_LIMIT) reject('TEST_REQUEST_SIZE_INVALID');
  let value; try { value=JSON.parse(text); } catch { reject('TEST_REQUEST_JSON_INVALID'); }
  return validateTestLicenseRequest(value);
}

export function suggestedTestRequestFileName(request) {
  validateTestLicenseRequest(request);
  const safe=request.requestId.replace(/[^A-Za-z0-9-]/g,'-').slice(-56);
  return 'iwxa-test-license-request-'+safe+'.json';
}
