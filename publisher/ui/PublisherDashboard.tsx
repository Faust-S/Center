import React from 'react';

// UI-only settings. No product data, credentials, entitlement or license state.
export const UI_PREF_KEY='iwxa.publisher.ui.v2';
export type Page='overview'|'products'|'tariffs'|'holders'|'proposals'|'releases'|'trust'|'settings';
export type WidgetId='corporate'|'person'|'products'|'tariffs'|'clients'|'preparations'|'ledger'|'trust'|'releases'|'delivery'|'age'|'backups'|'diagnostics'|'recovery';
export type Widget={id:WidgetId;wide:boolean};
export type Preferences={widgets:Widget[];dockWidth:number;dockOpen:boolean};
type Draft={products:{id:string;name:string;version:string}[];
 holders:{id:string;type:string;name:string}[];
 tariffs:{id:string;productId:string;name:string;holderType:string}[];
 proposals:{id:string;productId:string;holderId:string;previousProposalId?:string}[];
 artifacts:{id:string;productId:string;name:string;platform:string}[]};
type Attention={attentionInShown:number;shown:number;total:number;truncated:boolean}|null;
type Diagnostics={localPreparation:'READABLE'|'EMPTY'|'NEEDS_ATTENTION';
 webviewProfile:'FOLDER_PRESENT'|'FOLDER_NOT_OBSERVED';attentionRequired:boolean}|null;
type Spec={label:string;category:string;summary:string;source:string;page:Page};
export const WIDGETS:Record<WidgetId,Spec>={
 corporate:{label:'Лицензия организации',category:'Лицензии',summary:'Admin Center и назначаемый пул корпоративных Personal Agent.',source:'Черновики Publisher и исходный T3',page:'proposals'},
 person:{label:'Лицензии PERSON',category:'Лицензии',summary:'Подпись, STATUS, продление и контроль получателя.',source:'Только проверенный оригинальный T3',page:'trust'},
 products:{label:'Продукты',category:'Каталог',summary:'Программы и связь с лицензиями, тарифами и релизами.',source:'Нативные черновики Publisher',page:'products'},
 tariffs:{label:'Тарифы и квоты',category:'Каталог',summary:'Редакции, тарифные места, функции и квоты.',source:'Нативные черновики Publisher',page:'tariffs'},
 clients:{label:'Клиенты',category:'Каталог',summary:'Организации и физические лица без неявных прав.',source:'Нативные черновики Publisher',page:'holders'},
 preparations:{label:'Предложения и продление',category:'Лицензии',summary:'Неподписанные заявки, повторная подготовка и тарифный снимок.',source:'Не является лицензией',page:'proposals'},
 ledger:{label:'Журнал T3 и STATUS',category:'Контроль',summary:'ISSUE, STATUS, отзыв, история, точный readback.',source:'Оригинальный T3 Owner',page:'trust'},
 trust:{label:'Публичное доверие',category:'Контроль',summary:'Исходные ключи и полномочия; доверие отдельно от .iwxa.',source:'Оригинальный T3 Owner',page:'trust'},
 releases:{label:'Релизы и проверка файлов',category:'Выпуск',summary:'SHA-256, две копии и проверка источников.',source:'Проверка файла ≠ разрешение на выпуск',page:'releases'},
 delivery:{label:'Обмен .iwxa',category:'Выпуск',summary:'Импорт и экспорт, отдельная приёмка получателя.',source:'Подлинность подтверждается отдельно',page:'trust'},
 age:{label:'Шифрованная передача age',category:'Выпуск',summary:'.iwxa.age и ключи получателей для адресной передачи.',source:'Исходный age v1.3.1',page:'trust'},
 backups:{label:'Резервные копии',category:'Система',summary:'Сохранение и подтверждённое восстановление черновиков.',source:'Нативные данные Publisher',page:'overview'},
 diagnostics:{label:'Диагностика',category:'Система',summary:'Windows, WebView2, Setup Core и сохранённые данные.',source:'Установленная программа',page:'overview'},
 recovery:{label:'Потерянная квитанция ACK',category:'Контроль',summary:'Перед повтором сверить подписанный журнал издателя.',source:'Оригинальный T3 Owner',page:'trust'}
};
export const DEFAULT_WIDGETS:Widget[]=[
 {id:'corporate',wide:true},{id:'person',wide:false},{id:'products',wide:false},
 {id:'tariffs',wide:false},{id:'clients',wide:false},{id:'preparations',wide:false},
 {id:'releases',wide:false},{id:'trust',wide:false},{id:'backups',wide:false}
];
export function readPreferences():Preferences{
 const defaults=()=>({widgets:DEFAULT_WIDGETS.map(w=>({...w})),dockWidth:375,dockOpen:false});
 if(typeof window==='undefined')return defaults();
 try{
  const raw=JSON.parse(window.localStorage.getItem(UI_PREF_KEY)||'null');
  if(!raw||typeof raw!=='object')return defaults();
  const seen=new Set<string>();
  const widgets=Array.isArray(raw.widgets)?raw.widgets.filter((item:unknown)=>{
   if(!item||typeof item!=='object')return false;
   const row=item as Record<string,unknown>;
   if(typeof row.id!=='string'||!Object.hasOwn(WIDGETS,row.id)||
     typeof row.wide!=='boolean'||seen.has(row.id))return false;
   seen.add(row.id);return true;
  }).slice(0,14).map((w:Widget)=>({id:w.id,wide:w.wide})):defaults().widgets;
  const dockWidth=Number.isFinite(raw.dockWidth)?
    Math.max(290,Math.min(760,Math.round(raw.dockWidth))):375;
  return {widgets,dockWidth,dockOpen:raw.dockOpen===true};
 }catch{return defaults();}
}
export function savePreferences(p:Preferences){
 try{window.localStorage.setItem(UI_PREF_KEY,JSON.stringify({
   widgets:p.widgets,dockWidth:p.dockWidth,dockOpen:p.dockOpen
 }));}catch{/* cosmetic setting only, never blocks native store */}
}
export type DashboardProps={draft:Draft;attention:Attention;diagnostics:Diagnostics;
 corporateIssuerCount:number|null;corporateIssuerBusy:boolean;
 corporateIssuerError:string;onCheckCorporateIssuer:()=>void;
 attentionBusy:boolean;attentionError:string;onCheckAttention:()=>void;
 diagnosticsBusy:boolean;diagnosticsError:string;onCheckDiagnostics:()=>void;
 layout:Widget[];editing:boolean;onChange:(next:Widget[])=>void;
 onEditing:(value:boolean)=>void;onLibrary:()=>void;
 onNavigate:(page:Page,anchor?:string)=>void};
function metric(id:WidgetId,d:Draft,attention:Attention,diagnostics:Diagnostics):[number|string,string]|null{
 const organizations=new Set(d.holders.filter(h=>h.type==='ORGANIZATION').map(h=>h.id));
 switch(id){
  case 'corporate':return [d.proposals.filter(p=>p.productId==='IWXA_ADMIN_CENTER'&&organizations.has(p.holderId)).length,'подготовок организации'];
  case 'person':return attention?[attention.attentionInShown,'состояний требуют внимания в прочитанном журнале']:
    ['—','журнал PERSON ещё не запрошен'];
  case 'ledger':return attention?[attention.shown,'записей прочитано из T3']:
    ['—','журнал PERSON ещё не запрошен'];
  case 'products':return [d.products.length,'продуктов'];
  case 'tariffs':return [d.tariffs.length,'редакций'];
  case 'clients':return [d.holders.length,'получателей'];
  case 'preparations':return [d.proposals.length,'неподписанных предложений'];
  case 'releases':return [d.artifacts.length,'записей о файлах'];
  case 'diagnostics':return diagnostics?['Проверено','нативное состояние Publisher']:
    ['—','диагностика ещё не запускалась'];
  default:return null;
 }
}
// Only locally persisted unsigned drafts or explicit native readbacks feed
// these details. A blank or partial issuer journal is never zero licenses.
function details(id:WidgetId,d:Draft,attention:Attention,diagnostics:Diagnostics,
 corporateIssuerCount:number|null):string[]{
 const orgs=d.holders.filter(h=>h.type==='ORGANIZATION').length;
 const people=d.holders.filter(h=>h.type==='PERSON').length;
 switch(id){
  case 'corporate':return [
   'Организаций в подготовке: '+orgs,
   'Корпоративных тарифов Admin Center: '+d.tariffs.filter(t=>t.productId==='IWXA_ADMIN_CENTER'&&t.holderType==='ORGANIZATION').length,
   corporateIssuerCount===null?'Исходный корпоративный T3 ещё не проверен':
    corporateIssuerCount===0?'Корпоративный издатель не зарегистрирован':
    'При последней проверке издателей T3: '+corporateIssuerCount
  ];
  case 'person':return attention?[
    'Прочитано: '+attention.shown+' из '+attention.total,
    ...(attention.truncated?['Журнал неполный: нужен точный поиск']:[])]:
    ['Неподписанных подготовок PERSON: '+d.proposals.filter(p=>
      d.holders.some(h=>h.id===p.holderId&&h.type==='PERSON')).length];
  case 'ledger':return attention?[
    'Состояний требуют внимания: '+attention.attentionInShown,
    'Прочитано: '+attention.shown+' из '+attention.total,
    ...(attention.truncated?['Нет полной картины без точного поиска']:[])
   ]:['Нужен запрос к исходному T3'];
  case 'products':return d.products.length?
    d.products.slice(0,3).map(p=>p.name+' · '+p.version):['Каталог пока пуст'];
  case 'tariffs':return [
    'Для организаций: '+d.tariffs.filter(t=>t.holderType==='ORGANIZATION').length,
    'Для физических лиц: '+d.tariffs.filter(t=>t.holderType==='PERSON').length
   ];
  case 'clients':return ['Организации: '+orgs,'Физические лица: '+people];
  case 'preparations':return [
    'Для организаций: '+d.proposals.filter(p=>
      d.holders.some(h=>h.id===p.holderId&&h.type==='ORGANIZATION')).length,
    'Для PERSON: '+d.proposals.filter(p=>
      d.holders.some(h=>h.id===p.holderId&&h.type==='PERSON')).length,
    'Подготовок продления: '+d.proposals.filter(p=>Boolean(p.previousProposalId)).length
   ];
  case 'releases':return d.artifacts.length?
    d.artifacts.slice(-2).reverse().map(a=>a.name+' · '+a.platform):
    ['Файлы пока не проверялись'];
  case 'diagnostics':return diagnostics?[
    'Черновики: '+(diagnostics.localPreparation==='READABLE'?'доступны':
      diagnostics.localPreparation==='EMPTY'?'пусто':'требуют внимания'),
    'WebView2: '+(diagnostics.webviewProfile==='FOLDER_PRESENT'?'профиль доступен':'профиль не обнаружен'),
    ...(diagnostics.attentionRequired?['Программа требует внимания']:[])
   ]:['Запустите проверку состояния установленного приложения'];
  default:return [];
 }
}
export function PublisherDashboard({draft,attention,diagnostics,attentionBusy,attentionError,
 corporateIssuerCount,corporateIssuerBusy,corporateIssuerError,onCheckCorporateIssuer,
 onCheckAttention,diagnosticsBusy,diagnosticsError,onCheckDiagnostics,
 layout,editing,onChange,onEditing,onLibrary,onNavigate}:DashboardProps){
 const [dragged,setDragged]=React.useState<WidgetId|null>(null);
 const move=(id:WidgetId,target:WidgetId|undefined)=>{
  if(!target)return;
  const a=layout.findIndex(x=>x.id===id),b=layout.findIndex(x=>x.id===target);
  if(a<0||b<0||a===b)return;
  const next=layout.map(w=>({...w})),[item]=next.splice(a,1);next.splice(b,0,item);onChange(next);
 };
 return <section className="publisher-dashboard" data-testid="publisher-dashboard">
  <header className="pub-dashboard-header">
   <div><h1>Моя главная</h1><p>Добавляйте нужные блоки и располагайте их в удобном порядке.</p></div>
   <div className="pub-dashboard-actions">
    <button className="secondary" type="button" data-testid="publisher-dashboard-edit"
     onClick={()=>onEditing(!editing)}>{editing?'Завершить настройку':'Настроить дашборд'}</button>
    <button className="primary" type="button" data-testid="publisher-dashboard-library"
     onClick={onLibrary}>Добавить виджет</button>
   </div>
  </header>
  <div className="pub-dashboard-intro"><strong>Главный маршрут:</strong> Publisher → лицензия организации → Admin Center → места сотрудников Personal Agent. Черновики не создают прав.</div>
  {editing&&<p className="pub-dashboard-help">Перетащите блок, используйте стрелки на его заголовке, измените ширину или уберите лишнее. Раскладка сохраняется.</p>}
  <div className="pub-dashboard-grid" role="list" aria-label="Настраиваемые виджеты Publisher">
   {layout.length===0&&<div className="card pub-dashboard-empty"><h3>Здесь пока нет виджетов</h3><p>Подключите только те, которые нужны вам.</p><button className="primary" onClick={onLibrary}>Добавить виджеты</button></div>}
   {layout.map((w,i)=>{
    const spec=WIDGETS[w.id],value=metric(w.id,draft,attention,diagnostics);
    const facts=details(w.id,draft,attention,diagnostics,corporateIssuerCount);
    const jump=()=>onNavigate(spec.page,w.id==='backups'?'publisher-preparation-backup':w.id==='diagnostics'?'publisher-diagnostics':undefined);
    return <article key={w.id} role="listitem" className={'card pub-widget'+(w.wide?' wide':'')+(editing?' editing':'')+(dragged===w.id?' moving':'')}
      data-widget-id={w.id} draggable={editing}
      onDragStart={e=>{if(!editing)return;setDragged(w.id);e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',w.id);}}
      onDragOver={e=>{if(editing&&dragged&&dragged!==w.id)e.preventDefault();}}
      onDrop={e=>{e.preventDefault();if(dragged)move(dragged,w.id);setDragged(null);}}
      onDragEnd={()=>setDragged(null)}>
     <div className="pub-widget-head">
      <button type="button" className="pub-widget-grip" disabled={!editing} title="Переставить виджет"
       aria-label={'Переместить '+spec.label}
       onKeyDown={e=>{
        if(!editing||!['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key))return;
        e.preventDefault();const j=i+(['ArrowUp','ArrowLeft'].includes(e.key)?-1:1);
        if(layout[j])move(w.id,layout[j].id);
       }}>⋮⋮</button>
      <span className="pub-widget-icon" aria-hidden="true">◈</span><h3>{spec.label}</h3>
      {editing&&<div className="pub-widget-controls">
       <button type="button" aria-label={'Раньше '+spec.label} disabled={i===0} onClick={()=>move(w.id,layout[i-1]?.id)}>←</button>
       <button type="button" aria-label={'Позже '+spec.label} disabled={i===layout.length-1} onClick={()=>move(w.id,layout[i+1]?.id)}>→</button>
       <button type="button" aria-label={'Ширина '+spec.label} onClick={()=>onChange(layout.map(v=>v.id===w.id?{...v,wide:!v.wide}:v))}>{w.wide?'½':'↔'}</button>
       <button type="button" aria-label={'Убрать '+spec.label} onClick={()=>onChange(layout.filter(v=>v.id!==w.id))}>×</button>
      </div>}
     </div>
     <div className="pub-widget-body">
      {value&&<div className="pub-widget-value"><strong>{value[0]}</strong><span>{value[1]}</span></div>}
      <p>{spec.summary}</p>
      {facts.length>0&&<ul className="pub-widget-facts" aria-label={'Данные: '+spec.label}>
        {facts.map((fact,i)=><li key={i}>{fact}</li>)}
      </ul>}
      {w.id==='corporate'&&<>
        <small>Назначаемых без независимого приёма мест: 0</small>
        <div className="pub-widget-check">
          <button type="button" className="secondary" disabled={corporateIssuerBusy}
            data-testid="publisher-dashboard-corporate-check" onClick={onCheckCorporateIssuer}>
            {corporateIssuerBusy?'Проверяем T3…':'Проверить корпоративного издателя'}
          </button>
          {corporateIssuerError&&<small role="alert">{corporateIssuerError}</small>}
          <button type="button" className="secondary"
            data-testid="publisher-dashboard-corporate-open"
            onClick={()=>onNavigate('trust','publisher-corporate-native-owner')}>
            Открыть подпись и STATUS
          </button>
        </div>
      </>}
      {(w.id==='person'||w.id==='ledger')&&<div className="pub-widget-check">
        <button type="button" className="secondary" disabled={attentionBusy}
          onClick={onCheckAttention}>{attentionBusy?'Читаем T3…':'Прочитать PERSON в T3'}</button>
        {attentionError&&<small role="alert">{attentionError}</small>}
      </div>}
      {w.id==='diagnostics'&&<div className="pub-widget-check">
        <button type="button" className="secondary" disabled={diagnosticsBusy}
          onClick={onCheckDiagnostics}>{diagnosticsBusy?'Проверяем…':'Проверить состояние Publisher'}</button>
        {diagnosticsError&&<small role="alert">{diagnosticsError}</small>}
      </div>}
     </div>
     <footer className="pub-widget-footer"><small>{spec.source}</small><button className="secondary" onClick={jump}>Открыть</button></footer>
    </article>;
   })}
  </div>
  <footer className="pub-dashboard-footer"><span>{layout.length} виджетов</span>
   <button type="button" className="quiet" data-testid="publisher-dashboard-reset"
    onClick={()=>onChange(DEFAULT_WIDGETS.map(x=>({...x})))}>Вернуть исходный набор</button>
  </footer>
 </section>;
}
export function PublisherWidgetLibrary({layout,onChange}:{layout:Widget[];onChange:(next:Widget[])=>void}){
 const current=new Set(layout.map(w=>w.id));
 return <div className="pub-widget-library" data-testid="publisher-widget-library">
   <h2>Библиотека виджетов</h2>
   <p>Подключите нужные функции. Здесь не хранятся лицензии и права.</p>
   {['Лицензии','Каталог','Контроль','Выпуск','Система'].map(group=><section key={group}>
    <h3>{group}</h3>
    {Object.entries(WIDGETS).filter(([,s])=>s.category===group).map(([id,s])=>{
     const item=id as WidgetId,exists=current.has(item);
     return <div className="pub-library-entry" key={id}><div><strong>{s.label}</strong><small>{s.source}</small></div>
      <button className="secondary" type="button" aria-label={(exists?'Убрать':'Добавить')+' виджет '+s.label}
       onClick={()=>onChange(exists?layout.filter(w=>w.id!==item):[...layout,{id:item,wide:false}])}>
       {exists?'Убрать':'Добавить'}</button></div>;
    })}
   </section>)}
 </div>;
}
