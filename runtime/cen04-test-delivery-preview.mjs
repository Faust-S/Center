// Public, non-authoritative native-file PREVIEW for CEN04.
// Signature, status, trust, floors, persistence and rights remain T3-only.
export const CEN04_TEST_DELIVERY_LIMIT=1024*1024;
const fail=code=>{throw Error(code);};
const plain=x=>x&&typeof x==='object'&&!Array.isArray(x)&&Object.getPrototypeOf(x)===Object.prototype;
const exact=(o,keys,code)=>{if(!plain(o)||Object.keys(o).length!==keys.length||
  keys.some(k=>!Object.hasOwn(o,k)))fail(code);};
const id=x=>typeof x==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(x);
const STATES=new Set(['ACTIVE','SUSPENDED','REVOKED']);
const ENVELOPE='IWXA_T3_ACCESS_SIGNED/1';
export function inspectCen04TestDeliveryText(raw,{organizationId}={}){
  if(typeof raw!=='string'||new TextEncoder().encode(raw).byteLength===0||
    new TextEncoder().encode(raw).byteLength>CEN04_TEST_DELIVERY_LIMIT)
    fail('CEN04_TEST_DELIVERY_SIZE_INVALID');
  if(!id(organizationId))fail('CEN04_ORGANIZATION_REQUIRED');
  let carrier;try{carrier=JSON.parse(raw);}catch{fail('CEN04_TEST_DELIVERY_JSON_INVALID');}
  exact(carrier,['license','statusEnvelope'],'CEN04_TEST_DELIVERY_PAIR_REQUIRED');
  const {license,statusEnvelope}=carrier;
  for(const signed of [license,statusEnvelope]){
    exact(signed,['schema','keyId','payload','signature'],'CEN04_TEST_SIGNED_ENVELOPE_REQUIRED');
    if(signed.schema!==ENVELOPE||!id(signed.keyId)||typeof signed.signature!=='string'||
      !signed.signature.length||!plain(signed.payload))
      fail('CEN04_TEST_ENVELOPE_SHAPE_INVALID');
  }
  const lp=license.payload,sp=statusEnvelope.payload;
  if(lp.schema!=='IWXA_T3_PRODUCT_LICENSE/1'||lp.kind!=='LICENSE'||lp.environment!=='TEST'||
    !id(lp.id)||!id(lp.requestId)||!id(lp.issuerAuthorityId)||
    !plain(lp.subject)||lp.subject.type!=='ORGANIZATION'||!id(lp.subject.id)||
    !plain(lp.product)||lp.product.id!=='IWXA_ADMIN_CENTER'||
    !Number.isSafeInteger(lp.seats)||lp.seats<1||
    sp.schema!=='IWXA_T3_PRODUCT_LICENSE_STATUS/1'||sp.kind!=='LICENSE_STATUS'||
    sp.environment!=='TEST'||!STATES.has(sp.state)||
    !Number.isSafeInteger(sp.sequence)||sp.sequence<1)
    fail('CEN04_TEST_DELIVERY_PROFILE_INVALID');
  if(lp.subject.id!==organizationId||sp.organizationId!==organizationId)
    fail('CEN04_TEST_DELIVERY_ORGANIZATION_MISMATCH');
  if(sp.issuerAuthorityId!==lp.issuerAuthorityId||
    sp.licenseId!==lp.id||sp.requestId!==lp.requestId||
    sp.productId!==lp.product.id)
    fail('CEN04_TEST_DELIVERY_SIGNED_BINDING_CLAIM_MISMATCH');
  return Object.freeze({status:'FILE_PREVIEW_NOT_VERIFIED',
    organizationId,productId:'IWXA_ADMIN_CENTER',
    licenseId:lp.id,claimedSeats:lp.seats,
    claimedStatus:sp.state,claimedSequence:sp.sequence,
    signatureVerified:false,statusVerified:false,
    commercialAuthorityProven:false,activeSeats:0,assignableSeats:0,
    productionActivation:false,verification:'T3_NATIVE_CONSUMER_REQUIRED'});
}
