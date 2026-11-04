// Read-only view over original T3 interop/runtime.mjs applicationSummary().
 // The owner validates signatures, Store/Journal and causal evidence. This
 // projection neither verifies signatures itself nor stores independent results.
 const isHex64=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
 const requireValue=(ok,code)=>{if(!ok)throw Error(code);};
 export function readAppliedResults(snapshot,organizationId,workspaceId){
   requireValue(snapshot?.product==='admin' &&
     snapshot.organizationId===organizationId &&
     snapshot.workspaceId===workspaceId,'CEN_APPLIED_ORGANIZATION_CHANGED');
   const application=snapshot.application;
   if(application?.status==='HOLD_FOR_EXPLICIT_RECOVERY')
     return {status:'HOLD_FOR_EXPLICIT_RECOVERY',records:[]};
   if(application?.status!=='LOCAL_ENCRYPTED_STORE_CONFIRMED')
     return {status:application?.status??'NOT_PRESENT',records:[]};
   requireValue(application.externalContextCoreApplied===false &&
     Array.isArray(application.records),'CEN_APPLIED_READBACK_UNVERIFIED');
   const keys=new Set(),records=[];
   for(const record of application.records){
     requireValue(record && record.organizationId===organizationId &&
       record.workspaceId===workspaceId,'CEN_APPLIED_SCOPE_MISMATCH');
     requireValue(typeof record.taskId==='string' && record.taskId.startsWith('task:') &&
       isHex64(record.taskRevisionId) && isHex64(record.resultRevisionId) &&
       typeof record.executorId==='string' && record.executorId.length>0 &&
       typeof record.acceptanceId==='string' && record.acceptanceId.length>0 &&
       typeof record.result==='string' && record.result.length<=100000,
       'CEN_APPLIED_RECORD_INVALID');
     const key=JSON.stringify([record.taskId,record.taskRevisionId,record.resultRevisionId]);
     requireValue(!keys.has(key),'CEN_APPLIED_DUPLICATE_RECORD');
     keys.add(key);
     records.push({taskId:record.taskId,taskRevisionId:record.taskRevisionId,
       resultRevisionId:record.resultRevisionId,executorId:record.executorId,
       acceptanceId:record.acceptanceId,organizationId,workspaceId,result:record.result});
   }
   return {status:'LOCAL_ENCRYPTED_STORE_CONFIRMED',records};
 }
 // Manual selection for a NEW draft, not an automatic Task revision or reissue.
 // The current Center description field is 6000 UTF-16 code units; T3's entire
 // Task bound is 10000. Never silently shorten or overwrite an open editor.
 export function prepareAppliedReuse(readback,{taskId,resultRevisionId,text,existingText=''}){
   requireValue(readback?.status==='LOCAL_ENCRYPTED_STORE_CONFIRMED',
     'CEN_REUSE_APPLICATION_NOT_CONFIRMED');
   const source=readback.records.find(r=>r.taskId===taskId &&
     r.resultRevisionId===resultRevisionId);
   requireValue(source,'CEN_REUSE_SOURCE_NOT_IN_READBACK');
   requireValue(typeof text==='string' && text.trim().length>0,'CEN_REUSE_TEXT_REQUIRED');
   requireValue(text.length<=10000,'CEN_REUSE_TASK_TEXT_TOO_LARGE');
   requireValue(text.length<=6000,'CEN_REUSE_DESCRIPTION_TOO_LARGE');
   requireValue(typeof existingText==='string' &&
     (!existingText.trim() || existingText===text),'CEN_REUSE_EDITOR_NOT_EMPTY');
   return {description:text,source:{taskId:source.taskId,taskRevisionId:source.taskRevisionId,
     resultRevisionId:source.resultRevisionId,acceptanceId:source.acceptanceId,
     organizationId:source.organizationId,workspaceId:source.workspaceId},
     effect:'DRAFT_EDITOR_ONLY',newSignedTask:false,delivered:false};
 }

// This read-only projection compares the original T3 effect receipt with a
// fresh T3 applicationSummary() readback of encrypted Store and Journal.
// It does not verify signatures independently, perform writes or authorize
// any application in Atlas/Personal Agent.
export function verifyAppliedCommitReadback({
  receipt,snapshot,organizationId,workspaceId,acceptanceId,revisionIds
}={}){
  const fail='T3_APPLICATION_POSTCOMMIT_READBACK_HOLD';
  requireValue(isHex64(acceptanceId) && Array.isArray(revisionIds) &&
    revisionIds.length>0 && revisionIds.length<=32 &&
    revisionIds.every(isHex64) && new Set(revisionIds).size===revisionIds.length,fail);
  requireValue(receipt?.schema==='IWXA_T3_LOCAL_APPLICATION_EFFECT_RECEIPT/1' &&
    receipt.status==='LOCAL_ENCRYPTED_STORE_CONFIRMED' &&
    receipt.journalStatus==='COMMITTED' &&
    isHex64(receipt.effectKey) &&
    receipt.sourceAcceptanceId===acceptanceId &&
    receipt.target?.subjectId===organizationId &&
    receipt.target?.workspaceId===workspaceId &&
    receipt.target?.consumerId==='IWXA_ADMIN_CENTER' &&
    receipt.target?.processId==='admin.applied-results' &&
    receipt.action==='application.apply' &&
    receipt.externalContextCoreApplied===false,fail);
  let view;
  try { view=readAppliedResults(snapshot,organizationId,workspaceId); }
  catch { throw Error(fail); }
  requireValue(view.status==='LOCAL_ENCRYPTED_STORE_CONFIRMED',fail);
  const matches=snapshot.application.effects?.filter(effect=>
    effect.effectKey===receipt.effectKey &&
    effect.status==='LOCAL_ENCRYPTED_STORE_CONFIRMED' &&
    effect.journalStatus==='COMMITTED');
  requireValue(matches?.length===1,fail);
  for (const id of revisionIds) {
    requireValue(view.records.filter(row=>
      row.resultRevisionId===id && row.acceptanceId===acceptanceId).length===1,fail);
  }
  return {status:'LOCAL_ENCRYPTED_STORE_CONFIRMED',
    effectKey:receipt.effectKey,sourceAcceptanceId:acceptanceId,
    verifiedRevisionIds:[...revisionIds],externalContextCoreApplied:false};
}
