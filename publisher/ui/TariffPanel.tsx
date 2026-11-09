import React,{useEffect,useRef,useState} from 'react';
type Quota={metric:string;service:'LOCAL'|'CLOUD';unit:string;period:string;max:number};
type Tariff={id:string;productId:string;name:string;holderType:'ORGANIZATION'|'PERSON';revision:number;features:string[];termDays:number;productSeats:number;employeeLimit:number;deviceLimit:number;quotas:Quota[]};
type Holder={id:string;name:string;type:'ORGANIZATION'|'PERSON'};
type Product={id:string;name:string;version:string};
type Proposal={id:string;holderId:string;productId:string;tariffSnapshot?:Tariff;previousProposalId?:string;status:string};
type Draft={products:Product[];holders:Holder[];tariffs:Tariff[];proposals:Proposal[]};
const tariffKey=(t:Tariff)=>[t.productId,t.holderType,t.id,t.revision].join(':');
type SaveResult={ok:boolean;message:string};
export default function TariffPanel({draft,busy,change,mode='full'}:{draft:Draft;busy:boolean;change:(cmd:Record<string,unknown>,message:string)=>Promise<SaveResult>;mode?:'full'|'offer'}){
 const [productId,setProductId]=useState('');
 const [id,setId]=useState('');const [name,setName]=useState('');
 const [holderType,setHolderType]=useState<'ORGANIZATION'|'PERSON'>('ORGANIZATION');
 const [revision,setRevision]=useState('1');const [features,setFeatures]=useState('');
 const [termDays,setTermDays]=useState('365');const [productSeats,setProductSeats]=useState('5');
 const [employeeLimit,setEmployeeLimit]=useState('10');const [deviceLimit,setDeviceLimit]=useState('0');
 const [quotas,setQuotas]=useState<Quota[]>([]);const [choice,setChoice]=useState('');
 const [holderId,setHolderId]=useState('');
 const [previousProposalId,setPreviousProposalId]=useState('');
 const [editionNotice,setEditionNotice]=useState('');
 const [tariffFeedback,setTariffFeedback]=useState<SaveResult|null>(null);
 const [proposalFeedback,setProposalFeedback]=useState<SaveResult|null>(null);
 const tariffFeedbackRef=useRef<HTMLParagraphElement>(null);
 const proposalFeedbackRef=useRef<HTMLParagraphElement>(null);
 const editorRef=useRef<HTMLFormElement>(null);
 useEffect(()=>{
   if(tariffFeedback)tariffFeedbackRef.current?.scrollIntoView({block:'nearest',behavior:'auto'});
 },[tariffFeedback]);
 useEffect(()=>{
   if(proposalFeedback)proposalFeedbackRef.current?.scrollIntoView({block:'nearest',behavior:'auto'});
 },[proposalFeedback]);
 function nextEdition(t:Tariff){
   setTariffFeedback(null);
   const latest=draft.tariffs.filter(item=>item.id===t.id&&item.productId===t.productId&&
     item.holderType===t.holderType).reduce((value,item)=>Math.max(value,item.revision),0);
   setProductId(t.productId);setId(t.id);setName(t.name);setHolderType(t.holderType);
   setRevision(String(latest+1));setFeatures(t.features.join(', '));
   setTermDays(String(t.termDays));setProductSeats(String(t.productSeats));
   setEmployeeLimit(String(t.employeeLimit));setDeviceLimit(String(t.deviceLimit));
   setQuotas(t.quotas.map(q=>({...q})));
   setEditionNotice('Условия предыдущей редакции скопированы. Новая редакция будет сохранена отдельно.');
   editorRef.current?.scrollIntoView({block:'start',behavior:'auto'});
 }
 // Never silently prepare a license for the first tariff in the catalog.
 // Do not associate a newly created tariff with the first catalog product.
 const selectedProduct=draft.products.find(p=>p.id===productId)?.id||'';
 const selected=draft.tariffs.find(t=>tariffKey(t)===choice);
 const holders=draft.holders.filter(h=>h.type===selected?.holderType);
 // The recipient must be selected explicitly for each preparation.
 const selectedHolder=holders.find(h=>h.id===holderId)?.id||'';
 const eligibleSources=draft.proposals.filter(p=>p.tariffSnapshot&&
   p.productId===selected?.productId&&p.holderId===selectedHolder);
 const selectedSource=eligibleSources.find(p=>p.id===previousProposalId);
 async function saveTariff(e:React.FormEvent){
  e.preventDefault();
  if(!selectedProduct)return;
  setTariffFeedback(null);
  const preparedQuotas=quotas.map(q=>({...q,metric:q.metric.trim()}));
  const result=await change({kind:'addTariff',id:id.trim(),name:name.trim(),productId:selectedProduct,
   holderType,revision:Number(revision),features:features.split(',').map(v=>v.trim()).filter(Boolean),
   termDays:Number(termDays),productSeats:Number(productSeats),employeeLimit:Number(employeeLimit),
   deviceLimit:Number(deviceLimit),quotas:preparedQuotas},'Редакция тарифа сохранена. Лицензия не выдана.');
  setTariffFeedback(result);
 }
 async function saveOffer(){
  if(!selected||!selectedHolder)return;
  setProposalFeedback(null);
  const result=await change(selectedSource?{
    kind:'prepareFollowupProposal',previousProposalId:selectedSource.id,
    productId:selected.productId,tariffId:selected.id,revision:selected.revision
   }:{kind:'addTariffProposal',productId:selected.productId,
    tariffId:selected.id,revision:selected.revision,holderId:selectedHolder},
   'Подготовка сохранена. Действующие права не изменены.');
  setProposalFeedback(result);
 }
 return <div data-testid="publisher-tariffs">
  {mode==='full'&&<>
  <section className="card form-panel">
   <h2>Тарифы и лимиты</h2>
   <p className="muted">Один каталог для организаций и физических лиц. Сохранённая редакция не изменяет уже подготовленные условия.</p>
   {editionNotice&&<p className="muted" role="status">{editionNotice}</p>}
   {draft.products.length===0?<p className="muted">Сначала добавьте продукт.</p>:<form ref={editorRef} onSubmit={e=>void saveTariff(e)} onChangeCapture={()=>setTariffFeedback(null)}>
    <div className="form-grid">
     <label>Продукт<select value={selectedProduct} onChange={e=>setProductId(e.target.value)} required><option value="">Выберите продукт</option>{draft.products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
     <label>Код тарифа<input value={id} onChange={e=>setId(e.target.value)} required placeholder="TEAM"/></label>
     <label>Название тарифа<input value={name} onChange={e=>setName(e.target.value)} required placeholder="Команда"/></label>
     <label>Тип клиента<select aria-label="Тип клиента для тарифа" value={holderType} onChange={e=>{const t=e.target.value as 'PERSON'|'ORGANIZATION';setHolderType(t);setProductSeats(t==='PERSON'?'1':'5');setEmployeeLimit(t==='PERSON'?'0':'10');setDeviceLimit(t==='PERSON'?'2':'0');}}><option value="ORGANIZATION">Организация</option><option value="PERSON">Физическое лицо</option></select></label>
     <label>Редакция<input type="number" required min={1} max={1000} value={revision} onChange={e=>setRevision(e.target.value)}/></label>
     <label>Срок действия (дней)<input type="number" required min={1} max={3650} value={termDays} onChange={e=>setTermDays(e.target.value)}/></label>
     <label>Места продукта<input type="number" required min={1} max={10000} value={productSeats} onChange={e=>setProductSeats(e.target.value)}/></label>
     {holderType==='ORGANIZATION'&&<label>Сотрудники организации<input type="number" required min={1} max={100000} value={employeeLimit} onChange={e=>setEmployeeLimit(e.target.value)}/></label>}
     {holderType==='PERSON'&&<label>Устройства владельца<input type="number" required min={1} max={100} value={deviceLimit} onChange={e=>setDeviceLimit(e.target.value)}/></label>}
     <label>Функции и модули<input value={features} onChange={e=>setFeatures(e.target.value)} placeholder="LOCAL_MODELS, WORKSPACES"/></label>
    </div>
    <div className="publisher-quota-editor" data-testid="publisher-quota-editor">
     <div className="publisher-quota-head"><strong>Ограничения ресурсов</strong><button type="button" className="secondary" disabled={busy||quotas.length>=32} onClick={()=>setQuotas(previous=>[...previous,{metric:'',service:'LOCAL',unit:'COUNT',period:'TOTAL',max:1}])}>Добавить квоту</button></div>
     {quotas.length===0?<p className="muted">Дополнительные ограничения не заданы.</p>:quotas.map((q,index)=>{
       const update=(patch:Partial<Quota>)=>setQuotas(previous=>previous.map((item,n)=>n===index?{...item,...patch}:item));
       return <div className="publisher-quota-row" key={index}>
         <label>Ресурс<input required value={q.metric} onChange={e=>update({metric:e.target.value})} placeholder="LOCAL_PROJECTS"/></label>
         <label>Где используется<select value={q.service} onChange={e=>update({service:e.target.value as Quota['service']})}><option value="LOCAL">В программе</option><option value="CLOUD">В облаке</option></select></label>
         <label>Единица<select value={q.unit} onChange={e=>update({unit:e.target.value})}><option value="COUNT">Количество</option><option value="TOKENS">Токены</option><option value="MINUTES">Минуты</option><option value="GIB">ГиБ</option><option value="CREDITS">Кредиты</option></select></label>
         <label>Период<select value={q.period} onChange={e=>update({period:e.target.value})}><option value="TOTAL">Всего</option><option value="DAY">В день</option><option value="MONTH">В месяц</option></select></label>
         <label>Предел<input required type="number" min={1} max={1000000000} value={q.max} onChange={e=>update({max:Number(e.target.value)})}/></label>
         <button type="button" className="quiet" disabled={busy} onClick={()=>setQuotas(previous=>previous.filter((_,n)=>n!==index))}>Убрать</button>
       </div>;
     })}
    </div>
    <p className="muted">Облачные квоты учитывает подключённый сервис. Локальная работа не требует интернета.</p>
    <div className="publisher-save-action" data-testid="publisher-tariff-save-action">
      <button type="submit" disabled={busy||!selectedProduct} className="primary">{busy?'Сохраняем…':'Сохранить редакцию тарифа'}</button>
      {tariffFeedback&&<p ref={tariffFeedbackRef} className={'publisher-inline-feedback '+(tariffFeedback.ok?'success':'error')}
        role={tariffFeedback.ok?'status':'alert'} data-testid="publisher-tariff-save-feedback">{tariffFeedback.message}</p>}
    </div>
   </form>}
  </section>
  <section className="card padded"><h2>Сохранённые тарифы ({draft.tariffs.length})</h2>
   {draft.tariffs.length===0?<p className="muted">Тарифов пока нет.</p>:draft.tariffs.map(t=><div className="simple-row" key={tariffKey(t)}><div><strong>{t.name} · редакция {t.revision}</strong><small>{draft.products.find(p=>p.id===t.productId)?.name||t.productId} · {t.holderType==='PERSON'?'Физическое лицо':'Организация'} · {t.termDays} дней</small><small>Мест: {t.productSeats} · сотрудников: {t.employeeLimit} · устройств: {t.deviceLimit} · функций: {t.features.length} · квот: {t.quotas.length}</small></div><span className="status neutral">Черновик</span><button className="secondary" type="button" disabled={busy} onClick={()=>nextEdition(t)}>Новая редакция</button></div>)}
  </section>
  </>}
  <section className="card form-panel" data-testid="publisher-tariff-proposal" onChangeCapture={()=>setProposalFeedback(null)}><h2>Подготовить лицензию</h2>
   <p className="muted">Условия выбранной редакции сохраняются в запросе. Лицензия без подписи не действует.</p>
   {draft.tariffs.length===0?<p className="muted">Сначала создайте тариф.</p>:<>
    <div className="form-grid">
     <label>Тариф<select value={selected?tariffKey(selected):''} onChange={e=>{setChoice(e.target.value);setHolderId('');setPreviousProposalId('');}}><option value="">Выберите тариф</option>{draft.tariffs.map(t=><option key={tariffKey(t)} value={tariffKey(t)}>{draft.products.find(p=>p.id===t.productId)?.name||t.productId} · {t.name} · редакция {t.revision} · {t.holderType==='PERSON'?'Личный':'Для организации'}</option>)}</select></label>
     <label>Клиент<select value={selectedHolder} disabled={!selected||holders.length===0} onChange={e=>{setHolderId(e.target.value);setPreviousProposalId('');}}><option value="">Выберите клиента</option>{holders.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
    </div>
    {!selected&&<p className="muted" role="status">Выберите тариф и клиента, чтобы проверить условия до сохранения.</p>}
    {selected&&holders.length===0&&<p className="muted" role="status">Нет клиентов нужного типа. Добавьте получателя в разделе «Клиенты».</p>}
    {selected&&selectedHolder&&<label className="publisher-followup-choice">Основание подготовки
      <select aria-label="Основание подготовки" value={selectedSource?.id||''} onChange={e=>setPreviousProposalId(e.target.value)}>
        <option value="">Новая подготовка</option>
        {eligibleSources.map(p=><option key={p.id} value={p.id}>{p.tariffSnapshot?.name} · редакция {p.tariffSnapshot?.revision} · прежняя подготовка</option>)}
      </select>
    </label>}
    {selected&&<p className="muted">{selected.holderType==='PERSON'?'Личная лицензия предназначена для проверки прямо в установленном продукте, без Admin Center. Подписанный маршрут PERSON пока не подключён.':'Организационная лицензия предназначена для проверки в Admin Center. Сейчас Publisher сохраняет условия и не выдаёт действующих прав.'}</p>}
    {selectedSource&&<p className="muted">Новая подготовка будет связана с прежним запросом. Это не продлевает и не изменяет действующие права без отдельной подписи издателя.</p>}
    {selected&&selectedHolder&&<div className="publisher-offer-review" data-testid="publisher-offline-offer-preview" role="status">
      <strong>Условия для проверки</strong>
      <p>{draft.holders.find(h=>h.id===selectedHolder)?.name} · {draft.products.find(p=>p.id===selected.productId)?.name||selected.productId}</p>
      <div className="publisher-offer-limits">
        <span>Места продукта: <b>{selected.productSeats}</b></span>
        {selected.holderType==='ORGANIZATION'?<span>Сотрудники: <b>{selected.employeeLimit}</b></span>:<span>Устройства: <b>{selected.deviceLimit}</b></span>}
        <span>Срок: <b>{selected.termDays} дней</b></span>
      </div>
      <p><b>Функции:</b> {selected.features.length?selected.features.join(', '):'Дополнительные функции не выбраны'}</p>
      {selected.quotas.length>0&&<div className="publisher-offer-quotas">
        <b>Ограничения ресурсов</b>
        {selected.quotas.map(q=><span key={[q.service,q.metric,q.unit,q.period].join(':')}>{q.metric} · {q.service==='CLOUD'?'Облако':'Локально'} · {q.max} {q.unit} · {q.period}</span>)}
      </div>}
      <p className="muted">Неподписанная подготовка. Права появятся только после выпуска и проверки доверенной лицензии .iwxa.</p>
    </div>}
    <div className="publisher-save-action" data-testid="publisher-proposal-save-action">
      <button className="primary" type="button" disabled={busy||!selected||!selectedHolder} onClick={()=>void saveOffer()}>{busy?'Сохраняем…':selectedSource?'Создать следующую подготовку':'Сохранить подготовку по тарифу'}</button>
      {proposalFeedback&&<p ref={proposalFeedbackRef} className={'publisher-inline-feedback '+(proposalFeedback.ok?'success':'error')}
        role={proposalFeedback.ok?'status':'alert'} data-testid="publisher-proposal-save-feedback">{proposalFeedback.message}</p>}
    </div>
   </>}
  </section>
 </div>;
}
