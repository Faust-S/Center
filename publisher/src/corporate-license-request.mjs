import {validatePublisherDraft} from './preparation.mjs';
import {prepareCorporateOfferReview} from './corporate-offer-review.mjs';

// Exact unsigned wire request for the ORIGINAL T3 corporate Publisher issuer.
// It carries no signature, credential, activation, admission or employee grant.
// T3 revalidates all terms and the independent enrolled publisher authority.
export const CORPORATE_REQUEST_SCHEMA='IWXA_T3_CORPORATE_LICENSE_REQUEST/1';
export class CorporateRequestError extends Error{
  constructor(code){super(code);this.name='CorporateRequestError';this.code=code;}
}
function deny(code){throw new CorporateRequestError(code);}
export function prepareCorporateLicenseRequest(draft,{proposalId,personalAgentSeats}={}){
  const state=validatePublisherDraft(draft);
  const offer=prepareCorporateOfferReview(state,{proposalId});
  if(!Number.isSafeInteger(personalAgentSeats)||personalAgentSeats<0||
    personalAgentSeats>offer.limits.employeeLimit)
    deny('CORPORATE_REQUEST_AGENT_SEATS_INVALID');
  if(personalAgentSeats>0&&
    !offer.featureIds.includes('PERSONAL_AGENT_CORPORATE'))
    deny('CORPORATE_REQUEST_AGENT_FEATURE_NOT_SELECTED');
  const proposal=state.proposals.find(p=>p.id===offer.proposalId);
  if(!proposal||!proposal.tariffSnapshot)
    deny('CORPORATE_REQUEST_SOURCE_NOT_FOUND');
  const response={
    schema:CORPORATE_REQUEST_SCHEMA,kind:'CORPORATE_LICENSE_REQUEST',
    requestId:offer.proposalId,requestedAt:proposal.createdAt,
    environment:'PRODUCTION',
    subject:{type:'ORGANIZATION',id:offer.organization.id},
    product:{id:offer.product.id,version:offer.product.version},
    tariff:{id:offer.tariff.id,revision:offer.tariff.revision},
    featureIds:[...offer.featureIds],
    limits:{
      adminCenterSeats:offer.limits.adminCenterProductSeats,
      employeeLimit:offer.limits.employeeLimit,
      personalAgentSeats,
      quotas:offer.limits.quotas.map(q=>({
        metric:q.metric,service:q.service,unit:q.unit,period:q.period,max:q.max
      }))
    },
    termDays:offer.termDays,status:'UNSIGNED_REQUEST'
  };
  return Object.freeze(response);
}
export function encodeCorporateLicenseRequest(request){
  if(request?.schema!==CORPORATE_REQUEST_SCHEMA||
    request?.kind!=='CORPORATE_LICENSE_REQUEST'||
    request?.status!=='UNSIGNED_REQUEST'||
    request?.environment!=='PRODUCTION')
    deny('CORPORATE_REQUEST_UNSIGNED_PROFILE_REQUIRED');
  const raw=JSON.stringify(request);
  if(new TextEncoder().encode(raw).byteLength>32768)
    deny('CORPORATE_REQUEST_SIZE_INVALID');
  return raw;
}
export function suggestedCorporateLicenseRequestFileName(request){
  if(request?.schema!==CORPORATE_REQUEST_SCHEMA||
    typeof request?.requestId!=='string'||!request.requestId)
    deny('CORPORATE_REQUEST_ID_REQUIRED');
  const tail=request.requestId.slice(-28).replace(/[^A-Za-z0-9.-]/g,'-');
  return 'iwxa-corporate-license-request-'+tail+'.json';
}

// Retain the local preparation that produced an ORIGINAL signed corporate
// license. It is needed for later STATUS/renewal; deleting or restoring an
// older backup must not silently detach the signed request from its source.
// The only authority is an exact, read-only lookup in the existing T3 ledger.
export async function preserveSignedCorporateSources(current,replacement,readOriginalInventory){
 if(typeof readOriginalInventory!=='function')
  deny('CORPORATE_SOURCE_LEDGER_READER_REQUIRED');
 for(const proposal of current.proposals){
  if(proposal.productId!=='IWXA_ADMIN_CENTER'||
     proposal.tariffSnapshot?.holderType!=='ORGANIZATION')continue;
  const request=prepareCorporateLicenseRequest(current,{
   proposalId:proposal.id,personalAgentSeats:0
  });
  let after=null;
  try{after=prepareCorporateLicenseRequest(replacement,{
   proposalId:proposal.id,personalAgentSeats:0
  });}catch{/* A removed or changed source cannot be reconstructed. */}
  const successor=replacement.proposals.find(p=>p.id===proposal.id);
  if(after&&JSON.stringify(after)===JSON.stringify(request)&&
     (successor?.previousProposalId??null)===(proposal.previousProposalId??null))continue;
  let inventory;
  try{inventory=await readOriginalInventory(proposal.id);}
  catch{deny('CORPORATE_SOURCE_ORIGINAL_LEDGER_UNAVAILABLE');}
  if(inventory?.operation!=='CORPORATE_INVENTORY'||
     inventory.lookupId!==proposal.id||
     inventory.productionActivation!==false||inventory.activeSeats!==0||
     inventory.truncated!==false||
     !Number.isSafeInteger(inventory.total)||inventory.total<0||
     !Number.isSafeInteger(inventory.matches)||inventory.matches<0||
     inventory.total<inventory.matches||
     !Array.isArray(inventory.licenses)||
     inventory.licenses.length!==inventory.matches){
    deny('CORPORATE_SOURCE_LEDGER_READBACK_INVALID');
  }
  if(inventory.matches!==0)
   deny('CORPORATE_SOURCE_SIGNED_REQUEST_MUST_BE_RETAINED');
 }
}
