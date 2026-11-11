import React,{useEffect,useMemo,useState} from 'react';
import {prepareUnsignedPersonLicenseRequest,preparePersonRenewalDraftCommand,
  validatePersonRenewalSource} from '../src/person-license-request.mjs';

type NativeInvoke=(name:string,args?:Record<string,unknown>)=>Promise<any>;
type PersonRecord={
  licenseId:string;requestId:string;issuerAuthorityId:string;
  personId:string;productId:string;deviceLimit:number;quotaCount:number;
  issuedAt:string;notBefore:string;expiresAt:string;
  statusIssuedAt?:string;statusValidUntil?:string;
  renewalOfLicenseId?:string;
  status:'NOT_ACTIVATED'|'ACTIVE'|'SUSPENDED'|'REVOKED';
  sequence:number;activeSeats:0
};
type Inventory={entries:PersonRecord[];truncated:boolean;total:number;matches?:number};
type Props={draft:any;invoke:NativeInvoke;
 change:(command:Record<string,unknown>,message:string)=>Promise<{ok:boolean;message:string}>};
const err=(e:unknown)=>e instanceof Error?e.message:String(e);
const id=(v:unknown)=>typeof v==='string'&&
  /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(v);
const digest=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const instant=(v:unknown)=>typeof v==='string'&&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(v)&&
  Number.isFinite(Date.parse(v));
const localTime=(v:string)=>new Date(v).toLocaleString('ru-RU',{hour12:false});
const MAX_STATUS_REFRESH_LEAD_MS=6*60*60*1000;
const personStatusAllowed=(license:PersonRecord|undefined,requested:string)=>{
  if(!license||!requested||license.status==='REVOKED'||
     Date.parse(license.expiresAt)<=Date.now())return false;
  if(license.status!==requested)return true;
  // Same-state signing is useful near signed status expiry. The original T3
  // creates the next monotonic sequence; Publisher never fabricates status.
  if(!license.statusIssuedAt||!license.statusValidUntil)return false;
  const duration=Date.parse(license.statusValidUntil)-
    Date.parse(license.statusIssuedAt);
  const lead=Math.min(MAX_STATUS_REFRESH_LEAD_MS,Math.floor(duration/4));
  return duration>0&&Date.parse(license.statusValidUntil)<=Date.now()+lead;
};
const shortLicenseId=(value:string)=>value.length>30?
  value.slice(0,12)+'…'+value.slice(-12):value;
export default function PublisherPersonOwnerPanel({draft,invoke,change}:Props){
  const [issuers,setIssuers]=useState<string[]>([]);
  const [issuer,setIssuer]=useState('');
  const [available,setAvailable]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [needsRefresh,setNeedsRefresh]=useState(false);
  const [licenses,setLicenses]=useState<PersonRecord[]>([]);
  const [total,setTotal]=useState(0);
  const [truncated,setTruncated]=useState(false);
  const [lookupText,setLookupText]=useState('');
  const [lookupTarget,setLookupTarget]=useState('');
  const [lookupMatches,setLookupMatches]=useState<number|null>(null);
  const [proposalId,setProposalId]=useState('');
  const [licenseId,setLicenseId]=useState('');
   const [ageRecipients,setAgeRecipients]=useState('');
  const [status,setStatus]=useState<''|'ACTIVE'|'SUSPENDED'|'REVOKED'>('');
  const [termsConfirmed,setTermsConfirmed]=useState(false);
  const [revokePending,setRevokePending]=useState('');
  const [renewalTariff,setRenewalTariff]=useState('');
  const [message,setMessage]=useState('');
  const [failure,setFailure]=useState('');
  const options=useMemo(()=>{
    const proposals=Array.isArray(draft?.proposals)?draft.proposals:[];
    return proposals.flatMap((proposal:any)=>{
      try{
        const request=prepareUnsignedPersonLicenseRequest(draft,{proposalId:proposal.id});
        const product=draft.products?.find((p:any)=>p.id===request.product.id);
        const holder=draft.holders?.find((h:any)=>h.id===request.subject.id);
        return [{proposalId:proposal.id,request,
          label:(product?.name??request.product.id)+' / '+
            (holder?.name??request.subject.id)+' / '+request.termDays+' дн.'}];
      }catch{return [];}
    }) as {proposalId:string;request:any;label:string}[];
  },[draft]);
  const selected=options.find(o=>o.proposalId===proposalId);
  // Original T3 idempotently owns the signed issuance. Once the journal
  // confirms this request, the UI must not invite a redundant signature.
  const issuedSelected=selected?licenses.find(l=>
    l.requestId===selected.request.requestId):undefined;
  const selectedLicense=licenses.find(l=>l.licenseId===licenseId);
  const renewalOptions=(Array.isArray(draft?.tariffs)?draft.tariffs:[])
    .filter((t:any)=>t.productId===selectedLicense?.productId&&t.holderType==='PERSON');
  const selectedRenewal=renewalOptions.find((t:any)=>
    t.id+'#'+t.revision===renewalTariff);
  const canRevoke=Boolean(revokePending&&revokePending===licenseId&&
    status==='REVOKED'&&selectedLicense?.status!=='REVOKED');
  useEffect(()=>{
    if(!options.some(o=>o.proposalId===proposalId)){
      setProposalId('');setTermsConfirmed(false);
    }
  },[options,proposalId]);
  function checkedInventory(value:any,lookupId?:string):PersonRecord[]{
    if(value?.operation!=='PERSON_INVENTORY'||value.activeSeats!==0||
       value.productionActivation!==false||!Array.isArray(value.licenses))
      throw Error('PERSON_NATIVE_INVENTORY_INVALID');
    const entries=value.licenses as PersonRecord[];
    if(entries.length>48||entries.some(x=>!x||!id(x.licenseId)||
       !id(x.requestId)||!id(x.issuerAuthorityId)||!id(x.personId)||
       !['IWXA_ATLAS','IWXA_PERSONAL_AGENT'].includes(x.productId)||
       !['NOT_ACTIVATED','ACTIVE','SUSPENDED','REVOKED'].includes(x.status)||
       !Number.isSafeInteger(x.deviceLimit)||x.deviceLimit<1||
       !Number.isSafeInteger(x.quotaCount)||x.quotaCount<0||
       !Number.isSafeInteger(x.sequence)||x.sequence<0||x.activeSeats!==0||
       !instant(x.issuedAt)||!instant(x.notBefore)||!instant(x.expiresAt)||
       Date.parse(x.issuedAt)>Date.parse(x.notBefore)||
       Date.parse(x.notBefore)>=Date.parse(x.expiresAt)||
       (x.status==='NOT_ACTIVATED'?
         x.statusValidUntil!==undefined||x.statusIssuedAt!==undefined:
         !instant(x.statusValidUntil)||!instant(x.statusIssuedAt))||
       (x.statusValidUntil!==undefined&&
         (Date.parse(x.statusValidUntil)>Date.parse(x.expiresAt)||
          Date.parse(x.statusIssuedAt!)>=Date.parse(x.statusValidUntil)))||
       (x.renewalOfLicenseId!==undefined&&
         (!id(x.renewalOfLicenseId)||x.renewalOfLicenseId===x.licenseId)))||
       new Set(entries.map(e=>e.licenseId)).size!==entries.length)
      throw Error('PERSON_NATIVE_INVENTORY_ENTRY_INVALID');
    if(lookupId!==undefined&&
       (value.lookupId!==lookupId||!Number.isSafeInteger(value.matches)||
        value.matches<entries.length||entries.some(x=>x.licenseId!==lookupId&&
          x.requestId!==lookupId&&x.personId!==lookupId)))
      throw Error('PERSON_NATIVE_INVENTORY_LOOKUP_INVALID');
    return entries;
  }
  async function inventory(search=lookupTarget):Promise<Inventory>{
    const recent=await invoke('publisher_t3_person_inventory');
    const latest=checkedInventory(recent);
    let entries=latest, matches: number|undefined;
    if(search){
      const response=await invoke('publisher_t3_person_inventory',{lookupId:search});
      const found=checkedInventory(response,search);
      matches=response.matches;
      // Preserve the recent ledger and expose older matching records in the
      // same native selector. A search never manufactures license records.
      const byId=new Map(latest.map(x=>[x.licenseId,x] as const));
      for(const record of found)byId.set(record.licenseId,record);
      entries=[...byId.values()];
    }
    const count=Number.isSafeInteger(recent.total)&&recent.total>=latest.length?
      recent.total:latest.length;
    setLicenses(entries);setTotal(count);
    setTruncated(recent.truncated===true);
    setLookupMatches(matches??null);
    setLicenseId(old=>entries.some(e=>e.licenseId===old)?old:'');
    return {entries,truncated:recent.truncated===true,total:count,matches};
  }
  useEffect(()=>{
    let alive=true;
    (async()=>{
      try{
        const info=await invoke('publisher_t3_person_capabilities');
        if(info?.operation!=='PERSON_CAPABILITIES'||info.environment!=='PRODUCTION'||
           info.productionActivation!==false||info.activeSeats!==0||
           !Array.isArray(info.issuers)||!info.issuers.every(id))
          throw Error('PERSON_NATIVE_ISSUER_NOT_ENROLLED');
        if(!alive)return;
        setIssuers(info.issuers);setAvailable(info.issuers.length>0);
        if(info.issuers.length>0){
          try{await inventory();}
          catch(e){
            if(alive){
              // A readable issuer and an unreadable ledger are different states:
              // keep Refresh available but do not allow any signed mutation.
              setNeedsRefresh(true);
              setFailure('Журнал персональных лицензий T3 недоступен при запуске. '+
                'Обновите журнал перед выдачей или изменением статуса. '+err(e));
            }
          }
        }
      }catch{
        if(alive)setAvailable(false);
      }finally{if(alive)setLoading(false);}
    })();
    return()=>{alive=false;};
  },[]);
  async function refresh(search=lookupTarget){
    if(!available||busy)return;
    setBusy(true);setFailure('');setMessage('');
    try{await inventory(search);setNeedsRefresh(false);
      setMessage('Журнал персональных лицензий обновлён.');}
    catch(e){setNeedsRefresh(true);
      setFailure('Не удалось прочитать журнал T3: '+err(e));}
    finally{setBusy(false);}
  }
  async function findLicense(){
    if(!available||busy)return;
    const search=lookupText.trim();
    if(!id(search)){setFailure('Введите корректный ID лицензии, запроса или получателя.');return;}
    setBusy(true);setFailure('');setMessage('');
    try{
      const result=await inventory(search);
      setLookupTarget(search);setNeedsRefresh(false);
      const found=result.entries.filter(x=>x.licenseId===search||
        x.requestId===search||x.personId===search);
      if(found.length){
        setLicenseId(found[0].licenseId);setStatus('');setRevokePending('');
      }
      setMessage(result.matches?
        'Поиск в исходном T3: найдено записей '+result.matches+'.':
        'В исходном T3 нет лицензии с таким идентификатором.');
    }catch(e){setNeedsRefresh(true);
      setFailure('Поиск в журнале T3 не выполнен: '+err(e));}
    finally{setBusy(false);}
  }
  async function operate(action:()=>Promise<{
    message:string;confirm?:(value:Inventory)=>boolean;readbackLookupId?:string
  }>,mutatesLedger=false){
    if(busy||!available||needsRefresh)return;
    setBusy(true);setFailure('');setMessage('');
    try{
      const result=await action();
      let readback:Inventory;
      const query=result.readbackLookupId??lookupTarget;
      try{readback=await inventory(query);}
      catch(e){setNeedsRefresh(true);
        setFailure('Операция могла сохраниться, но журнал T3 не перечитан. '+
          'Обновите журнал перед повтором. '+err(e));return;}
      if(result.confirm&&!result.confirm(readback)){
        setNeedsRefresh(true);
        setFailure('Подписанная запись не подтверждена повторным чтением T3. '+
          'Обновите журнал перед повтором.');
        return;
      }
      if(result.readbackLookupId){
        setLookupTarget(result.readbackLookupId);
        setLookupText(result.readbackLookupId);
      }
      setMessage(result.message);
    }catch(e){
      // The native T3 process may have committed a signed mutation before
      // losing its IPC response. Never allow a second issue/status change
      // until an independently read owner ledger settles the ambiguity.
      if(mutatesLedger){
        setNeedsRefresh(true);
        setFailure('Операция могла сохраниться в T3, но результат не подтверждён. '+
          'Обновите журнал перед повтором. '+err(e));
      }else setFailure(err(e));
    }finally{setBusy(false);}
  }
  async function issue(){
    if(!issuer||!selected||!termsConfirmed||issuedSelected||busy||needsRefresh)return;
    const request=prepareUnsignedPersonLicenseRequest(draft,{proposalId:selected.proposalId});
    const authority=issuer;
    const source=draft.proposals?.find((p:any)=>p.id===selected.proposalId);
    if(source?.previousProposalId){
      try{
        const prior=licenses.find(l=>l.requestId===source.previousProposalId);
        const verified=validatePersonRenewalSource(draft,{
          sourceLicense:prior,issuerAuthorityId:authority});
        if(verified.personId!==request.subject.id||
           verified.productId!==request.product.id)
          throw Error('PERSON_RENEWAL_REQUEST_SCOPE_MISMATCH');
      }catch(e){
        setFailure('Продление не подтверждено журналом T3: '+err(e));
        return;
      }
    }
    await operate(async()=>{
      // The 48-record recent view is not proof that an older request is new.
      // Query the original T3 ledger BEFORE inviting a second signature.
      const before=await invoke('publisher_t3_person_inventory',{
        lookupId:request.requestId});
      const prior=checkedInventory(before,request.requestId)
        .find(x=>x.requestId===request.requestId);
      if(prior)return {
        message:'Эта подготовка уже подписана исходным T3. '+
          'Выберите найденную лицензию для статуса, продления или экспорта.',
        readbackLookupId:request.requestId,
        confirm:({entries}:Inventory)=>entries.some(x=>
          x.licenseId===prior.licenseId&&x.requestId===request.requestId)
      };
      const result=await invoke('publisher_t3_person_issue',{
        requestJson:JSON.stringify(request),issuerAuthorityId:authority});
      if(result?.operation!=='PERSON_ISSUE'||result.productionActivation!==false||
         result.activeSeats!==0||!['ISSUED_NEW','ALREADY_ISSUED'].includes(result.outcome)||
         !id(result.licenseId)||result.requestId!==request.requestId)
        throw Error('PERSON_NATIVE_ISSUE_RECEIPT_INVALID');
      return {
        message:'Подписанная лицензия сохранена в журнале издателя. '+
          'Для применения прав её необходимо импортировать в установленную программу.',
        readbackLookupId:request.requestId,
        confirm:({entries}:Inventory)=>entries.some(x=>x.licenseId===result.licenseId&&
          x.requestId===request.requestId&&x.issuerAuthorityId===authority&&
          x.personId===request.subject.id&&x.productId===request.product.id&&
          x.deviceLimit===request.deviceLimit&&x.quotaCount===request.quotas.length)
      };
    },true);
  }
  async function prepareRenewal(){
    if(!selectedLicense||!selectedRenewal||busy||needsRefresh)return;
    let command;
    try{
      command=preparePersonRenewalDraftCommand(draft,{
        sourceLicense:selectedLicense,
        issuerAuthorityId:selectedLicense.issuerAuthorityId,
        tariffId:selectedRenewal.id,revision:selectedRenewal.revision,
        issuedRecords:licenses
      });
    }catch(e){setFailure('Подготовка продления отклонена: '+err(e));return;}
    setBusy(true);setFailure('');setMessage('');
    try{
      const result=await change(command,
        'Подготовка продления сохранена. Прежняя лицензия не изменена.');
      if(!result.ok)throw Error(result.message);
      setRenewalTariff('');
      setMessage('Подготовка продления сохранена. Выберите её в списке выше, '+
        'проверьте условия и отдельно подпишите через T3.');
    }catch(e){setFailure('Продление не подготовлено: '+err(e));}
    finally{setBusy(false);}
  }
  async function changeStatus(){
    const current=selectedLicense,requested=status;
    if(!current||!personStatusAllowed(current,requested)||busy||needsRefresh||
       (requested==='REVOKED'&&!canRevoke))return;
    setRevokePending('');
    await operate(async()=>{
      const value=await invoke('publisher_t3_person_change_status',{
        licenseId:current.licenseId,nextStatus:requested});
      if(value?.operation!=='PERSON_STATUS'||value.productionActivation!==false||
         value.activeSeats!==0||value.licenseId!==current.licenseId||
         value.state!==requested||!Number.isSafeInteger(value.sequence)||
         value.sequence<=current.sequence)
        throw Error('PERSON_NATIVE_STATUS_RECEIPT_INVALID');
      return {
        message:requested==='REVOKED'?
          'Подписанный отзыв сохранён. Передайте новый .iwxa получателю.':
          'Подписанный статус сохранён. Передайте новый .iwxa получателю.',
        readbackLookupId:current.licenseId,
        confirm:({entries}:Inventory)=>entries.some(x=>
          x.licenseId===current.licenseId&&x.status===requested&&
          x.sequence===value.sequence)
      };
    },true);
  }
  async function exportPublicTrust(){
    if(!available||busy||needsRefresh)return;
    await operate(async()=>{
      const receipt=await invoke('publisher_t3_person_export_public_trust');
      if(receipt===null)return {message:'Экспорт доверия отменён.'};
      if(receipt?.operation!=='PERSON_TRUST_EXPORTED'||
         receipt.publicOnly!==true||receipt.activeSeats!==0||
         receipt.productionActivation!==false||
         !Number.isSafeInteger(receipt.bytes)||receipt.bytes<10||
         !digest(receipt.sha256)||!Number.isSafeInteger(receipt.keyCount)||
         receipt.keyCount<1||!Number.isSafeInteger(receipt.issuerCount)||
         receipt.issuerCount<1)
        throw Error('PERSON_PUBLIC_TRUST_NATIVE_RECEIPT_INVALID');
      return {message:'Публичное доверие издателя экспортировано и проверено по SHA-256. '+
        'Его устанавливают отдельно через официальный IWXA Setup Core, не из лицензии .iwxa.'};
    });
  }
  async function exportIwxa(){
    const current=selectedLicense;
    if(!current||current.status==='NOT_ACTIVATED'||busy||needsRefresh)return;
    await operate(async()=>{
      const value=await invoke('publisher_t3_person_export',{
        licenseId:current.licenseId});
      if(value===null)return {message:'Экспорт отменён.'};
      if(value?.operation!=='PERSON_IWXA_EXPORTED'||value.activeSeats!==0||
         value.productionActivation!==false||value.licenseId!==current.licenseId||
         !Number.isSafeInteger(value.bytes)||value.bytes<1||!digest(value.packageSha256))
        throw Error('PERSON_NATIVE_EXPORT_RECEIPT_INVALID');
      return {message:'Подписанный пакет .iwxa сохранён и повторно проверен по SHA-256.'};
    });
  }
  async function exportProtectedIwxa(){
    const current=selectedLicense;
    if(!current||current.status==='NOT_ACTIVATED'||busy||needsRefresh||!ageRecipients.trim())return;
    await operate(async()=>{
      const receipt=await invoke('publisher_t3_person_export_age',{
        licenseId:current.licenseId,recipients:ageRecipients});
      if(receipt===null)return {message:'Экспорт защищённой лицензии отменён.'};
      if(receipt?.operation!=='PERSON_AGE_EXPORTED'||
         receipt.licenseId!==current.licenseId||
         receipt.activeSeats!==0||receipt.productionActivation!==false||
         receipt.admitted!==false||receipt.deliveryState!=='NOT_CONFIRMED'||
         !Number.isSafeInteger(receipt.bytes)||receipt.bytes<1||
         !digest(receipt.packageSha256)||!digest(receipt.ciphertextSha256)){
        throw Error('PERSON_AGE_EXPORT_RECEIPT_INVALID');
      }
      return {message:'Подписанная PERSON-лицензия защищена age/X25519 и сохранена как .iwxa.age. Получение и применение прав в продукте ещё не подтверждены.'};
    });
  }
  return <section className="publisher-test-owner publisher-person-owner"
    data-testid="publisher-person-owner">
    <h3>Лицензии физических лиц</h3>
    <p className="muted">Выдача и отзыв через исходный T3. Подписанный файл
      передаётся офлайн. Импорт файла сам по себе не открывает функции продукта.</p>
    {loading&&<p role="status">Проверяем издателя PERSON…</p>}
    {!loading&&!available&&<p className="notice subdued"
      data-testid="publisher-person-owner-unavailable">
      Производственный издатель T3 не зарегистрирован в этой установке.
      Выпуск и отзыв недоступны, сохранённые тарифы и черновики не изменены.
    </p>}
    {available&&<>
      <div className="form-grid">
        <label>Издатель
          <select value={issuer} onChange={e=>{setIssuer(e.target.value);
            setTermsConfirmed(false);}} disabled={busy}>
            <option value="">Выберите издателя</option>
            {issuers.map(i=><option key={i} value={i}>{i}</option>)}
          </select>
        </label>
        <label>Подготовленная лицензия
          <select value={proposalId} onChange={e=>{setProposalId(e.target.value);
            setTermsConfirmed(false);}} disabled={busy}>
            <option value="">Выберите клиента и тариф</option>
            {options.map(o=><option key={o.proposalId} value={o.proposalId}>
              {o.label}</option>)}
          </select>
        </label>
      </div>
      {selected&&<div className="publisher-offer-review"
        data-testid="publisher-person-issue-preview">
        <strong>Условия персональной лицензии</strong>
        <p>Получатель: {selected.request.subject.name} ·
          программа: {selected.request.product.id}</p>
        <p>Функции: {selected.request.featureIds.join(', ')} ·
          срок: {selected.request.termDays} дн. ·
          устройств: {selected.request.deviceLimit}</p>
        <p>Ресурсы: {selected.request.quotas.length===0?'без отдельных квот':
          selected.request.quotas.map((q:any)=>q.service+': '+q.metric+
            ' '+q.max+' '+q.unit+' / '+q.period).join('; ')}</p>
        <label><input type="checkbox" checked={termsConfirmed}
          onChange={e=>setTermsConfirmed(e.target.checked)}
          disabled={busy}/> Подтверждаю выпуск на указанных условиях</label>
      </div>}
      {issuedSelected&&<p className="notice subdued"
        data-testid="publisher-person-already-issued">
        Эта подготовка уже выпущена в T3: {issuedSelected.licenseId}
        (издатель {issuedSelected.issuerAuthorityId}).
        Выберите запись в журнале ниже для подписания статуса или экспорта .iwxa.
      </p>}
      <div className="actions">
        <button type="button" className="primary" data-testid="publisher-person-issue"
          disabled={busy||needsRefresh||!issuer||!selected||!termsConfirmed||!!issuedSelected}
          onClick={()=>void issue()}>{issuedSelected?'Уже выпущена':'Подписать и записать в T3'}</button>
        <button type="button" className="secondary"
          data-testid="publisher-person-refresh" disabled={busy}
          onClick={()=>void refresh()}>Обновить журнал PERSON</button>
        <button type="button" className="secondary"
          data-testid="publisher-person-public-trust-export" disabled={busy||needsRefresh}
          onClick={()=>void exportPublicTrust()}>
          Экспортировать публичное доверие издателя
        </button>
      </div>
      <p className="muted">Доверие для установщика — отдельный публичный JSON,
        выпускаемый исходным T3. Подписанная .iwxa не назначает себе издателя.</p>
      {options.length===0&&<p className="muted">Создайте персональный тариф и
        подготовьте лицензию для Atlas или Personal Agent.</p>}
      <h4>Журнал персональных лицензий</h4>
      <div className="actions">
        <label>Поиск по ID лицензии, запроса или получателя
          <input data-testid="publisher-person-lookup-input"
            value={lookupText} onChange={e=>setLookupText(e.target.value)}
            disabled={busy} placeholder="Введите идентификатор из T3"/>
        </label>
        <button type="button" className="secondary"
          data-testid="publisher-person-lookup" disabled={busy||!lookupText.trim()}
          onClick={()=>void findLicense()}>Найти в T3</button>
        <button type="button" className="secondary"
          data-testid="publisher-person-lookup-clear" disabled={busy||!lookupTarget}
          onClick={()=>{setLookupTarget('');setLookupText('');void refresh('');}}>
          Сбросить поиск
        </button>
      </div>
      <p className="muted">{needsRefresh?'Журнал пока не прочитан.':
        <>В журнале: {total}.{truncated&&' Показаны последние 48 записей.'}
          {lookupMatches!==null&&' Результаты поиска: '+lookupMatches+'.'}</>}</p>
      {licenses.length>0&&<>
        <label>Персональная лицензия
        <select value={licenseId} disabled={busy}
          onChange={e=>{setLicenseId(e.target.value);setStatus('');
            setRevokePending('');setRenewalTariff('');}}>
          <option value="">Выберите лицензию</option>
          {licenses.map(x=><option key={x.licenseId} value={x.licenseId}>
            {x.renewalOfLicenseId?'Продление':'Первоначальный выпуск'} ·
            {x.personId} / {x.productId} / {x.status} · {shortLicenseId(x.licenseId)}
          </option>)}
        </select>
        </label>
        {selectedLicense&&<>
          <small data-testid="publisher-person-selected-license"
            style={{display:'block',overflowWrap:'anywhere'}}>
            Выбрана запись T3: {selectedLicense.licenseId}.
            {selectedLicense.renewalOfLicenseId?
              ' Продление лицензии '+selectedLicense.renewalOfLicenseId+'.':
              ' Первоначальный выпуск.'}
          </small>
          <div data-testid="publisher-person-license-dates" className="publisher-offer-review">
            <p>Лицензия выдана: {localTime(selectedLicense.issuedAt)}.
              Срок лицензии до: <strong>{localTime(selectedLicense.expiresAt)}</strong> (местное время).</p>
            <p>{selectedLicense.statusValidUntil?
              <>Подписанный статус {selectedLicense.status} выдан
                {selectedLicense.statusIssuedAt&&' '+localTime(selectedLicense.statusIssuedAt)}.
                Действителен до:
                <strong> {localTime(selectedLicense.statusValidUntil)}</strong> (местное время).</>:
              'Подписанный статус ещё не выпущен.'}</p>
            {Date.parse(selectedLicense.expiresAt)<=Date.now()?
              <p className="notice subdued" data-testid="publisher-person-license-expired">
                Срок лицензии истёк. Для продолжения использования требуется новая подписанная лицензия.</p>:
              selectedLicense.statusValidUntil&&
                Date.parse(selectedLicense.statusValidUntil)<=Date.now()?
                <p className="notice subdued" data-testid="publisher-person-status-expired">
                  Подписанный статус устарел. Обновите подпись текущего статуса через T3
                  перед новым экспортом .iwxa.</p>:null}
          </div>
        </>}
      </>}
      <div className="actions">
        <select aria-label="Новый статус PERSON" value={status}
          disabled={busy||needsRefresh||!selectedLicense||
            selectedLicense.status==='REVOKED'||
            Date.parse(selectedLicense.expiresAt)<=Date.now()}
          onChange={e=>{setStatus(e.target.value as typeof status);
            setRevokePending('');}}>
          <option value="">Выберите новый статус</option>
          <option value="ACTIVE">Активна</option>
          <option value="SUSPENDED">Приостановлена</option>
          <option value="REVOKED">Отозвана</option>
        </select>
        <button type="button" className="secondary"
          data-testid="publisher-person-status"
          disabled={busy||needsRefresh||!personStatusAllowed(selectedLicense,status)}
          onClick={()=>status==='REVOKED'?setRevokePending(licenseId):
            void changeStatus()}>
          {status==='REVOKED'?'Подготовить отзыв PERSON':
            selectedLicense?.status===status?'Обновить подпись статуса':'Подписать статус'}
        </button>
        <button type="button" className="secondary"
          data-testid="publisher-person-export"
          disabled={busy||needsRefresh||!selectedLicense||
            selectedLicense.status==='NOT_ACTIVATED'||
            Date.parse(selectedLicense.expiresAt)<=Date.now()||
            !selectedLicense.statusValidUntil||
            Date.parse(selectedLicense.statusValidUntil)<=Date.now()}
          onClick={()=>void exportIwxa()}>Экспортировать .iwxa</button>
        <button type="button" className="secondary"
          data-testid="publisher-person-export-age"
          disabled={busy||needsRefresh||!selectedLicense||!ageRecipients.trim()||
            selectedLicense.status==='NOT_ACTIVATED'||
            Date.parse(selectedLicense.expiresAt)<=Date.now()||
            !selectedLicense.statusValidUntil||
            Date.parse(selectedLicense.statusValidUntil)<=Date.now()}
          onClick={()=>void exportProtectedIwxa()}>Защищённая .iwxa.age</button>
      </div>
      {selectedLicense&&<label>Публичный ключ получателя age1
        <textarea rows={2} spellCheck={false} value={ageRecipients}
          data-testid="publisher-person-age-recipients"
          onChange={e=>setAgeRecipients(e.target.value)} placeholder="age1…"/>
        <small>Принадлежность ключа получателю проверяется отдельно от лицензии.</small>
      </label>}
      {selectedLicense&&<section className="publisher-offer-review"
        data-testid="publisher-person-renewal">
        <strong>Подготовить продление</strong>
        <p>Новая подготовка сохраняет получателя и программу. Прежняя подписанная
          лицензия и её статус не изменяются.</p>
        <label>Тариф продления
          <select aria-label="Тариф продления PERSON" value={renewalTariff}
            disabled={busy||needsRefresh||
              !['ACTIVE','SUSPENDED'].includes(selectedLicense.status)}
            onChange={e=>setRenewalTariff(e.target.value)}>
            <option value="">Выберите тариф</option>
            {renewalOptions.map((t:any)=><option key={t.id+'#'+t.revision}
              value={t.id+'#'+t.revision}>{t.name} · редакция {t.revision} · {t.termDays} дн.</option>)}
          </select>
        </label>
        <button className="secondary" type="button"
          data-testid="publisher-person-prepare-renewal"
          disabled={busy||needsRefresh||!selectedRenewal||
            !['ACTIVE','SUSPENDED'].includes(selectedLicense.status)}
          onClick={()=>void prepareRenewal()}>Создать подготовку продления</button>
        <p className="muted">Подпись, новый срок и передача .iwxa выполняются отдельно.</p>
      </section>}
      {canRevoke&&<div className="notice"
        data-testid="publisher-person-revoke-confirmation" role="alert">
        <p>Окончательно отозвать лицензию {licenseId}?
          Повторная активация этой лицензии будет запрещена.</p>
        <div className="actions">
          <button type="button" className="primary" disabled={busy}
            onClick={()=>void changeStatus()}>Подтвердить отзыв PERSON</button>
          <button type="button" className="secondary" disabled={busy}
            onClick={()=>{setRevokePending('');setStatus('');}}>Отмена</button>
        </div>
      </div>}
    </>}
    {failure&&<p role="alert">{failure}</p>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
