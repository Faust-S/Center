import React,{useState} from 'react';
type Quota={metric:string;service:'LOCAL'|'CLOUD';unit:string;period:string;max:number};
type Tariff={id:string;productId:string;name:string;holderType:'ORGANIZATION'|'PERSON';revision:number;features:string[];termDays:number;productSeats:number;employeeLimit:number;deviceLimit:number;quotas:Quota[]};
type Holder={id:string;name:string;type:'ORGANIZATION'|'PERSON'};
type Product={id:string;name:string;version:string};
type Draft={products:Product[];holders:Holder[];tariffs:Tariff[]};
export default function TariffPanel({draft,busy,change}:{draft:Draft;busy:boolean;change:(cmd:Record<string,unknown>,message:string)=>Promise<void>}){
 const [productId,setProductId]=useState('');
 const [id,setId]=useState('');const [name,setName]=useState('');
 const [holderType,setHolderType]=useState<'ORGANIZATION'|'PERSON'>('ORGANIZATION');
 const [revision,setRevision]=useState('1');const [features,setFeatures]=useState('');
 const [termDays,setTermDays]=useState('365');const [productSeats,setProductSeats]=useState('5');
 const [employeeLimit,setEmployeeLimit]=useState('10');const [deviceLimit,setDeviceLimit]=useState('0');
 const [quotas,setQuotas]=useState<Quota[]>([]);const [choice,setChoice]=useState('');
 const [holderId,setHolderId]=useState('');
 const selected=draft.tariffs.find(t=>t.id+':'+t.revision===choice)||draft.tariffs[0];
 const holders=draft.holders.filter(h=>h.type===selected?.holderType);
 const selectedHolder=holders.find(h=>h.id===holderId)?.id||holders[0]?.id||'';
 function saveTariff(e:React.FormEvent){
  e.preventDefault();
  const preparedQuotas=quotas.map(q=>({...q,metric:q.metric.trim()}));
  void change({kind:'addTariff',id:id.trim(),name:name.trim(),productId:productId||draft.products[0]?.id,
   holderType,revision:Number(revision),features:features.split(',').map(v=>v.trim()).filter(Boolean),
   termDays:Number(termDays),productSeats:Number(productSeats),employeeLimit:Number(employeeLimit),
   deviceLimit:Number(deviceLimit),quotas:preparedQuotas},'Редакция тарифа сохранена. Лицензия не выдана.');
 }
 return <div data-testid="publisher-tariffs">
  <section className="card form-panel">
   <h2>Тарифы и лимиты</h2>
   <p className="muted">Один каталог для организаций и физических лиц. Сохранённая редакция не изменяет уже подготовленные условия.</p>
   {draft.products.length===0?<p className="muted">Сначала добавьте продукт.</p>:<form onSubmit={saveTariff}>
    <div className="form-grid">
     <label>Продукт<select value={productId||draft.products[0].id} onChange={e=>setProductId(e.target.value)}>{draft.products.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
     <label>Код тарифа<input value={id} onChange={e=>setId(e.target.value)} required placeholder="TEAM"/></label>
     <label>Название тарифа<input value={name} onChange={e=>setName(e.target.value)} required placeholder="Команда"/></label>
     <label>Клиент<select value={holderType} onChange={e=>{const t=e.target.value as 'PERSON'|'ORGANIZATION';setHolderType(t);setProductSeats(t==='PERSON'?'1':'5');setEmployeeLimit(t==='PERSON'?'0':'10');setDeviceLimit(t==='PERSON'?'2':'0');}}><option value="ORGANIZATION">Организация</option><option value="PERSON">Физическое лицо</option></select></label>
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
    <button type="submit" disabled={busy} className="primary">Сохранить редакцию тарифа</button>
   </form>}
  </section>
  <section className="card padded"><h2>Сохранённые тарифы ({draft.tariffs.length})</h2>
   {draft.tariffs.length===0?<p className="muted">Тарифов пока нет.</p>:draft.tariffs.map(t=><div className="simple-row" key={t.id+':'+t.revision}><div><strong>{t.name} · редакция {t.revision}</strong><small>{draft.products.find(p=>p.id===t.productId)?.name||t.productId} · {t.holderType==='PERSON'?'Физическое лицо':'Организация'} · {t.termDays} дней</small><small>Мест: {t.productSeats} · сотрудников: {t.employeeLimit} · устройств: {t.deviceLimit} · функций: {t.features.length} · квот: {t.quotas.length}</small></div><span className="status neutral">Черновик</span></div>)}
  </section>
  <section className="card form-panel" data-testid="publisher-tariff-proposal"><h2>Подготовить лицензию</h2>
   <p className="muted">Условия выбранной редакции сохраняются в запросе. Лицензия без подписи не действует.</p>
   {draft.tariffs.length===0?<p className="muted">Сначала создайте тариф.</p>:<>
    <div className="form-grid">
     <label>Тариф<select value={selected?selected.id+':'+selected.revision:''} onChange={e=>{setChoice(e.target.value);setHolderId('');}}>{draft.tariffs.map(t=><option key={t.id+':'+t.revision} value={t.id+':'+t.revision}>{t.name} · редакция {t.revision} · {t.holderType==='PERSON'?'Личный':'Для организации'}</option>)}</select></label>
     <label>Клиент<select value={selectedHolder} onChange={e=>setHolderId(e.target.value)}>{holders.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}</select></label>
    </div>
    <p className="muted">{selected?.holderType==='PERSON'?'Личный подписанный .iwxa принимается непосредственно продуктом, без Admin Center.':'Организационный подписанный .iwxa передаётся в Admin Center для распределения.'}</p>
    <button className="primary" type="button" disabled={busy||!selectedHolder} onClick={()=>void change({kind:'addTariffProposal',tariffId:selected.id,revision:selected.revision,holderId:selectedHolder},'Черновик условий сохранён. Лицензия не выдана.')}>Сохранить подготовку по тарифу</button>
   </>}
  </section>
 </div>;
}
