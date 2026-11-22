/**
 * Durable n8n proposal flow, backed entirely by the existing Core owners.
 * A proposal is a Task requiring Human Review; nothing invokes n8n here.
 * On an ambiguous command response the caller must only query request status.
 */
export type N8nWorkflowPort={
 query<T>(query:string,params?:Record<string,unknown>):Promise<T>;
 command<T>(command:string,input:Record<string,unknown>,target?:{kind:string;id:string}):Promise<T>;
 refreshRevision():Promise<void>;
};
type Row=Record<string,unknown>;
const row=(value:unknown):Row=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const requestPattern=/^NRQ-[0-9a-f]{32}$/;
const targetPattern=/^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
export type WorkflowTarget={target_id:string;title:string};
export type WorkflowOptions={
 workspace_id:string;selected:boolean;local_only:boolean;pending_request_id:string;
 targets:WorkflowTarget[];
};
export type WorkflowReadback={state:'READY_FOR_REVIEW'|'RECOVERY_REQUIRED'|'NOT_FOUND';task_id:string|null};
export function freshWorkflowRequestId(bytes:Uint8Array):string{
 if(bytes.length!==16)throw Error('workflow_entropy_unavailable');
 return 'NRQ-'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
}
export async function readN8nWorkflowOptions(port:N8nWorkflowPort):Promise<WorkflowOptions>{
 const data=row(await port.query<Row>('n8n_workflow_options'));
 if(data.schema!=='IWXA_N8N_WORKFLOW_OPTIONS/1'||data.provider_id!=='N8N_WORKFLOW_V1'
   ||typeof data.workspace_id!=='string'||!data.workspace_id||data.workspace_id.length>200
   ||typeof data.selected!=='boolean'||typeof data.local_only!=='boolean'
   ||!Array.isArray(data.targets)||data.targets.length>20
   ||(data.pending_request_id!==null&&data.pending_request_id!==undefined
      &&data.pending_request_id!==''&&(typeof data.pending_request_id!=='string'
       ||!requestPattern.test(data.pending_request_id))))
  throw Error('n8n_options_contract_invalid');
 const targets=data.targets.map(row);
 if(targets.some(t=>typeof t.target_id!=='string'||!targetPattern.test(t.target_id)
  ||typeof t.title!=='string'||t.title.length>200)
  ||new Set(targets.map(t=>t.target_id)).size!==targets.length)
  throw Error('n8n_targets_invalid');
 return {workspace_id:data.workspace_id,selected:data.selected,local_only:data.local_only,
  pending_request_id:typeof data.pending_request_id==='string'?data.pending_request_id:'',
  targets:targets.map(t=>({target_id:t.target_id as string,title:t.title as string}))};
}
export async function readN8nWorkflowRequest(port:N8nWorkflowPort,id:string):Promise<WorkflowReadback>{
 if(!requestPattern.test(id))throw Error('n8n_request_id_invalid');
 const data=row(await port.query<Row>('n8n_workflow_request_status',{request_id:id}));
 const state=data.state;
 if(!['READY_FOR_REVIEW','RECOVERY_REQUIRED','NOT_FOUND'].includes(String(state))
  ||data.read_only!==true||data.provider_invoked!==false)
  throw Error('n8n_request_status_contract_invalid');
 if(state!=='READY_FOR_REVIEW')return {state:state as WorkflowReadback['state'],task_id:null};
 const taskId=data.task_id;
 if(typeof taskId!=='string'||!/^TASK-N8NW-[0-9a-f]{20}$/.test(taskId)
  ||typeof data.candidate_id!=='string'||!data.candidate_id)
  throw Error('n8n_request_task_identity_invalid');
 const task=row(await port.query<Row>('task',{task_id:taskId}));
 if(task.task_id!==taskId||!Array.isArray(task.action_candidates)
   ||!task.action_candidates.map(row).some(candidate=>
    candidate.candidate_id===data.candidate_id&&candidate.operation==='n8n.workflow'))
  throw Error('n8n_request_task_readback_mismatch');
 return {state:'READY_FOR_REVIEW',task_id:taskId};
}
export async function prepareN8nWorkflow(port:N8nWorkflowPort,args:{
 request_id:string;workflow_target:string;message:string;workspace_id:string
}):Promise<{task_id:string;request_id:string}>{
 if(!requestPattern.test(args.request_id))throw Error('n8n_request_id_invalid');
 if(typeof args.message!=='string'||!args.message.trim()
    ||new TextEncoder().encode(args.message).length>4096)throw Error('n8n_message_invalid');
 const options=await readN8nWorkflowOptions(port);
 if(args.workspace_id!==options.workspace_id)throw Error('n8n_workspace_changed');
 if(options.local_only)throw Error('n8n_local_only_forbidden');
 if(!options.selected)throw Error('n8n_provider_not_selected');
 if(!options.targets.some(t=>t.target_id===args.workflow_target))
  throw Error('n8n_target_not_authorized');
 if(options.pending_request_id){
  const previous=await readN8nWorkflowRequest(port,options.pending_request_id);
  if(previous.state!=='READY_FOR_REVIEW')throw Error('n8n_previous_request_unresolved');
 }
 // The caller keeps request_id from BEFORE this first durable mutation.
 // A lost acknowledgement must not cause a second attempt.
 await port.refreshRevision();
 const begun=row(await port.command<Row>('n8n_workflow_request_begin',
  {request_id:args.request_id,confirmed:true},{kind:'provider',id:'N8N_WORKFLOW_V1'}));
 if(begun.request_id!==args.request_id||begun.execution_performed!==false)
  throw Error('n8n_begin_not_confirmed');
 const after=await readN8nWorkflowOptions(port);
 if(after.pending_request_id!==args.request_id
   ||after.workspace_id!==args.workspace_id||!after.selected||after.local_only
   ||!after.targets.some(t=>t.target_id===args.workflow_target))
  throw Error('n8n_reserved_state_changed');
 await port.refreshRevision();
 const result=row(await port.command<Row>('n8n_workflow_draft',{
  provider_id:'N8N_WORKFLOW_V1',workflow_target:args.workflow_target,
  message:args.message,workspace_id:args.workspace_id,confirmed:true,
  request_id:args.request_id
 },{kind:'provider',id:'N8N_WORKFLOW_V1'}));
 if(typeof result.task_id!=='string'||!/^TASK-N8NW-[0-9a-f]{20}$/.test(result.task_id)
   ||result.execution_performed!==false||result.model_invoked!==false)
  throw Error('n8n_draft_ack_unconfirmed');
 const readback=await readN8nWorkflowRequest(port,args.request_id);
 if(readback.state!=='READY_FOR_REVIEW'||readback.task_id!==result.task_id)
  throw Error('n8n_draft_readback_unconfirmed');
 return {task_id:result.task_id,request_id:args.request_id};
}


/** Read-only Task projection. The Task, plan, execution, and approval remain
 * Core-owned; this only binds their already-verified identities for the UI. */
export type N8nTaskLike={
 task_id:string;status:string;accepted_artifact_digest?:string;
 accepted_action_candidate_ids?:string[];
 action_candidates?:{candidate_id?:string;operation?:string;target?:string}[];
 readback?:{
  tool_plans?:{plan_id?:string;candidate_id?:string;tool_id?:string;execution_state?:string;execution_receipt_id?:string}[];
  execution_receipts?:{plan_id?:string;status?:string;external_effect_state?:string}[];
  repair_cases?:{case_id?:string;plan_id?:string;contract_state?:string}[];
  scheduled_work?:{job_id?:string;state?:string}[];
 };
};
export function summarizeN8nTask(task:N8nTaskLike){
 const candidates=(task.action_candidates||[]).filter(c=>c.operation==='n8n.workflow'
  &&typeof c.candidate_id==='string'&&c.candidate_id.length>0);
 const candidateIds=new Set(candidates.map(c=>c.candidate_id));
 const accepted=task.status==='closed'&&!!task.accepted_artifact_digest;
 const acceptedIds=new Set(task.accepted_action_candidate_ids||[]);
 const acceptedCandidates=accepted?candidates.filter(c=>typeof c.candidate_id==='string'&&acceptedIds.has(c.candidate_id)):[];
 const plans=(task.readback?.tool_plans||[]).filter(p=>p.tool_id==='n8n.workflow'
  &&typeof p.plan_id==='string'&&/^TPLAN-[A-Za-z0-9_-]{1,100}$/.test(p.plan_id)
  &&candidateIds.has(p.candidate_id));
 const planIds=new Set(plans.map(p=>p.plan_id));
 const receipts=(task.readback?.execution_receipts||[]).filter(r=>planIds.has(r.plan_id));
 const repairs=(task.readback?.repair_cases||[]).filter(r=>planIds.has(r.plan_id));
 const scheduled=task.readback?.scheduled_work||[];
 const unknownStates=new Set(['OUTCOME_UNKNOWN','INTERRUPTED']);
 const openCases=new Set(['OPEN_UNKNOWN','EVIDENCE_PENDING','REMAINS_UNKNOWN']);
 return {candidates,accepted,acceptedCandidates,plans,receipts,repairs,scheduled,
  // UNKNOWN external effect is not cleared by a SUCCEEDED plan state.
  // Only the owning ToolRuntime reconciliation can settle the outcome.
  unresolved:plans.some(p=>unknownStates.has(p.execution_state||''))
   ||receipts.some(r=>r.external_effect_state==='UNKNOWN')
   ||repairs.some(r=>openCases.has(r.contract_state||''))};
}
