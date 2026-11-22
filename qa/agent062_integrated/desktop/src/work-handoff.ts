/** Explicit UI handoff only; Core still owns every saved task, graph and automation. */
export type WorkDestination='Цепочки'|'Агенты'|'Автоматизации';
export type WorkHandoff={
 destination:WorkDestination;
 objective:string;
 localModel:{name:string;digest:string}|null;
 hadLocalSources:boolean;
 sourceTaskId:string|null;
 linkedGoalId:string|null;
 linkedBoardId:string|null;
 /** Optional original user request for pre-filling Goal when text is a reviewed Result. */
 goalObjective?:string;
};
// Graph STATIC_TEXT in the existing Core accepts up to 500,000 characters.
// A Result handoff must not impose the old 12,000-character draft-only cap.
// A chosen model may still reject an input beyond its actual GGUF context.
const LIMIT:Record<WorkDestination,number>={'Цепочки':500000,'Агенты':2000,'Автоматизации':32000};
export function planWorkHandoff(destination:WorkDestination,objective:string,
 localModel:{name:string;digest:string}|null,hadLocalSources:boolean,
 sourceTaskId:string|null=null,linkedGoalId:string|null=null,linkedBoardId:string|null=null,
 goalObjective:string|null=null):WorkHandoff{
 if(!Object.prototype.hasOwnProperty.call(LIMIT,destination))throw Error('work_handoff_target_invalid');
 if(typeof objective!=='string'||!objective.trim())throw Error('work_handoff_objective_missing');
 // Reviewed Result is immutable source text: preserve every leading/trailing
 // newline and space. The original Task objective remains a separate Goal seed.
 const text=goalObjective!==null?objective:objective.trim();
 if(text.length>LIMIT[destination])throw Error('work_handoff_objective_too_long');
 if(localModel!==null&&(!localModel||typeof localModel.name!=='string'||typeof localModel.digest!=='string'
    ||!/^[a-f0-9]{64}$/i.test(localModel.digest)))throw Error('work_handoff_model_invalid');
 if(sourceTaskId!==null&&(typeof sourceTaskId!=='string'||!/^TASK-[A-Za-z0-9_-]{1,80}$/.test(sourceTaskId)))
  throw Error('work_handoff_source_task_invalid');
 if(linkedGoalId!==null&&(!sourceTaskId||typeof linkedGoalId!=='string'
     ||!/^GOAL-[A-Za-z0-9_-]{1,100}$/.test(linkedGoalId)))
  throw Error('work_handoff_linked_goal_invalid');
 if(linkedBoardId!==null&&(!linkedGoalId||typeof linkedBoardId!=='string'
    ||!/^BOARD-[A-Za-z0-9_-]{1,100}$/.test(linkedBoardId)))throw Error('work_handoff_linked_board_invalid');
 if(goalObjective!==null&&
    (destination!=='Цепочки'||!sourceTaskId||typeof goalObjective!=='string'||
     !goalObjective.trim()||goalObjective.length>240))
   throw Error('work_handoff_goal_objective_invalid');
 return {destination,objective:text,localModel,hadLocalSources:hadLocalSources===true,
  sourceTaskId,linkedGoalId,linkedBoardId,
  ...(goalObjective!==null?{goalObjective:goalObjective.trim()}:{})};
}


/** Read-only identity check at the Task -> Goal -> WorkBoard -> Graph handoff.
 * All actual execution and authority decisions stay in Python Core.
 */
type Row=Record<string,unknown>;
const row=(value:unknown):Row=>value!==null&&typeof value==='object'&&!Array.isArray(value)
 ?value as Row:{};
const rows=(value:unknown):Row[]=>Array.isArray(value)?value.map(row):[];
const digest=(value:unknown):value is string=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);

/** Copy the verified, complete accepted Result only after an explicit choice.
 * Never substitute the Task objective, a list preview, or truncated text.
 * This uses the existing Task detail and Graph editor; no new Result store.
 */
export function acceptedTaskResultForGraphHandoff(value:unknown):string{
 const task=row(value);
 if(task.status!=='closed'||!digest(task.accepted_artifact_digest))
  throw Error('work_handoff_source_not_accepted');
 if(task.summary_truncated===true)
  throw Error('work_handoff_result_incomplete');
 const result=typeof task.summary==='string'?task.summary:'';
 if(!result.trim())throw Error('work_handoff_result_unavailable');
 if(result.length>LIMIT['Цепочки'])
  throw Error('work_handoff_accepted_result_too_long');
 return result;
}

export function verifiedGraphWorkOrigin(
 taskValue:unknown,goalValue:unknown,boardValue:unknown,
 sourceTaskId:string,linkedGoalId:string,linkedBoardId:string|null=null,
):boolean{
 const task=row(taskValue),readback=row(task.readback),status=row(goalValue),goal=row(status.goal);
 const origin=row(status.source_task),sourceRef=row(goal.source_task_ref);
 const accepted=task.accepted_artifact_digest;
 if(!sourceTaskId||!linkedGoalId||task.task_id!==sourceTaskId||task.status!=='closed'||!digest(accepted))return false;
 const link=rows(readback.goals).find(g=>g.goal_id===linkedGoalId&&digest(g.contract_digest));
 if(!link||goal.goal_id!==linkedGoalId||goal.contract_digest!==link.contract_digest
   ||sourceRef.ref_id!==sourceTaskId||origin.task_id!==sourceTaskId
   ||origin.binding_state!=='BOUND'||origin.human_accepted!==true
   ||origin.accepted_artifact_digest!==accepted)return false;
 if(!linkedBoardId)return true;
 const boardStatus=row(boardValue),board=row(boardStatus.board);
 const boardGoal=row(board.goal_ref),summary=row(boardStatus.goal_summary);
 const boardOrigin=row(boardStatus.source_task);
 const boardLink=rows(readback.work_boards).find(b=>b.board_id===linkedBoardId&&b.goal_id===linkedGoalId
   &&digest(b.board_digest));
 return Boolean(boardLink&&board.board_id===linkedBoardId&&board.board_digest===boardLink.board_digest
   &&boardGoal.ref_id===linkedGoalId&&boardGoal.digest_sha256===goal.contract_digest
   &&summary.goal_id===linkedGoalId&&summary.contract_digest===goal.contract_digest
   &&rows(status.linked_boards).some(b=>b.board_id===linkedBoardId&&b.board_digest===board.board_digest)
   &&boardOrigin.binding_state==='BOUND'&&boardOrigin.task_id===sourceTaskId
   &&boardOrigin.human_accepted===true&&boardOrigin.accepted_artifact_digest===accepted);
}


/** Link a verified Goal proof back to an execution explicitly present in the
 * originating Task's readback. A saved proof alone cannot confirm live evidence.
 * No execution or Goal authority is granted by this projection.
 */
export function linkedGraphProofExecution(
 proofValue:unknown,evidenceIntegrity:unknown,goalId:string,graphRunsValue:unknown,
):string|null{
 if(evidenceIntegrity!=='VERIFIED'||!goalId)return null;
 const refs=rows(row(proofValue).evidence_refs);
 if(refs.length!==1)return null;
 const ref=refs[0];
 if(typeof ref.ref_id!=='string'||!digest(ref.digest_sha256))return null;
 const match=/^graph-final:(.+):([a-f0-9]{64})$/.exec(ref.ref_id);
 if(!match||!/^[A-Za-z0-9_.:-]{1,160}$/.test(match[1]))return null;
 return rows(graphRunsValue).some(run=>run.execution_id===match[1]&&run.goal_id===goalId)
  ?match[1]:null;
}

/** Read-only recovery hint from the existing Core-owned automation history.
 * A matching saved submission is NEVER an instruction to repeat execution.
 * The human can inspect it or explicitly request a separate new Task.
 */
export type SavedInteractiveSubmission={
 submissionId:string;taskId:string;jobId:string;state:string;
};
export function savedInteractiveTaskForDraft(
 jobsValue:unknown,workspaceId:string,draftText:string
):SavedInteractiveSubmission|null{
 if(!Array.isArray(jobsValue))throw Error('task_submission_history_unreadable');
 if(!workspaceId||!draftText.trim())return null;
 const jobs=jobsValue.map(row).filter(item=>{
  const payload=row(item.payload);
  return payload.interactive===true&&payload.workspace_id===workspaceId
   &&payload.message===draftText.trim();
 });
 const saved=jobs.sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')))[0];
 if(!saved)return null;
 const payload=row(saved.payload);
 if(typeof payload.submission_id!=='string'||!/^[0-9a-f]{32}$/.test(payload.submission_id)
   ||typeof payload.task_id!=='string'||!/^TASK-CHAT-[0-9a-f]{24}$/.test(payload.task_id)
   ||typeof saved.job_id!=='string'||!/^JOB-CHAT-[0-9a-f]{24}$/.test(saved.job_id)
   ||!['SCHEDULED','RUNNING','COMPLETED','PAUSED','DEAD','CANCELLED'].includes(String(saved.state)))
  throw Error('task_submission_history_identity_invalid');
 return {submissionId:payload.submission_id,taskId:payload.task_id,
  jobId:saved.job_id as string,state:String(saved.state)};
}

/** A task send is reserved in the existing Core composer BEFORE dispatch.
 * An unknown outcome is recoverable after a full GUI/Core restart, and a
 * different workspace may not silently inherit or clear that reservation.
 */
export type PendingTaskIntent={submission_id:string;draft_digest:string;workspace_id:string};
export function pendingTaskIntent(value:unknown):PendingTaskIntent|null{
 if(value===null||value===undefined)return null;
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('task_intent_unreadable');
 const o=value as Record<string,unknown>;
 if(Object.keys(o).sort().join(',')!=='draft_digest,submission_id,workspace_id'
   ||typeof o.submission_id!=='string'||!/^[a-f0-9]{32}$/.test(o.submission_id)
   ||typeof o.draft_digest!=='string'||!/^[a-f0-9]{64}$/.test(o.draft_digest)
   ||typeof o.workspace_id!=='string'||!(/^(personal|AREA-[a-f0-9]{18})$/.test(o.workspace_id)))
  throw Error('task_intent_unreadable');
 return {submission_id:o.submission_id,draft_digest:o.draft_digest,workspace_id:o.workspace_id};
}

/** Validate presentation identity against the ORIGINAL accepted Agent artifact.
 * This read-only preview is NOT an organizational right, signed carrier,
 * Kernel Import, or proof of external execution.
 */
export function acceptedT3HandoffPreview(value:unknown,taskId:string,acceptedDigest:string):boolean{
 const preview=row(value);
 if(preview.status!=='PREVIEW_ONLY'||preview.task_id!==taskId
    ||typeof preview.result_id!=='string'||!/^RES-[A-Za-z0-9_-]+$/.test(preview.result_id)
    ||preview.exported!==false||preview.t3_signed!==false
    ||typeof preview.text!=='string'||!digest(acceptedDigest))return false;
 let selected:Row;
 try {selected=row(JSON.parse(preview.text));}catch{return false;}
 const origin=row(selected.origin);
 return origin.personal_task_id===taskId
   &&origin.personal_result_id===preview.result_id
   &&origin.accepted_artifact_sha256===acceptedDigest
   &&digest(origin.personal_result_sha256)
   &&selected.recipient_review_required===true
   &&selected.external_actions_performed===false;
}
