/** Confirm the durable Task projection reflects this exact human decision.
 * A command acknowledgement by itself is not an accepted action candidate.
 */
type Row = Record<string, unknown>;
const record = (value: unknown): Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const digest = (value: unknown): boolean =>
  typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sameIds = (expected: string[], observed: unknown): boolean => {
  if (!Array.isArray(observed) || observed.some(v => typeof v !== 'string')) return false;
  const left = [...expected].sort(), right = [...observed].sort();
  return left.length === new Set(left).size && right.length === new Set(right).size &&
    left.length === right.length && left.every((id, index) => id === right[index]);
};
/** UI-only admission before an immutable Human Review command.
 * Core remains the authority; this compares the displayed Task result
 * against a new exact Workspace-scoped readback, without granting rights.
 */
export function taskReviewPreflightMatches(
 taskId:string,decision:string,admitted:string[],displayed:unknown,current:unknown
):boolean{
 const shown=record(displayed),fresh=record(current);
 if(!taskId||shown.task_id!==taskId||fresh.task_id!==taskId
    ||shown.status!=='result_imported'||fresh.status!=='result_imported'
    ||shown.review_required!==true||fresh.review_required!==true
    ||typeof shown.run_seq!=='number'||!Number.isSafeInteger(shown.run_seq)
    ||shown.run_seq!==fresh.run_seq)return false;
 if(!['approve','reject','revise'].includes(decision)
    ||new Set(admitted).size!==admitted.length
    ||admitted.some(id=>typeof id!=='string'||!id)
    ||(decision!=='approve'&&admitted.length))return false;
 const before=shown.action_candidates,after=fresh.action_candidates;
 if(!Array.isArray(before)||!Array.isArray(after)
    ||JSON.stringify(before)!==JSON.stringify(after))return false;
 const ids=after.map(value=>{
  const candidate=record(value);return candidate.candidate_id||candidate.ref_id;
 });
 if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length
    ||admitted.some(id=>!ids.includes(id)))return false;
 return ['summary','claims','uncertainties','draft_artifacts','provider'].every(key=>
  JSON.stringify(shown[key]??null)===JSON.stringify(fresh[key]??null));
}

export function reviewedTaskReadbackMatches(
  taskId: string, decision: string, selectedCandidates: string[], ack: unknown, observed: unknown,
): boolean {
  const result = record(ack), task = record(observed);
  if (!taskId || result.task_id !== taskId || task.task_id !== taskId) return false;
  if (decision === 'approve') {
    return result.decision === 'approve_draft' && result.status === 'closed' &&
      task.status === 'closed' && digest(task.accepted_artifact_digest) &&
      sameIds(selectedCandidates, result.accepted_action_candidates) &&
      sameIds(selectedCandidates, task.accepted_action_candidate_ids);
  }
  if (decision === 'reject') {
    return result.decision === 'reject' && result.status === 'closed' &&
      task.status === 'closed' && !task.accepted_artifact_digest &&
      sameIds([], result.accepted_action_candidates) &&
      (task.accepted_action_candidate_ids === undefined || sameIds([], task.accepted_action_candidate_ids));
  }
  if (decision === 'revise') {
    return selectedCandidates.length === 0 && result.review_decision === 'revise' &&
      result.revision_applied === true &&
      ['result_imported', 'awaiting_revision'].includes(String(task.status));
  }
  return false;
}

/** Recover a lost Human Review reply from the exact immutable decision
 * already verified and exposed by Core. Status "closed" alone is NOT enough:
 * the decision, original notes and admitted candidates must all match.
 * Only approval/rejection are terminal; revision may still invoke a model.
 */
export function recoveredHumanDecisionMatches(
  taskId: string, decision: string, candidates: string[], notes: string, observed: unknown,
): boolean {
  const task = record(observed), review = record(task.review_decision);
  if (!taskId || task.task_id !== taskId || task.review_required !== false ||
    task.status !== 'closed' || review.read_only !== true ||
    !/^REV-[0-9a-f]{16}$/.test(String(review.review_id || '')) ||
    !digest(review.review_digest) || review.notes !== notes) return false;
  if (decision === 'approve') {
    return review.decision === 'approve_draft' && digest(task.accepted_artifact_digest) &&
      sameIds(candidates, review.accepted_action_candidate_ids) &&
      sameIds(candidates, task.accepted_action_candidate_ids);
  }
  if (decision === 'reject') {
    return review.decision === 'reject' && candidates.length === 0 &&
      !task.accepted_artifact_digest &&
      sameIds([], review.accepted_action_candidate_ids) &&
      (task.accepted_action_candidate_ids === undefined ||
        sameIds([], task.accepted_action_candidate_ids));
  }
  return false;
}

/** Readback for one completed Graph belonging to the selected accepted Task.
 * Projection comparison never authorizes execution or a human decision.
 */
export function graphFinalReadbackMatches(
  executionId: string, goalId: string, snapshot: unknown, finalResult: unknown, goalStatus: unknown,
): boolean {
  const graph = record(snapshot), result = record(finalResult), goal = record(goalStatus);
  return Boolean(executionId && goalId && graph.snapshot_digest && graph.graph_digest &&
    graph.execution_digest && graph.execution_id === executionId &&
    graph.predecessor_goal_ref === goalId && graph.execution_state === 'COMPLETED' &&
    graph.user_readback && !graph.user_readback_error &&
    result.execution_id === executionId && result.goal_id === goalId &&
    result.graph_digest === graph.graph_digest &&
    result.execution_digest === graph.execution_digest &&
    digest(result.artifact_digest) && typeof result.text === 'string' && result.text.trim() &&
    record(goal.goal).goal_id === goalId);
}

/** Compare a Task action with its freshly read Workspace-scoped source.
 * UI checks do not substitute for Core command admission.
 */
export function taskFollowupPreflightMatches(
 taskId:string,operation:'prepare'|'retry',candidateId:string|undefined,
 displayed:unknown,current:unknown
):boolean{
 const shown=record(displayed),fresh=record(current);
 if(!taskId||shown.task_id!==taskId||fresh.task_id!==taskId
    ||typeof shown.run_seq!=='number'||!Number.isSafeInteger(shown.run_seq)
    ||shown.run_seq<1||shown.run_seq!==fresh.run_seq
    ||shown.status!==fresh.status)return false;
 const resultFields=['objective','summary','claims','uncertainties','draft_artifacts',
  'provider','requested_local_model','action_candidates','accepted_artifact_digest',
  'accepted_action_candidate_ids','review_required'];
 if(!resultFields.every(key=>JSON.stringify(shown[key]??null)===JSON.stringify(fresh[key]??null)))
  return false;
 if(operation==='retry')return !candidateId&&shown.status==='awaiting_result'
  &&!shown.accepted_artifact_digest;
 if(operation!=='prepare'||shown.status!=='closed'||!digest(shown.accepted_artifact_digest)
    ||typeof candidateId!=='string'||!candidateId)return false;
 const admitted=shown.accepted_action_candidate_ids,proposed=shown.action_candidates;
 if(!Array.isArray(admitted)||new Set(admitted).size!==admitted.length
    ||admitted.some(id=>typeof id!=='string'||!id)||!admitted.includes(candidateId)
    ||!Array.isArray(proposed))return false;
 const candidates=proposed.map(record);
 const ids=candidates.map(row=>row.candidate_id??row.ref_id);
 if(ids.some(id=>typeof id!=='string'||!id)||new Set(ids).size!==ids.length)
  return false;
 const candidate=candidates.find(row=>(row.candidate_id??row.ref_id)===candidateId);
 return !!candidate&&candidate.tool_id!=='files.write_text'
  &&candidate.operation!=='files.write_text';
}
