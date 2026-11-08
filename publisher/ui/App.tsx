import React, {useEffect,useState} from 'react';
import { emptyPublisherDraft, decodePublisherDraft, encodePublisherDraft, applyPublisherDraftCommand } from '../src/preparation.mjs';
import '../../src/style.css';
import './style.css';

type Product = {id:string;name:string;version:string};
type Holder = {id:string;name:string;type:'PERSON'|'ORGANIZATION'};
type Proposal = {id:string;productId:string;holderId:string;features:string[];termDays:number;createdAt:string;status:'DRAFT_NOT_ISSUED'};
type Artifact = {id:string;productId:string;version:string;platform:string;sourceRepository:string;sourceCommit:string;sourceTree:string;name:string;size:number;sha256:string;createdAt:string;status:'BYTES_INSPECTED_NOT_APPROVED'};
type Draft = {format:string;version:number;products:Product[];holders:Holder[];proposals:Proposal[];artifacts:Artifact[];updatedAt:string};
type Inspection = {name:string;size:number;sha256:string};
type Page = 'overview'|'products'|'holders'|'proposals'|'releases'|'trust';
const navigation: [Page,string,string][] = [
 ['overview','Обзор','◫'],['products','Продукты','▣'],['holders','Получатели','♧'],
 ['proposals','Запросы на лицензии','▤'],['releases','Релизы','◇'],['trust','Доверие и ключи','⚑']
];
const storageKey='iwxa.publisher.preparation/1';
function getError(error:unknown) {return error instanceof Error ? error.message : String(error);}
const nativeHost=Boolean((window as any).__TAURI_INTERNALS__);
async function invoke(command:string,args?:Record<string,unknown>):Promise<any> {
 const fn=(window as any).__TAURI_INTERNALS__?.invoke;
 if(typeof fn!=='function')throw new Error('NATIVE_HOST_NOT_CONNECTED');
 return fn(command,args);
}
function initialDraft():Draft{return emptyPublisherDraft() as Draft;}
async function loadDraft():Promise<Draft> {
 const text=nativeHost?await invoke('publisher_draft_read'):localStorage.getItem(storageKey);
 return text===null?initialDraft():decodePublisherDraft(text) as Draft;
}
async function persistDraft(state:Draft):Promise<void> {
 const content=encodePublisherDraft(state);
 if(nativeHost)await invoke('publisher_draft_save',{content});
 else localStorage.setItem(storageKey,content);
}
function typeLabel(type:Holder['type']):string {return type==='ORGANIZATION'?'Организация':'Физическое лицо';}
export default function App(){
 const [state,setState]=useState<Draft>(initialDraft);
 const [loaded,setLoaded]=useState(false);
 const [page,setPage]=useState<Page>('overview');
 const [mobileNav,setMobileNav]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [productId,setProductId]=useState('');
 const [productName,setProductName]=useState('');
 const [productVersion,setProductVersion]=useState('0.2.0');
 const [holderName,setHolderName]=useState('');
 const [holderType,setHolderType]=useState<Holder['type']>('ORGANIZATION');
 const [proposalProduct,setProposalProduct]=useState('');
 const [proposalHolder,setProposalHolder]=useState('');
 const [features,setFeatures]=useState('');
 const [termDays,setTermDays]=useState('30');
 const [inspected,setInspected]=useState<Inspection|null>(null);
 const [releaseProduct,setReleaseProduct]=useState('');
 const [releasePlatform,setReleasePlatform]=useState('windows-x64');
 const [releaseRepo,setReleaseRepo]=useState('Faust-S/Center');
 const [releaseCommit,setReleaseCommit]=useState('');
 const [releaseTree,setReleaseTree]=useState('');
 const [releaseVersion,setReleaseVersion]=useState('0.2.0');
 useEffect(()=>{
   let alive=true;
   loadDraft().then(data=>{if(alive){setState(data);setLoaded(true);}})
     .catch(e=>{if(alive){setError('Не удалось открыть сохранённые черновики: '+getError(e));setLoaded(false);}});
   return ()=>{alive=false;};
 },[]);
 async function change(command:Record<string,unknown>,success:string){
   if(busy||!loaded)return;
   setBusy(true);setError('');setMessage('');
   try{
     const next=applyPublisherDraftCommand(state,command) as Draft;
     await persistDraft(next);
     setState(next);
     setMessage(success);
   }catch(e){setError(getError(e));}
   finally{setBusy(false);}
 }
 async function inspect(){
   if(!nativeHost){setError('Выбор и проверка настоящего файла доступны в установленной программе Publisher.');return;}
   setError('');setMessage('');setBusy(true);
   try{
     const result=await invoke('publisher_inspect_artifact');
     if(result){setInspected(result as Inspection);setMessage('Байты файла проверены. Источник и разрешение на выпуск ещё не подтверждены.');}
   }catch(e){setError(getError(e));}
   finally{setBusy(false);}
 }
 const productTitle=(id:string)=>state.products.find(p=>p.id===id)?.name||id;
 const holderTitle=(id:string)=>state.holders.find(h=>h.id===id)?.name||id;
 const activeProduct=proposalProduct||state.products[0]?.id||'';
 const activeHolder=proposalHolder||state.holders[0]?.id||'';
 const selectedReleaseProduct=releaseProduct||state.products[0]?.id||'';
 function go(p:Page){setPage(p);setMobileNav(false);setError('');setMessage('');}
 return <div className={'app publisher-app'+(mobileNav?' menu-open':'')}>
   <aside className="sidebar">
     <header className="brand"><div><strong>IWXA</strong><small>Publisher · 0.2 development</small></div><span className="version">PREVIEW</span></header>
     <nav aria-label="Разделы Publisher">
       {navigation.map(([key,label,symbol])=><button key={key} type="button" className={'nav-link'+(page===key?' active':'')} onClick={()=>go(key)} aria-current={page===key?'page':undefined}><span className="nav-icon" aria-hidden="true">{symbol}</span><span>{label}</span></button>)}
     </nav>
     <div className="sidebar-bottom"><p className="local-label"><span className="dot"></span>{nativeHost?'Локальная программа':'Режим браузерного просмотра'}</p><p>Черновики не являются лицензиями, релизами или правами пользователей.</p></div>
   </aside>
   <main className="main">
     <header className="top">
       <button className="menu-button secondary" type="button" onClick={()=>setMobileNav(!mobileNav)} aria-label="Открыть навигацию">☰</button>
       <div className="breadcrumb"><span>IWXA</span> / Publisher / {navigation.find(v=>v[0]===page)?.[1]}</div>
       <span className="status neutral">{loaded?'Локально сохранено':'Состояние не загружено'}</span>
     </header>
     <div className="page-heading"><div><div className="eyebrow">OWNER-SIDE PUBLISHER</div><h1>{navigation.find(v=>v[0]===page)?.[1]}</h1></div></div>
     <div className="notice">Версия разработки 0.2. Состояние подготовки: лицензии не выдаются, подпись издателя не подключена, выпуск релиза не разрешён. {nativeHost?'Черновики хранятся отдельно от Admin Center.':'В браузере доступны только локальные подготовительные черновики.'}</div>
     {error&&<div className="notice error" role="alert">{error}</div>}
     {message&&<div className="notice" role="status">{message}</div>}
     {!loaded?<section className="card padded" role="status">Открываем локальные черновики… При ошибке сохранённые данные не перезаписываются.</section>:<>
       {page==='overview'&&<>
         <div className="metrics"><div className="card metric"><span>Продукты</span><strong>{state.products.length}</strong></div><div className="card metric"><span>Получатели</span><strong>{state.holders.length}</strong></div><div className="card metric"><span>Черновики запросов</span><strong>{state.proposals.length}</strong></div></div>
         <section className="hero"><div className="eyebrow">РАБОТА ИЗДАТЕЛЯ</div><h2>Подготовка лицензий и выпусков IWXA</h2><p>Создайте запись продукта, получателя и проект условий лицензии. Действительное право появится только после подписи и проверки исходным механизмом издателя.</p><div className="actions"><button type="button" className="primary" onClick={()=>go('products')}>Добавить продукт</button><button type="button" className="secondary" onClick={()=>go('releases')}>Проверить сборку</button></div></section>
         <section className="card padded"><h2>Текущее состояние</h2><p className="muted">Заявок на публикацию: {state.artifacts.length}. Подтверждённых релизов: 0. Подписанных лицензий: 0.</p><p className="muted">Реальные источники подписей, trust catalog и приём лицензии в Admin Center пока не включены в этот исполняемый продукт.</p></section>
       </>}
       {page==='products'&&<>
         <section className="card form-panel"><h2>Новый продукт в локальном черновике каталога</h2>
           <form onSubmit={e=>{e.preventDefault();void change({kind:'addProduct',id:productId.trim(),name:productName.trim(),version:productVersion.trim()},'Продукт добавлен в черновик каталога.');}}>
             <div className="form-grid">
               <label>Идентификатор продукта<input required maxLength={64} placeholder="IWXA_ADMIN_CENTER" value={productId} onChange={e=>setProductId(e.target.value)}/></label>
               <label>Название<input required maxLength={130} placeholder="IWXA Admin Center" value={productName} onChange={e=>setProductName(e.target.value)}/></label>
               <label>Версия<input required value={productVersion} onChange={e=>setProductVersion(e.target.value)} placeholder="0.2.0"/></label>
             </div><button className="primary" disabled={busy} type="submit">Сохранить продукт</button>
           </form>
         </section>
         <section className="card padded"><h2>Продукты ({state.products.length})</h2>{state.products.length===0?<p className="muted">Каталог пуст. Ни один продукт не допущен к распространению.</p>:state.products.map(p=><div className="simple-row" key={p.id}><div><strong>{p.name}</strong><small>{p.id} · {p.version}</small></div><span className="status neutral">Черновик</span></div>)}</section>
       </>}
       {page==='holders'&&<>
         <section className="card form-panel"><h2>Новый получатель</h2><form onSubmit={e=>{e.preventDefault();void change({kind:'addHolder',name:holderName.trim(),type:holderType},'Получатель добавлен в локальный черновик.');setHolderName('');}}>
           <div className="form-grid"><label>Название / имя<input required maxLength={130} value={holderName} onChange={e=>setHolderName(e.target.value)}/></label>
           <label>Тип субъекта<select value={holderType} onChange={e=>setHolderType(e.target.value as Holder['type'])}><option value="ORGANIZATION">Организация</option><option value="PERSON">Физическое лицо</option></select></label></div>
           <button className="primary" disabled={busy} type="submit">Сохранить получателя</button></form></section>
         <section className="card padded"><h2>Получатели ({state.holders.length})</h2>{state.holders.length===0?<p className="muted">Получателей пока нет.</p>:state.holders.map(h=><div key={h.id} className="simple-row"><div><strong>{h.name}</strong><small>{typeLabel(h.type)} · {h.id}</small></div><span className="status neutral">Подготовка</span></div>)}</section>
       </>}
       {page==='proposals'&&<>
         <section className="card form-panel"><h2>Подготовить запрос на лицензию</h2><p className="muted">Создание запроса не создаёт подписанной лицензии и не меняет права получателя.</p>
         {state.products.length===0||state.holders.length===0?<div className="notice">Для запроса необходимо сначала создать продукт и получателя.</div>:<form onSubmit={e=>{e.preventDefault();void change({kind:'addProposal',productId:activeProduct,holderId:activeHolder,features:features.split(',').map(x=>x.trim()).filter(Boolean),termDays:Number(termDays)},'Черновик запроса сохранён. Лицензия не выдана.');}}>
           <div className="form-grid"><label>Продукт<select value={activeProduct} onChange={e=>setProposalProduct(e.target.value)}>{state.products.map(p=><option key={p.id} value={p.id}>{p.name} ({p.version})</option>)}</select></label>
           <label>Получатель<select value={activeHolder} onChange={e=>setProposalHolder(e.target.value)}>{state.holders.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
           <label>Функции (коды через запятую)<input value={features} onChange={e=>setFeatures(e.target.value)} placeholder="Не определены"/></label>
           <label>Срок в днях<input type="number" min={1} max={3650} required value={termDays} onChange={e=>setTermDays(e.target.value)}/></label></div>
           <button type="submit" className="primary" disabled={busy}>Сохранить запрос</button></form>}</section>
         <section className="card padded"><h2>Подготовленные запросы ({state.proposals.length})</h2>
         {state.proposals.length===0?<p className="muted">Запросов пока нет.</p>:state.proposals.map(p=><div className="simple-row" key={p.id}><div><strong>{productTitle(p.productId)}</strong><small>{holderTitle(p.holderId)} · {p.termDays} дн. · {p.features.length? p.features.join(', '):'Функции не выбраны'}</small></div><span className="status neutral">Не выдано</span><button className="quiet" disabled={busy} type="button" onClick={()=>void change({kind:'removeProposal',id:p.id},'Черновик удалён.')}>Удалить</button></div>)}
         </section>
       </>}
       {page==='releases'&&<>
         <section className="card form-panel"><h2>Проверить настоящий файл сборки</h2><p className="muted">Проверяется фактический SHA-256 содержимого и размер файла. Версию исходников и право публикации проверяет отдельный выпускной процесс.</p>
           <button type="button" className="secondary" onClick={()=>void inspect()} disabled={busy||!nativeHost}>Выбрать и проверить файл</button>
           {inspected&&<div className="inspected"><strong>{inspected.name}</strong><small>{inspected.size.toLocaleString('ru-RU')} байт</small><code>{inspected.sha256}</code></div>}
         </section>
         {inspected&&state.products.length>0&&<section className="card form-panel"><h2>Зафиксировать проверку файла</h2>
           <form onSubmit={e=>{e.preventDefault();void change({kind:'addArtifact',productId:selectedReleaseProduct,version:releaseVersion.trim(),platform:releasePlatform,sourceRepository:releaseRepo.trim(),sourceCommit:releaseCommit.trim(),sourceTree:releaseTree.trim(),...inspected},'Проверенные байты сохранены. Источник и решение о публикации не подтверждены.');setInspected(null);}}>
             <div className="form-grid"><label>Продукт<select value={selectedReleaseProduct} onChange={e=>setReleaseProduct(e.target.value)}>{state.products.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
             <label>Версия файла<input required value={releaseVersion} onChange={e=>setReleaseVersion(e.target.value)}/></label>
             <label>Платформа<select value={releasePlatform} onChange={e=>setReleasePlatform(e.target.value)}>{['windows-x64','windows-arm64','linux-x64','linux-arm64','macos-x64','macos-arm64'].map(p=><option key={p} value={p}>{p}</option>)}</select></label>
             <label>Репозиторий источника<input required value={releaseRepo} onChange={e=>setReleaseRepo(e.target.value)}/></label>
             <label>Source commit (40 hex)<input required value={releaseCommit} onChange={e=>setReleaseCommit(e.target.value)}/></label>
             <label>Source tree (40 hex)<input required value={releaseTree} onChange={e=>setReleaseTree(e.target.value)}/></label></div>
             <button type="submit" className="primary" disabled={busy}>Сохранить проверенный файл</button>
           </form></section>}
         <section className="card padded"><h2>Проверенные файлы ({state.artifacts.length})</h2>
         {state.artifacts.length===0?<p className="muted">Файлы ещё не проверены. Подтверждённых релизов нет.</p>:state.artifacts.map(a=><div key={a.id} className="simple-row"><div><strong>{a.name}</strong><small>{productTitle(a.productId)} · {a.version} · {a.platform} · SHA-256 {a.sha256}</small><small>Заявленный источник: {a.sourceRepository} @ {a.sourceCommit.slice(0,12)} (не проверен независимо)</small></div><span className="status neutral">Не опубликовано</span></div>)}</section>
       </>}
       {page==='trust'&&<section className="card padded"><h2>Издательские полномочия</h2><p>Операции подписи не подключены. Производственные ключи здесь не создаются и не импортируются.</p>
           <div className="simple-row"><div><strong>Доверенный root издателя</strong><small>Публичное решение владельца</small></div><span className="status neutral">Не подключён</span></div>
           <div className="simple-row"><div><strong>Подпись лицензии</strong><small>Исходный issuer: T3 license-engine.mjs</small></div><span className="status neutral">Недоступно</span></div>
           <div className="simple-row"><div><strong>Подпись статуса</strong><small>Независимый purpose key</small></div><span className="status neutral">Недоступно</span></div>
           <p className="muted">Планируемое подключение не является действительным issuer, лицензией или назначением прав.</p></section>}
     </>}
     <footer className="footer"><span>IWXA Publisher · отдельная owner-side программа</span><span>Локальные подготовительные данные · не лицензия и не release authority</span></footer>
   </main>
   <aside className="inspector"><div className="eyebrow">ИЗДАТЕЛЬСКАЯ ПАНЕЛЬ</div><h2>Только подготовка</h2>
     <div className="inspector-card"><strong>Действительные лицензии</strong><p>0</p><small>До подключения проверенного issuer здесь не отображается ACTIVE.</small></div>
     <div className="inspector-card"><strong>Подтверждённые релизы</strong><p>0</p><small>SHA-256 сам по себе не является решением о публикации.</small></div>
     <div className="inspector-card"><strong>Разделение полномочий</strong><small>Publisher выдаёт лицензии. Admin Center только потребляет подтверждённые права и распределяет места.</small></div>
   </aside>
 </div>;
}
