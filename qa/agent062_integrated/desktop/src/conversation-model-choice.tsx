import React,{useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {record,records,str,failure,useOwnerActions,OwnerError,OwnerMessage,type Row} from './owner-ui';
import {useUiSettings} from './ui-preferences';
import {localModelSource} from './local-model-route';

const OLLAMA='OLLAMA_LOCAL_V1';
const IWXA_ENGINE='IWXA_BASIC_RUNTIME_V1';
const normalizedDigest=(value:unknown)=>str(value).toLowerCase().replace(/^sha256:/,'');
const exactDigest=(value:unknown)=>/^[a-f0-9]{64}$/.test(normalizedDigest(value));
const localKey=(name:string,digest:string)=>'local:'+JSON.stringify([name,normalizedDigest(digest)]);
const providerKey=(id:string)=>'provider:'+id;
const modelTitle=(row:Row)=>{
 if(str(row.provider_id)===IWXA_ENGINE)return 'IWXA LLM Engine';
 const id=str(row.provider_id),known:Record<string,string>={ANTHROPIC_MESSAGES:'Anthropic',OPENAI_RESPONSES:'OpenAI',OPENAI_CHAT_COMPLETIONS:'OpenAI',GOOGLE_GEMINI:'Google Gemini'};
 return str(row.display_name)||str(row.name)||str(row.title)||known[id]||id.replace(/_V\d+$/,'').replaceAll('_',' ');
};

/**
 * One Core-owned model route is active for new messages. This control does not
 * claim per-dialogue model isolation or cache model identities in the browser.
 * Every selection and provider switch goes through existing owner commands.
 */
export function ConversationModelChoice({onChanged,onOpenModels,compact=false,localOnly=false}:{
 onChanged?:()=>void;onOpenModels?:()=>void;compact?:boolean;localOnly?:boolean
}){
 const {tr}=useUiSettings();
 const [ai,setAi]=useState<Row>({}),[setup,setSetup]=useState<Row>({}),[ops,setOps]=useState<Row>({});
 const [detected,setDetected]=useState<Row>({}),[detectionChecked,setDetectionChecked]=useState(false),[detectionError,setDetectionError]=useState('');
 const [engine,setEngine]=useState<Row>({}),[engineError,setEngineError]=useState('');
 const [connectingDetected,setConnectingDetected]=useState(false);
 const connectingRef=useRef(false);
 const [fault,setFault]=useState(''),[explanation,setExplanation]=useState('');
 const [candidate,setCandidate]=useState('');
 const [switching,setSwitching]=useState(false),[switchError,setSwitchError]=useState('');
 const switchRef=useRef(false);
 const changed=useRef(false),serial=useRef(0);
 const load=useCallback(async()=>{
  const seq=++serial.current;
  const results=await Promise.allSettled([
   runtime.query<Row>('local_ai_setup'),
   runtime.query<Row>('user_setup'),
   runtime.query<Row>('operational_control'),
  ]);
  if(seq!==serial.current)return;
  const local=results[0].status==='fulfilled'?record(results[0].value):{};
  const user=results[1].status==='fulfilled'?record(results[1].value):{};
  const operational=results[2].status==='fulfilled'?record(results[2].value):{};
  setAi(local);setSetup(user);setOps(operational);
  const issues=results.flatMap((v,i)=>v.status==='rejected'?[[ 'local_ai_setup','user_setup','operational_control'][i]+': '+failure(v.reason)]:[]);
  setFault(issues.join(' · '));
  const active=str(operational.active_model_provider_id||user.active_model_provider_id);
  if(!changed.current){
   setCandidate(active===OLLAMA&&str(local.selected_model)&&exactDigest(local.selected_model_expected_digest)
    ?localKey(str(local.selected_model),str(local.selected_model_expected_digest))
    :!localOnly&&active&&active!=='NONE'?providerKey(active):'');
  }
  // These are optional display-only reads. Never hold the main model
  // selection/owner-action readback open while a discovery or GGUF status
  // request is slow. Each response still belongs to its original Core snapshot.
  if(local.source_confirmed===false){
   void (async()=>{
    try{
     const observed=record(await runtime.query<Row>('existing_local_ollama'));
     if(seq!==serial.current)return;
     setDetected(observed);setDetectionChecked(true);setDetectionError('');
    }catch(error){
     if(seq!==serial.current)return;
     setDetected({});setDetectionChecked(false);setDetectionError(failure(error));
    }
   })();
  }else{
   setDetected({});setDetectionChecked(false);setDetectionError('');
  }
  if(active===IWXA_ENGINE&&!localOnly){
   void (async()=>{
    try{
     const selected=record(await runtime.query<Row>('iwxa_basic_model_status'));
     if(seq!==serial.current)return;
     setEngine(selected);setEngineError('');
    }catch(error){
     if(seq!==serial.current)return;
     setEngine({});setEngineError(failure(error));
    }
   })();
  }else{
   setEngine({});setEngineError('');
  }
 },[localOnly]);
 useEffect(()=>{void load();return()=>{serial.current++}},[load]);
 const {run,busy,message,diagnostic}=useOwnerActions(load);
 const active=str(ops.active_model_provider_id||setup.active_model_provider_id);
 const models=records(ai.local_models).filter(row=>str(row.name)&&exactDigest(row.digest)&&!str(row.name).toLowerCase().endsWith(':cloud'));
 const discovery=localModelSource(ai,detected,ops);
 const availableOnComputer=discovery.source==='DEFAULT_PORT'?discovery.models:[];
 const slot=records(setup.slots).find(row=>str(row.slot_id)==='model');
 const providers=records(record(slot).providers).filter(row=>str(row.provider_id)&&!['NONE','DEMO_REPLAY_V1'].includes(str(row.provider_id)));
 const currentlyLocal=active===OLLAMA;
 const activeKey=currentlyLocal&&str(ai.selected_model)&&exactDigest(ai.selected_model_expected_digest)
  ?localKey(str(ai.selected_model),str(ai.selected_model_expected_digest))
  :active&&active!=='NONE'?providerKey(active):'';
 const activeTitle=currentlyLocal
  ?tr('Ollama на компьютере: ','Ollama on this computer: ')+(str(ai.selected_model)||tr('не выбрана','not selected'))
  :providers.find(row=>str(row.provider_id)===active)
  ?modelTitle(providers.find(row=>str(row.provider_id)===active)!)
  :active&&active!=='NONE'?localOnly
    ?tr('Для Goose выберите локальную Ollama','Choose local Ollama for Goose')
    :tr('Источник: ','Source: ')+active
  :tr('Модель не выбрана','No model selected');
 const localAvailable=ai.source_confirmed===true&&ai.daemon_ready===true&&models.length>0;
 const eligibleLocal=localAvailable&&ai.ready_for_activation===true;
 const checked=record(ai.last_inference_check);
 const currentAnswer=currentlyLocal&&checked.state==='SUCCEEDED'
  &&checked.selection_matches_last_check===true
  &&str(checked.model)===str(ai.selected_model)
  &&normalizedDigest(checked.model_digest)===normalizedDigest(ai.selected_model_expected_digest)
  ?str(checked.response_excerpt).trim():'';
 async function connectDetectedOllama(){
  if(busy||switchRef.current||connectingRef.current||!!fault||ai.source_confirmed===true
    ||discovery.source!=='DEFAULT_PORT'||availableOnComputer.length===0)return;
  connectingRef.current=true;setConnectingDetected(true);setSwitchError('');setExplanation('');
  try{
   // A stale discovery result is not evidence that this endpoint still exists.
   const latest=record(await runtime.query<Row>('existing_local_ollama'));
   const observed=localModelSource({source_confirmed:false},latest,{});
   if(observed.source!=='DEFAULT_PORT'||observed.models.length===0){
    setExplanation(tr('Ollama перестала отвечать. Откройте её на компьютере и обновите список.',
      'Ollama is no longer responding. Open it on this computer and refresh.'));
    await load();return;
   }
   const before=record(await runtime.query<Row>('local_ai_setup'));
   if(before.source_confirmed===true){
    setExplanation(tr('Источник изменился. Обновите список перед подключением.',
      'The model source has changed. Refresh before connecting.'));
    await load();return;
   }
   // Connecting is a separate explicit user decision. Selecting a model and
   // running inference require their existing follow-up permissions.
   const accepted=await run<Row>(
    tr('Подключить работающую Ollama на этом компьютере? Установленные модели останутся без изменений.',
      'Connect the running Ollama on this computer? Installed models will not change.'),
    'local_ai_source_connect',
    {provider_id:OLLAMA,source:'USER_LOOPBACK_ENDPOINT',endpoint:'http://127.0.0.1:11434',confirmed:true},
    {kind:'provider',id:OLLAMA});
   if(!accepted)return;
   const after=record(await runtime.query<Row>('local_ai_setup'));
   if(after.source_confirmed!==true||after.runtime_endpoint_scope!=='USER_LOOPBACK_ENDPOINT'
      ||str(after.runtime_endpoint)!=='http://127.0.0.1:11434'||after.daemon_ready!==true){
    setExplanation(tr('Подключение отправлено, но состояние не подтверждено. Обновите сведения перед повтором.',
      'The connection was submitted but its state is not verified. Refresh before retrying.'));
    await load();return;
   }
   changed.current=false;
   await load();onChanged?.();
   setExplanation(tr('Ollama подключена. Выберите установленную модель в этом списке.',
     'Ollama is connected. Choose an installed model from this list.'));
  }catch(error){
   setSwitchError(failure(error));
   try{await load();}catch{/* Preserve the original error. */}
  }finally{
   connectingRef.current=false;setConnectingDetected(false);
  }
 }
 async function activateLocal(expectedName:string,expectedDigest:string){
  // Selection of a model does not automatically change provider. Activation
  // is a second explicit decision, read back against the same model digest.
  const before=record(await runtime.query<Row>('local_ai_setup'));
  if(before.ready_for_activation!==true
     ||str(before.selected_model)!==expectedName
     ||normalizedDigest(before.selected_model_expected_digest)!==expectedDigest){
   setExplanation(tr('Модель ещё не готова. Проверьте источник и реальный ответ в «Моделях».','The model is not ready. Check its connection and actual response in Models.'));
   return false;
  }
  const ack=await run<Row>(tr('Использовать «','Use "')+expectedName+tr('» как модель для новых сообщений?','" for new messages?'),
    'provider_connection_configure',{slot_id:'model',provider_id:OLLAMA,values:{},activate:true},{kind:'provider',id:OLLAMA},{confirmedBySelection:true});
  if(!ack)return false;
  const [after,selected]=await Promise.all([
   runtime.query<Row>('operational_control'),runtime.query<Row>('local_ai_setup')]);
  if(after.active_model_provider_id!==OLLAMA
     ||selected.ready_for_activation!==true
     ||str(selected.selected_model)!==expectedName
     ||normalizedDigest(selected.selected_model_expected_digest)!==expectedDigest){
   setExplanation(tr('Ответ о переключении получен, но текущая модель не подтверждена. Проверьте её перед отправкой.','A switch reply was received, but the active model is not verified. Check it before sending.'));
   return false;
  }
  return true;
 }
 async function checkSelectedLocal(expectedName:string,expectedDigest:string){
  // A single model choice includes a bounded synthetic Core inference check.
  const [selected,activeRoute]=await Promise.all([
   runtime.query<Row>('local_ai_setup'),runtime.query<Row>('operational_control')]);
  const before=record(selected);
  if(activeRoute.active_model_provider_id!==OLLAMA||before.ready_for_activation!==true
    ||str(before.selected_model)!==expectedName
    ||normalizedDigest(before.selected_model_expected_digest)!==expectedDigest){
   setExplanation(tr('Выбор модели сохранён, но готовность не подтверждена. Проверьте Ollama.','The model is selected but readiness is not confirmed. Check Ollama.'));
   return false;
  }
  const response=await run<Row>(tr('Проверить ответ локальной модели без пользовательских файлов?','Check a local model response without user files?'),
   'local_ai_inference_check',{provider_id:OLLAMA,confirmed:true},{kind:'provider',id:OLLAMA},{confirmedBySelection:true});
  if(!response){
   setExplanation(tr('Ответ модели не подтверждён. Проверьте состояние перед повторной попыткой.','The model response is not verified. Check the state before retrying.'));
   return false;
  }
  const [after,route]=await Promise.all([
   runtime.query<Row>('local_ai_setup'),runtime.query<Row>('operational_control')]);
  const state=record(after),receipt=record(state.last_inference_check);
  if(route.active_model_provider_id!==OLLAMA||state.ready_for_activation!==true
    ||str(state.selected_model)!==expectedName
    ||normalizedDigest(state.selected_model_expected_digest)!==expectedDigest
    ||response.inference_performed!==true||!str(response.actual_response).trim()
     ||response.remote_fallback_performed!==false||response.external_file_effects_performed!==false
     ||receipt.state!=='SUCCEEDED'||!str(receipt.response_excerpt).trim()
    ||receipt.selection_matches_last_check!==true
    ||str(receipt.model)!==expectedName
    ||normalizedDigest(receipt.model_digest)!==expectedDigest){
   setExplanation(tr('Ответ получен, но идентичность выбранной модели не подтверждена. Обновите сведения.','A response arrived, but the selected model identity is not confirmed. Refresh the state.'));
   return false;
  }
  return true;
 }
 const entries=[
  ...(currentlyLocal&&activeKey&&!models.some(row=>localKey(str(row.name),str(row.digest))===activeKey)
   ?[{key:activeKey,title:tr('Текущая локальная модель (проверка требуется)','Current local model (recheck required)')}]:[]),
  ...models.map(row=>({key:localKey(str(row.name),str(row.digest)),title:str(row.name)+' · Ollama · '+tr('локально','local')})),
  ...providers.filter(row=>!localOnly&&str(row.provider_id)!==OLLAMA).map(row=>({
    key:providerKey(str(row.provider_id)),
    title:modelTitle(row)+' · '+(record(row.health).ready===true
      ?str(row.provider_id)===IWXA_ENGINE?tr('локально','local'):tr('облачный источник','cloud source')
      :tr('нужно подключить','needs setup')),
    ready:record(row.health).ready===true,
   })),
 ];
 async function apply(chosen:string){
  const selected=entries.find(row=>row.key===chosen);
  if(!selected){
   changed.current=false;setCandidate(activeKey);
   return;
  }
  if(busy||fault||switchRef.current||localOnly&&!chosen.startsWith('local:'))return;
  switchRef.current=true;setSwitching(true);setSwitchError('');
  let notifyParent=false;
  setExplanation('');
  try{
  if(chosen===activeKey){
   if(chosen.startsWith('local:')){
    const current=models.find(row=>localKey(str(row.name),str(row.digest))===chosen);
    if(current)setExplanation(tr('Модель выбрана. Проверка ответа доступна отдельно.','Model selected. Response check is optional.'));
    changed.current=false;notifyParent=true;
   }else setExplanation(tr('Этот источник уже выбран.','This source is already selected.'));
   return;
  }
  if(chosen.startsWith('local:')){
   const actual=models.find(row=>localKey(str(row.name),str(row.digest))===chosen);
   if(!actual||!localAvailable){
    setExplanation(tr('Каталог локальных моделей недоступен. Проверьте Ollama.','Local model inventory is unavailable. Check Ollama.'));
    return;
   }
   if(str(ai.selected_model)!==str(actual.name)||normalizedDigest(ai.selected_model_expected_digest)!==normalizedDigest(actual.digest)){
    const fresh=record(await runtime.query<Row>('local_ai_setup').catch(()=>({})));
    if(!records(fresh.local_models).some(row=>str(row.name)===str(actual.name)&&normalizedDigest(row.digest)===normalizedDigest(actual.digest))){
     setExplanation(tr('Каталог изменился. Обновите список перед выбором.','The model inventory changed. Refresh before selecting.'));
     return;
    }
    const mode=str(fresh.selection_mode)==='IWXA_QUALIFIED'&&str(fresh.selected_model)===str(actual.name)
      &&normalizedDigest(fresh.selected_model_expected_digest)===normalizedDigest(actual.digest)
      ?'IWXA_QUALIFIED':'USER_SELECTED_LOCAL';
    const result=await run<Row>(tr('Выбрать «','Select "')+str(actual.name)+tr('» для новых сообщений? Выбор влияет и на новые задачи.','" for new messages? This also changes the model for new tasks.'),
     'local_ai_model_select',{provider_id:OLLAMA,name:actual.name,digest:actual.digest,mode,confirmed:true},{kind:'provider',id:OLLAMA},{confirmedBySelection:true});
    if(!result)return;
    notifyParent=true;
    const verified=record(await runtime.query<Row>('local_ai_setup').catch(()=>({})));
    if(str(verified.selected_model)!==str(actual.name)||normalizedDigest(verified.selected_model_expected_digest)!==normalizedDigest(actual.digest)||verified.ready_for_activation!==true){
     setExplanation(tr('Выбор отправлен, но подтверждение модели ещё не получено. Проверьте её в «Моделях».','Selection sent, but model identity is not confirmed. Check it in Models.'));
     return;
    }
    // Changing the selected model and changing the active provider are
    // different owner decisions. Never pretend one implies the other.
    if(!currentlyLocal){
     const activated=await activateLocal(str(actual.name),normalizedDigest(actual.digest));
     if(!activated)return;
    }
    changed.current=false;notifyParent=true;
    setExplanation(tr('Модель выбрана. Проверка ответа доступна отдельно.','Model selected. Response check is optional.'));
    return;
   }
   if(!eligibleLocal&&currentlyLocal){
    setExplanation(tr('Локальная модель пока не готова. Проверьте её ответ в «Моделях».','The local model is not ready. Verify its response in Models.'));return;
   }
   if(!await activateLocal(str(actual.name),normalizedDigest(actual.digest)))return;
   changed.current=false;notifyParent=true;
   setExplanation(tr('Модель выбрана. Проверка ответа доступна отдельно.','Model selected. Response check is optional.'));
   return;
  }else{
   const id=chosen.slice('provider:'.length);
   const provider=providers.find(row=>str(row.provider_id)===id&&id!==OLLAMA);
   if(!provider)return;
   if(record(provider.health).ready!==true){
    setExplanation(tr('Источник пока не готов. Настройте его в разделе «Модели», затем выберите снова.','This source is not ready. Set it up in Models, then select it again.'));
    return;
   }
   const res=await run<Row>(tr('Переключить следующие сообщения на «','Switch future messages to "')+modelTitle(provider)+ (id===IWXA_ENGINE
      ?tr('»? Модель будет работать на этом компьютере.','"? The model will run on this computer.')
      :tr('»? Запросы к внешнему сервису могут передаваться за пределы устройства.','"? External requests may leave this device.')),
     'provider_connection_configure',{slot_id:'model',provider_id:id,values:{},activate:true},{kind:'provider',id});
   if(!res)return;
   notifyParent=true;
   const verified=record(await runtime.query<Row>('operational_control').catch(()=>({})));
   if(verified.active_model_provider_id!==id){setExplanation(tr('Активация пока не подтверждена. Проверьте подключение перед отправкой.','Activation is not yet confirmed. Check the connection before sending.'));return;}
  }
  changed.current=false;notifyParent=true;
  setExplanation(tr('Выбор подтверждён для новых сообщений и задач.','Selected for new messages and tasks.'));
  }catch(error){
   // A lost reply may follow a successful owner action; do not submit again.
   changed.current=false;setSwitchError(failure(error));notifyParent=true;
  }finally{
   // One final Core snapshot covers all branches; commands reload on mutation.
   changed.current=false;
   try{await load();}catch(error){setSwitchError(failure(error));}
   switchRef.current=false;setSwitching(false);
   if(notifyParent)onChanged?.();
  }
 }
 async function verify(){
  if(!currentlyLocal||ai.ready_for_activation!==true||busy)return;
  const name=str(ai.selected_model),digest=normalizedDigest(ai.selected_model_expected_digest);
  if(!name||!exactDigest(digest)){
   setExplanation(tr('Идентичность выбранной модели не подтверждена. Обновите список.',
    'The selected model identity is unverified. Refresh the list.'));
   return;
  }
  setExplanation('');
  if(await checkSelectedLocal(name,digest)){
   setExplanation(tr('Проверочный запрос выполнен. Ответ показан ниже.',
    'The model answered the verification request. Its answer is shown below.'));
   // run() already refreshed Core; do not repeat the full read.
   onChanged?.();
  }
 }
 return <div className={'conversation-model-choice'+(compact?' compact':'')}>
  <div className="model-choice-head"><strong>{localOnly
   ?tr('Локальная модель Goose','Goose local model')
   :tr('Модель для новых сообщений','Model for new messages')}</strong>
   <span>{activeTitle}</span>
   <button type="button" className="mini-button" disabled={busy} onClick={()=>{changed.current=false;void load();}}>{tr('Обновить','Refresh')}</button>
  </div>
  <div className="model-choice-controls">
   <select aria-label={localOnly?tr('Выберите локальную модель для Goose','Choose a local model for Goose'):tr('Выберите модель для следующего сообщения','Choose model for the next message')}
    value={candidate} disabled={busy||switching||!!fault} onChange={e=>{const next=e.target.value;changed.current=true;setCandidate(next);setExplanation('');setSwitchError('');void apply(next);}}>
    <option value="">{tr('Выберите модель','Select a model')}</option>
    {entries.map(row=><option key={row.key} value={row.key} disabled={'ready' in row&&row.ready===false}>{row.title}</option>)}
   </select>
   {switching&&<span className="model-choice-note" role="status">{tr('Подключаю и проверяю…','Connecting and verifying…')}</span>}
   {currentlyLocal&&<button type="button" disabled={busy||switching||ai.ready_for_activation!==true}
    onClick={()=>void verify()}>{tr('Повторить проверку','Recheck response')}</button>}
   {onOpenModels&&<button type="button" className="mini-button" onClick={onOpenModels}>{tr('Настроить модели','Set up models')}</button>}
  </div>
  {ai.source_confirmed!==true&&detectionChecked&&detected.responding===true&&
   <div className="model-choice-note">
    <p role="status">{availableOnComputer.length
      ?tr('На компьютере найдены модели Ollama: ','Ollama models found on this computer: ')
        +availableOnComputer.slice(0,8).map(model=>model.name).join(', ')
        +(availableOnComputer.length>8?'…':'')
      :tr('Ollama отвечает, но локальные модели не обнаружены. Проверьте её список моделей.',
        'Ollama responds, but no local models were reported. Check its model list.')}</p>
    {availableOnComputer.length>0&&
     <button type="button" disabled={busy||switching||connectingDetected||!!fault}
       onClick={()=>void connectDetectedOllama()}>
      {tr('Подключить найденную Ollama','Connect detected Ollama')}
     </button>}
   </div>}
  {ai.source_confirmed!==true&&detectionChecked&&detected.responding!==true&&
   <p className="model-choice-note" role="status">{tr(
    'Ollama сейчас не отвечает. Наличие ранее установленных моделей не проверено.',
    'Ollama is not responding. Previously installed models have not been checked.')}</p>}
  {detectionError&&<OwnerError error={detectionError} context={tr('Обнаружение Ollama','Ollama discovery')}/>}
  {active===IWXA_ENGINE&&!!str(record(engine.pin).name)&&<p className="model-choice-note">{tr('Выбранный GGUF: ','Selected GGUF: ')}
   {str(record(engine.pin).name)} · {engine.ready===true
    ?tr('движок готов к запросу','engine ready for a request')
    :tr('движок требует проверки или запуска','engine needs checking or starting')}</p>}
  {engineError&&<OwnerError error={engineError} context={tr('Проверка IWXA LLM Engine','IWXA LLM Engine status')}/>}
  {fault&&<OwnerError error={fault}/>}
  {switchError&&<OwnerError error={switchError} context={tr('Модель не подтверждена','Model not verified')}/>}
  {message&&<OwnerMessage diagnostic={diagnostic}>{message}</OwnerMessage>}
  {explanation&&<p className="model-choice-note" role="status">{explanation}</p>}
   {currentAnswer&&<div className="model-choice-note" role="status">
    <strong>{tr('Фрагмент реального ответа выбранной модели','Excerpt from the selected model’s real response')}</strong>
    <pre className="document-content">{currentAnswer}</pre>
   </div>}
  <p className="model-choice-note">{localOnly
   ?tr('Goose использует текущую модель Ollama. Её выбор также действует для новых диалогов и задач; разрешение на файлы не меняется. Внешние источники здесь недоступны.','Goose uses the active Ollama model. Selecting it also affects new conversations and tasks; file permissions stay unchanged. Cloud sources are unavailable here.')
   :tr('Выбор действует для новых сообщений и задач, не изменяет историю и не выдаёт модели доступа к файлам.','Selection applies to new messages and tasks, does not change history or grant file access.')}</p>
  {currentlyLocal&&ai.selection_mode==='USER_SELECTED_LOCAL'&&
   <p className="model-choice-note">{tr('Выбранную модель можно использовать для документов и задач. Проверяйте ответ перед принятием результата.','You can use this model for documents and tasks. Review its answer before acceptance.')}</p>}
 </div>;
}
