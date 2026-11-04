import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftRepository} from '../runtime/t3-draft-repository.mjs';
import {createT3AdminPort} from '../runtime/t3-admin-port.mjs';
import {emptyDraft,applyDraftCommand} from '../src/organization.mjs';
import {empty as emptyAtlas,createProject,createItem} from '../vendor/atlas/src/core.mjs';
// Explicit contract doubles: these tests do not qualify signatures, T3 or native persistence.
function storeDouble() {let revision=0, bytes=null;return {read:()=>({revision,bytes}),write(expected,data){if(expected!==revision)throw Error('SUBJECT_CONCURRENT_REVISION');bytes=Buffer.from(data);return {revision:++revision};},close(){}};}
test('repository delegates commit and obtains same bytes on readback',()=>{const repo=createDraftRepository(storeDouble()),data=emptyDraft('2026-11-04T00:00:00Z');const saved=repo.save(data,0);assert.equal(saved.revision,1);assert.deepEqual(repo.load().draft,data);assert.throws(()=>repo.save(data,0),/CONCURRENT_REVISION/);});
test('failed write never reports persisted success',()=>{const repo=createDraftRepository({read:()=>({revision:0,bytes:null}),write(){throw Error('disk full');}});assert.throws(()=>repo.save(emptyDraft(),0),/disk full/);});
test('readback mismatch is visible',()=>{const repo=createDraftRepository({read:()=>({revision:0,bytes:null}),write:()=>({revision:1})});assert.throws(()=>repo.save(emptyDraft(),0),/READBACK_MISMATCH/);});
function runtimeDouble() {
 const calls=[];
 const state={organizationId:'org',workspaceId:'work',contextEpoch:1,personId:'person',
   application:{status:'LOCAL_ENCRYPTED_STORE_CONFIRMED',externalContextCoreApplied:false}};
 return {product:'admin',snapshot:()=>structuredClone(state),calls,state,
   decide(...args){calls.push(args);return {acceptanceState:'ACCEPTED'};},
   receive(){calls.push('RECEIVE');return {transportReceipt:{state:'RECEIVED',packageSha256:'a'.repeat(64)},preview:{classification:'NEW_REVISION'}};},
   review(hash){calls.push('REVIEW');return {hash,acceptanceState:'PENDING'};},
   previewApplication(args){calls.push('PREVIEW_APPLICATION');return {args,writeAllowed:false};},
   decideApplication(){calls.push('DECIDE_APPLICATION');return {status:'APPLICATION_DECISION_RECORDED',writeAllowed:false};},
   commitApplication(){calls.push('COMMIT_APPLICATION');return {status:'LOCAL_ENCRYPTED_STORE_CONFIRMED',externalContextCoreApplied:false};}
 };
}
const binding={organizationId:'org',workspaceId:'work',contextEpoch:1};
const PACKAGE_SHA='a'.repeat(64);
test('acceptance uses owning runtime and does not imply application',()=>{const runtime=runtimeDouble(),port=createT3AdminPort(runtime);const r=port.decide({packageSha256:'abc',previewDigest:'preview',decision:'ACCEPT',binding});assert.equal(r.acceptanceState,'ACCEPTED');assert.equal(runtime.calls.length,1);assert.deepEqual(runtime.calls[0],['abc',{previewDigest:'preview',decision:'ACCEPT',reason:''}]);assert.equal(r.applied,undefined);});
test('context switch prevents a stale decision',()=>{const runtime=runtimeDouble(),port=createT3AdminPort(runtime);runtime.state.contextEpoch++;assert.throws(()=>port.decide({decision:'ACCEPT',binding}),/CONTEXT_CHANGED/);assert.equal(runtime.calls.length,0);});
test('return for changes is not silently substituted with rejection',()=>{const runtime=runtimeDouble(),port=createT3AdminPort(runtime);assert.throws(()=>port.decide({decision:'CHANGES_REQUESTED',binding}),/RETURN_OPERATION_NOT_AVAILABLE/);assert.equal(runtime.calls.length,0);});
test('CEN02 receive and CEN03 review stay separate and never imply acceptance',()=>{
 const runtime=runtimeDouble(),port=createT3AdminPort(runtime);
 assert.throws(()=>port.inspect({bytes:Buffer.from('synthetic'),binding}),/T3_PACKAGE_SHA_REQUIRED/);
 assert.equal(runtime.calls.length,0);
 const ownerReceipt=port.receive({bytes:Buffer.from('contract-double'),binding});
 assert.equal(ownerReceipt.transportReceipt.packageSha256,PACKAGE_SHA);
 assert.equal(ownerReceipt.transportReceipt.state,'RECEIVED');
 assert.equal(ownerReceipt.acceptanceState,undefined);
 assert.equal(runtime.calls.length,1);
 assert.equal(runtime.calls[0],'RECEIVE');
 const preview=port.inspect({packageSha256:ownerReceipt.transportReceipt.packageSha256,binding});
 assert.equal(preview.acceptanceState,'PENDING');
 assert.equal(runtime.calls.length,2);
 assert.deepEqual(runtime.calls.slice(0,2),['RECEIVE','REVIEW']);
});
test('CEN02 requires the owning T3 nested transport receipt, including duplicate readback',()=>{
 const runtime=runtimeDouble(),port=createT3AdminPort(runtime);
 const duplicate={transportReceipt:{state:'RECEIVED',packageSha256:PACKAGE_SHA},
   preview:{classification:'DUPLICATE_ARCHIVE'}};
 runtime.receive=()=>duplicate;
 const received=port.receive({bytes:Buffer.from('synthetic signed carrier'),binding});
 assert.equal(received,duplicate);
 assert.equal(received.acceptanceState,undefined);
 runtime.receive=()=>({packageSha256:PACKAGE_SHA});
 assert.throws(()=>port.receive({bytes:Buffer.from('carrier'),binding}),/T3_RECEIPT_SHAPE_UNSUPPORTED/);
 runtime.receive=()=>({transportReceipt:{packageSha256:'not-sha256'}});
 assert.throws(()=>port.receive({bytes:Buffer.from('carrier'),binding}),/T3_RECEIPT_SHAPE_UNSUPPORTED/);
});
test('CEN03 application preview, explicit decision, commit and owner readback are distinct',()=>{
 const runtime=runtimeDouble(),port=createT3AdminPort(runtime);
 const preview=port.previewApplication({acceptanceId:'accepted',revisionIds:['rev1'],binding});
 assert.equal(preview.writeAllowed,false);
 assert.deepEqual(runtime.calls,['PREVIEW_APPLICATION']);
 const decision=port.decideApplication({previewId:'preview-id',previewDigest:'preview-digest',binding});
 assert.equal(decision.status,'APPLICATION_DECISION_RECORDED');
 assert.deepEqual(runtime.calls,['PREVIEW_APPLICATION','DECIDE_APPLICATION']);
 const committed=port.commitApplication({previewId:'preview-id',previewDigest:'preview-digest',binding});
 assert.equal(committed.status,'LOCAL_ENCRYPTED_STORE_CONFIRMED');
 assert.equal(committed.externalContextCoreApplied,false);
 assert.deepEqual(runtime.calls,['PREVIEW_APPLICATION','DECIDE_APPLICATION','COMMIT_APPLICATION']);
 assert.equal(port.applicationState({binding}).status,'LOCAL_ENCRYPTED_STORE_CONFIRMED');
});
test('stale organization context prevents receive, review and application commits',()=>{
 const runtime=runtimeDouble(),port=createT3AdminPort(runtime);
 runtime.state.contextEpoch=2;
 assert.throws(()=>port.receive({bytes:Buffer.from('test'),binding}),/T3_CONTEXT_CHANGED/);
 assert.throws(()=>port.inspect({packageSha256:PACKAGE_SHA,binding}),/T3_CONTEXT_CHANGED/);
 assert.throws(()=>port.commitApplication({previewId:'p',previewDigest:'d',binding}),/T3_CONTEXT_CHANGED/);
 assert.deepEqual(runtime.calls,[]);
});
test('without the owning application runtime Center cannot claim an applied result',()=>{
 const runtime=runtimeDouble();
 delete runtime.commitApplication;
 assert.throws(()=>createT3AdminPort(runtime).commitApplication({previewId:'p',previewDigest:'d',binding}),/T3_APPLY_NOT_CONNECTED/);
 assert.deepEqual(runtime.calls,[]);
});
test('wrong runtime cannot be bound',()=>assert.throws(()=>createT3AdminPort({product:'control'}),/ADMIN_RUNTIME_REQUIRED/));

function issueFixture() {
  let seq=0;
  const options={id:()=>`draft-${++seq}`,now:()=>'2026-11-04T12:00:00.000Z'};
  let state=emptyDraft(options.now()),act=command=>(state=applyDraftCommand(state,command,options));
  act({type:'CREATE_ORGANIZATION',name:'Manager'});
  const organizationId=state.activeOrganizationId;
  act({type:'ADD_WORKSPACE',organizationId,name:'Delivery'});
  act({type:'ADD_PARTICIPANT',organizationId,name:'Executor',roleLabel:'Staff'});
  act({type:'ADD_PARTICIPANT',organizationId,name:'Reviewer',roleLabel:'Lead'});
  const org=state.organizations[0],workspace=org.workspaces[0];
  const assignee=org.participants[0],reviewer=org.participants[1];
  const project=createProject(emptyAtlas(),{name:'Production plan',type:'business'});
  const work=createItem(project.state,project.id,{title:'Inspect goods'});
  const ref={projectId:project.id,workId:work.id,revision:String(work.state.revision)};
  act({type:'LINK_ATLAS_WORKSPACE',organizationId,workspaceId:workspace.id,
    atlasRef:{projectId:ref.projectId,revision:ref.revision}});
  act({type:'SAVE_ASSIGNMENT',organizationId,workspaceId:workspace.id,assigneeId:assignee.id,
    reviewerId:reviewer.id,title:'Inspect goods',description:'Check the quantity',
    criteria:'Signed inspection report',dueDate:'',atlasRef:ref});
  return {organization:state.organizations[0],assignment:state.organizations[0].assignments[0],
    observed:{organizationId,generation:'native-generation',snapshot:work.state},
    binding:{organizationId:'org',workspaceId:'work',contextEpoch:1,
      draftOrganizationId:organizationId,draftWorkspaceId:workspace.id,
      draftAssigneeId:assignee.id,draftReviewerId:reviewer.id,recipientId:'person'}};
}
function issuingRuntime() {
  const runtime=runtimeDouble();
  runtime.createTask=text=>{
    runtime.calls.push({type:'createTask',text});
    runtime.state.task={id:'task:owner',taskRevisionId:'revision:owner'};
    runtime.state.contextEpoch++;
    return Buffer.from('contract-double-not-a-real-signature');
  };
  return runtime;
}
test('T3 task issue requires native Atlas work and exact plan revision',async()=>{
  const f=issueFixture(),r=issuingRuntime();
  const port=createT3AdminPort(r,{openAtlas:async id=>{assert.equal(id,f.organization.id);return f.observed;}});
  const issued=await port.issue(f);
  assert.equal(r.calls.length,1);
  assert.match(r.calls[0].text,/Atlas work:/);
  assert.equal(issued.taskId,'task:owner');
  assert.equal(issued.taskRevisionId,'revision:owner');
  assert.deepEqual(issued.atlasRef,f.assignment.atlasRef);
  assert.equal(issued.deliveryState,'NOT_CONFIRMED');
});
test('T3 task issue fails closed without native source or when organization changes',async()=>{
  const f=issueFixture(),r=issuingRuntime();
  await assert.rejects(()=>createT3AdminPort(r).issue(f),/T3_ATLAS_OWNER_READER_REQUIRED/);
  await assert.rejects(()=>createT3AdminPort(r,{openAtlas:async()=>({...f.observed,organizationId:'other'})}).issue(f),
    /T3_ATLAS_ORGANIZATION_MISMATCH/);
  assert.equal(r.calls.length,0);
});
test('T3 task issue rejects stale revision, missing work and project-only link',async()=>{
  const f=issueFixture(),r=issuingRuntime(),port=createT3AdminPort(r,{openAtlas:async()=>f.observed});
  await assert.rejects(()=>port.issue({...f,assignment:{...f.assignment,
    atlasRef:{...f.assignment.atlasRef,revision:'1'}}}),/T3_ATLAS_REVISION_CHANGED/);
  await assert.rejects(()=>port.issue({...f,assignment:{...f.assignment,
    atlasRef:{...f.assignment.atlasRef,workId:'missing'}}}),/T3_ATLAS_WORK_NOT_IN_SOURCE/);
  await assert.rejects(()=>port.issue({...f,assignment:{...f.assignment,
    atlasRef:{projectId:f.assignment.atlasRef.projectId,revision:f.assignment.atlasRef.revision}}}),
    /T3_ATLAS_WORK_BINDING_REQUIRED/);
  assert.equal(r.calls.length,0);
});
test('T3 issue rechecks context epoch after native I/O and keeps reviewer binding',async()=>{
  const f=issueFixture(),r=issuingRuntime();
  const port=createT3AdminPort(r,{openAtlas:async()=>{r.state.contextEpoch++;return f.observed;}});
  await assert.rejects(()=>port.issue(f),/T3_CONTEXT_CHANGED/);
  const second=issuingRuntime(),port2=createT3AdminPort(second,{openAtlas:async()=>f.observed});
  await assert.rejects(()=>port2.issue({...f,binding:{...f.binding,draftReviewerId:'other'}}),
    /T3_DRAFT_BINDING_CHANGED/);
  assert.equal(r.calls.length,0);assert.equal(second.calls.length,0);
});
