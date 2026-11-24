import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareEmployeeDraftTask as prepare,employeeDraftSelectionCurrent as current,verifyEmployeeDraftSources as verify} from '../src/corporate-draft-task.mjs';
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
