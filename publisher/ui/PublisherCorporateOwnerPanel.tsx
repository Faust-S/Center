import React,{useMemo,useState} from 'react';
import {projectCorporateOfferReviews} from '../src/corporate-offer-review.mjs';
import {prepareCorporateLicenseRequest,encodeCorporateLicenseRequest}
  from '../src/corporate-license-request.mjs';

type Offer={proposalId:string;organization:{id:string;name:string};
  tariff:{id:string;name:string;revision:number};
  product:{id:string};featureIds:string[];
  limits:{employeeLimit:number;adminCenterProductSeats:number}};
type OwnerCaps={issuers:string[];operation:string;
  environment:string;activeSeats:number;productionActivation:boolean};
type IssuerReadback={operation:string;licenseId:string;requestId:string;
  organizationId:string;issuerAuthorityId:string;productId:string;
  tariffId:string;tariffRevision:number;status:string;sequence:number;
  licenseEnvelopeSha256:string;statusEnvelopeSha256:string|null;
  stateRevision:number;ledgerRevision:number;
  recipientConfirmed:boolean;activeSeats:number;
  assignablePersonalAgentSeats:number;productionActivation:boolean};
type Props={draft:any;invoke:(command:string,args?:Record<string,unknown>)=>Promise<any>;
  expectedDraftSha256:string;
  ensureSigningDraftCurrent:(sha:string)=>Promise<void>};
const error=e=>e instanceof Error?e.message:String(e);
const HEX=/^[a-f0-9]{64}$/;
const seatsInput=s=>/^(0|[1-9][0-9]*)$/.test(s);

export default function PublisherCorporateOwnerPanel({
  draft,invoke,expectedDraftSha256,ensureSigningDraftCurrent
}:Props){
  const offers=useMemo(()=>projectCorporateOfferReviews(draft,{limit:20}),[draft]);
  const [issuers,setIssuers]=useState<string[]>([]);
  const [issuer,setIssuer]=useState('');
  const [proposalId,setProposalId]=useState('');
  const [seatInput,setSeatInput]=useState('');
  const [review,setReview]=useState<{request:any;raw:string;
    sourceSha256:string;issuerId:string}|null>(null);
  const [confirmIssue,setConfirmIssue]=useState(false);
  const [signed,setSigned]=useState<IssuerReadback|null>(null);
  const [lookup,setLookup]=useState('');
  const [statusAction,setStatusAction]=useState<'ACTIVE'|'SUSPENDED'|'REVOKED'>('ACTIVE');
  const [validUntil,setValidUntil]=useState('');
  const [confirmStatus,setConfirmStatus]=useState(false);
  const [unknown,setUnknown]=useState(false);
  const [busy,setBusy]=useState(false);
  const [feedback,setFeedback]=useState('');
  const [problem,setProblem]=useState('');
  const selected=offers.items.find((o:Offer)=>o.proposalId===proposalId);
  const clearAction=()=>{setReview(null);setConfirmIssue(false);setSigned(null);
    setUnknown(false);setConfirmStatus(false);setProblem('');setFeedback('');};

  async function loadCapabilities(){
    if(busy)return;
    setBusy(true);setProblem('');setFeedback('');
    try{
      const value=await invoke('publisher_t3_corporate_capabilities') as OwnerCaps;
      if(value.operation!=='CORPORATE_CAPABILITIES'||
        value.environment!=='PRODUCTION'||
        value.productionActivation!==false||value.activeSeats!==0||
        !Array.isArray(value.issuers)||value.issuers.some(x=>typeof x!=='string'))
        throw Error('CORPORATE_OWNER_CAPABILITIES_NOT_ORIGINAL');
      setIssuers(value.issuers);
      setIssuer(value.issuers.length===1?value.issuers[0]:'');
      setFeedback(value.issuers.length
        ?'Исходный корпоративный Owner доступен. Фактические лицензии получателей ещё не проверены.'
        :'В исходном T3 нет зарегистрированного корпоративного издателя.');
    }catch(e){
      setIssuers([]);setIssuer('');
      setProblem('Корпоративный издатель недоступен: '+error(e));
    }finally{setBusy(false);}
  }

  function prepare(){
    if(!selected||!issuer||!seatsInput(seatInput))return;
    setProblem('');setFeedback('');setSigned(null);setUnknown(false);
    try{
      const request=prepareCorporateLicenseRequest(draft,{
        proposalId:selected.proposalId,personalAgentSeats:Number(seatInput)
      });
      const raw=encodeCorporateLicenseRequest(request);
      setReview({request,raw,sourceSha256:expectedDraftSha256,issuerId:issuer});
      setConfirmIssue(false);
    }catch(e){setReview(null);setProblem('Не удалось проверить запрос: '+error(e));}
  }

  async function coldSignedReadback(id:string,requestId?:string){
    const first=await invoke('publisher_t3_corporate_signed_readback',{licenseId:id}) as IssuerReadback;
    const second=await invoke('publisher_t3_corporate_signed_readback',{licenseId:id}) as IssuerReadback;
    for(const v of [first,second]){
      if(v.operation!=='CORPORATE_SIGNED_READBACK'||v.licenseId!==id||
         (requestId!==undefined&&v.requestId!==requestId)||
         v.productId!=='IWXA_ADMIN_CENTER'||
         !HEX.test(v.licenseEnvelopeSha256)||
         !Number.isSafeInteger(v.sequence)||v.sequence<0||
         v.productionActivation!==false||v.activeSeats!==0||
         v.assignablePersonalAgentSeats!==0||v.recipientConfirmed!==false)
        throw Error('CORPORATE_ORIGINAL_SIGNED_READBACK_INVALID');
    }
    if(first.licenseEnvelopeSha256!==second.licenseEnvelopeSha256||
       first.statusEnvelopeSha256!==second.statusEnvelopeSha256||
       first.sequence!==second.sequence||
       first.status!==second.status||
       first.stateRevision!==second.stateRevision||
       first.ledgerRevision!==second.ledgerRevision)
      throw Error('CORPORATE_OWNER_CONCURRENT_CHANGE_REQUIRES_REFRESH');
    return second;
  }

  async function issue(){
    if(busy||unknown||!review||!confirmIssue||
      review.issuerId!==issuer||review.sourceSha256!==expectedDraftSha256)return;
    setBusy(true);setProblem('');setFeedback('');
    try{
      await ensureSigningDraftCurrent(review.sourceSha256);
      // The native Rust bridge holds the original Publisher write lock from
      // exact source comparison THROUGH the irreversible original T3 issue.
      const result=await invoke('publisher_t3_corporate_issue',{
        requestJson:review.raw,issuerAuthorityId:issuer,
        expectedDraftSha256:review.sourceSha256
      });
      if(result.operation!=='CORPORATE_ISSUE'||
        !['ISSUED_NEW','ALREADY_ISSUED'].includes(result.outcome)||
        result.requestId!==review.request.requestId||
        typeof result.licenseId!=='string')
        throw Error('CORPORATE_OWNER_ISSUE_RECEIPT_NOT_CONFIRMED');
      const read=await coldSignedReadback(result.licenseId,review.request.requestId);
      if(read.organizationId!==review.request.subject.id||
         read.tariffId!==review.request.tariff.id||
         read.tariffRevision!==review.request.tariff.revision)
        throw Error('CORPORATE_OWNER_READBACK_TERMS_MISMATCH');
      setSigned(read);setLookup(read.licenseId);setReview(null);setConfirmIssue(false);
      setFeedback('Лицензия подписана и сохранена в оригинальном журнале T3. Получение в Admin Center и места сотрудников не подтверждены.');
    }catch(e){
      // A native ACK might be lost AFTER signing. Never blindly sign again.
      setUnknown(true);
      setProblem('Исход операции не подтверждён. Не повторяйте подписание; проверьте точный журнал издателя: '+error(e));
    }finally{setBusy(false);}
  }

  async function lookupSigned(){
    if(busy||!lookup.trim())return;
    setBusy(true);setProblem('');setFeedback('');
    try{
      const result=await invoke('publisher_t3_corporate_inventory',{lookupId:lookup.trim()});
      if(result.operation!=='CORPORATE_INVENTORY'||
        result.truncated===true||result.matches!==1||
        !Array.isArray(result.licenses)||result.licenses.length!==1)
        throw Error('CORPORATE_OWNER_EXACT_UNIQUE_LEDGER_ENTRY_REQUIRED');
      const row=result.licenses[0];
      const signedRead=await coldSignedReadback(row.licenseId);
      if(signedRead.requestId!==row.requestId||
         !(lookup.trim()===signedRead.requestId||
           lookup.trim()===signedRead.licenseId||
           lookup.trim()===signedRead.organizationId))
        throw Error('CORPORATE_OWNER_LOOKUP_BINDING_INVALID');
      setSigned(signedRead);setUnknown(false);setReview(null);
      setConfirmIssue(false);setConfirmStatus(false);
      setFeedback('Подпись и STATUS подтверждены двумя независимыми чтениями исходного журнала. Доставка и приём организацией не доказаны.');
    }catch(e){setSigned(null);setProblem('Точный подписанный readback недоступен: '+error(e));}
    finally{setBusy(false);}
  }

  async function changeStatus(){
    if(!signed||busy||unknown||!confirmStatus||
      !['ACTIVE','SUSPENDED','REVOKED'].includes(statusAction)||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(validUntil))
      return;
    setBusy(true);setProblem('');setFeedback('');
    const previous=signed;
    try{
      const result=await invoke('publisher_t3_corporate_change_status',{
        licenseId:previous.licenseId,nextStatus:statusAction,
        expectedSequence:previous.sequence,validUntil
      });
      if(result.operation!=='CORPORATE_STATUS'||
         result.licenseId!==previous.licenseId||
         result.sequence!==previous.sequence+1||
         result.state!==statusAction)
        throw Error('CORPORATE_OWNER_STATUS_COMMIT_NOT_CONFIRMED');
      const verified=await coldSignedReadback(previous.licenseId,previous.requestId);
      if(verified.sequence!==result.sequence||verified.status!==statusAction)
        throw Error('CORPORATE_STATUS_SIGNED_READBACK_MISMATCH');
      setSigned(verified);setConfirmStatus(false);
      setFeedback('Подписанный STATUS сохранён в оригинальном T3. Получение изменения устройствами сотрудников ещё не подтверждено.');
    }catch(e){
      setSigned(null);setUnknown(true);
      setProblem('Неизвестный исход STATUS. Нельзя повторно подписывать без точного исходного readback: '+error(e));
    }finally{setBusy(false);}
  }

  return <section className="publisher-test-owner" data-testid="publisher-corporate-native-owner">
    <h3>Корпоративная лицензия организации: исходный T3</h3>
    <p className="muted">Только зарегистрированный исходный T3 Owner подписывает
      LICENSE и STATUS. Сведения Publisher не являются проверкой доставки
      пакета организации или прав Personal Agent. Коммерческих мест без
      независимого приёма в Admin Center: 0.</p>
    <button className="secondary" type="button" disabled={busy}
      data-testid="publisher-corporate-owner-check"
      onClick={()=>void loadCapabilities()}>Проверить зарегистрированного издателя T3</button>
    {issuers.length>0&&<div className="publisher-offer-review">
      <label>Зарегистрированный издатель
        <select value={issuer} disabled={busy}
          onChange={e=>{setIssuer(e.target.value);clearAction();}}>
          <option value="">Выберите исходную запись</option>
          {issuers.map(x=><option key={x} value={x}>{x}</option>)}
        </select>
      </label>
      <label>Подготовленное предложение организации
        <select value={proposalId} disabled={busy}
          onChange={e=>{setProposalId(e.target.value);clearAction();}}>
          <option value="">Выберите предложение</option>
          {offers.items.map((x:Offer)=><option value={x.proposalId} key={x.proposalId}>
            {x.organization.name} · {x.tariff.name} (ред. {x.tariff.revision})
          </option>)}
        </select>
      </label>
      {selected&&<div>
        <p>Лимит сотрудников: {selected.limits.employeeLimit}.
          Места Admin Center: {selected.limits.adminCenterProductSeats}.</p>
        <label>Корпоративные места Personal Agent (явно)
          <input type="number" min={0} max={selected.limits.employeeLimit}
            value={seatInput} disabled={busy}
            onChange={e=>{setSeatInput(e.target.value);clearAction();}}
            data-testid="publisher-corporate-native-seats"/>
        </label>
        <button type="button" className="secondary"
          disabled={!issuer||!seatsInput(seatInput)||busy}
          onClick={prepare}>Проверить условия перед подписью</button>
      </div>}
      {review&&<div className="publisher-test-request"
        data-testid="publisher-corporate-signing-preview">
        <strong>Условия подписания: исходная организация и тариф</strong>
        <p>Организация: {review.request.subject.id}; продукт:
          {review.request.product.id} {review.request.product.version};
          тариф: {review.request.tariff.id}, редакция {review.request.tariff.revision};
          Personal Agent: {review.request.limits.personalAgentSeats} мест;
          срок: {review.request.termDays} дней.</p>
        <p>Функции: {review.request.featureIds.join(', ')||'не выбраны'}.
          Запрос пока не подписан. Исходный T3 отдельно проверит полномочия издателя.</p>
        <label><input type="checkbox" checked={confirmIssue} disabled={busy}
          onChange={e=>setConfirmIssue(e.target.checked)}/>
          Подтверждаю выдачу организации по этим условиям
        </label>
        <button type="button" className="primary"
          data-testid="publisher-corporate-native-issue"
          disabled={busy||unknown||!confirmIssue||
            review.sourceSha256!==expectedDraftSha256}
          onClick={()=>void issue()}>Подписать через оригинальный T3</button>
      </div>}
    </div>}
    <div className="publisher-test-request">
      <label>Точный requestId, licenseId или organizationId исходного T3
        <input value={lookup} disabled={busy}
          onChange={e=>setLookup(e.target.value)}
          data-testid="publisher-corporate-native-lookup"/>
      </label>
      <button type="button" className="secondary" disabled={busy||!lookup.trim()}
        onClick={()=>void lookupSigned()}>Прочитать подписанный журнал T3</button>
    </div>
    {signed&&<div className="publisher-test-request"
      data-testid="publisher-corporate-native-readback">
      <strong>Подписано издателем T3, не принято получателем</strong>
      <p>Лицензия: {signed.licenseId}; организация: {signed.organizationId};
        тариф {signed.tariffId} / {signed.tariffRevision}.</p>
      <p>STATUS: {signed.status}, последовательность {signed.sequence}.
        SHA-256 LICENSE: {signed.licenseEnvelopeSha256}.</p>
      <p>Получение Admin Center: не подтверждено. Назначаемых мест: 0.</p>
      {signed.status!=='REVOKED'&&<div>
        <label>Действие STATUS
          <select value={statusAction} disabled={busy}
            onChange={e=>{setStatusAction(e.target.value as typeof statusAction);
              setConfirmStatus(false);}}>
            <option value="ACTIVE">Активировать после подписи STATUS</option>
            <option value="SUSPENDED">Приостановить</option>
            <option value="REVOKED">Отозвать окончательно</option>
          </select>
        </label>
        <label>STATUS действителен до (UTC, ISO 8601)
          <input value={validUntil} disabled={busy}
            onChange={e=>{setValidUntil(e.target.value);setConfirmStatus(false);}}
            placeholder="2026-12-01T12:00:00.000Z"/>
        </label>
        <label><input type="checkbox" checked={confirmStatus} disabled={busy}
          onChange={e=>setConfirmStatus(e.target.checked)}/>
          Подтверждаю отдельную подпись STATUS; отзыв необратим
        </label>
        <button type="button" className="secondary" disabled={busy||!confirmStatus}
          onClick={()=>void changeStatus()}>Подписать новый STATUS через T3</button>
      </div>}
    </div>}
    {unknown&&<p role="alert">Операция требует сверки с оригинальным журналом.
      Повторная выдача или изменение STATUS заблокированы.</p>}
    {problem&&<p role="alert">{problem}</p>}
    {feedback&&<p role="status">{feedback}</p>}
  </section>;
}
