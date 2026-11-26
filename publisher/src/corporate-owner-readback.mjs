// Read-only guard for the EXISTING ORIGINAL T3 corporate issuer ledger.
// This module neither issues licenses nor persists rights or source data.
// Its only purpose is to prevent an uncertain/previous ISSUE from becoming
// an accidental second signing operation in Publisher's native UI.
export class CorporateOwnerReadbackError extends Error{
 constructor(code){super(code);this.name='CorporateOwnerReadbackError';this.code=code;}
}
const deny=code=>{throw new CorporateOwnerReadbackError(code);};
const id=value=>typeof value==='string'&&
 /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(value);

export function inspectCorporateIssuePreflight(value,requestId){
 if(!id(requestId))deny('CORPORATE_PREFLIGHT_REQUEST_ID_INVALID');
 if(value?.operation!=='CORPORATE_INVENTORY'||
    value.lookupId!==requestId||value.productionActivation!==false||
    value.activeSeats!==0||value.truncated!==false||
    !Number.isSafeInteger(value.matches)||value.matches<0||value.matches>1||
    !Number.isSafeInteger(value.total)||value.total<value.matches||
    !Array.isArray(value.licenses)||value.licenses.length!==value.matches)
   deny('CORPORATE_PREFLIGHT_EXACT_ORIGINAL_LEDGER_REQUIRED');
 if(value.matches===0)return Object.freeze({state:'NOT_SIGNED',requestId});
 const entry=value.licenses[0];
 if(!entry||entry.requestId!==requestId||!id(entry.licenseId))
   deny('CORPORATE_PREFLIGHT_SIGNED_SCOPE_INVALID');
 return Object.freeze({state:'ALREADY_SIGNED',requestId,licenseId:entry.licenseId});
}

// Recovery after an uncertain native ACK is independent of the current UI
// selection. For STATUS, the same signed record at the previous sequence is
// NOT proof that the mutation committed. No second signing is authorized.
export function inspectUnknownCorporateMutationReadback(pending,signed){
 if(!pending||!signed||signed.operation!=='CORPORATE_SIGNED_READBACK'||
    !id(pending.requestId)||!id(signed.requestId)||
    signed.requestId!==pending.requestId||
    !id(signed.licenseId)||
    signed.productId!=='IWXA_ADMIN_CENTER')
   deny('CORPORATE_UNKNOWN_ORIGINAL_REQUEST_MISMATCH');
 if(pending.kind==='ISSUE'){
   if(!id(pending.issuerId)||!id(pending.organizationId)||
      !id(pending.tariffId)||!Number.isSafeInteger(pending.tariffRevision)||
      pending.tariffRevision<1||
      signed.issuerAuthorityId!==pending.issuerId||
      signed.organizationId!==pending.organizationId||
      signed.tariffId!==pending.tariffId||
      signed.tariffRevision!==pending.tariffRevision)
    deny('CORPORATE_UNKNOWN_ISSUE_TERMS_MISMATCH');
   inspectCorporateIssueLineage(signed,pending.renewal??null);
 }else if(pending.kind==='STATUS'){
   if(!id(pending.licenseId)||signed.licenseId!==pending.licenseId||
      !['ACTIVE','SUSPENDED','REVOKED'].includes(pending.expectedStatus)||
      !Number.isSafeInteger(pending.expectedSequence)||
      pending.expectedSequence<1||
      signed.sequence!==pending.expectedSequence||
      signed.status!==pending.expectedStatus)
    deny('CORPORATE_UNKNOWN_STATUS_EXACT_COMMIT_REQUIRED');
 }else deny('CORPORATE_UNKNOWN_OPERATION_INVALID');
 return Object.freeze({state:'ORIGINAL_COMMIT_CONFIRMED',
   licenseId:signed.licenseId,requestId:signed.requestId});
}

// Read the predecessor against the exact original signed ledger, not draft labels.
export function inspectCorporateRenewalPreflight(inventory,signed,scope){
 const prior=inspectCorporateIssuePreflight(inventory,scope?.priorRequestId);
 if(prior.state!=='ALREADY_SIGNED'||
    signed?.operation!=='CORPORATE_SIGNED_READBACK'||
    signed.requestId!==prior.requestId||signed.licenseId!==prior.licenseId||
    !id(signed.lineageId)||signed.issuerAuthorityId!==scope.issuerId||
    signed.organizationId!==scope.organizationId||
    signed.productId!=='IWXA_ADMIN_CENTER'||
    !['NOT_ACTIVATED','ACTIVE','SUSPENDED'].includes(signed.status)||
    signed.activeSeats!==0||signed.productionActivation!==false||
    signed.recipientConfirmed!==false)
   deny('CORPORATE_RENEWAL_SIGNED_PREDECESSOR_REQUIRED');
 return Object.freeze({licenseId:signed.licenseId,lineageId:signed.lineageId});
}
export function inspectCorporateIssueLineage(signed,expected){
 if(!signed||!id(signed.lineageId)||
    signed.renewalOf!==(expected?.licenseId??null)||
    (expected!==null&&(!expected||!id(expected.lineageId)||
      signed.lineageId!==expected.lineageId)))
   deny('CORPORATE_ISSUE_LINEAGE_MISMATCH');
 return signed;
}

const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
// Acknowledgement is transport information, not the signed result. Verify
// the exact next STATUS and the unchanged LICENSE against the original Owner.
export function confirmCorporateStatusCommit(previous,expectedStatus,validUntil,signed){
 const pending={kind:'STATUS',requestId:previous?.requestId,
   licenseId:previous?.licenseId,expectedStatus,expectedSequence:previous?.sequence+1};
 inspectUnknownCorporateMutationReadback(pending,signed);
 if(previous?.operation!=='CORPORATE_SIGNED_READBACK'||
    previous.source!=='ORIGINAL_T3_PRODUCT_ISSUE_LEDGER'||
    signed.source!=='ORIGINAL_T3_PRODUCT_ISSUE_LEDGER'||
    !hex(previous.licenseEnvelopeSha256)||
    signed.licenseEnvelopeSha256!==previous.licenseEnvelopeSha256||
    !hex(signed.statusEnvelopeSha256)||
    signed.statusEnvelopeSha256===previous.statusEnvelopeSha256||
    signed.licenseSignatureVerifiedAtIssuance!==true||
    signed.statusSignatureVerifiedAtIssuance!==true||
    signed.statusFloorVerified!==true||
    !Number.isSafeInteger(previous.stateRevision)||
    !Number.isSafeInteger(signed.stateRevision)||signed.stateRevision<=previous.stateRevision||
    !Number.isSafeInteger(previous.ledgerRevision)||
    !Number.isSafeInteger(signed.ledgerRevision)||signed.ledgerRevision<previous.ledgerRevision||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(validUntil)||
    signed.statusValidUntil!==validUntil||
    signed.productionActivation!==false||signed.activeSeats!==0||
    signed.assignablePersonalAgentSeats!==0||signed.recipientConfirmed!==false)
   deny('CORPORATE_STATUS_EXACT_SIGNED_READBACK_REQUIRED');
 for(const field of ['organizationId','issuerAuthorityId','productId','productVersion',
    'tariffId','tariffRevision','lineageId','renewalOf']){
   if(signed[field]!==previous[field])deny('CORPORATE_STATUS_LICENSE_BINDING_CHANGED');
 }
 return signed;
}
// Only one mutation call. Even a thrown or malformed ACK can mean the
// original journal committed. Read it, never sign again to get a response.
// The supplied readback must be the product's stable double cold read.
export async function changeCorporateStatusWithReadback(previous,expectedStatus,validUntil,mutate,readback){
 let acknowledged=false;
 try{
   const ack=await mutate();
   acknowledged=ack?.operation==='CORPORATE_STATUS'&&
     ack.licenseId===previous.licenseId&&ack.sequence===previous.sequence+1&&
     ack.state===expectedStatus;
 }catch{}
 const signed=confirmCorporateStatusCommit(previous,expectedStatus,validUntil,await readback());
 return {signed,recovered:!acknowledged};
}
