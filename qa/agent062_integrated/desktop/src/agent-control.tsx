import React,{useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {record,records,str,failure,OwnerDetails,OwnerError,OwnerMessage,useOwnerActions,type Row} from './owner-ui';
import {HelpTip,useUiSettings} from './ui-preferences';

const ROLE_IDS=['COORDINATOR','WORKER','REVIEWER'] as const;
const roleName=(role:string,tr:(ru:string,en:string)=>string)=>role==='COORDINATOR'?tr('Организует работу','Coordinator'):role==='WORKER'?tr('Выполняет задачи','Worker'):role==='REVIEWER'?tr('Проверяет результат','Reviewer'):role;
type RoleId=typeof ROLE_IDS[number];
const ACCOUNT_RUNTIMES=['CODEX_CHATGPT_CLI_V1','GOOGLE_ANTIGRAVITY_SPECIALIST_V1'];
const lines=(value:string)=>value.split('\n').map(x=>x.trim()).filter(Boolean);
const qualified=(row:Row)=>str(row.qualification_state).startsWith('QUALIFIED_');
const ready=(row:Row)=>record(row.health).ready===true&&row.route_admissible===true;
const statusLabel=(state:string,tr:(ru:string,en:string)=>string)=>{
 const key=state.toUpperCase();
 if(key==='AWAITING_HUMAN_VERIFICATION')return tr('Ожидает вашей проверки','Awaiting your review');
 if(key==='ACCEPTED'||key==='FINALIZED')return tr('Решение сохранено','Review completed');
 if(key==='REJECTED')return tr('Отклонено','Rejected');
 if(key==='RUNNING'||key==='IN_PROGRESS')return tr('Выполняется','In progress');
 if(key==='FAILED')return tr('Завершилось с ошибкой','Failed');
 if(key==='INTENT_ONLY_RECOVERY_REQUIRED')return tr('Результат ещё неизвестен','The outcome is not yet known');
 return tr('Требуется проверить состояние','Check current state');
};

export function AgentControl({onOpenPrograms,onOpenModels,onOpenConnections,onOpenTask,onContinueWithEvidence,onContinueInDialogue,focusRunId,initialObjective,initialSourceTaskId,onHandoffConsumed}:{initialObjective?:string;initialSourceTaskId?:string|null;onHandoffConsumed?:()=>void;onOpenPrograms?:()=>void;onOpenModels?:()=>void;onOpenConnections?:()=>void;onOpenTask?:(taskId:string)=>void;onContinueWithEvidence?:(hostedRunId:string,ticketId:string)=>Promise<void>;onContinueInDialogue?:(hostedRunId:string,ticketId:string)=>Promise<void>;focusRunId?:string}){
 const {tr}=useUiSettings();
 const [roles,setRoles]=useState<Row>({}),[activity,setActivity]=useState<Row[]>([]),[error,setError]=useState('');
 const [role,setRole]=useState<RoleId>('WORKER'),[runtimeId,setRuntimeId]=useState('');
 const [accountReadback,setAccountReadback]=useState<Row|null>(null);
 const [objective,setObjective]=useState(()=>initialObjective||''),[criteria,setCriteria]=useState(''),[privacy,setPrivacy]=useState<'PUBLIC'|'SYNTHETIC'>('PUBLIC');
 const [importedFromTask]=useState(Boolean(initialObjective));
 // A Task handoff is for one group dispatch, not a permanent session binding.
 // Keep this visible so the next unrelated run cannot silently inherit it.
 const sourceTaskId=useRef(initialSourceTaskId||null);
 const [sourceTaskLinked,setSourceTaskLinked]=useState(Boolean(initialSourceTaskId));
 useEffect(()=>{if(initialObjective)onHandoffConsumed?.();},[]);
 const [runId,setRunId]=useState(''),[review,setReview]=useState<Row|null>(null),[votes,setVotes]=useState<Record<string,string>>({});
 const [reviewBusy,setReviewBusy]=useState(false),[filePath,setFilePath]=useState('Goose-result.md'),[draftTicket,setDraftTicket]=useState('');
 const [runningGroup,setRunningGroup]=useState(false),[recoveryMessage,setRecoveryMessage]=useState('');
 const [continuingTask,setContinuingTask]=useState(false);
 const reviewSequence=useRef(0),initialAssignment=useRef(false),initialHistory=useRef(false);
 const loadSequence=useRef(0);
 const focusedRunHandled=useRef('');
 const recoverySequence=useRef(0);
 const load=useCallback(async(strict=false)=>{
  const seq=++loadSequence.current;
  const issues:Record<string,string>={};
  const report=(key:string,issue:string)=>{
   issues[key]=issue;
   if(seq===loadSequence.current)setError([issues.agent_roles,issues.hosted_reference_activity].filter(Boolean).join(' · '));
  };
  const read=async(key:'agent_roles'|'hosted_reference_activity')=>{
   try{
    const value=record(await runtime.query<Row>(key));
    if(seq!==loadSequence.current)return '';
    if(key==='agent_roles')setRoles(value);
    else setActivity(records(value.runs));
    report(key,'');
    return '';
   }catch(error){
    if(seq!==loadSequence.current)return '';
    if(key==='agent_roles')setRoles({});
    // A history failure is visible but cannot retract an acknowledged
    // action. A failed role probe still prevents an unverified role switch.
    const issue=key+': '+failure(error);
    report(key,issue);
    return issue;
   }
  };
  const roleRead=read('agent_roles');
  // A slow optional history query must not delay the confirmation of an
  // already completed Core command. The saved history still appears later.
  void read('hosted_reference_activity');
  const roleIssue=await roleRead;
  if(seq!==loadSequence.current)return;
  if(strict&&roleIssue)throw Error(roleIssue);
 },[]);
 useEffect(()=>{void load();return()=>{loadSequence.current++}},[load]);
 // Restore the most recent persisted run, including failure or unknown
 // outcome. Do not silently replace a failed current run with older success.
 // This performs no agent execution, acceptance, or file modification.
 useEffect(()=>{
  if(initialHistory.current||!activity.length)return;
  const latest=activity[0];
  const id=str(latest.hosted_run_id);
  if(!id)return;
  chooseRun(id);
  if(['AWAITING_HUMAN_VERIFICATION','FINALIZED'].includes(str(latest.state)))
   void inspectRun(id);
 },[activity]);
 useEffect(()=>{
  if(!focusRunId){focusedRunHandled.current='';return;}
  if(!/^HREF-[A-Za-z0-9_-]+$/.test(focusRunId)||focusedRunHandled.current===focusRunId)return;
  const row=activity.find(item=>str(item.hosted_run_id)===focusRunId);
  if(!row)return;
  focusedRunHandled.current=focusRunId;
  initialHistory.current=true;
  if(runId!==focusRunId){
   chooseRun(focusRunId);
   if(['AWAITING_HUMAN_VERIFICATION','FINALIZED'].includes(str(row.state)))
    void inspectRun(focusRunId);
  }
 },[focusRunId,activity,runId]);
 const {run,busy,message,diagnostic}=useOwnerActions(()=>load(true));
 useEffect(()=>{
  if(initialAssignment.current||roles.enabled!==true)return;
  initialAssignment.current=true;
  setRuntimeId(str(record(record(roles.roles).WORKER).target_id));
 },[roles]);
 const currentRoles=record(roles.roles),persistedRoles=record(record(roles.durable_binding_state).roles);
 const current=record(currentRoles[role]),policy=record(persistedRoles[role]);
 const allowed=Array.isArray(policy.allowed_privacy_classes)?policy.allowed_privacy_classes.map(str):[];
 const configured=records(roles.runtimes),portfolio=records(roles.portfolio_runtimes);
 const options:(Row & {portfolio:Row})[]=configured.map(row=>({...row,portfolio:portfolio.find(p=>p.runtime_id===row.runtime_id)||{}}));
 const candidate=options.find(row=>row.runtime_id===runtimeId);
 const candidateQual=qualified(record(candidate?.portfolio));
 const currentTarget=str(current.target_id);
 const same=runtimeId===currentTarget;
 const canSwitch=roles.enabled===true&&!!candidate&&ready(candidate)&&candidateQual&&allowed.length>0&&!same;
 const groupReady=roles.enabled===true&&ROLE_IDS.every(id=>{
  const binding=record(currentRoles[id]);
  const profile=options.find(row=>row.runtime_id===binding.target_id);
  const rule=record(persistedRoles[id]);
  return !!profile&&ready(profile)&&qualified(record(profile.portfolio))&&Array.isArray(rule.allowed_privacy_classes)&&rule.allowed_privacy_classes.includes(privacy);
 });
 const tickets=records(review?.ticket_results),criteriaRows=records(review?.goal_criteria);
 const evidence=records(review?.ticket_evidence),synthesis=record(review?.synthesis),finalization=record(review?.finalization);
 const finalDone=finalization.finalized===true;
 const selectedRun=activity.find(row=>str(row.hosted_run_id)===runId);
 const canInspectRun=!!selectedRun&&['AWAITING_HUMAN_VERIFICATION','FINALIZED'].includes(str(selectedRun.state));
 const acceptedTicketIds=Array.isArray(finalization.accepted_ticket_ids)?finalization.accepted_ticket_ids.map(str):[];
 const acceptedEvidence=selectedRun?.privacy_class==='SYNTHETIC'&&finalDone&&finalization.final_state==='ACCEPTED'&&review?.evidence_verified===true
  ?evidence.filter(row=>acceptedTicketIds.includes(str(row.ticket_id))&&row.worker_output_truncated!==true&&!!str(row.worker_output).trim()):[];
 const canExportEvidence=(row:Row)=>{
  const text=str(row.worker_output);
  return row.worker_output_truncated!==true&&text.trim().length>0
   &&new TextEncoder().encode(text).length<=8000&&text.trim().split(/\s+/).length<=1600;
 };
 const exportedEvidence=acceptedEvidence.filter(canExportEvidence);
 const exportTicket=exportedEvidence.some(row=>str(row.ticket_id)===draftTicket)?draftTicket:str(exportedEvidence[0]?.ticket_id);
 const conflictingVotes=tickets.some(row=>votes['ticket:'+str(row.ticket_id)]==='FAIL')
  &&criteriaRows.length>0&&criteriaRows.every(row=>votes['criterion:'+str(row.criterion_id)]==='PASS');
 const safeFilePath=(value:string)=>value.length>0&&value.length<=160&&value===value.normalize('NFC')
  &&!value.startsWith('/')&&!value.endsWith('/')&&/\.(md|txt)$/i.test(value)
  &&value.split('/').every(part=>!!part&&part===part.trim()&&!part.startsWith('.')
   &&!/[<>:"\\|?*\x00-\x1f]/.test(part)&&!/[. ]$/.test(part)
   &&!/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part));
 const votesComplete=review?.evidence_verified===true&&!finalDone&&!conflictingVotes&&tickets.length>0&&criteriaRows.length>0
  &&tickets.every(x=>{
   const vote=votes['ticket:'+str(x.ticket_id)];
   const proof=evidence.find(y=>str(y.ticket_id)===str(x.ticket_id));
   // A truncated preview is not sufficient evidence to accept a step.
   return vote==='FAIL'||(vote==='PASS'&&!!proof&&proof.worker_output_truncated!==true&&!!str(proof.worker_output).trim());
  })
  &&criteriaRows.every(x=>['PASS','FAIL','UNKNOWN'].includes(votes['criterion:'+str(x.criterion_id)]));
 function chooseRun(id:string){
  initialHistory.current=true;
  reviewSequence.current+=1;recoverySequence.current+=1;
  setRunId(id);setReview(null);setVotes({});setReviewBusy(false);setDraftTicket('');
  setRecoveryMessage('');
 }
 async function inspectRun(id=runId){
  if(!id.trim())return;
  const sequence=++reviewSequence.current;
  setReview(null);setVotes({});setReviewBusy(true);setError('');
  try{
   const result=record(await runtime.query<Row>('hosted_reference_review',{hosted_run_id:id.trim()}));
   if(sequence!==reviewSequence.current)return;
   if(str(result.hosted_run_id)!==id.trim())throw Error('hosted_review_identity_mismatch');
   setReview(result);
  }catch(e){if(sequence===reviewSequence.current){setReview(null);setError(failure(e));}}
  finally{if(sequence===reviewSequence.current)setReviewBusy(false);}
 }
 async function recoverSavedRun(){
  // The client may have lost the response to a long request after Core
  // persisted its intent or complete result. Read only. Never replay it.
  // Do not override a result the user selected while history was loading.
  const seq=++recoverySequence.current;
  const selection=reviewSequence.current;
  setRecoveryMessage('');setError('');
  try{
   const projection=record(await runtime.query<Row>('hosted_reference_activity'));
   if(seq!==recoverySequence.current||selection!==reviewSequence.current)return;
   const saved=records(projection.runs);
   setActivity(saved);
   if(!saved.length){
    chooseRun('');
    setRecoveryMessage(tr('Сохранённых заданий пока нет. Новый запуск требует отдельного разрешения.','There are no saved tasks yet. A new run requires separate approval.'));
    return;
   }
   // Core returns activity newest first; no old success may mask a failure.
   const selected=saved[0];
   const id=str(selected.hosted_run_id);
   if(!id)throw Error('hosted_run_identity_missing');
   chooseRun(id);
   if(['AWAITING_HUMAN_VERIFICATION','FINALIZED'].includes(str(selected.state))){
    await inspectRun(id);
   }else{
    setRecoveryMessage(str(selected.state)==='FAILED'
     ?tr('Последняя попытка завершилась с ошибкой. Решение о новом запуске принимайте после проверки причины.','The last attempt failed. Check the reason before deciding on another run.')
     :tr('Выполнение могло продолжиться без ответа интерфейсу. Обновите список позже. Повтор автоматически не запускается.','Execution may still be running without a response to the interface. Refresh later. Nothing is restarted automatically.'));
   }
  }catch(e){
   if(seq===recoverySequence.current&&selection===reviewSequence.current)
    setError(tr('Не удалось прочитать историю заданий. Не повторяйте запуск до проверки состояния.','Could not read task history. Do not retry before checking its state.')+' '+failure(e));
  }
 }
 async function launchGroup(){
  if(busy||runningGroup||!groupReady||!objective.trim()||!lines(criteria).length||lines(criteria).length>10)return;
  setRunningGroup(true);setRecoveryMessage('');
  const linkedTask=sourceTaskId.current;
  // Preserve a run the user explicitly opens while this command is active.
  const launchSelection=reviewSequence.current;
  try{
   const answer=await run<Row>(
    tr('Передать группе только '+(privacy==='PUBLIC'?'открытые':'учебные')+' данные?','Send only '+(privacy==='PUBLIC'?'public':'sample')+' data to the group?'),
    'hosted_reference_run',
    {orchestration_id:'hosted_reference',objective:objective.trim(),acceptance_criteria:lines(criteria),privacy_class:privacy,confirm_hosted_usage:true,
       ...(linkedTask?{source_task_id:linkedTask}:{})},
    {kind:'agent_orchestration',id:'hosted_reference'});
   if(answer&&str(answer.hosted_run_id)){
    // A second run in the same screen is independent unless the Task
    // explicitly hands off again. Its own Core acknowledgement is authoritative.
    if(linkedTask&&sourceTaskId.current===linkedTask){
     sourceTaskId.current=null;
     setSourceTaskLinked(false);
    }
    const id=str(answer.hosted_run_id);
    if(launchSelection===reviewSequence.current){
     chooseRun(id);
     await inspectRun(id);
    }else{
     // The user selected another saved run while Core was executing.
     // Keep that view and make the new run discoverable in history.
     setRecoveryMessage(tr('Новое задание принято. Оно доступно в истории; выбранное вами задание осталось открытым.',
      'The new run was acknowledged. Find it in history; your selected run stays open.'));
    }
   }else{
    // A null acknowledgement also covers a cancelled confirmation. Only
    // allow deliberate readback, never infer a failure or issue another run.
    if(launchSelection===reviewSequence.current)
     setRecoveryMessage(tr('Ответ о запуске не подтверждён. Проверьте сохранённые задания прежде, чем повторять.','The run was not acknowledged. Check saved tasks before considering another run.'));
   }
  }finally{setRunningGroup(false);}
 }
 async function continueWithEvidence(){
  if(continuingTask||busy||reviewBusy||!onContinueWithEvidence||!runId||!exportTicket
      ||review?.evidence_verified!==true||!finalDone||finalization.final_state!=='ACCEPTED'
      ||selectedRun?.privacy_class!=='SYNTHETIC'||!exportedEvidence.some(row=>str(row.ticket_id)===exportTicket))return;
  setContinuingTask(true);setError('');
  try{
   await onContinueWithEvidence(runId,exportTicket);
  }catch(e){
   setError(tr('Не удалось подтвердить перенос результата. Проверьте черновик задания перед повтором. ',
     'Could not verify the result transfer. Check the task draft before retrying. ')+failure(e));
  }finally{setContinuingTask(false);}
 }
 async function createFileDraft(){
  const path=filePath.trim();
  if(!onOpenTask||!exportTicket||!safeFilePath(path)||!runId||review?.evidence_verified!==true||
     selectedRun?.privacy_class!=='SYNTHETIC'||!finalDone||finalization.final_state!=='ACCEPTED')return;
  const selectedTicket=exportTicket;
  const out=await run<Row>(tr('Создать задачу на запись учебного результата в файл «','Create a file-writing task for sample output at "')+
   path+tr('»? Файл будет записан только после отдельной проверки и разрешения.','"? The file will be written only after separate review and permission.'),
   'hosted_reference_file_draft',{hosted_run_id:runId,ticket_id:selectedTicket,path,confirmed:true},
   {kind:'hosted_reference_run',id:runId});
  if(!out)return;
  const taskId=str(out.task_id),candidateId=str(out.candidate_id);
  if(!taskId||!candidateId){setError(tr('Не получено подтверждение подготовленной задачи. Проверьте сохранённые задачи перед повтором.','The file task was not confirmed. Check saved tasks before retrying.'));return;}
  try{
   const saved=record(await runtime.query<Row>('task',{task_id:taskId}));
   if(str(saved.task_id)!==taskId||!records(saved.action_candidates)
      .some(item=>str(item.candidate_id)===candidateId&&item.operation==='files.write_text'
       &&str(record(item.arguments).path)===path))
    throw Error('goose_file_draft_task_readback_mismatch');
   await onOpenTask?.(taskId);
  }catch(e){
   setError(tr('Подготовка могла завершиться, но сохранённая задача ещё не подтверждена. Откройте задачи и проверьте результат до новой попытки.','The draft may have been saved, but its task cannot be verified. Check saved tasks before another attempt.')+' '+failure(e));
  }
 }
 async function finalize(){
  if(!runId.trim()||!votesComplete)return;
  const ticket_decisions:Record<string,string>={},criterion_decisions:Record<string,string>={};
  for(const item of tickets)ticket_decisions[str(item.ticket_id)]=votes['ticket:'+str(item.ticket_id)];
  for(const item of criteriaRows)criterion_decisions[str(item.criterion_id)]=votes['criterion:'+str(item.criterion_id)];
  await run<Row>(tr('Сохранить человеческое решение по каждому шагу и критерию?','Record the human decision for each task and criterion?'),'hosted_reference_finalize',
   {hosted_run_id:runId.trim(),ticket_decisions,criterion_decisions},{kind:'hosted_reference_run',id:runId.trim()});
  // Even when the acknowledgement is lost, read the existing immutable
  // decision instead of submitting the human vote twice.
  await inspectRun(runId);
 }
 async function accountAction(command:'agent_account_readiness_probe'|'agent_account_setup_launch'){
  if(!ACCOUNT_RUNTIMES.includes(runtimeId))return;
  const input=command==='agent_account_setup_launch'?{runtime_id:runtimeId,confirmed:true}:{runtime_id:runtimeId};
  const result=await run<Row>(command==='agent_account_setup_launch'
   ?tr('Открыть штатный вход выбранного агента? IWXA не получает пароль и не выдаёт права на инструменты.','Launch the runtime account sign-in? IWXA captures no credentials or tool authority.')
   :tr('Проверить фактическую готовность учётной записи?','Probe actual account readiness?'),
   command,input,{kind:'agent_runtime',id:runtimeId});
  if(result)setAccountReadback(result);
 }
 const candidateReason=str(record(candidate?.health).reason);
 const setupAction=/(model_not_configured|selected_model_not_ready|selected_model_digest|model_digest_changed|model_selection_changed|model_not_present|selected_model_not_present|model_binding_mismatch|ollama_unavailable|endpoint_binding_mismatch|iwxa_selected_model)/.test(candidateReason)
  ?tr('Проверьте локальную модель в разделе «Модели».','Check the local model in Models.')
  :/(runtime_not_selected|runtime_launch_failed|install_receipt|version_probe|runtime_adoption)/.test(candidateReason)
  ?tr('Проверьте программу Goose и её подключение в «Программах».','Check the Goose program and its connection in Programs.')
  :tr('Обновите сведения и проверьте причину в технических деталях.','Refresh and inspect technical details.');
 const blockedReason=!candidate?tr('Сначала выберите помощника. Если Goose не появился, откройте «Программы».','Choose an assistant. If Goose is missing, open Programs.')
  :!candidateQual?tr('Этот помощник пока недоступен для назначения. Откройте подробности проверки.','This assistant is not yet eligible for assignment. Open the check details.')
  :candidate.route_admissible===false?tr('Текущий режим работы не допускает этого исполнителя. Выберите другого или проверьте режим Agent.','The current Agent mode does not allow this runtime. Choose another or review the Agent mode.')
  :!ready(candidate)?tr('Помощник пока не готов. ','The assistant is not ready. ')+setupAction
  :!allowed.length?tr('Отсутствует действующая политика классов данных.','Role privacy policy is unavailable.')
  :same?tr('Уже назначен этой роли.','Already bound to this role.'):'';
 return <section className="subpage card advanced">
  <div className="advanced-head"><div><h2>{tr('Помощники','Assistants')} <HelpTip topic="Агенты"/></h2>
   <p>{tr('Назначьте помощников для подготовки работы, выполнения и проверки результата. Права на изменение файлов подтверждаются отдельно.','Assign assistants for planning, execution and review. File changes require separate approval.')}</p></div>
   <button className="secondary-button" disabled={busy} onClick={()=>void load()}>{tr('Обновить','Refresh')}</button></div>
  {error&&<OwnerError error={error}/>}{message&&<OwnerMessage diagnostic={diagnostic}>{message}</OwnerMessage>}
  {onOpenConnections&&/goose_file_draft_destination_(not_connected|not_writable|parent_missing)/.test(diagnostic)&&
   <div className="advanced-notice" role="status">
    <p>{tr('Папка для нового файла пока недоступна. Подключите папку с правом записи и проверьте путь к документу.','The destination folder is unavailable. Connect a writable file folder and check the document path.')}</p>
    <button type="button" onClick={onOpenConnections}>{tr('Настроить папку для файлов','Configure file folder')}</button>
   </div>}
  <div className="advanced-form"><h3>{tr('Распределение работы','Work assignments')}</h3>
   {ROLE_IDS.map(id=>{const binding=record(currentRoles[id]),runtimeRow=options.find(x=>x.runtime_id===binding.target_id);
    return <div className="owner-row" key={id}><strong>{roleName(id,tr)}</strong><span>{str(runtimeRow?.display_name)||tr('Не назначен','Not assigned')}</span>
     <small>{runtimeRow?.route_admissible===false
      ?tr('Исполнение недоступно в текущем режиме','Execution unavailable in current mode')
      :runtimeRow?.execution_verified_for_current_identity===true
      ?tr('Ответ исполнителя подтверждён','Assistant response verified')
      :ready(runtimeRow||{})?tr('Программа и модель доступны','Program and model available')
      :tr('Готовность не проверена','Readiness not verified')}</small>
     <OwnerDetails title={tr('Состояние помощника','Assistant details')} value={{binding,portfolio:runtimeRow?.portfolio}}/>
    </div>;})}
   <p>{tr('Назначения сохраняются после перезапуска. Если помощник недоступен, выберите другого из проверенных.','Assignments survive restarts. If an assistant becomes unavailable, choose another verified one.')}</p>
  </div>
  <div className="advanced-form"><h3>{tr('Выбрать проверенного исполнителя','Select a verified runtime')}</h3>
   <label className="advanced-field">{tr('Роль','Role')}<select value={role} onChange={e=>{const next=e.target.value as RoleId;setRole(next);setRuntimeId(str(record(currentRoles[next]).target_id));setAccountReadback(null);}}>
    {ROLE_IDS.map(x=><option key={x} value={x}>{roleName(x,tr)}</option>)}</select></label>
   <label className="advanced-field">{tr('Программа исполнителя','Assistant program')}<select value={runtimeId} onChange={e=>{setRuntimeId(e.target.value);setAccountReadback(null);}}>
    <option value="">{tr('Выберите исполнителя','Choose runtime')}</option>
    {options.map(x=><option key={str(x.runtime_id)} value={str(x.runtime_id)}>{str(x.display_name)||str(x.runtime_id)} · {ready(x)&&qualified(record(x.portfolio))?tr('доступен','eligible'):tr('не готов','unavailable')}</option>)}
   </select></label>
   {candidate&&<><p>{ready(candidate)&&candidateQual?tr('Помощник проверен и отвечает.','Assistant verified and responding.'):tr('Помощник пока не готов к назначению. Проверьте подключение.','Assistant is not ready for assignment. Check its connection.')}</p>
    <OwnerDetails title={tr('Условия работы','Execution details')} value={{portfolio:candidate.portfolio,health:candidate.health,runtime_class:candidate.runtime_class,adapter:candidate.adapter,auth_mode:candidate.auth_mode,allowed_privacy_classes:allowed}}/></>}
   <p>{blockedReason||tr('Помощник доступен для выбранной роли. Подтвердите назначение.','This assistant is eligible for the chosen role. Confirm the assignment.')}</p>
   <div className="advanced-actions">
    {onOpenPrograms&&<button type="button" className="secondary-button" onClick={onOpenPrograms}>{tr('Найти и подключить Goose','Find and connect Goose')}</button>}
    {onOpenModels&&<button type="button" className="secondary-button" onClick={onOpenModels}>{tr('Проверить локальную модель','Check local model')}</button>}
   </div>
   <div className="advanced-actions">
    <button disabled={busy||!canSwitch} onClick={()=>void run(tr('Назначить помощника «'+(str(candidate?.display_name)||tr('выбранный','selected'))+'» для роли «'+roleName(role,tr)+'»?','Assign '+(str(candidate?.display_name)||'the selected assistant')+' to '+roleName(role,tr)+'?'),
     'agent_role_switch',{role_id:role,runtime_id:runtimeId},{kind:'agent_role',id:role})}>{tr('Назначить роль','Assign role')}</button>
    <button disabled={busy||!ACCOUNT_RUNTIMES.includes(runtimeId)} onClick={()=>void accountAction('agent_account_readiness_probe')}>{tr('Проверить подключение','Check connection')}</button>
    <button disabled={busy||!ACCOUNT_RUNTIMES.includes(runtimeId)} onClick={()=>void accountAction('agent_account_setup_launch')}>{tr('Открыть вход в программу','Open runtime sign-in')}</button>
   </div>
   {accountReadback&&<OwnerDetails title={tr('Ответ проверки Runtime','Runtime response')} value={accountReadback}/>}
  </div>
  <div className="advanced-form"><h3>{tr('Портфель и доступные альтернативы','Portfolio and alternatives')}</h3>
   <p>{tr('В списке показаны доступные варианты. Подключение на этом компьютере и готовность к работе проверяются отдельно.','These are available choices. Local connection and readiness are checked separately.')}</p>
   <div className="owner-rows">{portfolio.map(p=>{const configuredRow=options.find(x=>x.runtime_id===p.runtime_id);
    return <div className="owner-row" key={str(p.runtime_id)}>
     <strong>{str(p.display_name)||str(p.runtime_id)}</strong>
     <span>{configuredRow&&ready(configuredRow)&&qualified(p)?tr('Доступен для назначения','Available for assignment'):tr('Требуется проверка или подключение','Check or connect before use')}</span>
     <small>{configuredRow?(configuredRow.route_admissible===false
       ?tr('Исполнение заблокировано текущим режимом','Execution blocked by current mode')
       :configuredRow.execution_verified_for_current_identity===true
       ?tr('Получен проверенный ответ','Verified response received')
       :ready(configuredRow)?tr('Готов к пробному заданию','Ready for a sample task')
       :tr('Программа не готова','Program not ready')):tr('Пока не подключён','Not connected yet')}</small>
     {configuredRow&&ready(configuredRow)&&qualified(p)&&<button disabled={busy} onClick={()=>setRuntimeId(str(p.runtime_id))}>{tr('Выбрать для роли','Select for role')}</button>}
    </div>;})}</div>
  </div>
  <div className="advanced-form"><h3>{tr('Задание группе','Group task')}</h3>
    {importedFromTask&&<p role="status">{tr('Цель перенесена из задачи. Проверьте и удалите личные данные: этот способ работы сейчас принимает только открытые и учебные сведения. Файлы не перенесены. Сам перенос цели не выполняет задание.',
     'The objective was copied. Review and remove personal data: this workflow currently accepts public or sample data only. No files were transferred. Copying the objective does not run a task.')}</p>}
    {sourceTaskLinked&&sourceTaskId.current&&<div className="advanced-notice" role="status">
     <p>{tr('Следующий запуск будет связан с исходной задачей: ','The next run will be linked to source Task: ')}
      <code>{sourceTaskId.current}</code>. {tr('После принятого Core запуска связь будет снята; цель останется в поле ввода.',
       'The link is cleared after Core acknowledges the run; the objective remains editable.')}</p>
     <button type="button" className="secondary-button" disabled={busy||runningGroup}
      onClick={()=>{sourceTaskId.current=null;setSourceTaskLinked(false);}}>
      {tr('Запустить отдельно от исходной задачи','Run independently of the source Task')}</button>
    </div>}
   <p>{tr('Сейчас группе можно передавать только открытые или учебные данные. Личные документы недоступны этому способу работы.','This group can use public or sample data only. Personal documents are unavailable.')}</p>
   <label className="advanced-field">{tr('Задача','Objective')}<input value={objective} onChange={e=>setObjective(e.target.value)}/></label>
   <label className="advanced-field">{tr('Критерии (по строкам)','Criteria (one per line)')}<textarea rows={4} value={criteria} onChange={e=>setCriteria(e.target.value)}/></label>
   <label className="advanced-field">{tr('Класс данных','Data class')}<select value={privacy} onChange={e=>setPrivacy(e.target.value as 'PUBLIC'|'SYNTHETIC')}><option value="PUBLIC">{tr('Открытые данные','Public data')}</option><option value="SYNTHETIC">{tr('Учебные данные','Sample data')}</option></select></label>
   {!groupReady&&<p>{tr('Для запуска нужны три доступных помощника: организатор, исполнитель и проверяющий. Все они должны быть проверены для выбранных данных.','The task needs three available assistants for coordination, execution and review. Each must be verified for the selected data.')}</p>}
   <button disabled={busy||runningGroup||!groupReady||!objective.trim()||!lines(criteria).length||lines(criteria).length>10}
    onClick={()=>void launchGroup()}>{runningGroup?tr('Выполняем задание…','Running task…'):tr('Запустить разрешённую группу','Run eligible group')}</button>
   {runningGroup&&<p role="status">{tr('Помощники выполняют задание. Результат появится в сохранённых заданиях. Не повторяйте запуск при потере связи.','Assistants are working. Results will appear in saved tasks. Do not rerun if the connection is lost.')}</p>}
  </div>
  <div className="advanced-form"><h3>{tr('Результаты и проверка человеком','Results and human verification')}</h3>
   <div className="advanced-actions"><button type="button" className="secondary-button" disabled={runningGroup||reviewBusy} onClick={()=>void recoverSavedRun()}>{tr('Восстановить сохранённое задание','Recover saved task')}</button></div>
   {recoveryMessage&&<p role="status">{recoveryMessage}</p>}
   <label className="advanced-field">{tr('Выполнение','Run')}<select value={runId} onChange={e=>chooseRun(e.target.value)}>
    <option value="">{tr('Выбрать сохранённый запуск','Select saved run')}</option>
    {activity.map((row,i)=><option value={str(row.hosted_run_id)} key={str(row.hosted_run_id)}>{tr('Задание ','Task ')+(activity.length-i)} · {statusLabel(str(row.state),tr)} · {str(row.privacy_class)==='SYNTHETIC'?tr('учебные данные','sample data'):tr('открытые данные','public data')}</option>)}
    {runId&&!activity.some(x=>x.hosted_run_id===runId)&&<option value={runId}>{tr('Текущее задание','Current task')}</option>}
   </select></label>
   <button disabled={busy||reviewBusy||!canInspectRun} onClick={()=>void inspectRun()}>{tr('Открыть результат и основания','Open result and evidence')}</button>
   {selectedRun&&!canInspectRun&&<p role="status">{str(selectedRun.state)==='FAILED'
    ?tr('Задание завершилось с ошибкой. Результат для принятия не создан. Проверьте подключение и обновите список, прежде чем решать о новом запуске.','This task failed without producing a reviewable result. Check the connection and refresh before deciding whether to start a new task.')
    :tr('Результат пока неизвестен. Задание могло продолжить выполняться после потери связи. Обновите историю, не повторяя запуск.','The outcome is unknown. The task may still be running after the connection was lost. Refresh the history without rerunning.')}
    <OwnerDetails value={selectedRun}/></p>}
   {reviewBusy&&<p role="status">{tr('Проверяем сохранённый результат...','Verifying saved result...')}</p>}
   {!activity.length&&<p>{tr('Выполненных заданий пока нет. Начните с учебного задания выше.','There are no saved group tasks yet. Start with a sample task above.')}</p>}
   {review&&<>
    <p role="status">{finalDone?(finalization.final_state==='ACCEPTED'?tr('Вы приняли результат.','You accepted the result.'):tr('Проверка завершена. Результат не принят полностью.','Review completed. The result was not fully accepted.')):statusLabel(str(review.state),tr)}. {review.evidence_verified===true?tr('Основания результата проверены и доступны для чтения.','Evidence was verified and is available to read.'):tr('Подтверждение оснований отсутствует. Решение недоступно.','Evidence is not verified. Decisions are unavailable.')}</p>
    <h3>{tr('Предложенный результат','Proposed result')}</h3>
    <p className="document-content">{str(synthesis.summary)||tr('Резюме результата отсутствует.','Result summary is unavailable.')}</p>
    {records(synthesis.open_issues).length>0&&<OwnerDetails value={synthesis.open_issues}/>}
    {Array.isArray(synthesis.open_issues)&&synthesis.open_issues.length>0&&<div><strong>{tr('Что ещё требует внимания','Items needing attention')}</strong><ul>{synthesis.open_issues.map((issue,i)=><li key={i}>{str(issue)}</li>)}</ul></div>}
    {str(synthesis.recommended_next_action)&&<p>{tr('Предложение помощника: ','Assistant suggests: ')}{str(synthesis.recommended_next_action)}</p>}
    <h3>{tr('Проверить шаги задания','Review task steps')}</h3>
    {tickets.map((row,i)=>{const item=evidence.find(x=>str(x.ticket_id)===str(row.ticket_id));return <div className="owner-row" key={str(row.ticket_id)}>
     <strong>{tr('Шаг ','Step ')+(i+1)}</strong>
     {item?<><pre className="document-content">{str(item.worker_output)}</pre>
      {item.worker_output_truncated===true&&<p role="alert">{tr('Для этого шага доступна только часть текста. Принятие недоступно; шаг можно отклонить.','Only part of this step is available. It cannot be accepted; you may reject it.')}</p>}
      <small>{str(item.reviewer_recommendation)==='PASS'?tr('Проверяющий предлагает принять шаг.','Reviewer recommends approval.'):tr('Проверяющий предлагает доработать шаг.','Reviewer recommends revision.')} {str(item.reviewer_reason)}</small>
      {Array.isArray(item.reviewer_issues)&&item.reviewer_issues.length>0&&<ul>{item.reviewer_issues.map((issue,j)=><li key={j}>{str(issue)}</li>)}</ul>}
     </>:<p role="alert">{tr('Основания этого шага отсутствуют. Принятие недоступно.','Evidence for this step is missing. Approval is unavailable.')}</p>}
     {!finalDone&&<label className="advanced-field">{tr('Ваше решение','Your decision')}
      <select disabled={review?.evidence_verified!==true||busy} value={votes['ticket:'+str(row.ticket_id)]||''} onChange={e=>setVotes(v=>({...v,['ticket:'+str(row.ticket_id)]:e.target.value}))}>
       <option value="">{tr('Выберите решение','Choose decision')}</option>
       <option value="PASS" disabled={!item||item.worker_output_truncated===true||!str(item.worker_output).trim()}>{tr('Принять шаг','Accept step')}</option>
       <option value="FAIL">{tr('Отклонить шаг','Reject step')}</option>
      </select></label>}
    </div>;})}
    <h3>{tr('Проверить условия задания','Review acceptance criteria')}</h3>
    {criteriaRows.map((row,i)=><label key={str(row.criterion_id)} className="advanced-field">{tr('Условие ','Criterion ')+(i+1)}. {str(row.description)}
     {!finalDone&&<select disabled={review?.evidence_verified!==true||busy} value={votes['criterion:'+str(row.criterion_id)]||''} onChange={e=>setVotes(v=>({...v,['criterion:'+str(row.criterion_id)]:e.target.value}))}>
      <option value="">{tr('Выберите решение','Choose decision')}</option>
      <option value="PASS">{tr('Выполнено','Met')}</option>
      <option value="FAIL">{tr('Не выполнено','Not met')}</option>
      <option value="UNKNOWN">{tr('Не могу подтвердить','Cannot confirm')}</option>
     </select>}
    </label>)}
    {!finalDone&&conflictingVotes&&<p role="alert">{tr('Отклонённый шаг не позволяет подтвердить выполнение всех условий. Пересмотрите решения по условиям.','A rejected step cannot satisfy every acceptance criterion. Review the criterion decisions.')}</p>}
    {!finalDone&&<button disabled={busy||reviewBusy||!votesComplete||review.state!=='AWAITING_HUMAN_VERIFICATION'} onClick={()=>void finalize()}>{tr('Сохранить моё решение','Save my decision')}</button>}
    {acceptedEvidence.length>0&&exportedEvidence.length===0&&<p role="status">{tr('Принятый результат слишком велик для автоматической подготовки файла. Его можно прочитать выше; ограничение записи сохраняется.','The accepted output is too large for an automatic file draft. You can read it above; file limits still apply.')}</p>}
    {exportedEvidence.length>0&&(onOpenTask||onContinueWithEvidence)&&<div className="advanced-form">
     <h3>{tr('Продолжить работу с принятым результатом','Continue with the accepted result')}</h3>
     <p>{tr('Выберите принятый шаг. Его текст можно перенести в следующее задание или подготовить файл. Новая модель не запускается автоматически.',
       'Choose an accepted step. Its text can be used in another task or prepared as a file. No model is invoked automatically.')}</p>
     <p>{tr('Доступно только для учебного задания. Будет создана задача на запись нового текстового файла. Сама запись требует отдельного решения и разрешения.','Available only for sample tasks. This prepares a task to create a new text file. Writing still requires separate review and permission.')}</p>
     <label className="advanced-field">{tr('Результат для файла','Result to include')}
      <select value={exportTicket} onChange={e=>setDraftTicket(e.target.value)}>{exportedEvidence.map((item,i)=><option key={str(item.ticket_id)} value={str(item.ticket_id)}>{tr('Шаг ','Step ')+(i+1)}</option>)}</select>
     </label>
     {onContinueInDialogue&&<button type="button" disabled={busy||continuingTask||reviewBusy||!exportTicket}
      onClick={()=>{setContinuingTask(true);setError('');
       void onContinueInDialogue(runId,exportTicket).catch(e=>setError(
        tr('Результат пока не перенесён в разговор. Проверьте выбранную тему. ',
         'Result was not transferred to the conversation. Check the selected topic. ')+failure(e)))
        .finally(()=>setContinuingTask(false));
      }}>{tr('Продолжить в диалоге','Continue in conversation')}</button>}
     {onContinueWithEvidence&&<button type="button" disabled={busy||continuingTask||reviewBusy||!exportTicket}
      onClick={()=>void continueWithEvidence()}>{continuingTask
       ?tr('Сохраняю в задании…','Saving to task…')
       :tr('Использовать в следующем задании','Use in next task')}</button>}
     {onOpenTask&&<>
      <p>{tr('Можно также подготовить новый текстовый файл. Запись потребует отдельного разрешения.',
        'You can also prepare a new text file. Writing requires separate approval.')}</p>
      <label className="advanced-field">{tr('Имя нового файла','New file name')}
       <input value={filePath} onChange={e=>setFilePath(e.target.value)} placeholder="Goose-result.md" maxLength={160}/>
      </label>
      {!safeFilePath(filePath.trim())&&<p role="alert">{tr('Введите относительный путь с расширением .md или .txt без переходов в другие папки.','Enter a relative path ending in .md or .txt without parent-directory traversal.')}</p>}
      <button disabled={busy||continuingTask||reviewBusy||!exportTicket||!safeFilePath(filePath.trim())} onClick={()=>void createFileDraft()}>{tr('Создать задачу на запись файла','Prepare file-writing task')}</button>
     </>}
    </div>}
    <OwnerDetails title={tr('Подтверждения и результаты','Evidence and results')} value={review}/>
   </>}
  </div>
 </section>;
}
