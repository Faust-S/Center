import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareEmployeeDraftTask as prepare,employeeDraftSelectionCurrent as current,verifyEmployeeDraftSources as verify,prepareCorporateDraftTask,readAppliedD3Result} from '../src/corporate-draft-task.mjs';
const scope={organizationId:'org:one',workspaceId:'workspace:one',actorId:'person:manager',
 employeePersonId:'person:worker',enrollmentId:'enrollment:worker',contextId:'context:one',contextEpoch:7};
const draft={id:'draft:one',status:'DRAFT',workspaceId:scope.workspaceId,editNumber:2,
 title:'Supplier invoice',description:'12 units at 45',criteria:'Check total',dueDate:'2026-12-01',
 assigneeId:'contact:local',reviewerId:null,atlasRef:null,sourceResultRef:null};
test('local draft prepares complete text for the exact signed employee without creating an identity or Task',()=>{
 const source=prepare(draft,scope);
 assert.match(source.text,/Supplier invoice/);
 assert.match(source.text,/Критерии приёмки: Check total/);
 assert.match(source.text,/Срок: 2026-12-01/);
 assert.match(source.text,/draft:one, редакция 2/);
 assert.equal(source.taskId,undefined);
 assert.equal(source.grant,undefined);
 assert.equal(current(source,draft,scope,source.text,true),true);
 assert.equal(current(source,draft,scope,source.text,false),false);
 for(const candidate of [{...draft,editNumber:3},{...draft,description:'changed'},
   {...draft,assigneeId:'contact:another'},{...draft,workspaceId:'workspace:foreign'}])
   assert.equal(current(source,candidate,scope,source.text,true),false);
 assert.equal(current(source,draft,{...scope,employeePersonId:'person:other'},source.text,true),false);
 assert.equal(current(source,draft,{...scope,contextEpoch:8},source.text,true),false);
 assert.equal(current(source,draft,{...scope,contextId:'context:other'},source.text,true),false);
 assert.throws(()=>prepare(draft,{...scope,contextEpoch:NaN}),/SOURCE_INVALID/);
 assert.equal(current(source,draft,scope,source.text+' modified',true),false);
 assert.throws(()=>prepare({...draft,status:'SIGNED'},scope),/SOURCE_INVALID/);
});
test('original Result source is re-read in the exact signed workspace before new issuance',async()=>{
 const resultRef={organizationId:scope.organizationId,workspaceId:scope.workspaceId,taskId:'task:source',
   taskRevisionId:'a'.repeat(64),resultRevisionId:'b'.repeat(64),acceptanceId:'acceptance:one'};
 const source=prepare({...draft,sourceResultRef:resultRef},scope);
 const row={...resultRef,executorId:'person:worker',result:'Accepted result'};
 const observed={status:'D3_OWNER_READY',snapshot:{product:'admin',...scope,application:{
   status:'LOCAL_ENCRYPTED_STORE_CONFIRMED',externalContextCoreApplied:false,records:[row]}}};
 let reads=0;
 await verify(source,scope,async(cmd,args)=>{reads++;assert.equal(cmd,'center_corporate_state');assert.equal(args.organizationId,scope.organizationId);return observed;});
 assert.equal(reads,1);
 for(const snapshot of [{...observed.snapshot,contextEpoch:8},{...observed.snapshot,actorId:'person:other'},
   {...observed.snapshot,application:{...observed.snapshot.application,records:[{...row,acceptanceId:'acceptance:other'}]}}]){
   await assert.rejects(verify(source,scope,async()=>({...observed,snapshot})),/RESULT_SOURCE_CHANGED/);
 }
 await assert.rejects(verify(source,scope,async()=>({status:'NOT_CONNECTED'})),/RESULT_SOURCE_CHANGED/);
});
test('ordinary draft preparation does not invoke Atlas or original Result owner',async()=>{
 let calls=0;
 await verify(prepare(draft,scope),scope,async()=>{calls++;throw Error('UNEXPECTED');});
 await assert.rejects(verify(prepare(draft,scope),{...scope,contextEpoch:8},async()=>{calls++;}),/DRAFT_CHANGED_BEFORE_SIGNING/);
 assert.equal(calls,0);
});

test('manager and employee drafts share the same canonical signed assignment text',()=>{
 const direct=prepareCorporateDraftTask(draft,scope);
 const employee=prepare(draft,scope);
 assert.equal(direct.text,employee.text);
 assert.equal(direct.snapshot,employee.snapshot);
 assert.deepEqual(direct.atlasRef,employee.atlasRef);
 assert.deepEqual(direct.sourceResultRef,employee.sourceResultRef);
 assert.equal(Object.hasOwn(direct,'scope'),false);
 assert.throws(()=>prepareCorporateDraftTask({...draft,workspaceId:'workspace:other'},scope));
});

test('signed D3 follow-up source is re-read through the original candidate and Kernel recovery, including the separate receipt Workspace',async()=>{
 const source={organizationId:scope.organizationId,workspaceId:scope.workspaceId,taskId:'task:source',
   taskRevisionId:'a'.repeat(64),resultRevisionId:'b'.repeat(64),acceptanceId:'c'.repeat(64)};
 const physical='workspace:registry:'+'d'.repeat(64),effect='e'.repeat(64);
 const signed={...scope,d3ApplyRecoverAvailable:true,d3ApplicationReceiptWorkspaceId:physical};
 const target={consumerId:'IWXA_ADMIN_CENTER',processId:'admin.applied-results',processVersion:'1.0.0',
   purpose:'application.apply',subjectId:scope.organizationId,workspaceId:scope.workspaceId,dataRootId:'root:one'};
 const candidate={schema:'IWXA_T3_APPLICATION_PROJECTION_CANDIDATE/1',
   status:'CANDIDATE_REQUIRES_INDEPENDENT_HOST_AUTHORIZATION',source:{acceptanceId:source.acceptanceId},
   applicationAttempted:false,applicationAuthorized:false,externalContextCoreApplied:false,
   target,changes:[{...source,executorId:'person:worker'}]};
 const row={...source,executorId:'person:worker',result:'Original Result'};
 const recovered={status:'ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED',effectKey:effect,
   kernelWriteReadback:'CONFIRMED',automaticRetryAllowed:false,externalProductAcceptance:'NOT_ACCEPTED',
   originalKernelReadback:{object:{workspace_id:physical,object_id:'result:applied:'+effect,revision:1,
     schema_id:'iwxa.admin.applied-results',schema_version:'1.0.0',
     data:{schema:'IWXA_T3_ADMIN_APPLIED_RESULTS/1',records:[row]}}},
   originalEventReadback:{workspace_id:physical,event_id:'event:one',event_type:'iwxa.admin.result.applied',
     object_id:'result:applied:'+effect,revision:1,idempotency_key:effect,
     payload:{reconciliation_acceptance_id:source.acceptanceId,reconciliation_revision_ids:[source.resultRevisionId]}}};
 const selection=prepare({...draft,sourceResultRef:source},scope);
 const invoke=async()=>({status:'D3_OWNER_READY',snapshot:signed});
 let calls=[];
 await verify(selection,scope,invoke,async(op,input)=>{
   calls.push(op);
   assert.equal(input.acceptanceId,source.acceptanceId);
   assert.deepEqual(input.revisionIds,[source.resultRevisionId]);
   if(op==='d3InspectAccepted')return candidate;
   assert.equal(op,'d3RecoverApplied');assert.deepEqual(input.target,target);return recovered;
 });
 assert.deepEqual(calls,['d3InspectAccepted','d3RecoverApplied']);
 for(const invalid of [
   {...recovered,status:'OUTCOME_UNKNOWN'},
   {...recovered,originalEventReadback:{...recovered.originalEventReadback,idempotency_key:'f'.repeat(64)}},
   {...recovered,originalKernelReadback:{object:{...recovered.originalKernelReadback.object,
      data:{schema:'IWXA_T3_ADMIN_APPLIED_RESULTS/1',records:[{...row,taskRevisionId:'f'.repeat(64)}]}}}},
   {...recovered,originalKernelReadback:{object:{...recovered.originalKernelReadback.object,workspace_id:'workspace:other'}}}
 ])await assert.rejects(verify(selection,scope,invoke,async op=>op==='d3InspectAccepted'?candidate:invalid),/RESULT_SOURCE_CHANGED/);
 await assert.rejects(verify(selection,scope,invoke,async()=>({...candidate,changes:[{...candidate.changes[0],taskId:'task:other'}]})),/RESULT_SOURCE_CHANGED/);
 await assert.rejects(verify(selection,scope,invoke),/RESULT_SOURCE_CHANGED/);
});

test('grouped original application returns only the selected Result and preserves the recovery set',async()=>{
 const source={organizationId:scope.organizationId,workspaceId:scope.workspaceId,taskId:'task:source',
   taskRevisionId:'a'.repeat(64),resultRevisionId:'b'.repeat(64),acceptanceId:'c'.repeat(64),
   applicationRevisionIds:['f'.repeat(64),'b'.repeat(64)]};
 const ids=[...source.applicationRevisionIds].sort(),effect='e'.repeat(64);
 const target={consumerId:'IWXA_ADMIN_CENTER',processId:'admin.applied-results',processVersion:'1.0.0',
   purpose:'application.apply',subjectId:scope.organizationId,workspaceId:scope.workspaceId,dataRootId:'root:one'};
 const {applicationRevisionIds,...rowRef}=source;
 const first={...rowRef,executorId:'person:worker',result:'Selected text'};
 const second={...rowRef,taskId:'task:other',taskRevisionId:'d'.repeat(64),
   resultRevisionId:ids[1],executorId:'person:other',result:'Do not copy'};
 const records=[second,first];
 const candidate={schema:'IWXA_T3_APPLICATION_PROJECTION_CANDIDATE/1',
   status:'CANDIDATE_REQUIRES_INDEPENDENT_HOST_AUTHORIZATION',source:{acceptanceId:source.acceptanceId},
   applicationAttempted:false,applicationAuthorized:false,externalContextCoreApplied:false,
   target,changes:records.map(({taskId,taskRevisionId,resultRevisionId,executorId})=>({taskId,taskRevisionId,resultRevisionId,executorId}))};
 const recovered={status:'ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED',effectKey:effect,
   kernelWriteReadback:'CONFIRMED',automaticRetryAllowed:false,externalProductAcceptance:'NOT_ACCEPTED',
   originalKernelReadback:{object:{workspace_id:scope.workspaceId,object_id:'result:applied:'+effect,revision:1,
     schema_id:'iwxa.admin.applied-results',schema_version:'1.0.0',
     data:{schema:'IWXA_T3_ADMIN_APPLIED_RESULTS/1',records}}},
   originalEventReadback:{workspace_id:scope.workspaceId,event_id:'event:one',event_type:'iwxa.admin.result.applied',
     object_id:'result:applied:'+effect,revision:1,idempotency_key:effect,
     payload:{reconciliation_acceptance_id:source.acceptanceId,reconciliation_revision_ids:ids}}};
 const owner=async(op,input)=>{
   assert.deepEqual(input.revisionIds,ids);
   return op==='d3InspectAccepted'?candidate:recovered;
 };
 const read=await readAppliedD3Result(source,scope,owner);
 assert.equal(read.result,'Selected text');
 assert.deepEqual(read.source.applicationRevisionIds,ids);
 assert.equal(read.source.resultRevisionId,first.resultRevisionId);
 const prepared=prepare({...draft,sourceResultRef:read.source},scope);
 assert.deepEqual(prepared.sourceResultRef.applicationRevisionIds,ids);
 await verify(prepared,scope,async()=>({status:'D3_OWNER_READY',snapshot:{...scope,d3ApplyRecoverAvailable:true}}),owner);
 const invalids=[
   {...recovered,originalEventReadback:{...recovered.originalEventReadback,payload:{...recovered.originalEventReadback.payload,reconciliation_revision_ids:[ids[0]]}}},
   {...recovered,originalKernelReadback:{object:{...recovered.originalKernelReadback.object,data:{schema:'IWXA_T3_ADMIN_APPLIED_RESULTS/1',records:[first,first]}}}},
   {...recovered,originalKernelReadback:{object:{...recovered.originalKernelReadback.object,data:{schema:'IWXA_T3_ADMIN_APPLIED_RESULTS/1',records:[first,{...second,workspaceId:'workspace:other'}]}}}},
 ];
 for(const invalid of invalids)await assert.rejects(readAppliedD3Result(source,scope,async op=>op==='d3InspectAccepted'?candidate:invalid),/RESULT_SOURCE_CHANGED/);
 for(const invalid of [[ids[0],ids[0]],[ids[1],'9'.repeat(64)],[ids[0]],[ids[0],undefined]]){
   await assert.rejects(readAppliedD3Result({...source,applicationRevisionIds:invalid},scope,owner),/RESULT_SOURCE_CHANGED/);
 }
});
