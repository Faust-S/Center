import React, {useEffect, useMemo, useRef, useState} from 'react';
import {readManagerSignedContext,managerSignedInboxArgs,prepareManagerOriginalSelection} from './manager-owner-context.mjs';
import {managerActivityArgs,readManagerActivity,managerActivityMatchesSignedOwner,managerActivityFailureCode} from './manager-activity.mjs';
import type {ManagerOriginalSelection} from './manager-original-selection';
import {buildManagerContext, searchManagerContext, managerAttention} from './manager-context.mjs';
import {answerManagerQuestion,MANAGER_QUESTIONS} from './manager-answers.mjs';

type View = 'overview'|'context';
type Destination = 'overview'|'context'|'resources'|'work'|'results'|'people'|'programs'|'data';
type Entry={kind:string;id:string;title:string;summary:string;source:string};
type Alert={key:string;title:string;detail:string;destination:string;assignmentId:string|null};
type ContextOrg={
 id:string;name:string;
 participants:Array<{id:string;name:string;roleLabel:string;personalAgentPlan?:string}>;
 workspaces:Array<{id:string;name:string;atlasRef?:unknown}>;
 assignments:Array<{id:string;title:string;dueDate:string;assigneeId:string|null;atlasRef:unknown}>;
};
type Props={
 organization:ContextOrg;
 atlasView:any;
 view:View;
 atlasStatus:(reference:any)=>string;
 onNavigate:(destination:Destination)=>void;
 onOpenEntry:(entry:Entry)=>void;
 onOpenAttention:(item:Alert)=>void;
 onOpenOriginal:(selection:ManagerOriginalSelection)=>void;
 invoke?:((command:string,args?:Record<string,unknown>)=>Promise<any>)|null;
 sourceGeneration?:number;
};
const destinations:Record<string,Destination>={
 organization:'overview',workspace:'resources',person:'people',
 assignment:'work','atlas-project':'resources','atlas-work':'resources'
};
const names:Record<string,string>={
 organization:'Организация',workspace:'Рабочая область',person:'Сотрудник (черновик)',
 assignment:'Поручение (черновик)','atlas-project':'Проект Atlas (наблюдение)',
 'atlas-work':'Работа Atlas (наблюдение)',
 'signed-task':'Подписанная Task T3',
 'signed-result-package':'Пакет оригинального Reconciliation',
 'd2-object':'Объект оригинального Kernel',
 'd2-event':'Событие оригинального Kernel'
};
const links=[
 {id:'organization',label:'Организация',detail:'Выбранный корпоративный контекст',target:'overview' as Destination},
 {id:'people',label:'Люди',detail:'Контакты и организационные роли',target:'people' as Destination},
 {id:'work',label:'Работа',detail:'Поручения, задачи и решения',target:'work' as Destination},
 {id:'agent',label:'Personal Agent',detail:'Исполнение сотрудника, личная область отдельно',target:'programs' as Destination},
 {id:'t3',label:'T3 / T2 Workspace',detail:'Авторитетные права, объекты и события',target:'results' as Destination},
 {id:'atlas',label:'Atlas',detail:'Необязательный план проектов и работ',target:'resources' as Destination},
 {id:'results',label:'Результаты',detail:'Human Review, приёмка и разрешённое применение',target:'results' as Destination}
];
// Architectural connections, never inferred grants or observed deliveries.
const mapRelations=[
 {from:'organization',to:'people',label:'Состав и ответственность'},
 {from:'organization',to:'work',label:'Организация работы'},
 {from:'people',to:'agent',label:'Личный инструмент участника'},
 {from:'work',to:'t3',label:'Подписанные операции и история'},
 {from:'agent',to:'t3',label:'Только разрешённая корпоративная Workspace'},
 {from:'work',to:'atlas',label:'План проекта, необязательно'},
 {from:'t3',to:'results',label:'Review, затем отдельный Apply'}
];
export default function ManagerContextPanel({organization,atlasView,view,atlasStatus,onNavigate,onOpenEntry,onOpenAttention,onOpenOriginal,invoke=null,sourceGeneration=0}:Props) {
 const [query,setQuery]=useState('');
 const [selectedQuestion,setSelectedQuestion]=useState<string|null>(null);
 // Explicit read only: no background signer initialization or repeating
 // requests whenever React renders. Clear on a changed organization,
 // original Kernel child lifecycle, or unmount. Retained native observations
 // must never look live after the signed Workspace has closed/reopened.
 const request=useRef(0);
 const [owner,setOwner]=useState<any>(null);
 const [ownerIssue,setOwnerIssue]=useState('');
 const [inboxIssue,setInboxIssue]=useState('');
 const [loading,setLoading]=useState(false);
 const [activity,setActivity]=useState<any>(null);
 const [activityLoading,setActivityLoading]=useState(false);
 const [activityIssue,setActivityIssue]=useState('');
 const [activityPhase,setActivityPhase]=useState<'session'|'kernel'|'verify'|null>(null);
 const [activitySlow,setActivitySlow]=useState(false);
 const [activityTiming,setActivityTiming]=useState<{totalMs:number;kernelMs:number}|null>(null);
 useEffect(()=>{
   setActivitySlow(false);
   if(!activityLoading||activityPhase!=='kernel')return;
   const timeout=window.setTimeout(()=>setActivitySlow(true),15000);
   return()=>window.clearTimeout(timeout);
 },[activityLoading,activityPhase]);
 const [selectedEvidence,setSelectedEvidence]=useState<Entry|null>(null);
 useEffect(()=>{
   request.current++;
   setOwner(null);setOwnerIssue('');setInboxIssue('');setLoading(false);
   setActivity(null);setActivityLoading(false);setActivityIssue('');setSelectedEvidence(null);
   setActivityPhase(null);setActivitySlow(false);setActivityTiming(null);
   return()=>{request.current++};
 },[organization.id,sourceGeneration]);
 const refreshSigned=async()=>{
   if(!invoke||loading||activityLoading)return;
   const selectedId=organization.id,seq=++request.current;
   setOwner(null);setOwnerIssue('');setInboxIssue('');setLoading(true);
   setActivity(null);setActivityIssue('');setSelectedEvidence(null);setActivityTiming(null);
   try {
     const snapshot=await invoke('center_corporate_state',{organizationId:selectedId});
     let readback=readManagerSignedContext(snapshot,selectedId);
     if(readback.status==='SIGNED_D3_READBACK'){
       try {
         const inbox=await invoke('center_corporate_action',
           managerSignedInboxArgs(snapshot,selectedId));
         readback=readManagerSignedContext(snapshot,selectedId,inbox);
       }catch{
         if(seq===request.current)setInboxIssue('Журнал Reconciliation не прочитан. Показаны только подписанные Task. Проверьте корпоративный сеанс.');
       }
     }
     if(seq===request.current)setOwner(readback);
   }catch{
     if(seq===request.current)setOwnerIssue('Оригинальный T3 не подтвердил чтение корпоративного контекста. Данные не показаны.');
   }finally{if(seq===request.current)setLoading(false);}
 };
 const refreshActivity=async()=>{
   if(!invoke||loading||activityLoading||owner?.status!=='SIGNED_D3_READBACK'||
      owner.organizationId!==organization.id)return;
   const seq=++request.current,orgId=organization.id;
   const started=Date.now();let kernelStarted=0;
   setActivity(null);setActivityIssue('');setSelectedEvidence(null);setActivityLoading(true);
   setActivityTiming(null);setActivityPhase('session');
   try {
     const fresh=await invoke('center_corporate_state',{organizationId:orgId});
     const current:any=readManagerSignedContext(fresh,orgId);
     if(current.status!=='SIGNED_D3_READBACK'||
       current.organizationId!==owner.organizationId||
       current.workspaceId!==owner.workspaceId||
       current.actorId!==owner.actorId||
       current.contextId!==owner.contextId||
       current.contextEpoch!==owner.contextEpoch)
       throw Error('CEN_D2_ORIGINAL_SIGNED_CONTEXT_CHANGED');
     kernelStarted=Date.now();if(seq===request.current)setActivityPhase('kernel');
     const original=await invoke('center_corporate_action',managerActivityArgs(fresh,orgId));
     if(seq===request.current)setActivityPhase('verify');
     const readback=readManagerActivity(fresh,orgId,original);
     if(!managerActivityMatchesSignedOwner(readback,owner))
       throw Error('CEN_D2_ORIGINAL_SIGNED_CONTEXT_CHANGED');
     if(seq===request.current){
       setActivity(readback);
       setActivityTiming({totalMs:Date.now()-started,kernelMs:Date.now()-kernelStarted});
     }
   }catch(error){
     if(seq===request.current){
       const code=managerActivityFailureCode(error);
       setActivityIssue(code==='WORKSPACE_NOT_ACTIVE'
         ?'В исходном T2 Kernel пока нет действующей корпоративной Workspace. Откройте «Результаты» → «Открыть Workspace T3» и дождитесь её подтверждения. Если исходный T3 предлагает «Создать выбранную Workspace», подтвердите создание отдельным подписанным правом workspace.create. Затем перечитайте данные здесь. Код: '+code+'.'
         :'Исходные Object/Event не прочитаны. Проверьте открытую Workspace T3 и отдельное подписанное право activity.read. Данные других источников не подставляются. Код: '+code+'.');
     }
   }finally{if(seq===request.current){setActivityLoading(false);setActivityPhase(null);}}
 };
 const [selection,setSelection]=useState('organization');
 const rows=useMemo(()=>[
     ...buildManagerContext(organization,atlasView),
     ...(owner?.status==='SIGNED_D3_READBACK'&&owner.organizationId===organization.id
       ?owner.entries:[]),
     ...(managerActivityMatchesSignedOwner(activity,owner)
       ?activity.entries:[])
   ] as Entry[],[organization,atlasView,owner,activity]);
 const alerts=useMemo(()=>[
   ...(owner?.status==='SIGNED_D3_READBACK'&&owner.organizationId===organization.id
     ?owner.attention:[]),
   ...managerAttention(organization,{
     today:new Date().toLocaleDateString('en-CA',{timeZone:'UTC'}),atlasStatus
   })
 ] as Alert[],[organization,atlasStatus,owner]);
 const hits=useMemo(()=>searchManagerContext(rows,query,view==='overview'?6:24) as Entry[],
   [rows,query,view]);
 const selected=links.find(x=>x.id===selection)??links[0];
 const full=view==='context';
 const available=atlasView?.projects?.length??0;
 const openOriginal=(kind:string,id:string)=>{
   const selection=prepareManagerOriginalSelection(owner,organization.id,kind,id);
   if(selection)onOpenOriginal(selection);
 };
 const openHit=(hit:Entry)=>{
   if(hit.kind==='signed-task'||hit.kind==='signed-result-package')
     openOriginal(hit.kind,hit.id);
   else if(hit.kind==='d2-object'||hit.kind==='d2-event')
     setSelectedEvidence(hit);
   else onOpenEntry(hit);
 };
 const answer=useMemo(()=>selectedQuestion
   ?answerManagerQuestion(selectedQuestion,{organization,owner,atlasView,rows,alerts,
      activity:managerActivityMatchesSignedOwner(activity,owner)?activity:null})
   :null,[selectedQuestion,organization,owner,atlasView,rows,alerts,activity]);
 const openAnswerItem=(item:any)=>{
   if(item.kind==='attention'){
     const alert=alerts.find(a=>a.key===item.id);
     if(alert)openAlert(alert);
     return;
   }
   const entry=rows.find(row=>row.kind===item.kind&&row.id===item.id);
   if(entry)openHit(entry);
 };
 const openAlert=(item:Alert)=>{
   if(item.key.startsWith('signed-inbox:'))openOriginal('signed-result-package',item.key.slice('signed-inbox:'.length));
   else onOpenAttention(item);
 };
 const mapRelationsForNode=mapRelations.filter(relation=>relation.from===selection||relation.to===selection)
   .map(relation=>({...relation,neighbor:relation.from===selection?relation.to:relation.from}));
 const mapFacts:Record<string,string>={
   organization:'Выбрана: '+organization.name,
   people:(organization.participants?.length??0)+' контактов в черновике',
   work:(organization.assignments?.length??0)+' черновиков поручений',
   agent:'Личный Agent отделён от данных компании',
   t3:managerActivityMatchesSignedOwner(activity,owner)
     ?'Оригинал: '+activity.counts.objects+' Object / '+activity.counts.events+' Event'
     :owner?.status==='SIGNED_D3_READBACK'&&owner.organizationId===organization.id
       ?'Прочитано: '+owner.totalTasks+' Task':'Подписанные сведения не прочитаны',
   atlas:available>0?'Открыто проектов: '+available:'Источник необязателен',
   results:owner?.inboxLoaded&&owner.organizationId===organization.id
     ?'Пакетов: '+owner.inboxTotal:'Журнал Reconciliation не прочитан'
 };
 return <section className="manager-context" data-testid={full?'manager-context-detail':'manager-context-overview'}>
   <div className="card padded manager-search">
     <div className="section-head"><h2>{full?'Поиск по доступному контексту':'Что нужно найти или решить?'}</h2>
       {!full&&<button type="button" className="secondary" onClick={()=>onNavigate('overview')}>Текущая организация</button>}
     </div>
     <label className="manager-search-label" htmlFor={full?'context-query':'overview-query'}>Поиск по выбранной организации</label>
     <input id={full?'context-query':'overview-query'} type="search" value={query} onChange={e=>setQuery(e.target.value)}
       data-testid={full?'context-search':'overview-search'}
       placeholder="Сотрудник, поручение, рабочая область, проект..."
       autoComplete="off"/>
     <p className="muted manager-context-note">Черновики текущей организации и явно открытый Atlas доступны отдельно.
       После ручного чтения T3 добавляются подписанные Task и полученные пакеты исходного Reconciliation.
       Оригинальные Object/Event доступны после отдельного подписанного права DATA и ручного чтения.
       Снимки не являются сквозным семантическим поиском. Личные данные Agent не читаются.</p>
     <div className="manager-owner-readback" data-testid="manager-owner-readback">
       <button className="secondary" type="button" data-testid="manager-read-signed"
         disabled={!invoke||loading||activityLoading} onClick={()=>{void refreshSigned()}}>
         {loading?'Читаем T3...':'Обновить подписанные сведения T3'}
       </button>
       {!invoke&&<small className="muted">Нативный T3 недоступен в браузере. Пробные права не создаются.</small>}
       {owner?.status==='NOT_CONNECTED'&&<small className="muted">Подписанный владелец T3 D3 для этой организации не подключён. Откройте «Результаты» для подключения.</small>}
       {owner?.status==='SIGNED_D3_READBACK'&&owner.organizationId===organization.id&&
         <div role="status" data-testid="manager-signed-summary" className="manager-signed-summary">
           <strong>Подписанная Workspace · {owner.workspaceId}</strong>
           <span>Task в оригинальном T3: {owner.totalTasks}.
             {owner.inboxLoaded
               ?' Пакетов Reconciliation: '+owner.inboxTotal+(owner.inboxTruncated?' (показана часть).':'.')
               :' Журнал Result ещё не подтверждён.'}
             {' '}Доставка Task и Kernel Apply не подтверждаются этим обзором.</span>
         </div>}
       {owner?.status==='SIGNED_D3_READBACK'&&owner.organizationId===organization.id&&<>
         <p role="status" data-testid="manager-native-d2-readiness" className="muted">
           {owner.d2ReaderConnected
             ?'T3 DATA: исходный Kernel подключён к нативному читателю. Подписанное activity.read проверяется при каждом чтении.'
             :'T3 DATA: нативный читатель Object/Event ещё не подключён. Откройте Workspace T3 в «Результатах», дождитесь ядра и обновите подписанные сведения. Данные не подменяются.'}
         </p>
         <button className="secondary" type="button" data-testid="manager-read-activity"
           disabled={!invoke||loading||activityLoading} onClick={()=>{void refreshActivity()}}>
           {activityLoading?'Читаем Object/Event...':'Перечитать Object/Event через T3 DATA'}
         </button>
         {activityLoading&&<p className="manager-data-read-progress" data-testid="manager-data-read-progress" role="status">
           {activityPhase==='session'?'Проверяю выбранную организацию и актуальность подписанного сеанса.':
            activityPhase==='kernel'?'Ожидаю адресное чтение Object/Event из исходного T2 Kernel.':
            'Проверяю исходные записи и их принадлежность выбранной Workspace.'}
           {activitySlow&&<small>Чтение исходного Kernel продолжается. Повторный запрос до получения ответа не нужен.</small>}
         </p>}
         {!activityLoading&&!activity?.status&&<small className="muted">Откройте «Результаты» → «Открыть Workspace T3», затем «К приёмке» и вернитесь сюда. Для чтения требуется отдельное подписанное право activity.read.</small>}
       </>}
       {managerActivityMatchesSignedOwner(activity,owner)&&
         <div className="manager-signed-summary" data-testid="manager-activity-summary" role="status">
           <strong>Оригинальный T2 Kernel · Workspace {activity.workspaceId}</strong>
           <span>Object: {activity.counts.objects}; Event: {activity.counts.events};
             связей: {activity.counts.relations}; неразрешённых ссылок: {activity.counts.unresolved};
             без предметной привязки: {activity.counts.unmappedObjects} Object и {activity.counts.unmappedEvents} Event.</span>
           <small>Это метаданные исходных записей, не доказательство выполнения хозяйственных действий.</small>
           {activityTiming&&<small data-testid="manager-data-read-timing">Время ожидания интерфейса: {Math.round(activityTiming.totalMs/1000)} с, из них чтение исходного Kernel: {Math.round(activityTiming.kernelMs/1000)} с.</small>}
         </div>}
       {activityIssue&&<div role="alert" className="muted" data-testid="manager-activity-issue">
         <small>{activityIssue}</small>
         {activityIssue.includes('Код: WORKSPACE_NOT_ACTIVE')&&
           <button className="secondary" type="button" data-testid="manager-open-workspace-remedy"
             onClick={()=>onNavigate('results')}>Открыть подписанную Workspace в «Результатах»</button>}
       </div>}
       {inboxIssue&&<small role="status" className="muted" data-testid="manager-inbox-issue">{inboxIssue}</small>}
       {ownerIssue&&<small role="alert" className="muted" data-testid="manager-owner-error">{ownerIssue}</small>}
     </div>
     {query.trim()&&<div className="manager-results" aria-live="polite" data-testid={full?'context-hits':'overview-hits'}>
       {hits.length?hits.map(hit=><button key={hit.kind+'|'+hit.id} type="button" className="manager-hit"
         onClick={()=>openHit(hit)} data-testid="manager-search-hit">
         <span className="manager-hit-name"><strong>{hit.title}</strong><small>{names[hit.kind]??hit.kind} · {hit.source}</small></span>
         <span className="manager-hit-description">{hit.summary}</span>
         <span aria-hidden="true">›</span>
       </button>):<p className="muted">В доступных источниках совпадений нет. Это не поиск по всем данным T3 или Personal Agent.</p>}
     </div>}
     {selectedEvidence&&managerActivityMatchesSignedOwner(activity,owner)&&
       activity.entries.some((row:any)=>row.kind===selectedEvidence.kind&&row.id===selectedEvidence.id)&&
       <div className="manager-evidence-detail" data-testid="manager-original-evidence-detail">
         <div className="section-head"><strong>Источник · оригинальный T2 Kernel</strong>
           <button className="quiet" type="button" onClick={()=>setSelectedEvidence(null)}>Закрыть</button></div>
         <strong>{selectedEvidence.title}</strong>
         <p>{selectedEvidence.summary}</p>
         <small>{selectedEvidence.source}. ID: {selectedEvidence.id}.
           Это read-only чтение, а не Kernel Apply.</small>
       </div>}
   </div>
   <section className="card padded manager-question-card" data-testid="manager-questions">
     <div className="section-head"><h2>Вопросы руководителя</h2><small className="muted">Ответы по источникам, без ИИ-генерации</small></div>
     <div className="manager-question-choices">
       {MANAGER_QUESTIONS.map(question=><button key={question.id} type="button"
         className={selectedQuestion===question.id?'secondary manager-question-active':'quiet'}
         data-testid={'manager-question-'+question.id}
         aria-pressed={selectedQuestion===question.id}
         onClick={()=>setSelectedQuestion(old=>old===question.id?null:question.id)}>
         {question.label}
       </button>)}
     </div>
     {answer&&<div className="manager-answer" data-testid="manager-answer" aria-live="polite">
       <strong>{answer.title}</strong>
       <p>{answer.summary}</p>
       <small className="muted">{answer.scope}</small>
       {answer.status==='SOURCE_REQUIRED'&&invoke&&
         <button className="secondary" type="button" disabled={loading}
           onClick={()=>{void refreshSigned()}}>Перечитать оригинальный T3</button>}
       {answer.items.length>0&&<div className="manager-answer-sources" data-testid="manager-answer-sources">
         {answer.items.map((item:any)=><button className="manager-answer-source" type="button" key={item.key}
           onClick={()=>openAnswerItem(item)}>
           <strong>{item.title}</strong><small>{item.source}</small><span>{item.detail}</span>
         </button>)}
       </div>}
     </div>}
   </section>
   <div className="card padded manager-attention" data-testid="manager-attention">
     <div className="section-head"><h2>Требует внимания</h2><small className="muted">Черновики{owner?.inboxLoaded?' и оригинальный T3':''}</small></div>
     {alerts.length?alerts.slice(0,full?12:4).map(a=><button type="button" key={a.key}
       className="manager-attention-item" onClick={()=>openAlert(a)} data-testid="manager-attention-item">
       <span><strong>{a.title}</strong><small>{a.detail}</small></span><span aria-hidden="true">›</span>
     </button>):<p className="muted">В доступных черновиках нет выявленных вопросов. Состояние неподключённого корпоративного владельца здесь не оценивалось.</p>}
     {!full&&<button type="button" className="quiet" data-testid="open-context-map" onClick={()=>onNavigate('context')}>Открыть карту организации и полный поиск →</button>}
   </div>
   {full&&<>
     <section className="card padded" data-testid="corporate-interactive-map">
       <div className="section-head"><h2>Как устроена работа организации</h2><span className="status neutral">Интерактивная карта</span></div>
       <p className="muted">Выберите элемент карты для пояснения и перехода к действительной области работы.
         Связи показывают устройство продукта, а не подтверждают наличие доступа или доставку данных.</p>
       <div className="manager-map" role="group" aria-label="Интерактивная карта организации">
         <svg className="manager-map-edges" viewBox="0 0 900 600" preserveAspectRatio="none" aria-hidden="true">
           <defs><marker id="manager-flow-arrow" markerWidth="8" markerHeight="8" refX="6" refY="3"
             orient="auto"><path d="M0,0 L6,3 L0,6 Z" fill="#96b0cc"/></marker></defs>
           <g fill="none" stroke="#96b0cc" strokeWidth="2" markerEnd="url(#manager-flow-arrow)">
             <path d="M425 140 L230 258"/><path d="M450 145 L450 248"/>
             <path d="M280 255 C400 185 600 185 645 255" strokeDasharray="6 6"/>
             <path d="M450 352 L450 445"/>
             <path d="M395 354 L250 449" strokeDasharray="6 6"/>
             <path d="M650 352 L510 445" strokeDasharray="6 6"/>
             <path d="M550 500 L635 500"/>
           </g>
         </svg>
         {links.map(node=><button type="button" key={node.id}
           className={'manager-map-node '+(selection===node.id?'selected ':'')+'manager-map-'+node.id}
           aria-pressed={selection===node.id} data-testid={'context-map-'+node.id}
           onClick={()=>setSelection(node.id)}>
           <strong>{node.label}</strong><small>{node.detail}</small><span className="manager-map-fact">{mapFacts[node.id]}</span>
         </button>)}
       </div>
       <div className="manager-map-relations" data-testid="manager-map-relations" aria-label="Связи выбранного узла">
         <strong>Связанные элементы</strong>
         <div>{mapRelationsForNode.map(relation=>{
           const neighbor=links.find(node=>node.id===relation.neighbor);
           return <button key={relation.from+'-'+relation.to} type="button" className="secondary"
             data-testid={'manager-relation-'+relation.neighbor}
             onClick={()=>setSelection(relation.neighbor)}>
             {neighbor?.label}: {relation.label}
           </button>;
         })}</div>
         <small className="muted">Сплошные связи обозначают основной маршрут; пунктирные показывают возможное или необязательное взаимодействие. Это схема устройства, не доказательство выдачи прав или доставки.</small>
       </div>
       <div className="manager-map-detail" data-testid="context-map-detail">
         <div><strong>{selected.label}</strong><p>{selected.detail}.</p>
           {selection==='organization'&&<p>Текущая организация: {organization.name}; {organization.workspaces.length} рабочих областей,
             {organization.participants.length} контактов, {organization.assignments.length} черновиков поручений.</p>}
           {selection==='atlas'&&<p>{available
             ? 'Наблюдаемые проекты: '+available+'. Это открытый источник, не проверка организационных прав.'
             : 'Проектный источник не открыт. Для обычных поручений Atlas необязателен.'}</p>}
           {selection==='t3'&&<p>Оригинальный T3 является владельцем подписанных полномочий и действий. Показанные здесь черновики не дают такого допуска.
             {owner?.status==='SIGNED_D3_READBACK'
               ?' Последнее чтение: '+owner.totalTasks+' подписанных Task; контекст '+owner.workspaceId+
                 (managerActivityMatchesSignedOwner(activity,owner)
                   ?'; Kernel Object '+activity.counts.objects+', Event '+activity.counts.events+'.'
                   :'; чтение Object/Event не выполнено.')
               :' Подписанное состояние не прочитано в этом разделе.'}</p>}
           {selection==='agent'&&<p>Руководитель также работает в собственном Personal Agent. Личная информация не становится корпоративной автоматически; подписанное поручение передаётся существующим маршрутом T3.</p>}
           {selection==='results'&&<p>{owner?.inboxLoaded
             ?'Журнал исходного Reconciliation: '+owner.inboxTotal+' пакетов. ACCEPT не подтверждает Kernel Apply.'
             :'Журнал оригинального Reconciliation здесь не перечитан. Для решений откройте исходный T3.'}</p>}
         </div>
         <button type="button" className="secondary" data-testid="context-map-open" onClick={()=>onNavigate(selected.target)}>Открыть раздел</button>
       </div>
     </section>
     <section className="card padded" data-testid="manager-agent-integration">
       <h2>Руководитель и Personal Agent</h2>
       <div className="manager-agent-paths">
         <div><strong>Личная работа руководителя</strong><p>Открывайте личного Agent отдельно. Контекст организации передаётся только через действительные полномочия и выбранную Workspace, без автоматического чтения личной памяти.</p></div>
         <div><strong>Корпоративное поручение</strong><p>Подготовьте поручение здесь. Его подписание, передача сотруднику, Result и рассмотрение выполняются оригинальными механизмами T3 и Agent.</p></div>
       </div>
       <button type="button" className="secondary" onClick={()=>onNavigate('results')}>Открыть корпоративные операции</button>
     </section>
   </>}
 </section>;
}
