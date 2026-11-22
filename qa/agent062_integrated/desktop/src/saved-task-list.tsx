import React,{memo,useMemo,useState} from 'react';
import {FileText} from 'lucide-react';
import {useUiSettings} from './ui-preferences';

/** UI-only projection of the existing, Core-scoped Task list. */
export type SavedTaskRow={id:string;title?:string;status?:string};
export const SAVED_TASKS_PER_PAGE=24;

export function selectSavedTaskRows(
 tasks:readonly SavedTaskRow[],query:string,shown:number,selected:string
):{rows:SavedTaskRow[];matched:number;remaining:number}{
 const search=query.trim().toLocaleLowerCase();
 const matched=search?tasks.filter(task=>(task.title||'').toLocaleLowerCase().includes(search)):tasks;
 const limit=Math.max(0,Math.min(matched.length,Number.isFinite(shown)?Math.trunc(shown):0));
 const initial=matched.slice(0,limit);
 // A selected Task is never hidden by the initial window. It stays first
 // as the user reveals more saved Tasks, without duplicating the row.
 const pinned=!search&&selected?matched.find(task=>task.id===selected):undefined;
 const rows=pinned?[pinned,...initial.filter(task=>task.id!==selected)]:initial;
 return {rows,matched:matched.length,remaining:matched.length-rows.length};
}

type Props={tasks:readonly SavedTaskRow[];selected:string;
 onOpenTask:(id:string)=>void;
 statusLabel:(status:string|undefined,language:'ru'|'en')=>string};

/** Stays idle while typing in the parent Task composer unless the saved list changes. */
export const SavedTaskList=memo(function SavedTaskList({tasks,selected,onOpenTask,statusLabel}:Props){
 const {tr,language}=useUiSettings();
 const [query,setQuery]=useState('');
 const [shown,setShown]=useState(SAVED_TASKS_PER_PAGE);
 const {rows,matched,remaining}=useMemo(
  ()=>selectSavedTaskRows(tasks,query,shown,selected),[tasks,query,shown,selected]);
 if(tasks.length===0)return <p>{tr('В этой рабочей области ещё нет сохранённых задач.',
  'There are no saved Tasks in this Workspace yet.')}</p>;
 return <>
  <div className="saved-task-tools">
   <label className="saved-task-search">{tr('Найти задачу по названию','Find a Task by title')}
    <input type="search" value={query} onChange={e=>{setQuery(e.currentTarget.value);setShown(SAVED_TASKS_PER_PAGE)}}
     placeholder={tr('Название задачи','Task title')}/>
   </label>
   <small role="status" aria-live="polite">{tr('Показано','Showing')} {rows.length} {tr('из','of')} {matched}</small>
  </div>
  {matched===0?<p role="status">{tr('По этому запросу задачи не найдены.','No Tasks match this search.')}</p>:
   <div className="task-list">{rows.map(task=><button type="button"
    className={'task-row'+(task.id===selected?' active':'')} key={task.id}
    id={'saved-task-'+task.id}
    aria-label={tr('Открыть задачу','Open Task')+': '+(task.title||tr('Задача без названия','Untitled task'))}
    aria-current={task.id===selected?'true':undefined} onClick={()=>onOpenTask(task.id)}>
    <FileText size={16} aria-hidden="true"/>
    <span className="saved-task-title">{task.title||tr('Задача без названия','Untitled task')}</span>
    <small>{statusLabel(task.status,language)}</small>
    {task.id===selected&&<small className="saved-task-current">{tr('Открыта','Open')}</small>}
   </button>)}</div>}
  {remaining>0&&<button type="button" className="secondary-button" onClick={()=>setShown(n=>n+SAVED_TASKS_PER_PAGE)}>
   {tr('Показать ещё','Show more')} ({Math.min(remaining,SAVED_TASKS_PER_PAGE)})
  </button>}
 </>;
});
