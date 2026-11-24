import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createCorporateOwnerHost} from '../runtime/cen-corporate-owner-host.mjs';
import {signedD3SessionFingerprint,
 signedD3EmployeeScopeFingerprint} from '../runtime/cen03-review.mjs';
import {MAX_CEN_D3_IWXA_CARRIER_BYTES,readOriginalResultReview,
 appendOriginalResultReview,readCompleteOriginalResult,
 validateOriginalSignedTaskReadback,validateOriginalEmployeeTaskIssueReceipt,
 validateOriginalEmployeeTaskReadback,employeeTaskContinuationKey,readEmployeeTaskContinuation,
 saveEmployeeTaskContinuation,clearEmployeeTaskContinuation,
 readOriginalEmployeeEnrollmentIdentity,readOriginalEmployeeCredentialIdentity,readEmployeeChallengeProof,
 inspectOriginalEmployeeWorkspaceRights,inspectOriginalEmployeeTaskGrant,
 readOriginalTaskCatalog,validateOriginalEmployeeCatalogReadback,validateOriginalEmployeeTaskExportReceipt,
 isDefiniteUndispatchedD3Failure,
 readOriginalApplicationTarget} from '../runtime/cen03-d3-owner.mjs';
import {MAX_CEN_IWXA_CARRIER_BYTES} from '../runtime/cen-corporate-owner-host.mjs';

const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);

test('corporate UI states that Atlas is optional for an ordinary T3 Task',()=>{
  const ui=readFileSync(new URL('../src/App.tsx',import.meta.url),'utf8');
  assert.doesNotMatch(ui,/Для эксплуатационного выпуска связь с Atlas обязательна/);
  assert.match(ui,/Обычное поручение и приёмка Result не требуют Atlas/);
  assert.match(ui,/Только проектные поручения требуют проверки точной редакции установленного Atlas/);
});

test('D3 generic signed Task UI does not eagerly import Atlas product modules',()=>{
  const source=readFileSync(new URL('../src/CorporateD3Panel.tsx',import.meta.url),'utf8');
  const head=source.slice(0,source.indexOf('export default function CorporateD3Panel'));
  assert.doesNotMatch(head,/from ['"]\.\/atlas-(?:native|integration)\.mjs['"]/,
    'a generic signed Task cannot depend on Atlas UI module startup');
  const begin=source.indexOf('const createSignedTask=');
  const end=source.indexOf('const recoverTaskById=',begin);
  assert.ok(begin>0&&end>begin,'original independent Task UI must still exist');
  const issue=source.slice(begin,end);
  const sourceSelection=issue.indexOf('const source=assignmentDrafts.find');
  const linkedOnly=issue.indexOf('if(source){',sourceSelection);
  const imports=issue.indexOf("import('./atlas-native.mjs')",linkedOnly);
  const strictRead=issue.indexOf("current!=='SOURCE_REVISION_MATCHES'",imports);
  const originalSigner=issue.indexOf("execute('d3CreateTask'",strictRead);
  assert.ok(sourceSelection>=0&&linkedOnly>sourceSelection&&imports>linkedOnly&&
    strictRead>imports&&originalSigner>strictRead,
    'only an explicit AtlasRef may load native Atlas and must preserve the currentness gate');
  assert.match(issue,/import\('\.\/atlas-integration\.mjs'\)/);
  assert.match(issue,/throw Error\('CEN_D3_ATLAS_SOURCE_REVISION_STALE'\)/);
});
test('independent employee signed Task accepts original native state, never first-person status',()=>{
 const scope={taskId:'task:work-verified',employeePersonId:'person:employee',
   enrollmentId:'enrollment:employee'};
 const real={schema:'IWXA_T3_ORIGINAL_EMPLOYEE_SIGNED_TASK/1',
   state:'SIGNED_TASK_CREATED_NOT_DELIVERED',taskId:scope.taskId,
   taskRevisionId:B,packageSha256:A,recipientId:scope.employeePersonId,
   enrollmentId:scope.enrollmentId,originalKernelStatusSequence:7,
   originalSigned:true,taskDelivered:false};
 assert.deepEqual(validateOriginalEmployeeTaskIssueReceipt(real,scope),real,
   'genuine signed independent employee Task must reach the UI as confirmed');
 const bads=[
  {state:undefined,status:'SIGNED_TASK_CREATED_NOT_DELIVERED'},
  {schema:'IWXA_T3_ORIGINAL_SIGNED_TASK/1'},
  {recipientId:'person:foreign'},
  {enrollmentId:'enrollment:foreign'},
  {taskId:'task:foreign'},
  {packageSha256:'c'.repeat(63)},
  {taskRevisionId:'f'.repeat(64)+'f'},
  {originalKernelStatusSequence:0},
  {originalKernelStatusSequence:'7'},
  {originalSigned:false},
  {taskDelivered:true}
 ];
 for(const changed of bads)assert.throws(
   ()=>validateOriginalEmployeeTaskIssueReceipt({...real,...changed},scope),
   /CEN_D3_EMPLOYEE_TASK_ORIGINAL_SIGNING_UNCONFIRMED/,
   'the public UI cannot accept a foreign/unsigned/legacy Task receipt');
});

test('existing independent employee identity is recovered only from exact original enrollment and PROOF readback',()=>{
 const scope={organizationId:'org:employee',workspaceId:'workspace:employee',
   actorId:'person:manager',employeePersonId:'person:employee',enrollmentId:'enrollment:employee'};
 const {organizationId,workspaceId,employeePersonId:personId,enrollmentId}=scope;
 const keyId='key:employee';
 const real={state:'ORIGINAL_GRANTS_ACTIVE',originalSigned:true,originalReadback:true,safeToReissue:false,
   organizationId,employeePersonId:personId,enrollmentId,statusSequence:5,
   membership:{organizationId,personId,workspaceId},credential:{holderPersonId:personId,publicKeyRef:keyId},
   binding:{organizationId,holderPersonId:personId,grantId:'grant:work'},
   workGrant:{payload:{id:'grant:work',holderId:personId,rightClass:'ACTION',
     actions:['work.prepare'],resources:[workspaceId]}},
   exportGrant:{payload:{holderId:personId,rightClass:'DATA',actions:['package.export'],
     resources:['workspace:'+workspaceId,'subject:'+organizationId,'recipient:'+organizationId,
       'field:result','operation:UPSERT']}},
   originalEnrollment:{payload:{personId,organizationId,workspaceId,credentialPublicKeyRef:keyId}}};
 const identity=readOriginalEmployeeEnrollmentIdentity(real,scope);
 assert.deepEqual(identity,{employeePersonId:personId,enrollmentId,credentialKeyId:keyId});
 const proof={state:'ORIGINAL_PROOF_CREDENTIAL_ADMITTED',employeePersonId:personId,credentialKeyId:keyId,
   originalReadback:true,safeToRetry:false};
 assert.deepEqual(readOriginalEmployeeCredentialIdentity(proof,identity),proof);
 for(const changed of [{organizationId:'org:other'},{workspaceId:'workspace:other'},
   {actorId:personId},{employeePersonId:'person:other'},{enrollmentId:'enrollment:other'}])
   assert.throws(()=>readOriginalEmployeeEnrollmentIdentity(real,{...scope,...changed}),/READBACK_HOLD/);
 for(const changed of [{originalSigned:false},{originalReadback:false},{safeToReissue:true},
   {statusSequence:0},{credential:{...real.credential,publicKeyRef:'key:other'}},
   {binding:{...real.binding,grantId:'grant:other'}},{membership:{...real.membership,workspaceId:'workspace:other'}},
   {exportGrant:{payload:{...real.exportGrant.payload,resources:['workspace:other']}}}])
   assert.throws(()=>readOriginalEmployeeEnrollmentIdentity({...real,...changed},scope),/READBACK_HOLD/);
 for(const changed of [{credentialKeyId:'key:other'},{employeePersonId:'person:other'},
   {originalReadback:false},{safeToRetry:true},{state:'AWAITING_EMPLOYEE_PROOF'}])
   assert.throws(()=>readOriginalEmployeeCredentialIdentity({...proof,...changed},identity),/READBACK_REQUIRED/);
});

test('original employee rights restore exact active grants, distinguish absence and reject a stale/foreign or partial receipt',()=>{
 const scope={organizationId:'org:north',workspaceId:'workspace:north',actorId:'person:manager',
  employeePersonId:'person:worker',enrollmentId:'enrollment:worker',credentialKeyId:'key:worker'};
 const {organizationId,workspaceId,employeePersonId,enrollmentId,credentialKeyId,actorId}=scope;
 const base={organizationId,workspaceId,employeePersonId,enrollmentId,originalReadback:true,safeToReissue:false};
 const w={...base,schema:'IWXA_T3_ORIGINAL_EMPLOYEE_WORKSPACE_RIGHTS/1',
  state:'ORIGINAL_EMPLOYEE_WORKSPACE_RIGHTS_NOT_FOUND'};
 const d={...base,schema:'IWXA_T3_ORIGINAL_EMPLOYEE_TASK_DATA_READBACK/1',
  state:'ORIGINAL_MANAGER_TASK_DATA_NOT_FOUND',recipientId:employeePersonId,managerPersonId:actorId};
 assert.equal(inspectOriginalEmployeeWorkspaceRights(w,scope),'NOT_FOUND');
 assert.equal(inspectOriginalEmployeeTaskGrant(d,scope),'NOT_FOUND');
 const spec={readAccess:['workspace.read','workspace.read'],writeAccess:['object.write','workspace.work'],
   createAccess:['workspace.create','workspace.onboarding'],importAccess:['workspace.exchange.import','workspace.exchange.import']};
 const attachments=Object.fromEntries(Object.entries(spec).map(([name,[action,purpose]])=>{
   const grantId='grant:'+name;
   return [name,{grantId,membership:{personId:employeePersonId,workspaceId},
    binding:{grantId,holderPersonId:employeePersonId,actions:[action],purposes:[purpose]},
    credential:{publicKeyRef:credentialKeyId},enrollment:{payload:{credentialPublicKeyRef:credentialKeyId}}}];
 }));
 const activeW={...w,state:'ORIGINAL_EMPLOYEE_WORKSPACE_RIGHTS_ACTIVE',statusSequence:7,
   attachments,grantIds:Object.values(attachments).map(x=>x.grantId)};
 const activeD={...d,state:'ORIGINAL_MANAGER_TASK_DATA_ACTIVE',statusSequence:7,grantId:'grant:task',
   grant:{payload:{id:'grant:task',holderId:actorId,roleId:'assigner',rightClass:'DATA',
    actions:['package.export'],purposes:['assignment'],resources:['workspace:'+workspaceId,
     'subject:'+organizationId,'recipient:'+employeePersonId,'field:task','operation:UPSERT']}}};
 assert.equal(inspectOriginalEmployeeWorkspaceRights(activeW,scope),'ACTIVE');
 assert.equal(inspectOriginalEmployeeTaskGrant(activeD,scope),'ACTIVE');
 for(const state of ['ORIGINAL_MANAGER_TASK_DATA_REVOKED_OR_EXPIRED','ORIGINAL_MANAGER_TASK_DATA_STATUS_UNKNOWN_HOLD'])
  assert.equal(inspectOriginalEmployeeTaskGrant({...d,state},scope),'HOLD');
 for(const patch of [{workspaceId:'workspace:foreign'},{employeePersonId:'person:foreign'},
   {enrollmentId:'enrollment:foreign'},{originalReadback:false},{safeToReissue:true}]){
   assert.throws(()=>inspectOriginalEmployeeWorkspaceRights({...activeW,...patch},scope),/READBACK_REQUIRED/);
   assert.throws(()=>inspectOriginalEmployeeTaskGrant({...activeD,...patch},scope),/READBACK_HOLD/);
 }
 const extra=structuredClone(attachments.readAccess);
 extra.grantId='grant:exportAccess';extra.binding.grantId=extra.grantId;
 extra.binding.actions=['workspace.exchange.export'];extra.binding.purposes=['workspace.exchange.export'];
 const returned={...activeW,returnExportAvailable:true,statusSequence:8,
   attachments:{...attachments,exportAccess:extra},
   grantIds:[...activeW.grantIds,extra.grantId]};
 assert.equal(inspectOriginalEmployeeWorkspaceRights(returned,scope),'ACTIVE');
 assert.throws(()=>inspectOriginalEmployeeWorkspaceRights({...returned,returnExportAvailable:false},scope),/READBACK_REQUIRED/);
 assert.throws(()=>inspectOriginalEmployeeWorkspaceRights({...activeW,returnExportAvailable:true},scope),/READBACK_REQUIRED/);
 assert.throws(()=>inspectOriginalEmployeeWorkspaceRights({...returned,attachments:{...returned.attachments,
   exportAccess:{...extra,credential:{publicKeyRef:'key:other'}}}},scope),/READBACK_REQUIRED/);
 assert.throws(()=>inspectOriginalEmployeeWorkspaceRights({...activeW,attachments:{}},scope),/READBACK_REQUIRED/);
 assert.throws(()=>inspectOriginalEmployeeWorkspaceRights({...activeW,grantIds:['grant:foreign']},scope),/READBACK_REQUIRED/);
 assert.throws(()=>inspectOriginalEmployeeWorkspaceRights({...w,attachments},scope),/READBACK_REQUIRED/);
 assert.throws(()=>inspectOriginalEmployeeTaskGrant({...d,grant:activeD.grant},scope),/READBACK_HOLD/);
 assert.throws(()=>inspectOriginalEmployeeTaskGrant({...activeD,recipientId:'person:foreign'},scope),/READBACK_HOLD/);
 assert.throws(()=>inspectOriginalEmployeeTaskGrant({...activeD,managerPersonId:'person:foreign'},scope),/READBACK_HOLD/);
 assert.throws(()=>inspectOriginalEmployeeTaskGrant({...activeD,statusSequence:0},scope),/READBACK_HOLD/);
 assert.throws(()=>inspectOriginalEmployeeTaskGrant({...activeD,state:'UNKNOWN'},scope),/READBACK_HOLD/);
});

test('employee rights are read before issue, with both existing grants restored on roster open',()=>{
 const ui=readFileSync(new URL('../src/CorporateEmployeeEnrollment.tsx',import.meta.url),'utf8');
 const restore=ui.slice(ui.indexOf('const openRosterRow='),ui.indexOf('const restoreRosterEmployee='));
 assert.match(restore,/await readGrant\('workspace',scope\)/);
 assert.match(restore,/await readGrant\('task',scope\)/);
 const read=ui.slice(ui.indexOf('async function readGrant('),ui.indexOf('// The employee must import'));
 assert.match(read,/setHold\(true\);setReceipt\(null\)/);
 assert.match(read,/setReceipt\(result\);setHold\(false\)/);
 for(const [kind,id,operation] of [['workspace','d3-employee-workspace-grants-issue','d3EmployeeWorkspaceGrantIssue'],
   ['task','d3-employee-task-grant-issue','d3EmployeeTaskGrantIssue']]){
   const segment=ui.slice(ui.indexOf('data-testid="'+id+'"'));
   const pre=segment.indexOf("await readGrant('"+kind+"')");
   assert.ok(pre>=0&&segment.indexOf("execute('"+operation+"'")>pre);
   assert.match(segment.slice(pre,pre+300),/before!=='NOT_FOUND'/);
 }
});

test('original Task catalog separates recipients and requires exact carrier readback',()=>{
 const rows=[{taskId:'task:manager',recipientId:'person:manager',taskRevisionId:A,packageSha256:B,
   summary:'Manager work',deliveryState:'NOT_CONFIRMED'},
  {taskId:'task:employee',recipientId:'person:employee',taskRevisionId:B,packageSha256:C,
   summary:'Employee work',deliveryState:'NOT_CONFIRMED'}];
 const snapshot={organizationId:'org:one',workspaceId:'workspace:one',actorId:'person:manager',totalTasks:2,tasks:rows};
 const catalog=readOriginalTaskCatalog(snapshot);
 assert.deepEqual(catalog.rows.filter(x=>x.recipientId==='person:employee'),[rows[1]]);
 assert.equal(catalog.truncated,false);
 assert.equal(readOriginalTaskCatalog({...snapshot,totalTasks:3}).truncated,true);
 assert.throws(()=>readOriginalTaskCatalog({...snapshot,tasks:[rows[0],rows[0]]}),/DUPLICATE/);
 assert.throws(()=>readOriginalTaskCatalog({...snapshot,tasks:[rows[0],{...rows[1],recipientId:undefined}]}),/TASK_INVALID/);
 assert.throws(()=>readOriginalTaskCatalog({...snapshot,tasks:[rows[0],{...rows[1],deliveryState:'DELIVERED'}]}),/TASK_INVALID/);
 const receipt={schema:'IWXA_T3_ORIGINAL_EMPLOYEE_TASK_READBACK/1',found:true,
  taskId:'task:employee',recipientId:'person:employee',enrollmentId:'enrollment:employee',
  status:'SIGNED_TASK_PERSISTED_NOT_DELIVERED',originalKernelReadback:true,taskDelivered:false,
  taskRevisionId:B,packageSha256:C};
 assert.deepEqual(validateOriginalEmployeeCatalogReadback(receipt,rows[1],'enrollment:employee'),receipt);
 for(const patch of [{recipientId:'person:manager'},{taskRevisionId:A},{packageSha256:A},{found:false}]){
   assert.throws(()=>validateOriginalEmployeeCatalogReadback({...receipt,...patch},rows[1],'enrollment:employee'),/READBACK_HOLD/);
 }
 assert.throws(()=>validateOriginalEmployeeCatalogReadback(receipt,rows[0],'enrollment:employee'),/READBACK_HOLD/);
 const exported={schema:'IWXA_T3_ORIGINAL_EMPLOYEE_TASK_EXPORT/1',status:'EXPORTED_UNDELIVERED',
   taskId:receipt.taskId,recipientId:receipt.recipientId,taskRevisionId:B,packageSha256:C,
   originalSigned:true,taskDelivered:false,bytes:512};
 assert.deepEqual(validateOriginalEmployeeTaskExportReceipt(exported,receipt),exported);
 assert.throws(()=>validateOriginalEmployeeTaskExportReceipt(exported,rows[1]),/EXPORT_READBACK_HOLD/);
 assert.throws(()=>validateOriginalEmployeeTaskExportReceipt({...exported,recipientId:'person:other'},receipt),/EXPORT_READBACK_HOLD/);
 assert.throws(()=>validateOriginalEmployeeTaskExportReceipt({...exported,packageSha256:A},receipt),/EXPORT_READBACK_HOLD/);
});
test('employee history is independent of a pending Task and first-person route filters its recipient',()=>{
 const ui=readFileSync(new URL('../src/CorporateEmployeeEnrollment.tsx',import.meta.url),'utf8');
 const start=ui.indexOf('const readHistory=');
 const end=ui.indexOf('useEffect(()=>',start);
 assert.ok(start>=0&&end>start,'read-only history route must exist');
 const history=ui.slice(start,end);
 assert.match(history,/d3EmployeeTaskReadback/);
 assert.match(history,/d3EmployeeExportTask/);
 assert.doesNotMatch(history,/saveEmployeeTaskContinuation|clearEmployeeTaskContinuation|d3EmployeeCreateTask/);
 assert.match(ui,/historyReadback.epoch!==session.contextEpoch/);
 const owner=readFileSync(new URL('../src/CorporateD3Panel.tsx',import.meta.url),'utf8');
 assert.match(owner,/allSignedTasks.filter\(t=>t.recipientId===session.actorId\)/);
});

test('independent employee Task continuation saves only the operation ID, restores after reopening and isolates exact enrollments',()=>{
 const entries=new Map();
 const storage={getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};
 const scope=['org:north','workspace:north','person:manager','person:worker','enrollment:worker'];
 const key=employeeTaskContinuationKey(...scope);
 const task='task:existing-1';
 assert.equal(readEmployeeTaskContinuation(storage,key),null);
 saveEmployeeTaskContinuation(storage,key,task);
 assert.equal(readEmployeeTaskContinuation(storage,key),task);
 assert.deepEqual([...entries.values()],[task]);
 assert.throws(()=>saveEmployeeTaskContinuation(storage,key,task),/CONTINUATION_ALREADY_PENDING/);
 assert.throws(()=>saveEmployeeTaskContinuation(storage,key,'task:new-2'),/CONTINUATION_ALREADY_PENDING/);
 assert.throws(()=>clearEmployeeTaskContinuation(storage,key,'task:new-2'),/CONTINUATION_CHANGED/);
 for(let i=0;i<scope.length;i++){
   const different=[...scope];different[i]+='-other';
   assert.equal(readEmployeeTaskContinuation(storage,employeeTaskContinuationKey(...different)),null);
 }
 clearEmployeeTaskContinuation(storage,key,task);
 saveEmployeeTaskContinuation(storage,key,'task:new-2');
 assert.equal(readEmployeeTaskContinuation(storage,key),'task:new-2');
 assert.throws(()=>employeeTaskContinuationKey('org:north','workspace:north','person:manager','person:manager','enrollment:worker'),/CONTINUATION_SCOPE_INVALID/);
});
test('employee Task continuation fails closed when local operation identity cannot be saved or read',()=>{
 const key=employeeTaskContinuationKey('org:north','workspace:north','person:manager','person:worker','enrollment:worker');
 const noWrite={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
 assert.throws(()=>saveEmployeeTaskContinuation(noWrite,key,'task:existing-1'),/CONTINUATION_NOT_SAVED/);
 const invalid={getItem:()=>'{not a task}',setItem:()=>assert.fail('must not overwrite'),removeItem:()=>assert.fail('must not delete')};
 assert.throws(()=>readEmployeeTaskContinuation(invalid,key),/CONTINUATION_INVALID/);
 assert.throws(()=>saveEmployeeTaskContinuation(invalid,key,'task:existing-1'),/CONTINUATION_INVALID/);
 assert.throws(()=>clearEmployeeTaskContinuation(invalid,key,'task:existing-1'),/CONTINUATION_INVALID/);
});
test('independent employee Task readback binds prior signed bytes, distinguishes missing and orphan without claiming safe reissue',()=>{
 const scope={taskId:'task:work-verified',employeePersonId:'person:worker',enrollmentId:'enrollment:worker'};
 const original={schema:'IWXA_T3_ORIGINAL_EMPLOYEE_TASK_READBACK/1',found:true,
  taskId:scope.taskId,recipientId:scope.employeePersonId,enrollmentId:scope.enrollmentId,
  status:'SIGNED_TASK_PERSISTED_NOT_DELIVERED',originalKernelReadback:true,
  taskDelivered:false,taskRevisionId:A,packageSha256:B};
 const issued={taskId:scope.taskId,recipientId:scope.employeePersonId,enrollmentId:scope.enrollmentId,
   taskRevisionId:A,packageSha256:B};
 assert.deepEqual(validateOriginalEmployeeTaskReadback(original,scope,issued),original);
 for(const patch of [{taskId:'task:other'},{recipientId:'person:other'},{enrollmentId:'enrollment:other'},
  {taskDelivered:true},{originalKernelReadback:false},{packageSha256:C},{taskRevisionId:C}]){
   assert.throws(()=>validateOriginalEmployeeTaskReadback({...original,...patch},scope,issued),/ORIGINAL_READBACK_HOLD/);
 }
 for(const status of ['NOT_IN_ORIGINAL_TASK_INVENTORY','ORIGINAL_SIGNED_CARRIER_WITHOUT_INVENTORY_HOLD']){
   const missing={schema:original.schema,taskId:scope.taskId,found:false,status,automaticReissueAllowed:false};
   assert.deepEqual(validateOriginalEmployeeTaskReadback(missing,scope),missing);
   assert.throws(()=>validateOriginalEmployeeTaskReadback(missing,scope,issued),/ORIGINAL_READBACK_HOLD/);
   assert.throws(()=>validateOriginalEmployeeTaskReadback({...missing,automaticReissueAllowed:true},scope),/ORIGINAL_READBACK_HOLD/);
 }
});
test('employee UI persists exact Task ID before signing and permits next Task only after original cold readback',()=>{
 const ui=readFileSync(new URL('../src/CorporateEmployeeEnrollment.tsx',import.meta.url),'utf8');
 const start=ui.indexOf('data-testid="d3-employee-task-create"');
 const end=ui.indexOf('data-testid="d3-employee-task-read"',start);
 const issue=ui.slice(start,end);
 const save=issue.indexOf('saveEmployeeTaskContinuation(localStorage,taskScope,taskId)');
 const send=issue.indexOf("execute('d3EmployeeCreateTask'");
 assert.ok(save>=0&&send>save);
 assert.match(ui,/const freshTaskReadback=taskReadbackCurrent&&taskReceipt\?\.schema==='IWXA_T3_ORIGINAL_EMPLOYEE_TASK_READBACK\/1'/);
 assert.match(ui,/taskAttempted&&!freshTaskReadback/);
 assert.match(ui,/const pending=readEmployeeTaskContinuation\(localStorage,taskScope\)/);
 assert.match(ui,/setTaskId\('task:'\+crypto\.randomUUID\(\)\)/);
 assert.match(ui,/validateOriginalEmployeeTaskReadback\(result,/);
});

test('D3 native definite pre-dispatch failures permit a deliberate retry, never lost ACK',()=>{
 const safe={
   d3ApplyAccepted:[
     'CEN_D3_CONTEXT_CHANGED','CEN_D3_ORIGINAL_OWNER_NOT_BUNDLED',
     'CEN_D3_ORIGINAL_KERNEL_APPLY_NOT_CONNECTED',
     'CEN_D3_ORIGINAL_WORKSPACE_NOT_RUNNING',
     'CEN_D3_SEPARATE_HUMAN_APPLY_CANCELLED',
     'CEN_D3_ACCEPTED_SOURCE_INVALID',
     'T3_D3_ORIGINAL_WORKSPACE_PROVISION_REQUIRED',
     'T3_D3_ORIGINAL_WORKSPACE_DELETED',
     'T3_D3_ORIGINAL_WORKSPACE_READ_ONLY'
   ],
   d3CreateTask:[
     'CEN_D3_CONTEXT_CHANGED','CEN_D3_ORIGINAL_OWNER_NOT_BUNDLED',
     'CEN_D3_ORIGINAL_TASK_OPERATION_ID_REQUIRED',
     'CEN_D3_SIGNED_TASK_TEXT_REQUIRED'
   ]
 };
 for(const [operation,codes] of Object.entries(safe)){
   for(const code of codes){
     assert.equal(isDefiniteUndispatchedD3Failure(code,operation),true,code);
     assert.equal(isDefiniteUndispatchedD3Failure(new Error(code),operation),true,code);
   }
 }
 const unconfirmed=[
   'CEN_D3_OUTCOME_UNKNOWN','T3_D3_KERNEL_WRITE_MAY_HAVE_COMMITTED',
   'CEN_D3_NATIVE_WORKER_FAILED','CEN_D3_ORIGINAL_TASK_ALREADY_ISSUED',
   'T3_D3_OWNER_CONTEXT_CHANGED_OUTCOME_UNKNOWN',
   'T3_D3_ORIGINAL_KERNEL_OUTCOME_UNKNOWN',
   'WORKSPACE_NOT_FOUND','PERMISSION_DENIED',
   'CEN_D3_KERNEL_COMMIT_OUTCOME_UNKNOWN',
   'CEN_D3_ORIGINAL_DECISION_READBACK_NOT_CONFIRMED',
   'CEN_D3_SEPARATE_HUMAN_APPLY_CANCELLED additional text'
 ];
 for(const operation of Object.keys(safe))
   for(const code of unconfirmed)
     assert.equal(isDefiniteUndispatchedD3Failure(code,operation),false,code);
 assert.equal(isDefiniteUndispatchedD3Failure('CEN_D3_SEPARATE_HUMAN_APPLY_CANCELLED',
   'd3CreateTask'),false);
 assert.equal(isDefiniteUndispatchedD3Failure('CEN_D3_SIGNED_TASK_TEXT_REQUIRED',
   'd3ApplyAccepted'),false);
 assert.equal(isDefiniteUndispatchedD3Failure(
   'T3_D3_ORIGINAL_WORKSPACE_PROVISION_REQUIRED','d3CreateTask'),false);
 assert.equal(isDefiniteUndispatchedD3Failure('CEN_D3_CONTEXT_CHANGED',
   'd3Decide'),false);
 assert.equal(isDefiniteUndispatchedD3Failure(null,'d3CreateTask'),false);
});

const context=()=>({kind:'CORP',context_id:'context:1',actor_id:'person:manager',
 principal_id:'org:1',role_id:'role:manager',grant_id:'grant:accept',
 organization_id:'org:1',workspace_id:'workspace:1',resource:'workspace:1',
 realm_id:'realm:1',audience:'admin',purpose:'application',scope_revision:7});
test('original D3 target is exact and bound to the accepted organization',async()=>{
 assert.deepEqual(readOriginalApplicationTarget(target,'org:1','workspace:1'),target);
 for(const invalid of [
   {...target,workspaceId:'workspace:foreign'},
   {...target,subjectId:'org:foreign'},
   {...target,dataRootId:'root:foreign',extra:'caller-inserted'},
   {...target,consumerId:'IWXA_OTHER'},
   {...target,processId:undefined},
 ]){
   assert.throws(()=>readOriginalApplicationTarget(invalid,'org:1','workspace:1'),
     /CEN_D3_ORIGINAL_APPLICATION_TARGET_REQUIRED/);
 }
 const {host,log}=original();
 for(const operation of ['d3ApplyAccepted','d3RecoverApplied']){
   const selection={acceptanceId:C,revisionIds:[C],
     target:{...target,dataRootId:'root:foreign'}};
   await assert.rejects(()=>command(host,operation,selection),
     /CEN_D3_ORIGINAL_APPLICATION_TARGET_CHANGED/);
 }
 assert.equal(log.filter(x=>x[0]==='apply'||x[0]==='recoverApply').length,0);
});

test('D3 native carrier limit matches original installed 32 MiB owner',()=>{
 assert.equal(MAX_CEN_D3_IWXA_CARRIER_BYTES,32*1024*1024);
 assert.equal(MAX_CEN_D3_IWXA_CARRIER_BYTES,MAX_CEN_IWXA_CARRIER_BYTES);
});
const binding={organizationId:'org:1',workspaceId:'workspace:1',
 contextEpoch:7,actorId:'person:manager',contextId:'context:1'};
const target={consumerId:'IWXA_ADMIN_CENTER',processId:'admin.applied-results',
 processVersion:'1',purpose:'application',subjectId:'org:1',
 workspaceId:'workspace:1',dataRootId:'root:1'};
function original(){
 const log=[],claims={...context()},receipts=new Map();
 const preview=()=>({schema:'IWXA_T3_RECONCILIATION_PREVIEW/1',packageSha256:A,
   previewDigest:B,allowedAction:'EXPLICIT_ACCEPT_ONLY',classification:'NEW',
   entries:[{kind:'OBJECT',id:'object:1',revisionId:C}]});
 const admission={
   async receive(bytes){
     log.push(['receive',Array.from(bytes)]);
     return {transportReceipt:{status:'RECEIVED'},preview:preview(),
       acceptanceState:'NOT_ACCEPTED',kernelApplication:'NOT_APPLIED'};
   },
   async preview(sha){log.push(['preview',sha]);return preview();},
   async receipt(id,sha){
     log.push(['receipt',id,sha]);
     const r=receipts.get(id);
     return r&&r.packageSha256===sha?
       {found:true,receipt:r,
        kernelApplication:'NOT_ATTESTED_BY_RECONCILIATION_RECEIPT'}:
       {found:false,receipt:null,
        kernelApplication:'NOT_ATTESTED_BY_RECONCILIATION_RECEIPT'};
   },
   async accept(args){
     log.push(['accept',structuredClone(args)]);
     const receipt={schema:'IWXA_T3_ACCEPTANCE_RECEIPT/1',operationId:args.operationId,
       decisionBy:args.decisionBy,packageSha256:args.packageSha256,
       acceptanceId:C,acceptanceState:'ACCEPTED',appliedScope:'RECONCILIATION_LEDGER_ONLY',
       externalContextCoreApplied:false};
     receipts.set(args.operationId,receipt);
     return {receipt,acceptanceState:'ACCEPTED',kernelApplication:'NOT_APPLIED'};
   },
   async reject(args){
     log.push(['reject',structuredClone(args)]);
     const receipt={schema:'IWXA_T3_REJECTION_RECEIPT/1',operationId:args.operationId,
       decisionBy:args.decisionBy,packageSha256:args.packageSha256,
       acceptanceState:'REJECTED',applicationState:'NOT_APPLIED'};
     receipts.set(args.operationId,receipt);
     return {receipt,acceptanceState:'REJECTED',kernelApplication:'NOT_APPLIED'};
   },
   async inspectAcceptedApplication(args){
     log.push(['inspectApply',structuredClone(args)]);
     return {schema:'IWXA_T3_APPLICATION_PROJECTION_CANDIDATE/1',
       status:'CANDIDATE_REQUIRES_INDEPENDENT_HOST_AUTHORIZATION',
       applicationAuthorized:false,applicationAttempted:false,
       externalContextCoreApplied:false};
   },
 };
 const apply={
   async applyAccepted(args){
     log.push(['apply',structuredClone(args)]);
     return {kernelWriteReadback:'CONFIRMED',
       originalKernelReceipt:{workspace_id:'workspace:1',object:{revision:2}},
       originalKernelReadback:{object:{object_id:'object:1',revision:2}},
       externalProductAcceptance:'NOT_ACCEPTED'};
   }
 };
 apply.recoverApplied=async args=>{
   log.push(['recoverApply',structuredClone(args)]);
   return {status:'ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED',
     effectKey:A,kernelWriteReadback:'CONFIRMED',
     originalKernelReadback:{object:{workspace_id:'workspace:1',
       object_id:'object:1',revision:2}},
     originalEventReadback:{event_id:'event:1',workspace_id:'workspace:1',
       object_id:'object:1',revision:2,idempotency_key:A,
       payload:{reconciliation_acceptance_id:C,
         reconciliation_revision_ids:[C]}},
     externalProductAcceptance:'NOT_ACCEPTED',automaticRetryAllowed:false};
 };
 const signedD3Owner={admission,access:{currentContext:async()=>structuredClone(claims)},
   apply,applicationTargetFor:async()=>structuredClone(target)};
 const host=createCorporateOwnerHost({signedD3Owner});
 return {log,claims,receipts,host,admission,apply,signedD3Owner};
}
const command=(host,operation,input={})=>
 host.action({organizationId:'org:1',operation,input,binding});

test('D3: real signed subject scope, original archive, ACCEPT receipt and separate Kernel Apply',async()=>{
 const {host,log}=original();
 const state=await host.state({organizationId:'org:1'});
 assert.equal(state.status,'D3_OWNER_READY');
 assert.equal(state.snapshot.productionActivation,false);
 assert.equal(state.snapshot.T3_READY,false);
 assert.equal(state.snapshot.d3RecipientAvailable,true);
 assert.equal(state.snapshot.d3InspectAvailable,true);
 assert.equal(state.snapshot.d3ApplyAvailable,true);
 assert.equal(state.snapshot.d3ApplyRecoverAvailable,true);
 assert.ok(signedD3SessionFingerprint(state,'org:1'));
 assert.equal(signedD3SessionFingerprint(state,'org:other'),null);
 const received=await command(host,'d3Receive',{bytes:[80,75,3,4]});
 assert.equal(received.acceptanceState,'NOT_ACCEPTED');
 assert.equal(received.kernelApplication,'NOT_APPLIED');
 assert.deepEqual(log[0],['receive',[80,75,3,4]]);
 const view=await command(host,'d3Preview',{packageSha256:A});
 assert.equal(view.previewDigest,B);
 const decision=await command(host,'d3Decide',{operationId:'decision:one',
   packageSha256:A,previewDigest:B,decision:'ACCEPT'});
 assert.equal(decision.acceptanceState,'ACCEPTED');
 assert.equal(decision.kernelApplication,'NOT_APPLIED');
 assert.equal(log[2][1].decisionBy,'person:manager',
   'actor is read from signed D1 owner, never supplied by UI');
 const recovered=await command(host,'d3Receipt',
   {operationId:'decision:one',packageSha256:A});
 assert.equal(recovered.found,true);
 assert.equal(recovered.kernelApplication,'NOT_ATTESTED_BY_RECONCILIATION_RECEIPT');
 const selection={acceptanceId:C,revisionIds:[C]};
 const candidate=await command(host,'d3InspectAccepted',selection);
 assert.equal(candidate.applicationAttempted,false);
 const applied=await command(host,'d3ApplyAccepted',{...selection,target});
 assert.equal(applied.kernelWriteReadback,'CONFIRMED');
 assert.equal(applied.originalKernelReadback.object.revision,2);
 assert.equal(log.filter(x=>x[0]==='accept').length,1);
 assert.equal(log.filter(x=>x[0]==='apply').length,1);
 assert.deepEqual(log.find(x=>x[0]==='apply')[1].target,target);
 const verified=await command(host,'d3RecoverApplied',{...selection,target});
 assert.equal(verified.status,'ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED');
 assert.equal(verified.originalEventReadback.idempotency_key,A);
 assert.equal(verified.automaticRetryAllowed,false);
 assert.equal(log.filter(x=>x[0]==='apply').length,1,
   'original signed recovery must not call Apply again');
 assert.deepEqual(log.find(x=>x[0]==='recoverApply')[1].target,target);
});

test('D3: lost ACCEPT acknowledgment is UNKNOWN; only original receipt can recover',async()=>{
 const {host,admission,log,receipts}=original();
 admission.accept=async args=>{
   log.push(['accept',args]);
   receipts.set(args.operationId,{schema:'IWXA_T3_ACCEPTANCE_RECEIPT/1',
     operationId:args.operationId,packageSha256:args.packageSha256,
     decisionBy:args.decisionBy,acceptanceId:C,acceptanceState:'ACCEPTED'});
   throw Object.assign(new Error('T3_D3_ORIGINAL_DECISION_READBACK_NOT_CONFIRMED'),
     {code:'T3_D3_ORIGINAL_DECISION_READBACK_NOT_CONFIRMED'});
 };
 await assert.rejects(()=>command(host,'d3Decide',{
   operationId:'decision:lost',packageSha256:A,previewDigest:B,decision:'ACCEPT'
 }),/CEN_D3_OUTCOME_UNKNOWN/);
 const recovered=await command(host,'d3Receipt',{
   operationId:'decision:lost',packageSha256:A});
 assert.equal(recovered.found,true);
 assert.equal(recovered.receipt.operationId,'decision:lost');
 assert.equal(log.filter(x=>x[0]==='accept').length,1,
   'recovery is read-only, not a second ACCEPT');
 assert.equal((await command(host,'d3Receipt',{
   operationId:'decision:lost',packageSha256:B})).found,false);
 assert.equal(log.filter(x=>x[0]==='accept').length,1);
});

test('D3: original actor/organization and epoch changes invalidate retained selection',async()=>{
 const {host,claims,log}=original();
 await assert.rejects(()=>host.state({organizationId:'org:other'}),
   /SIGNED_CORPORATE_CONTEXT_REQUIRED/);
 claims.actor_id='person:other';
 await assert.rejects(()=>command(host,'d3Preview',{packageSha256:A}),
   /CEN_D3_CONTEXT_CHANGED/);
 assert.deepEqual(log,[]);
 claims.actor_id='person:manager';claims.scope_revision=8;
 await assert.rejects(()=>command(host,'d3Receipt',{
   operationId:'decision:one',packageSha256:A}),/CEN_D3_CONTEXT_CHANGED/);
 assert.deepEqual(log,[]);
});

test('D3: no reference owner mixing and no unsigned or incomplete Apply target',async()=>{
 const {signedD3Owner,host,log}=original();
 assert.throws(()=>createCorporateOwnerHost({runtime:{product:'admin'},
   signedD3Owner}),/LEGACY_OWNER_MIXING_FORBIDDEN/);
 await assert.rejects(()=>command(host,'issue',{assignmentId:'draft'}),
   /CEN_D3_OPERATION_NOT_SUPPORTED/);
 await assert.rejects(()=>command(host,'d3Decide',{operationId:'bad id',
   packageSha256:A,previewDigest:B,decision:'ACCEPT'}),/EXPLICIT_DECISION_REQUIRED/);
 await assert.rejects(()=>command(host,'d3Receive',{bytes:[80,,75]}),
   /CEN_D3_CARRIER_INVALID/);
 assert.deepEqual(log,[]);
 const wrong=createCorporateOwnerHost({signedD3Owner:{
   ...signedD3Owner,applicationTargetFor:async()=>({...target,dataRootId:undefined})
 }});
 await assert.rejects(()=>command(wrong,'d3ApplyAccepted',
   {acceptanceId:C,revisionIds:[C]}),/ORIGINAL_APPLICATION_TARGET_REQUIRED/);
 assert.equal(log.filter(x=>x[0]==='apply').length,0);
});

test('D3: context change after Kernel dispatch is UNKNOWN and never auto-retries',async()=>{
 const {host,claims,apply,log}=original();
 apply.applyAccepted=async args=>{
   log.push(['apply',args]);claims.scope_revision++;
   return {kernelWriteReadback:'CONFIRMED',originalKernelReceipt:{object:{revision:1}},
     originalKernelReadback:{object:{revision:1}},externalProductAcceptance:'NOT_ACCEPTED'};
 };
 await assert.rejects(()=>command(host,'d3ApplyAccepted',
   {acceptanceId:C,revisionIds:[C]}),/CEN_D3_OUTCOME_UNKNOWN/);
 assert.equal(log.filter(x=>x[0]==='apply').length,1);
 host.close();
 await assert.rejects(()=>host.state({organizationId:'org:1'}),/CEN_D3_HOST_CLOSED/);
});


test('D3: late signed-context error after original ACCEPT remains UNKNOWN, not retryable',async()=>{
 const {host,claims,admission,receipts,log}=original();
 admission.accept=async args=>{
   log.push(['accept',structuredClone(args)]);
   receipts.set(args.operationId,{schema:'IWXA_T3_ACCEPTANCE_RECEIPT/1',
     operationId:args.operationId,packageSha256:args.packageSha256,
     decisionBy:args.decisionBy,acceptanceId:C,acceptanceState:'ACCEPTED'});
   claims.scope_revision++;
   throw Object.assign(new Error('T3_D3_SELECTED_CONTEXT_CHANGED'),
     {code:'T3_D3_SELECTED_CONTEXT_CHANGED',outcome:'DENIED'});
 };
 await assert.rejects(()=>command(host,'d3Decide',{
   operationId:'decision:late-context',packageSha256:A,previewDigest:B,
   decision:'ACCEPT'
 }),/CEN_D3_OUTCOME_UNKNOWN/);
 assert.equal(log.filter(x=>x[0]==='accept').length,1);
 claims.scope_revision=7;
 const saved=await command(host,'d3Receipt',{
   operationId:'decision:late-context',packageSha256:A});
 assert.equal(saved.found,true);
 assert.equal(saved.receipt.decisionBy,'person:manager');
 assert.equal(log.filter(x=>x[0]==='accept').length,1);
});

test('D3: lost original Kernel Apply acknowledgment recovers only by Object and Event query',async()=>{
 const {host,apply,log}=original();
 apply.applyAccepted=async args=>{
   log.push(['apply',structuredClone(args)]);
   throw new Error('T3_D3_KERNEL_WRITE_MAY_HAVE_COMMITTED');
 };
 const selection={acceptanceId:C,revisionIds:[C]};
 await assert.rejects(()=>command(host,'d3ApplyAccepted',selection),/CEN_D3_OUTCOME_UNKNOWN/);
 const recovered=await command(host,'d3RecoverApplied',selection);
 assert.equal(recovered.status,'ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED');
 assert.equal(recovered.originalEventReadback.event_id,'event:1');
 assert.equal(log.filter(x=>x[0]==='apply').length,1);
 assert.equal(log.filter(x=>x[0]==='recoverApply').length,1);
});

test('D3: unknown Apply remains unknown, forged or absent original Event never confirms',async()=>{
 const {host,apply,log}=original();
 const selection={acceptanceId:C,revisionIds:[C]};
 apply.recoverApplied=async args=>{
   log.push(['recoverApply',structuredClone(args)]);
   return {status:'OUTCOME_UNKNOWN',effectKey:A,
     kernelWriteReadback:'NOT_CONFIRMED',automaticRetryAllowed:false};
 };
 const unknown=await command(host,'d3RecoverApplied',selection);
 assert.equal(unknown.status,'OUTCOME_UNKNOWN');
 assert.equal(unknown.automaticRetryAllowed,false);
 assert.equal(log.filter(x=>x[0]==='apply').length,0);
 apply.recoverApplied=async()=>({
   status:'ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED',effectKey:A,
   kernelWriteReadback:'CONFIRMED',originalKernelReadback:{object:{}},
   automaticRetryAllowed:false,externalProductAcceptance:'NOT_ACCEPTED'
 });
 await assert.rejects(()=>command(host,'d3RecoverApplied',selection),
   /CEN_D3_KERNEL_RECOVERY_READBACK_INVALID/);
 assert.equal(log.filter(x=>x[0]==='apply').length,0);
});

test('D3: no original signed recovery port cannot be advertised as available',async()=>{
 const {signedD3Owner}=original();
 const host=createCorporateOwnerHost({signedD3Owner:{
   ...signedD3Owner,apply:{applyAccepted:signedD3Owner.apply.applyAccepted}
 }});
 assert.equal((await host.state({organizationId:'org:1'}))
   .snapshot.d3ApplyRecoverAvailable,false);
 await assert.rejects(()=>command(host,'d3RecoverApplied',
   {acceptanceId:C,revisionIds:[C]}),/CEN_D3_APPLY_RECOVERY_NOT_CONNECTED/);
});

test('D3: a different original Event provenance never attests a prior Kernel Apply',async()=>{
 const {host,apply,log}=original();
 const selection={acceptanceId:C,revisionIds:[C]};
 const different=[
   ['event.idempotency_key',out=>{out.originalEventReadback.idempotency_key=B;}],
   ['event.source_acceptance',out=>{out.originalEventReadback.payload.reconciliation_acceptance_id=B;}],
   ['event.revision_ids',out=>{out.originalEventReadback.payload.reconciliation_revision_ids=[B];}],
   ['event.workspace',out=>{out.originalEventReadback.workspace_id='workspace:other';}],
   ['object.revision',out=>{out.originalEventReadback.revision=3;}]
 ];
 for(const [name,alter] of different){
   const valid={status:'ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED',
     effectKey:A,kernelWriteReadback:'CONFIRMED',automaticRetryAllowed:false,
     originalKernelReadback:{object:{workspace_id:'workspace:1',
       object_id:'object:1',revision:2}},
     originalEventReadback:{event_id:'event:1',workspace_id:'workspace:1',
       object_id:'object:1',revision:2,idempotency_key:A,
       payload:{reconciliation_acceptance_id:C,reconciliation_revision_ids:[C]}},
     externalProductAcceptance:'NOT_ACCEPTED'};
   alter(valid);
   apply.recoverApplied=async()=>valid;
   await assert.rejects(()=>command(host,'d3RecoverApplied',selection),
     /CEN_D3_KERNEL_RECOVERY_READBACK_INVALID/,name);
 }
 assert.equal(log.filter(x=>x[0]==='apply').length,0);
});

test('D3: original recipient can inspect accepted Result without a Kernel Apply owner',async()=>{
 const {signedD3Owner,log}=original();
 const host=createCorporateOwnerHost({signedD3Owner:{
   ...signedD3Owner,apply:null
 }});
 const state=await host.state({organizationId:'org:1'});
 assert.equal(state.snapshot.d3RecipientAvailable,true);
 assert.equal(state.snapshot.d3InspectAvailable,true);
 assert.equal(state.snapshot.d3ApplyAvailable,false);
 assert.equal(state.snapshot.d3ApplyRecoverAvailable,false);
 const selection={acceptanceId:C,revisionIds:[C]};
 const candidate=await command(host,'d3InspectAccepted',selection);
 assert.equal(candidate.schema,'IWXA_T3_APPLICATION_PROJECTION_CANDIDATE/1');
 assert.equal(candidate.status,'CANDIDATE_REQUIRES_INDEPENDENT_HOST_AUTHORIZATION');
 assert.equal(candidate.applicationAuthorized,false);
 assert.equal(candidate.applicationAttempted,false);
 assert.deepEqual(log.filter(x=>x[0]==='inspectApply')[0][1].target,target);
 await assert.rejects(()=>command(host,'d3ApplyAccepted',selection),
   /CEN_D3_APPLY_NOT_CONNECTED/);
 await assert.rejects(()=>command(host,'d3RecoverApplied',selection),
   /CEN_D3_APPLY_RECOVERY_NOT_CONNECTED/);
 assert.equal(log.filter(x=>x[0]==='apply').length,0);
 assert.equal(log.filter(x=>x[0]==='recoverApply').length,0);
});

test('D3 Human Review: only fully read original signed Task/Result permits ACCEPT UI',()=>{
 const p='a'.repeat(64),d='b'.repeat(64),r='c'.repeat(64);
 const identity={schema:'IWXA_T3_ORIGINAL_SIGNED_RESULT_REVIEW/1',
   packageSha256:p,previewDigest:d,taskId:'task:one',taskRevisionId:p,
   resultRevisionId:r,executorId:'person:worker',organizationId:'org:1',
   workspaceId:'workspace:1',signatureVerified:true,taskBindingProven:true,
   taskCatalogVerified:true,assignmentText:'Подготовить результат и проверить критерии',
   resultLength:5500};
 const format=(offset,text)=>({schema:'IWXA_T3_RECONCILIATION_PREVIEW/1',
   packageSha256:p,previewDigest:d,entries:[{revisionId:r}],
   resultInspection:{...identity,offset,resultText:text,
     nextOffset:offset+text.length,hasMore:offset+text.length<5500}});
 const first=readOriginalResultReview(format(0,'Ж'.repeat(4096)),
   'org:1','workspace:1');
 assert.equal(first.hasMore,true);
 assert.equal(first.nextOffset,4096);
 const second=appendOriginalResultReview(first,
   format(4096,'R'.repeat(1404)),'org:1','workspace:1');
 assert.equal(second.resultText.length,5500);
 assert.equal(second.hasMore,false);
 assert.equal(second.nextOffset,5500);
 assert.equal(second.assignmentText,'Подготовить результат и проверить критерии');
 assert.throws(()=>readOriginalResultReview({
   ...format(0,'Ж'.repeat(4096)),
   resultInspection:{...format(0,'Ж'.repeat(4096)).resultInspection,
     taskCatalogVerified:false}
 },'org:1','workspace:1'),/CEN_D3_SIGNED_RESULT_REVIEW_INVALID/);
 assert.throws(()=>appendOriginalResultReview(first,{
   ...format(4096,'R'.repeat(1404)),
   resultInspection:{...format(4096,'R'.repeat(1404)).resultInspection,
      assignmentText:'Другое поручение'}
 },'org:1','workspace:1'),/CEN_D3_SIGNED_RESULT_REVIEW_STALE/);
 assert.equal(readOriginalResultReview({
   schema:'IWXA_T3_RECONCILIATION_PREVIEW/1',packageSha256:p,
   previewDigest:d,entries:[{revisionId:r}],resultInspection:null
 },'org:1','workspace:1'),null);
 assert.throws(()=>readOriginalResultReview(format(0,'Ж'.repeat(4096)),
   'org:other','workspace:1'),/CEN_D3_SIGNED_RESULT_REVIEW_INVALID/);
 assert.throws(()=>appendOriginalResultReview(first,
   {...format(4096,'R'.repeat(1404)),previewDigest:'d'.repeat(64)},
   'org:1','workspace:1'),/CEN_D3_SIGNED_RESULT_REVIEW_INVALID/);
 assert.throws(()=>appendOriginalResultReview(first,format(0,'A'.repeat(4096)),
   'org:1','workspace:1'),/CEN_D3_SIGNED_RESULT_REVIEW_INVALID/);
});

test('D3 Task ID survives native ACK loss through original signed inventory readback',()=>{
 const saved={taskId:'task:11111111-2222-3333-4444-555555555555',
   taskRevisionId:A,packageSha256:B,deliveryState:'NOT_CONFIRMED'};
 const originalReadback={schema:'IWXA_T3_ORIGINAL_TASK_READBACK/1',
   found:true,taskId:saved.taskId,status:'SIGNED_TASK_PERSISTED_NOT_DELIVERED',
   recipientId:'person:manager',taskRevisionId:A,packageSha256:B};
 // A different contextEpoch remounts the panel; only original signed
 // persisted inventory, NOT its transient previous operationId, survives.
 const found=validateOriginalSignedTaskReadback(originalReadback,
   saved.taskId,'person:manager',saved);
 assert.equal(found.found,true);
 assert.equal(found.taskId,saved.taskId);
 assert.equal(found.packageSha256,B);
 assert.throws(()=>validateOriginalSignedTaskReadback(
   {...originalReadback,packageSha256:C},saved.taskId,'person:manager',saved),
   /CEN_D3_ORIGINAL_TASK_READBACK_UNKNOWN/);
 assert.throws(()=>validateOriginalSignedTaskReadback(
   {...originalReadback,recipientId:'person:other'},saved.taskId,
   'person:manager',saved),/CEN_D3_ORIGINAL_TASK_READBACK_UNKNOWN/);
 assert.throws(()=>validateOriginalSignedTaskReadback(
   {schema:'IWXA_T3_ORIGINAL_TASK_READBACK/1',taskId:saved.taskId,
    found:false,status:'NOT_IN_ORIGINAL_TASK_INVENTORY'},
   saved.taskId,'person:manager',saved),/CEN_D3_ORIGINAL_TASK_READBACK_UNKNOWN/);
 const unknown=validateOriginalSignedTaskReadback({
   schema:'IWXA_T3_ORIGINAL_TASK_READBACK/1',taskId:saved.taskId,
   found:false,status:'NOT_IN_ORIGINAL_TASK_INVENTORY'},
   saved.taskId,'person:manager');
 assert.equal(unknown.found,false);
});

test('D3: one explicit click shows complete original Result without ACCEPT',async()=>{
 const sha='a'.repeat(64),digest='b'.repeat(64),rev='c'.repeat(64);
 const full='Работа завершена. '+'Проверено; '.repeat(950);
 const identity={schema:'IWXA_T3_ORIGINAL_SIGNED_RESULT_REVIEW/1',
   packageSha256:sha,previewDigest:digest,taskId:'task:one',
   taskRevisionId:sha,resultRevisionId:rev,executorId:'person:worker',
   organizationId:'org:1',workspaceId:'workspace:1',
   signatureVerified:true,taskBindingProven:true,taskCatalogVerified:true,
   assignmentText:'Проверить документы',resultLength:full.length};
 const page=offset=>{
   const text=full.slice(offset,offset+4096);
   return {schema:'IWXA_T3_RECONCILIATION_PREVIEW/1',
     packageSha256:sha,previewDigest:digest,entries:[{revisionId:rev}],
     resultInspection:{...identity,offset,resultText:text,
       nextOffset:offset+text.length,hasMore:offset+text.length<full.length}};
 };
 const preview=page(0);
 const first=readOriginalResultReview(preview,'org:1','workspace:1');
 const requested=[],shown=[];
 const result=await readCompleteOriginalResult(first,preview,'org:1','workspace:1',
   async offset=>{requested.push(offset);return page(offset);},
   progress=>shown.push(progress.nextOffset));
 assert.equal(result.resultText,full);
 assert.equal(result.hasMore,false);
 assert.equal(result.nextOffset,full.length);
 assert.ok(requested.length>=2);
 assert.deepEqual(shown,requested.slice(1).concat(full.length));
 await assert.rejects(()=>readCompleteOriginalResult(first,preview,
   'org:1','workspace:1',
   async()=>({...page(4096),previewDigest:'d'.repeat(64)})),
   /CEN_D3_SIGNED_RESULT_REVIEW_STALE/);
 await assert.rejects(()=>readCompleteOriginalResult(first,preview,
   'org:1','workspace:1',async()=>({...page(4096),
     resultInspection:{...page(4096).resultInspection,
       assignmentText:'Другое поручение'}})),
   /CEN_D3_SIGNED_RESULT_REVIEW_STALE/);
});

test('same-employee original Task epoch retains enrollment recovery form but a foreign subject remounts',()=>{
 const view={status:'D3_OWNER_READY',snapshot:{
   product:'admin',organizationId:'org:north',workspaceId:'workspace:north',
   actorId:'person:manager',contextId:'admin:pinned-signed-owner',
   contextEpoch:17,d3RecipientAvailable:true,productionActivation:false,
   T3_READY:false
 }};
 const first=signedD3EmployeeScopeFingerprint(view,'org:north');
 const full=signedD3SessionFingerprint(view,'org:north');
 assert.equal(typeof first,'string');
 assert.equal(typeof full,'string');
 const clone=()=>structuredClone(view);
 for(const nextEpoch of [18,19,200]){
   const next=clone();next.snapshot.contextEpoch=nextEpoch;
   assert.notEqual(signedD3SessionFingerprint(next,'org:north'),full,
     'native D3 binding always changes after a committed Task');
   assert.equal(signedD3EmployeeScopeFingerprint(next,'org:north'),first,
     'only React form survives the same signed owner epoch');
 }
 for(const field of ['organizationId','workspaceId','actorId','contextId']){
   const next=clone();next.snapshot[field]+='-other';
   assert.notEqual(signedD3EmployeeScopeFingerprint(next,next.snapshot.organizationId),
     first,field+' must remount form, not retain an unrelated credential');
 }
 assert.equal(signedD3EmployeeScopeFingerprint(view,'org:foreign'),null);
 const unsigned=clone();unsigned.snapshot.d3RecipientAvailable=false;
 assert.equal(signedD3EmployeeScopeFingerprint(unsigned,'org:north'),null);
});

test('employee public bootstrap binds exact original organization, manager and candidate; never grants authority',async()=>{
 const {readOriginalEmployeeBootstrap,readOriginalEmployeePublicCandidate}=await import('../runtime/cen03-d3-owner.mjs');
 const scope={organizationId:'org:one',workspaceId:'workspace:one',actorId:'person:manager'};
 const pem='-----BEGIN PUBLIC KEY-----\npublic\n-----END PUBLIC KEY-----\n';
 const profile={audience:'iwxa.local.admin',authorityId:'authority:one',confirmedIssuerSha256:A,
  issuerKeyId:'key:issuer',issuerPublicKey:pem,managerPersonId:scope.actorId,
  organizationDataRootId:'root:org',organizationId:scope.organizationId,organizationName:'Company',
  realmId:'realm:one',reviewKeyId:'key:review',reviewPublicKey:pem.replace('public','review'),
  workspaceId:scope.workspaceId};
 const receipt={schema:'IWXA_T3_ORIGINAL_EMPLOYEE_BOOTSTRAP/1',organizationId:scope.organizationId,
  workspaceId:scope.workspaceId,profile,profileDigest:B,originalReadback:true,employeeEnrolled:false,grantIssued:false};
 const checked=readOriginalEmployeeBootstrap(receipt,scope);
 assert.deepEqual(checked,{profile,profileDigest:B});
 for(const patch of [{grantIssued:true},{employeeEnrolled:true},{originalReadback:false},
  {profile:{...profile,managerPersonId:'person:other'}},{profile:{...profile,privateKey:'hidden'}}])
  assert.throws(()=>readOriginalEmployeeBootstrap({...receipt,...patch},scope),/CEN_D3_EMPLOYEE_BOOTSTRAP_READBACK_INVALID/);
 const candidate={schema:'IWXA_T3_ORIGINAL_EMPLOYEE_WINDOWS_CANDIDATE/1',state:'AWAITING_ORIGINAL_MANAGER_ENROLLMENT',
  profileDigest:B,organizationId:scope.organizationId,workspaceId:scope.workspaceId,
  employeePersonId:'person:employee',managerPersonId:scope.actorId,credentialKeyId:'key:employee',
  originalKernelEnrollment:false,originalSignedGrant:false,automaticTransfer:false,T3_READY:false,
  employeeProofKeyRecord:{subjectId:'person:employee',environment:'PRODUCTION',publicKey:pem,status:'ACTIVE',
   uses:['PROOF'],notBefore:'2026-11-23T00:00:00Z',expiresAt:'2027-11-23T00:00:00Z'}};
 assert.equal(readOriginalEmployeePublicCandidate(JSON.stringify(candidate),scope,checked).employeePersonId,'person:employee');
 for(const patch of [{profileDigest:C},{workspaceId:'workspace:foreign'},{originalKernelEnrollment:true},
  {employeePersonId:scope.actorId},{employeeProofKeyRecord:{...candidate.employeeProofKeyRecord,privateKey:'hidden'}}])
  assert.throws(()=>readOriginalEmployeePublicCandidate(JSON.stringify({...candidate,...patch}),scope,checked),
   /CEN_D3_EMPLOYEE_PUBLIC_CANDIDATE_INVALID/);
});

test('employee key and membership responses require the exact outstanding challenge before native confirmation',()=>{
 const key='key:employee',challenge='fresh-challenge';
 const proof={schema:'IWXA_T3_ACCESS_SIGNED/1',keyId:key,
  payload:{kind:'PROOF',challenge,requestDigest:A},signature:'a'.repeat(86)};
 assert.deepEqual(readEmployeeChallengeProof(JSON.stringify(proof),key,challenge),proof);
 assert.throws(()=>readEmployeeChallengeProof(JSON.stringify(proof),key,'new-challenge'),
  /CEN_D3_EMPLOYEE_PROOF_CHALLENGE_MISMATCH/);
 assert.throws(()=>readEmployeeChallengeProof(JSON.stringify(proof),'key:other',challenge),
  /CEN_D3_EMPLOYEE_PROOF_KEY_MISMATCH/);
 for(const raw of ['invalid','null','[]',JSON.stringify({...proof,signature:'short'}),
    JSON.stringify({...proof,payload:{...proof.payload,requestDigest:'not-a-digest'}})])
  assert.throws(()=>readEmployeeChallengeProof(raw,key,challenge),
   /CEN_D3_EMPLOYEE_SIGNED_PROOF_REQUIRED/);
 const ui=readFileSync(new URL('../src/CorporateEmployeeEnrollment.tsx',import.meta.url),'utf8');
 assert.match(ui,/!credentialProofReady\} onClick=\{\(\)=>void confirmCredential\(\)\}/);
 assert.match(ui,/!enrollmentProofReady\} onClick=\{\(\)=>void confirmEnrollment\(\)\}/);
});
