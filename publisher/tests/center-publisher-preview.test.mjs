import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDraft,applyDraftCommand} from '../../src/organization.mjs';
import {emptyPublisherDraft,applyPublisherDraftCommand} from '../../publisher/src/preparation.mjs';
import {prepareTestLicenseRequest} from '../../publisher/src/test-license-request.mjs';
import {simulateIssuerEvent} from '../../publisher/src/issuer-simulation.mjs';
import {previewSimulatedPublisherSeats} from '../cen04-publisher-preview.mjs';
const NOW='2026-11-08T14:00:00.000Z',ORG='00000000-0000-4000-8000-000000000001';
function fixture(){
 let center=applyDraftCommand(emptyDraft(),{type:'CREATE_ORGANIZATION',kind:'ORGANIZATION',name:'Training company'},{
   id:()=>ORG,now:()=>NOW});
 center=applyDraftCommand(center,{type:'ADD_PARTICIPANT',organizationId:ORG,name:'Employee',roleLabel:'operator'},{
   id:()=> 'participant:1',now:()=>NOW});
 center=applyDraftCommand(center,{type:'PLAN_PERSONAL_AGENT_ACCESS',organizationId:ORG,participantId:'participant:1',plan:'PLANNED'},{
   now:()=>NOW});
 let pub=emptyPublisherDraft();
 pub=applyPublisherDraftCommand(pub,{kind:'addProduct',id:'IWXA_ADMIN_CENTER',name:'Admin',version:'0.3.0'});
 pub=applyPublisherDraftCommand(pub,{kind:'addHolder',id:ORG,name:'Training company',type:'ORGANIZATION'});
 pub=applyPublisherDraftCommand(pub,{kind:'addProposal',productId:'IWXA_ADMIN_CENTER',holderId:ORG,features:['WORKSPACE'],termDays:30});
 const request=prepareTestLicenseRequest(pub,{proposalId:pub.proposals[0].id,seats:3});
 return {center,request};
}
const examine=(v)=>previewSimulatedPublisherSeats(v);
test('CEN04 independently matches exact Admin organization and counts modeled seats with 0 real rights',()=>{
 const {center,request}=fixture(),before=JSON.stringify(center);
 const event=simulateIssuerEvent(request,{observedAt:NOW,sequence:1});
 const r=examine({centerDraft:center,request,event,observedAt:NOW});
 assert.equal(r.state,'MATCHED_TEST_SIMULATION');
 assert.equal(r.modeledRequestedSeats,3);
 assert.equal(r.modeledPlannedSeats,1);
 assert.equal(r.modeledUnassignedCapacity,2);
 assert.equal(r.actualLicensedSeats,0);
 assert.equal(r.actualGrantedSeats,0);
 assert.equal(r.signedLicenseVerified,false);
 assert.equal(r.canAssignSeats,false);
 assert.equal(r.canActivateProduct,false);
 assert.equal(JSON.stringify(center),before);
});
test('different organization, context or forged requested seats are never previewed as matched',()=>{
 const {center,request}=fixture();
 const event=simulateIssuerEvent(request,{observedAt:NOW});
 const changedOrg={...request,subject:{...request.subject,id:'00000000-0000-4000-8000-000000000099'}};
 let r=examine({centerDraft:center,request:changedOrg,event,observedAt:NOW});
 assert.equal(r.state,'ORGANIZATION_NOT_FOUND');
 const other=structuredClone(center);other.activeOrganizationId=null;
 r=examine({centerDraft:other,request,event,observedAt:NOW});
 assert.equal(r.state,'ORGANIZATION_CONTEXT_CHANGED');
 r=examine({centerDraft:center,request:{...request,seats:99},event,observedAt:NOW});
 assert.equal(r.state,'REQUEST_BINDING_CHANGED');
 for(const result of [r])assert.equal(result.actualLicensedSeats,0);
});
test('simulated suspension, revocation, expiry and stale sequence never grant rights',()=>{
 const {center,request}=fixture();
 const cases=[
  [{decision:'SIMULATED_REVOKED',sequence:3},'SIMULATED_REVOKED',NOW,0],
  [{decision:'SIMULATED_SUSPENDED',sequence:2},'SIMULATED_SUSPENDED',NOW,0],
  [{decision:'SIMULATED_ISSUED',sequence:1},'SIMULATED_EVENT_REPLAY',NOW,1],
  [{decision:'SIMULATED_ISSUED',sequence:1},'SIMULATED_EVENT_EXPIRED','2027-02-01T00:00:00.000Z',0]
 ];
 for(const [settings,status,now,floor] of cases){
   const event=simulateIssuerEvent(request,{observedAt:NOW,...settings});
   const r=examine({centerDraft:center,request,event,observedAt:now,priorSequenceFloor:floor});
   assert.equal(r.state,status);
   assert.equal(r.actualLicensedSeats,0);
   assert.equal(r.canAssignSeats,false);
 }
});
test('simulated future issuer event is held and cannot become real license',()=>{
 const {center,request}=fixture();
 const event=simulateIssuerEvent(request,{observedAt:'2026-12-08T14:00:00.000Z'});
 const result=examine({centerDraft:center,request,event,observedAt:NOW});
 assert.equal(result.state,'SIMULATED_EVENT_IN_FUTURE');
 assert.equal(result.actualGrantedSeats,0);
});
test('consumer rejects corrupt simulation fields and does not persist them in organization',()=>{
 const {center,request}=fixture();
 const event=simulateIssuerEvent(request,{observedAt:NOW});
 assert.throws(()=>examine({centerDraft:center,request,event:{...event,signature:'forged'},observedAt:NOW}));
 assert.throws(()=>examine({centerDraft:center,request,event:{...event,actualLicensedSeats:3},observedAt:NOW}));
 assert.throws(()=>examine({centerDraft:center,request,event,observedAt:NOW,priorSequenceFloor:-1}),{code:'CEN04_PREVIEW_SEQUENCE_FLOOR_INVALID'});
 assert.equal('licenses' in center,false);
});
