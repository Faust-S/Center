import {humanState} from './human-language';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {record,records,str,failure,OwnerDetails,useOwnerActions,type Row} from './owner-ui';
import {HelpTip,useUiSettings} from './ui-preferences';
import {isCompleteDecisionEvidence,presentEvidence} from './evidence-presentation';

const active=(a:Row)=>a.decision==='approve'&&a.active===true&&a.state==='APPROVED'&&(!a.expires_at||Date.parse(str(a.expires_at))>Date.now());
const expired=(v:unknown)=>{const time=Date.parse(str(v));return !Number.isFinite(time)||time<=Date.now()};
const fileWrite=(p:Row)=>p.tool_id==='files.write_text';
const planRef=(p:Row)=>str(p.plan_id);
const safePlan=(p:Row)=>/^TPLAN-[A-Za-z0-9-]+$/.test(str(p.plan_id))&&!!str(p.operation)&&!!str(p.target)&&p.arguments!==null&&typeof p.arguments==='object'&&!Array.isArray(p.arguments)&&!!str(p.tool_id);
const safeReceipt=(r:Row,id:string)=>str(record(r.plan_ref).ref_id)===id;
type AttentionTask={id:string;title?:string;status?:string};
export function ApprovalsControl({attentionTasks,tasksVerified,onOpenTask,onOpenRecovery,onOpenAutomations,onOpenMemory,readbackEpoch=0}:{
 attentionTasks:AttentionTask[];tasksVerified:boolean;onOpenTask:(id:string)=>void;
 onOpenRecovery:(caseId?:string)=>void;onOpenAutomations:()=>void;onOpenMemory:()=>void;readbackEpoch?:number;
}){
 const {tr}=useUiSettings();
 const [plans,setPlans]=useState<Row[]>([]),[approvals,setApprovals]=useState<Row[]>([]),[receipts,setReceipts]=useState<Row[]>([]),[states,setStates]=useState<Row>({});
 const [selected,setSelected]=useState(''),[confirmed,setConfirmed]=useState(false),[loaded,setLoaded]=useState(false),[error,setError]=useState('');
 const [lastResponse,setLastResponse]=useState<Row|null>(null);
 const [scheduledJobs,setScheduledJobs]=useState<Row[]>([]),[automationAvailable,setAutomationAvailable]=useState(false);
 const [repairCases,setRepairCases]=useState<Row[]>([]),[repairAvailable,setRepairAvailable]=useState(false);
 const [dueLocal,setDueLocal]=useState(''),[scheduleError,setScheduleError]=useState('');
 const [scheduleBusy,setScheduleBusy]=useState(false);
 const [readbackBusy,setReadbackBusy]=useState(false),[readbackNotice,setReadbackNotice]=useState('');
 const [recoveredCase,setRecoveredCase]=useState('');
 const [executionUncertain,setExecutionUncertain]=useState<{planId:string;reason:string}|null>(null);
 const selectionEpoch=useRef(0),selectedRef=useRef(selected);
 const loadEpoch=useRef(0),coreEpoch=useRef(readbackEpoch);
 selectedRef.current=selected;coreEpoch.current=readbackEpoch;
 const scheduleAttempts=useRef<Set<string>>(new Set());
 const attempted=useRef<Set<string>>(new Set());
 const load=useCallback(async()=>{
  const epoch=++loadEpoch.current;
  // Any refresh invalidates consent attached to the former snapshot.
  setLoaded(false);setConfirmed(false);
  const fetched=await Promise.allSettled([
   runtime.query<Row>('tool_plans',{limit:200}),
   runtime.query<Row>('tool_approvals',{limit:200}),
   runtime.query<Row>('tool_execution_receipts',{limit:200}),
   runtime.query<Row>('automation_jobs',{limit:500}),
   runtime.query<Row>('tool_repair_cases',{limit:100}),
  ]);
  if(epoch!==loadEpoch.current)return;
  // Automation is optional: its outage must not disable unrelated approvals.
  const faults=fetched.slice(0,3).flatMap((x,i)=>x.status==='rejected'?[(i===0?'tool_plans':i===1?'tool_approvals':'tool_execution_receipts')+': '+failure(x.reason)]:[]);
  if(faults.length){
   setPlans([]);setApprovals([]);setReceipts([]);setStates({});setLoaded(false);setError(faults.join(' · '));
   return;
  }
  const p=record(fetched[0].status==='fulfilled'?fetched[0].value:null),a=record(fetched[1].status==='fulfilled'?fetched[1].value:null),r=record(fetched[2].status==='fulfilled'?fetched[2].value:null);
  setPlans(records(p.plans));setStates(record(p.execution_by_plan));setApprovals(records(a.approvals));setReceipts(records(r.receipts));
  setScheduledJobs(fetched[3].status==='fulfilled'?records(record(fetched[3].value).jobs):[]);
  setAutomationAvailable(fetched[3].status==='fulfilled');
  setRepairCases(fetched[4].status==='fulfilled'?records(record(fetched[4].value).cases):[]);
  setRepairAvailable(fetched[4].status==='fulfilled');
  setError('');setLoaded(true);
 },[]);
 useEffect(()=>{
  setReadbackNotice('');setRecoveredCase('');setLastResponse(null);
  void load();
  return()=>{loadEpoch.current++;};
 },[load,readbackEpoch]);
 const {run,busy,message}=useOwnerActions(load);
 const chosen=plans.find(p=>planRef(p)===selected);
 const reviewTasks=tasksVerified?attentionTasks.filter(task=>task.status==='pending_review'):[];
 const stoppedTasks=tasksVerified?attentionTasks.filter(task=>task.status==='failed'):[];
 const openRepairs=repairCases.filter(item=>/^REPAIR-[A-Za-z0-9_-]+$/.test(str(item.case_id))&&
  ['OPEN_UNKNOWN','EVIDENCE_PENDING','REMAINS_UNKNOWN'].includes(str(item.contract_state)));
 // Keep exact plan arguments in Core. This is a display-only, bounded and
 // sanitized projection; if it hides any parameters, approval is unavailable.
 const argumentEvidence=chosen&&!fileWrite(chosen)?presentEvidence(record(chosen.arguments)):null;
 const fullArgumentsVisible=isCompleteDecisionEvidence(argumentEvidence);
 const viewState=chosen?record(states[planRef(chosen)]):{};
 const chosenApprovals=approvals.filter(a=>str(a.plan_id)===selected||str(record(a.plan_ref).ref_id)===selected);
 const approval=chosenApprovals.find(active);
 const anyRejected=chosenApprovals.some(a=>a.decision==='reject'||a.state==='REJECTED');
 const receipt=receipts.find(r=>safeReceipt(r,selected));
 const scheduled=scheduledJobs.find(job=>str(job.job_kind)==='approved_action'
   &&str(record(job.payload).plan_id)===selected&&job.state!=='CANCELLED');
 const expires=Math.min(Date.parse(str(chosen?.expires_at)),Date.parse(str(approval?.expires_at)));
 const canAct=loaded&&!!chosen&&safePlan(chosen)&&!fileWrite(chosen)&&viewState.state==='NOT_STARTED'&&!expired(chosen.expires_at)&&!busy&&!error;
 const canExecute=canAct&&fullArgumentsVisible&&!!approval&&!scheduled&&!attempted.current.has(selected)&&!anyRejected;
 const canSchedule=canExecute&&chosen?.tool_id==='n8n.workflow'&&automationAvailable&&!scheduleBusy
   &&!scheduleAttempts.current.has(selected);
 async function scheduleApproved(){
  if(!canSchedule||!chosen||!approval||!confirmed||!dueLocal)return;
  const due=new Date(dueLocal);
  if(!Number.isFinite(due.getTime())||due.getTime()<Date.now()+1000
      ||!Number.isFinite(expires)||due.getTime()>expires){
   setScheduleError(tr('Выберите время в пределах действия разрешения. После его окончания понадобится новое согласование.',
    'Choose a time before this approval expires. A later run requires new approval.'));return;
  }
  if(!window.confirm(tr('Запланировать единственный запуск одобренного процесса на выбранное время? Изменение файлов или внешний вызов требует уже записанного разрешения.',
     'Schedule this approved workflow for one execution at the selected time? Its existing approval governs any external effect.')))return;
  const planId=selected,approvalId=str(approval.approval_id);
  const selection=selectionEpoch.current,connection=coreEpoch.current;
  const stillCurrent=()=>selection===selectionEpoch.current&&selectedRef.current===planId
      &&connection===coreEpoch.current;
  setScheduleBusy(true);setScheduleError('');setConfirmed(false);
  try{
   try{await runtime.refreshRevision();}
   catch(e){
    if(stillCurrent())setScheduleError(tr('Core не подтвердил готовность. Команда расписания не отправлена. ',
      'Core preflight failed. No scheduling command was sent. ')+failure(e));
    return;
   }
   if(!stillCurrent())return; // No dispatch after changing plan or Core session.
   scheduleAttempts.current.add(planId);
   const result=record(await runtime.command<Row>('automation_create',{
    job_kind:'approved_action',payload:{plan_id:planId,approval_id:approvalId},
    due_at:due.toISOString(),max_attempts:1,
   }));
   const id=str(result.job_id);
   if(!/^JOB-[A-Za-z0-9_-]+$/.test(id))throw Error('scheduled_action_identity_missing');
   const saved=record(await runtime.query<Row>('automation_jobs',{limit:500}));
   const verified=records(saved.jobs).find(job=>str(job.job_id)===id
      &&str(job.job_kind)==='approved_action'
      &&str(record(job.payload).plan_id)===planId
      &&str(record(job.payload).approval_id)===approvalId
      &&Date.parse(str(job.next_attempt_at))===due.getTime()
      &&job.state==='SCHEDULED');
   if(!verified)throw Error('scheduled_action_readback_not_confirmed');
   if(stillCurrent()){setScheduledJobs(records(saved.jobs));setLastResponse(result);setDueLocal('');}
  }catch(e){
   if(stillCurrent())setScheduleError(tr('Исход назначения времени не подтверждён. Откройте «Автоматизации» и проверьте запись. Не отправляйте действие повторно без сверки.',
      'Scheduling is not verified. Open Automations and check the saved job. Do not submit again without checking.')+' '+failure(e));
  }finally{
   try{await load();}catch{/* Keep the schedule attempt guard and uncertainty. */}
   setScheduleBusy(false);
  }
 }
 async function recoverInterrupted(){
  if(!selected||readbackBusy||busy||!loaded)return;
  // Read-only materialization of a previous interrupted intent. Never execute.
  const requestedPlan=selected,epoch=selectionEpoch.current;
  setReadbackBusy(true);setReadbackNotice('');setRecoveredCase('');
  try{
   await runtime.refreshRevision();
   const response=record(await runtime.command<Row>(
    'tool_recover_interrupted',{plan_id:requestedPlan},{kind:'tool_plan',id:requestedPlan}));
   if(epoch!==selectionEpoch.current||selectedRef.current!==requestedPlan)return;
   const id=str(response.repair_case_id);
   setRecoveredCase(id);
   setReadbackNotice(id
    ?tr('Найдено действие с неопределённым исходом. Откройте проверку результата.',
      'An action with an unknown outcome was found. Open recovery to review it.')
    :tr('Состояние прочитано. Откройте сведения и историю перед новым решением.',
      'State was read. Inspect the history before deciding anything further.'));
   setLastResponse(response);
  }catch(e){
   if(epoch!==selectionEpoch.current||selectedRef.current!==requestedPlan)return;
   setReadbackNotice(tr('Проверка прежнего действия не завершена. Не запускайте процесс повторно до выяснения результата.',
    'The previous action could not be verified. Do not rerun the workflow before resolving the outcome.')+' '+failure(e));
  }finally{await load();if(epoch===selectionEpoch.current&&selectedRef.current===requestedPlan)setReadbackBusy(false);}
 }
 async function decide(decision:'approve'|'reject'){
  if(!canAct||!chosen||anyRejected||approval||!confirmed||(decision==='approve'&&!fullArgumentsVisible))return;
  const result=await run<Row>(decision==='approve'
   ?tr('Я прочитал полный план и разрешаю именно эту операцию без немедленного исполнения.','I have reviewed the exact plan and approve this operation without executing it yet.')
   :tr('Отклонить этот план? Его нельзя будет выполнить.','Reject this plan? It will not be executable.'),
   'tool_approve',{plan_id:selected,decision},{kind:'tool_plan',id:selected});
  if(result){setConfirmed(false);setLastResponse(result);}
 }
 async function execute(){
  if(!canExecute||!chosen||!confirmed||attempted.current.has(selected))return;
  if(!window.confirm(tr('Выполнить конкретную одобренную операцию один раз? При неопределённом исходе повтор запрещён до сверки.',
     'Execute this approved operation once? Unknown outcomes must not be retried before reconciliation.')))return;
  const planId=selected,approvalId=str(approval?.approval_id);
  const selection=selectionEpoch.current,connection=coreEpoch.current;
  const stillCurrent=()=>selection===selectionEpoch.current&&selectedRef.current===planId
      &&connection===coreEpoch.current;
  setConfirmed(false);setLastResponse(null);setExecutionUncertain(null);
  try{await runtime.refreshRevision();}
  catch(e){
   if(stillCurrent())setError(tr('Core не подтвердил готовность. Команда выполнения не отправлена. ',
     'Core preflight failed. No execution command was sent. ')+failure(e));
   return;
  }
  if(!stillCurrent())return; // Do not execute a plan from the former view.
  attempted.current.add(planId); // From here the transport outcome may be unknown.
  try{
   const result=record(await runtime.command<Row>('tool_execute',
    {plan_id:planId,approval_id:approvalId},{kind:'tool_plan',id:planId}));
   if(stillCurrent())setLastResponse(result);
  }catch(e){
   if(stillCurrent())setExecutionUncertain({planId,reason:failure(e)});
  }
  try{await load();}catch{/* Preserve unknown outcome and the one-shot guard. */}
 }
 return <section className="subpage card advanced">
  <div className="advanced-head"><div><h2>{tr('Подтверждение действий','Review actions')} <HelpTip topic="Согласования"/></h2>
   <p>{tr('Проверьте предложенное действие и его последствия. Вы отдельно решаете, разрешить ли выполнение.','Review the proposed action and its consequences before approving execution.')}</p></div>
   <button className="secondary-button" disabled={busy} onClick={()=>void load()}>{tr('Обновить','Refresh')}</button>
  </div>
  {error&&<p role="alert" className="advanced-error">{error}</p>}{message&&<p role="status" className="advanced-notice">{message}</p>}
  <div className="advanced-form" aria-label={tr('Очередь внимания','Attention queue')}>
   <h3>{tr('Что требует внимания','Needs attention')}</h3>
   <p>{tr('Очередь показывает существующие записи Core. Открытие решения не запускает его исполнение.',
     'This queue displays existing Core records. Opening an item does not execute it.')}</p>
   <h4>{tr('Результаты задач текущей области','Task results in this Workspace')}</h4>
   {!tasksVerified?<p role="status">{tr('Список задач ещё не подтверждён.','The Task list is not verified.')}</p>:
    reviewTasks.length===0?<p>{tr('Нет результатов на проверку в прочитанном списке.','No results await review in the retrieved list.')}</p>:
    reviewTasks.slice(0,8).map(task=><div className="owner-row" key={task.id}>
     <strong>{task.title||tr('Задача без названия','Untitled Task')}</strong>
     <span>{tr('Результат ожидает решения или доработки','Result awaits review or revision')}</span>
     <button type="button" onClick={()=>onOpenTask(task.id)}>{tr('Открыть задачу','Open Task')}</button>
    </div>)}
   {reviewTasks.length>8&&<small>{tr('Показаны первые восемь из прочитанного списка.','Showing eight from the retrieved list.')}</small>}
   <h4>{tr('Ответы, остановившиеся с ошибкой','Responses stopped by an error')}</h4>
   {!tasksVerified?<p role="status">{tr('Список задач не подтверждён.','Task list is not verified.')}</p>:
    stoppedTasks.length===0?<p>{tr('В прочитанном списке нет задач с ошибкой.','No failed Tasks in the retrieved list.')}</p>:
    stoppedTasks.slice(0,8).map(task=><div className="owner-row" key={task.id}>
     <strong>{task.title||tr('Задача без названия','Untitled Task')}</strong>
     <span>{tr('Проверьте причину остановки и сохранённый результат','Check the failure and saved work')}</span>
     <button type="button" onClick={()=>onOpenTask(task.id)}>{tr('Проверить задачу','Inspect Task')}</button>
    </div>)}
   {stoppedTasks.length>8&&<small>{tr('Показаны первые восемь из прочитанного списка.','Showing eight from the retrieved list.')}</small>}
   <h4>{tr('Прерванные действия','Interrupted actions')}</h4>
   {!repairAvailable?<p role="status">{tr('История восстановления недоступна. Отсутствие ошибок не подтверждено.',
     'Recovery history is unavailable. Absence of interrupted actions cannot be verified.')}</p>:
    openRepairs.length===0?<p>{tr('Нет открытых случаев в прочитанной истории.','No open cases in the retrieved history.')}</p>:
    openRepairs.slice(0,8).map(item=><div className="owner-row" key={str(item.case_id)}>
     <strong>{str(item.task_id)||tr('Прерванное действие','Interrupted action')}</strong>
     <span>{tr('Исход неизвестен','Outcome unknown')}</span>
     <button type="button" onClick={()=>onOpenRecovery(str(item.case_id))}>{tr('Проверить действие','Review action')}</button>
    </div>)}
   {openRepairs.length>8&&<small>{tr('Показаны первые восемь случаев.', 'Showing eight recent cases.')}</small>}
   <h4>{tr('Отдельное согласование','Separate approvals')}</h4>
   <p>{tr('Ниже можно проверить подготовленные операции. Изменение личных файлов согласуется в соответствующей задаче.',
     'Prepared operations can be reviewed below. Personal file changes are approved in their Task.')}</p>
   <button type="button" className="secondary-button" onClick={onOpenMemory}>
    {tr('Предложения памяти','Memory proposals')}</button>
  </div>
  <div className="advanced-form"><h3>{tr('Недавние предложения','Recent proposals')}</h3>
   <p>{tr('Список показывает последние записи; для полной истории конкретного документа откройте его задачу.','This is a recent-record view. Open a document Task for its complete history.')}</p>
   <label className="advanced-field">{tr('Выбранный план','Selected plan')}<select value={selected} onChange={e=>{selectionEpoch.current++;setSelected(e.target.value);setConfirmed(false);setLastResponse(null);setDueLocal('');setScheduleError('');setReadbackNotice('');setRecoveredCase('');setReadbackBusy(false);}}>
    <option value="">{tr('Выберите предложение','Choose a proposal')}</option>
    {plans.map((p,i)=><option value={planRef(p)} key={planRef(p)}>{tr('Действие','Action')} {i+1} · {str(p.target)||tr('без названия','unnamed')}</option>)}
   </select></label>
   {chosen&&<div className="owner-row">
    <strong>{tr('Предложенное действие','Proposed action')} · {str(chosen.target)}</strong><span>{tr('Состояние:','State:')} {humanState(viewState.state,tr('ru','en') as 'ru'|'en')}</span>
    {fileWrite(chosen)&&<><p>{tr('Записи в Personal Files согласуются только в документном сценарии, где доступен весь текст и текущий SHA-256.','Personal Files writes must be reviewed in the Task showing full text and current SHA-256.')}</p>
      <button disabled={!str(record(chosen.task_ref).ref_id)} onClick={()=>onOpenTask(str(record(chosen.task_ref).ref_id))}>{tr('Открыть документное согласование','Open document review')}</button></>}
    {!fileWrite(chosen)&&<>
     <h3>{tr('Точное содержание предлагаемой операции','Exact proposed action')}</h3>
     <dl><dt>{tr('Операция','Operation')}</dt><dd>{str(chosen.operation)}</dd><dt>{tr('Цель','Target')}</dt><dd>{str(chosen.target)}</dd><dt>{tr('Инструмент','Tool')}</dt><dd>{tr('Разрешённое действие IWXA','Authorized IWXA action')}</dd></dl>
     <OwnerDetails title={tr('Параметры действия','Action parameters')} value={record(chosen.arguments)}/>
     {!fullArgumentsVisible&&<p role="alert" className="advanced-error">{tr(
      'Некоторые параметры скрыты или представлены не полностью. Разрешение и исполнение заблокированы: полную операцию невозможно проверить в этом экране. Отклонение остаётся доступным; при необходимости переподготовьте план без секретов в аргументах.',
      'Some arguments are hidden or incomplete. Approval and execution are blocked because this screen cannot verify the full operation. Rejection remains available. Prepare a new plan without credentials in its arguments if necessary.'
     )}</p>}
     <OwnerDetails title={tr('Политика и основания плана','Plan policy and evidence')} value={{plan_id:chosen.plan_id,policy_binding_digest:chosen.policy_binding_digest,provider_id:chosen.provider_id,provider_slot:chosen.provider_slot,risk:chosen.risk,candidate_ref:chosen.candidate_ref,task_ref:chosen.task_ref}}/>
    </>}
    {chosenApprovals.length>0&&<OwnerDetails title={tr('Сохранённые решения человека','Recorded human decisions')} value={chosenApprovals}/>}
    {receipt&&<OwnerDetails title={tr('Квитанция исполнения','Execution receipt')} value={receipt}/>}
    {scheduled&&<p role="status">{tr('Для этого действия уже сохранено задание в «Автоматизациях». Дата: ','This action is already scheduled in Automations. Due: ')}
     {new Date(str(scheduled.next_attempt_at)).toLocaleString(tr('ru-RU','en-GB'))}.
     <button type="button" className="mini-button" onClick={onOpenAutomations}>{tr('Открыть автоматизации','Open automations')}</button></p>}
    {!fileWrite(chosen)&&scheduled?.resume_blocked===true&&<div className="advanced-form">
      <p role="alert">{tr('Выполнение было прервано. Повтор заблокирован, пока результат не установлен.',
       'Execution was interrupted. A retry is blocked until its outcome is established.')}</p>
      <button disabled={busy||readbackBusy||!loaded} onClick={()=>void recoverInterrupted()}>{readbackBusy
       ?tr('Проверяю прежнее действие…','Checking previous action…')
       :tr('Проверить прежнее выполнение','Check previous execution')}</button>
      {readbackNotice&&<p role="status">{readbackNotice}</p>}
      {recoveredCase&&<button type="button" onClick={()=>onOpenRecovery(recoveredCase)}>{tr('Открыть восстановление','Open recovery')}</button>}
     </div>}
    {!fileWrite(chosen)&&canAct&&!anyRejected&&<><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
      {!fullArgumentsVisible?tr('Понимаю, что полный план недоступен для проверки; его можно отклонить.','I understand the full plan cannot be inspected here; I may reject it.'):
       approval?tr('Подтверждаю исполнение этого уже одобренного плана.','I confirm executing this already approved plan.'):
       tr('Проверен полный текст аргументов и адрес операции.','I reviewed all arguments and destination.')}
     </label>
     <div className="advanced-actions">
      {!approval&&<><button disabled={!confirmed||busy||!fullArgumentsVisible} onClick={()=>void decide('approve')}>{tr('Разрешить без исполнения','Approve without executing')}</button>
       <button disabled={!confirmed||busy} onClick={()=>void decide('reject')}>{tr('Отклонить','Reject')}</button></>}
      {approval&&<button className="primary-button" disabled={!canExecute||!confirmed} onClick={()=>void execute()}>{tr('Выполнить одобренную операцию','Execute approved action')}</button>}
     </div>
     {approval&&chosen.tool_id==='n8n.workflow'&&!scheduled&&<div className="advanced-form">
      <h4>{tr('Запустить процесс позже','Run this workflow later')}</h4>
      <p>{tr('Задание выполнится один раз. Если разрешение истечёт, запуск будет отклонён. Вы сможете увидеть квитанцию в «Автоматизациях».',
        'The workflow runs once. An expired approval prevents execution. Its receipt will appear in Automations.')}</p>
      <label className="advanced-field">{tr('Дата и время запуска','Execution date and time')}
       <input type="datetime-local" value={dueLocal} onChange={e=>{setDueLocal(e.target.value);setScheduleError('');}}/>
      </label>
      {Number.isFinite(expires)&&<small>{tr('Разрешение действует до ','Approval valid until ')}
       {new Date(expires).toLocaleString(tr('ru-RU','en-GB'))}</small>}
      {!automationAvailable&&<p role="alert">{tr('Не удалось прочитать расписание. Назначение времени пока недоступно.',
       'Could not read scheduled actions. Scheduling is unavailable.')}</p>}
      {scheduleError&&<p role="alert" className="advanced-error">{scheduleError}</p>}
      <button disabled={!canSchedule||!confirmed||!dueLocal} onClick={()=>void scheduleApproved()}>
       {scheduleBusy?tr('Сохраняю расписание…','Saving schedule…'):tr('Назначить запуск','Schedule execution')}</button>
     </div>}
     </>}
    {executionUncertain?.planId===selected&&<div role="alert" className="advanced-error">
      <p>{tr('Ответ исполнения потерян. Действие могло состояться. Не повторяйте его до сверки квитанции и фактического результата.',
       'The execution response was lost. The action may have occurred. Check receipts and actual results before retrying.')}</p>
      <OwnerDetails title={tr('Причина неопределённости','Uncertainty details')} value={executionUncertain.reason}/>
      <button type="button" onClick={()=>onOpenRecovery()}>{tr('Открыть восстановление','Open recovery')}</button>
     </div>}
    {attempted.current.has(selected)&&<p role="alert">{tr('Команда отправлялась в этой сессии. Повтор заблокирован; сверяйте квитанцию и состояние Core.','An execution was attempted in this session. Retry is blocked; inspect the receipt and Core state.')}</p>}
    {(viewState.state==='OUTCOME_UNKNOWN'||viewState.state==='INTERRUPTED')&&<button onClick={()=>onOpenRecovery()}>{tr('Проверить результат действия','Reconcile unknown outcome')}</button>}
    {lastResponse&&<OwnerDetails title={tr('Результат последней команды','Latest command result')} value={lastResponse}/>}
   </div>}
  </div>
 </section>;
}
