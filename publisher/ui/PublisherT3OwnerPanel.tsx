import React,{useEffect,useMemo,useState} from 'react';
import PublisherPersonOwnerPanel from './PublisherPersonOwnerPanel';
import {prepareTestLicenseRequest,encodeTestLicenseRequest,decodeTestLicenseRequest,inspectTestIssuerRequestScope,inspectTestIssuerRequestScopes} from '../src/test-license-request.mjs';

// This panel is intentionally only the front-end of the installed Tauri Host.
// The private, original T3 executable remains the sole signing authority. A
// public build without that privately assembled component is read-only.
type IssuerCapabilities={operation:'TEST_CAPABILITIES';issuers:string[];
 activeSeats:0;productionActivation:false;commercialAuthorityProven:false};
type License={licenseId:string;requestId:string;issuerAuthorityId:string;
 organizationId:string;productId:string;claimedSeats:number;status:string;sequence:number;activeSeats:0};
type AdminRequest={requestId:string;requestedAt:string;environment:'TEST';
 kind:'TEST_LICENSE_REQUEST';subject:{type:'ORGANIZATION';id:string;name:string};
 product:{id:'IWXA_ADMIN_CENTER';version:string};featureIds:string[];
 termDays:number;seats:number;status:'UNSIGNED_REQUEST'};
type Props={draft:any;invoke:(name:string,args?:Record<string,unknown>)=>Promise<any>;
 change:(command:Record<string,unknown>,message:string)=>Promise<{ok:boolean;message:string}>;
 personRequestId?:string;};
const error=(e:unknown)=>e instanceof Error?e.message:String(e);
export default function PublisherT3OwnerPanel({draft,invoke,change,personRequestId}:Props){
 const [issuerIds,setIssuerIds]=useState<string[]>([]);
 const [issuer,setIssuer]=useState('');
 const [licenses,setLicenses]=useState<License[]>([]);
 const [inventoryTotal,setInventoryTotal]=useState(0);
 const [inventoryTruncated,setInventoryTruncated]=useState(false);
 const [licenseId,setLicenseId]=useState('');
 const [adminRequest,setAdminRequest]=useState<AdminRequest|null>(null);
 const [proposalId,setProposalId]=useState('');
 const [seats,setSeats]=useState('');
 const [status,setStatus]=useState<''|'ACTIVE'|'SUSPENDED'|'REVOKED'>('');
 const [needsRefresh,setNeedsRefresh]=useState(false);
 const [revokePending,setRevokePending]=useState<{licenseId:string;organizationId:string}|null>(null);
 const [available,setAvailable]=useState(false);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [failure,setFailure]=useState('');
 const proposals=Array.isArray(draft?.proposals)?draft.proposals:[];
 const products=Array.isArray(draft?.products)?draft.products:[];
 const holders=Array.isArray(draft?.holders)?draft.holders:[];
 const readiness=useMemo(()=>inspectTestIssuerRequestScopes(draft) as {proposalId:string;supported:boolean}[],[draft]);
 const supportedIds=useMemo(()=>new Set(readiness.filter(p=>p.supported).map(p=>p.proposalId)),[readiness]);
 const eligible=proposals.filter((p:any)=>supportedIds.has(p.id));
 const unsupported=proposals.filter((p:any)=>!supportedIds.has(p.id));
 const personal=unsupported.filter((p:any)=>holders.some((h:any)=>h.id===p.holderId&&h.type==='PERSON'));
 const selectedLicense=licenses.find(x=>x.licenseId===licenseId);
 const revokeReady=Boolean(revokePending&&status==='REVOKED'&&
   selectedLicense&&selectedLicense.status!=='REVOKED'&&
   revokePending.licenseId===selectedLicense.licenseId&&
   revokePending.organizationId===selectedLicense.organizationId);
 const selectedProposal=eligible.find((p:any)=>p.id===proposalId);
 const alreadyIssued=selectedProposal?licenses.find(x=>x.requestId===selectedProposal.id):undefined;
 const adminAlreadyIssued=adminRequest?licenses.find(x=>x.requestId===adminRequest.requestId):undefined;
 const seatLimit=selectedProposal?.tariffSnapshot?.productSeats??10000;
 const seatCount=Number(seats);
 const seatsValid=Boolean(selectedProposal)&&/^[0-9]+$/.test(seats)&&
   Number.isSafeInteger(seatCount)&&seatCount>=1&&seatCount<=seatLimit;
 const proposalLabel=(p:any)=>{
   const product=products.find((v:any)=>v.id===p.productId);
   const holder=holders.find((v:any)=>v.id===p.holderId);
   return (product?.name??p.productId)+' · '+(holder?.name??p.holderId)+' · '+p.termDays+' дн.';
 };
 useEffect(()=>{
  if(!eligible.some((p:any)=>p.id===proposalId))
    setProposalId('');
 },[draft,proposalId]);
 type InventoryReadback={entries:License[];truncated:boolean};
 async function inventory():Promise<InventoryReadback>{
   const value=await invoke('publisher_t3_inventory');
   if(value?.operation!=='TEST_INVENTORY'||value.activeSeats!==0||
      value.productionActivation!==false||!Array.isArray(value.licenses))
      throw Error('PUBLISHER_T3_INVENTORY_INVALID');
   const entries=value.licenses as License[];
   const validId=(s:unknown)=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(s);
   if(entries.some(e=>!e||!validId(e.licenseId)||!validId(e.requestId)||
      !validId(e.issuerAuthorityId)||!validId(e.organizationId)||!validId(e.productId)||
      !['NOT_ACTIVATED','ACTIVE','SUSPENDED','REVOKED'].includes(e.status)||
      !Number.isSafeInteger(e.sequence)||e.sequence<0||
      !Number.isSafeInteger(e.claimedSeats)||e.claimedSeats<1||
      e.activeSeats!==0)||
      new Set(entries.map(e=>e.licenseId)).size!==entries.length)
      throw Error('PUBLISHER_T3_INVENTORY_ENTRY_INVALID');
   const truncated=value.truncated===true;
   setLicenses(entries);
   setInventoryTotal(Number.isSafeInteger(value.total)&&value.total>=entries.length?
     value.total:entries.length);
   setInventoryTruncated(truncated);
   setLicenseId(previous=>entries.some(x=>x.licenseId===previous)?previous:'');
   return {entries,truncated};
 }
 useEffect(()=>{
   let alive=true;
   (async()=>{
     try{
       const value=await invoke('publisher_t3_capabilities') as IssuerCapabilities;
       if(value?.operation!=='TEST_CAPABILITIES'||value.productionActivation!==false||
          value.activeSeats!==0||!Array.isArray(value.issuers))
         throw Error('PUBLISHER_T3_CAPABILITIES_INVALID');
       if(!alive)return;
       setIssuerIds(value.issuers);
       setIssuer('');
       setAvailable(value.issuers.length>0);
       if(value.issuers.length>0){
         try{await inventory();}
         catch(e){
           if(alive){
             // An enrolled issuer must not become "unavailable" merely
             // because its durable ledger could not be read at startup.
             setNeedsRefresh(true);
             setFailure('Журнал T3 недоступен при запуске. '+
               'Обновите журнал перед выдачей или изменением статуса. '+error(e));
           }
         }
       }
     }catch(e){
       if(alive){setAvailable(false);setMessage('Компонент T3 не включён в эту установку или издатель ещё не зарегистрирован.');}
     }finally{if(alive)setLoading(false);}
   })();
   return ()=>{alive=false;};
 },[]);
 async function refreshInventory(){
   if(busy||!available)return;
   setBusy(true);setFailure('');setMessage('');
   try{
     await inventory();setNeedsRefresh(false);
     setMessage('Журнал T3 обновлён. Подписи и права не изменены.');
   }catch(e){setFailure('Не удалось обновить журнал T3: '+error(e));}
   finally{setBusy(false);}
 }
 type ActionOutcome={message:string;confirm?:(readback:InventoryReadback)=>boolean;
  readbackMismatchMessage?:string};
 async function operation(action:()=>Promise<ActionOutcome>,mutatesLedger=false){
   if(busy||!available||needsRefresh)return;
   setBusy(true);setFailure('');setMessage('');
   try{
     const outcome=await action();
     // A committed owner action can outlive an interrupted inventory read.
     // Never show success before verifying the original T3 ledger.
     let readback:InventoryReadback;
     try{readback=await inventory();}
     catch(e){
       setNeedsRefresh(true);
       setFailure('Не удалось перечитать журнал T3. Операция могла выполниться: обновите журнал перед повтором. '+error(e));
       return;
     }
     if(outcome.confirm&&!outcome.confirm(readback)){
       setNeedsRefresh(true);
       setFailure(outcome.readbackMismatchMessage||
         'Запись T3 не совпала с результатом операции. Обновите журнал перед повтором.');
       return;
     }
     setMessage(outcome.message);
   }catch(e){
     if(mutatesLedger){
       // Original T3 can persist the signed change before the native IPC
       // reply is lost. A second click must never be an implicit retry.
       setNeedsRefresh(true);
       setFailure('Операция могла сохраниться в T3 без ответа. '+
         'Обновите журнал перед повтором. '+error(e));
     }else setFailure(error(e));
   }finally{setBusy(false);}
 }
 async function openAdminRequest(){
   if(busy||needsRefresh)return;
   setBusy(true);setMessage('');setFailure('');
   try{
     const content=await invoke('publisher_pick_unsigned_admin_request');
     if(content===null){setMessage('Выбор запроса отменён.');return;}
     // The original Publisher schema is parsed again in this UI; only the
     // separately enrolled T3 Owner can sign it after verifying issuer scope.
     const parsed=decodeTestLicenseRequest(content) as AdminRequest;
     setAdminRequest(parsed);
     setMessage('Неподписанный запрос Admin Center прочитан. Проверьте условия и выберите издателя.');
   }catch(e){
     setAdminRequest(null);setFailure('Запрос Admin Center не принят: '+error(e));
   }finally{setBusy(false);}
 }
 async function issueAdminRequest(){
   if(!available||!issuer||!adminRequest||adminAlreadyIssued||busy||needsRefresh)return;
   const request=adminRequest;
   await operation(async()=>{
     const result=await invoke('publisher_t3_issue',{
       requestJson:encodeTestLicenseRequest(request),issuerAuthorityId:issuer
     });
     if(result?.operation!=='TEST_ISSUE'||result.activeSeats!==0||
        result.productionActivation!==false||
        !['ISSUED_NEW','ALREADY_ISSUED'].includes(result.outcome)||
        typeof result.licenseId!=='string'||!result.licenseId||
        result.requestId!==request.requestId)
       throw Error('PUBLISHER_ADMIN_REQUEST_T3_ISSUE_INVALID');
     return {
       message:'Запрос Admin Center подписан исходным T3. Выберите запись ниже, установите статус и экспортируйте .iwxa.',
       readbackMismatchMessage:'Результат подписи не найден в журнале T3. Проверьте исходный журнал перед повтором.',
       confirm:({entries}:InventoryReadback)=>entries.some(x=>
         x.licenseId===result.licenseId&&x.requestId===request.requestId&&
         x.issuerAuthorityId===issuer&&x.organizationId===request.subject.id&&
         x.productId===request.product.id&&x.claimedSeats===request.seats)
     };
   },true);
 }
 async function applyStatus(){
   const target=licenseId,requested=status,previous=selectedLicense;
   if(!previous||!requested||busy||needsRefresh||
      previous.status===requested||previous.status==='REVOKED')return;
   if(requested==='REVOKED'&&!revokeReady)return;
   setRevokePending(null);
   await operation(async()=>{
     const receipt=await invoke('publisher_t3_change_status',{licenseId:target,nextStatus:requested});
     if(receipt?.operation!=='TEST_STATUS'||receipt.productionActivation!==false||
        receipt.activeSeats!==0||receipt.licenseId!==target||
        receipt.state!==requested||!Number.isSafeInteger(receipt.sequence)||
        receipt.sequence<=previous.sequence)
       throw Error('PUBLISHER_T3_STATUS_RECEIPT_INVALID');
     return {
       message:'Новый подписанный TEST-статус сохранён в T3: '+requested,
       confirm:({entries}:InventoryReadback)=>entries.some(x=>x.licenseId===target&&
         x.status===requested&&x.sequence===receipt.sequence)
     };
   },true);
 }
 return <><PublisherPersonOwnerPanel draft={draft} invoke={invoke} change={change}
   focusRequestId={personRequestId}/>
 <section className="publisher-test-owner" data-testid="publisher-t3-owner-panel">
   <h3>Выпуск лицензии через T3 Host</h3>
   <p className="muted">Только TEST. Команды выполняются в защищённом нативном компоненте T3,
     без передачи закрытых ключей в Publisher. Действительных коммерческих мест: 0.</p>
   {loading&&<p role="status">Проверяем подключение издателя…</p>}
   {!loading&&!available&&<p className="notice subdued" data-testid="publisher-t3-unavailable">
      {message||'Подтверждённый нативный издатель T3 недоступен.'}
      Выпуск и отзыв лицензий отключены.
   </p>}
   {personal.length>0&&<p className="notice subdued" data-testid="publisher-person-issuer-unavailable">Личные лицензии: подготовлено {personal.length}. TEST-контракт организаций не подписывает PERSON — это другой разрешённый маршрут того же T3. Выпуск и отзыв выполняются в разделе «Лицензии физических лиц» выше, только после регистрации издателя.</p>}
   {unsupported.length>personal.length&&<p className="muted" data-testid="publisher-other-issuer-unsupported">Неподдерживаемые или неполные TEST-запросы: {unsupported.length-personal.length}. Они не отправляются на подпись.</p>}
   {available&&<>
     <div className="form-grid">
       <label>Полномочие издателя
         <select value={issuer} onChange={e=>setIssuer(e.target.value)} disabled={busy}>
           <option value="">Выберите полномочие</option>{issuerIds.map(id=><option value={id} key={id}>{id}</option>)}
         </select>
       </label>
       <label>Подготовленный запрос
         <select value={proposalId} onChange={e=>{setProposalId(e.target.value);setSeats('');}} disabled={busy}>
           <option value="">Выберите запрос</option>{eligible.map((p:any)=><option value={p.id} key={p.id}>{proposalLabel(p)}</option>)}
         </select>
       </label>
       <label>Мест в TEST-запросе
         <input type="number" value={seats} min={1} max={seatLimit} step={1}
           placeholder="Укажите количество" onChange={e=>setSeats(e.target.value)}
           disabled={busy||!selectedProposal}/>
       </label>
     </div>
     {selectedProposal&&<div className="publisher-offer-review" data-testid="publisher-t3-issue-preview" role="status">
       <strong>Условия TEST-выпуска</strong>
       <p>Продукт: {selectedProposal.productId} · организация: {selectedProposal.holderId}</p>
       <p>Срок: {selectedProposal.termDays} дн. · функции: {selectedProposal.features.join(', ')||'не выбраны'}</p>
       <p>Укажите количество мест от 1 до {seatLimit}{selectedProposal.tariffSnapshot?' — предел сохранённой редакции тарифа':''}.
         {seatsValid?` Выбрано: ${seatCount}.`:seats?` Число мест (${seats}) вне допустимого диапазона 1–${seatLimit}.`:' Пока число мест не выбрано, выпуск недоступен.'}</p>
       {selectedProposal.tariffSnapshot&&<p className="muted">TEST-контракт T3 передаёт продукт, функции, срок и места. Лимиты сотрудников, устройств и ресурсов остаются в подготовке, но не подписываются этим контрактом.</p>}
     </div>}
     {alreadyIssued&&<p className="notice subdued" data-testid="publisher-t3-already-issued">
       Запрос уже подписан T3: {alreadyIssued.licenseId} (издатель {alreadyIssued.issuerAuthorityId}).
       Выберите запись ниже для экспорта в Admin Center или изменения её статуса.
     </p>}
     <div className="actions">
       <button className="secondary" type="button" disabled={busy||needsRefresh||!issuer||!proposalId||!supportedIds.has(proposalId)||!seatsValid||!!alreadyIssued}
         data-testid="publisher-t3-issue" onClick={()=>operation(async()=>{
           if(!issuer||!proposalId||alreadyIssued||!inspectTestIssuerRequestScope(draft,proposalId).supported)
             throw Error('PUBLISHER_T3_REQUEST_SCOPE_UNAVAILABLE');
           if(!seatsValid)throw Error('PUBLISHER_T3_EXPLICIT_SEATS_REQUIRED');
           const request=prepareTestLicenseRequest(draft,{proposalId,seats:seatCount});
           const result=await invoke('publisher_t3_issue',{
             requestJson:encodeTestLicenseRequest(request),issuerAuthorityId:issuer});
           if(result?.operation!=='TEST_ISSUE'||result.activeSeats!==0||
              result.productionActivation!==false||
              !['ISSUED_NEW','ALREADY_ISSUED'].includes(result.outcome)||
              typeof result.licenseId!=='string'||!result.licenseId||
              result.requestId!==request.requestId)
              throw Error('PUBLISHER_T3_ISSUE_RECEIPT_INVALID');
           // The original T3 CLI returns the most recent 48 records.
           // Truncation is not evidence that the receipt's exact record exists.
           return {
             message:result.outcome==='ALREADY_ISSUED'?
               'Ранее выпущенная TEST-лицензия найдена в журнале T3.':
               'TEST-лицензия подписана T3 и сохранена в журнале издателя.',
             readbackMismatchMessage:result.outcome==='ALREADY_ISSUED'?
               'T3 сообщил о ранее выпущенной TEST-лицензии, но её запись не видна в текущем журнале. '+
               'Показаны только последние записи: результат не подтверждён. '+
               'Проверьте полный журнал оригинального T3 перед повтором.':
               'T3 сообщил о новом TEST-выпуске, но запись не найдена при повторном чтении. '+
               'Результат не подтверждён. Проверьте оригинальный T3 перед повтором.',
             confirm:({entries}:InventoryReadback)=>entries.some(x=>
               x.licenseId===result.licenseId&&x.requestId===request.requestId&&
               x.issuerAuthorityId===issuer&&x.organizationId===request.subject.id&&
               x.productId===request.product.id&&x.claimedSeats===request.seats)
           };
         },true)}>{alreadyIssued?'Уже выпущена':'Выпустить TEST-лицензию'}</button>
     </div>
     {eligible.length===0&&<p className="muted" data-testid="publisher-no-supported-test-requests">Локальных подготовленных TEST-запросов нет. Вы можете открыть запрос из Admin Center выше.</p>}
     <div className="publisher-offer-review" data-testid="publisher-admin-request-handoff">
       <h4>Запрос из установленного Admin Center</h4>
       <p>Откройте переданный организацией неподписанный JSON. Не нужно создавать
         клиента, продукт и предложение повторно. Подписывает только исходный T3 Owner.</p>
       <button className="secondary" type="button" data-testid="publisher-open-admin-request"
         disabled={busy||needsRefresh} onClick={()=>void openAdminRequest()}>
         Открыть запрос Admin Center
       </button>
       {adminRequest&&<div data-testid="publisher-admin-request-review">
         <p>Организация: <strong>{adminRequest.subject.name}</strong> ({adminRequest.subject.id})</p>
         <p>Запрос: {adminRequest.requestId} · продукт {adminRequest.product.id} ·
           версия {adminRequest.product.version}</p>
         <p>Функции: {adminRequest.featureIds.join(', ')} · срок: {adminRequest.termDays} дней ·
           заявлено TEST-мест: {adminRequest.seats}</p>
         {adminAlreadyIssued&&<p data-testid="publisher-admin-request-already-issued">
           Запрос уже подписан T3: {adminAlreadyIssued.licenseId}.
         </p>}
         <button type="button" className="primary" data-testid="publisher-sign-admin-request"
           disabled={busy||needsRefresh||!issuer||!!adminAlreadyIssued}
           onClick={()=>void issueAdminRequest()}>
           {adminAlreadyIssued?'Уже выпущена':'Подписать запрос Admin Center в T3'}
         </button>
       </div>}
     </div>
     <h4>Подписанные TEST-лицензии T3</h4>
     <p className="muted" data-testid="publisher-t3-inventory-count">
       В реестре: {inventoryTotal} TEST-записей.
       {inventoryTruncated&&` Показаны последние ${licenses.length}.`}
     </p>
     <button type="button" className="secondary" data-testid="publisher-t3-refresh"
       disabled={busy} onClick={()=>void refreshInventory()}>Обновить журнал</button>
     {licenses.length===0?<p className="muted">{needsRefresh?
       'Журнал пока не прочитан.':'Пока нет выпущенных лицензий.'}</p>:
       <label>Лицензия
         <select value={licenseId} onChange={e=>{setLicenseId(e.target.value);setStatus('');setRevokePending(null);}} disabled={busy}>
           <option value="">Выберите лицензию</option>{licenses.map(x=><option value={x.licenseId} key={x.licenseId}>
             {x.licenseId} — {x.organizationId} — {x.status}
           </option>)}
         </select>
       </label>}
     <div className="actions">
       <select aria-label="Новый TEST-статус" value={status}
         onChange={e=>{setStatus(e.target.value as typeof status);setRevokePending(null);}}
         disabled={busy||needsRefresh||!selectedLicense||selectedLicense.status==='REVOKED'}>
         <option value="">Выберите новый статус</option>
         <option value="ACTIVE">ACTIVE</option>
         <option value="SUSPENDED">SUSPENDED</option>
         <option value="REVOKED">REVOKED</option>
       </select>
       <button className="secondary" type="button"
         disabled={busy||needsRefresh||!selectedLicense||!status||
           status===selectedLicense.status||selectedLicense.status==='REVOKED'}
         data-testid="publisher-t3-change-status" onClick={()=>{
           if(status==='REVOKED'&&selectedLicense)
             setRevokePending({licenseId:selectedLicense.licenseId,organizationId:selectedLicense.organizationId});
           else void applyStatus();
         }}>{status==='REVOKED'?'Подготовить отзыв':'Изменить статус'}</button>
       <button className="secondary" type="button" disabled={busy||needsRefresh||!licenseId}
         data-testid="publisher-t3-export" onClick={()=>operation(async()=>{
           const receipt=await invoke('publisher_t3_export',{licenseId});
           if(receipt===null)return {message:'Экспорт отменён.'};
           if(receipt?.operation!=='TEST_IWXA_EXPORTED'||receipt.productionActivation!==false||
              receipt.activeSeats!==0||receipt.licenseId!==licenseId||
              !Number.isSafeInteger(receipt.bytes)||receipt.bytes<1||
              typeof receipt.packageSha256!=='string'||
              !/^[a-f0-9]{64}$/.test(receipt.packageSha256))
             throw Error('PUBLISHER_T3_EXPORT_RECEIPT_INVALID');
           return {message:'Пакет .iwxa выпущен T3 и подтверждён повторным чтением.'};
         })}>Экспортировать подписанный .iwxa</button>
     </div>
     {revokeReady&&<div className="notice" data-testid="publisher-t3-revoke-confirmation" role="alert">
       <p>Отозвать TEST-лицензию {selectedLicense?.licenseId} для организации {selectedLicense?.organizationId}?
          Это действие окончательное: повторная активация будет недоступна.</p>
       <div className="actions">
         <button className="primary" type="button" disabled={busy||needsRefresh}
           onClick={()=>void applyStatus()}>Подтвердить отзыв</button>
         <button className="secondary" type="button" disabled={busy}
           onClick={()=>{setRevokePending(null);setStatus('');}}>Отмена</button>
       </div>
     </div>}
   </>}
   {selectedLicense?.status==='REVOKED'&&<p className="muted" role="status">Эта TEST-лицензия отозвана. Повторная активация запрещена. Подписанный отзыв можно экспортировать.</p>}
   {failure&&<p role="alert">{failure}</p>}
   {available&&message&&<p role="status">{message}</p>}
   <p className="muted">TEST-подпись не является коммерческим полномочием. Активных мест: 0.</p>
 </section></>;
}
