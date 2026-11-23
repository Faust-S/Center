// Admin Center display guard for a native SHA-256 match against the file
// exported by Publisher. This is NOT an original T3 Consumer receipt,
// a license verifier, a trust enrollment or a production seat entitlement.
const HEX=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const ensure=(ok,code)=>{if(!ok)throw Error(code);};

export function checkCorporateCarrierExpectation({organizationId,sha256,bytes}={}){
 ensure(typeof organizationId==='string'&&ID.test(organizationId),
   'CEN04_CORPORATE_ORGANIZATION_REQUIRED');
 ensure(typeof sha256==='string'&&HEX.test(sha256),
   'CEN04_CORPORATE_SHA256_REQUIRED');
 ensure(Number.isSafeInteger(bytes)&&bytes>0&&bytes<=4*1024*1024,
   'CEN04_CORPORATE_BYTES_REQUIRED');
 return Object.freeze({organizationId,sha256,bytes});
}
export function checkCorporateCarrierMatch(receipt,expectation){
 const expected=checkCorporateCarrierExpectation(expectation);
 ensure(receipt?.operation==='CORPORATE_CARRIER_SHA256_MATCHED'&&
   receipt.organizationId===expected.organizationId&&
   receipt.productId==='IWXA_ADMIN_CENTER'&&
   receipt.packageSha256===expected.sha256&&
   receipt.bytes===expected.bytes&&
   receipt.signatureVerified===false&&receipt.statusVerified===false&&
   receipt.recipientConfirmed===false&&
   receipt.productionActivation===false&&
   receipt.activeSeats===0&&receipt.assignablePersonalAgentSeats===0&&
   !Object.hasOwn(receipt,'licenseId')&&
   !Object.hasOwn(receipt,'trustedIssuer')&&
   !Object.hasOwn(receipt,'entitlement'),
   'CEN04_CORPORATE_FILE_ONLY_RECEIPT_REQUIRED');
 return Object.freeze({
   organizationId:expected.organizationId,
   packageSha256:expected.sha256,bytes:expected.bytes,
   signedLicenseAccepted:false,assignablePersonalAgentSeats:0
 });
}
