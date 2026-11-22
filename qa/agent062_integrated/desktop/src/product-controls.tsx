
import {useCallback,useEffect,useRef,useState,type MouseEvent} from 'react';
import {createPortal} from 'react-dom';
import {Plus,Send,Search,BookOpen,Wrench,Workflow,Brain,Paperclip,SlidersHorizontal,Folder,ChevronDown,ChevronRight,MoreHorizontal,Pin} from 'lucide-react';
import {runtime} from './runtime-client/interaction';
import {SafeMarkdown} from './safe-markdown';
import {useUiSettings} from './ui-preferences';
import {LocalTaskModelChoice,readLocalModelPin,type LocalModelPin} from './local-task-model-choice';
import {ToolsReadControl} from './tools-read-control';
import {humanState} from './human-language';
import {record,records,str,failure,OwnerDetails,OwnerError,OwnerMessage,useOwnerActions,type Row} from './owner-ui';


import {readGroupedConversationCatalog,createConversationGroup,renameConversationGroup,deleteConversationGroup,pinConversationGroup,assignConversationGroup,type ConversationGroup,conversationDraftMatches,LEGACY_CONVERSATION,newConversationKey,selectConversation,readConversation,readConversationQuick,readConversationDraft,readConversationAfterCoreReconnect,conversationReconnectDraftDifferences,resolveConversationReconnectDraft,saveCheckedConversationDraft,verifyConversationDraft,bindConversation,submitQuickMessage,readQuickChatProgress,restoredDraftMatchesLastSubmission,readPendingConversationSubmission,reserveConversationSubmission,resolveConversationSubmission,cancelPreparedConversationSubmission,readChatOptions,saveChatOptions,renameChat,chatFailureMessage,type ChatOptions,type ChatSource,type ChatAttachment,storedChatSource,chatSourceFromSearch,confirmChatSourceReadback,upsertVerifiedChatSource,sameVerifiedChatSource,terminalQuickChatTurn,verifiedRecoveredChatState,mergeConversationTurns,mergeScopedConversationHistory,conversationSessionIdentity} from './dialog-conversation';

const CHAT_LIST_VIEW_KEY='iwxa-personal-chat-view-062';
function savedChatListView():{collapsed:string[];hideEmpty:boolean;sort:'activity'|'title'}{
 try{
  const data=JSON.parse(window.localStorage.getItem(CHAT_LIST_VIEW_KEY)||'{}');
  return {
   collapsed:Array.isArray(data.collapsed)&&data.collapsed.length<=33
    ?data.collapsed.filter((id:unknown)=>typeof id==='string'&&(id==='ungrouped'||/^grp-[0-9a-f]{32}$/.test(id))):[],
   hideEmpty:data.hideEmpty===true,
   sort:data.sort==='title'?'title':'activity'
  };
 }catch{return {collapsed:[],hideEmpty:false,sort:'activity'}}
}
export function DialogControl({readbackEpoch,onOpenTask,onOpenModels,onOpenTools,onCreateTask,onRegisterCloseFlush}:{readbackEpoch:number;onOpenTask:(taskId:string)=>void;onOpenModels:()=>void;onOpenTools:(toolId?:string)=>void;onCreateTask?:(key:string,messageId:string)=>Promise<void>;onRegisterCloseFlush:(fn:null|(()=>Promise<void>))=>void}){
 const {tr}=useUiSettings();
 const [viewDefaults]=useState(savedChatListView);
 const [catalog,setCatalog]=useState<Row[]>([]),[key,setKey]=useState(LEGACY_CONVERSATION),[loading,setLoading]=useState(true);
 const [catalogReady,setCatalogReady]=useState(false),[catalogAttempt,setCatalogAttempt]=useState(0);
 const [error,setError]=useState(''),[creating,setCreating]=useState(false),[switching,setSwitching]=useState(false);
 const [renaming,setRenaming]=useState(false),[topic,setTopic]=useState('');
 const [groups,setGroups]=useState<ConversationGroup[]>([]);
 const [groupEditor,setGroupEditor]=useState<{kind:'create'|'rename';id?:string}|null>(null);
 const [groupName,setGroupName]=useState('');
 const [groupBusy,setGroupBusy]=useState(false);
 const [groupToDelete,setGroupToDelete]=useState<string|null>(null);
 const [collapsedGroups,setCollapsedGroups]=useState<string[]>(viewDefaults.collapsed);
 const [showAllGroups,setShowAllGroups]=useState<string[]>([]);
 const [renamingKey,setRenamingKey]=useState<string|null>(null);
 const [menu,setMenu]=useState<{kind:'list'|'group'|'chat';id:string;x:number;y:number}|null>(null);
 const [moveOpen,setMoveOpen]=useState(false);
 const [hideEmptyGroups,setHideEmptyGroups]=useState(viewDefaults.hideEmpty);
 const [sortChats,setSortChats]=useState<'activity'|'title'>(viewDefaults.sort);
 useEffect(()=>{
  try{window.localStorage.setItem(CHAT_LIST_VIEW_KEY,JSON.stringify({
   collapsed:collapsedGroups,hideEmpty:hideEmptyGroups,sort:sortChats
  }))}catch{/* UI layout remains usable without local storage. */}
 },[collapsedGroups,hideEmptyGroups,sortChats]);
 const menuRef=useRef<HTMLDivElement|null>(null);
 const menuTriggerRef=useRef<HTMLButtonElement|null>(null);
 const groupActionsBusy=creating||switching||loading||groupBusy||!catalogReady;
 const openActions=(event:MouseEvent<HTMLButtonElement>,kind:'list'|'group'|'chat',id:string)=>{
  if(menu?.kind===kind&&menu.id===id){setMenu(null);return;}
  const rect=event.currentTarget.getBoundingClientRect();
  const width=224;
  const left=rect.right+width+12<window.innerWidth?rect.right+6:Math.max(8,rect.left-width-6);
  const top=Math.max(8,Math.min(rect.top,window.innerHeight-300));
  menuTriggerRef.current=event.currentTarget;setMoveOpen(false);
  setRenaming(false);setGroupEditor(null);setGroupToDelete(null);
  setMenu({kind,id,x:left,y:top});
 };
 useEffect(()=>{
  if(!menu)return;
  const onPointer=(event:PointerEvent)=>{
   const target=event.target;
   if(target instanceof Node&&menuRef.current?.contains(target))return;
   if(target instanceof Element&&target.closest('[data-chat-menu-trigger]'))return;
   setMenu(null);setGroupEditor(null);setRenaming(false);setGroupToDelete(null);
  };
  const onKeyboard=(event:KeyboardEvent)=>{
   if(event.key==='Escape'){
    setMenu(null);setGroupEditor(null);setRenaming(false);setGroupToDelete(null);
    menuTriggerRef.current?.focus();
   }else if((event.key==='ArrowDown'||event.key==='ArrowUp')&&menuRef.current?.contains(document.activeElement)
     &&!(document.activeElement instanceof HTMLInputElement)){
    const choices=Array.from(menuRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    const current=choices.indexOf(document.activeElement as HTMLButtonElement);
    if(choices.length){
     event.preventDefault();
     choices[(current+(event.key==='ArrowDown'?1:-1)+choices.length)%choices.length].focus();
    }
   }
  };
  menuRef.current?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  document.addEventListener('pointerdown',onPointer);
  document.addEventListener('keydown',onKeyboard);
  return()=>{document.removeEventListener('pointerdown',onPointer);document.removeEventListener('keydown',onKeyboard)};
 },[menu]);

 const activeEditor=useRef<null|(()=>Promise<void>)>(null);
 const registerEditor=useCallback((fn:null|(()=>Promise<void>))=>{activeEditor.current=fn},[]);
 const closingStatus=useRef({creating,switching,loading});
 closingStatus.current={creating,switching,loading};
 useEffect(()=>{
  const flush=async()=>{
   if(closingStatus.current.creating||closingStatus.current.switching)
    throw Error('conversation_navigation_not_finished');
   if(activeEditor.current)await activeEditor.current();
   else if(!closingStatus.current.loading)throw Error('conversation_editor_not_ready');
  };
  onRegisterCloseFlush(flush);
  return()=>onRegisterCloseFlush(null);
 },[onRegisterCloseFlush]);

 const loadCatalog=useCallback(async()=>{
  const result=await readGroupedConversationCatalog(runtime);
  setCatalog(result.conversations);setGroups(result.groups);
 },[]);
 useEffect(()=>{
  let alive=true;
  setLoading(true);setCatalogReady(false);
  void readGroupedConversationCatalog(runtime).then(({conversations,groups:loadedGroups,activeKey})=>{
   if(!alive)return;
   setCatalog(conversations);setGroups(loadedGroups);
   // The active conversation belongs to the Core, not a browser-local default.
   setKey(activeKey);setCatalogReady(true);setError('');
  }).catch(e=>{if(alive){setCatalogReady(false);setError(failure(e))}}).finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[catalogAttempt]);
 async function create(groupId:string|null=null){
  if(creating||switching||loading||!catalogReady)return;
  setCreating(true);setError('');
  try{
   const next=newConversationKey();
   if(activeEditor.current)await activeEditor.current();
   await bindConversation(runtime,next);
   await selectConversation(runtime,next);
   if(groupId)await assignConversationGroup(runtime,next,groupId);
   await loadCatalog();
   setKey(next);
  }catch(e){setError(tr('Не удалось подтвердить создание разговора. Проверьте список перед повторением. ','Could not confirm creation. Check the list before retrying. ')+failure(e))}
  finally{setCreating(false)}
 }
 async function saveTopic(){if(!topic.trim()||!renamingKey)return;setSwitching(true);setError('');
  try{await renameChat(runtime,renamingKey,topic);await loadCatalog();setRenaming(false);setRenamingKey(null);setMenu(null)}
  catch(e){setError(failure(e))}finally{setSwitching(false)}
 }
 async function saveGroup(){
  if(groupBusy||!groupEditor||!groupName.trim())return;
  setGroupBusy(true);setError('');
  try{
   if(groupEditor.kind==='create'){
    await createConversationGroup(runtime,groupName);
   }else if(groupEditor.id)await renameConversationGroup(runtime,groupEditor.id,groupName);
   await loadCatalog();setGroupEditor(null);setGroupName('');setMenu(null);
  }catch(e){setError(failure(e))}finally{setGroupBusy(false)}
 }
 async function pinGroup(groupId:string,pinned:boolean){
  if(groupBusy)return;
  setGroupBusy(true);setError('');
  try{await pinConversationGroup(runtime,groupId,pinned);await loadCatalog();setMenu(null)}
  catch(e){setError(failure(e))}finally{setGroupBusy(false)}
 }
 async function removeGroup(groupId:string){
  setGroupBusy(true);setError('');
  try{
   await deleteConversationGroup(runtime,groupId);
   await loadCatalog();setGroupToDelete(null);setMenu(null);
  }catch(e){setError(failure(e))}finally{setGroupBusy(false)}
 }
 async function moveConversation(conversationKey:string,groupId:string|null){
  if(groupBusy||creating||switching)return;
  setGroupBusy(true);setError('');
  try{await assignConversationGroup(runtime,conversationKey,groupId);await loadCatalog();setMenu(null);setMoveOpen(false)}
  catch(e){setError(failure(e))}finally{setGroupBusy(false)}
 }
 async function switchConversation(next:string){
  if(creating||switching||loading||!catalogReady||next===key)return;
  setSwitching(true);setError('');
  try{
   if(activeEditor.current)await activeEditor.current();
   await selectConversation(runtime,next);
   setKey(next);
   await loadCatalog();
  }catch(e){
   setError(tr('Не удалось подтвердить переключение разговора. Текущий разговор оставлен открытым. ','Could not confirm conversation switch. The current conversation stays open. ')+failure(e));
  }finally{setSwitching(false)}
 }
 return <section className="iwxa-chat">
  <header className="iwxa-chat-header"><div><strong>{str(catalog.find(item=>item.conversation_key===key)?.title)
   ||tr('Новый разговор','New conversation')}</strong></div></header>
  {error&&<OwnerError error={error}/>}
  {!loading&&!catalogReady&&<div role="status" className="iwxa-chat-note">
   <p>{tr('История недоступна для чтения. Сохранённые сообщения не изменены.','Conversation history could not be read. Saved messages were not changed.')}</p>
   <button type="button" onClick={()=>setCatalogAttempt(attempt=>attempt+1)}>{tr('Повторить загрузку','Retry loading')}</button>
  </div>}
  <div className="iwxa-chat-with-folders">
   <aside className="iwxa-chat-folders" aria-label={tr('Группы и разговоры','Groups and conversations')}>
    <div className="iwxa-chat-folders-head">
     <strong>{tr('Разговоры','Conversations')}</strong>
     <div className="iwxa-chat-folders-head-actions">
      <button type="button" className="iwxa-chat-folders-new" disabled={groupActionsBusy}
       aria-label={tr('Новый разговор','New conversation')} onClick={()=>void create()}><Plus size={17}/></button>
     <button type="button" className="iwxa-chat-folders-menu-trigger" data-chat-menu-trigger
      aria-label={tr('Настроить список разговоров','Conversation list options')} aria-haspopup="dialog"
      aria-expanded={menu?.kind==='list'} disabled={!catalogReady||groupBusy}
      onClick={e=>openActions(e,'list','list')}><MoreHorizontal size={18}/></button>
     </div>
    </div>
    {[
      ...[...groups].sort((a,b)=>Number(b.pinned)-Number(a.pinned)).map(group=>({id:group.group_id,name:group.name})),
      {id:'ungrouped',name:tr('Без группы','Ungrouped')}
    ].map(group=>{
     const groupId=group.id==='ungrouped'?null:group.id;
     const items=catalog.filter(item=>(item.group_id??null)===groupId)
      .sort(sortChats==='title'?(a,b)=>str(a.title).localeCompare(str(b.title),'ru'):()=>0);
     if(hideEmptyGroups&&!items.length)return null;
     const expanded=!collapsedGroups.includes(group.id);
     return <section key={group.id} className="iwxa-chat-folder">
      <div className="iwxa-chat-folder-head">
       <button type="button" className="iwxa-chat-folder-toggle" aria-expanded={expanded}
        onClick={()=>setCollapsedGroups(previous=>expanded
          ?[...previous,group.id]:previous.filter(id=>id!==group.id))}>
        {expanded?<ChevronDown size={14}/>:<ChevronRight size={14}/>}<Folder size={16}/>
        <span>{group.name}</span></button>
       <button type="button" className="iwxa-chat-folder-more" data-chat-menu-trigger
        disabled={groupActionsBusy} aria-label={tr('Действия с группой','Group actions')+': '+group.name}
        aria-haspopup="dialog" aria-expanded={menu?.kind==='group'&&menu.id===group.id}
        onClick={e=>openActions(e,'group',group.id)}><MoreHorizontal size={17}/></button>
      </div>
      {expanded&&<div className="iwxa-chat-folder-items">
       {(showAllGroups.includes(group.id)?items:items.slice(0,7)).map((item,i)=><div className={'iwxa-chat-folder-entry'+(key===item.conversation_key?' active':'')} key={str(item.conversation_key)}>
        <button type="button" className="iwxa-chat-folder-chat" disabled={groupActionsBusy}
         aria-current={key===item.conversation_key?'page':undefined}
         onClick={()=>void switchConversation(str(item.conversation_key))}>
         {str(item.title)||tr('Разговор ','Conversation ')+(i+1)}</button>
        <button type="button" className="iwxa-chat-entry-more" data-chat-menu-trigger
         aria-label={tr('Действия с разговором','Conversation actions')+': '+(str(item.title)||tr('Без названия','Untitled'))}
         aria-haspopup="dialog" aria-expanded={menu?.kind==='chat'&&menu.id===item.conversation_key}
         disabled={groupActionsBusy} onClick={e=>openActions(e,'chat',str(item.conversation_key))}>
         <MoreHorizontal size={16}/></button>
       </div>)}
       {items.length>7&&<button type="button" className="iwxa-chat-show-more"
        onClick={()=>setShowAllGroups(ids=>ids.includes(group.id)?ids.filter(id=>id!==group.id):[...ids,group.id])}>
        {showAllGroups.includes(group.id)?tr('Свернуть список','Show less'):tr('Показать ещё','Show more')}
       </button>}
      </div>}
     </section>;
    })}
   </aside>
   {!loading&&catalogReady&&<ConversationWorkspace key={key} conversationKey={key} readbackEpoch={readbackEpoch} onOpenTask={onOpenTask} onOpenModels={onOpenModels}
    onOpenTools={onOpenTools} onCreateTask={onCreateTask} onCatalogChanged={loadCatalog} registerBeforeLeave={registerEditor}/>}
  </div>
  {menu&&createPortal(<div className="iwxa-chat-context-menu" ref={menuRef}
   role="dialog" aria-label={menu.kind==='chat'?tr('Действия с разговором','Conversation actions')
     :menu.kind==='group'?tr('Действия с группой','Group actions'):tr('Настройки списка','List settings')}
   style={{left:menu.x,top:menu.y}}>
   {groupEditor?<form className="iwxa-chat-popup-editor" onSubmit={e=>{e.preventDefault();void saveGroup()}}>
     <label>{groupEditor.kind==='create'?tr('Новая группа','New group'):tr('Название группы','Group name')}
      <input autoFocus maxLength={60} value={groupName} disabled={groupBusy}
       onChange={e=>setGroupName(e.target.value)}/></label>
     <div><button type="submit" disabled={!groupName.trim()||groupBusy}>{tr('Сохранить','Save')}</button>
      <button type="button" onClick={()=>{setGroupEditor(null);setMenu(null)}}>{tr('Отмена','Cancel')}</button></div>
    </form>:renaming?<form className="iwxa-chat-popup-editor" onSubmit={e=>{e.preventDefault();void saveTopic()}}>
     <label>{tr('Название разговора','Conversation name')}
      <input autoFocus maxLength={90} value={topic} disabled={switching}
       onChange={e=>setTopic(e.target.value)}/></label>
     <div><button type="submit" disabled={!topic.trim()||switching}>{tr('Сохранить','Save')}</button>
      <button type="button" onClick={()=>{setRenaming(false);setMenu(null)}}>{tr('Отмена','Cancel')}</button></div>
    </form>:groupToDelete?<div className="iwxa-chat-popup-confirm">
     <p>{tr('Удалить группу? Разговоры останутся в разделе «Без группы».','Delete group? Conversations will remain in Ungrouped.')}</p>
     <button type="button" disabled={groupBusy} onClick={()=>void removeGroup(groupToDelete)}>{tr('Удалить группу','Delete group')}</button>
     <button type="button" onClick={()=>setGroupToDelete(null)}>{tr('Отмена','Cancel')}</button>
    </div>:menu.kind==='list'?<>
     <div className="iwxa-chat-popup-heading">{tr('Список разговоров','Conversation list')}</div>
     <button type="button" onClick={()=>{setGroupEditor({kind:'create'});setGroupName('');setHideEmptyGroups(false)}}>
      <Plus size={16}/>{tr('Новая группа','New group')}</button>
     <button type="button" onClick={()=>{setCollapsedGroups([]);setMenu(null)}}>
      <ChevronDown size={16}/>{tr('Развернуть все','Expand all')}</button>
     <button type="button" onClick={()=>{setCollapsedGroups([...groups.map(g=>g.group_id),'ungrouped']);setMenu(null)}}>
      <ChevronRight size={16}/>{tr('Свернуть все','Collapse all')}</button>
     <hr/>
     <button type="button" aria-pressed={hideEmptyGroups} onClick={()=>setHideEmptyGroups(v=>!v)}>
      <span aria-hidden="true">{hideEmptyGroups?'✓':'○'}</span>{tr('Скрывать пустые группы','Hide empty groups')}</button>
     <hr/>
     <button type="button" aria-pressed={sortChats==='activity'} onClick={()=>{setSortChats('activity');setMenu(null)}}>
      {tr('Сначала недавние','Recent first')}</button>
     <button type="button" aria-pressed={sortChats==='title'} onClick={()=>{setSortChats('title');setMenu(null)}}>
      {tr('По названию','By name')}</button>
    </>:menu.kind==='group'?<>
     <div className="iwxa-chat-popup-heading">{menu.id==='ungrouped'?tr('Без группы','Ungrouped')
       :groups.find(group=>group.group_id===menu.id)?.name}</div>
     <div className="iwxa-chat-popup-count">{catalog.filter(item=>
       (item.group_id??null)===(menu.id==='ungrouped'?null:menu.id)).length} {tr('разговоров','conversations')}</div>
     <button type="button" disabled={groupActionsBusy} onClick={()=>{void create(menu.id==='ungrouped'?null:menu.id);setMenu(null)}}>
      <Plus size={16}/>{tr('Новый разговор здесь','New conversation here')}</button>
     {menu.id!=='ungrouped'&&<button type="button" disabled={groupActionsBusy}
      onClick={()=>void pinGroup(menu.id,!(groups.find(g=>g.group_id===menu.id)?.pinned))}>
      <Pin size={16}/>{groups.find(g=>g.group_id===menu.id)?.pinned?tr('Открепить','Unpin'):tr('Закрепить','Pin')}</button>}
     {menu.id!=='ungrouped'&&<button type="button" disabled={groupActionsBusy}
      onClick={()=>{setGroupEditor({kind:'rename',id:menu.id});setGroupName(groups.find(g=>g.group_id===menu.id)?.name||'')}}>
      <Folder size={16}/>{tr('Переименовать','Rename')}</button>}
     <button type="button" onClick={()=>{const id=menu.id;setCollapsedGroups(prev=>prev.includes(id)?prev.filter(x=>x!==id):[...prev,id]);setMenu(null)}}>
      <ChevronRight size={16}/>{collapsedGroups.includes(menu.id)?tr('Развернуть','Expand'):tr('Свернуть','Collapse')}</button>
     {menu.id!=='ungrouped'&&<><hr/>
      <button type="button" className="iwxa-chat-popup-destructive" disabled={groupActionsBusy}
       onClick={()=>setGroupToDelete(menu.id)}>{tr('Удалить группу','Delete group')}</button></>}
    </>:<>
     <div className="iwxa-chat-popup-heading">{str(catalog.find(item=>item.conversation_key===menu.id)?.title)
      ||tr('Разговор','Conversation')}</div>
     <button type="button" onClick={()=>{void switchConversation(menu.id);setMenu(null)}}>
      {tr('Открыть разговор','Open conversation')}</button>
     <button type="button" disabled={groupActionsBusy} onClick={()=>{setRenaming(true);setRenamingKey(menu.id);
      setTopic(str(catalog.find(item=>item.conversation_key===menu.id)?.title))}}>
      {tr('Переименовать','Rename')}</button>
     <button type="button" aria-expanded={moveOpen} disabled={groupActionsBusy}
      onClick={()=>setMoveOpen(v=>!v)}>
      <Folder size={16}/>{tr('Переместить в','Move to')}{moveOpen?<ChevronDown size={15}/>:<ChevronRight size={15}/>}</button>
     {moveOpen&&<div className="iwxa-chat-popup-submenu">
      {[{group_id:'',name:tr('Без группы','Ungrouped')},...groups].map(g=>
       <button type="button" key={g.group_id||'ungrouped'}
        aria-current={(catalog.find(item=>item.conversation_key===menu.id)?.group_id||'')===g.group_id?'true':undefined}
        disabled={groupActionsBusy} onClick={()=>void moveConversation(menu.id,g.group_id||null)}>
        <Folder size={14}/>{g.name}</button>)}
     </div>}
    </>}
  </div>,document.body)}
 </section>;
}

function ConversationWorkspace({conversationKey,readbackEpoch,onOpenTask,onOpenModels,onOpenTools,onCreateTask,onCatalogChanged,registerBeforeLeave}:{conversationKey:string;readbackEpoch:number;onOpenTask:(taskId:string)=>void;onOpenModels:()=>void;onOpenTools:(toolId?:string)=>void;onCreateTask?:(key:string,messageId:string)=>Promise<void>;onCatalogChanged:()=>Promise<void>;registerBeforeLeave:(fn:null|(()=>Promise<void>))=>void}){
 const {tr,language,workMode}=useUiSettings();
 const [state,setState]=useState<Row>({}),[history,setHistory]=useState<Row[]>([]);
 const [query,setQuery]=useState(''),[error,setError]=useState('');
 const [draft,setDraft]=useState(''),[localPin,setLocalPin]=useState<LocalModelPin|null>(null);
 const [options,setOptions]=useState<ChatOptions>({skill_id:null,use_memory:false,use_obsidian:false,use_web:false});
 const [sources,setSources]=useState<ChatSource[]>([]),[attachments,setAttachments]=useState<ChatAttachment[]>([]);
 const [savingSelection,setSavingSelection]=useState(false);
 const [panel,setPanel]=useState<'none'|'model'|'skill'|'sources'|'tools'|'search'|'more'>('none');
 const [skills,setSkills]=useState<Row[]>([]),[matches,setMatches]=useState<Row[]>([]),[noteQuery,setNoteQuery]=useState(''),[noteBusy,setNoteBusy]=useState(false);
 const [toolOutcome,setToolOutcome]=useState('');
 const [ready,setReady]=useState(false),[sending,setSending]=useState(false);
 const [initialLoadFailed,setInitialLoadFailed]=useState(false),[initialLoadAttempt,setInitialLoadAttempt]=useState(0);
 const [reconnectReadAttempt,setReconnectReadAttempt]=useState(0);
 const [reconnectError,setReconnectError]=useState(''),[reconnectReading,setReconnectReading]=useState(false);
 const [reconnectConflict,setReconnectConflict]=useState<null|{saved:Row;fields:string[];signature:string}>(null);
 const [reconnectResolving,setReconnectResolving]=useState(false);
 const reconnectInFlight=useRef(false),reconnectReadSequence=useRef(0);
 const [partialAnswer,setPartialAnswer]=useState('');
 const [quickPending,setQuickPending]=useState('');
 const sendingRef=useRef(false),live=useRef(true),revision=useRef(0);
 // This is a UI snapshot of Core authority, not another Session owner.
 // Remember the exact status associated with the last displayed projection.
 const historyStatus=useRef<Row>({});
 const acceptHistory=(observed:Row,rows:Row[],replace=false)=>{
  const previous=historyStatus.current;
  const previousIdentity=conversationSessionIdentity(previous);
  const nextIdentity=conversationSessionIdentity(observed);
  historyStatus.current=observed;
  setState(observed);
  setHistory(current=>mergeScopedConversationHistory(previous,current,observed,rows,replace));
  if(previousIdentity&&previousIdentity!==nextIdentity){
   // An old generation cannot keep its pending indicator or old
   // submission controls while the new generation is shown.
   setQuickPending('');setPartialAnswer('');
   recoveredPending.current='';pendingAttempt.current=null;
   setRecoveryState('');
  }
 };
 const pendingAttempt=useRef<{signature:string;submissionId:string}|null>(null);
 const recoveredPending=useRef('');
 const [recoveryState,setRecoveryState]=useState('');
 const restoredDuplicatePrompt=useRef('');
 const recoveringAutomatically=useRef(false);
 const snapshot=useRef({text:draft,pin:localPin,sources,attachments,options});
 snapshot.current={text:draft,pin:localPin,sources,attachments,options};
 const saveQueue=useRef<Promise<unknown>>(Promise.resolve());
 // Core's digest is the sole write revision; no browser-owned draft store.
 const draftRevision=useRef('');
 const savedDraftSignature=useRef<string|null>(null);
 const draftSaveBlocked=useRef(false);
 const selectionBusy=useRef(false);
 const editable=()=>{
  const v=snapshot.current;return {text:v.text,model:v.pin,sources:v.sources,attachments:v.attachments};
 };
 const editableSignature=()=>JSON.stringify(editable());
 const saveNow=useCallback(async()=>{
  const current=snapshot.current;
  const operation=saveQueue.current.catch(()=>undefined).then(async()=>{
   if(draftSaveBlocked.current)throw Error('conversation_draft_conflict_unresolved');
   try{
    const saved=await saveCheckedConversationDraft(runtime,conversationKey,draftRevision.current,{
     text:current.text,model:current.pin,sources:current.sources,attachments:current.attachments
    });
    draftRevision.current=str(saved.draft_digest);
    savedDraftSignature.current=JSON.stringify({text:current.text,model:current.pin,sources:current.sources,attachments:current.attachments});
   }catch(error){
    // Do not blind-retry a rejected CAS or a lost acknowledgment.
    // The existing explicit draft conflict control owns the human decision.
    try{
     const saved=await readConversationDraft(runtime,conversationKey);
     const latest=editable();
     const fields=conversationReconnectDraftDifferences(saved,latest);
     if(fields.length){
      draftSaveBlocked.current=true;
      if(live.current)setReconnectConflict({saved,fields,signature:JSON.stringify(latest)});
     }else if(typeof saved.draft_digest==='string'&&/^[0-9a-f]{64}$/.test(saved.draft_digest)){
      draftRevision.current=saved.draft_digest;
     }
    }catch{/* Retain the original uncertain write outcome. */}
    throw error;
   }
  });
  saveQueue.current=operation;
  await operation;
 },[conversationKey]);
 useEffect(()=>{
  const beforeLeave=async()=>{
   if(!ready||sendingRef.current||reconnectInFlight.current||reconnectError||reconnectConflict||reconnectResolving)
    throw Error('conversation_not_ready_to_switch');
   if(workMode==='fast'){
    const before=snapshot.current;
    if(editableSignature()!==savedDraftSignature.current)await saveNow();
    if(editableSignature()!==JSON.stringify({text:before.text,model:before.pin,sources:before.sources,attachments:before.attachments}))
     throw Error('conversation_draft_changed_during_switch');
    return;
   }
   for(let attempt=0;attempt<3;attempt++){
    const before=snapshot.current;
    await saveNow();
    await verifyConversationDraft(runtime,conversationKey,before.text,before.pin,before.sources,before.attachments);
    const current=snapshot.current;
    if(current.text===before.text&&JSON.stringify(current.pin)===JSON.stringify(before.pin)
     &&JSON.stringify(current.sources)===JSON.stringify(before.sources)
     &&JSON.stringify(current.attachments)===JSON.stringify(before.attachments))return;
   }
   throw Error('conversation_draft_changed_during_switch');
  };
  registerBeforeLeave(beforeLeave);
  return()=>registerBeforeLeave(null);
 },[ready,saveNow,conversationKey,registerBeforeLeave,reconnectError,reconnectConflict,reconnectResolving,workMode]);
 const load=useCallback(async()=>{
  const token=++revision.current;
  const quick=await readConversationQuick(runtime,conversationKey);
  if(!live.current||token!==revision.current)return;
  acceptHistory(quick.status,quick.turns);
  const pending=[...quick.turns].reverse().find(item=>item.status==='RUNNING');
  if(pending&&str(pending.message_id))setQuickPending(current=>current||str(pending.message_id));
  void readConversation(runtime,conversationKey).then(result=>{
   if(live.current&&token===revision.current){
    acceptHistory(result.status,result.turns);
   }
  }).catch(e=>{if(live.current&&token===revision.current)setError(failure(e))});
 },[conversationKey]);
 useEffect(()=>{
  live.current=true;
  let active=true;
  setInitialLoadFailed(false);
  void Promise.all([readConversationDraft(runtime,conversationKey),readConversationQuick(runtime,conversationKey),readChatOptions(runtime,conversationKey)])
   .then(([saved,result,storedOptions])=>{if(!active)return;
    if(typeof saved.draft_digest!=='string'||!/^[0-9a-f]{64}$/.test(saved.draft_digest))
     throw Error('conversation_initial_draft_revision_unverified');
    draftRevision.current=saved.draft_digest;draftSaveBlocked.current=false;
    const initialSources=records(saved.knowledge_sources).map(storedChatSource);
    const initialAttachments=records(saved.attachments).map(x=>({name:str(x.name),text:str(x.text)}));
    const initialPin=readLocalModelPin(saved.local_model);
    savedDraftSignature.current=JSON.stringify({text:str(saved.text),model:initialPin,sources:initialSources,attachments:initialAttachments});
    setOptions(storedOptions);
    setSources(initialSources);
    setAttachments(initialAttachments);
    setDraft(str(saved.text));setLocalPin(initialPin);
    const reserved=readPendingConversationSubmission(saved);
    recoveredPending.current=reserved?.submission_id||'';
    if(reserved)void readQuickChatProgress(runtime,conversationKey,reserved.submission_id).then(status=>{
     if(active){setRecoveryState(status.state);if(status.state==='RUNNING')setQuickPending(reserved.submission_id)}
    }).catch(e=>{if(active)setError(failure(e))});
    if(reserved)pendingAttempt.current={signature:JSON.stringify({conversationKey,text:str(saved.text),
     pin:readLocalModelPin(saved.local_model),options:storedOptions,
     sources:records(saved.knowledge_sources),attachments:records(saved.attachments)}),submissionId:reserved.submission_id};
    restoredDuplicatePrompt.current=restoredDraftMatchesLastSubmission(saved.text,result.turns)?str(saved.text).trim():'';
    // The first read unlocks the verified saved draft. Enrich only while
    // no newer terminal result, search or authenticated Core readback has
    // superseded it. Preserve linked Tasks and previously verified turns.
    const bootHistoryRevision=revision.current;
    acceptHistory(result.status,result.turns,true);setReady(true);setInitialLoadFailed(false);setError('');
    const pending=[...result.turns].reverse().find(item=>item.status==='RUNNING');
    if(pending)setQuickPending(str(pending.message_id));
    void readConversation(runtime,conversationKey).then(full=>{
     if(active&&bootHistoryRevision===revision.current){
      acceptHistory(full.status,full.turns);
     }
    }).catch(e=>{if(active&&bootHistoryRevision===revision.current)setError(failure(e))});
   }).catch(e=>{if(active){setInitialLoadFailed(true);setError(failure(e))}});
  return()=>{active=false;live.current=false;revision.current++};
 // Retry only the initial read; do not resubmit any message.
 // eslint-disable-next-line react-hooks/exhaustive-deps
 },[conversationKey,initialLoadAttempt]);
 useEffect(()=>{
  if(!ready||reconnectReading||reconnectError||reconnectConflict||reconnectResolving)return;
  // Persist only after a short pause. Send/switch explicitly flush the latest
  // draft through saveNow, preserving verified recovery without one fsync per key.
  const timer=window.setTimeout(()=>{
   if(!sendingRef.current&&!reconnectInFlight.current&&!reconnectError&&!reconnectConflict&&!reconnectResolving)
    void saveNow().catch(e=>{if(live.current)setError(failure(e))});
  },450);
  return()=>window.clearTimeout(timer);
 },[ready,draft,localPin,sources,attachments,saveNow,reconnectReading,reconnectError,reconnectConflict,reconnectResolving]);
 // A renewed Core session is a readback boundary for the open dialogue,
 // just as it is for the selected Task. Keep the user's current composer;
 // only Core-owned history and the exact previous submission are reread.
 useEffect(()=>{
  if(!readbackEpoch||!ready)return;
  let active=true;
  revision.current++; // Supersede any stale background history load.
  const token=++reconnectReadSequence.current;
  reconnectInFlight.current=true;
  setReconnectReading(true);setReconnectError('');setReconnectConflict(null);
  const previousId=recoveredPending.current||quickPending
   ||pendingAttempt.current?.submissionId||'';
  void readConversationAfterCoreReconnect(runtime,conversationKey,previousId)
   .then(result=>{
    if(!active||!live.current||token!==reconnectReadSequence.current)return;
    const local=editable();
    const fields=conversationReconnectDraftDifferences(result.draft,local);
    draftSaveBlocked.current=fields.length>0;
    if(!fields.length)draftRevision.current=str(result.draft.draft_digest);
    setReconnectConflict(fields.length?{saved:result.draft,fields,signature:JSON.stringify(local)}:null);
    acceptHistory(result.history.status,result.history.turns);
    if(result.reserved){
     recoveredPending.current=result.pendingId;
     // Existing recovery controls own the Core's saved draft reservation.
     setRecoveryState(result.pendingState);
    }else if(result.pendingId&&result.pendingState==='RUNNING'){
     // Core owns this RUNNING turn, so a stale UI reservation is no longer
     // authoritative. The pending turn still blocks concurrent inference.
     recoveredPending.current='';pendingAttempt.current=null;
     setRecoveryState('RUNNING');
    }else if(result.pendingId){
     // Only exact durable terminal history permits dropping a stale local
     // submission pointer. No command or new model call is issued here.
     recoveredPending.current='';pendingAttempt.current=null;
     setRecoveryState('');
    }
    if(result.pendingState==='RUNNING')setQuickPending(result.pendingId);
    else if(result.pendingId&&result.pendingState!=='PREPARED')setQuickPending('');
    setPartialAnswer('');
    setReconnectError('');
   })
   .catch(e=>{
    if(active&&live.current&&token===reconnectReadSequence.current)
     setReconnectError(tr(
      'После восстановления Core история диалога не подтверждена. Проверьте её повторно, сообщение не отправлялось. ',
      'Conversation history was not verified after Core reconnect. Recheck it; no message was sent. ')+failure(e));
   }).finally(()=>{
    if(active&&live.current&&token===reconnectReadSequence.current){
     reconnectInFlight.current=false;setReconnectReading(false);
    }
   });
  return()=>{active=false;reconnectInFlight.current=false;};
 },[readbackEpoch,reconnectReadAttempt,ready,conversationKey,tr]);

 useEffect(()=>{
  if(!quickPending||reconnectInFlight.current||reconnectReading||reconnectError
     ||reconnectConflict||reconnectResolving)return;
  let active=true,timeout:number|undefined;
  let failures=0;
  // One request at a time. Core must not receive overlapping progress
  // observations or duplicate model submissions on a slow machine.
  async function poll(){
   try{
    const value=await readQuickChatProgress(runtime,conversationKey,quickPending);
    if(!active)return;
    failures=0;setPartialAnswer(value.partialText);
    if(value.state!=='RUNNING'){
     // A terminal status does not yet prove the React history was refreshed.
     // Keep polling the *same* submission until its durable turn is visible.
     const confirmed=await readConversationQuick(runtime,conversationKey);
     if(!active)return;
     if(terminalQuickChatTurn(quickPending,confirmed.turns)!==value.state)
      throw Error('chat_terminal_history_not_ready');
     // Keep linked Tasks visible while the full mixed history reloads.
     // An earlier slow load is not allowed to replace terminal readback.
     const terminalVersion=++revision.current;
     acceptHistory(confirmed.status,confirmed.turns);
     setQuickPending('');setPartialAnswer('');
     if(value.state==='COMPLETED')setError('');
     void readConversation(runtime,conversationKey).then(full=>{
      if(active&&revision.current===terminalVersion
         &&terminalQuickChatTurn(quickPending,full.turns)===value.state){
       acceptHistory(full.status,full.turns);
      }
     }).catch(()=>{/* The verified quick turn remains visible. */});
     void onCatalogChanged().catch(e=>{if(active)setError(failure(e))});
     if(value.state!=='COMPLETED')setError(tr(
      'Ответ не завершён. Сообщение сохранено. Новый вызов модели не запускался.',
      'Reply not completed. The message was saved; model execution was not retried.'));
     return;
    }
   }catch(e){
    if(!active)return;
    failures+=1;
    // A transport error is not evidence that a model stopped. Keep the
    // submission bound; never resend while status is uncertain.
    if(failures===3)setError(tr(
     'Связь с Core временно потеряна. Проверяем прежнюю отправку без повторного запуска.',
     'Core connection interrupted. Rechecking the original submission without retrying.'));
   }
   if(active)timeout=window.setTimeout(()=>void poll(),Math.min(12000,900*Math.pow(2,Math.min(failures,4))));
  }
  void poll();
  return()=>{active=false;if(timeout!==undefined)window.clearTimeout(timeout)};
 },[quickPending,conversationKey,load,onCatalogChanged,tr,readbackEpoch,
    reconnectReading,reconnectError,reconnectConflict,reconnectResolving]);
 const {run,busy,message}=useOwnerActions(async()=>{await load();await onCatalogChanged()});
 const hasSession=!!str(record(state.session).session_id),paused=record(state.session).state==='PAUSED';
 async function acceptQuickDelivery(submissionId:string,state:string,_original:string){
  // The Core acknowledgement/status refers to the original immutable turn.
  // No resend or Task creation takes place while the GUI restores it.
  // The reserved submission must be resolved in the Core before the local
  // transport reference disappears. A lost ACK never authorizes another ID.
  await saveNow();
  const before=await readConversationDraft(runtime,conversationKey);
  const after=await resolveConversationSubmission(runtime,conversationKey,submissionId);
  draftRevision.current=str(after.draft_digest);
  const current=snapshot.current;
  if(conversationDraftMatches(before,current.text,current.pin,current.sources,current.attachments)){
   const text=str(after.text);
   const nextSources=records(after.knowledge_sources) as ChatSource[];
   const nextAttachments=records(after.attachments) as ChatAttachment[];
   snapshot.current={...current,text,sources:nextSources,attachments:nextAttachments};
   setDraft(text);setSources(nextSources);setAttachments(nextAttachments);
  }else{
   // An edit made during readback belongs to the user, even if text is unchanged.
   await saveNow();
  }
  pendingAttempt.current=null;recoveredPending.current='';setRecoveryState('');
  setQuickPending(state==='RUNNING'?submissionId:'');
  setPartialAnswer('');
  void readConversationQuick(runtime,conversationKey).then(result=>{
   if(live.current)acceptHistory(result.status,result.turns);
  }).catch(e=>{if(live.current)setError(failure(e))});

 }
 useEffect(()=>{
  const id=recoveredPending.current;
  if(!ready||!id||recoveryState==='PREPARED'||!recoveryState
    ||reconnectInFlight.current||reconnectError||reconnectConflict||reconnectResolving
    ||sendingRef.current||recoveringAutomatically.current)return;
  let alive=true;
  recoveringAutomatically.current=true;
  void (async()=>{
   try{
    // Read ONLY: status and durable, conversation-scoped history.
    const status=await readQuickChatProgress(runtime,conversationKey,id);
    if(!alive||status.state==='PREPARED')return;
    const stored=await readConversationQuick(runtime,conversationKey);
    if(!alive||verifiedRecoveredChatState(id,stored.turns)!==status.state)return;
    // Write all locally edited draft fields BEFORE clearing the original
    // reservation. If the user typed while Core was recovering, resolving
    // the old submission must not erase their newer, unsent text.
    await saveNow();
    if(!alive)return;
    const before=await readConversationDraft(runtime,conversationKey);
    if(!alive||readPendingConversationSubmission(before)?.submission_id!==id)return;
    const after=await resolveConversationSubmission(runtime,conversationKey,id);
    if(!alive)return;
    draftRevision.current=str(after.draft_digest);
    // Preserve any newer user edits; the exact Core composer remains owner.
    const current=snapshot.current;
    if(conversationDraftMatches(before,current.text,current.pin,current.sources,current.attachments)){
     const nextSources=records(after.knowledge_sources).map(storedChatSource);
     const nextAttachments=records(after.attachments).map(v=>({name:str(v.name),text:str(v.text)}));
     snapshot.current={...current,text:str(after.text),sources:nextSources,attachments:nextAttachments};
     setDraft(str(after.text));setSources(nextSources);setAttachments(nextAttachments);
    }else{
     // The user typed during the readback. Save that newer draft before
     // unlocking the composer for another message; never replay the model.
     await saveNow();
     if(!alive)return;
    }
    pendingAttempt.current=null;recoveredPending.current='';setRecoveryState('');
    setQuickPending(status.state==='RUNNING'?id:'');
    acceptHistory(stored.status,stored.turns);
   }catch(error){
    if(alive)setError(tr('Не удалось подтвердить сохранённую отправку. Проверьте её вручную. ',
     'Could not verify the saved submission. Review it manually. ')+failure(error));
   }finally{recoveringAutomatically.current=false;}
  })();
  return()=>{alive=false;};
 },[ready,recoveryState,conversationKey,tr,saveNow,reconnectError,reconnectConflict,reconnectResolving]);

 async function resolveReconnectConflict(choice:'saved'|'local'){
  const conflict=reconnectConflict;
  if(!conflict||reconnectInFlight.current||reconnectResolving||reconnectError)return;
  if(editableSignature()!==conflict.signature){
   setReconnectError(tr('Черновик изменился. Обновите проверку.','Draft changed. Recheck saved state.'));return;
  }
  setReconnectResolving(true);
  try{
   await saveQueue.current.catch(()=>undefined);
   const local=editable();
   if(JSON.stringify(local)!==conflict.signature)throw Error('chat_reconnect_local_draft_changed');
   const restored=await resolveConversationReconnectDraft(runtime,conversationKey,conflict.saved,choice,local);
   if(!live.current)return;
   draftRevision.current=str(restored.draft_digest);draftSaveBlocked.current=false;
   if(choice==='saved'){
    const value={text:str(restored.text),pin:readLocalModelPin(restored.local_model),
     sources:records(restored.knowledge_sources).map(storedChatSource),
     attachments:records(restored.attachments).map(v=>({name:str(v.name),text:str(v.text)}))};
    snapshot.current={...snapshot.current,...value};
    setDraft(value.text);setLocalPin(value.pin);
    setSources(value.sources);setAttachments(value.attachments);
   }
   setReconnectConflict(null);setReconnectError('');
  }catch(e){if(live.current)setReconnectError(tr(
   'Согласование не подтверждено. Проверьте сохранённый черновик повторно. ',
   'Reconciliation was not confirmed. Recheck the saved draft. ')+failure(e));}
  finally{if(live.current)setReconnectResolving(false);}
 }
 async function recoverSubmission(){
  const id=recoveredPending.current;
  if(!id||reconnectInFlight.current||reconnectError||reconnectConflict||reconnectResolving
     ||sendingRef.current||recoveringAutomatically.current)return;
  sendingRef.current=true;setSending(true);setError('');
  try{
   const status=await readQuickChatProgress(runtime,conversationKey,id);
   setRecoveryState(status.state);
   if(status.state==='PREPARED'){
    const saved=await readConversationDraft(runtime,conversationKey);
    const pending=readPendingConversationSubmission(saved);
    if(!pending||pending.submission_id!==id||saved.draft_digest!==pending.draft_digest)
     throw Error('chat_prepared_draft_changed');
    const actual=await readChatOptions(runtime,conversationKey);
    const selected=pending.context_options||actual;
    // Older markers require explicit confirmation of current options.
    // Explicitly reconfirm the current options rather than silently substituting them.
    const enabled=(value:boolean)=>value?tr('да','yes'):tr('нет','no');
    if(!window.confirm((pending.context_options
      ?tr('Продолжить с исходными сохранёнными параметрами?\n',
          'Continue with the original saved options?\n')
      :tr('Исходные параметры не сохранены. Продолжить с текущими параметрами?\n',
          'Original options were not saved. Continue with current options?\n'))+
     tr('Навык: ','Skill: ')+(selected.skill_id||tr('не выбран','none'))+'\n'+
     tr('Память: ','Memory: ')+enabled(selected.use_memory)+'\n'+
     'Obsidian: '+enabled(selected.use_obsidian)+'\n'+
     tr('Поиск в интернете: ','Web search: ')+enabled(selected.use_web)))return;
    const ack=await submitQuickMessage(runtime,conversationKey,str(saved.text),
     readLocalModelPin(saved.local_model),id,selected,
     records(saved.knowledge_sources).map(storedChatSource),
     records(saved.attachments).map(x=>({name:str(x.name),text:str(x.text)})));
    await acceptQuickDelivery(id,ack.state,str(saved.text));
   }else await acceptQuickDelivery(id,status.state,str((await readConversationDraft(runtime,conversationKey)).text));
   await load();await onCatalogChanged();
  }catch(e){setError(tr('Не удалось подтвердить состояние отправки. Проверьте историю перед продолжением. ',
    'Could not verify the submission state. Check history before continuing. ')+failure(e))}
  finally{sendingRef.current=false;setSending(false)}
 }
 async function cancelPrepared(){
  const id=recoveredPending.current;
  if(!id||recoveryState!=='PREPARED'||reconnectInFlight.current||reconnectError||reconnectConflict||reconnectResolving||sendingRef.current)return;
  if(!window.confirm(tr('Отменить подготовленную отправку и сохранить текст?',
   'Cancel the prepared submission and keep the draft?')))return;
  sendingRef.current=true;setSending(true);setError('');
  try{
   await saveQueue.current;
   const cancelled=await cancelPreparedConversationSubmission(runtime,conversationKey,id);
   draftRevision.current=str(cancelled.draft_digest);
   recoveredPending.current='';pendingAttempt.current=null;setRecoveryState('');
  }catch(e){setError(failure(e))}
  finally{sendingRef.current=false;setSending(false)}
 }
 async function send(){
  if(!ready||reconnectInFlight.current||reconnectError||reconnectConflict||reconnectResolving||!draft.trim()
     ||sendingRef.current||quickPending||recoveredPending.current)return;
  if(sources.some(source=>!source.provider_id||!source.binding_digest)){
   setPanel('sources');
   setError(tr('Подключение выбранной заметки изменилось или ещё не проверено. Удалите заметку и добавьте её повторно перед отправкой.',
    'A selected note does not have a verified source connection. Remove and reselect it before sending.'));
   return;
  }
  // Reopening after an ACK loss may leave the already-sent prompt in its
  // saved draft. Show the actual saved turn and ask before another send.
  if(restoredDuplicatePrompt.current===draft.trim()&&!pendingAttempt.current){
   const approved=window.confirm(tr(
    'Похожее сообщение уже сохранено в истории. Отправить его ещё раз?',
    'This message is already in the saved history. Send it again?'));
   if(!approved)return;
   restoredDuplicatePrompt.current='';
  }
  sendingRef.current=true;setSending(true);setError('');
  const original=draft;let dispatched=false,confirmed=false;
  const signature=JSON.stringify({conversationKey,text:original,pin:localPin,options,sources,attachments});
  const existing=pendingAttempt.current;
  // If the user changed a draft after an unknown delivery result, resolve
  // that older ID first. Never silently allocate a second model request.
  if(existing&&existing.signature!==signature){
   try{
    const status=await readQuickChatProgress(runtime,conversationKey,existing.submissionId);
    recoveredPending.current=existing.submissionId;setRecoveryState(status.state);
    setQuickPending(status.state==='RUNNING'?existing.submissionId:'');
    await load();
    setError(status.state==='RUNNING'
     ?tr('Предыдущее сообщение уже принято. Проверьте его ответ перед новой отправкой.',
       'The previous message was accepted. Review its reply before sending another.')
     :tr('Предыдущая отправка найдена в истории. Проверьте результат, затем подтвердите новый запрос.',
       'The previous submission is in history. Review it before sending another request.'));
   }catch(e){setError(tr(
    'Не удалось проверить предыдущую отправку. Не отправляйте новый запрос до восстановления связи. ',
    'Unable to verify the earlier submission. Avoid sending a new request until connection is restored. ')+failure(e))}
   finally{sendingRef.current=false;setSending(false)}
   return;
  }
  const submissionId=existing?.signature===signature?existing.submissionId:crypto.randomUUID().replace(/-/g,'');
  try{
   if(!existing){
    // Observe local GGUF readiness before reserving the message.
    // This read-only check is UX, never invocation authority. Core repeats
    // the exact-model validation after the request arrives.
    const route=record(await runtime.query<Row>('operational_control'));
    if(route.active_model_provider_id==='IWXA_BASIC_RUNTIME_V1'){
     const basic=record(await runtime.query<Row>('iwxa_basic_model_status'));
     const observed=readLocalModelPin(basic.pin);
     if(basic.ready!==true||basic.active!==true||!observed){
      setError(tr('Модель IWXA не готова. Откройте «Модели», запустите GGUF и проверьте ответ. Сообщение осталось в редакторе.',
       'The IWXA model is not ready. Open Models, start the GGUF and check its answer. Your message remains in the editor.'));
      return;
     }
     if(localPin&&(localPin.name!==observed.name||localPin.digest!==observed.digest)){
      setError(tr('GGUF-модель в черновике отличается от запущенной. Обновите выбор в диалоге. Сообщение не отправлялось.',
       'The GGUF in this draft differs from the active model. Refresh your selection. No message was submitted.'));
      return;
     }
    }
   }
   pendingAttempt.current={signature,submissionId};
   await saveNow();
   await reserveConversationSubmission(runtime,conversationKey,submissionId,original,
    localPin,sources,attachments,options);
   // The message has an exact idempotency key. A failed transport ACK is
   // resolved by status readback before considering a second submission.
   dispatched=true;
   const ack=await submitQuickMessage(runtime,conversationKey,original,localPin,submissionId,options,sources,attachments);
   confirmed=true;
   await acceptQuickDelivery(submissionId,ack.state,original);
  }catch(e){
   if(dispatched&&!confirmed){
    try{
     const status=await readQuickChatProgress(runtime,conversationKey,submissionId);
     confirmed=true;
     if(status.state==='PREPARED'){
      recoveredPending.current=submissionId;setRecoveryState('PREPARED');return;
     }
     await acceptQuickDelivery(submissionId,status.state,original);
     await load();await onCatalogChanged();
     setError(status.state==='RUNNING'?tr(
      'Сообщение принято. Проверяем исходный ответ без повторного запуска модели.',
      'Message accepted. Checking the existing reply without running the model again.')
      :status.state==='COMPLETED'?'':tr(
       'Сообщение сохранено, но ответ не завершён. Проверьте историю перед продолжением.',
       'Message saved, but the reply did not finish. Review history before continuing.'));
     return;
    }catch(lookupError){
     setError(confirmed?tr(
      'Сообщение принято, но обновление черновика или истории не подтверждено. ',
      'The message was accepted, but draft or history readback was not verified. ')+failure(lookupError)
      :tr('Результат отправки неизвестен. Сохраняем идентификатор, повторного запуска нет. ',
       'Delivery is uncertain. The original message identity is retained; no retry was issued. ')+failure(lookupError));
     return;
    }
   }
   setError((confirmed
    ?tr('Сообщение принято, но обновление черновика или истории не подтверждено. ',
      'The message was accepted, but draft or history readback was not verified. ')
    :tr('Сообщение не отправлено. ','Message not sent. '))+failure(e));
  }finally{sendingRef.current=false;setSending(false)}
 }
 async function search(){
  // Only the latest explicit query may determine which saved turns are shown.
  // This also invalidates a delayed startup/full-history projection.
  const token=++revision.current;
  try{
   const response=await readConversation(runtime,conversationKey,query);
   if(live.current&&token===revision.current){
    acceptHistory(response.status,response.turns,true);setError('');
   }
  }catch(e){if(live.current&&token===revision.current)setError(failure(e))}
 }
 async function begin(){
  if(reconnectInFlight.current||reconnectError||reconnectConflict||reconnectResolving)return;
  try{await bindConversation(runtime,conversationKey);await load();await onCatalogChanged()}
  catch(e){setError(failure(e))}
 }
 async function modify(action:string,input:Row){
  if(reconnectInFlight.current||reconnectError||reconnectConflict||reconnectResolving)return;
  const replaceContext=action==='recycle'||action==='clear';
  if(replaceContext&&(sendingRef.current||quickPending||recoveredPending.current
     ||pendingAttempt.current||reconnectReading)){
   setError(tr('Сначала дождитесь ответа или разрешите сохранённую отправку.',
    'Wait for the reply or resolve the saved submission before changing context.'));
   return;
  }
  const answer=await run<Row>(tr('Подтвердить изменение разговора?','Confirm conversation change?'),
   'session_'+action,{conversation_key:conversationKey,...input});
  if(answer&&replaceContext){
   try{
    // A successful Core reset immediately removes the former generation
    // from the screen, even if the subsequent history read is unavailable.
    const confirmedSession=record(answer.session);
    conversationSessionIdentity({session:confirmedSession});
    acceptHistory({session:confirmedSession},[],true);
    setError('');
    await load();
    await onCatalogChanged();
   }catch(e){if(live.current)setError(tr(
    'Контекст изменён, но новое состояние не прочитано. Повторите загрузку истории. ',
    'Context changed but its new history could not be read. Reload the history. ')+failure(e))}
  }
 }
 async function updateOptions(next:ChatOptions){
  if(reconnectInFlight.current||reconnectError||reconnectConflict||reconnectResolving)return;
  const old=options;setOptions(next);
  try{await saveChatOptions(runtime,conversationKey,next)}catch(e){setOptions(old);setError(failure(e))}
 }
 useEffect(()=>{if(panel!=='skill'||skills.length)return;
  void runtime.query<Row>('task_skills').then(d=>setSkills(records(record(d).skills))).catch(e=>setError(failure(e)));
 },[panel,skills.length]);
 async function searchNotes(){if(!noteQuery.trim())return;setNoteBusy(true);setError('');
  try{const result=record(await runtime.query<Row>('knowledge_search',{query:noteQuery.trim(),limit:20}));setMatches(records(result.results))}
  catch(e){setError(failure(e))}finally{setNoteBusy(false)}
 }
 async function commitSelection(nextSources:ChatSource[],nextAttachments:ChatAttachment[]){
  if(!ready||reconnectInFlight.current||reconnectError||reconnectConflict||reconnectResolving
     ||sendingRef.current||selectionBusy.current)return;
  // The selector must be committed before it appears as saved in the UI.
  // A window close immediately after a selection must not depend on the
  // typing debounce. Use the same serialized Composer owner, not a new store.
  selectionBusy.current=true;setSavingSelection(true);
  const previous=snapshot.current;
  snapshot.current={...previous,sources:nextSources,attachments:nextAttachments};
  try{
   await saveNow();
   const saved=await readConversationDraft(runtime,conversationKey);
   if(JSON.stringify(saved.knowledge_sources)!==JSON.stringify(nextSources)
      ||JSON.stringify(saved.attachments)!==JSON.stringify(nextAttachments))
    throw Error('conversation_selection_readback_mismatch');
   if(live.current){setSources(nextSources);setAttachments(nextAttachments);setError('')}
  }catch(e){
   // Roll back only the selector, preserving any text typed during the save.
   snapshot.current={...snapshot.current,sources:previous.sources,attachments:previous.attachments};
   if(live.current)setError(tr('Не удалось сохранить выбранные источники. Повторите выбор. ',
    'Could not save selected sources. Try again. ')+failure(e));
  }finally{
   selectionBusy.current=false;
   if(live.current)setSavingSelection(false);
  }
 }
 async function addNote(note:Row){
  const notePath=str(note.path)||str(note.relative_path);
  // An existing path can be reselected even when eight slots are filled:
  // the verified new vault binding replaces the previous selector.
  if(attachments.length||(sources.length>=8&&!sources.some(source=>source.path===notePath)))return;
  setNoteBusy(true);
  try{
   const selected=chatSourceFromSearch(note);
   const verified=await runtime.query<Row>('knowledge_source',{
    path:selected.path,expected_sha256:selected.expected_sha256,
    provider_id:selected.provider_id,binding_digest:selected.binding_digest
   });
   confirmChatSourceReadback(selected,verified);
   const current=snapshot.current.sources;
   // Re-selection replaces an older source binding; it never silently
   // borrows the previous vault's identity or retains a stale selector.
   const previous=current.find(x=>x.path===selected.path&&x.expected_sha256===selected.expected_sha256);
   if(!previous||!sameVerifiedChatSource(previous,selected)||previous.title!==selected.title)
    await commitSelection(upsertVerifiedChatSource(current,selected),snapshot.current.attachments);
  }catch(e){setError(failure(e))}finally{setNoteBusy(false)}
 }
 async function addFiles(list:FileList|null){if(!list)return;
  const files:ChatAttachment[]=[];
  for(const f of Array.from(list)){
   if(!/\.(txt|md|csv|json)$/i.test(f.name)){setError(tr('Поддерживаются текстовые файлы: txt, md, csv, json.','Only text files are supported.'));return}
   files.push({name:f.name,text:await f.text()});
  }
  if(attachments.length+files.length>8||new TextEncoder().encode([...attachments,...files].map(f=>f.text).join('')).length>48000){
   setError(tr('Не более 8 файлов и 48 КБ текста.','Maximum 8 files and 48 KB of text.'));return}
  await commitSelection([],[...snapshot.current.attachments,...files]);
 }
 function navigateAfterSave(next:()=>void){
  if(reconnectInFlight.current||reconnectError||reconnectConflict||reconnectResolving)return;
  void saveNow().then(next).catch(e=>setError(tr('Черновик не подтверждён. Повторите сохранение. ','Draft not confirmed. Retry saving. ')+failure(e)));
 }
 const skillNames:Record<string,[string,string]>={
  'triage-and-extract':['Разобраться в запросе','Understand a request'],
  'planning-and-prioritization':['Составить план','Plan and prioritize'],
  'document-understanding':['Разобрать документ','Understand a document'],
  'comparison-and-decision':['Сравнить варианты','Compare options'],
  'communication-drafting':['Подготовить текст','Draft a text'],
  'commitments-and-followup':['Договорённости','Commitments and follow-up'],
  'administrative-preparation':['Подготовить документы','Prepare paperwork'],
  'learning-and-review':['Учиться и повторять','Learn and review']
 };
 const skillLabel=(id:string)=>skillNames[id]?tr(skillNames[id][0],skillNames[id][1]):id;
 async function attachReadEvidence(destination:'task'|'dialogue',receiptId:string,data:unknown){
  if(destination!=='dialogue'||!ready||reconnectInFlight.current||reconnectError||reconnectConflict||reconnectResolving
     ||sendingRef.current||selectionBusy.current||recoveredPending.current)
   throw Error('conversation_tool_attachment_unavailable');
  selectionBusy.current=true;setSavingSelection(true);setToolOutcome('');
  const before=snapshot.current;
  try{
   // Serialize the same Core-owned draft before attempting a receipt-bound
   // append. The tool already ran once; this call never re-invokes it.
   await saveNow();
   const persisted=await readConversationDraft(runtime,conversationKey);
   if(!conversationDraftMatches(persisted,before.text,before.pin,before.sources,before.attachments)
      ||readPendingConversationSubmission(persisted))
    throw Error('conversation_tool_draft_changed');
   if(typeof persisted.draft_digest!=='string'||!/^[0-9a-f]{64}$/.test(persisted.draft_digest))
    throw Error('conversation_tool_draft_unavailable');
   const result=record(await runtime.command<Row>('tool_read_attach_to_draft',{
    destination:'dialogue',conversation_key:conversationKey,receipt_id:receiptId,
    data,expected_draft_digest:persisted.draft_digest,confirmed:true
   }));
   const after=await readConversationDraft(runtime,conversationKey);
   const attached=records(after.attachments).map(item=>({name:str(item.name),text:str(item.text)}));
   if(result.destination!=='dialogue'||result.conversation_key!==conversationKey
      ||result.receipt_id!==receiptId||typeof result.attachment_name!=='string'
      ||after.state!=='SAVED'||after.draft_digest!==result.draft_digest
      ||!attached.some(item=>item.name===result.attachment_name)
      ||!conversationDraftMatches(after,before.text,before.pin,before.sources,attached))
    throw Error('conversation_tool_receipt_readback_mismatch');
   draftRevision.current=str(after.draft_digest);
   // The user's subsequent typing is authoritative. Preserve it while
   // merging the verified evidence from the same SessionRuntime composer.
   const latest=snapshot.current;
   if(JSON.stringify(latest.attachments)!==JSON.stringify(before.attachments))
    throw Error('conversation_tool_attachments_changed_during_transfer');
   snapshot.current={...latest,attachments:attached};
   setAttachments(attached);
   if(!conversationDraftMatches(after,latest.text,latest.pin,latest.sources,attached)){
    await saveNow();
    await verifyConversationDraft(runtime,conversationKey,
      snapshot.current.text,snapshot.current.pin,snapshot.current.sources,snapshot.current.attachments);
   }
   setToolOutcome(tr('Проверенный результат добавлен в этот диалог. Можно задать вопрос.',
     'The verified result is attached to this conversation. You can ask about it.'));
   setPanel('none');
  }catch(err){
   setError(tr('Добавление источника не подтверждено. Проверьте сохранённый черновик и квитанцию перед повтором. ',
    'Source attachment was not verified. Review the saved draft and receipt before retrying. ')+failure(err));
   throw err;
  }finally{
   selectionBusy.current=false;
   if(live.current)setSavingSelection(false);
  }
 }
 const toggle=(name:typeof panel)=>setPanel(old=>old===name?'none':name);
 return <div className="iwxa-chat-room">
  {error&&<OwnerError error={error}/>}
  {reconnectReading&&<p role="status" className="iwxa-chat-note">{tr(
   'Восстанавливаем сохранённую историю и исход отправки без повторного ответа модели.',
   'Restoring saved history and submission status without restarting the model.')}</p>}
  {reconnectError&&<div className="iwxa-chat-note" role="alert">
   <p>{reconnectError}</p>
   <button type="button" onClick={()=>setReconnectReadAttempt(n=>n+1)}>
    {tr('Повторить проверку истории','Recheck history')}</button>
  </div>}
  {reconnectConflict&&<section className="iwxa-chat-note" role="group" aria-label={tr('Версии черновика','Draft versions')}>
    <strong>{tr('Обнаружены разные редакции черновика','Two draft revisions were found')}</strong>
    <p>{tr('Выберите версию перед продолжением. История ответов не изменена.',
      'Choose a draft before continuing. Saved replies were not changed.')}</p>
    <p>{tr('Различия: ','Differences: ')+reconnectConflict.fields.join(', ')}</p>
    <details><summary>{tr('Сохранённый текст','Saved text')}</summary>
     <pre>{str(reconnectConflict.saved.text)}</pre></details>
    <button type="button" disabled={reconnectResolving||!!reconnectError}
     onClick={()=>void resolveReconnectConflict('saved')}>{tr('Использовать сохранённый','Use saved draft')}</button>
    <button type="button" disabled={reconnectResolving||!!reconnectError}
     onClick={()=>void resolveReconnectConflict('local')}>{tr('Сохранить открытый','Save open draft')}</button>
  </section>}
  {message&&<OwnerMessage>{message}</OwnerMessage>}
  <div className="iwxa-chat-thread">
   {history.length===0&&ready&&!quickPending&&<div className="iwxa-chat-empty"><div className="iwxa-chat-mark">IX</div>
    <h2>{tr('Чем займёмся?','What shall we work on?')}</h2>
    <p>{tr('Задайте вопрос или выберите пример. Модель, навыки и источники находятся рядом с полем ввода.','Ask a question or choose an example. Model, skills and sources are next to the composer.')}</p>
    <div className="iwxa-chat-examples">{[
     [tr('План работы','Work plan'),tr('Составь план работы на завтра с тремя приоритетами.','Plan tomorrow with three priorities.')],
     [tr('Сравнить варианты','Compare options'),tr('Помоги сравнить два варианта с учётом рисков.','Compare two options and their risks.')],
     [tr('Разобраться в вопросе','Explore a topic'),tr('Почему трава зелёная?','Why is grass green?')]
    ].map(([title,value])=><button key={title} type="button"
       disabled={reconnectReading||!!reconnectError||!!reconnectConflict||reconnectResolving}
       onClick={()=>{snapshot.current={...snapshot.current,text:value};setDraft(value)}}>{title}</button>)}</div>
   </div>}
   {!ready&&<div className="iwxa-chat-note" role="status">
    <p>{initialLoadFailed?tr('История и черновик пока не подтверждены.','History and draft are not yet verified.'):tr('Открываем историю...','Opening history...')}</p>
    {initialLoadFailed&&<button type="button" onClick={()=>{setError('');setInitialLoadFailed(false);setInitialLoadAttempt(n=>n+1)}}>{tr('Повторить загрузку','Retry loading')}</button>}
   </div>}
   {history.map((entry,i)=><article className="iwxa-chat-turn" key={str(entry.message_id)||str(entry.task_id)||i}>
    <div className="iwxa-chat-user"><strong>{tr('Вы','You')}</strong><p>{str(entry.objective)}</p></div>
    <div className="iwxa-chat-answer"><strong>IWXA</strong><SafeMarkdown text={entry.status==='RUNNING'&&str(entry.message_id)===quickPending
      ?(partialAnswer||tr('Формируем ответ...','Generating a response...'))
      :str(entry.summary)||(entry.status==='INTERRUPTED'
       ?tr('Ответ прервался после завершения предыдущего сеанса. Можно продолжить разговор.', 'The previous session ended before the reply completed. You can continue chatting.')
       :entry.status==='FAILED'
       ?chatFailureMessage(entry.error_code,tr)
       :tr('Ответ готовится...','Preparing the answer...'))}/>
     <footer><small>{str(record(entry.local_model).name)||str(record(entry.provider).model)||humanState(entry.status,language)}</small>{records(entry.sources).map((source,i)=><small key={i} title={str(source.title)}>{str(source.kind)==='file'?tr('Файл','File'):str(source.kind)==='note'?tr('Заметка','Note'):str(source.kind)==='memory'?tr('Память','Memory'):tr('Интернет','Web')}: {str(source.title)}</small>)}
      {str(entry.message_id)&&entry.status==='COMPLETED'&&onCreateTask&&<button type="button" onClick={()=>navigateAfterSave(
        ()=>{void onCreateTask(conversationKey,str(entry.message_id)).catch(e=>setError(failure(e)))})}>
       {tr('Продолжить как задачу','Continue as task')}</button>}
      {str(entry.task_id)&&<button type="button" onClick={()=>navigateAfterSave(()=>onOpenTask(str(entry.task_id)))}>{tr('Открыть результат','Open result')}</button>}</footer></div>
   </article>)}
   {(sending||(quickPending&&!history.some(item=>str(item.message_id)===quickPending)))&&<div className="iwxa-chat-answer iwxa-chat-pending" role="status"><strong>IWXA · {tr('Формирует ответ','Generating')}</strong>
    <SafeMarkdown text={partialAnswer||tr('Сообщение принято. Модель работает.','Message received. The model is working.')}/></div>}

  </div>
  <div className="iwxa-chat-compose-area">
   {panel!=='none'&&<div className="iwxa-chat-menu">
    <button className="iwxa-chat-dismiss" type="button" onClick={()=>setPanel('none')} aria-label={tr('Закрыть','Close')}>×</button>
    {panel==='model'&&<LocalTaskModelChoice value={localPin} onChange={pin=>{snapshot.current={...snapshot.current,pin};setLocalPin(pin)}} onOpenModels={onOpenModels} disabled={!ready||sending||savingSelection||reconnectReading||!!reconnectError||!!reconnectConflict||reconnectResolving} />}
    {panel==='skill'&&<><h3>{tr('Способ работы','Approach')}</h3><div className="iwxa-chat-skills">
     <button type="button" onClick={()=>void updateOptions({...options,skill_id:null})}>{tr('Подобрать автоматически','Choose automatically')}</button>
     {skills.map(row=><button type="button" aria-pressed={options.skill_id===row.skill_id} key={str(row.skill_id)}
      disabled={row.task_route_supported===false} onClick={()=>void updateOptions({...options,skill_id:str(row.skill_id)})}>
       {skillLabel(str(row.skill_id))}{str(row.description)&&<small>{str(row.description)}</small>}</button>)}</div></>}
    {panel==='sources'&&<><h3>{tr('Источники и контекст','Sources and context')}</h3><div className="iwxa-chat-checks">
     {([['use_memory',tr('Память IWXA','IWXA memory')],['use_obsidian',tr('Подключённые заметки (Obsidian/Joplin)','Connected notes (Obsidian/Joplin)')],['use_web',tr('Поиск в интернете','Search the web')]] as const)
       .map(([name,label])=><label key={name}><input type="checkbox" checked={options[name]} disabled={!!attachments.length||reconnectReading||!!reconnectError||!!reconnectConflict||reconnectResolving}
         onChange={e=>void updateOptions({...options,[name]:e.target.checked})}/>{label}</label>)}</div>
     <div className="iwxa-chat-search"><input value={noteQuery} onChange={e=>setNoteQuery(e.target.value)}
       onKeyDown={e=>{if(e.key==='Enter')void searchNotes()}} placeholder={tr('Найти в подключённых заметках','Search connected notes')}/>
      <button type="button" disabled={noteBusy||!noteQuery.trim()} onClick={()=>void searchNotes()}>{tr('Найти','Search')}</button></div>
     {matches.map((note,i)=><div className="iwxa-chat-note-row" key={i}><span>{str(note.title)||str(note.path)}</span>
       <button type="button" disabled={noteBusy||!!attachments.length||
        (sources.length>=8&&!sources.some(source=>source.path===(str(note.path)||str(note.relative_path))))}
        onClick={()=>void addNote(note)}>{tr('Добавить','Add')}</button></div>)}
    </>}
    {panel==='tools'&&<ToolsReadControl inlineDestination="dialogue"
     onConnections={()=>onOpenTools()}
     onAttachToDraft={attachReadEvidence}/>}
    {panel==='search'&&<div className="iwxa-chat-search"><input value={query} onChange={e=>setQuery(e.target.value)}
       onKeyDown={e=>{if(e.key==='Enter')void search()}} placeholder={tr('Поиск в теме','Search topic')}/>
      <button type="button" onClick={()=>void search()}>{tr('Найти','Search')}</button></div>}
    {panel==='more'&&<><h3>{tr('Тема и история','Topic and history')}</h3>
      <div className="iwxa-chat-actions">
       <button disabled={!hasSession||paused||busy} onClick={()=>void modify('pause',{})}>{tr('Приостановить','Pause')}</button>
       <button disabled={!paused||busy} onClick={()=>void modify('resume',{})}>{tr('Продолжить','Resume')}</button>
       <button disabled={!hasSession||busy||sending||!!quickPending||!!recoveredPending.current||!!pendingAttempt.current||reconnectReading||!!reconnectError||!!reconnectConflict||reconnectResolving} onClick={()=>void modify('recycle',{})}>{tr('Новый контекст','New context')}</button>
       <button disabled={!hasSession||busy||sending||!!quickPending||!!recoveredPending.current||!!pendingAttempt.current||reconnectReading||!!reconnectError||!!reconnectConflict||reconnectResolving} onClick={()=>void modify('clear',{})}>{tr('Очистить контекст','Clear context')}</button>
      </div><p>{tr('Хотите уточнить ответ? Напишите следующее сообщение в этом разговоре.',
       'To clarify a reply, simply send a follow-up message in this conversation.')}</p></>}
   </div>}
   {recoveredPending.current&&<div className="iwxa-chat-note" role="status">
    <p>{recoveryState==='PREPARED'?tr('Отправка подготовлена. Продолжите её или отмените.','The submission is prepared. Continue or cancel it.'):
      tr('Есть сохранённая отправка. Проверьте результат.','A saved submission needs review.')}</p>
    <button type="button" disabled={sending||!!quickPending||recoveringAutomatically.current} onClick={()=>void recoverSubmission()}>{tr('Проверить и продолжить','Review and continue')}</button>
    {recoveryState==='PREPARED'&&<button type="button" disabled={sending} onClick={()=>void cancelPrepared()}>{tr('Отменить отправку','Cancel submission')}</button>}
   </div>}
   {toolOutcome&&<p role="status" className="iwxa-chat-note">{toolOutcome}</p>}
   {savingSelection&&<p role="status" className="iwxa-chat-note">{tr('Сохраняем выбранные источники…','Saving selected sources…')}</p>}
   {(sources.length>0||attachments.length>0)&&<div className="iwxa-chat-selected">
    {sources.map(s=><button type="button" key={s.path} disabled={savingSelection}
     onClick={()=>void commitSelection(snapshot.current.sources.filter(x=>x.path!==s.path),snapshot.current.attachments)}>📖 {s.title} ×</button>)}
    {attachments.map(s=><button type="button" key={s.name} disabled={savingSelection}
     onClick={()=>void commitSelection(snapshot.current.sources,snapshot.current.attachments.filter(x=>x.name!==s.name))}>📎 {s.name} ×</button>)}
   </div>}
   <div className="iwxa-chat-composer"><textarea rows={2} disabled={!ready||sending||paused||savingSelection||reconnectReading||!!reconnectError||!!reconnectConflict||reconnectResolving} value={draft}
    onChange={e=>{snapshot.current={...snapshot.current,text:e.target.value};setDraft(e.target.value)}} placeholder={tr('Напишите сообщение...','Write a message...')}
    onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send()}}}/>
    <button className="iwxa-chat-send" type="button" disabled={!ready||sending||paused||!!quickPending||!!recoveredPending.current||reconnectReading||!!reconnectError||!!reconnectConflict||reconnectResolving||!draft.trim()} onClick={()=>void send()}><Send size={19}/></button>
   </div>
   <div className="iwxa-chat-toolbar">
    <button className={panel==='model'?'active':''} onClick={()=>toggle('model')}><Brain size={15}/>{localPin?.name||tr('Модель','Model')}</button>
    <button className={panel==='skill'?'active':''} onClick={()=>toggle('skill')}><Workflow size={15}/>{options.skill_id?skillLabel(options.skill_id):tr('Навык','Skill')}</button>
    <button className={panel==='sources'?'active':''} onClick={()=>toggle('sources')}><BookOpen size={15}/>{tr('Контекст','Context')}{sources.length>0&&' · '+sources.length}</button>
    <button className={panel==='tools'?'active':''} onClick={()=>toggle('tools')}><Wrench size={15}/>{tr('Инструменты','Tools')}</button>
    <label><Paperclip size={15}/>{tr('Файл','File')}<input hidden type="file" multiple accept=".txt,.md,.csv,.json" onChange={e=>{void addFiles(e.target.files);e.target.value=''}}/></label>
    <span className="iwxa-chat-spacer"/>
    <button className={panel==='search'?'active':''} onClick={()=>toggle('search')}><Search size={15}/>{tr('Поиск','Search')}</button>
    <button className={panel==='more'?'active':''} onClick={()=>toggle('more')}><SlidersHorizontal size={15}/>{tr('Ещё','More')}</button>
   </div>
  </div>
 </div>;
}
export function IntegrationsControl(){
 const {tr}=useUiSettings();
 const [integration,setIntegration]=useState<Row>({}),[google,setGoogle]=useState<Row>({}),[mcp,setMcp]=useState<Row>({});
 const clientSecret=useRef<HTMLInputElement|null>(null);
 const [clientId,setClientId]=useState(''),[authUrl,setAuthUrl]=useState(''),[discovery,setDiscovery]=useState<Row|null>(null);
 const [mcpSelection,setMcpSelection]=useState<Record<string,boolean>>({});
 const [error,setError]=useState('');
 const load=useCallback(async()=>{
  const results=await Promise.allSettled([
   runtime.query<Row>('integration_control'),runtime.query<Row>('google_oauth_status'),runtime.query<Row>('mcp_user_tools')]);
  setIntegration(results[0].status==='fulfilled'?record(results[0].value):{});
  setGoogle(results[1].status==='fulfilled'?record(results[1].value):{});
  setMcp(results[2].status==='fulfilled'?record(results[2].value):{});
  setError(results.filter(x=>x.status==='rejected').map(x=>failure((x as PromiseRejectedResult).reason)).join(' · '));
 },[]);
 useEffect(()=>{void load()},[load]);
 const {run,busy,message}=useOwnerActions(load);
 async function configure(){
  const answer=await run<Row>('Сохранить клиентскую конфигурацию Google только через защищённый Python Runtime?','google_oauth_configure',
    {connection_id:'google',client_id:clientId,client_secret:clientSecret.current?.value||''},{kind:'oauth_connection',id:'google'});
  if(clientSecret.current)clientSecret.current.value='';
  if(answer)setClientId('');
 }
 async function begin(){
  const answer=await run<Row>('Начать OAuth-подключение Google? Текст согласия и разрешения проверяются в Google.','google_oauth_begin',
    {connection_id:'google'},{kind:'oauth_connection',id:'google'});
  if(answer)setAuthUrl(str(answer.authorization_url));
 }
 return <section className="subpage card advanced">
  <div className="advanced-head"><div><h2>Интеграции</h2><p>Подключите необходимые сервисы. Данные доступа сохраняются в защищённом хранилище агента.</p></div><button disabled={busy} className="secondary-button" onClick={()=>void load().catch(e=>setError(failure(e)))}>Обновить</button></div>
  {error&&<p className="advanced-error">{error}</p>}{message&&<OwnerMessage>{message}</OwnerMessage>}
  <div className="advanced-form"><h3>Google</h3><OwnerDetails value={google} title="Состояние подключения"/>
   <label className="advanced-field">Client ID<input autoComplete="off" value={clientId} onChange={e=>setClientId(e.target.value)}/></label>
   <label className="advanced-field">Client secret<input autoComplete="off" type="password" ref={clientSecret}/></label>
   <div className="advanced-actions"><button disabled={busy||!clientId.trim()} onClick={()=>void configure()}>Сохранить конфигурацию</button>
     <button disabled={busy} onClick={()=>void begin()}>Начать подключение</button>
     <button disabled={busy} onClick={()=>void run('Отключить локальный OAuth-сеанс Google?','google_oauth_disconnect_local',{connection_id:'google'},{kind:'oauth_connection',id:'google'})}>Отключить</button>
   </div>
   {authUrl&&<label className="advanced-field" style={{flexBasis:'100%'}}>Ссылка для входа (откройте в браузере)<textarea rows={3} readOnly value={authUrl}/></label>}
  </div>
  <div className="advanced-form"><h3>MCP-инструменты чтения</h3><p>Выберите инструменты чтения, которые агенту можно использовать. Изменение данных здесь не разрешается.</p>
   <button disabled={busy} onClick={()=>void (async()=>{
     const result=await run<Row>('Запросить список инструментов настроенного MCP-сервера?','mcp_discover_tools',
       {provider_id:'MCP_HTTP_20260728'},{kind:'provider',id:'MCP_HTTP_20260728'});
     if(result){setDiscovery(record(result));setMcpSelection(Object.fromEntries(records(record(result).tools).map(t=>[str(t.server_name),t.currently_imported===true])));}
   })()}>Обнаружить доступные инструменты</button>
   {discovery&&<><OwnerDetails title="Доступные инструменты" value={discovery}/>{records(discovery.tools).map(t=><label className="owner-row" key={str(t.server_name)}><input type="checkbox" checked={mcpSelection[str(t.server_name)]===true} onChange={e=>setMcpSelection(v=>({...v,[str(t.server_name)]:e.target.checked}))}/><span>{str(t.title)||str(t.server_name)}</span><small>{str(t.description)}</small></label>)}<button disabled={busy} onClick={()=>void run('Заменить список явно разрешённых MCP-инструментов чтения? Запись запрещена.','mcp_replace_read_tools',{provider_id:'MCP_HTTP_20260728',selections:records(discovery.tools).filter(t=>mcpSelection[str(t.server_name)]).map(t=>({server_name:t.server_name,server_tool_digest:t.server_tool_digest}))},{kind:'provider',id:'MCP_HTTP_20260728'})}>Сохранить разрешённые инструменты чтения</button></>}
   <OwnerDetails title="Текущая политика MCP" value={mcp}/>
  </div>
  <OwnerDetails title="Реестр интеграций и их состояния" value={integration}/>
 </section>;
}

export function SettingsControl({onNavigate}:{onNavigate:(page:string)=>void}){
 const {tr,language,theme,workMode,setWorkMode,toggleLanguage,toggleTheme,persistenceError,t3Enabled,t3Busy}=useUiSettings();
 const [section,setSection]=useState<'general'|'instructions'>('general');
 const [data,setData]=useState<Row>({}),[control,setControl]=useState<Row>({}),[profiles,setProfiles]=useState<Row[]>([]);
 const [profileId,setProfileId]=useState('UIP-personal-default'),[name,setName]=useState(''),[instructions,setInstructions]=useState(''),[enabled,setEnabled]=useState(true);
 const [error,setError]=useState('');
 const load=useCallback(async()=>{
  const [a,b]=await Promise.all([runtime.query<Row>('user_instructions'),runtime.query<Row>('operational_control')]);
  setData(record(a));setControl(record(b));setProfiles(records(record(a).profiles));
 },[]);
 useEffect(()=>{void load().catch(e=>setError(failure(e)))},[load]);
 const {run,busy,message}=useOwnerActions(load);
 function select(row:Row){setProfileId(str(row.profile_id));setName(str(row.name));setInstructions(str(row.instructions));setEnabled(row.enabled===true);}
 function nextProfile(){setProfileId('UIP-'+crypto.randomUUID());setName('');setInstructions('');setEnabled(true);}
 const activeModel=str(control.active_model_provider_id);
 return <section className="subpage card advanced settings-page">
  <div className="advanced-head"><div><h2>{tr('Настройки IWXA','IWXA settings')}</h2>
   <p>{tr('Оформление, способы работы и персональные правила. Все изменения подтверждаются приложением.','Appearance, work preferences and personal instructions. Changes are confirmed by the app.')}</p></div>
   <button className="secondary-button" disabled={busy} onClick={()=>void load().catch(e=>setError(failure(e)))}>{tr('Обновить','Refresh')}</button></div>
  <div className="settings-tabs" role="group" aria-label={tr('Раздел настроек','Settings section')}>
   <button type="button" aria-pressed={section==='general'} className={section==='general'?'active':''} onClick={()=>setSection('general')}>{tr('Общие настройки','General')}</button>
   <button type="button" aria-pressed={section==='instructions'} className={section==='instructions'?'active':''} onClick={()=>setSection('instructions')}>{tr('Поведение помощника','Assistant preferences')}</button>
  </div>
  {error&&<p role="alert" className="advanced-error">{error}</p>}
  {message&&<OwnerMessage>{message}</OwnerMessage>}
  {section==='general'&&<>
   <div className="advanced-form"><h3>{tr('Оформление приложения','Appearance')}</h3>
    <p>{tr('Выберите язык и удобную тему оформления. Выбор сохранится после перезапуска.','Choose your language and appearance. They are restored after restarting.')}</p>
    <div className="settings-choices">
     <span>{tr('Язык','Language')}</span>
     <button type="button" aria-pressed={language==='ru'} disabled={language==='ru'} onClick={toggleLanguage}>Русский</button>
     <button type="button" aria-pressed={language==='en'} disabled={language==='en'} onClick={toggleLanguage}>English</button>
    </div>
    <div className="settings-choices">
     <span>{tr('Тема','Theme')}</span>
     <button type="button" aria-pressed={theme==='light'} disabled={theme==='light'} onClick={toggleTheme}>{tr('Светлая','Light')}</button>
     <button type="button" aria-pressed={theme==='dark'} disabled={theme==='dark'} onClick={toggleTheme}>{tr('Тёмная','Dark')}</button>
    </div>
    {persistenceError&&<p role="alert">{tr('Не удалось подтвердить сохранение настроек.','Settings changes have not been confirmed.')} <OwnerDetails value={persistenceError}/></p>}
   </div>
   <div className="advanced-form"><h3>{tr('Режим работы','Work mode')}</h3>
    <p>{tr('Быстрый убирает дополнительные проверки интерфейса там, где операцию уже контролирует Core. Режим с проверками сохраняет прежний маршрут. Выбор не изменяет права программ и файлов.',
     'Fast skips extra interface checks where Core already controls the operation. With checks keeps the previous workflow. This setting does not change file or program permissions.')}</p>
    <div className="settings-choices">
     <span>{tr('Дополнительные проверки','Extra checks')}</span>
     <button type="button" aria-pressed={workMode==='fast'} disabled={workMode==='fast'} onClick={()=>setWorkMode('fast')}>{tr('Быстрый','Fast')}</button>
     <button type="button" aria-pressed={workMode==='checked'} disabled={workMode==='checked'} onClick={()=>setWorkMode('checked')}>{tr('С проверками','With checks')}</button>
    </div>
   </div>
   <div className="advanced-form"><h3>{tr('Локальная работа (T3)','Local work (T3)')}</h3>
    <p role="status" className={'t3-settings-state '+(t3Enabled===null?'unknown':t3Enabled?'enabled':'disabled')}>
     {t3Busy?tr('Сохраняется…','Saving…'):t3Enabled===null?tr('Состояние не подтверждено','State unavailable'):
      t3Enabled?tr('Включена','Enabled'):tr('Выключена','Disabled')}</p>
    <p>{tr('Изменить режим можно в левом меню. Выключение само по себе не запускает внешние подключения.','Use the left menu to change this mode. Turning it off does not start external connections.')}</p>
    {t3Busy&&<p>{tr('Сохраняется…','Saving…')}</p>}
   </div>
    <div className="advanced-form"><h3>{tr('Где хранятся данные','Where your data is stored')}</h3>
    <p>{tr('Сейчас используется локальное хранилище этого приложения. Отдельные рабочие области с изоляцией данных ещё не реализованы.','This app currently uses one local data store. Separate isolated workspaces are not yet available.')}</p>
    <p>{tr('Личные документы проходят через локальную Ollama. Обычные запросы могут использовать другие подключённые модели и сервисы. Передача зависит от выбранного маршрута.','Personal document analysis uses local Ollama. Ordinary requests can use other configured models and services; their data routes depend on your selection.')}</p>
    <div className="owner-row"><strong>{tr('Модель для новых задач','Model for new tasks')}</strong>
     <span>{activeModel==='OLLAMA_LOCAL_V1'?tr('Локальная Ollama','Local Ollama'):activeModel&&activeModel!=='NONE'?tr('Другой источник','Another source'):tr('Пока не выбрана','Not selected')}</span>
     <button type="button" onClick={()=>onNavigate('Модели')}>{tr('Выбрать модель','Choose model')}</button></div>
    <div className="advanced-actions"><button type="button" onClick={()=>onNavigate('Интеграции')}>{tr('Подключения и разрешения','Connections and permissions')}</button>
     <button type="button" onClick={()=>onNavigate('Файлы')}>{tr('Работа с файлами','Files and folders')}</button></div>
   </div>
   <div className="advanced-form"><h3>{tr('Учётная запись и синхронизация IWXA','IWXA account and synchronization')}</h3>
    <p>{tr('Вход в аккаунт IWXA и синхронизация между устройствами в текущем продукте пока не подключены. Приложение не выполняет такую передачу автоматически.','IWXA account sign-in and cross-device synchronization are not connected in this product yet. The app does not perform this synchronization automatically.')}</p>
    <p>{tr('Облачные возможности верхних уровней требуют отдельных действующих контрактов, авторизации и разрешений. Их нельзя включить только переключателем оформления.','Higher-level cloud capabilities require working contracts, authentication and explicit permissions. An appearance switch cannot enable them.')}</p>
   </div>
   <OwnerDetails title={tr('Текущее состояние приложения','App state')} value={control}/>
  </>}
  {section==='instructions'&&<>
   <div className="advanced-form"><h3>{tr('Как помощник должен отвечать','How the assistant should respond')}</h3>
    <p>{tr('Например: отвечать кратко, показывать источники, сначала предлагать план. Инструкция применяется к новым заданиям и не даёт дополнительных разрешений.','For example: keep answers concise, cite sources, or propose a plan first. This applies to new tasks and grants no additional permissions.')}</p>
    <div className="owner-rows">{profiles.map(row=><button key={str(row.profile_id)} className="owner-row" onClick={()=>select(row)}>{str(row.name)||tr('Без названия','Untitled')} · {row.enabled===true?tr('Используется','Enabled'):tr('Выключена','Disabled')}</button>)}</div>
    <button type="button" className="mini-button" onClick={nextProfile}>{tr('Новая инструкция','New instruction')}</button>
    <label className="advanced-field">{tr('Название','Name')}<input value={name} onChange={e=>setName(e.target.value)} placeholder={tr('Например, как оформлять ответы','For example, answer style')}/></label>
    <label className="advanced-field" style={{flexBasis:'100%'}}>{tr('Пожелания к ответам','Response preferences')}<textarea value={instructions} onChange={e=>setInstructions(e.target.value)} rows={6}/></label>
    <label><input type="checkbox" checked={enabled} onChange={e=>setEnabled(e.target.checked)}/> {tr('Использовать в новых заданиях','Apply to new tasks')}</label>
    <div className="advanced-actions"><button disabled={busy||!/^UIP-[A-Za-z0-9_-]{1,80}$/.test(profileId)||!name.trim()||!instructions.trim()||instructions.length>12000}
     onClick={()=>void run(tr('Сохранить эту инструкцию для следующих заданий?','Save this instruction for future tasks?'),'user_instruction_upsert',
       {profile_id:profileId,name,instructions,enabled},{kind:'instruction_profile',id:profileId})}>{tr('Сохранить','Save')}</button>
     <button disabled={busy||!profiles.some(p=>p.profile_id===profileId)}
      onClick={()=>void run(tr('Удалить выбранную инструкцию?','Delete this instruction?'),'user_instruction_delete',{profile_id:profileId},{kind:'instruction_profile',id:profileId})}>{tr('Удалить','Delete')}</button></div>
    <OwnerDetails title={tr('Служебный профиль','Internal profile')} value={{profileId,data}}/>
   </div>
  </>}
 </section>;
}
