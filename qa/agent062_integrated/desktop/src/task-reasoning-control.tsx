/** Fast, optional inline control for the existing model provider's reasoning effort.
 * No parallel Task settings, no model-dependent forced thinking mode.
 * The active provider and persisted limits remain owned by Core.
 */
import {useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {record,records,str,failure,type Row} from './owner-ui';
import {useUiSettings} from './ui-preferences';

type ReasoningPreference={providerId:string;level:string|null};
const levels=new Set(['-1','0','1','2','3']);

export function activeReasoningPreference(data:unknown):ReasoningPreference{
 const setup=record(data);
 const model=records(setup.slots).find(row=>str(row.slot_id)==='model');
 const providerId=str(model?.active_provider_id)||str(setup.active_model_provider_id);
 const provider=records(model?.providers).find(row=>str(row.provider_id)===providerId);
 const field=records(record(provider?.connection).adapter_limit_fields)
  .find(row=>str(row.field_id)==='reasoning_effort_level');
 const level=String(field?.value??'');
 return {providerId,level:levels.has(level)?level:null};
}

/** An unset field means the selected provider has not declared this control.
 * Never invent thinking support or silently switch the user's model.
 */
export function TaskReasoningControl({disabled=false,onPendingChange,onSavingChange}:{
 disabled?:boolean;
 onPendingChange?:(pending:boolean)=>void;
 onSavingChange?:(saving:boolean)=>void;
}){
 const {tr}=useUiSettings();
 const [observed,setObserved]=useState<ReasoningPreference|null>(null);
 const [draft,setDraft]=useState('0');
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const generation=useRef(0),saving=useRef(false);
 const pending=observed?.level!==null&&observed!==null&&draft!==observed.level;

 async function load(){
  const stamp=++generation.current;
  try{
   const row=record(await runtime.query<Row>('user_setup'));
   if(stamp!==generation.current||saving.current)return;
   const next=activeReasoningPreference(row);
   setObserved(next);setDraft(next.level??'0');setError('');
  }catch(e){
   if(stamp!==generation.current||saving.current)return;
   setObserved(null);setError(failure(e));
  }
 }
 useEffect(()=>{
  void load();
  return ()=>{generation.current++;};
 },[]);
 useEffect(()=>{
  onPendingChange?.(pending);
  return ()=>onPendingChange?.(false);
 },[pending,onPendingChange]);
 useEffect(()=>{
  onSavingChange?.(busy);
  return ()=>onSavingChange?.(false);
 },[busy,onSavingChange]);

 async function save(){
  if(disabled||busy||saving.current||!pending||!observed?.providerId
     ||observed.level===null||!levels.has(draft))return;
  const providerId=observed.providerId,requested=draft;
  saving.current=true;setBusy(true);setError('');
  try{
   // Re-observe support before a mutation. A provider switch must not save
   // the former provider's effort as if it controlled the new model.
   const fresh=activeReasoningPreference(await runtime.query<Row>('user_setup'));
   if(fresh.providerId!==providerId||fresh.level===null)
    throw Error('task_reasoning_provider_changed');
   if(fresh.level!==requested){
    await runtime.refreshRevision();
    const receipt=record(await runtime.command<Row>('provider_limits_configure',{
     provider_id:providerId,values:{reasoning_effort_level:Number(requested)}
    },{kind:'provider',id:providerId}));
    if(receipt.durable!==true)throw Error('task_reasoning_save_not_durable');
   }
   const current=activeReasoningPreference(await runtime.query<Row>('user_setup'));
   if(current.providerId!==providerId||current.level!==requested)
    throw Error('task_reasoning_readback_not_confirmed');
   setObserved(current);setDraft(requested);
  }catch(e){
   // Lost ACK: read existing Core settings, never repeat the write.
   try{
    const current=activeReasoningPreference(await runtime.query<Row>('user_setup'));
    if(current.providerId===providerId&&current.level===requested){
     setObserved(current);setDraft(requested);return;
    }
   }catch{/* Preserve the unresolved choice and do not replay a command. */}
   setError(tr('Уровень не подтверждён. Проверьте настройки, прежде чем отправлять новую задачу. ',
    'Effort is not confirmed. Check settings before submitting another Task. ')+failure(e));
  }finally{saving.current=false;setBusy(false);}
 }
 return <div className="task-reasoning-control" role="group"
   aria-label={tr('Глубина рассуждений модели','Model reasoning effort')}>
  <label>{tr('Глубина рассуждений','Reasoning depth')}
   <select aria-label={tr('Глубина рассуждений модели','Model reasoning effort')}
    value={draft} disabled={disabled||busy||!observed||observed.level===null}
    onChange={e=>setDraft(e.target.value)}>
    <option value="0">{tr('Авто: выбор модели','Auto: model default')}</option>
    <option value="-1">{tr('Без рассуждений','No reasoning')}</option>
    <option value="1">{tr('Низкая','Low')}</option>
    <option value="2">{tr('Средняя','Medium')}</option>
    <option value="3">{tr('Высокая','High')}</option>
   </select>
  </label>
  {pending&&<button type="button" className="mini-button"
   disabled={disabled||busy} onClick={()=>void save()}>
   {busy?tr('Сохраняем…','Saving…'):tr('Применить перед отправкой','Apply before sending')}
  </button>}
  {observed&&observed.level===null&&<small>{tr(
   'Активный источник не предоставляет управление рассуждениями. Выбор модели не меняется.',
   'The active provider does not declare reasoning control. Your model selection is unchanged.')}</small>}
  {observed!==null&&observed.level!==null&&<small>{tr(
   'Более высокая глубина может значительно увеличить ожидание, особенно на локальной модели. «Авто» оставляет режим модели. Настройка действует для новых запросов этого источника; текущую задачу она не останавливает.',
   'Higher effort may greatly increase waiting, especially on a local model. Auto leaves the model default. This setting applies to new requests using this provider; it does not stop a running Task.')}</small>}
  {!observed&&<button type="button" className="mini-button"
   disabled={disabled||busy} onClick={()=>void load()}>
   {tr('Прочитать настройку модели','Read model setting')}
  </button>}
  {error&&<p role="alert">{error}</p>}
 </div>;
}
