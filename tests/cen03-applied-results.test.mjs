import test from 'node:test';
import assert from 'node:assert/strict';
import {readAppliedResults,prepareAppliedReuse} from '../runtime/cen03-applied-results.mjs';
import {createT3AdminPort} from '../runtime/t3-admin-port.mjs';
import {canDecideReviewedResult,acceptedApplicationSelection} from '../runtime/cen03-review.mjs';

const A='a'.repeat(64),B='b'.repeat(64);
const record={organizationId:'org:1',workspaceId:'workspace:1',taskId:'task:old',
  taskRevisionId:A,resultRevisionId:B,executorId:'person:staff',
  acceptanceId:'acceptance:1',result:'Part of a verified report'};
const snapshot=()=>({product:'admin',organizationId:'org:1',
  workspaceId:'workspace:1',personId:'person:admin',contextEpoch:3,
  application:{status:'LOCAL_ENCRYPTED_STORE_CONFIRMED',
    records:[{...record}],externalContextCoreApplied:false}});
const binding={organizationId:'org:1',workspaceId:'workspace:1',contextEpoch:3};

test('CEN03 reads only owner-confirmed applied results, with exact source IDs',()=>{
 const s=snapshot(),owner={product:'admin',snapshot:()=>structuredClone(s)};
 const port=createT3AdminPort(owner);
 const read=port.reusableResults({binding});
 assert.equal(read.status,'LOCAL_ENCRYPTED_STORE_CONFIRMED');
 assert.deepEqual(read.records[0],record);
 const reuse=prepareAppliedReuse(read,{taskId:record.taskId,resultRevisionId:B,
   text:'Inspect the revised delivery'});
 assert.equal(reuse.description,'Inspect the revised delivery');
 assert.equal(reuse.source.taskRevisionId,A);
 assert.equal(reuse.source.organizationId,'org:1');
 assert.equal(reuse.source.workspaceId,'workspace:1');
 assert.equal(reuse.effect,'DRAFT_EDITOR_ONLY');
 assert.equal(reuse.newSignedTask,false);
 assert.equal(reuse.delivered,false);
 assert.deepEqual(owner.snapshot().application.records,[record]);
});

test('CEN03 does not reuse a received or merely accepted, but unapplied Result',()=>{
 const s=snapshot();
 for(const status of ['NOT_PRESENT','PREVIEW_ONLY','APPLICATION_DECISION_RECORDED']){
   s.application.status=status;
   const read=readAppliedResults(s,'org:1','workspace:1');
   assert.equal(read.records.length,0);
   assert.throws(()=>prepareAppliedReuse(read,{taskId:record.taskId,
     resultRevisionId:B,text:'test'}),/CEN_REUSE_APPLICATION_NOT_CONFIRMED/);
 }
 s.application.status='HOLD_FOR_EXPLICIT_RECOVERY';
 assert.equal(readAppliedResults(s,'org:1','workspace:1').status,'HOLD_FOR_EXPLICIT_RECOVERY');
 assert.equal(readAppliedResults(s,'org:1','workspace:1').records.length,0);
});

test('CEN03 never leaks confirmed Result across organization or workspace',()=>{
 const s=snapshot();
 assert.throws(()=>readAppliedResults(s,'org:other','workspace:1'),/ORGANIZATION_CHANGED/);
 assert.throws(()=>readAppliedResults(s,'org:1','workspace:other'),/ORGANIZATION_CHANGED/);
 s.application.records[0].organizationId='org:other';
 assert.throws(()=>readAppliedResults(s,'org:1','workspace:1'),/SCOPE_MISMATCH/);
});

test('CEN03 refuses malformed/uncertain Store readback and duplicate references',()=>{
 const s=snapshot();
 s.application.externalContextCoreApplied=true;
 assert.throws(()=>readAppliedResults(s,'org:1','workspace:1'),/READBACK_UNVERIFIED/);
 s.application.externalContextCoreApplied=false;
 s.application.records.push({...record});
 assert.throws(()=>readAppliedResults(s,'org:1','workspace:1'),/DUPLICATE_RECORD/);
 s.application.records=[{...record,resultRevisionId:'not-sha'}];
 assert.throws(()=>readAppliedResults(s,'org:1','workspace:1'),/RECORD_INVALID/);
});

test('CEN03 requires explicit nonblank bounded text and never overwrites a draft',()=>{
 const read=readAppliedResults(snapshot(),'org:1','workspace:1');
 const args={taskId:record.taskId,resultRevisionId:B};
 assert.throws(()=>prepareAppliedReuse(read,{...args,text:''}),/TEXT_REQUIRED/);
 assert.throws(()=>prepareAppliedReuse(read,{...args,text:'x'.repeat(10001)}),/TASK_TEXT_TOO_LARGE/);
 assert.throws(()=>prepareAppliedReuse(read,{...args,text:'x'.repeat(6001)}),/DESCRIPTION_TOO_LARGE/);
 assert.throws(()=>prepareAppliedReuse(read,{...args,text:'selected',existingText:'older'}),/EDITOR_NOT_EMPTY/);
 assert.throws(()=>prepareAppliedReuse(read,{...args,resultRevisionId:A,text:'selected'}),/SOURCE_NOT_IN_READBACK/);
});

test('CEN03 rechecks owner context after reading application snapshot',()=>{
 let epoch=3;
 const owner={product:'admin',snapshot(){const s=snapshot();s.contextEpoch=epoch;epoch++;return s;}};
 const port=createT3AdminPort(owner);
 assert.throws(()=>port.reusableResults({binding}),/CONTEXT_CHANGED/);
});

const H='d'.repeat(64),REV='e'.repeat(64),DIGEST='f'.repeat(64);
function reviewed(state='PENDING'){
  return {verificationState:'VERIFIED',reviewLedgerConsistent:true,
    taskBinding:{proven:true,taskRevisionId:A},
    preview:{packageSha256:H,previewDigest:DIGEST,
      allowedAction:state==='PENDING'?'EXPLICIT_ACCEPT_ONLY':'ALREADY_DECIDED'},
    receipt:state==='PENDING'?null:
      {packageSha256:H,acceptanceState:state,acceptanceId:'acceptance:verified'},
    changes:[{operation:'UPSERT',revisionId:REV}],
    revisionCurrentness:[{revisionId:REV,
      currentness:state==='ACCEPTED'?'CURRENT_BOUNDED':'NOT_ACCEPTED',
      eligibleForLocalInterpretation:state==='ACCEPTED',
      protectedActionAuthorized:false}]};
}
test('CEN03 UI only permits explicit decisions before a persisted receipt',()=>{
 const pending=reviewed();
 assert.equal(canDecideReviewedResult(pending,H,'ACCEPT'),true);
 assert.equal(canDecideReviewedResult(pending,H,'REJECT'),true);
 assert.equal(acceptedApplicationSelection(pending,H),null);
 assert.equal(canDecideReviewedResult(pending,'0'.repeat(64),'ACCEPT'),false);
 assert.equal(canDecideReviewedResult(pending,H,'CHANGES_REQUESTED'),false);
 const accepted=reviewed('ACCEPTED');
 assert.equal(canDecideReviewedResult(accepted,H,'ACCEPT'),false);
 assert.equal(canDecideReviewedResult(accepted,H,'REJECT'),false);
 assert.deepEqual(acceptedApplicationSelection(accepted,H),{
   acceptanceId:'acceptance:verified',revisionIds:[REV]});
 assert.equal(acceptedApplicationSelection(reviewed('REJECTED'),H),null);
});
test('CEN03 UI never enables Apply from stale, untrusted or mismatched review evidence',()=>{
 const valid=reviewed('ACCEPTED');
 const withPatch=(mutate)=>{const copy=structuredClone(valid);mutate(copy);return copy};
 const invalid=[
  withPatch(x=>x.verificationState='UNTRUSTED'),
  withPatch(x=>x.reviewLedgerConsistent=false),
  withPatch(x=>x.taskBinding.proven=false),
  withPatch(x=>x.receipt.packageSha256='0'.repeat(64)),
  withPatch(x=>x.revisionCurrentness[0].currentness='UNKNOWN_EVIDENCE'),
  withPatch(x=>x.revisionCurrentness[0].eligibleForLocalInterpretation=false),
  withPatch(x=>x.revisionCurrentness[0].protectedActionAuthorized=true),
  withPatch(x=>x.revisionCurrentness=[]),
  withPatch(x=>x.changes.push({...x.changes[0]}))
 ];
 for(const bad of invalid)assert.equal(acceptedApplicationSelection(bad,H),null);
 assert.equal(acceptedApplicationSelection(valid,'0'.repeat(64)),null);
});

test('CEN03 permits reasoned REJECT of stable but untrusted packages without enabling ACCEPT',()=>{
  const untrusted=reviewed();
  untrusted.verificationState='UNTRUSTED';
  untrusted.preview.allowedAction='HOLD_FOR_REVIEW';
  assert.equal(canDecideReviewedResult(untrusted,H,'ACCEPT'),false);
  assert.equal(canDecideReviewedResult(untrusted,H,'REJECT'),true);
  untrusted.reviewLedgerConsistent=false;
  assert.equal(canDecideReviewedResult(untrusted,H,'REJECT'),false);
});
