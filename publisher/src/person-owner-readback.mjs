// Read-only recovery from the ORIGINAL T3 PERSON owner inventory.
// No signer, Store, STATUS validator or retry loop is implemented here.
const SHA=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const valid=x=>typeof x==='string'&&ID.test(x);
const unknown=()=>Object.freeze({status:'OUTCOME_UNKNOWN'});
const conflict=()=>Object.freeze({status:'CONFLICT'});
export function personOwnerOutcomeLookupId(intent){
  if(intent?.kind==='ISSUE')return intent.request?.requestId;
  if(intent?.kind==='STATUS')return intent.license?.licenseId;
  throw Error('PERSON_OUTCOME_INTENT_REQUIRED');
}
export function inspectOriginalPersonMutationReadback(intent,owner){
  const id=personOwnerOutcomeLookupId(intent);
  if(!valid(id)||owner?.operation!=='PERSON_INVENTORY'||owner.lookupId!==id||
     owner.activeSeats!==0||owner.productionActivation!==false||
     owner.truncated!==false||!Array.isArray(owner.licenses)||
     !Number.isSafeInteger(owner.matches)||owner.matches<owner.licenses.length)
    throw Error('PERSON_OUTCOME_ORIGINAL_DURABLE_READBACK_REQUIRED');
  if(owner.matches!==1||owner.licenses.length!==1)return unknown();
  const row=owner.licenses[0];
  if(!row||!valid(row.licenseId)||!valid(row.requestId)||
     !valid(row.issuerAuthorityId)||!valid(row.personId)||
     !valid(row.productId)||!SHA.test(row.requestDigest)||
     !Number.isSafeInteger(row.sequence)||row.sequence<0||
     !['NOT_ACTIVATED','ACTIVE','SUSPENDED','REVOKED'].includes(row.status))
    throw Error('PERSON_OUTCOME_ORIGINAL_RECORD_INVALID');
  if(intent.kind==='ISSUE'){
    const request=intent.request;
    if(!valid(intent.issuerAuthorityId)||!SHA.test(intent.requestDigest)||
       !Number.isSafeInteger(request?.termDays)||request.termDays<1)
      throw Error('PERSON_OUTCOME_ISSUE_INTENT_INVALID');
    const same=row.requestId===request.requestId&&
      row.issuerAuthorityId===intent.issuerAuthorityId&&
      row.requestDigest===intent.requestDigest&&
      row.personId===request.subject?.id&&
      row.productId===request.product?.id&&
      row.deviceLimit===request.deviceLimit&&
      row.quotaCount===request.quotas?.length&&
      Date.parse(row.expiresAt)-Date.parse(row.notBefore)===
        request.termDays*86400000&&
      Boolean(row.renewalOfLicenseId)===Boolean(request.renewalOfRequestId);
    return same?Object.freeze({status:'COMMITTED',
      licenseId:row.licenseId,sequence:row.sequence}):conflict();
  }
  const prior=intent.license;
  if(!prior||!valid(prior.licenseId)||
     !['ACTIVE','SUSPENDED','REVOKED'].includes(intent.state)||
     !Number.isSafeInteger(prior.sequence)||prior.sequence<0||
     prior.sequence>=Number.MAX_SAFE_INTEGER)
    throw Error('PERSON_OUTCOME_STATUS_INTENT_INVALID');
  const same=row.licenseId===prior.licenseId&&
    row.requestId===prior.requestId&&
    row.issuerAuthorityId===prior.issuerAuthorityId&&
    row.personId===prior.personId&&row.productId===prior.productId&&
    row.requestDigest===prior.requestDigest;
  if(!same)return conflict();
  if(row.sequence===prior.sequence+1&&row.status===intent.state)
    return Object.freeze({status:'COMMITTED',
      licenseId:row.licenseId,sequence:row.sequence});
  return row.sequence<=prior.sequence?unknown():conflict();
}
