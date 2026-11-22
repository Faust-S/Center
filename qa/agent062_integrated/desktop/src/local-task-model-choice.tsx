import {useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {useUiSettings} from './ui-preferences';
import {record,str,failure,type Row} from './owner-ui';
import {canDiscoverDefaultOllama,hasObservedPin,localModelSource,normalizedLocalDigest,observedLocalModels,type LocalModelPin} from './local-model-route';
export type {LocalModelPin} from './local-model-route';

export const readLocalModelPin=(value:unknown):LocalModelPin|null=>{
 const item=record(value),name=str(item.name),digest=normalizedLocalDigest(item.digest);
 return name&&/^[a-f0-9]{64}$/.test(digest)?{name,digest}:null;
};
const OLLAMA='OLLAMA_LOCAL_V1';

/** Per-dialogue or per-task model choice. The model pin is saved by the caller.
 * Activating a model *provider* is a separate, explicit Core-owned mutation.
 * Never quietly replace the global selected model while choosing a local pin.
 */
export function LocalTaskModelChoice({value,onChange,onOpenModels,onConnected,disabled=false}:{
 value:LocalModelPin|null;onChange:(value:LocalModelPin|null)=>void;onOpenModels?:()=>void;
 onConnected?:()=>void;disabled?:boolean
}){
 const {tr}=useUiSettings();
 const [local,setLocal]=useState<Row>({}),[existing,setExisting]=useState<Row>({});
 const [route,setRoute]=useState<Row>({}),[error,setError]=useState('');
 const [engine,setEngine]=useState<Row>({});
 const [working,setWorking]=useState(false);
 const busy=useRef(false),readSeq=useRef(0);
 const load=useCallback(async()=>{
  const seq=++readSeq.current;
  const results=await Promise.allSettled([
   runtime.query<Row>('local_ai_setup'),runtime.query<Row>('operational_control')
  ]);
  if(seq!==readSeq.current)return;
  const configured=results[0].status==='fulfilled'?record(results[0].value):{};
  const active=results[1].status==='fulfilled'?record(results[1].value):{};
  // Only an observed UNCONFIGURED source allows default-port discovery.
  // A configured IWXA endpoint stays authoritative even while offline;
  // an unreadable Core snapshot must not fall through to another daemon.
  const fallback=results[0].status==='fulfilled'&&canDiscoverDefaultOllama(configured)
   ?await Promise.allSettled([runtime.query<Row>('existing_local_ollama')])
   :null;
  if(seq!==readSeq.current)return;
  const detected=fallback?.[0]?.status==='fulfilled'?record(fallback[0].value):{};
  let currentEngine:Row={};
  let engineIssue='';
  if(active.active_model_provider_id==='IWXA_BASIC_RUNTIME_V1'){
   try{currentEngine=record(await runtime.query<Row>('iwxa_basic_model_status'));}
   catch(e){engineIssue=failure(e);}
  }
  if(seq!==readSeq.current)return;
  // Atomic presentation: an old slow GGUF hash cannot overwrite a newer route.
  setEngine(currentEngine);
  setLocal(configured);setRoute(active);setExisting(detected);
  const problems=results.flatMap(x=>x.status==='rejected'?[failure(x.reason)]:[]);
  if(fallback?.[0]?.status==='rejected')problems.push(failure(fallback[0].reason));
  if(engineIssue)problems.push(engineIssue);
  setError(problems.join(' · '));
 },[]);
 useEffect(()=>{void load();return()=>{readSeq.current+=1;}},[load]);
 const observed=localModelSource(local,existing,route);
 const catalogue=observed.models;
 const connected=observed.active;
 const selected=value?JSON.stringify([value.name,normalizedLocalDigest(value.digest)]):'';
 const selectedAvailable=hasObservedPin(catalogue,value);
 const readyDefault=local.ready_for_activation===true;
 // An obsolete per-work pin must not activate a different global model
 // merely because Ollama's default model is available.
 const canActivate=!disabled&&!working&&!connected&&(!value||selectedAvailable)&&(
  (observed.source==='CONFIGURED'&&(readyDefault||selectedAvailable))||
  (observed.source==='DEFAULT_PORT'&&selectedAvailable));
 async function connect(){
  if(busy.current||disabled||connected||(value&&!selectedAvailable))return;
  busy.current=true;setWorking(true);setError('');
  try{
   const preflight=record(await runtime.query<Row>('local_ai_setup'));
   const verifiedSource=preflight.source_confirmed===true&&preflight.daemon_ready===true;
   if(verifiedSource&&value&&!hasObservedPin(observedLocalModels(preflight.local_models),value))
    throw Error(tr('Закреплённая модель отсутствует в актуальном списке Ollama. Обновите модели, прежде чем подключать источник.',
     'The pinned model is missing from the current Ollama inventory. Refresh models before connecting the provider.'));
   if(!verifiedSource){
    // A previously connected private/custom server must never be replaced by
    // a different default-port process merely because it stopped responding.
    if(!canDiscoverDefaultOllama(preflight))
     throw Error(tr('Настроенный источник Ollama недоступен. Проверьте его в «Моделях»; автоматически переключать сервер нельзя.',
      'The configured Ollama source is unavailable. Check it in Models; switching servers automatically is not allowed.'));
    // Adopt only after explicit selection, a fresh inventory and confirmation.
    const discovered=record(await runtime.query<Row>('existing_local_ollama'));
    if(discovered.responding!==true||!hasObservedPin(observedLocalModels(discovered.models),value))
     throw Error(tr('Выбранная модель отсутствует в работающей Ollama. Обновите список.','The selected model is no longer available in the running Ollama. Refresh the list.'));
    const yes=window.confirm(tr(
     'Подключить найденную Ollama на этом компьютере? Это изменит общий источник моделей IWXA, но не установит программы и не откроет файлы.',
     'Connect the running Ollama? This changes the active IWXA model source without installing software or opening files.'));
    if(!yes)return;
    const beforeAdoption=record(await runtime.query<Row>('local_ai_setup'));
    if(!canDiscoverDefaultOllama(beforeAdoption))
     throw Error('ollama_source_changed_before_connection');
    await runtime.command('local_ai_source_connect',{
     provider_id:OLLAMA,source:'USER_LOOPBACK_ENDPOINT',
     endpoint:'http://127.0.0.1:11434',confirmed:true
    },{kind:'provider',id:OLLAMA});
   }
   let fresh=record(await runtime.query<Row>('local_ai_setup'));
   if(fresh.source_confirmed!==true||fresh.daemon_ready!==true)
    throw Error('ollama_source_readback_unverified');
   if(value&&!hasObservedPin(observedLocalModels(fresh.local_models),value))
    throw Error('ollama_pinned_model_not_available_before_activation');
   if(fresh.ready_for_activation!==true){
    // A per-dialogue pin is not consent to change the global default.
    // Only bootstrap Ollama's provider selection after a SECOND explicit
    // decision, leaving the saved dialogue pin and files untouched on refusal.
    if(!hasObservedPin(observedLocalModels(fresh.local_models),value))
     throw Error(tr('Выберите доступную модель Ollama и повторите подключение.','Select an available Ollama model before connecting.'));
    if(!window.confirm(tr(
     'Общая модель Ollama пока не выбрана. Сделать «'+value!.name+'» моделью по умолчанию для новых диалогов и задач? Выбор только для этой работы сохранится в любом случае.',
     'Ollama has no ready default model. Use "'+value!.name+'" as the default for future conversations and tasks? Your selection for this work stays saved either way.'
    ))){
     setError(tr('Общая модель не изменена. Для работы с этой моделью настройте источник по умолчанию в разделе «Модели».',
      'The default model was not changed. Set up a default source in Models before using this model.'));
     await load();
     return;
    }
    await runtime.command('local_ai_model_select',{
     provider_id:OLLAMA,name:value!.name,digest:normalizedLocalDigest(value!.digest),
     mode:'USER_SELECTED_LOCAL',confirmed:true
    },{kind:'provider',id:OLLAMA});
    fresh=record(await runtime.query<Row>('local_ai_setup'));
    if(fresh.ready_for_activation!==true||str(fresh.selected_model)!==value!.name
      ||normalizedLocalDigest(fresh.selected_model_expected_digest)!==normalizedLocalDigest(value!.digest))
     throw Error('ollama_selected_model_readback_unverified');
   }
   const current=record(await runtime.query<Row>('operational_control'));
   if(current.active_model_provider_id!==OLLAMA){
    await runtime.command('provider_connection_configure',{
     slot_id:'model',provider_id:OLLAMA,values:{},activate:true
    },{kind:'provider',id:OLLAMA});
   }
   const [after,active]=await Promise.all([
    runtime.query<Row>('local_ai_setup'),runtime.query<Row>('operational_control')
   ]);
   if(active.active_model_provider_id!==OLLAMA||after.source_confirmed!==true
     ||after.daemon_ready!==true||after.ready_for_activation!==true
     ||(value&&!hasObservedPin(observedLocalModels(after.local_models),value)))
    throw Error('ollama_activation_readback_unverified');
   await load();onConnected?.();
  }catch(e){
   await load().catch(()=>{});
   setError(tr('Подключение не подтверждено. Сверьте состояние перед повтором. ',
    'Connection is unverified. Read the current state before retrying. ')+failure(e));
  }finally{busy.current=false;setWorking(false);}
 }
 if(route.active_model_provider_id==='IWXA_BASIC_RUNTIME_V1'){
  const pin=readLocalModelPin(engine.pin);
  const ready=engine.ready===true&&engine.active===true&&!!pin;
  const matched=!!value&&!!pin&&value.name===pin.name&&value.digest===pin.digest;
  return <div className="model-choice-controls">
   <label className="advanced-field">{tr('Модель для этой работы','Model for this work')}
    <select value={matched?'engine':value?'stale':'default'} disabled={disabled||working}
     onChange={e=>onChange(e.target.value==='engine'&&ready?pin:null)}>
     <option value="default">{tr('Текущая модель IWXA LLM Engine','Current IWXA LLM Engine model')}</option>
     {ready&&<option value="engine">{tr('Закрепить эту GGUF-модель','Pin this GGUF model')}: {pin!.name}</option>}
     {value&&!matched&&<option value="stale">{value.name} - {tr('требуется повторная проверка','recheck required')}</option>}
    </select>
   </label>
   {!ready&&<p role="status">{tr(
    'IWXA LLM Engine ещё не готов к работе. Выберите и запустите модель в «Моделях».',
    'IWXA LLM Engine is not ready. Select and start a model in Models.')}</p>}
   {error&&<p role="alert">{error}</p>}
   {onOpenModels&&<button type="button" className="mini-button" onClick={onOpenModels}>
    {tr('Управление моделями','Manage models')}</button>}
  </div>;
 }
 return <div className="model-choice-controls">
  <label className="advanced-field">{tr('Модель для этой работы','Model for this work')}
   <select value={selected} disabled={working||disabled} onChange={event=>{
    const next=catalogue.find(item=>JSON.stringify([item.name,item.digest])===event.target.value);
    onChange(next||null);
   }}>
    <option value="">{tr('Использовать модель по умолчанию','Use the default model')}</option>
    {catalogue.map(item=><option key={item.name+item.digest}
     value={JSON.stringify([item.name,item.digest])}>{item.name} · {tr('на компьютере','on this computer')}</option>)}
    {value&&!selectedAvailable&&<option value={selected}>
     {value.name} · {tr('требуется повторная проверка','recheck needed')}</option>}
   </select>
  </label>
  <button type="button" className="mini-button" disabled={working||disabled} onClick={()=>void load()}>
   {tr('Обновить модели','Refresh models')}
  </button>
  {observed.source==='CONFIGURED'&&!connected&&
   <p role="status">{tr('Ollama доступна, но пока не выбрана для новых сообщений и задач.',
    'Ollama is available, but is not the active model source for new messages and tasks.')}</p>}
  {observed.source==='DEFAULT_PORT'&&<p role="status">
   {tr('Обнаружена работающая Ollama. Выберите модель для подключения.',
     'Running Ollama detected. Choose a model to connect.')}</p>}
  {canActivate&&<button type="button" disabled={working||disabled} onClick={()=>void connect()}>
   {working?tr('Подключаем…','Connecting…'):observed.source==='CONFIGURED'
    ?tr('Использовать Ollama для новых сообщений и задач','Use Ollama for new messages and tasks')
    :tr('Подключить работающую Ollama','Connect running Ollama')}
  </button>}
  {!connected&&observed.source==='CONFIGURED'&&!readyDefault&&!selectedAvailable&&
   <p role="status">{tr('Выберите модель из списка, затем подключите её. Выбор для этого диалога не меняет глобальную модель.',
    'Choose an available model, then connect. This dialogue-specific selection does not change the global model.')}</p>}
  {observed.source==='UNAVAILABLE'&&<p role="status">
   {tr('Ollama пока не отвечает. Установленные модели и пользовательские данные не изменены.',
    'Ollama is currently unavailable. Installed models and personal data are unchanged.')}</p>}
  {value&&!selectedAvailable&&<p role="status">
   {tr('Выбранную модель нельзя вызвать до повторной проверки. Выбор остаётся в черновике.',
    'The chosen model needs rechecking before inference. The draft retains your selection.')}</p>}
  {connected&&selectedAvailable&&<small>{tr(
   'Модель закреплена только за этой работой. Общая модель Ollama не изменяется.',
   'This model is pinned to this work only. The global Ollama model is unchanged.')}</small>}
  {error&&<p role="alert">{error}</p>}
  {onOpenModels&&<button type="button" className="mini-button" onClick={onOpenModels}>
   {tr('Управление моделями','Manage models')}</button>}
 </div>;
}
