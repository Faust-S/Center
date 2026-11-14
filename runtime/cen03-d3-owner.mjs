// CEN03: a product-facing port over the ORIGINAL signed T3 D3 recipient.
// The actual Reconciliation ledger, Human Review, signed D1 authorization,
// sealed application binding, Kernel commit and readback remain with T3.
// This adapter has no Store, signer, grant evaluator or automatic retry.
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const SHA=/^[a-f0-9]{64}$/;
const MAX_ARCHIVE=16*1024*1024;
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
 need(Array.isArray(value)&&value.length>0&&value.length<=MAX_ARCHIVE,
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
       // Even an original post-write readback exception does not mean that
       // the first operation failed. Recovery is read-only; NEVER replay.
       const code=error?.code??error?.message;
       if(['CEN_D3_DECISION_OUTCOME_UNKNOWN','CEN_D3_RECEIVE_READBACK_UNKNOWN',
         'CEN_D3_KERNEL_COMMIT_OUTCOME_UNKNOWN',
         'T3_D3_KERNEL_WRITE_MAY_HAVE_COMMITTED',
         'T3_D3_ORIGINAL_DECISION_READBACK_NOT_CONFIRMED',
         'T3_D3_OWNER_REQUEST_OUTCOME_UNKNOWN',
         'T3_D3_OWNER_CONTEXT_CHANGED_OUTCOME_UNKNOWN'].includes(code))
         fail('CEN_D3_OUTCOME_UNKNOWN');
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
