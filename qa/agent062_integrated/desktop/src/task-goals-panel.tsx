import React,{useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {OwnerError,record,records,str,type Row} from './owner-ui';
import {useUiSettings} from './ui-preferences';
import {LocalTaskModelChoice,readLocalModelPin,type LocalModelPin} from './local-task-model-choice';
import {WorkTicketResult,workerReviewToken} from './work-ticket-result';
import {linkedGraphProofExecution} from './work-handoff';
import {meetingTranscriptFromTask,reviewMeetingTaskSummary,meetingFollowupGoalPlan,meetingHumanHandoffText} from './meeting-followup-review';

/** Human-directed Goal and WorkBoard operations inside the originating Task.
 * Python Core owns all durable state, evidence, workers and permissions. */
export type TaskGoalLink={goal_id:string;objective:string;contract_digest:string;complete:boolean};
export type TaskBoardLink={board_id:string;goal_id:string;board_digest:string;complete:boolean;counts?:Record<string,number>};
type Props={
 taskId:string;taskObjective:string;taskSummary?:string;taskDraftArtifacts?:string[];acceptedDigest?:string;fresh:boolean;
 reportTasks?:{id:string;title?:string;status?:string}[];
 onOpenReport?:(taskId:string)=>void;
 onRefreshReports?:()=>Promise<unknown>;
 links?:{goals?:TaskGoalLink[];work_boards?:TaskBoardLink[];
  graph_runs?:{execution_id:string;goal_id:string;graph_id:string;state:string}[]};
 onRefreshTask:()=>Promise<void>;
 onContinueGraph:(goalId:string,boardId:string|null)=>void;
 onOpenGraph:(executionId:string)=>void;
};
type Snapshots={source:Row;goal:Row|null;board:Row|null};
const WORKER='model-worker';
const NO_BOARD='__NONE__';
const lines=(text:string)=>text.split('\n').map(x=>x.trim()).filter(Boolean);
const ticketStatus=(value:string,tr:(ru:string,en:string)=>string)=>{
 switch(value){
  case 'TODO':return tr('Ожидает начала','Ready to start');
  case 'RUNNING':return tr('Назначен исполнителю','Assigned to worker');
  case 'VERIFY':return tr('Ожидает вашей проверки','Awaiting your review');
  case 'BLOCKED':return tr('Требует внимания','Needs attention');
  case 'DONE':return tr('Проверен и принят','Reviewed and accepted');
  default:return tr('Проверьте состояние','Check state');
 }
};
const criterionStatus=(value:string,tr:(ru:string,en:string)=>string)=>value==='PASS'
 ?tr('Подтверждён','Met'):value==='FAIL'?tr('Не выполнен','Not met'):tr('Ожидает проверки','Not yet verified');
export function TaskGoalsPanel({taskId,taskObjective,taskSummary='',taskDraftArtifacts,acceptedDigest,fresh,reportTasks=[],onOpenReport,onRefreshReports,links,onRefreshTask,onContinueGraph,onOpenGraph}:Props){
 const {tr}=useUiSettings();
 const relatedGoals=links?.goals||[],relatedBoards=links?.work_boards||[];
 const [goalChoice,setGoalChoice]=useState(''),[boardChoice,setBoardChoice]=useState('');
 // Do not silently choose the first of several unrelated Goals or Boards.
 const selectedGoal=relatedGoals.find(g=>g.goal_id===goalChoice)
  ||(goalChoice===''&&relatedGoals.length===1?relatedGoals[0]:undefined);
 const goalId=selectedGoal?.goal_id||'';
 const boardsForGoal=relatedBoards.filter(b=>b.goal_id===goalId);
 const selectedBoard=boardsForGoal.find(b=>b.board_id===boardChoice)
  ||(boardChoice===''&&boardsForGoal.length===1?boardsForGoal[0]:undefined);
 const boardId=selectedBoard?.board_id||'';
 const [goal,setGoal]=useState<Row|null>(null),[board,setBoard]=useState<Row|null>(null);
 const [loading,setLoading]=useState(false),[acting,setActing]=useState(false);
 const [error,setError]=useState<unknown>(null),[notice,setNotice]=useState('');
 const [createOpen,setCreateOpen]=useState(false),[objective,setObjective]=useState('');
 const [criteriaText,setCriteriaText]=useState(''),[stepsText,setStepsText]=useState('');
 const [humanHandoffText,setHumanHandoffText]=useState('');
 const [humanReportChoice,setHumanReportChoice]=useState<Record<string,string>>({});
 const [planMode,setPlanMode]=useState<'sequential'|'parallel'|'dependencies'>('sequential');
 const [dependencyText,setDependencyText]=useState('');
 const [criterionChoice,setCriterionChoice]=useState(''),[criterionDecision,setCriterionDecision]=useState<'PASS'|'FAIL'|'UNKNOWN'>('UNKNOWN');
 const [evidenceChoice,setEvidenceChoice]=useState('');
 const [stepModel,setStepModel]=useState<Record<string,LocalModelPin|null>>({});
 const [reviewedOutput,setReviewedOutput]=useState<Record<string,string>>({});
 const [acceptedInput,setAcceptedInput]=useState<{
  ticketId:string;boardId:string;stateDigest:string;rows:Row[];
 }|null>(null);
 const [inputReading,setInputReading]=useState(false);
 const [inputError,setInputError]=useState<{ticketId:string;message:string}|null>(null);
 const inputEpoch=useRef(0);
 const revision=useRef(0),inFlight=useRef(false),attempted=useRef(new Set<string>()),createAttempted=useRef(false);

 useEffect(()=>{
  revision.current+=1;setGoalChoice('');setBoardChoice('');setGoal(null);setBoard(null);
  setCreateOpen(false);setObjective(taskObjective.slice(0,500));setCriteriaText('');setStepsText('');setPlanMode('sequential');setDependencyText('');
  setCriterionChoice('');setCriterionDecision('UNKNOWN');setEvidenceChoice('');setStepModel({});
  setNotice('');setError(null);setReviewedOutput({});setHumanHandoffText('');setHumanReportChoice({});attempted.current.clear();createAttempted.current=false;
 },[taskId]);
 useEffect(()=>{
  inputEpoch.current+=1;setAcceptedInput(null);setInputReading(false);setInputError(null);
 },[taskId,goalId,boardId]);

 async function readBound(targetGoalId:string,targetBoardId:string):Promise<Snapshots>{
  const source=record(await runtime.query<Row>('task',{task_id:taskId}));
  if(str(source.task_id)!==taskId||source.status!=='closed'||!acceptedDigest
   ||source.accepted_artifact_digest!==acceptedDigest)throw Error('task_goal_source_changed');
  if(!targetGoalId)return {source,goal:null,board:null};
  const sourceLinks=record(source.readback);
  const goalLink=records(sourceLinks.goals).find(x=>str(x.goal_id)===targetGoalId);
  if(!goalLink||!str(goalLink.contract_digest))throw Error('task_goal_binding_unavailable');
  const goalStatus=record(await runtime.query<Row>('goal_status',{goal_id:targetGoalId}));
  const goalContract=record(goalStatus.goal),origin=record(goalStatus.source_task);
  if(str(goalContract.goal_id)!==targetGoalId
   ||str(goalContract.contract_digest)!==str(goalLink.contract_digest)
   ||str(record(goalContract.source_task_ref).ref_id)!==taskId
   ||str(origin.task_id)!==taskId||origin.binding_state!=='BOUND'
   ||origin.human_accepted!==true||origin.accepted_artifact_digest!==acceptedDigest)
   throw Error('task_goal_binding_changed');
  if(!targetBoardId)return {source,goal:goalStatus,board:null};
  const boardLink=records(sourceLinks.work_boards).find(x=>str(x.board_id)===targetBoardId
   &&str(x.goal_id)===targetGoalId);
  if(!boardLink||!str(boardLink.board_digest))throw Error('task_board_binding_unavailable');
  const boardStatus=record(await runtime.query<Row>('work_board_status',{board_id:targetBoardId}));
  const contract=record(boardStatus.board),sourceGoal=record(contract.goal_ref),summary=record(boardStatus.goal_summary);
  const boundGoalBoards=records(goalStatus.linked_boards);
  if(str(contract.board_id)!==targetBoardId||str(contract.board_digest)!==str(boardLink.board_digest)
   ||str(sourceGoal.ref_id)!==targetGoalId||str(sourceGoal.digest_sha256)!==str(goalContract.contract_digest)
   ||str(summary.goal_id)!==targetGoalId||str(summary.contract_digest)!==str(goalContract.contract_digest)
   ||!boundGoalBoards.some(x=>str(x.board_id)===targetBoardId&&str(x.board_digest)===str(contract.board_digest))
   ||record(boardStatus.source_task).binding_state!=='BOUND'
   ||str(record(boardStatus.source_task).task_id)!==taskId
   ||record(boardStatus.source_task).human_accepted!==true
   ||record(boardStatus.source_task).accepted_artifact_digest!==acceptedDigest)
   throw Error('task_board_binding_changed');
  return {source,goal:goalStatus,board:boardStatus};
 }
 async function refreshView(){
  const seq=++revision.current;
  setLoading(true);setError(null);
  try{
   const result=await readBound(goalId,boardId);
   if(seq!==revision.current)return;
   setGoal(result.goal);setBoard(result.board);
  }catch(e){
   if(seq===revision.current){setError(e);setGoal(null);setBoard(null);}
  }finally{if(seq===revision.current)setLoading(false);}
 }
 useEffect(()=>{
  const seq=++revision.current;
  if(!fresh||!acceptedDigest||!goalId){setGoal(null);setBoard(null);setLoading(false);return;}
  setLoading(true);setError(null);
  void readBound(goalId,boardId).then(out=>{
   if(seq===revision.current){setGoal(out.goal);setBoard(out.board);}
  }).catch(e=>{
   if(seq===revision.current){setError(e);setGoal(null);setBoard(null);}
  }).finally(()=>{if(seq===revision.current)setLoading(false);});
  return()=>{revision.current+=1;};
 },[taskId,acceptedDigest,fresh,goalId,boardId,links]);

 const criteria=records(goal?.criteria),tickets=records(board?.tickets);
 const evidence=records(goal?.verified_board_evidence);
 const ticketStates=new Map(tickets.map(row=>[str(record(row.ticket).ticket_id),record(row.state)]));
 const readyTickets=tickets.filter(row=>{
  const ticket=record(row.ticket),state=record(row.state);
  return state.status==='TODO'&&Array.isArray(ticket.depends_on)
   &&ticket.depends_on.every(dep=>record(ticketStates.get(str(dep))).status==='DONE');
 });
 const readyTicketIds=new Set(readyTickets.map(row=>str(record(row.ticket).ticket_id)));
 // The clock is only a UI cue. Core checks lease expiry and recovers a claim
 // only on an explicit user action; viewing the board never restarts a worker.
 const nextLeaseExpiry=Math.min(Infinity,...tickets.flatMap(row=>{
  const state=record(row.state);
  const expires=Date.parse(str(state.claim_expires_at));
  return state.status==='RUNNING'&&row.lease_expired!==true&&Number.isFinite(expires)?[expires]:[];
 }));
 const lastLeaseRefresh=useRef('');
 useEffect(()=>{
  if(!boardId||!fresh||!acceptedDigest||loading||acting||!Number.isFinite(nextLeaseExpiry))return;
  const key=boardId+':'+nextLeaseExpiry;
  if(lastLeaseRefresh.current===key)return;
  const delay=Math.max(200,Math.min(2147483000,nextLeaseExpiry-Date.now()+250));
  const timeout=window.setTimeout(()=>{
   lastLeaseRefresh.current=key;
   if(!inFlight.current)void refreshView();
  },delay);
  return()=>window.clearTimeout(timeout);
 },[boardId,taskId,fresh,acceptedDigest,loading,acting,nextLeaseExpiry]);
 async function inspectAcceptedInputs(ticketId:string){
  if(!goalId||!boardId||!fresh||!acceptedDigest||inFlight.current||inputReading)return;
  const epoch=++inputEpoch.current;
  setInputReading(true);setInputError(null);setAcceptedInput(null);
  try{
   const before=await readBound(goalId,boardId);
   const selected=records(before.board?.tickets).find(
    row=>str(record(row.ticket).ticket_id)===ticketId);
   if(!selected)throw Error('task_input_ticket_missing');
   const predecessors=record(selected.ticket).depends_on;
   if(!Array.isArray(predecessors)||predecessors.length===0
      ||predecessors.some(x=>typeof x!=='string'))
    throw Error('task_input_dependencies_invalid');
   const packet=record(await runtime.query<Row>('work_board_context',{
    board_id:boardId,ticket_id:ticketId
   }));
   const accepted=packet.accepted_dependencies;
   if(packet.board_id!==boardId||packet.ticket_id!==ticketId
      ||!Array.isArray(packet.depends_on)||!Array.isArray(accepted)
      ||accepted.length!==predecessors.length
      ||packet.depends_on.some((id:unknown,i:number)=>id!==predecessors[i])
      ||accepted.some((part:unknown,i:number)=>{
       const row=record(part);
       return row.ticket_id!==predecessors[i]
        ||typeof row.output!=='string'||!row.output.trim()
        ||!(/^[a-f0-9]{64}$/.test(str(row.output_digest)))
        ||!(/^[a-f0-9]{64}$/.test(str(row.verification_digest)));
      }))throw Error('task_input_readback_invalid');
   const after=await readBound(goalId,boardId);
   const updated=records(after.board?.tickets).find(
    row=>str(record(row.ticket).ticket_id)===ticketId);
   if(!updated||str(record(updated.state).state_digest)!==
      str(record(selected.state).state_digest))
    throw Error('task_input_changed_during_readback');
   if(epoch===inputEpoch.current)setAcceptedInput({
    ticketId,boardId,stateDigest:str(record(updated.state).state_digest),
    rows:accepted.map((x:unknown)=>record(x))
   });
  }catch{
   if(epoch===inputEpoch.current)setInputError({ticketId,message:tr(
    'Не удалось подтвердить материалы предыдущих шагов. Проверьте их принятие, сохранённые ответы и квитанции.',
    'Previous-step materials could not be verified. Check their acceptance, saved answers and receipts.'
   )});
  }finally{
   if(epoch===inputEpoch.current)setInputReading(false);
  }
 }
 const currentCriterion=criteria.find(x=>str(record(x.criterion).criterion_id)===criterionChoice);
 const currentEvidence=evidence.find(x=>str(x.verification_id)===evidenceChoice);
 const canChange=!!acceptedDigest&&fresh&&!loading&&!acting&&!error&&!inFlight.current;
 const goaltitle=str(record(goal?.goal).objective);
 const createCriteria=lines(criteriaText),createSteps=lines(stepsText);
 const hasMeetingStarter=Boolean(meetingTranscriptFromTask(taskObjective)?.trim());
 const savedMeetingReview=reviewMeetingTaskSummary(taskObjective,taskSummary,taskDraftArtifacts);
 const meetingPlan=savedMeetingReview?meetingFollowupGoalPlan(savedMeetingReview,taskObjective.startsWith('Разбери протокол')?'ru':'en'):null;
 const goalSteps=records(record(goal?.goal).plan_steps);
 // A user may clarify/edit a meeting Goal's steps before work begins. Since
 // this Goal is already bound by readBound to the accepted meeting source
 // Task, its title/step text must not disable the human-report route.
 const humanMeetingGoal=meetingPlan!==null&&!!goalId&&!!goal;
 // Only an untouched generated plan receives the parallel default.
 const meetingAssignmentGoal=humanMeetingGoal&&goaltitle===meetingPlan.objective
  &&goalSteps.length===meetingPlan.steps.length
  &&meetingPlan.steps.every((step,i)=>str(goalSteps[i]?.description)===step);
 useEffect(()=>{
  // Human meeting assignments are independent unless the user chooses dependencies.
  if(meetingAssignmentGoal&&boardsForGoal.length===0)setPlanMode('parallel');
 },[meetingAssignmentGoal,goalId]);

 async function createGoal(preset?:{objective:string;criteria:string[];steps:string[];continueToGraph:boolean}){
  const objectiveToSave=preset?.objective.trim()??objective.trim();
  const criteriaToSave=preset?.criteria??createCriteria;
  const stepsToSave=preset?.steps??createSteps;
  if(!canChange||createAttempted.current||!objectiveToSave||!criteriaToSave.length||!stepsToSave.length
   ||(preset&&relatedGoals.length>0))return;
  if(!window.confirm(tr('Сохранить эту цель, её критерии и шаги как продолжение принятой задачи?',
    'Save this goal, its criteria and steps as follow-up work for the accepted Task?')))return;
  createAttempted.current=true;inFlight.current=true;setActing(true);setError(null);setNotice('');
  let dispatched=false;
  try{
   const source=await readBound('','');
   // The direct meeting path must not create another Goal after a stale UI read.
   if(preset&&records(record(source.source.readback).goals).length>0)throw Error('task_goal_already_linked');
   await runtime.refreshRevision();dispatched=true;
   const result=record(await runtime.command<Row>('goal_create',{
    objective:objectiveToSave,acceptance_criteria:criteriaToSave,plan_steps:stepsToSave,source_task_id:taskId,
   }));
   const newGoalId=str(result.goal_id);
   if(!/^GOAL-[A-Za-z0-9_-]+$/.test(newGoalId))throw Error('task_goal_create_identity_unconfirmed');
   const verified=await readBound(newGoalId,'');
   if(str(record(verified.goal?.goal).contract_digest)!==str(result.contract_digest))
    throw Error('task_goal_create_readback_unverified');
   await onRefreshTask();
   setGoalChoice(newGoalId);setBoardChoice('');setGoal(verified.goal);setBoard(null);
   setCreateOpen(false);setCriteriaText('');setStepsText('');setObjective(taskObjective.slice(0,500));
   setNotice(tr('Цель сохранена со связью с исходной задачей. Теперь можно создать план шагов.',
    'Goal saved with its source Task. You can now create the step plan.'));
   createAttempted.current=false;
   if(preset?.continueToGraph)onContinueGraph(newGoalId,null);
  }catch(e){
   setError(e);setNotice(dispatched?tr('Создание цели могло завершиться. Обновите задачу и проверьте существующие цели перед новой попыткой.',
    'The goal may have been saved. Refresh the Task and review existing goals before trying again.'):
    tr('Не удалось подтвердить исходные данные. Новая цель не отправлена.','Source data could not be verified. No goal was submitted.'));
  }finally{inFlight.current=false;setActing(false);}
 }

 async function changeHumanTicket(ticketId:string,decision?:'PASS'|'FAIL'){
  const reportId=humanReportChoice[ticketId];
  if(!canChange||inFlight.current||!humanMeetingGoal||!boardId||!goalId)return;
  const row=tickets.find(x=>str(record(x.ticket).ticket_id)===ticketId),state=record(row?.state);
  const human=record(row?.human_report);
  const reviewToken=boardId+':'+ticketId+':'+str(state.state_digest)+':'+str(human.accepted_artifact_digest);
  if(!decision&&!(state.status==='TODO'&&readyTicketIds.has(ticketId)
    ||state.status==='RUNNING'&&row?.human_report_claim===true)
    ||!decision&&!reportTasks.some(t=>t.id===reportId&&t.id!==taskId&&t.status==='completed'))return;
  if(decision&&(state.status!=='VERIFY'||human.verified!==true||!str(human.task_id)
    ||(decision==='PASS'&&reviewedOutput[ticketId]!==reviewToken)))return;
  const message=!decision
    ?tr('Приложить принятый отчёт к поручению? После этого потребуется отдельное решение о выполнении.',
      'Attach this accepted report? Completion will still require a separate decision.')
    :decision==='PASS'
      ?tr('Вы проверили выполнение поручения по отчёту?','Have you verified this assignment against the report?')
      :tr('Вернуть поручение на доработку?','Return this assignment for revision?');
  if(!window.confirm(message))return;
  inFlight.current=true;setActing(true);setError(null);setNotice('');
  let dispatched=false;
  try{
   const before=await readBound(goalId,boardId);
   const live=records(before.board?.tickets).find(x=>str(record(x.ticket).ticket_id)===ticketId);
   if(!live||str(record(live.state).state_digest)!==str(state.state_digest))
    throw Error('human_ticket_state_changed');
   await runtime.refreshRevision();dispatched=true;
   const name=decision?'work_board_verify':'work_board_submit_human';
   const args:Row=decision
     ?{board_id:boardId,ticket_id:ticketId,decision,verifier_mode:'human'}
     :{board_id:boardId,ticket_id:ticketId,report_task_id:reportId};
   await runtime.command<Row>(name,args,{kind:'work_board',id:boardId});
   const after=await readBound(goalId,boardId);
   const updated=records(after.board?.tickets).find(x=>str(record(x.ticket).ticket_id)===ticketId);
   const status=str(record(updated?.state).status);
   if(status!==(decision?(decision==='PASS'?'DONE':'TODO'):'VERIFY')
     ||(!decision&&(record(updated?.human_report).verified!==true
       ||str(record(updated?.human_report).task_id)!==reportId)))
    throw Error('human_ticket_readback_unverified');
   setGoal(after.goal);setBoard(after.board);
   setNotice(!decision
     ?tr('Отчёт приложен. Проверьте его и отдельно подтвердите выполнение.',
       'Report attached. Review it and confirm completion separately.')
     :tr('Решение сохранено и проверено.','Decision saved and verified.'));
   await onRefreshTask();
  }catch(e){
   setError(e);
   setNotice(dispatched?tr('Действие могло сохраниться. Обновите план перед повтором.',
       'The action may have been saved. Refresh the board before retrying.')
     :tr('Состояние изменилось до записи. Обновите план.','State changed before submission. Refresh the board.'));
   try{const after=await readBound(goalId,boardId);setGoal(after.goal);setBoard(after.board);}catch{setBoard(null);}
  }finally{inFlight.current=false;setActing(false);}
 }
 type Action='create-board'|'claim'|'run'|'recover'|'verify-pass'|'verify-fail'|'retry'|'proof';
 async function act(action:Action,ticketId=''){
  if(!canChange||!goal||!goalId||inFlight.current)return;
  if(action!=='create-board'&&action!=='proof'&&(!board||!boardId))return;
  const displayedState=record(ticketStates.get(ticketId));
  const displayedRow=tickets.find(row=>str(record(row.ticket).ticket_id)===ticketId);
  const displayedExpired=displayedRow?.lease_expired===true;
  const claimed=action==='claim';
  const running=action==='run';
  const recovering=action==='recover';
  const verifying=action==='verify-pass'||action==='verify-fail';
  const retrying=action==='retry';
  if(claimed&&(!readyTicketIds.has(ticketId)||displayedState.status!=='TODO')&&!displayedExpired)return;
  if(running&&(displayedState.status!=='RUNNING'||displayedExpired||!str(displayedState.claim_token)))return;
  if(recovering&&(displayedState.status!=='RUNNING'||!displayedExpired||!str(displayedState.claim_token)))return;
  if(verifying&&(displayedState.status!=='VERIFY'||!records(displayedState.evidence_refs).length))return;
  if(retrying&&displayedState.status!=='BLOCKED')return;
  if(action==='create-board'&&records(goal.linked_boards).length>0)return;
  if(action==='proof'&&(!currentCriterion||(criterionDecision!=='UNKNOWN'&&!currentEvidence)))return;
  if(action==='proof'&&currentEvidence&&(!record(currentEvidence.evidence_ref).ref_id
      ||!record(currentEvidence.evidence_ref).digest_sha256))return;
  const actionKey=[action,goalId,boardId,ticketId,str(displayedState.state_digest),
   str(record(currentCriterion?.proof).proof_digest)].join(':');
  if(attempted.current.has(actionKey))return;
  const confirmation=action==='create-board'
   ?tr('Создать последовательный план из сохранённых шагов этой цели?','Create a sequential plan from the saved goal steps?')
   :claimed?tr('Назначить следующий доступный шаг локальному исполнителю?','Assign the next available step to the configured worker?')
   :running?tr('Запустить модель для этого шага? Ответ потребуется проверить отдельно.','Run the selected model for this step? Its answer will require separate review.')
   :recovering?tr('Проверить сохранённый ответ этого шага и восстановить его без нового вызова модели? Если квитанции нет, состояние не изменится.',
     'Check this step for an already saved answer and restore it without another model call? If no receipt exists, nothing changes.')
   :verifying?tr(action==='verify-pass'?'Принять результат этого шага?':'Вернуть этот шаг на доработку?',
    action==='verify-pass'?'Accept the result of this step?':'Return this step for revision?')
   :retrying?tr('После устранения причины вернуть заблокированный шаг в ожидание?',
    'Return the blocked step to the queue after checking the cause?')
   :tr('Сохранить ваше решение по критерию с выбранными основаниями?',
    'Save your decision on this criterion with the selected evidence?');
  if(!window.confirm(confirmation))return;
  inFlight.current=true;setActing(true);setError(null);setNotice('');
  let dispatched=false;
  try{
   const before=await readBound(goalId,boardId);
   if(str(record(before.goal?.goal).contract_digest)!==str(record(goal.goal).contract_digest))
    throw Error('task_goal_state_changed');
   const beforeBoard=record(before.board?.board);
   if(boardId&&str(beforeBoard.board_digest)!==str(record(board?.board).board_digest))
    throw Error('task_board_state_changed');
   let command='',input:Row={},target:{kind:string;id:string};
   if(action==='create-board'){
    if(records(before.goal?.linked_boards).length)throw Error('task_board_already_exists');
    const dependencyMap:Record<string,string[]>={};
    if(planMode==='dependencies'){
     const steps=records(record(goal.goal).plan_steps);const known=new Set(steps.map(x=>str(x.step_id)));
     for(const line of lines(dependencyText)){
      const matched=/^(S[0-9]+)\s*:\s*(.*)$/.exec(line);
      if(!matched||!known.has(matched[1])||dependencyMap[matched[1]])throw Error('task_plan_dependency_invalid');
      const parents=matched[2].trim()?matched[2].split(',').map(x=>x.trim()):[];
      if(parents.some(x=>!known.has(x)||x===matched[1])||new Set(parents).size!==parents.length)throw Error('task_plan_dependency_invalid');
      dependencyMap[matched[1]]=parents;
     }
    }
    command='work_board_create';input={goal_id:goalId,sequential:planMode==='sequential',max_parallel:planMode==='sequential'?1:4,
     ...(planMode==='dependencies'?{dependency_map:dependencyMap}:{})};
    target={kind:'goal',id:goalId};
   }else if(action==='proof'){
    const current=records(before.goal?.criteria).find(x=>str(record(x.criterion).criterion_id)===criterionChoice);
    if(!current||str(record(current.proof).proof_digest)!==str(record(currentCriterion?.proof).proof_digest))
     throw Error('task_criterion_changed');
    const picked=records(before.goal?.verified_board_evidence).find(x=>str(x.verification_id)===evidenceChoice);
    if(criterionDecision!=='UNKNOWN'&&(!picked||str(picked.verification_digest)!==str(currentEvidence?.verification_digest)))
     throw Error('task_proof_evidence_changed');
    command='goal_proof';input={goal_id:goalId,criterion_id:criterionChoice,
     status:criterionDecision,evidence_refs:picked?[picked.evidence_ref]:[],
     verifier_mode:criterionDecision==='UNKNOWN'?'system':'human'};
    target={kind:'goal',id:goalId};
   }else{
    const liveTicket=records(before.board?.tickets).find(x=>str(record(x.ticket).ticket_id)===ticketId);
    const live=record(liveTicket?.state);
    if(!liveTicket||str(live.state_digest)!==str(displayedState.state_digest))
     throw Error('task_ticket_state_changed');
    target={kind:'work_board',id:boardId};
    if(claimed){
     const recoveredAssignment=liveTicket?.lease_expired===true;
     const states=new Map(records(before.board?.tickets).map(x=>[str(record(x.ticket).ticket_id),record(x.state)]));
     const ready=records(before.board?.tickets).filter(row=>{
      const t=record(row.ticket),s=record(row.state);
      return (s.status==='TODO'||row.lease_expired===true)&&Array.isArray(t.depends_on)&&t.depends_on.every(d=>record(states.get(str(d))).status==='DONE');
     });
     if(!ready.some(row=>str(record(row.ticket).ticket_id)===ticketId)
       ||(live.status!=='TODO'&&!recoveredAssignment))
      throw Error('task_next_ticket_changed');
     // Preserve the former model pin on reassignment unless the person has
     // chosen another model or explicitly cleared the pin.
     const chosenModel=Object.prototype.hasOwnProperty.call(stepModel,ticketId)
      ?stepModel[ticketId]:recoveredAssignment?readLocalModelPin(live.local_model):null;
     command='work_board_claim';input={board_id:boardId,ticket_id:ticketId,worker_id:WORKER,limit:1,
      ...(chosenModel?{local_model:chosenModel}:{})};
    }else if(running){
     if(live.status!=='RUNNING'||liveTicket.lease_expired===true||!str(live.claim_token))throw Error('task_ticket_claim_unavailable');
     command='work_board_run_worker';
     input={board_id:boardId,ticket_id:ticketId,claim_token:str(live.claim_token),worker_id:WORKER};
    }else if(recovering){
     if(live.status!=='RUNNING'||liveTicket.lease_expired!==true||!str(live.claim_token))
      throw Error('task_ticket_recovery_unavailable');
     command='work_board_recover_worker';
     input={board_id:boardId,ticket_id:ticketId,claim_token:str(live.claim_token)};
    }else if(verifying){
     if(live.status!=='VERIFY'||!records(live.evidence_refs).length)throw Error('task_ticket_review_unavailable');
     const worker=record(liveTicket.worker_result);
     const reviewToken=workerReviewToken(boardId,ticketId,str(live.state_digest),worker);
     if(action==='verify-pass'&&(!reviewToken||reviewedOutput[ticketId]!==reviewToken))
      throw Error('task_ticket_full_result_required');
     command='work_board_verify';input={board_id:boardId,ticket_id:ticketId,
      decision:action==='verify-pass'?'PASS':'FAIL',verifier_mode:'human'};
    }else if(retrying){
     if(live.status!=='BLOCKED')throw Error('task_ticket_not_blocked');
     command='work_board_retry_blocked';input={board_id:boardId,ticket_id:ticketId};
    }else throw Error('task_action_not_supported');
   }
   attempted.current.add(actionKey);
   await runtime.refreshRevision();dispatched=true;
   const result=record(await runtime.command<Row>(command,input,target));
   const nextId=action==='create-board'?str(result.board_id):boardId;
   const after=await readBound(goalId,nextId);
   if(action==='create-board'){
    if(!/^BOARD-[A-Za-z0-9_-]+$/.test(nextId)
      ||str(record(after.board?.board).board_digest)!==str(result.board_digest))
     throw Error('task_board_create_readback_unverified');
    setBoardChoice(nextId);
   }else if(action==='proof'){
    const latest=records(after.goal?.criteria).find(x=>str(record(x.criterion).criterion_id)===criterionChoice);
    if(str(record(latest?.proof).proof_id)!==str(result.proof_id)
       ||latest?.status!==criterionDecision)throw Error('task_goal_proof_readback_unverified');
    setEvidenceChoice('');setCriterionDecision('UNKNOWN');
   }else{
    const updated=records(after.board?.tickets).find(x=>str(record(x.ticket).ticket_id)===ticketId);
    const updatedState=record(updated?.state),status=str(updatedState.status);
    const wanted=claimed?'RUNNING':(running||recovering)?'VERIFY':verifying?(action==='verify-pass'?'DONE':'TODO'):'TODO';
    if(status!==wanted||str(updatedState.state_digest)===str(displayedState.state_digest))
     throw Error('task_ticket_readback_unverified');
    if(claimed){
     const expected=Object.prototype.hasOwnProperty.call(stepModel,ticketId)
      ?stepModel[ticketId]:(displayedExpired?readLocalModelPin(displayedState.local_model):null);
     const persisted=readLocalModelPin(updatedState.local_model);
     if(!records(result.claimed).some(x=>str(x.ticket_id)===ticketId
       &&str(x.state_digest)===str(updatedState.state_digest))
       ||(expected?persisted?.name!==expected.name||persisted?.digest!==expected.digest:persisted!==null))
      throw Error('task_ticket_claim_readback_unverified');
    }
    if((running||recovering)&&(
       str(record(result.ticket_state).state_digest)!==str(updatedState.state_digest)
       ||(recovering&&result.recovered_without_inference!==true)
       ||record(updated?.worker_result).integrity_verified!==true))
     throw Error('task_worker_result_readback_unverified');
    if(verifying&&(str(record(result.state).state_digest)!==str(updatedState.state_digest)
       ||str(record(result.verification).ticket_id)!==ticketId))
     throw Error('task_ticket_verification_readback_unverified');
   }
   setGoal(after.goal);setBoard(after.board);
   setAcceptedInput(null);setInputError(null);
   setNotice(action==='create-board'?tr('План сохранён. Выберите шаг для назначения исполнителю.',
      'Step plan saved. You can assign the next step.'):
    action==='proof'?tr('Решение по критерию записано и проверено.','Criterion decision recorded and verified.'):
    recovering?tr('Сохранённый ответ восстановлен без повторного запуска модели. Проверьте его перед принятием.',
      'The saved answer was restored without rerunning the model. Review it before acceptance.'):
    running?tr('Исполнитель подготовил результат. Теперь проверьте шаг.','Worker completed the step. Review the result next.'):
    tr('Изменение состояния сохранено и проверено.','State change saved and verified.'));
   await onRefreshTask();
  }catch(e){
   setError(e);
   setNotice(dispatched?tr('Действие могло выполниться. Обновите сохранённое состояние до следующего решения - повтор не отправлен.',
     'The action may have completed. Refresh saved state before taking another decision. Nothing was retried.'):
     tr('Состояние изменилось до выполнения. Обновите задачу и повторно проверьте условия.',
       'The state changed before execution. Refresh the Task and check the conditions again.'));
   try{
    const after=await readBound(goalId,boardId);
    setGoal(after.goal);setBoard(after.board);
   }catch{setGoal(null);setBoard(null);}
  }finally{inFlight.current=false;setActing(false);}
 }

 if(!fresh||!acceptedDigest)return <section className="advanced-form">
  <h3>{tr('Цели и шаги выполнения','Goals and work steps')}</h3>
  <p>{tr('Для продолжения работы нужен принятый результат задачи.','Accept the Task result before organizing follow-up work.')}</p>
 </section>;
 return <section className="advanced-form" aria-label={tr('Планирование и проверка задачи','Task planning and review')}>
  <div className="advanced-head"><div>
   <h3>{tr('Цели и шаги выполнения','Goals and work steps')}</h3>
   <p>{tr('Сохранённая цель объединяет критерии результата, шаги и ваши решения. Выполнение модели подтверждается отдельно.',
     'A saved goal connects criteria, work steps and human decisions. Model execution is confirmed separately.')}</p>
  </div><button type="button" disabled={loading||acting} onClick={()=>void refreshView()}>{tr('Обновить','Refresh')}</button></div>
  {Boolean(error)&&<OwnerError error={error}/>}
  {Boolean(error)&&String(error).includes('work_ticket_worker_already_running')&&
   <p role="status">{tr(
    'Этот шаг уже выполняется. Проверьте сохранённое состояние, прежде чем назначать повтор.',
    'This step is already running. Check its saved state before assigning another attempt.'
   )}</p>}
  {notice&&<p role="status">{notice}</p>}
  {loading&&<p role="status">{tr('Читаю сохранённое состояние…','Reading saved state…')}</p>}
  {acting&&<p role="status">{tr('Проверяю действие и его результат…','Checking the action and its outcome…')}</p>}
  {relatedGoals.length>0&&<label className="advanced-field">{tr('Цель этой задачи','Goal linked to this Task')}
   <select value={goalId} disabled={acting} onChange={e=>{setGoalChoice(e.target.value);setBoardChoice('');setCriterionChoice('');setEvidenceChoice('');}}>
    {(relatedGoals.length>1||!goalId)&&<option value="">{tr('Выберите цель','Choose a Goal')}</option>}
    {relatedGoals.map(g=><option key={g.goal_id} value={g.goal_id}>{g.objective.slice(0,130)}</option>)}
   </select>
  </label>}
  {relatedGoals.length===0&&<p>{tr('Связанной цели пока нет. Определите ожидаемый результат и признаки его достижения.',
    'No linked goal yet. Describe the expected outcome and its acceptance criteria.')}</p>}
  {relatedGoals.length===0&&meetingPlan&&!createOpen&&<button type="button" className="primary-button"
   disabled={!canChange||createAttempted.current}
   onClick={()=>void createGoal({...meetingPlan,continueToGraph:false})}>
   {tr('Создать план из поручений','Create plan from action items')}
  </button>}
  {relatedGoals.length===0&&hasMeetingStarter&&!createOpen&&<button type="button" className="primary-button"
   disabled={!canChange||createAttempted.current}
   onClick={()=>void createGoal({
    objective:tr('Получить проверяемые поручения по протоколу','Produce verifiable meeting action items'),
    criteria:[tr('Все предложенные поручения содержат точные цитаты, исполнителя и срок либо UNKNOWN, а неопределённости вынесены в вопросы.',
      'Every proposed action includes an exact quote, owner and due date or UNKNOWN; unresolved details appear as questions.')],
    steps:[tr('Извлечь поручения из протокола','Extract action items from the transcript'),
      tr('Проверить поручения по исходному тексту','Review actions against the original transcript')],
    continueToGraph:true,
   })}>{tr('Подготовить дополнительную проверку поручений','Prepare additional action review')}</button>}

  <button type="button" className="secondary-button" disabled={acting} onClick={()=>setCreateOpen(v=>!v)}>
   {createOpen?tr('Свернуть создание цели','Close goal draft'):tr('Создать цель из результата','Create goal from result')}</button>
  {createOpen&&<div className="advanced-form">
   <label className="advanced-field">{tr('Ожидаемый результат','Expected result')}
    <textarea rows={2} value={objective} maxLength={2000} disabled={acting} onChange={e=>setObjective(e.target.value)}/></label>
   <label className="advanced-field">{tr('Как проверить результат - по одному критерию в строке','Acceptance criteria - one per line')}
    <textarea rows={3} value={criteriaText} disabled={acting} onChange={e=>setCriteriaText(e.target.value)}/></label>
   <label className="advanced-field">{tr('Шаги работы - по одному в строке','Work steps - one per line')}
    <textarea rows={4} value={stepsText} disabled={acting} onChange={e=>setStepsText(e.target.value)}/></label>
   <button type="button" disabled={!canChange||createAttempted.current||!objective.trim()||!createCriteria.length||!createSteps.length}
    onClick={()=>void createGoal()}>{tr('Сохранить цель и шаги','Save goal and steps')}</button>
   {createAttempted.current&&<p role="alert">{tr('Исход сохранения пока нужно проверить по списку целей. Не создавайте дубликат.',
     'Check the saved goals before trying again to avoid duplicates.')}</p>}
  </div>}
  {goal&&<div className="advanced-form">
   <h3>{tr('Что должно получиться','Expected outcome')}</h3>
   <p>{goaltitle}</p>
   <p>{goal.complete===true?tr('Все критерии подтверждены.','All acceptance criteria have evidence.'):
    tr('Есть критерии, которые ещё не подтверждены.','Some criteria still need verification.')}</p>
   <div className="owner-rows">{criteria.map((c,i)=>{
    const proof=record(c.proof);
    const isGraphProof=records(proof.evidence_refs).some(ref=>str(ref.ref_id).startsWith('graph-final:'));
    const executionId=isGraphProof
     ?linkedGraphProofExecution(proof,c.evidence_integrity,goalId,links?.graph_runs):null;
    return <div className="owner-row" key={str(record(c.criterion).criterion_id)}>
     <strong>{i+1}. {str(record(c.criterion).description)}</strong>
     <small>{criterionStatus(str(c.status),tr)}</small>
     {isGraphProof?(c.evidence_integrity==='VERIFIED'
      ?<small>{tr('Основание Graph повторно проверено по сохранённому результату.',
       'Graph evidence was reverified against its saved result.')}</small>
      :<span role="alert">{tr('Сохранённое решение есть, но основание Graph сейчас недоступно. Критерий не подтверждён.',
       'The decision is saved, but its Graph evidence is unavailable. The criterion is not verified.')}</span>)
      :Boolean(c.proof)&&<span>{tr('Решение сохранено','Decision recorded')}</span>}
     {executionId&&<button type="button" className="secondary-button"
      disabled={!fresh||acting||loading} onClick={()=>onOpenGraph(executionId)}>
      {tr('Открыть подтверждённый Graph','Open verified Graph')}</button>}
     {isGraphProof&&<small>{tr(
      'Решение по критерию Goal не завершает автоматически шаги плана WorkBoard.',
      'A Goal criterion decision does not automatically complete WorkBoard tickets.'
     )}</small>}
    </div>;
   })}</div>
   {criteria.length>0&&<div className="advanced-form">
    <h3>{tr('Проверка достижения цели','Verify goal criteria')}</h3>
    <label className="advanced-field">{tr('Критерий','Criterion')}
     <select value={criterionChoice} disabled={acting} onChange={e=>setCriterionChoice(e.target.value)}>
      <option value="">{tr('Выберите критерий','Choose criterion')}</option>
      {criteria.map(c=><option key={str(record(c.criterion).criterion_id)} value={str(record(c.criterion).criterion_id)}>
       {str(record(c.criterion).description).slice(0,160)}</option>)}
     </select></label>
    <label className="advanced-field">{tr('Проверенный шаг как основание','Reviewed step as evidence')}
     <select value={evidenceChoice} disabled={acting} onChange={e=>setEvidenceChoice(e.target.value)}>
      <option value="">{tr('Не выбран','None selected')}</option>
      {evidence.map(e=><option key={str(e.verification_id)} value={str(e.verification_id)}>
       {str(e.ticket_description).slice(0,160)}</option>)}
     </select></label>
    <label className="advanced-field">{tr('Ваше решение','Your decision')}
     <select value={criterionDecision} disabled={acting} onChange={e=>setCriterionDecision(e.target.value as 'PASS'|'FAIL'|'UNKNOWN')}>
      <option value="UNKNOWN">{tr('Пока не подтверждено','Not yet verified')}</option>
      <option value="PASS">{tr('Выполнено','Met')}</option>
      <option value="FAIL">{tr('Не выполнено','Not met')}</option>
     </select></label>
    {criterionDecision!=='UNKNOWN'&&!currentEvidence&&<p>{tr('Для решения выберите ранее принятый шаг с сохранённым основанием.',
      'Choose an accepted step with saved evidence before recording a decision.')}</p>}
    <button type="button" disabled={!canChange||!currentCriterion||(criterionDecision!=='UNKNOWN'&&!currentEvidence)}
     onClick={()=>void act('proof')}>{tr('Сохранить решение по критерию','Save criterion decision')}</button>
   </div>}
  </div>}
  {goal&&<div className="advanced-form">
   <h3>{tr('Продолжить процесс','Continue workflow')}</h3>
   <p>{boardId
     ?tr('Новая цепочка будет связана с этой целью и выбранным планом. Запуск требует отдельного решения.',
       'The new graph will be linked to this Goal and WorkBoard. Execution needs separate approval.')
     :tr('Новая цепочка будет связана с этой целью. План можно создать отдельно.',
       'The new graph will be linked to this Goal. A WorkBoard can be created separately.')}</p>
   <button type="button" disabled={!canChange||!goalId
      ||str(record(goal.goal).goal_id)!==goalId
      ||(boardsForGoal.length>0&&boardChoice!==NO_BOARD
        &&(!boardId||str(record(board?.board).board_id)!==boardId))}
     onClick={()=>onContinueGraph(goalId,boardId||null)}>
    {tr('Создать цепочку для выбранной цели','Create workflow for selected Goal')}</button>
  </div>}
  {goal&&<div className="advanced-form">
   <h3>{tr('План выполнения','Execution plan')}</h3>
   {meetingAssignmentGoal&&<p role="status">{tr(
    'Поручения людям сохранены как план. WorkBoard в этой версии запускает модельные шаги: он не уведомляет названных исполнителей и не подтверждает фактическое выполнение их поручений.',
    'Human assignments are saved as a plan. This WorkBoard runs model-worker steps; it does not notify the named people or prove they completed the assignments.'
   )}</p>}
   {meetingAssignmentGoal&&savedMeetingReview?.assignments?.length?<div className="advanced-form"
     aria-label={tr('Поручения людям','Human assignments')}>
     <p>{tr('Подготовьте сообщение для каждого человека. Текст не отправлен; WorkBoard не подтверждает выполнение человеком.',
      'Prepare a message for each person. No message has been sent; WorkBoard does not verify a person’s completion.')}</p>
     <div className="advanced-actions">{savedMeetingReview.assignments.map((item,i)=><button type="button" key={i}
      onClick={()=>setHumanHandoffText(meetingHumanHandoffText(item,taskObjective.startsWith('Разбери протокол')?'ru':'en'))}>
      {tr('Подготовить поручение','Prepare assignment')} {i+1}{item.assignee==='UNKNOWN'?'':': '+item.assignee}
     </button>)}</div>
     {humanHandoffText&&<label className="advanced-field">{tr('Текст для ручной передачи (выделите и скопируйте)','Text for manual sharing (select and copy)')}
      <textarea readOnly rows={8} value={humanHandoffText} onFocus={e=>e.currentTarget.select()}/>
     </label>}
    </div>:null}
   
   {boardsForGoal.length>0&&<label className="advanced-field">{tr('Сохранённый план','Saved plan')}
    <select value={boardChoice===NO_BOARD?NO_BOARD:boardId} disabled={acting}
     onChange={e=>setBoardChoice(e.target.value)}>
     {(boardsForGoal.length>1||!boardId)&&<option value="">{tr('Выберите план','Choose a WorkBoard')}</option>}
     <option value={NO_BOARD}>{tr('Продолжить без плана','Continue without a WorkBoard')}</option>
     {boardsForGoal.map(b=><option key={b.board_id} value={b.board_id}>
      {b.complete?tr('План завершён','Completed plan'):tr('План в работе','Active plan')}</option>)}
    </select></label>}
   {boardsForGoal.length===0&&<p>{tr('Из шагов цели можно создать последовательный план. Существующая история не заменяется.',
     'Create a sequential plan from this goal. Existing history is preserved.')}</p>}
   {boardsForGoal.length===0&&<div className="advanced-form">
    <label className="advanced-field">{tr('Порядок выполнения','Execution order')}
     <select value={planMode} disabled={!canChange} onChange={e=>setPlanMode(e.target.value as typeof planMode)}>
      <option value="sequential">{tr('По очереди','Sequential')}</option>
      <option value="parallel">{tr('Независимые шаги','Independent steps')}</option>
      <option value="dependencies">{tr('Ветви и объединения','Branches and joins')}</option>
     </select></label>
    {planMode==='dependencies'&&<label className="advanced-field">{tr('Зависимости шагов, например S3: S1, S2','Step dependencies, e.g. S3: S1, S2')}
     <textarea value={dependencyText} disabled={!canChange} onChange={e=>setDependencyText(e.target.value)} rows={4}
      placeholder={'S3: S1, S2'} />
     <small>{tr('Для каждого шага укажите предшествующие шаги. Шаги без зависимостей могут выполняться независимо.','List predecessor steps. Steps without dependencies may run independently.')}</small>
    </label>}
   </div>}
   {boardsForGoal.length===0&&<button disabled={!canChange} onClick={()=>void act('create-board')}>
    {tr('Создать план шагов','Create step plan')}</button>}
   {board&&<div className="owner-rows">
    <p>{board.complete===true?tr('Все шаги плана проверены.','All plan steps were verified.'):
     tr('План выполняется по сохранённым зависимостям.','The plan follows its saved step dependencies.')}</p>
    {tickets.map((item,i)=>{
     const ticket=record(item.ticket),state=record(item.state),id=str(ticket.ticket_id);
     const worker=record(item.worker_result),output=typeof worker.output==='string'?worker.output:'';
      const human=record(item.human_report),humanClaim=item.human_report_claim===true;
      const humanReviewToken=boardId+':'+id+':'+str(state.state_digest)+':'+str(human.accepted_artifact_digest);
     const expired=item.lease_expired===true;
     const reviewToken=workerReviewToken(boardId,id,str(state.state_digest),worker);
     const isReady=readyTicketIds.has(id);
     const hasEvidence=records(state.evidence_refs).length>0;
     const predecessors=Array.isArray(ticket.depends_on)?ticket.depends_on.filter(
      (dep:unknown):dep is string=>typeof dep==='string'):[];
     const inspected=acceptedInput?.ticketId===id&&acceptedInput.boardId===boardId
      &&acceptedInput.stateDigest===str(state.state_digest)?acceptedInput:null;
     return <div className="owner-row" key={id}>
      <strong>{tr('Шаг','Step')} {i+1}. {str(ticket.description)}</strong>
      <small>{ticketStatus(str(state.status),tr)}</small>
      {predecessors.length>0&&<div className="advanced-form">
       <small>{tr('Зависит от принятых шагов','Depends on accepted steps')}:</small>
       {predecessors.map(dep=>{
        const original=tickets.find(row=>str(record(row.ticket).ticket_id)===dep);
        const step=record(original?.ticket),previous=record(original?.state);
        return <small key={dep}>{
         tr('Шаг','Step')+' '+(tickets.findIndex(row=>str(record(row.ticket).ticket_id)===dep)+1)
        }: {str(step.description)} - {previous.status==='DONE'
         ?tr('принят','accepted'):tr('ожидает проверки','awaiting review')}</small>;
       })}
       <div className="advanced-actions">
        <button type="button" disabled={inputReading||!fresh||!acceptedDigest||acting}
         onClick={()=>void inspectAcceptedInputs(id)}>{
         inputReading?tr('Проверяем материалы…','Checking materials…'):
         tr('Посмотреть принятые материалы','View accepted materials')
        }</button>
       </div>
       {inputError?.ticketId===id&&<p role="alert">{inputError.message}</p>}
       {inspected&&<div className="advanced-form">
        <p role="status">{tr(
         'Входные материалы сверены с принятыми результатами предыдущих шагов.',
         'Inputs match the accepted results of previous steps.'
        )}</p>
        {inspected.rows.map((source,i)=>{
         const content=str(source.output);
         return <div key={str(source.ticket_id)+'-'+i}>
          <strong>{tr('Принятый результат','Accepted result')} {i+1}</strong>
          <pre style={{whiteSpace:'pre-wrap',overflow:'auto',maxHeight:240}}>{
           content.slice(0,3500)
          }</pre>
          {content.length>3500&&<small>{tr(
           'Показан фрагмент. Полный результат сохранён у предыдущего шага.',
           'Excerpt shown. The full result is saved on the preceding step.'
          )}</small>}
         </div>;
        })}
       </div>}
      </div>}
      {state.status==='BLOCKED'&&<p role="alert">{tr('Исполнение было остановлено. Проверьте модель и причины отказа перед повтором.',
       'Execution stopped. Check the model and the failure reason before trying again.')}</p>}
      {readLocalModelPin(state.local_model)&&<small>{tr('Модель шага','Step model')}: {readLocalModelPin(state.local_model)?.name}
       {state.local_model_provider_id==='IWXA_BASIC_RUNTIME_V1'?' · IWXA LLM Engine':
        state.local_model_provider_id==='OLLAMA_LOCAL_V1'?' · Ollama':''}</small>}
      {state.status==='BLOCKED'&&str(state.block_reason).includes('work_ticket_local_provider_')&&
       <p role="alert">{tr('Выбранный источник модели изменился. Проверьте модель и назначьте шаг заново.',
         'The selected model provider changed. Review the model and reassign this step.')}</p>}
      {readLocalModelPin(worker.local_model)&&<small>{tr('Результат модели','Model used')}: {readLocalModelPin(worker.local_model)?.name}</small>}
      {expired&&!humanClaim&&<p role="status">{tr(
       'Срок назначения истёк. Сначала проверьте, сохранился ли ответ. Если его нет, назначьте шаг заново.',
       'This assignment expired. Check for a saved answer first. If none exists, reassign the step.'
      )}</p>}
      {state.status==='RUNNING'&&!expired&&!humanClaim&&str(state.claim_expires_at)&&<small>{tr('Назначение действует до','Assignment valid until')}: {new Date(str(state.claim_expires_at)).toLocaleString(tr('ru-RU','en-GB'))}</small>}
      
       {str(human.task_id)&&<div className="advanced-form">
        <strong>{tr('Принятый отчёт сотрудника','Accepted human report')}</strong>
        <p>{str(human.objective)}</p>
        {str(human.summary)&&<pre style={{whiteSpace:'pre-wrap',maxHeight:260,overflow:'auto'}}>{str(human.summary)}</pre>}
        {human.summary_truncated===true&&<small>{tr('Показан фрагмент отчёта. Откройте исходную задачу, чтобы прочитать полный результат.',
          'Only part of the report is shown. Open its Task to read the complete result.')}</small>}
        {onOpenReport&&/^TASK-[A-Za-z0-9_-]{1,80}$/.test(str(human.task_id))&&
         <button type="button" className="secondary-button"
          onClick={()=>onOpenReport(str(human.task_id))}>{tr('Открыть полный отчёт','Open full report')}</button>}
        {human.verified===true?<small>{tr('Принятый отчёт найден. Сопоставьте содержание с поручением.',
         'The accepted report was found. Check it against this assignment.')}</small>
         :<p role="alert">{tr('Основание отчёта не подтверждено.','Report evidence could not be verified.')}</p>}
        {state.status==='VERIFY'&&human.verified===true&&<label>
         <input type="checkbox" checked={reviewedOutput[id]===humanReviewToken} disabled={!canChange}
          onChange={e=>setReviewedOutput(old=>({...old,[id]:e.target.checked?humanReviewToken:''}))}/>
         {tr('Я проверил отчёт и его соответствие поручению','I checked the report against this assignment')}
        </label>}
        {state.status==='VERIFY'&&<div className="advanced-actions">
         <button type="button" disabled={!canChange||human.verified!==true||reviewedOutput[id]!==humanReviewToken}
          onClick={()=>void changeHumanTicket(id,'PASS')}>{tr('Подтвердить выполнение','Confirm completion')}</button>
         <button type="button" disabled={!canChange||human.verified!==true}
          onClick={()=>void changeHumanTicket(id,'FAIL')}>{tr('Вернуть на доработку','Request revision')}</button>
        </div>}
       </div>}
       {humanMeetingGoal&&((state.status==='TODO'&&isReady)
        ||(humanClaim&&state.status==='RUNNING'))&&<div className="advanced-form">
        <label className="advanced-field">{tr('Принятая задача-отчёт','Accepted report Task')}
         <select value={humanReportChoice[id]||''} disabled={!canChange}
          onChange={e=>setHumanReportChoice(old=>({...old,[id]:e.target.value}))}>
          <option value="">{tr('Выберите отчёт','Select a report')}</option>
          {reportTasks.filter(t=>t.id!==taskId&&t.status==='completed').map(t=>
           <option key={t.id} value={t.id}>{(t.title||t.id).slice(0,160)}</option>)}
         </select>
        </label>
        {onRefreshReports&&<button type="button" className="secondary-button" disabled={!canChange}
         onClick={()=>void onRefreshReports()}>{tr('Обновить список отчётов','Refresh report list')}</button>}
        <button type="button" disabled={!canChange||!reportTasks.some(t=>t.id===humanReportChoice[id]&&t.status==='completed')}
         onClick={()=>void changeHumanTicket(id)}>{tr('Приложить отчёт на проверку','Submit report for review')}</button>
       </div>}
       {output&&<WorkTicketResult key={reviewToken||id+':unverified'} worker={worker}
       reviewToken={reviewToken} reviewed={!!reviewToken&&reviewedOutput[id]===reviewToken}
       allowReview={state.status==='VERIFY'}
       onReview={checked=>setReviewedOutput(prev=>{
        const updated={...prev};
        if(checked&&reviewToken)updated[id]=reviewToken;else delete updated[id];
        return updated;
       })}/>}
      {((state.status==='TODO'&&isReady)||expired)&&!humanClaim&&<LocalTaskModelChoice
       value={Object.prototype.hasOwnProperty.call(stepModel,id)?stepModel[id]:(expired?readLocalModelPin(state.local_model):null)}
       onChange={value=>setStepModel(old=>({...old,[id]:value}))} disabled={!canChange}/>}
      <div className="advanced-actions">
       
        {state.status==='TODO'&&<button disabled={!canChange||!isReady} onClick={()=>void act('claim',id)}>
        {isReady?(humanMeetingGoal?tr('Назначить ИИ-исполнителя','Assign model worker'):tr('Назначить шаг','Assign step')):tr('Ожидает предыдущих шагов','Waiting for earlier steps')}</button>}
       {expired&&<>
        {!humanClaim&&<button disabled={!canChange||!str(state.claim_token)} onClick={()=>void act('recover',id)}>{
         tr('Восстановить сохранённый ответ','Recover saved answer')}</button>}
        {!humanClaim&&<button disabled={!canChange} onClick={()=>void act('claim',id)}>{tr('Назначить заново','Assign again')}</button>}
       </>}
       {state.status==='RUNNING'&&!expired&&!humanClaim&&<button disabled={!canChange||!str(state.claim_token)} onClick={()=>void act('run',id)}>
        {tr('Выполнить моделью','Run with model')}</button>}
       {state.status==='VERIFY'&&!str(human.task_id)&&<>
        <button disabled={!canChange||!hasEvidence||!reviewToken||reviewedOutput[id]!==reviewToken}
         onClick={()=>void act('verify-pass',id)}>{tr('Принять шаг','Accept step')}</button>
        <button disabled={!canChange||!hasEvidence} onClick={()=>void act('verify-fail',id)}>
         {tr('Вернуть на доработку','Request revision')}</button>
       </>}
       {state.status==='BLOCKED'&&<button disabled={!canChange} onClick={()=>void act('retry',id)}>
        {tr('Вернуть шаг в очередь','Return step to queue')}</button>}
      </div>
      {state.status==='VERIFY'&&!output&&!str(human.task_id)&&<p role="alert">{tr('Сохранённые основания доступны, но результат модели не прочитан. Принятие пока недоступно.',
       'Evidence exists, but the saved model output could not be read. Approval is unavailable.')}</p>}
     </div>;
    })}
   </div>}
  </div>}
 </section>;
}
