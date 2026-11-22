import React,{useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {record,records,str,failure,OwnerDetails,OwnerError,type Row} from './owner-ui';
import {useUiSettings,HelpTip} from './ui-preferences';
import {verifiedPersonalFolder,type PersonalFolderRoot} from './files-root-readback';
import {documentReadbackOutcome,documentEditorReadbackMatches,verifiedDocumentOrigin,verifiedPlanApproval,verifiedDocumentExecutionAdmission,documentJourneyState,documentWriteCandidateProgress,documentEditorConsentKey,documentActionTaskMatches,documentMutationReady,type DocumentReadbackOutcome} from './document-readback';
import {readTaskInActiveWorkArea,readWorkAreas,readDocumentSourceInActiveWorkArea} from './work-area-flow';
import {OfficePdfOcrTask} from './office-pdf-ocr-task';

type Attachment={origin?:string;path?:string;sha256?:string;bytes?:number};
type Snapshot={snapshot_id?:string;source_items?:Attachment[]};
type Candidate={candidate_id?:string;ref_id?:string;operation?:string;target?:string;arguments?:Row;description?:string};
type DocTask={
 task_id:string;status:string;summary?:string;claims?:{text?:string}[];provider?:{id?:string};
 local_document_mode?:boolean;accepted_artifact_digest?:string;
 document_origin?:Row;
 action_candidates?:Candidate[];accepted_action_candidate_ids?:string[];
 readback?:{context_snapshots?:Snapshot[];tool_plans?:Row[];execution_receipts?:Row[];repair_cases?:Row[]};
};
type CurrentFile={path:string;sha256:string;text:string};
type ReviewPlan={id:string;current:CurrentFile|null};
type EditorValue={active:boolean;path:string;mode:'create'|'replace';text:string;expected_sha256:string|null};
type EditorRead=EditorValue&{source_task_id:string;state:string;draft_digest:string;read_only:boolean};
const emptyEditor:EditorValue={active:false,path:'action-plan.md',mode:'create',text:'',expected_sha256:null};
const editorSignature=(v:EditorValue)=>JSON.stringify([v.active,v.path,v.mode,v.text,v.expected_sha256]);
const MAX_BYTES=128*1024;
const digestOK=(x:unknown)=>/^[0-9a-f]{64}$/.test(str(x));
const nowExpired=(x:unknown)=>{const t=Date.parse(str(x));return !Number.isFinite(t)||t<=Date.now()};
const message=(e:unknown)=>failure(e);
const utf8Bytes=(x:string)=>new TextEncoder().encode(x).length;
function validPath(x:string){return x.length>0&&x.length<=160&&x===x.normalize('NFC')
 &&!x.startsWith('/')&&!x.endsWith('/')&&/\.(md|txt)$/i.test(x)
 &&x.split('/').every(p=>!!p&&p===p.trim()&&!p.startsWith('.')
  &&!/[<>:"\\|?*\x00-\x1f]/.test(p)&&!/[. ]$/.test(p)
  &&!/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(p));}
function draftText(task:DocTask, title:string, stepsTitle:string){
 const summary=(task.summary||'').trim(),claims=(task.claims||[]).map(x=>(x.text||'').trim()).filter(Boolean);
 let text=summary.startsWith('#')?summary:'# '+title+'\n\n'+summary;
 if(claims.length&&!text.includes('## '+stepsTitle))text+='\n\n## '+stepsTitle+claims.map(x=>'\n- '+x).join('');
 return text;
}
function writtenPlan(p:Row){
 const a=record(p.arguments);
 return p.tool_id==='files.write_text'&&p.provider_id==='LOCAL_FILES_V1'
  &&p.provider_slot==='file_workspace'&&a.root_id==='personal'
  &&['create','replace'].includes(str(a.mode))&&str(a.path)===str(p.target)
  &&validPath(str(a.path))&&typeof a.text==='string'
  &&utf8Bytes(a.text)<=MAX_BYTES&&!!a.text.trim()&&(a.mode!=='replace'||digestOK(a.expected_sha256));
}
function activeApproval(row:Row){return row.decision==='approve'&&row.active===true&&row.state==='APPROVED'&&!nowExpired(row.expires_at);}
function planApprovalId(a:Row){return str(a.plan_id)||str(record(a.plan_ref).ref_id);}
function readPlanState(states:Row,id:string){return record(states[id]);}

export function DocumentWorkflow({task,workspaceId,verified=true,suggestedOcrPath='',focusRequest=0,readbackEpoch=0,onOpenTask,onOpenSourceTask,onRefreshTasks,onReviewCandidate,onPrepareCandidate,onOpenPlans,onOpenConnections,onOpenRecovery,onRegisterLeaveGuard,onRegisterCloseFlush}:{
 task:DocTask|null;
 workspaceId:string;
 verified?:boolean;
 suggestedOcrPath?:string;
 focusRequest?:number;
 readbackEpoch?:number;
 onOpenTask:(id:string,operation?:'files.write_text'|'files.ocr_pdf')=>Promise<void>;
 onPrepareCandidate:(id:string)=>void;
 onOpenPlans:()=>void;
 onOpenSourceTask:(id:string)=>Promise<void>;
 onRefreshTasks:(currentTaskId?:string)=>Promise<void>;
 onReviewCandidate:(candidateId:string)=>void;
 onOpenConnections:()=>void;
 onOpenRecovery:(caseId:string)=>void;
 onRegisterLeaveGuard?:(guard:null|(()=>void))=>void;
 onRegisterCloseFlush?:(flush:null|(()=>Promise<void>))=>void;
}){
 const {tr}=useUiSettings();
 const taskId=str(task?.task_id);
 // An accepted generic Task alone is not a reason to show the OCR panel.
 // Open this route only for a PDF explicitly selected in Files or an existing
 // OCR action, keeping ordinary Task/document navigation uncluttered.
 const officeOcrEntry=Boolean(suggestedOcrPath)||
  Boolean(task?.action_candidates?.some(c=>c.operation==='files.ocr_pdf'));
 const acceptedSource=!!task?.local_document_mode&&task?.status==='closed'
  &&!!task?.accepted_artifact_digest
  &&['OLLAMA_LOCAL_V1','IWXA_BASIC_RUNTIME_V1'].includes(task?.provider?.id||'');
 const fileProgress=documentWriteCandidateProgress(task);
 const isWriteCandidate=fileProgress.present;
 const sourceTaskId=verifiedDocumentOrigin(task?.document_origin,taskId);
 const history=records(task?.readback?.tool_plans).filter(x=>x.tool_id==='files.write_text');
 const historyReceipts=records(task?.readback?.execution_receipts).filter(x=>x.tool_id==='files.write_text');
 // An unchanged number of receipts does not mean the latest receipt is
 // unchanged. Bind restoration to the immutable ID, not the array length.
 const newestReceipt=historyReceipts
  .filter(r=>r.status==='SUCCEEDED'&&r.external_effect_state==='ACKNOWLEDGED'&&str(r.receipt_id))
  .sort((a,b)=>(Date.parse(str(b.finished_at))||0)-(Date.parse(str(a.finished_at))||0)
    ||str(b.receipt_id).localeCompare(str(a.receipt_id)))[0];
 const newestReceiptId=str(newestReceipt?.receipt_id);
 const sourceRows=(task?.readback?.context_snapshots||[]).flatMap(s=>(s.source_items||[])
  .filter(x=>x.origin==='interaction_attachment'&&!!x.path&&digestOK(x.sha256))
  .map(x=>({snapshot_id:str(s.snapshot_id),path:str(x.path),sha256:str(x.sha256),bytes:x.bytes||0})));
 const [draftOpen,setDraftOpen]=useState(false),[mode,setMode]=useState<'create'|'replace'>('create');
 const [expectedDigest,setExpectedDigest]=useState<string|null>(null);
 const [editorLoaded,setEditorLoaded]=useState(false),[editorSaving,setEditorSaving]=useState(false);
 const [editorRestoreAttempt,setEditorRestoreAttempt]=useState(0);
 const [editorReconnectAttempt,setEditorReconnectAttempt]=useState(0);
 const [editorReconnectState,setEditorReconnectState]=useState<'idle'|'checking'|'conflict'|'unavailable'>('idle');
 const [editorError,setEditorError]=useState('');
 const [path,setPath]=useState('action-plan.md'),[draft,setDraft]=useState(''),[previous,setPrevious]=useState<CurrentFile|null>(null);
 const [conflictingFile,setConflictingFile]=useState<CurrentFile|null>(null);
 const [editorConsent,setEditorConsent]=useState<string|null>(null),[source,setSource]=useState<Row|null>(null);
 const [plans,setPlans]=useState<Row[]>([]),[approvals,setApprovals]=useState<Row[]>([]);
 const [states,setStates]=useState<Row>({}),[loadedTask,setLoadedTask]=useState('');
 const [historySession,setHistorySession]=useState(-1);
 const cases=records(task?.readback?.repair_cases);
 const [loading,setLoading]=useState(false),[busy,setBusy]=useState(''),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [reviewPlan,setReviewPlan]=useState<ReviewPlan|null>(null),[planConfirmed,setPlanConfirmed]=useState(false);
 const [saved,setSaved]=useState<Row|null>(null),[readBusy,setReadBusy]=useState(false);
 const [savedReadError,setSavedReadError]=useState('');
 const [destination,setDestination]=useState<PersonalFolderRoot|null>(null),[destinationError,setDestinationError]=useState('');
 const lastRestoredReceipt=useRef('');
 const receiptReadSequence=useRef(0);
 const currentTaskId=useRef(taskId);
 currentTaskId.current=taskId;
 const currentWorkspaceId=useRef(workspaceId);
 currentWorkspaceId.current=workspaceId;
 const currentVerified=useRef(verified);
 currentVerified.current=verified;
 const persistedEditor=useRef<{taskId:string;digest:string;signature:string}|null>(null);
 const editorQueue=useRef<Promise<unknown>>(Promise.resolve()),editorEpoch=useRef(0);
 const editorRestoreSequence=useRef(0);
 const coreSessionEpoch=useRef(readbackEpoch);
 coreSessionEpoch.current=readbackEpoch;
 // A Core session change invalidates an editor's authority to autosave until
 // its exact saved digest and Task/Workspace membership have been re-read.
 const editorAdmittedSession=useRef(-1);
 // Prevent any already-in-flight async preflight from dispatching a command
 // after selecting another Task, unmounting, or reconnecting to Core.
 const scopeCurrent=(id:string,restore:number,core:number)=>
  !!id&&currentTaskId.current===id&&
  editorRestoreSequence.current===restore&&coreSessionEpoch.current===core
  &&!!workspaceId&&currentWorkspaceId.current===workspaceId&&currentVerified.current;
 async function verifyDocumentTask(kind:'draft'|'write',candidateId?:string){
  const requested=taskId,area=workspaceId;
  if(!task||!requested||!area||!currentVerified.current||
     currentTaskId.current!==requested||currentWorkspaceId.current!==area)
   throw Error('document_task_context_unavailable_before_dispatch');
  // Reuse the existing Core Workspace admission. No browser cache or extra
  // storage is consulted to authorize a document write.
  const {catalog,task:observed}=await readTaskInActiveWorkArea<DocTask>(runtime,requested);
  if(catalog.active_id!==area||currentWorkspaceId.current!==area||
     currentTaskId.current!==requested||!currentVerified.current||
     !documentActionTaskMatches(requested,kind,task,observed,candidateId))
   throw Error('document_task_or_workspace_changed_before_dispatch');
  return observed;
 }
 const editorValue:EditorValue=draftOpen?
  {active:true,path,mode,text:draft,expected_sha256:mode==='replace'?expectedDigest:null}:emptyEditor;
 const editorSig=editorSignature(editorValue);
 const currentConsentKey=documentEditorConsentKey(taskId,editorValue);
 const editorConfirmed=!!currentConsentKey&&editorConsent===currentConsentKey;
 const consentCurrent=useRef(editorConsent);
 consentCurrent.current=editorConsent;
 // State is retained during React Task transitions until its restore effect
 // runs. Never display another Task's draft or file evidence in that window.
 const editorForTask=editorLoaded&&persistedEditor.current?.taskId===taskId;
 const visibleSource=verified&&source?.task_id===taskId&&sourceRows.some(row=>
  row.snapshot_id===source.snapshot_id&&row.path===source.path&&row.sha256===source.sha256)?source:null;
 const visibleSaved=verified&&saved?.task_id===taskId&&saved.read_only===true
  &&saved.receipt_confirmed===true?saved:null;
 const editorCurrent=useRef({taskId,value:editorValue,loaded:editorLoaded});
 editorCurrent.current={taskId,value:editorValue,loaded:editorLoaded};
 const attempted=useRef<Set<string>>(new Set());
 const sequence=useRef(0),inFlight=useRef(false);
 useEffect(()=>{
  if(!onRegisterLeaveGuard)return;
  const check=()=>{
   if(inFlight.current)throw Error('document_operation_not_finished');
   // Read the latest Core-confirmed digest, not a dirty flag captured during
   // the last React render. Closing can flush successfully without rendering.
   const current=editorCurrent.current;
   if(current.value.active&&(!current.loaded
       ||persistedEditor.current?.taskId!==current.taskId
       ||persistedEditor.current.signature!==editorSignature(current.value)))
    throw Error('document_draft_not_saved');
  };
  onRegisterLeaveGuard(check);
  return()=>onRegisterLeaveGuard(null);
 },[onRegisterLeaveGuard]);
 async function persistEditor(snapshot:{taskId:string;value:EditorValue}):Promise<EditorRead>{
  const sig=editorSignature(snapshot.value);
  const session=coreSessionEpoch.current,restore=editorRestoreSequence.current;
  const work=editorQueue.current.catch(()=>undefined).then(async()=>{
   // A queued old-session mutation must never dispatch after reconnect.
   if(session!==coreSessionEpoch.current||editorAdmittedSession.current!==session
     ||restore!==editorRestoreSequence.current)
    throw Error('document_editor_session_readback_required');
   if(currentTaskId.current!==snapshot.taskId)throw Error('document_editor_selection_changed');
   const previous=persistedEditor.current;
   if(!previous||previous.taskId!==snapshot.taskId)throw Error('document_editor_not_restored');
   let saved:EditorRead|null=null;
   if(previous.signature!==sig){
    try{
     saved=await runtime.command<EditorRead>('document_editor_save',{
      source_task_id:snapshot.taskId,value:snapshot.value,expected_draft_digest:previous.digest
     },{kind:'task',id:snapshot.taskId});
    }catch(error){
     // A lost command reply is checked by readback. Never repeat an
     // unknown document-editor mutation without observing its version.
     const observed=await runtime.query<EditorRead>('document_editor_draft',{source_task_id:snapshot.taskId});
     if(!documentEditorReadbackMatches(observed,snapshot.taskId)||editorSignature(observed)!==sig)throw error;
     saved=observed;
    }
   }
   const checked=await runtime.query<EditorRead>('document_editor_draft',{source_task_id:snapshot.taskId});
   if(!documentEditorReadbackMatches(checked,snapshot.taskId)
      ||editorSignature(checked)!==sig||(saved&&saved.draft_digest!==checked.draft_digest))
    throw Error('document_editor_readback_mismatch');
   if(currentTaskId.current!==snapshot.taskId)
    throw Error('document_editor_selection_changed');
   if(session!==coreSessionEpoch.current||editorAdmittedSession.current!==session
     ||restore!==editorRestoreSequence.current)
    throw Error('document_editor_session_changed_during_save');
   persistedEditor.current={taskId:snapshot.taskId,digest:checked.draft_digest,signature:sig};
   return checked;
  });
  editorQueue.current=work;
  return await work;
 }
 useEffect(()=>{
  if(!onRegisterCloseFlush)return;
  const flush=async()=>{
   if(inFlight.current)throw Error('document_operation_not_finished');
   const snapshot=editorCurrent.current;
   if(!snapshot.value.active)return;
   if(!snapshot.loaded)throw Error('document_editor_not_restored');
   editorEpoch.current++;
   await persistEditor({taskId:snapshot.taskId,value:snapshot.value});
   if(currentTaskId.current!==snapshot.taskId
      ||editorSignature(editorCurrent.current.value)!==editorSignature(snapshot.value))
    throw Error('document_editor_changed_during_close');
  };
  onRegisterCloseFlush(flush);
  return()=>onRegisterCloseFlush(null);
 },[onRegisterCloseFlush]);
 const applicable=acceptedSource||isWriteCandidate||history.length>0||historyReceipts.length>0;
 async function confirmDestination(binding?:string){
  try{
   const response=await runtime.command<Row>('tool_read',{arguments:{}},{kind:'tool',id:'files.roots'});
   const observed=verifiedPersonalFolder(response,binding);
   if(observed.read_only)throw Error('personal_folder_read_only');
   setDestination(observed);setDestinationError('');
   return observed;
  }catch(e){
   // Never keep showing a former verified destination after an unsuccessful
   // check. In particular the previous folder must not look writable.
   setDestination(null);setDestinationError(message(e));
   throw e;
  }
 }
 useEffect(()=>{
  if(!applicable){setDestination(null);setDestinationError('');return;}
  let active=true;
  setDestination(null);setDestinationError('');
  runtime.command<Row>('tool_read',{arguments:{}},{kind:'tool',id:'files.roots'})
   .then(response=>{const found=verifiedPersonalFolder(response);if(active){setDestination(found);setDestinationError('');}})
   .catch(e=>{if(active){setDestination(null);setDestinationError(message(e));}});
  return()=>{active=false};
 },[taskId,applicable]);
 const sectionRef=useRef<HTMLElement>(null);
 useEffect(()=>{
  if(focusRequest>0&&applicable)sectionRef.current?.scrollIntoView({behavior:'smooth',block:'start'});
 },[focusRequest,applicable]);
 const load=useCallback(async(strict=false):Promise<Row|null>=>{
  if(!taskId){if(strict)throw Error('task_required_for_plan_readback');return null;}
  const s=++sequence.current,session=coreSessionEpoch.current,area=workspaceId;
  setLoading(true);setLoadedTask('');setHistorySession(-1);
  try{
   // Task-scoped, canonical plan/approval readback: no global 100-plan cutoff.
   const result=record(await runtime.query<Row>('tool_plans',{task_id:taskId}));
   if(s!==sequence.current||session!==coreSessionEpoch.current||currentTaskId.current!==taskId
      ||currentWorkspaceId.current!==area){if(strict)throw Error('plan_readback_superseded');return null;}
   if(result.task_id!==taskId||result.read_only!==true||!Array.isArray(result.plans)||!Array.isArray(result.approvals))
    throw Error('task_tool_history_contract_invalid');
   const scopedPlans=records(result.plans);
   if(scopedPlans.some(p=>str(record(p.task_ref).ref_id)!==taskId))throw Error('task_tool_plan_binding_mismatch');
   setPlans(scopedPlans.filter(p=>p.tool_id==='files.write_text'));
   setApprovals(records(result.approvals));
   setStates(record(result.execution_by_plan));
   setLoadedTask(taskId);setHistorySession(session);setError('');
   return result;
  }catch(e){
   if(s===sequence.current&&session===coreSessionEpoch.current){
    setLoadedTask('');setHistorySession(-1);setPlans([]);setApprovals([]);setStates({});setError(message(e));
   }
   if(strict)throw e;
   return null;
  }finally{if(s===sequence.current&&session===coreSessionEpoch.current)setLoading(false)}
 },[taskId,workspaceId]);
 // A repaired desktop session invalidates the previous Core projection.
 // Do not reset the editor or issue writes; refresh the exact task-scoped
 // plans/approvals and let receipt readback verify the most recent file.
 useEffect(()=>{
  if(!readbackEpoch||!taskId||!applicable)return;
  // A prior receipt checked in the old session is not a live verification
  // in the new Core. The next check is read-only, never a second file write.
  receiptReadSequence.current++;
  lastRestoredReceipt.current='';
  setReadBusy(false);setSaved(null);setSavedReadError('');
  void load(true).catch(()=>{/* The loader reports the failure. */});
 // Keep this keyed to an authenticated Core session, not a Task re-render.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[readbackEpoch]);
 useEffect(()=>{
  if(!readbackEpoch||!taskId||!acceptedSource)return;
  const baseline=persistedEditor.current;
  editorAdmittedSession.current=-1;
  if(!baseline||baseline.taskId!==taskId){
   // An initial read was interrupted by session renewal; resume from the
   // existing Core editor rather than treating stale UI as a blank editor.
   setEditorLoaded(false);setEditorReconnectState('idle');
   setEditorRestoreAttempt(n=>n+1);
   return;
  }
  const requested=taskId,area=workspaceId,session=coreSessionEpoch.current;
  const restore=++editorRestoreSequence.current;
  let alive=true;
  const current=()=>alive&&requested===currentTaskId.current&&
   area===currentWorkspaceId.current&&session===coreSessionEpoch.current
   &&restore===editorRestoreSequence.current;
  editorEpoch.current++;
  setEditorLoaded(false);setEditorConsent(null);
  setEditorReconnectState('checking');setEditorError('');
  // Do not abort a dispatched Core command. An old in-flight save must settle
  // before any new editor admission; a delayed result never enables a retry.
  const slow=window.setTimeout(()=>{
   if(current()){
    setEditorReconnectState('unavailable');
    setEditorError(tr(
     'Сверка черновика задерживается. Возможен незавершённый ответ сохранения. Запись заблокирована.',
     'Draft verification is delayed. A prior save may still be unresolved. Writing is blocked.'));
   }
  },15000);
  void (async()=>{
   await editorQueue.current.catch(()=>undefined);
   if(!current())return;
   const scoped=await readTaskInActiveWorkArea<DocTask>(runtime,requested);
   if(!current())return;
   if(scoped.catalog.active_id!==area
     ||!documentActionTaskMatches(requested,'draft',task,scoped.task))
    throw Error('document_editor_task_changed_after_reconnect');
   const observed=await runtime.query<EditorRead>('document_editor_draft',{source_task_id:requested});
   const catalog=await readWorkAreas(runtime);
   if(!current())return;
   if(catalog.active_id!==area||!documentEditorReadbackMatches(observed,requested))
    throw Error('document_editor_reconnect_readback_invalid');
   if(observed.draft_digest!==baseline.digest||editorSignature(observed)!==baseline.signature){
    // A saved editor changed while the connection was unavailable. Keep the
    // local text visible for copying, but never overwrite the new Core draft.
    setEditorReconnectState('conflict');
    setEditorError(tr(
     'Черновик в ядре отличается от прежней редакции. Локальный текст сохранён в этом окне. Перед загрузкой новой редакции скопируйте нужные изменения.',
     'The saved Core draft differs from the previous revision. Local text remains in this window. Copy any needed edits before loading the new version.'));
    return;
   }
   persistedEditor.current={taskId:requested,digest:observed.draft_digest,
    signature:editorSignature(observed)};
   editorAdmittedSession.current=session;
   setEditorReconnectState('idle');setEditorError('');setEditorLoaded(true);
  })().catch(e=>{
   if(!current())return;
   setEditorReconnectState('unavailable');
   setEditorError(tr(
    'Не удалось подтвердить сохранённый черновик после восстановления соединения. Запись заблокирована. ',
    'Could not verify the saved draft after reconnect. Writing is blocked. ')+message(e));
  }).finally(()=>window.clearTimeout(slow));
  return()=>{alive=false;editorRestoreSequence.current++;window.clearTimeout(slow)};
 // A user retry runs this read-only reconciliation again. No autosave or
 // editor reset occurs until either exact readback or explicit discard.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[readbackEpoch,editorReconnectAttempt]);
 useEffect(()=>{
  const restoreSeq=++editorRestoreSequence.current;
  const sessionAtRestore=coreSessionEpoch.current;
  editorAdmittedSession.current=-1;
  setEditorReconnectState('idle');
  receiptReadSequence.current++;editorEpoch.current++;
  setReadBusy(false);setLoadedTask('');setReviewPlan(null);setSaved(null);
  setSavedReadError('');lastRestoredReceipt.current='';setSource(null);
  setDraftOpen(false);setPrevious(null);setConflictingFile(null);setExpectedDigest(null);
  setEditorConsent(null);
  setNotice('');setError('');setEditorError('');setEditorLoaded(false);setEditorSaving(false);
  persistedEditor.current=null;
  void load();
  const selectedTask=taskId;
  if(!selectedTask||!acceptedSource){setEditorLoaded(true);return;}
  void runtime.query<EditorRead>('document_editor_draft',{source_task_id:selectedTask}).then(saved=>{
   if(restoreSeq!==editorRestoreSequence.current||currentTaskId.current!==selectedTask
     ||sessionAtRestore!==coreSessionEpoch.current)return;
   if(!documentEditorReadbackMatches(saved,selectedTask))
    throw Error('document_editor_restore_invalid');
   persistedEditor.current={taskId:selectedTask,digest:saved.draft_digest,
    signature:editorSignature(saved)};
   editorAdmittedSession.current=sessionAtRestore;
   if(saved.state==='SAVED'&&saved.active){
    setMode(saved.mode);setPath(saved.path);setDraft(saved.text);
    setExpectedDigest(saved.expected_sha256);setDraftOpen(true);
   }
   setEditorLoaded(true);
  }).catch(e=>{if(restoreSeq===editorRestoreSequence.current&&currentTaskId.current===selectedTask
    &&sessionAtRestore===coreSessionEpoch.current)
   setEditorError(tr('Не удалось восстановить черновик документа. Редактирование пока недоступно. ',
    'Could not restore the document draft. Editing remains unavailable. ')+message(e));});
  return()=>{editorRestoreSequence.current++};
 },[load,acceptedSource,editorRestoreAttempt]);
 useEffect(()=>{
  if(!acceptedSource||!editorLoaded||!draftOpen||!taskId)return;
  if(persistedEditor.current?.taskId===taskId&&persistedEditor.current.signature===editorSig)return;
  const epoch=++editorEpoch.current;
  const session=coreSessionEpoch.current,restore=editorRestoreSequence.current;
  const visible=()=>session===coreSessionEpoch.current&&restore===editorRestoreSequence.current;
  const snapshot={taskId,value:editorValue};
  const timer=window.setTimeout(()=>{
   if(epoch!==editorEpoch.current)return;
   setEditorSaving(true);
   void persistEditor(snapshot).then(()=>{if(visible())setEditorError('')})
    .catch(e=>{if(visible())setEditorError(tr('Черновик не подтверждён в локальном хранилище. ',
      'The draft has not been verified in local storage. ')+message(e))})
    .finally(()=>{if(visible())setEditorSaving(false)});
  },650);
  return()=>{editorEpoch.current++;window.clearTimeout(timer);};
 },[taskId,acceptedSource,editorLoaded,draftOpen,path,mode,draft,expectedDigest]);
 // Refreshing an already open Task must not reset its editor. The old
 // projection may stay visible, but write authority waits for a fresh read.
 const ready=verified&&loadedTask===taskId&&historySession===readbackEpoch&&!loading&&!error;
 const mutationReady=documentMutationReady(ready,acceptedSource,editorLoaded,
  editorReconnectState,editorAdmittedSession.current,readbackEpoch);
 const journey=documentJourneyState({
  taskId,verified,historyReady:ready,acceptedSource,
  candidatePresent:fileProgress.present,
  candidateAccepted:fileProgress.accepted,
  plans,approvals,executionByPlan:states,saved:visibleSaved
 });
 useEffect(()=>{
  if(!ready||busy||readBusy||!taskId)return;
  if(!newestReceiptId||lastRestoredReceipt.current===taskId+':'+newestReceiptId)return;
  lastRestoredReceipt.current=taskId+':'+newestReceiptId;
  // A read-only receipt check restores the last approved document after
  // reopening IWXA. It never calls ToolRuntime Execute or repeats a write.
  void readSaved(newestReceiptId);
 },[taskId,ready,busy,readBusy,newestReceiptId]);
 async function guarded(label:string,action:()=>Promise<void>){
  if(inFlight.current)return;
  inFlight.current=true;setBusy(label);setError('');setNotice('');
  try{await action();}
  catch(e){setError(tr('Действие или проверка состояния не завершились. Обновите сведения перед повтором.','The action or state verification did not complete. Refresh before retrying.')+' '+message(e));}
  finally{inFlight.current=false;setBusy('');}
 }

 const relatedCases=cases.filter(c=>{
  const id=str(c.plan_id)||str(record(c.plan_ref).ref_id);
  return history.some(x=>str(x.plan_id)===id)||plans.some(x=>str(x.plan_id)===id)||str(c.task_id)===taskId;
 });
 function editPath(p:string){setPath(p);setPrevious(null);setConflictingFile(null);setExpectedDigest(null);setEditorConsent(null)}
 function editMode(m:'create'|'replace'){
  if(m===mode)return;
  if(draft.trim()&&!window.confirm(tr('Сменить режим и заменить текст текущего черновика?',
   'Change the mode and replace the current draft text?')))return;
  setMode(m);setPrevious(null);setConflictingFile(null);setExpectedDigest(null);setEditorConsent(null);
  setDraft(m==='create'&&task?draftText(task,tr('План действий','Action plan'),
   tr('Предлагаемые шаги','Proposed steps')):'');
 }
 async function readExisting(){
  if(!validPath(path))return;
  // A failed refresh must not leave a previously observed file looking current.
  // Keep the user's draft text and its prior digest for an explicit rebase.
  setPrevious(null);setConflictingFile(null);setEditorConsent(null);
  await guarded(tr('Чтение файла','Reading file'),async()=>{
   const result=record(await runtime.command<Row>('tool_read',{arguments:{root_id:'personal',path}},{kind:'tool',id:'files.read'}));
   const found=record(result.data);
   if(found.root_id!=='personal'||found.path!==path||!digestOK(found.sha256)||typeof found.text!=='string')
    throw Error('file_readback_identity_invalid');
   const v={path,sha256:str(found.sha256),text:str(found.text)};
   if(expectedDigest&&v.sha256!==expectedDigest){
    setConflictingFile(v);
    setNotice(tr(
     'Файл изменился после последнего чтения. Сравните новую версию со своим черновиком и явно выберите, продолжать ли изменение. Запись не выполнялась.',
     'The file changed since it was last read. Compare the new version with your draft and explicitly choose whether to continue. No write was performed.'
    ));
    return;
   }
   const keep=!!expectedDigest||(!!draft.trim()&&draft!==v.text&&!window.confirm(tr(
    'Заменить черновик текущим содержимым файла? Выберите «Отмена», чтобы сохранить свою редакцию.',
    'Replace the draft with the file content? Select Cancel to preserve your edits.')));
   setPrevious(v);setExpectedDigest(v.sha256);if(!keep)setDraft(v.text);
   setNotice(tr('Версия файла прочитана. Перед записью приложение снова проверит её.','File version loaded. The app will recheck it before writing.'));
  });
 }
 async function stageDraft(){
  if(!task||!acceptedSource||!verified||!editorForTask||!validPath(path)||!draft.trim()
      ||utf8Bytes(draft)>MAX_BYTES||!editorConfirmed||busy)return;
  if(mode==='replace'&&(!previous||previous.path!==path||!digestOK(previous.sha256)
      ||expectedDigest!==previous.sha256))return;
  const requested=taskId,restore=editorRestoreSequence.current,core=coreSessionEpoch.current;
  const confirmedKey=currentConsentKey,expectedSig=editorSig;
  const snapshot:EditorValue={...editorValue};
  await guarded(tr('Подготовка документа','Preparing document'),async()=>{
   editorEpoch.current++;
   await persistEditor({taskId:requested,value:snapshot});
   await confirmDestination();
   await runtime.refreshRevision();
   // Consent must still cover the exact Core-confirmed text and destination,
   // even if the Task or editor changes during asynchronous preflight.
   if(!scopeCurrent(requested,restore,core)
      ||!confirmedKey||consentCurrent.current!==confirmedKey
      ||editorCurrent.current.taskId!==requested
      ||editorSignature(editorCurrent.current.value)!==expectedSig
      ||persistedEditor.current?.signature!==expectedSig
      ||(snapshot.mode==='replace'&&(!previous
       ||previous.path!==snapshot.path
       ||previous.sha256!==snapshot.expected_sha256)))
    throw Error('document_draft_changed_before_candidate_no_command_sent');
   await verifyDocumentTask('draft');
   if(!scopeCurrent(requested,restore,core)
      ||consentCurrent.current!==confirmedKey
      ||editorSignature(editorCurrent.current.value)!==expectedSig)
    throw Error('document_task_context_changed_before_candidate_no_command_sent');
   const out=record(await runtime.command<Row>('local_document_file_draft',{
    source_task_id:requested,path:snapshot.path,text:snapshot.text,mode:snapshot.mode,
    confirmed:true,...(snapshot.mode==='replace'?{expected_sha256:snapshot.expected_sha256}:{})
   },{kind:'task',id:requested}));
   const next=str(out.task_id);
   if(!next)throw Error('draft_task_id_missing');
   const newTask=record(await runtime.query<Row>('task',{task_id:next}));
   if(str(newTask.task_id)!==next||!records(newTask.action_candidates).some(c=>c.operation==='files.write_text'))
    throw Error('document_draft_task_not_verified');
   // Do not delete the reviewed source draft here. An interrupted UI
   // transition must leave the original text recoverable after restart.
   // Candidate creation is deterministic, so a repeated preparation returns
   // the same Task rather than authorizing or executing another write.
   await onOpenTask(next);
   setNotice(tr(
    'Подготовлена отдельная задача для проверки записи. Исходный черновик сохранён; файл пока не изменён.',
    'A separate file-write review task is prepared. Your source draft remains saved; the file is unchanged.'
   ));
   try{await onRefreshTasks()}catch{/* New task already verified. */}
  });
 }
 async function prepare(candidateId:string){
  if(!mutationReady||!task||!task.accepted_action_candidate_ids?.includes(candidateId))return;
  const requested=taskId,restore=editorRestoreSequence.current,core=coreSessionEpoch.current;
  await guarded(tr('Подготовка плана','Preparing plan'),async()=>{
   await confirmDestination();
   await runtime.refreshRevision();
   if(!scopeCurrent(requested,restore,core))throw Error('document_scope_changed_before_prepare');
   await verifyDocumentTask('write',candidateId);
   if(!scopeCurrent(requested,restore,core))throw Error('document_scope_changed_before_prepare');
   const out=record(await runtime.command<Row>('tool_prepare',{task_id:taskId,candidate_id:candidateId},{kind:'action_candidate',id:candidateId}));
   const planId=str(out.plan_id);
   if(!planId)throw Error('tool_prepare_plan_identity_missing');
   const snapshot=record(await load(true));
   if(!records(snapshot.plans).some(p=>str(p.plan_id)===planId&&str(record(p.task_ref).ref_id)===taskId))
    throw Error('prepared_plan_missing_from_task_history');
   setReviewPlan(null);
   // Synchronize the selected Task detail, not only ToolRuntime. This makes
   // newly prepared plans visible in saved history without reopening.
   try{await onRefreshTasks(requested)}catch{/* Manual history refresh remains available. */}
   setNotice(tr('План сохранён и проверен. Файл ещё не изменён - проверьте текст перед разрешением.','Plan saved and verified. The file is unchanged; inspect the text before approval.'));
  });
 }
 async function inspectPlan(p:Row){
  if(!mutationReady||!writtenPlan(p)){setError('file_write_plan_contract_invalid');return;}
  setReviewPlan(null);setPlanConfirmed(false);
  await guarded(tr('Проверка плана','Inspecting plan'),async()=>{
   const a=record(p.arguments);let current:CurrentFile|null=null;
   if(a.mode==='replace'){
    const data=record((await runtime.command<Row>('tool_read',{arguments:{root_id:'personal',path:str(a.path)}},{kind:'tool',id:'files.read'})).data);
    if(data.root_id!=='personal'||data.path!==a.path||data.sha256!==a.expected_sha256||typeof data.text!=='string')
     throw Error('file_changed_after_plan_preparation');
    current={path:str(data.path),sha256:str(data.sha256),text:str(data.text)};
   }
   setReviewPlan({id:str(p.plan_id),current});
  });
 }
 async function decidePlan(p:Row,decision:'approve'|'reject'){
  const id=str(p.plan_id),planDigest=str(p.plan_digest);
  if(!mutationReady||!writtenPlan(p)||readPlanState(states,id).state!=='NOT_STARTED'
     ||nowExpired(p.expires_at)||!digestOK(planDigest))return;
  if(decision==='approve'&&(reviewPlan?.id!==id||!planConfirmed))return;
  const requested=taskId,restore=editorRestoreSequence.current,core=coreSessionEpoch.current;
  await guarded(tr('Решение человека','Human decision'),async()=>{
   if(decision==='approve'&&record(p.arguments).mode==='replace'){
    const a=record(p.arguments);
    const v=record((await runtime.command<Row>('tool_read',{arguments:{root_id:'personal',path:str(a.path)}},{kind:'tool',id:'files.read'})).data);
    if(v.path!==a.path||v.sha256!==a.expected_sha256||typeof v.text!=='string')throw Error('file_modified_before_approval');
   }
   if(decision==='approve')await confirmDestination(str(p.provider_binding_digest));
   // Identify immutable approvals that existed BEFORE this decision. A
   // preexisting historical record is not evidence of a new command.
   const before=record(await load(true));
   if(!records(before.plans).some(x=>str(x.plan_id)===id&&str(x.plan_digest)===planDigest))
    throw Error('tool_approval_plan_changed_before_decision');
   const priorIds=records(before.approvals).filter(x=>planApprovalId(x)===id)
    .map(x=>str(x.approval_id));
   await runtime.refreshRevision();
   if(!scopeCurrent(requested,restore,core)||nowExpired(p.expires_at)
     ||readPlanState(record(before.execution_by_plan),id).state!=='NOT_STARTED')
    throw Error('document_approval_preflight_changed_no_command_sent');
   const candidateId=str(record(p.candidate_ref).ref_id);
   await verifyDocumentTask('write',candidateId);
   if(!scopeCurrent(requested,restore,core))
    throw Error('document_approval_workspace_changed_no_command_sent');
   let ackId:string|null=null,unknown:unknown=null;
   try{
    const result=record(await runtime.command<Row>('tool_approve',
      {plan_id:id,decision},{kind:'tool_plan',id}));
    ackId=str(result.approval_id)||null;
   }catch(e){unknown=e;}
   // A missing HTTP acknowledgement may follow an actual, durable approval.
   // Read the exact Task's Core-owned plan/approval history, never dispatch
   // tool_approve or tool_execute a second time from this recovery path.
   let after:Row;
   try{after=record(await load(true));}
   catch(e){
    if(unknown)throw Error('tool_approval_outcome_unconfirmed: '+message(unknown));
    throw e;
   }
   const verified=verifiedPlanApproval(id,planDigest,decision,
     after.approvals,priorIds,ackId);
   if(!verified){
    if(unknown){
     setNotice(tr('Ответ на разрешение потерян. Сверьте сохранённую историю плана перед повторным решением; запись файла не запускалась.',
      'The approval reply was lost. Review the saved plan history before deciding again; no file write was started.'));
     throw Error('tool_approval_outcome_unconfirmed: '+message(unknown));
    }
    throw Error('tool_approval_readback_mismatch');
   }
   setReviewPlan(null);setPlanConfirmed(false);
   try{await onRefreshTasks(requested)}catch{/* Exact decision remains in Core history. */}
   setNotice(unknown
    ?tr('В истории найдено новое подтверждённое решение по этому плану. Повторной отправки не было; запись файла потребует отдельного действия.',
      'A new verified decision was found for this plan. Nothing was resent; writing the file requires a separate action.')
    :decision==='approve'
    ?tr('Разрешение сохранено и проверено. Запись потребует отдельного действия.',
      'Approval saved and verified. Writing requires a separate action.')
    :tr('Отклонение сохранено. Файл не изменён.','Rejection recorded. The file is unchanged.'));
  });
 }
 async function execute(p:Row,approvalId:string){
  const id=str(p.plan_id);
  if(!mutationReady||inFlight.current||busy||attempted.current.has(id)||!writtenPlan(p)||!approvalId||readPlanState(states,id).state!=='NOT_STARTED')return;
  if(!window.confirm(tr('Выполнить одобренную запись файла? После неизвестного исхода повтор запрещён до сверки квитанции.','Execute the approved file write? If the outcome is unknown, no retry is allowed until receipt reconciliation.')))return;
  const requested=taskId,restore=editorRestoreSequence.current,core=coreSessionEpoch.current;
  await guarded(tr('Запись файла','Writing file'),async()=>{
   // Preflight cannot have written anything. A failed folder/revision check
   // must allow a fresh explicit attempt and must not be labelled UNKNOWN.
   try{
    await confirmDestination(str(p.provider_binding_digest));
    await runtime.refreshRevision();
   }catch(e){
    setError(tr('Папка или разрешение не проверены. Команда записи не отправлена. Подключите нужную папку и обновите план.',
     'The folder or authority could not be verified. No write was sent. Reconnect the intended folder and refresh the plan.')+' '+message(e));
    return;
   }
   // The plan and approval shown before the confirmation dialog can expire,
   // be revoked, or be superseded while awaiting Core and folder preflight.
   // Read the exact Task again before dispatch. The Core still independently
   // validates its own immutable authority when tool_execute arrives.
   let current:Row|null=null;
   try{current=record(await load(true));}
   catch(e){
    setError(tr('Не удалось повторно проверить план и разрешение. Запись не отправлена. ',
      'The plan and approval could not be rechecked. No write was sent. ')+message(e));
    return;
   }
   if(!scopeCurrent(requested,restore,core)
     ||!verifiedDocumentExecutionAdmission(current,requested,id,str(p.plan_digest),approvalId)){
    setError(tr('План, разрешение или текущая задача изменились. Запись не отправлена. Обновите сведения.',
      'The plan, approval or selected Task changed. No write was sent. Refresh the details.'));
    return;
   }
   const candidateId=str(record(p.candidate_ref).ref_id);
   try{
    await verifyDocumentTask('write',candidateId);
    if(!scopeCurrent(requested,restore,core))
     throw Error('document_execution_workspace_changed_no_command_sent');
   }catch(e){
    setError(tr('Задача или рабочая область изменились. Команда записи не отправлена. ',
      'The Task or Workspace changed. No write command was sent. ')+message(e));
    return;
   }
   let output:Row|null=null,transportFailure:unknown=null;
   try{
    attempted.current.add(id);
    output=record(await runtime.command<Row>('tool_execute',{plan_id:id,approval_id:approvalId},{kind:'tool_plan',id}));
   }catch(e){transportFailure=e;}
   const receipt=record(output?.receipt);
   let snapshot:Row|null=null;
   try{snapshot=record(await load(true));}
   catch(e){
    setError(tr('Запись могла состояться, но состояние плана сейчас не читается. Повтор запрещён.','The write may have occurred, but the plan cannot be read back. Retrying is forbidden.')+' '+message(e));
   }
   const durable=record(record(snapshot?.execution_by_plan)[id]);
   const receiptId=str(durable.receipt_id);
   // The command response can disappear after the Core has committed the
   // write. Recover only from the exact task-scoped durable plan, then require
   // an independently verified immutable receipt and approved file content.
   const matchingAck=!output||(receipt.status==='SUCCEEDED'
    &&receipt.external_effect_state==='ACKNOWLEDGED'
    &&str(receipt.receipt_id)===receiptId);
   const durableSuccess=str(durable.state)==='SUCCEEDED'&&!!receiptId&&matchingAck;
   let verifiedWrite=false;
   if(durableSuccess){
    const readback=await readSaved(receiptId);
    verifiedWrite=readback==='CURRENT_VERIFIED';
    if(verifiedWrite){
     setNotice(transportFailure
      ?tr('Ответ записи был потерян, но сохранённая квитанция и документ подтвердили результат.','The write response was lost, but the saved receipt and document verified the result.')
      :tr('Запись подтверждена историей выполнения и сохранённой версией файла.','The write was verified against execution history and the saved file version.'));
    }else if(readback==='HISTORY_ONLY'){
     setNotice(tr('Квитанция подтверждена, но текущий файл не совпадает с утверждённым текстом или недоступен для проверки. История сохранена. Повтор записи запрещён.',
      'The receipt is verified, but the live file differs from the approved content or cannot be checked. History is preserved. Do not retry the write.'));
    }else{
     setNotice(tr('Квитанция записи найдена, но подтверждение сохранённого документа недоступно. Повтор запрещён.',
      'A write receipt was found, but document readback is unavailable. Do not retry.'));
    }
   }else{
    setNotice(tr('Результат записи не подтверждён полностью. Повтор заблокирован. Проверьте историю и восстановление.','The write has not been fully verified. Retrying is blocked. Check history and recovery.'));
   }
   try{await onRefreshTasks(requested);}catch{/* Preserve execution evidence and warning. */}
   if(transportFailure&&!verifiedWrite)setError(tr('Ответ выполнения не получен. Проверьте состояние, повтор записи запрещён.','The execution response was lost. Check the state; no write retry is allowed.')+' '+message(transportFailure));
  });
 }
 async function readSaved(receiptId:string):Promise<DocumentReadbackOutcome|'UNAVAILABLE'>{
  if(!taskId||!receiptId||!workspaceId)return 'UNAVAILABLE';
  const requestedTask=taskId,requestedArea=workspaceId,request=++receiptReadSequence.current;
  const session=coreSessionEpoch.current;
  const current=()=>session===coreSessionEpoch.current
   &&request===receiptReadSequence.current&&currentTaskId.current===requestedTask
   &&currentWorkspaceId.current===requestedArea&&currentVerified.current;
  setReadBusy(true);setSaved(null);setSavedReadError('');
  try{
   const scoped=await readTaskInActiveWorkArea<DocTask>(runtime,requestedTask);
   if(!current()||scoped.catalog.active_id!==requestedArea)return 'UNAVAILABLE';
   const value=record(await runtime.query<Row>('task_saved_document',{task_id:requestedTask,receipt_id:receiptId}));
   const verifiedArea=await readWorkAreas(runtime);
   if(!current()||verifiedArea.active_id!==requestedArea)return 'UNAVAILABLE';
   const readback=documentReadbackOutcome(value,requestedTask,receiptId);
   setSaved(value);
   return readback;
  }catch(e){
   if(current())setSavedReadError(tr('Не удалось прочитать сохранённую версию. Повтор записи не требуется.','The saved version could not be read. Do not repeat the write.')+' '+message(e));
   return 'UNAVAILABLE';
  }finally{if(current())setReadBusy(false);}
 }
 async function readSource(snapshotId:string,attachmentPath:string,digest:string){
  const requestedTask=taskId,requestedArea=workspaceId;
  const restore=editorRestoreSequence.current,core=coreSessionEpoch.current;
  setSource(null);
  if(!verified||!requestedTask||!requestedArea||!sourceRows.some(item=>
    item.snapshot_id===snapshotId&&item.path===attachmentPath&&item.sha256===digest))
   return;
  await guarded(tr('Проверка исходника','Reading source'),async()=>{
   const source=await readDocumentSourceInActiveWorkArea(runtime,{
    taskId:requestedTask,areaId:requestedArea,snapshotId,
    path:attachmentPath,sha256:digest
   });
   if(!scopeCurrent(requestedTask,restore,core))
    throw Error('task_source_readback_identity_changed');
   setSource(source);
  });
 }
 async function interrupted(planId:string){
  if(!mutationReady||inFlight.current)return;
  const requested=taskId,restore=editorRestoreSequence.current,core=coreSessionEpoch.current;
  await guarded(tr('Восстановление записи','Recovering recorded intent'),async()=>{
   // Recovery only reads/materializes existing intent evidence. Never call
   // tool_execute or replay an approved file write after an unknown outcome.
   await runtime.refreshRevision();
   if(!scopeCurrent(requested,restore,core))throw Error('document_scope_changed_before_recovery');
   const before=record(await load(true));
   const plan=records(before.plans).find(x=>str(x.plan_id)===planId);
   if(!plan)throw Error('document_recovery_plan_missing');
   await verifyDocumentTask('write',str(record(plan.candidate_ref).ref_id));
   if(!scopeCurrent(requested,restore,core))throw Error('document_scope_changed_before_recovery');
   const out=record(await runtime.command<Row>('tool_recover_interrupted',{plan_id:planId},{kind:'tool_plan',id:planId}));
   if(!['ALREADY_RECORDED','RECONCILIATION_REQUIRED'].includes(str(out.state))
      ||out.provider_invoked!==false)throw Error('document_recovery_authority_or_state_invalid');
   const state=record(await load(true));
   const durable=record(record(state.execution_by_plan)[planId]);
   const receiptId=str(durable.receipt_id);
   if(str(durable.state)==='SUCCEEDED'&&receiptId){
    const observed=await readSaved(receiptId);
    setNotice(observed==='CURRENT_VERIFIED'
      ?tr('Запись подтверждена по квитанции; текущий файл совпадает. Повтор не требуется.',
        'The receipt confirms the write and the current file matches. No retry is needed.')
      :observed==='HISTORY_ONLY'
      ?tr('История записи подтверждена, но текущий файл отличается или недоступен. Повтор запрещён.',
        'The write history is verified, but the current file differs or is unavailable. Do not retry.')
      :tr('Квитанция существует, но текущий документ не проверен. Повтор запрещён.',
        'A receipt exists, but the live document could not be verified. Do not retry.'));
   }else{
    setNotice(tr('Результат прерванной записи требует сверки. Автоматический повтор запрещён.',
      'The interrupted write still requires reconciliation. Automatic retry is forbidden.')
      +(out.state==='RECONCILIATION_REQUIRED'
       ?' · '+tr('Откройте случай восстановления в истории ниже.','Open the recovery case in history below.')
       :''));
   }
   // Refresh the existing Task's repair-case and immutable receipt projection.
   // This never invokes the file provider or reenacts a previously sent write.
   try{await onRefreshTasks(requested)}catch{/* Keep the verified local history visible. */}
  });
 }
 const ocrPanel=officeOcrEntry?<OfficePdfOcrTask task={task} workspaceId={workspaceId}
  initialSourcePath={suggestedOcrPath}
  verified={verified} onOpenTask={onOpenTask} onRefreshTasks={onRefreshTasks}
  onReviewCandidate={onReviewCandidate} onPrepareCandidate={onPrepareCandidate}
  onOpenPlans={onOpenPlans} onOpenConnections={onOpenConnections}/>:null;
 // An OCR shortcut may exist before a source Task is selected. Do not
 // dereference that absent Task in the standard document editor below.
 if(!task)return suggestedOcrPath?<section className="subpage card advanced"
  aria-label={tr('Документы и OCR','Documents and OCR')}>{ocrPanel}</section>:null;
 if(!applicable)return officeOcrEntry?<section className="subpage card advanced"
  aria-label={tr('Документы и OCR','Documents and OCR')}>{ocrPanel}</section>:null;
 return <section ref={sectionRef} className="subpage card advanced" aria-label={tr('Создание и изменение документов','Create and edit documents')}>
  <div className="advanced-head"><div><h2>{tr('Создание и изменение документов','Create and edit documents')} <HelpTip topic="files"/></h2>
   <p>{visibleSaved&&ready
    ?tr('Сохранённая версия и состояние текущего файла показаны ниже. Новая запись требует отдельного разрешения.',
     'The saved version and live-file status appear below. Another write requires separate approval.')
    :tr('Проверьте результат анализа, подготовьте текст и отдельно разрешите создание или изменение файла.',
     'Review the analysis, prepare the content and separately approve creating or updating a file.')}</p></div>
   <button className="secondary-button" disabled={!!busy||loading} onClick={()=>void load()}>{tr('Обновить историю','Refresh history')}</button></div>
  {ocrPanel}
  {!verified&&<p role="status" className="advanced-notice">{tr(
   'Обновляем результат задачи. Черновик остаётся открытым, действия с файлами временно недоступны.',
   'Refreshing the task result. Your draft stays open; file actions are temporarily unavailable.'
  )}</p>}
  <div className="advanced-form" aria-label={tr('Текущий этап работы с документом','Current document step')}>
   <h3>{tr('Состояние документа','Document status')}</h3>
   <p role="status">{
    journey.status==='LIVE_VERIFIED'?tr('Файл проверен: текущий текст совпадает с одобренным и квитанция прочитана.',
      'File verified: current text matches the approved content and the receipt was read.'):
    journey.status==='HISTORY_ONLY'?tr('Квитанция подтверждена, но текущий файл отличается или недоступен. Сохранённая история остаётся доступной.',
      'The receipt is verified, but the current file differs or is unavailable. Saved history remains available.'):
    journey.status==='VERIFY_FILE'?tr('Запись отражена в истории. Требуется отдельная проверка текущего файла по квитанции.',
      'Execution is recorded. Verify the live file separately against its receipt.'):
    journey.status==='OUTCOME_UNKNOWN'?tr('Исход действия неизвестен. Повтор записи запрещён до сверки.',
      'The effect is unknown. Do not retry the write before reconciliation.'):
    journey.status==='READY_TO_WRITE'?tr('Разрешение на план сохранено. Запись ещё не подтверждена; требуется отдельное действие.',
      'Plan approval is saved. The write is not verified; an additional action is required.'):
    journey.status==='REVIEW_PLAN'?tr('План подготовлен. Проверьте полный текст и отдельно разрешите запись.',
      'A plan is prepared. Review its full text and approve the write separately.'):
    journey.status==='PLAN_EXPIRED'?tr('Срок плана истёк. Старое разрешение не действует. Из принятого кандидата потребуется подготовить новый план.',
      'The plan expired. Earlier approval no longer applies. Prepare a new plan from the accepted candidate.'):
    journey.status==='PLAN_REJECTED'?tr('План отклонён. Запись по нему запрещена. При необходимости создайте новое предложение.',
      'This plan was rejected and cannot be executed. Prepare a new proposal if needed.'):
    journey.status==='PREPARE_PLAN'?tr('Кандидат принят человеком. Подготовьте план записи для отдельной проверки.',
      'The candidate has human acceptance. Prepare a write plan for separate review.'):
    journey.status==='CANDIDATE_REVIEW'?tr('Есть предложение записи. Оно ждёт решения человека по полному тексту.',
      'A write candidate awaits human review of the full text.'):
    journey.status==='ANALYSIS_ACCEPTED'?tr('Результат анализа принят. Подготовьте и сохраните редактируемый документ.',
      'The analysis was accepted. Prepare and save the editable document.'):
    journey.status==='UNVERIFIED'?tr('Актуальная история документа пока не подтверждена. Запись недоступна.',
      'Current document history has not been verified. Writing is unavailable.'):
    tr('Для этой задачи нет подтверждённого действия записи.','No verified write action is associated with this Task.')
   }</p>
   {journey.status==='VERIFY_FILE'&&journey.receiptId&&<button type="button"
     className="secondary-button" disabled={readBusy||!!busy}
     onClick={()=>void readSaved(journey.receiptId!)}>{tr('Проверить текущий файл','Verify live file')}</button>}
   {(journey.status==='OUTCOME_UNKNOWN'||journey.status==='HISTORY_ONLY')&&
    <p role="alert" className="advanced-notice">{tr('Просмотрите историю и основания ниже. Повтор действия может повредить данные.',
      'Inspect the history and evidence below. Repeating the action could damage data.')}</p>}
  </div>
  {visibleSaved&&ready&&<div className="advanced-form document-verified-result" role="region"
   aria-label={tr('Сохранённая версия документа','Saved document version')}>
   <div className="document-verified-heading">
    <div><h3>{tr('Сохранённая версия документа','Saved document version')}</h3>
     <p>{tr('Содержимое подтверждено квитанцией. Проверка текущего файла показывается отдельно.',
      'This content is backed by a receipt. Live-file verification is shown separately.')}</p></div>
    <button type="button" className="secondary-button" disabled={readBusy}
     onClick={()=>void readSaved(str(visibleSaved.receipt_id))}>
     {tr('Повторно прочитать файл','Recheck the live file')}</button>
   </div>
   <p className="document-verified-path"><strong>{tr('Файл в Personal Files:','File in Personal Files:')}</strong>
    {' '}{str(visibleSaved.path)}</p>
   <p className="document-verified-state" role="status">{journey.status==='LIVE_VERIFIED'
    &&visibleSaved.current_state==='MATCHES_APPROVED'
    ?tr('Текущий файл проверен: текст совпадает с утверждённой версией.',
      'Live file verified: its content matches the approved version.')
    :visibleSaved.current_state==='MODIFIED'
    ?tr('Сохранённая версия подтверждена, но текущий файл изменён. Ниже можно сравнить обе версии.',
      'The saved version is verified, but the live file has changed. Compare both versions below.')
    :visibleSaved.current_state==='MATCHES_APPROVED'
    ?tr('Эта версия совпадала с файлом при последней сверке. Состояние новых действий показано выше.',
      'This version matched the file at the last check. Any newer action is reported above.')
    :tr('Сохранённая версия подтверждена квитанцией. Проверить текущий файл не удалось.',
      'The receipt verifies the saved version. The live file could not be verified.')}</p>
   <details open className="document-verified-text"><summary>{tr('Утверждённый текст','Approved content')}</summary>
    <pre className="document-content">{str(visibleSaved.text)}</pre></details>
   {visibleSaved.current_state==='MODIFIED'&&<details><summary>{tr('Текущая версия отличается от утверждённой','Live file differs from approved version')}</summary>
    <pre className="document-content">{str(visibleSaved.current_text)}</pre></details>}
   <OwnerDetails title={tr('Квитанция и целостность','Receipt and integrity')} value={visibleSaved}/>
  </div>}
  {error&&<OwnerError error={error}/>}
  {editorError&&<p role="alert" className="advanced-error">{editorError}</p>}
  {acceptedSource&&editorReconnectState==='checking'&&<p role="status" className="advanced-notice">
   {tr('Проверяем сохранённую редакцию документа после восстановления ядра. Запись временно недоступна.',
    'Verifying the saved document draft after reconnect. Writing is temporarily unavailable.')}
  </p>}
  {acceptedSource&&(editorReconnectState==='conflict'||editorReconnectState==='unavailable')&&
   <div className="advanced-form" role="group" aria-label={tr('Восстановление черновика документа','Document draft recovery')}>
    {draftOpen&&<details>
     <summary>{tr('Показать локальный текст для копирования','Show local text to copy')}</summary>
     <pre className="document-content">{draft}</pre>
    </details>}
    <button type="button" className="secondary-button" disabled={!!busy}
     onClick={()=>{setEditorReconnectState('checking');setEditorReconnectAttempt(n=>n+1)}}>
     {tr('Повторить сверку с ядром','Recheck saved Core draft')}
    </button>
    {editorReconnectState==='conflict'&&<button type="button" className="secondary-button"
     disabled={!!busy} onClick={()=>{
      if(!window.confirm(tr(
       'Локальные несохранённые изменения редактора будут заменены подтверждённой версией из ядра. Скопируйте нужный текст перед продолжением. Загрузить версию ядра?',
       'Unsaved local editor changes will be replaced with the verified Core version. Copy any needed text first. Load the Core version?')))return;
      setEditorReconnectState('idle');setEditorError('');
      setEditorRestoreAttempt(n=>n+1);
     }}>{tr('Загрузить сохранённую версию','Load saved Core version')}</button>}
   </div>}
  {acceptedSource&&!editorLoaded&&!!editorError&&editorReconnectState==='idle'&&<button type="button" className="secondary-button"
   disabled={!!busy||loading} onClick={()=>{setEditorError('');setEditorRestoreAttempt(n=>n+1)}}>
   {tr('Повторить чтение черновика','Retry loading the draft')}</button>}
  {notice&&<p role="status" className="advanced-notice">{notice}</p>}
  {busy&&<p role="status">{busy}</p>}
  <p role="status">{destination?tr('Проверенная папка для документов:','Verified document folder:')+' '+destination.path+(destination.read_only?' · '+tr('Только чтение','Read-only'):''):tr('Папка для записи пока не проверена. Подключите Personal Files и обновите сведения.','The write destination is not verified. Connect Personal Files and refresh.')}</p>
  {destinationError&&<details><summary>{tr('Проверка папки','Folder check')}</summary><code>{destinationError}</code></details>}
  {savedReadError&&<p role="alert" className="advanced-error">{savedReadError}</p>}
  {isWriteCandidate&&sourceTaskId&&<div className="advanced-form">
   <h3>{tr('Связанный исходный анализ','Original reviewed analysis')}</h3>
   <p>{tr('Эта задача записи создана из отдельно принятого анализа. Исходный черновик и его история сохраняются в исходной задаче.',
    'This file-write task was prepared from separately accepted analysis. The original draft and its history remain in the source Task.')}</p>
   <button type="button" className="secondary-button" disabled={!!busy||readBusy||!verified}
    onClick={()=>void onOpenSourceTask(sourceTaskId)}>
    {tr('Вернуться к исходному анализу','Return to original analysis')}</button>
  </div>}
  {isWriteCandidate&&task?.document_origin?.verified===false&&<p role="status">
   {tr('Связь с исходным анализом сейчас не подтверждена. Задача записи и её квитанции доступны отдельно.',
    'The original analysis link cannot currently be verified. The write Task and its receipts remain available.')}</p>}
  {acceptedSource&&<>
   <div className="advanced-form"><h3>{tr('1. Проверенный результат анализа','1. Reviewed document analysis')}</h3>
    <p>{tr('Результат анализа локальной моделью принят. Создание или изменение файла потребует отдельного разрешения.','The local model analysis was accepted. Creating or updating a file requires separate approval.')}</p>
    {sourceRows.map(row=><div className="owner-row" key={row.snapshot_id+':'+row.path}>
     <strong>{row.path}</strong>
     <button disabled={!!busy} onClick={()=>void readSource(row.snapshot_id,row.path,row.sha256)}>{tr('Прочитать подтверждённый источник','Read verified source')}</button>
    </div>)}
    {visibleSource&&<details open><summary>{tr('Прочитанный исходный документ: ','Verified source document: ')+str(visibleSource.path)}</summary><pre className="document-content">{str(visibleSource.text)}</pre></details>}
    <button className="primary-button" disabled={!!busy||!verified||!editorLoaded} onClick={()=>{
     if(draftOpen&&!window.confirm(tr('Начать новый черновик и заменить сохранённый текст?',
      'Start a new draft and replace the saved text?')))return;
     setMode('create');setPath('action-plan.md');
     setDraft(draftText(task,tr('План действий','Action plan'),tr('Предлагаемые шаги','Proposed steps')));
     setPrevious(null);setConflictingFile(null);setExpectedDigest(null);setEditorConsent(null);setDraftOpen(true);
    }}>{draftOpen?tr('Начать заново','Start over'):tr('Подготовить документ','Prepare a document')}</button>
   </div>
   {draftOpen&&editorForTask&&<div className="advanced-form"><h3>{tr('2. Подготовка текста и назначения','2. Review content and destination')}</h3>
    <p role="status">{editorSaving
     ?tr('Сохраняем черновик в приложении...','Saving the draft in the app...')
     :persistedEditor.current?.taskId===taskId&&persistedEditor.current.signature===editorSig
      ?tr('Черновик сохранён. После перезапуска редактирование продолжится.','Draft saved. Editing can resume after restart.')
      :tr('Есть изменения, ожидающие сохранения.','There are changes awaiting save.')}</p>
    <p>{tr('Путь относительно подключённой папки Personal Files (не путь к произвольному файлу на ПК).','Path is relative to the connected Personal Files workspace, not an arbitrary computer file.')}</p>
    <label className="advanced-field">{tr('Режим','Mode')}<select value={mode} disabled={!!busy} onChange={e=>editMode(e.target.value as 'create'|'replace')}>
     <option value="create">{tr('Создать новый файл','Create new file')}</option><option value="replace">{tr('Изменить существующий файл','Update an existing file')}</option>
    </select></label>
    <label className="advanced-field">{tr('Файл .md / .txt','File .md / .txt')}<input maxLength={160} disabled={!!busy} value={path} onChange={e=>editPath(e.target.value)} placeholder="reports/analysis.md"/></label>
    {mode==='replace'&&<><button className="secondary-button" disabled={!!busy||!validPath(path)}
      onClick={()=>void readExisting()}>{tr('Открыть текущий файл','Open current file')}</button>
      {previous&&previous.path===path&&<p>{tr('Текущая версия прочитана. Она будет сверена перед записью.','The current file version was read and will be checked again before writing.')}</p>}
      {conflictingFile&&conflictingFile.path===path&&<div role="alert" className="advanced-notice">
       <p>{tr('Исходный файл изменился. Сверьте его с черновиком, прежде чем выбрать новую основу для изменения.',
        'The original file has changed. Compare it with your draft before choosing a new version to edit.')}</p>
       <details><summary>{tr('Показать новую версию файла','Show the current file version')}</summary>
        <pre className="document-content">{conflictingFile.text}</pre></details>
       <button type="button" className="secondary-button" disabled={!!busy}
        onClick={()=>{
         if(!conflictingFile||conflictingFile.path!==path||mode!=='replace')return;
         if(!window.confirm(tr(
          'Использовать прочитанную новую версию как основу? Ваш черновик сохранится. Запись файла не выполняется.',
          'Use the current file version as the new base? Your draft is preserved. No file write will occur.'
         )))return;
         setPrevious(conflictingFile);setExpectedDigest(conflictingFile.sha256);
         setConflictingFile(null);setEditorConsent(null);
         setReviewPlan(null);setPlanConfirmed(false);
         setNotice(tr('Основа обновлена. Проверьте черновик и отдельно разрешите подготовку записи.',
          'Base version updated. Review your draft and separately approve preparing the write.'));
        }}>{tr('Продолжить с новой версией','Use current version as base')}</button>
      </div>}
      {previous&&<details><summary>{tr('Исходный текст','Original text')}</summary><pre className="document-content">{previous.text}</pre></details>}
    </>}
    <label className="advanced-field document-draft-text">{tr('Редактируемый текст результата','Editable document text')}<textarea rows={13} maxLength={MAX_BYTES} value={draft} onChange={e=>{
      setEditorConsent(null);setDraft(e.target.value);
     }} disabled={!!busy||(mode==='replace'&&!previous)}/></label>
    <p>{utf8Bytes(draft)} / {MAX_BYTES} {tr('байт','bytes')} · {tr('Файл пока не изменён','No file has been changed yet')}</p>
    <label><input type="checkbox" checked={editorConfirmed} disabled={!!busy||!editorForTask}
      onChange={e=>setEditorConsent(e.target.checked?currentConsentKey:null)}/>
     {tr('Я проверил этот текст, путь и режим. Разрешаю только подготовку кандидата, без записи файла.',
       'I reviewed this text, path and mode. I authorize candidate preparation only, not a file write.')}</label>
    <div className="advanced-actions"><button className="primary-button" disabled={!!busy||!verified||!mutationReady||!editorLoaded||!validPath(path)||!draft.trim()||utf8Bytes(draft)>MAX_BYTES||!editorConfirmed||(mode==='replace'&&!previous)}
      onClick={()=>void stageDraft()}>{tr('Подготовить запись','Prepare file write')}</button>
     <button className="secondary-button" disabled={!!busy} onClick={()=>{
      if(!window.confirm(tr('Удалить сохранённый черновик? Файл останется без изменений.',
       'Discard the saved draft? The file will remain unchanged.')))return;
      void guarded(tr('Удаление черновика','Discarding draft'),async()=>{
       editorEpoch.current++;
       await persistEditor({taskId,value:emptyEditor});
       setDraftOpen(false);setDraft('');setPrevious(null);setConflictingFile(null);setExpectedDigest(null);setEditorConsent(null);
      });
     }}>{tr('Отказаться от черновика','Discard draft')}</button>
     <button className="secondary-button" disabled={!!busy||!editorLoaded} onClick={()=>{
      editorEpoch.current++;setEditorSaving(true);
      void persistEditor({taskId,value:editorValue}).then(()=>setEditorError(''))
       .catch(e=>setEditorError(message(e))).finally(()=>setEditorSaving(false));
     }}>{tr('Сохранить черновик','Save draft')}</button>
     <button className="secondary-button" onClick={onOpenConnections}>{tr('Настроить папку Personal Files','Configure Personal Files')}</button>
    </div>
   </div>}
  </>}
  {isWriteCandidate&&<div className="advanced-form"><h3>{tr('3. Решение человека по кандидату записи','3. Human review of write candidate')}</h3>
   <p>{tr('Проверьте предложенный текст и место сохранения. Файл изменится только после отдельного разрешения и вашего действия «Выполнить запись».','Review the proposed text and destination. The file changes only after a separate approval and your explicit Write action.')}</p>
   {(task.action_candidates||[]).filter(c=>c.operation==='files.write_text').map(c=>{
    const id=str(c.candidate_id)||str(c.ref_id),a=record(c.arguments),accepted=task.accepted_action_candidate_ids?.includes(id)===true;
    return <div className="owner-row" key={id}><strong>{str(a.mode)==='replace'?tr('Обновить файл','Update file'):tr('Создать файл','Create file')} · {str(a.path)}</strong>
     <small>{tr('Личная папка','Personal files')} · {typeof a.text==='string'?utf8Bytes(a.text):0} {tr('байт','bytes')}</small>
     {a.mode==='replace'&&<small>{tr('Изменение только при совпадении проверенной версии.','Update only if the verified file version still matches.')}</small>}
     <details><summary>{tr('Полный предложенный текст','Full proposed text')}</summary><pre className="document-content">{str(a.text)}</pre></details>
     {task.status!=='closed'&&task.status!=='rejected'&&<button disabled={!!busy||!verified} onClick={()=>onReviewCandidate(id)}>{tr('Проверить и принять именно этот кандидат','Review this exact candidate')}</button>}
     {task.status==='closed'&&<p>{accepted?tr('Кандидат принят человеком; можно подготовить план.','Candidate accepted; prepare the plan.'):tr('Кандидат не включён в принятое решение.','Candidate was not accepted for execution.')}</p>}
     {accepted&&task.status==='closed'&&<button disabled={!!busy||!mutationReady} onClick={()=>void prepare(id)}>{tr('Подготовить запись файла','Prepare file write')}</button>}
    </div>;
   })}
  </div>}
  {(isWriteCandidate||plans.length>0)&&<div className="advanced-form"><h3>{tr('Планы, разрешения и исполнение','Plans, approvals and execution')}</h3>
   {!ready&&<p>{loading?tr('Чтение сохранённых состояний…','Loading durable state…'):tr('Не удалось проверить актуальное состояние. Обновите сведения перед действием.','Current state could not be checked. Refresh before acting.')}</p>}
   {ready&&plans.length===0&&<p>{tr('Подготовленных планов записи для этой задачи нет.','No prepared file write plans for this task.')}</p>}
   {(ready?plans:[]).map(p=>{
    const id=str(p.plan_id),state=str(readPlanState(states,id).state),receiptId=str(readPlanState(states,id).receipt_id);
    const approved=approvals.find(a=>planApprovalId(a)===id&&activeApproval(a)
     &&a.binding_valid===true&&record(a.plan_ref).kind==='tool_execution_plan'
     &&record(a.plan_ref).digest_sha256===p.plan_digest);
    const denied=approvals.some(a=>planApprovalId(a)===id&&(a.decision==='reject'||a.state==='REJECTED'));
    const expired=nowExpired(p.expires_at),valid=writtenPlan(p),shown=reviewPlan?.id===id;
    return <div className="owner-row" key={id}><strong>{str(record(p.arguments).mode)==='replace'?tr('Обновить файл','Update file'):tr('Создать файл','Create file')} · {str(p.target)}</strong>
     <span>{state==='NOT_STARTED'?tr('Ожидает решения или исполнения','Awaiting approval or execution')
 :state==='OUTCOME_UNKNOWN'?tr('Нужна проверка после прерывания','Recovery check required')
 :state==='SUCCEEDED'?tr('Выполнение отмечено в квитанции; проверьте файл','Execution acknowledged; verify the file')
 :state==='ATTEMPTED'?tr('Попытка зафиксирована; проверьте результат','Attempt recorded; check the outcome')
 :tr('Состояние требует проверки','Check current state')}
 {expired?' · '+tr('срок действия завершён','expired'):''}</span>
     <small>{tr('План подготовлен:','Plan prepared:')} {str(p.prepared_at)}</small>
     {!valid&&<p role="alert" className="advanced-error">{tr('Параметры плана не соответствуют разрешённой записи Personal Files. Действия запрещены.','Plan does not match an allowed Personal Files write. Actions denied.')}</p>}
     {valid&&<details><summary>{tr('Полный текст и параметры утверждаемой записи','Exact text and parameters of the proposed write')}</summary>
      <p>Personal Files / {str(record(p.arguments).path)} · {utf8Bytes(str(record(p.arguments).text))} B</p>
      <pre className="document-content">{str(record(p.arguments).text)}</pre>
      {record(p.arguments).mode==='replace'&&<small>Expected SHA-256: {str(record(p.arguments).expected_sha256)}</small>}
     </details>}
     {state==='NOT_STARTED'&&!expired&&valid&&ready&&!denied&&!approved&&<>
      <button disabled={!!busy||!mutationReady} onClick={()=>void inspectPlan(p)}>{tr('Проверить текущий файл перед решением','Inspect before approval')}</button>
      {shown&&<div className="advanced-form">
       <p role="status">{tr('Вы подтверждаете только показанный план. Разрешение не выполняет запись файла.',
         'You are approving only this exact plan. Approval does not execute a file write.')}</p>
       <strong>{str(record(p.arguments).mode)==='replace'?tr('Заменить существующий файл','Replace existing file'):
        tr('Создать новый файл','Create a new file')} · Personal Files / {str(record(p.arguments).path)}</strong>
       <p>{tr('Полный текст для записи, байт: ','Complete text to write, bytes: ')}
        {utf8Bytes(str(record(p.arguments).text))}</p>
       <pre className="document-content">{str(record(p.arguments).text)}</pre>
       {record(p.arguments).mode==='replace'&&<p>{tr('Ожидаемый SHA-256 исходного файла:','Expected source file SHA-256:')}
        {' '+str(record(p.arguments).expected_sha256)}</p>}
       {reviewPlan.current?<><p>{tr('Проверена актуальная версия файла. Сравните её с полным текстом записи выше.',
        'The existing file was read. Compare it with the full proposed text above.')}</p>
        <pre className="document-content">{reviewPlan.current.text}</pre></>:
        <p>{tr('Новый файл будет создан только по свободному адресу. Существующий файл не перезаписывается.',
          'A new file will be created only if its path is unused. Existing files are not overwritten.')}</p>}
       <label><input type="checkbox" checked={planConfirmed} onChange={e=>setPlanConfirmed(e.target.checked)}/>{tr('Я сравнил путь, режим и полный текст и разрешаю именно этот план.','I compared the path, mode and full text and approve this exact plan.')}</label>
       <div className="advanced-actions"><button disabled={!!busy||!mutationReady||!planConfirmed} onClick={()=>void decidePlan(p,'approve')}>{tr('Разрешить план','Approve plan')}</button>
       <button disabled={!!busy} onClick={()=>{setReviewPlan(null);setPlanConfirmed(false)}}>{tr('Отмена','Cancel')}</button></div>
      </div>}
      <button disabled={!!busy||!mutationReady} onClick={()=>void decidePlan(p,'reject')}>{tr('Отклонить план','Reject plan')}</button>
     </>}
     {approved&&<p>{tr('Ваше разрешение сохранено. Для записи требуется отдельное действие.','Your approval is saved. Writing requires a separate action.')}</p>}
     {approved&&state==='NOT_STARTED'&&ready&&valid&&!expired&&!attempted.current.has(id)&&
      <button className="primary-button" disabled={!!busy||!mutationReady} onClick={()=>void execute(p,str(approved.approval_id))}>{tr('Выполнить одобренную запись один раз','Execute approved write once')}</button>}
     {attempted.current.has(id)&&<p>{tr('Повтор отключён после попытки. Сверьте квитанцию.','Retries disabled after an attempt. Check the receipt.')}</p>}
     {state==='OUTCOME_UNKNOWN'&&<><p role="alert">{tr('Исход неизвестен. Запись нельзя повторять до восстановления.','Outcome unknown. No retry before reconciliation.')}</p>
      <button disabled={!!busy||!mutationReady} onClick={()=>void interrupted(id)}>{tr('Считать прерванное действие (без записи)','Read interrupted action (no write)')}</button></>}
     {receiptId&&<button disabled={!!busy||readBusy} onClick={()=>void readSaved(receiptId)}>{tr('Проверить сохранённый документ по квитанции','Verify saved document by receipt')}</button>}
     <details><summary>{tr('Технические сведения','Technical details')}</summary><OwnerDetails value={{plan:p,execution_state:readPlanState(states,id)}}/></details>
    </div>;
   })}
  </div>}
  {(historyReceipts.length>0||relatedCases.length>0)&&<details className="advanced-form document-history"
   open={journey.status==='OUTCOME_UNKNOWN'}>
   <summary>{tr('История записи и восстановление','Write history and recovery')} ({historyReceipts.length+relatedCases.length})</summary>
   {historyReceipts.map(r=><div className="owner-row" key={str(r.receipt_id)}>
    <strong>{r.status==='SUCCEEDED'&&r.external_effect_state==='ACKNOWLEDGED'?tr('Есть квитанция записи; сверьте текущий файл','Write receipt recorded; verify current file'):tr('Проверьте исход записи','Check write outcome')}</strong><span>{tr('Сохранённая запись действия','Saved action record')}</span>
    {r.status==='SUCCEEDED'&&r.external_effect_state==='ACKNOWLEDGED'&&
     <button disabled={readBusy} onClick={()=>void readSaved(str(r.receipt_id))}>{tr('Открыть утверждённую версию файла','Open approved file version')}</button>}
   </div>)}
   {relatedCases.map(c=><div className="owner-row" key={str(c.case_id)}>
    <strong>{tr('Нужно сверить предыдущее действие','Previous action needs reconciliation')}</strong><span>{tr('Повтор записи до проверки запрещён.','Do not retry the write before checking.')}</span><OwnerDetails value={c}/>
    <button onClick={()=>onOpenRecovery(str(c.case_id))}>{tr('Сверить результат без повторной записи','Reconcile without retrying write')}</button>
   </div>)}
  </details>}

 </section>;
}
