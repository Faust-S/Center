import test from 'node:test';
import assert from 'node:assert/strict';
import {readReviewContinuation as read,rememberReviewContinuation as remember,
 clearUndispatchedReviewContinuation as clear,mergeReviewContinuations as merge,
 validateReviewDecisionReceipt as verify} from '../runtime/cen03-review-continuation.mjs';
const scope={organizationId:'org:one',workspaceId:'workspace:one',actorId:'person:manager',contextEpoch:1};
const sha='a'.repeat(64),acceptance='b'.repeat(64),revision='c'.repeat(64),other='d'.repeat(64);
const marker={operationId:'decision:one',decision:'ACCEPT'};
function disk(){
 const map=new Map();
 return {map,getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v),removeItem:k=>map.delete(k)};
}
test('decision continuation survives restart, isolates exact actor/workspace and never repeats',()=>{
 const storage=disk();
 assert.equal(read(storage,scope,'decision',sha),null);
 remember(storage,scope,'decision',sha,marker);
 assert.deepEqual(read({...storage},{...scope,contextEpoch:2},'decision',sha),marker);
 assert.deepEqual([...storage.map.values()].map(JSON.parse),[marker]);
 assert.throws(()=>remember(storage,scope,'decision',sha,marker),/CONTINUATION_HOLD/);
 remember(storage,scope,'decision',sha,marker,true);
 assert.throws(()=>remember(storage,scope,'decision',sha,{...marker,decision:'REJECT'},true),/CONTINUATION_HOLD/);
 for(const key of ['organizationId','workspaceId','actorId'])
   assert.equal(read(storage,{...scope,[key]:scope[key]+'-other'},'decision',sha),null);
 assert.equal(read(storage,scope,'decision',other),null);
 assert.throws(()=>clear(storage,scope,'decision',sha,{...marker,operationId:'decision:wrong'}),/CONTINUATION_HOLD/);
 clear(storage,scope,'decision',sha,marker);
 assert.equal(read(storage,scope,'decision',sha),null);
});
test('Apply remembers exact original revision selection, not accepted content',()=>{
 const storage=disk(),selection=[revision,other];
 remember(storage,scope,'apply',acceptance,selection);
 selection.pop();
 assert.deepEqual(read(storage,{...scope,contextEpoch:9},'apply',acceptance),[revision,other]);
 assert.throws(()=>remember(storage,scope,'apply',acceptance,[revision]),/CONTINUATION_HOLD/);
 assert.throws(()=>merge('apply',[revision,other],[other,revision]),/CONTINUATION_HOLD/);
 assert.throws(()=>remember(storage,scope,'apply',other,[revision,revision]),/CONTINUATION_HOLD/);
 assert.throws(()=>remember(storage,scope,'apply',other,[]),/CONTINUATION_HOLD/);
 assert.throws(()=>remember(storage,scope,'apply',other,['not-a-revision']),/CONTINUATION_HOLD/);
 assert.deepEqual(merge('apply',[revision,other],null),[revision,other]);
 assert.deepEqual([...storage.map.values()].map(JSON.parse),[[revision,other]]);
 clear(storage,scope,'apply',acceptance,[revision,other]);
 assert.equal(read(storage,scope,'apply',acceptance),null);
});
test('missing or corrupted persistence blocks dispatch; never overwrite an uncertain marker',()=>{
 const storage=disk();
 const noWrite={...storage,setItem:()=>{}};
 assert.throws(()=>remember(noWrite,scope,'decision',sha,marker),/CONTINUATION_HOLD/);
 remember(storage,scope,'decision',sha,marker);
 const key=[...storage.map.keys()][0];
 storage.map.set(key,'{');
 assert.throws(()=>read(storage,scope,'decision',sha),/CONTINUATION_HOLD/);
 assert.throws(()=>remember(storage,scope,'decision',sha,marker),/CONTINUATION_HOLD/);
 assert.equal(storage.map.get(key),'{');
 storage.map.set(key,JSON.stringify({...marker,receipt:'forged'}));
 assert.throws(()=>read(storage,scope,'decision',sha),/CONTINUATION_HOLD/);
 storage.map.set(key,JSON.stringify(marker));
 assert.throws(()=>clear({...storage,removeItem:()=>{}},scope,'decision',sha,marker),/CONTINUATION_HOLD/);
 assert.deepEqual(read(storage,scope,'decision',sha),marker);
});
test('original receipt must match exact operation, package, actor, decision and acceptance',()=>{
 const row={schema:'IWXA_T3_ACCEPTANCE_RECEIPT/1',operationId:marker.operationId,
   packageSha256:sha,decisionBy:scope.actorId,acceptanceState:'ACCEPTED',acceptanceId:acceptance};
 const response={found:true,kernelApplication:'NOT_ATTESTED_BY_RECONCILIATION_RECEIPT',receipt:row};
 assert.equal(verify(response,scope,sha,marker.operationId,'ACCEPT'),response);
 for(const change of [{operationId:'decision:other'},{packageSha256:other},
   {decisionBy:'person:other'},{acceptanceId:'bad'},{schema:'IWXA_T3_REJECTION_RECEIPT/1'}])
   assert.throws(()=>verify({...response,receipt:{...row,...change}},scope,sha,marker.operationId,'ACCEPT'),/RECEIPT_INVALID/);
 assert.throws(()=>verify(response,scope,sha,marker.operationId,'REJECT'),/RECEIPT_INVALID/);
 const absent={...response,found:false,receipt:null};
 assert.equal(verify(absent,scope,sha,marker.operationId),absent);
});
