import React,{useEffect,useMemo,useState} from 'react';
import {prepareUnsignedPersonLicenseRequest} from '../src/person-license-request.mjs';

type NativeInvoke=(name:string,args?:Record<string,unknown>)=>Promise<any>;
type PersonRecord={
  licenseId:string;requestId:string;issuerAuthorityId:string;
  personId:string;productId:string;deviceLimit:number;quotaCount:number;
  status:'NOT_ACTIVATED'|'ACTIVE'|'SUSPENDED'|'REVOKED';
  sequence:number;activeSeats:0
};
type Inventory={entries:PersonRecord[];truncated:boolean;total:number};
type Props={draft:any;invoke:NativeInvoke};
const err=(e:unknown)=>e instanceof Error?e.message:String(e);
const id=(v:unknown)=>typeof v==='string'&&
  /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(v);
const digest=(v:unknown)=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export default function PublisherPersonOwnerPanel({draft,invoke}:Props){
  const [issuers,setIssuers]=useState<string[]>([]);
  const [issuer,setIssuer]=useState('');
  const [available,setAvailable]=useState(false);
  const [loading,setLoading]=useState(true);
  const [busy,setBusy]=useState(false);
  const [needsRefresh,setNeedsRefresh]=useState(false);
  const [licenses,setLicenses]=useState<PersonRecord[]>([]);
  const [total,setTotal]=useState(0);
  const [truncated,setTruncated]=useState(false);
  const [proposalId,setProposalId]=useState('');
  const [licenseId,setLicenseId]=useState('');
  const [status,setStatus]=useState<''|'ACTIVE'|'SUSPENDED'|'REVOKED'>('');
  const [termsConfirmed,setTermsConfirmed]=useState(false);
  const [revokePending,setRevokePending]=useState('');
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
  const selectedLicense=licenses.find(l=>l.licenseId===licenseId);
  const canRevoke=Boolean(revokePending&&revokePending===licenseId&&
    status==='REVOKED'&&selectedLicense?.status!=='REVOKED');
  useEffect(()=>{
    if(!options.some(o=>o.proposalId===proposalId)){
      setProposalId('');setTermsConfirmed(false);
    }
  },[options,proposalId]);
  async function inventory():Promise<Inventory>{
    const value=await invoke('publisher_t3_person_inventory');
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
       !Number.isSafeInteger(x.sequence)||x.sequence<0||x.activeSeats!==0)||
       new Set(entries.map(e=>e.licenseId)).size!==entries.length)
      throw Error('PERSON_NATIVE_INVENTORY_ENTRY_INVALID');
    const count=Number.isSafeInteger(value.total)&&value.total>=entries.length?
      value.total:entries.length;
    setLicenses(entries);setTotal(count);
    setTruncated(value.truncated===true);
    setLicenseId(old=>entries.some(e=>e.licenseId===old)?old:'');
    return {entries,truncated:value.truncated===true,total:count};
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
        await inventory();
      }catch{
        if(alive)setAvailable(false);
      }finally{if(alive)setLoading(false);}
    })();
    return()=>{alive=false;};
  },[]);
  async function refresh(){
    if(!available||busy)return;
    setBusy(true);setFailure('');setMessage('');
    try{await inventory();setNeedsRefresh(false);
      setMessage('Журнал персональных лицензий обновлён.');}
    catch(e){setFailure('Не удалось прочитать журнал T3: '+err(e));}
    finally{setBusy(false);}
  }
  async function operate(action:()=>Promise<{
    message:string;confirm?:(value:Inventory)=>boolean
  }>){
    if(busy||!available||needsRefresh)return;
    setBusy(true);setFailure('');setMessage('');
    try{
      const result=await action();
      let readback:Inventory;
      try{readback=await inventory();}
      catch(e){setNeedsRefresh(true);
        setFailure('Операция могла сохраниться, но журнал T3 не перечитан. '+
          'Обновите журнал перед повтором. '+err(e));return;}
      if(result.confirm&&!result.confirm(readback)){
        setNeedsRefresh(true);
        setFailure('Подписанная запись не подтверждена повторным чтением T3. '+
          'Обновите журнал перед повтором.');
        return;
      }
      setMessage(result.message);
    }catch(e){setFailure(err(e));}
    finally{setBusy(false);}
  }
  async function issue(){
    if(!issuer||!selected||!termsConfirmed||busy||needsRefresh)return;
    const request=prepareUnsignedPersonLicenseRequest(draft,{proposalId:selected.proposalId});
    const authority=issuer;
    await operate(async()=>{
      const result=await invoke('publisher_t3_person_issue',{
        requestJson:JSON.stringify(request),issuerAuthorityId:authority});
      if(result?.operation!=='PERSON_ISSUE'||result.productionActivation!==false||
         result.activeSeats!==0||!['ISSUED_NEW','ALREADY_ISSUED'].includes(result.outcome)||
         !id(result.licenseId)||result.requestId!==request.requestId)
        throw Error('PERSON_NATIVE_ISSUE_RECEIPT_INVALID');
      return {
        message:'Подписанная лицензия сохранена в журнале издателя. '+
          'Для применения прав её необходимо импортировать в установленную программу.',
        confirm:({entries}:Inventory)=>entries.some(x=>x.licenseId===result.licenseId&&
          x.requestId===request.requestId&&x.issuerAuthorityId===authority&&
          x.personId===request.subject.id&&x.productId===request.product.id&&
          x.deviceLimit===request.deviceLimit&&x.quotaCount===request.quotas.length)
      };
    });
  }
  async function changeStatus(){
    const current=selectedLicense,requested=status;
    if(!current||!requested||current.status==='REVOKED'||busy||needsRefresh||
       current.status===requested||(requested==='REVOKED'&&!canRevoke))return;
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
        confirm:({entries}:Inventory)=>entries.some(x=>
          x.licenseId===current.licenseId&&x.status===requested&&
          x.sequence===value.sequence)
      };
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
      <div className="actions">
        <button type="button" className="primary" data-testid="publisher-person-issue"
          disabled={busy||needsRefresh||!issuer||!selected||!termsConfirmed}
          onClick={()=>void issue()}>Подписать и записать в T3</button>
        <button type="button" className="secondary"
          data-testid="publisher-person-refresh" disabled={busy}
          onClick={()=>void refresh()}>Обновить журнал</button>
      </div>
      {options.length===0&&<p className="muted">Создайте персональный тариф и
        подготовьте лицензию для Atlas или Personal Agent.</p>}
      <h4>Журнал персональных лицензий</h4>
      <p className="muted">В журнале: {total}.
        {truncated&&' Показаны последние 48 записей.'}</p>
      {licenses.length>0&&<label>Лицензия
        <select value={licenseId} disabled={busy}
          onChange={e=>{setLicenseId(e.target.value);setStatus('');
            setRevokePending('');}}>
          <option value="">Выберите лицензию</option>
          {licenses.map(x=><option key={x.licenseId} value={x.licenseId}>
            {x.personId} / {x.productId} / {x.status}</option>)}
        </select></label>}
      <div className="actions">
        <select aria-label="Новый статус PERSON" value={status}
          disabled={busy||needsRefresh||!selectedLicense||
            selectedLicense.status==='REVOKED'}
          onChange={e=>{setStatus(e.target.value as typeof status);
            setRevokePending('');}}>
          <option value="">Выберите новый статус</option>
          <option value="ACTIVE">Активна</option>
          <option value="SUSPENDED">Приостановлена</option>
          <option value="REVOKED">Отозвана</option>
        </select>
        <button type="button" className="secondary"
          data-testid="publisher-person-status"
          disabled={busy||needsRefresh||!selectedLicense||!status||
            selectedLicense.status===status||selectedLicense.status==='REVOKED'}
          onClick={()=>status==='REVOKED'?setRevokePending(licenseId):
            void changeStatus()}>
          {status==='REVOKED'?'Подготовить отзыв':'Подписать статус'}
        </button>
        <button type="button" className="secondary"
          data-testid="publisher-person-export"
          disabled={busy||needsRefresh||!selectedLicense||
            selectedLicense.status==='NOT_ACTIVATED'}
          onClick={()=>void exportIwxa()}>Экспортировать .iwxa</button>
      </div>
      {canRevoke&&<div className="notice"
        data-testid="publisher-person-revoke-confirmation" role="alert">
        <p>Окончательно отозвать лицензию {licenseId}?
          Повторная активация этой лицензии будет запрещена.</p>
        <div className="actions">
          <button type="button" className="primary" disabled={busy}
            onClick={()=>void changeStatus()}>Подтвердить отзыв</button>
          <button type="button" className="secondary" disabled={busy}
            onClick={()=>{setRevokePending('');setStatus('');}}>Отмена</button>
        </div>
      </div>}
    </>}
    {failure&&<p role="alert">{failure}</p>}
    {message&&<p role="status">{message}</p>}
  </section>;
}
