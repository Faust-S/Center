import React,{useEffect,useRef,useState} from 'react';
import CorporateD3Panel from './CorporateD3Panel';
import type {ManagerOriginalSelection} from './manager-original-selection';
import type {AcceptedAtlasFocus,AcceptedAtlasReturn,AppliedResultDraftSelection} from './atlas-result-context.mjs';
import CorporateEmployeeEnrollment from './CorporateEmployeeEnrollment';
import {corporateSeatRouteStage,observeOriginalEmployeeRegistry,originalSeatRegistryScopeMatches} from '../runtime/cen03-corporate-seats.mjs';
import {readAppliedResults,prepareAppliedReuse} from '../runtime/cen03-applied-results.mjs';
import {canDecideReviewedResult,acceptedApplicationSelection,ownerSessionFingerprint,receivedResultInbox,signedD3SessionFingerprint,
 signedD3EmployeeScopeFingerprint} from '../runtime/cen03-review.mjs';

// CEN02/CEN03 GUI consumes an approved host implementation. Private T3 code,
// keys, permissions, signing, Reconciliation and Store never run in this WebView.
type Invoke=(command:string,args?:Record<string,unknown>)=>Promise<any>;
type Org={id:string;name:string;workspaces:Array<{id:string;name:string}>;participants?:Array<{id:string;name:string}>;assignments:Array<{id:string;title:string;workspaceId?:string;assigneeId?:string|null;reviewerId?:string|null;status?:string;editNumber?:number;description?:string;criteria?:string;dueDate?:string;atlasRef:{projectId:string;revision:string;workId?:string}|null;sourceResultRef?:{organizationId:string;workspaceId:string;taskId:string;taskRevisionId:string;resultRevisionId:string;acceptanceId:string}|null}>};
const hex=/^[a-f0-9]{64}$/;
const why=(e:unknown)=>{
 const message=e instanceof Error?e.message:String(e);
 if(message.includes('T3_RECEIVE_STORE_READBACK_HOLD'))
   return 'Получение не подтверждено хранилищем организации. Обновите список Result и проверьте журнал перед повторной передачей файла.';
 if(/CEN_D3_KERNEL_COMMIT_OUTCOME_UNKNOWN|CEN_D3_KERNEL_RECOVERY_READBACK_INVALID|T3_D3_KERNEL_WRITE_MAY_HAVE_COMMITTED|CEN_D3_APPLY_RECOVERY_NOT_CONNECTED|CEN_D3_PREVIOUS_APPLY_REQUIRED_FOR_RECOVERY/.test(message))
   return 'Kernel Apply не подтверждён. Не отправляйте Apply повторно: после подключения исходного владельца используйте «Проверить Kernel без повторного Apply».';
 if(message.includes('CEN_D3_EMPLOYEE_TASK_DATA_HUMAN_CANCELLED'))
   return 'Выдача адресного права на поручение отменена до записи. Можно подтвердить выдачу заново.';
 if(/T3_D3_EMPLOYEE_TASK_DATA_OUTCOME_UNKNOWN|CEN_D3_EMPLOYEE_TASK_DATA_UNKNOWN_READBACK_REQUIRED/.test(message))
   return 'Выдача адресного права на поручение не подтверждена. Не выдавайте право повторно: перечитайте исходный DATA-грант.';
 if(/CEN_D3_EMPLOYEE_TASK_DATA_READBACK_HOLD|CEN_D3_EMPLOYEE_TASK_DATA_USE_READBACK/.test(message))
   return 'Адресное право не подтверждено для выбранного сотрудника. Перечитайте исходный DATA-грант.';
 if(/OUTCOME_UNKNOWN|T3_D3_ORIGINAL_DECISION_READBACK_NOT_CONFIRMED/.test(message))
   return 'Исход операции неизвестен. Не повторяйте ACCEPT, REJECT или Apply. Откройте исходную квитанцию по сохранённому ID и SHA-256 пакета.';
 if(message.includes('CEN_D3_EMPLOYEE_CREDENTIAL_HUMAN_CANCELLED'))
   return 'Подтверждение публичного ключа сотрудника отменено в Windows до записи. Можно проверить или повторно подтвердить его.';
 if(message.includes('CEN_D3_EMPLOYEE_GRANTS_HUMAN_CANCELLED'))
   return 'Выдача ACTION/DATA сотруднику отменена в Windows до отправки в Kernel. Права не выдавались.';
 if(message.includes('CEN_D3_EMPLOYEE_REGISTRY_HUMAN_CANCELLED'))
   return 'Подключение исходного корпоративного реестра отменено до записи.';
 if(/T3_D3_ORIGINAL_EMPLOYEE_REGISTRY_EXISTS_USE_READBACK|CEN_D3_EMPLOYEE_REGISTRY_USE_READBACK/.test(message))
   return 'Оригинальный реестр уже может существовать. Не повторяйте запись: используйте «Проверить реестр без записи».';
 if(/T3_D3_ORIGINAL_KERNEL_OUTCOME_UNKNOWN|T3_D3_ORIGINAL_EMPLOYEE_REGISTRY_READBACK_HOLD/.test(message))
   return 'Исход подключения реестра неизвестен. Не повторяйте запись: перечитайте оригинальный Kernel без записи.';
 if(message.includes('CEN_D3_REVIEW_CONTINUATION_HOLD'))
   return 'Не удалось подтвердить локальное сохранение ID решения или редакций. Запись не отправляется повторно. Проверьте исходную квитанцию или Kernel.';
 if(message.includes('CEN_D3_HUMAN_REVIEW_CANCELLED'))
   return 'Решение отменено в системном окне Windows. Оно не отправлялось.';
 if(message.includes('CEN_D3_SEPARATE_HUMAN_APPLY_CANCELLED'))
   return 'Применение отменено в системном окне Windows до отправки в Kernel. Для продолжения подтвердите применение ещё раз.';
 if(message.includes('CEN_D3_ORIGINAL_WORKSPACE_NOT_RUNNING'))
   return 'Для Apply и проверки Kernel откройте подписанную Workspace T3 в этом окне Admin Center. Закрытие Workspace не отправляет Apply.';
 if(message.includes('T3_D3_DESTINATION_ALREADY_EXISTS'))
   return 'Файл .iwxa с таким именем уже существует. Выберите новое имя: исходный подписанный файл не перезаписывается.';
 if(message.includes('T3_D3_DESTINATION_UNAVAILABLE'))
   return 'Папка для сохранения .iwxa недоступна. Выберите другой каталог.';
 if(/CEN_D3_EMPLOYEE_DRAFT_(?:CHANGED_BEFORE_SIGNING|SOURCE_INVALID|RESULT_SOURCE_CHANGED)/.test(message))
   return 'Черновик, его источник или подписанный контекст изменился. Выберите актуальный черновик и подтвердите адресата заново. Task не подписана.';
 if(message.includes('CEN_D3_ATLAS_OWNER_NOT_AVAILABLE'))
   return 'Установленный Atlas не открыл источник проекта. Не подписывайте Task по старой копии. Откройте проект в Atlas и проверьте связь.';
 if(message.includes('CEN_D3_ATLAS_SOURCE_REVISION_STALE'))
   return 'Исходный план Atlas изменён или работа отсутствует. Обновите связь поручения с актуальной редакцией до подписания Task.';
 if(message.includes('CEN_D3_ORIGINAL_TASK_INVENTORY_READBACK_HOLD'))
   return 'Список поручений изменился. Обновите корпоративную сессию и прочитайте оригинальную Task ещё раз, не подписывая её повторно.';
 if(/CEN_D3_SIGNED_ENROLLMENT_DRAFT_(?:NOT_READY|SAVE_UNCONFIRMED|READBACK_MISMATCH|CHANGED)/.test(message))
   return 'Подключение T3 не началось: не удалось подтвердить сохранение рабочей области организации на этом компьютере. Проверьте данные и повторите.';
 if(message.includes('CEN_D3_MANAGER_SOURCE_NOT_IN_INBOX'))
   return 'Пакет не найден в свежем оригинальном Reconciliation. Вернитесь к поиску и перечитайте источник. Решение не отправлялось.';
 if(message.includes('CEN_D3_MANAGER_SOURCE_CONTEXT_CHANGED'))
   return 'Подписанный контекст T3 изменился. Перечитайте корпоративные сведения и выберите источник заново.';
 if(message.includes('CEN_D3_ORIGINAL_TASK_ALREADY_ISSUED'))
   return 'У этого поручения уже есть подписанный ID. Откройте сохранённую Task или подготовьте новый ID.';
 if(/CEN_D3_ORIGINAL_TASK_WRITE_READBACK_UNKNOWN|T3_D3_OWNER_CONTEXT_CHANGED_OUTCOME_UNKNOWN/.test(message))
   return 'Не удалось подтвердить результат подписания или экспорта. Обновите исходный список Task перед новой операцией, чтобы не создавать дубликат.';
 return message;
};
export default function CorporatePanel({organization,invoke,onReuse,onPrepare,onSetupWorkspace,onEnsureDraftSaved,onOpenSignedWorkspace,signedWorkspaceGeneration=0,managerOriginal=null,preferredEmployeeContactId=null,preferCorporateSeats=false,signedWorkspaceVisible=false,signedWorkspaceOpen=false,onOpenLicenses,onInspectAtlasResult,atlasResultReturn,onClearAtlasResultReturn}:{organization:Org;invoke:Invoke|null;onReuse:(selection:AppliedResultDraftSelection)=>void;onPrepare:()=>void;onSetupWorkspace:()=>void;onEnsureDraftSaved:(organizationId:string,workspaceId:string)=>Promise<void>;onOpenSignedWorkspace:(organizationId:string)=>Promise<void>;signedWorkspaceGeneration?:number;managerOriginal?:ManagerOriginalSelection|null;preferredEmployeeContactId?:string|null;preferCorporateSeats?:boolean;signedWorkspaceVisible?:boolean;signedWorkspaceOpen?:boolean;onOpenLicenses?:()=>void;onInspectAtlasResult?:(source:AcceptedAtlasFocus)=>void;atlasResultReturn?:AcceptedAtlasReturn|null;onClearAtlasResultReturn?:()=>void}){
 const [owner,setOwner]=useState<any>(null);
 const [ownerAvailability,setOwnerAvailability]=useState<'NOT_CONNECTED'|'CHECKING'|'OWNER_READ_FAILED'|'OWNER_READY'>('NOT_CONNECTED');
 const [ownerReadCode,setOwnerReadCode]=useState('');
 const [enrollmentAvailable,setEnrollmentAvailable]=useState(false);
 const [enrollWorkspace,setEnrollWorkspace]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [notice,setNotice]=useState('');
 const [selected,setSelected]=useState('');
 const [hash,setHash]=useState('');
 const [review,setReview]=useState<any>(null);
 const [consent,setConsent]=useState(false);
 const [rejectReason,setRejectReason]=useState('');
 const [preview,setPreview]=useState<any>(null);
 const [applyConsent,setApplyConsent]=useState(false);
 const [applyDecided,setApplyDecided]=useState(false);
 const [reuseKey,setReuseKey]=useState('');
 const [reuseText,setReuseText]=useState('');
 const organizationId=organization.id;
 const selectedEnrollmentWorkspace=organization.workspaces.some(w=>w.id===enrollWorkspace)
   ?enrollWorkspace:organization.workspaces[0]?.id??'';
 const requestRef=useRef(0),sessionRef=useRef<string|null>(null),actionRef=useRef(false);
 // A signed context epoch change remounts the child. Retain attempted Apply
 // selections in this existing parent UI lifetime (never a second Store).
 const dispatchedD3Applications=useRef<Map<string,string[]>>(new Map());
 // Original signed Task IDs must survive the child remount when the T3
 // contextEpoch changes. This parent UI ref is not another Task store.
 const attemptedD3Tasks=useRef<Map<string,{taskId:string;attempted:boolean}>>(new Map());
 // Keep an already sent Human decision available for receipt-only recovery
 // across signed owner epoch changes, without another Store or journal.
 const attemptedD3Decisions=useRef<Map<string,{operationId:string;decision:'ACCEPT'|'REJECT'}>>(new Map());
 const legacyReady=ownerSessionFingerprint(owner,organizationId)!==null;
 const d3Ready=signedD3SessionFingerprint(owner,organizationId)!==null;
 const ready=legacyReady||d3Ready;
 const seatStage=corporateSeatRouteStage({nativeHost:!!invoke,ownerReadFailed:ownerAvailability==='OWNER_READ_FAILED',d3Ready,snapshot:owner?.snapshot});
 const seatNavigationTarget=seatStage==='SEATS'?'d3-corporate-seat-assignments':
   seatStage==='READ_REGISTRY'||seatStage==='SEAT_CONTRACT_UNAVAILABLE'?'d3-independent-employee':'corporate-panel';
 const automaticRegistryRead=useRef<string|null>(null);
 const [registryRetry,setRegistryRetry]=useState(0);
 const [registryObservation,setRegistryObservation]=useState<{key:string;state:'CHECKING'|'NOT_FOUND'|'CONFIRMED'|'FAILED'|'TIMEOUT'}|null>(null);
 const registryReadKey=d3Ready?JSON.stringify([organizationId,owner.snapshot.workspaceId,owner.snapshot.actorId,
   owner.snapshot.contextId,owner.snapshot.contextEpoch,signedWorkspaceGeneration]):null;
 const registryState=registryObservation?.key===registryReadKey?registryObservation?.state:null;
 const seatGuidance:Record<string,string>={
   NATIVE_REQUIRED:'Распределение мест доступно в установленном Admin Center.',
   OWNER_READ_FAILED:'Не удалось прочитать состояние организации. Обновите сведения перед продолжением.',
   CONNECT_ORGANIZATION:'Подключите организацию. Если рабочая область ещё не создана, добавьте её перед подключением.',
   OPEN_WORKSPACE:signedWorkspaceOpen?'Подключаем исходную Workspace T3 и проверяем реестр.':'Откройте Workspace T3. Исходная система проверит выбранную рабочую область.',
   KERNEL_UNAVAILABLE:'Исходная Workspace T3 недоступна. Обновите состояние организации и проверьте установленный компонент.',
   READ_REGISTRY:'Проверяем существующий реестр сотрудников. Если его нет, подключите реестр отдельным подтверждаемым действием.',
   SEAT_CONTRACT_UNAVAILABLE:'Реестр сотрудников доступен, но установленный T3 не поддерживает корпоративные места. Обновите программу.',
   SEATS:'Актуальные назначения перечитываются из исходного T3. Выберите сотрудника или назначение для изменения.'
 };
 useEffect(()=>{
   if(!preferCorporateSeats||signedWorkspaceVisible)return;
   // Run after the parent's section-scroll reset. Never focus a hidden
   // manager control while the signed native child Workspace is visible.
   const frame=requestAnimationFrame(()=>{
     const target=document.querySelector<HTMLElement>(`[data-testid="${seatNavigationTarget}"]`);
     if(target){target.scrollIntoView({block:'start',behavior:'auto'});target.focus({preventScroll:true});}
   });
   return()=>cancelAnimationFrame(frame);
 },[preferCorporateSeats,seatNavigationTarget,signedWorkspaceVisible]);
 const resetReview=()=>{setReview(null);setConsent(false);setRejectReason('');setPreview(null);setApplyConsent(false);setApplyDecided(false)};
 const adoptOwner=(candidate:any)=>{
   const fingerprint=ownerSessionFingerprint(candidate,organizationId)??
     signedD3SessionFingerprint(candidate,organizationId);
   if(fingerprint!==sessionRef.current){
     sessionRef.current=fingerprint;
     setHash('');setSelected('');setReuseKey('');setReuseText('');
     resetReview();
   }
   const valid=fingerprint===null?null:candidate;
   setEnrollmentAvailable(!valid&&candidate?.status==='NOT_CONNECTED'&&
     candidate?.enrollmentAvailable===true);
   setOwner(valid);
   setOwnerReadCode(!valid&&candidate!==null&&candidate?.status!=='NOT_CONNECTED'&&candidate?.status!=='REFERENCE_ONLY'
     ?'CEN_D3_OWNER_STATE_INVALID':'');
   setOwnerAvailability(valid?'OWNER_READY':
      candidate===null||candidate?.status==='NOT_CONNECTED'||candidate?.status==='REFERENCE_ONLY'
        ?'NOT_CONNECTED':'OWNER_READ_FAILED');
   return valid;
 };
 const ownerReadFailure=(e:unknown)=>{
   const reason=e instanceof Error?e.message:String(e);
   adoptOwner(null);
   // Distinguish a missing Tauri command from a real owner readback failure.
   const missing=/unknown command|command .*not found|center_corporate_state.*not found/i.test(reason);
   setOwnerAvailability(missing?'NOT_CONNECTED':'OWNER_READ_FAILED');
   // Rust and the original native owner expose bounded diagnostic codes.
   // Never show arbitrary exception text (paths, signed bodies or secrets).
   const code=reason.trim().replace(/^Error:\s*/,'');
   setOwnerReadCode(missing?'':/^(?:CEN|T3|INTEROP)_[A-Z0-9_]{4,95}$/.test(code)
     ?code:'CEN_D3_OWNER_READ_UNCONFIRMED');
 };

 const refresh=async()=>{
   const seq=++requestRef.current;
   if(!invoke)return adoptOwner(null);
   try{
     const next=await invoke('center_corporate_state',{organizationId});
     return seq===requestRef.current?adoptOwner(next):null;
    }catch(e){
      if(seq===requestRef.current)ownerReadFailure(e);
      return null;
    }
 };
 useEffect(()=>{
   let cancelled=false;
   const seq=++requestRef.current;
   adoptOwner(null);setError('');setNotice('');
   if(invoke)setOwnerAvailability('CHECKING');
   if(invoke)void invoke('center_corporate_state',{organizationId}).then(r=>{
     if(!cancelled&&seq===requestRef.current)adoptOwner(r);
   }).catch(e=>{
      if(!cancelled&&seq===requestRef.current)ownerReadFailure(e);
    });
   return()=>{cancelled=true;requestRef.current++};
 },[invoke,organizationId,signedWorkspaceGeneration]);
 const execute=async(operation:string,input:Record<string,unknown>={})=>{
   if(!ready||!invoke)throw Error('CEN_OWNER_NOT_CONNECTED');
   const context=owner.snapshot;
   const r=await invoke('center_corporate_action',{organizationId,operation,input,
     binding:{organizationId:context.organizationId,workspaceId:context.workspaceId,
       contextEpoch:context.contextEpoch,actorId:context.actorId,contextId:context.contextId}});
   if(!r||r.status==='NOT_CONNECTED')throw Error('CEN_OWNER_NOT_CONNECTED');
   return r;
 };
 const act=async(success:string,fn:()=>Promise<void|boolean>,refreshAfter=true)=>{
   // The disabled React button alone is not an atomic guard against two
   // quick event dispatches. Never dispatch Apply twice in one UI session.
   if(actionRef.current)return;
   actionRef.current=true;
   setBusy(true);setError('');setNotice('');
   try{const saved=await fn();if(saved!==false)setNotice(success)}
   catch(e){setError(why(e))}
   finally{if(refreshAfter)await refresh();actionRef.current=false;setBusy(false)}
 };
 // Opening/parking the native child and attaching its original Kernel are
 // asynchronous. Resume the same signed scope and read-only registry until
 // the ORIGINAL workspace/registry observation arrives, never an automatic write.
 useEffect(()=>{
   if(!preferCorporateSeats||signedWorkspaceVisible||!signedWorkspaceOpen||
      !registryReadKey||!invoke||!owner||
      !['OPEN_WORKSPACE','READ_REGISTRY'].includes(seatStage))return;
   const key=registryReadKey,attemptKey=JSON.stringify([key,registryRetry]);
   if(automaticRegistryRead.current===attemptKey)return;
   const {workspaceId,actorId,contextId,contextEpoch}=owner.snapshot;
   const scope={organizationId,workspaceId,actorId,contextId,contextEpoch};
   let active=true,finished=false,timer:number|undefined;
   const begin=()=>{
     if(!active)return;
     if(actionRef.current){timer=window.setTimeout(begin,150);return;}
     automaticRegistryRead.current=attemptKey;
     actionRef.current=true;setBusy(true);setError('');setNotice('');
     setRegistryObservation({key,state:'CHECKING'});
     void (async()=>{
       try{
         const observed=await observeOriginalEmployeeRegistry({
           scope,isCurrent:()=>active,
           readOwner:()=>invoke('center_corporate_state',{organizationId}),
           readRegistry:candidate=>{const s=candidate.snapshot;return invoke('center_corporate_action',{
             organizationId,operation:'d3EmployeeRegistryReadback',input:{},
             binding:{organizationId:s.organizationId,workspaceId:s.workspaceId,
               contextEpoch:s.contextEpoch,actorId:s.actorId,contextId:s.contextId}})},
           wait:()=>new Promise<void>(resolve=>window.setTimeout(resolve,600)),
         });
         if(!active||observed==='CANCELLED')return;
         if(observed==='TIMEOUT'){finished=true;setRegistryObservation({key,state:'TIMEOUT'});return;}
         // The native receipt can change available operations without a
         // context epoch change. Re-read that exact owner, not a UI guess.
         const next=await invoke('center_corporate_state',{organizationId});
         if(!active)return;
         if(!originalSeatRegistryScopeMatches(next,scope))
           throw Error('CEN_D3_EMPLOYEE_REGISTRY_SCOPE_CHANGED');
         adoptOwner(next);
         finished=true;
         setRegistryObservation({key,state:observed==='CONFIRMED'?'CONFIRMED':'NOT_FOUND'});
       }catch(e){
         if(active){finished=true;setRegistryObservation({key,state:'FAILED'});setError(why(e));}
       }finally{actionRef.current=false;setBusy(false);}
     })();
   };
   timer=window.setTimeout(begin,0);
   return()=>{
     active=false;
     if(timer!==undefined)window.clearTimeout(timer);
     // A cancelled observation is not a completed read. Returning to the
     // same signed scope may resume it once the native action slot is free.
     if(!finished&&automaticRegistryRead.current===attemptKey)
       automaticRegistryRead.current=null;
   };
 },[preferCorporateSeats,signedWorkspaceVisible,signedWorkspaceOpen,registryReadKey,registryRetry,invoke]);
 const applied=(()=>{
   if(!legacyReady)return {status:'NOT_CONNECTED',records:[] as any[]};
   try{return readAppliedResults(owner.snapshot,organizationId,owner.snapshot.workspaceId)}
   catch{return {status:'HOLD_FOR_EXPLICIT_RECOVERY',records:[] as any[]}}
 })();
 const records=applied.records as any[];
 const chosen=records.find(r=>r.taskId+'|'+r.resultRevisionId===reuseKey);
 const inbox=(()=>{
  if(!legacyReady)return {status:'NOT_CONNECTED',items:[] as any[],counts:null};
  try{return receivedResultInbox(owner.snapshot,organizationId,owner.snapshot.workspaceId)}
  catch{return {status:'OWNER_READBACK_INVALID',items:[] as any[],counts:null}}
 })();
 const inboxLabels:Record<string,string>={
  REVIEW_REQUIRED:'Ожидает Review',RECEIPT_CONFLICT:'Проверить квитанции',
  ACCEPTED:'ACCEPT (не Apply)',REJECTED:'REJECT'
 };
 // Real staff/operator identities are projections of the ORIGINAL T3 owner,
 // not the draft participants in CEN01 and not a license or credential issuer.
 const staff=legacyReady&&Array.isArray(owner?.snapshot?.staff)
   ?owner.snapshot.staff.filter((x:any)=>typeof x?.id==='string' &&
      typeof x?.personId==='string'&&typeof x?.workspaceId==='string'):[];
 const operators=legacyReady&&Array.isArray(owner?.snapshot?.operators)
   ?owner.snapshot.operators.filter((x:any)=>typeof x?.id==='string' &&
      typeof x?.personId==='string'):[];
 const acceptedSelection=acceptedApplicationSelection(review,hash);
 const canApply=legacyReady&&!!acceptedSelection&&
   owner.snapshot?.application?.status!=='HOLD_FOR_EXPLICIT_RECOVERY';
 return <section className="card padded" data-testid="corporate-panel" tabIndex={preferCorporateSeats?-1:undefined}>
  <div className="section-head"><h2>Поручения и корпоративная приёмка</h2>
   <div className="actions">
    {d3Ready&&invoke&&owner?.snapshot?.originalSignedWorkspaceAvailable===true&&
      <button className="secondary" data-testid="d3-open-signed-workspace" disabled={busy}
        onClick={()=>act('Подписанная Workspace открыта внутри Admin Center.',async()=>
          onOpenSignedWorkspace(organizationId))}>Открыть Workspace T3</button>}
    <button className="secondary" id="iwxa-center-owner-refresh" data-testid="corporate-owner-refresh"
      aria-label="Обновить подписанное состояние"
      disabled={busy||ownerAvailability==='CHECKING'} onClick={()=>act('Исходное состояние подтверждено.',async()=>{
        const next=await refresh();
        resetReview();
        // A failed or absent original owner is not successful readback.
        // This explicit recovery is one read, never a second enrollment.
        return next!==null;
      },false)}>Обновить</button>
   </div></div>
  {preferCorporateSeats&&<div data-testid="corporate-seat-route-guide">
   <p role="status">{ownerAvailability==='CHECKING'?'Проверяем подписанное состояние организации.':registryState==='CHECKING'?'Проверяем выбранную Workspace и читаем исходный реестр сотрудников.':
     registryState==='NOT_FOUND'&&seatStage==='READ_REGISTRY'?'Исходный реестр сотрудников ещё не создан. Подключите его отдельным подтверждаемым действием.':
     registryState==='TIMEOUT'?'Исходная Workspace ещё не подтвердила готовность. Откройте её или повторите чтение.':
     registryState==='FAILED'?'Чтение реестра не подтверждено. Новые назначения недоступны.':seatGuidance[seatStage]}</p>
   {(registryState==='TIMEOUT'||registryState==='FAILED')&&
     <button type="button" className="secondary" disabled={busy} onClick={()=>setRegistryRetry(value=>value+1)}>Повторить чтение реестра</button>}
  </div>}
  <p className="muted">Все подписи, проверки полномочий и записи выполняются исходными механизмами из Faust-S/T3. Черновики не дают права выдачи.</p>
  <p className="notice subdued" role="status" id="iwxa-center-original-owner-state" data-testid="corporate-owner-status">{d3Ready?'Подписанный T3 D3 получатель доступен. Это не статус готовности всего T3.':ready?'Подтверждённая организационная сессия владельца.':ownerAvailability==='CHECKING'?'Проверяем подписанное состояние организации.':ownerAvailability==='OWNER_READ_FAILED'?'OWNER_READ_FAILED: не удалось прочитать организационную сессию. Корпоративные действия заблокированы; нажмите «Обновить».':'NOT_CONNECTED: организационный механизм не активирован в установленном Admin Center. Действия недоступны.'}</p>
  {ownerAvailability==='OWNER_READ_FAILED'&&ownerReadCode&&<p role="alert" id="iwxa-center-original-owner-error"
    data-testid="corporate-owner-diagnostic" className="notice error">Код чтения: {ownerReadCode}. Запись не выполнялась.</p>}
  {error&&<p role="alert" data-testid="corporate-operation-error" className="notice error">{error}</p>}{notice&&<p role="status" className="notice">{notice}</p>}
  {!ready&&enrollmentAvailable&&invoke&&<div className="nested-form" data-testid="d3-org-onboarding">
   <h3>Подключить подписанную организацию T3</h3>
   <p className="muted">Создать собственный подписанный организационный контур
    с оригинальным AccessRegistry, ключами Ed25519 и Windows DPAPI.
    Это отдельное подтверждаемое действие, а не преобразование черновиков в права.</p>
   {organization.workspaces.length===0
     ? <div className="notice subdued" data-testid="d3-enrollment-no-workspace">
        <p>Перед подписанным подключением создайте рабочую область этой организации.
         Это подготовительный шаг: он не выдаёт права и не создаёт T3 Workspace.</p>
        <button type="button" className="secondary" data-testid="d3-enrollment-create-workspace"
         disabled={busy} onClick={onSetupWorkspace}>Создать рабочую область</button>
       </div>
     : <label>Первая рабочая область
        <select data-testid="d3-enrollment-workspace" value={selectedEnrollmentWorkspace}
         disabled={busy} onChange={e=>setEnrollWorkspace(e.target.value)}>
         {organization.workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
       </label>}
   <button className="primary" data-testid="d3-enroll" disabled={busy||!selectedEnrollmentWorkspace}
    onClick={()=>act('Оригинальный подписанный T3-владелец организации подключён.',async()=>{
      // The original signed organization binds immutable organization and
      // Workspace IDs. Ensure Center has durably stored and read back the
      // exact current local draft BEFORE any irreversible T3 enrollment.
      await onEnsureDraftSaved(organizationId,selectedEnrollmentWorkspace);
      const result=await invoke('center_corporate_enroll',{
        organizationId,workspaceId:selectedEnrollmentWorkspace,
        organizationName:organization.name});
      if(result?.status!=='D3_OWNER_READY'||
        result.snapshot?.organizationId!==organizationId)
        throw Error('CEN_D3_SIGNED_ENROLLMENT_UNCONFIRMED');
    })}>Подключить организацию</button>
  </div>}
  {d3Ready&&invoke&&<CorporateEmployeeEnrollment key={'employee|'+(signedD3EmployeeScopeFingerprint(owner,organizationId)??'unknown')}
    session={owner.snapshot} contacts={organization.participants??[]} managerOriginal={managerOriginal}
    assignmentDrafts={organization.assignments.filter(a=>a.workspaceId===owner.snapshot.workspaceId)}
    invoke={invoke} onEnsureDraftSaved={onEnsureDraftSaved}
    preferredContactId={preferredEmployeeContactId} autoReadSeats={preferCorporateSeats&&!signedWorkspaceVisible}
    requireRegistryAbsence={preferCorporateSeats} registryAbsent={registryState==='NOT_FOUND'}
    execute={execute} run={act} busy={busy} onOpenLicenses={onOpenLicenses}/>}
  {d3Ready&&invoke ? <CorporateD3Panel key={'review|'+(signedD3SessionFingerprint(owner,organizationId)??'unknown')} owner={owner} execute={execute}
    dispatchedApplications={dispatchedD3Applications}
    taskAttempts={attemptedD3Tasks}
    decisionAttempts={attemptedD3Decisions}
    run={act} busy={busy} invoke={invoke} managerOriginal={managerOriginal} organizationName={organization.name}
    onInspectAtlasResult={onInspectAtlasResult} onReuse={onReuse}
    atlasResultReturn={atlasResultReturn} onClearAtlasResultReturn={onClearAtlasResultReturn}
    assignmentDrafts={organization.assignments.filter(a=>
      a.workspaceId===owner.snapshot.workspaceId).map(a=>({
        id:a.id,title:a.title,assigneeId:a.assigneeId??null,reviewerId:a.reviewerId??null,
        workspaceId:a.workspaceId??'',status:a.status??'',
        editNumber:a.editNumber??0,description:a.description??'',
        criteria:a.criteria??'',dueDate:a.dueDate??'',
        atlasRef:a.atlasRef??null,sourceResultRef:a.sourceResultRef??null
      }))}/> : <>
  <div className="nested-form" data-testid="cen02-owner-people">
   <h3>Ответственные в организации</h3>
   <p className="muted">Выбор выполняется только из подтверждённого реестра T3. Черновики сотрудников и запланированные места Personal Agent не дают полномочий.</p>
   <div className="form-grid">
    <label>Сотрудник (владелец T3)
     <select data-testid="cen02-select-staff" value={owner?.snapshot?.selectedStaffId??''}
      disabled={!ready||busy||staff.length===0}
      onChange={e=>{const staffId=e.target.value;if(staffId)void act('Контекст сотрудника перечитан из T3.',async()=>{
       const changed=await execute('selectStaff',{staffId});
       if(changed.staffId!==staffId)throw Error('T3_STAFF_SELECTION_READBACK_HOLD');
      })}}>
      <option value="">Выберите подтверждённого сотрудника</option>
      {staff.map((p:any)=><option key={p.id} value={p.id}>{p.name||p.personId} · {p.workspaceId}</option>)}
     </select>
    </label>
    <label>Оператор решения (владелец T3)
     <select data-testid="cen02-select-operator" value={owner?.snapshot?.selectedOperatorId??''}
      disabled={!ready||busy||operators.length===0}
      onChange={e=>{const operatorId=e.target.value;if(operatorId)void act('Оператор перечитан из T3.',async()=>{
       const changed=await execute('selectOperator',{operatorId});
       if(changed.operatorId!==operatorId)throw Error('T3_OPERATOR_SELECTION_READBACK_HOLD');
      })}}>
      <option value="">Выберите подтверждённого оператора</option>
      {operators.map((p:any)=><option key={p.id} value={p.id}>{p.name||p.personId}</option>)}
     </select>
    </label>
   </div>
  </div>
  <div className="nested-form" data-testid="cen02-section">
   <h3>1. Выдать подписанное поручение</h3>
   <label>Черновик<select value={selected} onChange={e=>setSelected(e.target.value)} data-testid="corporate-assignment"><option value="">Выберите поручение</option>{organization.assignments.map(a=><option key={a.id} value={a.id}>{a.title}</option>)}</select></label>
   <div className="actions">
    <button className="secondary" onClick={onPrepare}>Подготовить поручение</button>
    <button className="primary" data-testid="corporate-issue" disabled={!ready||busy||!organization.assignments.some(a=>a.id===selected)}
     onClick={()=>act('Подписанная редакция создана владельцем. Доставка сотруднику не подтверждена.',async()=>{
       const out=await execute('issue',{assignmentId:selected});
       if(!out.taskId||!hex.test(out.taskRevisionId)||out.deliveryState!=='NOT_CONFIRMED')throw Error('T3_ISSUE_READBACK_REQUIRED');
     })}>Выдать через CEN02</button>
    <button className="secondary" data-testid="corporate-export" disabled={!ready||busy||!owner.snapshot?.task?.taskRevisionId}
     onClick={()=>act('Выдана копия подписанного carrier; доставка не подтверждена.',async()=>{
       const task=owner.snapshot.task;
       const result=await execute('exportIssuedTask',{taskId:task.id,taskRevisionId:task.taskRevisionId});
       if(!Array.isArray(result.bytes)||!result.bytes.length)throw Error('T3_SIGNED_TASK_CARRIER_REQUIRED');
       // WebView2 blob downloads are not the native product export path.
       // Save exactly the original T3 taskBytes() output through Windows
       // file dialog. A cancelled chooser never claims delivery or export.
       if(!invoke)throw Error('CEN_NATIVE_FILE_DIALOG_UNAVAILABLE');
       const saved=await invoke('center_save_iwxa_file',{bytes:result.bytes,taskRevisionId:task.taskRevisionId});
       if(saved!==true)return false;
     })}>Сохранить .iwxa</button>
   </div>
  </div>
  <div className="nested-form" data-testid="cen03-section">
   <h3>2. Result сотрудника и Review</h3>
   <p className="muted">Выберите файл результата через системный диалог Windows. Приёмка и проверка подписи выполняются отдельно.</p>
   <button className="secondary" data-testid="corporate-receive" disabled={!ready||busy}
    onClick={()=>act('Пакет получен. Корпоративное принятие ещё не выполнено.',async()=>{
      if(!invoke)throw Error('CEN_NATIVE_FILE_DIALOG_UNAVAILABLE');
      const bytes=await invoke('center_open_iwxa_file');
      if(bytes===null)return false;
      if(!Array.isArray(bytes)||bytes.length===0||bytes.length>32*1024*1024)
        throw Error('T3_PACKAGE_SIZE_UNSUPPORTED');
      const r=await execute('receive',{bytes});
      const sha=r.transportReceipt?.packageSha256;
      if(!hex.test(sha))throw Error('T3_RECEIPT_SHAPE_UNSUPPORTED');
      setHash(sha);resetReview();
    })}>Получить Result</button>
   <p className="muted" data-testid="corporate-inbox-summary">
    {inbox.status==='NOT_CONNECTED'?'Получение результатов недоступно до подключения организации.':
      inbox.status!=='OWNER_READBACK'?'Подтверждённый список Result владельца недоступен.':
      `Получено: ${inbox.items.length}. Ожидают Review: ${inbox.counts?.reviewRequired}.
      Проблемные квитанции: ${inbox.counts?.receiptConflict}.
      ACCEPT (не Apply): ${inbox.counts?.accepted}. REJECT: ${inbox.counts?.rejected}.`}
   </p>
   <label>Полученные результаты<select data-testid="corporate-package" value={hash} onChange={e=>{setHash(e.target.value);resetReview()}}>
    <option value="">Выберите пакет для Review</option>
    {inbox.items.map((item:{packageSha256:string;status:string;acceptanceId:string|null})=><option key={item.packageSha256} value={item.packageSha256}>
      {inboxLabels[item.status]??'Проверить'} · {item.packageSha256.slice(0,16)}…
    </option>)}
    {hash&&!inbox.items.some((item:{packageSha256:string;status:string;acceptanceId:string|null})=>item.packageSha256===hash)&&
      <option value={hash}>Недавно полученный пакет · {hash.slice(0,16)}…</option>}
   </select></label>
   <button className="secondary" data-testid="corporate-review" disabled={!ready||!hash||busy}
    onClick={()=>act('Проверка подписи, редакций и конфликтов выполнена владельцем.',async()=>{
     resetReview();const r=await execute('inspect',{packageSha256:hash});
     if(r.preview?.packageSha256!==hash)throw Error('T3_REVIEW_PACKAGE_CHANGED');
     setReview(r);
    })}>Review</button>
   {review&&<div data-testid="corporate-review-readback">
    <p>Подпись: {review.verificationState??'не подтверждена'} · тип: {review.preview?.classification??'неизвестен'}</p>
    <p>Task revision: {review.taskBinding?.proven?review.taskBinding.taskRevisionId:'не доказана'} · конфликт: {review.causalReview?.classification??'нет сведений'}</p>
    <p>Приёмка: {review.receipt?.acceptanceState??'ожидается'}. ACCEPT не означает Apply.</p>
    {review.receipt?.acceptanceState==='ACCEPTED'&&
      <p data-testid="corporate-apply-readiness">{acceptedSelection
        ? 'Принятая редакция подтверждена повторным Review. Применение требует отдельного решения.'
        : 'Решение ACCEPT существует, но актуальность редакции для применения не подтверждена.'}</p>}
    <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/> Я проверил пакет и подтверждаю решение</label>
    <label>Причина отказа (обязательна для REJECT)
      <textarea data-testid="corporate-reject-reason" rows={2} maxLength={1000} value={rejectReason}
        onChange={e=>setRejectReason(e.target.value)}/>
    </label>
    <div className="actions">
     <button className="primary" data-testid="corporate-accept" disabled={!ready||busy||!consent||!canDecideReviewedResult(review,hash,'ACCEPT')}
      onClick={()=>act('ACCEPT сохранён отдельно, применения ещё не было.',async()=>{
       const decision=await execute('decide',{packageSha256:hash,previewDigest:review.preview.previewDigest,decision:'ACCEPT'});
       if(decision.acceptanceState!=='ACCEPTED')throw Error('T3_ACCEPT_RECEIPT_NOT_CONFIRMED');
       resetReview();
       // Just as in the verified T3 reference UI: ACCEPT -> fresh owner
       // review. Only the new receipt and revision observation can permit Apply.
       const confirmed=await execute('inspect',{packageSha256:hash});
       if(confirmed.receipt?.acceptanceState!=='ACCEPTED'||
         confirmed.receipt?.packageSha256!==hash||
         confirmed.preview?.packageSha256!==hash)
         throw Error('T3_ACCEPT_READBACK_NOT_CONFIRMED');
       setReview(confirmed);
      })}>ACCEPT</button>
     <button className="secondary" data-testid="corporate-reject" disabled={!ready||busy||!consent||!rejectReason.trim()||rejectReason.length>1000||!canDecideReviewedResult(review,hash,'REJECT')}
      onClick={()=>act('REJECT сохранён отдельно.',async()=>{
       if(!rejectReason.trim())throw Error('RECONCILIATION_REJECTION_REASON_REQUIRED');
       const decision=await execute('decide',{packageSha256:hash,previewDigest:review.preview.previewDigest,decision:'REJECT',reason:rejectReason});
       if(decision.acceptanceState!=='REJECTED')throw Error('T3_REJECT_RECEIPT_NOT_CONFIRMED');
       resetReview();
       const confirmed=await execute('inspect',{packageSha256:hash});
       if(confirmed.receipt?.acceptanceState!=='REJECTED'||
         confirmed.receipt?.packageSha256!==hash)
         throw Error('T3_REJECT_READBACK_NOT_CONFIRMED');
       setReview(confirmed);
      })}>REJECT</button>
    </div>
   </div>}
  </div>
  <div className="nested-form" data-testid="cen03-apply">
   <h3>3. Отдельное применение</h3>
   <p>Текущее состояние Store/Journal: {owner?.snapshot?.application?.status??'нет сведений'}</p>
   <button className="secondary" data-testid="corporate-apply-preview" disabled={!canApply||busy} onClick={()=>act('Предварительный просмотр без записи.',async()=>{
     setPreview(null);setApplyConsent(false);setApplyDecided(false);
     const selected=acceptedApplicationSelection(review,hash);
     if(!selected)throw Error('T3_APPLICATION_SOURCE_NOT_CURRENT');
     const r=await execute('previewApplication',selected);
     if(r.status==='ALREADY_COMMITTED_NO_WRITE')return;
     if(!r.previewId||!r.previewDigest||
       r.acceptanceId!==selected.acceptanceId||
       !Array.isArray(r.revisionIds)||
       r.revisionIds.length!==selected.revisionIds.length||
       !selected.revisionIds.every((id:string)=>r.revisionIds.includes(id)))
       throw Error('T3_APPLICATION_PREVIEW_SOURCE_MISMATCH');
     setPreview(r);
   })}>Посмотреть применение</button>
   {preview&&<div>
    <p>Предварительный просмотр: {preview.previewId}. Запись ещё не выполнялась.</p>
    <label><input type="checkbox" checked={applyConsent} onChange={e=>{setApplyConsent(e.target.checked);setApplyDecided(false)}}/> Отдельно подтверждаю применение</label>
    <div className="actions">
     <button className="secondary" disabled={!ready||busy||!applyConsent} onClick={()=>act('Подтверждение применения записано отдельно.',async()=>{
       const r=await execute('decideApplication',{previewId:preview.previewId,previewDigest:preview.previewDigest});
       if(r.status!=='APPLICATION_DECISION_RECORDED')throw Error('T3_APPLICATION_DECISION_REQUIRED');
       setApplyDecided(true);
     })}>Подтвердить решение</button>
     <button className="primary" data-testid="corporate-apply-commit" disabled={!ready||busy||!applyDecided} onClick={()=>act('Состояние перечитано из Store/Journal.',async()=>{
       const p=preview;setPreview(null);setApplyConsent(false);setApplyDecided(false);
       try{
         const result=await execute('commitApplication',{previewId:p.previewId,
           previewDigest:p.previewDigest,acceptanceId:p.acceptanceId,
           revisionIds:p.revisionIds});
         if(result.verifiedReadback?.status!=='LOCAL_ENCRYPTED_STORE_CONFIRMED'||
           result.verifiedReadback?.effectKey!==result.effectKey)
           throw Error('T3_APPLICATION_POSTCOMMIT_READBACK_HOLD');
       }catch{throw Error('COMMIT_UNKNOWN: проверьте журнал и Store, не повторяйте запись вслепую.')}
     })}>Apply</button>
    </div>
   </div>}
  </div>
  <div className="nested-form" data-testid="cen03-reuse">
   <h3>4. Использовать применённый Result</h3>
   <p className="muted">Только из подтверждённого Store T3, после повторного чтения. Новое поручение требует отдельной выдачи и подписи.</p>
   <p data-testid="corporate-applied-status">{applied.status}</p>
   <label>Применённый Result<select value={reuseKey} data-testid="corporate-reuse-select" onChange={e=>{
     const key=e.target.value;setReuseKey(key);const r=records.find(x=>x.taskId+'|'+x.resultRevisionId===key);setReuseText(r?.result??'');
    }}><option value="">Выберите запись</option>
    {records.map(r=><option key={r.taskId+'|'+r.resultRevisionId} value={r.taskId+'|'+r.resultRevisionId}>{r.taskId} · {r.resultRevisionId.slice(0,12)}</option>)}
   </select></label>
   <label>Фрагмент для нового поручения<textarea rows={4} value={reuseText} maxLength={10000} data-testid="corporate-reuse-text" onChange={e=>setReuseText(e.target.value)}/></label>
   <p className="muted">{reuseText.length}/10000 символов; в описание помещается не более 6000.</p>
   <button className="secondary" data-testid="corporate-reuse" disabled={!ready||busy||!chosen||!reuseText.trim()||reuseText.length>6000}
    onClick={()=>{try{const r=prepareAppliedReuse(applied,{taskId:chosen.taskId,resultRevisionId:chosen.resultRevisionId,text:reuseText});onReuse({description:r.description,source:r.source})}
    catch(e){setError(why(e))}}}>Вставить в новый черновик</button>
  </div>
  </>}
 </section>;
}
