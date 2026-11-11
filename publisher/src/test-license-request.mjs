import {validatePublisherDraft} from './preparation.mjs';
import {
  TEST_LICENSE_REQUEST_SCHEMA, TestLicenseRequestError,
  validateTestLicenseRequest, validTestRequestId as validId
} from '../../runtime/cen04-unsigned-test-request.mjs';

// Retain all existing Publisher callers without duplicating the contract.
export {
  TEST_LICENSE_REQUEST_SCHEMA, TEST_LICENSE_REQUEST_LIMIT, TestLicenseRequestError,
  validateTestLicenseRequest, encodeTestLicenseRequest, decodeTestLicenseRequest,
  suggestedTestRequestFileName
} from '../../runtime/cen04-unsigned-test-request.mjs';
const reject=code=>{throw new TestLicenseRequestError(code);};

function prepareTestLicenseRequestValidated(state, { proposalId, seats }) {
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

export function prepareTestLicenseRequest(draft,options) {
 return prepareTestLicenseRequestValidated(validatePublisherDraft(draft),options);
}
// Original TEST issuer only: read-only, never signed consumer authority.
function inspectValidatedTestIssuerScope(state,proposalId) {
 const p=state.proposals.find(v=>v.id===proposalId);
 if(!p)return {supported:false,code:'PROPOSAL_NOT_FOUND',route:'NONE'};
 const h=state.holders.find(v=>v.id===p.holderId);
 const product=state.products.find(v=>v.id===p.productId);
 if(!h||!product)return {supported:false,code:'REFERENCE_MISSING',route:'NONE'};
 const route=h.type==='PERSON'?'PERSON_DIRECT_IN_PRODUCT':'ORGANIZATION_ADMIN_CENTER';
 if(h.type==='PERSON')return {supported:false,code:'PERSON_SIGNED_CONTRACT_UNAVAILABLE',route};
 if(product.id!=='IWXA_ADMIN_CENTER')
   return {supported:false,code:'PRODUCT_SIGNED_CONTRACT_UNAVAILABLE',route};
 try{
  prepareTestLicenseRequestValidated(state,{proposalId,seats:1});
  return {supported:true,code:'ORG_CENTER_TEST_REQUEST_ONLY',route};
 }catch{
  return {supported:false,code:'TEST_REQUEST_INCOMPLETE',route};
 }
}
export function inspectTestIssuerRequestScope(draft,proposalId) {
 return inspectValidatedTestIssuerScope(validatePublisherDraft(draft),proposalId);
}
// Check a whole draft once, rather than revalidating a 512 KiB store for
// every row while React renders an extensive customer/license catalog.
export function inspectTestIssuerRequestScopes(draft) {
 const state=validatePublisherDraft(draft);
 return state.proposals.map(p=>({proposalId:p.id,...inspectValidatedTestIssuerScope(state,p.id)}));
}
