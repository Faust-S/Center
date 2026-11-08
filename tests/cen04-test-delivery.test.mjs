import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCen04TestDeliveryText,CEN04_TEST_DELIVERY_LIMIT} from '../runtime/cen04-test-delivery-preview.mjs';
import {receiveCen04TestDeliveryText,receiveCen04TestDeliveryIwxa} from '../runtime/cen04-test-delivery-receive.mjs';
const org='11111111-1111-4111-8111-111111111111';
const licenseId='license:test:delivery:1',requestId='request:test:one',issuer='publisher:test:owner';
const envelope=(payload,keyId)=>({schema:'IWXA_T3_ACCESS_SIGNED/1',keyId,payload,
  signature:'THIS_IS_NOT_A_VALID_SIGNATURE_AND_PREVIEW_MUST_NOT_ACCEPT_IT_AS_AUTHORITY'});
const sample=()=>({
 license:envelope({kind:'LICENSE',schema:'IWXA_T3_PRODUCT_LICENSE/1',
  environment:'TEST',id:licenseId,requestId,issuerAuthorityId:issuer,
  subject:{type:'ORGANIZATION',id:org},product:{id:'IWXA_ADMIN_CENTER',version:'0.3.0'},
  seats:4,featureIds:['WORKSPACE']},'owner:license:1'),
 statusEnvelope:envelope({kind:'LICENSE_STATUS',schema:'IWXA_T3_PRODUCT_LICENSE_STATUS/1',
  environment:'TEST',issuerAuthorityId:issuer,licenseId,requestId,organizationId:org,
  productId:'IWXA_ADMIN_CENTER',sequence:1,state:'ACTIVE'},'owner:status:1')
});
const inspect=object=>inspectCen04TestDeliveryText(JSON.stringify(object),{organizationId:org});
test('plausible fake signed TEST file previews only, never verifies signatures or seats',()=>{
 const result=inspect(sample());
 assert.equal(result.status,'FILE_PREVIEW_NOT_VERIFIED');
 assert.equal(result.claimedSeats,4);
 assert.equal(result.claimedStatus,'ACTIVE');
 assert.equal(result.signatureVerified,false);
 assert.equal(result.statusVerified,false);
 assert.equal(result.activeSeats,0);
 assert.equal(result.assignableSeats,0);
 assert.equal(result.productionActivation,false);
 assert.ok(!Object.hasOwn(result,'signedLicense'));
});
test('wrong organization/product/status linkage and trust-injection rejected on preview',()=>{
 const v=sample();
 for(const input of [
  {...v,trust:{policy:{}}},
  {...v,license:{...v.license,payload:{...v.license.payload,subject:{type:'ORGANIZATION',id:'other:org'}}}},
  {...v,license:{...v.license,payload:{...v.license.payload,product:{id:'IWXA_PERSONAL_AGENT',version:'0.3.0'}}}},
  {...v,statusEnvelope:{...v.statusEnvelope,payload:{...v.statusEnvelope.payload,sequence:0}}},
  {...v,statusEnvelope:{...v.statusEnvelope,payload:{...v.statusEnvelope.payload,licenseId:'other:license'}}},
  {...v,statusEnvelope:{...v.statusEnvelope,payload:{...v.statusEnvelope.payload,organizationId:'other:org'}}}
 ])assert.throws(()=>inspect(input),/CEN04_/);
});
test('file cap, malformed JSON, missing signed pair denied',()=>{
 assert.throws(()=>inspectCen04TestDeliveryText('{bad',{organizationId:org}),/JSON_INVALID/);
 assert.throws(()=>inspectCen04TestDeliveryText('x'.repeat(CEN04_TEST_DELIVERY_LIMIT+1),{organizationId:org}),/SIZE_INVALID/);
 assert.throws(()=>inspectCen04TestDeliveryText('{}',{organizationId:org}),/PAIR_REQUIRED/);
});
test('authoritative receive invokes supplied T3 consumer and requires its trusted readback',()=>{
 const v=sample();let n=0;
 const consumer={
  receive({license,statusEnvelope}){n++;assert.deepEqual(license,v.license);
    assert.deepEqual(statusEnvelope,v.statusEnvelope);
    throw Error('T3_SIGNATURE_INVALID');},
  view(){throw Error('SHOULD_NOT_VIEW_ON_FAILED_RECEIVE');}
 };
 assert.throws(()=>receiveCen04TestDeliveryText({
  raw:JSON.stringify(v),organizationId:org,consumer}),/T3_SIGNATURE_INVALID/);
 assert.equal(n,1);
 assert.throws(()=>receiveCen04TestDeliveryText({
  raw:JSON.stringify(v),organizationId:org}),/CEN04_T3_CONSUMER_REQUIRED/);
});

test('canonical .iwxa uses only original T3 inspecting and verifying consumer',()=>{
 const bytes=Buffer.from('PK\\x03\\x04'+'fixture-only');
 assert.throws(()=>receiveCen04TestDeliveryIwxa({bytes,organizationId:org}),
   /CEN04_T3_ORIGINAL_IWXA_INSPECTOR_REQUIRED/);
 let inspected=0,received=0;
 const inspectT3Iwxa=b=>{inspected++;assert.deepEqual(b,bytes);
   return {integrityVerified:true,signatureVerified:false,productionActivation:false,
     pair:sample()};
 };
 const consumer={receive(){received++;throw Error('T3_SIGNATURE_INVALID');},
   view(){throw Error('MUST_NOT_READ_AFTER_INVALID_SIGNATURE');}};
 assert.throws(()=>receiveCen04TestDeliveryIwxa({bytes,organizationId:org,
   inspectT3Iwxa,consumer}),/T3_SIGNATURE_INVALID/);
 assert.equal(inspected,1);assert.equal(received,1);
 assert.throws(()=>receiveCen04TestDeliveryIwxa({
   bytes,organizationId:org,inspectT3Iwxa:()=>({integrityVerified:false,
     signatureVerified:true,productionActivation:false,pair:sample()}),consumer
 }),/CEN04_T3_IWXA_INTEGRITY_RESULT_REQUIRED/);
 assert.throws(()=>receiveCen04TestDeliveryIwxa({
   bytes:Buffer.alloc(4*1024*1024+1),organizationId:org,
   inspectT3Iwxa,consumer}),/CEN04_IWXA_BYTES_INVALID/);
});
