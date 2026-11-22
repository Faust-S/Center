import React,{useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {record,records,str,OwnerError,type Row} from './owner-ui';
import {useUiSettings} from './ui-preferences';
import {readTaskInActiveWorkArea,readWorkAreas} from './work-area-flow';
import {verifiedPdfOcrReadReceipt,type PdfOcrOffer} from './pdf-ocr-readback';
import {officePdfPathValid,selectedPdfOcrReviewKey,type PdfScanSelection} from './office-pdf-ocr-review';
import {OfficePersonalFilePicker} from './office-personal-file-picker';
import {officeCopySuggestion} from './office-personal-file-picker-review';

type OfficeTaskRead=Row&{task_id:string;status?:string;accepted_artifact_digest?:string};

/** Only stages an ordinary Human Review Task; no OCR or file write here. */
export function OfficePdfOcrProposal({taskId,workspaceId,verified,onOpenTask,onRefreshTasks,
 onOpenConnections,initialSourcePath=''}:{
 taskId:string;workspaceId:string;verified:boolean;initialSourcePath?:string;
 onOpenTask:(id:string)=>Promise<void>;onRefreshTasks:(id?:string)=>Promise<void>;
 onOpenConnections:()=>void;
}){
 const {tr}=useUiSettings();
 const [sourcePath,setSourcePath]=useState(initialSourcePath);
 const [destinationPath,setDestinationPath]=useState(officeCopySuggestion(initialSourcePath,'pdf'));
 const [selected,setSelected]=useState<PdfScanSelection|null>(null);
 const [offer,setOffer]=useState<PdfOcrOffer|null>(null);
 const [consent,setConsent]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null);
 const [notice,setNotice]=useState('');
 const [expanded,setExpanded]=useState(Boolean(initialSourcePath));
 const [uncertainDraftKey,setUncertainDraftKey]=useState<string|null>(null);
 const nonce=useRef(0),inFlight=useRef(false);
 const live=useRef({taskId,workspaceId,verified});
 live.current={taskId,workspaceId,verified};
 const selectionIdentity=taskId||'SELECTED_PERSONAL_FILE';
 const consentKey=selectedPdfOcrReviewKey(selectionIdentity,workspaceId,sourcePath,
  destinationPath,selected,offer);
 const current=(task:string,area:string,seq:number)=>live.current.taskId===task&&
  live.current.workspaceId===area&&live.current.verified&&nonce.current===seq;
 const readScan=async(requested:string,area:string,source:string,seq:number)=>{
  if(requested){
   const scoped=await readTaskInActiveWorkArea<OfficeTaskRead>(runtime,requested);
   if(!current(requested,area,seq)||scoped.catalog.active_id!==area||
      scoped.task.status!=='closed'||!str(scoped.task.accepted_artifact_digest))
    throw Error('office_ocr_source_task_not_accepted');
  }else{
   const areas=await readWorkAreas(runtime);
   if(!current(requested,area,seq)||areas.active_id!==area)
    throw Error('office_ocr_selected_workspace_changed');
  }
  const reply=record(await runtime.command<Row>('tool_read',{
   arguments:{root_id:'personal',path:source,offset_chars:0,max_text_bytes:32000}
  },{kind:'tool',id:'files.read'}));
  const data=record(reply.data),readback=verifiedPdfOcrReadReceipt(reply,source);
  if(!current(requested,area,seq)||!readback||
     !Number.isSafeInteger(data.bytes)||Number(data.bytes)>5000000||
     readback.offer.pagesTotal>30)
   throw Error('office_ocr_scan_readback_unavailable');
  // Re-admit the actual Core Workspace after the Files operation. A switch
  // outside this React view cannot authorize a draft for the old Workspace.
  const workAreas=await readWorkAreas(runtime);
  if(!current(requested,area,seq)||workAreas.active_id!==area)
   throw Error('office_ocr_workspace_changed_during_read');
  return readback;
 };
 async function inspect(){
  if(inFlight.current||!verified||!officePdfPathValid(sourcePath))return;
  const task=taskId,area=workspaceId,source=sourcePath,seq=++nonce.current;
  inFlight.current=true;setBusy(true);setError(null);setNotice('');
  setSelected(null);setOffer(null);setConsent(null);setUncertainDraftKey(null);
  try{
   const result=await readScan(task,area,source,seq);
   if(!current(task,area,seq))return;
   setSelected({taskId:task||'SELECTED_PERSONAL_FILE',workspaceId:area,path:source,
    sha256:result.offer.sourceSha256,pagesTotal:result.offer.pagesTotal,
    providerBindingDigest:result.providerBindingDigest});
   setOffer(result.offer);
   setNotice(tr('PDF проверен: текстового слоя нет. OCR ещё не выполнялся.',
    'PDF checked: no text layer found. OCR has not run.'));
  }catch(e){if(current(task,area,seq)){setSelected(null);setOffer(null);setError(e);}}
  finally{inFlight.current=false;setBusy(false);}
 }
 async function stage(){
  if(inFlight.current||!verified||!consentKey||consent!==consentKey||
     !selected||!offer)return;
  const task=taskId,area=workspaceId,source=sourcePath,dest=destinationPath,
   old=selected,key=consentKey,seq=++nonce.current;
  let requestDispatched=false;
  inFlight.current=true;setBusy(true);setError(null);setNotice('');
  setUncertainDraftKey(null);
  try{
   const fresh=await readScan(task,area,source,seq);
   if(!current(task,area,seq)||fresh.offer.sourceSha256!==old.sha256||
      fresh.offer.pagesTotal!==old.pagesTotal||
      fresh.providerBindingDigest!==old.providerBindingDigest)
    throw Error('office_ocr_source_revision_changed');
   await runtime.refreshRevision();
   const finalAreas=await readWorkAreas(runtime);
   if(!current(task,area,seq)||finalAreas.active_id!==area)
    throw Error('office_ocr_context_changed');
   // Core stages a deterministic TASK-OCR intent. Its persisted
   // idempotency handles a lost response even after cold restart.
   // Never automatically replay this command on an unknown reply.
   requestDispatched=true;
   const result=record(await runtime.command<Row>('local_office_pdf_ocr_draft',{
    source_task_id:task||null,...(!task?{workspace_id:area}:{}),
    source_path:source,path:dest,expected_sha256:old.sha256,confirmed:true
   },task?{kind:'task',id:task}:{kind:'workspace',id:area}));
   if(!current(task,area,seq))return;
   const id=str(result.task_id),candidateId=str(result.candidate_id);
   if(!id||!candidateId||result.review_required!==true||
      result.execution_performed!==false||
      typeof result.reused!=='boolean')
    throw Error('office_ocr_task_not_verified');
   const detail=record(await runtime.query<Row>('task',{task_id:id}));
   if(!current(task,area,seq))return;
   if(detail.task_id!==id||!records(detail.action_candidates).some(c=>
      c.candidate_id===candidateId&&c.operation==='files.ocr_pdf'&&c.target===dest))
    throw Error('office_ocr_candidate_readback_invalid');
   setConsent(null);
   try{
    await onOpenTask(id);
    setNotice(result.reused===true
     ?tr('Найдена ранее подготовленная Task. OCR не запускался повторно.',
      'The existing Task was recovered. No OCR was executed again.')
     :tr('Новая Task подготовлена. OCR и запись выполняются только после Human Review и отдельного разрешения.',
      'New Task prepared. OCR and file write require Human Review and a separate approval.'));
   }catch{
    setNotice(tr('Task подготовлена, но переход не удался. Откройте её в списке задач.',
     'The Task is prepared, but navigation failed. Open it from the task list.'));
   }
   try{await onRefreshTasks()}catch{/* Already read back the Task. */ }
  }catch(e){if(current(task,area,seq)){
   if(requestDispatched){
    setError(null);setUncertainDraftKey(key);
    setNotice(tr('Ответ на создание Task не получен. Сначала обновите список задач. При явном повторе с теми же данными Core возвращает ту же Task и не запускает OCR.',
     'The Task draft reply was lost. Refresh the task list first. An explicit retry with identical inputs reuses the existing Core Task without executing OCR.'));
   }else setError(e);
   setConsent(null);
  }}
  finally{inFlight.current=false;setBusy(false);}
 }
 return <details className="advanced-form" open={expanded}
  onToggle={event=>setExpanded(event.currentTarget.open)}
  aria-label={tr('Распознавание сканированного PDF','Scanned PDF OCR')}>
  <summary>{tr('Распознать PDF через установленный OCRmyPDF','Recognize PDF using installed OCRmyPDF')}</summary>
  <p>{tr('Программа устанавливается только по вашему выбору. IWXA проверит отсутствие текста и предложит новую копию. Подготовка Task не запускает OCR. После Human Review нужно отдельно разрешить исполнение через ToolRuntime.',
    'The app is installed only by your choice. IWXA checks for missing text and prepares a new copy. Staging a Task does not start OCR. Human Review and ToolRuntime approval are required.')}</p>
  <label className="advanced-field">{tr('Сканированный PDF в Personal Files','Scanned PDF in Personal Files')}
   <input value={sourcePath} maxLength={160} placeholder="scans/invoice.pdf" disabled={busy||!verified}
    onChange={e=>{
     const next=e.target.value;
     setSourcePath(next);setDestinationPath(officeCopySuggestion(next,'pdf'));
     setSelected(null);setOffer(null);setConsent(null);setError(null);
     setNotice('');setUncertainDraftKey(null);
    }}/>
  </label>
  <OfficePersonalFilePicker taskId={taskId} workspaceId={workspaceId}
   verified={verified} disabled={busy} kind="pdf"
   onSelect={selectedPath=>{
    setSourcePath(selectedPath);setDestinationPath(officeCopySuggestion(selectedPath,'pdf'));
    setSelected(null);setOffer(null);setConsent(null);setError(null);setNotice('');
    setUncertainDraftKey(null);
   }}/>
  <button type="button" className="secondary-button"
   disabled={busy||!verified||!officePdfPathValid(sourcePath)} onClick={()=>void inspect()}>
   {busy?tr('Проверяю…','Checking…'):tr('Проверить текстовый слой','Check PDF text layer')}</button>
  {offer&&selected?.path===sourcePath&&<div className="owner-row">
   <strong>{tr('Нет извлекаемого текста','No extractable text')}</strong>
   <p>{tr('Страниц без текста','Pages without text')}: {offer.pagesTotal}</p>
   <small>SHA-256: {offer.sourceSha256}</small>
   <small>{tr('OCR не выполнялся, файл не изменён','OCR has not run; original is unchanged')}</small>
  </div>}
  <label className="advanced-field">{tr('Новая PDF-копия (не заменять оригинал)','New PDF copy (do not overwrite original)')}
   <input value={destinationPath} maxLength={160} placeholder="scans/invoice-searchable.pdf"
    disabled={busy||!verified} onChange={e=>{
     setDestinationPath(e.target.value);setConsent(null);setError(null);setNotice('');
    }}/>
  </label>
  {consentKey&&<label><input type="checkbox" checked={consent===consentKey}
   disabled={busy||!verified} onChange={e=>setConsent(e.target.checked?consentKey:null)}/>
   {tr('Я проверил PDF, его SHA-256 и адрес новой копии. Согласен подготовить Task для OCRmyPDF.',
    'I verified the scan, its SHA-256 and the new copy path. I consent to stage the OCRmyPDF Task.')}
  </label>}
  <div className="advanced-actions">
   <button type="button" disabled={busy||!verified||!consentKey||
     consent!==consentKey}
    onClick={()=>void stage()}>{tr('Подготовить Task для Human Review','Prepare Task for Human Review')}</button>
   {Boolean(consentKey)&&uncertainDraftKey===consentKey&&<button type="button" className="secondary-button"
    disabled={busy} onClick={()=>void onRefreshTasks().catch(e=>setError(e))}>
    {tr('Обновить список задач','Refresh task list')}</button>}
   <button type="button" className="secondary-button" onClick={onOpenConnections}>
    {tr('Настроить Personal Files','Configure Personal Files')}</button>
  </div>
  {notice&&<p role="status">{notice}</p>}
  {Boolean(error)&&<OwnerError error={error}/>}
 </details>;
}
