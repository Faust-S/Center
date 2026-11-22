import React,{useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {record,records,str,OwnerDetails,OwnerError,type Row} from './owner-ui';
import {useUiSettings} from './ui-preferences';
import {readActiveWorkAreaTasks,selectWorkArea,createAndSelectWorkArea} from './work-area-flow';

export type WorkArea={id:string;name:string;purpose:string;local_only:boolean;permissions:{memory:boolean;obsidian:boolean;web:boolean;selected_notes:boolean};task_count?:number;goals?:Row[]};
const defaults=()=>({memory:false,obsidian:false,web:false,selected_notes:false});
export function WorkAreaControl({active,onChanged,onSwitchBegin,onSwitchEnd,onBeforeSwitch,onOpenTask,onOpenProjects}:{
 active:WorkArea|null;onChanged:(switchAttempted:boolean)=>Promise<void>;
 onSwitchBegin:()=>boolean;onSwitchEnd:()=>void;
 onBeforeSwitch:()=>Promise<void>;onOpenTask:(id:string)=>void;onOpenProjects:()=>void;
}){
 const {tr}=useUiSettings();
 const [catalog,setCatalog]=useState<Row>({}),[tasks,setTasks]=useState<Row[]>([]);
 const [name,setName]=useState(''),[purpose,setPurpose]=useState(''),[localOnly,setLocalOnly]=useState(true),[permissions,setPermissions]=useState(defaults);
 const [editName,setEditName]=useState(''),[editPurpose,setEditPurpose]=useState(''),[editLocal,setEditLocal]=useState(true),[editPermissions,setEditPermissions]=useState(defaults);
 const [goals,setGoals]=useState<Row[]>([]),[goalId,setGoalId]=useState('');
 const [error,setError]=useState(''),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const readEpoch=useRef(0);
 const load=useCallback(async()=>{
  const epoch=++readEpoch.current;
  const [snapshot,allGoals]=await Promise.all([
   readActiveWorkAreaTasks<Row>(runtime),runtime.query<Row>('goals',{limit:100})
  ]);
  if(epoch!==readEpoch.current)return;
  setCatalog(snapshot.catalog);setGoals(records(allGoals.goals));setTasks(records(snapshot.tasks));
 },[]);
 useEffect(()=>{void load().catch(e=>setError(String(e)));return()=>{readEpoch.current++;};},[load]);
 async function act(command:string,input:Row){
  if(busy||command==='work_area_select'&&str(input.area_id)===str(catalog.active_id))return;
  const switching=command==='work_area_create'||command==='work_area_select';
  // One synchronous lock covers preflight, Core mutation and both readbacks.
  if(switching&&!onSwitchBegin()){
   setError(tr('Дождитесь окончания текущего переключения или закрытия окна.',
    'Finish the current Workspace switch or window close first.'));
   return;
  }
  setBusy(true);setError('');setNotice('');
  let preflightPassed=false;
  const preflight=async()=>{await onBeforeSwitch();preflightPassed=true;};
  try{
   if(command==='work_area_create'){
    await createAndSelectWorkArea(runtime,input as Parameters<typeof createAndSelectWorkArea>[1],preflight);
    setName('');setPurpose('');
    setNotice(tr('Рабочая область создана и открыта. Задачи этой области будут показаны отдельно.',
                 'The work area has been created and opened. Its tasks are shown separately.'));
   }else if(command==='work_area_select'){
    await selectWorkArea(runtime,str(input.area_id),preflight);
    setNotice(tr('Рабочая область открыта.','Work area opened.'));
   }else{
    await runtime.refreshRevision();
    await runtime.command(command,input);
   }
   await onChanged(switching&&preflightPassed);await load();
  }catch(e){
   const reason=e instanceof Error?e.message:String(e);
   if(switching&&!preflightPassed){
    setError(tr('Переключение отменено: сохранение открытой работы не подтверждено. Рабочая область не изменялась. ',
      'Workspace switch cancelled: open work could not be verified as saved. No Workspace change was requested. ')+reason);
    return;
   }
   setError(reason.startsWith('work_area_creation_')
    ?tr('Не удалось подтвердить создание области. Проверьте список перед повторным созданием. ',
        'Could not confirm work area creation. Check the list before creating it again. ')+reason
    :tr('Не удалось подтвердить изменение области. Проверьте состояние и повторите действие при необходимости. ',
        'Could not verify the work area change. Check the current state before trying again. ')+reason);
   try{await onChanged(switching&&preflightPassed);}catch{/* Preserve the original error. */}
   try{await load();}catch{/* Preserve the original error. */}
  }finally{setBusy(false);if(switching)onSwitchEnd();}
 }
 const selected=records(catalog.areas).find(r=>r.id===catalog.active_id);
 const createDisabledReason=!name.trim()?tr('Введите название области.','Enter an area name.'):name.trim().length>90?tr('Название слишком длинное.','Area name is too long.') :'';
 const editable=selected&&selected.id!=='personal';
 useEffect(()=>{if(selected){setEditName(str(selected.name));setEditPurpose(str(selected.purpose));setEditLocal(selected.local_only===true);const p=record(selected.permissions);setEditPermissions({memory:p.memory===true,obsidian:p.obsidian===true,web:p.web===true,selected_notes:p.selected_notes===true});}},[catalog]);
 return <section className="subpage card advanced">
  <div className="advanced-head"><div><h2>{tr('Рабочие области','Work areas')}</h2><p>{tr('Создавайте отдельные контексты для задач и целей. Хранение общее; область не предоставляет дополнительные права и не изолирует файлы.','Organize tasks and goals into separate contexts. Storage is shared; areas do not grant access or isolate files.')}</p></div><button disabled={busy} onClick={()=>void load().catch(e=>setError(String(e)))}>{tr('Обновить','Refresh')}</button></div>
  {error&&<OwnerError error={error}/>}
  {notice&&<p role="status">{notice}</p>}
  <div className="advanced-form"><h3>{tr('Выбрать область','Select area')}</h3>
   <select value={str(catalog.active_id)||'personal'} disabled={busy} onChange={e=>void act('work_area_select',{area_id:e.target.value})}>
    {records(catalog.areas).map(a=><option value={str(a.id)} key={str(a.id)}>{str(a.name)} ({str(a.task_count||0)})</option>)}
   </select>
   {selected&&<><p>{str(selected.purpose)||tr('Описание не задано','No description')}</p><p>{selected.local_only===true?tr('Модель IWXA или Ollama на этом компьютере. Интернет-поиск запрещён; память и заметки доступны по выбранным разрешениям.','Local IWXA or Ollama model. Web search is blocked; memory and notes follow the selected permissions.'):tr('Источники доступны только в пределах выбранных разрешений.','Sources follow the selected permissions.')}</p><OwnerDetails value={selected}/></>}
  </div>
  <div className="advanced-form"><h3>{tr('Создать область','Create area')}</h3>
   <label className="advanced-field">{tr('Название','Name')}<input value={name} maxLength={90} onChange={e=>setName(e.target.value)}/></label>
   <label className="advanced-field">{tr('Назначение','Purpose')}<textarea value={purpose} maxLength={500} onChange={e=>setPurpose(e.target.value)}/></label>
   <label><input type="checkbox" checked={localOnly} onChange={e=>{setLocalOnly(e.target.checked);if(e.target.checked)setPermissions(p=>({...p,web:false}));}}/>{tr('Локальная модель, без интернет-поиска','Local model, no web search')}</label>
   {Object.keys(permissions).filter(key=>!localOnly||key!=='web').map(key=><label key={key}><input type="checkbox" checked={permissions[key as keyof typeof permissions]} onChange={e=>setPermissions(p=>({...p,[key]:e.target.checked}))}/>{({memory:tr('Память','Memory'),obsidian:'Obsidian',web:tr('Интернет','Web'),selected_notes:tr('Выбранные заметки','Selected notes')})[key as keyof typeof permissions]}</label>)}
   {createDisabledReason&&<p role="status">{createDisabledReason}</p>}
   <button disabled={busy||!!createDisabledReason} onClick={()=>void act('work_area_create',{name:name.trim(),purpose:purpose.trim(),local_only:localOnly,permissions:localOnly?{...permissions,web:false}:permissions})}>{tr('Создать рабочую область','Create work area')}</button>
  </div>
  {editable&&<div className="advanced-form"><h3>{tr('Изменить выбранную область','Edit selected area')}</h3>
   <p>{tr('При изменении условий следующие задачи будут проверяться по новым разрешениям. Прошлые результаты не удаляются.','Updated permissions apply to future tasks. Existing results remain.')}</p>
   <label className="advanced-field">{tr('Название','Name')}<input value={editName} maxLength={90} disabled={busy} onChange={e=>setEditName(e.target.value)}/></label>
   <label className="advanced-field">{tr('Назначение','Purpose')}<textarea value={editPurpose} maxLength={500} disabled={busy} onChange={e=>setEditPurpose(e.target.value)}/></label>
   <label><input type="checkbox" checked={editLocal} disabled={busy} onChange={e=>{setEditLocal(e.target.checked);if(e.target.checked)setEditPermissions(p=>({...p,web:false}));}}/>{tr('Локальная модель, без интернет-поиска','Local model, no web search')}</label>
   {Object.keys(editPermissions).filter(key=>!editLocal||key!=='web').map(key=><label key={key}><input type="checkbox" checked={editPermissions[key as keyof typeof editPermissions]} disabled={busy} onChange={e=>setEditPermissions(p=>({...p,[key]:e.target.checked}))}/>{({memory:tr('Память','Memory'),obsidian:'Obsidian',web:tr('Интернет','Web'),selected_notes:tr('Выбранные заметки','Selected notes')})[key as keyof typeof editPermissions]}</label>)}
   <button disabled={busy||!editName.trim()} onClick={()=>void act('work_area_update',{area_id:str(selected?.id),expected_digest:str(catalog.catalog_digest),name:editName.trim(),purpose:editPurpose.trim(),local_only:editLocal,permissions:editLocal?{...editPermissions,web:false}:editPermissions})}>{tr('Сохранить изменения','Save changes')}</button>
   <h3>{tr('Связать цель','Link a goal')}</h3><select value={goalId} onChange={e=>setGoalId(e.target.value)}><option value="">{tr('Выберите цель','Choose goal')}</option>{goals.map(g=><option key={str(record(g.goal).goal_id)} value={str(record(g.goal).goal_id)}>{str(record(g.goal).objective)}</option>)}</select>
   <button disabled={busy||!goalId} onClick={()=>void act('work_area_link_goal',{area_id:str(selected?.id),goal_id:goalId})}>{tr('Связать с областью','Link to area')}</button>
   {records(selected?.goals).map(g=><p key={str(g.goal_id)}>{str(g.objective)}</p>)}
   <button onClick={onOpenProjects}>{tr('Открыть цели и планы','Open goals and plans')}</button>
  </div>}
  <div className="advanced-form"><h3>{tr('Задачи выбранной области','Tasks in this area')}</h3>
   {tasks.length===0&&<p>{tr('Пока нет задач. Выберите область и создайте задачу на главном экране.','No tasks yet. Select an area and create a task from the home screen.')}</p>}
   {tasks.map(t=><button key={str(t.id)} onClick={()=>onOpenTask(str(t.id))}>{str(t.title)} · {str(t.status)}</button>)}
  </div>
  <p>{tr('Переключение области не меняет права на файлы, модели и внешние сервисы.','Switching areas does not change file, model or external-service permissions.')}</p>
 </section>;
}
