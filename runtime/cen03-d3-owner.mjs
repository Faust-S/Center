// CEN03: a product-facing port over the ORIGINAL signed T3 D3 recipient.
// The actual Reconciliation ledger, Human Review, signed D1 authorization,
// sealed application binding, Kernel commit and readback remain with T3.
// This adapter has no Store, signer, grant evaluator or automatic retry.
// A definite native rejection BEFORE owner dispatch is safe to retry after
// the operator fixes it. Any error past dispatch (including a lost reply)
// remains UNKNOWN and may only be resolved with original read-only receipts.
const PRE_DISPATCH_BASE=new Set([
  'CEN_D3_CONTEXT_CHANGED',
  'CEN_D3_ORIGINAL_OWNER_NOT_BUNDLED',
  'CEN_D3_ORGANIZATION_REQUIRED',
  'CEN_D3_INPUT_INVALID',
]);
const PRE_DISPATCH_APPLY=new Set([
  'CEN_D3_ORIGINAL_KERNEL_APPLY_NOT_CONNECTED',
  'CEN_D3_ORIGINAL_WORKSPACE_NOT_RUNNING',
  'CEN_D3_SEPARATE_HUMAN_APPLY_CANCELLED',
  'CEN_D3_ACCEPTED_SOURCE_INVALID',
  // Canonical One Core pre-Apply getWorkspace may definitively fail before
  // the native owner has sent any commitObjectGraph. These exact errors
  // keep the installed signed owner live; UNKNOWN errors never do.
  'T3_D3_ORIGINAL_WORKSPACE_PROVISION_REQUIRED',
  'T3_D3_ORIGINAL_WORKSPACE_DELETED',
  'T3_D3_ORIGINAL_WORKSPACE_READ_ONLY',
]);
const PRE_DISPATCH_TASK=new Set([
  'CEN_D3_SIGNED_TASK_TEXT_REQUIRED',
  'CEN_D3_ORIGINAL_TASK_OPERATION_ID_REQUIRED',
]);
export function isDefiniteUndispatchedD3Failure(error,operation){
  if(operation!=='d3ApplyAccepted'&&operation!=='d3CreateTask')return false;
  const raw=typeof error==='string'?error:
    error instanceof Error?error.message:'';
  const match=/^(?:Error:\s*)?([A-Z][A-Z0-9_]{4,99})$/.exec(raw.trim());
  if(!match)return false;
  return PRE_DISPATCH_BASE.has(match[1])||
    (operation==='d3ApplyAccepted'&&PRE_DISPATCH_APPLY.has(match[1]))||
    (operation==='d3CreateTask'&&PRE_DISPATCH_TASK.has(match[1]));
}

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
   Object.keys(value).length===TARGET_FIELDS.length&&
   TARGET_FIELDS.every(field=>validId(value[field]))&&
   value.subjectId===context.organization_id&&
   value.workspaceId===context.workspace_id&&
   ['IWXA_ADMIN_CENTER','IWXA_CONTROL_CENTER'].includes(value.consumerId),
   'CEN_D3_ORIGINAL_APPLICATION_TARGET_REQUIRED');
 return copy(value,'CEN_D3_APPLICATION_TARGET_INVALID');
}
// Send back the exact accepted original Application target. It is not a
// browser-selected grant: the original signed owner checks the same target
// AGAIN at Host APPLY and read-only recovery.
export function readOriginalApplicationTarget(value,organizationId,workspaceId){
 need(validId(organizationId)&&validId(workspaceId),
   'CEN_D3_ORIGINAL_APPLICATION_TARGET_REQUIRED');
 return checkedTarget(value,{organization_id:organizationId,
   workspace_id:workspaceId});
}
function assertSameRequestedTarget(input,owned){
 if(!Object.hasOwn(input,'target'))return; // Existing legacy Host adapter.
 const claimed=input.target;
 need(claimed!==null&&typeof claimed==='object'&&
   !Array.isArray(claimed)&&
   Object.keys(claimed).length===TARGET_FIELDS.length&&
   TARGET_FIELDS.every(key=>claimed[key]===owned[key]),
   'CEN_D3_ORIGINAL_APPLICATION_TARGET_CHANGED');
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

// Only display ORIGINAL recipient-verified selected Result text.
// The original verifier owns signatures, Task binding, content and currentness;
// this is a UI shape check, not another Reconciliation.
export function readOriginalResultReview(preview,organizationId,workspaceId,
  offset=0){
 const r=preview?.resultInspection;
 if(r==null)return null;
 const bad='CEN_D3_SIGNED_RESULT_REVIEW_INVALID';
 need(preview?.schema==='IWXA_T3_RECONCILIATION_PREVIEW/1'&&
   validSha(preview.packageSha256)&&validSha(preview.previewDigest)&&
   r?.schema==='IWXA_T3_ORIGINAL_SIGNED_RESULT_REVIEW/1'&&
   r.signatureVerified===true&&r.taskBindingProven===true&&
   r.taskCatalogVerified===true&&
   typeof r.assignmentText==='string'&&r.assignmentText.length>0&&
   r.assignmentText.length<=10000&&
   r.packageSha256===preview.packageSha256&&
   r.previewDigest===preview.previewDigest&&
   validId(organizationId)&&validId(workspaceId)&&
   r.organizationId===organizationId&&r.workspaceId===workspaceId&&
   validId(r.executorId)&&validId(r.taskId)&&
   validSha(r.taskRevisionId)&&validSha(r.resultRevisionId)&&
   Array.isArray(preview.entries)&&
   preview.entries.some(x=>x?.revisionId===r.resultRevisionId)&&
   Number.isSafeInteger(offset)&&offset>=0&&
   Number.isSafeInteger(r.resultLength)&&r.resultLength>=0&&
   r.resultLength<=100000&&r.offset===offset&&
   typeof r.resultText==='string'&&r.resultText.length<=4096&&
   Number.isSafeInteger(r.nextOffset)&&
   r.nextOffset===offset+r.resultText.length&&
   r.nextOffset<=r.resultLength&&
   r.hasMore===(r.nextOffset<r.resultLength),bad);
 need(r.hasMore!==true||r.resultText.length>0,bad);
 return copy(r,bad);
}

/** @param {unknown} result
 *  @param {string} taskId
 *  @param {string} actorId
 *  @param {{taskId:string,taskRevisionId:string,packageSha256:string,deliveryState:string}|null} observed
 */
export function validateOriginalSignedTaskReadback(result,taskId,actorId,observed=null){
 const code='CEN_D3_ORIGINAL_TASK_READBACK_UNKNOWN';
 need(validId(actorId)&&typeof taskId==='string'&&
   /^task:[A-Za-z0-9-]{1,100}$/.test(taskId)&&
   result?.schema==='IWXA_T3_ORIGINAL_TASK_READBACK/1'&&
   result.taskId===taskId&&typeof result.found==='boolean',code);
 if(!result.found){
   need(result.status==='NOT_IN_ORIGINAL_TASK_INVENTORY'&&observed==null,code);
 }else{
   need(result.status==='SIGNED_TASK_PERSISTED_NOT_DELIVERED'&&
     result.recipientId===actorId&&validSha(result.taskRevisionId)&&
     validSha(result.packageSha256),code);
   if(observed!==null){
     need(observed?.taskId===taskId&&
       observed.taskRevisionId===result.taskRevisionId&&
       observed.packageSha256===result.packageSha256&&
       observed.deliveryState==='NOT_CONFIRMED',code);
   }
 }
 return copy(result,code);
}

// The independent employee signed Task response belongs to the ORIGINAL
// private T3 owner, not the older first-person d3CreateTask path. That owner
// returns state, NOT status. Verify the exact native shape before showing a
// saved signature as successful. Validation is UI-only, never an authority.
export function validateOriginalEmployeeTaskIssueReceipt(
 receipt,{taskId,employeePersonId,enrollmentId}={}){
 const code='CEN_D3_EMPLOYEE_TASK_ORIGINAL_SIGNING_UNCONFIRMED';
 need(typeof taskId==='string'&&/^task:[A-Za-z0-9-]{1,100}$/.test(taskId)&&
   validId(employeePersonId)&&validId(enrollmentId)&&
   receipt?.schema==='IWXA_T3_ORIGINAL_EMPLOYEE_SIGNED_TASK/1'&&
   receipt.state==='SIGNED_TASK_CREATED_NOT_DELIVERED'&&
   receipt.originalSigned===true&&receipt.taskDelivered===false&&
   receipt.recipientId===employeePersonId&&
   receipt.enrollmentId===enrollmentId&&receipt.taskId===taskId&&
   validSha(receipt.packageSha256)&&validSha(receipt.taskRevisionId)&&
   Number.isSafeInteger(receipt.originalKernelStatusSequence)&&
   receipt.originalKernelStatusSequence>0,code);
 return copy(receipt,code);
}

// Presentation of an existing original enrollment. The caller must first read
// the ORIGINAL signed roster, enrollment and PROOF credential. Neither an
// organizational contact nor a local continuation is proof of these rights.
export function readOriginalEmployeeEnrollmentIdentity(receipt,
 {organizationId,workspaceId,actorId,employeePersonId:personId,enrollmentId}){
 const code='CEN_D3_EMPLOYEE_ORIGINAL_ENROLLMENT_READBACK_HOLD';
 const keyId=receipt?.credential?.publicKeyRef;
 const exportResources=['workspace:'+workspaceId,'subject:'+organizationId,
   'recipient:'+organizationId,'field:result','operation:UPSERT'];
 const work=receipt?.workGrant?.payload,exp=receipt?.exportGrant?.payload,
   original=receipt?.originalEnrollment?.payload;
 need([organizationId,workspaceId,actorId,personId,enrollmentId,keyId].every(validId)&&
   personId!==actorId&&receipt?.state==='ORIGINAL_GRANTS_ACTIVE'&&
   receipt.employeePersonId===personId&&receipt.enrollmentId===enrollmentId&&
   receipt.organizationId===organizationId&&receipt.originalReadback===true&&
   receipt.originalSigned===true&&receipt.safeToReissue===false&&
   receipt.membership?.personId===personId&&
   receipt.membership?.organizationId===organizationId&&
   receipt.membership?.workspaceId===workspaceId&&
   receipt.credential?.holderPersonId===personId&&
   receipt.binding?.holderPersonId===personId&&
   receipt.binding?.organizationId===organizationId&&
   validId(work?.id)&&receipt.binding?.grantId===work.id&&
   work.holderId===personId&&work.rightClass==='ACTION'&&
   JSON.stringify(work.actions)==='["work.prepare"]'&&
   JSON.stringify(work.resources)===JSON.stringify([workspaceId])&&
   exp?.holderId===personId&&exp?.rightClass==='DATA'&&
   JSON.stringify(exp.actions)==='["package.export"]'&&
   JSON.stringify(exp.resources)===JSON.stringify(exportResources)&&
   original?.personId===personId&&original?.organizationId===organizationId&&
   original?.workspaceId===workspaceId&&original?.credentialPublicKeyRef===keyId&&
   Number.isSafeInteger(receipt.statusSequence)&&receipt.statusSequence>0,code);
 return Object.freeze({employeePersonId:personId,enrollmentId,credentialKeyId:keyId});
}
export function readOriginalEmployeeCredentialIdentity(receipt,identity){
 const code='CEN_D3_EMPLOYEE_ORIGINAL_KEY_READBACK_REQUIRED';
 need(validId(identity?.employeePersonId)&&validId(identity?.credentialKeyId)&&
   receipt?.state==='ORIGINAL_PROOF_CREDENTIAL_ADMITTED'&&
   receipt.employeePersonId===identity.employeePersonId&&
   receipt.credentialKeyId===identity.credentialKeyId&&
   receipt.originalReadback===true&&receipt.safeToRetry===false,code);
 return copy(receipt,code);
}

// Interpret only the original owner's exact scoped grant readback. Missing
// is not a permission; it merely allows a first explicitly approved issue.
// A revoked, malformed or unknown grant must not be treated as missing.
const employeeWorkspaceGrantSpec=Object.freeze({
 readAccess:['workspace.read','workspace.read'],
 writeAccess:['object.write','workspace.work'],
 createAccess:['workspace.create','workspace.onboarding'],
 importAccess:['workspace.exchange.import','workspace.exchange.import'],
});
function employeeGrantScopeMatches(value,scope){
 return [scope?.organizationId,scope?.workspaceId,scope?.actorId,
   scope?.employeePersonId,scope?.enrollmentId,scope?.credentialKeyId].every(validId)&&
   scope.actorId!==scope.employeePersonId&&
   value?.organizationId===scope.organizationId&&value.workspaceId===scope.workspaceId&&
   value.employeePersonId===scope.employeePersonId&&value.enrollmentId===scope.enrollmentId&&
   value.originalReadback===true&&value.safeToReissue===false;
}
export function inspectOriginalEmployeeWorkspaceRights(value,scope){
 const code='CEN_D3_EMPLOYEE_WORKSPACE_RIGHTS_READBACK_REQUIRED';
 need(employeeGrantScopeMatches(value,scope)&&
   value.schema==='IWXA_T3_ORIGINAL_EMPLOYEE_WORKSPACE_RIGHTS/1',code);
 if(value.state==='ORIGINAL_EMPLOYEE_WORKSPACE_RIGHTS_NOT_FOUND'){
   need((value.attachments===undefined||Object.keys(value.attachments??{}).length===0)&&
     (value.grantIds===undefined||Array.isArray(value.grantIds)&&value.grantIds.length===0),code);
   return 'NOT_FOUND';
 }
 need(value.state==='ORIGINAL_EMPLOYEE_WORKSPACE_RIGHTS_ACTIVE'&&
   Number.isSafeInteger(value.statusSequence)&&value.statusSequence>0&&
   Object.keys(value.attachments??{}).length===4,code);
 const ids=new Set();
 for(const [name,[action,purpose]] of Object.entries(employeeWorkspaceGrantSpec)){
   const a=value.attachments[name];
   need(validId(a?.grantId)&&!ids.has(a.grantId)&&a.grantId===a.binding?.grantId&&
     a.membership?.personId===scope.employeePersonId&&
     a.membership?.workspaceId===scope.workspaceId&&
     a.binding.holderPersonId===scope.employeePersonId&&
     a.credential?.publicKeyRef===scope.credentialKeyId&&
     a.enrollment?.payload?.credentialPublicKeyRef===scope.credentialKeyId&&
     JSON.stringify(a.binding.actions)===JSON.stringify([action])&&
     JSON.stringify(a.binding.purposes)===JSON.stringify([purpose]),code);
   ids.add(a.grantId);
 }
 if(value.grantIds!==undefined)need(Array.isArray(value.grantIds)&&
   value.grantIds.length===4&&new Set(value.grantIds).size===4&&
   value.grantIds.every(id=>ids.has(id)),code);
 return 'ACTIVE';
}
export function inspectOriginalEmployeeTaskGrant(value,scope){
 const code='CEN_D3_EMPLOYEE_TASK_DATA_READBACK_HOLD';
 need(employeeGrantScopeMatches(value,scope)&&
   value.schema==='IWXA_T3_ORIGINAL_EMPLOYEE_TASK_DATA_READBACK/1'&&
   value.recipientId===scope.employeePersonId&&value.managerPersonId===scope.actorId,code);
 if(value.state==='ORIGINAL_MANAGER_TASK_DATA_NOT_FOUND'){
   need(value.grant===undefined&&value.grantId===undefined,code);
   return 'NOT_FOUND';
 }
 if(value.state==='ORIGINAL_MANAGER_TASK_DATA_REVOKED_OR_EXPIRED'||
    value.state==='ORIGINAL_MANAGER_TASK_DATA_STATUS_UNKNOWN_HOLD')return 'HOLD';
 const g=value.grant?.payload;
 need(value.state==='ORIGINAL_MANAGER_TASK_DATA_ACTIVE'&&
   Number.isSafeInteger(value.statusSequence)&&value.statusSequence>0&&validId(g?.id)&&
   (value.grantId===undefined||value.grantId===g.id)&&
   g.holderId===scope.actorId&&g.roleId==='assigner'&&g.rightClass==='DATA'&&
   JSON.stringify(g.actions)==='["package.export"]'&&
   JSON.stringify(g.purposes)==='["assignment"]'&&
   JSON.stringify(g.resources)===JSON.stringify(['workspace:'+scope.workspaceId,
     'subject:'+scope.organizationId,'recipient:'+scope.employeePersonId,'field:task','operation:UPSERT']),code);
 return 'ACTIVE';
}

// UI continuation only, following the existing pending seat intent pattern.
// Do not store Task content, a signature, receipt, grant or organizational
// authority here. The original owner remains the only Task inventory.
const employeeTaskId=value=>typeof value==='string'&&/^task:[A-Za-z0-9-]{1,100}$/.test(value);
export function employeeTaskContinuationKey(organizationId,workspaceId,actorId,employeePersonId,enrollmentId){
 need([organizationId,workspaceId,actorId,employeePersonId,enrollmentId].every(validId)&&
  actorId!==employeePersonId,'CEN_D3_EMPLOYEE_TASK_CONTINUATION_SCOPE_INVALID');
 return 'iwxa.center.pending-employee-task.v1:'+JSON.stringify([
  organizationId,workspaceId,actorId,employeePersonId,enrollmentId]);
}
export function readEmployeeTaskContinuation(storage,key){
 const value=storage.getItem(key);
 need(value===null||employeeTaskId(value),'CEN_D3_EMPLOYEE_TASK_CONTINUATION_INVALID');
 return value;
}
export function saveEmployeeTaskContinuation(storage,key,taskId){
 need(employeeTaskId(taskId),'CEN_D3_EMPLOYEE_TASK_CONTINUATION_INVALID');
 need(readEmployeeTaskContinuation(storage,key)===null,'CEN_D3_EMPLOYEE_TASK_CONTINUATION_ALREADY_PENDING');
 storage.setItem(key,taskId);
 need(readEmployeeTaskContinuation(storage,key)===taskId,'CEN_D3_EMPLOYEE_TASK_CONTINUATION_NOT_SAVED');
}
export function clearEmployeeTaskContinuation(storage,key,taskId){
 const current=readEmployeeTaskContinuation(storage,key);
 need(employeeTaskId(taskId)&&(current===null||current===taskId),
  'CEN_D3_EMPLOYEE_TASK_CONTINUATION_CHANGED');
 if(current!==null)storage.removeItem(key);
 need(readEmployeeTaskContinuation(storage,key)===null,'CEN_D3_EMPLOYEE_TASK_CONTINUATION_NOT_CLEARED');
}

// Match the existing ORIGINAL native d3EmployeeTaskReadback contract.
// A prior successful issuance/recovery receipt cannot be replaced by a
// different original carrier with the same Task ID. Absence is never proof
// that an earlier consequential invocation can safely be dispatched again.
export function validateOriginalEmployeeTaskReadback(receipt,{taskId,employeePersonId,enrollmentId},previous=null){
 const code='CEN_D3_EMPLOYEE_TASK_ORIGINAL_READBACK_HOLD';
 need(employeeTaskId(taskId)&&validId(employeePersonId)&&validId(enrollmentId)&&
  receipt?.schema==='IWXA_T3_ORIGINAL_EMPLOYEE_TASK_READBACK/1'&&
  receipt.taskId===taskId&&typeof receipt.found==='boolean',code);
 if(!receipt.found){
  need(previous===null&&receipt.automaticReissueAllowed===false&&
   ['NOT_IN_ORIGINAL_TASK_INVENTORY','ORIGINAL_SIGNED_CARRIER_WITHOUT_INVENTORY_HOLD'].includes(receipt.status),code);
 }else{
  need(receipt.status==='SIGNED_TASK_PERSISTED_NOT_DELIVERED'&&
   receipt.recipientId===employeePersonId&&receipt.enrollmentId===enrollmentId&&
   receipt.originalKernelReadback===true&&receipt.taskDelivered===false&&
   validSha(receipt.taskRevisionId)&&validSha(receipt.packageSha256),code);
  if(previous!==null)need(previous.taskId===taskId&&
   previous.recipientId===employeePersonId&&previous.enrollmentId===enrollmentId&&
   previous.taskRevisionId===receipt.taskRevisionId&&previous.packageSha256===receipt.packageSha256,code);
 }
 return copy(receipt,code);
}

// Display the existing original inventory as recipient-specific lists.
// Every selected employee carrier still requires independent native readback.
export function readOriginalTaskCatalog(snapshot){
 const code='CEN_MANAGER_SIGNED_TASK_INVENTORY_INVALID';
 need(validId(snapshot?.organizationId)&&validId(snapshot?.workspaceId)&&
   validId(snapshot?.actorId)&&Array.isArray(snapshot.tasks)&&
   Number.isSafeInteger(snapshot.totalTasks)&&snapshot.totalTasks>=snapshot.tasks.length&&
   snapshot.totalTasks<=256,code);
 const ids=new Set(),rows=[];
 for(const row of snapshot.tasks){
  need(employeeTaskId(row?.taskId)&&validId(row?.recipientId)&&
   validSha(row?.taskRevisionId)&&validSha(row?.packageSha256)&&
   typeof row?.summary==='string'&&row.summary.length<=10000&&
   row.deliveryState==='NOT_CONFIRMED','CEN_MANAGER_SIGNED_TASK_INVALID');
  need(!ids.has(row.taskId),'CEN_MANAGER_SIGNED_TASK_DUPLICATE');
  ids.add(row.taskId);
  rows.push({taskId:row.taskId,recipientId:row.recipientId,
    taskRevisionId:row.taskRevisionId,packageSha256:row.packageSha256,
    summary:row.summary,deliveryState:'NOT_CONFIRMED'});
 }
 return {rows,totalTasks:snapshot.totalTasks,truncated:rows.length<snapshot.totalTasks};
}
export function validateOriginalEmployeeCatalogReadback(receipt,row,enrollmentId){
 const code='CEN_D3_EMPLOYEE_TASK_CATALOG_READBACK_HOLD';
 need(row?.deliveryState==='NOT_CONFIRMED'&&validId(row.recipientId)&&
   validId(enrollmentId)&&employeeTaskId(row.taskId)&&validSha(row.taskRevisionId)&&
   validSha(row.packageSha256),code);
 return validateOriginalEmployeeTaskReadback(receipt,{
   employeePersonId:row.recipientId,enrollmentId,taskId:row.taskId
 },{...row,enrollmentId});
}
export function validateOriginalEmployeeTaskExportReceipt(result,source){
 const code='CEN_D3_EMPLOYEE_TASK_EXPORT_READBACK_HOLD';
 need(source?.found===true&&source.originalKernelReadback===true&&
   source.status==='SIGNED_TASK_PERSISTED_NOT_DELIVERED'&&
   employeeTaskId(source.taskId)&&validId(source.recipientId)&&
   validSha(source.taskRevisionId)&&validSha(source.packageSha256)&&
   result?.schema==='IWXA_T3_ORIGINAL_EMPLOYEE_TASK_EXPORT/1'&&
   result.status==='EXPORTED_UNDELIVERED'&&result.originalSigned===true&&
   result.taskDelivered===false&&result.taskId===source.taskId&&
   result.recipientId===source.recipientId&&result.taskRevisionId===source.taskRevisionId&&
   result.packageSha256===source.packageSha256&&Number.isSafeInteger(result.bytes)&&
   result.bytes>0,code);
 return copy(result,code);
}

export function appendOriginalResultReview(previous,preview,organizationId,
 workspaceId){
 const bad='CEN_D3_SIGNED_RESULT_REVIEW_STALE';
 need(previous&&previous.schema==='IWXA_T3_ORIGINAL_SIGNED_RESULT_REVIEW/1'&&
   previous.hasMore===true&&Number.isSafeInteger(previous.nextOffset)&&
   previous.offset===0&&typeof previous.resultText==='string'&&
   previous.nextOffset===previous.resultText.length,bad);
 const next=readOriginalResultReview(preview,organizationId,workspaceId,
   previous.nextOffset);
 need(next!==null&&
   ['schema','packageSha256','previewDigest','taskId','taskRevisionId',
    'resultRevisionId','executorId','organizationId','workspaceId','resultLength',
    'assignmentText','taskCatalogVerified']
     .every(key=>next[key]===previous[key]),bad);
 const accumulated=previous.resultText+next.resultText;
 need(accumulated.length===next.nextOffset,bad);
 return {...next,offset:0,resultText:accumulated};
}

// A manager can request all remaining ORIGINAL signed Result pages at
// once. Every page is tied to the unchanged package, Task, original signer
// and preview digest. This remains read-only, not Human ACCEPT or Kernel APPLY.
/** @param {any} first
 *  @param {any} preview
 *  @param {string} organizationId
 *  @param {string} workspaceId
 *  @param {(offset:number)=>Promise<any>} readPage
 *  @param {(page:any)=>void} onPage
 */
export async function readCompleteOriginalResult(first,preview,organizationId,
  workspaceId,readPage,onPage=()=>{}){
 const bad='CEN_D3_SIGNED_RESULT_REVIEW_STALE';
 need(first?.schema==='IWXA_T3_ORIGINAL_SIGNED_RESULT_REVIEW/1'&&
   first.offset===0&&validSha(first.packageSha256)&&
   validSha(first.previewDigest)&&preview?.packageSha256===first.packageSha256&&
   preview.previewDigest===first.previewDigest&&
   typeof readPage==='function'&&typeof onPage==='function',bad);
 let current=first;
 // A 100,000-character Result requires at most 25 original pages.
 for(let part=0;part<26&&current.hasMore;part++){
   const next=await readPage(current.nextOffset);
   need(next?.schema==='IWXA_T3_RECONCILIATION_PREVIEW/1'&&
     next.packageSha256===first.packageSha256&&
     next.previewDigest===first.previewDigest,bad);
   current=appendOriginalResultReview(current,next,organizationId,workspaceId);
   onPage(current);
 }
 need(current.hasMore===false&&current.nextOffset===current.resultLength,bad);
 return current;
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
     d3InspectAvailable:applicationTargetFor!==null,
     d3ApplyAvailable:apply!==null&&applicationTargetFor!==null,
     d3ApplyRecoverAvailable:apply!==null&&
       typeof apply.recoverApplied==='function'&&applicationTargetFor!==null,
     // D3 readiness is NOT the entire T3 release/production activation.
     productionActivation:false,T3_READY:false,
   }};
 }
 async function targetFor(c,selection){
   need(applicationTargetFor!==null,'CEN_D3_INSPECT_NOT_CONNECTED');
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
       const selection=sourceSelection(input);
       need(apply!==null,'CEN_D3_APPLY_RECOVERY_NOT_CONNECTED');
       const target=await targetFor(c,selection);
       assertSameRequestedTarget(input,target);
       need(typeof apply.recoverApplied==='function',
         'CEN_D3_APPLY_RECOVERY_NOT_CONNECTED');
       // Original signed D1 Kernel Object + Event readback. Never issue
       // another commitObjectGraph or another Human APPLY during recovery.
       result=checkedKernelRecovery(
         await apply.recoverApplied({...selection,target}),c,selection);
    }else if(operation==='d3ApplyAccepted'){
       const selection=sourceSelection(input);
       need(apply!==null,'CEN_D3_APPLY_NOT_CONNECTED');
       const target=await targetFor(c,selection);
       assertSameRequestedTarget(input,target);
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

// Public original employee bootstrap projection. It carries no grant, private
// key or new authority. The original native owner computes the fingerprint;
// the employee confirms it independently before creating DPAPI custody.
const employeeBootstrapFields=['audience','authorityId','confirmedIssuerSha256','issuerKeyId',
 'issuerPublicKey','managerPersonId','organizationDataRootId','organizationId','organizationName',
 'realmId','reviewKeyId','reviewPublicKey','workspaceId'];
const publicEmployeePem=v=>typeof v==='string'&&v.length<4096&&
 v.startsWith('-----BEGIN PUBLIC KEY-----')&&v.includes('-----END PUBLIC KEY-----')&&!v.includes('PRIVATE KEY');
const exactEmployeeFields=(value,fields)=>value&&typeof value==='object'&&!Array.isArray(value)&&
 Object.keys(value).length===fields.length&&fields.every(k=>Object.hasOwn(value,k));
export function readOriginalEmployeeBootstrap(value,scope){
 const p=value?.profile;
 need(value?.schema==='IWXA_T3_ORIGINAL_EMPLOYEE_BOOTSTRAP/1'&&
   value.organizationId===scope.organizationId&&value.workspaceId===scope.workspaceId&&
   value.originalReadback===true&&value.employeeEnrolled===false&&value.grantIssued===false&&
   validSha(value.profileDigest)&&exactEmployeeFields(p,employeeBootstrapFields)&&
   p.organizationId===scope.organizationId&&p.workspaceId===scope.workspaceId&&
   p.managerPersonId===scope.actorId&&
   employeeBootstrapFields.filter(k=>!['confirmedIssuerSha256','issuerPublicKey','reviewPublicKey','organizationName'].includes(k))
    .every(k=>validId(p[k]))&&
   typeof p.organizationName==='string'&&p.organizationName.trim()===p.organizationName&&
   p.organizationName.length>0&&p.organizationName.length<=120&&
   validSha(p.confirmedIssuerSha256)&&publicEmployeePem(p.issuerPublicKey)&&publicEmployeePem(p.reviewPublicKey)&&
   p.issuerKeyId!==p.reviewKeyId&&p.issuerPublicKey!==p.reviewPublicKey,
   'CEN_D3_EMPLOYEE_BOOTSTRAP_READBACK_INVALID');
 return {profile:copy(p,'CEN_D3_EMPLOYEE_BOOTSTRAP_READBACK_INVALID'),profileDigest:value.profileDigest};
}
export function readOriginalEmployeePublicCandidate(raw,scope,bootstrap){
 need(typeof raw==='string'&&raw.length<=32768&&bootstrap&&validSha(bootstrap.profileDigest),
  'CEN_D3_EMPLOYEE_PUBLIC_CANDIDATE_INVALID');
 let c;try{c=JSON.parse(raw)}catch{fail('CEN_D3_EMPLOYEE_PUBLIC_CANDIDATE_INVALID')}
 const k=c?.employeeProofKeyRecord;
 need(exactEmployeeFields(c,['schema','state','profileDigest','organizationId','workspaceId','employeePersonId',
   'managerPersonId','credentialKeyId','employeeProofKeyRecord','originalKernelEnrollment','originalSignedGrant',
   'automaticTransfer','T3_READY'])&&
  c.schema==='IWXA_T3_ORIGINAL_EMPLOYEE_WINDOWS_CANDIDATE/1'&&
  c.state==='AWAITING_ORIGINAL_MANAGER_ENROLLMENT'&&c.profileDigest===bootstrap.profileDigest&&
  c.organizationId===scope.organizationId&&c.workspaceId===scope.workspaceId&&c.managerPersonId===scope.actorId&&
  validId(c.employeePersonId)&&c.employeePersonId!==scope.actorId&&validId(c.credentialKeyId)&&
  c.originalKernelEnrollment===false&&c.originalSignedGrant===false&&c.automaticTransfer===false&&c.T3_READY===false&&
  exactEmployeeFields(k,['subjectId','environment','publicKey','status','uses','notBefore','expiresAt'])&&
  k.subjectId===c.employeePersonId&&k.environment==='PRODUCTION'&&k.status==='ACTIVE'&&publicEmployeePem(k.publicKey)&&
  Array.isArray(k.uses)&&k.uses.length===1&&k.uses[0]==='PROOF'&&
  typeof k.notBefore==='string'&&typeof k.expiresAt==='string'&&
  Number.isFinite(Date.parse(k.notBefore))&&Date.parse(k.expiresAt)>Date.parse(k.notBefore),
  'CEN_D3_EMPLOYEE_PUBLIC_CANDIDATE_INVALID');
 // Populating the draft fields does NOT admit the PROOF key.
 return {employeePersonId:c.employeePersonId,credentialKeyId:c.credentialKeyId,
  keyRecord:copy(k,'CEN_D3_EMPLOYEE_PUBLIC_CANDIDATE_INVALID')};
}
