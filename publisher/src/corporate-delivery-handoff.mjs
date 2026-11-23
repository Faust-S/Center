// Read-only transfer evidence for one original corporate T3 LICENSE/STATUS.
// A Publisher export is NOT a recipient acknowledgement or a seat grant.
const HEX=/^[0-9a-f]{64}$/;
const validId=value=>typeof value==='string'&&
  /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(value);
const deny=code=>{throw Error(code);};

function verifySigned(view){
 if(view?.operation!=='CORPORATE_SIGNED_READBACK'||
   view.source!=='ORIGINAL_T3_PRODUCT_ISSUE_LEDGER'||
   !validId(view.licenseId)||!validId(view.requestId)||
   !validId(view.issuerAuthorityId)||!validId(view.organizationId)||
   view.productId!=='IWXA_ADMIN_CENTER'||
   !validId(view.tariffId)||!Number.isSafeInteger(view.tariffRevision)||
   view.tariffRevision<1||
   !['ACTIVE','SUSPENDED','REVOKED'].includes(view.status)||
   !Number.isSafeInteger(view.sequence)||view.sequence<1||
   !HEX.test(view.licenseEnvelopeSha256)||
   !HEX.test(view.statusEnvelopeSha256)||
   view.licenseSignatureVerifiedAtIssuance!==true||
   view.statusSignatureVerifiedAtIssuance!==true||
   view.statusFloorVerified!==true||
   view.recipientConfirmed!==false||
   view.productionActivation!==false||
   view.activeSeats!==0||view.assignablePersonalAgentSeats!==0)
   deny('CORPORATE_DELIVERY_ORIGINAL_SIGNED_SOURCE_REQUIRED');
}

export function projectCorporateDeliveryHandoff(before,exportResult,after){
 verifySigned(before);
 verifySigned(after);
 const keys=['licenseId','requestId','issuerAuthorityId','organizationId',
  'productId','tariffId','tariffRevision','status','sequence',
  'licenseEnvelopeSha256','statusEnvelopeSha256'];
 if(keys.some(key=>before[key]!==after[key]))
   deny('CORPORATE_DELIVERY_OWNER_CHANGED_DURING_EXPORT');
 if(exportResult?.operation!=='CORPORATE_IWXA_EXPORTED'||
   exportResult.licenseId!==before.licenseId||
   !HEX.test(exportResult.packageSha256)||
   !Number.isSafeInteger(exportResult.bytes)||exportResult.bytes<1||
   exportResult.productionActivation!==false||exportResult.activeSeats!==0)
   deny('CORPORATE_DELIVERY_ORIGINAL_FILE_READBACK_REQUIRED');
 return Object.freeze({
   licenseId:before.licenseId,requestId:before.requestId,
   issuerAuthorityId:before.issuerAuthorityId,
   organizationId:before.organizationId,productId:before.productId,
   tariffId:before.tariffId,tariffRevision:before.tariffRevision,
   status:before.status,sequence:before.sequence,
   licenseEnvelopeSha256:before.licenseEnvelopeSha256,
   statusEnvelopeSha256:before.statusEnvelopeSha256,
   packageSha256:exportResult.packageSha256,
   bytes:exportResult.bytes,
   recipientConfirmed:false,assignablePersonalAgentSeats:0
 });
}
