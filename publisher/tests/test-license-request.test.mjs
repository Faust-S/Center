import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyPublisherDraft, applyPublisherDraftCommand} from '../src/preparation.mjs';
import {emptyDraft as emptyAdminDraft, applyDraftCommand as applyAdminCommand} from '../../src/organization.mjs';
import {prepareTestLicenseRequest, validateTestLicenseRequest, encodeTestLicenseRequest, decodeTestLicenseRequest, suggestedTestRequestFileName} from '../src/test-license-request.mjs';

function fixture(kind='ORGANIZATION',productId='IWXA_ADMIN_CENTER',features=['WORKSPACE']){
  let s=emptyPublisherDraft();
  s=applyPublisherDraftCommand(s,{kind:'addProduct',id:productId,name:'Test product',version:'0.3.0'});
  s=applyPublisherDraftCommand(s,{kind:'addHolder',id:'11111111-1111-4111-8111-111111111111',name:'Test holder',type:kind});
  s=applyPublisherDraftCommand(s,{kind:'addProposal',holderId:s.holders[0].id,productId,features,termDays:90});
  return s;
}
test('Publisher exports a stable, bounded, explicit UNSIGNED TEST request; no license, signer, authority or acceptance',()=>{
  const d=fixture(),proposalId=d.proposals[0].id;
  const one=prepareTestLicenseRequest(d,{proposalId,seats:8}),two=prepareTestLicenseRequest(d,{proposalId,seats:8});
  assert.deepEqual(one,two);
  assert.deepEqual(decodeTestLicenseRequest(encodeTestLicenseRequest(one)),one);
  assert.equal(one.product.id,'IWXA_ADMIN_CENTER');
  assert.equal(one.product.version,'0.3.0');
  assert.equal(one.subject.type,'ORGANIZATION');
  assert.equal(one.subject.id,d.holders[0].id);
  assert.equal(one.status,'UNSIGNED_REQUEST');
  assert.equal(one.seats,8);
  assert.equal(one.termDays,90);
  assert.equal(one.requestId,proposalId);
  const serialized=encodeTestLicenseRequest(one);
  assert.ok(!/"(?:signature|licenseId|issuerAuthorityId|signingKey|grants|authorized)"\s*:/i.test(serialized));
  assert.match(suggestedTestRequestFileName(one),/^iwxa-test-license-request-[A-Za-z0-9-]+\.json$/);
});
test('scoped TEST issuer request refuses a PERSONAL holder, Control Center and arbitrary products',()=>{
  for(const [holder,product] of [['PERSON','IWXA_ADMIN_CENTER'],['PERSON','IWXA_CONTROL_CENTER'],['ORGANIZATION','OTHER_PRODUCT']]){
    const d=fixture(holder,product);
    assert.throws(()=>prepareTestLicenseRequest(d,{proposalId:d.proposals[0].id,seats:1}),{code:'TEST_REQUEST_SCOPE_NOT_SUPPORTED'});
  }
});
test('request subject binds exactly to the original Admin Center organization draft identity',()=>{
  const original='11111111-1111-4111-8111-111111111111';
  const admin=applyAdminCommand(emptyAdminDraft(),{type:'CREATE_ORGANIZATION',name:'Source organization',kind:'ORGANIZATION'},{
    id:()=>original, now:()=>new Date('2026-11-08T00:00:00.000Z').toISOString()
  });
  const publisher=fixture();
  const request=prepareTestLicenseRequest(publisher,{proposalId:publisher.proposals[0].id,seats:4});
  assert.equal(request.subject.id,admin.organizations[0].id);
  assert.equal(request.subject.type,'ORGANIZATION');
  assert.equal(request.seats,4);
  assert.equal(request.status,'UNSIGNED_REQUEST');
  assert.equal(admin.organizations[0].id,admin.activeOrganizationId);
});
test('legacy generated placeholder holder IDs are not authoritative source identities',()=>{
 const d=fixture();
 d.holders[0].id='holder:synthetic';
 d.proposals[0].holderId='holder:synthetic';
 assert.throws(()=>prepareTestLicenseRequest(d,{proposalId:d.proposals[0].id,seats:1}),{code:'TEST_REQUEST_SOURCE_ORGANIZATION_ID_REQUIRED'});
});
test('issuer request cannot be generated for empty or unselected features, wrong proposal ID or extra fields',()=>{
  const d=fixture('ORGANIZATION','IWXA_ADMIN_CENTER',[]);
  assert.throws(()=>prepareTestLicenseRequest(d,{proposalId:d.proposals[0].id,seats:1}),{code:'TEST_REQUEST_FEATURES_INVALID'});
  assert.throws(()=>prepareTestLicenseRequest(d,{proposalId:'proposal:unknown',seats:1}),{code:'TEST_REQUEST_PROPOSAL_NOT_FOUND'});
  const valid=fixture(),r=prepareTestLicenseRequest(valid,{proposalId:valid.proposals[0].id,seats:3});
  assert.throws(()=>decodeTestLicenseRequest(JSON.stringify({...r,signature:'forged'})),{code:'TEST_REQUEST_FIELDS_INVALID'});
  assert.throws(()=>decodeTestLicenseRequest(JSON.stringify({...r,status:'ISSUED'})),{code:'TEST_REQUEST_SCHEMA_OR_STATUS_INVALID'});
  assert.throws(()=>decodeTestLicenseRequest(JSON.stringify({...r,environment:'PRODUCTION'})),{code:'TEST_REQUEST_SCHEMA_OR_STATUS_INVALID'});
  assert.throws(()=>decodeTestLicenseRequest(JSON.stringify({...r,licenseId:'license:forged'})),{code:'TEST_REQUEST_FIELDS_INVALID'});
});
test('issuer request never represents expanded license subjects, seats or duration',()=>{
  const d=fixture(),requestId=d.proposals[0].id;
  for (const seats of [-1,0,10001,1.5,NaN,Infinity,'8',null]){
    assert.throws(()=>prepareTestLicenseRequest(d,{proposalId:requestId,seats}),{code:'TEST_REQUEST_SEATS_INVALID'});
  }
  const r=prepareTestLicenseRequest(d,{proposalId:requestId,seats:1});
  for(const v of [{...r,featureIds:['WORKSPACE','WORKSPACE']},{...r,featureIds:[]},{...r,featureIds:['../disk']}]){
    assert.throws(()=>validateTestLicenseRequest(v),{code:'TEST_REQUEST_FEATURES_INVALID'});
  }
});
test('issuer request cannot bypass original product-scoped entitlement semantics',()=>{
  const d=fixture(),r=prepareTestLicenseRequest(d,{proposalId:d.proposals[0].id,seats:2});
  assert.ok(!('domainId' in r.product));
  assert.ok(!('domainRegistryVersion' in r));
  assert.ok(!('kind' in r.product));
  assert.notEqual(r.schema,'IWXA_T3_LICENSE/1');
});
