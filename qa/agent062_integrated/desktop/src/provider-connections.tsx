import React,{useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {record,records,str,failure,OwnerDetails,useOwnerActions,type Row} from './owner-ui';
import {HelpTip,useUiSettings} from './ui-preferences';
import {OwnerError} from './owner-ui';

type Slot=Row;
type Provider=Row;
export function ProviderConnections({initialSlot='model'}:{initialSlot?:string}){
 const {tr,language}=useUiSettings();
 const inputs=useRef<Record<string,HTMLInputElement|null>>({});
 // The Windows chooser can finish after a person has typed a path instead.
 // Its old reply must never replace the newer, explicitly selected folder.
 const folderSelectionEpoch=useRef(0);
 const folderConnectInFlight=useRef(false);
 const [setup,setSetup]=useState<Row>({}),[busyError,setBusyError]=useState(''),[slot,setSlot]=useState(initialSlot),[provider,setProvider]=useState(''),[limits,setLimits]=useState<Record<string,string>>({});
 const load=useCallback(async()=>{try{const result=await runtime.query<Row>('user_setup');setSetup(record(result));setBusyError('');}catch(e){setSetup({});setBusyError(failure(e));throw e}},[]);
 useEffect(()=>{void load().catch(e=>setBusyError(failure(e)))},[load]);
 useEffect(()=>{
  ++folderSelectionEpoch.current;
  setSlot(initialSlot);setProvider('');inputs.current={};setLimits({});
  setPickedFolder('');setFolderConsent(false);
 },[initialSlot]);
 const {run,busy,message}=useOwnerActions(load);
 const slots=records(setup.slots) as Slot[];
 const surfaceProviders=records(setup.surface_connections);
 const currentSlot=slots.find(x=>str(x.slot_id)===slot);
 const providers=slot==='interaction_surface'?surfaceProviders:records(currentSlot?.providers);
 const selectableProviders=providers.filter(x=>!['NONE','DEMO_REPLAY_V1'].includes(str(x.provider_id)));
 const current=selectableProviders.find(x=>str(x.provider_id)===provider)||selectableProviders[0];
 const providerId=str(current?.provider_id),selectedSlot=slot;
 const fields=records(current?.fields),meta=record(current?.connection),limitFields=records(meta.adapter_limit_fields);
 const active=!!providerId&&str(currentSlot?.active_provider_id)===providerId;
 const folderVerified=active&&record(current?.health).ready===true
  &&current?.verification_scope==='RUNTIME_OR_RESOURCE_OBSERVED';
 const isN8n=slot==='workflow_execution'&&providerId==='N8N_WORKFLOW_V1';
 const isLocalObscura=slot==='web_acquisition'&&providerId==='OBSCURA_LOCAL_V1';
 const obscuraStatus=record(setup.obscura),obscuraState=str(obscuraStatus.state);
 const obscuraVerified=obscuraStatus.u01_install_verified===true;
 const isLocalFolder=slot==='file_workspace'&&providerId==='LOCAL_FILES_V1';
 const [n8nCheck,setN8nCheck]=useState<Row|null>(null),[n8nChecking,setN8nChecking]=useState(false);
 const [pickedFolder,setPickedFolder]=useState(''),[folderConsent,setFolderConsent]=useState(false);
 const [pickingFolder,setPickingFolder]=useState(false),[pickerPending,setPickerPending]=useState(false);
 async function checkN8n(){
  if(n8nChecking)return;
  setN8nChecking(true);setN8nCheck(null);
  try{setN8nCheck(record(await runtime.query<Row>('n8n_local_status')));}
  catch(e){setBusyError(failure(e));}
  finally{setN8nChecking(false);}
 }
 const slotLabels:Record<string,[string,string]>={
 model:['Модель для задач','Model for tasks'],tool:['Инструменты','Tools'],
 web_acquisition:['Веб-доступ','Web access'],
 file_workspace:['Личная папка','Personal folder'],mcp_tools:['Дополнительные инструменты','Additional tools'],
 human_knowledge_workspace:['Материалы и заметки','Reference materials'],workflow_execution:['Локальные процессы','Local workflows'],interaction_surface:['Интерфейсы и приложения','Interfaces and apps']
 };
 const fieldLabels:Record<string,[string,string]>={
 api_key:['Ключ подключения','Access key'],base_url:['Адрес сервиса','Service address'],
 endpoint:['Адрес сервиса','Service address'],client_id:['Идентификатор приложения','Application ID'],
 client_secret:['Секрет приложения','Application secret'],access_token:['Ключ доступа','Access token'],
 model:['Модель','Model'],model_name:['Название модели','Model name'],execution_secret:['Секрет выполнения процессов','Workflow execution secret']
 };
 const readable=(id:string,labels:Record<string,[string,string]>)=>labels[id]?.[language==='ru'?0:1]||id.replace(/_/g,' ');
 const providerTitle=(row:Row)=>str(row.provider_id)==='OBSCURA_LOCAL_V1'
  ?tr('Obscura, локальный браузер','Obscura, local browser')
  :str(row.display_name)||str(row.name)||str(row.title)||str(row.provider_id).replace(/_V\d+$/,'').replaceAll('_',' ');

 async function submit(activate:boolean){
  if(!providerId)return;
  const submitted:Record<string,string>={};
  for(const x of fields){const key=str(x.field_id),val=(inputs.current[key]?.value||'').trim();if(val)submitted[key]=val;}
  try{
   const result=await run<Row>(tr('Сохранить настройки выбранного сервиса'+(activate?' и использовать подключение':'')+'?','Save the service settings'+(activate?' and use this connection':'')+'?'),
    'provider_connection_configure',
    {slot_id:selectedSlot,provider_id:providerId,values:submitted,activate:activate&&slot!=='interaction_surface'},
    {kind:'provider',id:providerId});
   // Keep ordinary edits on failure or an uncertain result.
   // A canceled confirmation never changes the form.
   if(result)for(const entry of Object.values(inputs.current)){
    if(entry&&entry.type!=='password')entry.value='';
   }
  }finally{
   // Credentials should not remain visible after a submission attempt.
   for(const field of fields){
    if(field.secret===true){
     const input=inputs.current[str(field.field_id)];
     if(input)input.value='';
    }
   }
  }
 }
 function enterFolderPath(path:string){
  // Text entry is an alternative to a stuck Windows chooser. It is NOT a
  // permission grant: only the confirmed provider configuration can activate
  // an OS-validated, existing local directory.
  ++folderSelectionEpoch.current;
  // The Windows Shell dialog may be hidden or slow. Choosing a manual path
  // abandons its reply without waiting for the Core's read-only chooser.
  setPickingFolder(false);
  setPickedFolder(path);setFolderConsent(false);setBusyError('');
 }
 function continueWithManualFolder(){
  // Do not cancel, repeat or forge an in-flight Core request. A late chooser
  // response is ignored; the person must still explicitly approve connection.
  ++folderSelectionEpoch.current;
  setPickingFolder(false);setBusyError('');
 }
 async function pickFolder(){
  // One native Shell dialog at a time, even after the person continues with
  // manual entry. More dialogs would leave hidden, unmanaged Windows windows.
  if(pickerPending||busy)return;
  const epoch=++folderSelectionEpoch.current;
  setPickerPending(true);setPickingFolder(true);setBusyError('');
  try{
   const selection=record(await runtime.command<Row>('local_file_folder_choose',{provider_id:'LOCAL_FILES_V1'},{kind:'provider',id:'LOCAL_FILES_V1'}));
   if(epoch!==folderSelectionEpoch.current)return;
   if(selection.cancelled===true){setPickedFolder('');setFolderConsent(false);return;}
   if(selection.selected!==true||!str(selection.path)||selection.access_granted!==false)
    throw Error('folder_selection_unconfirmed');
   setPickedFolder(str(selection.path));setFolderConsent(false);
  }catch(e){
   if(epoch===folderSelectionEpoch.current){
    setPickedFolder('');setFolderConsent(false);
    setBusyError(tr('Не удалось выбрать папку. ','Could not choose the folder. ')+failure(e));
   }
  }finally{setPickerPending(false);setPickingFolder(false)}
 }
 async function connectFolder(){
  const path=pickedFolder.trim();
  if(!isLocalFolder||!path||!folderConsent||busy||folderConnectInFlight.current)return;
  folderConnectInFlight.current=true;
  const epoch=folderSelectionEpoch.current;
  try{
   const result=await run<Row>(
    tr('Подключить выбранную локальную папку к IWXA? Чтение будет доступно после проверки подключения; изменение файлов всегда требует отдельного решения.','Connect this local folder to IWXA? Reading will become available after verification; changing files always needs separate approval.'),
    'provider_connection_configure',
    {slot_id:'file_workspace',provider_id:'LOCAL_FILES_V1',values:{root_personal_path:path},activate:true},
    {kind:'provider',id:'LOCAL_FILES_V1'});
   if(epoch!==folderSelectionEpoch.current)return;
   if(result&&result.activated===true){
    ++folderSelectionEpoch.current;
    setPickedFolder('');setFolderConsent(false);
   }else if(result){
    setBusyError(tr('Папка не подключена. Проверьте разрешения и состояние подключения.','The folder was not activated. Check its permissions and connection status.'));
   }
  }finally{folderConnectInFlight.current=false}
 }
 async function saveLimits(){
  const submitted:Record<string,number>={};
  for(const x of limitFields){const key=str(x.field_id),raw=limits[key];if(!raw)continue;const n=Number(raw);if(!Number.isFinite(n)||n<Number(x.minimum)||n>Number(x.maximum)||str(x.kind)==='integer'&&!Number.isInteger(n)){setBusyError(tr('Недопустимое значение лимита: ','Invalid limit value: ')+key);return;}submitted[key]=n;}
  if(!Object.keys(submitted).length)return;
  const saved=await run<Row>(tr('Сохранить ограничения подключения?','Save connection limits?'),
   'provider_limits_configure',{provider_id:providerId,values:submitted},{kind:'provider',id:providerId});
  if(saved)setLimits({});
 }
 return <section className="subpage card advanced">
  <div className="advanced-head"><div><h2>{tr('Подключения','Connections')} <HelpTip topic="Интеграции"/></h2><p>{tr('Выберите сервис, укажите необходимые параметры и проверьте подключение. Сохранённые настройки ещё не означают, что сервис работает.','Choose a service, provide its settings and check the connection. Saved settings do not mean the service is working.')}</p></div><button className="secondary-button" disabled={busy} onClick={()=>void load().catch(e=>setBusyError(failure(e)))}>{tr('Обновить','Refresh')}</button></div>
  {busyError&&<OwnerError error={busyError}/>}{message&&<p role="status" className="advanced-notice">{message}</p>}
  <div className="advanced-form">
   <h3>{tr('Настройка сервиса','Configure service')}</h3>
   <label className="advanced-field">{tr('Назначение','Capability')}<select value={slot} onChange={e=>{++folderSelectionEpoch.current;setSlot(e.target.value);setProvider('');inputs.current={};setLimits({});setPickedFolder('');setFolderConsent(false);}}>
    {slots.map(x=><option value={str(x.slot_id)} key={str(x.slot_id)}>{readable(str(x.slot_id),slotLabels)}</option>)}{!slots.some(x=>str(x.slot_id)==='interaction_surface')&&<option value="interaction_surface">{tr('Интерфейсы и приложения','Interfaces and apps')}</option>}</select></label>
   <label className="advanced-field">{tr('Провайдер','Provider')}<select value={providerId} onChange={e=>{++folderSelectionEpoch.current;setProvider(e.target.value);inputs.current={};setLimits({});setPickedFolder('');setFolderConsent(false);}}>
    {selectableProviders.map(x=><option key={str(x.provider_id)} value={str(x.provider_id)}>{providerTitle(x)}</option>)}</select></label>
   {!selectableProviders.length&&<p role="alert" className="advanced-error">{tr('Для назначения нет доступного профиля провайдера.','No configurable provider profile exists for this capability.')}</p>}
   {slot==='web_acquisition'&&obscuraState==='PROFILE_NOT_PROVISIONED'&&<p role="status" className="advanced-notice">{tr('Obscura пока не готова к подключению. Требуется утверждённый выпуск U01 и отдельная пользовательская установка. Тестовые сборки не подключаются автоматически.','Obscura is not yet ready to connect. It requires an approved U01 release and a separate user-approved installation. Test builds are never connected automatically.')}</p>}
   {isLocalObscura&&<div className="advanced-notice"><p>{tr('Obscura читает разрешённые HTTPS-страницы локально, без веб-поиска и записи на сайты. Отсутствие ключа API не доказывает готовность программы.','Obscura reads allowed HTTPS pages locally, without web search or website writes. Not requiring an API key does not prove the program is ready.')}</p>
    <p role="status">{obscuraState==='USER_ORIGINS_REVOKED'?tr('Доступ Obscura ко всем HTTPS-сайтам отозван. Новые чтения заблокированы. Изменить разрешения можно в «Программах».','Obscura access to all HTTPS sites is revoked. New reads are blocked. Manage permissions in Programs.'):
     obscuraState==='USER_ORIGINS_CHANGED_OR_INVALID'?tr('Разрешения на HTTPS-сайты изменились или не подтверждены. Проверьте выбор в «Программах». Новые чтения заблокированы.','HTTPS permissions changed or could not be verified. Review them in Programs. New reads are blocked.'):
     !obscuraVerified?tr('U01 не подтвердил установленный исполняемый файл. Установка и подключение остаются раздельными действиями.','U01 has not verified the installed executable. Installation and connection remain separate actions.'):
     obscuraState==='INSTALLED_NOT_SELECTED'?tr('Установленный файл проверен U01. Можно выбрать Obscura как источник чтения.','U01 verified the installed file. You can select Obscura for read-only acquisition.'):
     obscuraState==='SELECTED_T3_OFF_REQUIRED'?tr('Obscura выбрана, но внешние HTTPS-страницы недоступны при включённом T3.','Obscura is selected, but external HTTPS pages are blocked while T3 mode is on.'):
     obscuraState==='READ_ONLY_READY'?tr('Obscura выбрана, U01 подтвердил файл, чтение HTTPS разрешено действующими настройками.','Obscura is selected, U01 verified the file, and current settings permit HTTPS reads.'):
     tr('Установка проверяется существующим U01; выпуск и полномочия проверяются отдельно.','Installation is checked by the existing U01; release and authorization must be checked separately.')}</p>
   </div>}
   {isN8n&&<div className="advanced-notice"><p>{tr('Укажите локальный адрес n8n, например http://127.0.0.1:5678. Сохраните параметры, проверьте ответ сервиса и затем выберите подключение.','Enter a local n8n address, such as http://127.0.0.1:5678. Save the settings, check the service response, then select the connection.')}</p>
    <button type="button" disabled={busy||n8nChecking} onClick={()=>void checkN8n()}>{n8nChecking?tr('Проверяю…','Checking…'):tr('Проверить n8n','Check n8n')}</button>
    {n8nCheck&&<p role="status">{n8nCheck.responding===true?tr('n8n отвечает. Теперь можно выбрать это подключение. Для запуска процесса потребуется отдельное подтверждение действия.','n8n responds. You can now select this connection. Running a workflow requires separate action approval.'):tr('Подключение не подтверждено. Проверьте адрес и работу n8n.','Connection unverified. Check the address and n8n service.')}</p>}</div>}
   <p>{active?tr('Выбрано для этого назначения','Selected for this purpose'):tr('Не выбран для этого назначения','Not active for this capability')} · {current?.verification_scope==='RUNTIME_OR_RESOURCE_OBSERVED'?tr('Доступ подтверждён','Observed ready'):current?.verification_scope==='CONFIGURATION_ONLY'?tr('Настроено, требуется проверка при использовании','Configured, runtime unverified'):tr('Требует настройки','Needs setup')}</p>
   {isLocalFolder&&<div className="advanced-form">
    <h3>{tr('Выбрать папку с файлами','Choose a folder')}</h3>
    <p>{tr('Выберите существующую локальную папку на компьютере. IWXA не перемещает и не меняет её содержимое при подключении.','Select an existing folder on this computer. IWXA does not move or change its contents when connecting.')}</p>
    <button type="button" disabled={busy||pickerPending} onClick={()=>void pickFolder()}>{pickingFolder?
     tr('Открываем выбор папки…','Opening folder picker…'):pickerPending?
     tr('Выбор папки ещё открыт','Folder chooser is still open'):tr('Выбрать папку…','Choose folder…')}</button>
    {pickingFolder&&<button type="button" className="secondary-button" onClick={continueWithManualFolder}>
     {tr('Продолжить с ручным вводом','Continue by entering a path')}</button>}
    {pickerPending&&!pickingFolder&&<p role="status">{tr(
     'Окно Windows может оставаться открытым. Можно подключить папку по введённому пути: поздний ответ выбора не заменит его.',
     'The Windows dialog may still be open. You can connect a manually entered folder; a late picker reply cannot replace it.')}</p>}
    <label className="advanced-field">{tr('Или укажите путь к существующей папке','Or enter the path to an existing folder')}
     <input type="text" maxLength={4096} autoComplete="off" value={pickedFolder}
      onChange={e=>enterFolderPath(e.target.value)} placeholder="C:\\Users\\…\\Documents"/>
    </label>
    <p>{tr('Если окно выбора не открылось, введите локальный путь. Приложение проверит его перед подключением; до вашего согласия доступ к файлам не предоставляется.',
      'If the folder picker did not open, enter a local path. The app validates it before connecting and grants no file access without your consent.')}</p>
    {pickedFolder.trim()&&<><p>{tr('Выбрана папка: ','Selected folder: ')}{pickedFolder.trim()}</p>
     <label><input type="checkbox" checked={folderConsent} onChange={e=>setFolderConsent(e.target.checked)}/>{tr('Разрешаю IWXA использовать выбранную папку. Запись и удаление файлов отдельно подтверждаются для каждого действия.','Allow IWXA to use this folder. File writes and removals require separate approval for each action.')}</label>
     <button type="button" disabled={busy||!folderConsent||!pickedFolder.trim()} onClick={()=>void connectFolder()}>{tr('Подключить папку','Connect folder')}</button></>}
    {active&&<p role="status">{folderVerified
      ?tr('Личная папка подключена. Изменение файлов требует отдельного подтверждения.',
        'Personal folder connected. File changes require separate approval.')
      :tr('Папка выбрана, но доступ к файлам пока не подтверждён. Проверьте её в разделе «Файлы».',
        'Folder selected, but file access has not been verified. Check it in Files.')}</p>}
   </div>}
   {fields.filter(x=>!(isLocalFolder&&str(x.field_id)==='root_personal_path')).map(x=>{const key=str(x.field_id);return <label className="advanced-field" key={key}>{readable(key,fieldLabels)} {x.configured===true?'✓':''}
    <input key={selectedSlot+":"+providerId+":"+key} autoComplete="off" type={x.secret===true?'password':'text'} ref={input=>{inputs.current[key]=input;}} placeholder={x.configured===true?tr('Уже сохранено; оставить без изменений','Stored; leave blank to keep'):''}/></label>})}
   <div className="advanced-actions">
    {!isLocalFolder&&!isLocalObscura&&<button disabled={busy||!providerId} onClick={()=>void submit(false)}>{tr('Сохранить','Save only')}</button>}
    {!isLocalFolder&&!isLocalObscura&&slot!=='interaction_surface'&&<button disabled={busy||!providerId} onClick={()=>void submit(true)}>{tr('Сохранить и использовать','Save and use')}</button>}
    {slot!=='interaction_surface'&&!active&&<button disabled={busy||!providerId||(isLocalObscura&&!obscuraVerified)} onClick={()=>void run(
     tr('Активировать уже сохранённый профиль '+providerId+' без повторного ввода секретов? Core проверит готовность.','Use connection profile '+providerId+' without re-entering credentials? Core will check readiness.'),
     'provider_switch',{slot_id:selectedSlot,provider_id:providerId},{kind:'provider',id:providerId})}>
      {tr('Использовать подключение','Activate saved')}
    </button>}
    <button disabled={busy||!providerId} onClick={()=>void run(tr('Удалить сохранённые параметры этого подключения без удаления программы?','Remove stored connection settings without uninstalling the program?'),'provider_connection_disconnect',{slot_id:slot,provider_id:providerId},{kind:'provider',id:providerId})}>{tr('Отключить','Disconnect')}</button>
   </div>
   {limitFields.length>0&&<><h3>{tr('Параметры модели и лимиты','Model settings and limits')}</h3>{limitFields.map(x=>{const key=str(x.field_id);
    if(key==='reasoning_effort_level')return <label key={key} className="advanced-field">{tr('Усилия рассуждений','Reasoning effort')}
     <select disabled={busy} value={limits[key]??str(x.value)} onChange={e=>setLimits(v=>({...v,[key]:e.target.value}))}>
      <option value="0">{tr('Авто (режим модели)','Auto (model default)')}</option>
      <option value="-1">{tr('Выключено','Off')}</option>
      <option value="1">{tr('Низкие','Low')}</option>
      <option value="2">{tr('Средние','Medium')}</option>
      <option value="3">{tr('Высокие','High')}</option>
     </select><small>{tr('Применяется только если выбранная модель поддерживает этот режим. Неподдерживаемый уровень не заменяется другим.','Applies only when the selected model supports this control; unsupported levels are never silently substituted.')}</small>
    </label>;
    return <label key={key} className="advanced-field">{readable(key,fieldLabels)} ({str(x.minimum)} - {str(x.maximum)})
    <input type="number" min={Number(x.minimum)} max={Number(x.maximum)} step={str(x.kind)==='integer'?'1':'any'} value={limits[key]??str(x.value)} onChange={e=>setLimits(v=>({...v,[key]:e.target.value}))}/></label>})}
    <button disabled={busy||!Object.keys(limits).length} onClick={()=>void saveLimits()}>{tr('Сохранить параметры','Save settings')}</button></>}
   <details className="advanced-field"><summary>{tr('Технический статус','Technical status')}</summary><OwnerDetails value={current}/></details>
  </div>
  <p className="advanced-notice">{tr('Секретные поля не читаются обратно и не сохраняются в React. Для выбора установленной модели Ollama используйте раздел «Модели».','Secret values are never read back or stored in React. Use Models to select an installed Ollama model.')}</p>
 </section>;
}
