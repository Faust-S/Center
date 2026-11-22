import React,{useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {record,records,str,failure,OwnerDetails,OwnerError,OwnerMessage,useOwnerActions,type Row} from './owner-ui';
import {HelpTip,useUiSettings} from './ui-preferences';
import {ConversationModelChoice} from './conversation-model-choice';
import {ollamaStageText,type UserReadiness} from './ollama-user-status';
import {ModelLibrary} from './model-library';
import {BasicModelTry} from './basic-model-try';
import {readModelsCoreSnapshot,activeModelPresentation} from './models-core-snapshot';

const OLLAMA='OLLAMA_LOCAL_V1';
const IWXA_ENGINE='IWXA_BASIC_RUNTIME_V1';
function localEndpoint(url:string){
 const match=/^http:\/\/127\.0\.0\.1:([0-9]{1,5})\/?$/.exec(url.trim());
 return !!match&&Number(match[1])>=1&&Number(match[1])<=65535&&Number(match[1])!==8765;
}
/** Thin visual surface: selection, authority, history and secrets belong to Python Core. */
export function ModelsControl({onNavigate,onChanged,onOpenProgram}:{onNavigate:(page:string)=>void;onChanged?:()=>void;onOpenProgram?:(id:string)=>void}){
 const {tr}=useUiSettings();
 const [ai,setAi]=useState<Row>({}),[setup,setSetup]=useState<Row>({}),[ops,setOps]=useState<Row>({}),[status,setStatus]=useState<Row>({});
 const [error,setError]=useState(''),[source,setSource]=useState(''),[endpoint,setEndpoint]=useState('');
 const [pollWarning,setPollWarning]=useState('');
 const [engine,setEngine]=useState<Row>({});
 const [engineLoaded,setEngineLoaded]=useState(false);
 const [routeConfirmed,setRouteConfirmed]=useState(false),[routeLoading,setRouteLoading]=useState(true);
 const [routeId,setRouteId]=useState('NONE');
 const readGeneration=useRef(0);
 const onChangedRef=useRef(onChanged);onChangedRef.current=onChanged;
 const [providerId,setProviderId]=useState('');
 const [compatibility,setCompatibility]=useState<Row|null>(null),[assistantStatus,setAssistantStatus]=useState<Row|null>(null),[assistantBusy,setAssistantBusy]=useState(false);
 const load=useCallback(async(strict=false)=>{
  const generation=++readGeneration.current;
  setRouteLoading(true);
  const snapshot=await readModelsCoreSnapshot(
   name=>runtime.query<Row>(name),
   milliseconds=>new Promise<void>(resolve=>window.setTimeout(resolve,milliseconds)),
   ()=>generation===readGeneration.current);
  if(!snapshot){
   if(strict)throw Error('models_core_readback_superseded');
   return;
  }
  const {values,successful,faults,route}=snapshot;
  if(successful.includes('local_ai_setup')){
   setAi(values.local_ai_setup);
   const local=values.local_ai_setup;
   setSource(str(local.runtime_endpoint_scope)||'IWXA_PRIVATE_LOOPBACK');
   setEndpoint(old=>old||(str(local.runtime_endpoint_scope)==='USER_LOOPBACK_ENDPOINT'
    ?str(local.runtime_endpoint):'http://127.0.0.1:11434'));
  }
  if(successful.includes('user_setup'))setSetup(values.user_setup);
  if(successful.includes('operational_control'))setOps(values.operational_control);
  if(successful.includes('status'))setStatus(values.status);
  if(successful.includes('iwxa_basic_model_status'))setEngine(values.iwxa_basic_model_status);
  setEngineLoaded(successful.includes('iwxa_basic_model_status'));
  const verified=route.issue===null;
  setRouteConfirmed(verified);
  setRouteId(route.route||'NONE');
  setRouteLoading(false);
  setProviderId(old=>old&&old!=='NONE'?old:OLLAMA);
  const errors=faults.map(item=>item.name+': '+failure(item.reason));
  if(route.issue)errors.push(route.issue);
  setError(errors.join(' · '));
  if(strict&&(route.issue||faults.some(item=>
   ['local_ai_setup','user_setup','operational_control'].includes(item.name)
   ||item.name==='iwxa_basic_model_status'&&route.route===IWXA_ENGINE)))
   throw Error(errors.join(' · ')||'models_core_readback_unconfirmed');
 },[]);
 useEffect(()=>{void load();return()=>{readGeneration.current++;};},[load]);
 const downloadState=str(record(ai.materialization).state);
 // Both downloads and model imports belong to the same Core owner.
 // Observe them through one serialized read loop: overlapping interval
 // requests can flood a slow local inference process.
 const operationState=str(record(ai.model_operation).state);
 useEffect(()=>{
  const activeDownload=downloadState==='STARTING'||downloadState==='DOWNLOADING';
  const activeOperation=operationState==='RUNNING';
  if(!activeDownload&&!activeOperation)return;
  let alive=true,failures=0;
  let scheduled:number|undefined;
  const poll=async()=>{
   try{
    const observed=record(await runtime.query<Row>('local_ai_setup'));
    if(!alive)return;
    failures=0;setPollWarning('');
    const nextDownload=str(record(observed.materialization).state);
    const nextOperation=str(record(observed.model_operation).state);
    setAi(observed);
    if((activeDownload&&!['STARTING','DOWNLOADING'].includes(nextDownload))
       ||(activeOperation&&nextOperation!=='RUNNING'))onChangedRef.current?.();
    // Never retry or restart a model transfer here: only read Core status.
    if(['STARTING','DOWNLOADING'].includes(nextDownload)||nextOperation==='RUNNING')
     scheduled=window.setTimeout(()=>void poll(),2200);
   }catch(e){
    if(!alive)return;
    failures+=1;
    if(failures>=3)setPollWarning(tr(
     'Связь с Ollama временно прервана. Проверяем предыдущую операцию без повторного запуска.',
     'Ollama connection interrupted. Checking the existing operation without restarting it.'));
    scheduled=window.setTimeout(()=>void poll(),
      Math.min(12000,2200*Math.pow(2,Math.min(failures,3))));
   }
  };
  scheduled=window.setTimeout(()=>void poll(),1700);
  return()=>{alive=false;if(scheduled!==undefined)window.clearTimeout(scheduled)};
 },[downloadState,operationState,tr]);
 const {run,busy,message,diagnostic}=useOwnerActions(async()=>{await load(true);onChanged?.();});
 const slot=records(setup.slots).find(x=>x.slot_id==='model')||{};
 const providers=records(slot.providers).filter(x=>!['NONE','DEMO_REPLAY_V1'].includes(str(x.provider_id)));
 const provider=providers.find(x=>x.provider_id===providerId);
 const healthy=record(ai.daemon_health);
 const activeHealth=record(setup.active_model_health);
 const fallback=record(status.model_fallback_policy);
  const lastCheck=record(ai.last_inference_check),download=record(ai.materialization);
  const downloadLabel=downloadState==='STARTING'?tr('Подготовка загрузки','Preparing download')
   :downloadState==='DOWNLOADING'?tr('Модель загружается','Model downloading')
   :downloadState==='READY'&&ai.model_identity_qualified===true?tr('Модель загружена и проверена','Model downloaded and verified')
   :downloadState==='READY'?tr('Предыдущая загрузка завершена. Проверьте модель.','Previous download completed. Check model identity.')
   :downloadState==='FAILED'?tr('Загрузка завершилась с ошибкой','Download failed')
   :downloadState==='INTERRUPTED_RECHECK_REQUIRED'?tr('После перезапуска исход загрузки не подтверждён','Download outcome unconfirmed after restart')
   :downloadState==='EVIDENCE_GAP'?tr('Состояние загрузки недоступно','Download status unavailable')
   :tr('Загрузка ещё не запускалась','No download started');
 const route=routeId;
 const localRoute=route===OLLAMA;
 const engineRoute=route===IWXA_ENGINE;
 const usage=records(record(ops.provider_usage).providers).find(x=>x.provider_id===route)||{};
 const sourceId=source==='IWXA_PRIVATE_LOOPBACK'?'IWXA_PRIVATE_LOOPBACK':'USER_LOOPBACK_ENDPOINT';
 const address=sourceId==='IWXA_PRIVATE_LOOPBACK'?str(ai.private_runtime_endpoint):endpoint.trim();
 const sourceReady=ai.source_confirmed===true&&str(ai.runtime_endpoint_scope)===sourceId
   &&(sourceId==='IWXA_PRIVATE_LOOPBACK'
     ||(localEndpoint(address)&&address.replace(/\/$/,'')===str(ai.runtime_endpoint).replace(/\/$/,'')));
 const canResetQualified=sourceId==='IWXA_PRIVATE_LOOPBACK'&&sourceReady&&ai.selection_mode==='USER_SELECTED_LOCAL';
 const readiness=(ai.user_readiness||null) as UserReadiness|null;
 const selectedProvider=providers.find(item=>str(item.provider_id)===route);
 const activeModel=activeModelPresentation(route,engine.pin,ai.selected_model,
  readiness?.response_verified,lastCheck.selection_matches_last_check,
  str(selectedProvider?.display_name)||str(selectedProvider?.name));
 const nextStep=routeLoading
  ?tr('Проверяем, какая модель выбрана для запросов.','Checking which model is selected for requests.')
  :!routeConfirmed
  ?tr('Не удалось подтвердить выбранную модель. Нажмите «Обновить».',
    'Could not confirm the selected model. Select Refresh.')
  :route==='NONE'
  ?tr('Модель для новых запросов пока не выбрана. Выберите модель IWXA или подключите Ollama.',
    'No model is selected for new requests. Choose an IWXA model or connect Ollama.')
  :engineRoute
  ?engine.ready===true
   ?tr('Модель IWXA выбрана. Проверить её ответ можно ниже.',
      'An IWXA model is selected. You can check its response below.')
   :tr('Проверьте выбранную модель IWXA и её файл.',
      'Check the selected IWXA model and its file.')
  :localRoute?ollamaStageText(readiness,tr)
  :tr('Источник модели выбран. Проверьте его работу с помощью запроса.',
    'A model source is selected. Use a request to check that it works.');
 async function connect(){
  if(!address||(sourceId==='USER_LOOPBACK_ENDPOINT'&&!localEndpoint(address))){setError(tr('Только локальный http://127.0.0.1:PORT, порт 8765 запрещён.','Only http://127.0.0.1:PORT is accepted; port 8765 is reserved.'));return;}
  await run(tr('Подтвердить этот локальный источник Ollama и проверить сервер?','Confirm this local Ollama source and probe the server?'),
    'local_ai_source_connect',{provider_id:OLLAMA,source:sourceId,endpoint:address,confirmed:true},{kind:'provider',id:OLLAMA});
 }
 async function inspectInstalled(){
  setCompatibility(null);
  const result=await run<Row>(tr('Найти установленную Ollama и проверить версию и SHA-256, не изменяя её?','Discover an installed Ollama and verify its version and SHA-256 without modifying it?'),
   'check_existing_runtime',{runtime_id:OLLAMA},{kind:'runtime',id:OLLAMA});
  if(result)setCompatibility(record(result));
 }
 async function adoptInstalled(){
  if(!compatibility||compatibility.compatible!==true||!/^[0-9a-f]{64}$/i.test(str(compatibility.compatibility_digest)))return;
  const result=await run<Row>(tr('Подключить найденную Ollama как проверенный системный runtime?','Adopt the verified system Ollama runtime?'),
   'adopt_existing_runtime',{runtime_id:OLLAMA,compatibility_digest:compatibility.compatibility_digest,confirmed:true},{kind:'runtime',id:OLLAMA});
  if(result){setCompatibility(null);setSource('IWXA_PRIVATE_LOOPBACK');}
 }
 async function startExistingOllama(){
  if(str(ai.runtime_source)!=='SYSTEM_ADOPTED')return;
  const result=await run<Row>(tr(
   'Запустить ранее проверенную Ollama на 127.0.0.1? IWXA не меняет выбранную модель, установку и пользовательские файлы.',
   'Start the previously verified Ollama on 127.0.0.1? IWXA will not change your model selection, installation or files.'),
   'local_ai_existing_start',{runtime_id:OLLAMA,confirmed:true},{kind:'runtime',id:OLLAMA});
  if(result&&result.responding===true&&result.endpoint==='http://127.0.0.1:11434'){
   // Startup and connection are separate, human-confirmed actions.
   setSource('USER_LOOPBACK_ENDPOINT');setEndpoint('http://127.0.0.1:11434');
  }
 }
 async function selectManaged(){

  const result=await run<Row>(tr('Выбрать подготовленный в составе продукта Ollama Runtime?','Select the Ollama runtime staged in this product installation?'),
   'use_managed_runtime',{runtime_id:OLLAMA,confirmed:true},{kind:'runtime',id:OLLAMA});
  if(result)setSource('IWXA_PRIVATE_LOOPBACK');
 }
 async function resetQualified(){
  if(!canResetQualified)return;
  // Reuse the Core source-confirmation transition. It discards the old model
  // identity and returns to qualified selection without downloading anything.
  await run(tr('Перейти к модели IWXA? Выбранную ранее модель потребуется подтвердить заново.','Switch to the IWXA model? The previous model will need verification again.'),
    'local_ai_source_connect',{provider_id:OLLAMA,source:'IWXA_PRIVATE_LOOPBACK',endpoint:address,confirmed:true},{kind:'provider',id:OLLAMA});
 }
 async function inspectAssistant(){
  setAssistantStatus(null);setAssistantBusy(true);
  try{
   const snapshot=record(await runtime.query<Row>('agent_roles'));
   if(!Array.isArray(snapshot.runtimes))throw Error('agent_roles_runtime_list_invalid');
   const candidate=records(snapshot.runtimes).find(row=>str(row.runtime_id)==='GOOSE_PRIMARY_V1');
   setAssistantStatus(candidate||{health:{ready:false}});
   setError('');
  }catch(e){setError(failure(e));}
  finally{setAssistantBusy(false);}
 }
 async function activate(){
  if(!provider)return;
  await run(tr('Выбрать этот источник для новых запросов? Сам выбор ещё не подтверждает работу модели.','Use this source for new requests? Selection alone does not verify that the model works.'),
    'provider_connection_configure',{slot_id:'model',provider_id:providerId,values:{},activate:true},{kind:'provider',id:providerId});
 }
 return <section className="subpage card advanced">
  <div className="advanced-head"><div><h2>{tr('Модели','Models')} <HelpTip topic="Модели"/></h2>
   <p>{tr('Выберите модель для запросов. После подключения проверьте её ответ.','Choose a model for requests. After connecting it, check the response.')}</p></div>
   <button className="secondary-button" disabled={busy} onClick={()=>void load()}>{tr('Обновить','Refresh')}</button></div>
  {error&&<OwnerError error={error}/>}
  {pollWarning&&<p role="status" className="advanced-error">{pollWarning}</p>}
  {message&&<OwnerMessage diagnostic={diagnostic}>{message}</OwnerMessage>}
  <div className="advanced-form"><h3>{tr('Следующее действие','Next action')}</h3><p role="status">{nextStep}</p></div>
  <BasicModelTry modelStatus={engineLoaded?engine:null} userSetup={setup} activeProviderId={routeId}
   providerRouteConfirmed={routeConfirmed&&!routeLoading}
   onChanged={()=>{void load();onChanged?.();}}/>
   {routeConfirmed&&!routeLoading?<div className="advanced-form">
   <h3>{tr('Модель для запросов','Model for requests')}</h3>
   <div className="owner-row">
    <strong>{activeModel.kind==='NONE'?tr('Не выбрана','Not selected'):
      activeModel.name||tr('Другой источник','Other source')}</strong>
    <span role="status">{activeModel.kind==='NONE'
      ?tr('Выберите модель ниже','Choose a model below')
      :activeModel.kind==='ENGINE'
      ?tr('Ответ можно проверить отдельно','You can check the response separately')
      :activeModel.responseVerified
      ?tr('Ответ этой модели проверен','This model has a verified response')
      :tr('Ответ пока не проверен','Response not yet verified')}</span>
    {activeModel.kind!=='NONE'&&<small>{activeModel.kind==='ENGINE'?tr('Модель IWXA на этом компьютере','Local IWXA model'):
      activeModel.kind==='OLLAMA'?tr('Модель Ollama на этом компьютере','Local Ollama model'):
      tr('Выбран другой источник','Another source is selected')}</small>}
   </div>
   <OwnerDetails title={tr('Сведения о модели','Model details')} value={{route,activeHealth,healthy,usage,verification:ops.model_verification_state}}/>
  </div>:<div className="advanced-form"><h3>{tr('Модель для запросов','Model for requests')}</h3>
   <p role="status">{routeLoading?tr('Проверяем выбранную модель.','Checking the selected model.'):
    tr('Не удалось узнать, какая модель выбрана. Нажмите «Обновить».',
       'Could not confirm the selected model. Select Refresh.')}</p>
  </div>}
  <div className="advanced-form"><h3>{tr('1. Источник Ollama','1. Ollama source')}</h3>
   <p>{tr('Порядок: установите Ollama, выберите её исполняемый файл и подтвердите локальный источник. Затем запустите сервер, выберите модель и проверьте ответ.','Flow: install Ollama, select its executable and confirm the local source. Then start the server, choose a model, activate it and verify the response.')}</p>
   {sourceId==='IWXA_PRIVATE_LOOPBACK'&&!ai.runtime_staged&&<p role="alert" className="advanced-error">{tr('Ollama Runtime пока не подключён. Команда запуска без исполняемого файла не сработает.','Ollama runtime is not selected. Start cannot work without a verified executable.')}</p>}
   <div className="advanced-actions">
    <button disabled={busy} onClick={()=>onOpenProgram?onOpenProgram(OLLAMA):onNavigate('Программы')}>{tr('Найти или установить Ollama','Find or install Ollama')}</button>
    <button disabled={busy} onClick={()=>void inspectInstalled()}>{tr('1. Найти Ollama на компьютере','1. Discover installed Ollama')}</button>
    <button disabled={busy||ai.runtime_staged!==true||str(ai.runtime_source)!=='IWXA_MANAGED'} onClick={()=>void selectManaged()}>{tr('Выбрать Ollama из пакета IWXA','Select packaged IWXA Ollama')}</button>
   </div>
   {compatibility&&<div className="owner-row">
    <strong>{compatibility.compatible===true?tr('Найдена совместимая Ollama','Compatible Ollama found'):tr('Нет совместимого исполняемого файла','No compatible executable found')}</strong>
    <OwnerDetails value={compatibility} title={tr('Проверка версии и идентичности','Version and identity verification')}/>
    <button disabled={busy||compatibility.compatible!==true||!/^[0-9a-f]{64}$/i.test(str(compatibility.compatibility_digest))}
     onClick={()=>void adoptInstalled()}>{tr('Использовать найденную Ollama','Use discovered Ollama')}</button>
   </div>}
   {str(ai.runtime_source)==='SYSTEM_ADOPTED'&&<div className="owner-row">
    <strong>{tr('Установленная Ollama','Installed Ollama')}</strong>
    <p>{tr(
     'Если установленная Ollama не отвечает, её можно запустить отсюда. Существующие модели сохраняются. Подключение и выбор модели выполняются отдельно.',
     'If installed Ollama is not responding, start it here. Existing models are preserved. Connection and model selection are separate actions.')}</p>
    <button type="button" disabled={busy} onClick={()=>void startExistingOllama()}>
     {tr('Запустить установленную Ollama','Start installed Ollama')}</button>
   </div>}
   {ai.runtime_staged!==true&&<p>{tr('Для собственного сервера IWXA требуется выбранная программа Ollama. Если Ollama уже работает на компьютере, можно подключиться к ней напрямую ниже.','The IWXA private server requires a selected Ollama executable. If Ollama is already running, connect to it directly below.')}</p>}
   <label className="advanced-field">{tr('Тип','Source')}<select value={sourceId} onChange={e=>setSource(e.target.value)}>
    <option value="USER_LOOPBACK_ENDPOINT">{tr('Запущенная пользовательская Ollama','Running user Ollama')}</option>
    <option value="IWXA_PRIVATE_LOOPBACK">{tr('Управляемая IWXA Ollama','Managed IWXA Ollama')}</option></select></label>
   <label className="advanced-field">{tr('Подтверждённый адрес','Endpoint')}<input type="url" autoComplete="off" value={address} readOnly={sourceId==='IWXA_PRIVATE_LOOPBACK'} onChange={e=>setEndpoint(e.target.value)} placeholder="http://127.0.0.1:11434"/></label>
   <div className="advanced-actions">
    <button disabled={busy||!address||sourceReady||(sourceId==='USER_LOOPBACK_ENDPOINT'&&!localEndpoint(address))} onClick={()=>void connect()}>{tr('Подключить и проверить','Connect and probe')}</button>
    <button disabled={busy||sourceId!=='IWXA_PRIVATE_LOOPBACK'||ai.runtime_staged!==true||!sourceReady||ai.daemon_ready===true} onClick={()=>void run(tr('Запустить выбранную Ollama на частном адресе IWXA?','Start the selected Ollama on the IWXA private address?'),'local_ai_runtime_start',{provider_id:OLLAMA,confirmed:true},{kind:'provider',id:OLLAMA})}>{tr('Запустить Ollama','Start Ollama')}</button>
    {canResetQualified&&<button disabled={busy} onClick={()=>void resetQualified()}>{tr('Вернуться к модели IWXA','Switch to IWXA model')}</button>}
   </div>
   <p role="status">{ai.daemon_ready===true?tr('Сервер отвечает.','Server is responding.'):tr('Сервер не отвечает. Проверьте подключение.','Server is unavailable. Check its connection.')}</p><OwnerDetails title={tr('Диагностика сервера','Server diagnostics')} value={healthy}/>
  </div>
  <div className="advanced-form"><h3>{tr('Выберите модель','Choose a model')}</h3>
   <p>{tr('Выберите модель в списке. IWXA сохранит выбор; реальный ответ проверяется отдельной кнопкой. Файлы не открываются.','Choose a model. IWXA saves the selection; use the separate response check to verify inference. No files are opened.')}</p>
   <ConversationModelChoice key={records(ai.local_models).map(r=>str(r.name)+'@'+str(r.digest)).join('|')}
    onChanged={()=>{void load();onChanged?.();}}/>
   <div className="advanced-actions"><button disabled={busy||['STARTING','DOWNLOADING'].includes(downloadState)||sourceId!=='IWXA_PRIVATE_LOOPBACK'||!sourceReady||ai.runtime_staged!==true||ai.selection_mode==='USER_SELECTED_LOCAL'||ai.disk_ready_for_download!==true||ai.model_identity_qualified===true} onClick={()=>void run(
     downloadState==='INTERRUPTED_RECHECK_REQUIRED'
      ?tr('После перезапуска результат прежней загрузки неизвестен. Повторно проверить наличие модели и, если её нет, начать новую загрузку?','The previous download outcome is unknown. Check whether the model is present and start a new download only if needed?')
      :tr('Загрузить квалифицированную локальную модель IWXA?','Download the IWXA-qualified local model?'),
     'local_ai_model_materialize',{provider_id:OLLAMA,confirmed:true},{kind:'provider',id:OLLAMA})}>
      {downloadState==='INTERRUPTED_RECHECK_REQUIRED'?tr('Проверить и возобновить','Check and resume'):tr('Загрузить IWXA','Download IWXA')}</button></div>
   <p role="status">{downloadLabel}</p>
   {downloadState==='INTERRUPTED_RECHECK_REQUIRED'&&<p role="alert">{tr('Проверьте сервер после прерванной загрузки. Новая попытка требует вашего разрешения.','Check the server after the interrupted download. A retry requires your approval.')}</p>}
   <OwnerDetails title={tr('Сведения о загрузке','Download details')} value={download}/>
  </div>
  <ModelLibrary ai={ai} onChanged={async()=>{await load(true);onChanged?.()}}/>
  <details className="programs-advanced"><summary>{tr('Другие источники моделей','Other model sources')}</summary>
  <div className="advanced-form"><h3>{tr('Настройка источника','Configure source')}</h3>
   <label className="advanced-field">{tr('Доступная модель','Available model')}<select value={providerId} onChange={e=>setProviderId(e.target.value)}>
    <option value="">{tr('Выберите','Choose')}</option>{providers.map(x=><option key={str(x.provider_id)} value={str(x.provider_id)}>{str(x.display_name)||str(x.name)||(str(x.provider_id)==='OLLAMA_LOCAL_V1'?'Ollama':tr('Другой источник','Other source'))}</option>)}</select></label>
   {provider&&<p>{tr('Состояние:','Status:')} {record(provider.health).ready===true?tr('Подключение отвечает','Connection responds'):tr('Подключение требует проверки','Connection needs verification')}</p>}
   <div className="advanced-actions">
    <button disabled={busy||!provider||(providerId===OLLAMA&&(ai.ready_for_activation!==true||localRoute))} onClick={()=>void activate()}>{tr('Использовать модель','Use model')}</button>
    <button onClick={()=>onNavigate('Интеграции')}>{tr('Параметры и лимиты','Credentials and limits')}</button>
   </div>
   <div className="advanced-actions">
      <button disabled={busy||!localRoute||ai.ready_for_activation!==true} onClick={()=>void run(
        tr('Проверить реальный ответ локальной модели без файлов и облачного fallback?','Verify a real local model response without files or cloud fallback?'),
        'local_ai_inference_check',{provider_id:OLLAMA,confirmed:true},{kind:'provider',id:OLLAMA})}>{tr('Проверить ответ модели','Verify model response')}</button>
    </div>
    {lastCheck.state==='SUCCEEDED'&&<div className="owner-row"><strong>{tr('Последняя реальная проверка','Last inference check')}</strong>
      <span>{lastCheck.selection_matches_last_check===true?tr('Модель совпадает','Same model'):tr('Модель изменена; требуется новая проверка','Model changed; check again')}</span>
      <small>{str(lastCheck.completed_at)}</small><p>{str(lastCheck.response_excerpt)}</p><OwnerDetails value={lastCheck}/></div>}
   </div>
  </details>
  <div className="advanced-form"><h3>{tr('Использовать модель с Goose','Use this model with Goose')}</h3>
   <p>{tr('Goose получает только открытые или учебные задания. Личные документы остаются в документном маршруте IWXA.','Goose can receive only public or sample tasks. Personal documents remain in the IWXA document workflow.')}</p>
   <div className="advanced-actions">
    <button disabled={busy||assistantBusy} onClick={()=>void inspectAssistant()}>{tr('Проверить Goose','Check Goose')}</button>
    <button disabled={busy} onClick={()=>onOpenProgram?onOpenProgram('GOOSE_PRIMARY_V1'):onNavigate('Программы')}>{tr('Подключить Goose','Connect Goose')}</button>
    <button disabled={busy} onClick={()=>onNavigate('Агенты')}>{tr('Назначить помощника','Assign assistant')}</button>
   </div>
   {assistantBusy&&<p role="status">{tr('Проверяем программу и выбранную модель...','Checking the program and selected model...')}</p>}
   {assistantStatus&&<><p role="status">{record(assistantStatus.health).ready===true
    ?tr('Goose найден, модель доступна. Его ответ проверяется при выполнении задания.','Goose found and model available. A real response is checked when running a task.')
    :tr('Goose пока не готов. Проверьте программу и модель выше.','Goose is not ready. Check the program and model above.')}</p>
    <OwnerDetails title={tr('Проверка Goose','Goose readiness')} value={assistantStatus}/>
   </>}
  </div>
  <div className="advanced-form"><h3>{tr('Конфиденциальность','Privacy')} <HelpTip topic="privacy"/></h3>
   <p>{!routeConfirmed||routeLoading
    ?tr('Источник запроса пока не подтверждён. Проверьте выбранную модель перед работой с личными документами.','The request source is not confirmed. Check the selected model before working with personal documents.')
    :localRoute||engineRoute
    ?tr('Выбран локальный маршрут. Для локальных документов Core исключает память, Web и другие внешние источники.','The local route is selected. Core excludes memory, web and other external sources for local documents.')
    :route==='NONE'&&str(record(engine.pin).name)
    ?tr('GGUF-модель сохранена, но не назначена для новых диалогов и задач.','The GGUF model is selected but is not active for new conversations or tasks.')
    :tr('Локальная модель не выбрана. Для PRIVATE и внешних моделей действуют отдельные проверки Core; локальные документы требуют проверенного локального маршрута.','No local model is selected. PRIVATE/external model routes require separate Core checks; local documents require a verified local route.')}</p>
   <p>{tr('Для работы с личными документами требуется проверенная локальная модель. Переключение источника не расширяет разрешения на передачу данных.',
    'Working with private documents requires a verified local model. Switching sources does not extend data-sharing permissions.')}</p>
   <OwnerDetails title={tr('Маршрутизация и ограничения','Routing and restrictions')}
    value={{fallback,route_authority:status.vds_control,operational_control:{readiness:ops.readiness,blockers:ops.blockers,warnings:ops.warnings,configured_agent_routes:ops.configured_agent_routes}}}/>
  </div>
 </section>;
}
