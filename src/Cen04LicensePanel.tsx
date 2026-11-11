import React,{useEffect,useState} from 'react';
import {prepareAdminPublisherTestRequest} from '../runtime/cen04-issuer-request.mjs';

// Center does not receive a license merely by opening a .iwxa file. Verified
// intake is available only when an original private T3 Consumer executable
// was assembled into this installed Tauri bundle with out-of-band trust.
const MAX_TEST_IWXA=4*1024*1024;
type Preview={size:number;source:'IWXA_SELECTED_NOT_VERIFIED'};
type License={licenseId:string;status:'ACTIVE'|'SUSPENDED'|'REVOKED';
 sequence:number;claimedSeats:number;signatureVerified:true;statusVerified:true};
type View={organizationId:string;productId:string;licenses:License[];
 revision:number;activeSeats:0;assignableSeats:0;productionActivation:false};
type Props={organizationId:string;organizationName:string;
 organizationKind:'GROUP'|'ORGANIZATION';
 invoke:((command:string,args?:Record<string,unknown>)=>Promise<any>)|null};
const error=(e:unknown)=>e instanceof Error?e.message:String(e);
export default function Cen04LicensePanel({organizationId,organizationName,organizationKind,invoke}:Props){
 const [testSeats,setTestSeats]=useState('1');
 const [testTerm,setTestTerm]=useState('30');
 const [testVersion,setTestVersion]=useState('0.3.0');
 const [preview,setPreview]=useState<Preview|null>(null);
 const [verified,setVerified]=useState<View|null>(null);
 const [ready,setReady]=useState(false);
 const [busy,setBusy]=useState(false);
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
   setReady(false);setVerified(null);setPreview(null);setMessage('');setFailure('');
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
 async function exportUnsignedRequest(){
   if(!invoke||busy)return;
   setBusy(true);setFailure('');setMessage('');
   try{
     // This is the existing Publisher/T3 unsigned TEST profile. Admin Center
     // does not create a new license format, issuer or authority.
     const prepared=prepareAdminPublisherTestRequest({
       organization:{kind:organizationKind,id:organizationId,name:organizationName},
       requestId:'request:admin:'+crypto.randomUUID(),
       requestedAt:new Date().toISOString(),
       version:testVersion,termDays:Number(testTerm),seats:Number(testSeats)
     });
     const saved=await invoke('center_export_publisher_test_request',{
       content:prepared.content,suggestedFileName:prepared.suggestedFileName});
     setMessage(saved?'Неподписанный запрос сохранён. Откройте этот JSON в Publisher и передайте в T3 для подписания.':
       'Сохранение запроса отменено. Подпись и права не создавались.');
   }catch(e){setFailure('Запрос Publisher не сохранён: '+error(e));}
   finally{setBusy(false);}
 }
 async function openPreview(){
   if(!invoke||busy)return;
   setBusy(true);setPreview(null);setFailure('');setMessage('');
   try{
     const raw=await invoke('center_open_iwxa_file');
     if(raw===null){setMessage('Выбор пакета отменён.');return;}
     if(!Array.isArray(raw)||raw.length<4||raw.length>MAX_TEST_IWXA||
       raw.slice(0,4).some((v,i)=>v!==[80,75,3,4][i])||
       !raw.every(v=>Number.isInteger(v)&&v>=0&&v<=255))
       throw Error('CEN04_IWXA_CARRIER_BYTES_INVALID');
     // Preview bytes are intentionally discarded; the original T3 Host
     // independently reads the selected .iwxa from a native file dialog.
     setPreview({size:raw.length,source:'IWXA_SELECTED_NOT_VERIFIED'});
     setMessage('Пакет открыт только для предварительного просмотра.');
   }catch(e){setFailure('Не удалось открыть .iwxa: '+error(e));}
   finally{setBusy(false);}
 }
 async function importVerified(){
   if(!invoke||!ready||busy)return;
   setBusy(true);setFailure('');setMessage('');
   try{
     const receipt=await invoke('center_cen04_t3_import',{organizationId});
     if(receipt===null){setMessage('Импорт отменён.');return;}
     if(receipt?.operation!=='TEST_RECEIVE'||receipt.organizationId!==organizationId||
        receipt.signatureVerified!==true||receipt.statusVerified!==true||
        receipt.activeSeats!==0||receipt.productionActivation!==false)
       throw Error('CEN04_NATIVE_T3_SIGNED_RECEIPT_REQUIRED');
     // The original T3 receive receipt proves signed verification and exact
     // encrypted-store readback for THIS license. Historical unrelated
     // expired statuses may still prevent rendering the full list.
     setPreview(null);
     let listFailure='';
     try{await readHost();}
     catch(e){setVerified(null);listFailure=readFailure(e);}
     if(listFailure)setFailure(listFailure);
     setMessage('TEST-лицензия проверена T3, сохранена в зашифрованном Store и подтверждена повторным чтением T3.');
   }catch(e){setFailure('T3 не принял лицензию: '+error(e));}
   finally{setBusy(false);}
 }
 return <section className="card padded" data-testid="cen04-test-license-panel">
   <h3>Лицензии Admin Center от Publisher</h3>
   <p className="muted">Подписанные TEST-лицензии передаются в едином формате .iwxa.
      Подлинность и статус независимо проверяет T3 по ранее установленному доверию.
      Коммерческая активация не выполняется.</p>
   <div className="notice subdued" data-testid="cen04-publisher-request">
     <strong>Запрос лицензии в Publisher</strong>
     <p>Admin Center передаёт только неподписанный TEST-запрос с точным идентификатором выбранной организации.
       Publisher подписывает его через исходный T3; доступ к данным организации этим не предоставляется.</p>
     <>
       <div className="form-grid">
         <label>Версия Admin Center
           <input aria-label="Версия продукта для Publisher" value={testVersion} maxLength={64}
             onChange={e=>setTestVersion(e.target.value)} disabled={busy}/>
         </label>
         <label>Срок в днях
           <input aria-label="Срок TEST-запроса" type="number" min={1} max={3650} step={1}
             value={testTerm} onChange={e=>setTestTerm(e.target.value)} disabled={busy}/>
         </label>
         <label>Заявленных TEST-мест
           <input aria-label="Места TEST-запроса" type="number" min={1} max={10000} step={1}
             value={testSeats} onChange={e=>setTestSeats(e.target.value)} disabled={busy}/>
         </label>
       </div>
       <p className="muted">Функция запроса: WORKSPACE. Группа тоже может быть техническим получателем; TEST-запрос не подтверждает юридический статус, организационные полномочия или коммерческие места.</p>
       <button type="button" className="secondary" data-testid="cen04-export-publisher-request"
         onClick={exportUnsignedRequest} disabled={!invoke||busy}>
         Сохранить запрос для Publisher
       </button>
     </>
   </div>
   <div className="actions">
     <button type="button" className="secondary" data-testid="cen04-select-test-iwxa"
       onClick={openPreview} disabled={!invoke||busy}>{busy?'Открываем…':'Предпросмотр .iwxa'}</button>
     <button type="button" className="secondary" data-testid="cen04-import-verified-iwxa"
       onClick={importVerified} disabled={!ready||busy}>
       Проверить и сохранить через T3
     </button>
   </div>
   {!invoke&&<p className="muted">Файловые операции доступны только в установленном Admin Center.</p>}
   {!ready&&<p className="muted" data-testid="cen04-native-consumer-unavailable">
      Оригинальный получатель T3 ещё не включён в установку или доверие издателя не настроено.
      Проверка и сохранение недоступны.
   </p>}
   {ready&&!verified&&<p className="muted" data-testid="cen04-intake-ready">
      T3 Consumer подключён. Импорт нового подписанного .iwxa доступен даже при истёкшем статусе ранее сохранённой лицензии.
   </p>}
   {message&&<p role="status">{message}</p>}
   {failure&&<p role="alert">{failure}</p>}
   {preview&&<div data-testid="cen04-iwxa-unverified">
      <p><strong>Пакет выбран. Проверка T3 ещё не выполнялась.</strong></p>
      <p>Размер: {preview.size} байт. Организация: {organizationId}.</p>
      <p><strong>Подтверждённых мест: 0.</strong></p>
   </div>}
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
