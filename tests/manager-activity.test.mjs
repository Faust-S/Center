import test from 'node:test';
import assert from 'node:assert/strict';
import {managerActivityArgs,readManagerActivity,managerActivityMatchesSignedOwner,managerActivityFailureCode}
 from '../src/manager-activity.mjs';
import {readManagerSignedContext} from '../src/manager-owner-context.mjs';
const view=(org='org:north',ws='workspace:north')=>({
 status:'D3_OWNER_READY',snapshot:{
  product:'admin',organizationId:org,workspaceId:ws,actorId:'person:manager',
  contextId:'context:manager',contextEpoch:4,
  d3RecipientAvailable:true,productionActivation:false,T3_READY:false,
  d2ActivityReaderConnected:true,
  tasks:[],totalTasks:0
 }
});
const response=(org='org:north',ws='workspace:north')=>({
 schema:'IWXA_T3_ORIGINAL_ADMIN_ACTIVITY_READBACK/1',
 organizationId:org,workspaceId:ws,actorId:'person:manager',
 source:'ORIGINAL_T2_KERNEL_D1_ACTIVITY_DATA',
 evidenceScope:'METADATA_ONLY_NOT_BUSINESS_COMPLETION_PROOF',
 view:{workspace_id:ws,
  nodes:[{object_id:'iwxa.admin.applied-results',revision:2,
   schema_id:'iwxa.admin.applied-results',schema_version:'1.0.0',
   semantic_kind:'Result'}],
  events:[{event_id:'event:1',event_type:'iwxa.admin.result.applied',
   semantic_kind:'Event',epistemic_status:'reported',
   occurred_at:'2026-11-22T01:00:00.000Z',object_ref:{
    object_id:'iwxa.admin.applied-results',revision:2}}],
  relations:[],unresolved:[],
  unmapped:{object_ids:['private:unbound'],event_ids:[],relation_ids:[]}
 }
});
test('signed read args preserve exact original native context, no extra scope',()=>{
 const args=managerActivityArgs(view(),'org:north');
 assert.deepEqual(args,{organizationId:'org:north',operation:'d2ActivityReadback',input:{},
  binding:{organizationId:'org:north',workspaceId:'workspace:north',
   contextEpoch:4,actorId:'person:manager',contextId:'context:manager'}});
 assert.throws(()=>managerActivityArgs(view(),'org:south'),/SIGNED_READER_REQUIRED/);
 assert.throws(()=>managerActivityArgs({status:'NOT_CONNECTED'},'org:north'),
  /SIGNED_READER_REQUIRED/);
});
test('original D2 reports only verified metadata, never Object.data or event payload',()=>{
 const original=response();original.view.nodes[0].data={private:'should not appear'};
 original.view.events[0].payload={secret:'do not display'};
 const x=readManagerActivity(view(),'org:north',original);
 assert.equal(x.entries.length,2);
 assert.equal(x.counts.objects,1);
 assert.equal(x.counts.events,1);
 assert.equal(x.counts.unmappedObjects,1);
 assert.match(x.entries[0].source,/подписанное DATA/);
 assert.match(x.entries[1].summary,/не доказательство/);
 assert.equal(JSON.stringify(x).includes('should not appear'),false);
 assert.equal(JSON.stringify(x).includes('do not display'),false);
 assert.equal(JSON.stringify(x).includes('private:unbound'),false);
 const owner=readManagerSignedContext(view(),'org:north');
 assert.equal(managerActivityMatchesSignedOwner(x,owner),true);
});
test('other organization or workspace cannot reuse original D2 projection',()=>{
 assert.throws(()=>readManagerActivity(view(),'org:north',
  response('org:south','workspace:south')),/ACTIVITY_INVALID/);
 assert.throws(()=>readManagerActivity(view(),'org:north',
  response('org:north','workspace:other')),/ACTIVITY_INVALID/);
 assert.throws(()=>readManagerActivity(view(),'org:south',response()),/SIGNED_READER_REQUIRED/);
 const x=readManagerActivity(view(),'org:north',response());
 const other=readManagerSignedContext(view('org:south','workspace:south'),'org:south');
 assert.equal(managerActivityMatchesSignedOwner(x,other),false);
 const newEpoch=view();newEpoch.snapshot.contextEpoch++;
 assert.equal(managerActivityMatchesSignedOwner(x,
   readManagerSignedContext(newEpoch,'org:north')),false);
});
test('unsafe event/objects and invented semantic conclusion fail before display',()=>{
 const a=response();a.view.events[0].epistemic_status='accepted-business-result';
 assert.throws(()=>readManagerActivity(view(),'org:north',a),/EVENT_INVALID/);
 const b=response();b.view.nodes[0].semantic_kind='VerifiedEmployeeCompetence';
 assert.throws(()=>readManagerActivity(view(),'org:north',b),/OBJECT_INVALID/);
 const c=response();c.view.nodes.push({...c.view.nodes[0]});
 assert.throws(()=>readManagerActivity(view(),'org:north',c),/SOURCE_DUPLICATE/);
 const d=response();d.view.nodes[0].schema_id='foreign schema';
 assert.throws(()=>readManagerActivity(view(),'org:north',d),/OBJECT_INVALID/);
 const e=response();e.source='UNSIGNED_JSON';
 assert.throws(()=>readManagerActivity(view(),'org:north',e),/ACTIVITY_INVALID/);
});
test('absent signed original D2 read capability never authorizes a call',()=>{
 const disconnected=view();disconnected.snapshot.d2ActivityReaderConnected=false;
 assert.throws(()=>managerActivityArgs(disconnected,'org:north'),/SIGNED_READER_REQUIRED/);
 assert.throws(()=>readManagerActivity(disconnected,'org:north',response()),
  /SIGNED_READER_REQUIRED/);
});

test('manager D2 error exposes only trusted machine code, never sensitive message',()=>{
 assert.equal(managerActivityFailureCode('CEN_D2_ORIGINAL_SIGNED_READER_REQUIRED'),
   'CEN_D2_ORIGINAL_SIGNED_READER_REQUIRED');
 assert.equal(managerActivityFailureCode(Error('T3_D2_ORIGINAL_ACTIVITY_READER_NOT_CONNECTED')),
   'T3_D2_ORIGINAL_ACTIVITY_READER_NOT_CONNECTED');
 assert.equal(managerActivityFailureCode({code:'T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED',message:'local secret'}),
   'T3_D3_ORIGINAL_KERNEL_SESSION_CHANGED');
 assert.equal(managerActivityFailureCode({code:'T3_ACCESS_NOT_PERMITTED',message:'C:\\\\Users\\\\private\\\\vault.json'}),
   'T3_ACCESS_NOT_PERMITTED');
 assert.equal(managerActivityFailureCode('Error: T3_KERNEL_OPERATION_NOT_GRANTED'),
   'T3_KERNEL_OPERATION_NOT_GRANTED');
 assert.equal(managerActivityFailureCode({code:'T3_HOST_DISPOSED'}),
   'T3_HOST_DISPOSED');
 assert.equal(managerActivityFailureCode('T3_ACCESS_NOT_PERMITTED private key file'),
   'CEN_D2_SOURCE_READ_FAILED');
 assert.equal(managerActivityFailureCode('Error: T3_D2_ORIGINAL_DATA_GRANT_REQUIRED'),
   'T3_D2_ORIGINAL_DATA_GRANT_REQUIRED');
 assert.equal(managerActivityFailureCode('C:\\Users\\alice\\secret\\private-key.json'),
   'CEN_D2_SOURCE_READ_FAILED');
 assert.equal(managerActivityFailureCode('Error: T3_D2_INVALID C:\\private\\credentials'),
   'CEN_D2_SOURCE_READ_FAILED');
 assert.equal(managerActivityFailureCode({message:'TypeError: data payload value'}),
   'CEN_D2_SOURCE_READ_FAILED');
 assert.equal(managerActivityFailureCode(null),'CEN_D2_SOURCE_READ_FAILED');
});
