import test from 'node:test';
import assert from 'node:assert/strict';
import {createCorporateOwnerHost} from '../runtime/cen-corporate-owner-host.mjs';

const A='a'.repeat(64),B='b'.repeat(64);
const binding={organizationId:'org:1',workspaceId:'work:1',contextEpoch:1};
function owner(){
 const calls=[];
 const state={product:'admin',productionActivation:true,T3_READY:true,organizationId:'org:1',workspaceId:'work:1',
   personId:'person:1',contextEpoch:1,task:{id:'task:1',taskRevisionId:B},
   packages:[],application:{status:'NOT_PRESENT',records:[],externalContextCoreApplied:false}};
 return {product:'admin',state,calls,snapshot:()=>structuredClone(state),
  taskBytes(){calls.push('taskBytes');return Buffer.from('owner-signed-carrier')},
  receive(bytes){calls.push(['receive',Buffer.from(bytes)]);state.packages.push(A);return {transportReceipt:{packageSha256:A,state:'RECEIVED'}}},
  review(hash){calls.push(['review',hash]);return {preview:{packageSha256:hash,previewDigest:'preview'},verificationState:'VERIFIED'}},
  decide(hash,input){calls.push(['decide',hash,input]);return {acceptanceState:'ACCEPTED'}},
  close(){calls.push('close')}
 };
}
test('CEN host dispatch delegates signed carrier and received result to source owner',async()=>{
 const runtime=owner(),host=createCorporateOwnerHost({runtime});
 const snapshot=host.state({organizationId:'org:1'});
 assert.equal(snapshot.status,'OWNER_READY');
 const bytes=await host.action({organizationId:'org:1',operation:'exportIssuedTask',
   binding,input:{taskId:'task:1',taskRevisionId:B}});
 assert.deepEqual(Buffer.from(bytes.bytes),Buffer.from('owner-signed-carrier'));
 assert.equal(bytes.deliveryState,'NOT_CONFIRMED');
 const receipt=await host.action({organizationId:'org:1',operation:'receive',
   binding,input:{bytes:[80,75,3,4]}});
 assert.equal(receipt.transportReceipt.packageSha256,A);
 assert.deepEqual(runtime.calls.slice(0,2),['taskBytes',['receive',Buffer.from([80,75,3,4])]]);
 const inspection=await host.action({organizationId:'org:1',operation:'inspect',
   binding,input:{packageSha256:A}});
 assert.equal(inspection.verificationState,'VERIFIED');
 const accepted=await host.action({organizationId:'org:1',operation:'decide',
   binding,input:{packageSha256:A,previewDigest:'preview',decision:'ACCEPT'}});
 assert.equal(accepted.acceptanceState,'ACCEPTED');
 assert.equal(runtime.calls.at(-1)[0],'decide');
});
test('CEN host rejects unverified organization, bytes, unknown action and issuance resolver absence',async()=>{
 const runtime=owner(),host=createCorporateOwnerHost({runtime});
 assert.throws(()=>host.state({organizationId:'org:2'}),/ORGANIZATION_MISMATCH/);
 await assert.rejects(()=>host.action({organizationId:'org:2',operation:'receive',binding,
   input:{bytes:[1]}}),/ORGANIZATION_MISMATCH/);
 await assert.rejects(()=>host.action({organizationId:'org:1',operation:'receive',binding,
   input:{bytes:[256]}}),/PACKAGE_BYTES_INVALID/);
 await assert.rejects(()=>host.action({organizationId:'org:1',operation:'applyWithoutReview',binding}),
   /OPERATION_NOT_SUPPORTED/);
 await assert.rejects(()=>host.action({organizationId:'org:1',operation:'issue',binding,
   input:{assignmentId:'draft:1'}}),/ASSIGNMENT_RESOLVER_REQUIRED/);
 assert.deepEqual(runtime.calls,[]);
});
test('CEN host verifies authoritative assignment mapping before issue',async()=>{
 const runtime=owner();
 const host=createCorporateOwnerHost({runtime,resolveAssignment:async()=>({
   organization:{id:'org:wrong'},assignment:{id:'draft:1'},binding})});
 await assert.rejects(()=>host.action({organizationId:'org:1',operation:'issue',binding,
   input:{assignmentId:'draft:1'}}),/ASSIGNMENT_MISMATCH/);
 assert.deepEqual(runtime.calls,[]);
});

test('CEN host exposes only real owner staff and operator selections with fresh epoch',async()=>{
 const runtime=owner(),host=createCorporateOwnerHost({runtime});
 const staff={id:'staff:1',personId:'person:employee',workspaceId:'work:employee',name:'Employee'};
 runtime.state.staff=[staff];
 runtime.state.operators=[{id:'operator:1',personId:'person:manager',name:'Manager'}];
 runtime.selectStaff=id=>{
   runtime.calls.push(['selectStaff',id]);runtime.state.selectedStaffId=id;
   runtime.state.personId=staff.personId;runtime.state.workspaceId=staff.workspaceId;
   runtime.state.contextEpoch++;return {staffId:id,contextEpoch:runtime.state.contextEpoch};
 };
 runtime.selectOperator=id=>{
   runtime.calls.push(['selectOperator',id]);runtime.state.selectedOperatorId=id;
   runtime.state.contextEpoch++;return {operatorId:id,contextEpoch:runtime.state.contextEpoch};
 };
 assert.deepEqual(runtime.calls,[]);
 const selected=await host.action({organizationId:'org:1',operation:'selectStaff',
   input:{staffId:'staff:1'},binding});
 assert.equal(selected.contextEpoch,2);
 assert.equal(host.state({organizationId:'org:1'}).snapshot.personId,staff.personId);
 await assert.rejects(()=>host.action({organizationId:'org:1',operation:'selectOperator',
   input:{operatorId:'operator:1'},binding}),/T3_CONTEXT_CHANGED/);
 const updated={organizationId:'org:1',workspaceId:staff.workspaceId,contextEpoch:2};
 const switched=await host.action({organizationId:'org:1',operation:'selectOperator',
   input:{operatorId:'operator:1'},binding:updated});
 assert.equal(switched.contextEpoch,3);
 assert.equal(host.state({organizationId:'org:1'}).snapshot.selectedOperatorId,'operator:1');
 assert.deepEqual(runtime.calls,[['selectStaff','staff:1'],['selectOperator','operator:1']]);
});
test('CEN host never selects employees without owner activation or genuine source method',async()=>{
 const runtime=owner(),host=createCorporateOwnerHost({runtime});
 runtime.state.staff=[{id:'staff:1',personId:'person:1',workspaceId:'work:1'}];
 await assert.rejects(()=>host.action({organizationId:'org:1',operation:'selectStaff',
   input:{staffId:'staff:1'},binding}),/T3_STAFF_SELECTION_NOT_CONNECTED/);
 runtime.state.productionActivation=false;
 await assert.rejects(()=>host.action({organizationId:'org:1',operation:'selectStaff',
   input:{staffId:'staff:1'},binding}),/CEN_OWNER_PRODUCTION_NOT_ACTIVATED/);
 assert.deepEqual(runtime.calls,[]);
});
test('original T3 qualification flags cannot activate Center corporate actions',async()=>{
 const runtime=owner(),host=createCorporateOwnerHost({runtime});
 runtime.state.productionActivation=false;runtime.state.T3_READY=false;
 const view=host.state({organizationId:'org:1'});
 assert.equal(view.status,'REFERENCE_ONLY');
 assert.equal(view.snapshot.productionActivation,false);
 assert.equal(view.snapshot.T3_READY,false);
 assert.equal(view.snapshot.task,undefined);
 await assert.rejects(()=>host.action({organizationId:'org:1',operation:'receive',
   binding,input:{bytes:[80,75,3,4]}}),/CEN_OWNER_PRODUCTION_NOT_ACTIVATED/);
 assert.deepEqual(runtime.calls,[]);
});
test('missing single T3 activation flag is never sufficient for readiness',async()=>{
 const runtime=owner(),host=createCorporateOwnerHost({runtime});
 for(const flags of [[true,false],[false,true],[undefined,true],[true,undefined]]){
   runtime.state.productionActivation=flags[0];
   runtime.state.T3_READY=flags[1];
   assert.equal(host.state({organizationId:'org:1'}).status,'REFERENCE_ONLY');
   await assert.rejects(()=>host.action({organizationId:'org:1',operation:'inspect',
     binding,input:{packageSha256:A}}),/PRODUCTION_NOT_ACTIVATED/);
 }
 assert.deepEqual(runtime.calls,[]);
});
