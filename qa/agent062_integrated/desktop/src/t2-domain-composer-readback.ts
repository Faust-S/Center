/** Exact readback for one T2 Result attached to the Core-owned Task draft.
 * No local storage, external authority, or automatic replay of uncertain writes.
 */
export type DomainAttachment={name:string;text:string};
export type DomainComposerView={
 state:'SAVED'|'EMPTY_OR_UNREADABLE';draft_digest:string;text:string;
 knowledge_sources:readonly unknown[];attachments:readonly DomainAttachment[];
 local_model:unknown;pending_submission:unknown;
};
export type DomainSelection={
 package_sha256:string;workspace_id:string;object_id:string;revision:number;
};
export type DomainAttachReceipt={
 attachment_name:string;draft_digest:string;active_workspace_id:string;
};
export type DomainReadback={attachment_name:string;draft_digest:string};
const validDigest=(s:unknown):s is string=>typeof s==='string'&&/^[a-f0-9]{64}$/.test(s);
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);

export function reconcileDomainTaskAttachment(
 before:DomainComposerView, after:DomainComposerView,
 selected:DomainSelection, selectedText:string,
 expectedWorkspaceId:string, ack?:DomainAttachReceipt|null,
):DomainReadback|null {
 if(!before||!after||!selected||after.state!=='SAVED'
    ||!validDigest(before.draft_digest)||!validDigest(after.draft_digest)
    ||!validDigest(selected.package_sha256)
    ||!Number.isSafeInteger(selected.revision)||selected.revision<0
    ||typeof selected.workspace_id!=='string'||!selected.workspace_id
    ||typeof selected.object_id!=='string'||!selected.object_id
    ||typeof selectedText!=='string'||!selectedText
    ||!selectedText.includes('workspace_id: '+selected.workspace_id+'\n')
    ||!selectedText.includes('object_id: '+selected.object_id+'\n')
    ||!selectedText.includes('revision: '+selected.revision+'\n')
    ||!selectedText.includes('package_sha256: '+selected.package_sha256+'\n')
    ||before.pending_submission!==null||after.pending_submission!==null
    ||before.text!==after.text
    ||!Array.isArray(before.attachments)||!Array.isArray(after.attachments)
    ||!same(before.knowledge_sources,after.knowledge_sources)
    ||!same(before.local_model,after.local_model)
    ||after.attachments.length!==before.attachments.length+1)return null;
 for(let i=0;i<before.attachments.length;i++) {
  const a=before.attachments[i],b=after.attachments[i];
  if(!a||!b||a.name!==b.name||a.text!==b.text)return null;
 }
 const appended=after.attachments[before.attachments.length];
 if(!appended||typeof appended.name!=='string'||appended.text!==selectedText)return null;
 const prefix='T2 result '+selected.package_sha256.slice(0,12)+' ';
 const suffix=' r'+selected.revision+'.txt';
 if(!appended.name.startsWith(prefix)||!appended.name.endsWith(suffix)
    ||appended.name.length<=prefix.length+suffix.length)return null;
 if(ack&&(ack.active_workspace_id!==expectedWorkspaceId
   ||ack.attachment_name!==appended.name||ack.draft_digest!==after.draft_digest))return null;
 return {attachment_name:appended.name,draft_digest:after.draft_digest};
}
export class DomainReadbackUnconfirmed extends Error {
 constructor(reason='t2_domain_attachment_outcome_unconfirmed'){
  super(reason);this.name='DomainReadbackUnconfirmed';
 }
}
/** Exactly one command, followed by read-only observation even if ACK is lost. */
export async function commitAndReconcileDomainAttachment(
 before:DomainComposerView,selected:DomainSelection,selectedText:string,
 expectedWorkspaceId:string,command:()=>Promise<DomainAttachReceipt>,
 readback:()=>Promise<DomainComposerView>,isUnknown:(e:unknown)=>boolean,
):Promise<{after:DomainComposerView;confirmed:DomainReadback;recoveredAfterLostAck:boolean}> {
 let ack:DomainAttachReceipt|null=null;
 let lostAck=false;
 try{
  const response=await command();
  if(!response||typeof response.attachment_name!=='string'
     ||!validDigest(response.draft_digest)
     ||response.active_workspace_id!==expectedWorkspaceId)
    throw new DomainReadbackUnconfirmed('t2_domain_attachment_ack_invalid');
  ack=response;
 }catch(e){
  if(!isUnknown(e))throw e;
  lostAck=true;
 }
 let after:DomainComposerView;
 try{after=await readback();}
 catch{throw new DomainReadbackUnconfirmed('t2_domain_attachment_readback_unavailable')}
 const confirmed=reconcileDomainTaskAttachment(before,after,selected,selectedText,expectedWorkspaceId,ack);
 if(!confirmed)throw new DomainReadbackUnconfirmed('t2_domain_attachment_readback_mismatch');
 return {after,confirmed,recoveredAfterLostAck:lostAck};
}
