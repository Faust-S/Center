import React,{useEffect,useRef,useState} from 'react';

// Signed license bytes never enter WebView: only original T3 Consumer may
// intake a signed package after separate first-use enrollment. The raw .iwxa
// preview is intentionally absent because it copied license bytes over IPC.
type License={licenseId:string;status:'ACTIVE'|'SUSPENDED'|'REVOKED';
 sequence:number;claimedSeats:number;signatureVerified:true;statusVerified:true};
type View={organizationId:string;productId:string;licenses:License[];
 revision:number;activeSeats:0;assignableSeats:0;productionActivation:false};
type Props={organizationId:string;invoke:((command:string,args?:Record<string,unknown>)=>Promise<any>)|null};
const error=(e:unknown)=>e instanceof Error?e.message:String(e);
export default function Cen04LicensePanel({organizationId,invoke}:Props){
 const [verified,setVerified]=useState<View|null>(null);
 const [ready,setReady]=useState(false);
 const [busy,setBusy]=useState(false);
 const [trustSha,setTrustSha]=useState('');
 const actionRef=useRef(false);
 const [latest,setLatest]=useState<{licenseId:string;status:string;outcome:string}|null>(null);
 const [message,setMessage]=useState('');
 const [failure,setFailure]=useState('');
 const readFailure=(e:unknown)=>{
   const code=error(e);
   if(code.includes('PRODUCT_STATUS_STALE'))
     return 'Срок проверки сохранённого TEST-статуса истёк. Получите новый подписанный .iwxa в Publisher. Ранее сохранённые данные не изменены.';
   return 'Не удалось прочитать подтверждённые статусы T3: '+code;
 };
 const checkedView=(result:any):View=>{
   const value=result?.view as View;
   if(result?.operation!=='TEST_READ'||result.productionActivation!==false||
      result.activeSeats!==0||value?.organizationId!==organizationId||
      value.productId!=='IWXA_ADMIN_CENTER'||value.productionActivation!==false||
      value.activeSeats!==0||!Array.isArray(value.licenses))
     throw Error('CEN04_T3_VERIFIED_READBACK_REQUIRED');
   return value;
 };
 async function readHost(){
   if(!invoke)throw Error('CEN04_NATIVE_HOST_REQUIRED');
   const result=await invoke('center_cen04_t3_read',{organizationId});
   const value=checkedView(result);
   setVerified(value);
 }
 useEffect(()=>{
   setReady(false);setVerified(null);setLatest(null);setMessage('');setFailure('');
   let live=true;
   if(invoke){
     (async()=>{
       try{
         const caps=await invoke('center_cen04_t3_capabilities',{organizationId});
         if(caps?.operation!=='TEST_CAPABILITIES'||caps.organizationId!==organizationId||
            caps.productId!=='IWXA_ADMIN_CENTER'||caps.intakeConfigured!==true||
            caps.activeSeats!==0||caps.assignableSeats!==0||
            caps.productionActivation!==false)
           throw Error('CEN04_T3_INTAKE_CAPABILITIES_INVALID');
         if(!live)return;
         setReady(true);
         // A stale historical record does NOT take away the ability to
         // import a fresh signed status via the independently trusted T3 Host.
         try{
           const result=await invoke('center_cen04_t3_read',{organizationId});
           if(live)setVerified(checkedView(result));
         }catch(e){if(live)setFailure(readFailure(e));}
       }catch(e){
         if(!live)return;
         setReady(false);
         if(!error(e).includes('T3_PRODUCT_NATIVE_COMPONENT_NOT_CONFIGURED'))
           setFailure('Подключение T3 недоступно: '+error(e));
       }
     })();
   }
   return ()=>{live=false;};
 },[organizationId,invoke]);
 async function configureTrust(){
   if(!invoke||ready||busy||actionRef.current)return;
   const expectedSha256=trustSha.trim().toLowerCase();
   if(!/^[a-f0-9]{64}$/.test(expectedSha256)){
     setFailure('Введите полный SHA-256 публичного файла доверия из независимого источника Publisher.');
     return;
   }
   actionRef.current=true;setBusy(true);setFailure('');setMessage('');
   try{
     const receipt=await invoke('center_cen04_t3_enroll',{
       organizationId,expectedSha256});
     if(receipt===null){setMessage('Настройка доверия отменена.');return;}
     if(receipt?.operation!=='TEST_ENROLLED'||
        receipt.organizationId!==organizationId||
        receipt.fingerprint!==expectedSha256||
        receipt.intakeConfigured!==true||receipt.publicOnly!==true||
        receipt.activeSeats!==0||receipt.assignableSeats!==0||
        receipt.productionActivation!==false)
       throw Error('CEN04_T3_FIRST_USE_RECEIPT_INVALID');
     const caps=await invoke('center_cen04_t3_capabilities',{organizationId});
     if(caps?.operation!=='TEST_CAPABILITIES'||caps.organizationId!==organizationId||
        caps.productId!=='IWXA_ADMIN_CENTER'||caps.intakeConfigured!==true||
        caps.productionActivation!==false||caps.activeSeats!==0||
        caps.assignableSeats!==0)
       throw Error('CEN04_T3_FIRST_USE_CAPABILITIES_INVALID');
     setReady(true);
     setTrustSha('');
     setMessage('Публичное доверие T3 установлено по проверенному SHA-256. Локальный ключ защищён Windows DPAPI; теперь можно получать подписанные TEST-лицензии.');
     try{await readHost();}
     catch(e){setVerified(null);setFailure(readFailure(e));}
   }catch(e){setFailure('Не удалось подключить доверие T3: '+error(e));}
   finally{actionRef.current=false;setBusy(false);}
 }
 async function importVerified(encrypted=false){
   if(!invoke||!ready||busy||actionRef.current)return;
   actionRef.current=true;
   setBusy(true);setFailure('');setMessage('');
   try{
     const receipt=await invoke(encrypted?'center_cen04_t3_import_age':'center_cen04_t3_import',{organizationId});
     if(receipt===null){setMessage('Импорт отменён.');return;}
     if(receipt?.operation!=='TEST_RECEIVE'||receipt.organizationId!==organizationId||
        receipt.signatureVerified!==true||receipt.statusVerified!==true||
        receipt.activeSeats!==0||receipt.productionActivation!==false||
        typeof receipt.licenseId!=='string'||!receipt.licenseId||
        !['ACTIVE','SUSPENDED','REVOKED'].includes(receipt.status)||
        !['VERIFIED_TEST_SAVED','ALREADY_RECEIVED'].includes(receipt.outcome))
       throw Error('CEN04_NATIVE_T3_SIGNED_RECEIPT_REQUIRED');
     // The original T3 receive receipt proves signed verification and exact
     // encrypted-store readback for THIS license. Historical unrelated
     // expired statuses may still prevent rendering the full list.
     setLatest({licenseId:receipt.licenseId,status:receipt.status,outcome:receipt.outcome});
     let listFailure='';
     try{await readHost();}
     catch(e){setVerified(null);listFailure=readFailure(e);}
     if(listFailure)setFailure(listFailure);
     const label=encrypted?'Защищённый пакет .iwxa.age расшифрован T3. ':'';
     const outcome=receipt.outcome==='ALREADY_RECEIVED'
       ?'Повторный пакет уже был принят T3; новая запись не создавалась.'
       :'Подписанная TEST-лицензия проверена и сохранена оригинальным T3 Consumer.';
     setMessage(label+outcome+(listFailure?
       ' Квитанция подтверждает сохранение; обновить общий список пока не удалось.':
       ' Общий список повторно прочитан из T3.'));
   }catch(e){setFailure('T3 не принял лицензию: '+error(e));}
   finally{actionRef.current=false;setBusy(false);}
 }
 async function refreshVerified(){
   if(!invoke||!ready||busy||actionRef.current)return;
   actionRef.current=true;setBusy(true);setFailure('');
   try{await readHost();}
   catch(e){setVerified(null);setFailure(readFailure(e));}
   finally{actionRef.current=false;setBusy(false);}
 }
 return <section className="card padded" data-testid="cen04-test-license-panel">
   <h3>Лицензии Admin Center от Publisher</h3>
   <p className="muted">Подписанные TEST-лицензии передаются в едином формате .iwxa.
      Подлинность и статус независимо проверяет T3 по ранее установленному доверию.
      Для защищённой доставки используется .iwxa.age: T3 расшифровывает пакет,
      проверяет подпись и статус и сохраняет лицензию без промежуточного файла в интерфейсе.
      Коммерческая активация не выполняется.</p>
   <div className="actions">
     <button type="button" className="secondary" data-testid="cen04-import-verified-age"
       onClick={()=>void importVerified(true)} disabled={!ready||busy}>
       Получить защищённую .iwxa.age через T3
     </button>
     <button type="button" className="secondary" data-testid="cen04-import-verified-iwxa"
       onClick={()=>void importVerified(false)} disabled={!ready||busy}>
       Проверить и сохранить через T3
     </button>
     <button type="button" className="secondary" data-testid="cen04-refresh-t3"
       onClick={()=>void refreshVerified()} disabled={!ready||busy}>
       Обновить лицензии
     </button>
   </div>
   {!invoke&&<p className="muted">Файловые операции доступны только в установленном Admin Center.</p>}
   {!ready&&<div className="nested-form" data-testid="cen04-native-consumer-unavailable">
      <p className="muted">Оригинальный T3 Consumer ещё не подключён либо доверие издателя
        не установлено. Настройте его отдельно от получаемой лицензии.</p>
      {invoke&&<>
        <label>SHA-256 публичного файла доверия издателя
          <input data-testid="cen04-trust-sha256" value={trustSha}
            spellCheck={false} autoComplete="off"
            placeholder="64 символа SHA-256"
            onChange={e=>setTrustSha(e.target.value)}
            disabled={busy}/>
        </label>
        <button type="button" className="secondary"
          data-testid="cen04-enroll-trust"
          onClick={()=>void configureTrust()}
          disabled={busy||!(/^[a-f0-9]{64}$/.test(trustSha.trim().toLowerCase()))}>
          Подключить доверие издателя T3
        </button>
        <p className="muted">Выберите публичный файл publisher-test-trust.json.
          Сверьте SHA-256 с издателем независимым способом. Сам пакет .iwxa.age
          не устанавливает доверие и не даёт коммерческих прав.</p>
      </>}
   </div>}
   {ready&&!verified&&<p className="muted" data-testid="cen04-intake-ready">
      T3 Consumer подключён. Импорт нового подписанного .iwxa доступен даже при истёкшем статусе ранее сохранённой лицензии.
   </p>}
   {message&&<p role="status">{message}</p>}
   {latest&&<p data-testid="cen04-last-native-receipt" className="muted">
      Лицензия: {latest.licenseId}. Подписанный статус: {latest.status}.
      {latest.outcome==='ALREADY_RECEIVED'?' Повторная передача без новой записи.':''}
   </p>}
   {failure&&<p role="alert">{failure}</p>}
   {ready&&verified&&<div data-testid="cen04-t3-verified">
     <p><strong>Оригинальный T3 Consumer подключён.</strong>
       Сохранённых TEST-лицензий: {verified.licenses.length}. Коммерческих мест: 0.</p>
     {verified.licenses.map(row=><div className="simple-row" key={row.licenseId}>
       <div><strong>{row.licenseId}</strong>
         <small>{row.status} · подтверждённая последовательность {row.sequence} ·
           заявлено TEST-мест: {row.claimedSeats}</small></div>
       <span className="status neutral">Подпись T3 проверена</span>
     </div>)}
   </div>}
   <div className="notice subdued">
     TEST-лицензии не дают права назначать места Personal Agent. Активных мест: 0.
   </div>
 </section>;
}
