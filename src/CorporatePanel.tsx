import React,{useEffect,useRef,useState} from 'react';
import {readAppliedResults,prepareAppliedReuse,projectAppliedAtlasEvidence} from '../runtime/cen03-applied-results.mjs';
import {canDecideReviewedResult,acceptedApplicationSelection,ownerSessionFingerprint,receivedResultInbox} from '../runtime/cen03-review.mjs';

// CEN02/CEN03 GUI consumes an approved host implementation. Private T3 code,
// keys, permissions, signing, Reconciliation and Store never run in this WebView.
type Invoke=(command:string,args?:Record<string,unknown>)=>Promise<any>;
type Org={id:string;name:string;issuedTaskLinks?:Array<any>;assignments:Array<{id:string;title:string;atlasRef:{projectId:string;revision:string;workId?:string}|null}>};
const hex=/^[a-f0-9]{64}$/;
const why=(e:unknown)=>{
 const message=e instanceof Error?e.message:String(e);
 return message.includes('T3_RECEIVE_STORE_READBACK_HOLD')
   ? 'Получение не подтверждено хранилищем организации. Обновите список Result и проверьте журнал перед повторной передачей файла.'
   : message==='TASK_ALREADY_ISSUED_LINK_NOT_SAVED'
     ? 'Подписанная Task могла быть выдана, но привязка Atlas не сохранена. Проверьте T3, повторно выдавать вслепую нельзя.'
     : message;
};

/** Expand only on request: evidence text is read from T3's confirmed
 * application snapshot; it is not an Atlas write or a completion claim. */
function AppliedEvidenceRow({e}:{e:any}){
 const [expanded,setExpanded]=useState(false);
 return <li data-testid="cen05-applied-work">
   <strong>{e.atlasCurrentWork?.title??('Работа '+e.atlasRef.workId)}</strong> · проект {e.atlasRef.projectId} · WorkRef {e.atlasRef.workId} · редакция {e.atlasRef.revision}.
   {e.atlasCurrentWork&&<span data-testid="cen05-atlas-current-work"> Atlas: {e.atlasCurrentWork.state} (состояние исходного снимка, не эффект T3 Result).</span>}
   <span> {e.atlasObservation==='SOURCE_REVISION_MATCHES'?'Редакция Atlas совпадает':
     e.atlasObservation==='SOURCE_REVISION_CHANGED'?'Редакция Atlas изменилась':
     e.atlasObservation==='NOT_OBSERVED'?'Atlas не открыт':'Связь с Atlas требует проверки'}.</span>
   <small> Task {e.result.taskId} · Result {e.result.resultRevisionId.slice(0,12)} · выполнение работы не утверждается.</small>
   <details data-testid="cen05-evidence-details" onToggle={event=>setExpanded(event.currentTarget.open)}>
     <summary>Прочитать полный подтверждённый Result</summary>
     {expanded&&<div>
       <p>Источником является подтверждённый T3 Apply; WorkRef — только локальная привязка. Это не запись в Atlas.</p>
       <p><strong>Task ID:</strong> {e.result.taskId}</p>
       <p><strong>Task revision:</strong> {e.result.taskRevisionId}</p>
       <p><strong>Result revision:</strong> {e.result.resultRevisionId}</p>
       <p><strong>ACCEPT receipt:</strong> {e.result.acceptanceId}</p>
       <p><strong>Исполнитель:</strong> {e.result.executorId}</p>
       <pre data-testid="cen05-applied-result-text" style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:320,overflowY:'auto'}}>{e.result.text}</pre>
       <p><strong>Статус:</strong> применён в T3; выполнение работы Atlas не утверждается.</p>
     </div>}
   </details>
 </li>;
}

export default function CorporatePanel({organization,invoke,onReuse,onPrepare,onIssued,atlasView}:{organization:Org;atlasView:any|null;invoke:Invoke|null;onIssued:(issued:any,recipientId:string)=>Promise<void>;onReuse:(selection:{description:string;source:{organizationId:string;workspaceId:string;taskId:string;taskRevisionId:string;resultRevisionId:string;acceptanceId:string}})=>void;onPrepare:()=>void}){
 const [owner,setOwner]=useState<any>(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [selected,setSelected]=useState('');
 const [hash,setHash]=useState('');
 const [review,setReview]=useState<any>(null);
 const [consent,setConsent]=useState(false);
 const [rejectReason,setRejectReason]=useState('');
 const [preview,setPreview]=useState<any>(null);
 const [applyConsent,setApplyConsent]=useState(false);
 const [applyDecided,setApplyDecided]=useState(false);
 const [reuseKey,setReuseKey]=useState('');
 const [reuseText,setReuseText]=useState('');
 const organizationId=organization.id;
 const requestRef=useRef(0),sessionRef=useRef<string|null>(null),actionRef=useRef(false);
 const ready=ownerSessionFingerprint(owner,organizationId)!==null;
 const resetReview=()=>{setReview(null);setConsent(false);setRejectReason('');setPreview(null);setApplyConsent(false);setApplyDecided(false)};
 const adoptOwner=(candidate:any)=>{
   const fingerprint=ownerSessionFingerprint(candidate,organizationId);
   if(fingerprint!==sessionRef.current){
     sessionRef.current=fingerprint;
     setHash('');setSelected('');setReuseKey('');setReuseText('');
     resetReview();
   }
   const valid=fingerprint===null?null:candidate;
   setOwner(valid);
   return valid;
 };
 const refresh=async()=>{
   const seq=++requestRef.current;
   if(!invoke)return adoptOwner(null);
   try{
     const next=await invoke('center_corporate_state',{organizationId});
     return seq===requestRef.current?adoptOwner(next):null;
   }catch{
     return seq===requestRef.current?adoptOwner(null):null;
   }
 };
 useEffect(()=>{
   let cancelled=false;
   const seq=++requestRef.current;
   adoptOwner(null);setError('');setNotice('');
   if(invoke)void invoke('center_corporate_state',{organizationId}).then(r=>{
     if(!cancelled&&seq===requestRef.current)adoptOwner(r);
   }).catch(()=>{
     if(!cancelled&&seq===requestRef.current)adoptOwner(null);
   });
   return()=>{cancelled=true;requestRef.current++};
 },[invoke,organizationId]);
 const execute=async(operation:string,input:Record<string,unknown>={})=>{
   if(!ready||!invoke)throw Error('CEN_OWNER_NOT_CONNECTED');
   const context=owner.snapshot;
   const r=await invoke('center_corporate_action',{organizationId,operation,input,
     binding:{organizationId:context.organizationId,workspaceId:context.workspaceId,contextEpoch:context.contextEpoch}});
   if(!r||r.status==='NOT_CONNECTED')throw Error('CEN_OWNER_NOT_CONNECTED');
   return r;
 };
 const act=async(success:string,fn:()=>Promise<void|boolean>)=>{
   // The disabled React button alone is not an atomic guard against two
   // quick event dispatches. Never dispatch Apply twice in one UI session.
   if(actionRef.current)return;
   actionRef.current=true;
   setBusy(true);setError('');setNotice('');
   try{const saved=await fn();if(saved!==false)setNotice(success)}
   catch(e){setError(why(e))}
   finally{await refresh();actionRef.current=false;setBusy(false)}
 };
 const applied=(()=>{
   if(!ready)return {status:'NOT_CONNECTED',records:[] as any[]};
   try{return readAppliedResults(owner.snapshot,organizationId,owner.snapshot.workspaceId)}
   catch{return {status:'HOLD_FOR_EXPLICIT_RECOVERY',records:[] as any[]}}
 })();
 const records=applied.records as any[];
 // The signed application comes from T3; the WorkRef is a local, read-only
 // issuer association, never a signature over the Atlas project.
 const atlasEvidence=(()=>{
   if(!ready||applied.status!=='LOCAL_ENCRYPTED_STORE_CONFIRMED')return [];
   const links=organization.issuedTaskLinks??[],rows:any[]=[];
   for(const record of records){
     const candidates=links.filter(link=>
       link.organizationId===organizationId &&
       link.workspaceId===owner.snapshot.workspaceId &&
       link.taskId===record.taskId &&
       link.taskRevisionId===record.taskRevisionId);
     if(candidates.length!==1)continue;
     try{
       rows.push(projectAppliedAtlasEvidence({ownerSnapshot:owner.snapshot,
         issuedTask:candidates[0],resultRevisionId:record.resultRevisionId,atlasView}));
     }catch{/* No inference of project completion from invalid local links. */}
   }
   return rows;
 })();
 // A verified T3 Apply may lack a single issuer-side WorkRef correlation.
 // Do not silently hide that result or guess its project by matching titles.
 const unlinkedAppliedCount=ready&&applied.status==='LOCAL_ENCRYPTED_STORE_CONFIRMED'
   ?Math.max(0,records.length-atlasEvidence.length):0;
 const chosen=records.find(r=>r.taskId+'|'+r.resultRevisionId===reuseKey);
 const inbox=(()=>{
  if(!ready)return {status:'NOT_CONNECTED',items:[] as any[],counts:null};
  try{return receivedResultInbox(owner.snapshot,organizationId,owner.snapshot.workspaceId)}
  catch{return {status:'OWNER_READBACK_INVALID',items:[] as any[],counts:null}}
 })();
 const inboxLabels:Record<string,string>={
  REVIEW_REQUIRED:'Ожидает Review',RECEIPT_CONFLICT:'Проверить квитанции',
  ACCEPTED:'ACCEPT (не Apply)',REJECTED:'REJECT'
 };
 const acceptedSelection=acceptedApplicationSelection(review,hash);
 const canApply=ready&&!!acceptedSelection&&
   owner.snapshot?.application?.status!=='HOLD_FOR_EXPLICIT_RECOVERY';
 return <section className="card padded" data-testid="corporate-panel">
  <div className="section-head"><h2>Поручения и корпоративная приёмка</h2><button className="secondary" disabled={busy} onClick={()=>act('Состояние перечитано.',async()=>{await refresh();resetReview()})}>Обновить</button></div>
  <p className="muted">Все подписи, проверки полномочий и записи выполняются исходными механизмами из Faust-S/T3. Черновики не дают права выдачи.</p>
  <p className="notice subdued" data-testid="corporate-owner-status">{ready?'Подтверждённая организационная сессия владельца.':'NOT_CONNECTED: организационный механизм не активирован в установленном Admin Center. Действия недоступны.'}</p>
  <div className="notice subdued" data-testid="corporate-offline-summary">
   <strong>Работа без сети — обмен файлами между компьютерами</strong>
   <p data-testid="corporate-offline-readiness">{ready
    ? 'Организационный T3 подключён. Можно подготовить подписанное поручение и сохранить его в .iwxa. Файл нужно передать сотруднику отдельно.'
    : 'Сейчас T3 организации не подключён. Можно создавать черновики и связывать работы Atlas, но подписанные поручения и приём Result пока недоступны.'}</p>
   <details data-testid="corporate-offline-instructions">
    <summary>Как передавать поручения и результаты на автономных ПК</summary>
    <ol>
     <li>В Atlas сохраните JSON-портфель и откройте его в разделе «Планы Atlas». Это снимок проекта и WorkRef, не подписанный пакет поручения.</li>
     <li>После подключения организационного T3 выдайте поручение и нажмите «Сохранить .iwxa». Перенесите файл на компьютер сотрудника через выбранный носитель.</li>
     <li>Сотрудник открывает подписанный файл в действующем локальном клиенте T3, выполняет работу с Personal Agent и формирует Result через T3. Личный экспорт Agent .iwxa не заменяет подписанный корпоративный Result.</li>
     <li>Передайте Result .iwxa обратно, нажмите «Получить Result», выполните Review, отдельно решите ACCEPT/REJECT и, если применимо, Apply.</li>
    </ol>
    <p>Сохранение .iwxa не доказывает доставку; получение файла не означает принятие; ACCEPT не выполняет Apply. Без нового пакета нельзя узнать фактическое состояние отключённого ПК.</p>
   </details>
  </div>
  {error&&<p role="alert" className="notice error">{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}
  <div className="nested-form" data-testid="cen02-section">
   <h3>1. Выдать подписанное поручение</h3>
   <label>Черновик<select value={selected} onChange={e=>setSelected(e.target.value)} data-testid="corporate-assignment"><option value="">Выберите поручение</option>{organization.assignments.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}</select></label>
   <div className="actions">
    <button className="secondary" onClick={onPrepare}>Подготовить поручение</button>
    <button className="primary" data-testid="corporate-issue" disabled={!ready||busy||!organization.assignments.find(a=>a.id===selected)?.atlasRef?.workId}
     onClick={()=>act('Подписанная редакция создана владельцем. Доставка сотруднику не подтверждена.',async()=>{
       const before=owner.snapshot;
       const out=await execute('issue',{assignmentId:selected});
       if(!out.taskId||!hex.test(out.taskRevisionId)||out.deliveryState!=='NOT_CONFIRMED'||
          out.assignmentId!==selected||out.organizationId!==organizationId||
          out.workspaceId!==before.workspaceId||out.recipientId!==before.personId||
          !out.atlasRef?.workId)throw Error('TASK_ALREADY_ISSUED_LINK_NOT_SAVED');
       // The original T3 increments contextEpoch on issuance.
       const after=await refresh();
       if(!after||after.snapshot.personId!==before.personId||
          after.snapshot.organizationId!==before.organizationId||
          after.snapshot.workspaceId!==before.workspaceId||
          after.snapshot.task?.id!==out.taskId||
          after.snapshot.task?.taskRevisionId!==out.taskRevisionId)
         throw Error('TASK_ALREADY_ISSUED_LINK_NOT_SAVED');
       await onIssued(out,before.personId);
     })}>Выдать через CEN02</button>
    <button className="secondary" data-testid="corporate-export" disabled={!ready||busy||!owner.snapshot?.task?.taskRevisionId}
     onClick={()=>act('Подписанный .iwxa сохранён на выбранный носитель. Передача и открытие сотрудником не подтверждены.',async()=>{
       const task=owner.snapshot.task;
       const result=await execute('exportIssuedTask',{taskId:task.id,taskRevisionId:task.taskRevisionId});
       if(!Array.isArray(result.bytes)||!result.bytes.length)throw Error('T3_SIGNED_TASK_CARRIER_REQUIRED');
       // WebView2 blob downloads are not the native product export path.
       // Save exactly the original T3 taskBytes() output through Windows
       // file dialog. A cancelled chooser never claims delivery or export.
       if(!invoke)throw Error('CEN_NATIVE_FILE_DIALOG_UNAVAILABLE');
       const saved=await invoke('center_save_iwxa_file',{bytes:result.bytes,taskRevisionId:task.taskRevisionId});
       if(saved!==true)return false;
     })}>Сохранить .iwxa</button>
   </div>
  </div>
  <div className="nested-form" data-testid="cen03-section">
   <h3>2. Result сотрудника и Review</h3>
   <p className="muted">Выберите файл результата через системный диалог Windows. Приёмка и проверка подписи выполняются отдельно.</p>
   <button className="secondary" data-testid="corporate-receive" disabled={!ready||busy}
    onClick={()=>act('Пакет получен. Корпоративное принятие ещё не выполнено.',async()=>{
      if(!invoke)throw Error('CEN_NATIVE_FILE_DIALOG_UNAVAILABLE');
      const bytes=await invoke('center_open_iwxa_file');
      if(bytes===null)return false;
      if(!Array.isArray(bytes)||bytes.length===0||bytes.length>8*1024*1024)
        throw Error('T3_PACKAGE_SIZE_UNSUPPORTED');
      const r=await execute('receive',{bytes});
      const sha=r.transportReceipt?.packageSha256;
      if(!hex.test(sha))throw Error('T3_RECEIPT_SHAPE_UNSUPPORTED');
      setHash(sha);resetReview();
    })}>Получить Result</button>
   <p className="muted" data-testid="corporate-inbox-summary">
    {inbox.status==='NOT_CONNECTED'?'Получение результатов недоступно до подключения организации.':
      inbox.status!=='OWNER_READBACK'?'Подтверждённый список Result владельца недоступен.':
      `Получено: ${inbox.items.length}. Ожидают Review: ${inbox.counts?.reviewRequired}.
      Проблемные квитанции: ${inbox.counts?.receiptConflict}.
      ACCEPT (не Apply): ${inbox.counts?.accepted}. REJECT: ${inbox.counts?.rejected}.`}
   </p>
   <label>Полученные результаты<select data-testid="corporate-package" value={hash} onChange={e=>{setHash(e.target.value);resetReview()}}>
    <option value="">Выберите пакет для Review</option>
    {inbox.items.map((item:{packageSha256:string;status:string;acceptanceId:string|null})=><option key={item.packageSha256} value={item.packageSha256}>
      {inboxLabels[item.status]??'Проверить'} · {item.packageSha256.slice(0,16)}…
    </option>)}
    {hash&&!inbox.items.some((item:{packageSha256:string;status:string;acceptanceId:string|null})=>item.packageSha256===hash)&&
      <option value={hash}>Недавно полученный пакет · {hash.slice(0,16)}…</option>}
   </select></label>
   <button className="secondary" data-testid="corporate-review" disabled={!ready||!hash||busy}
    onClick={()=>act('Проверка подписи, редакций и конфликтов выполнена владельцем.',async()=>{
     resetReview();const r=await execute('inspect',{packageSha256:hash});
     if(r.preview?.packageSha256!==hash)throw Error('T3_REVIEW_PACKAGE_CHANGED');
     setReview(r);
    })}>Review</button>
   {review&&<div data-testid="corporate-review-readback">
    <p>Подпись: {review.verificationState??'не подтверждена'} · тип: {review.preview?.classification??'неизвестен'}</p>
    <p>Task revision: {review.taskBinding?.proven?review.taskBinding.taskRevisionId:'не доказана'} · конфликт: {review.causalReview?.classification??'нет сведений'}</p>
    <p>Приёмка: {review.receipt?.acceptanceState??'ожидается'}. ACCEPT не означает Apply.</p>
    {review.receipt?.acceptanceState==='ACCEPTED'&&
      <p data-testid="corporate-apply-readiness">{acceptedSelection
        ? 'Принятая редакция подтверждена повторным Review. Применение требует отдельного решения.'
        : 'Решение ACCEPT существует, но актуальность редакции для применения не подтверждена.'}</p>}
    <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> Я проверил пакет и подтверждаю решение</label>
    <label>Причина отказа (обязательна для REJECT)
      <textarea data-testid="corporate-reject-reason" rows={2} maxLength={1000} value={rejectReason}
        onChange={e=>setRejectReason(e.target.value)}/>
    </label>
    <div className="actions">
     <button className="primary" data-testid="corporate-accept" disabled={!ready||busy||!consent||!canDecideReviewedResult(review,hash,'ACCEPT')}
      onClick={()=>act('ACCEPT сохранён отдельно, применения ещё не было.',async()=>{
       const decision=await execute('decide',{packageSha256:hash,previewDigest:review.preview.previewDigest,decision:'ACCEPT'});
       if(decision.acceptanceState!=='ACCEPTED')throw Error('T3_ACCEPT_RECEIPT_NOT_CONFIRMED');
       resetReview();
       // Just as in the verified T3 reference UI: ACCEPT -> fresh owner
       // review. Only the new receipt and revision observation can permit Apply.
       const confirmed=await execute('inspect',{packageSha256:hash});
       if(confirmed.receipt?.acceptanceState!=='ACCEPTED'||
         confirmed.receipt?.packageSha256!==hash||
         confirmed.preview?.packageSha256!==hash)
         throw Error('T3_ACCEPT_READBACK_NOT_CONFIRMED');
       setReview(confirmed);
      })}>ACCEPT</button>
     <button className="secondary" data-testid="corporate-reject" disabled={!ready||busy||!consent||!rejectReason.trim()||rejectReason.length>1000||!canDecideReviewedResult(review,hash,'REJECT')}
      onClick={()=>act('REJECT сохранён отдельно.',async()=>{
       if(!rejectReason.trim())throw Error('RECONCILIATION_REJECTION_REASON_REQUIRED');
       const decision=await execute('decide',{packageSha256:hash,previewDigest:review.preview.previewDigest,decision:'REJECT',reason:rejectReason});
       if(decision.acceptanceState!=='REJECTED')throw Error('T3_REJECT_RECEIPT_NOT_CONFIRMED');
       resetReview();
       const confirmed=await execute('inspect',{packageSha256:hash});
       if(confirmed.receipt?.acceptanceState!=='REJECTED'||
         confirmed.receipt?.packageSha256!==hash)
         throw Error('T3_REJECT_READBACK_NOT_CONFIRMED');
       setReview(confirmed);
      })}>REJECT</button>
    </div>
   </div>}
  </div>
  <div className="nested-form" data-testid="cen03-apply">
   <h3>3. Отдельное применение</h3>
   <p>Текущее состояние Store/Journal: {owner?.snapshot?.application?.status??'нет сведений'}</p>
   <button className="secondary" data-testid="corporate-apply-preview" disabled={!canApply||busy} onClick={()=>act('Предварительный просмотр без записи.',async()=>{
     setPreview(null);setApplyConsent(false);setApplyDecided(false);
     const selected=acceptedApplicationSelection(review,hash);
     if(!selected)throw Error('T3_APPLICATION_SOURCE_NOT_CURRENT');
     const r=await execute('previewApplication',selected);
     if(r.status==='ALREADY_COMMITTED_NO_WRITE')return;
     if(!r.previewId||!r.previewDigest||
       r.acceptanceId!==selected.acceptanceId||
       !Array.isArray(r.revisionIds)||
       r.revisionIds.length!==selected.revisionIds.length||
       !selected.revisionIds.every((id:string)=>r.revisionIds.includes(id)))
       throw Error('T3_APPLICATION_PREVIEW_SOURCE_MISMATCH');
     setPreview(r);
   })}>Посмотреть применение</button>
   {preview&&<div>
    <p>Предварительный просмотр: {preview.previewId}. Запись ещё не выполнялась.</p>
    <label><input type="checkbox" checked={applyConsent} onChange={e=>{setApplyConsent(e.target.checked);setApplyDecided(false)}}/> Отдельно подтверждаю применение</label>
    <div className="actions">
     <button className="secondary" disabled={!ready||busy||!applyConsent} onClick={()=>act('Подтверждение применения записано отдельно.',async()=>{
       const r=await execute('decideApplication',{previewId:preview.previewId,previewDigest:preview.previewDigest});
       if(r.status!=='APPLICATION_DECISION_RECORDED')throw Error('T3_APPLICATION_DECISION_REQUIRED');
       setApplyDecided(true);
     })}>Подтвердить решение</button>
     <button className="primary" data-testid="corporate-apply-commit" disabled={!ready||busy||!applyDecided} onClick={()=>act('Состояние перечитано из Store/Journal.',async()=>{
       const p=preview;setPreview(null);setApplyConsent(false);setApplyDecided(false);
       try{
         const result=await execute('commitApplication',{previewId:p.previewId,
           previewDigest:p.previewDigest,acceptanceId:p.acceptanceId,
           revisionIds:p.revisionIds});
         if(result.verifiedReadback?.status!=='LOCAL_ENCRYPTED_STORE_CONFIRMED'||
           result.verifiedReadback?.effectKey!==result.effectKey)
           throw Error('T3_APPLICATION_POSTCOMMIT_READBACK_HOLD');
       }catch{throw Error('COMMIT_UNKNOWN: проверьте журнал и Store, не повторяйте запись вслепую.')}
     })}>Apply</button>
    </div>
   </div>}
  </div>
  <div className="nested-form" data-testid="cen05-result-projection">
   <h3>5. Применённые результаты и работы Atlas</h3>
   <p className="muted">Только подтверждённые T3 Apply и локальные исходные WorkRef. Это наблюдение, а не изменение проекта Atlas; ACCEPT и Apply не завершают работу автоматически.</p>
   {!ready?<p data-testid="cen05-not-connected">NOT_CONNECTED: организационный T3 не подключён.</p>:
    atlasEvidence.length===0?<p data-testid="cen05-no-projection">Нет подтверждённого Result со связью Atlas. Необходимы T3 Apply и сохранённая исходная привязка.</p>:
    <ul data-testid="cen05-applied-list">{atlasEvidence.map((e:any)=>
      <AppliedEvidenceRow key={e.result.taskId+'|'+e.result.resultRevisionId} e={e}/>)}</ul>}
   {unlinkedAppliedCount>0&&<p data-testid="cen05-unlinked-count">
     Применённых Result без проверенной связи с WorkRef: {unlinkedAppliedCount}. Уточните исходную выдачу Task в T3 и локальную привязку Center. Нельзя назначать работу по совпадению названий.
   </p>}
  </div>
  <div className="nested-form" data-testid="cen03-reuse">
   <h3>4. Использовать применённый Result</h3>
   <p className="muted">Только из подтверждённого Store T3, после повторного чтения. Новое поручение требует отдельной выдачи и подписи.</p>
   <p data-testid="corporate-applied-status">{applied.status}</p>
   <label>Применённый Result<select value={reuseKey} data-testid="corporate-reuse-select" onChange={e=>{
     const key=e.target.value;setReuseKey(key);const r=records.find(x=>x.taskId+'|'+x.resultRevisionId===key);setReuseText(r?.result??'');
    }}><option value="">Выберите запись</option>
    {records.map(r=><option key={r.taskId+'|'+r.resultRevisionId} value={r.taskId+'|'+r.resultRevisionId}>{r.taskId} · {r.resultRevisionId.slice(0,12)}</option>)}
   </select></label>
   <label>Фрагмент для нового поручения<textarea rows={4} value={reuseText} maxLength={10000} data-testid="corporate-reuse-text" onChange={e=>setReuseText(e.target.value)}/></label>
   <p className="muted">{reuseText.length}/10000 символов; в описание помещается не более 6000.</p>
   <button className="secondary" data-testid="corporate-reuse" disabled={!ready||busy||!chosen||!reuseText.trim()||reuseText.length>6000}
    onClick={()=>{try{const r=prepareAppliedReuse(applied,{taskId:chosen.taskId,resultRevisionId:chosen.resultRevisionId,text:reuseText});onReuse({description:r.description,source:r.source})}
    catch(e){setError(why(e))}}}>Вставить в новый черновик</button>
  </div>
 </section>;
}
