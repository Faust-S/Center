/** P04: optional user-selected Atlas work. No portfolio storage or owner mutation. */
import React,{useState,useEffect,useRef} from 'react';
import {runtime} from './runtime-client/interaction';

export type AtlasWorkSelection={file_path:string;project_id:string;work_id:string;revision:string;work_digest:string};
type AtlasWork={workId:string;title:string;workDigest:string};
type AtlasProject={projectId:string;name:string;work:AtlasWork[];workCount:number;matchingWorkCount:number;moreWork:boolean};
type AtlasPreview={revision:string;schema:string;ownerProduct:string;projects:AtlasProject[];matchedProjects:number;truncated:boolean;mode:string;ownerReads:number};
type WorkReference={ownerProduct:string;objectRef:{projectId:string;workId:string};revision:string;display?:{projectName:string;workTitle:string};workspaceRef?:{workspaceId:string}};
export type LinkedAtlasWork={taskId?:string;ref?:WorkReference;context?:{projectName:string;workTitle:string;workState?:string};savedContext?:{projectName:string;workTitle:string};status:string;observedRevision?:string};
type Translate=(ru:string,en:string)=>string;
const STATUS:Record<string,[string,string]>={
 SOURCE_REVISION_MATCHES:['Ревизия совпадает','Revision matches'],
 SOURCE_REVISION_CHANGED:['Источник изменён — ссылка устарела','Source changed — link is stale'],
 SOURCE_CONTENT_CHANGED:['Работа изменена при той же ревизии Atlas','Work changed at the same Atlas revision'],
 SOURCE_UNAVAILABLE:['Файл Atlas недоступен','Atlas file unavailable'],
 INVALID_REFERENCE:['Ссылка повреждена','Reference is invalid'],
 PROJECT_MISSING_IN_SOURCE:['Проект удалён из источника','Project missing from source'],
 WORK_MISSING_IN_SOURCE:['Работа удалена из источника','Work missing from source'],
};

export function AtlasWorkContextPicker({selection,onSelect,disabled,tr}:{
 selection:AtlasWorkSelection|null;onSelect:(value:AtlasWorkSelection|null)=>void;disabled:boolean;tr:Translate;
}){
 const[filePath,setFilePath]=useState('');
 const[query,setQuery]=useState('');
 const[preview,setPreview]=useState<AtlasPreview|null>(null);
 const[busy,setBusy]=useState(false);
 const[error,setError]=useState('');
 const[previewSource,setPreviewSource]=useState('');
 // Invalidates an in-flight read on edits, a newer inspection, or unmount.
 // No timer, polling, owner cache, or extra request is required.
 const requestEpoch=useRef(0);
 useEffect(()=>()=>{requestEpoch.current+=1;},[]);
 function invalidatePreview(){
  requestEpoch.current+=1;
  setPreview(null);setPreviewSource('');setError('');setBusy(false);onSelect(null);
 }
 async function inspect(chosenPath?:string){
  const requestedPath=(chosenPath??filePath).trim();
  if(!requestedPath||busy||disabled)return;
  if(!/\.iwxa$/i.test(requestedPath)){
   invalidatePreview();
   setError(tr('Выберите архив Atlas в формате .iwxa.','Choose an Atlas .iwxa archive.'));
   return;
  }
  const epoch=++requestEpoch.current;
  const requestedQuery=query.trim();
  setBusy(true);setError('');setPreview(null);setPreviewSource('');onSelect(null);
  try{
   const data=await runtime.query<AtlasPreview>('atlas_work_preview',{file_path:requestedPath,query:requestedQuery});
   if(epoch!==requestEpoch.current)return;
   if(data.ownerProduct!=='Atlas'||data.schema!=='atlas.project/1'||data.mode!=='READ_ONLY_USER_SELECTED_FILE'
      ||!Array.isArray(data.projects)||typeof data.revision!=='string'||
      data.projects.some(project=>!Array.isArray(project.work)||project.work.some(work=>
       !/^[0-9a-f]{64}$/.test(work.workDigest))))throw Error('atlas_preview_invalid');
   setPreviewSource(requestedPath);setPreview(data);
  }catch(e){
   if(epoch!==requestEpoch.current)return;
   setError(tr('Не удалось прочитать файл Atlas. Проверьте путь и сохранённый архив.','Cannot read the Atlas file. Check its path and saved archive.')+' '+String(e instanceof Error?e.message:e));
  }finally{if(epoch===requestEpoch.current)setBusy(false);}
 }
 async function chooseFile(){
  if(disabled||busy)return;
  const epoch=++requestEpoch.current;
  setBusy(true);setError('');
  try{
   const chosen=await runtime.command<{selected:boolean;cancelled:boolean;path?:string}>('atlas_file_choose',{});
   if(epoch!==requestEpoch.current)return;
   if(chosen.selected===true&&typeof chosen.path==='string'&&/\.iwxa$/i.test(chosen.path)){
    setFilePath(chosen.path);
    await inspect(chosen.path);
   }else if(chosen.cancelled!==true){
    setError(tr('Не удалось открыть выбор файла Atlas. Укажите путь вручную.',
     'Cannot open the Atlas file picker. Enter the path manually.'));
   }
  }catch{
   if(epoch===requestEpoch.current)setError(tr('Выбор файла недоступен. Укажите путь вручную.',
    'File selection is unavailable. Enter the path manually.'));
  }finally{if(epoch===requestEpoch.current)setBusy(false);}
 }
 return <details className="composer-options" aria-label={tr('Связать работу Atlas','Link an Atlas work item')}>
  <summary>{tr('Связать работу из Atlas (необязательно)','Link work from Atlas (optional)')}{selection?' ✓':''}</summary>
  <p>{tr('Выберите архив Atlas (.iwxa). В задаче сохраняется только ссылка на выбранную работу.','Choose an Atlas archive (.iwxa). Only a link to the selected work item is saved in the task.')}</p>
  <label>{tr('Файл Atlas (.iwxa)','Atlas file (.iwxa)')}
   <input type="text" value={filePath} disabled={disabled||busy} placeholder={tr('Например: C:\\Проекты\\atlas.iwxa','For example: C:\\Projects\\atlas.iwxa')}
    onChange={e=>{setFilePath(e.target.value);invalidatePreview();}}/>
  </label>
  <button type="button" className="mini-button" disabled={disabled||busy} onClick={()=>void chooseFile()}>{tr('Выбрать файл…','Choose file…')}</button>
  <label>{tr('Поиск проекта или работы','Find project or work')}
   <input type="search" value={query} disabled={disabled||busy} placeholder={tr('Название или ID','Title or ID')}
    onChange={e=>{setQuery(e.target.value);invalidatePreview();}}/>
  </label>
  <button type="button" className="mini-button" disabled={disabled||busy||!filePath.trim()} onClick={()=>void inspect()}>{busy?tr('Чтение…','Reading…'):tr('Показать работы','Show work items')}</button>
  {error&&<p role="alert">{error}</p>}
  {selection&&<p role="status">{tr('Выбрана работа','Selected work')}: {preview?.projects.find(p=>p.projectId===selection.project_id)?.name||selection.project_id} / {preview?.projects.find(p=>p.projectId===selection.project_id)?.work.find(w=>w.workId===selection.work_id)?.title||selection.work_id} · {tr('ревизия','revision')} {selection.revision}
   <button type="button" className="mini-button" disabled={disabled} onClick={()=>onSelect(null)}>{tr('Убрать','Remove')}</button></p>}
  {preview&&<div>
   <small>{tr('Ревизия Atlas','Atlas revision')}: {preview.revision}. {tr('Найдено проектов','Projects found')}: {preview.matchedProjects}.
    {preview.truncated&&tr(' Показана часть — уточните поиск.',' Partial results — refine search.')}</small>
   {preview.projects.length===0&&<p role="status">{tr('Работы не найдены.','No matching work items.')}</p>}
   {preview.projects.map(project=><details key={project.projectId}>
    <summary>{project.name} — {project.matchingWorkCount} {tr('работ','works')}</summary>
    <div className="owner-rows">{project.work.map(work=><div key={work.workId} className="owner-row">
     <span>{work.title}</span>
     <button type="button" className="mini-button" disabled={disabled||busy}
      aria-pressed={selection?.project_id===project.projectId&&selection.work_id===work.workId&&selection.revision===preview.revision}
      onClick={()=>onSelect({file_path:previewSource,project_id:project.projectId,work_id:work.workId,
       revision:preview.revision,work_digest:work.workDigest})}>{tr('Выбрать','Select')}</button>
    </div>)}</div>
    {project.moreWork&&<small>{tr('Есть ещё работы — уточните поиск.','More work items exist — refine search.')}</small>}
   </details>)}
  </div>}
 </details>;
}

export function AtlasWorkContextStatus({link,tr}:{link:LinkedAtlasWork;tr:Translate}){
 const[observation,setObservation]=useState(link);
 const[loading,setLoading]=useState(false);
 const[error,setError]=useState('');
 useEffect(()=>{setObservation(link);setError('');},[link]);
 const ref=observation.ref;
 const wording:[string,string]=STATUS[observation.status]||[observation.status,observation.status];
 const saved=observation.savedContext||ref?.display;
 const current=observation.context;
 const changed=observation.status==='SOURCE_REVISION_CHANGED'||observation.status==='SOURCE_CONTENT_CHANGED';
 async function recheck(){
  const taskId=observation.taskId;
  if(!taskId||loading)return;
  setLoading(true);setError('');
  try{
   const row=await runtime.query<{task_id:string;linked_atlas_work?:LinkedAtlasWork}>('task',{task_id:taskId});
   if(row.task_id!==taskId||!row.linked_atlas_work||
      JSON.stringify(row.linked_atlas_work.ref?.objectRef)!==JSON.stringify(ref?.objectRef))
    throw Error('atlas_work_task_link_changed');
   setObservation({...row.linked_atlas_work,taskId});
  }catch{
   setError(tr('Состояние источника не обновилось — сохранена предыдущая проверка.',
    'The source state could not be refreshed — the previous observation remains.'));
  }finally{setLoading(false);}
 }
 return <section className="owner-rows" aria-label={tr('Связанная работа Atlas','Linked Atlas work')}>
  <strong>{tr('Работа Atlas','Atlas work item')}</strong>
  <p>{current?.projectName||saved?.projectName||ref?.objectRef?.projectId||'Atlas'} / {current?.workTitle||saved?.workTitle||ref?.objectRef?.workId||'Work'}</p>
  <p role="status">{tr(...wording)}. {ref?.revision&&`${tr('Сохранённая ревизия','Saved revision')}: ${ref.revision}`}
   {observation.observedRevision&&observation.observedRevision!==ref?.revision&&` · ${tr('Ревизия источника','Source revision')}: ${observation.observedRevision}`}</p>
  {changed&&saved&&current&&(saved.projectName!==current.projectName||saved.workTitle!==current.workTitle)&&
   <small>{tr('При привязке','When linked')}: {saved.projectName} / {saved.workTitle}</small>}
  {observation.taskId&&<button type="button" className="mini-button" disabled={loading} onClick={()=>void recheck()}>
   {loading?tr('Проверяем…','Checking…'):tr('Проверить изменения Atlas','Check Atlas changes')}</button>}
  {error&&<p role="alert">{error}</p>}
  <small>{tr('Task и Result сохранены. Состояние Atlas проверяется при открытии задачи или по вашей команде.',
   'Task and Result are saved. Atlas is checked when the Task is opened or when you request it.')}</small>
 </section>;
}