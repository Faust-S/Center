import React, {useEffect,useMemo,useState} from 'react';
import { emptyPublisherDraft, decodePublisherDraft, encodePublisherDraft, applyPublisherDraftCommand } from '../src/preparation.mjs';
import { prepareTestLicenseRequest, encodeTestLicenseRequest, suggestedTestRequestFileName, inspectTestIssuerRequestScopes } from '../src/test-license-request.mjs';
import {simulateIssuerEvent} from '../src/issuer-simulation.mjs';
import PublisherT3OwnerPanel from './PublisherT3OwnerPanel';
import TariffPanel from './TariffPanel';
import '../../src/style.css';
import './style.css';

type Product = {id:string;name:string;version:string};
type Holder = {id:string;name:string;type:'PERSON'|'ORGANIZATION'};
type Tariff={id:string;productId:string;name:string;holderType:'ORGANIZATION'|'PERSON';revision:number;features:string[];termDays:number;productSeats:number;employeeLimit:number;deviceLimit:number;quotas:{metric:string;service:'LOCAL'|'CLOUD';unit:string;period:string;max:number}[]};
type Proposal = {id:string;productId:string;holderId:string;features:string[];termDays:number;createdAt:string;status:'DRAFT_NOT_ISSUED';productVersion?:string;tariffSnapshot?:Tariff;previousProposalId?:string};
type Artifact = {id:string;productId:string;version:string;platform:string;sourceRepository:string;sourceCommit:string;sourceTree:string;name:string;size:number;sha256:string;createdAt:string;status:'BYTES_INSPECTED_NOT_APPROVED'};
type Draft = {format:string;version:number;products:Product[];holders:Holder[];tariffs:Tariff[];proposals:Proposal[];artifacts:Artifact[];updatedAt:string};
type Inspection = {name:string;size:number;sha256:string};
type OfflineCopiesCheck = {
 name:string;size:number;sha256:string;copiesChecked:number;
 sameContent:boolean;distinctSelectedPaths:boolean;
 physicalIndependenceVerified:boolean;publisherAuthorized:boolean;
 signedReleaseMetadataVerified:boolean;
};
type IwxaTransfer={size:number;sha256:string;integrityVerified:false;signatureVerified:false;statusVerified:false;activeSeats:0;productionActivation:false;};
type PublisherDiagnosticsReport={schema:'IWXA_DIAGNOSTICS/1';productId:'iwxa.publisher';version:string;
 application:'NATIVE_RUNNING';localPreparation:'READABLE'|'EMPTY'|'NEEDS_ATTENTION';
 webviewProfile:'FOLDER_PRESENT'|'FOLDER_NOT_OBSERVED';setupCore:'CHECK_IN_SETUP_CORE';
 licensing:'TEST_ONLY';activeSeats:0;productionActivation:false;attentionRequired:boolean};
type Page = 'overview'|'products'|'tariffs'|'holders'|'proposals'|'releases'|'trust';
const navigation: [Page,string][] = [
 ['overview','Обзор'],['products','Продукты'],['tariffs','Тарифы и лимиты'],['holders','Клиенты'],
 ['proposals','Лицензии'],['releases','Релизы'],['trust','Доверие и ключи']
];
function PublisherNavIcon({section}:{section:Page}){
 return <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
   {section==='overview'&&<><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/></>}
   {section==='products'&&<><path d="m3 7 9-4 9 4v10l-9 4-9-4Z"/><path d="m3 7 9 4 9-4M12 11v10"/></>}
   {section==='tariffs'&&<><path d="M4 5h16v14H4zM8 9h8M8 13h5"/></>}
    {section==='holders'&&<><circle cx="9" cy="8" r="3.5"/><path d="M2.5 20v-2a6.5 6.5 0 0 1 13 0v2M17 5a3 3 0 0 1 0 6M17 14a5.5 5.5 0 0 1 4.5 5.5V20"/></>}
   {section==='proposals'&&<><rect x="5" y="3" width="14" height="18" rx="2"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/></>}
   {section==='releases'&&<><path d="M12 3v12m0 0-4-4m4 4 4-4"/><path d="M4 15v5h16v-5"/></>}
   {section==='trust'&&<><path d="M12 2 20 6v6c0 5-3.4 8.3-8 10-4.6-1.7-8-5-8-10V6Z"/><path d="m9 12 2 2 4-4"/></>}
 </svg>;
}
const publisherDraftMessages:Record<string,string>={
  DUPLICATE_TARIFF_REVISION:'Такая редакция тарифа уже сохранена. Создайте следующую редакцию.',
  TARIFF_PROPOSAL_AMBIGUOUS:'Уточните продукт: одинаковое название тарифа используется в нескольких программах.',
  TARIFF_PROPOSAL_HOLDER_MISMATCH:'Для выбранного клиента нужен тариф соответствующего типа.',
  PROPOSAL_FOLLOWUP_SOURCE_INVALID:'Прежнюю подготовку найти не удалось. Выберите другую.',
  PROPOSAL_FOLLOWUP_PRODUCT_MISMATCH:'Для повторной подготовки должен использоваться тот же продукт.',
  PROPOSAL_HAS_FOLLOWUPS:'Сначала удалите более поздние подготовки, связанные с этой записью.',
  TARIFF_ORGANIZATION_LIMITS_INVALID:'Проверьте места и число сотрудников организации.',
  TARIFF_PERSON_LIMITS_INVALID:'Для личного тарифа укажите число устройств. Мест продукта должно быть одно.',
  TARIFF_QUOTA_DUPLICATE:'Этот ресурс уже имеет ограничение за выбранный период.',
  TARIFF_QUOTA_INVALID:'Проверьте единицу измерения, период и величину ресурса.',
  TARIFF_PRODUCT_MISSING:'Сначала добавьте продукт, к которому относится тариф.'
};
function getError(error:unknown) {
  const code=error instanceof Error?error.message:String(error);
  return publisherDraftMessages[code]||code;
}
// The shipped Publisher is a Tauri desktop program. There is deliberately
// no browser draft fallback: opening its embedded assets in a normal
// browser cannot create or modify Publisher drafts.
const nativeHost=typeof (window as any).__TAURI_INTERNALS__?.invoke==='function';
async function invoke(command:string,args?:Record<string,unknown>):Promise<any> {
 const fn=(window as any).__TAURI_INTERNALS__?.invoke;
 if(typeof fn!=='function')throw new Error('NATIVE_HOST_NOT_CONNECTED');
 return fn(command,args);
}
function initialDraft():Draft{return emptyPublisherDraft() as Draft;}
async function loadDraft():Promise<Draft> {
 const text=await invoke('publisher_draft_read');
 return text===null?initialDraft():decodePublisherDraft(text) as Draft;
}
async function persistDraft(state:Draft):Promise<void> {
 const content=encodePublisherDraft(state);
 await invoke('publisher_draft_save',{content});
}
function typeLabel(type:Holder['type']):string {return type==='ORGANIZATION'?'Организация':'Физическое лицо';}
export default function App(){
 const [state,setState]=useState<Draft>(initialDraft);
 const testScope=useMemo(()=>{
   type Scope={proposalId:string;code:string;route:string;supported:boolean};
   const reports=inspectTestIssuerRequestScopes(state) as Scope[];
   return new Map<string,Scope>(reports.map(v=>[v.proposalId,v] as const));
 },[state]);
 const [loaded,setLoaded]=useState(false);
 const [page,setPage]=useState<Page>('overview');
 const [mobileNav,setMobileNav]=useState(false);
 const [legacyOpen,setLegacyOpen]=useState(false);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [productFeedback,setProductFeedback]=useState<{ok:boolean;message:string}|null>(null);
 const [clientFeedback,setClientFeedback]=useState<{ok:boolean;message:string}|null>(null);
 const [legacyFeedback,setLegacyFeedback]=useState<{ok:boolean;message:string}|null>(null);
 const [artifactFeedback,setArtifactFeedback]=useState<{ok:boolean;message:string}|null>(null);
 const [artifactSaved,setArtifactSaved]=useState(false);
 const [diagnostics,setDiagnostics]=useState<PublisherDiagnosticsReport|null>(null);
 const [diagnosticsBusy,setDiagnosticsBusy]=useState(false);
 const [diagnosticsMessage,setDiagnosticsMessage]=useState('');
 const productFeedbackRef=React.useRef<HTMLParagraphElement>(null);
 const clientFeedbackRef=React.useRef<HTMLParagraphElement>(null);
 const legacyFeedbackRef=React.useRef<HTMLParagraphElement>(null);
 const artifactFeedbackRef=React.useRef<HTMLParagraphElement>(null);
 useEffect(()=>{if(productFeedback)productFeedbackRef.current?.scrollIntoView({block:'nearest',behavior:'auto'});},[productFeedback]);
 useEffect(()=>{if(clientFeedback)clientFeedbackRef.current?.scrollIntoView({block:'nearest',behavior:'auto'});},[clientFeedback]);
 useEffect(()=>{if(legacyFeedback)legacyFeedbackRef.current?.scrollIntoView({block:'nearest',behavior:'auto'});},[legacyFeedback]);
 useEffect(()=>{if(artifactFeedback)artifactFeedbackRef.current?.scrollIntoView({block:'nearest',behavior:'auto'});},[artifactFeedback]);
 const [productId,setProductId]=useState('');
 const [productName,setProductName]=useState('');
 const [productVersion,setProductVersion]=useState('');
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
 const legacyTestRef=React.useRef<HTMLElement>(null);
 useEffect(()=>{if(legacyOpen&&page==='proposals')legacyTestRef.current?.scrollIntoView({block:'start',behavior:'auto'});},[legacyOpen,page]);
 const mainScrollRef=React.useRef<HTMLElement>(null);
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
 const [offlineCopies,setOfflineCopies]=useState<OfflineCopiesCheck|null>(null);
 const [selectedIwxa,setSelectedIwxa]=useState<IwxaTransfer|null>(null);
 const [releaseProduct,setReleaseProduct]=useState('');
 const [releasePlatform,setReleasePlatform]=useState('');
 const [releaseRepo,setReleaseRepo]=useState('');
 const [releaseCommit,setReleaseCommit]=useState('');
 const [releaseTree,setReleaseTree]=useState('');
 const [releaseVersion,setReleaseVersion]=useState('');
 useEffect(()=>{
   if(!nativeHost)return;
   let alive=true;
   loadDraft().then(data=>{if(alive){setState(data);setLoaded(true);}})
     .catch(e=>{if(alive){setError('Не удалось открыть сохранённые черновики: '+getError(e));setLoaded(false);}});
   return ()=>{alive=false;};
 },[]);
 async function change(command:Record<string,unknown>,success:string):Promise<{ok:boolean;message:string}>{
   if(busy||!loaded)return {ok:false,message:'Сохранение сейчас недоступно. Дождитесь завершения текущего действия.'};
   setBusy(true);setError('');setMessage('');setSimulated(null);
   try{
     const next=applyPublisherDraftCommand(state,command) as Draft;
     await persistDraft(next);
     setState(next);
     setPendingRestore(null);
     setMessage(success);
     return {ok:true,message:success};
   }catch(e){
     const reason=getError(e);
     setError(reason);
     return {ok:false,message:'Не удалось сохранить: '+reason};
   }
   finally{setBusy(false);}
 }
 async function saveProduct(e:React.FormEvent){
   e.preventDefault();setProductFeedback(null);
   const result=await change({kind:'addProduct',id:productId.trim(),name:productName.trim(),version:productVersion.trim()},
     'Продукт добавлен в черновик каталога.');
   setProductFeedback(result);
   if(result.ok){setProductId('');setProductName('');setProductVersion('');}
 }
 async function saveLegacyRequest(e:React.FormEvent){
   e.preventDefault();
   if(!activeProduct||!activeHolder)return;
   setLegacyFeedback(null);
   const result=await change({kind:'addProposal',productId:activeProduct,holderId:activeHolder,
     features:features.split(',').map(x=>x.trim()).filter(Boolean),termDays:Number(termDays)},
     'Черновик запроса сохранён. Лицензия не выдана.');
   setLegacyFeedback(result);
   if(result.ok){setProposalProduct('');setProposalHolder('');setFeatures('');setTermDays('30');}
 }
 async function saveClient(e:React.FormEvent){
   e.preventDefault();setClientFeedback(null);
   const result=await change({kind:'addHolder',id:holderSourceId.trim(),name:holderName.trim(),type:holderType},
     'Клиент добавлен в локальный черновик.');
   setClientFeedback(result);
   if(result.ok){setHolderName('');setHolderSourceId('');}
 }
 async function inspect(){
   if(!nativeHost){setError('Выбор и проверка настоящего файла доступны в установленной программе Publisher.');return;}
   setError('');setMessage('');setBusy(true);
   try{
     const result=await invoke('publisher_inspect_artifact');
     if(result){
      setInspected(result as Inspection);
      setArtifactFeedback(null);setArtifactSaved(false);
      // A new EXE requires fresh, reviewed release identity metadata.
      // Never carry a previous product/version/repository into another file.
      setReleaseProduct('');setReleaseVersion('');setReleasePlatform('');
      setReleaseRepo('');setReleaseCommit('');setReleaseTree('');
      setMessage('Байты файла проверены. Источник и разрешение на выпуск ещё не подтверждены.');
     }
   }catch(e){setError(getError(e));}
   finally{setBusy(false);}
 }
 async function compareOfflineCopies(){
   if(busy||!loaded||!nativeHost)return;
   setBusy(true);setError('');setMessage('');setOfflineCopies(null);
   try {
     const result=await invoke('publisher_compare_offline_copies');
     if(result===null){setMessage('Сверка копий отменена. Черновики не изменены.');return;}
     const check=result as OfflineCopiesCheck;
     if(check.copiesChecked!==2||check.sameContent!==true||check.distinctSelectedPaths!==true||
        check.publisherAuthorized!==false||check.signedReleaseMetadataVerified!==false||
        check.physicalIndependenceVerified!==false)throw Error('OFFLINE_COPIES_RESULT_INVALID');
     setOfflineCopies(check);
     setMessage('Байты двух выбранных файлов совпадают. Релиз не подписан и не утверждён.');
   }catch(e){setError('Сверка файлов не выполнена: '+getError(e));}
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
     const saved=await invoke('publisher_save_test_request',{content,suggestedFileName:filename});
     if(!saved){setMessage('Сохранение TEST-запроса отменено.');return;}
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
 const activeProduct=state.products.some(p=>p.id===proposalProduct)?proposalProduct:'';
 const activeHolder=state.holders.some(h=>h.id===proposalHolder)?proposalHolder:'';
 // Never silently associate a release artifact with the first catalog product.
 const selectedReleaseProduct=state.products.some(p=>p.id===releaseProduct)?releaseProduct:'';
 async function saveInspectedArtifact(e:React.FormEvent){
   e.preventDefault();
   if(!inspected||!selectedReleaseProduct||busy||!loaded||artifactSaved)return;
   setArtifactFeedback(null);
   const result=await change({kind:'addArtifact',productId:selectedReleaseProduct,
     version:releaseVersion.trim(),platform:releasePlatform,
     sourceRepository:releaseRepo.trim(),sourceCommit:releaseCommit.trim(),
     sourceTree:releaseTree.trim(),...inspected},
     'Проверенные байты сохранены. Источник и решение о публикации не подтверждены.');
   // Keep the inspected file and all form fields if native persistence fails.
   // After success, retain the evidence and disallow accidental duplicate save
   // until a field is edited or another file is inspected.
   setArtifactFeedback(result);
   setArtifactSaved(result.ok);
 }
 async function selectTestIwxa(){
   if(busy||!loaded||!nativeHost)return;
   setBusy(true);setError('');setMessage('');setSelectedIwxa(null);
   try{
     const v=await invoke('publisher_select_test_iwxa');
     if(v===null){setMessage('Выбор пакета отменён.');return;}
     if(!v||!Number.isSafeInteger(v.size)||v.size<=0||
       typeof v.sha256!=='string'||!/^[0-9a-f]{64}$/.test(v.sha256)||
       v.integrityVerified!==false||v.signatureVerified!==false||
       v.statusVerified!==false||v.productionActivation!==false||v.activeSeats!==0)
       throw Error('PUBLISHER_IWXA_NATIVE_UNVERIFIED_REPORT_REQUIRED');
     setSelectedIwxa(v as IwxaTransfer);
     setMessage('Пакет .iwxa выбран. Подлинность, получатель и статус не проверялись.');
   }catch(e){setError('Не удалось выбрать .iwxa: '+getError(e));}
   finally{setBusy(false);}
 }
 async function exportTestIwxa(){
   if(busy||!loaded||!nativeHost||!selectedIwxa)return;
   setBusy(true);setError('');setMessage('');
   try{
     const saved=await invoke('publisher_export_test_iwxa',{expectedSha256:selectedIwxa.sha256});
     setMessage(saved?'Файл .iwxa скопирован без изменения байтов. Подлинность, статус и права должен проверить получающий продукт или Admin Center.':'Экспорт отменён.');
   }catch(e){setError('Не удалось экспортировать .iwxa: '+getError(e));}
   finally{setBusy(false);}
 }
 async function checkDiagnostics(){
   if(!nativeHost||diagnosticsBusy)return;
   setDiagnosticsBusy(true);setDiagnosticsMessage('');setDiagnostics(null);
   try{
     const report=await invoke('publisher_diagnostics') as PublisherDiagnosticsReport;
     if(report?.schema!=='IWXA_DIAGNOSTICS/1'||report.productId!=='iwxa.publisher'||
        report.application!=='NATIVE_RUNNING'||!['READABLE','EMPTY','NEEDS_ATTENTION'].includes(report.localPreparation)||
        !['FOLDER_PRESENT','FOLDER_NOT_OBSERVED'].includes(report.webviewProfile)||
        report.setupCore!=='CHECK_IN_SETUP_CORE'||report.licensing!=='TEST_ONLY'||
        report.activeSeats!==0||report.productionActivation!==false||
        typeof report.version!=='string'||typeof report.attentionRequired!=='boolean')
       throw Error('PUBLISHER_DIAGNOSTICS_INVALID_REPORT');
     setDiagnostics(report);
   }catch(e){setDiagnosticsMessage('Диагностику получить не удалось: '+getError(e));}
   finally{setDiagnosticsBusy(false);}
 }
 async function copyDiagnostics(){
   if(!diagnostics)return;
   try{
     await navigator.clipboard.writeText(JSON.stringify(diagnostics,null,2));
     setDiagnosticsMessage('Сведения скопированы. Персональные данные и ключи не включены.');
   }catch{
     setDiagnosticsMessage('Автоматическое копирование недоступно. Выделите сведения ниже и нажмите Ctrl+C.');
   }
 }
 function go(p:Page){
   // Reset the native desktop work area's scroll when changing sections.
   // Compact layouts scroll the document instead of the work area.
   if(mainScrollRef.current)mainScrollRef.current.scrollTop=0;
   window.scrollTo(0,0);
   if(p!=='proposals')setLegacyOpen(false);
   setPage(p);setMobileNav(false);setError('');setMessage('');setPendingRestore(null);setOfflineCopies(null);
 }
 const diagnosticPanel=(
<section className="card padded" data-testid="publisher-diagnostics">
            <h2>Диагностика IWXA</h2>
            <p className="muted">Проверяет работу нативной программы, доступность черновиков и наличие локального профиля WebView2. Проверка установки, восстановление и удаление выполняются исходным IWXA Setup Core.</p>
            <div className="actions">
              <button type="button" className="secondary" disabled={!nativeHost||diagnosticsBusy} onClick={()=>void checkDiagnostics()}>{diagnosticsBusy?'Проверяем…':'Проверить программу'}</button>
              {diagnostics&&<button type="button" className="secondary" onClick={()=>void copyDiagnostics()}>Скопировать сведения</button>}
            </div>
            {diagnostics&&<div data-testid="publisher-diagnostics-result" role="status">
              <p>Программа: IWXA Publisher {diagnostics.version} · нативный запуск подтверждён.</p>
              <p>Черновики: {diagnostics.localPreparation==='READABLE'?'читаются':diagnostics.localPreparation==='EMPTY'?'ещё не созданы':'требуют внимания'}.
              Профиль WebView2: {diagnostics.webviewProfile==='FOLDER_PRESENT'?'каталог доступен':'каталог не обнаружен'}.</p>
              <p className="muted">Установка: откройте IWXA Setup Core для проверки, восстановления или удаления. Лицензирование: только TEST, коммерческих мест — 0.</p>
              <textarea aria-label="Сведения диагностики" readOnly rows={8}
                value={JSON.stringify(diagnostics,null,2)} style={{width:'100%',fontFamily:'monospace'}}/>
            </div>}
            {diagnosticsMessage&&<p role={diagnostics?'status':'alert'} data-testid="publisher-diagnostics-feedback">{diagnosticsMessage}</p>}
          </section>
 );
 if(!nativeHost){
   return <main className="publisher-desktop-required" data-testid="publisher-desktop-required">
     <section className="publisher-desktop-required-card" role="status">
       <img src="/favicon.svg" width="64" height="64" alt="IWXA"/>
       <div className="eyebrow">IWXA · DESKTOP</div>
       <h1>IWXA Publisher</h1>
       <p>Publisher — самостоятельная настольная программа. Откройте установленное приложение Windows; браузерная версия для работы с продуктами, запросами и лицензиями не предусмотрена.</p>
       <p className="muted">Рабочие данные сохраняются нативным модулем Tauri/Rust на этом компьютере. Сайт и локальный сервер для работы не требуются.</p>
     </section>
   </main>;
 }
 return <div className={'app publisher-app'+(mobileNav?' menu-open':'')}>
   <aside className="sidebar">
     <header className="brand publisher-brand">
       <div className="publisher-brand-lockup">
         <img className="publisher-brand-logo" src="/favicon.svg" alt="IWXA" width="43" height="43"/>
         <div className="publisher-brand-copy"><strong>IWXA</strong><small>Publisher</small></div>
       </div>
       <span className="version publisher-version">0.4</span>
     </header>
     <div className="publisher-nav-caption">ИЗДАТЕЛЬ И ЛИЦЕНЗИИ</div>
     <nav aria-label="Разделы Publisher">
       {navigation.map(([key,label])=><button key={key} type="button" className={'nav-link'+(page===key?' active':'')} onClick={()=>go(key)} aria-current={page===key?'page':undefined}><span className="nav-icon"><PublisherNavIcon section={key}/></span><span>{label}</span></button>)}
     </nav>
     <div className="sidebar-bottom"><p className="local-label"><span className="dot"></span>Локальная программа</p><p>Черновики — не лицензии и не права.</p></div>
   </aside>
   <main className="main" ref={mainScrollRef}>
     <header className="top">
       <button className="menu-button secondary" type="button" onClick={()=>setMobileNav(!mobileNav)} aria-label="Открыть навигацию">☰</button>
       <div className="breadcrumb"><span>IWXA</span> / Publisher / {navigation.find(v=>v[0]===page)?.[1]}</div>
       <span className="status neutral publisher-top-status"><span className="publisher-top-status-dot" aria-hidden="true"></span>{loaded?'Локально сохранено':'Состояние не загружено'}</span>
     </header>
     <div className="page-heading"><div><div className="eyebrow publisher-section-eyebrow">IWXA / РАБОЧЕЕ МЕСТО ИЗДАТЕЛЯ</div><h1>{navigation.find(v=>v[0]===page)?.[1]}</h1></div></div>
     <div className="notice">Publisher 0.4.0-dev.2 · Черновики хранятся отдельно от Admin Center. Подписанные лицензии доступны только в режиме TEST через предварительно настроенный T3 Host. Коммерческая активация мест и выпуск релизов отключены.</div>
     {error&&<div className="notice error" role="alert">{error}</div>}
     {message&&<div className="notice" role="status">{message}</div>}
     {!loaded?<><section className="card padded" role="status">Открываем локальные черновики… При ошибке сохранённые данные не перезаписываются.</section>{page==='overview'&&diagnosticPanel}</>:<>
       {page==='overview'&&<>
         <div className="metrics">
           <div className="card metric publisher-metric"><span>Продукты</span><strong>{state.products.length}</strong><small>Каталог в подготовке</small></div>
           <div className="card metric publisher-metric"><span>Клиенты</span><strong>{state.holders.length}</strong><small>Привязанные идентификаторы</small></div>
           <div className="card metric publisher-metric"><span>Черновики запросов</span><strong>{state.proposals.length}</strong><small>Без выданных лицензий</small></div>
         </div>
         <section className="card padded"><strong>Тарифы и лимиты ({state.tariffs.length})</strong><p className="muted">Организации и физические лица получают разные маршруты выдачи. Сохранённые тарифы пока не являются лицензиями.</p><button className="secondary" type="button" onClick={()=>go('tariffs')}>Открыть тарифы</button></section>
          <section className="hero publisher-hero">
           <div className="publisher-hero-body">
             <div className="publisher-hero-copy">
               <div className="eyebrow">РАБОТА ИЗДАТЕЛЯ</div>
               <h2>Подготовка лицензий и выпусков IWXA</h2>
               <p>Продукт, клиент и условия выдачи — в одном рабочем месте. Действительные права появятся только после подписи и независимой проверки T3.</p>
             </div>
             <div className="publisher-hero-symbol" aria-hidden="true"><img className="publisher-hero-symbol-inner" src="/favicon.svg" alt="" width="79" height="79"/></div>
           </div>
           <div className="actions publisher-hero-actions">
             <button type="button" className="secondary" onClick={()=>go('products')}>Добавить продукт</button>
             <button type="button" className="secondary" onClick={()=>go('releases')}>Проверить сборку</button>
           </div>
         </section>
         <section className="card padded"><h2>Текущее состояние</h2><p className="muted">Заявок на публикацию: {state.artifacts.length}. Подтверждённых релизов: 0. Подписанных лицензий: 0.</p><p className="muted">Реальные источники подписей, trust catalog и приём лицензии в Admin Center пока не включены в этот исполняемый продукт.</p></section>
         {diagnosticPanel}
          <section className="card padded" data-testid="publisher-preparation-backup">
           <h2>Резервная копия черновиков</h2>
           <p className="muted">Включает каталог продуктов, клиентов, редакции тарифов, неподписанные запросы и записи проверок файлов. Действительных лицензий и ключей издателя в копии нет.</p>
           <p className="muted">Восстановление заменит текущие черновики после отдельного подтверждения. Выберите файл резервной копии.</p>
           <div className="actions">
             <button type="button" className="secondary" disabled={!nativeHost||busy} onClick={()=>void exportPreparationBackup()}>Сохранить копию черновиков</button>
             <button type="button" className="secondary" disabled={!nativeHost||busy} onClick={()=>void restorePreparationBackup()}>Восстановить черновики</button>
           </div>

           {pendingRestore&&<div ref={restoreConfirmationRef} className="publisher-test-request" role="group" aria-label="Подтверждение восстановления черновиков" data-testid="publisher-restore-confirmation">
             <strong>Подтвердите замену черновиков</strong>
             <p>В выбранной копии: продуктов — {pendingRestore.products.length}, клиентов — {pendingRestore.holders.length}, тарифов — {pendingRestore.tariffs.length}, неподписанных запросов — {pendingRestore.proposals.length}.</p>
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
           <form onSubmit={e=>void saveProduct(e)} onChangeCapture={()=>setProductFeedback(null)}>
             <div className="form-grid">
               <label>Идентификатор продукта<input required maxLength={64} placeholder="IWXA_ADMIN_CENTER" value={productId} onChange={e=>setProductId(e.target.value)}/></label>
               <label>Название<input required maxLength={130} placeholder="IWXA Admin Center" value={productName} onChange={e=>setProductName(e.target.value)}/></label>
               <label>Версия<input required value={productVersion} onChange={e=>setProductVersion(e.target.value)} placeholder="0.2.0"/></label>
             </div><div className="publisher-save-action" data-testid="publisher-product-save-action">
               <button className="primary" disabled={busy} type="submit">{busy?'Сохраняем…':'Сохранить продукт'}</button>
               {productFeedback&&<p ref={productFeedbackRef} className={'publisher-inline-feedback '+(productFeedback.ok?'success':'error')}
                 role={productFeedback.ok?'status':'alert'} data-testid="publisher-product-save-feedback">{productFeedback.message}</p>}
             </div>
           </form>
         </section>
         <section className="card padded"><h2>Продукты ({state.products.length})</h2>{state.products.length===0?<p className="muted">Каталог пуст. Ни один продукт не допущен к распространению.</p>:state.products.map(p=><div className="simple-row" key={p.id}><div><strong>{p.name}</strong><small>{p.id} · {p.version}</small></div><span className="status neutral">Черновик</span></div>)}</section>
       </>}
       {page==='tariffs'&&<TariffPanel draft={state} busy={busy} change={change}/>}
        {page==='holders'&&<>
         <section className="card form-panel"><h2>Новый клиент</h2><form onSubmit={e=>void saveClient(e)} onChangeCapture={()=>setClientFeedback(null)}>
           <p className="muted">{holderType==='PERSON'?'Для личной лицензии укажите постоянный идентификатор владельца. Admin Center не нужен.':'Для лицензии организации укажите её идентификатор, используемый в Admin Center.'} Эта запись пока не предоставляет прав.</p>
           <div className="form-grid"><label>Идентификатор клиента<input required maxLength={90} placeholder={holderType==='PERSON'?'person:example':'org:example'} value={holderSourceId} onChange={e=>setHolderSourceId(e.target.value)}/></label><label>Название / имя<input required maxLength={130} value={holderName} onChange={e=>setHolderName(e.target.value)}/></label>
           <label>Тип субъекта<select value={holderType} onChange={e=>setHolderType(e.target.value as Holder['type'])}><option value="ORGANIZATION">Организация</option><option value="PERSON">Физическое лицо</option></select></label></div>
           <div className="publisher-save-action" data-testid="publisher-client-save-action">
             <button className="primary" disabled={busy} type="submit">{busy?'Сохраняем…':'Сохранить клиента'}</button>
             {clientFeedback&&<p ref={clientFeedbackRef} className={'publisher-inline-feedback '+(clientFeedback.ok?'success':'error')}
               role={clientFeedback.ok?'status':'alert'} data-testid="publisher-client-save-feedback">{clientFeedback.message}</p>}
           </div></form></section>
         <section className="card padded"><h2>Клиенты ({state.holders.length})</h2>{state.holders.length===0?<p className="muted">Клиентов пока нет.</p>:state.holders.map(h=><div key={h.id} className="simple-row"><div><strong>{h.name}</strong><small>{typeLabel(h.type)} · {h.id}</small></div><span className="status neutral">Подготовка</span></div>)}</section>
       </>}
       {page==='proposals'&&<>
          <div className="publisher-license-shortcut">
            <p className="muted">Для обычной подготовки выберите тариф и клиента. Простой TEST-запрос оставлен только для совместимости.</p>
            <button type="button" className="secondary" aria-expanded={legacyOpen} onClick={()=>setLegacyOpen(value=>!value)}>{legacyOpen?'Скрыть TEST-запрос':'Открыть TEST-запрос'}</button>
          </div>
          <TariffPanel draft={state} busy={busy} change={change} mode="offer"/>
         {legacyOpen&&<section ref={legacyTestRef} className="card form-panel"><h2>Простой TEST-запрос (совместимость)</h2><p className="muted">Создание запроса не создаёт подписанной лицензии и не меняет права получателя.</p>
         {state.products.length===0||state.holders.length===0?<div className="notice">Для запроса необходимо сначала создать продукт и клиента.</div>:<form onSubmit={e=>void saveLegacyRequest(e)} onChangeCapture={()=>setLegacyFeedback(null)}>
           <div className="form-grid"><label>Продукт<select value={activeProduct} onChange={e=>setProposalProduct(e.target.value)}><option value="">Выберите продукт</option>{state.products.map(p=><option key={p.id} value={p.id}>{p.name} ({p.version})</option>)}</select></label>
           <label>Получатель<select value={activeHolder} onChange={e=>setProposalHolder(e.target.value)}><option value="">Выберите клиента</option>{state.holders.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
           <label>Функции (коды через запятую)<input value={features} onChange={e=>setFeatures(e.target.value)} placeholder="Не определены"/></label>
           <label>Срок в днях<input type="number" min={1} max={3650} required value={termDays} onChange={e=>setTermDays(e.target.value)}/></label></div>
           <div className="publisher-save-action" data-testid="publisher-legacy-save-action">
             <button type="submit" className="primary" disabled={busy||!activeProduct||!activeHolder}>Сохранить запрос</button>
             {legacyFeedback&&<p ref={legacyFeedbackRef} className={'publisher-inline-feedback '+(legacyFeedback.ok?'success':'error')}
               role={legacyFeedback.ok?'status':'alert'} data-testid="publisher-legacy-save-feedback">{legacyFeedback.message}</p>}
           </div></form>}</section>}
         <section className="card padded"><h2>Подготовленные запросы ({state.proposals.length})</h2>
          {state.proposals.length>0&&<div className="publisher-test-request">
            <p className="muted">Экспорт TEST-запроса для будущего оригинального издателя T3. Файл не подписан и не предоставляет права Admin Center.</p>
            <label>Места для TEST-запроса<input aria-label="Места для TEST-запроса" type="number" min={1} max={10000} value={testSeats} onChange={e=>setTestSeats(e.target.value)}/></label>
          </div>}
         {state.proposals.length===0?<p className="muted">Запросов пока нет.</p>:state.proposals.map(p=><div className="simple-row" key={p.id}><div><strong>{productTitle(p.productId)}</strong><small>{holderTitle(p.holderId)} · {p.termDays} дн. · {p.features.length? p.features.join(', '):'Функции не выбраны'}</small>{p.tariffSnapshot&&<small>{p.tariffSnapshot.name} · редакция {p.tariffSnapshot.revision} · места {p.tariffSnapshot.productSeats} · сотрудники {p.tariffSnapshot.employeeLimit} · устройства {p.tariffSnapshot.deviceLimit} · {p.tariffSnapshot.holderType==='PERSON'?'Напрямую в продукт':'Через Admin Center'}</small>}{p.previousProposalId&&<small>Повторная подготовка по прежнему запросу; действующая лицензия не изменена</small>}{testScope.get(p.id)?.code==='PERSON_SIGNED_CONTRACT_UNAVAILABLE'&&<small className="publisher-license-unavailable">Для личной лицензии нужен подписанный контракт издателя и локальная проверка в установленной программе. Запрос сохранён, права не выданы.</small>}{testScope.get(p.id)?.code==='PRODUCT_SIGNED_CONTRACT_UNAVAILABLE'&&<small className="publisher-license-unavailable">Существующий T3 TEST-контракт не подписывает лицензии этого продукта.</small>}</div><span className="status neutral">Не выдано</span>
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
         <section className="card form-panel" data-testid="publisher-offline-copies">
           <h2>Сверка двух копий файла поставки</h2>
           <p className="muted">Выберите два файла через системные диалоги. Publisher независимо прочитает байты каждого и сравнит имя, размер и SHA-256. Проверка не подтверждает независимость носителей, происхождение, подпись или разрешение на публикацию.</p>
           <button type="button" className="secondary" disabled={busy} onClick={()=>void compareOfflineCopies()}>Сверить две копии файла</button>
           {offlineCopies&&<div className="inspected" role="status" data-testid="publisher-offline-copies-result">
             <strong>Сверены 2 файла — байты совпадают</strong>
             <small>{offlineCopies.name} · {offlineCopies.size.toLocaleString('ru-RU')} байт</small>
             <code>{offlineCopies.sha256}</code>
             <p className="muted">Два разных выбранных пути. Независимость физических носителей не подтверждена. Подписи и разрешения на выпуск нет.</p>
           </div>}
         </section>
         <section className="card form-panel"><h2>Проверить настоящий файл сборки</h2><p className="muted">Проверяется фактический SHA-256 содержимого и размер файла. Версию исходников и право публикации проверяет отдельный выпускной процесс.</p>
           <button type="button" className="secondary" onClick={()=>void inspect()} disabled={busy||!nativeHost}>Выбрать и проверить файл</button>
           {inspected&&<div className="inspected"><strong>{inspected.name}</strong><small>{inspected.size.toLocaleString('ru-RU')} байт</small><code>{inspected.sha256}</code></div>}
         </section>
         {inspected&&state.products.length>0&&<section className="card form-panel"><h2>Зафиксировать проверку файла</h2>
           <form onSubmit={e=>void saveInspectedArtifact(e)} onChangeCapture={()=>{
                setArtifactFeedback(null);setArtifactSaved(false);
              }}>
             <div className="form-grid"><label>Продукт<select value={selectedReleaseProduct} required onChange={e=>setReleaseProduct(e.target.value)}><option value="">Выберите продукт</option>{state.products.map(p=><option value={p.id} key={p.id}>{p.name}</option>)}</select></label>
             <label>Версия файла<input required placeholder="Например, 0.3.0" value={releaseVersion} onChange={e=>setReleaseVersion(e.target.value)}/></label>
             <label>Платформа<select required value={releasePlatform} onChange={e=>setReleasePlatform(e.target.value)}><option value="">Выберите платформу</option>{['windows-x64','windows-arm64','linux-x64','linux-arm64','macos-x64','macos-arm64'].map(p=><option key={p} value={p}>{p}</option>)}</select></label>
             <label>Репозиторий источника<input required placeholder="Владелец/репозиторий" value={releaseRepo} onChange={e=>setReleaseRepo(e.target.value)}/></label>
             <label>Source commit (40 hex)<input required value={releaseCommit} onChange={e=>setReleaseCommit(e.target.value)}/></label>
             <label>Source tree (40 hex)<input required value={releaseTree} onChange={e=>setReleaseTree(e.target.value)}/></label></div>
             <div className="publisher-save-action" data-testid="publisher-artifact-save-action">
                <button type="submit" className="primary"
                  disabled={busy||!selectedReleaseProduct||artifactSaved}>Сохранить проверенный файл</button>
                {artifactFeedback&&<p ref={artifactFeedbackRef}
                  className={'publisher-inline-feedback '+(artifactFeedback.ok?'success':'error')}
                  role={artifactFeedback.ok?'status':'alert'} data-testid="publisher-artifact-save-feedback">{artifactFeedback.message}</p>}
              </div>
           </form></section>}
         <section className="card padded"><h2>Проверенные файлы ({state.artifacts.length})</h2>
         {state.artifacts.length===0?<p className="muted">Файлы ещё не проверены. Подтверждённых релизов нет.</p>:state.artifacts.map(a=><div key={a.id} className="simple-row"><div><strong>{a.name}</strong><small>{productTitle(a.productId)} · {a.version} · {a.platform} · SHA-256 {a.sha256}</small><small>Заявленный источник: {a.sourceRepository} @ {a.sourceCommit.slice(0,12)} (не проверен независимо)</small></div><span className="status neutral">Не опубликовано</span></div>)}</section>
       </>}
       {page==='trust'&&<section className="card padded"><h2>Издательские полномочия</h2>
           <p className="muted">TEST-подпись доступна только через ранее зарегистрированного владельца и оригинальный нативный компонент T3. Подписанный выпуск PERSON требует отдельно зарегистрированного издателя. Закрытые ключи не передаются в интерфейс. Действие лицензии подтверждается установленным продуктом, а не фактом её выдачи.</p>
           <PublisherT3OwnerPanel draft={state} invoke={invoke}/>
           <div className="divider"></div>
           <h3>Офлайн-передача пакета .iwxa</h3>
           <p className="muted">Publisher сохраняет выбранный пакет без изменения байтов. Для организации проверку и распределение выполняет Admin Center, для частного лица — установленный продукт. Здесь подпись, статус, получатель и права не проверяются.</p>
           <div className="actions">
             <button className="secondary" data-testid="publisher-select-test-iwxa" disabled={busy} onClick={selectTestIwxa}>Открыть пакет .iwxa</button>
             <button className="secondary" data-testid="publisher-export-test-iwxa" disabled={busy||!selectedIwxa} onClick={exportTestIwxa}>Экспортировать .iwxa</button>
           </div>
           {selectedIwxa&&<div data-testid="publisher-iwxa-unverified" role="status">
             <p><strong>Пакет выбран. Подлинность и статус не проверены.</strong></p>
             <p>Размер: {selectedIwxa.size} байт. Подтверждённых мест: 0.</p>
             <p className="muted">SHA-256: <code>{selectedIwxa.sha256}</code></p>
           </div>}
           </section>}
     </>}
     <footer className="footer"><span>IWXA Publisher · отдельная owner-side программа</span><span>Локальные подготовительные данные · не лицензия и не release authority</span></footer>
   </main>
   <aside className="inspector"><div className="eyebrow">ИЗДАТЕЛЬСКАЯ ПАНЕЛЬ</div><h2>TEST и подготовка</h2>
     <div className="inspector-card"><strong>Действительные лицензии</strong><p>0</p><small>Подписанные TEST-лицензии не предоставляют коммерческих мест.</small></div>
     <div className="inspector-card"><strong>Подтверждённые релизы</strong><p>0</p><small>SHA-256 сам по себе не является решением о публикации.</small></div>
     <div className="inspector-card"><strong>Разделение полномочий</strong><small>Publisher выдаёт лицензии. Admin Center только потребляет подтверждённые права и распределяет места.</small></div>
   </aside>
 </div>;
}
