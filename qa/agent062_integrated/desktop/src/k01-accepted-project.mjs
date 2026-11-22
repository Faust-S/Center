/** K01 0.3.5 from a pair of real human-accepted Agent Results.
 *
 * This is a read-only, user-initiated adapter around the frozen *owner*
 * implementation. It does not invent supersession, accept a new commercial
 * contract, write a Task, or run a model.
 */
import {sha256} from './public-k01/index.mjs';
import {prepareProjectContinuation,refreshProjectContinuation,
 PROJECT_CONTINUATION_VERSION,PROJECT_REFRESH_VERSION}
 from './public-k01/integrations/project-continuation.mjs';
import {compareDocumentRevisions} from './k01-document-change-preview.mjs';
const TASK=/^TASK-[A-Za-z0-9_-]{1,80}$/,HEX=/^[a-f0-9]{64}$/;
const active=fn=>{if(!fn())throw Error('k01_project_request_superseded');};
const row=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)?v:{};
const RFC3339_UTC=/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
/** Validate owner-verified Core readback; a model string is never authority. */
function validateSource(value,taskId,area,first){
 const s=row(value);
 if(s.contract_version!=='PA.K01_ACCEPTED_RESULT_SOURCE/0.1.0'||
  s.task_id!==taskId||s.workspace_ref!==area||
  s.source_ref!=='agent-result:'+taskId||
  s.kind!=='result'||s.state!=='accepted'||s.epistemic!=='reported'||
  s.read_only!==true||s.commercial_approval_claimed!==false||
  typeof s.content!=='string'||!s.content.trim()||
  new TextEncoder().encode(s.content).length>65536||
  s.revision!=='sha256:'+sha256(s.content)||
  !HEX.test(s.accepted_artifact_digest??'')||!Array.isArray(s.supersedes)||
  s.supersedes.length!==0||!RFC3339_UTC.test(s.issued_at??'')||
  !Number.isFinite(Date.parse(s.issued_at))||
  typeof s.result_id!=='string'||!/^RES-[A-Za-z0-9_-]+$/.test(s.result_id)||
  typeof s.review_id!=='string'||!/^REV-[A-Za-z0-9_-]+$/.test(s.review_id))
  throw Error('k01_project_accepted_source_unverified');
 if(first && (s.revision!==first.revision ||
  s.accepted_artifact_digest!==first.accepted_artifact_digest||
  s.issued_at!==first.issued_at||s.result_id!==first.result_id||
  s.review_id!==first.review_id))
  throw Error('k01_project_source_revision_changed');
 return s;
}
/** Exactly two canonical reads: initial pair and end-of-compare revalidation. */
async function readPair(port,ids,isCurrent,baseline){
 active(isCurrent);
 const batch=row(await port.query('k01_accepted_result_sources',{task_ids:ids}));
 active(isCurrent);
 if(batch.contract_version!=='PA.K01_ACCEPTED_RESULT_SOURCES/0.1.0'||
  batch.read_only!==true||typeof batch.workspace_ref!=='string'||
  !batch.workspace_ref||typeof batch.scope_revision!=='string'||
  !batch.scope_revision||!Array.isArray(batch.sources)||batch.sources.length!==2)
  throw Error('k01_project_pair_readback_invalid');
 const sources=ids.map((id,i)=>validateSource(batch.sources[i],id,batch.workspace_ref,
  baseline?.sources?.[i]));
 if(baseline && (baseline.workspace_ref!==batch.workspace_ref ||
  baseline.scope_revision!==batch.scope_revision))
  throw Error('k01_project_workspace_changed');
 return {workspace_ref:batch.workspace_ref,scope_revision:batch.scope_revision,sources};
}
const meta=(s,fields)=>({
 sourceRef:s.source_ref,workspaceRef:s.workspace_ref,revision:s.revision,
 kind:'result',state:'accepted',epistemic:'reported',issuedAt:s.issued_at,
 // A requested field is deliberately checked by K01 against actual lines.
 // Absence becomes source_evidence_missing, never fallback to an older price.
 topics:fields.map(f=>f.key),supersedes:[],
});
function fieldsFromVisual(visual){
 if(!visual.contentChanged)throw Error('k01_project_revisions_identical');
 if(visual.ambiguousCount||visual.hiddenStructuredChanges)
  throw Error('k01_project_fields_require_manual_review');
 if(!visual.structuredChanges.length)throw Error('k01_project_no_labeled_fields');
 const keys=new Set();
 return visual.structuredChanges.map(change=>{
  const label=change.label;
  const key='f_'+sha256(label.toLocaleLowerCase('ru-RU')).slice(0,20);
  if(keys.has(key))throw Error('k01_project_field_collision');
  keys.add(key);
  return {key,labels:[label],required:true};
 });
}
function asPort(area,scopeRevision,firstByTask,tasks,fields,isCurrent){
 const ids=[...tasks],sourceRefs=ids.map(id=>'agent-result:'+id).sort();
 const check=()=>active(isCurrent);
 return {
  async listSources(req){
   check();
   if(req.workspaceRef!==area||!Array.isArray(req.allowedSources)||
    JSON.stringify([...req.allowedSources].sort())!==JSON.stringify(sourceRefs))
    throw Error('k01_project_roster_invalid');
   return {scopeRevision,sources:ids.map(id=>meta(firstByTask.get(id),fields))};
  },
  async readSource(req){
   check();
   const found=ids.find(id=>'agent-result:'+id===req.sourceRef);
   if(!found||req.workspaceRef!==area)
    throw Error('k01_project_source_not_allowed');
   const snapshot=firstByTask.get(found);
   if(snapshot.revision!==req.requestedRevision)
    throw Error('k01_project_source_revision_changed');
   return {revision:snapshot.revision,complete:true,content:snapshot.content};
  }
 };
}

/** Compare two distinct, already human-accepted Tasks from the active area.
 * A conflict with no signed supersession must remain INCOMPLETE.
 */
export async function reviewAcceptedResultChange(port,{olderTaskId,newerTaskId,
 isCurrent=()=>true,maxTokens=2400}){
 if(!port||typeof port.query!=='function'||typeof isCurrent!=='function'||
  !TASK.test(olderTaskId??'')||!TASK.test(newerTaskId??'')||
  olderTaskId===newerTaskId||!Number.isSafeInteger(maxTokens)||
  maxTokens<1||maxTokens>20000)throw Error('k01_project_request_invalid');
 const ids=[olderTaskId,newerTaskId];
 const start=await readPair(port,ids,isCurrent);
 const [older,newer]=start.sources;
 if(Date.parse(older.issued_at)>=Date.parse(newer.issued_at))
  throw Error('k01_project_accepted_chronology_invalid');
 const visual=compareDocumentRevisions(older.content,newer.content);
 const fields=fieldsFromVisual(visual);
 const firstByTask=new Map([[olderTaskId,older],[newerTaskId,newer]]);
 const oldPort=asPort(start.workspace_ref,start.scope_revision,firstByTask,[olderTaskId],fields,isCurrent);
 const nextPort=asPort(start.workspace_ref,start.scope_revision,firstByTask,
  [olderTaskId,newerTaskId],fields,isCurrent);
 const request={taskId:olderTaskId,workspaceRef:start.workspace_ref,scopeRevision:start.scope_revision,
  maxTokens,fields,allowedSources:[older.source_ref]};
 const previous=await prepareProjectContinuation(request,oldPort);
 active(isCurrent);
 if(previous.contractVersion!==PROJECT_CONTINUATION_VERSION)
  throw Error('k01_project_owner_contract_mismatch');
 const result=await refreshProjectContinuation({
  ...previous
 },{...request,allowedSources:[older.source_ref,newer.source_ref]},nextPort);
 // Revalidate the exact accepted pair and Workspace after owner selection.
 // No result can become visible from a stale or replaced Core snapshot.
 await readPair(port,ids,isCurrent,start);
 active(isCurrent);
 if(result.contractVersion!==PROJECT_REFRESH_VERSION ||
  !['CURRENT','UPDATED','INCOMPLETE','REJECTED'].includes(result.status) ||
  !Array.isArray(result.fieldChanges)||!Array.isArray(result.sourceChanges))
  throw Error('k01_project_refresh_contract_mismatch');
 return {authority:'REVIEW_ONLY',status:result.status,reason:result.reason,
  requiresReview:result.requiresReview,reusable:result.reusable,
  fieldChanges:result.fieldChanges,sourceChanges:result.sourceChanges,
  issueChanges:result.issueChanges,visual,
  oldTaskId:olderTaskId,newTaskId:newerTaskId,workspaceRef:start.workspace_ref,
  scopeRevision:start.scope_revision,
  comparedFieldCount:fields.length,fieldLabels:fields.map(field=>({fieldKey:field.key,label:field.labels[0]})),
  sourceBytes:[new TextEncoder().encode(older.content).length,
   new TextEncoder().encode(newer.content).length],
  complete:result.latest?.requiredComplete===true,
  // Do not surface or store the full owner projection containing private text.
  sourceRevisions:[{sourceRef:older.source_ref,revision:older.revision},
   {sourceRef:newer.source_ref,revision:newer.revision}]};
}

/** A separate user action rereads the actual accepted Results before copying
 * them into the existing Task composer. No automatic Task or model execution.
 */
export async function prepareAcceptedResultComparisonDraft(port,comparison,{
 isCurrent=()=>true}={}){
 if(!port||typeof port.query!=='function'||typeof isCurrent!=='function'||
  comparison?.authority!=='REVIEW_ONLY'||
  !['INCOMPLETE','UPDATED','CURRENT'].includes(comparison.status)||
  !TASK.test(comparison.oldTaskId??'')||!TASK.test(comparison.newTaskId??'')||
  comparison.oldTaskId===comparison.newTaskId||
  typeof comparison.workspaceRef!=='string'||
  typeof comparison.scopeRevision!=='string'||
  !Array.isArray(comparison.sourceRevisions)||comparison.sourceRevisions.length!==2)
  throw Error('k01_project_draft_request_invalid');
 const current=await readPair(port,[comparison.oldTaskId,comparison.newTaskId],isCurrent);
 if(current.workspace_ref!==comparison.workspaceRef||
  current.scope_revision!==comparison.scopeRevision)
  throw Error('k01_project_draft_workspace_changed');
 for(let i=0;i<2;i++){
  const receipt=comparison.sourceRevisions[i],source=current.sources[i];
  if(receipt?.sourceRef!==source.source_ref||receipt?.revision!==source.revision)
   throw Error('k01_project_draft_source_changed');
 }
 const [historical,latest]=current.sources;
 const size=new TextEncoder().encode(historical.content).length+
  new TextEncoder().encode(latest.content).length;
 if(size>48000)throw Error('k01_project_draft_pair_over_budget');
 active(isCurrent);
 return {authority:'DRAFT_INPUT_ONLY',
  name:'iwxa-new-accepted-result.md',text:latest.content,
  previousText:historical.content,
  sourcePath:'agent-result:'+comparison.newTaskId};
}
