import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyPublisherDraft,applyPublisherDraftCommand,encodePublisherDraft}
 from '../src/preparation.mjs';
import {CORPORATE_REQUEST_SCHEMA,
  prepareCorporateLicenseRequest as prepare,
  encodeCorporateLicenseRequest as encode,
  suggestedCorporateLicenseRequestFileName as filename
} from '../src/corporate-license-request.mjs';
function fixture(features=['PERSONAL_AGENT_CORPORATE']){
 let d=emptyPublisherDraft();
 d=applyPublisherDraftCommand(d,{kind:'addProduct',id:'IWXA_ADMIN_CENTER',name:'Admin',version:'0.5.0'});
 d=applyPublisherDraftCommand(d,{kind:'addHolder',id:'org:factory',name:'Factory',type:'ORGANIZATION'});
 d=applyPublisherDraftCommand(d,{kind:'addTariff',id:'TEAM',productId:'IWXA_ADMIN_CENTER',
   name:'Team',holderType:'ORGANIZATION',revision:2,
   features,termDays:365,productSeats:3,employeeLimit:10,deviceLimit:0,
   quotas:[{metric:'REPORTS',service:'LOCAL',unit:'COUNT',period:'MONTH',max:700}]});
 return applyPublisherDraftCommand(d,{kind:'addTariffProposal',productId:'IWXA_ADMIN_CENTER',
   holderId:'org:factory',tariffId:'TEAM',revision:2});
}
test('company request preserves exact signed candidate terms without any grant',()=>{
 const d=fixture(),before=encodePublisherDraft(d);
 const r=prepare(d,{proposalId:d.proposals[0].id,personalAgentSeats:4});
 assert.equal(r.schema,CORPORATE_REQUEST_SCHEMA);
 assert.equal(r.environment,'PRODUCTION');
 assert.equal(r.status,'UNSIGNED_REQUEST');
 assert.equal(r.subject.id,'org:factory');
 assert.deepEqual(r.tariff,{id:'TEAM',revision:2});
 assert.deepEqual(r.product,{id:'IWXA_ADMIN_CENTER',version:'0.5.0'});
 assert.equal(r.limits.adminCenterSeats,3);
 assert.equal(r.limits.employeeLimit,10);
 assert.equal(r.limits.personalAgentSeats,4);
 assert.deepEqual(r.limits.quotas,[{metric:'REPORTS',service:'LOCAL',
   unit:'COUNT',period:'MONTH',max:700}]);
 assert.equal(r.issuerAuthorityId,undefined);
 assert.equal(r.signature,undefined);
 assert.equal(r.activeSeats,undefined);
 assert.equal(encodePublisherDraft(d),before);
 assert.ok(filename(r).startsWith('iwxa-corporate-license-request-'));
 assert.equal(JSON.parse(encode(r)).requestId,r.requestId);
});
test('agent corporate place count must be explicit and cannot be inferred from staff',()=>{
 const d=fixture();const proposalId=d.proposals[0].id;
 assert.throws(()=>prepare(d,{proposalId}),{
   code:'CORPORATE_REQUEST_AGENT_SEATS_INVALID'});
 assert.throws(()=>prepare(d,{proposalId,personalAgentSeats:11}),{
   code:'CORPORATE_REQUEST_AGENT_SEATS_INVALID'});
 assert.throws(()=>prepare(d,{proposalId,personalAgentSeats:-1}),{
   code:'CORPORATE_REQUEST_AGENT_SEATS_INVALID'});
 assert.equal(prepare(d,{proposalId,personalAgentSeats:0}).limits.personalAgentSeats,0);
 const noFeature=fixture(['CORPORATE_TASKS']);
 assert.throws(()=>prepare(noFeature,{proposalId:noFeature.proposals[0].id,
   personalAgentSeats:2}),{code:'CORPORATE_REQUEST_AGENT_FEATURE_NOT_SELECTED'});
});
test('cannot claim a production license by relabeling the unsigned request',()=>{
 const d=fixture(),r=prepare(d,{proposalId:d.proposals[0].id,personalAgentSeats:3});
 assert.throws(()=>encode({...r,kind:'LICENSE'}),{
   code:'CORPORATE_REQUEST_UNSIGNED_PROFILE_REQUIRED'});
 assert.throws(()=>encode({...r,environment:'TEST'}),{
   code:'CORPORATE_REQUEST_UNSIGNED_PROFILE_REQUIRED'});
 assert.throws(()=>encode({...r,status:'ACTIVE'}),{
   code:'CORPORATE_REQUEST_UNSIGNED_PROFILE_REQUIRED'});
});
