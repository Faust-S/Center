/** Read-only admission of the existing Core-owned Task composer.
 * An incomplete projection must never become an empty draft through autosave.
 */
export type RecoveredTaskSource={path:string;expected_sha256:string;title:string;provider_id?:string;binding_digest?:string};
export type RecoveredTaskAttachment={name:string;text:string};
export type RecoveredTaskComposer={
 state:'SAVED'|'EMPTY_OR_UNREADABLE';draft_digest:string;text:string;
 knowledge_sources:RecoveredTaskSource[];attachments:RecoveredTaskAttachment[];
 local_model:unknown;pending_submission:unknown;workspace_id?:string;
};
type Row=Record<string,unknown>;
const object=(value:unknown):value is Row=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const digest=(value:unknown)=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const CONTROL=/[\u0000-\u001f]/;
const fail=():never=>{throw Error('task_draft_startup_readback_invalid');};

export function verifiedTaskComposerReadback(value:unknown,expectedWorkspace?:string):RecoveredTaskComposer{
 if(!object(value)||!['SAVED','EMPTY_OR_UNREADABLE'].includes(String(value.state))
  ||!digest(value.draft_digest)||typeof value.text!=='string'||value.text.length>65536
  ||!Array.isArray(value.knowledge_sources)||value.knowledge_sources.length>8
  ||!Array.isArray(value.attachments)||value.attachments.length>8
  ||!Object.prototype.hasOwnProperty.call(value,'local_model')
  ||!Object.prototype.hasOwnProperty.call(value,'pending_submission'))return fail();
 if(expectedWorkspace!==undefined&&(
    !/^(personal|AREA-[0-9a-f]{18})$/.test(expectedWorkspace)||value.workspace_id!==expectedWorkspace||
    (value.pending_submission!==null&&(!object(value.pending_submission)||
      value.pending_submission.workspace_id!==expectedWorkspace))))
  throw Error('task_draft_workspace_changed');
 const sources:RecoveredTaskSource[]=[],seenSources=new Set<string>();
 for(const item of value.knowledge_sources){
  if(!object(item))return fail();
  const keys=Object.keys(item).sort().join(',');
  if(keys!=='expected_sha256,path,title'
   &&keys!=='binding_digest,expected_sha256,path,provider_id,title')return fail();
  if(typeof item.path!=='string'||!item.path.trim()||item.path.length>1024||CONTROL.test(item.path)
   ||!digest(item.expected_sha256)||typeof item.title!=='string'||item.title.length>200
   ||CONTROL.test(item.title))return fail();
  if('provider_id' in item&&(
   typeof item.provider_id!=='string'||item.provider_id.length<1||item.provider_id.length>200
   ||!digest(item.binding_digest)))return fail();
  const signature=JSON.stringify([item.path,item.expected_sha256,item.provider_id??null,item.binding_digest??null]);
  if(seenSources.has(signature))return fail();
  seenSources.add(signature);
  sources.push(item as RecoveredTaskSource);
 }
 const attachments:RecoveredTaskAttachment[]=[],seenNames=new Set<string>();
 let bytes=0;
 for(const item of value.attachments){
  if(!object(item)||Object.keys(item).sort().join(',')!=='name,text'
   ||typeof item.name!=='string'||typeof item.text!=='string')return fail();
  const name=item.name;
  if(name.length<1||name.length>120||name!==name.normalize('NFC')
   ||!/^[\p{L}\p{N}_ .()-]+$/u.test(name)||name.startsWith('.')
   ||name.includes('..')||/[. ]$/.test(name)
   ||/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(name)
   ||!/\.(txt|md|csv|json)$/i.test(name)||!item.text.trim())return fail();
  const key=name.toLowerCase();
  if(seenNames.has(key))return fail();
  seenNames.add(key);
  bytes+=new TextEncoder().encode(item.text).length;
  if(bytes>48000)return fail();
  attachments.push({name,text:item.text});
 }
 if(value.state==='EMPTY_OR_UNREADABLE'&&(
  value.text!==''||sources.length!==0||attachments.length!==0
  ||value.local_model!==null||value.pending_submission!==null))return fail();
 return {
  state:value.state as RecoveredTaskComposer['state'],draft_digest:value.draft_digest as string,
  text:value.text as string,knowledge_sources:sources,attachments,
  local_model:value.local_model,pending_submission:value.pending_submission,
  ...(typeof value.workspace_id==='string'?{workspace_id:value.workspace_id}:{})
 };
}
