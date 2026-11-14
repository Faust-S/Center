import React,{useEffect,useRef,useState} from 'react';
import {createNativeAtlasPort} from './atlas-native.mjs';
import {atlasLinkReadback,atlasWorkReadback} from './atlas-integration.mjs';

// D3 UI is deliberately limited to the ORIGINAL recipient and signed D1 Host.
// It cannot issue a task, sign a grant, interpret an ACCEPT as Apply, or
// automatically repeat a decision whose native acknowledgment was lost.
type Exec=(operation:string,input?:Record<string,unknown>)=>Promise<any>;
type Run=(success:string,work:()=>Promise<void|boolean>)=>Promise<void>;
type SignedTask={taskId:string;taskRevisionId:string;packageSha256:string;summary:string;deliveryState:'NOT_CONFIRMED'};
type Owner={snapshot:{organizationId:string;workspaceId:string;actorId:string;
  contextId:string;contextEpoch:number;d3ApplyAvailable:boolean;
  d3TaskIssueAvailable?:boolean;tasks?:SignedTask[];totalTasks?:number}};
type AssignmentDraft={id:string;title:string;description:string;criteria:string;dueDate:string;
 atlasRef:{projectId:string;revision:string;workId?:string}|null};
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const opPattern=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const same=(a:unknown,b:unknown)=>a===b;
const label=(entry:any)=>String(entry?.id||entry?.kind||'Ревизия');

export default function CorporateD3Panel({owner,execute,run,busy,invoke,assignmentDrafts}:{
 owner:Owner;execute:Exec;run:Run;busy:boolean;
 invoke:(command:string,args?:Record<string,unknown>)=>Promise<any>;
 assignmentDrafts:AssignmentDraft[];
}){
 const [hash,setHash]=useState('');
 const [taskText,setTaskText]=useState('');
 const [draftId,setDraftId]=useState('');
 const [taskId,setTaskId]=useState('');
 const [preview,setPreview]=useState<any>(null);
 const [confirmed,setConfirmed]=useState(false);
 const [rejectReason,setRejectReason]=useState('');
 const [operationId,setOperationId]=useState('');
 const [preparedId,setPreparedId]=useState('');
 const [idSaved,setIdSaved]=useState(false);
 const [decisionAttempted,setDecisionAttempted]=useState(false);
 const [decisionType,setDecisionType]=useState<'ACCEPT'|'REJECT'|null>(null);
 const [receipt,setReceipt]=useState<any>(null);
 const [selectedRevisions,setSelectedRevisions]=useState<string[]>([]);
 const [application,setApplication]=useState<any>(null);
 const [applyConsent,setApplyConsent]=useState(false);
 const [applyAttempted,setApplyAttempted]=useState(false);
 const [kernelResult,setKernelResult]=useState<any>(null);
 const [lastReceiveState,setLastReceiveState]=useState<string|null>(null);
 const [inbox,setInbox]=useState<{total:number;truncated:boolean;
   items:{packageSha256:string;status:string;acceptanceId:string|null;
     operationId:string|null}[]} | null>(null);
 const session=owner.snapshot;
 const sessionKey=JSON.stringify([session.organizationId,session.workspaceId,
   session.actorId,session.contextId,session.contextEpoch]);
 const previous=useRef(sessionKey);
 const reset=()=>{
   setPreview(null);setConfirmed(false);setRejectReason('');setOperationId('');
   setPreparedId('');setIdSaved(false);
   setDecisionAttempted(false);setDecisionType(null);setReceipt(null);
   setSelectedRevisions([]);setApplication(null);setApplyConsent(false);
   setApplyAttempted(false);setKernelResult(null);
 };
 useEffect(()=>{
   if(previous.current!==sessionKey){
   previous.current=sessionKey;setHash('');setInbox(null);setTaskId('');
   setLastReceiveState(null);setDraftId('');reset();
 }
 },[sessionKey]);
 const choose=(value:string)=>{setHash(value);setLastReceiveState(null);reset();};
 const signedTasks=Array.isArray(session.tasks)?session.tasks.filter(t=>
   opPattern.test(t.taskId)&&hex(t.taskRevisionId)&&hex(t.packageSha256)):[];
 const selectedTask=signedTasks.find(t=>t.taskId===taskId)??signedTasks.at(-1);
 const createSignedTask=()=>run('Подписанная Task сохранена. Передача получателю ещё не подтверждена.',async()=>{
   if(session.d3TaskIssueAvailable!==true||!taskText.trim()||
     taskText.length>10000)throw Error('CEN_D3_SIGNED_TASK_TEXT_REQUIRED');
   // A draft Atlas link is not automatically a valid current source. Before
   // original T3 signs it, reread the installed Atlas Desktop owner in its
   // existing fixed-path READ_ONLY mode, never a cached/selected file copy.
   const source=assignmentDrafts.find(a=>a.id===draftId)?.atlasRef;
   if(source){
     const port=createNativeAtlasPort(invoke);
     let sessionFromInstalled;
     try{
       sessionFromInstalled=await port.openPublicAtlas(session.organizationId);
     }catch{throw Error('CEN_D3_ATLAS_OWNER_NOT_AVAILABLE');}
     const fresh=port.view(sessionFromInstalled);
     const current=source.workId?
       atlasWorkReadback(fresh,source):atlasLinkReadback(fresh,source);
     if(current!=='SOURCE_REVISION_MATCHES')
       throw Error('CEN_D3_ATLAS_SOURCE_REVISION_STALE');
   }
   const result=await execute('d3CreateTask',{task:taskText.trim()});
   if(result?.schema!=='IWXA_T3_ORIGINAL_SIGNED_TASK/1'||
     result.status!=='SIGNED_TASK_CREATED_NOT_DELIVERED'||
     !opPattern.test(result.taskId)||!hex(result.taskRevisionId)||
     !hex(result.packageSha256)||result.recipientId!==session.actorId)
     throw Error('CEN_D3_ORIGINAL_TASK_WRITE_READBACK_UNKNOWN');
   setTaskText('');setDraftId('');
 });
 const exportTask=()=>run('Оригинальный подписанный .iwxa сохранён. Доставка остаётся неподтверждённой.',async()=>{
   if(!selectedTask)throw Error('CEN_D3_ORIGINAL_TASK_SELECTION_REQUIRED');
   const result=await execute('d3ExportTask',{taskId:selectedTask.taskId});
   if(result?.status==='CANCELLED')return false;
   if(result?.schema!=='IWXA_T3_ORIGINAL_SIGNED_TASK_EXPORT/1'||
     result.status!=='EXPORTED_UNDELIVERED'||
     result.taskId!==selectedTask.taskId||
     result.taskRevisionId!==selectedTask.taskRevisionId||
     result.packageSha256!==selectedTask.packageSha256||
     result.recipientId!==session.actorId||
     !Number.isSafeInteger(result.bytes)||result.bytes<=0)
     throw Error('CEN_D3_ORIGINAL_TASK_EXPORT_UNKNOWN');
 });
 const exportInvitation=()=>run('Оригинальное подписанное приглашение сохранено. Personal Agent ещё не подключён.',async()=>{
   if(session.d3TaskIssueAvailable!==true)
     throw Error('CEN_D3_SIGNED_INVITATION_REQUIRED');
   const result=await execute('d3ExportInvitation');
   if(result?.status==='CANCELLED')return false;
   if(result?.schema!=='IWXA_T3_ORIGINAL_SIGNED_INVITATION_EXPORT/1'||
     result.status!=='EXPORTED_UNDELIVERED'||!hex(result.packageSha256)||
     !Number.isSafeInteger(result.bytes)||result.bytes<=0)
     throw Error('CEN_D3_ORIGINAL_INVITATION_EXPORT_UNKNOWN');
 });
 const selectedInboxItem=inbox?.items.find(x=>x.packageSha256===hash);
 const originalDecisionRecorded=
   ['ACCEPTED','REJECTED'].includes(selectedInboxItem?.status??'')||
   ['ACCEPTED','REJECTED'].includes(lastReceiveState??'');
 const refreshInbox=()=>run('Полученные пакеты перечитаны из оригинального Reconciliation.',async()=>{
   const result=await execute('d3Inbox');
   if(result?.schema!=='IWXA_T3_ORIGINAL_RECIPIENT_INBOX/1'||
     result.organizationId!==session.organizationId||
     result.workspaceId!==session.workspaceId||
     !Number.isSafeInteger(result.total)||!Array.isArray(result.items)||
     result.items.length>64||
     !result.items.every((x:any)=>hex(x.packageSha256)&&
       ['REVIEW_REQUIRED','ACCEPTED','REJECTED','RECEIPT_CONFLICT'].includes(x.status)&&
       (x.operationId==null||opPattern.test(x.operationId))))
     throw Error('CEN_D3_ORIGINAL_INBOX_INVALID');
   setInbox(result);
 });
 const revisions=Array.isArray(preview?.entries)?
   [...new Set(preview.entries.map((x:any)=>x?.revisionId).filter(hex))].slice(0,32) as string[]:[];
 const accepted=receipt?.found===true&&
   receipt.receipt?.acceptanceState==='ACCEPTED'&&
   receipt.receipt.packageSha256===hash&&
   receipt.receipt.operationId===operationId&&
   receipt.kernelApplication==='NOT_ATTESTED_BY_RECONCILIATION_RECEIPT';
 const review=()=>run('Оригинальный Reconciliation проверил пакет без принятия.',async()=>{
   const result=await execute('d3Preview',{packageSha256:hash});
   if(result.schema!=='IWXA_T3_RECONCILIATION_PREVIEW/1'||
     result.packageSha256!==hash||!hex(result.previewDigest))
     throw Error('CEN_D3_ORIGINAL_PREVIEW_INVALID');
   setPreview(result);setConfirmed(false);setApplication(null);
   setPreparedId('');setIdSaved(false);
 });
 const recover=()=>run('Оригинальная квитанция перечитана. Это не подтверждение записи в Kernel.',async()=>{
   const id=operationId.trim();
   if(!opPattern.test(id)||!hex(hash))throw Error('CEN_D3_RECEIPT_QUERY_REQUIRED');
   const result=await execute('d3Receipt',{operationId:id,packageSha256:hash});
   if(result?.kernelApplication!=='NOT_ATTESTED_BY_RECONCILIATION_RECEIPT'||
     typeof result.found!=='boolean'||result.found&&(
       result.receipt?.operationId!==id||result.receipt?.packageSha256!==hash))
     throw Error('CEN_D3_RECEIPT_INVALID');
   setReceipt(result);setApplication(null);
   if(!result.found)setSelectedRevisions([]);
 });
 const decide=(kind:'ACCEPT'|'REJECT')=>run(
   'Решение записано исходным Reconciliation. Для проверки используйте отдельное чтение квитанции.',
   async()=>{
     if(decisionAttempted||originalDecisionRecorded||!confirmed||!preview||!hex(hash)||
       !idSaved||!opPattern.test(preparedId)||preparedId!==operationId||
       (kind==='ACCEPT'&&preview.allowedAction!=='EXPLICIT_ACCEPT_ONLY')||
       (kind==='REJECT'&&!rejectReason.trim()))
       throw Error('CEN_D3_EXPLICIT_HUMAN_REVIEW_REQUIRED');
     // The ID was visible and explicitly saved BEFORE dispatch. On a lost
     // acknowledgment, restoring the original receipt never retries the write.
     const id=preparedId;
     setDecisionAttempted(true);setDecisionType(kind);
     setReceipt(null);setApplication(null);
     let outcome:any;
     try{
      outcome=await execute('d3Decide',{operationId:id,packageSha256:hash,
       previewDigest:preview.previewDigest,decision:kind,
       ...(kind==='REJECT'?{reason:rejectReason.trim()}:{} )});
     }catch(e){
      // If the Windows confirmation was cancelled, no signed decision
      // was sent and the original preview can still be confirmed.
      if(String(e).includes('CEN_D3_HUMAN_REVIEW_CANCELLED')){
        setDecisionAttempted(false);setDecisionType(null);
      }
      throw e;
     }
     if(outcome.acceptanceState!==(kind==='ACCEPT'?'ACCEPTED':'REJECTED')||
       outcome.kernelApplication!=='NOT_APPLIED')
       throw Error('CEN_D3_OUTCOME_UNKNOWN');
     // Read only. Never call ACCEPT or REJECT again to discover the result.
     const saved=await execute('d3Receipt',{operationId:id,packageSha256:hash});
     if(saved?.found!==true||saved.receipt?.acceptanceState!==
       (kind==='ACCEPT'?'ACCEPTED':'REJECTED'))
       throw Error('CEN_D3_OUTCOME_UNKNOWN');
     setReceipt(saved);
   });
 const toggleRevision=(id:string,checked:boolean)=>{
   setSelectedRevisions(old=>checked?[...old.filter(x=>x!==id),id]:
     old.filter(x=>x!==id));
   setApplication(null);setApplyConsent(false);
 };
 const inspectApplication=()=>run('Оригинальный Reconciliation подтвердил только кандидат на применение.',async()=>{
   if(!accepted||!session.d3ApplyAvailable||!hex(receipt.receipt.acceptanceId))
     throw Error('CEN_D3_ACCEPTED_SOURCE_INVALID');
   const result=await execute('d3InspectAccepted',{
     acceptanceId:receipt.receipt.acceptanceId,revisionIds:selectedRevisions
   });
   if(result?.status!=='CANDIDATE_REQUIRES_INDEPENDENT_HOST_AUTHORIZATION'||
     result.applicationAttempted!==false||result.applicationAuthorized!==false)
     throw Error('CEN_D3_APPLICATION_PREVIEW_INVALID');
   setApplication(result);setApplyConsent(false);
 });
 const apply=()=>run('Исходный T3 Kernel вернул квитанцию записи и повторное чтение.',async()=>{
   if(!accepted||!application||!applyConsent||applyAttempted)
     throw Error('CEN_D3_SEPARATE_HUMAN_APPLY_REQUIRED');
   setApplyAttempted(true);setKernelResult(null);
   const result=await execute('d3ApplyAccepted',{
     acceptanceId:receipt.receipt.acceptanceId,revisionIds:selectedRevisions
   });
   if(result.kernelWriteReadback!=='CONFIRMED'||!result.originalKernelReadback||
     !result.originalKernelReceipt)
     throw Error('CEN_D3_KERNEL_COMMIT_OUTCOME_UNKNOWN');
   setKernelResult(result);
 });
 return <div className="nested-form" data-testid="cen03-d3-original">
  <h3>Подписанный T3: получение и принятие Result</h3>
  <p className="muted">Подтверждённый субъект: {session.actorId} · Workspace: {session.workspaceId}.
   Оригинальный получатель проверяет подпись и полномочия. Приём не означает ACCEPT;
   ACCEPT не означает запись в Kernel.</p>
  <div className="nested-form" data-testid="d3-signed-task-workflow">
   <h3>Подписанные поручения T3</h3>
   <p className="muted">Текущий получатель: {session.actorId}.
    Это локальный участник организации. Выдача другому сотруднику требует
    отдельной регистрации его ключей, а не выбора имени из черновика.</p>
   {session.d3TaskIssueAvailable===true ? <>
    {!!assignmentDrafts.length&&<label>Подготовить текст из сохранённого черновика
     <select data-testid="d3-task-from-draft" value={draftId}
      onChange={e=>{
       const id=e.target.value;
       setDraftId(id);
       const selected=assignmentDrafts.find(a=>a.id===id);
       if(selected){
         const atlas=selected.atlasRef;
         const content=[selected.title,selected.description,
           selected.criteria&&'Критерии приёмки: '+selected.criteria,
           selected.dueDate&&'Срок: '+selected.dueDate,
           atlas&&'Ссылка на проект Atlas (из черновика, не доказательство полномочий): '+
             atlas.projectId+' @ '+atlas.revision+
             (atlas.workId?', работа: '+atlas.workId:'')].filter(Boolean).join('\n\n');
         setTaskText(content.slice(0,10000));
       }
      }}>
      <option value="">Выберите черновик (не выдаёт полномочий)</option>
      {assignmentDrafts.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}
     </select>
    </label>}
    <label>Поручение и критерии результата
     <textarea data-testid="d3-task-text" rows={3} maxLength={10000}
      value={taskText} onChange={e=>setTaskText(e.target.value)}
      placeholder="Что сделать и по каким критериям принять результат"/>
    </label>
    <div className="actions">
     <button className="primary" data-testid="d3-create-task"
      disabled={busy||!taskText.trim()} onClick={createSignedTask}>
      Подписать и сохранить Task
     </button>
     <button className="secondary" data-testid="d3-export-invitation"
      disabled={busy} onClick={exportInvitation}>
      Сохранить приглашение .iwxa
     </button>
    </div>
   </> : <p className="notice subdued">
    Подписанные права на выдачу Task ещё не установлены.</p>}
   {!!signedTasks.length&&<>
    <label>Сохранённая Task
     <select data-testid="d3-signed-task-select" value={selectedTask?.taskId??''}
      onChange={e=>setTaskId(e.target.value)}>
      {signedTasks.map(t=><option key={t.taskId} value={t.taskId}>
       {t.summary.slice(0,90)} · {t.taskId.slice(0,23)}
      </option>)}
     </select>
    </label>
    <p className="muted" data-testid="d3-signed-task-proof">
     Ревизия: {selectedTask?.taskRevisionId.slice(0,16)}… ·
     SHA-256: {selectedTask?.packageSha256.slice(0,16)}… ·
     Передача: не подтверждена
    </p>
    <button className="secondary" data-testid="d3-export-task" disabled={busy}
     onClick={exportTask}>Сохранить подписанную Task в .iwxa</button>
   </>}
  </div>
  <div className="actions">
   <button className="secondary" data-testid="d3-receive" disabled={busy}
    onClick={()=>run('Пакет перечитан исходным Reconciliation. Решение показано отдельно.',async()=>{
     // Native Tauri chooses the file. Original signed bytes never traverse
     // WebView JSON or a separate package parser in Center.
     const result=await execute('d3Receive');
     if(result?.status==='CANCELLED')return false;
     if(!['NOT_ACCEPTED','ACCEPTED','REJECTED'].includes(result.acceptanceState)||
       !hex(result.preview?.packageSha256))throw Error('CEN_D3_RECEIVE_READBACK_UNKNOWN');
     choose(result.preview.packageSha256);
     setLastReceiveState(result.acceptanceState);
     setPreview(result.preview);
    })}>Получить .iwxa</button>
   <button className="secondary" data-testid="d3-review" disabled={busy||!hex(hash)}
    onClick={review}>Review</button>
   <button className="secondary" data-testid="d3-inbox-refresh" disabled={busy}
    onClick={refreshInbox}>Открыть полученные</button>
  </div>
  {inbox&&<div data-testid="d3-original-inbox">
   <p>Оригинальный журнал получателя: {inbox.total} пакетов.
    {inbox.truncated?' Показаны последние 64.':''}</p>
   <label>Полученный результат
    <select data-testid="d3-inbox-select" value={inbox.items.some(x=>x.packageSha256===hash)?hash:''}
     onChange={e=>{
       const value=e.target.value;
       const item=inbox.items.find(x=>x.packageSha256===value);
       choose(value);
       if(item?.operationId)setOperationId(item.operationId);
     }}>
     <option value="">Выберите полученный .iwxa</option>
     {inbox.items.map(x=><option key={x.packageSha256} value={x.packageSha256}>
      {x.status} · {x.packageSha256.slice(0,16)}…
     </option>)}
    </select>
   </label>
  </div>}
  <label>SHA-256 пакета
   <input data-testid="d3-package-sha" value={hash} maxLength={64}
    onChange={e=>choose(e.target.value.trim().toLowerCase())}
    placeholder="64 символа SHA-256" />
  </label>
  {lastReceiveState&&lastReceiveState!=='NOT_ACCEPTED'&&
   <p data-testid="d3-already-decided">В исходном журнале найдено решение: {lastReceiveState}.
    Повторный ACCEPT/REJECT не требуется. Откройте исходную квитанцию.</p>}
  {preview&&<div data-testid="d3-preview">
   <p>Классификация: {preview.classification??'нет сведений'} ·
    Решение: {preview.allowedAction??'нет сведений'} ·
    Редакции: {revisions.length}</p>
   <label><input type="checkbox" checked={confirmed}
     onChange={e=>setConfirmed(e.target.checked)}/>
    Я просмотрел этот пакет и подтверждаю отдельное решение</label>
   <label>Причина REJECT
    <textarea rows={2} value={rejectReason} maxLength={1000}
     onChange={e=>setRejectReason(e.target.value)}/>
   </label>
   <div className="actions">
    <button className="secondary" data-testid="d3-prepare-id"
     disabled={busy||decisionAttempted}
     onClick={()=>{
       const id='decision:'+crypto.randomUUID();
       setOperationId(id);setPreparedId(id);setIdSaved(false);
       setReceipt(null);setApplication(null);
     }}>Подготовить ID решения</button>
   </div>
   {preparedId&&operationId===preparedId&&<div data-testid="d3-id-before-send">
    <p>Сохраните ID до отправки: <code>{preparedId}</code></p>
    <label><input type="checkbox" checked={idSaved}
      onChange={e=>setIdSaved(e.target.checked)}/>
      Я сохранил ID для восстановления при потере ответа</label>
   </div>}
   <div className="actions">
    <button className="primary" data-testid="d3-accept"
     disabled={busy||!confirmed||decisionAttempted||originalDecisionRecorded||!idSaved||
       !preparedId||preparedId!==operationId||
       preview.allowedAction!=='EXPLICIT_ACCEPT_ONLY'}
     onClick={()=>decide('ACCEPT')}>ACCEPT</button>
    <button className="secondary" data-testid="d3-reject"
     disabled={busy||!confirmed||decisionAttempted||originalDecisionRecorded||!idSaved||
       !preparedId||preparedId!==operationId||!rejectReason.trim()}
     onClick={()=>decide('REJECT')}>REJECT</button>
   </div>
  </div>}
  <div className="nested-form" data-testid="d3-receipt-recovery">
   <h3>Восстановить решение без повтора</h3>
   <p className="muted">ID фиксируется перед ACCEPT/REJECT. Если связь оборвалась,
    проверяйте исходную квитанцию по ID и SHA-256. Повторный ACCEPT/REJECT запрещён.
    ID можно сохранить отдельно для восстановления после перезапуска.</p>
   <label>ID операции
    <input data-testid="d3-operation-id" value={operationId} maxLength={160}
     onChange={e=>{setOperationId(e.target.value.trim());setPreparedId('');
      setIdSaved(false);setReceipt(null);setApplication(null)}}
     placeholder="decision:..." />
   </label>
   <div className="actions">
    <button className="secondary" data-testid="d3-recover" disabled={busy||!hex(hash)||
      !opPattern.test(operationId)} onClick={recover}>Проверить квитанцию</button>
    {opPattern.test(operationId)&&<button className="secondary" disabled={busy}
      onClick={()=>navigator.clipboard.writeText(operationId)}>
      Скопировать ID</button>}
   </div>
   {decisionAttempted&&!receipt&&<p className="notice subdued">
    Решение отправлялось. До подтверждения исходного владельца результат неизвестен.
    Не отправляйте его повторно.
   </p>}
   {receipt&&<p data-testid="d3-recovered-receipt">
    {receipt.found?
      'Оригинальная квитанция: '+String(receipt.receipt.acceptanceState)+
       ' · '+String(receipt.receipt.acceptanceId??'')+
       '. Запись в Kernel не подтверждена.'
      :'Для этой операции и пакета подтверждённая квитанция не найдена. Это не доказывает, что запись не выполнялась.'}
   </p>}
   {decisionType&&<p className="muted">Отправленное решение: {decisionType}.</p>}
  </div>
  {accepted&&<div className="nested-form" data-testid="d3-apply">
   <h3>Отдельное применение в оригинальный Kernel</h3>
   <p className="muted">ACCEPT подтверждён только в Reconciliation.
    Применение требует отдельного Human APPLY и подписанного D1 JIT.
    Неизвестный результат не повторяется автоматически.</p>
   {!session.d3ApplyAvailable?<p>Исходный подписанный Apply-владелец ещё не подключён.</p>:<>
    <p>Выберите принятые редакции:</p>
    {revisions.map(id=><label key={id}>
      <input type="checkbox" checked={selectedRevisions.includes(id)}
       onChange={e=>toggleRevision(id,e.target.checked)}/>
      {label(preview.entries.find((x:any)=>same(x.revisionId,id)))} · {id.slice(0,16)}
    </label>)}
    <div className="actions">
     <button className="secondary" data-testid="d3-inspect-apply"
      disabled={busy||selectedRevisions.length===0||applyAttempted}
      onClick={inspectApplication}>Предпросмотр применения</button>
    </div>
    {application&&<div>
     <p>Источник подтверждён как кандидат. Запись не выполнялась.</p>
     <label><input type="checkbox" checked={applyConsent} disabled={applyAttempted}
       onChange={e=>setApplyConsent(e.target.checked)}/>
       Отдельно подтверждаю применение выбранных редакций</label>
     <button className="primary" data-testid="d3-apply-confirm"
      disabled={busy||!applyConsent||applyAttempted} onClick={apply}>Apply</button>
    </div>}
   </>}
   {applyAttempted&&!kernelResult&&<p className="notice subdued">
    Результат Apply не подтверждён. Требуется независимое чтение исходного Kernel
    и журнала владельца. Второй Apply здесь заблокирован.</p>}
   {kernelResult&&<p data-testid="d3-kernel-readback">
    Оригинальный Kernel подтвердил запись и повторное чтение:
    {String(kernelResult.originalKernelReadback?.object?.object_id??'объект')} ·
    редакция {String(kernelResult.originalKernelReadback?.object?.revision??'?')}.
    Итоговая приёмка всего T3 выполняется отдельно.
   </p>}
  </div>}
 </div>;
}
