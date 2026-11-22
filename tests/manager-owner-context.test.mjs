import test from 'node:test';
import assert from 'node:assert/strict';
import {readManagerSignedContext,managerSignedInboxArgs,
 prepareManagerOriginalSelection,managerOriginalSelectionMatches} from '../src/manager-owner-context.mjs';
import {searchManagerContext} from '../src/manager-context.mjs';

const hex=(c)=>c.repeat(64);
const view=(organizationId='org:north',workspaceId='workspace:north')=>({
 status:'D3_OWNER_READY',snapshot:{
 product:'admin',organizationId,workspaceId,actorId:'person:manager',
 contextId:'context:original',contextEpoch:23,
 d3RecipientAvailable:true,productionActivation:false,T3_READY:false,
 totalTasks:1,tasks:[{taskId:'task:actual',taskRevisionId:hex('a'),
 packageSha256:hex('b'),summary:'Проверить поставку',deliveryState:'NOT_CONFIRMED'}]
 }});
const inbox=(orgId='org:north',ws='workspace:north')=>({
 schema:'IWXA_T3_ORIGINAL_RECIPIENT_INBOX/1',
 organizationId:orgId,workspaceId:ws,total:3,truncated:false,items:[
  {packageSha256:hex('c'),status:'REVIEW_REQUIRED',acceptanceId:null,operationId:null},
  {packageSha256:hex('d'),status:'ACCEPTED',acceptanceId:hex('e'),operationId:'review:1'},
  {packageSha256:hex('f'),status:'REJECTED',acceptanceId:hex('a'),operationId:'review:2'}
 ]});

test('signed owner shows original tasks and never assumes delivery or Apply',()=>{
 const signed=readManagerSignedContext(view(),'org:north');
 assert.equal(signed.status,'SIGNED_D3_READBACK');
 assert.equal(signed.entries.length,1);
 assert.match(signed.entries[0].summary,/не подтверждена/);
 assert.equal(signed.inboxLoaded,false);
 const all=readManagerSignedContext(view(),'org:north',inbox());
 assert.equal(all.entries.length,4);
 assert.equal(all.inboxTotal,3);
 assert.equal(all.attention.length,1);
 assert.match(all.entries.find(row=>row.id===hex('d')).summary,/не подтверждение отдельного Kernel Apply/);
 assert.equal(searchManagerContext(all.entries,'поставку').length,1);
 assert.equal(searchManagerContext(all.entries,hex('d')).length,1);
});
test('corporate source is isolated by original D3 signed session and Workspace',()=>{
 assert.equal(readManagerSignedContext(view(),'org:south').entries.length,0);
 assert.equal(readManagerSignedContext({status:'NOT_CONNECTED'},'org:north').entries.length,0);
 const other=inbox('org:south','workspace:south');
 assert.throws(()=>readManagerSignedContext(view(),'org:north',other),
   /CEN_MANAGER_SIGNED_INBOX_INVALID/);
 assert.throws(()=>readManagerSignedContext(view(),'org:north',inbox('org:north','workspace:foreign')),
   /CEN_MANAGER_SIGNED_INBOX_INVALID/);
 const different=view('org:south','workspace:south');
 assert.equal(readManagerSignedContext(different,'org:north').status,'NOT_CONNECTED');
 assert.equal(readManagerSignedContext(different,'org:south').totalTasks,1);
});
test('never present malformed, repeated or fabricated receipt states',()=>{
 const duplicate=view();duplicate.snapshot.tasks.push({...duplicate.snapshot.tasks[0]});
 duplicate.snapshot.totalTasks=2;
 assert.throws(()=>readManagerSignedContext(duplicate,'org:north'),/DUPLICATE/);
 const forged=view();forged.snapshot.tasks[0].deliveryState='DELIVERED';
 assert.throws(()=>readManagerSignedContext(forged,'org:north'),/TASK_INVALID/);
 const bad=inbox();bad.items[1].status='APPLIED';
 assert.throws(()=>readManagerSignedContext(view(),'org:north',bad),/RECEIPT_INVALID/);
 const conflict=inbox();conflict.items[0].status='RECEIPT_CONFLICT';
 const projection=readManagerSignedContext(view(),'org:north',conflict);
 assert.match(projection.attention[0].title,/конфликт/);
 assert.equal(projection.inboxTruncated,false);
});
test('read-only original D3 inbox binding is exact current signed context',()=>{
 const signed=view();
 assert.deepEqual(managerSignedInboxArgs(signed,'org:north'),{
  organizationId:'org:north',operation:'d3Inbox',input:{},binding:{
  organizationId:'org:north',workspaceId:'workspace:north',
  contextEpoch:23,actorId:'person:manager',contextId:'context:original'}
 });
 assert.throws(()=>managerSignedInboxArgs(signed,'org:other'),/BINDING_REQUIRED/);
 const changed=view();changed.snapshot.contextEpoch=24;
 assert.notEqual(managerSignedInboxArgs(changed,'org:north').binding.contextEpoch,
   managerSignedInboxArgs(signed,'org:north').binding.contextEpoch);
});

test('navigation locator permits only exact signed source and expires on epoch change',()=>{
 const original=view();
 const read=readManagerSignedContext(original,'org:north',inbox());
 const focus=prepareManagerOriginalSelection(read,'org:north','signed-result-package',hex('c'));
 assert.equal(focus.kind,'signed-result-package');
 assert.equal(managerOriginalSelectionMatches(focus,original.snapshot),true);
 const changed=structuredClone(original.snapshot);changed.contextEpoch++;
 assert.equal(managerOriginalSelectionMatches(focus,changed),false);
 for(const field of ['organizationId','workspaceId','actorId','contextId']){
  const other=structuredClone(original.snapshot);other[field]+='-other';
  assert.equal(managerOriginalSelectionMatches(focus,other),false,field);
 }
 assert.equal(prepareManagerOriginalSelection(read,'org:south','signed-result-package',hex('c')),null);
 assert.equal(prepareManagerOriginalSelection(read,'org:north','signed-result-package',hex('1')),null);
 assert.equal(prepareManagerOriginalSelection(read,'org:north','signed-result-package','not-sha'),null);
 assert.equal(prepareManagerOriginalSelection(read,'org:north','assignment','task:actual'),null);
 const task=prepareManagerOriginalSelection(read,'org:north','signed-task','task:actual');
 assert.equal(task.taskRevisionId,hex('a'));
 assert.equal(task.packageSha256,hex('b'));
 assert.equal(managerOriginalSelectionMatches(task,original.snapshot),true);
 const revised=structuredClone(original.snapshot);revised.tasks[0].taskRevisionId=hex('f');
 assert.equal(managerOriginalSelectionMatches(task,revised),false,
   'same Task ID with another original revision must not be selected');
 assert.equal(managerOriginalSelectionMatches({...task,packageSha256:hex('f')},original.snapshot),false);
 assert.equal(managerOriginalSelectionMatches({...task,kind:'signed-result-package'},original.snapshot),false);
});
