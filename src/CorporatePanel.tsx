import React,{useEffect,useState} from 'react';
import {readAppliedResults,prepareAppliedReuse} from '../runtime/cen03-applied-results.mjs';

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
 const [file,setFile]=useState<File|null>(null);
 const [hash,setHash]=useState('');
 const [review,setReview]=useState<any>(null);
 const [consent,setConsent]=useState(false);
 const [preview,setPreview]=useState<any>(null);
 const [applyConsent,setApplyConsent]=useState(false);
 const [applyDecided,setApplyDecided]=useState(false);
 const [reuseKey,setReuseKey]=useState('');
 const [reuseText,setReuseText]=useState('');
 const organizationId=organization.id;
 const ready=owner?.status==='OWNER_READY'&&owner.snapshot?.product==='admin'&&owner.snapshot?.organizationId===organizationId;
 const resetReview=()=>{setReview(null);setConsent(false);setPreview(null);setApplyConsent(false);setApplyDecided(false)};
 const refresh=async()=>{
   if(!invoke){setOwner(null);return null;}
   try{
     const result=await invoke('center_corporate_state',{organizationId});
     if(result?.status==='OWNER_READY'&&result.snapshot?.product==='admin'&&
       result.snapshot.organizationId===organizationId&&result.snapshot.workspaceId&&
       Number.isSafeInteger(result.snapshot.contextEpoch)){setOwner(result);return result;}
     setOwner(null);return null;
   }catch{setOwner(null);return null;}
 };
 useEffect(()=>{
   let cancelled=false;
   setOwner(null);setHash('');setError('');setNotice('');setReview(null);setPreview(null);
   if(invoke)void invoke('center_corporate_state',{organizationId}).then(r=>{
     if(!cancelled)setOwner(r?.status==='OWNER_READY'&&r.snapshot?.organizationId===organizationId&&
       r.snapshot?.product==='admin'&&Number.isSafeInteger(r.snapshot.contextEpoch)&&r.snapshot.workspaceId?r:null);
   }).catch(()=>{if(!cancelled)setOwner(null)});
   return()=>{cancelled=true};
 },[invoke,organizationId]);
 const execute=async(operation:string,input:Record<string,unknown>={})=>{
   if(!ready||!invoke)throw Error('CEN_OWNER_NOT_CONNECTED');
   const context=owner.snapshot;
   const r=await invoke('center_corporate_action',{organizationId,operation,input,
     binding:{organizationId:context.organizationId,workspaceId:context.workspaceId,contextEpoch:context.contextEpoch}});
   if(!r||r.status==='NOT_CONNECTED')throw Error('CEN_OWNER_NOT_CONNECTED');
   return r;
 };
 const act=async(success:string,fn:()=>Promise<void>)=>{
   setBusy(true);setError('');setNotice('');
   try{await fn();setNotice(success)}catch(e){setError(why(e))}
   finally{await refresh();setBusy(false)}
 };
 const applied=(()=>{
   if(!ready)return {status:'NOT_CONNECTED',records:[] as any[]};
   try{return readAppliedResults(owner.snapshot,organizationId,owner.snapshot.workspaceId)}
   catch{return {status:'HOLD_FOR_EXPLICIT_RECOVERY',records:[] as any[]}}
 })();
 const records=applied.records as any[];
 const chosen=records.find(r=>r.taskId+'|'+r.resultRevisionId===reuseKey);
 const revisionIds=(review?.changes??[]).filter((r:any)=>r.operation==='UPSERT'&&hex.test(r.revisionId)).map((r:any)=>r.revisionId) as string[];
 const current=review?.reviewLedgerConsistent===true&&revisionIds.length>0&&revisionIds.every(id=>{
   const x=review.revisionCurrentness?.find((r:any)=>r.revisionId===id);
   return x?.currentness==='CURRENT_BOUNDED'&&x.eligibleForLocalInterpretation===true;
 });
 const canApply=ready&&review?.receipt?.acceptanceState==='ACCEPTED'&&
   review.preview?.packageSha256===hash&&current&&owner.snapshot?.application?.status!=='HOLD_FOR_EXPLICIT_RECOVERY';
 return <section className="card padded" data-testid="corporate-panel">
  <div className="section-head"><h2>Поручения и корпоративная приёмка</h2><button className="secondary" disabled={busy} onClick={()=>act('Состояние перечитано.',async()=>{await refresh();resetReview()})}>Обновить</button></div>
  <p className="muted">Все подписи, проверки полномочий и записи выполняются исходными механизмами из Faust-S/T3. Черновики не дают права выдачи.</p>
  <p className="notice subdued" data-testid="corporate-owner-status">{ready?'Подтверждённая организационная сессия владельца.':'NOT_CONNECTED: механизмы корпоративного обмена не поставлены с этим установленным Admin Center. Действия недоступны.'}</p>
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
       const bytes=Uint8Array.from(result.bytes);
       const url=URL.createObjectURL(new Blob([bytes.buffer as ArrayBuffer],{type:'application/vnd.iwxa.package'}));
       const a=document.createElement('a');a.href=url;a.download='task.iwxa';a.click();
       setTimeout(()=>URL.revokeObjectURL(url),10000);
     })}>Сохранить .iwxa</button>
   </div>
  </div>
  <div className="nested-form" data-testid="cen03-section">
   <h3>2. Result сотрудника и Review</h3>
   <label>Полученный пакет .iwxa<input type="file" accept=".iwxa" onChange={e=>setFile(e.target.files?.[0]??null)}/></label>
   <button className="secondary" data-testid="corporate-receive" disabled={!ready||!file||busy}
    onClick={()=>act('Пакет получен. Корпоративное принятие ещё не выполнено.',async()=>{
      if(!file||file.size===0||file.size>8*1024*1024)throw Error('T3_PACKAGE_SIZE_UNSUPPORTED');
      const r=await execute('receive',{bytes:Array.from(new Uint8Array(await file.arrayBuffer()))});
      const sha=r.transportReceipt?.packageSha256;
      if(!hex.test(sha))throw Error('T3_RECEIPT_SHAPE_UNSUPPORTED');
      setHash(sha);resetReview();
    })}>Получить Result</button>
   <label>SHA-256 принятого пакета<select data-testid="corporate-package" value={hash} onChange={e=>{setHash(e.target.value);resetReview()}}>
    <option value="">Выберите пакет</option>
    {(owner?.snapshot?.packages??[]).filter((s:unknown)=>typeof s==='string'&&hex.test(s)).map((s:string)=><option key={s} value={s}>{s}</option>)}
    {hash&&!(owner?.snapshot?.packages??[]).includes(hash)&&<option value={hash}>{hash}</option>}
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
    <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> Я проверил пакет и подтверждаю решение</label>
    <div className="actions">
     <button className="primary" data-testid="corporate-accept" disabled={!ready||busy||!consent||review.preview?.allowedAction!=='EXPLICIT_ACCEPT_ONLY'||review.reviewLedgerConsistent!==true}
      onClick={()=>act('ACCEPT сохранён отдельно, применения ещё не было.',async()=>{
       await execute('decide',{packageSha256:hash,previewDigest:review.preview.previewDigest,decision:'ACCEPT'});
       resetReview();
      })}>ACCEPT</button>
     <button className="secondary" disabled={!ready||busy||!consent||!review.preview?.previewDigest}
      onClick={()=>act('REJECT сохранён отдельно.',async()=>{
       await execute('decide',{packageSha256:hash,previewDigest:review.preview.previewDigest,decision:'REJECT'});resetReview();
      })}>REJECT</button>
    </div>
   </div>}
  </div>
  <div className="nested-form" data-testid="cen03-apply">
   <h3>3. Отдельное применение</h3>
   <p>Текущее состояние Store/Journal: {owner?.snapshot?.application?.status??'нет сведений'}</p>
   <button className="secondary" data-testid="corporate-apply-preview" disabled={!canApply||busy} onClick={()=>act('Предварительный просмотр без записи.',async()=>{
     setPreview(null);setApplyConsent(false);setApplyDecided(false);
     const r=await execute('previewApplication',{acceptanceId:review.receipt.acceptanceId,revisionIds});
     if(r.status==='ALREADY_COMMITTED_NO_WRITE')return;
     if(!r.previewId||!r.previewDigest)throw Error('T3_APPLICATION_PREVIEW_REQUIRED');
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
       try{await execute('commitApplication',{previewId:p.previewId,previewDigest:p.previewDigest})}
       catch{throw Error('COMMIT_UNKNOWN: проверьте журнал и Store, не повторяйте запись вслепую.')}
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
