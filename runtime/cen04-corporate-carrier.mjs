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

// Paste the existing Publisher export projection in one action instead of
// typing its SHA-256 and size separately. This is untrusted transfer metadata,
// NOT a new exchange format, signed document, trust root or entitlement.
const HANDOFF_FIELDS=[
 'licenseId','requestId','issuerAuthorityId','organizationId','productId',
 'tariffId','tariffRevision','status','sequence','licenseEnvelopeSha256',
 'statusEnvelopeSha256','packageSha256','bytes','recipientConfirmed',
 'assignablePersonalAgentSeats'
];
const HANDOFF_STATES=new Set(['ACTIVE','SUSPENDED','REVOKED']);
export function parseCorporateDeliveryHandoff(text,organizationId){
 const code='CEN04_PUBLISHER_HANDOFF_INVALID';
 ensure(typeof text==='string'&&text.length>0&&text.length<=8192,code);
 let data;
 try{data=JSON.parse(text);}catch{throw Error(code);}
 ensure(data!==null&&typeof data==='object'&&!Array.isArray(data)&&
   Object.keys(data).length===HANDOFF_FIELDS.length&&
   HANDOFF_FIELDS.every(k=>Object.hasOwn(data,k)),code);
 for(const key of ['licenseId','requestId','issuerAuthorityId','organizationId','tariffId'])
   ensure(typeof data[key]==='string'&&ID.test(data[key]),code);
 ensure(data.organizationId===organizationId,'CEN04_PUBLISHER_HANDOFF_WRONG_ORGANIZATION');
 ensure(data.productId==='IWXA_ADMIN_CENTER'&&
   Number.isSafeInteger(data.tariffRevision)&&data.tariffRevision>0&&
   Number.isSafeInteger(data.sequence)&&data.sequence>0&&
   HANDOFF_STATES.has(data.status)&&
   typeof data.licenseEnvelopeSha256==='string'&&HEX.test(data.licenseEnvelopeSha256)&&
   typeof data.statusEnvelopeSha256==='string'&&HEX.test(data.statusEnvelopeSha256)&&
   data.recipientConfirmed===false&&data.assignablePersonalAgentSeats===0,code);
 checkCorporateCarrierExpectation({organizationId,sha256:data.packageSha256,bytes:data.bytes});
 return Object.freeze(data);
}
// This comparison is made only AFTER the original T3 native receipt has
// passed inspectCorporateReceived. Clipboard metadata never decides admission.
export function matchesCorporateSignedPair(receipt,handoff){
 return !!receipt&&!!handoff&&
  receipt.signedStatus===handoff.status&&
  ['organizationId','productId','licenseId','requestId','issuerAuthorityId',
   'tariffId','tariffRevision','sequence',
   'licenseEnvelopeSha256','statusEnvelopeSha256']
   .every(key=>receipt[key]===handoff[key]);
}
export function matchesCorporateDeliveryReceipt(receipt,handoff){
 return matchesCorporateSignedPair(receipt,handoff)&&
  receipt.packageSha256===handoff.packageSha256;
}
