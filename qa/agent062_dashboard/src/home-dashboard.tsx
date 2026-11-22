import React,{useEffect,useRef,useState} from 'react';
import {Plus,GripVertical,LayoutDashboard,Settings2,ArrowUp,ArrowDown,X,RotateCcw,FolderOpen,CheckSquare,MessageCircle,Boxes,ExternalLink} from 'lucide-react';
import {useUiSettings} from './ui-preferences';
import {runtime} from './runtime-client/interaction';
import {readHomeLive,type HomeLive,type HomeLiveNeed} from './home-dashboard-live';
import {
 DEFAULT_DASHBOARD,PROGRAM_SHORTCUTS,
 dashboardStorageKey,parseDashboard,moveDashboardWidget,resizeDashboardWidget,
 removeDashboardWidget,addDashboardWidget,
 type WidgetKind,type ProgramShortcut,type WidgetSpan,type DashboardLayout,type DashboardWidget
} from './home-dashboard-model';

type HomeTask={id:string;title?:string;status?:string};
type Props={
 areaId:string;areaName:string;taskComposer:React.ReactNode;tasks:HomeTask[];taskSources:string[];
 selectedTask?:{id:string;title:string;status:string;verified:boolean}|null;
 taskStatus:(task:HomeTask)=>string;onOpenTask:(id:string)=>void;
 onNavigate:(page:string)=>void;onOpenProgram:(id:ProgramShortcut)=>void;coreReady:boolean;
};
type Description={ru:string;en:string;category:'work'|'sources'|'tools';page?:string;span:WidgetSpan};
const TYPES:Record<WidgetKind,Description>={
 composer:{ru:'Новое поручение',en:'New task',category:'work',span:12},
 recent:{ru:'Продолжить работу',en:'Continue work',category:'work',page:'Задачи',span:12},
 selected:{ru:'Открытая работа',en:'Current task',category:'work',page:'Задачи',span:6},
 review:{ru:'На проверку',en:'Needs review',category:'work',page:'Согласования',span:6},
 'work-status':{ru:'Состояние работ',en:'Work overview',category:'work',page:'Задачи',span:6},
 conversations:{ru:'Разговоры',en:'Conversations',category:'work',page:'Диалоги',span:6},
 files:{ru:'Файлы',en:'Files',category:'sources',page:'Файлы',span:6},
 'task-sources':{ru:'Источники работы',en:'Task sources',category:'sources',page:'Задачи',span:6},
 projects:{ru:'Проекты',en:'Projects',category:'work',page:'Проекты',span:6},
 automations:{ru:'Автоматизации',en:'Automations',category:'work',page:'Автоматизации',span:6},
 programs:{ru:'Программы',en:'Programs',category:'tools',page:'Программы',span:6},
 models:{ru:'Модели',en:'Models',category:'tools',page:'Модели',span:6},
 connections:{ru:'Подключения',en:'Connections',category:'tools',page:'Интеграции',span:6},
 knowledge:{ru:'Знания',en:'Knowledge',category:'sources',page:'Знания',span:6},
 memory:{ru:'Память',en:'Memory',category:'sources',page:'Память',span:6},
 company:{ru:'Поручения организации',en:'Company assignments',category:'work',page:'Работа в организации',span:6},
 'program-shortcut':{ru:'Выбранная программа',en:'Chosen program',category:'tools',page:'Программы',span:6}
};
const KIND_ORDER=Object.keys(TYPES) as WidgetKind[];
function load(areaId:string):DashboardLayout{
 try{const raw=window.localStorage.getItem(dashboardStorageKey(areaId));
  return raw?parseDashboard(JSON.parse(raw)):parseDashboard(DEFAULT_DASHBOARD)}
 catch{return parseDashboard(DEFAULT_DASHBOARD)}
}
export function HomeDashboard({areaId,areaName,taskComposer,tasks,taskSources,selectedTask,taskStatus,onOpenTask,onNavigate,onOpenProgram,coreReady}:Props){
 const {tr}=useUiSettings();
 const [layout,setLayout]=useState<DashboardLayout>(()=>load(areaId));
 const [editing,setEditing]=useState(false),[catalogOpen,setCatalogOpen]=useState(false);
 const [programId,setProgramId]=useState<ProgramShortcut>('external:n8n');
 const [storageError,setStorageError]=useState(''),[notice,setNotice]=useState('');
 // Internal pointer reordering works in installed Windows WebView2 without
 // disabling Tauri's native file drop handler for the whole application.
 const pointerDrag=useRef<{id:string;pointerId:number;x:number;y:number;moving:boolean}|null>(null);
 const [draggingWidget,setDraggingWidget]=useState<string|null>(null);
 const [dropTarget,setDropTarget]=useState<string|null>(null);
 const pointerTarget=(clientX:number,clientY:number):string|null=>{
  const hit=document.elementFromPoint(clientX,clientY);
  const row=hit?.closest<HTMLElement>('[data-iwxa-dashboard-widget]');
  return row?.dataset.iwxaDashboardWidget||null;
 };
 const clearPointer=()=>{
  pointerDrag.current=null;setDraggingWidget(null);setDropTarget(null);
 };
 const handlePointerDown=(event:React.PointerEvent<HTMLButtonElement>,id:string)=>{
  if(!editing||event.button!==0||pointerDrag.current)return;
  pointerDrag.current={id,pointerId:event.pointerId,x:event.clientX,y:event.clientY,moving:false};
  event.currentTarget.setPointerCapture(event.pointerId);
 };
 const handlePointerMove=(event:React.PointerEvent<HTMLButtonElement>)=>{
  const drag=pointerDrag.current;
  if(!drag||drag.pointerId!==event.pointerId)return;
  if(!drag.moving&&Math.hypot(event.clientX-drag.x,event.clientY-drag.y)<7)return;
  if(!drag.moving){drag.moving=true;setDraggingWidget(drag.id)}
  event.preventDefault();
  const id=pointerTarget(event.clientX,event.clientY);
  setDropTarget(id&&id!==drag.id?id:null);
 };
 const handlePointerUp=(event:React.PointerEvent<HTMLButtonElement>)=>{
  const drag=pointerDrag.current;
  if(!drag||drag.pointerId!==event.pointerId)return;
  const id=drag.moving?pointerTarget(event.clientX,event.clientY):null;
  if(event.currentTarget.hasPointerCapture(event.pointerId))
   event.currentTarget.releasePointerCapture(event.pointerId);
  clearPointer();
  if(editing&&drag.moving&&id&&id!==drag.id)
   setLayout(before=>moveDashboardWidget(before,drag.id,id));
 };
 const catalogRef=useRef<HTMLElement|null>(null);
 const [live,setLive]=useState<HomeLive|null>(null);
 const [liveBusy,setLiveBusy]=useState(false),[liveError,setLiveError]=useState('');
 const [refreshEpoch,setRefreshEpoch]=useState(0);
 const liveSequence=useRef(0);
 const liveNeedKey=React.useMemo(()=>{
  const needs=new Set<HomeLiveNeed>();
  for(const widget of layout.widgets){
   if(widget.kind==='automations')needs.add('automations');
   if(widget.kind==='models')needs.add('model');
   if(widget.kind==='connections')needs.add('connections');
   if(widget.kind==='programs'||widget.kind==='program-shortcut')needs.add('programs');
  }
  return [...needs].sort().join('|');
 },[layout.widgets]);
 useEffect(()=>{
  const seq=++liveSequence.current;
  setLive(null);setLiveError('');
  if(!coreReady||!liveNeedKey){setLiveBusy(false);return}
  setLiveBusy(true);
  void readHomeLive(runtime,areaId,liveNeedKey.split('|') as HomeLiveNeed[])
   .then(result=>{if(seq===liveSequence.current)setLive(result)})
   .catch(error=>{if(seq===liveSequence.current)setLiveError(
     String(error instanceof Error?error.message:error))})
   .finally(()=>{if(seq===liveSequence.current)setLiveBusy(false)});
  return()=>{liveSequence.current++};
 },[areaId,coreReady,liveNeedKey,refreshEpoch]);
 const pendingLive=(!coreReady?tr('Подключение к Core не подтверждено.','Core connection not confirmed.'):
  liveBusy?tr('Читаем состояние из Core…','Reading state from Core…'):
  liveError?tr('Данные не подтверждены. Обновите сведения.','Data not confirmed. Refresh to retry.'):
  tr('Сведения недоступны. Откройте раздел для проверки.','Status unavailable. Open section to inspect.'));

 useEffect(()=>{if(catalogOpen)catalogRef.current?.querySelector<HTMLButtonElement>('button[aria-label]')?.focus()},[catalogOpen]);
 useEffect(()=>{
  try{window.localStorage.setItem(dashboardStorageKey(areaId),JSON.stringify(layout));setStorageError('')}
  catch{setStorageError(tr('Компоновка не сохранена. Проверьте хранилище приложения.',
    'Layout could not be saved. Check application storage.'))}
 },[areaId,layout]);
 const add=(kind:WidgetKind)=>{
  if(layout.widgets.length>=24){setNotice(tr('Можно разместить до 24 блоков.','Up to 24 widgets are supported.'));return}
  if(kind!=='program-shortcut'&&layout.widgets.some(w=>w.kind===kind)){
   setNotice(tr('Этот блок уже добавлен.','This widget is already on the dashboard.'));return;
  }
  if(kind==='program-shortcut'&&layout.widgets.some(w=>w.kind===kind&&w.program===programId)){
   setNotice(tr('Эта программа уже добавлена.','This program is already added.'));return;
  }
  const id='widget-'+crypto.randomUUID().replace(/-/g,'');
  setLayout(before=>addDashboardWidget(before,{id,kind,span:TYPES[kind].span,
   ...(kind==='program-shortcut'?{program:programId}:{})}));
  setNotice('');setCatalogOpen(false);
 };
 const open=(page:string)=>onNavigate(page);
 const recent=tasks.slice(0,5);
 const reviews=tasks.filter(task=>task.status==='pending_review');
 const render=(widget:DashboardWidget):React.ReactNode=>{
  if(widget.kind==='composer')return taskComposer;
  if(widget.kind==='recent')return <>
   {recent.length===0?<p>{tr('В этой рабочей области пока нет сохранённых задач.',
    'No saved tasks in this Workspace yet.')}</p>:<div className="iwxa-dash-task-list">
    {recent.map(task=><button type="button" key={task.id} className="iwxa-dash-task-row"
     onClick={()=>onOpenTask(task.id)}>
     <strong>{task.title||tr('Задача без названия','Untitled task')}</strong>
     <small>{taskStatus(task)}</small><span aria-hidden="true">›</span></button>)}
   </div>}
   <button type="button" className="mini-button" onClick={()=>open('Задачи')}>{tr('Все работы','All tasks')}</button>
  </>;
  if(widget.kind==='selected')return <>
   {selectedTask?<><strong>{selectedTask.title}</strong>
    <p>{selectedTask.verified?selectedTask.status:tr('Проверяем состояние выбранной работы','Verifying selected task')}</p>
    <button type="button" className="mini-button" onClick={()=>onOpenTask(selectedTask.id)}>
     {tr('Открыть работу','Open task')}</button></>:<p>{tr('Выберите работу из списка, чтобы видеть её здесь.',
     'Select a task to show it here.')}</p>}
  </>;
  if(widget.kind==='task-sources')return <>
   {selectedTask?.verified&&taskSources.length>0?taskSources.slice(0,5).map((path,i)=>
    <div className="iwxa-dash-task-row" key={path+':'+i}><FolderOpen size={14}/>
     <strong>{path.split(/[\\/]/).pop()||path}</strong></div>):
    <p>{tr('Откройте подтверждённую работу с источниками, чтобы увидеть их здесь.',
     'Open a verified task with sources to see them here.')}</p>}
   {selectedTask&&<button type="button" className="mini-button" onClick={()=>onOpenTask(selectedTask.id)}>
    {tr('Открыть источники','Open sources')}</button>}
  </>;
  if(widget.kind==='review')return <>
   <div className="iwxa-dash-metric">{reviews.length}<small>{tr('задач ждут решения','tasks require a decision')}</small></div>
   {reviews.slice(0,3).map(t=><button type="button" className="iwxa-dash-task-row" key={t.id}
    onClick={()=>onOpenTask(t.id)}><strong>{t.title||tr('Задача без названия','Untitled task')}</strong><span aria-hidden="true">›</span></button>)}
   <button type="button" className="mini-button" onClick={()=>open('Согласования')}>{tr('Открыть проверку','Review decisions')}</button>
  </>;
  if(widget.kind==='work-status')return <>
   <div className="iwxa-dash-mini-metrics">
    <span><b>{tasks.length}</b>{tr('Всего задач','All tasks')}</span>
    <span><b>{reviews.length}</b>{tr('Ждут проверки','Needs review')}</span>
   </div>
   <button type="button" className="mini-button" onClick={()=>open('Задачи')}>{tr('Открыть работы','Open tasks')}</button>
  </>;
  if(widget.kind==='automations'){
   const observed=live?.automations;
   return <>{observed?.state==='ready'?<>
    <div className="iwxa-dash-mini-metrics">
     <span><b>{observed.value.scheduled}</b>{tr('Запланированы','Scheduled')}</span>
     <span><b>{observed.value.running}</b>{tr('Выполняются','Running')}</span>
     <span><b>{observed.value.needsAttention}</b>{tr('Требуют внимания','Needs attention')}</span>
    </div>
    <p className="iwxa-dash-muted">{observed.value.limited?
     tr('Показаны данные только из первых 100 автоматизаций.','Counts use only the first 100 automations.'):
     tr('Только автоматизации с подтверждённой привязкой к текущей Workspace.','Only automations bound to this Workspace.')}</p>
   </>:<p role="status">{pendingLive}</p>}
   <button type="button" className="mini-button" onClick={()=>open('Автоматизации')}>{tr('Открыть расписания','Open schedules')}</button></>;
  }
  if(widget.kind==='models'){
   const observed=live?.model;
   return <>{observed?.state==='ready'?<>
    <strong>{observed.value.route==='NONE'?tr('Модель не выбрана','No model selected'):observed.value.name}</strong>
    <p className="iwxa-dash-muted">{observed.value.answerVerified?
     tr('Ответ текущей модели подтверждён','Current model response verified'):
     observed.value.reason==='NONE'?tr('Выберите модель для поручений.','Choose a model for tasks.'):
     tr('Выбрана, но подтверждённого ответа нет.','Selected; response not verified.')}</p>
   </>:<p role="status">{pendingLive}</p>}
   <button type="button" className="mini-button" onClick={()=>open('Модели')}>{tr('Открыть модели','Open models')}</button></>;
  }
  if(widget.kind==='connections'){
   const observed=live?.connections;
   return <>{observed?.state==='ready'?<>
    <div className="iwxa-dash-mini-metrics">
     <span><b>{observed.value.selected}</b>{tr('Выбрано провайдеров','Selected providers')}</span>
     <span><b>{observed.value.healthy}</b>{tr('Сообщают о готовности','Report ready')}</span>
    </div>
    <p className="iwxa-dash-muted">{tr('Состояние подключений этого приложения; новые разрешения не выдаются.','Application connection status; no new permissions are granted.')}</p>
   </>:<p role="status">{pendingLive}</p>}
   <button type="button" className="mini-button" onClick={()=>open('Интеграции')}>{tr('Настроить подключения','Configure connections')}</button></>;
  }
  if(widget.kind==='programs'){
   const observed=live?.programs;
   return <>{observed?.state==='ready'?<>
    <div className="iwxa-dash-mini-metrics">
     <span><b>{observed.value.verified}</b>{tr('Проверенные подключения','Verified connections')}</span>
     <span><b>{observed.value.responding}</b>{tr('Сервис отвечает','Service responding')}</span>
    </div>
    <p className="iwxa-dash-muted">{tr('Из семи выбранных типов программ. Доступность функции проверяется перед запуском.','Among seven known program types. Execution is checked separately.')}</p>
   </>:<p role="status">{pendingLive}</p>}
   <button type="button" className="mini-button" onClick={()=>open('Программы')}>{tr('Открыть программы','Open programs')}</button></>;
  }
  const target=TYPES[widget.kind].page;
  if(widget.kind==='program-shortcut'){
   const program=PROGRAM_SHORTCUTS.find(p=>p.id===widget.program);
   const observed=live?.programs;
   const match=observed?.state==='ready'?observed.value.items.find(item=>item.id===widget.program):null;
   return <><strong>{program?tr(program.ru,program.en):tr('Программа','Program')}</strong>
    <p className="iwxa-dash-muted">{!match?pendingLive:match.status==='verified'?
      tr('Работа подключения подтверждена.','Connection verified.'):match.status==='responding'?
      tr('Сервис отвечает. Запуск процесса требует отдельной проверки.','Service responds. Workflow execution requires a separate check.'):
      tr('Готовность не подтверждена.','Readiness not verified.')}</p>
    <button type="button" className="mini-button" onClick={()=>widget.program&&onOpenProgram(widget.program)}>
     <ExternalLink size={13}/>{tr('Открыть программу','Open program')}</button></>;
  }
  if(widget.kind==='conversations')return <><p>{tr('Продолжайте разговоры в сохранённом контексте.',
   'Continue conversations in their saved context.')}</p>
   <button type="button" className="mini-button" onClick={()=>open('Диалоги')}>
    <MessageCircle size={14}/>{tr('Открыть разговоры','Open conversations')}</button></>;
  if(widget.kind==='programs')return <><p>{tr('Запускайте и настраивайте установленные программы в их штатном разделе.',
   'Open and configure installed programs from their original workspace.')}</p>
    <button type="button" className="mini-button" onClick={()=>open('Программы')}>
     <Boxes size={14}/>{tr('Программы','Programs')}</button></>;
  if(widget.kind==='connections')return <><p>{tr('Подключённые возможности управляются в разделе подключений. Новое подключение требует вашего действия.',
   'Connections are managed in Connections. New connections require your action.')}</p>
    <button type="button" className="mini-button" onClick={()=>open('Интеграции')}>
     {tr('Настроить подключения','Configure connections')}</button></>;
  if(widget.kind==='company')return <><p>{tr('Поручения организации доступны только в соответствующей рабочей области и с подтверждёнными правами.',
   'Company assignments require a verified company Workspace and permissions.')}</p>
   <button type="button" className="mini-button" onClick={()=>open('Работа в организации')}>
    {tr('Открыть поручения','Open assignments')}</button></>;
  return <><p>{tr('Откройте соответствующий раздел для просмотра текущих данных и управления.',
   'Open the relevant section to view current data and manage it.')}</p>
   {target&&<button type="button" className="mini-button" onClick={()=>open(target)}>
    <FolderOpen size={14}/>{tr('Открыть раздел','Open section')}</button>}</>;
 };
 return <section className="iwxa-dashboard" aria-label={tr('Настраиваемая главная','Customizable Home')}>
  <div className="iwxa-dash-head">
   <div><h2>{tr('Моё рабочее место','My workspace')}</h2>
    <small>{areaName} · {coreReady?tr('Ядро подключено','Core connected'):
     tr('Нет подтверждённого подключения к ядру','Core connection unverified')}</small></div>
   <div className="iwxa-dash-head-actions">
    {liveNeedKey&&<button type="button" disabled={!coreReady||liveBusy}
      onClick={()=>setRefreshEpoch(value=>value+1)} title={tr('Повторно прочитать текущие данные Core','Refresh current Core projections')}>
      {tr('Обновить сведения','Refresh status')}</button>}
    {editing&&<><button type="button" onClick={()=>setCatalogOpen(true)}><Plus size={16}/>{tr('Добавить блок','Add widget')}</button>
     <button type="button" onClick={()=>{if(window.confirm(tr('Вернуть исходную компоновку главной?',
      'Restore the original Home layout?')))setLayout(parseDashboard(DEFAULT_DASHBOARD))}}>
      <RotateCcw size={16}/>{tr('Сбросить','Reset')}</button></>}
    <button type="button" className={editing?'active':''} aria-pressed={editing}
     onClick={()=>{setEditing(v=>!v);setCatalogOpen(false)}}>
     {editing?<CheckSquare size={16}/>:<Settings2 size={16}/>}
     {editing?tr('Готово','Done'):tr('Настроить','Customize')}</button>
   </div>
  </div>
  {storageError&&<p className="iwxa-dash-error" role="alert">{storageError}</p>}
  {notice&&<p className="iwxa-dash-note" role="status">{notice}</p>}
  {editing&&<p className="iwxa-dash-guide">{tr(
   'Перетащите блок за ручку. Для клавиатуры используйте стрелки в меню блока. Размеры привязаны к колонкам.',
   'Drag widgets by the handle. Use the move buttons for keyboard access. Sizes snap to columns.')}</p>}
  <div className={'iwxa-dashboard-grid'+(editing?' is-editing':'')}>
   {layout.widgets.map((w,index)=>{
    const title=w.kind==='program-shortcut'?(PROGRAM_SHORTCUTS.find(p=>p.id===w.program)?.ru||TYPES[w.kind].ru)
     :tr(TYPES[w.kind].ru,TYPES[w.kind].en);
    return <article className={'iwxa-dash-widget iwxa-dash-span-'+w.span+
      (draggingWidget===w.id?' iwxa-dash-dragging':'')+
      (dropTarget===w.id?' iwxa-dash-target':'')}
     data-iwxa-dashboard-widget={w.id} key={w.id}>
     <div className="iwxa-dash-widget-head">
      {editing&&<button type="button" className="iwxa-dash-handle"
       aria-label={tr('Перетащить блок','Drag widget')+': '+title}
       title={tr('Удерживайте и перемещайте блок. Для клавиатуры есть команды выше/ниже в меню.','Drag to move. Keyboard movement is available in the widget menu.')}
       onPointerDown={event=>handlePointerDown(event,w.id)}
       onPointerMove={handlePointerMove} onPointerUp={handlePointerUp}
       onPointerCancel={clearPointer}><GripVertical size={16}/></button>}
      <strong>{title}</strong>
      {editing&&<details className="iwxa-dash-widget-menu"><summary aria-label={tr('Настроить блок','Widget options')+': '+title}>···</summary>
       <div className="iwxa-dash-widget-actions">
        <button type="button" disabled={index===0} onClick={()=>setLayout(prev=>moveDashboardWidget(prev,w.id,prev.widgets[index-1]?.id||w.id))}>
         <ArrowUp size={14}/>{tr('Выше','Move up')}</button>
        <button type="button" disabled={index===layout.widgets.length-1} onClick={()=>setLayout(prev=>moveDashboardWidget(prev,w.id,prev.widgets[index+1]?.id||w.id))}>
         <ArrowDown size={14}/>{tr('Ниже','Move down')}</button>
        {[4,6,12].map(span=><button type="button" key={span} aria-pressed={w.span===span}
         onClick={()=>setLayout(prev=>resizeDashboardWidget(prev,w.id,span as WidgetSpan))}>
         {span===4?tr('Треть ширины','One third'):span===6?tr('Половина','Half width'):tr('Вся ширина','Full width')}</button>)}
        <button type="button" className="iwxa-dash-remove" onClick={()=>setLayout(prev=>removeDashboardWidget(prev,w.id))}>
         <X size={14}/>{tr('Убрать блок','Remove widget')}</button>
       </div></details>}
     </div>
     <div className="iwxa-dash-widget-body">{render(w)}</div>
    </article>;
   })}
   {editing&&<button type="button" className="iwxa-dash-add-tile" onClick={()=>setCatalogOpen(true)}>
    <Plus size={22}/>{tr('Добавить блок','Add widget')}</button>}
  </div>
  {layout.widgets.length===0&&!editing&&<button type="button" className="secondary-button"
   onClick={()=>{setEditing(true);setCatalogOpen(true)}}>{tr('Добавить первый блок','Add your first widget')}</button>}
  {catalogOpen&&<div className="iwxa-dash-modal-backdrop" onMouseDown={e=>{
   if(e.target===e.currentTarget)setCatalogOpen(false)}}
   onKeyDown={e=>{
    if(e.key==='Escape'){e.preventDefault();setCatalogOpen(false);return}
    if(e.key!=='Tab'||!catalogRef.current)return;
    const focusable=Array.from(catalogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled),select:not(:disabled)'));
    if(!focusable.length)return;
    if(e.shiftKey&&document.activeElement===focusable[0]){e.preventDefault();focusable.at(-1)?.focus()}
    else if(!e.shiftKey&&document.activeElement===focusable.at(-1)){e.preventDefault();focusable[0].focus()}
   }}>
   <section ref={catalogRef} className="iwxa-dash-modal" role="dialog" aria-modal="true" aria-label={tr('Каталог блоков','Widget catalog')}>
    <header><h3>{tr('Добавить на главную','Add to Home')}</h3>
     <button type="button" aria-label={tr('Закрыть','Close')} onClick={()=>setCatalogOpen(false)}><X size={17}/></button></header>
    <p>{tr('Выберите сведения или действие. Блоки не устанавливают программы и не дают новых разрешений.',
     'Choose a view or action. Widgets do not install programs or grant permissions.')}</p>
    <label className="iwxa-dash-program-picker">{tr('Для блока программы','Program shortcut')}
     <select value={programId} onChange={e=>setProgramId(e.target.value as ProgramShortcut)}>
      {PROGRAM_SHORTCUTS.map(p=><option key={p.id} value={p.id}>{tr(p.ru,p.en)}</option>)}</select></label>
    <div className="iwxa-dash-catalog-grid">
     {KIND_ORDER.map(kind=>{
      const description=TYPES[kind];
      const exists=layout.widgets.some(w=>w.kind===kind&&
       (kind!=='program-shortcut'||w.program===programId));
      return <button type="button" key={kind} disabled={exists||layout.widgets.length>=24}
       onClick={()=>add(kind)}><LayoutDashboard size={17}/>
       <strong>{tr(description.ru,description.en)}</strong>
       <small>{exists?tr('Уже добавлено','Already added'):
        description.category==='work'?tr('Работа','Work'):
        description.category==='sources'?tr('Материалы','Sources'):tr('Возможности','Capabilities')}</small></button>;
     })}
    </div>
    <footer><button type="button" onClick={()=>setCatalogOpen(false)}>{tr('Закрыть','Close')}</button></footer>
   </section>
  </div>}
 </section>;
}