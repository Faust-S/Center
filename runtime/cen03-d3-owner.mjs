// CEN03: a product-facing port over the ORIGINAL signed T3 D3 recipient.
// The actual Reconciliation ledger, Human Review, signed D1 authorization,
// sealed application binding, Kernel commit and readback remain with T3.
// This adapter has no Store, signer, grant evaluator or automatic retry.
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const SHA=/^[a-f0-9]{64}$/;
// The installed original corporate D3 owner accepts up to 32 MiB, not the
// larger browser-host carrier limit. Match the existing Windows file picker.
export const MAX_CEN_D3_IWXA_CARRIER_BYTES=32*1024*1024;
const TARGET_FIELDS=['consumerId','processId','processVersion','purpose',
  'subjectId','workspaceId','dataRootId'];
const CONTEXT_FIELDS=['kind','context_id','actor_id','principal_id','role_id',
  'grant_id','organization_id','workspace_id','resource','realm_id',
  'audience','purpose','scope_revision'];
const validId=value=>typeof value==='string'&&ID.test(value);
const validSha=value=>typeof value==='string'&&SHA.test(value);
const fail=code=>{const e=new Error(code);e.code=code;throw e;};
const need=(ok,code)=>{if(!ok)fail(code);};
const sameSubject=(a,b)=>JSON.stringify(CONTEXT_FIELDS.map(field=>a?.[field]))===
  JSON.stringify(CONTEXT_FIELDS.map(field=>b?.[field]));
const copy=(value,code)=>{try{return structuredClone(value);}catch{fail(code);}};
function originalArchive(value){
 need(Array.isArray(value)&&value.length>0&&value.length<=MAX_CEN_D3_IWXA_CARRIER_BYTES,
   'CEN_D3_CARRIER_INVALID');
 // Array.every skips holes, so enumerate every physical index.
 for(let i=0;i<value.length;i++)need(Object.hasOwn(value,i)&&
   Number.isInteger(value[i])&&value[i]>=0&&value[i]<=255,'CEN_D3_CARRIER_INVALID');
 return Uint8Array.from(value);
}
function sourceSelection(value){
 need(validSha(value?.acceptanceId)&&Array.isArray(value.revisionIds)&&
   value.revisionIds.length>0&&value.revisionIds.length<=32&&
   value.revisionIds.every(validSha)&&
   new Set(value.revisionIds).size===value.revisionIds.length,
   'CEN_D3_ACCEPTED_SOURCE_INVALID');
 return {acceptanceId:value.acceptanceId,revisionIds:[...value.revisionIds]};
}
function checkedReceipt(outcome,operationId,packageSha256,actorId){
 need(outcome?.kernelApplication==='NOT_ATTESTED_BY_RECONCILIATION_RECEIPT'&&
   typeof outcome.found==='boolean','CEN_D3_RECEIPT_INVALID');
 if(outcome.found){
   const r=outcome.receipt;
   need(r?.operationId===operationId&&r.packageSha256===packageSha256&&
     r.decisionBy===actorId&&
     ['IWXA_T3_ACCEPTANCE_RECEIPT/1','IWXA_T3_REJECTION_RECEIPT/1']
       .includes(r.schema),'CEN_D3_RECEIPT_WRONG_SOURCE');
 }else need(outcome.receipt===null,'CEN_D3_RECEIPT_INVALID');
 return outcome;
}
function checkedTarget(value,context){
 need(value!==null&&typeof value==='object'&&!Array.isArray(value)&&
   TARGET_FIELDS.every(field=>validId(value[field]))&&
   value.subjectId===context.organization_id&&
   value.workspaceId===context.workspace_id&&
   ['IWXA_ADMIN_CENTER','IWXA_CONTROL_CENTER'].includes(value.consumerId),
   'CEN_D3_ORIGINAL_APPLICATION_TARGET_REQUIRED');
 return copy(value,'CEN_D3_APPLICATION_TARGET_INVALID');
}
// Only the ORIGINAL signed owner can prove a committed graph. The Center
// boundary checks that its read-only Object and Event evidence refers to
// the exact selected acceptance and original effect, not a similar object.
function checkedKernelRecovery(result,context,selection){
 const confirmed=result?.status==='ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED';
 need((confirmed||result?.status==='OUTCOME_UNKNOWN')&&
   validSha(result.effectKey)&&result.automaticRetryAllowed===false&&
   result.kernelWriteReadback===(confirmed?'CONFIRMED':'NOT_CONFIRMED'),
   'CEN_D3_KERNEL_RECOVERY_READBACK_INVALID');
 if(!confirmed){
   need(result.originalKernelReadback==null&&result.originalEventReadback==null,
     'CEN_D3_KERNEL_RECOVERY_READBACK_INVALID');
   return result;
 }
 const object=result.originalKernelReadback?.object;
 const event=result.originalEventReadback;
 const recorded=event?.payload?.reconciliation_revision_ids;
 need(result.externalProductAcceptance==='NOT_ACCEPTED'&&
   object?.workspace_id===context.workspace_id&&
   validId(object.object_id)&&Number.isSafeInteger(object.revision)&&
   object.revision>0&&
   event?.workspace_id===context.workspace_id&&
   validId(event.event_id)&&event.idempotency_key===result.effectKey&&
   (event.object_id==null||event.object_id===object.object_id)&&
   (event.revision==null||event.revision===object.revision)&&
   event.payload?.reconciliation_acceptance_id===selection.acceptanceId&&
   Array.isArray(recorded)&&recorded.length===selection.revisionIds.length&&
   recorded.every(validSha)&&
   JSON.stringify([...recorded].sort())===
     JSON.stringify([...selection.revisionIds].sort()),
   'CEN_D3_KERNEL_RECOVERY_READBACK_INVALID');
 return result;
}

// A trusted native product Host, never WebView, supplies:
// admission = createTrustedReconciliationAdmission(original private recipient),
// access = the existing signed D1 owner, apply = optional original Kernel port,
// applicationTargetFor = mapping owned by the private original application host.
// No public reference runtime with T3_READY=false may be substituted here.
export function createCenD3OwnerHost({admission,access,apply=null,
  applicationTargetFor=null}={}){
 need(admission&&['receive','preview','receipt','accept','reject',
   'inspectAcceptedApplication'].every(method=>typeof admission[method]==='function')&&
   access&&typeof access.currentContext==='function',
   'CEN_D3_ORIGINAL_SIGNED_OWNER_REQUIRED');
 need(apply===null||typeof apply.applyAccepted==='function',
   'CEN_D3_ORIGINAL_KERNEL_APPLY_REQUIRED');
 need(applicationTargetFor===null||typeof applicationTargetFor==='function',
   'CEN_D3_ORIGINAL_APPLICATION_TARGET_REQUIRED');
 let closed=false;
 async function selected(organizationId){
   need(!closed,'CEN_D3_HOST_CLOSED');
   need(validId(organizationId),'CEN_D3_ORGANIZATION_REQUIRED');
   const c=copy(await access.currentContext(),'CEN_D3_SIGNED_CONTEXT_INVALID');
   need(c?.kind==='CORP'&&
     CONTEXT_FIELDS.slice(1,-1).every(field=>validId(c[field]))&&
     Number.isSafeInteger(c.scope_revision)&&c.scope_revision>0&&
     c.organization_id===organizationId&&c.principal_id===organizationId&&
     c.workspace_id===c.resource,
     'CEN_D3_SIGNED_CORPORATE_CONTEXT_REQUIRED');
   return c;
 }
 function bound(c,organizationId,binding){
   need(binding?.organizationId===organizationId&&
     binding.workspaceId===c.workspace_id&&
     binding.contextEpoch===c.scope_revision&&
     binding.actorId===c.actor_id&&binding.contextId===c.context_id,
     'CEN_D3_CONTEXT_CHANGED');
 }
 async function state({organizationId}={}){
   const c=await selected(organizationId);
   return {status:'D3_OWNER_READY',snapshot:{
     product:'admin',organizationId,workspaceId:c.workspace_id,
     personId:c.actor_id,actorId:c.actor_id,contextId:c.context_id,
     contextEpoch:c.scope_revision,d3RecipientAvailable:true,
     d3ApplyAvailable:apply!==null&&applicationTargetFor!==null,
     d3ApplyRecoverAvailable:apply!==null&&
       typeof apply.recoverApplied==='function'&&applicationTargetFor!==null,
     // D3 readiness is NOT the entire T3 release/production activation.
     productionActivation:false,T3_READY:false,
   }};
 }
 async function targetFor(c,selection){
   need(apply!==null&&applicationTargetFor!==null,'CEN_D3_APPLY_NOT_CONNECTED');
   return checkedTarget(await applicationTargetFor(copy(c,
     'CEN_D3_SIGNED_CONTEXT_INVALID'),copy(selection,
     'CEN_D3_ACCEPTED_SOURCE_INVALID')),c);
 }
 async function action({organizationId,operation,input={},binding}={}){
   const c=await selected(organizationId);
   bound(c,organizationId,binding);
   need(input!==null&&typeof input==='object'&&!Array.isArray(input),
     'CEN_D3_INPUT_INVALID');
   const id=input.operationId,sha=input.packageSha256;
   let result,entered=false;
   const mayWrite=['d3Receive','d3Decide','d3ApplyAccepted'].includes(operation);
   try{
     if(operation==='d3Receive'){
       const bytes=originalArchive(input.bytes);
       entered=true;
       result=await admission.receive(bytes);
       need(validSha(result?.preview?.packageSha256)&&
         result?.acceptanceState==='NOT_ACCEPTED'&&
         result?.kernelApplication==='NOT_APPLIED',
         'CEN_D3_RECEIVE_READBACK_UNKNOWN');
     }else if(operation==='d3Preview'){
       need(validSha(sha),'CEN_D3_PACKAGE_SHA_REQUIRED');
       result=await admission.preview(sha);
       need(result?.schema==='IWXA_T3_RECONCILIATION_PREVIEW/1'&&
         result.packageSha256===sha&&validSha(result.previewDigest),
         'CEN_D3_ORIGINAL_PREVIEW_INVALID');
     }else if(operation==='d3Receipt'){
       need(validId(id)&&validSha(sha),'CEN_D3_RECEIPT_QUERY_REQUIRED');
       result=checkedReceipt(await admission.receipt(id,sha),id,sha,c.actor_id);
     }else if(operation==='d3Decide'){
       need(validId(id)&&validSha(sha)&&validSha(input.previewDigest)&&
         ['ACCEPT','REJECT'].includes(input.decision)&&
         (input.decision!=='REJECT'||
           (typeof input.reason==='string'&&input.reason.trim().length>0&&
             input.reason.length<=1000)),'CEN_D3_EXPLICIT_DECISION_REQUIRED');
       const args={operationId:id,packageSha256:sha,
         previewDigest:input.previewDigest,decisionBy:c.actor_id,
         ...(input.decision==='REJECT'?{reason:input.reason}:{} )};
       // The original owner performs its independent HUMAN review and
       // re-checks the signed issuer at the actual Reconciliation JIT.
       entered=true;
       result=await admission[input.decision==='ACCEPT'?'accept':'reject'](args);
       need(result?.receipt?.operationId===id&&
         result.receipt.packageSha256===sha&&
         result.receipt.decisionBy===c.actor_id&&
         result.acceptanceState===
           (input.decision==='ACCEPT'?'ACCEPTED':'REJECTED')&&
         result.kernelApplication==='NOT_APPLIED',
         'CEN_D3_DECISION_OUTCOME_UNKNOWN');
     }else if(operation==='d3InspectAccepted'){
       const selection=sourceSelection(input);
       need(applicationTargetFor!==null,'CEN_D3_APPLY_NOT_CONNECTED');
       const target=checkedTarget(await applicationTargetFor(copy(c,
         'CEN_D3_SIGNED_CONTEXT_INVALID'),copy(selection,
         'CEN_D3_ACCEPTED_SOURCE_INVALID')),c);
       result=await admission.inspectAcceptedApplication({...selection,target});
       need(result?.schema==='IWXA_T3_APPLICATION_PROJECTION_CANDIDATE/1'&&
         result.status==='CANDIDATE_REQUIRES_INDEPENDENT_HOST_AUTHORIZATION'&&
         result.applicationAuthorized===false&&
         result.applicationAttempted===false&&
         result.externalContextCoreApplied===false,
         'CEN_D3_APPLICATION_PREVIEW_INVALID');
     }else if(operation==='d3RecoverApplied'){
       const selection=sourceSelection(input),target=await targetFor(c,selection);
       need(typeof apply.recoverApplied==='function',
         'CEN_D3_APPLY_RECOVERY_NOT_CONNECTED');
       // Original signed D1 Kernel Object + Event readback. Never issue
       // another commitObjectGraph or another Human APPLY during recovery.
       result=checkedKernelRecovery(
         await apply.recoverApplied({...selection,target}),c,selection);
    }else if(operation==='d3ApplyAccepted'){
       const selection=sourceSelection(input),target=await targetFor(c,selection);
       entered=true;
       // The original trusted owner repeats source review, gets sealed
       // effect/graph, independently confirms HUMAN APPLY, authorizes via
       // existing D1, then executes original Kernel commit + getObject.
       result=await apply.applyAccepted({...selection,target});
       need(result?.kernelWriteReadback==='CONFIRMED'&&
         result?.originalKernelReceipt&&result?.originalKernelReadback&&
         result?.externalProductAcceptance==='NOT_ACCEPTED',
         'CEN_D3_KERNEL_COMMIT_OUTCOME_UNKNOWN');
     }else fail('CEN_D3_OPERATION_NOT_SUPPORTED');
   }catch(error){
     if(entered&&mayWrite){
       // An unknown original owner failure or context change may occur
       // AFTER the ledger or original Kernel committed. No auto-retry.
       // Only explicitly documented pre-write rejections are definite.
       const code=error?.code??error?.message;
       const definiteBeforeWrite=[
         'T3_D3_HUMAN_REVIEW_REQUIRED',
         'T3_D3_SEPARATE_HUMAN_APPLY_REQUIRED',
         'T3_D3_PREVIEW_STALE',
         'T3_D3_ORIGINAL_ACCEPTANCE_NOT_ELIGIBLE'
       ].includes(code);
       if(!definiteBeforeWrite)fail('CEN_D3_OUTCOME_UNKNOWN');
     }
     throw error;
   }
   const after=await selected(organizationId).catch(()=>{
     fail(mayWrite&&entered?'CEN_D3_OUTCOME_UNKNOWN':'CEN_D3_CONTEXT_CHANGED');
   });
   need(sameSubject(c,after),mayWrite&&entered
     ?'CEN_D3_OUTCOME_UNKNOWN':'CEN_D3_CONTEXT_CHANGED');
   return copy(result,'CEN_D3_OWNER_RESPONSE_INVALID');
 }
 return Object.freeze({state,action,close(){closed=true;}});
}
