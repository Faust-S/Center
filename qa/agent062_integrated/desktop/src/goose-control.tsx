import React,{useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {ConversationModelChoice} from './conversation-model-choice';
import {record,records,str,failure,OwnerDetails,OwnerError,OwnerMessage,useOwnerActions,type Row} from './owner-ui';
import {useUiSettings} from './ui-preferences';

const GOOSE='GOOSE_PRIMARY_V1';
const ROLES=['COORDINATOR','WORKER','REVIEWER'] as const;
type Role=typeof ROLES[number];
const criteriaLines=(value:string)=>value.split('\n').map(x=>x.trim()).filter(Boolean);
const validRun=(row:Row)=>['AWAITING_HUMAN_VERIFICATION','FINALIZED'].includes(str(row.state));

export function GooseControl({onReview,onChanged}:{onReview:(hostedRunId:string)=>void;onChanged?:()=>void}){
 const {tr,language}=useUiSettings();
 const [roles,setRoles]=useState<Row>({}),[history,setHistory]=useState<Row[]>([]);
 const [error,setError]=useState(''),[role,setRole]=useState<Role>('WORKER');
 const [objective,setObjective]=useState(''),[criteria,setCriteria]=useState('');
 const [running,setRunning]=useState(false),[runId,setRunId]=useState('');
 const [review,setReview]=useState<Row|null>(null),[outcome,setOutcome]=useState('');
 const selectionEpoch=useRef(0),initialHistory=useRef(false),loadSequence=useRef(0);
 const load=useCallback(async(strict=false)=>{
  const seq=++loadSequence.current;
  const issues:Record<string,string>={};
  const report=(key:string,issue:string)=>{
   issues[key]=issue;
   if(seq===loadSequence.current)setError([issues.agent_roles,issues.hosted_reference_activity].filter(Boolean).join(' · '));
  };
  const read=async(key:'agent_roles'|'hosted_reference_activity')=>{
   try{
    const data=record(await runtime.query<Row>(key));
    if(seq!==loadSequence.current)return '';
    if(key==='agent_roles')setRoles(data);
    else setHistory(records(data.runs));
    report(key,'');
    return '';
   }catch(error){
    if(seq!==loadSequence.current)return '';
    if(key==='agent_roles')setRoles({});
    // History failure must remain visible, not undo the acknowledged run.
    const issue=key+': '+failure(error);
    report(key,issue);
    return issue;
   }
  };
  const roleRead=read('agent_roles');
  // The run's own evidence check follows its Core acknowledgement.
  // Optional history display must never postpone that acknowledgement.
  void read('hosted_reference_activity');
  const roleIssue=await roleRead;
  if(seq!==loadSequence.current)return;
  if(strict&&roleIssue)throw Error(roleIssue);
 },[]);
 useEffect(()=>{void load();return()=>{loadSequence.current++}},[load]);
 // The Core history is already durable. Open its newest entry after restart
 // without starting another run; later refreshes preserve manual selection.
 useEffect(()=>{
  if(initialHistory.current||!history.length)return;
  initialHistory.current=true;
  void selectSaved(history[0],true);
 },[history]);
 const {run,busy,message,diagnostic}=useOwnerActions(()=>load(true));
 const runtimeRows=records(roles.runtimes),portfolio=records(roles.portfolio_runtimes);
 const goose=runtimeRows.find(row=>str(row.runtime_id)===GOOSE);
 const qualification=portfolio.find(row=>str(row.runtime_id)===GOOSE);
 const runtimeReady=record(goose?.health).ready===true&&goose?.route_admissible===true;
 const qualified=str(qualification?.qualification_state).startsWith('QUALIFIED_');
 const boundRoles=record(roles.roles);
 const policies=record(record(roles.durable_binding_state).roles);
 const boundToGoose=ROLES.filter(key=>str(record(boundRoles[key]).target_id)===GOOSE);
 const chosenPolicy=record(policies[role]);
 const roleAllowed=Array.isArray(chosenPolicy.allowed_privacy_classes)
  &&chosenPolicy.allowed_privacy_classes.includes('SYNTHETIC');
 const assignable=roles.enabled===true&&!!goose&&runtimeReady&&qualified&&roleAllowed
  &&!boundToGoose.includes(role);
 const groupReady=roles.enabled===true&&boundToGoose.length>0&&ROLES.every(key=>{
  const assigned=record(boundRoles[key]);
  const runtimeId=str(assigned.target_id);
  const active=runtimeRows.find(item=>str(item.runtime_id)===runtimeId);
  const eligible=portfolio.find(item=>str(item.runtime_id)===runtimeId);
  const permitted=record(policies[key]).allowed_privacy_classes;
  return !!active&&record(active.health).ready===true&&active.route_admissible===true
   &&str(eligible?.qualification_state).startsWith('QUALIFIED_')
   &&Array.isArray(permitted)&&permitted.includes('SYNTHETIC');
 });
 const steps=criteriaLines(criteria);
 const canRun=groupReady&&!!objective.trim()&&objective.length<=2000
  &&steps.length>0&&steps.length<=10&&steps.every(line=>new TextEncoder().encode(line).length<=800);
 const current=history.find(row=>str(row.hosted_run_id)===runId);
 const roleName=(key:Role)=>key==='COORDINATOR'?tr('Организатор','Coordinator')
  :key==='WORKER'?tr('Исполнитель','Worker'):tr('Проверяющий','Reviewer');
 const savedState=(value:string)=>value==='AWAITING_HUMAN_VERIFICATION'
  ?tr('Ожидает проверки','Awaiting review')
  :value==='FINALIZED'?tr('Решение сохранено','Review saved')
  :value==='RUNNING'?tr('Выполняется','In progress')
  :value==='FAILED'?tr('Завершилось с ошибкой','Failed')
  :tr('Требуется проверить исход','Outcome needs checking');
 const failedReason=(row:Row)=>{
  const code=str(row.failure_code);
  if(code==='hosted_plan_invalid_json'||code==='hosted_plan_schema_mismatch')
   return tr('Выбранная модель ответила, но не смогла подготовить план в формате IWXA. Попробуйте другую локальную модель или измените формулировку. Предыдущий запуск сохранён; действия не выполнялись.',
    'The selected model replied but could not produce an IWXA-compatible plan. Choose another local model or revise the request. The run is saved; no actions were executed.');
  if(code==='goose_agent_runtime_failed')
   return tr('Goose завершился с ошибкой до получения результата. Проверьте поддержку инструментов выбранной моделью и состояние Goose. Запуск сохранён.',
    'Goose failed before a usable result. Check model tool support and Goose readiness. The run is saved.');
  return tr('Задание завершилось с ошибкой. Основания сохранены, для повторного запуска требуется ваше решение.',
   'The task failed. Evidence is saved and starting again requires your decision.');
 };
 const savedDate=(value:unknown)=>{
  const date=new Date(str(value));
  return Number.isFinite(date.getTime())
   ?date.toLocaleString(language==='ru'?'ru-RU':'en-US',{dateStyle:'short',timeStyle:'short'})
   :tr('Сохранённое задание','Saved task');
 };

 async function assign(){
  if(!assignable||busy||running)return;
  setOutcome('');
  const result=await run<Row>(
   tr('Назначить Goose для выбранной роли? Доступ к личным файлам не предоставляется.',
      'Assign Goose to this role? No private-file access is granted.'),
   'agent_role_switch',{role_id:role,runtime_id:GOOSE},{kind:'agent_role',id:role});
  if(!result)return;
  try{
   const saved=record(await runtime.query<Row>('agent_roles'));
   setRoles(saved);
   if(str(record(record(saved.roles)[role]).target_id)!==GOOSE)
    throw Error('goose_role_binding_readback_mismatch');
   setOutcome(tr('Goose назначен. Можно подготовить учебное задание.','Goose is assigned. You can prepare a sample task.'));
   onChanged?.();
  }catch(e){
   setError(tr('Назначение ещё не подтверждено. Обновите сведения перед повтором.',
    'The assignment is not verified. Refresh before retrying.')+' '+failure(e));
  }
 }

 async function assignMissingRoles(){
  if(busy||running||!goose||!runtimeReady||!qualified||roles.enabled!==true)return;
  const missing=ROLES.filter(key=>str(record(boundRoles[key]).target_id)!==GOOSE);
  if(!missing.length)return;
  if(!missing.every(key=>{
   const allowed=record(policies[key]).allowed_privacy_classes;
   return Array.isArray(allowed)&&allowed.includes('SYNTHETIC');
  })){
   setError(tr('Роли не разрешены для учебных данных.','Roles not eligible for sample data.'));return;
  }
  if(!window.confirm(tr('Назначить Goose на остальные роли учебной группы? Задания не запускаются.',
     'Assign Goose to remaining group roles? No tasks will run.')))return;
  setRunning(true);setError('');setOutcome('');
  try{
   for(const key of missing){
    await runtime.refreshRevision();
    await runtime.command<Row>('agent_role_switch',{role_id:key,runtime_id:GOOSE},{kind:'agent_role',id:key});
    const saved=record(await runtime.query<Row>('agent_roles'));
    setRoles(saved);
    if(str(record(record(saved.roles)[key]).target_id)!==GOOSE)
     throw Error('goose_role_binding_readback_mismatch:'+key);
   }
   setOutcome(tr('Роли сохранены. Можно проверить готовность и запустить учебное задание.',
    'Roles saved. Verify readiness and run a sample task.'));
   onChanged?.();
  }catch(e){
   setError(tr('Часть назначений не подтверждена. Обновите состояние.',
    'Some assignments are unverified. Refresh state.')+' '+failure(e));
   void load();
  }finally{setRunning(false);}
 }

 async function openEvidence(id:string,epoch=++selectionEpoch.current){
  if(!id)return;
  try{
   const data=record(await runtime.query<Row>('hosted_reference_review',{hosted_run_id:id}));
   // The user may have selected another saved run while this read was pending.
   if(epoch!==selectionEpoch.current)return;
   if(str(data.hosted_run_id)!==id||data.evidence_verified!==true)
    throw Error('goose_review_evidence_not_verified');
   setReview(data);
   setRunId(id);
   setOutcome(tr('Результат сохранён. Откройте проверку и примите решение по шагам.',
    'The result is saved. Open the review and decide on each step.'));
  }catch(e){
   if(epoch!==selectionEpoch.current)return;
   setReview(null);setRunId(id);
   setOutcome(tr('Запуск найден, но основания результата пока не подтверждены. Откройте историю заданий.',
    'The run was found, but its evidence is not verified. Open task history.'));
   setError(failure(e));
  }
 }

 async function start(){
  if(busy||running||!canRun)return;
  // A new, explicit run supersedes any pending historical review read.
  // A manual history selection made during the run takes precedence later.
  const launchSelection=++selectionEpoch.current;
  initialHistory.current=true;
  setRunning(true);setReview(null);setRunId('');setOutcome('');setError('');
  let acknowledgedId='';
  try{
   const result=await run<Row>(
    tr('Передать помощникам только учебное задание без личных данных? Результат потребует вашей проверки.',
       'Send a sample-only task to assistants? You must review its result.'),
    'hosted_reference_run',{
     orchestration_id:'hosted_reference',
     objective:objective.trim(),
     acceptance_criteria:steps,
     privacy_class:'SYNTHETIC',
     confirm_hosted_usage:true,
    },{kind:'agent_orchestration',id:'hosted_reference'});
   if(!result||!str(result.hosted_run_id)){
    if(launchSelection===selectionEpoch.current)
     setOutcome(tr('Подтверждение выполнения не получено. Проверьте историю перед новой попыткой.',
      'The run was not acknowledged. Check saved history before another attempt.'));
    return;
   }
   const id=str(result.hosted_run_id);
   acknowledgedId=id;
   // A previous optional history refresh may still return an older snapshot.
   // This direct read of the newly acknowledged run supersedes that refresh.
   const historySequence=++loadSequence.current;
   if(launchSelection===selectionEpoch.current)setRunId(id);
   const saved=record(await runtime.query<Row>('hosted_reference_activity'));
   const rows=records(saved.runs);
   const row=rows.find(entry=>str(entry.hosted_run_id)===id);
   if(historySequence===loadSequence.current)setHistory(rows);
   if(launchSelection!==selectionEpoch.current){
    // The user opened another saved run during execution. Keep that view.
    onChanged?.();
    return;
   }
   if(!row||!validRun(row)){
    setOutcome(tr('Исход задания пока не подтверждён. Проверьте историю, не запускайте его повторно.',
      'The task outcome is not verified. Check history without restarting it.'));
    onChanged?.();
    return;
   }
   await openEvidence(id);
   onChanged?.();
  }catch(e){
   if(launchSelection===selectionEpoch.current){
    setOutcome(acknowledgedId
     ?tr('Запуск '+acknowledgedId+' принят Core, но его исход не удалось прочитать. Откройте сохранённую историю; не запускайте задание повторно.',
        'Run '+acknowledgedId+' was acknowledged by Core, but its outcome could not be read. Open saved history; do not rerun.')
     :tr('Связь прервалась или состояние изменилось. Проверьте историю перед новым запуском.',
        'Connection lost or state changed. Check history before another run.'));
    setError(failure(e));
   }
   if(acknowledgedId)onChanged?.();
  }finally{setRunning(false);}
 }

 async function selectSaved(row:Row,preserveLoadError=false){
  const id=str(row.hosted_run_id);
  if(!/^HREF-[A-Za-z0-9_-]+$/.test(id))return;
  initialHistory.current=true;
  const epoch=++selectionEpoch.current;
  setRunId(id);setReview(null);
  if(!preserveLoadError)setError('');
  setOutcome('');
  if(validRun(row)){
   await openEvidence(id,epoch);
  }else{
   setOutcome(str(row.state)==='FAILED'
    ?failedReason(row)
    :tr('Результат пока неизвестен. Запуск не повторяется автоматически.','The outcome is unknown. Nothing is restarted automatically.'));
  }
 }
 async function restore(){
  if(busy||running)return;
  const epoch=++selectionEpoch.current;
  setOutcome('');setReview(null);
  try{
   const data=record(await runtime.query<Row>('hosted_reference_activity'));
   if(epoch!==selectionEpoch.current)return;
   const saved=records(data.runs);
   setHistory(saved);
   const recent=saved[0];
   if(!recent){
    setRunId('');
    setOutcome(tr('Сохранённых заданий пока нет.','No saved tasks yet.'));
   }else{
    await selectSaved(recent);
   }
  }catch(e){
   if(epoch===selectionEpoch.current)setError(tr('Не удалось прочитать сохранённые задания. Не повторяйте запуск.',
    'Saved tasks could not be read. Do not rerun.')+' '+failure(e));
  }
 }

 return <section className="goose-control" aria-label={tr('Управление Goose','Manage Goose')}>
  <h3>{tr('Работа с Goose','Working with Goose')}</h3>
  <p>{tr('Выберите локальную модель, назначьте Goose и запустите учебное задание. Решение о результате и изменении файлов остаётся за вами.',
   'Select a local model, assign Goose and run a sample task. You control the review and any file changes.')}</p>
  {error&&<OwnerError error={error}/>}
  {message&&<OwnerMessage diagnostic={diagnostic}>{message}</OwnerMessage>}
  <div className="goose-controls"><button type="button" className="secondary-button"
   disabled={busy||running} onClick={()=>void load()}>{tr('Обновить состояние','Refresh status')}</button></div>
  <div className="goose-setup-step">
   <h4>{tr('1. Локальная модель','1. Local model')}</h4>
   <ConversationModelChoice compact localOnly onChanged={()=>{void load();onChanged?.();}}/>
   <p>{runtimeReady
    ?tr('Программа и выбранная модель готовы к разрешённому заданию.',
       'The program and selected model are ready for an authorized task.')
    :goose?.route_admissible===false
      ?tr('Текущий режим Agent не разрешает запуск Goose. Сама программа и модель могут быть исправны.',
       'The current Agent mode does not allow Goose execution. Its program and model may still be healthy.')
      :tr('Если модель или программа не отвечает, проверьте существующее подключение выше.',
       'If the model or program is unavailable, check its existing connection above.')}</p>
  </div>
  <div className="goose-setup-step">
   <h4>{tr('2. Назначение','2. Assignment')}</h4>
   <div className="goose-controls">
    <label>{tr('За что отвечает Goose','Goose role')}
     <select value={role} onChange={event=>setRole(event.target.value as Role)}>
      {ROLES.map(key=><option key={key} value={key}>{roleName(key)}</option>)}
     </select>
    </label>
    <button type="button" disabled={busy||running||!assignable}
     onClick={()=>void assign()}>{boundToGoose.includes(role)
      ?tr('Уже назначен','Already assigned'):tr('Назначить Goose','Assign Goose')}</button>
   </div>
   {runtimeReady&&qualified&&roles.enabled===true&&boundToGoose.length<ROLES.length&&
    <button type="button" className="secondary-button" disabled={busy||running}
     onClick={()=>void assignMissingRoles()}>{tr('Назначить Goose на оставшиеся роли','Assign Goose to remaining roles')}</button>}
   <p>{!qualified?tr('Этот исполнитель пока недоступен для назначения.',
     'This runtime is not yet eligible for assignment.')
    :goose?.route_admissible===false?tr('Запуск Goose недоступен в текущем режиме Agent.',
     'Goose execution is unavailable in the current Agent mode.')
    :!runtimeReady?tr('Сначала подключите Goose и проверьте модель.',
     'Connect Goose and verify the model first.')
    :!roleAllowed?tr('Для этой роли не разрешены учебные данные.',
     'Sample data is not permitted for this role.')
    :boundToGoose.length>0
     ?tr('Назначения сохраняются и используются при следующих заданиях.',
       'Assignments are saved and used for subsequent tasks.')
     :tr('Выберите роль и подтвердите назначение.',
       'Choose a role and confirm the assignment.')}</p>
  </div>
  <div className="goose-setup-step">
   <h4>{tr('3. Выполнение задания','3. Run a task')}</h4>
   <label>{tr('Учебная задача без личных сведений','Sample task without personal information')}
    <textarea rows={3} maxLength={2000} value={objective} onChange={event=>setObjective(event.target.value)}
     placeholder={tr('Например: предложить план запуска небольшого открытого проекта',
      'For example: propose a plan to start a small public project')}/>
   </label>
   <label>{tr('Условия результата, по одному на строку','Acceptance criteria, one per line')}
    <textarea rows={2} maxLength={3200} value={criteria} onChange={event=>setCriteria(event.target.value)}
     placeholder={tr('Например: три последовательных шага','For example: three ordered steps')}/>
   </label>
   {!groupReady&&<p role="status">{tr('Перед запуском организатор, исполнитель и проверяющий должны быть доступны для учебных данных. Goose должен быть назначен хотя бы одной роли.',
     'The coordinator, worker and reviewer must be eligible for sample data, and Goose must hold at least one role.')}</p>}
   <div className="goose-controls">
    <button type="button" disabled={busy||running||!canRun} onClick={()=>void start()}>
     {running?tr('Выполняется…','Running…'):tr('Выполнить задание','Run task')}</button>
    <button type="button" className="secondary-button" disabled={busy||running} onClick={()=>void restore()}>
     {tr('Восстановить результат','Recover result')}</button>
   </div>
   {running&&<p role="status">{tr('Задание выполняется. При потере связи проверьте историю. Повторный запуск не происходит автоматически.',
    'Task is running. If connection is lost, check history. It will not restart automatically.')}</p>}
   {outcome&&<p role="status">{outcome}</p>}
   {review&&<div className="goose-result">
    <strong>{tr('Сохранённое предложение','Saved proposal')}</strong>
    <p>{str(record(review.synthesis).summary)||tr('Итог пока не доступен.','Summary is unavailable.')}</p>
    <p>{tr('Окончательное решение остаётся за человеком.','The final decision remains with you.')}</p>
   </div>}
   {history.length>0&&<div className="goose-saved-runs">
    <strong>{tr('Сохранённые задания группы','Saved group tasks')}</strong>
    <p>{tr('Выберите нужный результат. Открытие истории не запускает помощников повторно.',
      'Choose a result. Opening history does not rerun assistants.')}</p>
    {history.slice(0,8).map(row=><button key={str(row.hosted_run_id)} type="button"
      className={'goose-saved-run'+(str(row.hosted_run_id)===runId?' selected':'')}
      disabled={busy||running} onClick={()=>void selectSaved(row)}>
      <span>{savedDate(row.created_at)}</span><small>{savedState(str(row.state))}</small>
     </button>)}
   </div>}
   {runId&&<p>{current&&validRun(current)
    ?tr('Результат доступен для проверки.','The result is available for review.')
    :tr('Исход ещё не подтверждён. Сначала обновите историю.','The outcome is not verified. Refresh the history first.')}</p>}
   <button type="button" className="secondary-button"
    disabled={busy||running||!runId||!current||!validRun(current)||review?.evidence_verified!==true}
    onClick={()=>onReview(runId)}>{tr('Проверить именно этот результат','Review this result')}</button>
  </div>
  <p className="goose-boundary">{tr('Инструменты и расширения Goose пока отключены. Доступ к личным файлам запрещён. Разрешены только открытые и учебные задания, без действий за пределами IWXA.',
   'Goose tools and extensions are currently disabled. Private-file access is denied. Only public and sample tasks are allowed, without external actions.')}</p>
  <OwnerDetails title={tr('Подтверждения и причины ограничений','Evidence and restrictions')}
   value={{goose_runtime:goose,qualification,assignments:boundRoles,policies,run:history[0],review:review?{run_id:runId,evidence_verified:review.evidence_verified}:null}}/>
 </section>;
}
