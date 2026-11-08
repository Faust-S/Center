import React, {useEffect,useState} from 'react';
import { emptyPublisherDraft, decodePublisherDraft, encodePublisherDraft, applyPublisherDraftCommand } from '../src/preparation.mjs';
import { prepareTestLicenseRequest, encodeTestLicenseRequest, suggestedTestRequestFileName } from '../src/test-license-request.mjs';
import {simulateIssuerEvent} from '../src/issuer-simulation.mjs';
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
 const [holderSourceId,setHolderSourceId]=useState('');
 const [holderType,setHolderType]=useState<Holder['type']>('ORGANIZATION');
 const [proposalProduct,setProposalProduct]=useState('');
 const [proposalHolder,setProposalHolder]=useState('');
 const [features,setFeatures]=useState('');
 const [termDays,setTermDays]=useState('30');
 const [testSeats,setTestSeats]=useState('1');
 const [simulated,setSimulated]=useState<{requestId:string;organizationId:string;modeledSeats:number;actualSeats:number;state:string}|null>(null);
 const [pendingRestore,setPendingRestore]=useState<Draft|null>(null);
 const restoreConfirmationRef=React.useRef<HTMLDivElement>(null);
 useEffect(()=>{
   if(pendingRestore)restoreConfirmationRef.current?.scrollIntoView({block:'center'});
 },[pendingRestore]);
 const simulationResultRef=React.useRef<HTMLDivElement>(null);
 useEffect(()=>{
   // The result sits below the proposal list; reveal it in the native scroll
   // container instead of leaving the successful response below the viewport.
   if(simulated)simulationResultRef.current?.scrollIntoView({block:'center'});
 },[simulated]);
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
   setBusy(true);setError('');setMessage('');setSimulated(null);
   try{
     const next=applyPublisherDraftCommand(state,command) as Draft;
     await persistDraft(next);
     setState(next);
     setPendingRestore(null);
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
 async function exportPreparationBackup(){
   if(busy||!loaded||!nativeHost)return;
   setBusy(true);setError('');setMessage('');
   try {
     const saved=await invoke('publisher_export_preparation_backup',{content:encodePublisherDraft(state)});
     setMessage(saved?'Копия черновиков сохранена и проверена. Лицензии и ключи издателя не включены.':'Создание копии отменено.');
   } catch(e){setError('Не удалось сохранить копию: '+getError(e));}
   finally{setBusy(false);}
 }
 async function restorePreparationBackup(){
   if(busy||!loaded||!nativeHost)return;
   setBusy(true);setError('');setMessage('');setPendingRestore(null);
   try {
     const selected=await invoke('publisher_pick_preparation_backup');
     if(selected===null){setMessage('Выбор копии отменён.');return;}
     const restored=decodePublisherDraft(selected) as Draft;
     // Selecting a file must never overwrite data. Require a separate,
     // accessible in-app confirmation rather than browser-native confirm().
     setPendingRestore(restored);
     setMessage('Копия проверена. Подтвердите замену текущих черновиков.');
   } catch(e){setError('Не удалось открыть копию, текущие черновики сохранены: '+getError(e));}
   finally{setBusy(false);}
 }
 async function confirmPreparationRestore(){
   if(!pendingRestore||busy||!nativeHost||!loaded)return;
   setBusy(true);setError('');setMessage('');
   try {
     await persistDraft(pendingRestore);
     setState(pendingRestore);setPendingRestore(null);setSimulated(null);setInspected(null);
     setMessage('Черновики восстановлены из копии и сохранены. Подписи и права не изменены.');
   } catch(e){setError('Восстановление не выполнено, текущие черновики не заменены: '+getError(e));}
   finally{setBusy(false);}
 }
 function cancelPreparationRestore(){
   setPendingRestore(null);setMessage('Восстановление отменено. Текущие черновики сохранены.');
 }
 async function exportTestRequest(proposalId:string) {
   if(busy||!loaded)return;
   setBusy(true);setError('');setMessage('');
   try {
     const request=prepareTestLicenseRequest(state,{proposalId,seats:Number(testSeats)});
     const content=encodeTestLicenseRequest(request);
     const filename=suggestedTestRequestFileName(request);
     if(nativeHost) {
       const saved=await invoke('publisher_save_test_request',{content,suggestedFileName:filename});
       if(!saved){setMessage('Сохранение TEST-запроса отменено.');return;}
     } else {
       const url=URL.createObjectURL(new Blob([content],{type:'application/json;charset=utf-8'}));
       try {
         const link=document.createElement('a');link.href=url;link.download=filename;
         document.body.appendChild(link);link.click();link.remove();
         await new Promise(resolve=>setTimeout(resolve,0));
       } finally {URL.revokeObjectURL(url);}
     }
     setMessage('Неподписанный TEST-запрос экспортирован. Лицензия не выдана.');
   } catch(e) {setError(getError(e));}
   finally {setBusy(false);}
 }
 function simulateTestDecision(proposalId:string) {
   setError('');setMessage('');
   try {
     const request=prepareTestLicenseRequest(state,{proposalId,seats:Number(testSeats)});
     const event=simulateIssuerEvent(request,{decision:'SIMULATED_ISSUED',sequence:1,observedAt:new Date().toISOString()});
     setSimulated({requestId:request.requestId,organizationId:request.subject.id,
       modeledSeats:request.seats,actualSeats:event.effectiveSeats,state:event.status});
     setMessage('Проверен модельный ответ издателя. Никакие лицензии или права не созданы.');
   } catch(e) {
     setSimulated(null);
     setError(getError(e));
   }
 }
 const productTitle=(id:string)=>state.products.find(p=>p.id===id)?.name||id;
 const holderTitle=(id:string)=>state.holders.find(h=>h.id===id)?.name||id;
 const activeProduct=proposalProduct||state.products[0]?.id||'';
 const activeHolder=proposalHolder||state.holders[0]?.id||'';
 const selectedReleaseProduct=releaseProduct||state.products[0]?.id||'';
 function go(p:Page){setPage(p);setMobileNav(false);setError('');setMessage('');setPendingRestore(null);}
 return <div className={'app publisher-app'+(mobileNav?' menu-open':'')}>
   <aside className="sidebar">
     <header className="brand"><div><strong>IWXA</strong><small>Publisher · 0.2.0-dev.2</small></div><span className="version">PREVIEW</span></header>
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
     <div className="notice">Версия разработки 0.2.0-dev.2. Состояние подготовки: лицензии не выдаются, подпись издателя не подключена, выпуск релиза не разрешён. {nativeHost?'Черновики хранятся отдельно от Admin Center.':'В браузере доступны только локальные подготовительные черновики.'}</div>
     {error&&<div className="notice error" role="alert">{error}</div>}
     {message&&<div className="notice" role="status">{message}</div>}
     {!loaded?<section className="card padded" role="status">Открываем локальные черновики… При ошибке сохранённые данные не перезаписываются.</section>:<>
       {page==='overview'&&<>
         <div className="metrics"><div className="card metric"><span>Продукты</span><strong>{state.products.length}</strong></div><div className="card metric"><span>Получатели</span><strong>{state.holders.length}</strong></div><div className="card metric"><span>Черновики запросов</span><strong>{state.proposals.length}</strong></div></div>
         <section className="hero"><div className="eyebrow">РАБОТА ИЗДАТЕЛЯ</div><h2>Подготовка лицензий и выпусков IWXA</h2><p>Создайте запись продукта, получателя и проект условий лицензии. Действительное право появится только после подписи и проверки исходным механизмом издателя.</p><div className="actions"><button type="button" className="primary" onClick={()=>go('products')}>Добавить продукт</button><button type="button" className="secondary" onClick={()=>go('releases')}>Проверить сборку</button></div></section>
         <section className="card padded"><h2>Текущее состояние</h2><p className="muted">Заявок на публикацию: {state.artifacts.length}. Подтверждённых релизов: 0. Подписанных лицензий: 0.</p><p className="muted">Реальные источники подписей, trust catalog и приём лицензии в Admin Center пока не включены в этот исполняемый продукт.</p></section>
         <section className="card padded" data-testid="publisher-preparation-backup">
           <h2>Резервная копия черновиков</h2>
           <p className="muted">Включает только каталог продуктов, получателей, неподписанные запросы и записи проверок файлов. Подписанных лицензий, решений о публикации и ключей издателя в этой копии нет.</p>
           <p className="muted">Восстановление заменит текущие черновики после отдельного подтверждения. Выберите сохранённый JSON-файл.</p>
           <div className="actions">
             <button type="button" className="secondary" disabled={!nativeHost||busy} onClick={()=>void exportPreparationBackup()}>Сохранить копию черновиков</button>
             <button type="button" className="secondary" disabled={!nativeHost||busy} onClick={()=>void restorePreparationBackup()}>Восстановить черновики</button>
           </div>
           {!nativeHost&&<p className="muted">Экспорт и восстановление доступны в установленном Publisher.</p>}
           {pendingRestore&&<div ref={restoreConfirmationRef} className="publisher-test-request" role="group" aria-label="Подтверждение восстановления черновиков" data-testid="publisher-restore-confirmation">
             <strong>Подтвердите замену черновиков</strong>
             <p>В выбранной копии: продуктов — {pendingRestore.products.length}, получателей — {pendingRestore.holders.length}, неподписанных запросов — {pendingRestore.proposals.length}.</p>
             <p>После подтверждения текущие локальные черновики будут заменены. Лицензии, ключи и издательские полномочия этим действием не создаются.</p>
             <div className="actions">
               <button type="button" className="primary" disabled={busy} onClick={()=>void confirmPreparationRestore()}>Заменить текущие черновики</button>
               <button type="button" className="secondary" disabled={busy} onClick={cancelPreparationRestore}>Отмена восстановления</button>
             </div>
           </div>}
         </section>
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
         <section className="card form-panel"><h2>Новый получатель</h2><form onSubmit={e=>{e.preventDefault();void change({kind:'addHolder',id:holderSourceId.trim(),name:holderName.trim(),type:holderType},'Получатель добавлен в локальный черновик.');setHolderName('');setHolderSourceId('');}}>
           <p className="muted">Укажите точный идентификатор субъекта из Admin Center или исходной системы. Запись здесь не создаёт организационных полномочий.</p>
           <div className="form-grid"><label>Идентификатор субъекта<input required maxLength={90} placeholder="UUID организации из Admin Center" value={holderSourceId} onChange={e=>setHolderSourceId(e.target.value)}/></label><label>Название / имя<input required maxLength={130} value={holderName} onChange={e=>setHolderName(e.target.value)}/></label>
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
          {state.proposals.length>0&&<div className="publisher-test-request">
            <p className="muted">Экспорт TEST-запроса для будущего оригинального издателя T3. Файл не подписан и не предоставляет права Admin Center.</p>
            <label>Места для TEST-запроса<input aria-label="Места для TEST-запроса" type="number" min={1} max={10000} value={testSeats} onChange={e=>setTestSeats(e.target.value)}/></label>
          </div>}
         {state.proposals.length===0?<p className="muted">Запросов пока нет.</p>:state.proposals.map(p=><div className="simple-row" key={p.id}><div><strong>{productTitle(p.productId)}</strong><small>{holderTitle(p.holderId)} · {p.termDays} дн. · {p.features.length? p.features.join(', '):'Функции не выбраны'}</small></div><span className="status neutral">Не выдано</span>
            <button className="secondary" disabled={busy||p.features.length===0||p.productId!=='IWXA_ADMIN_CENTER'||state.holders.find(h=>h.id===p.holderId)?.type!=='ORGANIZATION'} type="button" onClick={()=>void exportTestRequest(p.id)}>Подготовить TEST-запрос</button>
            <button className="secondary" disabled={busy||p.features.length===0||p.productId!=='IWXA_ADMIN_CENTER'||state.holders.find(h=>h.id===p.holderId)?.type!=='ORGANIZATION'} type="button" onClick={()=>simulateTestDecision(p.id)}>Моделировать TEST-ответ</button>
            <button className="quiet" disabled={busy} type="button" onClick={()=>void change({kind:'removeProposal',id:p.id},'Черновик удалён.')}>Удалить</button></div>)}
         {simulated&&<div ref={simulationResultRef} className="publisher-test-request" data-testid="publisher-test-simulation-result" role="status" aria-label={`СИМУЛЯЦИЯ · НЕ ЛИЦЕНЗИЯ. Действительных лицензированных мест: ${simulated.actualSeats}`}>
           <strong>СИМУЛЯЦИЯ · НЕ ЛИЦЕНЗИЯ</strong>
           <p>Модельный запрос {simulated.requestId} для организации {simulated.organizationId}.</p>
           <p>Смоделировано мест: {simulated.modeledSeats}. Действительных лицензированных мест: {simulated.actualSeats}.</p>
           <p>Подпись T3 и доверие издателю не проверялись. Активация и распределение мест недоступны.</p>
         </div>}
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
