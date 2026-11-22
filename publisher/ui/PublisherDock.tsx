import React,{useState} from 'react';
import {PublisherWidgetLibrary} from './PublisherDashboard';
import type {Page,Widget} from './PublisherDashboard';

type Draft={
 products:{id:string;name:string;version:string}[];
 holders:{id:string;name:string;type:string}[];
 tariffs:{id:string;name:string;productId:string;revision:number;holderType:string}[];
 proposals:{id:string;productId:string;holderId:string}[];
 artifacts:{id:string;name:string;productId:string;sha256:string}[]
};
type Props={
 page:Page;draft:Draft;selectedProductId:string;onSelectProduct:(id:string)=>void;
 mode:'context'|'widgets';onMode:(mode:'context'|'widgets')=>void;
 open:boolean;width:number;onWidth:(width:number)=>void;onClose:()=>void;
 widgets:Widget[];onWidgets:(next:Widget[])=>void;
 onNavigate:(page:Page)=>void;
};
const MIN=290,MAX=760;
export function PublisherDock({page,draft,selectedProductId,onSelectProduct,mode,onMode,
  open,width,onWidth,onClose,widgets,onWidgets,onNavigate}:Props){
 const [tab,setTab]=useState<'details'|'tariffs'|'licenses'|'releases'|'t3'>('details');
 const gesture=React.useRef<{startX:number;startWidth:number}|null>(null);
 if(!open)return null;
 const product=draft.products.find(p=>p.id===selectedProductId)||draft.products[0];
 const tariffs=product?draft.tariffs.filter(t=>t.productId===product.id):[];
 const proposals=product?draft.proposals.filter(p=>p.productId===product.id):[];
 const artifacts=product?draft.artifacts.filter(a=>a.productId===product.id):[];
 const link=(label:string,target:Page)=><button type="button" className="secondary"
   onClick={()=>onNavigate(target)}>{label}</button>;
 const bound=(size:number)=>{
   const max=typeof window==='undefined'?MAX:Math.max(MIN,
     Math.min(MAX,window.innerWidth-(window.innerWidth<980?365:500)));
   onWidth(Math.max(MIN,Math.min(max,Math.round(size))));
 };
 return <aside className="pub-dock" aria-label="Контекстная панель Publisher"
   data-testid="publisher-split-dock" style={{width:width,flexBasis:width}}>
   <div className="pub-dock-splitter" role="separator" tabIndex={0}
     aria-label="Изменить ширину просмотра"
     aria-orientation="vertical" aria-valuemin={MIN} aria-valuemax={MAX}
     aria-valuenow={width} data-testid="publisher-splitter"
     onPointerDown={e=>{
       gesture.current={startX:e.clientX,startWidth:width};
       e.currentTarget.setPointerCapture(e.pointerId);
     }}
     onPointerMove={e=>{if(gesture.current)bound(gesture.current.startWidth+gesture.current.startX-e.clientX);}}
     onPointerUp={()=>{gesture.current=null;}}
     onPointerCancel={()=>{gesture.current=null;}}
     onKeyDown={e=>{
       if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;
       e.preventDefault();
       bound(e.key==='Home'?MIN:e.key==='End'?MAX:width+(e.key==='ArrowLeft'?24:-24));
     }}/>
   <div className="pub-dock-head">
     <div><strong>{mode==='widgets'?'Библиотека виджетов':'Просмотр'}</strong>
       <small>{mode==='widgets'?'Настройте свою главную':'Сведения и связанные действия'}</small></div>
     <button className="quiet" type="button" aria-label="Закрыть просмотр"
       data-testid="publisher-dock-close" onClick={onClose}>✕</button>
   </div>
   <div className="pub-dock-tabs">
     <button className={mode==='context'?'selected':''}
       onClick={()=>onMode('context')}>Сведения</button>
     <button className={mode==='widgets'?'selected':''}
       onClick={()=>onMode('widgets')}>Виджеты</button>
   </div>
   <div className="pub-dock-scroll">
     {mode==='widgets'?<PublisherWidgetLibrary layout={widgets} onChange={onWidgets}/>:
     <>
       <p className="pub-dock-page-label">{page==='overview'?'Главная':
         page==='proposals'?'Лицензии':
         page==='trust'?'Доверие и ключи':
         page==='holders'?'Клиенты':
         page==='tariffs'?'Тарифы и лимиты':
         page==='releases'?'Релизы':
         page==='settings'?'Настройки':'Продукты'}</p>
       {page==='products'&&product?<section className="pub-dock-context">
         <label className="pub-dock-product-picker">Выбранный продукт
           <select value={product.id} onChange={e=>onSelectProduct(e.target.value)}>
             {draft.products.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}
           </select>
         </label>
         <div className="pub-dock-subtabs" role="tablist" aria-label="Сведения продукта">
           {([['details','Сведения'],['tariffs','Тарифы'],['licenses','Лицензии'],
              ['releases','Релизы'],['t3','Связи T3']] as const).map(([id,label])=>
             <button key={id} type="button" role="tab" aria-selected={tab===id}
               className={tab===id?'selected':''} onClick={()=>setTab(id)}>{label}</button>)}
         </div>
         {tab==='details'&&<div className="pub-dock-card">
           <h3>{product.name}</h3>
           <dl><dt>Идентификатор</dt><dd>{product.id}</dd>
             <dt>Версия</dt><dd>{product.version}</dd>
             <dt>Подготовленные тарифы</dt><dd>{tariffs.length}</dd>
             <dt>Предложения</dt><dd>{proposals.length}</dd>
             <dt>Файлы релиза</dt><dd>{artifacts.length}</dd></dl>
           <p className="muted">Каталог сам по себе не подтверждает право на выпуск.</p>
         </div>}
         {tab==='tariffs'&&<div className="pub-dock-card"><h3>Тарифные редакции</h3>
           {tariffs.length?tariffs.map(t=><p key={t.id+':'+t.revision}>
             {t.name}, редакция {t.revision} · {t.holderType}</p>):
             <p>Редакций пока нет.</p>}
           {link('Открыть тарифы','tariffs')}
         </div>}
         {tab==='licenses'&&<div className="pub-dock-card"><h3>Лицензирование</h3>
           <p>Неподписанных предложений: {proposals.length}.</p>
           <p className="muted">Подпись, STATUS и права получателя определяет только оригинальный T3.</p>
           {link('Подготовить лицензию','proposals')}
         </div>}
         {tab==='releases'&&<div className="pub-dock-card"><h3>Файлы выпуска</h3>
           <p>Записей о проверенных байтах: {artifacts.length}.</p>
           <p className="muted">SHA-256 не является разрешением на публикацию.</p>
           {link('Открыть релизы','releases')}
         </div>}
         {tab==='t3'&&<div className="pub-dock-card"><h3>Оригинальный T3</h3>
           <p>Издатель, доверие, подписанный STATUS и журнал читаются отдельно.</p>
           {link('Открыть T3 Owner','trust')}
         </div>}
       </section>:<section className="pub-dock-context">
         <div className="pub-dock-card">
           <h3>{page==='overview'?'Состояние издателя':
             page==='settings'?'Приложение':'Связанные процессы'}</h3>
           <p>Подготовлено продуктов: {draft.products.length}, клиентов:
             {' '+draft.holders.length}, предложений: {draft.proposals.length}.</p>
           <p className="muted">Коммерческие места не определяются по локальным черновикам.</p>
         </div>
         <div className="pub-dock-card">
           <h3>Перейти к действию</h3>
           <div className="pub-dock-links">
             {link('Корпоративная лицензия','proposals')}
             {link('Выдача и STATUS','trust')}
             {link('Тарифы и квоты','tariffs')}
             {link('Продукты','products')}
             {link('Проверка релиза','releases')}
             {link('Настройки','settings')}
           </div>
         </div>
       </section>}
     </>}
   </div>
   <footer className="pub-dock-foot">Панель находится рядом с рабочей областью.
     Разделитель регулирует ширину.</footer>
 </aside>;
}
