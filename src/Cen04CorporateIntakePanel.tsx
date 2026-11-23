import React,{useEffect,useRef,useState} from 'react';
import {checkCorporateCarrierExpectation,checkCorporateCarrierMatch}
 from '../runtime/cen04-corporate-carrier.mjs';
import {inspectCorporateEnrollment,inspectCorporateCapabilities,
 inspectCorporatePinnedTrust,inspectCorporateRead,inspectCorporateReceived}
 from '../runtime/cen04-corporate-receipt.mjs';

// This is only the UI of the ORIGINAL T3 corporate Consumer profile.
// Admin Center 0.4.1 retains its separate Publisher TEST request workflow.
type Props={organizationId:string;
 invoke:((command:string,args?:Record<string,unknown>)=>Promise<any>)|null};
const error=(e:unknown)=>e instanceof Error?e.message:String(e);
export default function Cen04CorporateIntakePanel({organizationId,invoke}:Props){
 const [busy,setBusy]=useState(false);
 const actionRef=useRef(false);
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
 const latestOrgRef=useRef(organizationId);
 latestOrgRef.current=organizationId;
 const sameOrg=()=>latestOrgRef.current===organizationId;
 useEffect(()=>{
  setCorporateFile(null);setCorporateSha('');setCorporateBytes('');
  setCorporateMessage('');setCorporateFailure('');setCorporateTrustSha('');
  setCorporateReady(false);setCorporateRead(null);setCorporateLatest(null);
  let live=true;
  if(invoke){
   (async()=>{
    try{
     const caps=await invoke('center_cen04_corporate_t3_capabilities',{organizationId});
     inspectCorporateCapabilities(caps,organizationId);
     if(!live)return;
     setCorporateReady(true);
     try{
      const value=await invoke('center_cen04_corporate_t3_read',{organizationId});
      const evidence=inspectCorporateRead(value,organizationId);
      if(live)setCorporateRead(evidence);
     }catch(e){
      if(live)setCorporateFailure('Не удалось прочитать корпоративный T3: '+error(e));
     }
    }catch{if(live)setCorporateReady(false);}
   })();
  }
  return()=>{live=false;};
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
     if(!sameOrg())return;
     if(value===null){setCorporateMessage('Выбор файла отменён.');return;}
     const matched=checkCorporateCarrierMatch(value,expectation);
     setCorporateFile(matched);
     setCorporateMessage('Байты выбранного файла совпали с введёнными SHA-256 '+
       'и размером из Publisher. Подпись и права пока не проверены T3.');
   }catch(e){
     if(sameOrg())setCorporateFailure('Контрольная сумма файла не совпала либо файл недоступен: '+error(e));
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
     inspectCorporatePinnedTrust(caps,organizationId,fingerprint);
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
       inspectCorporatePinnedTrust(caps,organizationId,fingerprint);
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

 return <div data-testid="cen04-corporate-native-intake">
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
 </div>;
}
