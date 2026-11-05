import React,{useEffect,useRef,useState} from 'react';
import {readAppliedResults,prepareAppliedReuse} from '../runtime/cen03-applied-results.mjs';
import {canDecideReviewedResult,acceptedApplicationSelection,ownerSessionFingerprint,receivedResultInbox} from '../runtime/cen03-review.mjs';

// CEN02/CEN03 GUI consumes an approved host implementation. Private T3 code,
// keys, permissions, signing, Reconciliation and Store never run in this WebView.
type Invoke=(command:string,args?:Record<string,unknown>)=>Promise<any>;
type Org={id:string;name:string;assignments:Array<{id:string;title:string;atlasRef:{projectId:string;revision:string;workId?:string}|null}>};
const hex=/^[a-f0-9]{64}$/;
const why=(e:unknown)=>e instanceof Error?e.message:String(e);
export default function CorporatePanel({organization,invoke,onReuse,onPrepare}:{organization:Org;invoke:Invoke|null;onReuse:(selection:{description:string;source:{organizationId:string;workspaceId:string;taskId:string;taskRevisionId:string;resultRevisionId:string;acceptanceId:string}})=>void;onPrepare:()=>void}){
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
  {error&&<p role="alert" className="notice error">{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}
  <div className="nested-form" data-testid="cen02-section">
   <h3>1. Выдать подписанное поручение</h3>
   <label>Черновик<select value={selected} onChange={e=>setSelected(e.target.value)} data-testid="corporate-assignment"><option value="">Выберите поручение</option>{organization.assignments.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}</select></label>
   <div className="actions">
    <button className="secondary" onClick={onPrepare}>Подготовить поручение</button>
    <button className="primary" data-testid="corporate-issue" disabled={!ready||busy||!organization.assignments.find(a=>a.id===selected)?.atlasRef?.workId}
     onClick={()=>act('Подписанная редакция создана владельцем. Доставка сотруднику не подтверждена.',async()=>{
       const out=await execute('issue',{assignmentId:selected});
       if(!out.taskId||!hex.test(out.taskRevisionId)||out.deliveryState!=='NOT_CONFIRMED')throw Error('T3_ISSUE_READBACK_REQUIRED');
     })}>Выдать через CEN02</button>
    <button className="secondary" data-testid="corporate-export" disabled={!ready||busy||!owner.snapshot?.task?.taskRevisionId}
     onClick={()=>act('Выдана копия подписанного carrier; доставка не подтверждена.',async()=>{
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
