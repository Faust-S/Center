import React,{useEffect,useRef,useState} from 'react';
import {checkCorporateCarrierExpectation,checkCorporateCarrierMatch}
  from '../runtime/cen04-corporate-carrier.mjs';
import {inspectCorporateEnrollment,inspectCorporateCapabilities,
  inspectCorporatePinnedTrust,inspectCorporateRead,inspectCorporateReceived}
  from '../runtime/cen04-corporate-receipt.mjs';

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
 const [corporateSha,setCorporateSha]=useState('');
 const [corporateBytes,setCorporateBytes]=useState('');
 const [corporateTrustSha,setCorporateTrustSha]=useState('');
 const [corporateReady,setCorporateReady]=useState(false);
 const [corporateRead,setCorporateRead]=useState<ReturnType<typeof inspectCorporateRead>|null>(null);
 const [corporateLatest,setCorporateLatest]=useState<ReturnType<typeof inspectCorporateReceived>|null>(null);
 const [corporateFile,setCorporateFile]=useState<{
   organizationId:string;packageSha256:string;bytes:number;
   signedLicenseAccepted:false;assignablePersonalAgentSeats:0
 }|null>(null);
 const [corporateMessage,setCorporateMessage]=useState('');
 const [corporateFailure,setCorporateFailure]=useState('');
 const actionRef=useRef(false);
 // Ignore old source responses if the manager switches organizations while
 // a native file picker, trusted enrollment or Store read is in flight.
 const latestOrgRef=useRef(organizationId);
 latestOrgRef.current=organizationId;
 const sameOrg=()=>latestOrgRef.current===organizationId;
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
   setCorporateFile(null);setCorporateSha('');setCorporateBytes('');
   setCorporateMessage('');setCorporateFailure('');
   setCorporateTrustSha('');setCorporateReady(false);
   setCorporateRead(null);setCorporateLatest(null);
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
   // TEST availability is independent of CORPORATE PRODUCTION. A fresh
   // corporate recipient may exist with no TEST trust and vice versa.
   if(invoke){
     (async()=>{
       try{
         const caps=await invoke('center_cen04_corporate_t3_capabilities',{organizationId});
         inspectCorporateCapabilities(caps,organizationId);
         if(!live)return;
         setCorporateReady(true);
         try{
           const result=await invoke('center_cen04_corporate_t3_read',{organizationId});
           const evidence=inspectCorporateRead(result,organizationId);
           if(live)setCorporateRead(evidence);
         }catch(e){if(live)setCorporateFailure('Не удалось прочитать корпоративный T3: '+error(e));}
       }catch{
         if(live)setCorporateReady(false);
       }
     })();
   }
   return ()=>{live=false;};
 },[organizationId,invoke]);
 async function verifyCorporateFile(){
   if(!invoke||busy||actionRef.current)return;
   const expectedSha256=corporateSha.trim().toLowerCase();
   const expectedBytes=Number(corporateBytes);
   let expectation;
   try{
     expectation=checkCorporateCarrierExpectation({
       organizationId,sha256:expectedSha256,bytes:expectedBytes
     });
     if(!/^[1-9][0-9]*$/.test(corporateBytes))throw Error('CEN04_CORPORATE_BYTES_REQUIRED');
   }catch(e){setCorporateFailure('Проверьте SHA-256 и размер файла из Publisher: '+error(e));return;}
   actionRef.current=true;setBusy(true);setCorporateFile(null);
   setCorporateMessage('');setCorporateFailure('');
   try{
     const value=await invoke('center_cen04_corporate_verify_carrier',{
       organizationId,expectedSha256,expectedBytes
     });
     if(value===null){setCorporateMessage('Выбор файла отменён.');return;}
     const matched=checkCorporateCarrierMatch(value,expectation);
     setCorporateFile(matched);
     setCorporateMessage('Байты выбранного файла совпали с введёнными SHA-256 '+
       'и размером из Publisher. Подпись и права пока не проверены T3.');
   }catch(e){
     setCorporateFailure('Контрольная сумма файла не совпала либо файл недоступен: '+error(e));
   }finally{actionRef.current=false;setBusy(false);}
 }
 // First use installs a PUBLIC corporate issuer fingerprint, never rights.
 async function enrollCorporateTrust(){
   if(!invoke||corporateReady||busy||actionRef.current)return;
   const fingerprint=corporateTrustSha.trim().toLowerCase();
   if(!/^[a-f0-9]{64}$/.test(fingerprint)){
     setCorporateFailure('Введите SHA-256 публичного доверия издателя, полученный независимо от .iwxa.');
     return;
   }
   actionRef.current=true;setBusy(true);
   setCorporateMessage('');setCorporateFailure('');
   try{
     const value=await invoke('center_cen04_corporate_t3_enroll',{
       organizationId,expectedSha256:fingerprint
     });
     if(!sameOrg())return;
     if(value===null){setCorporateMessage('Выбор публичного доверия отменён.');return;}
     inspectCorporateEnrollment(value,organizationId,fingerprint);
     const caps=await invoke('center_cen04_corporate_t3_capabilities',{organizationId});
     const installed=inspectCorporateCapabilities(caps,organizationId);
     if(installed.fingerprint!==fingerprint)
       throw Error('CEN04_CORPORATE_TRUST_FINGERPRINT_MISMATCH');
     if(!sameOrg())return;
     setCorporateReady(true);setCorporateTrustSha('');
     setCorporateMessage('Доверие корпоративного издателя установлено в оригинальном T3. '+
       'Лицензия ещё не получена, права и места не назначены.');
     try{
       const read=await invoke('center_cen04_corporate_t3_read',{organizationId});
       const evidence=inspectCorporateRead(read,organizationId);
       if(sameOrg())setCorporateRead(evidence);
     }catch(e){if(sameOrg())setCorporateFailure('Не удалось перечитать корпоративный T3: '+error(e));}
   }catch(e){
     if(!sameOrg())return;
     // First-use may have committed before its ACK was lost. Re-read the
     // ORIGINAL organization-scoped trust and match the exact independently
     // supplied fingerprint before treating an enrollment as recovered.
     try{
       const caps=await invoke('center_cen04_corporate_t3_capabilities',{organizationId});
       const installed=inspectCorporateCapabilities(caps,organizationId);
       if(installed.fingerprint!==fingerprint)
         throw Error('CEN04_CORPORATE_TRUST_FINGERPRINT_MISMATCH');
       if(!sameOrg())return;
       setCorporateReady(true);setCorporateTrustSha('');
       setCorporateMessage('Исходный T3 подтвердил уже установленное доверие по SHA-256. '+
         'Повторное создание ключей или Store не требуется.');
       try{
         const read=await invoke('center_cen04_corporate_t3_read',{organizationId});
         const evidence=inspectCorporateRead(read,organizationId);
         if(sameOrg())setCorporateRead(evidence);
       }catch(readError){
         if(sameOrg())setCorporateFailure('Доверие подтверждено, но readback T3 не удался: '+error(readError));
       }
     }catch(recoverError){
       if(sameOrg())setCorporateFailure('Не удалось подтвердить корпоративное доверие T3: '+
         error(e)+'; контрольный readback: '+error(recoverError));
     }
   }
   finally{actionRef.current=false;setBusy(false);}
 }
 async function receiveCorporate(){
   if(!invoke||!corporateReady||busy||actionRef.current)return;
   const expectedSha256=corporateSha.trim().toLowerCase();
   const expectedBytes=Number(corporateBytes);
   try{
     checkCorporateCarrierExpectation({organizationId,
       sha256:expectedSha256,bytes:expectedBytes});
     if(!/^[1-9][0-9]*$/.test(corporateBytes))
       throw Error('CEN04_CORPORATE_BYTES_REQUIRED');
   }catch(e){setCorporateFailure('Сверьте SHA-256 и размер из Publisher: '+error(e));return;}
   actionRef.current=true;setBusy(true);
   setCorporateFailure('');setCorporateMessage('');
   setCorporateLatest(null);setCorporateFile(null);
   try{
     // The original T3 Host reopens and checks the SAME physical file bytes
     // in one receive action. Earlier transport-only comparison is ignored.
     const result=await invoke('center_cen04_corporate_t3_receive',{
       organizationId,expectedSha256,expectedBytes
     });
     if(!sameOrg())return;
     if(result===null){setCorporateMessage('Получение корпоративного файла отменено.');return;}
     const saved=inspectCorporateReceived(result,organizationId,expectedSha256);
     setCorporateLatest(saved);
     try{
       const read=await invoke('center_cen04_corporate_t3_read',{organizationId});
       const evidence=inspectCorporateRead(read,organizationId);
       if(!sameOrg())return;
       setCorporateRead(evidence);
       setCorporateMessage(saved.outcome==='ALREADY_RECEIVED'
         ?'Исходные LICENSE и STATUS уже сохранены в T3. Новая запись не создана.'
         :'Подписи LICENSE и STATUS проверены оригинальным T3, запись сохранена и прочитана.');
     }catch(e){
       if(sameOrg()){
         setCorporateRead(null);
         setCorporateFailure('Лицензия подтверждена исходной квитанцией, но общий readback не удался: '+error(e));
       }
     }
   }catch(e){if(sameOrg())setCorporateFailure('T3 не принял корпоративную лицензию: '+error(e));}
   finally{actionRef.current=false;setBusy(false);}
 }
 async function refreshCorporate(){
   if(!invoke||!corporateReady||busy||actionRef.current)return;
   actionRef.current=true;setBusy(true);
   setCorporateFailure('');
   try{
     const value=await invoke('center_cen04_corporate_t3_read',{organizationId});
     const evidence=inspectCorporateRead(value,organizationId);
     if(sameOrg())setCorporateRead(evidence);
   }catch(e){if(sameOrg()){
     setCorporateRead(null);setCorporateFailure('Корпоративное чтение T3: '+error(e));
   }}
   finally{actionRef.current=false;setBusy(false);}
 }
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
   <div className="nested-form" data-testid="cen04-corporate-file-preflight">
     <h4>Корпоративная лицензия: сверка файла</h4>
     <p className="muted">Корпоративное получение выполняет исключительно
       оригинальный T3 Consumer, отдельно от TEST-лицензий.</p>
     {!corporateReady&&<div className="nested-form"
       data-testid="cen04-corporate-native-first-use">
       <strong>1. Подключение корпоративного издателя</strong>
       <p className="muted">Получите SHA-256 файла publisher-corporate-trust.json
         независимо от передаваемого .iwxa и установите исходное публичное
         доверие в Windows T3.</p>
       <label>SHA-256 публичного доверия
         <input data-testid="cen04-corporate-trust-sha256"
           value={corporateTrustSha} spellCheck={false}
           autoComplete="off" disabled={busy||!invoke}
           placeholder="64 символа"
           onChange={e=>setCorporateTrustSha(e.target.value)}/>
       </label>
       <button type="button" className="secondary"
         data-testid="cen04-corporate-enroll-trust"
         disabled={!invoke||busy||
           !/^[a-f0-9]{64}$/.test(corporateTrustSha.trim().toLowerCase())}
         onClick={()=>void enrollCorporateTrust()}>
         Установить доверие корпоративного издателя
       </button>
     </div>}
     {corporateReady&&<p className="muted"
       data-testid="cen04-corporate-original-ready">
       Корпоративный T3 Consumer подключён к выбранной организации.
       Получение подписанного файла выполняется отдельно.</p>}
     <p className="muted">2. После выпуска лицензии в Publisher перенесите
       контрольную сумму и размер сохранённого .iwxa. Admin Center сравнит
       их с выбранным файлом. Это первый этап передачи, до получения и
       проверки подписанной лицензии в корпоративном T3 Consumer.</p>
     <label>SHA-256 корпоративного .iwxa из Publisher
       <input data-testid="cen04-corporate-sha256" value={corporateSha}
         autoComplete="off" spellCheck={false} disabled={busy}
         placeholder="64 символа"
         onChange={e=>{setCorporateSha(e.target.value);setCorporateFile(null);
           setCorporateLatest(null);
           setCorporateMessage('');setCorporateFailure('');}}/>
     </label>
     <label>Размер файла из Publisher (байт)
       <input data-testid="cen04-corporate-bytes" value={corporateBytes}
         inputMode="numeric" autoComplete="off" disabled={busy}
         placeholder="Например, 7312"
         onChange={e=>{setCorporateBytes(e.target.value);setCorporateFile(null);
           setCorporateLatest(null);
           setCorporateMessage('');setCorporateFailure('');}}/>
     </label>
     <button type="button" className="secondary"
       data-testid="cen04-corporate-verify-carrier"
       disabled={!invoke||busy||
         !/^[a-f0-9]{64}$/.test(corporateSha.trim().toLowerCase())||
         !/^[1-9][0-9]*$/.test(corporateBytes)||
         Number(corporateBytes)>4*1024*1024}
       onClick={()=>void verifyCorporateFile()}>
       Выбрать .iwxa и сверить с Publisher
     </button>
     <button type="button" className="secondary"
       data-testid="cen04-corporate-native-receive"
       disabled={!invoke||!corporateReady||busy||
         !/^[a-f0-9]{64}$/.test(corporateSha.trim().toLowerCase())||
         !/^[1-9][0-9]*$/.test(corporateBytes)||
         Number(corporateBytes)>4*1024*1024}
       onClick={()=>void receiveCorporate()}>
       Получить подписанную корпоративную лицензию через T3
     </button>
     <button type="button" className="secondary"
       data-testid="cen04-corporate-native-read"
       disabled={!invoke||!corporateReady||busy}
       onClick={()=>void refreshCorporate()}>
       Обновить корпоративные лицензии из T3
     </button>
     {corporateFile&&<div className="cen04-carrier-match"
       data-testid="cen04-corporate-file-matched">
       <strong>Контрольная сумма и размер файла совпали</strong>
       <p>Размер: {corporateFile.bytes} байт.
         Выбранная организация Admin Center: {corporateFile.organizationId}.</p>
       <p className="muted">SHA-256: <code className="cen04-sha">
         {corporateFile.packageSha256}</code></p>
       <p>Принадлежность пакета этой организации, подпись, STATUS
         и получение лицензии пока не проверены оригинальным T3.
         Доступных к назначению мест: 0.</p>
     </div>}
     {corporateMessage&&<p role="status">{corporateMessage}</p>}
     {corporateFailure&&<p role="alert">{corporateFailure}</p>}
     {corporateLatest&&<div className="cen04-carrier-match"
       data-testid="cen04-corporate-original-received">
       <strong>Подписанные LICENSE и STATUS получены оригинальным T3</strong>
       <p>Лицензия: {corporateLatest.licenseId}.
         STATUS: {corporateLatest.status},
         последовательность: {corporateLatest.sequence}.
         Редакция Store: {corporateLatest.revision}.</p>
       <p className="muted">Подпись проверена, пакет сохранён.
         Применение лицензии организацией и распределение мест не выполнялись.</p>
     </div>}
     {corporateReady&&corporateRead&&<div
       data-testid="cen04-corporate-original-list">
       <p><strong>Исходное корпоративное чтение T3.</strong>
         Лицензий: {corporateRead.licenses.length}.
         Редакция Store: {corporateRead.revision}.
         Назначаемых мест Personal Agent: 0.</p>
       {corporateRead.licenses.map((row:{licenseId:string;issuerAuthorityId:string;
         tariffId:string;status:string;sequence:number;current:boolean})=><div className="simple-row"
         key={row.licenseId}>
         <div><strong>{row.licenseId}</strong>
           <small>Издатель: {row.issuerAuthorityId};
             тариф: {row.tariffId};
             STATUS: {row.status};
             последовательность: {row.sequence}.
             {row.current?' Подпись действительна на момент чтения.':
               ' Сохранена история, текущие права не подтверждены.'}
           </small>
         </div>
         <span className="status neutral">Получено T3</span>
       </div>)}
     </div>}
     {!invoke&&<p className="muted">
       Выбор файла доступен в установленном Admin Center.</p>}
   </div>
   <h4>TEST-лицензии</h4>
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
