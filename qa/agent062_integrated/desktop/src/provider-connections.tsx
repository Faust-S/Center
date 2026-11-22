import React,{useCallback,useEffect,useRef,useState} from 'react';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {runtime} from './runtime-client/interaction';
import {record,records,str,failure,OwnerDetails,useOwnerActions,type Row} from './owner-ui';
import {HelpTip,useUiSettings} from './ui-preferences';
import {OwnerError} from './owner-ui';

type Slot=Row;
type Provider=Row;
type OnlineService='mail'|'calendar'|'contacts';
type OnlineVendor='yandex'|'mail'|'custom';
// Original bundled providers are not user-created accounts. Their settings
// can be disconnected by the existing provider surface, not deleted here.
function originalOnlineProfile(account:Row):boolean{
 return account.user_created!==true;
}
function OnlineAccountsPanel({onSelect,onRegistered,version}:{
 onSelect:(slot:string,id:string)=>void;
 onRegistered:()=>Promise<void>;
 version:number;
}){
 const {tr}=useUiSettings();
 const [rows,setRows]=useState<Row[]>([]),[busy,setBusy]=useState(false);
 const [remoteAvailable,setRemoteAvailable]=useState(true);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const [service,setService]=useState<OnlineService>('mail');
 const [vendor,setVendor]=useState<OnlineVendor>('yandex');
 const [id,setId]=useState(''),[label,setLabel]=useState('');
 const [url,setUrl]=useState(''),[imap,setImap]=useState(''),[smtp,setSmtp]=useState('');
 const [smtpSecurity,setSmtpSecurity]=useState<'implicit_tls'|'starttls'>('implicit_tls');
 const [smtpPort,setSmtpPort]=useState('465');
 const refresh=useCallback(async()=>{
  try{
   const snapshot=record(await runtime.query<Row>('online_accounts'));
   setRows(records(snapshot.accounts));
   setRemoteAvailable(snapshot.remote_execution_available!==false);
   setError('');
  }
  catch(e){setError(failure(e));}
 },[]);
 useEffect(()=>{void refresh()},[refresh,version]);
 const ready=/^[A-Z][A-Z0-9_]{2,79}$/.test(id)&&!!label.trim()&&
  (service==='mail'?(vendor!=='custom'||!!imap.trim()&&!!smtp.trim()
   &&Number.isInteger(Number(smtpPort))&&Number(smtpPort)>=1&&Number(smtpPort)<=65535)
   :/^https:\/\/[^\s?#]+\/$/.test(url.trim()));
 async function remove(account:Row){
  if(busy)return;
  const google=str(account.vendor)==='google';
  const accountId=google?str(account.login_group_id):str(account.provider_id);
  const selected=rows.filter(a=>google?str(a.login_group_id)===accountId
    :str(a.provider_id)===accountId);
  const providerIds=selected.map(a=>str(a.provider_id)).sort();
  if(!accountId||!providerIds.length||providerIds.length>3)return;
  if(selected.some(a=>Array.isArray(a.selected_slots)&&a.selected_slots.length>0)){
   setError(tr('Сначала отключите аккаунт от выбранного назначения.',
     'Disconnect the account from its active capability before removing it.'));
   return;
  }
  if(!window.confirm(tr(
   'Удалить профиль '+accountId+' и его локальные учётные данные? Сторонний аккаунт и разрешения на сервере не удаляются.',
   'Remove profile '+accountId+' and local credentials? The remote account and its server-side permissions are not deleted.')))return;
  setBusy(true);setError('');setNotice('');
  try{
   await runtime.refreshRevision();
   const result=record(await runtime.command<Row>('online_account_remove',{
    account_id:accountId,expected_provider_ids:providerIds,confirmed:true
   },{kind:'provider',id:accountId}));
   if(result.external_effect_performed!==false||result.local_credentials_removed!==true
      ||JSON.stringify(result.removed_provider_ids)!==JSON.stringify(providerIds))
    throw Error('online_account_remove_readback_mismatch');
   setNotice(tr('Локальные данные аккаунта удалены. Разрешения на сервере при необходимости отзовите отдельно.',
    'Local account data removed. Revoke any server-side grants separately if desired.'));
   try{await refresh();await onRegistered();}
   catch{setError(tr('Аккаунт удалён, но список не обновился. Обновите страницу, не повторяя удаление.',
    'Account removed, but the list did not refresh. Reload; do not repeat removal.'));}
  }catch(e){setError(failure(e));}
  finally{setBusy(false);}
 }
 async function verify(account:Row){
  if(busy||!remoteAvailable||!str(account.verification_binding_digest))return;
  if(!window.confirm(tr('Проверить выбранное подключение без чтения писем, контактов или сообщений и без отправки?',
    'Verify this connection without reading mail, contacts or messages, and without sending?')))return;
  setBusy(true);setError('');setNotice('');
  try{
   const accountId=str(account.provider_id);
   await runtime.refreshRevision();
   const result=record(await runtime.command<Row>('online_account_verify',{
    account_id:accountId,
    expected_binding_digest:str(account.verification_binding_digest),
    confirmed:true},{kind:'provider',id:accountId}));
   await refresh();
   if(result.verified===true&&result.external_effect_performed===false){
    setNotice(tr('Доступ подтверждён сейчас. Проверка не отправляла сообщения и не читала личное содержимое.',
     'Access verified now. No messages sent and no personal content read.'));
   }else{
    setError(tr('Подключение не подтверждено: ','Connection not verified: ')+str(result.error_code||result.status));
   }
  }catch(e){setError(failure(e));}
  finally{setBusy(false);}
 }
 async function add(){
  if(busy||!ready)return;
  if(!window.confirm(tr('Создать профиль без подключения к сервису?','Create a profile without connecting to the service?')))return;
  setBusy(true);setError('');setNotice('');
  try{
   const input:Record<string,unknown>={confirmed:true,provider_id:id,vendor,service,
    account_label:label.trim(),username_env:id+'_USER',app_password_env:id+'_APP_PASSWORD'};
   if(service!=='mail')input.collection_url=url.trim();
   if(service==='mail'&&vendor==='custom'){
    input.imap_host=imap.trim();input.smtp_host=smtp.trim();
    input.smtp_security=smtpSecurity;input.smtp_port=Number(smtpPort);
   }
   await runtime.refreshRevision();
   const accepted=record(await runtime.command<Row>('online_account_register',input));
   if(accepted.profile_saved!==true)throw Error('online_profile_save_unconfirmed');
   const savedSlot=service,savedId=id;
   setId('');setLabel('');setUrl('');
   setNotice(tr('Профиль сохранён. Введите учётные данные в форме подключения ниже.',
     'Profile saved. Enter credentials in the connection form below.'));
   try{await refresh();await onRegistered();onSelect(savedSlot,savedId);}
   catch{setError(tr('Профиль создан, но список не обновился. Обновите страницу перед повторным действием.',
     'Profile was created, but its list could not refresh. Refresh before trying again.'));}
  }catch(e){setError(failure(e));}
  finally{setBusy(false);}
 }
 return <div className="advanced-form">
  <h3>{tr('Онлайн-сервисы и аккаунты','Online services and accounts')}</h3>
  <p>{tr('Профили не дают разрешения на внешние действия. Для отправки и изменения данных требуется отдельное согласие в Task.',
   'Profiles do not authorize external actions. Sending or changing data requires separate Task approval.')}</p>
  {!remoteAvailable&&<p role="status" className="advanced-notice">{tr(
   'Включён локальный T3. Онлайн-запросы не исполняются; для их использования выключите T3 в настройках.',
   'Local T3 is enabled. Online requests are unavailable until T3 is disabled in Settings.')}</p>}
  <div className="advanced-items">{rows.filter(account=>str(account.vendor)!=='google'||str(account.service)==='mail')
   .map(account=><div className="advanced-item" key={str(account.provider_id)}>
   <strong>{str(account.label)||str(account.provider_id)}</strong>
   <p>{str(account.vendor)} · {str(account.service)} · {
    str(account.verification_state)==='VERIFIED_RECENTLY'
      ?tr('Доступ проверен недавно','Access checked recently')
      :str(account.connection_state)==='CONFIGURED_UNVERIFIED'
       ?tr('Настроено, вход не подтверждён','Configured, login unverified')
       :tr('Не настроено','Not configured')}</p>
   {str(account.verification_checked_at)&&str(account.verification_state)==='VERIFIED_RECENTLY'
    &&<small>{tr('Последняя проверка: ','Last check: ')}{str(account.verification_checked_at)}</small>}
   {str(account.vendor)!=='google'&&['mail','calendar','contacts','bot'].includes(str(account.service))&&<button type="button"
    disabled={busy} onClick={()=>onSelect(str(account.service)==='bot'?'interaction_surface':str(account.service),str(account.provider_id))}>
    {tr('Настроить','Configure')}</button>}
    {str(account.vendor)!=='google'&&<button type="button" disabled={busy||!remoteAvailable||
      str(account.connection_state)!=='CONFIGURED_UNVERIFIED'||!str(account.verification_binding_digest)}
      onClick={()=>void verify(account)}>{tr('Проверить доступ','Verify access')}</button>}
    {str(account.vendor)==='google'&&<small>{tr('Gmail, Календарь и Контакты. Авторизация в блоке Google ниже.',
      'Gmail, Calendar and Contacts. Manage authorization in Google below.')}</small>}
    {originalOnlineProfile(account)
     ?<small>{tr('Встроенное подключение. Удалять можно только добавленные аккаунты.',
                 'Built-in connection. Only user-added accounts can be removed.')}</small>
     :<button type="button" disabled={busy} className="secondary-button"
      onClick={()=>void remove(account)}>{tr('Удалить профиль','Remove profile')}</button>}
  </div>)}</div>
  <details><summary>{tr('Добавить IMAP / CalDAV / CardDAV аккаунт','Add IMAP / CalDAV / CardDAV account')}</summary>
  <label className="advanced-field">{tr('Функция','Service')}<select disabled={busy} value={service}
   onChange={e=>setService(e.target.value as OnlineService)}>
   <option value="mail">{tr('Почта','Mail')}</option><option value="calendar">{tr('Календарь','Calendar')}</option>
   <option value="contacts">{tr('Контакты','Contacts')}</option></select></label>
  <label className="advanced-field">{tr('Поставщик','Provider')}<select disabled={busy} value={vendor}
   onChange={e=>setVendor(e.target.value as OnlineVendor)}>
   <option value="yandex">Яндекс</option><option value="mail">Mail.ru</option>
   <option value="custom">{tr('Другой','Other')}</option></select></label>
  <label className="advanced-field">{tr('ID профиля (латиница, заглавные)','Profile ID (uppercase ASCII)')}
   <input disabled={busy} value={id} maxLength={80} autoComplete="off" placeholder="PERSONAL_MAIL"
    onChange={e=>setId(e.target.value.toUpperCase())}/></label>
  <label className="advanced-field">{tr('Название аккаунта','Account label')}
   <input disabled={busy} value={label} maxLength={160} autoComplete="off" onChange={e=>setLabel(e.target.value)}/></label>
  {service==='mail'&&<p className="advanced-notice">{tr(
   'Для почты используйте отдельный пароль приложения с разрешёнными IMAP и SMTP. Обычный пароль аккаунта может не работать. Проверка доступа не отправляет письма.',
   'Use a service-specific app password with IMAP and SMTP enabled. A normal account password may not work. Verification never sends email.')}</p>}
  {service==='mail'&&vendor==='custom'&&<>
   <label className="advanced-field">IMAP host<input disabled={busy} value={imap} onChange={e=>setImap(e.target.value)}/></label>
   <label className="advanced-field">SMTP host<input disabled={busy} value={smtp} onChange={e=>setSmtp(e.target.value)}/></label>
   <label className="advanced-field">{tr('Защита SMTP','SMTP transport')}
    <select disabled={busy} value={smtpSecurity} onChange={e=>{
     const mode=e.target.value as 'implicit_tls'|'starttls';
     setSmtpSecurity(mode);setSmtpPort(mode==='starttls'?'587':'465');
    }}>
     <option value="implicit_tls">TLS (465)</option>
     <option value="starttls">STARTTLS (587)</option>
    </select>
   </label>
   <label className="advanced-field">{tr('Порт SMTP','SMTP port')}
    <input type="number" min={1} max={65535} step={1} disabled={busy}
     value={smtpPort} onChange={e=>setSmtpPort(e.target.value)}/>
   </label>
  </>}
  {service!=='mail'&&<label className="advanced-field">{tr('HTTPS URL выбранной коллекции','HTTPS URL of selected collection')}
   <input disabled={busy} value={url} maxLength={2048} autoComplete="off"
    placeholder="https://dav.example.com/collection/" onChange={e=>setUrl(e.target.value)}/></label>}
  <div className="advanced-actions">
   <button type="button" disabled={busy||!ready} onClick={()=>void add()}>{tr('Создать профиль','Create profile')}</button>
   <button type="button" disabled={busy} onClick={()=>void refresh()}>{tr('Обновить','Refresh')}</button>
  </div>
  {error&&<OwnerError error={error}/>}
  {notice&&<p role="status" className="advanced-notice">{notice}</p>}
  </details>
 </div>;
}

function GoogleAccountsPanel({onRegistered,version}:{onRegistered:()=>Promise<void>;version:number}){
 const {tr}=useUiSettings();
 const [groups,setGroups]=useState<Array<{id:string;label:string}>>([]);
 const [remoteAvailable,setRemoteAvailable]=useState(true);
 const [selected,setSelected]=useState(''),[id,setId]=useState(''),[label,setLabel]=useState('');
 const [clientId,setClientId]=useState(''),[status,setStatus]=useState<Row|null>(null);
 const [authorizationUrl,setAuthorizationUrl]=useState(''),[busy,setBusy]=useState(false);
 const [error,setError]=useState(''),[notice,setNotice]=useState('');
 const secretRef=useRef<HTMLInputElement|null>(null);
 const loadGroups=useCallback(async()=>{
  const snapshot=record(await runtime.query<Row>('online_accounts'));
  setRemoteAvailable(snapshot.remote_execution_available!==false);
  const groupMap=new Map<string,{id:string;label:string}>();
  for(const account of records(snapshot.accounts)){
   if(str(account.vendor)!=='google')continue;
   const groupId=str(account.login_group_id);
   if(groupId==='GOOGLE_LEGACY'||!/^[A-Z][A-Z0-9_]{2,48}$/.test(groupId))continue;
   if(!groupMap.has(groupId))
    groupMap.set(groupId,{id:groupId,label:str(account.label).trim()||groupId});
  }
  const found=[...groupMap.values()].sort((a,b)=>a.id.localeCompare(b.id));
  setGroups(found);
  setSelected(current=>found.some(group=>group.id===current)?current:'');
 },[]);
 useEffect(()=>{void loadGroups().catch(e=>setError(failure(e)));},[loadGroups,version]);
 useEffect(()=>{
  let active=true;
  // Prevent reuse of a previous account's OAuth material after selection changes.
  setStatus(null);setAuthorizationUrl('');setClientId('');
  if(secretRef.current)secretRef.current.value='';
  if(selected)void runtime.query<Row>('google_oauth_status',{account_id:selected})
    .then(r=>{if(active)setStatus(record(r));})
    .catch(e=>{if(active)setError(failure(e));});
  return()=>{active=false;};
 },[selected]);
 async function readStatus(){
  if(!selected)return;
  try{setStatus(record(await runtime.query<Row>('google_oauth_status',{account_id:selected})));setError('');}
  catch(e){setError(failure(e));}
 }
 async function create(){
  if(busy||!id||!label.trim())return;
  if(!window.confirm(tr('Добавить группу Gmail, Calendar и Contacts для отдельного Google-аккаунта?',
    'Create separate Gmail, Calendar and Contacts profiles for this Google account?')))return;
  setBusy(true);setError('');setNotice('');
  try{
   await runtime.refreshRevision();
   const result=record(await runtime.command<Row>('online_google_account_register',{
    account_id:id,account_label:label.trim(),env_prefix:'IWXA_'+id,confirmed:true}));
   if(result.profile_saved!==true)throw Error('google_profile_save_unconfirmed');
   const savedId=id;setId('');setLabel('');
   setNotice(tr('Профили созданы. Настройте OAuth-клиент и разрешения.',
     'Profiles created. Configure OAuth client and consent.'));
   try{await onRegistered();await loadGroups();setSelected(savedId);}
   catch{setError(tr('Google-профиль создан, но список не обновился. Обновите перед повторным действием.',
     'Google profiles were created, but refresh failed. Refresh before trying again.'));}
  }catch(e){setError(failure(e));}
  finally{setBusy(false);}
 }
 async function openGoogleBrowser(url:string){
  const parsed=new URL(url);
  if(parsed.origin!=='https://accounts.google.com'||parsed.pathname!=='/o/oauth2/v2/auth'
     ||!parsed.searchParams.get('state')||!parsed.searchParams.get('code_challenge'))
   throw Error('google_oauth_authorization_url_invalid');
  if(isTauri()){
   // Native command accepts *only* Google PKCE URLs, from the verified installed window.
   await invoke('open_google_oauth_browser',{authorizationUrl:url});
  }else{
   const opened=window.open(url,'_blank','noopener,noreferrer');
   if(!opened)throw Error('google_browser_popup_blocked');
  }
 }
 async function oauth(command:'google_oauth_configure'|'google_oauth_begin'|'google_oauth_disconnect_local'){
  if(busy||!selected||command==='google_oauth_begin'&&!remoteAvailable)return;
  if(command==='google_oauth_disconnect_local'&&!window.confirm(
   tr('Отключить локальную авторизацию этого Google-аккаунта?',
    'Remove the local authorization for this Google account?')))return;
  setBusy(true);setError('');setNotice('');setAuthorizationUrl('');
  try{
   const input:Record<string,unknown>={connection_id:selected,account_id:selected};
   if(command==='google_oauth_configure'){
    if(!clientId.trim()){setError(tr('Укажите OAuth Client ID','Enter the OAuth Client ID'));return;}
    input.client_id=clientId.trim();input.client_secret=secretRef.current?.value||'';
   }
   await runtime.refreshRevision();
   const result=record(await runtime.command<Row>(
    command,input,{kind:'oauth_connection',id:selected}));
   if(command==='google_oauth_begin'){
    const raw=str(result.authorization_url);
    const url=new URL(raw);
    if(url.origin!=='https://accounts.google.com'||url.pathname!=='/o/oauth2/v2/auth')
     throw Error('google_authorization_url_invalid');
    setAuthorizationUrl(raw);
    try{
     await openGoogleBrowser(raw);
     setNotice(tr('Системный браузер открыт. Завершите вход Google, затем проверьте состояние.',
      'System browser opened. Complete Google sign-in, then refresh the status.'));
    }catch(e){
     setError(tr('Браузер не открылся. Повторите открытие в этой форме. ',
       'Could not open the browser. Retry here. ')+failure(e));
    }
   }else{
    setNotice(command==='google_oauth_configure'
     ?tr('OAuth-клиент сохранён. Разрешения Google ещё не выданы.',
       'OAuth client saved. Google scopes are not yet granted.')
     :tr('Локальная авторизация отключена.','Local authorization removed.'));
   }
   await readStatus();
  }catch(e){setError(failure(e));}
  finally{if(secretRef.current)secretRef.current.value='';setBusy(false);}
 }
 return <details className="advanced-form">
  <summary>{tr('Аккаунты Google (Gmail, Календарь, Контакты)',
    'Google accounts (Gmail, Calendar, Contacts)')}</summary>
  <p>{tr('Каждая группа использует собственную авторизацию OAuth. Создание профиля не предоставляет доступ к Google.',
   'Each group has its own OAuth authorization. Profile creation does not grant Google access.')}</p>
  <p>{tr('Сейчас нужен OAuth Client ID приложения типа Desktop из Google Cloud. Общий клиент IWXA для обычного входа ещё не предоставлен. Секрет приложения вводить необязательно, если клиент его не требует.',
   'A Desktop-app OAuth Client ID from Google Cloud is currently required. A shared IWXA sign-in client is not yet available. The app secret is optional when your OAuth client does not require it.')}</p>
  {!remoteAvailable&&<p role="status">{tr(
   'Для авторизации Google требуется выключить локальный T3.',
   'Turn off local T3 before authorizing Google.')}</p>}
  <label className="advanced-field">{tr('ID группы Google','Google account group ID')}
   <input disabled={busy} value={id} maxLength={49} placeholder="GOOGLE_WORK_A"
    onChange={e=>setId(e.target.value.toUpperCase())}/></label>
  <label className="advanced-field">{tr('Название аккаунта','Account label')}
   <input disabled={busy} value={label} maxLength={160} onChange={e=>setLabel(e.target.value)}/></label>
  <button type="button" disabled={busy||!/^[A-Z][A-Z0-9_]{2,48}$/.test(id)||!label.trim()}
   onClick={()=>void create()}>{tr('Добавить Google','Add Google account')}</button>
  {!!groups.length&&<>
   <label className="advanced-field">{tr('Управляемый аккаунт','Selected account')}
    <select disabled={busy} value={selected} onChange={e=>{setSelected(e.target.value);setError('');}}>
     <option value="">{tr('Выберите аккаунт','Choose account')}</option>
     {groups.map(g=><option key={g.id} value={g.id}>{g.label} · {g.id}</option>)}
    </select></label>
   {selected&&<>
    <p>{status?.refresh_token_configured===true
      ?tr('Локальная авторизация Google сохранена.','Google authorization is stored locally.')
      :tr('Требуется разрешение Google OAuth.','Google OAuth consent required.')}</p>
    <label className="advanced-field">OAuth Client ID
     <input autoComplete="off" disabled={busy} maxLength={320} value={clientId}
      onChange={e=>setClientId(e.target.value)} placeholder="client.apps.googleusercontent.com"/></label>
    <label className="advanced-field">{tr('OAuth Client Secret (если требуется)','OAuth Client Secret (if required)')}
     <input autoComplete="off" disabled={busy} type="password" ref={secretRef}/></label>
    <div className="advanced-actions">
     <button disabled={busy||!clientId.trim()} onClick={()=>void oauth('google_oauth_configure')}>
      {tr('Сохранить OAuth-клиент','Save OAuth client')}</button>
     <button disabled={busy||!remoteAvailable||status?.client_id_configured!==true}
      onClick={()=>void oauth('google_oauth_begin')}>{tr('Разрешить в Google','Authorize in Google')}</button>
     <button disabled={busy} onClick={()=>void readStatus()}>{tr('Проверить','Refresh status')}</button>
     <button disabled={busy} onClick={()=>void oauth('google_oauth_disconnect_local')}>
      {tr('Отключить','Disconnect')}</button>
    </div>
    {authorizationUrl&&<button type="button" disabled={busy} className="secondary-button"
     onClick={()=>void openGoogleBrowser(authorizationUrl).then(()=>{
      setError('');setNotice(tr('Откройте Google в системном браузере и завершите вход.',
       'Complete Google sign-in in your default browser.'));
     }).catch(e=>setError(failure(e)))}>
      {tr('Открыть вход Google в браузере','Open Google sign-in in default browser')}
     </button>}
   </>}
  </>}
  {error&&<OwnerError error={error}/>}
  {notice&&<p role="status" className="advanced-notice">{notice}</p>}
 </details>;
}

function TelegramBotsPanel({onRegistered,onSelect}:{
 onRegistered:()=>Promise<void>;
 onSelect:(slot:string,id:string)=>void;
}){
 const {tr}=useUiSettings();
 const [id,setId]=useState(''),[label,setLabel]=useState('');
 const [testEnvironment,setTestEnvironment]=useState(true);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 async function create(){
  if(busy||!/^[A-Z][A-Z0-9_]{2,79}$/.test(id)||!label.trim())return;
  if(!window.confirm(tr('Создать отдельный профиль Telegram Bot API без доступа к сообщениям?',
    'Create a Telegram Bot API profile without accessing messages?')))return;
  setBusy(true);setError('');setNotice('');
  try{
   await runtime.refreshRevision();
   const result=record(await runtime.command<Row>('online_telegram_bot_register',{
    provider_id:id,account_label:label.trim(),
    bot_token_env:id+'_BOT_TOKEN',allowed_user_ids_env:id+'_ALLOWED_USERS',
    test_environment:testEnvironment,confirmed:true}));
   if(result.profile_saved!==true)throw Error('telegram_profile_not_confirmed');
   const savedId=id;setId('');setLabel('');
   setNotice(tr('Профиль создан. Заполните токен и разрешённых пользователей в форме подключения ниже.',
    'Profile created. Enter the bot token and allowed users in the connection form below.'));
   try{await onRegistered();onSelect('interaction_surface',savedId);}
   catch{setError(tr('Профиль бота создан, но список не обновился. Обновите перед повторным действием.',
    'Bot profile was created, but refresh failed. Refresh before trying again.'));}
  }catch(e){setError(failure(e));}
  finally{setBusy(false);}
 }
 return <details className="advanced-form">
  <summary>{tr('Боты Telegram','Telegram bots')}</summary>
  <p>{tr('Поддерживается Telegram Bot API, а не вход в личную учётную запись Telegram. Для Test Environment требуется отдельный тестовый бот.',
    'Telegram Bot API only, not personal Telegram login. Test Environment requires a separate test bot.')}</p>
  <label className="advanced-field">Bot ID
   <input maxLength={80} disabled={busy} value={id} placeholder="TELEGRAM_TEST_A"
    onChange={e=>setId(e.target.value.toUpperCase())}/></label>
  <label className="advanced-field">{tr('Название','Label')}
   <input maxLength={160} disabled={busy} value={label}
    onChange={e=>setLabel(e.target.value)}/></label>
  <label><input type="checkbox" disabled={busy} checked={testEnvironment}
   onChange={e=>setTestEnvironment(e.target.checked)}/>
   {tr('Тестовая среда Telegram','Telegram Test Environment')}</label>
  <button type="button" disabled={busy||!/^[A-Z][A-Z0-9_]{2,79}$/.test(id)||!label.trim()}
   onClick={()=>void create()}>{tr('Добавить бота','Add bot')}</button>
  {error&&<OwnerError error={error}/>}
  {notice&&<p role="status" className="advanced-notice">{notice}</p>}
 </details>;
}

export function ProviderConnections({initialSlot='model'}:{initialSlot?:string}){
 const {tr,language}=useUiSettings();
 const inputs=useRef<Record<string,HTMLInputElement|null>>({});
 // The Windows chooser can finish after a person has typed a path instead.
 // Its old reply must never replace the newer, explicitly selected folder.
 const folderSelectionEpoch=useRef(0);
 const folderConnectInFlight=useRef(false);
 const [setup,setSetup]=useState<Row>({}),[busyError,setBusyError]=useState(''),[slot,setSlot]=useState(initialSlot),[provider,setProvider]=useState(''),[limits,setLimits]=useState<Record<string,string>>({});
 const load=useCallback(async()=>{try{const result=await runtime.query<Row>('user_setup');setSetup(record(result));setBusyError('');}catch(e){setSetup({});setBusyError(failure(e));throw e}},[]);
 const [onlineVersion,setOnlineVersion]=useState(0);
 const afterOnlineChange=useCallback(async()=>{await load();setOnlineVersion(v=>v+1);},[load]);
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
  <OnlineAccountsPanel onRegistered={afterOnlineChange} version={onlineVersion}
   onSelect={(nextSlot,nextId)=>{setSlot(nextSlot);setProvider(nextId);inputs.current={};setLimits({});}}/>
  <GoogleAccountsPanel onRegistered={afterOnlineChange} version={onlineVersion}/>
  <TelegramBotsPanel onRegistered={afterOnlineChange}
   onSelect={(nextSlot,nextId)=>{setSlot(nextSlot);setProvider(nextId);inputs.current={};setLimits({});}}/>
  <div className="advanced-form">
   <h3>{tr('Настройка сервиса','Configure service')}</h3>
   <label className="advanced-field">{tr('Назначение','Capability')}<select value={slot} onChange={e=>{++folderSelectionEpoch.current;setSlot(e.target.value);setProvider('');inputs.current={};setLimits({});setPickedFolder('');setFolderConsent(false);}}>
    {slots.map(x=><option value={str(x.slot_id)} key={str(x.slot_id)}>{readable(str(x.slot_id),slotLabels)}</option>)}{!slots.some(x=>str(x.slot_id)==='interaction_surface')&&<option value="interaction_surface">{tr('Интерфейсы и приложения','Interfaces and apps')}</option>}</select></label>
   <label className="advanced-field">{tr('Провайдер','Provider')}<select value={providerId} onChange={e=>{++folderSelectionEpoch.current;setProvider(e.target.value);inputs.current={};setLimits({});setPickedFolder('');setFolderConsent(false);}}>
    {selectableProviders.map(x=><option key={str(x.provider_id)} value={str(x.provider_id)}>{providerTitle(x)}</option>)}</select></label>
   {!selectableProviders.length&&<p role="alert" className="advanced-error">{tr('Для назначения нет доступного профиля провайдера.','No configurable provider profile exists for this capability.')}</p>}
   {slot==='web_acquisition'&&obscuraState==='PROFILE_NOT_PROVISIONED'&&<p role="status" className="advanced-notice">{tr('Obscura ещё не установлена или не подтверждена U01. Откройте «Программы», установите встроенную Obscura и затем выберите разрешённые сайты.','Obscura is not installed or verified by U01. Open Programs, install the bundled Obscura, then select permitted websites.')}</p>}
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
