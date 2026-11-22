/** Localized status for a saved dialogue that failed after Core admission.
 * Only fixed Core-owned codes are interpreted; never display provider details. */
export function chatFailureMessage(code:unknown,tr:(ru:string,en:string)=>string):string{
 switch(code){
  case 'basic_runtime_busy':
   return tr('Локальная модель занята другой задачей. Дождитесь её завершения и отправьте новый запрос.',
    'The local model is busy with another task. Wait for it to finish, then send a new request.');
  case 'basic_runtime_timeout':
   return tr('Локальная модель не ответила вовремя. Сообщение сохранено. Попробуйте более короткий запрос.',
    'The local model timed out. Your message is saved. Try a shorter request.');
  case 'basic_runtime_model_pin_changed':
  case 'basic_runtime_model_digest_changed':
  case 'model_binding_changed_during_invocation':
  case 'local_model_response_identity_mismatch':
   return tr('Выбранная модель изменилась во время ответа. Проверьте её в разделе «Модели» и повторите запрос.',
    'The selected model changed during the reply. Check Models before sending another request.');
  case 'basic_runtime_context_window_insufficient':
  case 'basic_runtime_context_budget_too_large':
   return tr('Запрос и ответ не помещаются в контекст выбранной модели. Уменьшите объём запроса или ожидаемого ответа либо выберите модель с большим контекстом.',
    'The request and answer do not fit the selected model context. Shorten the request or expected answer, or select a model with a larger context.');
  case 'basic_runtime_model_not_active':
  case 'basic_runtime_component_changed':
   return tr('Локальная модель остановлена или её компонент изменился. Проверьте запуск в разделе «Модели».',
    'The local model is stopped or its component changed. Check activation in Models.');
  case 'basic_runtime_generation_failed':
  case 'basic_runtime_output_invalid':
   return tr('Локальная модель запустилась, но не сформировала завершённый ответ. Проверьте её в разделе «Модели».',
    'The local model started but did not produce a completed reply. Verify it in Models.');
  default:
   return tr('Ответ не получен. Сообщение сохранено, можно отправить новый запрос.',
    'No reply was received. The message was saved; you can send a new request.');
 }
}

/**
 * One durable SessionRuntime conversation per key. React owns only navigation
 * and the current form; the Core owns drafts, history, models and receipts.
 */
export const LEGACY_CONVERSATION='iwxa-desktop-local';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIALOG=/^dialog-[0-9a-f]{32}$/;

export type LocalPin={name:string;digest:string};
export type ConversationPort={
 query<T>(name:string,params?:Record<string,unknown>):Promise<T>;
 command<T>(name:string,input:Record<string,unknown>):Promise<T>;
};
type Row=Record<string,unknown>;
const row=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
export const validConversationKey=(key:string)=>key===LEGACY_CONVERSATION||DIALOG.test(key);
const requireKey=(key:string)=>{
 if(!validConversationKey(key))throw new Error('invalid_desktop_conversation_key');
 return key;
};
export const conversationDraftContext=(key:string)=>requireKey(key)===LEGACY_CONVERSATION
 ?'dialogue':'dialogue:'+key;

/** No deterministic or Math.random fallback: identifiers must be collision-resistant. */
export function newConversationKey(makeUuid:()=>string=()=>crypto.randomUUID()):string{
 const uuid=makeUuid();
 if(!UUID.test(uuid))throw new Error('secure_conversation_uuid_unavailable');
 return 'dialog-'+uuid.replace(/-/g,'');
}
export async function readConversationCatalog(port:ConversationPort):Promise<{conversations:Row[];activeKey:string}>{
 const data=row(await port.query<Row>('session_catalog',{limit:100,fast:true}));
 if(!Array.isArray(data.conversations))throw new Error('invalid_conversation_catalog');
 const conversations=data.conversations.map(row).filter(item=>typeof item.conversation_key==='string'
   &&validConversationKey(item.conversation_key)&&typeof item.session_id==='string');
 const selected=String(data.active_conversation_key||'');
 const activeKey=conversations.some(item=>item.conversation_key===selected)
   ?selected:conversations.length?String(conversations[0].conversation_key):LEGACY_CONVERSATION;
 return {conversations,activeKey};
}
export type ConversationGroup={group_id:string;name:string;pinned:boolean};
export type GroupedConversationCatalog={
 conversations:Row[];groups:ConversationGroup[];activeKey:string;
};
/** Grouping is a display index on existing conversations, never a new Session owner. */
export async function readGroupedConversationCatalog(port:ConversationPort):Promise<GroupedConversationCatalog>{
 const data=row(await port.query<Row>('session_catalog',{limit:100,fast:true}));
 if(!Array.isArray(data.conversations)||!Array.isArray(data.groups))
  throw Error('conversation_groups_catalog_invalid');
 const groups=data.groups.map(row).map(item=>{
  if(typeof item.group_id!=='string'||!/^grp-[0-9a-f]{32}$/.test(item.group_id)
    ||typeof item.name!=='string'||!item.name.trim()||item.name.length>60
    ||(item.pinned!==undefined&&typeof item.pinned!=='boolean'))
   throw Error('conversation_group_invalid');
  return {group_id:item.group_id,name:item.name,pinned:item.pinned===true};
 });
 if(new Set(groups.map(x=>x.group_id)).size!==groups.length||groups.length>32)
  throw Error('conversation_groups_catalog_invalid');
 const known=new Set(groups.map(x=>x.group_id));
 const conversations=data.conversations.map(row).filter(item=>typeof item.conversation_key==='string'
  &&validConversationKey(item.conversation_key)&&typeof item.session_id==='string');
 for(const item of conversations)
  if(item.group_id!==undefined&&item.group_id!==null&&!known.has(String(item.group_id)))
   throw Error('conversation_group_membership_invalid');
 const selected=String(data.active_conversation_key||'');
 const activeKey=conversations.some(item=>item.conversation_key===selected)
  ?selected:conversations.length?String(conversations[0].conversation_key):LEGACY_CONVERSATION;
 return {conversations,groups,activeKey};
}
export async function createConversationGroup(port:ConversationPort,name:string):Promise<ConversationGroup>{
 const normalized=name.trim();
 if(!normalized||normalized.length>60)throw Error('conversation_group_name_invalid');
 const ack=row(await port.command<Row>('conversation_group_create',{name:normalized}));
 if(typeof ack.group_id!=='string'||!/^grp-[0-9a-f]{32}$/.test(ack.group_id)
   ||ack.name!==normalized)throw Error('conversation_group_create_unconfirmed');
 const catalog=await readGroupedConversationCatalog(port);
 if(!catalog.groups.some(group=>group.group_id===ack.group_id&&group.name===normalized))
  throw Error('conversation_group_create_readback_mismatch');
 return {group_id:ack.group_id,name:normalized,pinned:false};
}
export async function renameConversationGroup(port:ConversationPort,groupId:string,name:string):Promise<void>{
 const normalized=name.trim();
 if(!normalized||normalized.length>60)throw Error('conversation_group_name_invalid');
 const ack=row(await port.command<Row>('conversation_group_rename',{group_id:groupId,name:normalized}));
 if(ack.group_id!==groupId||ack.name!==normalized)throw Error('conversation_group_rename_unconfirmed');
 const catalog=await readGroupedConversationCatalog(port);
 if(!catalog.groups.some(group=>group.group_id===groupId&&group.name===normalized))
  throw Error('conversation_group_rename_readback_mismatch');
}
export async function pinConversationGroup(port:ConversationPort,groupId:string,pinned:boolean):Promise<void>{
 if(typeof pinned!=='boolean')throw Error('conversation_group_pin_invalid');
 const ack=row(await port.command<Row>('conversation_group_pin',{group_id:groupId,pinned}));
 if(ack.group_id!==groupId||ack.pinned!==pinned)throw Error('conversation_group_pin_unconfirmed');
 const catalog=await readGroupedConversationCatalog(port);
 if(!catalog.groups.some(group=>group.group_id===groupId&&group.pinned===pinned))
  throw Error('conversation_group_pin_readback_mismatch');
}
export async function deleteConversationGroup(port:ConversationPort,groupId:string):Promise<void>{
 const ack=row(await port.command<Row>('conversation_group_delete',{group_id:groupId}));
 if(ack.group_id!==groupId)throw Error('conversation_group_delete_unconfirmed');
 const catalog=await readGroupedConversationCatalog(port);
 if(catalog.groups.some(group=>group.group_id===groupId)
    ||catalog.conversations.some(item=>item.group_id===groupId))
  throw Error('conversation_group_delete_readback_mismatch');
}
export async function assignConversationGroup(port:ConversationPort,key:string,groupId:string|null):Promise<void>{
 requireKey(key);
 const ack=row(await port.command<Row>('conversation_group_assign',{
  conversation_key:key,group_id:groupId}));
 if(ack.conversation_key!==key||ack.group_id!==groupId||typeof ack.session_id!=='string')
  throw Error('conversation_group_assignment_unconfirmed');
 const catalog=await readGroupedConversationCatalog(port);
 const item=catalog.conversations.find(item=>item.conversation_key===key);
 if(!item||(item.group_id??null)!==groupId)
  throw Error('conversation_group_assignment_readback_mismatch');
}

export async function listConversations(port:ConversationPort):Promise<Row[]>{
 return (await readConversationCatalog(port)).conversations;
}
export async function selectConversation(port:ConversationPort,key:string):Promise<void>{
 requireKey(key);
 const response=row(await port.command<Row>('session_select',{conversation_key:key}));
 if(response.active_conversation_key!==key||typeof response.session_id!=='string'||!response.session_id)
   throw new Error('desktop_conversation_selection_unconfirmed');
 const catalogue=await readConversationCatalog(port);
 if(catalogue.activeKey!==key||!catalogue.conversations.some(row=>row.session_id===response.session_id&&row.conversation_key===key))
   throw new Error('desktop_conversation_selection_readback_mismatch');
}
export async function readConversationQuick(port:ConversationPort,key:string):Promise<{status:Row;turns:Row[]}>{
 const data=row(await port.query<Row>('quick_chat_history',{conversation_key:requireKey(key),limit:80}));
 if(data.conversation_key!==key)throw Error('chat_history_conversation_mismatch');
 if(!Array.isArray(data.turns))throw Error('chat_history_invalid');
 return {status:{session:row(data.session)},turns:data.turns.map(row)};
}
export async function readConversation(port:ConversationPort,key:string,query=''):Promise<{status:Row;turns:Row[]}>{
 const quick=row(await port.query<Row>('quick_chat_history',{conversation_key:requireKey(key),query,limit:160}));
 if(quick.conversation_key!==key||!Array.isArray(quick.turns))
  throw Error('chat_history_conversation_mismatch');
 const quickRows=quick.turns.map(row);

 const status=row(await port.query<Row>('session_status',{session_surface:'web',conversation_key:key}));
 // A session can be recycled while these two read-only requests are in
 // flight. Never present turns from one generation as belonging to another.
 if(conversationSessionIdentity({session:quick.session})
    !==conversationSessionIdentity(status))
  throw Error('chat_history_session_changed_during_read');
 if(!query.trim()){
  // Owner already returned these verified rows; skip another history scan.
  if(!Array.isArray(status.recent_linked_tasks))throw new Error('invalid_conversation_history');
  return {status,turns:[...status.recent_linked_tasks.map(row),...quickRows].sort(
   (a,b)=>String(a.created_at||a.linked_at||'').localeCompare(String(b.created_at||b.linked_at||'')))};
 }
 const search=row(await port.query<Row>('session_search',{session_surface:'web',conversation_key:key,query,limit:40}));
 if(!Array.isArray(search.results))throw new Error('invalid_conversation_history');
 const after=row(await port.query<Row>('session_status',{session_surface:'web',conversation_key:key}));
 if(conversationSessionIdentity(status)!==conversationSessionIdentity(after))
  throw Error('chat_history_session_changed_during_search');
 return {status,turns:[...search.results.map(row),...quickRows].sort(
   (a,b)=>String(a.created_at||a.linked_at||'').localeCompare(String(b.created_at||b.linked_at||'')))};
}
/** Core Session identity for the displayed history.  The key names a topic;
 * only session_id + generation identify which run owns its messages.
 * Missing sessions are valid only for an untouched, empty topic.
 */
export function conversationSessionIdentity(status:unknown):string{
 const session=row(row(status).session);
 if(session.session_id===undefined&&session.generation===undefined)return '';
 if(typeof session.session_id!=='string'
   ||!/^SES-[A-Za-z0-9_-]{1,100}$/.test(session.session_id)
   ||typeof session.generation!=='number'
   ||!Number.isSafeInteger(session.generation)||session.generation<1)
  throw Error('chat_session_identity_invalid');
 return session.session_id+':'+session.generation;
}

/** Merge bounded readbacks only within the SAME Core Session generation.
 * A cleared/recycled conversation starts with its own verified history,
 * even if the user-visible topic key remains unchanged.
 */
export function mergeScopedConversationHistory(
 previousStatus:unknown,previous:unknown,
 incomingStatus:unknown,incoming:unknown,
 replace=false
):Row[]{
 if(!Array.isArray(previous)||!Array.isArray(incoming))
  throw Error('chat_history_merge_invalid');
 const before=conversationSessionIdentity(previousStatus);
 const after=conversationSessionIdentity(incomingStatus);
 if(!after&&incoming.length)throw Error('chat_history_session_unverified');
 if(replace||!after||before!==after)return incoming.map(row);
 return mergeConversationTurns(previous,incoming);
}

/** Merge a fresh bounded chat read into the displayed conversation.
 * Keep verified linked Tasks and older turns outside the quick-history window.
 * A late RUNNING response may not roll back a previously seen terminal turn.
 * Display only: Core SessionRuntime remains the authority for every row.
 */
export function mergeConversationTurns(previous:unknown,fresh:unknown):Row[]{
 if(!Array.isArray(previous)||!Array.isArray(fresh))throw Error('chat_history_merge_invalid');
 const records=new Map<string,Row>();
 let anonymous=0;
 const keyOf=(item:Row):string=>{
  if(typeof item.message_id==='string'&&SUBMISSION.test(item.message_id))
   return 'chat:'+item.message_id;
  if(typeof item.task_id==='string'&&item.task_id)
   return 'task:'+item.task_id;
  return 'other:'+String(anonymous++);
 };
 for(const input of [...previous,...fresh]){
  const item=row(input),key=keyOf(item),existing=records.get(key);
  const oldTerminal=existing&&['COMPLETED','FAILED','INTERRUPTED'].includes(String(existing.status));
  // A slow read of RUNNING must never replace a durable terminal reply
  // already displayed by a faster observation of the same message.
  if(oldTerminal&&item.status==='RUNNING')continue;
  records.set(key,item);
 }
 return [...records.values()].sort((a,b)=>
  String(a.created_at||a.linked_at||'').localeCompare(String(b.created_at||b.linked_at||'')));
}

export async function readConversationDraft(port:ConversationPort,key:string):Promise<Row>{
 return row(await port.query<Row>('composer_draft',{context:conversationDraftContext(key)}));
}
export type ChatSource={path:string;expected_sha256:string;title:string;provider_id?:string;binding_digest?:string};
const DIGEST=/^[a-f0-9]{64}$/;
/** Retain the source's Core binding across reload, resend and draft recovery. */
export function storedChatSource(value:unknown):ChatSource{
 const source=row(value);
 const base={
  path:String(source.path||''),expected_sha256:String(source.expected_sha256||''),
  title:String(source.title||'')
 };
 if(!base.path||!DIGEST.test(base.expected_sha256))throw Error('chat_source_identity_invalid');
 const hasProvider=source.provider_id!==undefined,hasBinding=source.binding_digest!==undefined;
 if(hasProvider!==hasBinding)throw Error('chat_source_binding_invalid');
 if(!hasProvider)return base; // An older draft is readable, but requires re-selection before send.
 if(typeof source.provider_id!=='string'||!source.provider_id
    ||source.provider_id.length>200||typeof source.binding_digest!=='string'
    ||!DIGEST.test(source.binding_digest))throw Error('chat_source_binding_invalid');
 return {...base,provider_id:source.provider_id,binding_digest:source.binding_digest};
}
/** A search result alone is not sufficient: its provider and binding are verified at readback. */
/** The verified source identity includes the active vault binding, not only path/content.
 * Re-selecting the same path after a vault change must replace its stale pin.
 */
export function sameVerifiedChatSource(left:ChatSource,right:ChatSource):boolean{
 return left.path===right.path&&left.expected_sha256===right.expected_sha256
  &&left.provider_id===right.provider_id&&left.binding_digest===right.binding_digest;
}
export function upsertVerifiedChatSource<T extends ChatSource>(current:T[],source:T):T[]{
 const verified=storedChatSource(source);
 if(!verified.provider_id||!verified.binding_digest)throw Error('chat_source_binding_invalid');
 const matching=current.filter(item=>item.path===verified.path);
 if(matching.length===1&&sameVerifiedChatSource(matching[0],verified)
    &&matching[0].title===verified.title)return current;
 const index=current.findIndex(item=>item.path===verified.path);
 if(index<0&&current.length>=8)return current;
 const updated=current.filter(item=>item.path!==verified.path);
 updated.splice(index<0?updated.length:Math.min(index,updated.length),0,source);
 return updated;
}
export function chatSourceFromSearch(value:unknown):ChatSource{
 const source=row(value),provenance=row(source.provenance);
 // Search results are new selections: missing provenance is never equivalent
 // to a legacy draft whose source identity has to be explicitly reselected.
 if(typeof provenance.provider_id!=='string'||!provenance.provider_id.trim()
    ||provenance.provider_id.length>200
    ||typeof provenance.binding_digest!=='string'||!DIGEST.test(provenance.binding_digest))
  throw Error('chat_source_binding_invalid');
 return storedChatSource({
  path:source.path||source.relative_path,
  expected_sha256:source.sha256||source.digest_sha256,
  title:source.title||source.path||source.relative_path,
  provider_id:provenance.provider_id,binding_digest:provenance.binding_digest
 });
}
export function confirmChatSourceReadback(selected:ChatSource,actual:unknown):ChatSource{
 const source=row(actual),binding=row(source.binding_ref);
 if(!selected.provider_id||!selected.binding_digest
    ||source.path!==selected.path||source.sha256!==selected.expected_sha256
    ||typeof source.content!=='string'
    ||source.provider_id!==selected.provider_id
    ||binding.binding_digest!==selected.binding_digest)
  throw Error('chat_source_verified_readback_mismatch');
 return selected;
}
function requireBoundChatSources(sources:ChatSource[]){
 for(const source of sources){
  const normalized=storedChatSource(source);
  if(!normalized.provider_id||!normalized.binding_digest)
   throw Error('chat_source_reselection_required');
 }
}

export type ChatAttachment={name:string;text:string};
export type ChatOptions={skill_id:string|null;use_memory:boolean;use_obsidian:boolean;use_web:boolean};
export async function readChatOptions(port:ConversationPort,key:string):Promise<ChatOptions>{
 const r=row(await port.query<Row>('session_options',{conversation_key:requireKey(key)}),);
 const o=row(r.options);
 return {skill_id:typeof o.skill_id==='string'?o.skill_id:null,
 use_memory:o.use_memory===true,use_obsidian:o.use_obsidian===true,use_web:o.use_web===true};
}
export async function saveChatOptions(port:ConversationPort,key:string,options:ChatOptions){
 const r=row(await port.command<Row>('session_options_save',{conversation_key:requireKey(key),options}));
 const saved=await readChatOptions(port,key);
 if(r.conversation_key!==key||JSON.stringify(options)!==JSON.stringify(saved))throw Error('chat_options_readback_failed');
}
export async function renameChat(port:ConversationPort,key:string,title:string){
 const r=row(await port.command<Row>('session_rename',{conversation_key:requireKey(key),title:title.trim()}));
 const catalog=await readConversationCatalog(port);
 if(r.title!==title.trim()||!catalog.conversations.some(c=>c.conversation_key===key&&c.title===title.trim()))throw Error('chat_rename_readback_failed');
}
export async function saveConversationDraft(port:ConversationPort,key:string,text:string,localModel:LocalPin|null,
 sources?:ChatSource[],attachments?:ChatAttachment[],expectedDigest?:string):Promise<Row>{
 if(typeof text!=='string'||text.length>65536)throw new Error('invalid_conversation_draft');
 if(expectedDigest!==undefined&&!SHA256.test(expectedDigest))throw Error('chat_draft_expected_revision_invalid');
 return row(await port.command<Row>('composer_draft_save',{
  context:conversationDraftContext(key),text,local_model:localModel,
  ...(sources?{knowledge_sources:sources}:{}),...(attachments?{attachments}:{}),
  ...(expectedDigest?{expected_draft_digest:expectedDigest}:{}),
 }));
}
/** Save through the existing SessionRuntime optimistic revision and read it
 * back. A lost command ACK may be reconciled only by exact stored fields;
 * an unrelated newer draft is never overwritten by an automatic retry.
 */
export async function saveCheckedConversationDraft(
 port:ConversationPort,key:string,expectedDigest:string,local:ReconnectEditableDraft
):Promise<Row>{
 if(!SHA256.test(expectedDigest))throw Error('chat_draft_revision_unverified');
 let failed:unknown=null;
 try{
  await saveConversationDraft(port,key,local.text,local.model,
   local.sources,local.attachments,expectedDigest);
 }catch(error){failed=error;}
 let saved:Row;
 try{saved=await readConversationDraft(port,key);}catch(error){throw failed||error;}
 if(saved.state!=='SAVED'||typeof saved.draft_digest!=='string'
    ||!SHA256.test(saved.draft_digest)
    ||!conversationDraftMatches(saved,local.text,local.model,local.sources,local.attachments))
  throw failed||Error('conversation_draft_save_readback_mismatch');
 return saved;
}
/** Confirm the exact Core draft before leaving a conversation.
 * An accepted write alone cannot prove text/model recovery after restart.
 */
export async function verifyConversationDraft(port:ConversationPort,key:string,text:string,localModel:LocalPin|null,sources?:ChatSource[],attachments?:ChatAttachment[]):Promise<void>{
 requireKey(key);
 const data=await readConversationDraft(port,key);
 const model=row(data.local_model);
 const matchesModel=localModel===null
  ?data.local_model==null
  :model.name===localModel.name&&model.digest===localModel.digest;
 const sourcesMatch=sources===undefined||JSON.stringify(sources)===JSON.stringify(data.knowledge_sources);
 const attachmentsMatch=attachments===undefined||JSON.stringify(attachments)===JSON.stringify(data.attachments);
 if(data.state!=='SAVED'||data.text!==text||!matchesModel||!sourcesMatch||!attachmentsMatch)
  throw new Error('conversation_draft_readback_mismatch');
}

export async function bindConversation(port:ConversationPort,key:string):Promise<Row>{
 requireKey(key);
 const answer=row(await port.command<Row>('session_bind',{conversation_key:key}));
 const session=row(answer.session),sid=session.session_id;
 if(typeof answer.created!=='boolean'||typeof sid!=='string'||!sid)throw new Error('conversation_creation_not_confirmed');
 const state=row(await port.query<Row>('session_status',{session_surface:'web',conversation_key:key}));
 const verified=row(state.session);
 if(verified.session_id!==sid||verified.state!=='ACTIVE')throw new Error('conversation_start_readback_mismatch');
 return state;
}
/** Regular conversation keeps source selection without creating Tasks. */
export async function submitQuickMessage(port:ConversationPort,key:string,message:string,
 model:LocalPin|null,submissionId:string,options:ChatOptions,
 sources:ChatSource[]=[],attachments:ChatAttachment[]=[]){
 requireBoundChatSources(sources);
 const ack=row(await port.command<Row>('quick_chat_submit',{
  conversation_key:requireKey(key),submission_id:submissionId,message:message.trim(),
  local_model:model,skill_id:options.skill_id,
  options:{use_memory:options.use_memory,use_obsidian:options.use_obsidian,use_web:options.use_web},
  knowledge_sources:sources,attachments
 }));
 if(ack.submission_id!==submissionId||ack.accepted!==true||!['RUNNING','COMPLETED','FAILED','INTERRUPTED'].includes(String(ack.state)))throw Error('chat_ack_mismatch');
 return {submissionId,state:String(ack.state),reused:ack.reused===true};
}



/** Read only a previously submitted chat turn. The operation never resends
 * a message, creates a Task or changes the selected model. */
export type QuickChatProgress={
 submissionId:string;
 state:'PREPARED'|'RUNNING'|'COMPLETED'|'FAILED'|'INTERRUPTED';
 partialText:string;
 errorCode:string;
};
const SUBMISSION=/^[0-9a-f]{32}$/;
/** A durable history read, not a status or a timer, confirms completed delivery.
 * No additional model request or mutation may be performed during reconciliation.
 */
export function terminalQuickChatTurn(submissionId:string,turns:unknown):'COMPLETED'|'FAILED'|'INTERRUPTED'|null{
 if(!SUBMISSION.test(submissionId)||!Array.isArray(turns))return null;
 const turn=turns.map(row).find(item=>item.message_id===submissionId);
 if(!turn)return null;
 const state=String(turn.status||'');
 if(!['COMPLETED','FAILED','INTERRUPTED'].includes(state))return null;
 if(state==='COMPLETED'&&(typeof turn.summary!=='string'||!turn.summary.trim()))return null;
 return state as 'COMPLETED'|'FAILED'|'INTERRUPTED';
}
/** A saved turn is the evidence that an earlier send was claimed.
 * Only the exact conversation-scoped history may settle a recovered pending
 * draft. Status alone is insufficient; this helper is pure and never invokes
 * or retries a model.
 */
export function verifiedRecoveredChatState(
 submissionId:string,turns:unknown
):'RUNNING'|'COMPLETED'|'FAILED'|'INTERRUPTED'|null{
 if(!SUBMISSION.test(submissionId)||!Array.isArray(turns))return null;
 const matching=turns.map(row).filter(turn=>turn.message_id===submissionId);
 if(matching.length!==1||typeof matching[0].objective!=='string'
   ||!matching[0].objective.trim())return null;
 if(matching[0].status==='RUNNING')return 'RUNNING';
 return terminalQuickChatTurn(submissionId,matching);
}

export async function readQuickChatProgress(port:ConversationPort,key:string,submissionId:string):Promise<QuickChatProgress>{
 requireKey(key);
 if(!SUBMISSION.test(submissionId))throw Error('chat_submission_id_invalid');
 const data=row(await port.query<Row>('quick_chat_status',{conversation_key:key,submission_id:submissionId}));
 if(data.submission_id!==submissionId||data.message_id!==submissionId
   ||!['PREPARED','RUNNING','COMPLETED','FAILED','INTERRUPTED'].includes(String(data.state)))
  throw Error('chat_status_readback_mismatch');
 const partial=typeof data.partial_text==='string'?data.partial_text:'';
 if(partial.length>16000)throw Error('chat_progress_out_of_bounds');
 return {submissionId,state:data.state as QuickChatProgress['state'],
  partialText:partial,errorCode:typeof data.error_code==='string'?data.error_code.slice(0,120):''};
}


/** A recovered draft identical to the last recorded submitted turn may be a
 * transport-ACK loss. Require a conscious choice before sending it again,
 * without treating ordinary repeated prompts as permanently forbidden.
 */
export function restoredDraftMatchesLastSubmission(draft:unknown,turns:unknown):boolean{
 if(typeof draft!=='string'||!draft.trim()||!Array.isArray(turns))return false;
 const submitted=turns.map(row).filter(item=>
  typeof item.message_id==='string'&&SUBMISSION.test(item.message_id)
  &&typeof item.objective==='string');
 return submitted.length>0
  &&String(submitted[submitted.length-1].objective).trim()===draft.trim();
}


/** Reserved on the existing Core-owned composer draft before dispatch.
 * The identity survives app and Core restarts; the actual text stays in the
 * already persisted draft rather than being copied into another registry.
 */
export type PendingChatSubmission={submission_id:string;draft_digest:string;context_options?:ChatOptions};
const SHA256=/^[a-f0-9]{64}$/;
export function readPendingConversationSubmission(draft:unknown):PendingChatSubmission|null{
 const value=row(draft).pending_submission;
 if(value==null)return null;
 const obj=row(value);
 if(typeof obj.submission_id!=='string'||!SUBMISSION.test(obj.submission_id)
    ||typeof obj.draft_digest!=='string'||!SHA256.test(obj.draft_digest))
  throw Error('chat_pending_identity_invalid');
 if(Object.keys(obj).some(k=>!['submission_id','draft_digest','context_options'].includes(k)))throw Error('chat_pending_identity_invalid');
 if(!Object.prototype.hasOwnProperty.call(obj,'context_options'))return {submission_id:obj.submission_id,draft_digest:obj.draft_digest};
 const options=row(obj.context_options);
 if(Object.keys(options).length!==4||!Object.prototype.hasOwnProperty.call(options,'skill_id')
  ||(options.skill_id!==null&&(typeof options.skill_id!=='string'||!/^[a-z0-9][a-z0-9-]{0,100}$/.test(options.skill_id)))
  ||['use_memory','use_obsidian','use_web'].some(k=>typeof options[k]!=='boolean'))throw Error('chat_pending_context_invalid');
 return {submission_id:obj.submission_id,draft_digest:obj.draft_digest,
  context_options:{skill_id:options.skill_id as string|null,use_memory:options.use_memory as boolean,
  use_obsidian:options.use_obsidian as boolean,use_web:options.use_web as boolean}};
}
/** Read-only J1 recovery after an authenticated Core reconnection.
 * The conversation key and the original submission ID must survive both
 * ends of readback. Status alone never proves a model reply: a matching
 * durable turn is required before marking a submission as delivered.
 */
export type ConversationReconnectReadback={
 draft:Row;history:{status:Row;turns:Row[]};
 pendingId:string;pendingState:QuickChatProgress['state']|'';
 reserved:boolean;
};
export async function readConversationAfterCoreReconnect(
 port:ConversationPort,key:string,previousSubmissionId=''
):Promise<ConversationReconnectReadback>{
 requireKey(key);
 if(previousSubmissionId&&!SUBMISSION.test(previousSubmissionId))
  throw Error('chat_reconnect_submission_invalid');
 const confirmActive=async():Promise<string>=>{
  // A recycled/cleared Session may keep the same conversation key.
  // Recovery must bind the entire read to the exact Core generation.
  const catalog=row(await port.query<Row>('session_catalog',{limit:100,fast:true}));
  const active=Array.isArray(catalog.conversations)
   ?catalog.conversations.map(row).find(item=>item.conversation_key===key)
   :undefined;
  if(catalog.active_conversation_key!==key||!active
     ||typeof active.session_id!=='string'||!active.session_id)
   throw Error('chat_reconnect_active_conversation_changed');
  const identity=conversationSessionIdentity({session:active});
  if(!identity)throw Error('chat_reconnect_catalog_session_unverified');
  return identity;
 };
 const originalIdentity=await confirmActive();
 const [draft,initialHistory]=await Promise.all([
  readConversationDraft(port,key),readConversationQuick(port,key)
 ]);
 let history=initialHistory;
 if(conversationSessionIdentity(history.status)!==originalIdentity)
  throw Error('chat_reconnect_session_changed_during_read');
 if(!['SAVED','EMPTY_OR_UNREADABLE'].includes(String(draft.state)))
  throw Error('chat_reconnect_draft_unverified');
 const pending=readPendingConversationSubmission(draft);
 if(pending&&previousSubmissionId&&pending.submission_id!==previousSubmissionId)
  throw Error('chat_reconnect_pending_identity_changed');
 // A RUNNING turn can outlive its cleared composer marker. Its identity is
 // still read from the existing SessionRuntime history, never recreated.
 const running=history.turns.map(row).filter(turn=>turn.status==='RUNNING'
  &&typeof turn.message_id==='string'&&SUBMISSION.test(turn.message_id));
 const id=pending?.submission_id||previousSubmissionId
  ||String(running[running.length-1]?.message_id||'');
 let state:ConversationReconnectReadback['pendingState']='';
 if(id){
  let progress=await readQuickChatProgress(port,key,id);
  if(progress.state==='PREPARED'){
   if(!pending)throw Error('chat_reconnect_prepared_without_marker');
  }else if(verifiedRecoveredChatState(id,history.turns)!==progress.state){
   // The model may finish between the history and status reads. Resolve
   // that single race with read-only history/status from the same session.
   const fresh=await readConversationQuick(port,key);
   if(conversationSessionIdentity(fresh.status)!==originalIdentity)
    throw Error('chat_reconnect_session_changed_during_read');
   history=fresh;
   progress=await readQuickChatProgress(port,key,id);
   if(progress.state==='PREPARED'
      ||verifiedRecoveredChatState(id,history.turns)!==progress.state)
    throw Error('chat_reconnect_history_not_verified');
  }
  state=progress.state;
 }
 if((await confirmActive())!==originalIdentity)
  throw Error('chat_reconnect_session_changed_during_read');
 return {draft,history,pendingId:id,pendingState:state,reserved:!!pending};
}
const asDraftArrays=(data:Row)=>{
 const sources=Array.isArray(data.knowledge_sources)?data.knowledge_sources:[];
 const attachments=Array.isArray(data.attachments)?data.attachments:[];
 return {sources,attachments};
};
export async function reserveConversationSubmission(port:ConversationPort,key:string,submissionId:string,
 text:string,model:LocalPin|null,sources:ChatSource[],attachments:ChatAttachment[],
 options:ChatOptions):Promise<PendingChatSubmission>{
 requireKey(key);
 if(!SUBMISSION.test(submissionId))throw Error('chat_submission_id_invalid');
 requireBoundChatSources(sources);
 const before=await readConversationDraft(port,key);
 const existing=readPendingConversationSubmission(before);
 if(existing){
  if(existing.submission_id!==submissionId)throw Error('chat_pending_submission_unresolved');
  if(before.text!==text||JSON.stringify(before.local_model??null)!==JSON.stringify(model)
    ||JSON.stringify(before.knowledge_sources??[])!==JSON.stringify(sources)
    ||JSON.stringify(before.attachments??[])!==JSON.stringify(attachments)
    ||(existing.context_options&&JSON.stringify(existing.context_options)!==JSON.stringify(options)))
    throw Error('chat_pending_draft_changed');
  return existing;
 }
 const fields=asDraftArrays(before);
 if(before.state!=='SAVED'||typeof before.draft_digest!=='string'||!SHA256.test(before.draft_digest)
  ||before.text!==text||JSON.stringify(before.local_model??null)!==JSON.stringify(model)
  ||JSON.stringify(fields.sources)!==JSON.stringify(sources)
  ||JSON.stringify(fields.attachments)!==JSON.stringify(attachments))
  throw Error('chat_submission_draft_changed');
 const actual=await readChatOptions(port,key);
 if(JSON.stringify(actual)!==JSON.stringify(options))throw Error('chat_context_options_changed');
 const pending={submission_id:submissionId,draft_digest:before.draft_digest,context_options:{...options}};
 await port.command<Row>('composer_draft_save',{
  context:conversationDraftContext(key),text,local_model:model,
  knowledge_sources:sources,attachments,pending_submission:pending
 });
 const after=await readConversationDraft(port,key);
 const confirmed=readPendingConversationSubmission(after);
 if(!confirmed||confirmed.submission_id!==submissionId||confirmed.draft_digest!==before.draft_digest
  ||JSON.stringify(confirmed.context_options)!==JSON.stringify(options)
  ||after.draft_digest!==before.draft_digest)
  throw Error('chat_submission_reservation_unconfirmed');
 return confirmed;
}
/** Resolve only after the Core owns the exact CHAT turn. Server readback
 * refuses clearing an unclaimed ID or one from another conversation.
 */
export async function resolveConversationSubmission(port:ConversationPort,key:string,
 submissionId:string):Promise<Row>{
 requireKey(key);
 const before=await readConversationDraft(port,key);
 const active=readPendingConversationSubmission(before);
 if(!active||active.submission_id!==submissionId)throw Error('chat_pending_resolution_conflict');
 if(before.state!=='SAVED'||typeof before.draft_digest!=='string'||!SHA256.test(before.draft_digest))
  throw Error('chat_pending_draft_unreadable');
 const shouldClear=before.draft_digest===active.draft_digest;
 const {sources,attachments}=asDraftArrays(before);
 await port.command<Row>('composer_draft_save',{
  context:conversationDraftContext(key),text:before.text,local_model:before.local_model??null,
  knowledge_sources:sources,attachments,
  pending_submission:null,expected_pending_submission_id:submissionId,
  expected_draft_digest:before.draft_digest,clear_submitted_draft:true
 });
 const after=await readConversationDraft(port,key);
 if(readPendingConversationSubmission(after)!==null||after.state!=='SAVED'
  ||after.text!==(shouldClear?'':before.text)
  ||JSON.stringify(after.local_model??null)!==JSON.stringify(before.local_model??null)
  ||JSON.stringify(after.knowledge_sources??[])!==JSON.stringify(shouldClear?[]:sources)
  ||JSON.stringify(after.attachments??[])!==JSON.stringify(shouldClear?[]:attachments))
  throw Error('chat_pending_resolution_unconfirmed');
 return after;
}

/** The human can revoke a PREPARED intention; a tombstone in the existing
 * Session owner refuses an in-flight late claim of its former identity.
 * Never invoke this for a claimed chat turn. */
export async function cancelPreparedConversationSubmission(port:ConversationPort,key:string,
 submissionId:string):Promise<Row>{
 requireKey(key);
 const before=await readConversationDraft(port,key);
 const active=readPendingConversationSubmission(before);
 if(!active||active.submission_id!==submissionId||before.state!=='SAVED'
  ||typeof before.draft_digest!=='string'||!SHA256.test(before.draft_digest))
  throw Error('chat_pending_cancel_conflict');
 const {sources,attachments}=asDraftArrays(before);
 await port.command<Row>('composer_draft_save',{
  context:conversationDraftContext(key),text:before.text,local_model:before.local_model??null,
  knowledge_sources:sources,attachments,pending_submission:null,
  expected_pending_submission_id:submissionId,expected_draft_digest:before.draft_digest,
  cancel_prepared_submission:true
 });
 const after=await readConversationDraft(port,key);
 if(readPendingConversationSubmission(after)!==null||after.draft_digest!==before.draft_digest
  ||after.text!==before.text||after.state!=='SAVED')throw Error('chat_pending_cancel_unconfirmed');
 return after;
}

/** Compare all editable draft fields before applying a Core settlement locally. */
export function conversationDraftMatches(saved:Row,text:string,model:LocalPin|null,
 sources:ChatSource[],attachments:ChatAttachment[]):boolean{
 return saved.text===text
  &&JSON.stringify(saved.local_model??null)===JSON.stringify(model)
  &&JSON.stringify(saved.knowledge_sources??[])===JSON.stringify(sources)
  &&JSON.stringify(saved.attachments??[])===JSON.stringify(attachments);
}

/** The current composer is a presentation of a Core-owned draft.  On Core
 * reconnect both copies are read, and disagreement requires a user decision:
 * never silently replace newly typed words or overwrite a newer Core draft.
 */
export type ReconnectEditableDraft={
 text:string;model:LocalPin|null;sources:ChatSource[];attachments:ChatAttachment[];
};
export type ReconnectDraftField='text'|'model'|'sources'|'attachments';
export function conversationReconnectDraftDifferences(
 saved:Row,local:ReconnectEditableDraft
):ReconnectDraftField[]{
 if(!['SAVED','EMPTY_OR_UNREADABLE'].includes(String(saved.state))
   ||typeof saved.text!=='string'
   ||!Array.isArray(saved.knowledge_sources)||!Array.isArray(saved.attachments)
   ||!(saved.local_model===null||saved.local_model===undefined
    ||(typeof saved.local_model==='object'&&!Array.isArray(saved.local_model))))
  throw Error('chat_reconnect_draft_unverified');
 const changes:ReconnectDraftField[]=[];
 if(saved.text!==local.text)changes.push('text');
 if(JSON.stringify(saved.local_model??null)!==JSON.stringify(local.model))changes.push('model');
 if(JSON.stringify(saved.knowledge_sources)!==JSON.stringify(local.sources))changes.push('sources');
 if(JSON.stringify(saved.attachments)!==JSON.stringify(local.attachments))changes.push('attachments');
 return changes;
}

/** Resolve a displayed reconnect conflict without creating a message or
 * changing the selected model provider. "saved" is read-only; "local" uses
 * SessionRuntime's existing revision guard and exact post-write readback.
 * A lost command reply is reconciled by reading, never by resending.
 */
export async function resolveConversationReconnectDraft(
 port:ConversationPort,key:string,expected:Row,choice:'saved'|'local',
 local:ReconnectEditableDraft
):Promise<Row>{
 requireKey(key);
 if(choice!=='saved'&&choice!=='local')throw Error('chat_reconnect_choice_invalid');
 const digest=expected.draft_digest;
 if(typeof digest!=='string'||!SHA256.test(digest))
  throw Error('chat_reconnect_revision_unverified');
 const prior=readPendingConversationSubmission(expected);
 const sameOrigin=(actual:Row)=>actual.draft_digest===digest
  &&JSON.stringify(readPendingConversationSubmission(actual))===JSON.stringify(prior);
 const check=async()=>await readConversationAfterCoreReconnect(
  port,key,prior?.submission_id||''
 );
 const verified=await check();
 if(!sameOrigin(verified.draft))
  throw Error('chat_reconnect_draft_changed');
 if(choice==='saved'||conversationReconnectDraftDifferences(verified.draft,local).length===0)
  return verified.draft;
 let failed:unknown=null;
 try{
  await saveConversationDraft(port,key,local.text,local.model,
   local.sources,local.attachments,digest);
 }catch(error){failed=error;}
 // Even after an unknown transport result, first inspect the durable Core
 // draft. A non-matching result must remain UNKNOWN and requires recheck.
 let observed:Row;
 try{observed=(await check()).draft;}catch(error){throw failed||error;}
 if(JSON.stringify(readPendingConversationSubmission(observed))!==JSON.stringify(prior)
    ||conversationReconnectDraftDifferences(observed,local).length!==0)
  throw failed||Error('chat_reconnect_draft_save_unconfirmed');
 return observed;
}
