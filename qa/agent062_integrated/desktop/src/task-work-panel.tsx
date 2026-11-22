import React,{useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {failure,record,records,str,OwnerError,type Row} from './owner-ui';
import {useUiSettings} from './ui-preferences';
import {savedDagRows} from './graph-dag';
import {GraphDagView} from './graph-dag-view';
import {graphFinalReadbackMatches} from './task-review-readback';
import {graphModelProvenance} from './graph-model-provenance';
import {meetingStepsFromGraph,reviewMeetingGraph,verifyMeetingDraft,type MeetingReview} from './meeting-followup-review';

/** All links originate from the accepted Task readback. Execution and decisions
 * remain in GraphControl and HostedReference; this component owns no work state. */
export type TaskGraphLink={
 execution_id:string;graph_id:string;goal_id:string;state:string;
 completed_node_count:number;node_count:number;
};
export type TaskAssistantLink={
 hosted_run_id:string;goal_id:string;state:string;created_at:string;final_state?:string;
};
export type TaskWorkLinks={
 graph_runs?:TaskGraphLink[];assistant_runs?:TaskAssistantLink[];
 graph_history_limited?:boolean;
};
type Focus={kind:'graph'|'assistant';id:string;goalId:string;graphId?:string};
type Props={
 taskId:string;accepted:boolean;fresh:boolean;links?:TaskWorkLinks;
 onOpenGraph:(id:string)=>void;onOpenAssistant:(id:string)=>void;
 onRefreshTask:()=>Promise<void>;
};
const stateName=(state:string,tr:(ru:string,en:string)=>string)=>{
 switch(state){
  case 'COMPLETED':return tr('Выполнен','Completed');
  case 'FINALIZED':return tr('Решение сохранено','Decision saved');
  case 'AWAITING_HUMAN_VERIFICATION':return tr('Ожидает вашей проверки','Awaiting your review');
  case 'ACCEPTED':return tr('Принят','Accepted');
  case 'REJECTED':return tr('Отклонён','Rejected');
  case 'FAILED':return tr('Ошибка','Failed');
  case 'PAUSED':return tr('Приостановлен','Paused');
  case 'CANCELLED':return tr('Отменён','Cancelled');
  case 'READY':return tr('Готов к выполнению','Ready to run');
  case 'RUNNING':return tr('Выполняется','Running');
  case 'PENDING':return tr('Ожидает выполнения','Pending');
  case 'AWAITING_HUMAN_REVIEW':return tr('Требует вашего решения','Your decision required');
  case 'APPLIED':return tr('Решение применено','Decision applied');
  case 'STALE':return tr('Требуется обновление','Refresh required');
  default:return tr('Проверьте состояние','Check status');
 }
};

export function TaskWorkPanel({taskId,accepted,fresh,links,onOpenGraph,onOpenAssistant,onRefreshTask}:Props){
 const {tr}=useUiSettings();
 const graphs=links?.graph_runs||[],assistants=links?.assistant_runs||[];
 const [focus,setFocus]=useState<Focus|null>(null);
 const [snapshot,setSnapshot]=useState<Row|null>(null);
 const [graphView,setGraphView]=useState<Row|null>(null),[graphViewError,setGraphViewError]=useState('');
 const [meetingReview,setMeetingReview]=useState<MeetingReview|null>(null);
 const [requests,setRequests]=useState<Row[]>([]);
 const [votes,setVotes]=useState<Record<string,string>>({});
 const [fullResult,setFullResult]=useState<Row|null>(null),[goalStatus,setGoalStatus]=useState<Row|null>(null);
 const [criterionId,setCriterionId]=useState(''),[resultReviewed,setResultReviewed]=useState(false);
 const [loading,setLoading]=useState(false),[acting,setActing]=useState(false);
 const [error,setError]=useState<unknown>(null),[notice,setNotice]=useState('');
 const readSeq=useRef(0),actionInFlight=useRef(false);
 useEffect(()=>{
  readSeq.current+=1;setFocus(null);setSnapshot(null);setGraphView(null);setGraphViewError('');setMeetingReview(null);setRequests([]);setVotes({});
  setLoading(false);setActing(false);setError(null);setNotice('');
 },[taskId]);

 const linked=(item:Focus,readback:Row)=>{
  const list=records(item.kind==='graph'?readback.graph_runs:readback.assistant_runs);
  return list.some(row=>(item.kind==='graph'?str(row.execution_id):str(row.hosted_run_id))===item.id
   &&str(row.goal_id)===item.goalId&&(item.kind!=='graph'||str(row.graph_id)===item.graphId));
 };
 async function readCurrent(item:Focus){
  // Re-read the accepted source Task before each consequential action.
  const source=record(await runtime.query<Row>('task',{task_id:taskId}));
  if(str(source.task_id)!==taskId||source.status!=='closed'||!str(source.accepted_artifact_digest)
     ||!linked(item,record(source.readback)))throw Error('task_link_changed');
  if(item.kind==='graph'){
   const graph=record(await runtime.query<Row>('graph_control_center',{execution_id:item.id}));
   if(str(graph.execution_id)!==item.id||str(graph.graph_id)!==item.graphId
      ||str(graph.predecessor_goal_ref)!==item.goalId||!str(graph.snapshot_digest))
    throw Error('task_graph_binding_changed');
   const queue=record(await runtime.query<Row>('graph_control_requests',{execution_id:item.id}));
   if(str(queue.execution_id)!==item.id||records(queue.requests).some(r=>str(r.execution_id)!==item.id))
    throw Error('task_graph_review_binding_changed');
   return {data:graph,queue:records(queue.requests)};
  }
  const review=record(await runtime.query<Row>('hosted_reference_review',{hosted_run_id:item.id}));
  if(str(review.hosted_run_id)!==item.id||str(record(review.goal_ref).ref_id)!==item.goalId)
   throw Error('task_assistant_binding_changed');
  return {data:review,queue:[] as Row[]};
 }
 async function readGraphView(item:Focus,observed:Row,sequence:number,fullResult:Row|null=null){
  setGraphView(null);setGraphViewError('');setMeetingReview(null);
  try{
   // An optional, read-only view. Human decisions still use readCurrent.
   const response=record(await runtime.query<Row>('graph_revision_editor',{execution_id:item.id}));
   const graph=record(response.base_graph);
   if(str(response.execution_id)!==item.id
    ||str(response.base_graph_digest)!==str(observed.graph_digest)
    ||str(response.expected_snapshot_digest)!==str(observed.snapshot_digest)
    ||str(graph.graph_digest)!==str(observed.graph_digest)
    ||str(graph.graph_id)!==item.graphId
    ||str(graph.predecessor_goal_ref)!==item.goalId
    ||!savedDagRows(graph))throw Error('task_graph_view_binding_changed');
   let meeting:MeetingReview|null=null;
   const nodes=records(graph.nodes);
   if((nodes.length===3||nodes.length===4)
      &&['input','extract','result'].every(id=>nodes.some(n=>str(n.node_id)===id))){
    try{
     const configs=record(await runtime.query<Row>('graph_node_configs'));
     const steps=meetingStepsFromGraph(graph,records(configs.configs));
     meeting=reviewMeetingGraph(steps,observed.user_readback,str(observed.execution_state));
     // Core exposes a shortened readback for the UI, but an independently
     // bound graph_final_result contains the full immutable final artifact.
     if(steps&&meeting?.issues.includes('RESULT_TRUNCATED')&&fullResult
        &&str(fullResult.node_id)==='result'&&typeof fullResult.text==='string')
      meeting=verifyMeetingDraft(steps[0].text,fullResult.text,false,
       steps.length===4||(steps[1].system?.includes('K04_SOURCE_EVIDENCE_V1')===true
        &&steps[2].system?.includes('K04_SOURCE_EVIDENCE_V1')===true));
    }catch{
     meeting={status:'REVIEW_REQUIRED',items:0,checked:0,issues:['MEETING_REVIEW_UNAVAILABLE'],questions:[]};
    }
   }
   if(sequence===readSeq.current){setGraphView(graph);setMeetingReview(meeting);}
  }catch(e){
   if(sequence===readSeq.current)setGraphViewError(tr(
    'Схема процесса не подтверждена. Проверка результата остаётся доступной. ',
    'Workflow graph cannot be verified. Result review remains available. ')+failure(e));
  }
 }
 async function readCompletedGraph(item:Focus,observed:Row):Promise<{full:Row;goal:Row}|null>{
  if(item.kind!=='graph'||observed.execution_state!=='COMPLETED')return null;
  if(!observed.user_readback||observed.user_readback_error)
   throw Error('task_graph_final_evidence_unavailable');
  const [full,goal]=await Promise.all([
   runtime.query<Row>('graph_final_result',{execution_id:item.id}),
   runtime.query<Row>('goal_status',{goal_id:item.goalId}),
  ]);
  if(!graphFinalReadbackMatches(item.id,item.goalId,observed,full,goal))
   throw Error('task_graph_final_binding_changed');
  return {full,goal};
 }
 async function show(item:Focus){
  if(!accepted||!fresh||loading||actionInFlight.current)return;
  const seq=++readSeq.current;
  setFocus(item);setSnapshot(null);setGraphView(null);setGraphViewError('');setMeetingReview(null);setRequests([]);setVotes({});
  setFullResult(null);setGoalStatus(null);setCriterionId('');setResultReviewed(false);
  setError(null);setNotice('');setLoading(true);
  try{
   const result=await readCurrent(item);
   if(seq!==readSeq.current)return;
   setSnapshot(result.data);setRequests(result.queue);
   const completed=await readCompletedGraph(item,result.data);
   if(seq!==readSeq.current)return;
   if(item.kind==='graph')await readGraphView(item,result.data,seq,completed?.full??null);
   if(seq!==readSeq.current)return;
   setFullResult(completed?.full??null);setGoalStatus(completed?.goal??null);
  }catch(e){if(seq===readSeq.current)setError(e);}
  finally{if(seq===readSeq.current)setLoading(false);}
 }
 async function refreshSelected(){
  if(!focus||loading||acting)return;
  const seq=++readSeq.current;
  setLoading(true);setError(null);setNotice('');setGraphView(null);setGraphViewError('');setMeetingReview(null);
  try{
   const result=await readCurrent(focus);
   if(seq!==readSeq.current)return;
   setSnapshot(result.data);setRequests(result.queue);
   setFullResult(null);setGoalStatus(null);setCriterionId('');setResultReviewed(false);
   const completed=await readCompletedGraph(focus,result.data);
   if(seq!==readSeq.current)return;
   if(focus.kind==='graph')await readGraphView(focus,result.data,seq,completed?.full??null);
   if(seq!==readSeq.current)return;
   setFullResult(completed?.full??null);setGoalStatus(completed?.goal??null);
  }catch(e){if(seq===readSeq.current){setSnapshot(null);setRequests([]);setError(e);}}
  finally{if(seq===readSeq.current)setLoading(false);}
 }
 function close(){
  if(actionInFlight.current)return;
  readSeq.current+=1;setFocus(null);setSnapshot(null);setGraphView(null);setGraphViewError('');setMeetingReview(null);setRequests([]);setVotes({});
  setError(null);setNotice('');setLoading(false);
 }
 const evidence=records(snapshot?.ticket_evidence);
 const tickets=records(snapshot?.ticket_results);
 const criteria=records(snapshot?.goal_criteria);
 const finalization=record(snapshot?.finalization);
 const finalized=finalization.finalized===true;
 const contradictory=tickets.some(row=>votes['ticket:'+str(row.ticket_id)]==='FAIL')
  &&criteria.length>0&&criteria.every(row=>votes['criterion:'+str(row.criterion_id)]==='PASS');
 const votesComplete=focus?.kind==='assistant'&&snapshot?.state==='AWAITING_HUMAN_VERIFICATION'
  &&snapshot.evidence_verified===true&&!finalized&&!contradictory
  &&tickets.length>0&&criteria.length>0
  &&tickets.every(row=>{
   const vote=votes['ticket:'+str(row.ticket_id)];
   const proof=evidence.find(ev=>str(ev.ticket_id)===str(row.ticket_id));
   return vote==='FAIL'||(vote==='PASS'&&!!proof&&proof.worker_output_truncated!==true&&!!str(proof.worker_output).trim());
  })
  &&criteria.every(row=>['PASS','FAIL','UNKNOWN'].includes(votes['criterion:'+str(row.criterion_id)]));
 const canAct=accepted&&fresh&&!loading&&!acting&&!!snapshot&&!error;
 const selectedCriterion=records(goalStatus?.criteria).find(c=>str(record(c.criterion).criterion_id)===criterionId);
 async function reviewGraph(status:'PASS'|'FAIL'){
  if(!focus||focus.kind!=='graph'||!canAct||!resultReviewed||!fullResult||!selectedCriterion)return;
  if(!window.confirm(tr('Записать решение по критерию после просмотра полного результата?',
    'Record criterion decision after reviewing the complete result?')))return;
  actionInFlight.current=true;setActing(true);setNotice('');setError(null);
  const seq=++readSeq.current;let sent=false;
  try{
   const before=await readCurrent(focus);
   if(str(before.data.snapshot_digest)!==str(snapshot?.snapshot_digest))
    throw Error('task_graph_review_snapshot_changed');
   const [full,goal]=await Promise.all([
    runtime.query<Row>('graph_final_result',{execution_id:focus.id}),
    runtime.query<Row>('goal_status',{goal_id:focus.goalId}),
   ]);
   if(!graphFinalReadbackMatches(focus.id,focus.goalId,before.data,full,goal))
    throw Error('task_graph_review_binding_changed');
   const oldProof=record(selectedCriterion.proof);
   const current=records(goal.criteria).find(c=>str(record(c.criterion).criterion_id)===criterionId);
   if(full.artifact_digest!==fullResult.artifact_digest||
      full.execution_digest!==fullResult.execution_digest||full.text!==fullResult.text||
      str(record(current?.proof).proof_digest)!==str(oldProof.proof_digest))
    throw Error('task_graph_review_evidence_changed');
   await runtime.refreshRevision();sent=true;
   const proof=record(await runtime.command<Row>('graph_goal_proof',{
    goal_id:focus.goalId,criterion_id:criterionId,execution_id:focus.id,status,
    expected_snapshot_digest:before.data.snapshot_digest,
    expected_artifact_digest:full.artifact_digest,
    expected_proof_digest:str(oldProof.proof_digest),confirmed:true,
   },{kind:'goal',id:focus.goalId}));
   const verified=record(await runtime.query<Row>('goal_status',{goal_id:focus.goalId}));
   const row=records(verified.criteria).find(c=>str(record(c.criterion).criterion_id)===criterionId);
   if(str(record(row?.proof).proof_id)!==str(proof.proof_id)
      ||row?.status!==status||row.evidence_integrity!=='VERIFIED')
    throw Error('task_graph_review_readback_unverified');
   if(seq===readSeq.current){setGoalStatus(verified);setResultReviewed(false);
    setNotice(tr('Решение записано и проверено.','Decision saved and verified.'));}
   await onRefreshTask();
  }catch(e){if(seq===readSeq.current){setError(e);setNotice(sent?tr(
   'Решение могло сохраниться. Обновите данные перед повтором.',
   'Decision may have been saved. Refresh before retrying.'):tr(
   'Состояние изменилось, проверьте его повторно.',
   'State changed. Inspect it again.'));}}
  finally{actionInFlight.current=false;if(seq===readSeq.current)setActing(false);}
 }

 const graphResultVerified=Boolean(snapshot?.user_readback)&&!str(record(snapshot?.user_readback_error).code);

 type Operation='advance'|'request'|'decision'|'finalize';
 async function execute(op:Operation,option?:string,digest?:string){
  if(!focus||!canAct||actionInFlight.current)return;
  const question=op==='advance'
   ?tr('Выполнить доступные шаги процесса? Модель и разрешённые инструменты чтения могут быть вызваны.',
       'Run available workflow steps? The model and approved read tools may be invoked.')
   :op==='request'?tr('Передать изменение состояния процесса на отдельное подтверждение?',
       'Submit the workflow state change for separate approval?')
   :op==='decision'?tr('Сохранить ваше решение по выбранной команде процесса?',
       'Save your decision on the selected workflow command?')
   :tr('Сохранить ваши решения по всем шагам и условиям работы помощников?',
       'Save your decisions for every assistant step and acceptance criterion?');
  if(!window.confirm(question))return;
  actionInFlight.current=true;setActing(true);setError(null);setNotice('');
  const current=focus,seq=++readSeq.current;
  let dispatched=false;
  try{
   const before=await readCurrent(current);
   // Never authorize an operation on a snapshot that changed since display.
   if(current.kind==='graph'){
    if(str(before.data.snapshot_digest)!==str(snapshot?.snapshot_digest))
     throw Error('task_workflow_changed');
    if(!before.data.user_readback||str(record(before.data.user_readback_error).code)){
     const resumeApproval=op==='decision'&&option==='APPROVE'&&before.queue.some(q=>
      str(q.command_digest)===digest&&str(q.action)==='RESUME');
     if(op==='advance'||(op==='request'&&option==='RESUME')||resumeApproval)
      throw Error('task_graph_result_evidence_unavailable');
    }
   }else if(str(before.data.hosted_run_id)!==str(snapshot?.hosted_run_id)
      ||record(before.data.finalization).finalized!==finalized
      ||before.data.state!==snapshot?.state)throw Error('task_assistant_changed');

   let command='',input:Row={},target:{kind:string;id:string}|undefined;
   if(op==='advance'&&current.kind==='graph'){
    if(records(record(before.data.user_readback).pending_model_attempts)
       .some(row=>str(row.reason)==='MODEL_OUTCOME_UNCONFIRMED'
        &&row.automatic_retry_allowed===false))
     throw Error('task_graph_model_outcome_unconfirmed');
    if(records(record(before.data.user_readback).pending_agent_attempts)
       .some(row=>str(row.reason)==='AGENT_RUNTIME_OUTCOME_UNKNOWN'
        &&row.automatic_retry_allowed===false))
     throw Error('task_graph_agent_outcome_unconfirmed');
    if(!['READY','RUNNING'].includes(str(before.data.execution_state)))throw Error('task_workflow_not_running');
    command='graph_advance';
    input={execution_id:current.id,expected_graph_snapshot_digest:before.data.snapshot_digest,max_steps:1};
    target={kind:'graph_execution',id:current.id};
   }else if(op==='request'&&current.kind==='graph'&&['PAUSE','RESUME','CANCEL'].includes(option||'')){
    if(!Array.isArray(before.data.supported_controls)||!before.data.supported_controls.includes(option))
     throw Error('task_workflow_action_unavailable');
    command='graph_control_command';
    input={execution_id:current.id,action:option,idempotency_key:crypto.randomUUID(),
      expected_graph_snapshot_digest:before.data.snapshot_digest};
    target={kind:'graph_execution',id:current.id};
   }else if(op==='decision'&&current.kind==='graph'&&['APPROVE','REJECT'].includes(option||'')&&digest){
    const row=before.queue.find(r=>str(r.command_digest)===digest&&r.state==='AWAITING_HUMAN_REVIEW');
    if(!row||str(row.execution_id)!==current.id||!['PAUSE','RESUME','CANCEL'].includes(str(row.action)))
     throw Error('task_workflow_decision_changed');
    command='graph_control_decision';
    input={command_digest:digest,decision:option,idempotency_key:crypto.randomUUID()};
   }else if(op==='finalize'&&current.kind==='assistant'&&votesComplete
      &&before.data.state==='AWAITING_HUMAN_VERIFICATION'
      &&before.data.evidence_verified===true
      &&record(before.data.finalization).finalized!==true){
    const currentTickets=records(before.data.ticket_results),currentCriteria=records(before.data.goal_criteria);
    if(currentTickets.length!==tickets.length||currentCriteria.length!==criteria.length
       ||currentTickets.some(x=>!tickets.some(y=>str(x.ticket_id)===str(y.ticket_id)))
       ||currentCriteria.some(x=>!criteria.some(y=>str(x.criterion_id)===str(y.criterion_id))))
     throw Error('task_assistant_steps_changed');
    const ticket_decisions:Record<string,string>={},criterion_decisions:Record<string,string>={};
    for(const row of currentTickets)ticket_decisions[str(row.ticket_id)]=votes['ticket:'+str(row.ticket_id)];
    for(const row of currentCriteria)criterion_decisions[str(row.criterion_id)]=votes['criterion:'+str(row.criterion_id)];
    command='hosted_reference_finalize';
    input={hosted_run_id:current.id,ticket_decisions,criterion_decisions};
    target={kind:'hosted_reference_run',id:current.id};
   }else throw Error('task_action_no_longer_available');

   await runtime.refreshRevision();dispatched=true;
   const ack=record(await runtime.command<Row>(command,input,target));
   const after=await readCurrent(current);
   if(op==='request'){
    const requested=str(record(ack.command).command_digest);
    if(!requested||!after.queue.some(row=>str(row.command_digest)===requested&&
      str(row.action)===option&&row.state==='AWAITING_HUMAN_REVIEW'))throw Error('task_control_request_readback_unverified');
   }else if(op==='decision'){
    if(!after.queue.some(row=>str(row.command_digest)===digest&&
     (option==='REJECT'?row.state==='REJECTED':row.state==='APPLIED')))throw Error('task_control_decision_readback_unverified');
   }else if(op==='finalize'){
    if(record(after.data.finalization).finalized!==true)throw Error('task_assistant_decision_readback_unverified');
   }else if(!str(after.data.snapshot_digest))throw Error('task_execution_readback_unverified');

   // A completed Graph is immediately ready for human review in this same Task.
   // Do not mistake a successful step acknowledgement for a verified final Result.
   const completed=await readCompletedGraph(current,after.data);
   if(current.kind==='graph')await readGraphView(current,after.data,seq,completed?.full??null);
   if(seq===readSeq.current){
    setSnapshot(after.data);setRequests(after.queue);
    if(current.kind==='graph'){
     setFullResult(completed?.full??null);setGoalStatus(completed?.goal??null);
     setCriterionId('');setResultReviewed(false);
    }
    if(op==='finalize')setVotes({});
    setNotice(tr('Сохранённое состояние подтверждено.','Saved state confirmed.'));
   }
   await onRefreshTask();
  }catch(e){
   if(seq===readSeq.current){
    setError(e);
    setNotice(dispatched?tr('Исход действия требует проверки. Обновите сведения, не повторяя команду.',
      'The outcome needs verification. Refresh before sending anything again.')
     :tr('Данные изменились. Обновите сведения и примите решение заново.',
       'The data changed. Refresh and decide again.'));
   }
  }finally{
   actionInFlight.current=false;
   if(seq===readSeq.current)setActing(false);
  }
 }
 if(!graphs.length&&!assistants.length)return <div className="advanced-form">
  <h3>{tr('Шаги и помощники','Steps and assistants')}</h3>
  <p>{tr('Связанных исполнений пока нет. Создайте последовательность шагов или поручите работу помощникам из принятого результата.',
    'No linked executions yet. Create a workflow or assign assistants from an accepted result.')}</p>
 </div>;
 const selectedGraph=focus?.kind==='graph';
 const k05Quality=record(fullResult?.quality_evaluation);
 const k05Available=str(k05Quality.contract)==='PA.K05.MEETING_SOURCE_EVALUATION/0.1.0';
 const modelMetrics=record(fullResult?.model_evaluation);
 const modelMetricsAvailable=str(modelMetrics.contract)==='PA.K05.MODEL_EXECUTION_OBSERVATION/0.1.0';
 const results=records(record(snapshot?.user_readback).results);
 const pendingModelAttempts=selectedGraph
  ?records(record(snapshot?.user_readback).pending_model_attempts):[];
 const modelOutcomeUnconfirmed=pendingModelAttempts.some(row=>
  str(row.reason)==='MODEL_OUTCOME_UNCONFIRMED'&&row.automatic_retry_allowed===false);
 const pendingAgentAttempts=selectedGraph
  ?records(record(snapshot?.user_readback).pending_agent_attempts):[];
 const agentOutcomeUnconfirmed=pendingAgentAttempts.some(row=>
  str(row.reason)==='AGENT_RUNTIME_OUTCOME_UNKNOWN'&&row.automatic_retry_allowed===false);
 const outputs=new Map(results.map(row=>[str(row.node_id),row]));
 const visualRows=graphView&&str(graphView.graph_digest)===str(snapshot?.graph_digest)
  ?savedDagRows(graphView):null;
 return <div className="advanced-form" aria-label={tr('Работа по задаче','Task execution')}>
  <h3>{tr('Шаги и помощники','Steps and assistants')}</h3>
  <p>{tr('Здесь можно просмотреть сохранённые шаги, проверить результат и управлять выполнением. Новое действие требует вашего решения.',
    'Review saved steps, verify outcomes and control execution here. Each new action requires your decision.')}</p>
  {graphs.map(row=><div className="owner-row" key={row.execution_id}>
   <strong>{tr('Процесс','Workflow')}</strong>
   <span>{tr('Выполнено шагов','Steps completed')}: {row.completed_node_count}/{row.node_count} · {stateName(row.state,tr)}</span>
   <div className="advanced-actions">
    <button type="button" disabled={!fresh||acting||loading} onClick={()=>void show({kind:'graph',id:row.execution_id,goalId:row.goal_id,graphId:row.graph_id})}>
     {tr('Показать шаги и управление','Show steps and controls')}</button>
    <button type="button" onClick={()=>onOpenGraph(row.execution_id)}>{tr('Изменить схему','Edit workflow')}</button>
   </div>
  </div>)}
  {links?.graph_history_limited&&<p>{tr('Показана последняя часть истории процессов.','Showing only recent workflow history.')}</p>}
  {assistants.map(row=><div className="owner-row" key={row.hosted_run_id}>
   <strong>{tr('Работа помощников','Assistant work')}</strong>
   <span>{row.final_state==='ACCEPTED'?tr('Результат принят','Result accepted'):stateName(row.state,tr)}</span>
   <div className="advanced-actions">
    <button type="button" disabled={!fresh||acting||loading||!['AWAITING_HUMAN_VERIFICATION','FINALIZED'].includes(row.state)}
     onClick={()=>void show({kind:'assistant',id:row.hosted_run_id,goalId:row.goal_id})}>
     {tr('Проверить результат здесь','Review result here')}</button>
    <button type="button" onClick={()=>onOpenAssistant(row.hosted_run_id)}>{tr('Открыть помощников','Open assistants')}</button>
   </div>
  </div>)}
  {focus&&<div className="advanced-form">
   <div className="advanced-head"><h3>{selectedGraph?tr('Исполнение шагов','Step execution'):tr('Проверка работы помощников','Assistant result review')}</h3>
    <div className="advanced-actions">
     <button type="button" disabled={loading||acting} onClick={()=>void refreshSelected()}>{tr('Обновить','Refresh')}</button>
     <button type="button" disabled={acting} onClick={close}>{tr('Свернуть','Collapse')}</button>
    </div>
   </div>
   {loading&&<p role="status">{tr('Читаю сохранённое состояние…','Reading saved state…')}</p>}
   {acting&&<p role="status">{tr('Проверяю решение и читаю новое состояние…','Checking the decision and reading the new state…')}</p>}
   {Boolean(error)&&<OwnerError error={error}/>}
   {notice&&<p role="status">{notice}</p>}
   {snapshot&&selectedGraph&&<>
    <p>{stateName(str(snapshot.execution_state),tr)}</p>
    {visualRows&&<GraphDagView title={tr('Связи и состояние шагов','Steps and dependencies')}
     steps={visualRows.map(x=>({node_id:str(x.node.node_id),node_type:str(x.node.node_type),depends_on:x.depends_on}))}
     statuses={records(snapshot.nodes)}/>}
    {graphViewError&&<p role="status">{graphViewError}</p>}
    {modelOutcomeUnconfirmed&&<p role="alert">{tr(
     'Ответ модели для одного из шагов не подтверждён. Запрос мог выполниться, но итог не сохранился. Автоматический повтор заблокирован. Проверьте сохранённые результаты и историю; новый запуск возможен только по отдельному решению.',
     'A model step has an unconfirmed outcome. The request may have run without a saved result. Automatic retry is blocked. Inspect saved results and history; any new execution needs a separate decision.'
    )} <small>MODEL_OUTCOME_UNCONFIRMED</small></p>}
    {agentOutcomeUnconfirmed&&<p role="alert">{tr(
     'Результат специализированного агента не подтверждён. Исполнитель мог выполнить операцию без сохранённого ответа. Автоматический повтор заблокирован. Проверьте сохранённые результаты и историю.',
     'The specialist agent outcome is unconfirmed. The operation may have happened without a saved reply. Automatic retry is blocked. Inspect saved results and history.'
    )} <small>AGENT_RUNTIME_OUTCOME_UNKNOWN</small></p>}
    {!graphResultVerified&&<p role="alert">{tr('Результат процесса не подтверждён. Выполнение и продолжение недоступны.','Workflow evidence could not be verified. Execution and resume are unavailable.')} <small>{str(record(snapshot.user_readback_error).code)||'GRAPH_RESULT_READBACK_UNAVAILABLE'}</small></p>}
    {records(snapshot.nodes).map((node,i)=>{
     const output=record(outputs.get(str(node.node_id))),kind=str(node.node_type);
     const modelEvidence=graphModelProvenance(output,tr);
     return <div className="owner-row" key={str(node.node_id)||i}>
      <strong>{tr('Шаг','Step')} {i+1} - {kind==='MODEL_INVOCATION'?tr('Работа модели','Model response'):kind==='AGENT_RUNTIME'?tr('Работа специализированного агента','Specialist agent work'):kind==='TOOL'?tr('Чтение источника','Source reading'):kind==='PARALLEL_FORK'?tr('Разветвление','Fork'):kind==='JOIN'?tr('Объединение','Join'):tr('Подготовка текста','Text preparation')}</strong>
      <small>{stateName(str(node.status),tr)}</small>
      {typeof output.text==='string'&&<p className="document-content">{str(output.text).slice(0,20000)}{output.truncated===true?'…':''}</p>}
      {modelEvidence&&<div className="owner-row" aria-label={tr('Выбор модели и расход','Model selection and usage')}>
       <small>{modelEvidence.selection}</small>
       {modelEvidence.actualModel&&<small>{tr('Фактическая модель','Observed model')}: {modelEvidence.actualModel}</small>}
       {modelEvidence.tokenUsage&&<small>{modelEvidence.tokenUsage}</small>}
       {modelEvidence.observedLatency&&<small>{modelEvidence.observedLatency}</small>}
       {modelEvidence.planRef&&<small>{modelEvidence.planRef}</small>}
      </div>}
      {kind==='AGENT_RUNTIME'&&str(output.runtime_id)&&
       <details><summary>{tr('Источник результата агента','Agent result source')}</summary>
        <small>{tr('Подключённый исполнитель','Connected runtime')}: {str(output.runtime_id)}</small>
        {str(output.operation_ref)&&<small>{tr('Подтверждённая операция','Recorded operation')}: {str(output.operation_ref)}</small>}
       </details>}
      {node.status==='PENDING'&&<small>{tr('Результат ещё не сохранён.','No saved result yet.')}</small>}
     </div>;
    })}
    {str(record(record(snapshot.user_readback).final_result).text)&&
     <div className="owner-row"><strong>{tr('Итог процесса','Workflow result')}</strong>
      <p className="document-content">{str(record(record(snapshot.user_readback).final_result).text).slice(0,20000)}</p></div>}
    {meetingReview&&<div className="advanced-form" aria-label={tr('Проверка цитат протокола','Meeting citation check')} role="status">
     <strong>{tr('Сверка поручений с протоколом','Meeting action attribution')}</strong>
     <p>{meetingReview.status==='PENDING'?tr('Итог процесса ещё не завершён.','Workflow output is not complete.')
      :meetingReview.status==='VERIFIED_QUOTES'?tr('Цитаты и позиции подтверждены. Смысл поручений и условия цели проверяет человек.','Quotes and offsets match. The user still reviews task meaning and the goal criterion.')
      :tr('Есть несоответствия в цитатах или сохранённых доказательствах. Проверьте источник перед решением.','Saved attribution has issues. Inspect the source before deciding.')}</p>
     {meetingReview.status!=='PENDING'&&<p>{tr('Поручений','Items')}: {meetingReview.items} · {tr('Цитат сверено','Quotes checked')}: {meetingReview.checked}</p>}
     {meetingReview.assignments&&meetingReview.assignments.length>0&&<div className="owner-rows" aria-label={tr('Предложенные поручения','Proposed assignments')}>
      {meetingReview.assignments.map((item,i)=><div className="owner-row" key={i}>
       <strong>{i+1}. {item.action}</strong>
       <span>{tr('Ответственный','Assignee')}: {item.assignee==='UNKNOWN'?tr('Не указан','Not specified'):item.assignee}</span>
       <span>{tr('Срок','Due date')}: {item.due_date==='UNKNOWN'?tr('Не указан','Not specified'):item.due_date}</span>
       <small>{tr('Основание в протоколе','Source excerpt')}: «{item.quote}»</small>
      </div>)}
     </div>}
     {meetingReview.issues.length>0&&<ul>{meetingReview.issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul>}
     {meetingReview.questions.length>0&&<><strong>{tr('Открытые вопросы','Open questions')}</strong>
      <ul>{meetingReview.questions.map((question,i)=><li key={i}>{question}</li>)}</ul></>}
    </div>}
    {fullResult&&modelMetricsAvailable&&<div className="owner-row" role="status">
     <strong>{tr('K05 · Измерения выполненной модели','K05 · Recorded model measurements')}</strong>
     <p>{tr('Качество и фактическая стоимость пока не оценены. Приведены только измерения из сохранённого результата.',
      'Quality and actual cost are not evaluated yet. Only recorded result measurements are shown.')}</p>
     {(typeof modelMetrics.observed_input_tokens==='number'||typeof modelMetrics.observed_output_tokens==='number')&&
      <small>{tr('Токены','Tokens')}: {typeof modelMetrics.observed_input_tokens==='number'?String(modelMetrics.observed_input_tokens):'—'} / {typeof modelMetrics.observed_output_tokens==='number'?String(modelMetrics.observed_output_tokens):'—'}</small>}
     {typeof modelMetrics.observed_latency_ms==='number'&&
      <small>{tr('Задержка вызова модели','Model invocation latency')}: {modelMetrics.observed_latency_ms} ms</small>}
     {str(modelMetrics.provenance_status)==='INCOMPLETE'&&
      <p role="alert">{tr('Ссылки на подтверждения K02/K04 неполные. Проверьте происхождение результата.',
       'K02/K04 receipt provenance is incomplete. Review result attribution.')}</p>}
     {str(modelMetrics.provenance_status)==='LINKED'&&
      <small>{tr('Планы K02/K04 связаны с сохранёнными квитанциями','K02/K04 plans are linked to saved receipts')}</small>}
    </div>}
    {fullResult&&goalStatus&&<div className="advanced-form">
     <h3>{tr('Проверка итогового результата','Final result review')}</h3>
     <p>{tr('Полный сохранённый результат. Его принятие относится только к выбранному критерию цели.',
       'Complete saved result. Acceptance applies only to the selected goal criterion.')}</p>
     <textarea className="document-content" readOnly rows={15} value={str(fullResult.text)} style={{width:'100%'}}/>
     {k05Available&&<div className="owner-row" role="status">
      <strong>{tr('Независимая сверка цитат K05','Independent K05 citation check')}</strong>
      <p>{k05Quality.passed===true
       ?tr('Цитаты сверены с сохранённым протоколом. Смысл поручений, полноту и факт выполнения проверяет человек.',
           'Quotes match the saved transcript. A person still reviews meaning, completeness and actual execution.')
       :tr('Сверка источника выявила несоответствие или недоступна. Проверьте протокол и итог перед решением.',
           'Source check found an issue or is unavailable. Review the transcript and result before deciding.')}</p>
      <small>{tr('Сверено цитат','Quotes checked')}: {str(k05Quality.source_quotes_checked)}</small>
      {Array.isArray(k05Quality.errors)&&k05Quality.errors.length>0&&
       <ul>{k05Quality.errors.map((issue,i)=><li key={i}>{str(issue)}</li>)}</ul>}
     </div>}
     <label className="advanced-field">{tr('Критерий цели','Goal criterion')}
      <select disabled={acting} value={criterionId} onChange={e=>{setCriterionId(e.target.value);setResultReviewed(false);}}>
       <option value="">{tr('Выберите критерий','Choose criterion')}</option>
       {records(goalStatus.criteria).map(row=><option key={str(record(row.criterion).criterion_id)}
        value={str(record(row.criterion).criterion_id)}>{str(record(row.criterion).description)}</option>)}
      </select>
     </label>
     {selectedCriterion&&<p>{tr('Сохранённое решение:','Saved decision:')} {str(selectedCriterion.status)}
      {selectedCriterion.evidence_integrity==='UNAVAILABLE'&&<span role="alert">{tr(' Основание недоступно.',' Evidence is unavailable.')}</span>}</p>}
     <label><input type="checkbox" checked={resultReviewed} disabled={!canAct||!criterionId}
      onChange={e=>setResultReviewed(e.target.checked)}/>
      {tr('Я прочитал полный сохранённый результат и проверил критерий.',
        'I read the complete saved result and reviewed the criterion.')}</label>
     <div className="advanced-actions">
      <button type="button" disabled={!canAct||!resultReviewed||!selectedCriterion} onClick={()=>void reviewGraph('PASS')}>{tr('Принять по критерию','Accept criterion')}</button>
      <button type="button" disabled={!canAct||!resultReviewed||!selectedCriterion} onClick={()=>void reviewGraph('FAIL')}>{tr('Отклонить по критерию','Reject criterion')}</button>
     </div>
    </div>}
    {records(snapshot.failures).length>0&&<p role="alert">{tr('Есть ошибки выполнения. Откройте процесс, чтобы изучить причины.',
       'Execution failures were saved. Open the workflow to inspect them.')}</p>}
    {requests.filter(q=>q.state==='AWAITING_HUMAN_REVIEW').map(q=><div key={str(q.command_digest)} className="owner-row">
     <strong>{tr('Ожидает решения','Decision needed')}: {str(q.action)==='PAUSE'?tr('Приостановить','Pause'):str(q.action)==='RESUME'?tr('Продолжить','Resume'):tr('Отменить','Cancel')}</strong>
     <div className="advanced-actions">
      <button disabled={!canAct||(str(q.action)==='RESUME'&&!graphResultVerified)} onClick={()=>void execute('decision','APPROVE',str(q.command_digest))}>{tr('Подтвердить','Approve')}</button>
      <button disabled={!canAct} onClick={()=>void execute('decision','REJECT',str(q.command_digest))}>{tr('Отклонить','Reject')}</button>
     </div>
    </div>)}
    {requests.some(q=>q.state==='STALE')&&<p role="status">{tr('Есть устаревший запрос управления. Подготовьте новый после обновления процесса.',
      'A previous control request is stale. Refresh the workflow before preparing another.')}</p>}
    <div className="advanced-actions">
     {['PAUSE','RESUME','CANCEL'].filter(op=>Array.isArray(snapshot.supported_controls)&&snapshot.supported_controls.includes(op)).map(op=>
      <button key={op} disabled={!canAct||(op==='RESUME'&&!graphResultVerified)} onClick={()=>void execute('request',op)}>
       {op==='PAUSE'?tr('Запросить паузу','Request pause'):op==='RESUME'?tr('Запросить продолжение','Request resume'):tr('Запросить отмену','Request cancel')}
      </button>)}
     {['READY','RUNNING'].includes(str(snapshot.execution_state))&&
      <button disabled={!canAct||!graphResultVerified||modelOutcomeUnconfirmed||agentOutcomeUnconfirmed} onClick={()=>void execute('advance')}>{tr('Выполнить следующие шаги','Run next steps')}</button>}
    </div>
   </>}
   {snapshot&&!selectedGraph&&<>
    <p>{finalized?tr('Ваше решение сохранено.','Your decision was recorded.'):stateName(str(snapshot.state),tr)}</p>
    <div className="owner-row"><strong>{tr('Предложенный результат','Proposed result')}</strong>
     <p className="document-content">{str(record(snapshot.synthesis).summary)||tr('Текст результата отсутствует.','No result summary available.')}</p></div>
    {snapshot.evidence_verified!==true&&<p role="alert">{tr('Основания не подтверждены. Принятие недоступно.',
      'Evidence is not verified. Approval is unavailable.')}</p>}
    {tickets.map((ticket,i)=>{
     const row=evidence.find(x=>str(x.ticket_id)===str(ticket.ticket_id));
     const acceptEnabled=!!row&&row.worker_output_truncated!==true&&!!str(row.worker_output).trim();
     return <div className="owner-row" key={str(ticket.ticket_id)}>
      <strong>{tr('Шаг','Step')} {i+1}</strong>
      {row?<><p className="document-content">{str(row.worker_output)}</p>
       {row.worker_output_truncated===true&&<p role="alert">{tr('Показана только часть текста. Шаг нельзя принять.','Only part of the text is available. This step cannot be accepted.')}</p>}
       <small>{str(row.reviewer_reason)}</small>
      </>:<p role="alert">{tr('Основания для этого шага отсутствуют.','Evidence for this step is missing.')}</p>}
      {!finalized&&<label className="advanced-field">{tr('Ваше решение','Your decision')}
       <select disabled={!canAct||snapshot.evidence_verified!==true} value={votes['ticket:'+str(ticket.ticket_id)]||''}
        onChange={e=>setVotes(v=>({...v,['ticket:'+str(ticket.ticket_id)]:e.target.value}))}>
        <option value="">{tr('Выберите решение','Choose decision')}</option>
        <option value="PASS" disabled={!acceptEnabled}>{tr('Принять шаг','Accept step')}</option>
        <option value="FAIL">{tr('Отклонить шаг','Reject step')}</option>
       </select>
      </label>}
     </div>;
    })}
    {criteria.map((criterion,i)=><label key={str(criterion.criterion_id)} className="advanced-field">
     {tr('Условие','Criterion')} {i+1}: {str(criterion.description)}
     {!finalized&&<select disabled={!canAct||snapshot.evidence_verified!==true}
      value={votes['criterion:'+str(criterion.criterion_id)]||''}
      onChange={e=>setVotes(v=>({...v,['criterion:'+str(criterion.criterion_id)]:e.target.value}))}>
      <option value="">{tr('Выберите решение','Choose decision')}</option>
      <option value="PASS">{tr('Выполнено','Met')}</option>
      <option value="FAIL">{tr('Не выполнено','Not met')}</option>
      <option value="UNKNOWN">{tr('Не подтверждено','Not verified')}</option>
     </select>}
    </label>)}
    {contradictory&&<p role="alert">{tr('Отклонённый шаг несовместим с принятием всех условий. Уточните решения.',
      'A rejected step is incompatible with accepting every criterion. Adjust your decisions.')}</p>}
    {finalized&&<p role="status">{record(snapshot.finalization).final_state==='ACCEPTED'
     ?tr('Результат принят.','Result accepted.'):tr('Результат полностью не принят.','Result was not fully accepted.')}</p>}
    {!finalized&&<button type="button" disabled={!canAct||!votesComplete} onClick={()=>void execute('finalize')}>
     {tr('Сохранить решения по результату','Save review decisions')}</button>}
   </>}
  </div>}
 </div>;
}
