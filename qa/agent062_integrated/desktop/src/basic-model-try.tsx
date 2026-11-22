import React,{useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {record,str,failure,type Row} from './owner-ui';
import {useUiSettings} from './ui-preferences';
import {draftMatchesSavedGguf,planGgufDraftHydration,savedGgufDraft} from './basic-model-selection';

const GGUF_PROVIDER='IWXA_BASIC_GGUF_V1';
const ADDON_PROVIDER='IWXA_BASIC_RUNTIME_ADDON_V1';
const IWXA_PROVIDER='IWXA_BASIC_RUNTIME_V1';

// Only fixed Core-owned native error codes become user guidance.
// Model responses and arbitrary provider text are not surfaced as diagnoses.
function modelTryError(e:unknown,tr:(ru:string,en:string)=>string):string{
 const code=e instanceof Error?e.message:String(e);
 switch(code){
  case 'basic_runtime_timeout':return tr(
   'Проверка не уложилась в лимит времени. Локальная модель могла загружаться или рассуждать слишком долго. Вы можете изменить глубину рассуждений или выбрать другую модель.',
   'The test exceeded its time limit. A local model may have been loading or reasoning too long. You can change reasoning effort or choose another model.');
  case 'basic_runtime_output_invalid':return tr(
   'Окончательный текст ответа не подтверждён. Возможно, модель не завершила рассуждения в рамках лимита проверки. Это не оценка качества модели. Проверьте глубину рассуждений или увеличьте лимит проверочного ответа и повторите по желанию.',
   'A complete final answer was not confirmed. The model may not have finished reasoning within the test limit. This is not a model-quality score. Review the selected effort or increase the test output limit, then retry if you wish.');
  case 'basic_runtime_generation_failed':return tr(
   'Локальный процесс модели завершился с ошибкой. Откройте состояние движка и выбранного файла GGUF. Задача не запускалась.',
   'The local model process failed. Inspect the engine and selected GGUF file. No Task was started.');
  case 'basic_runtime_busy':return tr(
   'Локальная модель уже обрабатывает другой запрос. Дождитесь завершения либо остановите модель явно.',
   'The local model is busy with another request. Wait or explicitly stop the model.');
  case 'basic_runtime_reasoning_effort_invalid':return tr(
   'Выбранный уровень рассуждений не принят движком. Верните Авто или выберите поддерживаемый режим.',
   'The engine rejected the selected reasoning effort. Choose Auto or another supported level.');
  case 'basic_runtime_start_failed':return tr(
   'Не удалось запустить локальный процесс модели. Проверьте установленный движок.',
   'Could not start the local model process. Inspect the installed engine.');
  case 'basic_runtime_executable_changed':return tr(
   'Исполняемый файл движка изменился после проверки. Повторно проверьте установку.',
   'The engine executable changed after verification. Verify the installation again.');
  default:return failure(e);
 }
}

// Read back the existing provider preference. No duplicate model store.
function reasoningFromSetup(data:Row):string|null{
 const slots=Array.isArray(data.slots)?data.slots.map(record):[];
 const model=slots.find(item=>str(item.slot_id)==='model');
 const profiles=Array.isArray(model?.providers)?model.providers.map(record):[];
 const profile=profiles.find(item=>str(item.provider_id)===IWXA_PROVIDER);
 const fields=record(profile?.connection).adapter_limit_fields;
 const field=Array.isArray(fields)?fields.map(record).find(item=>str(item.field_id)==='reasoning_effort_level'):null;
 if(!field||field.value===undefined)return null;
 const level=Number(field.value);
 return Number.isInteger(level)&&level>=-1&&level<=3?String(level):null;
}


export function BasicModelTry({onChanged,modelStatus,userSetup,activeProviderId,providerRouteConfirmed}:{onChanged?:()=>void;modelStatus:Row|null;userSetup:Row;activeProviderId:string;providerRouteConfirmed:boolean}){
 const {tr,t3Enabled,t3Busy,setT3}=useUiSettings();
 const [addonStatus,setAddonStatus]=useState<Row|null>(null);
 const [addonPlan,setAddonPlan]=useState<Row|null>(null);
 const [runtimeVersions,setRuntimeVersions]=useState<Row|null>(null);
 const [candidateVersion,setCandidateVersion]=useState("b11836");
 const [selectedBasic,setSelectedBasic]=useState<Row|null>(null);
 const [warmStatus,setWarmStatus]=useState<Row|null>(null);
 const [basicLicense,setBasicLicense]=useState("");
 const [basicSource,setBasicSource]=useState("");
 const [offers,setOffers]=useState<Row[]>([]);
 const [offerId,setOfferId]=useState("QWEN3_0_6B_Q8_0");
 const [ggufFile,setGgufFile]=useState<Row|null>(null);
 const [llamaFile,setLlamaFile]=useState<Row|null>(null);
 const [busy,setBusy]=useState(false);
  const [verifying,setVerifying]=useState(false);
  const [testSeconds,setTestSeconds]=useState(0);
  const [testTokenLimit,setTestTokenLimit]=useState<128|256|512>(128);
  const [stoppingTest,setStoppingTest]=useState(false);
  const stopTestInFlight=useRef(false),stopRequestedForTry=useRef(false);
  useEffect(()=>{
   if(!verifying){setTestSeconds(0);return;}
   const start=Date.now();
   const ticker=window.setInterval(()=>setTestSeconds(
    Math.max(0,Math.floor((Date.now()-start)/1000))),1000);
   return()=>window.clearInterval(ticker);
  },[verifying]);
 const [error,setError]=useState('');
 const [result,setResult]=useState<Row|null>(null);
 const [savedReasoning,setSavedReasoning]=useState<string|null>(null);
 const [reasoning,setReasoning]=useState('0');
 const reasoningSavingRef=useRef(false);
 const reasoningDraftRef=useRef(false);
 const modelIsActiveProvider=providerRouteConfirmed&&activeProviderId===IWXA_PROVIDER;
 const hydratedIdentity=useRef('');
 const draftPendingRef=useRef(false);
 const [draftPending,setDraftPending]=useState(false);
 const markDraftPending=()=>{draftPendingRef.current=true;setDraftPending(true);};
 const clearDraftPending=()=>{draftPendingRef.current=false;setDraftPending(false);};
 const discardDraft=()=>{
  const saved=savedGgufDraft(modelStatus);
  hydratedIdentity.current=saved?.identity||'';
  clearDraftPending();
  setGgufFile(saved?.file||null);
  setBasicLicense(saved?.license||'');
  setBasicSource(saved?.source||'');
 };
 useEffect(()=>{
  if(!modelStatus){setSelectedBasic(null);return;}
  const selected=record(modelStatus);
  setSelectedBasic(selected);
  const plan=planGgufDraftHydration(selected,hydratedIdentity.current,draftPendingRef.current);
  hydratedIdentity.current=plan.identity;
  if(plan.replaceDraft){
   setGgufFile(plan.saved?.file||null);
   setBasicLicense(plan.saved?.license||'');
   setBasicSource(plan.saved?.source||'');
  }
 },[modelStatus]);
 useEffect(()=>{
  let active=true;
  void Promise.allSettled([
   runtime.query<Row>('iwxa_basic_runtime_status'),
   runtime.query<Row>('iwxa_basic_runtime_plan'),
   runtime.query<Row>('iwxa_basic_runtime_versions'),
   runtime.query<Row>('iwxa_llm_warm_status'),
   runtime.query<Row>('iwxa_basic_model_offers')
  ]).then(rows=>{
   if(!active)return;
   if(rows[0].status==='fulfilled')setAddonStatus(record(rows[0].value));
   if(rows[1].status==='fulfilled')setAddonPlan(record(rows[1].value));
   if(rows[2].status==='fulfilled')setRuntimeVersions(record(rows[2].value));
   if(rows[3].status==='fulfilled')setWarmStatus(record(rows[3].value));
   if(rows[4].status==='fulfilled'){
    const offers=record(rows[4].value);
    setOffers(Array.isArray(offers.offers)?offers.offers as Row[]:[]);
   }
  });
  return ()=>{active=false;};
 },[]);
 // Reuse the already loaded parent Core snapshot instead of an extra startup read.
 // Parent refreshes must not replace a pending choice made by the user.
 useEffect(()=>{
  const level=reasoningFromSetup(userSetup);
  setSavedReasoning(level);
  if(level!==null&&!reasoningSavingRef.current&&!reasoningDraftRef.current)
   setReasoning(level);
 },[userSetup]);
 async function addonRefresh(){
  try{
   const [status,plan,versions]=await Promise.all([
    runtime.query<Row>('iwxa_basic_runtime_status'),
    runtime.query<Row>('iwxa_basic_runtime_plan'),
    runtime.query<Row>('iwxa_basic_runtime_versions')]);
   const state=record(status),details=record(plan);
   setAddonStatus(state);setAddonPlan(details);setRuntimeVersions(record(versions));
   if(state.verified===true&&str(state.executable)&&/^[a-f0-9]{64}$/.test(str(state.runtime_sha256))){
    setLlamaFile({path:state.executable,name:'llama-cli.exe',sha256:state.runtime_sha256});
   }
  }catch(e){setError(failure(e));}
 }
 async function changeModelSetupMode(nextEnabled:boolean){
  if(busy||t3Busy||t3Enabled===null||t3Enabled===nextEnabled)return;
  const explanation=nextEnabled
   ?tr('Включить автономный режим T3? Локальная модель продолжит работать, но внешние подключения и новые сетевые загрузки будут недоступны.',
     'Enable offline T3 mode? The local model will continue to work, but external connections and new downloads will be unavailable.')
   :tr('Отключить автономный режим T3 для подготовки модели? Пока он выключен, могут быть доступны и другие внешние подключения. После загрузки включите T3 снова.',
     'Disable offline T3 mode to prepare a model? Other external connections may become available until you re-enable T3 after downloading.');
  if(!window.confirm(explanation))return;
  try{
   await setT3(nextEnabled);
   // The shared preference callback reports failures through presentation
   // state, so confirm Core readback before offering a network download.
   const observed=record(await runtime.query<Row>('ui_preferences'));
   if(observed.persisted!==true||observed.t3_enabled!==nextEnabled)
    throw Error('t3_model_setup_mode_unverified');
   setError('');
  }catch(e){setError(failure(e));}
 }
 async function addonInstall(){
  if(busy||t3Enabled!==false)return;
  setBusy(true);setError('');setResult(null);
  try{
   const plan=record(await runtime.query<Row>('iwxa_basic_runtime_plan'));
   if(plan.runtime_id!==ADDON_PROVIDER||!str(plan.plan_sha256)||!str(plan.source)||!str(plan.archive_sha256))
    throw Error('addon_install_plan_unavailable');
   setAddonPlan(plan);
   const consent=window.confirm(tr(
    'Установить движок IWXA LLM Engine на основе llama.cpp (MIT)? Источник: '+str(plan.source)+'. Размер: '+String(plan.archive_size_bytes)+' байт. Загружается только вычислительный компонент, без моделей.',
    'Install the optional IWXA LLM Engine based on llama.cpp (MIT)? Source: '+str(plan.source)+'. Size: '+String(plan.archive_size_bytes)+' bytes. No model weights are downloaded.'));
   if(!consent)return;
   await runtime.refreshRevision();
   const installed=record(await runtime.command<Row>('iwxa_basic_runtime_install',{
    provider_id:ADDON_PROVIDER,plan_sha256:str(plan.plan_sha256),confirmed:true,accept_license:true
   },{kind:'provider',id:ADDON_PROVIDER}));
   if(installed.verified!==true||!str(installed.executable)||!/^[a-f0-9]{64}$/.test(str(installed.runtime_sha256)))
    throw Error('addon_install_readback_missing');
   await addonRefresh();
  }catch(e){setError(failure(e));}finally{setBusy(false);}
 }
 async function loadOffers(){
  try{
   const observed=record(await runtime.query<Row>('iwxa_basic_model_offers'));
   setOffers(Array.isArray(observed.offers)?observed.offers as Row[]:[]);
  }catch(e){setError(failure(e));}
 }
 async function downloadOfficial(){
  if(busy||t3Enabled!==false)return;
  setBusy(true);setError('');setResult(null);
  try{
   const plan=record(await runtime.query<Row>('iwxa_basic_model_download_plan',{model_id:offerId}));
   if(plan.model_id!==offerId||!str(plan.plan_sha256)||!str(plan.sha256)||!str(plan.license))throw Error('official_model_plan_invalid');
   const consent=window.confirm(tr(
    'Скачать модель '+str(plan.name)+' ('+Math.round(Number(plan.size_bytes)/1048576)+' МиБ) из '+str(plan.repository)+'? Лицензия '+str(plan.license)+'. Весовые файлы сохраняются отдельно и не запускаются автоматически.',
    'Download '+str(plan.name)+' ('+Math.round(Number(plan.size_bytes)/1048576)+' MiB) from '+str(plan.repository)+'? License: '+str(plan.license)+'. Weights are stored separately and not started automatically.'));
   if(!consent)return;
   await runtime.refreshRevision();
   const finished=record(await runtime.command<Row>('iwxa_basic_model_download',{
     provider_id:IWXA_PROVIDER,model_id:offerId,plan_sha256:str(plan.plan_sha256),
     confirmed:true,accept_license:true
   },{kind:'provider',id:IWXA_PROVIDER}));
   if(str(finished.sha256)!==str(plan.sha256)||!str(finished.file_path)||finished.model_usable_after_selection!==true)
     throw Error('official_model_download_unverified');
   markDraftPending();
   setGgufFile({kind:'MODEL',selected:true,path:finished.file_path,
     sha256:finished.sha256,name:str(plan.name),size_bytes:plan.size_bytes});
   setBasicLicense(str(plan.license));setBasicSource(str(plan.source));
  }catch(e){setError(failure(e));}finally{setBusy(false);}
 }
 async function installOtherVersion(){
  if(busy||t3Enabled!==false)return;
  setBusy(true);setError('');
  try{
   const plan=record(await runtime.query<Row>('iwxa_basic_runtime_plan',{version:candidateVersion}));
   if(str(plan.version)!==candidateVersion||!str(plan.plan_sha256))throw Error('runtime_release_plan_invalid');
   if(!window.confirm(tr('Установить версию '+candidateVersion+' отдельно? Рабочая версия не изменится. Источник: '+str(plan.source)+'. Лицензия MIT.',
      'Install '+candidateVersion+' separately? Your active runtime will remain unchanged. Source: '+str(plan.source)+'. MIT license.')))return;
   await runtime.refreshRevision();
   const receipt=record(await runtime.command<Row>('iwxa_basic_runtime_install',{
    provider_id:ADDON_PROVIDER,version:candidateVersion,plan_sha256:str(plan.plan_sha256),
    confirmed:true,accept_license:true},{kind:'provider',id:ADDON_PROVIDER}));
   if(receipt.verified!==true||str(receipt.version)!==candidateVersion)throw Error('runtime_release_receipt_invalid');
   await addonRefresh();
  }catch(e){setError(failure(e));}finally{setBusy(false);}
 }
 async function switchRuntime(version:string){
  if(busy||!version)return;
  if(!window.confirm(tr('Использовать версию '+version+' для следующих запусков модели? Предыдущая версия останется доступной.',
      'Use '+version+' for future inference? The previous runtime remains installed.')))return;
  setBusy(true);setError('');
  try{
   await runtime.refreshRevision();
   const changed=record(await runtime.command<Row>('iwxa_basic_runtime_switch',{
    provider_id:ADDON_PROVIDER,version,confirmed:true},{kind:'provider',id:ADDON_PROVIDER}));
   if(changed.active_version!==version||changed.active_verified!==true)throw Error('runtime_switch_readback_failed');
   await addonRefresh();await basicRefresh();
  }catch(e){setError(failure(e));}finally{setBusy(false);}
 }
 async function warmRefresh(){
  try{setWarmStatus(record(await runtime.query<Row>('iwxa_llm_warm_status')));}
  catch(e){setError(failure(e));}
 }
 async function warmControl(enabled:boolean){
  if(busy)return;
  const approved=window.confirm(enabled?
   tr('Включить ускоренный режим? Модель останется в памяти между запросами до 90 секунд простоя. Для этого IWXA запускает собственный процесс на 127.0.0.1; отключить его можно здесь.',
      'Enable faster inference? IWXA keeps the model loaded for up to 90 idle seconds. An IWXA-owned process listens on 127.0.0.1 and can be stopped here.'):
   tr('Отключить ускоренный режим и освободить память?','Disable warm mode and release model memory?'));
  if(!approved)return;
  setBusy(true);setError('');
  try{
   await runtime.refreshRevision();
   const state=record(await runtime.command<Row>('iwxa_llm_warm_control',{
    provider_id:IWXA_PROVIDER,enabled,confirmed:true},{kind:'provider',id:IWXA_PROVIDER}));
   setWarmStatus(state);
  }catch(e){setError(failure(e));}finally{setBusy(false);}
 }
 async function basicRefresh(){
  // Independent read-only observations: setup outage must not hide a valid model.
  const [model,setup]=await Promise.allSettled([
   runtime.query<Row>('iwxa_basic_model_status'),
   runtime.query<Row>('user_setup')
  ]);
  if(model.status==='fulfilled')setSelectedBasic(record(model.value));
  else setError(failure(model.reason));
  if(setup.status==='fulfilled'){
   const observed=reasoningFromSetup(record(setup.value));
   setSavedReasoning(observed);
   if(observed!==null)setReasoning(observed);
  }else setSavedReasoning(null);
 }
 async function retryReasoningReadback(){
  if(busy||reasoningSavingRef.current)return;
  try{
   const observed=reasoningFromSetup(record(await runtime.query<Row>('user_setup')));
   if(observed===null)throw Error('basic_reasoning_preference_metadata_unavailable');
   reasoningDraftRef.current=false;
   setSavedReasoning(observed);setReasoning(observed);setError('');
  }catch(e){setError(failure(e));}
 }
 async function saveReasoning(){
  if(busy||reasoningSavingRef.current||draftPendingRef.current||!selectedBasic?.pin
     ||savedReasoning===null||reasoning===savedReasoning)return;
  if(!window.confirm(tr('Сохранить выбранный уровень рассуждений для IWXA LLM Engine?',
                        'Save reasoning effort for IWXA LLM Engine?')))return;
  reasoningSavingRef.current=true;
  setBusy(true);setError('');
  try{
   await runtime.refreshRevision();
   const receipt=record(await runtime.command<Row>('provider_limits_configure',{
    provider_id:IWXA_PROVIDER,values:{reasoning_effort_level:Number(reasoning)}
   },{kind:'provider',id:IWXA_PROVIDER}));
   if(receipt.durable!==true)throw Error('basic_reasoning_preference_not_saved');
   // The acknowledgement may be received before the new state is visible.
   // Never repeat the mutation; read the Core-owned state instead.
   const observed=reasoningFromSetup(record(await runtime.query<Row>('user_setup')));
   if(observed!==reasoning)throw Error('basic_reasoning_preference_readback_unconfirmed');
   reasoningDraftRef.current=false;
   setSavedReasoning(observed);
  }catch(e){setError(failure(e));}
  finally{reasoningSavingRef.current=false;setBusy(false);}
 }
 async function basicSelect(){
  if(busy||!ggufFile||!str(ggufFile.sha256)||!basicLicense.trim()||!basicSource.trim()
   ||draftMatchesSavedGguf(modelStatus,ggufFile,basicLicense,basicSource))return;
  if(!window.confirm(tr('Подтверждаете право использовать выбранную модель на условиях указанной лицензии?','Confirm that you may use this model under the stated license?')))return;
  setBusy(true);setError('');
  try{
   await runtime.refreshRevision();
   const state=record(await runtime.command<Row>('iwxa_basic_model_select',{
    provider_id:IWXA_PROVIDER,path:str(ggufFile.path),digest:str(ggufFile.sha256),
    license_id:basicLicense.trim(),source:basicSource.trim(),
    confirmed:true,license_acknowledged:true},{kind:'provider',id:IWXA_PROVIDER}));
   if(!draftMatchesSavedGguf(state,ggufFile,basicLicense.trim(),basicSource.trim()))
    throw Error('basic_model_selection_readback_mismatch');
   const confirmed=savedGgufDraft(state);
   if(!confirmed)throw Error('basic_model_selection_readback_invalid');
   hydratedIdentity.current=confirmed.identity;
   clearDraftPending();
   setGgufFile(confirmed.file);
   setBasicLicense(confirmed.license);
   setBasicSource(confirmed.source);
   setSelectedBasic(state);
   onChanged?.();
  }catch(e){setError(failure(e));}finally{setBusy(false);}
 }
 async function basicActivateProvider(){
  if(busy||draftPendingRef.current||selectedBasic?.ready!==true)return;
  if(!window.confirm(tr('Использовать эту модель IWXA для новых диалогов и задач?','Use this IWXA model for future conversations and tasks?')))return;
  setBusy(true);setError('');
  try{
   await runtime.refreshRevision();
   await runtime.command('provider_connection_configure',{
    slot_id:'model',provider_id:IWXA_PROVIDER,values:{},activate:true
   },{kind:'provider',id:IWXA_PROVIDER});
   const current=record(await runtime.query<Row>('operational_control'));
   if(current.active_model_provider_id!==IWXA_PROVIDER)throw Error('basic_model_provider_activation_not_confirmed');
   onChanged?.();
  }catch(e){setError(failure(e));}finally{setBusy(false);}
 }
 async function basicTry(){
  if(busy||draftPendingRef.current||selectedBasic?.ready!==true||!modelIsActiveProvider)return;
  if(!window.confirm(tr('Проверить ответ выбранной GGUF-модели на коротком вопросе?','Run a short verification prompt with the selected GGUF model?')))return;
  stopRequestedForTry.current=false;
  setBusy(true);setVerifying(true);setError('');setResult(null);
  try{
   await runtime.refreshRevision();
   const result=record(await runtime.command<Row>('iwxa_basic_model_try',{
    provider_id:IWXA_PROVIDER,confirmed:true,max_output_tokens:testTokenLimit
   },{kind:'provider',id:IWXA_PROVIDER}));
   if(result.runtime_id!==IWXA_PROVIDER||result.inference_performed!==true
       ||result.remote_fallback_performed!==false||!str(result.answer).trim())
     throw Error('basic_model_inference_not_confirmed');
   setResult(result);
  }catch(e){
   setError(stopRequestedForTry.current?tr(
    'Остановка модели запрошена. Не считайте эту проверку завершённым ответом.',
    'Model stop was requested. Do not treat this test as a completed answer.'):
    modelTryError(e,tr));
  }finally{setVerifying(false);setBusy(false);stopRequestedForTry.current=false;}
 }
 // The existing Core-owned model control is the ONLY actual stop authority.
 // Make the scope explicit: this switches the local model off, not merely
 // hides a spinner or silently cancels a saved user Task.
 async function stopModelTest(){
  if(!verifying||stoppingTest||stopTestInFlight.current||
     selectedBasic?.active!==true)return;
  if(!window.confirm(tr(
   'Прервать проверку и выключить текущую локальную модель IWXA? Это также остановит её активную генерацию. Для следующих запросов модель нужно будет запустить снова.',
   'Interrupt the test and switch off the current local IWXA model? This also stops its active generation. You must start the model again for future requests.')))return;
  stopTestInFlight.current=true;stopRequestedForTry.current=true;
  setStoppingTest(true);setError('');
  try{
   await runtime.refreshRevision();
   await runtime.command<Row>('iwxa_basic_model_control',{
    provider_id:IWXA_PROVIDER,active:false,confirmed:true
   },{kind:'provider',id:IWXA_PROVIDER});
   const observed=record(await runtime.query<Row>('iwxa_basic_model_status'));
   if(observed.active!==false)throw Error('model_stop_readback_unverified');
   setSelectedBasic(observed);onChanged?.();
  }catch(e){
   // Never repeat an uncertain deactivation. Read current owner state instead.
   try{
    const observed=record(await runtime.query<Row>('iwxa_basic_model_status'));
    setSelectedBasic(observed);
    if(observed.active===false){onChanged?.();return;}
   }catch{/* Outcome unknown: model may still be running. */}
   setError(tr('Остановка не подтверждена. Проверьте состояние модели перед повтором.',
    'Stop was not confirmed. Read the model status before retrying.')+' '+failure(e));
  }finally{stopTestInFlight.current=false;setStoppingTest(false);}
 }
 async function basicControl(active:boolean){
  if(busy||draftPendingRef.current)return;
  if(!window.confirm(active?tr('Запустить модель средствами IWXA?','Enable this GGUF model in IWXA?'):tr('Остановить использование этой модели?','Stop using this model?')))return;
  setBusy(true);setError('');
  try{
   await runtime.refreshRevision();
   const state=record(await runtime.command<Row>('iwxa_basic_model_control',{
    provider_id:IWXA_PROVIDER,active,confirmed:true},{kind:'provider',id:IWXA_PROVIDER}));
   setSelectedBasic(state);
   onChanged?.();
  }catch(e){setError(failure(e));}finally{setBusy(false);}
 }
 async function chooseGGUF(kind:'MODEL'|'RUNTIME'){
  if(busy)return;
  setBusy(true);setError('');setResult(null);
  try{
   const picked=record(await runtime.command<Row>('local_ai_basic_gguf_choose',
     {provider_id:GGUF_PROVIDER,kind},{kind:'provider',id:GGUF_PROVIDER}));
   if(picked.selected!==true)return;
   if(picked.kind!==kind||!str(picked.path)||!str(picked.name)
     ||(kind==='RUNTIME'&&!/^[0-9a-f]{64}$/.test(str(picked.sha256))))
     throw Error('basic_gguf_selection_invalid');
   if(kind==='MODEL'){
    markDraftPending();
    setGgufFile(picked);
    // Never reuse license/provenance from a different GGUF file.
    setBasicLicense('');setBasicSource('');
   }else setLlamaFile(picked);
  }catch(e){setError(failure(e));}
  finally{setBusy(false);}
 }
 async function tryGGUF(){
  if(busy||!ggufFile||!llamaFile)return;
  const message=tr(
   'Запустить выбранный llama.cpp с коротким проверочным запросом? IWXA не передаёт личные документы. Подлинность стороннего файла и его сетевая изоляция пока не подтверждены.',
   'Run the selected llama.cpp binary with a short test prompt? IWXA shares no personal documents. Binary authenticity and OS network isolation are not verified.');
  if(!window.confirm(message))return;
  setBusy(true);setError('');setResult(null);
  try{
   const reply=record(await runtime.command<Row>('local_ai_basic_gguf_try',{
    provider_id:GGUF_PROVIDER,model_file:str(ggufFile.path),executable:str(llamaFile.path),
    executable_sha256:str(llamaFile.sha256),confirmed:true
   },{kind:'provider',id:GGUF_PROVIDER}));
   if(reply.runtime_id!==GGUF_PROVIDER||reply.model_path!==ggufFile.path
     ||reply.runtime_sha256!==llamaFile.sha256||reply.inference_performed!==true
     ||reply.remote_fallback_performed!==false||!str(reply.answer).trim())
     throw Error('basic_gguf_inference_unverified');
   setResult(reply);
  }catch(e){setError(failure(e));}
  finally{setBusy(false);}
 }
 return <div className="advanced-form" aria-label={tr('IWXA LLM Engine - языковые модели','IWXA LLM Engine - language models')}>
  <h3>{tr('IWXA LLM Engine - языковые модели','IWXA LLM Engine - language models')}</h3>
   <p>{tr('IWXA LLM Engine запускает совместимые GGUF-модели прямо на этом компьютере. Движок устанавливается отдельно по вашему решению; веса можно скачать или выбрать из существующего файла.',
    'IWXA LLM Engine runs compatible GGUF language models on this computer. The engine is installed separately with your approval; download model weights or select an existing file.')}</p>
   {t3Enabled===true&&<div className="advanced-notice" role="status">
    <p>{tr('Автономный режим T3 запрещает сетевую загрузку компонента и весов модели. Уже имеющиеся файлы GGUF можно выбрать без сети. Для загрузки отключите T3, затем включите обратно: локальный inference сохранится.',
      'Offline T3 mode blocks downloading the engine and model weights. Existing GGUF files can still be selected offline. To download, disable T3, then re-enable it; local inference will remain available.')}</p>
    <button type="button" className="secondary-button" disabled={busy||t3Busy}
      onClick={()=>void changeModelSetupMode(false)}>{tr('Разрешить подготовку модели через сеть','Allow online model preparation')}</button>
   </div>}
   {t3Enabled===false&&<div className="advanced-notice" role="status">
    <p>{tr('Сетевые загрузки доступны по отдельному подтверждению. После подготовки модели можно вернуться в автономный режим T3.',
      'Network downloads require separate confirmation. After preparing the model, you can return to offline T3 mode.')}</p>
    <button type="button" className="secondary-button" disabled={busy||t3Busy}
      onClick={()=>void changeModelSetupMode(true)}>{tr('Вернуться в автономный режим T3','Return to offline T3 mode')}</button>
   </div>}
   {t3Enabled===null&&<p role="status">{tr('Проверяем автономный режим перед загрузкой модели.','Verifying offline mode before model download.')}</p>}
   <div className="advanced-actions">
    <button type="button" className="secondary-button" disabled={busy} onClick={()=>void addonRefresh()}>{tr('Проверить компонент','Check component')}</button>
    <button type="button" disabled={busy||t3Enabled!==false||addonStatus?.verified===true} onClick={()=>void addonInstall()}>{tr('Установить компонент','Install component')}</button>
   </div>
   {runtimeVersions&&<div className="advanced-actions">
     <span>{tr('Активная версия','Active version')}: {str(runtimeVersions.active_version)}</span>
     <select aria-label={tr('Версия компонента','Runtime version')} disabled={busy} value={candidateVersion}
       onChange={e=>setCandidateVersion(e.target.value)}>
      <option value="b11827">b11827</option><option value="b11836">b11836</option>
     </select>
     <button type="button" disabled={busy||t3Enabled!==false} onClick={()=>void installOtherVersion()}>{tr('Установить версию','Install version')}</button>
     <button type="button" disabled={busy||!Array.isArray(runtimeVersions.releases)||
       !runtimeVersions.releases.some(v=>record(v).version===candidateVersion&&record(v).installed===true)}
       onClick={()=>void switchRuntime(candidateVersion)}>{tr('Переключить','Switch')}</button>
     <button type="button" disabled={busy||runtimeVersions.rollback_available!==true}
       onClick={()=>void switchRuntime(str(runtimeVersions.previous_version))}>{tr('Вернуть предыдущую','Restore previous')}</button>
    </div>}
   {addonPlan&&<small>{tr('Отдельная загрузка: ','Separate download: ')}{str(addonPlan.version)} · {Math.round(Number(addonPlan.archive_size_bytes)/1048576)} MiB · MIT</small>}
   {addonStatus&&<p role="status">{addonStatus.verified===true
    ?tr('Компонент проверен. Выберите GGUF и запустите проверку ответа.','Component verified. Choose GGUF and test a model response.')
    :tr('Компонент отсутствует или его целостность не подтверждена.','Component is missing or its integrity is not confirmed.')}</p>}
   <div className="advanced-actions">
    <label className="advanced-field">{tr('Модель из официального источника','Model from official source')}
     <select value={offerId} disabled={busy} onChange={e=>setOfferId(e.target.value)}>
      {offers.length===0?<option value="QWEN3_0_6B_Q8_0">Qwen3 0.6B Q8_0</option>:
       offers.map(item=><option key={str(item.model_id)} value={str(item.model_id)}>{str(item.name)}</option>)}
     </select>
    </label>
    <button type="button" disabled={busy||t3Enabled!==false} onClick={()=>void downloadOfficial()}>{tr('Скачать модель','Download model')}</button>
   </div>
   <div className="advanced-actions">
    <button type="button" disabled={busy} onClick={()=>void chooseGGUF('MODEL')}>
     {tr('Выбрать файл GGUF','Choose GGUF file')}</button>
    {draftPending&&<button type="button" className="secondary-button" disabled={busy}
      onClick={discardDraft}>{tr('Отменить изменения','Discard changes')}</button>}
   </div>
   {ggufFile&&<p>{tr('Подготовленная модель: ','Staged model: ')}{str(ggufFile.name)||str(ggufFile.path)}</p>}
   {draftPending&&<p role="status">{tr(
    'Новый файл или сведения о модели ещё не подтверждены. Сохранённая модель Core не менялась.',
    'The new model or provenance is not confirmed yet. The saved Core model remains unchanged.')}</p>}
   <label className="advanced-field">{tr('Лицензия модели','Model license')}
    <input value={basicLicense} maxLength={120} onChange={e=>{markDraftPending();setBasicLicense(e.target.value)}} placeholder="Apache-2.0 / MIT / другая" />
   </label>
   <label className="advanced-field">{tr('Происхождение файла','Model source')}
    <input value={basicSource} maxLength={280} onChange={e=>{markDraftPending();setBasicSource(e.target.value)}} placeholder={tr('Официальная страница модели или свой файл','Official model page or own file')} />
   </label>
   <label className="advanced-field">{tr('Объём проверочного ответа','Verification output limit')}
    <select aria-label={tr('Объём проверочного ответа','Verification output limit')}
     value={testTokenLimit} disabled={busy||draftPending}
     onChange={e=>{
      const chosen=Number(e.target.value);
      if(chosen===128||chosen===256||chosen===512)setTestTokenLimit(chosen);
     }}>
     <option value={128}>{tr('Быстрая проверка: до 128 токенов','Fast test: up to 128 tokens')}</option>
     <option value={256}>{tr('Подробная проверка: до 256 токенов','Extended test: up to 256 tokens')}</option>
     <option value={512}>{tr('Длинная проверка: до 512 токенов','Long test: up to 512 tokens')}</option>
    </select>
   </label>
   <small>{tr(
    'Это ограничение только проверочного запроса, а не обычных задач. Больший лимит позволяет модели дольше рассуждать и может увеличить ожидание; время завершения заранее неизвестно.',
    'This limit applies only to the test, not ordinary Tasks. More tokens allow longer reasoning and may increase waiting; completion time is unknown.')}</small>
   <div className="advanced-actions">
    <button type="button" disabled={busy||!ggufFile||!str(ggufFile.sha256)||!basicLicense.trim()||!basicSource.trim()
     ||draftMatchesSavedGguf(modelStatus,ggufFile,basicLicense,basicSource)} onClick={()=>void basicSelect()}>{tr('Выбрать модель','Select model')}</button>
    <button type="button" disabled={busy||draftPending||!selectedBasic?.pin||selectedBasic?.active===true} onClick={()=>void basicControl(true)}>{tr('Запустить','Start')}</button>
    <button type="button" disabled={busy||draftPending||selectedBasic?.ready!==true} onClick={()=>void basicActivateProvider()}>{tr('Использовать в диалогах и задачах','Use in conversations and tasks')}</button>
    <button type="button" disabled={busy||draftPending||selectedBasic?.ready!==true||!modelIsActiveProvider} onClick={()=>void basicTry()}>{tr('Проверить ответ','Verify response')}</button>
    <button type="button" disabled={busy||draftPending||selectedBasic?.active!==true||warmStatus?.enabled===true}
      onClick={()=>void warmControl(true)}>{tr('Ускорить повторные запросы','Keep model loaded')}</button>
    <button type="button" disabled={busy||warmStatus?.enabled!==true}
      onClick={()=>void warmControl(false)}>{tr('Отключить ускорение','Disable warm mode')}</button>
    <button type="button" disabled={busy||draftPending||selectedBasic?.active!==true} onClick={()=>void basicControl(false)}>{tr('Остановить','Stop')}</button>
   </div>
   <p role="status">{draftPending&&ggufFile
    ?tr('Следующее действие: нажмите «Выбрать модель», чтобы подтвердить файл и лицензию.',
       'Next: select the model to confirm the file and its license.')
    :addonStatus===null||t3Enabled===null
    ?tr('Проверяем состояние движка и автономного режима перед настройкой.',
       'Checking the engine and offline mode before setup.')
    :addonStatus?.verified!==true
    ?t3Enabled===true
     ?tr('Следующее действие: разрешите сетевую подготовку или используйте ранее установленный движок.',
        'Next: allow online setup, or use an already installed engine.')
     :tr('Следующее действие: установите IWXA LLM Engine. Затем выберите файл GGUF.',
        'Next: install IWXA LLM Engine, then select a GGUF file.')
    :!selectedBasic?.pin
    ?tr('Следующее действие: скачайте или выберите файл GGUF и подтвердите его.',
       'Next: download or choose a GGUF file and confirm its selection.')
    :selectedBasic?.active!==true
    ?tr('Следующее действие: нажмите «Запустить», чтобы включить выбранную модель.',
       'Next: Start the selected model.')
    :selectedBasic?.ready!==true
    ?tr('Модель ещё не готова. Проверьте состояние компонента и файла GGUF.',
       'The model is not ready. Check the engine and GGUF file status.')
    :!modelIsActiveProvider
    ?tr('Следующее действие: нажмите «Использовать в диалогах и задачах».',
       'Next: Use in conversations and tasks.')
    :tr('Модель подключена. Нажмите «Проверить ответ», затем создайте обычную задачу.',
       'The model is connected. Verify its response, then create an ordinary task.')}</p>
   {selectedBasic&&<p role="status">{str(selectedBasic.reason)}</p>}
   {!!selectedBasic?.pin&&<p role="status">
    {typeof record(selectedBasic.model).context_length==='number'
     ?tr('Контекст выбранной GGUF: ','Selected GGUF context: ')
       +String(record(selectedBasic.model).context_length)
       +tr(' токенов по метаданным модели. Реальный расход памяти зависит от размера выделенного контекста.',
         ' tokens according to model metadata. Actual memory use depends on the allocated context.')
     :tr('Контекст выбранной GGUF не указан в сохранённых метаданных. Движок проверит доступность при запуске.',
       'Selected GGUF context is not recorded. The engine will check its limits when started.')}
   </p>}
   {!!selectedBasic?.pin&&<div className="advanced-form" role="group"
     aria-label={tr('Усилия рассуждений','Reasoning effort')}>
    <label className="advanced-field">{tr('Усилия рассуждений','Reasoning effort')}
     <select aria-label={tr('Усилия рассуждений','Reasoning effort')}
      disabled={busy||draftPending||savedReasoning===null}
      value={reasoning} onChange={e=>{
       reasoningDraftRef.current=e.target.value!==savedReasoning;
       setReasoning(e.target.value);
      }}>
      <option value="0">{tr('Авто (режим модели)','Auto (model default)')}</option>
      <option value="-1">{tr('Выключены','Off')}</option>
      <option value="1">{tr('Низкие','Low')}</option>
      <option value="2">{tr('Средние','Medium')}</option>
      <option value="3">{tr('Высокие','High')}</option>
     </select>
    </label>
    {savedReasoning===null&&<button type="button" className="secondary-button"
      disabled={busy||draftPending} onClick={()=>void retryReasoningReadback()}>
     {tr('Повторить чтение настройки','Retry settings readback')}
    </button>}
    <button type="button" disabled={busy||draftPending||savedReasoning===null
       ||reasoning===savedReasoning} onClick={()=>void saveReasoning()}>
     {tr('Сохранить уровень','Save effort')}
    </button>
    <small>{tr('Настройка применяется к новым запросам IWXA LLM Engine. Поддержка уровней зависит от модели и её шаблона. «Авто» сохраняет выбор модели.',
      'Applies to new IWXA LLM Engine requests. Supported levels depend on the model and chat template. Auto preserves the model default.')}</small>
   </div>}
   {selectedBasic?.ready===true&&!modelIsActiveProvider&&<p role="status">{tr(
    'Для проверки ответа сначала нажмите «Использовать в диалогах и задачах».',
    'To verify a response, select “Use in conversations and tasks” first.')}</p>}
   <details className="owner-details"><summary>{tr('Дополнительно: проверить другой llama.cpp','Advanced: test another llama.cpp')}</summary>
    <p>{tr('Этот маршрут предназначен для ручной проверки стороннего исполняемого файла. Для обычной работы используйте установленный IWXA LLM Engine выше.',
      'This route tests a separately supplied executable. For ordinary use, choose the installed IWXA LLM Engine above.')}</p>
    <button type="button" disabled={busy} onClick={()=>void chooseGGUF('RUNTIME')}>
     {tr('Выбрать llama.cpp','Choose llama.cpp')}</button>
    <p>{llamaFile?str(llamaFile.name):tr('Исполняемый файл не выбран','No executable selected')}</p>
    <button type="button" disabled={!ggufFile||!llamaFile||busy} onClick={()=>void tryGGUF()}>
     {tr('Проверить GGUF с выбранным исполняемым файлом','Test GGUF with selected executable')}</button>
   </details>
   <p><a href="https://github.com/ggml-org/llama.cpp/releases" target="_blank" rel="noreferrer">
    {tr('Официальные выпуски llama.cpp','Official llama.cpp releases')}</a></p>
   <small>{tr('Проверяется целостность выбранного исполняемого файла перед запуском. Эта проверка не устанавливает его подлинность и не заменяет защиту Windows.',
    'The selected binary is checked for changes before execution. This does not prove its origin or replace Windows protection.')}</small>
  {verifying&&<div className="task-wait-status" role="status">
    <strong>{tr('Проверяем локальную модель','Testing the local model')}</strong>
    <span>{tr('В этом окне: ','In this window: ')}{testSeconds} {tr('с','s')}.
     {tr(' Время окончания не известно.',' Completion time is unknown.')}</span>
    <small>{tr('Локальная модель может долго загружаться или рассуждать. Режим задаётся вами, модель не переключается автоматически. Это проверка связи, не оценка качества ответа.',
     'Local loading and reasoning may take time. You choose the effort; no automatic model switch. This is a transport check, not an answer-quality rating.')}</small>
    <button type="button" className="mini-button" disabled={stoppingTest||selectedBasic?.active!==true}
     onClick={()=>void stopModelTest()}>
     {stoppingTest?tr('Останавливаем…','Stopping…'):
      tr('Прервать и выключить локальную модель','Interrupt and switch off local model')}</button>
   </div>}
   {error&&<p role="alert">{tr('Не удалось выполнить запрос: ','The request failed: ')}{error}</p>}
  {result&&<div className="owner-row" role="status">
   <strong>{tr('Получен ответ модели','Model responded')}</strong>
   <span>{str(result.model)}</span>
   <p>{str(result.answer)}</p>
   <small>{tr('Это проверка запуска, а не оценка качества ответа.',
     'This verifies execution, not response quality.')}</small>
  </div>}
 </div>;
}
