import {validatePublisherDraft} from './preparation.mjs';
import {prepareOfflineLicensePlanPreview} from './offline-license-plan.mjs';

// Publisher-only read-only review of the EXISTING organization/tariff proposal.
// It is never a T3 signed request, an issuer, an admission or a seat grant.
export const CORPORATE_OFFER_REVIEW_SCHEMA='IWXA_PUBLISHER_CORPORATE_OFFER_REVIEW/1';
export class CorporateOfferReviewError extends Error{
  constructor(code){super(code);this.name='CorporateOfferReviewError';this.code=code;}
}
const reject=code=>{throw new CorporateOfferReviewError(code);};
const scoped=(p,state)=>p?.tariffSnapshot?.holderType==='ORGANIZATION'&&
  p.productId==='IWXA_ADMIN_CENTER'&&state.holders.some(h=>
    h.id===p.holderId&&h.type==='ORGANIZATION');
function review(state,proposal){
  if(!scoped(proposal,state))
    reject('CORPORATE_OFFER_ADMIN_CENTER_ORGANIZATION_REQUIRED');
  const tariff=proposal.tariffSnapshot;
  const source=prepareOfflineLicensePlanPreview(state,{
    holderId:proposal.holderId,productId:proposal.productId,tariffCode:tariff.id,
    features:tariff.features,termDays:tariff.termDays,
    productSeats:tariff.productSeats,employeeLimit:tariff.employeeLimit,
    deviceLimit:tariff.deviceLimit,quotas:tariff.quotas
  });
  if(source.status!=='UNSIGNED_PREPARATION_ONLY'||
    source.subject.type!=='ORGANIZATION'||
    source.product.id!=='IWXA_ADMIN_CENTER'||
    source.entitlementRoute!=='ORGANIZATION_ADMIN_CENTER'||
    source.effectiveLicense!==false||source.productionActivation!==false)
    reject('CORPORATE_OFFER_SIGNED_SOURCE_FORBIDDEN');
  // productVersion is part of the saved proposal; don't replace it with the
  // version of a product later edited in the local preparation catalog.
  return {
    schema:CORPORATE_OFFER_REVIEW_SCHEMA,
    status:'LOCAL_PREPARATION_NOT_SIGNED',
    proposalId:proposal.id,
    organization:{...source.subject},
    product:{id:proposal.productId,version:proposal.productVersion},
    tariff:{id:tariff.id,name:tariff.name,revision:tariff.revision},
    priorPreparationId:proposal.previousProposalId??null,
    termDays:source.termDays,featureIds:[...source.featureIds],
    limits:{
      adminCenterProductSeats:source.limits.productSeats,
      employeeLimit:source.limits.employees,
      personalAgentSeats:null,
      quotas:source.limits.quotas.map(q=>({...q}))
    },
    coverage:{
      organizationLicenseProfile:'PRODUCTION_ORIGINAL_T3_REQUIRED',
      personalAgentSeatPool:'NOT_DEFINED_BY_THIS_TARIFF',
      employeeLimitIsAgentSeatPool:false,
      adminCenterSeatsAreAgentSeats:false,
      signedTariffIdAndRevision:false,
      originalPublisherAuthorityRead:false,
      installedAdminCenterReceiptRead:false
    },
    signedCorporateLicense:false,
    verifiedCorporateEntitlement:false,
    assignablePersonalAgentSeats:0,
    authorizedToAllocate:false
  };
}
export function prepareCorporateOfferReview(draft,{proposalId}={}){
  const state=validatePublisherDraft(draft);
  if(typeof proposalId!=='string'||!proposalId)
    reject('CORPORATE_OFFER_PROPOSAL_ID_REQUIRED');
  const proposal=state.proposals.find(p=>p.id===proposalId);
  if(!proposal)reject('CORPORATE_OFFER_PROPOSAL_NOT_FOUND');
  if(!proposal.tariffSnapshot)
    reject('CORPORATE_OFFER_SIGNED_TARIFF_SOURCE_REQUIRED');
  return review(state,proposal);
}
export function projectCorporateOfferReviews(draft,{limit=10}={}){
  const state=validatePublisherDraft(draft);
  if(!Number.isSafeInteger(limit)||limit<1||limit>20)
    reject('CORPORATE_OFFER_PREVIEW_LIMIT_INVALID');
  const proposals=state.proposals.filter(p=>scoped(p,state));
  const selected=proposals.slice(-limit).reverse();
  return {
    schema:CORPORATE_OFFER_REVIEW_SCHEMA,
    total:proposals.length,
    shown:selected.length,
    truncated:proposals.length>selected.length,
    items:selected.map(p=>review(state,p)),
    authorizedToAllocate:false,
    assignablePersonalAgentSeats:0
  };
}

// The signer normally lists the latest 20 corporate preparations. A direct
// navigation from an older saved proposal must keep the exact source in view
// without expanding or copying the underlying issuer ledger.
export function projectCorporateSigningOffers(draft,{focusProposalId='',limit=20}={}){
  const recent=projectCorporateOfferReviews(draft,{limit});
  if(!focusProposalId||recent.items.some(row=>row.proposalId===focusProposalId))
    return recent;
  let focused;
  try{focused=prepareCorporateOfferReview(draft,{proposalId:focusProposalId});}
  catch{return recent;} // A deleted/unsignable source is never fabricated.
  const items=[focused,...recent.items];
  return {...recent,shown:items.length,truncated:recent.total>items.length,items};
}
