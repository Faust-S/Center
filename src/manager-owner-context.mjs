// Read-only projection from the ORIGINAL D3 signed corporate owner.
// This module is not a signer, credential validator, Index, Store or Graph.
// The native Center port has already checked source and context. We repeat
// strict organization/Workspace checks before surfacing any rows to React.
import {signedD3SessionFingerprint} from '../runtime/cen03-review.mjs';
import {managerSearchRow} from './manager-context.mjs';
import {readOriginalTaskCatalog} from '../runtime/cen03-d3-owner.mjs';

const HEX=/^[a-f0-9]{64}$/;
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const need=(ok,code)=>{if(!ok)throw Error(code);};
const empty=()=>({
 status:'NOT_CONNECTED',workspaceId:null,actorId:null,contextId:null,
 contextEpoch:null,totalTasks:0,d2ReaderConnected:false,inboxTotal:null,inboxTruncated:false,
 entries:[],attention:[],inboxLoaded:false
});

// Unbound or other-organization readbacks yield no information; malformed
// signed-owner content is rejected rather than displayed as ordinary text.
export function readManagerSignedContext(view,organizationId,inbox=null){
 if(signedD3SessionFingerprint(view,organizationId)===null)return empty();
 const s=view.snapshot;
 const catalog=readOriginalTaskCatalog(s);
 const entries=[],attention=[];
 for(const task of catalog.rows){
   entries.push({...managerSearchRow('signed-task',task.taskId,
     task.summary.trim().slice(0,180)||task.taskId,
     'Подписанная Task в оригинальной Workspace. Адресат: '+task.recipientId+
     '. Доставка получателю не подтверждена; Result и приёмка не следуют из этой записи.',
     'Оригинальный T3 D3 · подписанный список Task',
     [task.taskId,task.taskRevisionId,task.packageSha256,task.summary,task.recipientId].join(' ')),
     taskRevisionId:task.taskRevisionId,packageSha256:task.packageSha256,recipientId:task.recipientId});
 }
 const base={status:'SIGNED_D3_READBACK',organizationId,
   workspaceId:s.workspaceId,actorId:s.actorId,contextId:s.contextId,
   contextEpoch:s.contextEpoch,totalTasks:s.totalTasks,
    // Signed native capability presence only, NOT a DATA grant, T2 receipt
    // or evidence that the selected corporate Workspace exists.
    d2ReaderConnected:s.d2ActivityReaderConnected===true,inboxTotal:null,
   inboxTruncated:false,entries,attention,inboxLoaded:false};
 if(inbox===null)return base;
 need(inbox?.schema==='IWXA_T3_ORIGINAL_RECIPIENT_INBOX/1' &&
   inbox.organizationId===organizationId &&
   inbox.workspaceId===s.workspaceId &&
   Number.isSafeInteger(inbox.total) && inbox.total>=0 && inbox.total<=10000 &&
   typeof inbox.truncated==='boolean' && Array.isArray(inbox.items) &&
   inbox.items.length<=64 && inbox.total>=inbox.items.length,
   'CEN_MANAGER_SIGNED_INBOX_INVALID');
 const receipts=new Set();
 for(const item of inbox.items){
   need(item&&HEX.test(item.packageSha256)&&
     ['REVIEW_REQUIRED','RECEIPT_CONFLICT','ACCEPTED','REJECTED'].includes(item.status)&&
     (item.operationId==null||ID.test(item.operationId)) &&
     (item.acceptanceId==null||HEX.test(item.acceptanceId)),
     'CEN_MANAGER_SIGNED_RECEIPT_INVALID');
   need(!receipts.has(item.packageSha256),'CEN_MANAGER_SIGNED_RECEIPT_DUPLICATE');
   receipts.add(item.packageSha256);
   const descriptions={
     REVIEW_REQUIRED:'Оригинальный Reconciliation ожидает Human Review. Результат не принят.',
     RECEIPT_CONFLICT:'Оригинальный Reconciliation обнаружил конфликт квитанций. Не повторяйте решение до проверки исходной записи.',
     ACCEPTED:'Решение ACCEPT зарегистрировано. Это не подтверждение отдельного Kernel Apply.',
     REJECTED:'Решение REJECT зарегистрировано. Применение не выполняется.'
   };
   entries.push(managerSearchRow('signed-result-package',item.packageSha256,
     'Пакет Result '+item.packageSha256.slice(0,12),
     descriptions[item.status],
     'Оригинальный T3 D3 · Reconciliation',
     [item.packageSha256,item.acceptanceId,item.operationId].filter(Boolean).join(' ')));
   if(item.status==='REVIEW_REQUIRED'||item.status==='RECEIPT_CONFLICT'){
     attention.push({
       key:'signed-inbox:'+item.packageSha256,
       title:item.status==='REVIEW_REQUIRED'?'Рассмотреть полученный Result':'Проверить конфликт квитанций',
       detail:'Пакет '+item.packageSha256.slice(0,12)+'. '+descriptions[item.status],
       destination:'results',assignmentId:null,
       source:'ORIGINAL_D3_READBACK'});
   }
 }
 return {...base,inboxLoaded:true,inboxTotal:inbox.total,
   inboxTruncated:inbox.truncated,entries,attention};
}

// Build the exact existing T3 native operation binding; no new grant and no
// extra scope-wide wildcard. Authority is checked again by original Host.
export function managerSignedInboxArgs(view,organizationId){
 need(signedD3SessionFingerprint(view,organizationId)!==null,
   'CEN_MANAGER_SIGNED_BINDING_REQUIRED');
 const s=view.snapshot;
 return {organizationId,operation:'d3Inbox',input:{},
   binding:{organizationId:s.organizationId,workspaceId:s.workspaceId,
     contextEpoch:s.contextEpoch,actorId:s.actorId,contextId:s.contextId}};
}

// A link from search to the original Reconciliation is not a capability.
const ORIGINAL_KINDS=new Set(['signed-task','signed-result-package']);
export function prepareManagerOriginalSelection(owner,organizationId,kind,id){
 if(owner?.status!=='SIGNED_D3_READBACK'||owner.organizationId!==organizationId||
   !ORIGINAL_KINDS.has(kind)||typeof id!=='string'||
   !owner.entries?.some(row=>row.kind===kind&&row.id===id)||
   typeof owner.workspaceId!=='string'||!ID.test(owner.workspaceId)||
   typeof owner.actorId!=='string'||!ID.test(owner.actorId)||
   typeof owner.contextId!=='string'||!ID.test(owner.contextId)||
   !Number.isSafeInteger(owner.contextEpoch)||owner.contextEpoch<=0)return null;
 if(kind==='signed-result-package'&&!HEX.test(id))return null;
 const matching=owner.entries.find(row=>row.kind===kind&&row.id===id);
 if(kind==='signed-task'&&(!ID.test(id)||!HEX.test(matching?.taskRevisionId)||
   !HEX.test(matching?.packageSha256)||!ID.test(matching?.recipientId)))return null;
 return {kind,id,organizationId,workspaceId:owner.workspaceId,
   actorId:owner.actorId,contextId:owner.contextId,contextEpoch:owner.contextEpoch,
   ...(kind==='signed-task'?{
      taskRevisionId:matching.taskRevisionId,packageSha256:matching.packageSha256,recipientId:matching.recipientId
   }:{})};
}
export function managerOriginalSelectionMatches(selection,session){
 return !!(selection&&session&&ORIGINAL_KINDS.has(selection.kind)&&
   typeof selection.organizationId==='string'&&
   typeof selection.workspaceId==='string'&&
   typeof selection.actorId==='string'&&
   typeof selection.contextId==='string'&&
   Number.isSafeInteger(selection.contextEpoch)&&selection.contextEpoch>0&&
   selection.organizationId===session.organizationId&&
   selection.workspaceId===session.workspaceId&&
   selection.actorId===session.actorId&&
   selection.contextId===session.contextId&&
   selection.contextEpoch===session.contextEpoch&&
   typeof selection.id==='string'&&
   (selection.kind==='signed-result-package'?HEX.test(selection.id):
     ID.test(selection.id)&&HEX.test(selection.taskRevisionId)&&
     HEX.test(selection.packageSha256)&&ID.test(selection.recipientId)&&Array.isArray(session.tasks)&&
     session.tasks.some(task=>task.taskId===selection.id&&
       task.taskRevisionId===selection.taskRevisionId&&
       task.packageSha256===selection.packageSha256&&task.recipientId===selection.recipientId)));
}
