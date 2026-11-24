import {routeAllows,type AdminRouteId} from './admin-navigation';
import React,{useEffect,useRef,useState} from 'react';
import type {ManagerOriginalSelection} from './manager-original-selection';
import {managerOriginalSelectionMatches} from './manager-owner-context.mjs';
import {readOriginalResultReview,readCompleteOriginalResult,
 validateOriginalSignedTaskReadback,
 isDefiniteUndispatchedD3Failure,
 readOriginalApplicationTarget} from '../runtime/cen03-d3-owner.mjs';

// D3 UI is deliberately limited to the ORIGINAL recipient and signed D1 Host.
// It cannot issue a task, sign a grant, interpret an ACCEPT as Apply, or
// automatically repeat a decision whose native acknowledgment was lost.
type Exec=(operation:string,input?:Record<string,unknown>)=>Promise<any>;
type Run=(success:string,work:()=>Promise<void|boolean>)=>Promise<void>;
type SignedTask={taskId:string;taskRevisionId:string;packageSha256:string;summary:string;deliveryState:'NOT_CONFIRMED'};
type Owner={snapshot:{organizationId:string;workspaceId:string;actorId:string;
  contextId:string;contextEpoch:number;d3ApplyAvailable:boolean;
  d3InspectAvailable?:boolean;
  d3TaskIssueAvailable?:boolean;d3ApplyRecoverAvailable?:boolean;
  tasks?:SignedTask[];totalTasks?:number}};
type AssignmentDraft={id:string;title:string;assigneeId:string;editNumber:number;
 description:string;criteria:string;dueDate:string;
 atlasRef:{projectId:string;revision:string;workId?:string}|null};
type AgeStatus={operation:'AGE_STATUS';available:boolean;recipient:string|null;
  toolchain:{ready:boolean;reason?:string};provider:string;admitted:false};
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const opPattern=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const age1=/^age1[023456789acdefghjklmnpqrstuvwxyz]{58}$/;
function requireAgeStatus(value:any):AgeStatus{
 if(value?.operation!=='AGE_STATUS'||value.admitted!==false||
    typeof value.available!=='boolean'||
    typeof value.toolchain?.ready!=='boolean'||
    (value.available?!age1.test(value.recipient):value.recipient!=null))
   throw Error('CEN_D3_AGE_STATUS_INVALID');
 return value as AgeStatus;
}
const same=(a:unknown,b:unknown)=>a===b;
const label=(entry:any)=>String(entry?.id||entry?.kind||'Ревизия');

export default function CorporateD3Panel({owner,execute,run,busy,invoke,assignmentDrafts,organizationName,dispatchedApplications,taskAttempts,decisionAttempts,managerOriginal=null,route='results',onNavigate}:{
 route?:AdminRouteId;
 onNavigate?:(route:AdminRouteId)=>void;
 owner:Owner;execute:Exec;run:Run;busy:boolean;organizationName:string;
 dispatchedApplications:React.RefObject<Map<string,string[]>>;
 taskAttempts:React.RefObject<Map<string,{taskId:string;attempted:boolean}>>;
 decisionAttempts:React.RefObject<Map<string,{operationId:string;decision:'ACCEPT'|'REJECT'}>>;
 invoke:(command:string,args?:Record<string,unknown>)=>Promise<any>;
 assignmentDrafts:AssignmentDraft[];
 managerOriginal?:ManagerOriginalSelection|null;
 }){
 const session=owner.snapshot;
 const exactFocus=managerOriginalSelectionMatches(managerOriginal,session)?managerOriginal:null;
 const taskAttemptKey=JSON.stringify([
   session.organizationId,session.workspaceId,session.actorId]);
 const [hash,setHash]=useState('');
 const [taskText,setTaskText]=useState('');
 const [draftId,setDraftId]=useState('');
 const [draftSnapshot,setDraftSnapshot]=useState('');
 const [taskId,setTaskId]=useState(()=>exactFocus?.kind==='signed-task'?exactFocus.id:'');
 const [taskOperationId,setTaskOperationId]=useState(
   ()=>taskAttempts.current.get(taskAttemptKey)?.taskId??'');
 const [taskIdSaved,setTaskIdSaved]=useState(false);
 const [taskAttempted,setTaskAttempted]=useState(
   ()=>taskAttempts.current.get(taskAttemptKey)?.attempted??false);
 const [taskReadback,setTaskReadback]=useState<any>(null);
 const [preview,setPreview]=useState<any>(null);
 const [reviewedResult,setReviewedResult]=useState<any>(null);
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
 const [applySelection,setApplySelection]=useState<{acceptanceId:string;revisionIds:string[]}|null>(null);
 const [kernelRecovery,setKernelRecovery]=useState<any>(null);
 const [recoverPrevious,setRecoverPrevious]=useState(false);
 // Only a definite refusal before the original Kernel write can unlock a
 // new separate Human APPLY after the manager repairs the SAME Workspace.
 const [workspacePreflight,setWorkspacePreflight]=useState<
   'missing'|'deleted'|'read_only'|null>(null);
 // Prevent a lost Apply acknowledgment from becoming a second Apply when
 // the manager switches packages and returns during the same signed session.
 // Kept by CorporatePanel across signed context-epoch remounts. Never
 // infer previous Kernel state or issue another Apply from this local guard.
 const [lastReceiveState,setLastReceiveState]=useState<string|null>(null);
 const [orgAge,setOrgAge]=useState<AgeStatus|null>(null);
 const [ageUnavailable,setAgeUnavailable]=useState('');
 const [inbox,setInbox]=useState<{total:number;truncated:boolean;
   items:{packageSha256:string;status:string;acceptanceId:string|null;
     operationId:string|null}[]} | null>(null);
 const rememberTaskAttempt=(taskId:string,attempted:boolean)=>{
   if(!taskId)taskAttempts.current.delete(taskAttemptKey);
   else taskAttempts.current.set(taskAttemptKey,{taskId,attempted});
 };
 const attemptKey=(acceptanceId:string)=>JSON.stringify([
   session.organizationId,session.workspaceId,session.actorId,acceptanceId]);
 const decisionKey=(packageSha256:string)=>JSON.stringify([
   session.organizationId,session.workspaceId,session.actorId,packageSha256]);
 const sessionKey=JSON.stringify([session.organizationId,session.workspaceId,
   session.actorId,session.contextId,session.contextEpoch]);
 const previous=useRef(sessionKey),previousTaskIdentity=useRef(taskAttemptKey);
 const ageStatusRead=async()=>requireAgeStatus(await invoke('center_corporate_age_status',{
   organizationId:session.organizationId
 }));
 useEffect(()=>{
   let current=true;setOrgAge(null);setAgeUnavailable('');
   void ageStatusRead().then(value=>{if(current)setOrgAge(value)}).catch(e=>{
     if(current)setAgeUnavailable(String(e));
   });
   return ()=>{current=false};
 },[sessionKey,invoke]);
 const createOrgAge=()=>run('Ключ age1 этой организации создан и защищён Windows DPAPI.',async()=>{
   const result=await invoke('center_corporate_age_create_recipient',{
     organizationId:session.organizationId});
   if(result?.operation!=='AGE_RECIPIENT_CREATED'||result.admitted!==false||
      !age1.test(result.recipient)||result.available!==true)
     throw Error('CEN_D3_AGE_CREATION_UNCONFIRMED');
   const latest=await ageStatusRead();
   if(!latest.available||latest.recipient!==result.recipient)
     throw Error('CEN_D3_AGE_CREATION_READBACK_UNKNOWN');
   setOrgAge(latest);setAgeUnavailable('');
 });
 const reset=()=>{
   setPreview(null);setReviewedResult(null);
   setConfirmed(false);setRejectReason('');setOperationId('');
   setPreparedId('');setIdSaved(false);
   setDecisionAttempted(false);setDecisionType(null);setReceipt(null);
   setSelectedRevisions([]);setApplication(null);setApplyConsent(false);
   setApplyAttempted(false);setKernelResult(null);
   setApplySelection(null);setKernelRecovery(null);setRecoverPrevious(false);
   setWorkspacePreflight(null);
 };
 useEffect(()=>{
   if(previous.current!==sessionKey){
   previous.current=sessionKey;
   setHash('');setInbox(null);setTaskId('');
   // A signed epoch change after Task creation is not a different actor.
   // Recover its original ID, but clear it for any different signed scope.
   if(previousTaskIdentity.current!==taskAttemptKey){
     previousTaskIdentity.current=taskAttemptKey;
     const selected=taskAttempts.current.get(taskAttemptKey);
     setTaskOperationId(selected?.taskId??'');
     setTaskAttempted(selected?.attempted??false);
     setTaskIdSaved(false);
   }
   setTaskText('');setTaskReadback(null);
   setLastReceiveState(null);setDraftId('');setDraftSnapshot('');reset();
 }
 },[sessionKey]);
 const choose=(value:string)=>{
   setHash(value);setLastReceiveState(null);reset();
   // A remounted panel restores the ID of a previously dispatched decision,
   // rather than accidentally allowing a second ACCEPT/REJECT for this .iwxa.
   const pending=decisionAttempts.current.get(decisionKey(value));
   if(pending){
     setOperationId(pending.operationId);
     setDecisionAttempted(true);setDecisionType(pending.decision);
   }
 };
 const signedTasks=Array.isArray(session.tasks)?session.tasks.filter(t=>
   opPattern.test(t.taskId)&&hex(t.taskRevisionId)&&hex(t.packageSha256)):[];
 const selectedTask=signedTasks.find(t=>t.taskId===taskId)??signedTasks.at(-1);
 const chosenDraft=assignmentDrafts.find(a=>a.id===draftId);
 const draftAssigneeUnbound=!!chosenDraft?.assigneeId;
 const draftStale=!!draftId&&(
   !chosenDraft||JSON.stringify(chosenDraft)!==draftSnapshot);
 const createSignedTask=()=>run('Подписанная Task сохранена. Передача получателю ещё не подтверждена.',async()=>{
   if(session.d3TaskIssueAvailable!==true||!taskText.trim()||
     taskText.length>10000)throw Error('CEN_D3_SIGNED_TASK_TEXT_REQUIRED');
   if(draftStale)throw Error('CEN_D3_DRAFT_CHANGED_BEFORE_SIGNING');
   if(draftAssigneeUnbound)throw Error('CEN_D3_DRAFT_ASSIGNEE_NOT_SIGNED');
   if(!/^task:[A-Za-z0-9-]{1,100}$/.test(taskOperationId)||
     !taskIdSaved||taskAttempted||
     signedTasks.some(t=>t.taskId===taskOperationId))
     throw Error('CEN_D3_SIGNED_TASK_OPERATION_REQUIRED');
   // A draft Atlas link is not automatically a valid current source. Before
   // original T3 signs it, reread the installed Atlas Desktop owner in its
   // existing fixed-path READ_ONLY mode, never a cached/selected file copy.
   const source=assignmentDrafts.find(a=>a.id===draftId)?.atlasRef;
   if(source){
     // Original corporate Task requires no Atlas modules until this exact
     // draft explicitly carries a native project/work reference.
     const [{createNativeAtlasPort},{atlasLinkReadback,atlasWorkReadback}]=
       await Promise.all([
         import('./atlas-native.mjs'),
         import('./atlas-integration.mjs')
       ]).catch(()=>{throw Error('CEN_D3_ATLAS_OWNER_NOT_AVAILABLE');});
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
   // The operation ID is saved before the original signer may write. Even if
   // this call loses its reply, the same ID can be queried without re-signing.
   const immutableId=taskOperationId;
   rememberTaskAttempt(immutableId,true);
   setTaskAttempted(true);setTaskReadback(null);
   let result:any;
   try{
     result=await execute('d3CreateTask',{
       task:taskText.trim(),taskId:immutableId});
   }catch(error){
     // The native owner was never dispatched only for these exact public
     // Rust preflight errors. Other errors may follow a successful signing:
     // retain the saved Task ID and require original read-only recovery.
     if(isDefiniteUndispatchedD3Failure(error,'d3CreateTask')){
       rememberTaskAttempt(immutableId,false);
       setTaskAttempted(false);setTaskReadback(null);
     }
     throw error;
   }
   if(result?.schema!=='IWXA_T3_ORIGINAL_SIGNED_TASK/1'||
     result.status!=='SIGNED_TASK_CREATED_NOT_DELIVERED'||
     result.taskId!==immutableId||!hex(result.taskRevisionId)||
     !hex(result.packageSha256)||result.recipientId!==session.actorId)
     throw Error('CEN_D3_ORIGINAL_TASK_WRITE_READBACK_UNKNOWN');
   setTaskText('');setDraftId('');setDraftSnapshot('');
   setTaskReadback({schema:'IWXA_T3_ORIGINAL_TASK_READBACK/1',
     found:true,taskId:immutableId,taskRevisionId:result.taskRevisionId,
     packageSha256:result.packageSha256,recipientId:result.recipientId,
     status:'SIGNED_TASK_PERSISTED_NOT_DELIVERED'});
 });
 const recoverTaskById=(knownId:string,observed:SignedTask|null=null)=>run(
   'Исходная подписанная Task перечитана без нового выпуска.',async()=>{
   if(!/^task:[A-Za-z0-9-]{1,100}$/.test(knownId))
     throw Error('CEN_D3_ORIGINAL_TASK_OPERATION_ID_REQUIRED');
   // The original recipient verifies stored signed .iwxa bytes and exact
   // revision. The UI never re-signs a Task to discover a lost ACK.
   const result=await execute('d3TaskReadback',{taskId:knownId});
   const verified=validateOriginalSignedTaskReadback(result,knownId,
     session.actorId,observed);
   if(observed&&!verified.found)
     throw Error('CEN_D3_ORIGINAL_TASK_INVENTORY_READBACK_HOLD');
   rememberTaskAttempt(knownId,taskAttempted||verified.found);
   setTaskOperationId(knownId);setTaskIdSaved(false);
   setTaskAttempted(taskAttempted||verified.found);
   setTaskReadback(verified);
 });
 const recoverTask=()=>recoverTaskById(taskOperationId);
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
 const reviewFullyDisplayed=reviewedResult!==null&&
   reviewedResult.hasMore===false&&reviewedResult.packageSha256===hash&&
   reviewedResult.previewDigest===preview?.previewDigest&&
   reviewedResult.nextOffset===reviewedResult.resultLength;
 const originalDecisionRecorded=
   ['ACCEPTED','REJECTED'].includes(selectedInboxItem?.status??'')||
   ['ACCEPTED','REJECTED'].includes(lastReceiveState??'')||
   // The read-only original receipt is authoritative after a full React
   // unmount/cold UI reopen. Do not offer another Human ACCEPT or REJECT.
   (receipt?.found===true&&
     ['ACCEPTED','REJECTED'].includes(receipt.receipt?.acceptanceState)&&
     receipt.receipt?.operationId===operationId&&
     receipt.receipt?.packageSha256===hash)||
   decisionAttempts.current.has(decisionKey(hash));
 const refreshInbox=(requestedPackage:string|null=null)=>run('Полученные пакеты перечитаны из оригинального Reconciliation.',async()=>{
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
   if(requestedPackage!==null){
     if(!exactFocus||exactFocus.kind!=='signed-result-package'||exactFocus.id!==requestedPackage)
       throw Error('CEN_D3_MANAGER_SOURCE_CONTEXT_CHANGED');
     const original=result.items.find((x:any)=>x.packageSha256===requestedPackage);
     if(!original){setInbox(result);throw Error('CEN_D3_MANAGER_SOURCE_NOT_IN_INBOX');}
     choose(original.packageSha256);
     if(original.operationId)setOperationId(original.operationId);
   }
   setInbox(result);
 });
 const revisions=Array.isArray(preview?.entries)?
   [...new Set(preview.entries.map((x:any)=>x?.revisionId).filter(hex))].slice(0,32) as string[]:[];
 const accepted=receipt?.found===true&&
   receipt.receipt?.acceptanceState==='ACCEPTED'&&
   receipt.receipt.packageSha256===hash&&
   receipt.receipt.operationId===operationId&&
   receipt.kernelApplication==='NOT_ATTESTED_BY_RECONCILIATION_RECEIPT';
 const applyPreviouslySent=accepted&&
   dispatchedApplications.current.has(attemptKey(receipt.receipt.acceptanceId as string));
 const receiveResult=(encrypted:boolean)=>run(
   'Оригинальный подписанный Result получен в Reconciliation. ACCEPT и Apply остаются отдельными действиями.',
   async()=>{
     const result=await execute(encrypted?'d3ReceiveAge':'d3Receive');
     if(result?.status==='CANCELLED')return false;
     if(!['NOT_ACCEPTED','ACCEPTED','REJECTED'].includes(result.acceptanceState)||
        !hex(result.preview?.packageSha256)||
        !hex(result.transportReceipt?.packageSha256)||
        result.transportReceipt.packageSha256!==result.preview.packageSha256)
       throw Error('CEN_D3_RECEIVE_READBACK_UNKNOWN');
     if(encrypted&&(result.encryptedTransport?.status!=='DECRYPTED_THEN_RECEIVED_BY_ORIGINAL_T3'||
       !hex(result.encryptedTransport.ciphertextSha256)||
       result.encryptedTransport.sourceSha256!==result.preview.packageSha256))
       throw Error('CEN_D3_AGE_ADMISSION_READBACK_UNKNOWN');
     const inspection=readOriginalResultReview(result.preview,
       session.organizationId,session.workspaceId);
     choose(result.preview.packageSha256);
     setLastReceiveState(result.acceptanceState);
     setPreview(result.preview);setReviewedResult(inspection);
   });
 const review=()=>run('Оригинальный Reconciliation проверил пакет без принятия.',async()=>{
   const result=await execute('d3Preview',{packageSha256:hash});
   if(result.schema!=='IWXA_T3_RECONCILIATION_PREVIEW/1'||
     result.packageSha256!==hash||!hex(result.previewDigest))
     throw Error('CEN_D3_ORIGINAL_PREVIEW_INVALID');
   const inspection=readOriginalResultReview(result,session.organizationId,
     session.workspaceId);
   setPreview(result);setReviewedResult(inspection);
   setConfirmed(false);setApplication(null);
   setPreparedId('');setIdSaved(false);
 });
 const showCompleteReview=()=>run('Полный оригинальный подписанный Result показан для Human Review.',async()=>{
   const first=reviewedResult,source=preview;
   if(!first?.hasMore||!source||!hex(hash)||
     first.packageSha256!==hash||first.previewDigest!==source.previewDigest)
     throw Error('CEN_D3_SIGNED_RESULT_REVIEW_NOT_AVAILABLE');
   // Reading original pages never approves ACCEPT. Consent is a separate
   // explicit manager action after the complete Result is displayed.
   setConfirmed(false);
   await readCompleteOriginalResult(first,source,session.organizationId,
     session.workspaceId,
     (offset:number)=>execute('d3Preview',{packageSha256:hash,resultOffset:offset}),
     (page:any)=>setReviewedResult(page));
 });
 const recover=()=>run('Оригинальная квитанция перечитана. Это не подтверждение записи в Kernel.',async()=>{
   const id=operationId.trim();
   if(!opPattern.test(id)||!hex(hash))throw Error('CEN_D3_RECEIPT_QUERY_REQUIRED');
   const result=await execute('d3Receipt',{operationId:id,packageSha256:hash});
   if(result?.kernelApplication!=='NOT_ATTESTED_BY_RECONCILIATION_RECEIPT'||
     typeof result.found!=='boolean'||result.found&&(
       result.receipt?.operationId!==id||
       result.receipt?.packageSha256!==hash||
       result.receipt?.decisionBy!==session.actorId||
       !['ACCEPTED','REJECTED'].includes(result.receipt?.acceptanceState)||
       result.receipt?.schema!==(result.receipt.acceptanceState==='ACCEPTED'
         ?'IWXA_T3_ACCEPTANCE_RECEIPT/1':'IWXA_T3_REJECTION_RECEIPT/1')))
     throw Error('CEN_D3_RECEIPT_INVALID');
   if(result.found){
     const decision=result.receipt.acceptanceState==='ACCEPTED'?'ACCEPT':'REJECT';
     const pending=decisionAttempts.current.get(decisionKey(hash));
     if(pending&&pending.operationId!==id)
       throw Error('CEN_D3_ORIGINAL_DECISION_RECEIPT_CONFLICT');
     decisionAttempts.current.set(decisionKey(hash),{operationId:id,decision});
     setDecisionAttempted(true);setDecisionType(decision);
   }
   setReceipt(result);setApplication(null);
   if(!result.found)setSelectedRevisions([]);
 });
 const decide=(kind:'ACCEPT'|'REJECT')=>run(
   'Решение записано исходным Reconciliation. Для проверки используйте отдельное чтение квитанции.',
   async()=>{
     if(decisionAttempted||originalDecisionRecorded||!confirmed||!preview||!hex(hash)||
       !idSaved||!opPattern.test(preparedId)||preparedId!==operationId||
       (kind==='ACCEPT'&&
         (preview.allowedAction!=='EXPLICIT_ACCEPT_ONLY'||!reviewFullyDisplayed))||
       (kind==='REJECT'&&!rejectReason.trim()))
       throw Error('CEN_D3_EXPLICIT_HUMAN_REVIEW_REQUIRED');
     // The ID was visible and explicitly saved BEFORE dispatch. On a lost
     // acknowledgment, restoring the original receipt never retries the write.
     const id=preparedId;
     decisionAttempts.current.set(decisionKey(hash),{operationId:id,decision:kind});
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
      if(String(e)==='Error: CEN_D3_HUMAN_REVIEW_CANCELLED'||
         String(e)==='CEN_D3_HUMAN_REVIEW_CANCELLED'){
        const pending=decisionAttempts.current.get(decisionKey(hash));
        if(pending?.operationId===id)decisionAttempts.current.delete(decisionKey(hash));
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
   setApplication(null);setApplyConsent(false);setKernelRecovery(null);
 };
 const inspectApplication=()=>run('Оригинальный Reconciliation подтвердил только кандидат на применение.',async()=>{
   if(!accepted||
     (session.d3InspectAvailable!==true&&session.d3ApplyAvailable!==true)||
     !hex(receipt.receipt.acceptanceId))
     throw Error('CEN_D3_ACCEPTED_SOURCE_INVALID');
   const result=await execute('d3InspectAccepted',{
     acceptanceId:receipt.receipt.acceptanceId,revisionIds:selectedRevisions
   });
   if(result?.schema!=='IWXA_T3_APPLICATION_PROJECTION_CANDIDATE/1'||
     result.status!=='CANDIDATE_REQUIRES_INDEPENDENT_HOST_AUTHORIZATION'||
     result.applicationAttempted!==false||result.applicationAuthorized!==false||
     result.externalContextCoreApplied!==false||
     (result.source?.acceptanceId!==undefined&&
       result.source.acceptanceId!==receipt.receipt.acceptanceId)||
     (result.target?.workspaceId!==undefined&&
       result.target.workspaceId!==session.workspaceId)||
     (result.target?.subjectId!==undefined&&
       result.target.subjectId!==session.organizationId)||
     (result.changes!==undefined&&
       (!Array.isArray(result.changes)||result.changes.length!==selectedRevisions.length||
        !result.changes.every((x:any)=>hex(x?.resultRevisionId)&&
          selectedRevisions.includes(x.resultRevisionId)&&
          opPattern.test(x.taskId)&&opPattern.test(x.executorId)&&
          typeof x.resultExcerpt==='string'&&x.resultExcerpt.length<=500&&
          typeof x.resultTruncated==='boolean'))))
     throw Error('CEN_D3_APPLICATION_PREVIEW_INVALID');
   const target=readOriginalApplicationTarget(result.target,
     session.organizationId,session.workspaceId);
   if(result.source?.acceptanceId!==receipt.receipt.acceptanceId)
     throw Error('CEN_D3_APPLICATION_PREVIEW_INVALID');
   setApplication({...result,target});setApplyConsent(false);
 });
 const apply=()=>run('Исходный T3 Kernel вернул квитанцию записи и повторное чтение.',async()=>{
   if(!accepted||!application||!applyConsent||applyAttempted||
      applyPreviouslySent||recoverPrevious)
     throw Error('CEN_D3_SEPARATE_HUMAN_APPLY_REQUIRED');
   const selection={acceptanceId:receipt.receipt.acceptanceId as string,
     revisionIds:[...selectedRevisions],
     target:readOriginalApplicationTarget(application.target,
       session.organizationId,session.workspaceId)};
   if(!hex(selection.acceptanceId)||selection.revisionIds.length===0)
     throw Error('CEN_D3_ACCEPTED_SOURCE_INVALID');
   setWorkspacePreflight(null);
   // Record the exact selection synchronously before sending to the owner.
   // React reset after switching a Result must not erase this no-replay gate.
   dispatchedApplications.current.set(attemptKey(selection.acceptanceId),[...selection.revisionIds]);
   setApplySelection(selection);setApplyAttempted(true);
   setKernelResult(null);setKernelRecovery(null);
   let result:any;
   try{
     result=await execute('d3ApplyAccepted',selection);
   }catch(error){
     // These exact public native preflight codes are returned before the
     // original owner is invoked. Every other failure can be post-dispatch,
     // and must retain the no-replay marker until original recovery.
     if(isDefiniteUndispatchedD3Failure(error,'d3ApplyAccepted')){
       dispatchedApplications.current.delete(attemptKey(selection.acceptanceId));
       setApplySelection(null);setApplyAttempted(false);setApplyConsent(false);
       const raw=error instanceof Error?error.message:
         typeof error==='string'?error:'';
       const code=raw.trim().replace(/^Error:\s*/,'');
       setWorkspacePreflight(
         code==='T3_D3_ORIGINAL_WORKSPACE_PROVISION_REQUIRED'?'missing':
         code==='T3_D3_ORIGINAL_WORKSPACE_DELETED'?'deleted':
         code==='T3_D3_ORIGINAL_WORKSPACE_READ_ONLY'?'read_only':null);
     }
     throw error;
   }
   if(result.kernelWriteReadback!=='CONFIRMED'||!result.originalKernelReadback||
     !result.originalKernelReceipt)
     throw Error('CEN_D3_KERNEL_COMMIT_OUTCOME_UNKNOWN');
   setKernelResult(result);
 });
 const recoverApplied=()=>run('Проверка исходного Kernel завершена без повторного Apply.',async()=>{
   if(session.d3ApplyRecoverAvailable!==true||!accepted)
     throw Error('CEN_D3_APPLY_RECOVERY_NOT_CONNECTED');
   if(!applyAttempted&&!applyPreviouslySent&&!recoverPrevious)
     throw Error('CEN_D3_PREVIOUS_APPLY_REQUIRED_FOR_RECOVERY');
   const acceptanceId=receipt.receipt.acceptanceId as string;
   // A live session reuses the actual previously dispatched selection.
   // After a cold restart the manager must explicitly mark the previous
   // attempt and reselect its original revisions before read-only recovery.
   const saved=dispatchedApplications.current.get(attemptKey(acceptanceId));
   const source=applySelection??(saved?{acceptanceId,revisionIds:[...saved]}:{
     acceptanceId,revisionIds:[...selectedRevisions]
   });
   if(!hex(source.acceptanceId)||source.revisionIds.length===0||
     source.revisionIds.length>32||!source.revisionIds.every(hex))
     throw Error('CEN_D3_ACCEPTED_SOURCE_INVALID');
   dispatchedApplications.current.set(attemptKey(source.acceptanceId),[...source.revisionIds]);
   setApplySelection(source);setApplyAttempted(true);
   // A cold restart has no cached target. Re-read it exclusively from the
   // original ACCEPTED source; this never records another Human APPLY.
   const candidate=await execute('d3InspectAccepted',source);
   if(candidate?.schema!=='IWXA_T3_APPLICATION_PROJECTION_CANDIDATE/1'||
     candidate.status!=='CANDIDATE_REQUIRES_INDEPENDENT_HOST_AUTHORIZATION'||
     candidate.source?.acceptanceId!==source.acceptanceId||
     candidate.applicationAttempted!==false||
     candidate.applicationAuthorized!==false)
     throw Error('CEN_D3_ORIGINAL_APPLICATION_TARGET_CHANGED');
   const target=readOriginalApplicationTarget(candidate.target,
     session.organizationId,session.workspaceId);
   const result=await execute('d3RecoverApplied',{...source,target});
   const confirmed=result?.status==='ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED';
   if((!confirmed&&result?.status!=='OUTCOME_UNKNOWN')||
     !hex(result.effectKey)||result.automaticRetryAllowed!==false||
     result.kernelWriteReadback!==(confirmed?'CONFIRMED':'NOT_CONFIRMED')||
     (confirmed&&(!result.originalKernelReadback?.object||
       !result.originalEventReadback?.event_id)))
     throw Error('CEN_D3_KERNEL_RECOVERY_READBACK_INVALID');
   // Recovery is an inquiry, never consent to repeat Apply. Even an
   // unconfirmed original outcome cannot enable another commit here.
   setKernelRecovery(result);
 });
 return <div className="nested-form" data-testid="cen03-d3-original">
  <h3>Подписанный T3: получение и принятие Result</h3>
  {managerOriginal&&<div className="notice subdued" data-testid="d3-manager-original-link">
    {exactFocus?<>
      <strong>Переход из корпоративного поиска</strong>
      <p>Исходный {exactFocus.kind==='signed-task'?'Task':'пакет Result'}: {exactFocus.id}.
        Подписанный владелец проверит источник заново перед действием.
        Этот переход ничего не подписывает, не принимает и не применяет.</p>
      {exactFocus.kind==='signed-result-package'&&<button className="secondary"
        type="button" data-testid="d3-manager-recheck-package" disabled={busy}
        onClick={()=>{void refreshInbox(exactFocus.id)}}>Перечитать Reconciliation и выбрать точный пакет</button>}
    </>:<p>Контекст подписанного T3 изменился. Ранее найденный источник не выбран.
      Вернитесь к поиску и обновите данные организации.</p>}
  </div>}
  <p className="muted">Подтверждённый субъект: {session.actorId} · Workspace: {session.workspaceId}.
   Оригинальный получатель проверяет подпись и полномочия. Приём не означает ACCEPT;
   ACCEPT не означает запись в Kernel.</p>
  <div className="nested-form" data-testid="d3-signed-task-workflow" hidden={!routeAllows(route,'signed-tasks')}>
   <h3>Подписанные поручения T3</h3>
   <p className="muted">Текущий получатель: {session.actorId}.
    Это локальный участник организации. Выдача другому сотруднику требует
    отдельной регистрации его ключей, а не выбора имени из черновика.</p>
   {session.d3TaskIssueAvailable===true ? <>
    {!!assignmentDrafts.length&&<label>Подготовить текст из сохранённого черновика
     <select data-testid="d3-task-from-draft" disabled={busy||taskAttempted}
      value={draftId}
      onChange={e=>{
       const id=e.target.value;
       setDraftId(id);
       const selected=assignmentDrafts.find(a=>a.id===id);
       setDraftSnapshot(selected?JSON.stringify(selected):'');
       if(selected){
         const atlas=selected.atlasRef;
         const content=[selected.title,selected.description,
           selected.criteria&&'Критерии приёмки: '+selected.criteria,
           selected.dueDate&&'Срок: '+selected.dueDate,
           atlas&&'Ссылка на проект Atlas (из черновика, не доказательство полномочий): '+
             atlas.projectId+' @ '+atlas.revision+
             (atlas.workId?', работа: '+atlas.workId:'')].filter(Boolean).join('\n\n');
         setTaskText(content.slice(0,10000));
       }else{
         // Do not retain a previous employee-assigned draft in manual mode.
         setTaskText('');
       }
      }}>
      <option value="">Выберите черновик (не выдаёт полномочий)</option>
      {assignmentDrafts.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}
     </select>
    </label>}
    {draftAssigneeUnbound&&<p role="status" data-testid="d3-unbound-draft-assignee">
      В черновике выбран сотрудник, но его отдельная подписанная личность T3
      не подключена. Нельзя выдавать поручение локальному руководителю вместо него.
      Для этого черновика сначала требуется организационное подключение сотрудника.
    </p>}
    {draftStale&&<p role="status" data-testid="d3-draft-changed">
      Черновик изменился после выбора. Выберите его повторно перед подписанием.
    </p>}
    <label>Поручение и критерии результата
     <textarea data-testid="d3-task-text" rows={3} maxLength={10000}
      disabled={busy||taskAttempted}
      value={taskText} onChange={e=>setTaskText(e.target.value)}
      placeholder="Что сделать и по каким критериям принять результат"/>
    </label>
    <div className="nested-form" data-testid="d3-signed-task-operation">
     <button className="secondary" type="button" data-testid="d3-task-prepare-id"
      disabled={busy||(taskAttempted&&taskReadback?.found!==true)}
      onClick={()=>{
       const fresh='task:'+crypto.randomUUID();
       rememberTaskAttempt(fresh,false);
       setTaskOperationId(fresh);
       setTaskIdSaved(false);setTaskAttempted(false);setTaskReadback(null);
      }}>Подготовить ID поручения</button>
     <label>Оригинальный ID Task для восстановления
      <input data-testid="d3-task-operation-id" value={taskOperationId}
       maxLength={105} placeholder="task:..." disabled={taskAttempted}
       onChange={e=>{
        if(taskAttempted)return;
        const typed=e.target.value.trim();
        rememberTaskAttempt(typed,false);
        setTaskOperationId(typed);
        setTaskIdSaved(false);setTaskReadback(null);
       }}/>
     </label>
     {!!taskOperationId&&<label>
      <input type="checkbox" checked={taskIdSaved}
       onChange={e=>setTaskIdSaved(e.target.checked)}/>
      Я сохранил этот ID до подписания
     </label>}
     {taskAttempted&&<p role="status" data-testid="d3-task-operation-attempted">
      Операция отправлялась. Не подписывайте Task повторно при потерянном ответе.
      Сначала прочитайте оригинальный результат по этому ID.
     </p>}
     {taskReadback&&<p role="status" data-testid="d3-task-operation-readback">
      {taskReadback.found
       ? 'Оригинальная Task сохранена, SHA-256 '+taskReadback.packageSha256+
         '. Доставка получателю не подтверждена.'
       : 'В исходном реестре Task с указанным ID не обнаружена. Неизвестный исход нельзя автоматически повторять.'}
     </p>}
     <div className="actions">
      <button className="secondary" type="button" data-testid="d3-task-recover"
       disabled={busy||!/^task:[A-Za-z0-9-]{1,100}$/.test(taskOperationId)}
       onClick={recoverTask}>Проверить выпуск без повтора</button>
      <button className="primary" data-testid="d3-create-task"
       disabled={busy||!taskText.trim()||draftAssigneeUnbound||draftStale||
         !taskIdSaved||taskAttempted||
         signedTasks.some(t=>t.taskId===taskOperationId)||
         !/^task:[A-Za-z0-9-]{1,100}$/.test(taskOperationId)}
       onClick={createSignedTask}>Подписать и сохранить Task</button>
     </div>
    </div>
     <button className="secondary" data-testid="d3-export-invitation"
      disabled={busy} onClick={exportInvitation}>
      Сохранить приглашение .iwxa
     </button>
   </> : <div className="nested-form" data-testid="d3-finish-first-use">
    <p className="notice subdued">
     Первоначальный реестр T3 существует, но подписанное приглашение ещё не
     завершено. Продолжение использует те же ключи Windows и прежний реестр.
    </p>
    <button type="button" className="secondary" disabled={busy}
     data-testid="d3-complete-enrollment"
     onClick={()=>run('Подписанное приглашение T3 подтверждено. Теперь можно выпускать Task.',async()=>{
      const result=await invoke('center_corporate_enroll',{
       organizationId:session.organizationId,
       workspaceId:session.workspaceId,
       organizationName
      });
      if(result?.status!=='D3_OWNER_READY'||
         result.snapshot?.organizationId!==session.organizationId||
         result.snapshot?.workspaceId!==session.workspaceId||
         result.snapshot?.d3TaskIssueAvailable!==true)
       throw Error('CEN_D3_FIRST_USE_COMPLETION_UNCONFIRMED');
     })}>Завершить подключение подписанных Task</button>
   </div>}
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
    <div className="actions">
     <button className="secondary" data-testid="d3-saved-task-readback"
      disabled={busy||!selectedTask} onClick={()=>{
       if(selectedTask)recoverTaskById(selectedTask.taskId,selectedTask);
      }}>Проверить сохранённую Task</button>
     <button className="secondary" data-testid="d3-export-task" disabled={busy}
      onClick={exportTask}>Сохранить подписанную Task в .iwxa</button>
    </div>
    <p className="muted">После перезапуска или потерянного ответа выберите
     поручение из исходного списка и нажмите «Проверить сохранённую Task».
     Проверка не создаёт второе поручение.</p>
   </>}
  </div>
  <div className="v8-route-region" hidden={!routeAllows(route,'receive','review','recovery')}>
  <div className="nested-form" data-testid="d3-organization-age-recipient" hidden={route==='recovery'}>
   <h3>Защищённое получение Result</h3>
   <p className="muted">Ключ age1 привязан к выбранной организации. Расшифрование
    само по себе не означает ACCEPT и не изменяет Kernel.</p>
   {orgAge?.available&&<label>Публичный ключ age1 организации
    <input data-testid="d3-org-age1" aria-label="age1 организации" readOnly
     value={orgAge.recipient??''} onFocus={e=>e.currentTarget.select()}/>
   </label>}
   {orgAge&&!orgAge.available&&orgAge.toolchain.ready&&
    <button type="button" className="secondary" data-testid="d3-age-create"
     disabled={busy} onClick={createOrgAge}>Создать ключ age1</button>}
   {orgAge&&!orgAge.toolchain.ready&&
    <p className="muted" data-testid="d3-age-toolchain-missing">
     Проверенные age и age-keygen не установлены: {orgAge.toolchain.reason??'NOT_CONFIGURED'}
    </p>}
   {ageUnavailable&&<p className="muted" data-testid="d3-age-owner-missing">
    Криптографический владелец недоступен: {ageUnavailable}
   </p>}
  </div>
  <div className="actions" hidden={route==='recovery'}>
   <button className="secondary" data-testid="d3-receive" disabled={busy}
    onClick={()=>receiveResult(false)}>Получить .iwxa</button>
   <button className="secondary" data-testid="d3-receive-age"
    disabled={busy||!orgAge?.available||!orgAge.toolchain.ready}
    onClick={()=>receiveResult(true)}>Получить .iwxa.age</button>
   <button className="secondary" data-testid="d3-review" disabled={busy||!hex(hash)}
    onClick={review}>Review</button>
   <button className="secondary" data-testid="d3-inbox-refresh" disabled={busy}
    onClick={()=>{void refreshInbox()}}>Открыть полученные</button>
  </div>
  {inbox&&<div data-testid="d3-original-inbox">
   <p>Оригинальный журнал получателя: {inbox.total} пакетов.
    {inbox.truncated?' Показаны последние 64.':''}</p>
   <label>Полученный результат
    <select data-testid="d3-inbox-select" disabled={busy} value={inbox.items.some(x=>x.packageSha256===hash)?hash:''}
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
   <input data-testid="d3-package-sha" value={hash} maxLength={64} disabled={busy}
    onChange={e=>choose(e.target.value.trim().toLowerCase())}
    placeholder="64 символа SHA-256" />
  </label>
  {lastReceiveState&&lastReceiveState!=='NOT_ACCEPTED'&&
   <p data-testid="d3-already-decided">В исходном журнале найдено решение: {lastReceiveState}.
    Повторный ACCEPT/REJECT не требуется. Откройте исходную квитанцию.</p>}
  </div>
   {preview&&<div data-testid="d3-preview" hidden={!routeAllows(route,'review')}>
   <p>Классификация: {preview.classification??'нет сведений'} ·
    Решение: {preview.allowedAction??'нет сведений'} ·
    Редакции: {revisions.length}</p>
   {reviewedResult?<div className="nested-form" data-testid="d3-original-signed-review">
     <p><strong>Проверенный подписанный Result</strong> ·
      Исполнитель: {reviewedResult.executorId} ·
      Поручение: {reviewedResult.taskId} ·
      Редакция Task: {reviewedResult.taskRevisionId.slice(0,16)}…</p>
     <p><strong>Исходное подписанное поручение и критерии</strong></p>
     <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:200,
       overflow:'auto'}} data-testid="d3-original-assignment-text">{reviewedResult.assignmentText}</pre>
     <p><strong>Ответ исполнителя</strong></p>
     <pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:320,
       overflow:'auto'}} data-testid="d3-original-result-text">{reviewedResult.resultText}</pre>
     {reviewedResult.hasMore&&<div>
       <p className="muted">Показано {reviewedResult.nextOffset} из
        {reviewedResult.resultLength} символов. Для ACCEPT требуется весь результат.</p>
       <button type="button" className="secondary"
        data-testid="d3-review-next" disabled={busy}
        onClick={showCompleteReview}>Показать весь Result</button>
     </div>}
    </div>:
    <p role="status" data-testid="d3-original-review-not-proven">
     Подлинное содержание Result или связь с подписанной Task ещё не подтверждены.
     ACCEPT недоступен. Можно отклонить пакет с указанием причины.
    </p>}
   <label><input type="checkbox" checked={confirmed} disabled={busy}
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
       preview.allowedAction!=='EXPLICIT_ACCEPT_ONLY'||!reviewFullyDisplayed}
     onClick={()=>decide('ACCEPT')}>ACCEPT</button>
    <button className="secondary" data-testid="d3-reject"
     disabled={busy||!confirmed||decisionAttempted||originalDecisionRecorded||!idSaved||
       !preparedId||preparedId!==operationId||!rejectReason.trim()}
     onClick={()=>decide('REJECT')}>REJECT</button>
   </div>
  </div>}
  <div className="nested-form" data-testid="d3-receipt-recovery" hidden={!routeAllows(route,'review','recovery')}>
   <h3>Восстановить решение без повтора</h3>
   <p className="muted">ID фиксируется перед ACCEPT/REJECT. Если связь оборвалась,
    проверяйте исходную квитанцию по ID и SHA-256. Повторный ACCEPT/REJECT запрещён.
    ID можно сохранить отдельно для восстановления после перезапуска.</p>
   <label>ID операции
    <input data-testid="d3-operation-id" value={operationId} maxLength={160}
     disabled={busy||decisionAttempted}
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
   {decisionAttempted&&!receipt&&<p className="notice subdued"
     data-testid="d3-decision-already-sent">
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
  {route==='apply'&&!accepted&&<div className="notice subdued" data-testid="v8-apply-needs-review">
    <p>Для отдельного применения сначала прочитайте исходный Result и подтвердите решение ACCEPT.</p>
    <button type="button" className="secondary" onClick={()=>onNavigate?.('review')}>Перейти к Human Review</button>
  </div>}
  {accepted&&<div className="nested-form" data-testid="d3-apply" hidden={!routeAllows(route,'apply','recovery')}>
   <h3>Отдельное применение в оригинальный Kernel</h3>
   {workspacePreflight&&<p role="status"
     data-testid="d3-apply-workspace-preflight" className="notice subdued">
     {workspacePreflight==='missing'
       ?'Исходная Workspace ещё не создана. Откройте «Workspace T3», создайте выбранную рабочую область, затем вернитесь «К приёмке» и отдельно подтвердите Apply.'
       :workspacePreflight==='deleted'
         ?'Исходная Workspace удалена. Не создавайте другую с новым ID. Восстановите исходную Workspace разрешённым способом и повторите проверку.'
         :'Исходная Workspace доступна только для чтения. Восстановите право записи в этой же Workspace и отдельно подтвердите Apply.'}
   </p>}
   <p className="muted">ACCEPT подтверждён только в Reconciliation.
    Применение требует отдельного Human APPLY и подписанного D1 JIT.
    Неизвестный результат не повторяется автоматически.</p>
   {!session.d3InspectAvailable&&!session.d3ApplyAvailable?
    <p>Исходный подписанный получатель не поддерживает просмотр принятого Result.</p>:<>
    <p>Выберите принятые редакции:</p>
    {revisions.map(id=><label key={id}>
      <input type="checkbox" checked={selectedRevisions.includes(id)}
       disabled={applyAttempted||applyPreviouslySent}
       onChange={e=>toggleRevision(id,e.target.checked)}/>
      {label(preview.entries.find((x:any)=>same(x.revisionId,id)))} · {id.slice(0,16)}
    </label>)}
    <div className="actions">
     <button className="secondary" data-testid="d3-inspect-apply"
      disabled={busy||selectedRevisions.length===0||applyAttempted||applyPreviouslySent}
      onClick={inspectApplication}>Проверить принятый Result</button>
    </div>
    {applyPreviouslySent&&!applyAttempted&&<p role="status"
      data-testid="d3-apply-already-sent">
      Для этого ACCEPT ранее отправлялся Apply. Повторная запись заблокирована.
      Восстановление использует исходный выбор редакций.
    </p>}
    {session.d3ApplyRecoverAvailable===true&&!applyAttempted&&
      !applyPreviouslySent&&<label>
       <input type="checkbox" data-testid="d3-recovery-previous-ack"
        checked={recoverPrevious} onChange={e=>setRecoverPrevious(e.target.checked)}/>
       Я уже отправлял Apply для этого ACCEPT в предыдущем сеансе и
       восстанавливаю исход, а не начинаю новое применение
      </label>}
    {session.d3ApplyRecoverAvailable===true&&
      (applySelection!==null||applyPreviouslySent||selectedRevisions.length>0)&&
      (applyAttempted||applyPreviouslySent||recoverPrevious)&&<button
       className="secondary" data-testid="d3-recover-apply" disabled={busy}
       onClick={recoverApplied}>Проверить Kernel без повторного Apply</button>}
    {kernelRecovery&&<p role="status" data-testid="d3-kernel-recovery">
     {kernelRecovery.status==='ORIGINAL_KERNEL_APPLY_READBACK_CONFIRMED'
       ? 'Применение подтверждено оригинальными Object и Event, ключ эффекта: '+
         kernelRecovery.effectKey+'. Повторный Apply не выполнялся.'
       : 'Исход Apply неизвестен: точное событие и объект не подтверждены. '+
         'Повторная запись запрещена. Ключ эффекта: '+kernelRecovery.effectKey+'.'}
    </p>}
    {application&&<div data-testid="d3-accepted-result-readback">
     <p>Оригинальный T3 подтвердил принятый Result и выбранные редакции.
      Это только просмотр: запись в Kernel не выполнялась.</p>
     {Array.isArray(application.changes)&&application.changes.map((item:any)=>
       <p key={item.resultRevisionId}>
        Поручение {item.taskId}; исполнитель {item.executorId}.
        Результат: {item.resultExcerpt}
        {item.resultTruncated?' (показан фрагмент)':''}
       </p>)}
     {session.d3ApplyAvailable===true&&<>
     <label><input type="checkbox" checked={applyConsent}
       disabled={applyAttempted||applyPreviouslySent||recoverPrevious}
       onChange={e=>setApplyConsent(e.target.checked)}/>
       Отдельно подтверждаю применение выбранных редакций</label>
     <button className="primary" data-testid="d3-apply-confirm"
      disabled={busy||!applyConsent||applyAttempted||applyPreviouslySent||recoverPrevious}
      onClick={apply}>Apply</button>
     </>}
    </div>}
    {!session.d3ApplyAvailable&&<p role="status" data-testid="d3-original-kernel-not-connected">
      Подписанный Result можно проверить, но применение в оригинальный
      Kernel пока не подключено. ACCEPT не означает Apply.
     </p>}
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
