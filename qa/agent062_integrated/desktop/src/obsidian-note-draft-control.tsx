import React,{useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {readTaskInActiveWorkArea} from './work-area-flow';
import {
 acceptedSourceMatches,draftRequest,obNoteDraftReadbackMatches,
 validObsidianDraftPath,verifiedReplacement,type ObsidianDraftMode,
} from './obsidian-note-draft';

type Tr=(ru:string,en:string)=>string;
type Row=Record<string,unknown>;
type Workspace={
 active_provider?:string;
 workspaces?:Array<{provider_id?:string;name?:string;active?:boolean;status?:string;
  governed_write_enabled?:boolean;health?:{ready?:boolean}}>;
};
type Replacement={path:string;sha:string;bindingDigest:string;providerId:string};
type Props={
 sourceTaskId:string;acceptedDigest:string;summary:string;workspaceId:string;
 tr:Tr;onOpenDraft:(taskId:string)=>Promise<void>;onConfigure:()=>void;
};
const hex=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const record=(v:unknown):Row=>
 v!==null&&typeof v==='object'&&!Array.isArray(v)?v as Row:{};

/** Optional, task-scoped UX; creates a new reviewed Task, never writes the Vault here. */
export function ObsidianNoteDraftControl({
 sourceTaskId,acceptedDigest,summary,workspaceId,tr,onOpenDraft,onConfigure,
}:Props){
 const [open,setOpen]=useState(false),[mode,setMode]=useState<ObsidianDraftMode>('create');
 const [path,setPath]=useState(''),[content,setContent]=useState(summary);
 const [workspace,setWorkspace]=useState<Workspace|null>(null);
 const [loading,setLoading]=useState(false),[checking,setChecking]=useState(false);
 const [replacement,setReplacement]=useState<Replacement|null>(null);
 const [busy,setBusy]=useState(false),[unknown,setUnknown]=useState(false);
 const [error,setError]=useState(''),[prepared,setPrepared]=useState('');
 const active=useRef(true),inFlight=useRef(false),checkEpoch=useRef(0);
 useEffect(()=>{active.current=true;return()=>{active.current=false;checkEpoch.current++}},[]);
 useEffect(()=>{
  if(!open)return;
  let live=true;
  setWorkspace(null);setLoading(true);setError('');
  void runtime.query<{workspaces:Workspace}>('knowledge_workspaces',{include_file_count:false})
   .then(result=>{if(live)setWorkspace(record(result.workspaces) as unknown as Workspace)})
   .catch(e=>{if(live)setError(tr('Не удалось прочитать подключение Obsidian.','Could not check the Obsidian connection.')+' '+String(e))})
   .finally(()=>{if(live)setLoading(false)});
  return()=>{live=false};
 },[open,sourceTaskId,workspaceId]);
 const current=workspace?.workspaces?.find(w=>w.provider_id==='OBSIDIAN_V1'&&w.active===true);
 const canWrite=workspace?.active_provider==='OBSIDIAN_V1'&&current?.status==='connected'&&
  current?.health?.ready===true&&current?.governed_write_enabled===true;
 const request=draftRequest({sourceTaskId,workspaceId,acceptedDigest,path,text:content,mode,
  ...(mode==='replace'&&replacement?.path===path?{expectedSha256:replacement.sha}:{})});
 const ready=canWrite&&!loading&&!checking&&!busy&&!unknown&&!!request;
 function changePath(value:string){
  checkEpoch.current++;setPath(value);setReplacement(null);setError('');setPrepared('');
 }
 function changeMode(value:ObsidianDraftMode){
  checkEpoch.current++;setMode(value);setReplacement(null);setError('');setPrepared('');
 }
 async function inspectReplacement(){
  if(!canWrite||mode!=='replace'||checking||busy||!validObsidianDraftPath(path))return;
  const ticket=++checkEpoch.current,p=path;
  setChecking(true);setReplacement(null);setError('');
  try{
   const found=await runtime.query<{results?:unknown[]}>('knowledge_search',{query:p,limit:100});
   const matched=(Array.isArray(found.results)?found.results:[])
    .map(record).filter(x=>x.path===p&&hex(x.sha256)&&record(x.provenance).provider_id==='OBSIDIAN_V1');
   if(matched.length!==1)throw Error('exact_note_not_found');
   const observed=matched[0],origin=record(observed.provenance);
   const providerId=String(origin.provider_id||''),bindingDigest=String(origin.binding_digest||'');
   if(!hex(bindingDigest))throw Error('note_provider_binding_missing');
   const verified=await runtime.query<Row>('knowledge_source',{
    path:p,expected_sha256:observed.sha256,
    provider_id:providerId,binding_digest:bindingDigest,
   });
   const sha=verifiedReplacement(p,verified,providerId,bindingDigest);
   if(!sha)throw Error('note_revision_readback_changed');
   if(ticket===checkEpoch.current&&active.current)
    setReplacement({path:p,sha,bindingDigest,providerId});
  }catch(e){
   if(ticket===checkEpoch.current&&active.current)
    setError(tr('Точную редакцию заметки подтвердить не удалось. Выберите другую заметку или проверьте подключение.',
      'The exact note revision could not be verified. Choose another note or check the connection.')+
      ' '+String(e));
  }finally{if(ticket===checkEpoch.current&&active.current)setChecking(false)}
 }
 async function stage(){
  if(inFlight.current||!ready||!request)return;
  inFlight.current=true;setBusy(true);setError('');setPrepared('');
  let dispatched=false;
  try{
   // No Task is accepted from UI state alone; check active area and saved digest.
   const original=await readTaskInActiveWorkArea<{
    task_id:string;status:string;accepted_artifact_digest?:string;
   }>(runtime,sourceTaskId,workspaceId);
   if(!acceptedSourceMatches(original.task,{sourceTaskId,acceptedDigest})||
      original.catalog.active_id!==workspaceId)throw Error('source_task_review_changed');
   if(mode==='replace'){
    const revision=replacement;
    if(!revision||revision.path!==path||!hex(revision.sha))throw Error('note_revision_required');
    const currentNote=await runtime.query<Row>('knowledge_source',{
     path,expected_sha256:revision.sha,
     provider_id:revision.providerId,binding_digest:revision.bindingDigest,
    });
    if(verifiedReplacement(path,currentNote,revision.providerId,
       revision.bindingDigest)!==revision.sha)throw Error('note_revision_changed');
   }
   await runtime.refreshRevision();
   // The backend re-verifies Workspace, Vault, source and revision atomically
   // before staging. Do not issue a second command when the reply is lost.
   dispatched=true;
   const ack=await runtime.command<Row>('obsidian_note_draft',request,
    {kind:'task',id:sourceTaskId});
   const derivedId=String(ack.task_id||'');
   const observed=await readTaskInActiveWorkArea<{
    task_id:string;status:string;action_candidates?:unknown[];
   }>(runtime,derivedId,workspaceId);
   if(observed.catalog.active_id!==workspaceId||
      !obNoteDraftReadbackMatches(ack,observed.task,{
       sourceTaskId,workspaceId,acceptedDigest,path,text:content,mode,
       ...(mode==='replace'&&replacement?{expectedSha256:replacement.sha}:{})
      }))throw Error('obsidian_task_readback_unconfirmed');
   if(active.current){
    setPrepared(derivedId);
    await onOpenDraft(derivedId);
   }
  }catch(e){
   if(active.current){
    if(dispatched){
     setUnknown(true);
     setError(tr('Подготовка могла сохраниться. Не повторяйте команду: проверьте список задач и существующий план.',
       'The draft may have been saved. Do not repeat the command; inspect saved Tasks and the existing plan.')+' '+String(e));
    }else{
     setError(tr('Источник, Vault или Workspace изменились. Новая Task не отправлена.',
       'The source, Vault or Workspace changed. No Task was submitted.')+' '+String(e));
    }
   }
  }finally{inFlight.current=false;if(active.current)setBusy(false)}
 }
 return <section className="advanced-form" aria-label={tr('Продолжить результат в Obsidian','Continue result in Obsidian')}>
  <div className="advanced-actions">
   <button type="button" className="secondary-button" aria-expanded={open}
    onClick={()=>setOpen(v=>!v)}>{tr('Подготовить заметку Obsidian','Prepare Obsidian note')}</button>
  </div>
  {open&&<>
   <p>{tr('Создайте отдельную задачу для заметки из принятого результата. Здесь Vault не изменяется: после подготовки вы отдельно проверите текст, примете действие и разрешите запись.',
    'Create a separate reviewed Task for a note based on the accepted result. This step does not modify the Vault: review the text, accept the action and separately authorize the write.')}</p>
   {loading?<p role="status">{tr('Проверяем выбранный Vault…','Checking selected Vault…')}</p>:
    !canWrite?<div role="status"><p>{tr(
     'Для записи выберите подключённый Obsidian Vault и включите разрешённую управляемую запись. Обычный доступ к заметкам остаётся только для чтения.',
     'Select a connected Obsidian Vault and enable governed write to create notes. Normal note access remains read-only.')}</p>
     <button type="button" onClick={onConfigure}>{tr('Настроить подключение','Configure connection')}</button>
    </div>:<p role="status">{tr('Выбран Vault: ','Selected Vault: ')}{current?.name||'Obsidian'}</p>}
   <label className="advanced-field">{tr('Операция с заметкой','Note operation')}
    <select value={mode} disabled={busy||unknown} onChange={(e:{target:{value:string}})=>changeMode(e.target.value as ObsidianDraftMode)}>
     <option value="create">{tr('Создать новую','Create new')}</option>
     <option value="replace">{tr('Обновить существующую','Update existing')}</option>
    </select>
   </label>
   <label className="advanced-field">{tr('Путь внутри Vault','Path within Vault')}
    <input type="text" value={path} disabled={busy||unknown} placeholder="Shared/Result.md"
     onChange={(e:{target:{value:string}})=>changePath(e.target.value)}/>
   </label>
   {mode==='replace'&&<div className="advanced-actions">
    <button type="button" disabled={!canWrite||busy||checking||unknown||!validObsidianDraftPath(path)}
     onClick={()=>void inspectReplacement()}>{tr('Проверить редакцию заметки','Verify note revision')}</button>
    {replacement?.path===path&&<small role="status">{tr('Редакция подтверждена','Revision verified')}: {replacement.sha.slice(0,12)}</small>}
   </div>}
   <label className="advanced-field">{tr('Текст заметки для проверки','Note text to review')}
    <textarea rows={9} className="document-content" value={content}
     disabled={busy||unknown} onChange={(e:{target:{value:string}})=>{setContent(e.target.value);setError('');setPrepared('')}}/>
   </label>
   <small>{tr('Доступны Markdown и TXT, размер текста — до 48 КБ. Папка назначения должна быть разрешена настройками Vault.',
    'Markdown and TXT are supported up to 48 KB. The destination folder must be allowed by the Vault configuration.')}</small>
   <div className="advanced-actions">
    <button type="button" className="primary-button" disabled={!ready}
     onClick={()=>void stage()}>{busy?tr('Сохраняем Task…','Saving Task…'):
      tr('Подготовить отдельную Task','Prepare separate Task')}</button>
    {prepared&&<button type="button" disabled={busy} onClick={()=>void onOpenDraft(prepared)}>
     {tr('Открыть подготовленную Task','Open prepared Task')}</button>}
   </div>
   {error&&<p role="alert">{error}</p>}
   {unknown&&<p role="status">{tr('Пока не подтверждено, создавался ли черновик. Обновите список задач и проверьте историю; повтор не запускается автоматически.',
     'It is not yet confirmed whether a draft was created. Refresh saved Tasks and inspect history; no automatic retry occurs.')}</p>}
  </>}
 </section>;
}


type SavedNote={
 path?:string;current_state?:string;after_sha256?:string;
 open_uri?:string|null;write_verified?:boolean;
};
/** Read-only projection of the existing ToolRuntime receipt; never activates Obsidian. */
export function ObsidianSavedNotes({notes,tr}:{notes:SavedNote[];tr:Tr}){
 if(!notes.length)return null;
 return <section className="owner-rows" aria-label={tr('Записанные заметки Obsidian','Saved Obsidian notes')}>
  <strong>{tr('Заметки Obsidian из действий задачи','Obsidian notes from Task actions')}</strong>
  {notes.map((note,i)=>{
   const current=note.current_state==='MATCHES_APPROVED';
   const uri=current&&typeof note.open_uri==='string'&&
    note.open_uri.startsWith('obsidian://open?')?note.open_uri:null;
   return <div key={(note.path||'note')+'-'+i} className="owner-row">
    <span>{note.path||tr('Заметка','Note')}</span>
    <small>{current?tr('Содержимое совпадает с сохранённой записью','Content matches saved receipt'):
     note.current_state==='WORKSPACE_CHANGED'?tr('Выбран другой Vault','Different Vault selected'):
     tr('Заметка изменилась или недоступна — требуется проверка','Note changed or unavailable; verification required')}</small>
    {uri&&<a href={uri}>{tr('Открыть заметку','Open note')}</a>}
   </div>;
  })}
 </section>;
}
