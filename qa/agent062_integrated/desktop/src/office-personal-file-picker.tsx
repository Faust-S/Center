import React,{useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {useUiSettings} from './ui-preferences';
import {readWorkAreas} from './work-area-flow';
import {record,type Row} from './owner-ui';
import {officeFolderPathValid,verifiedOfficeFileListing,
 type OfficeFileEntry,type OfficeFileKind} from './office-personal-file-picker-review';

/** Lazy read-only navigation through the original Files provider. Never launches
 * Office, changes a document or creates a separate document/File store.
 */
export function OfficePersonalFilePicker({taskId,workspaceId,verified,kind,disabled=false,onSelect}:{
 taskId:string;workspaceId:string;verified:boolean;kind:OfficeFileKind;
 disabled?:boolean;onSelect:(path:string)=>void;
}){
 const {tr}=useUiSettings();
 const [folder,setFolder]=useState('');
 const [entries,setEntries]=useState<OfficeFileEntry[]>([]);
 const [opened,setOpened]=useState(false),[loaded,setLoaded]=useState(false);
 const [busy,setBusy]=useState(false),[error,setError]=useState('');
 const [truncated,setTruncated]=useState(false);
 const current=useRef({taskId,workspaceId,verified,kind});
 const nonce=useRef(0),inFlight=useRef(false);
 current.current={taskId,workspaceId,verified,kind};
 useEffect(()=>{
  // A new Task or Workspace cannot reuse the former file list as current.
  nonce.current++;setFolder('');setEntries([]);setLoaded(false);
  setOpened(false);setTruncated(false);setError('');setBusy(false);
  return()=>{nonce.current++;};
 },[taskId,workspaceId,verified,kind]);
 const admitted=(seq:number,task:string,area:string,fileKind:OfficeFileKind)=>
  nonce.current===seq&&current.current.taskId===task&&
  current.current.workspaceId===area&&current.current.verified&&
  current.current.kind===fileKind;
 async function browse(path:string){
  if(disabled||!verified||inFlight.current||!officeFolderPathValid(path))return;
  const task=taskId,area=workspaceId,fileKind=kind,seq=++nonce.current;
  inFlight.current=true;setBusy(true);setError('');setLoaded(false);
  try{
   const initial=await readWorkAreas(runtime);
   if(!admitted(seq,task,area,fileKind)||initial.active_id!==area)
    throw Error('office_picker_workspace_changed');
   const reply=record(await runtime.command<Row>('tool_read',{
    arguments:{root_id:'personal',path,limit:100}
   },{kind:'tool',id:'files.list'}));
   const list=verifiedOfficeFileListing(reply,path,fileKind);
   const final=await readWorkAreas(runtime);
   if(!admitted(seq,task,area,fileKind)||final.active_id!==area)
    throw Error('office_picker_workspace_changed');
   setFolder(path);setEntries(list.entries);setTruncated(list.truncated);
   setOpened(true);setLoaded(true);
  }catch(e){if(admitted(seq,task,area,fileKind)){
   setEntries([]);setLoaded(false);setTruncated(false);
   setError(e instanceof Error?e.message:'office_picker_readback_failed');
  }}finally{inFlight.current=false;if(admitted(seq,task,area,fileKind))setBusy(false);}
 }
 async function choose(entry:OfficeFileEntry){
  if(disabled||!verified||inFlight.current||entry.kind!=='file'||
     !entries.some(e=>e.kind==='file'&&e.path===entry.path))return;
  const task=taskId,area=workspaceId,fileKind=kind,seq=++nonce.current;
  inFlight.current=true;setBusy(true);setError('');
  try{
   const final=await readWorkAreas(runtime);
   if(!admitted(seq,task,area,fileKind)||final.active_id!==area)
    throw Error('office_picker_workspace_changed');
   onSelect(entry.path);
   setOpened(false);
  }catch(e){if(admitted(seq,task,area,fileKind))setError(
   e instanceof Error?e.message:'office_picker_selection_failed');
  }finally{inFlight.current=false;if(admitted(seq,task,area,fileKind))setBusy(false);}
 }
 const parent=folder.split('/').slice(0,-1).join('/');
 return <div className="office-file-picker">
  <button type="button" className="secondary-button" disabled={disabled||!verified||busy}
   onClick={()=>{if(opened){nonce.current++;setOpened(false);}else void browse('');}}>
   {opened?tr('Скрыть список файлов','Hide file list'):
    tr('Выбрать из Personal Files','Choose from Personal Files')}
  </button>
  {busy&&!opened&&<p role="status">{tr('Чтение файлов…','Reading files…')}</p>}
  {opened&&<div className="advanced-form" role="group" aria-label={tr('Выбор документа','Document selection')}>
   <p>{tr('Папка:','Folder:')} {folder||tr('Корень Personal Files','Personal Files root')}</p>
   {folder&&<button type="button" className="secondary-button" disabled={busy||disabled}
    onClick={()=>void browse(parent)}>{tr('На уровень выше','Up one folder')}</button>}
   {busy&&<p role="status">{tr('Чтение файлов…','Reading files…')}</p>}
   {loaded&&entries.length===0&&<p>{tr('Подходящих документов нет. Можно ввести путь вручную.',
    'No matching documents. You can also enter a path manually.')}</p>}
   {loaded&&entries.map(entry=><div className="owner-row" key={entry.path}>
    <strong>{entry.kind==='dir'?'📁 ':'📄 '}{entry.name}</strong>
    {entry.kind==='file'&&entry.bytes!==null&&<small>{entry.bytes} {tr('байт','bytes')}</small>}
    <button type="button" className="secondary-button" disabled={busy||disabled}
     onClick={()=>entry.kind==='dir'?void browse(entry.path):void choose(entry)}>
     {entry.kind==='dir'?tr('Открыть папку','Open folder'):tr('Выбрать','Select')}
    </button>
   </div>)}
   {truncated&&<p role="status">{tr('Показаны элементы первой страницы. Можно уточнить папку или ввести путь вручную.',
    'Only the first page of entries is shown. Choose a folder or type the path manually.')}</p>}
  </div>}
  {error&&<p role="alert" className="advanced-error">{error}</p>}
 </div>;
}
