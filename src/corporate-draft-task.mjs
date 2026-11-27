// Preparing a local draft is not issuance, delivery, identity mapping or a
// second Task engine. The original T3 owner remains the only signer.
import {employeeTaskContinuationKey} from '../runtime/cen03-d3-owner.mjs';
import {readAppliedResults} from '../runtime/cen03-applied-results.mjs';
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
   /^[a-f0-9]{64}$/.test(source.taskRevisionId)&&/^[a-f0-9]{64}$/.test(source.resultRevisionId),code);
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
export async function verifyEmployeeDraftSources(selection,scope,invoke){
 need(selection?.scope===scopeKey(scope)&&selection.contextId===scope.contextId&&
   selection.contextEpoch===scope.contextEpoch,'CEN_D3_EMPLOYEE_DRAFT_CHANGED_BEFORE_SIGNING');
 return verifyCorporateDraftSources(selection,scope,invoke);
}
export async function verifyCorporateDraftSources(selection,scope,invoke){
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
   const view=readAppliedResults(snapshot,scope.organizationId,scope.workspaceId);
   const source=selection.sourceResultRef;
   need(view.status==='LOCAL_ENCRYPTED_STORE_CONFIRMED'&&view.records.filter(row=>
     row.taskId===source.taskId&&row.taskRevisionId===source.taskRevisionId&&
     row.resultRevisionId===source.resultRevisionId&&row.acceptanceId===source.acceptanceId).length===1,
     'CEN_D3_EMPLOYEE_DRAFT_RESULT_SOURCE_CHANGED');
 }
}
