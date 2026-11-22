import React, {useRef,useState} from 'react';

type PageId='overview'|'context'|'work'|'results'|'people'|'resources'|'programs'|'data';
type Participant={id:string;name:string;roleLabel:string;personalAgentPlan?:string;credentialState?:string};
type Workspace={id:string;name:string;atlasRef?:{projectId:string;revision:string}|null};
type Assignment={id:string;title:string;workspaceId:string;assigneeId:string|null;reviewerId:string|null;dueDate:string;editNumber?:number;status:string;atlasRef?:{projectId:string;revision:string}|null};
export type DashboardOrganization={id:string;name:string;workspaces:Workspace[];participants:Participant[];assignments:Assignment[]};
type AtlasView={projects:Array<{id:string;name:string;total:number;done:number;blocked:number}>;revision:string;mode?:string}|null;
type WidgetSize='third'|'half'|'wide';
type Widget={id:string;size:WidgetSize};
type WidgetSpec={id:string;name:string;size:WidgetSize;group:string};
export const DASHBOARD_WIDGETS:WidgetSpec[]=[
 {id:'summary',name:'Сводка организации',size:'wide',group:'Руководитель'},
 {id:'attention',name:'Требует внимания',size:'half',group:'Руководитель'},
 {id:'quick',name:'Быстрые действия',size:'half',group:'Руководитель'},
 {id:'assignments',name:'Поручения',size:'half',group:'Работа'},
 {id:'structure',name:'Структура компании',size:'wide',group:'Организация'},
 {id:'context',name:'Поиск и вопросы руководителя',size:'wide',group:'Организация'},
 {id:'workspaces',name:'Рабочие области',size:'half',group:'Работа'},
 {id:'process',name:'Маршрут Task / Result',size:'wide',group:'T3'},
 {id:'sources',name:'Корпоративные источники',size:'half',group:'T3'},
 {id:'atlas',name:'Планы Atlas',size:'half',group:'Программы'},
 {id:'agent',name:'Personal Agent и лицензии',size:'half',group:'Программы'},
 {id:'calendar',name:'Сроки поручений',size:'half',group:'Работа'}
];
const initialIds=['summary','attention','quick','assignments','structure','context'];
const specOf=(id:string)=>DASHBOARD_WIDGETS.find(w=>w.id===id);
const initial=():Widget[]=>initialIds.map(id=>({id,size:specOf(id)!.size}));
const storageKey=(id:string)=>'iwxa.admin-center.v8.dashboard.'+id;
function normalized(raw:unknown):Widget[] {
 if(!Array.isArray(raw)||raw.length>12)return initial();
 const unique=new Set<string>(),rows:Widget[]=[];
 for(const value of raw){
  if(!value||typeof value!=='object')continue;
  const id=(value as Widget).id,size=(value as Widget).size;
  if(typeof id!=='string'||!specOf(id)||unique.has(id))continue;
  unique.add(id);rows.push({id,size:['third','half','wide'].includes(size)?size:specOf(id)!.size});
 }
 return rows; // A deliberately empty dashboard is a valid saved preference.
}
function read(id:string):Widget[]{
 try{
  const s=window.localStorage.getItem(storageKey(id));
  return s?normalized(JSON.parse(s)):initial();
 }catch{return initial();}
}
function persist(id:string,items:Widget[]){
 try{window.localStorage.setItem(storageKey(id),JSON.stringify(items));}catch{/* UI preferences remain in memory. */}
}
const DEMO:DashboardOrganization={id:'demo-preview',name:'Пример: производственная компания',workspaces:[
 {id:'demo-1',name:'Производство'}, {id:'demo-2',name:'Снабжение'},{id:'demo-3',name:'Клиентские проекты'}
],participants:[
 {id:'p1',name:'Анна Смирнова',roleLabel:'Руководитель'},
 {id:'p2',name:'Игорь Петров',roleLabel:'Снабжение',personalAgentPlan:'PLANNED'},
 {id:'p3',name:'Ольга Морозова',roleLabel:'Производство'}
],assignments:[
 {id:'a1',title:'Проверить поставки на неделю',workspaceId:'demo-2',assigneeId:'p2',reviewerId:'p1',dueDate:'',status:'DRAFT'},
 {id:'a2',title:'Подготовить производственный план',workspaceId:'demo-1',assigneeId:'p3',reviewerId:'p1',dueDate:'',status:'DRAFT'}
]};
type DashboardProps={
 organization:DashboardOrganization|null|undefined;
 nativeHost:boolean;
 atlasView:AtlasView;
 managerContext?:React.ReactNode;
 onNavigate:(page:PageId)=>void;
 onCreateOrganization:()=>void;
 onNewAssignment:()=>void;
 onOpenAssignment:(id:string)=>void;
 onEnrollEmployee:(id:string)=>void;
};
const action=(title:string,onClick:()=>void,kind='secondary')=>
 <button className={kind} type="button" onClick={onClick}>{title}</button>;

export function AdminCompanyStructure({organization,onNavigate,onOpenAssignment,onEnrollEmployee,compact=false}:{organization:DashboardOrganization;onNavigate:(page:PageId)=>void;onOpenAssignment?:(assignmentId:string)=>void;onEnrollEmployee?:(contactId:string)=>void;compact?:boolean}) {
 const {workspaces,participants,assignments}=organization;
 const lead=participants.find(p=>/руковод|директор|начальник|owner|chief/i.test(p.roleLabel||''))??null;
 // An assignment establishes a working association, NEVER a reporting line
 // or signed corporate grant. Every edge below is derived from this draft.
 const [focused,setFocused]=useState<{kind:'workspace'|'person';id:string}|null>(null);
 const activeWorkspace=focused?.kind==='workspace'?workspaces.find(w=>w.id===focused.id):null;
 const activePerson=focused?.kind==='person'?participants.find(p=>p.id===focused.id):null;
 const relevant=activeWorkspace?assignments.filter(t=>t.workspaceId===activeWorkspace.id):
  activePerson?assignments.filter(t=>t.assigneeId===activePerson.id||t.reviewerId===activePerson.id):[];
 const memberIds=new Set(relevant.flatMap(t=>[t.assigneeId,t.reviewerId]).filter((id):id is string=>!!id));
 const members=participants.filter(p=>memberIds.has(p.id));
 const unitIds=new Set(relevant.map(t=>t.workspaceId));
 const units=workspaces.filter(w=>unitIds.has(w.id));
 return <div className={'v8-company-structure'+(compact?' compact':'')} data-testid="admin-v8-company-structure">
  <div className="v8-company-hub"><span className="v8-hub-label">ОРГАНИЗАЦИЯ</span><strong>{organization.name}</strong>
   <small>{workspaces.length} рабочих областей · {participants.length} сотрудников · {assignments.length} поручений</small>
   {lead&&<span className="v8-company-leader">Руководитель: {lead.name}</span>}
  </div>
  <div className="v8-company-columns">
   <div className="v8-company-column"><div className="v8-column-heading">Рабочие области <button type="button" onClick={()=>onNavigate('resources')}>Открыть</button></div>
    {workspaces.length?workspaces.slice(0,compact?4:12).map(w=><button type="button"
      className={'v8-company-item '+(activeWorkspace?.id===w.id?'selected':'')}
      data-testid={'company-workspace-'+w.id} aria-pressed={activeWorkspace?.id===w.id}
      key={w.id} onClick={()=>setFocused(old=>old?.kind==='workspace'&&old.id===w.id?null:{kind:'workspace',id:w.id})}>
      <strong>{w.name}</strong><small>{assignments.filter(t=>t.workspaceId===w.id).length} поручений{w.atlasRef?' · Atlas '+w.atlasRef.projectId:''}</small>
     </button>):<p className="v8-empty-line">Области ещё не созданы</p>}
   </div>
   <div className="v8-company-column"><div className="v8-column-heading">Команда и ответственность <button type="button" onClick={()=>onNavigate('people')}>Открыть</button></div>
    {participants.length?participants.slice(0,compact?4:12).map(p=><button type="button"
      className={'v8-company-item '+(activePerson?.id===p.id?'selected':'')}
      data-testid={'company-person-'+p.id} aria-pressed={activePerson?.id===p.id}
      key={p.id} onClick={()=>setFocused(old=>old?.kind==='person'&&old.id===p.id?null:{kind:'person',id:p.id})}>
      <strong>{p.name}</strong><small>{p.roleLabel||'Роль не указана'}{p.personalAgentPlan==='PLANNED'?' · Agent запланирован':''}</small>
     </button>):<p className="v8-empty-line">Добавьте сотрудников и определите роли</p>}
   </div>
  </div>
  {(activeWorkspace||activePerson)&&<section className="v8-company-selection" data-testid="company-selection-detail" aria-live="polite">
    <div className="v8-company-selection-head"><div>
      <small>{activeWorkspace?'РАБОЧАЯ ОБЛАСТЬ':'СОТРУДНИК'}</small>
      <strong>{activeWorkspace?.name??activePerson?.name}</strong>
      {activePerson&&<span>{activePerson.roleLabel||'Функция не указана'} · {activePerson.personalAgentPlan==='PLANNED'?'Agent запланирован':'Agent не запланирован'}</span>}
      {activeWorkspace?.atlasRef&&<span>Черновая связь Atlas: {activeWorkspace.atlasRef.projectId}, редакция {activeWorkspace.atlasRef.revision}</span>}
    </div><button type="button" className="quiet" aria-label="Сбросить выбор" onClick={()=>setFocused(null)}>×</button></div>
    <div className="v8-company-selection-grid"><div>
      <strong>{activeWorkspace?'Связанные сотрудники':'Связанные рабочие области'}</strong>
      {activeWorkspace?(members.length?members.map(p=><p key={p.id}>{p.name} <small>· {p.roleLabel||'роль не указана'}</small></p>):<p>Связанных сотрудников пока нет</p>):
        units.length?units.map(w=><p key={w.id}>{w.name}</p>):<p>Поручения с сотрудником ещё не созданы</p>}
    </div><div><strong>Поручения и ответственность</strong>
      {relevant.length?relevant.slice(0,compact?4:12).map(t=><button key={t.id} type="button" className="v8-company-task"
        data-testid={'company-assignment-'+t.id}
        onClick={()=>onOpenAssignment?onOpenAssignment(t.id):onNavigate('work')}>
        <span>{t.title}</span><small> · {t.assigneeId===activePerson?.id?'исполнитель':t.reviewerId===activePerson?.id?'принимает':participants.find(p=>p.id===t.assigneeId)?.name||'исполнитель не выбран'}</small><span aria-hidden="true"> ›</span></button>):
        <p>Связанных поручений пока нет</p>}
    </div></div>
    <div className="v8-company-selection-actions">
      {action('Поручения',()=>onNavigate('work'))}
      {action(activeWorkspace?'Планы Atlas':'Сотрудники и роли',()=>onNavigate(activeWorkspace?'resources':'people'))}
      {activePerson&&onEnrollEmployee&&action('Подключение сотрудника T3',()=>onEnrollEmployee(activePerson.id))}
      {action('Контекст T3',()=>onNavigate('context'))}
    </div>
  </section>}
  <div className="v8-company-links"><div><strong>Рабочие связи</strong>
    <small>Выберите область или сотрудника. Связи выведены из черновиков поручений, а не из подписанных полномочий.</small></div>
   {!compact&&action('Контекст и связи T3',()=>onNavigate('context'))}</div>
 </div>;
}
type DashboardAttention={id:string;title:string;detail:string;page:PageId;assignmentId?:string};
function attention(org:DashboardOrganization|null):DashboardAttention[] {
 if(!org)return [{id:'org',title:'Организация ещё не создана',detail:'Создайте компанию, чтобы начать работу.',page:'overview' as PageId}];
 const rows:DashboardAttention[]=[];
 if(!org.workspaces.length)rows.push({id:'ws',title:'Нет рабочей области',detail:'Для первого поручения нужна рабочая область.',page:'resources'});
 if(!org.participants.length)rows.push({id:'people',title:'Нет сотрудников',detail:'Укажите участников и их роли.',page:'people'});
 for(const task of org.assignments){
  if(!task.assigneeId)rows.push({id:task.id+'a',title:task.title,detail:'Исполнитель не выбран.',page:'work',assignmentId:task.id});
  if(!task.reviewerId)rows.push({id:task.id+'r',title:task.title,detail:'Не указан принимающий Result.',page:'work',assignmentId:task.id});
  if(task.dueDate&&task.dueDate<new Date().toISOString().slice(0,10))
   rows.push({id:task.id+'d',title:task.title,detail:'Срок черновика уже прошёл.',page:'work',assignmentId:task.id});
 }
 return rows.slice(0,8);
}
function asDate(value:string):string{if(!value)return 'Без срока';const d=new Date(value+'T00:00:00');return Number.isFinite(d.valueOf())?d.toLocaleDateString('ru-RU'):'Без срока';}
export default function AdminDashboard({organization,nativeHost,atlasView,managerContext,onNavigate,onCreateOrganization,onNewAssignment,onOpenAssignment,onEnrollEmployee}:DashboardProps){
 const id=organization?.id??'_start';
 const [widgets,setWidgets]=useState<Widget[]>(()=>read(id));
 const [edit,setEdit]=useState(false),[catalog,setCatalog]=useState(false),[demo,setDemo]=useState(false);
 const drag=useRef<string|null>(null);
 const org=organization??(demo?DEMO:null);
 const isDemo=!organization&&demo;
 const setRows=(items:Widget[])=>{setWidgets(items);persist(id,items);};
 const add=(id:string)=>{if(widgets.some(w=>w.id===id))return;const spec=specOf(id);if(!spec)return;setRows([...widgets,{id,size:spec.size}]);setCatalog(false);};
 const remove=(id:string)=>setRows(widgets.filter(w=>w.id!==id));
 const size=(id:string)=>setRows(widgets.map(w=>w.id!==id?w:{...w,size:w.size==='half'?'wide':w.size==='wide'?'third':'half'}));
 const move=(from:string,to:string)=>{
  const arr=widgets.slice(),start=arr.findIndex(w=>w.id===from),end=arr.findIndex(w=>w.id===to);
  if(start<0||end<0||start===end)return;
  const [row]=arr.splice(start,1);arr.splice(end,0,row);setRows(arr);
 };
 const moveOffset=(id:string,n:number)=>{const index=widgets.findIndex(w=>w.id===id),next=widgets[index+n];if(next)move(id,next.id);};
 const openAssignment=(id:string)=>{if(isDemo)return;onOpenAssignment(id);};
 const go=(p:PageId)=>{if(isDemo){setDemo(false);return;}onNavigate(p);};
 const original=!!organization;
 const renderWidget=(id:string):React.ReactNode=>{
  if(id==='summary')return <div className="v8-summary-grid">
   {[
    ['Рабочие области',org?.workspaces.length??0,'Организационная структура'],
    ['Сотрудники',org?.participants.length??0,'Контакты и роли'],
    ['Поручения',org?.assignments.length??0,'Черновики, ещё не Task'],
    ['Personal Agent',org?.participants.filter(p=>p.personalAgentPlan==='PLANNED').length??0,'Запланированные места']
   ].map(([name,count,sub])=><div className="v8-summary-stat" key={String(name)}><span>{name}</span><strong>{count}</strong><small>{sub}</small></div>)}
   </div>;
  if(id==='attention')return <div className="v8-widget-rows">
   {(attention(org).length?attention(org):[{id:'clear',title:'По черновикам вопросов нет',detail:'Подписанный T3 отдельно не прочитан.',page:'results' as PageId,assignmentId:undefined}]).map(a=>
    <button type="button" key={a.id} className="v8-attention" onClick={()=>{if(a.id==='org'&&!organization){onCreateOrganization();return;}if(a.assignmentId){openAssignment(a.assignmentId);return;}go(a.page);}}>
     <span className="v8-attention-dot" aria-hidden="true"/><span><strong>{a.title}</strong><small>{a.detail}</small></span><span aria-hidden="true">›</span>
    </button>)}</div>;
  if(id==='quick')return <div className="v8-quick-grid">
   {[
    ['Новое поручение',onNewAssignment],['Добавить сотрудника',()=>go('people')],
    ['Структура компании',()=>go('people')],['Проверить T3',()=>go('results')],
    ['Планы Atlas',()=>go('resources')],['Рабочие области',()=>go('resources')]
   ].map(([label,fn])=><button type="button" key={String(label)} onClick={fn as ()=>void}>{String(label)}<span>›</span></button>)}
   </div>;
  if(id==='assignments')return <div className="v8-widget-rows">{org?.assignments.length?
    org.assignments.slice(-6).reverse().map(t=><button key={t.id} type="button" className="v8-task-row" onClick={()=>openAssignment(t.id)}>
     <strong>{t.title}</strong><small>{org.participants.find(p=>p.id===t.assigneeId)?.name??'Исполнитель не выбран'} · {asDate(t.dueDate)}</small><span>Открыть ›</span>
    </button>):
    <div className="v8-empty-line">Поручений ещё нет. Создайте первое и назначьте исполнителя.</div>}
    <div className="v8-card-actions">{action('Поручения',()=>go('work'))}</div></div>;
  if(id==='structure')return org?<AdminCompanyStructure organization={org} onNavigate={go} onOpenAssignment={openAssignment} onEnrollEmployee={isDemo?undefined:onEnrollEmployee} compact/>:<div className="v8-empty-line">Структура компании появится после создания организации.</div>;
  if(id==='context')return original?managerContext:<div className="v8-empty-line">Поиск, вопросы руководителя и чтение T3 появятся после создания организации.</div>;
  if(id==='workspaces')return <div className="v8-widget-rows">{org?.workspaces.length?org.workspaces.slice(0,8).map(w=>
    <button key={w.id} className="v8-task-row" type="button" onClick={()=>go('resources')}><strong>{w.name}</strong><small>{org.assignments.filter(t=>t.workspaceId===w.id).length} поручений{w.atlasRef?' · связан Atlas':''}</small></button>):
    <p className="v8-empty-line">Рабочих областей пока нет</p>}
    <div className="v8-card-actions">{action('Открыть рабочие области',()=>go('resources'))}</div></div>;
  if(id==='process')return <div className="v8-process">
   {[
    ['1','Организация','Подписанная Workspace T3'],
    ['2','Сотрудник','PROOF и отдельное ACTION / DATA'],
    ['3','Поручение','Signed Task, .iwxa и Status'],
    ['4','Результат','Reconciliation и Human Review'],
    ['5','Решение','ACCEPT / REJECT, затем отдельный APPLY'],
    ['6','Продолжение','Object/Event, восстановление и новый Task']
   ].map(([n,t,d])=><button key={n} type="button" onClick={()=>go('results')}><b>{n}</b><span><strong>{t}</strong><small>{d}</small></span><span>›</span></button>)}</div>;
  if(id==='sources')return <div className="v8-source-list">
   <p><strong>Локальные черновики</strong><span>Открыты в текущей организации</span></p>
   <p><strong>T3 Owner / исходный Kernel</strong><span>{nativeHost?'Требуется отдельное подписанное чтение':'Не подключено в браузере'}</span></p>
   <p><strong>Подписанные Object/Event</strong><span>Не подменяются черновиками</span></p>
   <div className="v8-card-actions">{action('Открыть корпоративные операции',()=>go('results'))}</div>
   </div>;
  if(id==='atlas')return <div className="v8-summary-grid two">
   <div className="v8-summary-stat"><span>Рабочие области</span><strong>{org?.workspaces.length??0}</strong><small>{org?.workspaces.filter(w=>w.atlasRef).length??0} связаны с Atlas</small></div>
   <div className="v8-summary-stat"><span>Проекты в выбранном источнике</span><strong>{atlasView?.projects.length??0}</strong><small>{atlasView?'Редакция '+atlasView.revision:'Источник не открыт'}</small></div>
   <div className="v8-card-actions">{action('Планы Atlas',()=>go('resources'))}</div>
   </div>;
  if(id==='agent')return <div className="v8-summary-grid two">
   <div className="v8-summary-stat"><span>Места Agent</span><strong>{org?.participants.filter(p=>p.personalAgentPlan==='PLANNED').length??0}</strong><small>Только планирование</small></div>
   <div className="v8-summary-stat"><span>Лицензии Publisher</span><strong>—</strong><small>Проверяются отдельно</small></div>
   <div className="v8-card-actions">{action('Agent и лицензии',()=>go('programs'))}</div>
   </div>;
  if(id==='calendar')return <div className="v8-widget-rows">{org?.assignments.filter(t=>t.dueDate).sort((a,b)=>a.dueDate.localeCompare(b.dueDate)).slice(0,7).map(t=>
   <button className="v8-task-row" type="button" key={t.id} onClick={()=>openAssignment(t.id)}><strong>{t.title}</strong><small>{asDate(t.dueDate)} · черновик</small></button>)??[]}
   {!org?.assignments.some(t=>t.dueDate)&&<p className="v8-empty-line">В черновиках пока нет поручений со сроком.</p>}</div>;
  return null;
 };
 return <section className="v8-dashboard" data-testid="admin-v8-dashboard">
  <div className="v8-dashboard-heading"><div><div className="v8-eyebrow">ПАНЕЛЬ УПРАВЛЕНИЯ</div><h1>Главная</h1><p>Настройте рабочий стол под свою организацию</p></div>
   <div className="v8-dashboard-actions"><button className="primary" type="button" onClick={()=>setCatalog(v=>!v)} data-testid="dashboard-add-widget">＋ Добавить блок</button>
    <button className="secondary" type="button" onClick={()=>setEdit(v=>!v)} data-testid="dashboard-edit">{edit?'Готово':'Настроить'}</button>
    <button className="secondary" type="button" onClick={()=>{setRows(initial());setEdit(false);setCatalog(false);}} data-testid="dashboard-reset">Сбросить вид</button>
   </div>
  </div>
  <div className="v8-dashboard-subline"><span>{organization?.name??'Организация не выбрана'}</span><span>Черновики: локальные данные</span>
   <span>T3: только подтверждённое чтение</span><small>Раскладка сохраняется отдельно для каждой организации</small></div>
  {!organization&&<div className="v8-start-notice"><div><strong>{demo?'Пример компании. Это только предварительный просмотр.':'Настройте рабочее место руководителя'}</strong>
   <p>{demo?'Здесь показаны условные подразделения и сотрудники без подписанных данных.':'Создайте организацию или посмотрите пример, чтобы изучить все блоки и их расположение.'}</p></div>
   <div className="v8-start-actions">{action('Создать организацию',onCreateOrganization,'primary')}
    {action(demo?'Закрыть пример':'Открыть пример компании',()=>setDemo(v=>!v))}</div>
  </div>}
  {catalog&&<div className="v8-widget-catalog" data-testid="dashboard-widget-catalog"><strong>Подключить блок</strong><p>Выберите виджет. В программе будут показаны данные выбранной организации и подтверждённых источников.</p>
   <div className="v8-catalog-grid">{DASHBOARD_WIDGETS.filter(w=>!widgets.some(x=>x.id===w.id)).map(w=>
    <button type="button" key={w.id} onClick={()=>add(w.id)}>＋ {w.name}<small>{w.group}</small></button>)}
    {!DASHBOARD_WIDGETS.some(w=>!widgets.some(x=>x.id===w.id))&&<span>Все блоки подключены</span>}</div>
  </div>}
  {edit&&<p className="v8-edit-hint" role="status">Перетащите блок за заголовок. Можно менять ширину, порядок и состав. Для клавиатуры используйте кнопки вверх и вниз.</p>}
  <div className="v8-widget-grid" data-testid="dashboard-widget-grid">
   {widgets.map(w=><article key={w.id} className={'v8-widget '+w.size} draggable={edit} data-testid={'dashboard-widget-'+w.id}
      onDragStart={e=>{if(!edit){e.preventDefault();return;}drag.current=w.id;e.dataTransfer.setData('text/plain',w.id);e.dataTransfer.effectAllowed='move';}}
      onDragOver={e=>{if(edit){e.preventDefault();e.dataTransfer.dropEffect='move';}}}
      onDrop={e=>{if(edit){e.preventDefault();move(drag.current??e.dataTransfer.getData('text/plain'),w.id);drag.current=null;}}}
      onDragEnd={()=>{drag.current=null;}}>
     <div className="v8-widget-heading"><h2>{edit&&<span className="v8-drag-handle" aria-hidden="true">⋮⋮ </span>}{specOf(w.id)?.name}</h2>
      {edit&&<div className="v8-widget-controls">
       <button type="button" title="Выше" aria-label={'Переместить '+specOf(w.id)?.name+' выше'} onClick={()=>moveOffset(w.id,-1)}>↑</button>
       <button type="button" title="Ниже" aria-label={'Переместить '+specOf(w.id)?.name+' ниже'} onClick={()=>moveOffset(w.id,1)}>↓</button>
       <button type="button" title="Ширина" aria-label={'Изменить ширину '+specOf(w.id)?.name} onClick={()=>size(w.id)}>↔</button>
       <button type="button" title="Убрать" aria-label={'Убрать '+specOf(w.id)?.name} onClick={()=>remove(w.id)}>×</button>
      </div>}
     </div>
     <div className="v8-widget-content">{renderWidget(w.id)}</div>
    </article>)}
   {!widgets.length&&<div className="v8-dashboard-empty">Дашборд пуст. Нажмите «Добавить блок», чтобы собрать свою главную.</div>}
  </div>
 </section>;
}
