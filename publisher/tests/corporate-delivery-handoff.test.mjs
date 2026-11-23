import test from 'node:test';
import assert from 'node:assert/strict';
import {projectCorporateDeliveryHandoff as handoff}
  from '../src/corporate-delivery-handoff.mjs';

const view=(change={})=>({
 operation:'CORPORATE_SIGNED_READBACK',
 source:'ORIGINAL_T3_PRODUCT_ISSUE_LEDGER',
 licenseId:'license:company:one',requestId:'request:company:one',
 issuerAuthorityId:'issuer:iwxa',organizationId:'org:company',
 productId:'IWXA_ADMIN_CENTER',tariffId:'TEAM',tariffRevision:2,
 status:'ACTIVE',sequence:1,
 licenseEnvelopeSha256:'a'.repeat(64),
 statusEnvelopeSha256:'b'.repeat(64),
 licenseSignatureVerifiedAtIssuance:true,
 statusSignatureVerifiedAtIssuance:true,statusFloorVerified:true,
 recipientConfirmed:false,productionActivation:false,activeSeats:0,
 assignablePersonalAgentSeats:0,...change
});
const exported=(change={})=>({
 operation:'CORPORATE_IWXA_EXPORTED',
 licenseId:'license:company:one',packageSha256:'c'.repeat(64),
 bytes:7312,productionActivation:false,activeSeats:0,...change
});

test('original T3 export and two matching signed readbacks yield source-bound transfer data',()=>{
 const before=view(),after=view(),result=exported();
 const data=handoff(before,result,after);
 assert.equal(data.organizationId,'org:company');
 assert.equal(data.licenseId,'license:company:one');
 assert.equal(data.status,'ACTIVE');
 assert.equal(data.sequence,1);
 assert.equal(data.packageSha256,'c'.repeat(64));
 assert.equal(data.bytes,7312);
 assert.equal(data.recipientConfirmed,false);
 assert.equal(data.assignablePersonalAgentSeats,0);
 assert.equal(Object.isFrozen(data),true);
 assert.deepEqual(before,view());
 assert.deepEqual(after,view());
 assert.deepEqual(result,exported());
});
test('a concurrent STATUS or issuer/source change invalidates the visible handoff',()=>{
 for(const change of [
  {sequence:2},{status:'SUSPENDED'},
  {organizationId:'org:other'},
  {requestId:'request:other'},
  {issuerAuthorityId:'issuer:other'},
  {licenseId:'license:other'},
  {licenseEnvelopeSha256:'d'.repeat(64)},
  {statusEnvelopeSha256:'e'.repeat(64)},
  {tariffRevision:3}
 ]){
  assert.throws(()=>handoff(view(),exported(),view(change)),
    /CORPORATE_DELIVERY_OWNER_CHANGED_DURING_EXPORT/);
 }
});
test('no synthetic file success, trust, production or unsigned STATUS is accepted',()=>{
 for(const change of [
  {operation:'TEST_IWXA_EXPORTED'},
  {licenseId:'license:other'},
  {packageSha256:'a'},
  {bytes:0},{bytes:2.5},
  {productionActivation:true},{activeSeats:1}
 ]){
  assert.throws(()=>handoff(view(),exported(change),view()),
    /CORPORATE_DELIVERY_ORIGINAL_FILE_READBACK_REQUIRED/);
 }
 for(const change of [
  {status:'NOT_ACTIVATED',sequence:0,statusEnvelopeSha256:null},
  {statusSignatureVerifiedAtIssuance:false},
  {statusFloorVerified:false},
  {source:'WEBVIEW_DRAFT'},
  {recipientConfirmed:true},
  {activeSeats:1},
  {assignablePersonalAgentSeats:1},
  {licenseEnvelopeSha256:'not-a-sha'}
 ]){
  assert.throws(()=>handoff(view(change),exported(),view(change)),
    /CORPORATE_DELIVERY_ORIGINAL_SIGNED_SOURCE_REQUIRED/);
 }
});
