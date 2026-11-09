import React,{useEffect,useMemo,useState} from 'react';
import {prepareTestLicenseRequest,encodeTestLicenseRequest,inspectTestIssuerRequestScope,inspectTestIssuerRequestScopes} from '../src/test-license-request.mjs';

// This panel is intentionally only the front-end of the installed Tauri Host.
// The private, original T3 executable remains the sole signing authority. A
// public build without that privately assembled component is read-only.
type IssuerCapabilities={operation:'TEST_CAPABILITIES';issuers:string[];
 activeSeats:0;productionActivation:false;commercialAuthorityProven:false};
type License={licenseId:string;requestId:string;issuerAuthorityId:string;
 organizationId:string;claimedSeats:number;status:string;sequence:number;activeSeats:0};
type Props={draft:any;invoke:(name:string,args?:Record<string,unknown>)=>Promise<any>};
const error=(e:unknown)=>e instanceof Error?e.message:String(e);
export default function PublisherT3OwnerPanel({draft,invoke}:Props){
 const [issuerIds,setIssuerIds]=useState<string[]>([]);
 const [issuer,setIssuer]=useState('');
 const [licenses,setLicenses]=useState<License[]>([]);
 const [inventoryTotal,setInventoryTotal]=useState(0);
 const [inventoryTruncated,setInventoryTruncated]=useState(false);
 const [licenseId,setLicenseId]=useState('');
 const [proposalId,setProposalId]=useState('');
 const [seats,setSeats]=useState('1');
 const [status,setStatus]=useState<'ACTIVE'|'SUSPENDED'|'REVOKED'>('ACTIVE');
 const [available,setAvailable]=useState(false);
 const [loading,setLoading]=useState(true);
 const [busy,setBusy]=useState(false);
 const [message,setMessage]=useState('');
 const [failure,setFailure]=useState('');
 const proposals=Array.isArray(draft?.proposals)?draft.proposals:[];
 const products=Array.isArray(draft?.products)?draft.products:[];
 const holders=Array.isArray(draft?.holders)?draft.holders:[];
 const readiness=useMemo(()=>inspectTestIssuerRequestScopes(draft),[draft]);
 const supportedIds=useMemo(()=>new Set(readiness.filter(p=>p.supported).map(p=>p.proposalId)),[readiness]);
 const eligible=proposals.filter((p:any)=>supportedIds.has(p.id));
 const unsupported=proposals.filter((p:any)=>!supportedIds.has(p.id));
 const personal=unsupported.filter((p:any)=>holders.some((h:any)=>h.id===p.holderId&&h.type==='PERSON'));
 const proposalLabel=(p:any)=>{
   const product=products.find((v:any)=>v.id===p.productId);
   const holder=holders.find((v:any)=>v.id===p.holderId);
   return (product?.name??p.productId)+' · '+(holder?.name??p.holderId)+' · '+p.termDays+' дн.';
 };
 useEffect(()=>{
  if(!eligible.some((p:any)=>p.id===proposalId))
    setProposalId(String(eligible[0]?.id??''));
 },[draft,proposalId]);
 async function inventory(){
   const value=await invoke('publisher_t3_inventory');
   if(value?.operation!=='TEST_INVENTORY'||value.activeSeats!==0||
      value.productionActivation!==false||!Array.isArray(value.licenses))
      throw Error('PUBLISHER_T3_INVENTORY_INVALID');
   const entries=value.licenses as License[];
   setLicenses(entries);
   setInventoryTotal(Number.isSafeInteger(value.total)&&value.total>=entries.length?
     value.total:entries.length);
   setInventoryTruncated(value.truncated===true);
   setLicenseId(previous=>entries.some(x=>x.licenseId===previous)?previous:
       entries.at(-1)?.licenseId??'');
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
       setIssuer(value.issuers[0]??'');
       setAvailable(value.issuers.length>0);
       await inventory();
     }catch(e){
       if(alive){setAvailable(false);setMessage('Компонент T3 не включён в эту установку или издатель ещё не зарегистрирован.');}
     }finally{if(alive)setLoading(false);}
   })();
   return ()=>{alive=false;};
 },[]);
 async function operation(action:()=>Promise<string>){
   if(busy||!available)return;
   setBusy(true);setFailure('');setMessage('');
   try{setMessage(await action());await inventory();}
   catch(e){setFailure(error(e));}
   finally{setBusy(false);}
 }
 return <section className="publisher-test-owner" data-testid="publisher-t3-owner-panel">
   <h3>Выпуск лицензии через T3 Host</h3>
   <p className="muted">Только TEST. Команды выполняются в защищённом нативном компоненте T3,
     без передачи закрытых ключей в Publisher. Действительных коммерческих мест: 0.</p>
   {loading&&<p role="status">Проверяем подключение издателя…</p>}
   {!loading&&!available&&<p className="notice subdued" data-testid="publisher-t3-unavailable">
      {message||'Подтверждённый нативный издатель T3 недоступен.'}
      Выпуск и отзыв лицензий отключены.
   </p>}
   {personal.length>0&&<p className="notice subdued" data-testid="publisher-person-issuer-unavailable">Личные лицензии: подготовлено {personal.length}. Действующий T3 TEST-контракт не поддерживает персональные лицензии. Условия сохранены, выпуск и отзыв недоступны до подключения подписанного контракта.</p>}
   {unsupported.length>personal.length&&<p className="muted" data-testid="publisher-other-issuer-unsupported">Неподдерживаемые или неполные TEST-запросы: {unsupported.length-personal.length}. Они не отправляются на подпись.</p>}
   {available&&<>
     <div className="form-grid">
       <label>Полномочие издателя
         <select value={issuer} onChange={e=>setIssuer(e.target.value)} disabled={busy}>
           {issuerIds.map(id=><option value={id} key={id}>{id}</option>)}
         </select>
       </label>
       <label>Подготовленный запрос
         <select value={proposalId} onChange={e=>setProposalId(e.target.value)} disabled={busy}>
           {eligible.map((p:any)=><option value={p.id} key={p.id}>{proposalLabel(p)}</option>)}
         </select>
       </label>
       <label>Мест в TEST-запросе
         <input type="number" value={seats} min={1} max={10000} onChange={e=>setSeats(e.target.value)} disabled={busy}/>
       </label>
     </div>
     <div className="actions">
       <button className="secondary" type="button" disabled={busy||!issuer||!proposalId||!supportedIds.has(proposalId)}
         data-testid="publisher-t3-issue" onClick={()=>operation(async()=>{
           if(!inspectTestIssuerRequestScope(draft,proposalId).supported)throw Error('PUBLISHER_T3_REQUEST_SCOPE_UNAVAILABLE');
           const request=prepareTestLicenseRequest(draft,{proposalId,seats:Number(seats)});
           const result=await invoke('publisher_t3_issue',{
             requestJson:encodeTestLicenseRequest(request),issuerAuthorityId:issuer});
           if(result?.operation!=='TEST_ISSUE'||result.activeSeats!==0||
              result.productionActivation!==false||typeof result.licenseId!=='string')
              throw Error('PUBLISHER_T3_ISSUE_RECEIPT_INVALID');
           setLicenseId(result.licenseId);
           return result.outcome==='ALREADY_ISSUED'?
             'Ранее выпущенная TEST-лицензия найдена в журнале T3.':
             'TEST-лицензия подписана T3 и сохранена в журнале издателя.';
         })}>Выпустить TEST-лицензию</button>
     </div>
     {eligible.length===0&&<p className="muted" data-testid="publisher-no-supported-test-requests">Подходящих организационных TEST-запросов нет. Личные запросы нельзя подписывать этим компонентом.</p>}
     <h4>Подписанные TEST-лицензии T3</h4>
     <p className="muted" data-testid="publisher-t3-inventory-count">
       В реестре: {inventoryTotal} TEST-записей.
       {inventoryTruncated&&` Показаны последние ${licenses.length}.`}
     </p>
     {licenses.length===0?<p className="muted">Пока нет выпущенных лицензий.</p>:
       <label>Лицензия
         <select value={licenseId} onChange={e=>setLicenseId(e.target.value)} disabled={busy}>
           {licenses.map(x=><option value={x.licenseId} key={x.licenseId}>
             {x.licenseId} — {x.organizationId} — {x.status}
           </option>)}
         </select>
       </label>}
     <div className="actions">
       <select aria-label="Новый TEST-статус" value={status}
         onChange={e=>setStatus(e.target.value as typeof status)} disabled={busy||!licenseId}>
         <option value="ACTIVE">ACTIVE</option>
         <option value="SUSPENDED">SUSPENDED</option>
         <option value="REVOKED">REVOKED</option>
       </select>
       <button className="secondary" type="button" disabled={busy||!licenseId}
         data-testid="publisher-t3-change-status" onClick={()=>operation(async()=>{
           const receipt=await invoke('publisher_t3_change_status',{licenseId,nextStatus:status});
           if(receipt?.operation!=='TEST_STATUS'||receipt.productionActivation!==false)
             throw Error('PUBLISHER_T3_STATUS_RECEIPT_INVALID');
           return 'Новый подписанный TEST-статус сохранён в T3: '+status;
         })}>Изменить статус</button>
       <button className="secondary" type="button" disabled={busy||!licenseId}
         data-testid="publisher-t3-export" onClick={()=>operation(async()=>{
           const receipt=await invoke('publisher_t3_export',{licenseId});
           if(receipt===null)return 'Экспорт отменён.';
           if(receipt?.operation!=='TEST_IWXA_EXPORTED'||receipt.productionActivation!==false)
             throw Error('PUBLISHER_T3_EXPORT_RECEIPT_INVALID');
           return 'Пакет .iwxa выпущен T3 и подтверждён повторным чтением.';
         })}>Экспортировать подписанный .iwxa</button>
     </div>
   </>}
   {failure&&<p role="alert">{failure}</p>}
   {available&&message&&<p role="status">{message}</p>}
   <p className="muted">TEST-подпись не является коммерческим полномочием. Активных мест: 0.</p>
 </section>;
}
