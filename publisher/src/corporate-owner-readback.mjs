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
