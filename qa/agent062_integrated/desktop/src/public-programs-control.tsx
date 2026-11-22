import React,{useEffect,useRef,useState} from 'react';
import {runtime,RuntimeRequestError} from './runtime-client/interaction';
import {useUiSettings} from './ui-preferences';
import {programResultReadable,programResultMatchesTask,type ProgramResultSummary} from './program-result-readback';
import {observeSavedProgramOutput} from './program-output-u02.mjs';
import {programReadinessMessage} from './program-readiness-guidance.mjs';
import {programConnectFeedback,currentProgramConnection} from './program-connect-feedback.mjs';

type Operation={operation:string;capability_id:string;can_offer_invocation:boolean;execution_verified:boolean};
type Capability={id:string;kind:string;state:string;reason?:string|null;
 executionConfirmed:boolean;firstUseCandidate:boolean;canOfferInvocation:boolean};
type ProgramCard={programId:string;capabilities:Capability[];highestVerified:string|null};
type PreparedTask={task_id:string;objective:string;status:string;created_at:string;
 read_only:true;execution_performed:false};
type View={workspace_id:string;active_provider_id:string;
 programs:{provider_id:string;program_id:string;display_name:string;expected_version:string;installed:boolean;selected:boolean}[];
 selected:null|{program_id:string;source:{connection_epoch?:string;status?:string;connected?:boolean};operations:Operation[];parameters:Record<string,string[]>};
 program_card:ProgramCard|null;program_card_error:string|null;
 prepared_tasks:PreparedTask[];prepared_tasks_error:string|null;
 recent_results:ProgramResultSummary[];recent_results_error?:string|null};
type Pending={id:string;workspace:string};
const errorMessage=(e:unknown)=>e instanceof Error?e.message:String(e);

/** Extension of Programs, not a separate installer, Task editor or model route. */
export function PublicProgramsControl({onOpenTask}:{onOpenTask:(id:string)=>void}){
 const {tr}=useUiSettings();
 const [view,setView]=useState<View|null>(null),[error,setError]=useState('');
 const [busy,setBusy]=useState(false),[operation,setOperation]=useState('evaluate');
 const [parameters,setParameters]=useState<Record<string,string>>({});
 const [message,setMessage]=useState(''),[pending,setPending]=useState<Pending|null>(null);
 const [connectNotice,setConnectNotice]=useState<{state:string;ru:string;en:string}|null>(null);
 const [output,setOutput]=useState<string|null>(null),[outputPage,setOutputPage]=useState(0);
 const [outputSource,setOutputSource]=useState<{pin:{revision:string;sourceRef:string}}|null>(null);
 const alive=useRef(true),epoch=useRef(0),inFlight=useRef(false);
 async function load():Promise<View|null>{
  const version=++epoch.current;
  const data=await runtime.query<View>('public_programs');
  if(!alive.current||version!==epoch.current)return null;
  if(!Array.isArray(data.programs)||!Array.isArray(data.recent_results)||typeof data.workspace_id!=='string')
   throw Error('u01_program_projection_invalid');
  const operations=data.selected?.operations||[];
  // The connected CLI need not implement "evaluate". Preserve the user's
  // operation if still declared; otherwise select a real first operation.
  setOperation(previous=>operations.some(item=>item.operation===previous)
   ?previous:(operations[0]?.operation||''));
  setView(data);setOutput(null);setOutputSource(null);setOutputPage(0);
  return data;
 }
 useEffect(()=>{alive.current=true;void load().catch(e=>{if(alive.current)setError(errorMessage(e));});
  return()=>{alive.current=false;epoch.current++;};},[]);
 async function action(fn:()=>Promise<unknown>){
  if(inFlight.current)return;
  inFlight.current=true;setBusy(true);setError('');setConnectNotice(null);
  try{await fn();}catch(e){if(alive.current)setError(errorMessage(e));}
  finally{inFlight.current=false;if(alive.current)setBusy(false);}
 }
 async function choose(providerId:string){
  if(!view||pending)return;
  const switching=view.active_provider_id!==providerId;
  if(switching&&!window.confirm(tr(
   'Выбрать эту программу вместо текущего исполнителя программ? Модель и обычные задачи не меняются.',
   'Select this program instead of the current program provider? Models and ordinary tasks stay unchanged.')))return;
  let mutationAttempted=false,readbackStarted=false;
  try{
   if(switching){
    mutationAttempted=true;
    await runtime.command('provider_switch',{slot_id:'workflow_execution',provider_id:providerId},{kind:'provider',id:providerId});
   }
   // A U01 command ACK can contain a failed connection observation. Never
   // assume the command was successful merely because the ACK was accepted.
   mutationAttempted=true;
   const result=await runtime.command<unknown>('public_program_connect',
    {confirmed:true},{kind:'provider',id:providerId});
   setParameters({});setOperation('');
   readbackStarted=true;
   const latest=await load();
   if(alive.current)setConnectNotice(programConnectFeedback(result,providerId,latest));
  }catch(e){
   // A failed or ambiguous switch/connect may have changed the Core-selected
   // provider. Reconcile via ONE read-only query; never replay a command.
   if(mutationAttempted&&!readbackStarted)await load().catch(()=>null);
   throw e;
  }
 }
 async function recover(intent:Pending, releaseAbsent=false){
  const response=await runtime.query<{state:string;task_id:string|null}>('public_program_task_status',{request_id:intent.id});
  if(!alive.current)return;
  if((response.state==='READY_FOR_REVIEW'||response.state==='TASK_AVAILABLE'||
      response.state==='RECOVERY_REQUIRED')&&response.task_id){
   // The Task exists. Open it even if its content requires Core recovery;
   // never dispatch a second draft to replace the existing identity.
   setPending(null);onOpenTask(response.task_id);
  }else if(response.state==='NOT_FOUND'&&releaseAbsent){
   // A draft is not an external CLI action. After a confirmed refusal, or
   // an explicit user-initiated readback, unblock the form without replay.
   setPending(null);
   setError(tr('Сохранённая задача не найдена. Исправьте данные и подготовьте новую задачу; программа не запускалась.',
    'No saved Task was found. Correct the input and prepare a new Task; no program was invoked.'));
  }else{
   setError(tr('Подготовка пока не подтверждена. Проверьте сохранённые задачи; повторный запрос не отправлялся.',
    'Preparation is not yet verified. Inspect saved tasks; no repeat request was sent.'));
  }
 }
 async function prepare(){
  if(!view?.selected||pending||!message.trim())return;
  const available=view.selected.operations.find(row=>row.operation===operation&&row.can_offer_invocation);
  const connection=view.selected.source?.connection_epoch;
  if(!available||!connection)throw Error('u01_program_connection_required');
  const names=view.selected.parameters[operation]||[];
  if(names.length>8)throw Error('u01_program_too_many_parameters');
  const args=Object.fromEntries(names.map(name=>[name,parameters[name]||'']));
  const intent={id:crypto.randomUUID().replace(/-/g,''),workspace:view.workspace_id};
  setPending(intent);
  try{
   const saved=await runtime.command<{task_id:string;execution_performed:boolean}>('public_program_task_draft',{
    request_id:intent.id,workspace_id:intent.workspace,operation,parameters:args,
    connection_epoch:connection,message,confirmed:true
   },{kind:'provider',id:view.active_provider_id});
   if(saved.execution_performed!==false||!saved.task_id)throw Error('u01_task_ack_unverified');
  }catch(e){
   // Only explicit Core refusals let a missing draft free the form.
   // Timeouts/ambiguous acknowledgements may have created the Task.
   // Reconcile first in both cases, and never repeat the command.
   const confirmedRefusal=e instanceof RuntimeRequestError&&
    [400,403,404,409,410,412,422].includes(e.status)&&
    e.code!=='ACTION_OUTCOME_UNCONFIRMED';
   await recover(intent,confirmedRefusal).catch(()=>{throw e;});
   return;
  }
  // A confirmed ACK uses a single read-only lookup. If it fails, keep the
  // pending identity for manual recovery rather than retrying either call.
  await recover(intent);
 }
 async function readResult(receiptId:string){
  if(!view)return;
  const current=view.recent_results.find(row=>row.receipt_id===receiptId);
  if(!current||!programResultReadable(current))throw Error('u01_output_unavailable');
  const version=epoch.current,workspace=view.workspace_id;
  const result=await runtime.query<{workspace_id:string;task_id:string;receipt_id:string;
   output_digest:string;output_verified:boolean;metadata_only:boolean;
   read_only:true;data:{output:string};execution_performed:false}>(
   'public_program_result',{receipt_id:receiptId});
  if(!alive.current||version!==epoch.current)return;
  // Match the same Task/receipt/digest Core proof used by Task Actions.
  // This read-only check must never trigger a second CLI invocation.
  if(result.workspace_id!==workspace||
     !programResultMatchesTask(result,current.task_id,receiptId,current.output_digest||''))
   throw Error('u01_result_readback_invalid');
  // The U02 observation is optional display evidence, not a second Core read.
  const observed=await observeSavedProgramOutput(result).catch(()=>null);
  if(!alive.current||version!==epoch.current)return;
  setOutput(result.data.output);setOutputSource(observed);setOutputPage(0);
 }
 const chosen=view?.selected,ops=chosen?.operations||[];
 const cardOperation=view?.program_card?.capabilities.find(
  item=>item.kind==='OPERATION'&&item.id===ops.find(op=>op.operation===operation)?.capability_id);
 const discovered=view?.program_card?.capabilities.find(item=>item.kind==='DISCOVERY');
 const readiness=programReadinessMessage(cardOperation?.reason,chosen?.source?.status,chosen?.source?.connected);
 const fields=chosen?.parameters[operation]||[];
 const currentConnection=currentProgramConnection(view);
 return <section className="subpage card" aria-label={tr('Дополнительные программы','Additional programs')}>
  <h3>{tr('Дополнительные программы','Additional programs')}</h3>
  <p>{tr('Подключение проверяет версию. Выполнение проходит через обычную задачу и подтверждение действия.',
   'Connection checks the version. Execution uses a normal task and action approval.')}</p>
  <button type="button" disabled={busy} onClick={()=>void action(load)}>{tr('Обновить','Refresh')}</button>
  {error&&<p role="alert">{error}</p>}
  {connectNotice&&<p role="status">{tr(connectNotice.ru,connectNotice.en)}</p>}
  {view&&view.programs.length===0&&<p role="status">{tr(
   'В списке пока нет консольных программ. Проверьте настройки подключения и обновите список.',
   'No command-line programs are configured. Check connection settings and refresh.')}</p>}
  {view&&view.programs.length>0&&view.programs.every(program=>!program.installed)&&<p role="status">{tr(
   'На компьютере не найдены программы для командной строки. Установите нужную и перезапустите IWXA для проверки.',
   'No command-line programs were found on this computer. Install one and restart IWXA to check again.')}</p>}
  {view?.programs.map(program=><div className="owner-row" key={program.provider_id}>
   <strong>{program.display_name}</strong><span>{program.expected_version}</span>
   <span>{program.selected&&currentConnection?.providerId===program.provider_id
    ?tr('Подключена','Connected')
    :program.installed?tr('Обнаружена','Detected'):tr('Не найдена в PATH','Not found in PATH')}</span>
   <button type="button" disabled={busy||!!pending||!program.installed} onClick={()=>void action(()=>choose(program.provider_id))}>
    {program.selected&&currentConnection?.providerId===program.provider_id
     ?tr('Проверить подключение','Verify connection')
     :tr('Подключить и проверить','Connect and verify')}</button>
  </div>)}
  {chosen&&<div className="advanced-form">
   <p role="status">{currentConnection
    ?tr('Программа подключена. Для выполнения действия понадобится отдельное подтверждение.',
      'Program connected. Running an action will require separate approval.')
    :tr('Программа выбрана, но подключение не подтверждено. Нажмите «Подключить и проверить».',
      'Program selected, but its connection is not confirmed. Select “Connect and verify”.')}</p>
   <p>{tr('Выберите действие и опишите ожидаемый результат. Исполнение требует отдельного подтверждения задачи.',
    'Choose an action and describe the outcome. Task execution requires separate approval.')}</p>
   {readiness&&<p role="status">{tr(readiness.ru,readiness.en)}</p>}
   {view?.program_card_error&&<p role="status">{tr(
    'Сведения о готовности действия пока недоступны. Проверьте подключение перед подготовкой задачи.',
    'Action readiness is unavailable. Check the connection before preparing a task.')}</p>}
   <details className="program-technical-details">
    <summary>{tr('Технические сведения','Technical details')}</summary>
    <p>{chosen.program_id}</p>
    {discovered&&<p>{tr('Обнаружение','Discovery')}: {discovered.state}</p>}
    {cardOperation&&<p>{tr('Состояние действия','Operation state')}: {cardOperation.state}
     {cardOperation.firstUseCandidate?tr(' · Первый вызов ещё не подтверждён',' · First invocation not yet confirmed'):''}
     {cardOperation.executionConfirmed?tr(' · Выполнение подтверждено квитанцией',' · Execution confirmed by receipt'):''}
    </p>}
    {cardOperation?.reason&&<code>{cardOperation.reason}</code>}
   </details>
   <label>{tr('Действие','Action')}<select disabled={busy||!!pending} value={operation}
    onChange={e=>{setOperation(e.target.value);setParameters({});}}>
    {ops.map(row=><option key={row.operation} value={row.operation}>{row.operation}</option>)}
   </select></label>
   {fields.length>8&&<p role="status">{tr(
    'Для этой операции объявлено более 8 параметров. Исправьте конфигурацию программы.',
    'This operation declares more than 8 parameters. Update the program configuration.')}</p>}
   {fields.map(name=><label key={name}>{name}<textarea value={parameters[name]||''} disabled={busy||!!pending}
    maxLength={16384} onChange={e=>setParameters(old=>({...old,[name]:e.target.value}))}/></label>)}
   <label>{tr('Что нужно получить','Expected outcome')}<textarea value={message} maxLength={16000}
    disabled={busy||!!pending} onChange={e=>setMessage(e.target.value)}/></label>
   <p>{ops.find(row=>row.operation===operation)?.execution_verified
    ?tr('Предыдущее выполнение подтверждено квитанцией Core.','Previous execution has a verified Core receipt.')
    :tr('Предыдущее выполнение не подтверждено. Первый вызов доступен после проверки подключения.',
     'No previous execution is verified. First use is possible after checking the connection.')}</p>
   <button type="button" disabled={busy||!!pending||!message.trim()||fields.length>8||!ops.find(row=>row.operation===operation)?.can_offer_invocation}
    onClick={()=>void action(prepare)}>{tr('Подготовить обычную задачу','Prepare a normal task')}</button>
   {pending&&<button type="button" disabled={busy} onClick={()=>void action(()=>recover(pending,true))}>
    {tr('Проверить задачу или освободить форму, если её нет',
    'Check saved Task or free the form if absent')}</button>}
  </div>}
  {!!view?.prepared_tasks?.length&&<details>
   <summary>{tr('Подготовленные задачи программ','Prepared program Tasks')}
    {' ('+(view?.prepared_tasks.length??0)+')'}</summary>
   <p>{tr('Связанные с этой Workspace задачи сохранены в Core. Их можно открыть после перезапуска без повторного запуска программы.',
    'Tasks linked to this Workspace are saved in Core. Reopen them after restart without rerunning the program.')}</p>
   {view?.prepared_tasks.map(row=><div className="owner-row" key={row.task_id}>
    <strong>{row.objective}</strong><small>{row.status}</small>
    <button type="button" disabled={busy||!row.read_only||row.execution_performed!==false}
     onClick={()=>onOpenTask(row.task_id)}>{tr('Открыть задачу','Open task')}</button>
   </div>)}
  </details>}
  {view?.prepared_tasks_error&&<p role="status">{tr(
   'Не удалось прочитать историю подготовленных задач. Откройте их через общий список задач.',
   'Prepared-task history is unavailable. Open them from the main Task list.')}</p>}
  {view?.recent_results_error&&<p role="status">{tr(
   'История результатов временно недоступна. Подключение программ и работа с задачами доступны.',
   'Result history is unavailable. You can still connect programs and work with Tasks.')}</p>}
  {!!view?.recent_results.length&&<details><summary>{tr('Сохранённые результаты','Saved results')}</summary>
   {view.recent_results.map(row=><div className="owner-row" key={row.receipt_id}>
    <span>{row.provider_id} · {row.status}</span>
    {programResultReadable(row)&&<small>{tr('Сохранённый вывод проверен','Saved output verified')}</small>}
    {row.status==='SUCCEEDED'&&row.output_state==='UNAVAILABLE'&&<small role="status">{tr(
     'Квитанция сохранена, но вывод недоступен. Повторного запуска не будет.',
     'Receipt is saved, but output is unavailable. No automatic rerun.')}</small>}
    {row.external_effect_state==='UNKNOWN'&&<small role="status">{tr(
     'Исход внешнего действия неизвестен; проверьте его в задаче.',
     'External action outcome is unknown; inspect the Task.')}</small>}
    <button type="button" disabled={busy} onClick={()=>onOpenTask(row.task_id)}>{tr('Открыть задачу','Open task')}</button>
    <button type="button" disabled={busy||!programResultReadable(row)} onClick={()=>void action(()=>readResult(row.receipt_id))}>
     {tr('Прочитать результат','Read result')}</button>
   </div>)}
  </details>}
  {output!==null&&<div>
   {outputSource&&<small>{tr('U02 · Источник результата, только чтение','U02 · Read-only result source')}
    : {outputSource.pin.revision}</small>}
   <pre className="document-text">{output.slice(outputPage*24000,(outputPage+1)*24000)}</pre>
   <button type="button" disabled={outputPage===0} onClick={()=>setOutputPage(n=>n-1)}>{tr('Назад','Previous')}</button>
   <button type="button" disabled={(outputPage+1)*24000>=output.length} onClick={()=>setOutputPage(n=>n+1)}>{tr('Далее','Next')}</button>
  </div>}
 </section>;
}
