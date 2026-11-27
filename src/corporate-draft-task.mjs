// Preparing a local draft is not issuance, delivery, identity mapping or a
// second Task engine. The original T3 owner remains the only signer.
import {employeeTaskContinuationKey,readOriginalApplicationTarget} from '../runtime/cen03-d3-owner.mjs';
import {readAppliedResults} from '../runtime/cen03-applied-results.mjs';
import {appliedResultRevisionIds} from './organization.mjs';
const validId=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(v);
const need=(ok,code)=>{if(!ok)throw Error(code);};
const bounded=(v,max,required=false)=>typeof v==='string'&&v.length<=max&&(!required||!!v.trim());
const scopeKey=s=>employeeTaskContinuationKey(s.organizationId,s.workspaceId,s.actorId,s.employeePersonId,s.enrollmentId);
// One canonical signed assignment text for both direct manager Tasks and
// independent employees. This is preparation, never a signature or grant.
export function prepareCorporateDraftTask(draft,scope){
 const code='CEN_D3_EMPLOYEE_DRAFT_SOURCE_INVALID';
 need(validId(scope?.contextId)&&Number.isSafeInteger(scope.contextEpoch)&&scope.contextEpoch>=0,code);
 need(draft?.status==='DRAFT'&&validId(draft.id)&&draft.workspaceId===scope.workspaceId&&
   Number.isSafeInteger(draft.editNumber)&&draft.editNumber>0&&
   bounded(draft.title,200,true)&&bounded(draft.description,6000)&&bounded(draft.criteria,2000)&&
   bounded(draft.dueDate,10)&&(draft.dueDate===''||/^\d{4}-\d{2}-\d{2}$/.test(draft.dueDate))&&
   (draft.assigneeId===null||validId(draft.assigneeId))&&
   (draft.reviewerId===null||validId(draft.reviewerId)),code);
 const atlas=draft.atlasRef;
 if(atlas)need(validId(atlas.projectId)&&bounded(atlas.revision,160,true)&&
   (atlas.workId===undefined||validId(atlas.workId)),code);
 const source=draft.sourceResultRef;
 if(source)need(source.organizationId===scope.organizationId&&source.workspaceId===scope.workspaceId&&
   validId(source.taskId)&&validId(source.acceptanceId)&&
   /^[a-f0-9]{64}$/.test(source.taskRevisionId)&&appliedResultRevisionIds(source)!==null&&
   (!Object.hasOwn(source,'applicationRevisionIds')||/^[a-f0-9]{64}$/.test(source.acceptanceId)),code);
 const text=[draft.title,draft.description,
   draft.criteria&&'Критерии приёмки: '+draft.criteria,
   draft.dueDate&&'Срок: '+draft.dueDate,
   'Черновик Center: '+draft.id+', редакция '+draft.editNumber+'.',
   atlas&&'Ссылка на проект Atlas: '+atlas.projectId+' @ '+atlas.revision+(atlas.workId?', работа '+atlas.workId:''),
   source&&'Источник принятого Result: '+source.taskId+' @ '+source.taskRevisionId+
     ', Result '+source.resultRevisionId+', приёмка '+source.acceptanceId
 ].filter(Boolean).join('\n\n');
 need(text.length<=10000,'CEN_D3_EMPLOYEE_DRAFT_TEXT_TOO_LARGE');
 return {id:draft.id,contextId:scope.contextId,contextEpoch:scope.contextEpoch,snapshot:JSON.stringify(draft),text,
   atlasRef:atlas?{...atlas}:null,sourceResultRef:source?{...source}:null};
}
export function prepareEmployeeDraftTask(draft,scope){
 const prepared=prepareCorporateDraftTask(draft,scope);
 return {...prepared,scope:scopeKey(scope)};
}
export function employeeDraftSelectionCurrent(selection,draft,scope,text,confirmed){
 if(confirmed!==true||!selection)return false;
 try{
   const current=prepareEmployeeDraftTask(draft,scope);
   return selection.id===current.id&&selection.scope===current.scope&&
     selection.contextId===current.contextId&&selection.contextEpoch===current.contextEpoch&&
     selection.snapshot===current.snapshot&&selection.text===current.text&&text===current.text;
 }catch{return false;}
}
// Both checks only call existing source owners. A local Atlas plan or an
// earlier visible Result cannot establish current source provenance.
// Recover only the selected original D3 application, with no repeat Apply.
 // The native owner checks its signed Object/Event and current rights. This
 // product projection additionally binds the exact Task and Result record.
 export async function readAppliedD3Result(source,scope,execute){
   const code='CEN_D3_EMPLOYEE_DRAFT_RESULT_SOURCE_CHANGED';
   const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
   need(typeof execute==='function'&&source?.organizationId===scope.organizationId&&
     source.workspaceId===scope.workspaceId&&validId(source.taskId)&&
     [source.taskRevisionId,source.resultRevisionId,source.acceptanceId].every(sha),code);
   const revisionIds=appliedResultRevisionIds(source);
   need(revisionIds!==null,code);
   const selection={acceptanceId:source.acceptanceId,revisionIds};
   const exactSet=rows=>Array.isArray(rows)&&rows.length===revisionIds.length&&
     [...rows].every(sha)&&JSON.stringify([...rows].sort())===JSON.stringify(revisionIds);
   const candidate=await execute('d3InspectAccepted',selection);
   const matches=row=>row?.taskId===source.taskId&&row.taskRevisionId===source.taskRevisionId&&
     row.resultRevisionId===source.resultRevisionId;
   need(candidate?.schema==='IWXA_T3_APPLICATION_PROJECTION_CANDIDATE/1'&&
     candidate.status==='CANDIDATE_REQUIRES_INDEPENDENT_HOST_AUTHORIZATION'&&
     candidate.source?.acceptanceId===source.acceptanceId&&
     candidate.applicationAttempted===false&&candidate.applicationAuthorized===false&&
     candidate.externalContextCoreApplied===false&&Array.isArray(candidate.changes)&&
     exactSet(candidate.changes.map(row=>row?.resultRevisionId))&&
     [...candidate.changes].every(row=>validId(row?.taskId)&&sha(row.taskRevisionId)&&validId(row.executorId))&&
     candidate.changes.filter(matches).length===1,code);
   const target=readOriginalApplicationTarget(candidate.target,scope.organizationId,scope.workspaceId);
   const recovery=await execute('d3RecoverApplied',{...selection,target});
   const object=recovery?.originalKernelReadback?.object,event=recovery?.originalEventReadback;
   // Modern owners may hold administrative receipts in their advertised
   // registry Workspace. The record itself must always name the business scope.
   const physical=object?.workspace_id,partition=scope.d3ApplicationReceiptWorkspaceId;
   need(recovery?.status==='ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED'&&
     recovery.kernelWriteReadback==='CONFIRMED'&&recovery.automaticRetryAllowed===false&&
     recovery.externalProductAcceptance==='NOT_ACCEPTED'&&sha(recovery.effectKey)&&
     (physical===scope.workspaceId||
       (typeof partition==='string'&&/^workspace:registry:[a-f0-9]{64}$/.test(partition)&&physical===partition))&&
     object.object_id==='result:applied:'+recovery.effectKey&&object.revision===1&&
     object.schema_id==='iwxa.admin.applied-results'&&object.schema_version==='1.0.0'&&
     object.data?.schema==='IWXA_T3_ADMIN_APPLIED_RESULTS/1'&&
     Array.isArray(object.data.records)&&exactSet(object.data.records.map(row=>row?.resultRevisionId))&&
     event?.workspace_id===physical&&validId(event.event_id)&&
     event.event_type==='iwxa.admin.result.applied'&&event.object_id===object.object_id&&
     event.revision===object.revision&&event.idempotency_key===recovery.effectKey&&
     event.payload?.reconciliation_acceptance_id===source.acceptanceId&&
     exactSet(event.payload.reconciliation_revision_ids),code);
   // Every member must belong to the exact original application and agree
   // with its currently accepted Task binding. Return only the selected text.
   const candidates=new Map(candidate.changes.map(row=>[row.resultRevisionId,row]));
   need([...object.data.records].every(row=>{
     const expected=candidates.get(row?.resultRevisionId);
     return expected&&row.taskId===expected.taskId&&row.taskRevisionId===expected.taskRevisionId&&
       row.executorId===expected.executorId&&row.organizationId===scope.organizationId&&
       row.workspaceId===scope.workspaceId&&row.acceptanceId===source.acceptanceId&&
       typeof row.result==='string'&&row.result.length<=100000;
   }),code);
   const row=object.data.records.find(matches);
   need(row,code);
   return Object.freeze({source:{organizationId:row.organizationId,workspaceId:row.workspaceId,
     taskId:row.taskId,taskRevisionId:row.taskRevisionId,resultRevisionId:row.resultRevisionId,
     acceptanceId:row.acceptanceId,...(revisionIds.length>1?{applicationRevisionIds:Object.freeze([...revisionIds])}:{})},result:row.result});
 }

/** @param {any} selection @param {any} scope @param {any} invoke @param {((operation:string,input?:Record<string,unknown>)=>Promise<any>)=} execute */
export async function verifyEmployeeDraftSources(selection,scope,invoke,execute=undefined){
 need(selection?.scope===scopeKey(scope)&&selection.contextId===scope.contextId&&
   selection.contextEpoch===scope.contextEpoch,'CEN_D3_EMPLOYEE_DRAFT_CHANGED_BEFORE_SIGNING');
 return verifyCorporateDraftSources(selection,scope,invoke,execute);
}
/** @param {any} selection @param {any} scope @param {any} invoke @param {((operation:string,input?:Record<string,unknown>)=>Promise<any>)=} execute */
export async function verifyCorporateDraftSources(selection,scope,invoke,execute=undefined){
 need(selection?.contextId===scope.contextId&&selection.contextEpoch===scope.contextEpoch,
   'CEN_D3_EMPLOYEE_DRAFT_CHANGED_BEFORE_SIGNING');
 if(selection.atlasRef){
   const [{createNativeAtlasPort},{atlasLinkReadback,atlasWorkReadback}]=await Promise.all([
     import('./atlas-native.mjs'),import('./atlas-integration.mjs')
   ]).catch(()=>{throw Error('CEN_D3_ATLAS_OWNER_NOT_AVAILABLE');});
   const port=createNativeAtlasPort(invoke);
   let session;
   try{session=await port.openPublicAtlas(scope.organizationId)}
   catch{throw Error('CEN_D3_ATLAS_OWNER_NOT_AVAILABLE');}
   const view=port.view(session),ref=selection.atlasRef;
   const current=ref.workId?atlasWorkReadback(view,ref):atlasLinkReadback(view,ref);
   need(current==='SOURCE_REVISION_MATCHES','CEN_D3_ATLAS_SOURCE_REVISION_STALE');
 }
 if(selection.sourceResultRef){
   const observed=await invoke('center_corporate_state',{organizationId:scope.organizationId});
   const snapshot=observed?.snapshot;
   need(observed?.status==='D3_OWNER_READY'&&snapshot?.organizationId===scope.organizationId&&
     snapshot.workspaceId===scope.workspaceId&&snapshot.actorId===scope.actorId&&
     snapshot.contextId===scope.contextId&&snapshot.contextEpoch===scope.contextEpoch,
     'CEN_D3_EMPLOYEE_DRAFT_RESULT_SOURCE_CHANGED');
   const source=selection.sourceResultRef;
   if(snapshot.d3ApplyRecoverAvailable===true){
     await readAppliedD3Result(source,snapshot,execute);
     return;
   }
   // Preserve original legacy owner support. Never downgrade a failed
   // D3 recovery, including a group-bound pointer, to a legacy projection.
   need(!Object.hasOwn(source,'applicationRevisionIds'),'CEN_D3_EMPLOYEE_DRAFT_RESULT_SOURCE_CHANGED');
   const view=readAppliedResults(snapshot,scope.organizationId,scope.workspaceId);
   need(view.status==='LOCAL_ENCRYPTED_STORE_CONFIRMED'&&view.records.filter(row=>
     row.taskId===source.taskId&&row.taskRevisionId===source.taskRevisionId&&
     row.resultRevisionId===source.resultRevisionId&&row.acceptanceId===source.acceptanceId).length===1,
     'CEN_D3_EMPLOYEE_DRAFT_RESULT_SOURCE_CHANGED');
 }
}
