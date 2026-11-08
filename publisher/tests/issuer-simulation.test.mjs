import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyPublisherDraft,applyPublisherDraftCommand} from '../src/preparation.mjs';
import {prepareTestLicenseRequest} from '../src/test-license-request.mjs';
import {simulateIssuerEvent,validateSimulatedIssuerEvent,matchSimulatedEventToRequest} from '../src/issuer-simulation.mjs';
const now='2026-11-08T14:00:00.000Z';
function request(){
 let d=emptyPublisherDraft();
 d=applyPublisherDraftCommand(d,{kind:'addProduct',id:'IWXA_ADMIN_CENTER',name:'Admin',version:'0.3.0'});
 d=applyPublisherDraftCommand(d,{kind:'addHolder',id:'00000000-0000-4000-8000-000000000001',name:'Org',type:'ORGANIZATION'});
 d=applyPublisherDraftCommand(d,{kind:'addProposal',holderId:d.holders[0].id,productId:'IWXA_ADMIN_CENTER',features:['WORKSPACE'],termDays:30});
 return prepareTestLicenseRequest(d,{proposalId:d.proposals[0].id,seats:3});
}
test('test simulation outputs no license, signature, effective seats or signer authority',()=>{
 const r=request();
 const e=simulateIssuerEvent(r,{observedAt:now});
 assert.equal(e.status,'NOT_LICENSE');
 assert.equal(e.authority,false);
 assert.equal(e.effectiveSeats,0);
 assert.equal(e.origin,'TEST_MODEL_ONLY');
 assert.equal(e.decision,'SIMULATED_ISSUED');
 assert.deepEqual(validateSimulatedIssuerEvent(e),e);
 assert.equal(matchSimulatedEventToRequest(r,e),true);
 for(const field of ['licenseId','signature','signer','issuerAuthorityId','privateKey'])
   assert.ok(!Object.hasOwn(e,field));
});
test('simulation cannot impersonate real publisher or claim any rights',()=>{
 const e=simulateIssuerEvent(request(),{observedAt:now});
 for(const mutation of [
  {...e,status:'LICENSE_ACTIVE'},
  {...e,authority:true},
  {...e,effectiveSeats:3},
  {...e,origin:'T3'},
  {...e,signature:'fake'},
  {...e,decision:'PRODUCTION_ISSUED'},
  {...e,sequence:0}
 ])assert.throws(()=>validateSimulatedIssuerEvent(mutation));
});
test('subject/product/feature/seat edits after simulation are detected before review',()=>{
 const r=request(),e=simulateIssuerEvent(r,{observedAt:now});
 for(const modified of [
  {...r,seats:4},
  {...r,subject:{...r.subject,id:'different-org'}},
  {...r,product:{...r.product,version:'0.4.0'}},
  {...r,featureIds:['WORKSPACE','EXTRA']},
  {...r,termDays:45},
 ])assert.equal(matchSimulatedEventToRequest(modified,e),false);
});
test('same TEST request with reordered JSON object fields remains the same binding',()=>{
 const r=request(),e=simulateIssuerEvent(r,{observedAt:now});
 const reorder=o=>Object.fromEntries(Object.entries(o).reverse());
 const swapped=reorder({...r,product:reorder(r.product),subject:reorder(r.subject)});
 assert.equal(matchSimulatedEventToRequest(swapped,e),true);
});
test('simulation events can model suspension and revocation without authority',()=>{
 const r=request();
 const a=simulateIssuerEvent(r,{observedAt:now,decision:'SIMULATED_ISSUED',sequence:1});
 const b=simulateIssuerEvent(r,{observedAt:now,decision:'SIMULATED_SUSPENDED',sequence:2});
 const c=simulateIssuerEvent(r,{observedAt:now,decision:'SIMULATED_REVOKED',sequence:3});
 assert.deepEqual([a,b,c].map(x=>x.sequence),[1,2,3]);
 assert.ok([a,b,c].every(x=>x.effectiveSeats===0&&x.status==='NOT_LICENSE'));
});
