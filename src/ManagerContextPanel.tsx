import React, {useMemo, useState} from 'react';
import {buildManagerContext, searchManagerContext, managerAttention} from './manager-context.mjs';

type View = 'overview'|'context';
type Destination = 'overview'|'resources'|'work'|'results'|'people'|'programs'|'data';
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
};
const destinations:Record<string,Destination>={
 organization:'overview',workspace:'resources',person:'people',
 assignment:'work','atlas-project':'resources','atlas-work':'resources'
};
const names:Record<string,string>={
 organization:'Организация',workspace:'Рабочая область',person:'Сотрудник (черновик)',
 assignment:'Поручение (черновик)','atlas-project':'Проект Atlas (наблюдение)',
 'atlas-work':'Работа Atlas (наблюдение)'
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
export default function ManagerContextPanel({organization,atlasView,view,atlasStatus,onNavigate,onOpenEntry,onOpenAttention}:Props) {
 const [query,setQuery]=useState('');
 const [selection,setSelection]=useState('organization');
 const rows=useMemo(()=>buildManagerContext(organization,atlasView) as Entry[],[organization,atlasView]);
 const alerts=useMemo(()=>managerAttention(organization,{
   today:new Date().toLocaleDateString('en-CA',{timeZone:'UTC'}),
   atlasStatus
 }) as Alert[],[organization,atlasStatus]);
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
     <p className="muted manager-context-note">Поиск только по локальным черновикам текущей организации и явно открытому наблюдению Atlas.
       Черновики не являются подписанными Task, подтверждёнными правами или принятыми Result. Личные данные Agent не читаются.</p>
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
     <div className="section-head"><h2>Требует внимания</h2><small className="muted">По данным подготовки</small></div>
     {alerts.length?alerts.slice(0,full?12:4).map(a=><button type="button" key={a.key}
       className="manager-attention-item" onClick={()=>onOpenAttention(a)} data-testid="manager-attention-item">
       <span><strong>{a.title}</strong><small>{a.detail}</small></span><span aria-hidden="true">›</span>
     </button>):<p className="muted">В доступных черновиках нет выявленных вопросов. Состояние неподключённого корпоративного владельца здесь не оценивалось.</p>}
     {!full&&<button type="button" className="quiet" data-testid="open-context-map" onClick={()=>onNavigate('context' as Destination)}>Открыть карту организации и полный поиск →</button>}
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
           {selection==='t3'&&<p>Оригинальный T3 является владельцем подписанных полномочий и действий. Показанные здесь черновики не дают такого допуска.</p>}
           {selection==='agent'&&<p>Руководитель также работает в собственном Personal Agent. Личная информация не становится корпоративной автоматически; подписанное поручение передаётся существующим маршрутом T3.</p>}
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
