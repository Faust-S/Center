import React, {useEffect, useMemo, useRef, useState} from 'react';
import {readManagerSignedContext,managerSignedInboxArgs} from './manager-owner-context.mjs';
import {buildManagerContext, searchManagerContext, managerAttention} from './manager-context.mjs';

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
 invoke?:((command:string,args?:Record<string,unknown>)=>Promise<any>)|null;
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
 'signed-result-package':'Пакет оригинального Reconciliation'
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
export default function ManagerContextPanel({organization,atlasView,view,atlasStatus,onNavigate,onOpenEntry,onOpenAttention,invoke=null}:Props) {
 const [query,setQuery]=useState('');
 // Explicit read only: no background signer initialization or repeating
 // requests whenever React renders. Clear on a changed organization/unmount.
 const request=useRef(0);
 const [owner,setOwner]=useState<any>(null);
 const [ownerIssue,setOwnerIssue]=useState('');
 const [inboxIssue,setInboxIssue]=useState('');
 const [loading,setLoading]=useState(false);
 useEffect(()=>{
   request.current++;
   setOwner(null);setOwnerIssue('');setInboxIssue('');setLoading(false);
   return()=>{request.current++};
 },[organization.id]);
 const refreshSigned=async()=>{
   if(!invoke||loading)return;
   const selectedId=organization.id,seq=++request.current;
   setOwner(null);setOwnerIssue('');setInboxIssue('');setLoading(true);
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
 const [selection,setSelection]=useState('organization');
 const rows=useMemo(()=>[
     ...buildManagerContext(organization,atlasView),
     ...(owner?.status==='SIGNED_D3_READBACK'&&owner.organizationId===organization.id
       ?owner.entries:[])
   ] as Entry[],[organization,atlasView,owner]);
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
       Это снимок на момент запроса, не сквозной поиск по всем Object/Event/Result. Личные данные Agent не читаются.</p>
     <div className="manager-owner-readback" data-testid="manager-owner-readback">
       <button className="secondary" type="button" data-testid="manager-read-signed"
         disabled={!invoke||loading} onClick={()=>{void refreshSigned()}}>
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
       {inboxIssue&&<small role="status" className="muted" data-testid="manager-inbox-issue">{inboxIssue}</small>}
       {ownerIssue&&<small role="alert" className="muted" data-testid="manager-owner-error">{ownerIssue}</small>}
     </div>
     {query.trim()&&<div className="manager-results" aria-live="polite" data-testid={full?'context-hits':'overview-hits'}>
       {hits.length?hits.map(hit=><button key={hit.kind+'|'+hit.id} type="button" className="manager-hit"
         onClick={()=>onOpenEntry(hit)} data-testid="manager-search-hit">
         <span className="manager-hit-name"><strong>{hit.title}</strong><small>{names[hit.kind]??hit.kind} · {hit.source}</small></span>
         <span className="manager-hit-description">{hit.summary}</span>
         <span aria-hidden="true">›</span>
       </button>):<p className="muted">В доступных источниках совпадений нет. Это не поиск по всем данным T3 или Personal Agent.</p>}
     </div>}
   </div>
   <div className="card padded manager-attention" data-testid="manager-attention">
     <div className="section-head"><h2>Требует внимания</h2><small className="muted">Черновики{owner?.inboxLoaded?' и оригинальный T3':''}</small></div>
     {alerts.length?alerts.slice(0,full?12:4).map(a=><button type="button" key={a.key}
       className="manager-attention-item" onClick={()=>onOpenAttention(a)} data-testid="manager-attention-item">
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
         {links.map(node=><button type="button" key={node.id}
           className={'manager-map-node '+(selection===node.id?'selected ':'')+'manager-map-'+node.id}
           aria-pressed={selection===node.id} data-testid={'context-map-'+node.id}
           onClick={()=>setSelection(node.id)}>
           <strong>{node.label}</strong><small>{node.detail}</small>
         </button>)}
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
               ?' Последнее чтение: '+owner.totalTasks+' подписанных Task; контекст '+owner.workspaceId+'.'
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
