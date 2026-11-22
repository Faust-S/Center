import React,{useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {record,records,str,failure,OwnerDetails,OwnerError,OwnerMessage,useOwnerActions,type Row} from './owner-ui';
import {HelpTip,useUiSettings} from './ui-preferences';


function onlineReadSlot(toolId:string):'mail'|'calendar'|'contacts'|''{
 if(toolId.startsWith('mail.'))return 'mail';
 if(toolId.startsWith('calendar.'))return 'calendar';
 if(toolId.startsWith('contacts.'))return 'contacts';
 return '';
}

/** Read-only projection of the existing Core account catalogue, never a second registry. */
function readyOnlineReadAccounts(snapshot:Row,toolId:string):Row[]{
 const slot=onlineReadSlot(toolId);
 if(!slot)return [];
 return records(snapshot.accounts).filter(account=>
  str(account.service)===slot&&account.can_select_for_task===true
  &&account.connection_state==='CONFIGURED_UNVERIFIED'
  &&Array.isArray(account.operations)&&account.operations.includes(toolId)
  &&/^[A-Z][A-Z0-9_]{2,79}$/.test(str(account.provider_id)));
}

export function ToolsReadControl({onConnections,focusToolId='',onAttachToDraft,inlineDestination=null}:{onConnections:()=>void;focusToolId?:string;onAttachToDraft?:(destination:'task'|'dialogue',receiptId:string,data:unknown)=>Promise<void>;inlineDestination?:'task'|'dialogue'|null}){
 const {tr}=useUiSettings();
 const [catalog,setCatalog]=useState<Row>({}),[mcp,setMcp]=useState<Row>({}),[error,setError]=useState('');
 const [mcpStatusIssue,setMcpStatusIssue]=useState('');
 const [toolId,setToolId]=useState(focusToolId),[filePath,setFilePath]=useState(''),[argumentsText,setArgumentsText]=useState('{}'),[lastResult,setLastResult]=useState<Row|null>(null);
 const [fieldValues,setFieldValues]=useState<Record<string,string>>({});
 const [onlineAccounts,setOnlineAccounts]=useState<Row>({});
 const [onlineAccountState,setOnlineAccountState]=useState<'idle'|'loading'|'ready'|'unavailable'>('idle');
 const [accountRefresh,setAccountRefresh]=useState(0);
 const accountReadEpoch=useRef(0);
 const onlineService=onlineReadSlot(toolId);
 // The local account list is optional for unrelated read tools. A stale
 // response must never overwrite a later account or tool selection.
 useEffect(()=>{
  const epoch=++accountReadEpoch.current;
  if(!onlineService){setOnlineAccounts({});setOnlineAccountState('idle');return;}
  setOnlineAccounts({});setOnlineAccountState('loading');
  void runtime.query<Row>('online_accounts').then(data=>{
   if(epoch!==accountReadEpoch.current)return;
   const snapshot=record(data);
   if(snapshot.schema!=='IWXA_AGENT06_ONLINE_ACCOUNTS/1'
      ||!Array.isArray(snapshot.accounts))throw Error('online_accounts_contract_changed');
   setOnlineAccounts(snapshot);setOnlineAccountState('ready');
  }).catch(()=>{
   if(epoch!==accountReadEpoch.current)return;
   setOnlineAccounts({});setOnlineAccountState('unavailable');
  });
  return()=>{accountReadEpoch.current++};
 },[onlineService,accountRefresh]);
 // Changing the selected source or its arguments invalidates a pending read
 // result. A slow previous tool must never appear as the current tool's answer.
 const resultEpoch=useRef(0),catalogLoadEpoch=useRef(0);
 const invalidateRead=()=>{resultEpoch.current++;setLastResult(null);};
 useEffect(()=>{if(focusToolId){invalidateRead();setToolId(focusToolId);}},[focusToolId]);
 const [mcpDiscovery,setMcpDiscovery]=useState<Row|null>(null),[mcpSelected,setMcpSelected]=useState<string[]>([]);
 const [mcpBusy,setMcpBusy]=useState(false),[mcpError,setMcpError]=useState(''),[mcpNotice,setMcpNotice]=useState('');
 const [attaching,setAttaching]=useState(false);
 const load=useCallback(async()=>{
  const epoch=++catalogLoadEpoch.current;
  const read=async(key:'tool_catalog'|'mcp_user_tools')=>{
   try{
    const data=record(await runtime.query<Row>(key));
    if(epoch!==catalogLoadEpoch.current)return;
    if(key==='tool_catalog'){setCatalog(data);setError('');}
    else{setMcp(data);setMcpStatusIssue('');}
   }catch(e){
    if(epoch!==catalogLoadEpoch.current)return;
    if(key==='tool_catalog'){setCatalog({});setError('tool_catalog: '+failure(e));}
    else{setMcp({});setMcpStatusIssue('mcp_user_tools: '+failure(e));}
   }
  };
  // The main Task tool catalogue is independent of optional MCP metadata.
  // Resolve a refresh when the Task tools are available, not when MCP replies.
  const primary=read('tool_catalog');
  void read('mcp_user_tools');
  await primary;
 },[]);
 useEffect(()=>{void load();return()=>{catalogLoadEpoch.current++;};},[load]);
 const {run,busy,message,diagnostic}=useOwnerActions(load);
 const mcpReady=mcp.provider_active===true&&record(mcp.provider_health).ready===true;
 const mcpDiscovered=records(record(mcpDiscovery).tools).filter(tool=>{
  const name=str(tool.server_name),digest=str(tool.server_tool_digest);
  return name.length>0&&name.length<=240&&/^[0-9a-f]{64}$/.test(digest);
 });
 const mcpKey=(tool:Row)=>str(tool.server_name)+'::'+str(tool.server_tool_digest);
 const importedMcpTools=records(mcp.tools);
 const importedMcpKeys=new Set(importedMcpTools.map(mcpKey));
 const mcpSavedMatchesSelection=!!mcpDiscovery&&mcpSelected.length===importedMcpKeys.size
  &&mcpSelected.every(value=>importedMcpKeys.has(value));
 async function discoverMcp(){
  if(mcpBusy||busy||!mcpReady)return;
  setMcpBusy(true);setMcpError('');setMcpNotice('');setMcpDiscovery(null);setMcpSelected([]);
  try{
   await runtime.refreshRevision();
   const data=record(await runtime.command<Row>('mcp_discover_tools',
    {provider_id:'MCP_HTTP_20260728'},{kind:'provider',id:'MCP_HTTP_20260728'}));
   if(data.schema!=='IWXA_MCP_USER_DISCOVERY/1.0.0'||!Array.isArray(data.tools)
      ||data.tools.length>500||data.consequential_import_supported!==false){
    throw Error('mcp_discovery_contract_mismatch');
   }
   const observed=records(data.tools);
   if(observed.length!==data.tools.length
      ||observed.some(tool=>!str(tool.server_name)||!/^[0-9a-f]{64}$/.test(str(tool.server_tool_digest)))){
    throw Error('mcp_discovery_tools_invalid');
   }
   setMcpDiscovery(data);
   setMcpSelected(observed.filter(tool=>importedMcpKeys.has(mcpKey(tool))).map(mcpKey));
   setMcpNotice(tr('Инструменты обнаружены. Выберите те, которым разрешаете чтение, затем сохраните выбор.',
      'Tools were discovered. Choose the read tools you want to allow, then save.'));
  }catch(e){setMcpDiscovery(null);setMcpError(tr('Не удалось получить список инструментов сервера. Проверьте его подключение. ',
      'Could not discover server tools. Check its connection. ')+failure(e));}
  finally{setMcpBusy(false);}
 }
 function toggleMcp(key:string,checked:boolean){
  setMcpNotice('');
  setMcpSelected(current=>checked
   ?[...new Set([...current,key])]
   :current.filter(value=>value!==key));
 }
 async function saveMcp(){
  if(mcpBusy||busy||!mcpDiscovery||!mcpReady)return;
  const selections=mcpDiscovered.filter(tool=>mcpSelected.includes(mcpKey(tool))).map(tool=>({
   server_name:str(tool.server_name),server_tool_digest:str(tool.server_tool_digest)
  }));
  if(selections.length!==mcpSelected.length){
   setMcpError(tr('Каталог инструментов изменился. Получите его заново.',
      'The tool catalogue changed. Discover it again.'));
   return;
  }
  setMcpError('');setMcpNotice('');
  const accepted=await run<Row>(selections.length
   ?tr('Сохранить выбранные инструменты чтения? IWXA повторно сверит список с сервером. Другие действия не разрешаются.',
     'Allow these read tools? IWXA will verify the current server catalogue again. No other actions will be permitted.')
   :tr('Отключить все ранее выбранные инструменты чтения этого сервера?',
     'Remove all previously allowed read tools for this server?'),
   'mcp_replace_read_tools',{provider_id:'MCP_HTTP_20260728',selections},
   {kind:'provider',id:'MCP_HTTP_20260728'});
  if(!accepted)return;
  try{
   const saved=record(await runtime.query<Row>('mcp_user_tools'));
   const entries=records(saved.tools);
   const intended=new Set(selections.map(row=>row.server_name+'::'+row.server_tool_digest));
   const observed=new Set(entries.map(mcpKey));
   if(entries.length!==intended.size||observed.size!==intended.size
      ||[...intended].some(key=>!observed.has(key))){
    throw Error('mcp_user_policy_readback_mismatch');
   }
   setMcp(saved);setMcpNotice(tr('Выбор сохранён. Разрешённые инструменты доступны в списке ниже.',
       'Selection saved. Permitted tools are available below.'));
   setMcpDiscovery(null);setMcpSelected([]);
  }catch(e){
   setMcpError(tr('Изменение принято, но подтвердить сохранённый список не удалось. Обновите сведения перед следующим действием. ',
     'The change was accepted, but the saved list could not be verified. Refresh before the next action. ')+failure(e));
  }
 }
 const tools=records(catalog.tools);
 const readTools=tools.filter(row=>{
  const descriptor=record(row.descriptor),policy=record(row.policy);
  return row.available===true&&policy.status==='ALLOW'&&policy.effect_class==='READ_ONLY'
    &&policy.approval_requirement==='NOT_REQUIRED'&&!!str(descriptor.tool_id);
 });
 const chosen=readTools.find(row=>str(record(row.descriptor).tool_id)===toolId);
 const readyReadAccounts=readyOnlineReadAccounts(onlineAccounts,toolId);
 const remoteReadDenied=!!onlineService&&onlineAccounts.remote_execution_available===false;
 const explicitReadAccount=str(fieldValues.account_id);
 const effectiveReadAccount=explicitReadAccount||
  (readyReadAccounts.length===1?str(readyReadAccounts[0].provider_id):'');
 const personalFileRead=toolId==='files.read';
 const inputSchema=record(record(chosen?.descriptor).input_schema);
 const properties=record(inputSchema.properties);
 const fieldNames=Object.keys(properties);
 const simpleForm=!personalFileRead&&fieldNames.length>0&&fieldNames.length<=12
   &&fieldNames.every(name=>/^[a-zA-Z_][a-zA-Z0-9_]{0,100}$/.test(name)
     &&['string','integer','number','boolean'].includes(str(record(properties[name]).type)))
   &&(!Array.isArray(inputSchema.required)||inputSchema.required.every(name=>typeof name==='string'&&fieldNames.includes(name)));
 // MCP status is optional. A failed MCP status query cannot disable an
 // independently eligible local read tool returned by Core tool_catalog.
 const permitted=!!chosen;
 const toolName=(row:Row)=>{
  const descriptor=record(row.descriptor),id=str(descriptor.tool_id);
  if(id==='files.read')return tr('Прочитать локальный файл','Read local file');
  if(id==='files.list')return tr('Показать файлы','List files');
  return str(descriptor.display_name)||str(descriptor.name)||str(descriptor.description)
    ||tr('Дополнительный инструмент чтения','Additional read tool');
 };
 async function executeRead(){
  if(!permitted)return;
  let args:Row;
  if(personalFileRead){
   if(!filePath.trim()){setError(tr('Укажите файл в разрешённой личной папке.','Enter a file in the authorized personal folder.'));return;}
   args={root_id:'personal',path:filePath.trim()};
  }else if(simpleForm){
   args={};
   if(onlineService){
    if(remoteReadDenied){
     setError(tr('В режиме T3 внешние аккаунты недоступны. Измените режим в настройках Agent.',
       'External accounts are unavailable in T3 mode. Change the mode in Agent settings.'));return;
    }
    if(onlineAccountState==='idle'||onlineAccountState==='loading'){
     setError(tr('Список аккаунтов ещё загружается.','The account list is still loading.'));return;
    }
    if(onlineAccountState==='unavailable'&&
       (chosen?.account_selection_required===true||!!explicitReadAccount)){
     setError(tr('Не удалось проверить выбранный аккаунт. Обновите подключения.',
       'The selected account cannot be verified. Refresh connections.'));return;
    }
    if(onlineAccountState==='ready'){
     if(explicitReadAccount&&!readyReadAccounts.some(a=>str(a.provider_id)===explicitReadAccount)){
      setError(tr('Выбранный аккаунт изменился. Выберите его заново.',
       'The selected account changed. Select it again.'));return;
     }
     if(readyReadAccounts.length>1&&!explicitReadAccount){
      setError(tr('Выберите аккаунт, из которого нужно прочитать данные.',
       'Choose the account to read from.'));return;
     }
     if(chosen?.account_selection_required===true&&!effectiveReadAccount){
      setError(tr('Сначала настройте доступный аккаунт в разделе «Подключения».',
       'Configure an available account under Connections first.'));return;
     }
    }
   }
   const required=Array.isArray(inputSchema.required)?inputSchema.required:[];
   for(const name of fieldNames){
    if(name==='account_id'&&onlineService){
     if(effectiveReadAccount)args.account_id=effectiveReadAccount;
     continue;
    }
    const spec=record(properties[name]),value=fieldValues[name]??'';
    if(value.trim()===''){
     if(required.includes(name)){setError(tr('Заполните поле: ','Complete the field: ')+name);return;}
     continue;
    }
    const type=str(spec.type);
    if(type==='boolean'){
     if(value!=='true'&&value!=='false'){setError('tool_boolean_parameter_invalid');return;}
     args[name]=value==='true';
    }else if(type==='integer'||type==='number'){
     const numeric=Number(value);
     if(!Number.isFinite(numeric)||(type==='integer'&&!Number.isSafeInteger(numeric))){
      setError(tr('Проверьте числовой параметр: ','Check the numeric field: ')+name);return;
     }
     args[name]=numeric;
    }else{
     if(Array.isArray(spec.enum)&&!spec.enum.includes(value)){
      setError(tr('Значение поля больше не разрешено: ','Value is no longer permitted: ')+name);return;
     }
     args[name]=value;
    }
   }
  }else{
   try{
    const parsed=JSON.parse(argumentsText);
    if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw Error('arguments_must_be_object');
    args=record(parsed);
   }catch(e){setError(tr('Проверьте дополнительные параметры чтения.','Check the additional read parameters.')+' '+failure(e));return;}
  }
  const requestEpoch=++resultEpoch.current;
  setLastResult(null);setError('');
  const answer=await run<Row>(
   tr('Прочитать выбранный источник и сохранить подтверждение результата?','Read the selected source and record its result?'),
   'tool_read',{arguments:args},{kind:'tool',id:toolId});
  // The existing Core receipt is authoritative. Only display it for
  // the unchanged request, never after user edits or focus navigation.
  if(answer&&requestEpoch===resultEpoch.current){
   const receipt=record(record(answer).receipt);
   if(str(receipt.tool_id)!==toolId
      ||(str(args.account_id)&&str(receipt.provider_id)!==str(args.account_id))
      ||!['SUCCEEDED','INPUT_REQUIRED'].includes(str(receipt.status))){
    setError(tr('Ответ чтения не совпадает с выбранным инструментом. Проверьте квитанцию перед новым действием.',
      'The read response does not match the selected tool. Inspect the receipt before another action.'));
   }else setLastResult(record(answer));
  }
 }
 return <section className={inlineDestination?'advanced-form iwxa-tool-inline':'subpage card advanced'}>
  <div className="advanced-head"><div>
   {inlineDestination?<h3>{tr('Прочитать источник для работы','Read a source for this work')}</h3>
    :<h2>{tr('Инструменты чтения','Read tools')} <HelpTip topic="Инструменты"/></h2>}
   <p>{tr('Доступны только разрешённые действия чтения. Результат можно добавить в текущий черновик.',
    'Only permitted read actions are available. Their results can be added to the current draft.')}</p></div>
   <button className="secondary-button" disabled={busy} onClick={()=>{
    invalidateRead();setAccountRefresh(n=>n+1);void load();
   }}>{tr('Обновить','Refresh')}</button>
  </div>
  {error&&<OwnerError error={error}/>}
  {message&&<OwnerMessage diagnostic={diagnostic}>{message}</OwnerMessage>}
  {!inlineDestination&&<div className="advanced-form">
   <h3>{tr('Инструменты MCP','MCP tools')}</h3>
   <p>{mcpReady?tr('Сервер подключён. Вы можете выбрать доступные инструменты для чтения.',
       'The server is connected. You can select the available read tools.')
       :tr('Сначала подключите MCP-сервер в разделе «Подключения», затем проверьте его инструменты.',
        'Connect an MCP server in Connections first, then discover its tools.')}</p>
   <div className="advanced-actions">
    <button type="button" disabled={busy||mcpBusy||!mcpReady} onClick={()=>void discoverMcp()}>
     {mcpBusy?tr('Получаем инструменты…','Discovering tools…'):tr('Найти инструменты MCP','Discover MCP tools')}</button>
    <button type="button" disabled={busy||mcpBusy} onClick={onConnections}>{tr('Подключить сервер','Connect server')}</button>
   </div>
   {mcpStatusIssue&&<div role="status"><p>{tr('Состояние MCP сейчас недоступно. Локальные инструменты по-прежнему можно использовать.', 'MCP status is unavailable. Available local tools can still be used.')}</p>
     <OwnerDetails title={tr('Причина','Details')} value={mcpStatusIssue}/></div>}
   {mcpError&&<OwnerError error={mcpError}/>} 
   {mcpNotice&&<p role="status">{mcpNotice}</p>}
   {importedMcpTools.length>0&&<p>{tr('Разрешено инструментов чтения: ','Allowed read tools: ')}{importedMcpTools.length}</p>}
   {mcpDiscovery&&<>
    <p>{tr('Найдено инструментов: ','Discovered tools: ')}{mcpDiscovered.length}.
       {tr(' Выберите только те, которые действительно выполняют чтение. Действия с изменением данных здесь не поддерживаются.',
           ' Choose only tools that genuinely read data. Mutating tools are not supported here.')}</p>
    {mcpDiscovered.map(tool=>{
     const key=mcpKey(tool),name=str(tool.title)||str(tool.server_name);
     return <label className="owner-row" key={key}>
      <input type="checkbox" disabled={busy||mcpBusy||!mcpReady}
       checked={mcpSelected.includes(key)} onChange={e=>toggleMcp(key,e.target.checked)}/>
      <strong>{name}</strong><small>{str(tool.description)}</small>
     </label>;
    })}
    <div className="advanced-actions">
     <button type="button" disabled={busy||mcpBusy||!mcpReady||mcpSavedMatchesSelection}
      onClick={()=>void saveMcp()}>{mcpSelected.length?tr('Разрешить выбранные инструменты','Allow selected tools')
       :tr('Отключить выбранные инструменты','Remove allowed tools')}</button>
     <button type="button" disabled={busy||mcpBusy} onClick={()=>{setMcpDiscovery(null);setMcpSelected([]);setMcpNotice('');}}>
      {tr('Отменить выбор','Cancel selection')}</button>
    </div>
   </>}
   <details><summary>{tr('Сведения о подключении','Connection details')}</summary><OwnerDetails value={mcp}/></details>
  </div>}
  <div className="advanced-form"><h3>{tr('Выберите действие','Choose an action')}</h3>
   <p>{readTools.length?tr('Выберите установленный и разрешённый инструмент.','Choose an installed, authorized tool.')
    :tr('Пока нет доступных инструментов чтения. Подключите программу и проверьте её доступ.','No read tool is available yet. Connect a program and verify access.')}</p>
   {!inlineDestination&&<button type="button" onClick={onConnections}>{tr('Настроить источники','Configure sources')}</button>}
   {inlineDestination&&!readTools.length&&<button type="button" onClick={onConnections}>{tr('Подключить инструменты','Connect tools')}</button>}
   <label className="advanced-field">{tr('Что прочитать','What to read')}<select value={toolId}
    onChange={e=>{invalidateRead();setToolId(e.target.value);setFilePath('');setArgumentsText('{}');setFieldValues({});}}>
    <option value="">{tr('Выберите способ чтения','Choose a read action')}</option>
    {readTools.map((row,i)=><option key={str(record(row.descriptor).tool_id)}
     value={str(record(row.descriptor).tool_id)}>{toolName(row)} · {i+1}</option>)}
   </select></label>
   {chosen&&<>
    {personalFileRead?<label className="advanced-field">{tr('Путь к файлу внутри личной папки','Path inside the personal folder')}
     <input value={filePath} onChange={e=>{invalidateRead();setFilePath(e.target.value);}}
      placeholder={tr('Например: заметки/план.md','For example: notes/plan.md')}/></label>
    :simpleForm?<div className="advanced-form">
      {fieldNames.map(name=>{
       const spec=record(properties[name]),type=str(spec.type),required=Array.isArray(inputSchema.required)&&inputSchema.required.includes(name);
       const labelText=str(spec.title)||name;
       const choices=Array.isArray(spec.enum)?spec.enum.filter(value=>typeof value==='string') as string[]:[];
       if(name==='account_id'&&onlineService)return <label className="advanced-field" key={name}>
        {tr('Аккаунт для чтения','Account to read from')}
        <select value={effectiveReadAccount} disabled={busy||onlineAccountState!=='ready'}
         onChange={e=>{invalidateRead();setFieldValues(v=>({...v,account_id:e.target.value}));}}>
         <option value="">{onlineAccountState==='loading'
          ?tr('Читаем аккаунты…','Reading accounts…')
          :tr('Выберите аккаунт','Choose an account')}</option>
         {readyReadAccounts.map(account=><option key={str(account.provider_id)} value={str(account.provider_id)}>
          {str(account.label)||str(account.provider_id)} · {str(account.vendor)} · {str(account.provider_id)}
         </option>)}
        </select>
        {remoteReadDenied&&<small role="status">{tr(
         'T3 включён: внешние запросы отключены. Для чтения этого аккаунта измените режим в настройках Agent.',
         'T3 is enabled: external requests are disabled. Change the mode in Agent settings to read this account.')}</small>}
        {onlineAccountState==='unavailable'&&<small role="status">{tr(
         chosen?.account_selection_required===true
          ?'Список аккаунтов недоступен. Обновите подключения, чтобы выбрать аккаунт.'
          :'Список аккаунтов недоступен. Возможно чтение только из текущего подключения по умолчанию.',
         chosen?.account_selection_required===true
          ?'The account list is unavailable. Refresh connections to choose an account.'
          :'The account list is unavailable. Only the current default connection may be used.')}</small>}
        {onlineAccountState==='ready'&&readyReadAccounts.length===0&&<small role="status">{tr(
         'Нет настроенных аккаунтов для этого действия. Проверьте подключения.',
         'No configured account is available for this action. Check Connections.')}</small>}
        {onlineAccountState==='ready'&&readyReadAccounts.length>1&&!explicitReadAccount&&<small>{tr(
         'Выберите конкретный аккаунт. Глобальное подключение изменять не нужно.',
         'Choose an account. The global connection will not change.')}</small>}
       </label>;
       return <label className="advanced-field" key={name}>
        {labelText}{required?' *':''}
        {type==='boolean'?<select value={fieldValues[name]??''}
         onChange={e=>{invalidateRead();setFieldValues(v=>({...v,[name]:e.target.value}))}}>
         <option value="">{tr('Не задано','Not set')}</option>
         <option value="true">{tr('Да','Yes')}</option>
         <option value="false">{tr('Нет','No')}</option>
        </select>:choices.length?<select value={fieldValues[name]??''}
         onChange={e=>{invalidateRead();setFieldValues(v=>({...v,[name]:e.target.value}))}}>
         <option value="">{tr('Выберите значение','Choose value')}</option>
         {choices.map(choice=><option key={choice} value={choice}>{choice}</option>)}
        </select>:<input type={type==='integer'||type==='number'?'number':'text'}
         step={type==='integer'?'1':type==='number'?'any':undefined}
         value={fieldValues[name]??''} onChange={e=>{invalidateRead();setFieldValues(v=>({...v,[name]:e.target.value}))}}/>}
       </label>;
      })}
     </div>
    :<details className="owner-details"><summary>{tr('Дополнительные параметры','Additional parameters')}</summary>
     <p>{tr('Этот инструмент требует специальных параметров. Укажите их только если вам известна схема разрешённого чтения.',
      'This tool requires advanced parameters. Supply them only when you know its authorized read schema.')}</p>
     <textarea rows={5} aria-label={tr('Параметры инструмента','Tool parameters')}
      value={argumentsText} onChange={e=>{invalidateRead();setArgumentsText(e.target.value)}}/>
    </details>}
    <button type="button" disabled={busy||!permitted||(personalFileRead&&!filePath.trim())
     ||(!!onlineService&&(onlineAccountState==='idle'||onlineAccountState==='loading'))
     ||remoteReadDenied
     ||(!!onlineService&&chosen?.account_selection_required===true&&!effectiveReadAccount)
     ||(!!onlineService&&onlineAccountState==='ready'&&readyReadAccounts.length>1&&!explicitReadAccount)}
     onClick={()=>void executeRead()}>
     {tr('Прочитать источник','Read source')}</button>
    {!inlineDestination&&<OwnerDetails title={tr('Проверки доступа','Access checks')} value={chosen}/>}
   </>}
   {lastResult&&<><h3>{record(lastResult.receipt).status==='SUCCEEDED'
     ?tr('Полученный результат','Read result')
     :tr('Чтение требует внимания','Read needs attention')}</h3>
    {record(lastResult.receipt).status==='INPUT_REQUIRED'&&<p role="status">
     {tr('Для завершения действия требуются дополнительные данные. Уточните параметры инструмента.',
      'The read needs additional input. Review the tool arguments.')}</p>}
    {record(lastResult.receipt).status==='SUCCEEDED'&&typeof record(lastResult.data).text==='string'
     ?<pre className="document-content">{str(record(lastResult.data).text)}</pre>
     :record(lastResult.receipt).status==='SUCCEEDED'
      ?<p>{tr('Ответ получен. Его данные можно посмотреть ниже.','Response received. Its details are available below.')}</p>
      :null}
    {onAttachToDraft&&record(lastResult.receipt).status==='SUCCEEDED'&&
     <div className="advanced-actions">
      {(inlineDestination?[inlineDestination]:(['dialogue','task'] as const)).map(destination=><button key={destination} type="button" disabled={attaching}
       onClick={()=>{const receipt=str(record(lastResult.receipt).receipt_id);
        setAttaching(true);setError('');
        void onAttachToDraft(destination,receipt,lastResult.data).catch(e=>setError(
         tr('Результат пока не добавлен в черновик. ','The result could not be attached. ')+failure(e)))
         .finally(()=>setAttaching(false));
       }}>{attaching?tr('Сохраняем...','Saving...'):destination==='dialogue'?
          tr('Продолжить в диалоге','Continue in conversation'):
          tr('Подготовить задачу','Prepare a task')}</button>)}
     </div>}
    {!inlineDestination&&<OwnerDetails title={tr('Результат и квитанция','Result and receipt')} value={lastResult}/>}</>}
  </div>
 </section>;
}
