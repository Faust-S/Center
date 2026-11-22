import {humanState} from './human-language';
import React,{useCallback,useEffect,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {failure,OwnerDetails,OwnerError,record,records,str,useOwnerActions,type Row} from './owner-ui';
import {HelpTip,useUiSettings} from './ui-preferences';
import {LocalTaskModelChoice,readLocalModelPin,type LocalModelPin} from './local-task-model-choice';
import type {WorkHandoff} from './work-handoff';

type Mode='new'|'edit'|'duplicate';
type Schedule='once'|'hourly'|'daily'|'weekly'|'custom';
type Draft={mode:Mode;jobId:string;workspaceId:string;message:string;schedule:Schedule;customMinutes:string;dueLocal:string;memory:boolean;knowledge:boolean;web:boolean;conversationKey:string;localModel:LocalModelPin|null};
type RecoveryDraft={jobId:string;caseId:string;planId:string;approvalId:string;dueLocal:string};

const intervalSeconds:Record<Exclude<Schedule,'once'|'custom'>,number>={hourly:3600,daily:86400,weekly:604800};
const initialDraft=(workspaceId=''):Draft=>({mode:'new',jobId:'',workspaceId,message:'',schedule:'once',customMinutes:'60',dueLocal:'',memory:true,knowledge:false,web:false,conversationKey:'',localModel:null});
const isBlocked=(job:Row)=>job.resume_blocked===true||['RECONCILIATION_REQUIRED','EXTERNAL_EFFECT_UNKNOWN_REQUIRES_RECONCILIATION'].includes(str(job.resume_block_reason));
function toLocalDateTime(value:unknown){
 const d=new Date(str(value));
 if(!Number.isFinite(d.getTime()))return '';
 const p=(n:number)=>String(n).padStart(2,'0');
 return d.getFullYear()+'-'+p(d.getMonth()+1)+'-'+p(d.getDate())+'T'+p(d.getHours())+':'+p(d.getMinutes());
}
function fromJob(job:Row,mode:Mode,activeWorkspaceId:string):Draft{
 const p=record(job.payload),schedule=record(job.schedule);
 const interval=Number(schedule.interval_seconds);
 const kind:Schedule=schedule.kind!=='INTERVAL'?'once':interval===3600?'hourly':interval===86400?'daily':interval===604800?'weekly':'custom';
 return {
  mode,jobId:str(job.job_id),workspaceId:activeWorkspaceId,message:str(p.message),schedule:kind,
  customMinutes:String(Number.isFinite(interval)&&interval>=60?Math.round(interval/60):60),
  dueLocal:mode==='duplicate'?'':toLocalDateTime(job.next_attempt_at),
  memory:p.use_memory!==false,knowledge:p.use_knowledge===true,web:p.use_web===true,
  conversationKey:str(p.conversation_key),localModel:readLocalModelPin(p.local_model)
 };
}
function scheduleInput(draft:Draft):{due_at?:string;interval_seconds?:number}{
 const result:{due_at?:string;interval_seconds?:number}={};
 if(draft.schedule==='custom'){
  const m=Number(draft.customMinutes);
  if(!Number.isInteger(m)||m<1||m>525600)throw new Error('invalid_custom_interval_minutes');
  result.interval_seconds=m*60;
 }else if(draft.schedule!=='once')result.interval_seconds=intervalSeconds[draft.schedule];
 if(draft.dueLocal){
  const d=new Date(draft.dueLocal);
  if(!Number.isFinite(d.getTime())||d.getTime()<Date.now()-5000)throw new Error('invalid_or_past_first_run');
  result.due_at=d.toISOString();
 }
 return result;
}
function timeLabel(value:unknown,locale:string){
 const raw=str(value),d=new Date(raw);
 return raw&&Number.isFinite(d.getTime())?d.toLocaleString(locale==='en'?'en-GB':'ru-RU'):raw||'—';
}

export function AutomationsControl({onOpenTask,onOpenRecovery,onOpenModels,onOpenApprovals,initialHandoff,onHandoffConsumed,focusJobId}:{onOpenTask:(taskId:string)=>void;onOpenRecovery:(caseId:string)=>void;onOpenModels:()=>void;onOpenApprovals:()=>void;initialHandoff?:WorkHandoff;onHandoffConsumed?:()=>void;focusJobId?:string}){
 const {tr,language}=useUiSettings();
 const [jobs,setJobs]=useState<Row[]>([]),[available,setAvailable]=useState(false),[loading,setLoading]=useState(true),[error,setError]=useState('');
 const [areas,setAreas]=useState<{id:string;name:string}[]>([]),[activeAreaId,setActiveAreaId]=useState('');
 const areaName=(id:string)=>areas.find(a=>a.id===id)?.name||id;
 const [draft,setDraft]=useState<Draft|null>(()=>initialHandoff?{
  ...initialDraft(),message:initialHandoff.objective,localModel:initialHandoff.localModel,
  memory:false,knowledge:false,web:false
 }:null),[draftError,setDraftError]=useState('');
 const [importedFromTask]=useState(Boolean(initialHandoff));
 const sourceTaskId=React.useRef(initialHandoff?.sourceTaskId||null);
 useEffect(()=>{if(initialHandoff)onHandoffConsumed?.();},[]);
 const [recovery,setRecovery]=useState<RecoveryDraft|null>(null),[recoveryError,setRecoveryError]=useState('');
 const [selectedJob,setSelectedJob]=useState(()=>focusJobId||'');
 const [historyJobId,setHistoryJobId]=useState(''),[historyRuns,setHistoryRuns]=useState<Row[]>([]);
 const [historyLoading,setHistoryLoading]=useState(false),[historyError,setHistoryError]=useState('');
 const historyRequest=React.useRef(0);
 useEffect(()=>{if(focusJobId)setSelectedJob(focusJobId);},[focusJobId]);
 const load=useCallback(async()=>{
  try{
   const [result,focused,catalog]=await Promise.all([
    runtime.query<Row>('automation_jobs',{limit:100}),
    focusJobId?runtime.query<Row>('automation_jobs',{job_id:focusJobId}):Promise.resolve({jobs:[]} as Row),
    runtime.query<{active_id:string;areas:{id:string;name:string}[]}>('work_areas')
   ]);
   if(!catalog.active_id||!catalog.areas.some(a=>a.id===catalog.active_id))
    throw Error('automation_work_area_readback_invalid');
   setActiveAreaId(catalog.active_id);setAreas(catalog.areas);
   setDraft(previous=>previous&&!previous.workspaceId?{...previous,workspaceId:catalog.active_id}:previous);
   const current=records(focused.jobs);
   if(focusJobId&&(current.length!==1||str(current[0].job_id)!==focusJobId))
    throw Error('focused_automation_readback_unavailable');
   const next=[...current,...records(result.jobs).filter(x=>str(x.job_id)!==focusJobId)];
   setJobs(next);setAvailable(true);setError('');return next;
  }catch(e){setAvailable(false);setError(failure(e));throw e}
  finally{setLoading(false)}
 },[focusJobId]);
 useEffect(()=>{void load().catch(()=>{});},[load]);
 const {run,busy,message}=useOwnerActions(load);
 async function showHistory(jobId:string){
  const request=++historyRequest.current;
  setHistoryJobId(jobId);setHistoryRuns([]);setHistoryError('');setHistoryLoading(true);
  try{
   // The history is a signed DurableAutomation projection from Core, not
   // browser storage and never a request to execute or resume the job.
   const result=await runtime.query<Row>('automation_jobs',{job_id:jobId});
   if(request!==historyRequest.current)return;
   const selected=records(result.jobs);
   if(selected.length!==1||str(selected[0].job_id)!==jobId||
      !Array.isArray(selected[0].run_history))
    throw Error('automation_history_readback_invalid');
   const runs=records(selected[0].run_history);
   if(runs.some(item=>item.read_only!==true||str(item.job_id)!==jobId||
     !/^AJR-[A-Za-z0-9_-]+$/.test(str(item.run_id))||
     !/^[a-f0-9]{64}$/.test(str(item.run_digest))||
     !['SUCCEEDED','FAILED'].includes(str(item.status)))||
     new Set(runs.map(item=>str(item.run_id))).size!==runs.length)
    throw Error('automation_history_identity_invalid');
   setHistoryRuns(runs);
  }catch(error){
   if(request===historyRequest.current)setHistoryError(failure(error));
  }finally{
   if(request===historyRequest.current)setHistoryLoading(false);
  }
 }
 function hideHistory(){
  ++historyRequest.current;setHistoryJobId('');setHistoryRuns([]);
  setHistoryError('');setHistoryLoading(false);
 }
 async function save(){
  if(!draft||!available||busy)return;
  setDraftError('');
  const prompt=draft.message.trim();
  const selectedArea=draft.workspaceId;
  if(!selectedArea||!areas.some(a=>a.id===selectedArea)||selectedArea!==activeAreaId){
   setDraftError(tr('Рабочая область изменилась. Закройте форму и откройте её в нужной области.',
    'The work area changed. Close and reopen the form in the intended area.'));return;
  }
  try{
   const live=await runtime.query<{active_id:string;areas:{id:string;name:string}[]}>('work_areas');
   if(live.active_id!==selectedArea||!live.areas?.some(a=>a.id===selectedArea))
    throw Error('automation_work_area_changed');
  }catch{
   setDraftError(tr('Не удалось подтвердить рабочую область. Задание не отправлено.',
    'Could not verify the work area. The job was not submitted.'));return;
  }
  if(!prompt||prompt.length>32000){setDraftError(tr('Введите текст задания не длиннее 32 000 символов.','Enter a task prompt of no more than 32,000 characters.'));return;}
  let schedule:ReturnType<typeof scheduleInput>;
  try{schedule=scheduleInput(draft)}
  catch(e){setDraftError(str(failure(e))==='invalid_custom_interval_minutes'
    ?tr('Интервал должен быть целым числом минут от 1 до 525600.','Interval must be a whole number of minutes from 1 to 525600.')
    :tr('Дата первого запуска должна быть действительной и не в прошлом.','First run must be a valid future date.'));return;}
  const payload:Row={message:prompt,use_memory:draft.memory,use_knowledge:draft.knowledge,use_web:draft.web,
   ...(draft.conversationKey?{conversation_key:draft.conversationKey}:{}),
   ...(draft.localModel?{local_model:draft.localModel}:{})};
  const isEdit=draft.mode==='edit';
  const original=jobs.find(j=>str(j.job_id)===draft.jobId);
  const originalArea=str(record(original?.payload).workspace_id);
  if(isEdit&&originalArea&&originalArea!==activeAreaId){
   setDraftError(tr('Это расписание относится к другой рабочей области. Переключитесь в неё перед редактированием.',
    'This schedule belongs to another work area. Switch to that area before editing.'));return;
  }
  const command=isEdit?'automation_update_task_prompt':'automation_create';
  const input:Row=isEdit?{job_id:draft.jobId,payload,...schedule,expected_workspace_id:selectedArea}:{job_kind:'task_prompt',payload,...schedule,expected_workspace_id:selectedArea,
    ...(draft.mode==='new'&&sourceTaskId.current?{source_task_id:sourceTaskId.current}:{})};
  const label=isEdit
   ?tr('Сохранить изменения задания? История предыдущих запусков останется в Python Core.','Save changes to this job? Previous run history stays in Python Core.')
   :draft.mode==='duplicate'
    ?tr('Создать новое задание, сохранив историю исходного?','Create a separate job without changing the original history?')
    :tr('Запланировать новую задачу через Python Core?','Schedule a new task through Python Core?');
  const out=await run<Row>(label,command,input,isEdit?{kind:'automation_job',id:draft.jobId}:undefined);
  if(out){setDraft(null);setDraftError('');}
 }
 async function control(job:Row,action:'pause'|'resume'|'cancel'){
  const id=str(job.job_id);if(!id||!available)return;
  await run(tr('Подтвердить '+action+' для '+id+'?','Confirm '+action+' for '+id+'?'),
   'automation_'+action,{job_id:id},{kind:'automation_job',id});
 }
 async function rebind(){
  if(!recovery||!available||busy)return;
  setRecoveryError('');
  if(!/^TPLAN-[A-Za-z0-9-]+$/.test(recovery.planId)||!/^TEAPR-[A-Za-z0-9-]+$/.test(recovery.approvalId)){
   setRecoveryError(tr('Нужны ID новых плана TPLAN- и разрешения TEAPR- после сверки неизвестного действия.','Provide a new TPLAN- plan and TEAPR- approval after reconciling the unknown effect.'));return;
  }
  let due_at:string|undefined;
  if(recovery.dueLocal){
   const date=new Date(recovery.dueLocal);
   if(!Number.isFinite(date.getTime())||date.getTime()<Date.now()-5000){setRecoveryError(tr('Укажите действительную будущую дату.','Select a valid future date.'));return;}
   due_at=date.toISOString();
  }
  const result=await run<Row>(tr('Привязать заново только после сверки результата и получения нового одобрения ToolRuntime?','Rebind only after reconciliation and a new ToolRuntime approval?'),
   'automation_rebind_recovery',{job_id:recovery.jobId,case_id:recovery.caseId,plan_id:recovery.planId,approval_id:recovery.approvalId,...(due_at?{due_at}:{})},
   {kind:'automation_job',id:recovery.jobId});
  if(result)setRecovery(null);
 }
 const pending=jobs.filter(j=>isBlocked(j)||j.state==='DEAD'||Boolean(j.last_error_code));
 return <section className="subpage card advanced">
  <div className="advanced-head"><div><h2>{tr('Автоматизации','Automations')} <HelpTip topic="Автоматизации"/></h2>
   <p>{tr('Настройте задание на нужное время. Каждый запуск сохраняет результат, а действия с файлами потребуют отдельного разрешения.','Schedule recurring work and review each result. File changes require separate approval.')}</p></div>
   <button className="secondary-button" disabled={busy||loading} onClick={()=>void load().catch(()=>{})}>{tr('Обновить','Refresh')}</button></div>
  {error&&<p role="alert" className="advanced-error">{tr('Не удалось получить актуальные задания. Изменения временно недоступны.','Could not load current tasks. Changes are temporarily unavailable.')} {error}</p>}
  {message&&<p role="status" className="advanced-notice">{message}</p>}
  <div className="advanced-form">
   <h3>{tr('Сохранённые задания','Saved jobs')} · {jobs.length}</h3>
   <p>{tr('Требуют внимания:','Need attention:')} {pending.length}. {tr('Последний результат отображается из Core; отсутствие результата не считается успехом.','The last result is read from Core; a missing result is not treated as success.')}</p>
   <button disabled={!available||busy} onClick={()=>{setDraft(initialDraft(activeAreaId));setDraftError('');setRecovery(null);}}>{tr('Создать автоматизацию','Create automation')}</button>
  </div>
  {draft&&<div className="advanced-form">
   {importedFromTask&&<p role="status">{tr('Цель перенесена из задачи. Источники выключены, файлы не переданы. Проверьте текст, модель и время перед созданием расписания.',
     'The objective was copied. Sources are off and files were not transferred. Review the text, model and time before scheduling.')}</p>}
   <h3>{draft.mode==='edit'?tr('Редактировать задание','Edit job'):draft.mode==='duplicate'?tr('Создать копию задания','Duplicate job'):tr('Новое задание','New job')}</h3>
   <p>{tr('Рабочая область: ','Work area: ')}{draft.workspaceId?areaName(draft.workspaceId):tr('Проверяем…','Checking…')}</p>
   {draft.jobId&&<p>{tr('Исходная запись:','Original record:')} {draft.jobId}</p>}
   {draftError&&<p className="advanced-error" role="alert">{draftError}</p>}
   <label className="advanced-field">{tr('Сообщение будущей задаче','Future task prompt')}<textarea rows={4} maxLength={32000} value={draft.message} onChange={e=>setDraft(x=>x?{...x,message:e.target.value}:x)}/></label>
   <LocalTaskModelChoice value={draft.localModel} onChange={localModel=>setDraft(x=>x?{...x,localModel}:x)}
    onOpenModels={onOpenModels} disabled={busy}/>
   {draft.localModel&&<p>{tr('Модель закреплена за заданием. Если она исчезнет или Ollama перестанет быть выбранным источником, выполнение остановится до вашего решения.',
    'This job uses the selected local model. If it becomes unavailable or Ollama is no longer active, the job pauses for your decision.')}</p>}
   <label className="advanced-field">{tr('Расписание','Schedule')}<select value={draft.schedule} onChange={e=>setDraft(x=>x?{...x,schedule:e.target.value as Schedule}:x)}>
    <option value="once">{tr('Один раз','Once')}</option><option value="hourly">{tr('Каждый час','Hourly')}</option><option value="daily">{tr('Каждый день','Daily')}</option><option value="weekly">{tr('Каждую неделю','Weekly')}</option><option value="custom">{tr('Свой интервал','Custom interval')}</option>
   </select></label>
   {draft.schedule==='custom'&&<label className="advanced-field">{tr('Интервал в минутах','Interval in minutes')}<input type="number" min={1} max={525600} step={1} inputMode="numeric" value={draft.customMinutes} onChange={e=>setDraft(x=>x?{...x,customMinutes:e.target.value}:x)}/></label>}
   <label className="advanced-field">{tr('Первый запуск (местное время, необязательно)','First run (local time, optional)')}<input type="datetime-local" value={draft.dueLocal} onChange={e=>setDraft(x=>x?{...x,dueLocal:e.target.value}:x)}/></label>
   {!draft.dueLocal&&<p>{draft.schedule==='once'?tr('Без даты однократное задание будет запланировано немедленно.','Without a date, the one-time task will be scheduled immediately.'):tr('Без даты первый запуск рассчитывается Core от текущего времени.','Without a date, Core calculates the first run from now.')}</p>}
   <div className="composer-options">
    <label><input type="checkbox" checked={draft.memory} onChange={e=>setDraft(x=>x?{...x,memory:e.target.checked}:x)}/>{tr('Память','Memory')}</label>
    <label><input type="checkbox" checked={draft.knowledge} onChange={e=>setDraft(x=>x?{...x,knowledge:e.target.checked}:x)}/>{tr('Знания','Knowledge')}</label>
    <label><input type="checkbox" checked={draft.web} onChange={e=>setDraft(x=>x?{...x,web:e.target.checked}:x)}/>{tr('Интернет','Web')}</label>
   </div>
   <div className="advanced-actions"><button disabled={busy||!available||!draft.message.trim()} onClick={()=>void save()}>{draft.mode==='edit'?tr('Сохранить изменения','Save changes'):draft.mode==='duplicate'?tr('Создать копию','Create copy'):tr('Создать задание','Create job')}</button>
    <button className="secondary-button" disabled={busy} onClick={()=>setDraft(null)}>{tr('Отмена','Cancel')}</button></div>
   <p>{tr('Изменение расписания сохраняет историю выполнений, но формирует новую будущую occurrence; Core проверяет пределы и права.','Editing preserves past executions while scheduling a new future occurrence; Core validates limits and authority.')}</p>
  </div>}
  {recovery&&<div className="advanced-form">
   <h3>{tr('Повторная привязка после восстановления','Rebind after recovery')}</h3>
   {recoveryError&&<p role="alert" className="advanced-error">{recoveryError}</p>}
   <p>{tr('Сначала независимо определите исход предыдущего действия. Новые plan/approval создаются существующим ToolRuntime. Запись без них запрещена.','First reconcile the previous effect independently. A new plan and approval must come from the existing ToolRuntime.')}</p>
   <p>{tr('Случай:','Case:')} {recovery.caseId} · {tr('Задание:','Job:')} {recovery.jobId}</p>
   <label className="advanced-field">{tr('Новый план TPLAN-','New plan TPLAN-')}<input autoComplete="off" value={recovery.planId} onChange={e=>setRecovery(x=>x?{...x,planId:e.target.value.trim()}:x)}/></label>
   <label className="advanced-field">{tr('Новое подтверждение TEAPR-','New approval TEAPR-')}<input autoComplete="off" value={recovery.approvalId} onChange={e=>setRecovery(x=>x?{...x,approvalId:e.target.value.trim()}:x)}/></label>
   <label className="advanced-field">{tr('Новый запуск (необязательно)','Next run (optional)')}<input type="datetime-local" value={recovery.dueLocal} onChange={e=>setRecovery(x=>x?{...x,dueLocal:e.target.value}:x)}/></label>
   <div className="advanced-actions"><button disabled={!available||busy||!recovery.planId||!recovery.approvalId} onClick={()=>void rebind()}>{tr('Проверить и перепривязать через Core','Validate and rebind via Core')}</button>
    <button disabled={busy} className="secondary-button" onClick={()=>setRecovery(null)}>{tr('Закрыть','Close')}</button></div>
  </div>}
  <div className="advanced-form"><h3>{tr('История заданий и результаты','Job history and results')}</h3>
   {loading&&<p>{tr('Загружаю задания…','Loading tasks…')}</p>}
   {!loading&&jobs.length===0&&<p>{tr('Сохранённых заданий нет.','No saved jobs.')}</p>}
   <div className="owner-rows">{jobs.map(job=>{
    const id=str(job.job_id),state=str(job.state),blocked=isBlocked(job),kind=str(job.job_kind),payload=record(job.payload);
    const latest=record(job.latest_run),out=record(latest.result),pinned=readLocalModelPin(payload.local_model);
    const modelIssue=['local_model_requires_active_ollama','local_model_requires_active_local_provider',
     'basic_runtime_model_not_active','basic_runtime_component_changed',
     'basic_runtime_model_pin_changed','basic_runtime_model_digest_changed',
     'basic_model_unavailable','basic_model_chat_metadata_required',
     'warm_engine_not_enabled','warm_engine_executable_changed',
     'warm_engine_output_truncated','warm_engine_finish_reason_unverified',
     'ollama_graph_runtime_not_ready','ollama_graph_model_catalog_changed',
     'ollama_private_endpoint_binding_changed','ollama_model_binding_changed',
     'interactive_model_binding_changed'].includes(str(job.last_error_code));
    const interactive=payload.interactive===true;
    const missingArea=kind==='task_prompt'&&!interactive&&!str(payload.workspace_id);
    const canEdit=kind==='task_prompt'&&!interactive&&!blocked&&['SCHEDULED','PAUSED'].includes(state);
    const canDuplicate=kind==='task_prompt'&&!interactive&&!blocked&&!['RUNNING'].includes(state);
    const canPause=state==='SCHEDULED'&&!blocked;
    const canResume=state==='PAUSED'&&!blocked;
    const canCancel=['SCHEDULED','PAUSED'].includes(state)&&!blocked;
    const caseId=str(job.reconciliation_case_id);
    return <div className="owner-row" key={id} data-selected={id===selectedJob?'true':undefined}>
     <strong>{kind==='task_prompt'?str(payload.message)||id:tr('Одобренное внешнее действие','Approved external action')}</strong>
      {id===selectedJob&&<p role="status">{tr('Открыто задание, связанное с исходной задачей.','Opened the schedule linked to the source task.')}</p>}
     <span>{blocked?tr('Требуется восстановление','Recovery required'):humanState(state,language)}</span>
     {kind==='task_prompt'&&<small>{payload.workspace_id
      ?tr('Рабочая область: ','Work area: ')+areaName(str(payload.workspace_id))
      :tr('Рабочая область пока не закреплена','Work area not bound yet')}</small>}
     {missingArea&&<p role="alert" className="advanced-error">{tr(
      'Это старое расписание необходимо сохранить заново в нужной рабочей области перед исполнением.',
      'Save this older schedule again in the intended work area before it can execute.')}</p>}
     {kind==='task_prompt'&&str(job.last_error_code).startsWith('automation_work_area_')&&<p role="alert" className="advanced-error">{tr(
      'Рабочая область или доступ к источникам изменились. Проверьте расписание и его полномочия.',
      'The work area or source permissions changed. Review the schedule and its permissions.')}</p>}
     <small>{tr('Следующий запуск:','Next run:')} {timeLabel(job.next_attempt_at,language)} · {tr('Попытки:','Attempts:')} {str(job.attempt_count)||'0'}/{str(job.max_attempts)||'—'}</small>
     <small>{str(record(job.schedule).kind)==='INTERVAL'?tr('Повтор каждые ','Repeat every ')+Math.round(Number(record(job.schedule).interval_seconds)/60)+tr(' мин.',' min.'):tr('Однократно','Once')}
      {kind==='task_prompt'?' · '+[payload.use_memory!==false?'Memory':'',payload.use_knowledge===true?'Knowledge':'',payload.use_web===true?'Web':''].filter(Boolean).join(' · '):''}</small>
     {kind==='task_prompt'&&<small>{pinned
      ?tr('Закреплена модель: ','Pinned model: ')+pinned.name
      :tr('Модель определяется при запуске','Model is chosen at run time')}</small>}
     {modelIssue&&<p role="alert" className="advanced-error">{tr('Модель или подключение изменились. Задание остановлено. Проверьте модель в «Моделях», затем продолжите это задание.',
      'The model or connection changed. This job is paused. Check the model in Models, then resume this job.')}
      <button className="mini-button" onClick={onOpenModels}>{tr('Открыть модели','Open models')}</button></p>}
     {blocked&&<p role="alert" className="advanced-error">{tr('Внешний результат неизвестен. Повтор и отмена заблокированы до согласования.','External effect is unknown. Retries and cancellation are blocked until reconciliation.')}
      {!caseId&&kind==='approved_action'&&<span> {tr('Исполнение было прервано. Откройте историю исходной задачи и проверьте результат через восстановление ToolRuntime.',
       'Execution was interrupted. Open the source task and inspect the outcome through ToolRuntime recovery.')}</span>}
     </p>}
     {Boolean(job.last_error_code)&&<><p className="advanced-error">{tr('Последнее выполнение завершилось с ошибкой. Откройте подробности перед повтором.','The latest run failed. Review the details before retrying.')}</p><OwnerDetails title={tr('Причина ошибки','Failure details')} value={{error_code:job.last_error_code}}/></>}
     {Boolean(latest.status)&&<div className="advanced-form">
      <h4>{tr('Последнее выполнение','Latest execution')} · {humanState(latest.status,language)}</h4>
      <p>{tr('Завершено:','Finished:')} {timeLabel(latest.finished_at,language)}</p>
      {out.kind==='task'&&(out.unavailable===true||out.verified!==true)&&<p role="alert">{tr('Сохранённый результат задачи не подтверждён. Проверьте историю перед повтором.','The saved Task result is not verified. Check history before retrying.')}</p>}
      {out.kind==='task'&&out.unavailable!==true&&out.verified===true&&<><p>{str(out.summary)||tr('Итог задачи не сформирован.','No task summary was returned.')}</p>
       {Boolean(out.task_id)&&<button className="secondary-button" onClick={()=>onOpenTask(str(out.task_id))}>{tr('Открыть задачу','Open task')}</button>}</>}
      {out.kind==='approved_action'&&out.verified===true&&<div>
       <p>{out.status==='SUCCEEDED'&&out.external_effect_state==='ACKNOWLEDGED'
        ?tr('Действие выполнено. Квитанция и принадлежность результата подтверждены.', 'The action completed. Its receipt and result identity were verified.')
        :tr('Квитанция получена, но внешний результат требует отдельной проверки.', 'A receipt exists, but the external outcome needs separate review.')}</p>
       {Boolean(out.task_id)&&<button className="secondary-button" onClick={()=>onOpenTask(str(out.task_id))}>{tr('Открыть исходную задачу','Open source task')}</button>}
      </div>}
      {out.kind==='approved_action'&&out.verified===false&&<p role="alert">{tr('Квитанция действия недоступна. Проверьте историю до новых действий.',
       'The action receipt is unavailable. Check history before further actions.')}</p>}
      {Boolean(out.ref_id)&&<p>{tr('Ссылка на результат:','Result reference:')} {str(out.kind)}</p>}
      {latest.status==='FAILED'&&<OwnerDetails title={tr('Причина отказа','Failure reason')} value={{error_code:latest.error_code}}/>}
      {latest.status==='SUCCEEDED'&&!out.kind&&!out.ref_id&&<p>{tr('Выполнение отмечено успешным, но пользовательский результат отсутствует. Перед новым запуском проверьте квитанцию.','Run marked successful but no user-facing result was returned. Inspect receipt before another run.')}</p>}
     </div>}
     <div className="advanced-actions">
      <button type="button" className="secondary-button" disabled={!available}
       onClick={()=>historyJobId===id?hideHistory():void showHistory(id)}>
       {historyJobId===id?tr('Скрыть историю','Hide history'):tr('История запусков','Run history')}
      </button>
      {canPause&&<button disabled={busy||!available} onClick={()=>void control(job,'pause')}>{tr('Пауза','Pause')}</button>}
      {canResume&&<button disabled={busy||!available} onClick={()=>void control(job,'resume')}>{tr('Продолжить','Resume')}</button>}
      {canEdit&&<button disabled={busy||!available} onClick={()=>{setDraft(fromJob(job,'edit',activeAreaId));setDraftError('');setRecovery(null);}}>{tr('Редактировать','Edit')}</button>}
      {canDuplicate&&<button disabled={busy||!available} onClick={()=>{setDraft(fromJob(job,'duplicate',activeAreaId));setDraftError('');setRecovery(null);}}>{tr('Создать копию','Duplicate')}</button>}
      {canCancel&&<button disabled={busy||!available} onClick={()=>void control(job,'cancel')}>{tr('Отменить','Cancel')}</button>}
      {blocked&&!!caseId&&<button disabled={!available} onClick={()=>onOpenRecovery(caseId)}>{tr('Открыть восстановление','Open recovery')}</button>}
      {blocked&&!caseId&&kind==='approved_action'&&<button disabled={!available} onClick={onOpenApprovals}>{tr('Открыть одобренное действие','Open approved action')}</button>}
      {blocked&&kind==='approved_action'&&caseId&&<button disabled={busy||!available} onClick={()=>{setRecovery({jobId:id,caseId,planId:'',approvalId:'',dueLocal:''});setRecoveryError('');setDraft(null);}}>{tr('Новая привязка после сверки','New binding after reconciliation')}</button>}
     </div>
     {historyJobId===id&&<section className="advanced-form" aria-label={tr('История запусков','Run history')}>
      <div className="advanced-actions">
       <h4>{tr('Последние 20 запусков','Last 20 executions')}</h4>
       <button type="button" className="secondary-button" disabled={historyLoading}
        onClick={()=>void showHistory(id)}>{tr('Обновить историю','Refresh history')}</button>
      </div>
      {historyLoading&&<p role="status">{tr('Проверяю сохранённые запуски…','Checking saved executions…')}</p>}
      {historyError&&<p role="alert">{tr('Историю пока не удалось подтвердить. Попробуйте обновить.',
       'The saved history could not be verified. Try refreshing.')}</p>}
      {!historyLoading&&!historyError&&historyRuns.length===0&&<p>{tr('Запусков ещё не было.',
       'No executions yet.')}</p>}
      {!historyLoading&&!historyError&&historyRuns.map(entry=>{
       const result=record(entry.result),kind=str(result.kind);
       const taskConfirmed=kind==='task'&&result.verified===true&&result.unavailable!==true;
       const effectConfirmed=kind==='approved_action'&&result.verified===true
        &&result.status==='SUCCEEDED'&&result.external_effect_state==='ACKNOWLEDGED';
       return <div key={str(entry.run_id)} className="advanced-form">
        <p><strong>{humanState(str(entry.status),language)}</strong>
         {' · '}{timeLabel(entry.finished_at,language)}</p>
        {entry.status==='FAILED'&&<OwnerError error={str(entry.error_code)||'automation_run_failed'}/>}
        {taskConfirmed&&<><p>{str(result.summary)||tr('Результат сохранён. Откройте задачу, чтобы прочитать его.',
         'The result is saved. Open the Task to read it.')}</p>
         <button type="button" className="secondary-button"
          onClick={()=>onOpenTask(str(result.task_id))}>{tr('Открыть результат','Open result')}</button></>}
        {kind==='task'&&!taskConfirmed&&<p role="alert">{tr(
         'Сохранённая ссылка на результат не прошла проверку. Автоматический повтор запрещён.',
         'The stored result link could not be verified. Automatic retry is disabled.')}</p>}
        {effectConfirmed&&<p>{tr('Внешнее действие подтверждено квитанцией.',
         'The external action is confirmed by its receipt.')}</p>}
        {kind==='approved_action'&&!effectConfirmed&&<p role="alert">{tr(
         'Исход внешнего действия требует проверки по квитанции.',
         'The external action needs receipt verification.')}</p>}
        {entry.status==='SUCCEEDED'&&!kind&&<p role="alert">{tr(
         'Запуск отмечен завершённым, но сохранённый результат отсутствует.',
         'The run is marked completed, but the saved result is unavailable.')}</p>}
       </div>;
      })}
     </section>}
     <details><summary>{tr('Основания и идентификаторы Core','Core evidence and identifiers')}</summary><OwnerDetails title={tr('Сохранённая запись','Persisted record')} value={job}/></details>
    </div>;
   })}</div>
  </div>
 </section>;
}
