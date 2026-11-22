import React,{useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {useUiSettings} from './ui-preferences';

type T3Task={taskId:string;taskRevisionId:string;organizationId:string;workspaceId:string;executorId:string;packageSha256:string;task:string};
type T3Status={state:string;context:string;organizationId?:string;organizationName?:string;workspaceId?:string;membershipState?:string;exportRight?:string;outcomeUnknown?:boolean;task?:{taskId:string;taskRevisionId:string;packageSha256:string}|null;originalD6HostState?:string;originalCompanyWorkspaceAuthority?:string;signedWorkspaceUrl?:string|null;embeddedOriginalD6Allowed?:boolean;originalContextEpoch?:number};
type Ack={state:string;accepted?:boolean;task_id?:string;submission_id?:string;originalTask?:T3Task;sourceAgentTaskId?:string;sourceAgentResultId?:string};
type Detail={task_id:string;status:string;summary?:string;claims?:{text:string}[];uncertainties?:string[];draft_artifacts?:string[]};
type CompanyReceipt={state:string;originalKernelReadback:boolean;originalTaskKernelReadback:boolean;workspaceId?:string;resultId?:string;deliveredToCompany:boolean};
type AtlasPublication={status:string;operationId?:string;retrySafe?:boolean;recipientId?:string;
 selectedAcceptedSummary?:string;selectedSummarySha256?:string;selectedSummaryBytes?:number;
 accepted?:{taskId:string;resultId:string;archiveSha256:string;sourceObjectRef:Record<string,unknown>}};
const err=(e:unknown)=>e instanceof Error?e.message:String(e);

/** Original T3 only; personal work remains on the existing Work and Task screens. */
export function CorporateWorkControl({onOpenAgentTask}:{onOpenAgentTask:(taskId:string)=>void}){
 const {tr,t3Enabled}=useUiSettings();
 const [status,setStatus]=useState<T3Status|null>(null),[root,setRoot]=useState('');
 const [invite,setInvite]=useState(''),[taskPath,setTaskPath]=useState('');
 const [task,setTask]=useState<T3Task|null>(null);
 const [agentTaskId,setAgentTaskId]=useState(''),[result,setResult]=useState<Detail|null>(null);
 const [companyReceipt,setCompanyReceipt]=useState<CompanyReceipt|null>(null);
 const [ack,setAck]=useState<Record<string,unknown>|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [atlasProjectId,setAtlasProjectId]=useState(''),[atlasWorkId,setAtlasWorkId]=useState('');
 const [atlasRevision,setAtlasRevision]=useState(''),[atlasConsent,setAtlasConsent]=useState(false);
 const [atlasPublication,setAtlasPublication]=useState<AtlasPublication|null>(null);
 const [atlasSignedPath,setAtlasSignedPath]=useState('');
 const [atlasSavedReceipt,setAtlasSavedReceipt]=useState<Record<string,unknown>|null>(null);
 const [originalWorkspaceVisible,setOriginalWorkspaceVisible]=useState(false);
 const readbackEpoch=useRef(0);
 const atlasReady=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(atlasProjectId)&&
  /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(atlasWorkId)&&
  /^(0|[1-9][0-9]*)$/.test(atlasRevision)&&
  Number.isSafeInteger(Number(atlasRevision));
 const atlasWorkRef=()=>({projectId:atlasProjectId,workId:atlasWorkId,revision:atlasRevision});
 const refresh=useCallback(async()=>{
  const s=await runtime.query<T3Status>('corporate_t3_status');
  setStatus(s);
  if(s.context!=='ORGANIZATION'){
   readbackEpoch.current++;
   setTask(null);setAgentTaskId('');setResult(null);setCompanyReceipt(null);
  }
  return s;
 },[]);
 useEffect(()=>{if(t3Enabled===true)void refresh().catch(e=>setError(err(e)));
  else{setStatus(null);setOriginalWorkspaceVisible(false)}
 },[t3Enabled,refresh]);
 // Cold-start recovery is READ ONLY. Reopening the company screen must
 // show the original signed Task, one Agent Result and original T2 receipt
 // without the user preparing/exporting a second Result or rerunning a model.
 useEffect(()=>{
  if(t3Enabled!==true||status?.state!=='AUTHORIZED'||
     status.context!=='ORGANIZATION'||!status.task?.taskId)return;
  const key=status.task,scope=status.workspaceId;
  const epoch=++readbackEpoch.current;
  let live=true;
  const current=()=>live&&readbackEpoch.current===epoch;
  void (async()=>{
   const verified=await runtime.query<T3Task>('corporate_t3_task');
   if(!current())return;
   if(verified.taskId!==key.taskId||
      verified.taskRevisionId!==key.taskRevisionId||
      verified.packageSha256!==key.packageSha256||
      verified.workspaceId!==scope){
    throw Error('t3_cold_company_task_binding_changed');
   }
   const recovered=await runtime.query<{
    agentTaskId:string|null;state:string}>('corporate_t3_agent_readback');
   if(!current())return;
   const tid=recovered.agentTaskId;
   if(!tid){setTask(verified);setAgentTaskId('');setResult(null);setCompanyReceipt(null);return;}
   const detail=await runtime.query<Detail>('task',{task_id:tid});
   if(!current())return;
   if(detail.task_id!==tid)throw Error('t3_cold_agent_task_readback_changed');
   let receipt:CompanyReceipt|null=null;
   if(detail.status==='closed'&&
      status.originalCompanyWorkspaceAuthority==='ORIGINAL_T2_KERNEL_ATTACHED'){
    receipt=await runtime.query<CompanyReceipt>(
     'corporate_t3_company_result_readback',{task_id:tid});
    if(!current())return;
    if(receipt.workspaceId!==scope)
     throw Error('t3_cold_company_workspace_readback_changed');
   }
   if(!current())return;
   setTask(verified);setAgentTaskId(tid);
   setResult(detail);setCompanyReceipt(receipt);
  })().catch(e=>{if(current())setError(err(e));});
  return ()=>{live=false;};
 },[t3Enabled,status?.state,status?.context,status?.workspaceId,
    status?.task?.taskId,status?.task?.taskRevisionId,
    status?.task?.packageSha256,status?.originalContextEpoch,
    status?.originalCompanyWorkspaceAuthority]);
 // Open the ORIGINAL signed T2/T3 company Workspace as the normal company
 // surface after enrollment, not as an optional Atlas/D6 publication step.
 // The current original owner still performs every signed Kernel/JIT check.
 useEffect(()=>{
  setOriginalWorkspaceVisible(t3Enabled===true&&
   status?.state==='AUTHORIZED'&&status.context==='ORGANIZATION'&&
   !!status.signedWorkspaceUrl);
 },[t3Enabled,status?.state,status?.context,status?.signedWorkspaceUrl,
   status?.originalContextEpoch]);
 function invalidate(){readbackEpoch.current++;setAck(null);setCompanyReceipt(null);
  setResult(null);setAtlasPublication(null);setAtlasConsent(false);
  setAtlasSavedReceipt(null)}
 async function execute<T extends Record<string,unknown>>(name:string,input:Record<string,unknown>):Promise<T|null>{
  if(busy)return null;
  setBusy(true);setError('');
  try{
   const data=await runtime.command<T>('corporate_t3_'+name,input,{kind:'corporate_t3',id:'employee'});
   await refresh();return data;
  }catch(e){setError(err(e));return null}
  finally{setBusy(false)}
 }
 async function chooseContext(context:'PERSONAL'|'ORGANIZATION'){
  setOriginalWorkspaceVisible(false);
  invalidate();setTask(null);setAgentTaskId('');
  await execute('select',{context});
 }
 async function receive(){
  invalidate();setAgentTaskId('');setResult(null);
  const received=await execute<T3Task&{state:string}>('receive',{path:taskPath});
  if(received?.state==='TASK_RECEIVED')setTask(received);
 }
 async function loadTask(){
  setError('');
  try{
   const verified=await runtime.query<T3Task>('corporate_t3_task');
   const recovery=await runtime.query<{
    agentTaskId:string|null;state:string}>('corporate_t3_agent_readback');
   let detail:Detail|null=null,receipt:CompanyReceipt|null=null;
   if(recovery.agentTaskId){
    detail=await runtime.query<Detail>('task',{task_id:recovery.agentTaskId});
    if(detail.task_id!==recovery.agentTaskId)
     throw Error('t3_cold_agent_task_readback_changed');
    if(detail.status==='closed'&&
       status?.originalCompanyWorkspaceAuthority==='ORIGINAL_T2_KERNEL_ATTACHED'){
     receipt=await runtime.query<CompanyReceipt>(
      'corporate_t3_company_result_readback',
      {task_id:recovery.agentTaskId});
     if(receipt.workspaceId!==verified.workspaceId)
      throw Error('t3_cold_company_workspace_readback_changed');
    }
   }
   invalidate();
   setTask(verified);setAgentTaskId(recovery.agentTaskId||'');
   setResult(detail);setCompanyReceipt(receipt);
  }catch(e){setError(err(e))}
 }
 async function submit(){
  invalidate();
  const submitted=await execute<Ack>('submit',{});
  if(submitted?.accepted===true&&typeof submitted.task_id==='string'){
   setAgentTaskId(submitted.task_id);
   setAck(submitted as unknown as Record<string,unknown>);
  }
 }
 async function readResult(){
  setError('');
  try{
   if(!agentTaskId)throw Error('Agent Task not selected');
   const d=await runtime.query<Detail>('task',{task_id:agentTaskId});
   invalidate();setResult(d);
   if(d.status==='closed'&&
      status?.originalCompanyWorkspaceAuthority==='ORIGINAL_T2_KERNEL_ATTACHED'){
    const receipt=await runtime.query<CompanyReceipt>(
     'corporate_t3_company_result_readback',{task_id:agentTaskId});
    setCompanyReceipt(receipt);
   }else if(d.status!=='closed'){
    setError(tr('Сначала исполните задачу и примите Result в Agent.',
      'Run and review the Task in Agent before verifying company persistence.'));
   }
   // A closed Agent Result with a detached original Kernel stays pending.
   // Do not falsely tell the user to rerun a Task already Human-accepted.
  }catch(e){setError(err(e))}
 }
 async function recoverAtlasPublication(){
  setError('');setAtlasConsent(false);setAtlasPublication(null);
  if(!atlasReady)return;
  try{
   const state=await runtime.query<AtlasPublication>('corporate_t3_atlas_publication',
     {workRef:atlasWorkRef()});
   setAtlasPublication(state);
  }catch(e){setError(err(e))}
 }
 async function publishAtlas(){
  // Publishing substantive content needs its own visible, exact review.
  if(!atlasReady||!atlasConsent||
     result?.status!=='closed'||
     atlasPublication?.status!=='NOT_PUBLISHED_CONFIRMED'||
     !atlasPublication.selectedAcceptedSummary?.trim()||
     !/^[a-f0-9]{64}$/.test(atlasPublication.selectedSummarySha256??''))return;
  const state=await execute<AtlasPublication>('atlas_publish',
    {workRef:atlasWorkRef(),confirmed:true,
     selectedSummarySha256:atlasPublication.selectedSummarySha256});
  setAtlasConsent(false);
  setAtlasPublication(state);
 }
 async function saveAtlasArchive(){
  if(!atlasReady||atlasPublication?.status!=='OWNER_READBACK_CONFIRMED'||
     !atlasSignedPath.toLowerCase().endsWith('.iwxa'))return;
  const saved=await execute<Record<string,unknown>>('atlas_save',{
    workRef:atlasWorkRef(),path:atlasSignedPath,confirmed:true
  });
  if(saved?.status==='ORIGINAL_SIGNED_ARCHIVE_SAVED'&&
     saved.originalReceiptVerified===true&&
     saved.recipientId==='iwxa.atlas'&&
     saved.portableSelectedSummary===true&&
     /^[a-f0-9]{64}$/.test(String(saved.selectedSummarySha256??''))){
    setAtlasSavedReceipt(saved);
  }
 }
 if(t3Enabled!==true)return <section className="subpage card"><h2>{tr('Работа в организации','Work in an organization')}</h2>
  <p>{tr('Включите локальную работу T3, чтобы открыть корпоративные подключения.',
   'Enable T3 local work to use corporate connections.')}</p></section>;
 const authorized=status?.state==='AUTHORIZED'&&status.context==='ORGANIZATION';
 // A valid corporate invitation is not evidence that the ORIGINAL T2
 // Kernel is installed and attached. Never offer Atlas D6 publication
 // against a signed owner with no live native original source port.
 const atlasAvailable=authorized&&status?.embeddedOriginalD6Allowed===true&&
  status.originalD6HostState==='ORIGINAL_KERNEL_ATTACHED';
 return <section className="subpage card advanced-form" aria-label={tr('Работа в организации','Work in an organization')}>
  <h2>{tr('Работа в организации','Work in an organization')}</h2>
  {authorized&&status?.signedWorkspaceUrl&&<>
    <button type="button" disabled={busy}
      onClick={()=>setOriginalWorkspaceVisible(open=>!open)}>
      {originalWorkspaceVisible
       ?tr('Закрыть Workspace компании','Close company Workspace')
       :tr('Открыть Workspace компании','Open company Workspace')}
    </button>
    {originalWorkspaceVisible&&<small>{tr(
      'Здесь используется исходная подписанная Workspace T2/T3. При первом открытии создание выполняется только с предоставленным компанией полномочием. Личная Workspace остаётся отдельной.',
      'This is the original signed T2/T3 company Workspace. First-use creation requires the company grant. Your personal Workspace stays separate.')}
    </small>}
    <iframe
      key={String(status.originalContextEpoch??0)+':'+String(status.task?.taskRevisionId??'')}
      title="IWXA T3 original signed Workspace"
      src={status.signedWorkspaceUrl}
      onLoad={()=>void refresh().catch(e=>setError(err(e)))}
      aria-hidden={!originalWorkspaceVisible}
      tabIndex={originalWorkspaceVisible?0:-1}
      style={originalWorkspaceVisible
       ?{display:'block',width:'100%',height:410,border:0}
       :{position:'absolute',width:1,height:1,opacity:0,
          pointerEvents:'none',border:0}}
    />
   </>}
  <p>{tr('Работа компании сохраняется в выбранной подписанной Workspace. Для передачи откройте её штатный Exchange и экспортируйте Workspace целиком, с документами, историей, связями и вложениями. Личные области не включаются.',
    'Company work is saved in the selected signed Workspace. Use its original Exchange to export the entire Workspace with documents, history, relations and attachments. Personal work is excluded.')}</p>
  <p role="status"><strong>{status?.outcomeUnknown?'OUTCOME_UNKNOWN':status?.state||'NOT_CONNECTED'}</strong>
   {status?.organizationName?' · '+status.organizationName:''} · {status?.context||'PERSONAL'}</p>
  {authorized&&status?.originalD6HostState&&
    <small role="status">{tr('Оригинальный T3 Kernel','Original T3 Kernel')}: {status.originalD6HostState}</small>}
  {status?.outcomeUnknown&&<p role="alert">{tr('Исход операции неизвестен. Не повторяйте подписание. Проверьте оригинальные квитанции T3.',
   'Outcome unknown. Do not sign again. Reconcile original T3 receipts first.')}</p>}
  {status?.state==='NOT_CONNECTED'&&<fieldset><legend>{tr('Подключение T3 сотрудника','Employee T3 connection')}</legend>
   <label>{tr('Папка зарегистрированного T3-профиля','Enrolled T3 profile folder')}
    <input value={root} onChange={e=>setRoot(e.target.value)} placeholder="C:\\IWXA\\employee-t3" autoComplete="off"/></label>
   <button type="button" disabled={busy||!root} onClick={()=>void execute('connect',{root})}>{tr('Подключить','Connect')}</button>
   <small>{tr('Нужен действующий оригинальный credential текущего пользователя Windows. Agent не выпускает ключи.',
     'An original Windows-user credential is required. Agent never issues credentials.')}</small>
  </fieldset>}
  {status?.state!=='NOT_CONNECTED'&&<div className="advanced-actions">
   <button type="button" disabled={busy} onClick={()=>void chooseContext('PERSONAL')}>{tr('Личный контур','Personal mode')}</button>
   <button type="button" disabled={busy||status?.state==='REVOKED'} onClick={()=>void chooseContext('ORGANIZATION')}>{tr('Организация','Organization')}</button>
   <button type="button" disabled={busy} onClick={()=>void execute('disconnect',{})}>{tr('Отключить','Disconnect')}</button>
   <button type="button" disabled={busy} onClick={()=>void refresh().catch(e=>setError(err(e)))}>{tr('Проверить права','Check grants')}</button>
  </div>}
  {status?.state!=='NOT_CONNECTED'&&<p>{tr('Полномочия','Membership')}: {status?.membershipState||'UNKNOWN'} · {tr('Экспорт','Export')}: {status?.exportRight||'UNKNOWN'}</p>}
  {status?.state!=='NOT_CONNECTED'&&status?.membershipState!=='ACTIVE'&&<fieldset>
   <legend>{tr('Подписанное приглашение','Signed invitation')}</legend>
   <label>{tr('Путь к приглашению .iwxa','Invitation .iwxa path')}
    <input value={invite} onChange={e=>setInvite(e.target.value)}/></label>
   <button type="button" disabled={busy||!invite||status?.context!=='PERSONAL'}
    onClick={()=>void execute('invite',{path:invite})}>{tr('Проверить приглашение','Verify invitation')}</button>
  </fieldset>}
  {authorized&&<fieldset><legend>{tr('Получить подписанную Task','Receive signed Task')}</legend>
   <label>{tr('Файл поручения .iwxa','Assignment .iwxa file')}
    <input value={taskPath} onChange={e=>setTaskPath(e.target.value)}/></label>
   <div className="advanced-actions">
    <button type="button" disabled={busy||!taskPath} onClick={()=>void receive()}>{tr('Получить поручение','Receive Task')}</button>
    <button type="button" disabled={busy} onClick={()=>void loadTask()}>{tr('Открыть сохранённое','Read saved Task')}</button>
   </div>
   {task&&<><p><strong>{task.task}</strong></p><small>{task.taskId} · {task.taskRevisionId} · SHA-256 {task.packageSha256}</small>
    <p>{tr('Исполнитель','Executor')}: {task.executorId} · Workspace: {task.workspaceId}</p>
    <button type="button" disabled={busy||!!status?.outcomeUnknown||
     status?.originalCompanyWorkspaceAuthority!=='ORIGINAL_T2_KERNEL_ATTACHED'}
     onClick={()=>void submit()}>{tr('Выполнить в Agent','Run in Agent')}</button>
    {status?.originalCompanyWorkspaceAuthority!=='ORIGINAL_T2_KERNEL_ATTACHED'&&
      <small role="status">{tr('Откройте исходную Workspace компании и дождитесь подключения оригинального T2 Kernel. Без этого корпоративная Task не запускается.',
        'Open the original company Workspace and wait for the original T2 Kernel. A company Task cannot run before it is attached.')}</small>}</>}
  </fieldset>}
  {authorized&&agentTaskId&&<fieldset><legend>{tr('Result и Human Review','Result and Human Review')}</legend>
   <p>Agent Task: {agentTaskId}</p>
   <div className="advanced-actions"><button type="button" onClick={()=>onOpenAgentTask(agentTaskId)}>{tr('Открыть в Agent','Open in Agent')}</button>
    <button type="button" disabled={busy} onClick={()=>void readResult()}>{tr('Проверить запись в Workspace компании','Verify company Workspace record')}</button></div>
   {result&&<p>{tr('Состояние Task','Task status')}: {result.status}</p>}
   {result?.status==='closed'&&<p>{tr('Один Human Review принимает Result в Agent и сохраняет тот же полный Result в исходную Workspace. Отдельный выбор содержания и вторая подпись не нужны.',
     'One Human Review accepts the Agent Result and writes the same complete Result into the original Workspace. No second content selection or signing.')}</p>}
   {result?.status==='closed'&&!companyReceipt&&<small role="status">{tr(
     'Исходная Workspace ещё не подтвердила сохранение Result. Откройте её и проверьте запись после подключения Kernel. Повторно исполнять Task не нужно.',
     'Original Workspace has not yet confirmed the Result. Open it, attach Kernel and check the record. Do not rerun Task.')}</small>}
   {companyReceipt&&(companyReceipt.originalKernelReadback&&companyReceipt.originalTaskKernelReadback
     ?<p role="status">{tr('Оригинальный T2 подтвердил Task и принятый Result в Workspace компании.',
       'Original T2 confirmed Task and accepted Result in company Workspace.')}{' · '+(companyReceipt.workspaceId||'')}</p>
     :<p role="alert">{tr('Принятие Result в Agent подтверждено, но корпоративная запись ещё не подтверждена исходным Kernel. Не запускайте Task повторно.',
       'Result accepted in Agent, but company persistence is not confirmed by original Kernel. Do not rerun Task.')}</p>)}
   <small>{tr('Передача компании при офлайн-работе подтверждается после переноса всей Workspace и её чтения получателем.',
     'Offline delivery is confirmed after transferring the whole Workspace and recipient readback.')}</small>
  </fieldset>}
  {atlasAvailable&&<details>
   <summary>{tr('Дополнительно: подключённый Atlas','Optional: connected Atlas')}</summary>
   <fieldset>
   <legend>{tr('Подписанный Result для Atlas 0.9','Signed Result for Atlas 0.9')}</legend>
   <p>{tr('Новый подписанный .iwxa включает выбранный принятый краткий Result (до 64 КБ), его SHA-256 и связь с Task. Остальная память, черновики и Workspace Agent не передаются. Ранее подписанные архивы могут содержать только ссылку.',
    'The new signed .iwxa includes the selected accepted Result summary (up to 64 KB), its SHA-256 and Task binding. Other Agent memory, drafts and Workspace are not transferred. Older signed archives may contain only a reference.')}</p>
   <p className="minor">{tr('Важно: подпись защищает подлинность файла, но сама по себе не шифрует выбранный текст. Содержимое доступно любому, кто получит этот .iwxa. Передавайте файл только указанному получателю.',
    'Important: the signature proves authenticity but does not encrypt the selected text. Anyone with this .iwxa can read it. Share the file only with its intended recipient.')}</p>
   <div className="advanced-form">
    <label>{tr('Проект Atlas','Atlas project ID')}
     <input value={atlasProjectId} onChange={e=>{setAtlasProjectId(e.target.value);setAtlasPublication(null);setAtlasConsent(false)}} autoComplete="off" placeholder="project:..." /></label>
    <label>{tr('Работа Atlas','Atlas work ID')}
     <input value={atlasWorkId} onChange={e=>{setAtlasWorkId(e.target.value);setAtlasPublication(null);setAtlasConsent(false)}} autoComplete="off" placeholder="work:..." /></label>
    <label>{tr('Точная ревизия работы','Exact work revision')}
     <input value={atlasRevision} onChange={e=>{setAtlasRevision(e.target.value);setAtlasPublication(null);setAtlasConsent(false)}} inputMode="numeric" autoComplete="off" placeholder="1" /></label>
    <button type="button" disabled={busy||!atlasReady} onClick={()=>void recoverAtlasPublication()}>
     {tr('Прочитать оригинальную квитанцию','Read original publication receipt')}
    </button>
    {atlasPublication&&<p role="status">{atlasPublication.status}
     {atlasPublication.operationId?' · '+atlasPublication.operationId:''}</p>}
    {atlasPublication?.status==='NOT_PUBLISHED_CONFIRMED'&&<>
     {result?.status==='closed'&&atlasPublication.selectedAcceptedSummary?.trim()&&
       /^[a-f0-9]{64}$/.test(atlasPublication.selectedSummarySha256??'')
      ?<label>{tr('Точный принятый Result из проверенного Agent Core для передачи в Atlas',
         'Exact accepted Result from verified Agent Core for Atlas')}
        <textarea rows={6} readOnly value={atlasPublication.selectedAcceptedSummary}
         className="document-content"/>
        <small>SHA-256: {atlasPublication.selectedSummarySha256} · {atlasPublication.selectedSummaryBytes} bytes</small>
       </label>
      :<p role="status">{tr('Откройте принятый Result и прочитайте исходную квитанцию заново. Без проверенного содержания публикация недоступна.',
         'Open the accepted Result and reread the original receipt. Publication needs verified source content.')}</p>}
     <label><input type="checkbox" checked={atlasConsent}
       disabled={result?.status!=='closed'||!atlasPublication.selectedAcceptedSummary?.trim()||
        !/^[a-f0-9]{64}$/.test(atlasPublication.selectedSummarySha256??'')}
       onChange={e=>setAtlasConsent(e.target.checked)}/>
      {tr('Я проверил выбранный краткий Result и отдельно разрешаю подписать и передать его содержимое в Atlas',
          'I reviewed the selected summary and separately approve signing and transferring its content to Atlas')}</label>
     <button type="button" disabled={busy||!atlasConsent||
       result?.status!=='closed'||!atlasPublication.selectedAcceptedSummary?.trim()||
       !/^[a-f0-9]{64}$/.test(atlasPublication.selectedSummarySha256??'')} onClick={()=>void publishAtlas()}>
      {tr('Подписать выбранный Result для Atlas','Sign selected Result for Atlas')}
     </button>
    </>}
    {atlasPublication?.status==='OUTCOME_UNKNOWN'&&
     <p role="alert">{tr('Результат записи неизвестен. Публикация не повторяется; необходима исходная квитанция T3.',
       'The write outcome is unknown. Publication is not retried; original T3 receipt is required.')}</p>}
    {atlasPublication?.status==='OWNER_READBACK_CONFIRMED'&&<>
     <p role="status">{tr('Исходные Kernel Object и Exchange подтверждены. Для работы в Atlas требуется отдельная проверка файла и запись средствами Atlas.',
       'Original Kernel Object and Exchange verified. Atlas must separately verify the file and persist it using its own Store.')}</p>
     <label>{tr('Файл подписанного Result .iwxa',
       'Signed Result .iwxa file')}
      <input value={atlasSignedPath} onChange={e=>{
       setAtlasSignedPath(e.target.value);setAtlasSavedReceipt(null)
      }} placeholder="C:\\IWXA\\atlas-result.iwxa" autoComplete="off" /></label>
     <button type="button" disabled={busy||!atlasSignedPath.toLowerCase().endsWith('.iwxa')}
       onClick={()=>void saveAtlasArchive()}>
       {tr('Сохранить подписанный .iwxa','Save signed .iwxa')}
     </button>
     {atlasSavedReceipt?.status==='ORIGINAL_SIGNED_ARCHIVE_SAVED'&&
      <p role="status">{tr('Исходный .iwxa с выбранным текстом Result проверен и сохранён без повторной записи Kernel. Atlas должен независимо проверить подпись и получателя, затем сохранить Result собственным Store.',
       'The original .iwxa with selected Result text was verified and saved without another Kernel write. Atlas must independently verify its signature and recipient before saving the Result in its own Store.')}
       {' · SHA-256 '+String(atlasSavedReceipt.archiveSha256)}</p>}
    </>}
    <small>{tr('Без установленного оригинального T3 Host публикация недоступна. Проверка квитанции выполняется только чтением.',
      'Publication requires the installed original T3 Host. Receipt recovery is read-only.')}</small>
   </div>
   </fieldset>
  </details>}
  {ack&&<p role="status">{String(ack.state||'')}{typeof ack.fileSha256==='string'?' · SHA-256 '+ack.fileSha256:''}
   {typeof ack.resultId==='string'?' · Result '+ack.resultId:''}
   {typeof ack.taskId==='string'?' · T3 Task '+ack.taskId:''}</p>}
  {ack?.originalLedgerVerified===true&&<p role="status">
   {tr('Оригинальный T3 подтвердил Reconciliation ledger и точные байты подписанного .iwxa.',
    'Original T3 verified the Reconciliation ledger and exact signed .iwxa bytes.')}
  </p>}
  {ack?.transferEvidence==='LEGACY_TASK_HISTORY_ONLY'&&<p role="status">
   {tr('Подпись и локальная история экспорта проверены. Отдельная квитанция Reconciliation ещё не подтверждена старой версией T3.',
    'Signature and local export history verified. This older T3 cannot independently confirm the Reconciliation transfer receipt.')}
  </p>}
  {error&&<p role="alert">{error}</p>}
 </section>;
}
