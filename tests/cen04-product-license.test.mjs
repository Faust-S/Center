import test from 'node:test';
import assert from 'node:assert/strict';
import {createCen04ProductLicensePort} from '../runtime/cen04-product-license.mjs';
const ORG='org:example';
const licenseId='license:test:one';
const fixture=(overrides={})=>{
 const state={schema:'IWXA_T3_PRODUCT_LICENSE_CONSUMER_VIEW/1',organizationId:ORG,
  productId:'IWXA_ADMIN_CENTER',revision:0,licenses:[],
  trustOrigin:'HOST_PREINSTALLED_PUBLIC_POLICY',activeSeats:0,assignableSeats:0,
  productionActivation:false};
 let accept=true;let status='ACTIVE';let revision=0;let readbacks=0;
 const consumer={
  view(){readbacks++;return {...state,revision,licenses:revision?[{
    licenseId,organizationId:ORG,productId:'IWXA_ADMIN_CENTER',claimedSeats:4,
    sequence:revision,status,signatureVerified:true,statusVerified:true,
    activeSeats:0,assignableSeats:0,commercialAuthorityProven:false,
    productionActivation:false}]:[],...overrides};},
  receive(){if(!accept)throw Error('PRODUCT_STATUS_ROLLBACK_DENIED');revision++;return {
    outcome:'VERIFIED_TEST_SAVED',revision,licenseId,organizationId:ORG,
    productId:'IWXA_ADMIN_CENTER',claimedSeats:4,sequence:revision,status,
    signatureVerified:true,statusVerified:true,activeSeats:0,assignableSeats:0,
    commercialAuthorityProven:false,productionActivation:false};},
  setStatus(next){status=next;},deny(){accept=false;},reads(){return readbacks;}
 };
 return consumer;
};
test('CEN04 cannot be constructed without original T3 consumer and fixed organization',()=>{
 assert.throws(()=>createCen04ProductLicensePort({organizationId:ORG}),/CEN04_T3_CONSUMER_REQUIRED/);
 assert.throws(()=>createCen04ProductLicensePort({consumer:fixture(),organizationId:'../escape'}),/CEN04_ORGANIZATION_REQUIRED/);
});
test('no publisher status means no verified seats and no organization activation',()=>{
 const port=createCen04ProductLicensePort({consumer:fixture(),organizationId:ORG});
 const view=port.read();assert.equal(view.status,'NO_SIGNED_TEST_LICENSE');
 assert.equal(view.activeSeats,0);assert.equal(view.productionActivation,false);
 assert.deepEqual(view.licenses,[]);
});
test('owner T3 readback controls receipt; signed TEST ACTIVE never yields seats',()=>{
 const owner=fixture(),port=createCen04ProductLicensePort({consumer:owner,organizationId:ORG});
 const result=port.receive({organizationId:ORG,license:{signed:true},statusEnvelope:{signed:true}});
 assert.equal(result.status,'SIGNED_TEST_STATUS_VERIFIED');assert.equal(result.licenseStatus,'ACTIVE');
 assert.equal(result.claimedSeats,4);assert.equal(result.activeSeats,0);
 assert.equal(result.assignableSeats,0);assert.equal(result.productionActivation,false);
 assert.equal(port.read().revision,1);assert.ok(owner.reads()>0);
});
test('signed SUSPENDED and REVOKED remain non-activating and owner controls failures',()=>{
 const owner=fixture(),port=createCen04ProductLicensePort({consumer:owner,organizationId:ORG});
 owner.setStatus('SUSPENDED');const suspended=port.receive({organizationId:ORG,license:{},statusEnvelope:{}});
 assert.equal(suspended.licenseStatus,'SUSPENDED');
 owner.setStatus('REVOKED');const revoked=port.receive({organizationId:ORG,license:{},statusEnvelope:{}});
 assert.equal(revoked.licenseStatus,'REVOKED');assert.equal(port.read().licenses[0].activeSeats,0);
 owner.deny();assert.throws(()=>port.receive({organizationId:ORG,license:{},statusEnvelope:{}}),/PRODUCT_STATUS_ROLLBACK_DENIED/);
});
test('forged organization, asserted seats or owner view trust fail closed',()=>{
 const owner=fixture(),port=createCen04ProductLicensePort({consumer:owner,organizationId:ORG});
 assert.throws(()=>port.receive({organizationId:'org:other',license:{},statusEnvelope:{}}),/CEN04_ORGANIZATION_MISMATCH/);
 for(const value of [{activeSeats:2},{trustOrigin:'DELIVERED_FILE'},{productionActivation:true},
   {organizationId:'org:other'},{schema:'UNTRUSTED'}]){
  const malformed=createCen04ProductLicensePort({consumer:fixture(value),organizationId:ORG});
  assert.throws(()=>malformed.read(),/CEN04_OWNER_VERIFIED_VIEW_REQUIRED/);
 }
});
test('no successful response without T3 durable readback of sequence and status',()=>{
 const consumer=fixture();const original=consumer.receive;
 consumer.receive=()=>({...original(),sequence:17});
 const port=createCen04ProductLicensePort({consumer,organizationId:ORG});
 assert.throws(()=>port.receive({organizationId:ORG,license:{},statusEnvelope:{}}),/CEN04_T3_DURABLE_READBACK_REQUIRED/);
});
test('port rejects malformed T3 consumer licensed seats even if view says verified',()=>{
 const consumer=fixture();const original=consumer.receive;
 consumer.receive=()=>({...original(),activeSeats:4});
 const port=createCen04ProductLicensePort({consumer,organizationId:ORG});
 assert.throws(()=>port.receive({organizationId:ORG,license:{},statusEnvelope:{}}),/CEN04_OWNER_VERIFIED_RECEIPT_REQUIRED/);
});
