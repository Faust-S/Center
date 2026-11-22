import React,{useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {useUiSettings} from './ui-preferences';
import {failure} from './owner-ui';
import {freshWorkflowRequestId,readN8nWorkflowOptions,readN8nWorkflowRequest,prepareN8nWorkflow,type WorkflowOptions} from './n8n-workflow-intent';

/** Propose an authorized n8n process from work without executing it.
 * Recovery always queries the durable occurrence, never issues another POST. */
export function N8nWorkflowProposal({onOpenTask,initialMessage=''}:{
 onOpenTask:(id:string)=>void;initialMessage?:string
}){
 const {tr}=useUiSettings();
 const [options,setOptions]=useState<WorkflowOptions|null>(null);
 const [target,setTarget]=useState(''),[message,setMessage]=useState(initialMessage);
 const [pending,setPending]=useState(''),[result,setResult]=useState('');
 const [previousTask,setPreviousTask]=useState('');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const locked=useRef(false);
 const load=useCallback(async()=>{
  const state=await readN8nWorkflowOptions(runtime);
  setOptions(state);
  if(state.pending_request_id){
   // Reconcile the durable occurrence before allowing a new submission.
   // A completed Task is distinct from a request with an unknown outcome.
   const prior=await readN8nWorkflowRequest(runtime,state.pending_request_id);
   if(prior.state==='READY_FOR_REVIEW'&&prior.task_id){
    setPreviousTask(prior.task_id);
    setPending('');
   }else setPending(state.pending_request_id);
  }else setPending('');
  setTarget(current=>state.targets.some(t=>t.target_id===current)?current:state.targets[0]?.target_id||'');
  return state;
 },[]);
 useEffect(()=>{let active=true;void load().catch(e=>{if(active)setError(failure(e))});
  return()=>{active=false};},[load]);
 async function check(){
  if(locked.current)return;
  locked.current=true;setBusy(true);setError('');
  try{
   const state=await load();
   const request=pending||state.pending_request_id;
   if(!request){setError(tr('Нет отправленного предложения для проверки.','There is no submitted proposal to check.'));return;}
   const observed=await readN8nWorkflowRequest(runtime,request);
   if(observed.state==='READY_FOR_REVIEW'&&observed.task_id){
    setResult(observed.task_id);setPreviousTask(observed.task_id);setPending('');
   }else setError(observed.state==='NOT_FOUND'
    ?tr('Предложение пока не найдено. Не отправляйте его повторно до выяснения результата.','Proposal not found. Do not resend until the outcome is known.')
    :tr('Предложение требует восстановления. Проверьте сохранённую работу.','Proposal needs recovery. Review the saved work.'));
  }catch(e){setError(failure(e))}
  finally{locked.current=false;setBusy(false)}
 }
 async function prepare(){
  if(locked.current||pending||!options||!target||!message.trim()||result)return;
  if(!window.confirm(tr('Создать предложение процесса для отдельной проверки? Сейчас n8n не запускается.','Create a workflow proposal for separate review? n8n will not run yet.')))return;
  locked.current=true;setBusy(true);setError('');
  let id='';
  try{
   id=freshWorkflowRequestId(crypto.getRandomValues(new Uint8Array(16)));
   setPending(id);
   const saved=await prepareN8nWorkflow(runtime,{
    request_id:id,workspace_id:options.workspace_id,workflow_target:target,message
   });
   setResult(saved.task_id);setPreviousTask(saved.task_id);setPending('');
  }catch(e){
   // After the intent is generated, only read-only reconciliation is safe.
   setError(tr('Состояние подготовки не подтверждено. Проверьте его перед новым действием. ','Preparation is not verified. Check its status before another action. ')+failure(e));
  }finally{locked.current=false;setBusy(false)}
 }
 return <div className="advanced-form" aria-label={tr('Подготовить процесс n8n','Prepare n8n workflow')}>
  <h3>{tr('Подготовить процесс n8n','Prepare n8n workflow')}</h3>
  <p>{tr('Создайте задачу для отдельного согласования процесса. Запуск не происходит автоматически.','Create a task for separate workflow approval. Nothing runs automatically.')}</p>
  <button type="button" disabled={busy} onClick={()=>void load().catch(e=>setError(failure(e)))}>{tr('Проверить подключение','Check connection')}</button>
  {options&&<p>{options.local_only
   ?tr('В этой локальной области запуск внешних процессов запрещён.','External workflow execution is disabled in this local workspace.')
   :!options.selected?tr('n8n ещё не выбран как исполнитель процессов.','n8n is not selected as a workflow provider.')
   :options.targets.length===0?tr('Разрешённые процессы не найдены.','No approved workflows were found.')
   :tr('Выберите разрешённый процесс.','Choose an approved workflow.')}</p>}
  <label className="advanced-field">{tr('Процесс','Workflow')}<select value={target} disabled={busy||!!pending}
   onChange={e=>{setTarget(e.target.value);setResult('')}}>
   <option value="">{tr('Выберите процесс','Select a workflow')}</option>
   {options?.targets.map(t=><option value={t.target_id} key={t.target_id}>{t.title}</option>)}
  </select></label>
  <label className="advanced-field">{tr('Поручение','Objective')}<textarea value={message}
   maxLength={4096} disabled={busy||!!pending} onChange={e=>{setMessage(e.target.value);setResult('')}}/></label>
  <button type="button" disabled={busy||!!pending||!!result||!options?.selected||options.local_only||
   !options.targets.some(t=>t.target_id===target)||!message.trim()||new TextEncoder().encode(message).length>4096}
   onClick={()=>void prepare()}>{tr('Подготовить для согласования','Prepare for review')}</button>
  {pending&&<div role="status">
   <p>{tr('Исход предыдущего запроса пока неизвестен. Отправлять повторно нельзя.','Previous request outcome is unknown. Do not resend.')}</p>
   <button type="button" disabled={busy} onClick={()=>void check()}>{tr('Проверить результат','Check outcome')}</button>
  </div>}
  {result&&<><button type="button" onClick={()=>onOpenTask(result)}>{tr('Открыть предложение в задачах','Open proposal in Tasks')}</button>
   <button type="button" className="secondary-button" disabled={busy||!!pending}
    onClick={()=>{setResult('');setMessage('');setError('')}}>{tr('Подготовить другое предложение','Prepare another proposal')}</button></>}
  {previousTask&&previousTask!==result&&<button type="button" className="secondary-button"
   onClick={()=>onOpenTask(previousTask)}>{tr('Ранее сохранённое предложение','Previously saved proposal')}</button>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
