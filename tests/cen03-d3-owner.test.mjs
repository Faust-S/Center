import test from 'node:test';
import assert from 'node:assert/strict';
import {createCorporateOwnerHost} from '../runtime/cen-corporate-owner-host.mjs';
import {signedD3SessionFingerprint} from '../runtime/cen03-review.mjs';
import {MAX_CEN_D3_IWXA_CARRIER_BYTES,readOriginalResultReview,
 appendOriginalResultReview} from '../runtime/cen03-d3-owner.mjs';
import {MAX_CEN_IWXA_CARRIER_BYTES} from '../runtime/cen-corporate-owner-host.mjs';

const A='a'.repeat(64),B='b'.repeat(64),C='c'.repeat(64);
const context=()=>({kind:'CORP',context_id:'context:1',actor_id:'person:manager',
 principal_id:'org:1',role_id:'role:manager',grant_id:'grant:accept',
 organization_id:'org:1',workspace_id:'workspace:1',resource:'workspace:1',
 realm_id:'realm:1',audience:'admin',purpose:'application',scope_revision:7});
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
 const applied=await command(host,'d3ApplyAccepted',selection);
 assert.equal(applied.kernelWriteReadback,'CONFIRMED');
 assert.equal(applied.originalKernelReadback.object.revision,2);
 assert.equal(log.filter(x=>x[0]==='accept').length,1);
 assert.equal(log.filter(x=>x[0]==='apply').length,1);
 assert.deepEqual(log.find(x=>x[0]==='apply')[1].target,target);
 const verified=await command(host,'d3RecoverApplied',selection);
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
