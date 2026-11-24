import React,{useEffect,useRef,useState} from 'react';
import {checkCorporateCarrierExpectation,checkCorporateCarrierMatch,
 parseCorporateDeliveryHandoff,matchesCorporateDeliveryReceipt,matchesCorporateSignedPair}
 from '../runtime/cen04-corporate-carrier.mjs';
import {inspectCorporateEnrollment,inspectCorporateCapabilities,
 inspectCorporatePinnedTrust,inspectCorporateRead,inspectCorporateReceived,
 reconcileCorporateReceiveWithRead,projectCorporateSeatPlan}
 from '../runtime/cen04-corporate-receipt.mjs';

// This is only the UI of the ORIGINAL T3 corporate Consumer profile.
// Admin Center 0.4.1 retains its separate Publisher TEST request workflow.
type PlanParticipant={id:string;personalAgentPlan?:'NONE'|'PLANNED'};
type Props={organizationId:string;participants:readonly PlanParticipant[];
 onManageSeats:()=>void;
 invoke:((command:string,args?:Record<string,unknown>)=>Promise<any>)|null};
const error=(e:unknown)=>e instanceof Error?e.message:String(e);
export default function Cen04CorporateIntakePanel({organizationId,participants,invoke,onManageSeats}:Props){
 const [busy,setBusy]=useState(false);
 const actionRef=useRef(false);
 const [corporateSha,setCorporateSha]=useState('');
 const [corporateBytes,setCorporateBytes]=useState('');
 const [handoffText,setHandoffText]=useState('');
 const [handoff,setHandoff]=useState<ReturnType<typeof parseCorporateDeliveryHandoff>|null>(null);
 const [corporateTrustSha,setCorporateTrustSha]=useState('');
 const [corporateReady,setCorporateReady]=useState(false);
 const [nativeFingerprint,setNativeFingerprint]=useState('');
 const [nativeNeedsTrust,setNativeNeedsTrust]=useState(false);
 const organizationField=useRef<HTMLInputElement>(null);
 const [corporateRead,setCorporateRead]=useState<ReturnType<typeof inspectCorporateRead>|null>(null);
 const [corporateLatest,setCorporateLatest]=useState<ReturnType<typeof inspectCorporateReceived>|null>(null);
 const [corporateFile,setCorporateFile]=useState<{
  organizationId:string;packageSha256:string;bytes:number;
  signedLicenseAccepted:false;assignablePersonalAgentSeats:0
 }|null>(null);
 const [corporateMessage,setCorporateMessage]=useState('');
 const [corporateFailure,setCorporateFailure]=useState('');
 const [displayNow,setDisplayNow]=useState(()=>Date.now());
 // Expiry while the window remains open must not keep showing available
 // planned capacity. The local clock can only invalidate this readback.
 useEffect(()=>{
   const update=()=>setDisplayNow(previous=>Math.max(previous,Date.now()));
   update();
   const candidate=corporateRead?.licenses.find(row=>row.licenseId===corporateRead.capacity.candidateLicenseId);
   const deadline=candidate?Math.min(Date.parse(candidate.expiresAt),Date.parse(candidate.statusValidUntil)):null;
   let timer:number|undefined;
   const schedule=()=>{
     if(timer!==undefined)window.clearTimeout(timer);
     update();
     if(deadline!==null&&deadline>Date.now())timer=window.setTimeout(schedule,Math.min(deadline-Date.now()+1,3600000));
   };
   schedule();
   window.addEventListener('focus',schedule);
   return()=>{if(timer!==undefined)window.clearTimeout(timer);window.removeEventListener('focus',schedule);};
 },[corporateRead]);
 const seatPlan=projectCorporateSeatPlan(corporateRead,participants,displayNow);
 const latestOrgRef=useRef(organizationId);
 latestOrgRef.current=organizationId;
 const sameOrg=()=>latestOrgRef.current===organizationId;
 const missingRecipient=(e:unknown)=>error(e).includes('CORPORATE_RECIPIENT_NOT_ENROLLED');
 async function readOriginalCorporate(isLive:()=>boolean){
   if(!invoke)return null;
   let caps;
   try{
     caps=inspectCorporateCapabilities(
       await invoke('center_cen04_corporate_t3_capabilities',{organizationId}),organizationId);
   }catch(e){
     if(isLive()){
       setCorporateReady(false);setNativeFingerprint('');setCorporateRead(null);
       setNativeNeedsTrust(missingRecipient(e));
       if(!missingRecipient(e))setCorporateFailure('Корпоративный T3 недоступен: '+error(e));
     }
     return null;
   }
   if(!isLive())return null;
   setCorporateReady(true);setNativeFingerprint(caps.fingerprint);setNativeNeedsTrust(false);
   const value=await invoke('center_cen04_corporate_t3_read',{organizationId});
   const evidence=inspectCorporateRead(value,organizationId);
   return isLive()?evidence:null;
 }
 useEffect(()=>{
   setCorporateFile(null);setCorporateSha('');setCorporateBytes('');
   setHandoff(null);setHandoffText('');
   setCorporateMessage('');setCorporateFailure('');setCorporateTrustSha('');
   setCorporateReady(false);setCorporateRead(null);setCorporateLatest(null);
   setNativeNeedsTrust(false);setNativeFingerprint('');
   if(!invoke){actionRef.current=false;setBusy(false);return;}
   let live=true;
   // Do not let the initial read race a user's first enrollment/import.
   actionRef.current=true;setBusy(true);
   (async()=>{
     try{
       const evidence=await readOriginalCorporate(()=>live);
       if(live&&evidence)setCorporateRead(evidence);
     }catch(e){
       if(live){setCorporateRead(null);setCorporateFailure('Не удалось прочитать корпоративный T3: '+error(e));}
     }finally{
       if(live){actionRef.current=false;setBusy(false);}
     }
   })();
   return()=>{live=false;};
 },[organizationId,invoke]);
 async function copyOrganizationId(){
   const field=organizationField.current;
   if(!field)return;
   field.focus();field.select();
   try{
     await navigator.clipboard.writeText(organizationId);
     if(sameOrg())setCorporateMessage('Идентификатор скопирован. Используйте его в карточке клиента Publisher.');
   }catch{
     if(sameOrg())setCorporateMessage('Идентификатор выделен. Нажмите Ctrl+C.');
   }
 }

 // Only the chosen organization may use the pasted transfer details.
 // Editing either manual field discards the previously applied clipboard data.
 function resetCarrierEvidence(){
   setCorporateFile(null);setCorporateLatest(null);
   setCorporateMessage('');setCorporateFailure('');
 }
 function applyHandoff(){
   if(busy)return;
   resetCarrierEvidence();
   setHandoff(null);setCorporateSha('');setCorporateBytes('');
   try{
     const data=parseCorporateDeliveryHandoff(handoffText,organizationId);
     setHandoff(data);setCorporateSha(data.packageSha256);
     setCorporateBytes(String(data.bytes));
     setCorporateMessage('Контрольные данные перенесены. Выберите полученный .iwxa.');
   }catch(e){
     setCorporateFailure(error(e).includes('WRONG_ORGANIZATION')
       ?'Данные Publisher относятся к другой организации. Выберите нужную организацию.'
       :'Не удалось прочитать контрольные данные. Скопируйте их из Publisher ещё раз.');
   }
 }
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
   if(!invoke||corporateReady||!nativeNeedsTrust||busy||actionRef.current)return;
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
     setCorporateReady(true);setNativeNeedsTrust(false);setNativeFingerprint(fingerprint);setCorporateTrustSha('');
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
       setCorporateReady(true);setNativeNeedsTrust(false);setNativeFingerprint(fingerprint);setCorporateTrustSha('');
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
     const handoffMatched=!handoff||matchesCorporateDeliveryReceipt(saved,handoff);
     try{
       const read=await invoke('center_cen04_corporate_t3_read',{organizationId});
       const evidence=inspectCorporateRead(read,organizationId);
       if(!sameOrg())return;
       const checked=reconcileCorporateReceiveWithRead(saved,evidence);
       setCorporateRead(evidence);
       if(!handoffMatched){
         // A genuine T3 write already happened; do not claim that it failed.
         setCorporateFailure('T3 сохранил подписанный файл, но его данные не совпали с вставленными данными Publisher. Проверьте исходную выдачу.');
       }else{
         setCorporateMessage(checked.newer
           ?'Лицензия получена. В T3 уже сохранён более новый STATUS, показан актуальный.'
           :saved.outcome==='ALREADY_RECEIVED'
             ?'Исходные LICENSE и STATUS уже сохранены в T3. Новая запись не создана.'
             :'Подписи LICENSE и STATUS проверены оригинальным T3, запись сохранена и прочитана.');
       }
     }catch(e){
       if(sameOrg()){
         setCorporateRead(null);
         setCorporateFailure('Лицензия подтверждена исходной квитанцией, но общий readback не удался: '+error(e));
       }
     }
   }catch(e){
     if(!sameOrg())return;
     // The native write may have committed before an IPC error or lost ACK.
     // A matching signed pair recovered from Store is not evidence that the
     // newly chosen physical carrier was itself successfully verified.
     setCorporateFailure('Результат получения файла не подтверждён: '+error(e));
     setCorporateRead(null);
     try{
       const evidence=await readOriginalCorporate(sameOrg);
       if(!sameOrg()||!evidence)return;
       setCorporateRead(evidence);
       if(handoff&&evidence.licenses.some(row=>matchesCorporateSignedPair(row,handoff))){
         setCorporateMessage('В T3 уже сохранены те же подписанные LICENSE и STATUS. Получение именно выбранного файла не подтверждено.');
       }
     }catch(readError){
       if(sameOrg())setCorporateFailure('Результат получения не подтверждён. Чтение T3 недоступно: '+error(readError));
     }
   }
   finally{actionRef.current=false;setBusy(false);}
 }
 async function refreshCorporate(){
   if(!invoke||busy||actionRef.current)return;
   actionRef.current=true;setBusy(true);
   setCorporateFailure('');setCorporateMessage('');
   try{
     const evidence=await readOriginalCorporate(sameOrg);
     if(sameOrg()&&evidence){
       if(corporateLatest)reconcileCorporateReceiveWithRead(corporateLatest,evidence);
       setCorporateRead(evidence);
       setCorporateMessage('Подписанные сведения T3 обновлены.');
     }
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
     <label>Идентификатор организации для Publisher
       <input ref={organizationField} readOnly value={organizationId}
         data-testid="cen04-corporate-organization-id"/>
     </label>
     <button type="button" className="secondary"
       onClick={()=>void copyOrganizationId()}
       data-testid="cen04-corporate-organization-copy">Скопировать идентификатор организации</button>
     {!corporateReady&&nativeNeedsTrust&&<div className="nested-form"
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
     {corporateReady&&<div data-testid="cen04-corporate-original-ready">
       <p className="muted">Корпоративный T3 Consumer подключён к выбранной организации.
         Получение подписанного файла выполняется отдельно.</p>
       <details><summary>Закреплённое доверие издателя</summary>
         <code className="cen04-sha">{nativeFingerprint}</code>
       </details>
     </div>}
     {!corporateReady&&!nativeNeedsTrust&&<p className="muted">
       {busy?'Проверяем подключение T3.':
         'Оригинальный корпоративный T3 недоступен. Проверьте установленный компонент и обновите состояние.'}
     </p>}
     <p className="muted">2. Скопируйте контрольные данные из Publisher,
       вставьте их сюда и выберите полученный .iwxa. Подпись и STATUS проверит T3.</p>
     <label>Контрольные данные из Publisher
       <textarea rows={3} maxLength={8192} spellCheck={false} autoComplete="off"
         data-testid="cen04-corporate-handoff-text"
         value={handoffText} disabled={busy}
         placeholder="Вставьте скопированные данные"
         onChange={e=>{
           setHandoffText(e.target.value);setHandoff(null);
           setCorporateSha('');setCorporateBytes('');resetCarrierEvidence();
         }}/>
     </label>
     <button type="button" className="secondary"
       data-testid="cen04-corporate-handoff-apply"
       disabled={busy||!handoffText.trim()}
       onClick={applyHandoff}>Перенести контрольные данные</button>
     {handoff&&<p data-testid="cen04-corporate-handoff-summary" className="muted">
       Лицензия: {handoff.licenseId}. STATUS: {handoff.status},
       последовательность: {handoff.sequence}.
       {' '}{corporateLatest
         ?matchesCorporateDeliveryReceipt(corporateLatest,handoff)
           ?'Данные совпадают с квитанцией оригинального T3.'
           :'Данные не совпадают с квитанцией оригинального T3.'
         :'Данные ещё не проверены T3.'}
     </p>}
     <details>
       <summary>Контрольная сумма и размер (ручной ввод)</summary>
     <label>SHA-256 корпоративного .iwxa из Publisher
       <input data-testid="cen04-corporate-sha256" value={corporateSha}
         autoComplete="off" spellCheck={false} disabled={busy}
         placeholder="64 символа"
         onChange={e=>{setCorporateSha(e.target.value);setHandoff(null);
           setHandoffText('');resetCarrierEvidence();}}/>
     </label>
     <label>Размер файла из Publisher (байт)
       <input data-testid="cen04-corporate-bytes" value={corporateBytes}
         inputMode="numeric" autoComplete="off" disabled={busy}
         placeholder="Например, 7312"
         onChange={e=>{setCorporateBytes(e.target.value);setHandoff(null);
           setHandoffText('');resetCarrierEvidence();}}/>
     </label>
     </details>
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
       disabled={!invoke||busy}
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
         Этот файл ещё не является основанием для назначения места.</p>
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
         Получение пакета само по себе не распределяет места.</p>
     </div>}
     {corporateReady&&corporateRead&&<div
       data-testid="cen04-corporate-original-list">
       <p><strong>Исходное корпоративное чтение T3.</strong>
         Лицензий: {corporateRead.licenses.length}.
         Редакция Store: {corporateRead.revision}.
         Фактические назначения проверяются в подписанном реестре сотрудников T3.</p>
       <section className="nested-form" data-testid="cen04-corporate-capacity">
         <strong>План мест по актуальному тарифу</strong>
         {seatPlan.state==='VERIFIED_CAPACITY_CANDIDATE'?<>
           <div className="form-grid">
             <div><small>Контакты в плане / лимит</small><strong>{' '}{seatPlan.employeeCount} / {seatPlan.employeeLimit}</strong></div>
             <div><small>Запланированные места Agent / лимит</small><strong>{' '}{seatPlan.planned} / {seatPlan.seatLimit}</strong></div>
             <div><small>Остаток для планирования</small><strong>{' '}{seatPlan.remainingPlannedSeats}</strong></div>
           </div>
           {((seatPlan.employeeOverLimit??0)>0||(seatPlan.seatOverLimit??0)>0)?
             <p role="alert">План превышает подписанные условия. Сотрудников сверх лимита: {seatPlan.employeeOverLimit}.
               Мест Agent сверх лимита: {seatPlan.seatOverLimit}. Уточните тариф или план.</p>:
             <p>Текущий план укладывается в подписанные лимиты.</p>}
           <p className="muted">Используется только одна актуальная лицензия: {seatPlan.licenseId}.
             Это сравнение плана с тарифом. Фактические назначения и свободные места определяются по исходному реестру T3.</p>
           <button type="button" className="primary" data-testid="cen04-open-original-seat-registry"
             onClick={onManageSeats} disabled={busy||!invoke}>Перейти к распределению мест</button>
         </>:<p role="status">{seatPlan.state==='LINEAGE_INCOMPLETE'?
           'История продления неполна. Для расчёта лимитов требуется недостающая лицензия.':
           seatPlan.state==='MULTIPLE_CURRENT_LICENSES'?
             'Получено несколько действующих независимых лицензий. Их лимиты не складываются; уточните основание у Publisher.':
             seatPlan.state==='READBACK_EXPIRED'?
               'Срок последней проверки LICENSE или STATUS истёк. Обновите подписанные сведения T3; доступный остаток больше не отображается.':
               'Нет текущей подписанной лицензии ACTIVE. Лимиты плана не определены.'}</p>}
       </section>
       {corporateRead.licenses.map(row=><section className="nested-form"
         data-testid="cen04-corporate-license-terms" key={row.licenseId}>
         <div className="simple-row">
           <div><strong>Тариф {row.tariffId}, редакция {row.tariffRevision}</strong>
             <small>STATUS: {row.status}; последовательность: {row.sequence}.</small>
             <small>{row.current?'STATUS проверен на момент чтения.':
               'Историческая запись, срок действия или срок STATUS истёк.'}</small>
           </div>
           <span className="status neutral">{row.superseded?'Заменена новой редакцией':
             !row.lineageResolved?'История неполна':
             row.licenseId===corporateRead.capacity.candidateLicenseId?
               seatPlan.state==='READBACK_EXPIRED'?'Требуется обновление STATUS':'Актуальный тариф':'Получено T3'}</span>
         </div>
         <div className="form-grid" aria-label="Подписанные условия лицензии">
           <div><small>Места Admin Center по лицензии</small>
             <strong>{' '}{row.signedTerms.limits.adminCenterSeats}</strong></div>
           <div><small>Лимит сотрудников</small>
             <strong>{' '}{row.signedTerms.limits.employeeLimit}</strong></div>
           <div><small>Места Personal Agent по лицензии</small>
             <strong>{' '}{row.signedTerms.limits.personalAgentSeats}</strong></div>
         </div>
         <p>Фактически занятые и свободные места проверяются в подписанном реестре организации. Получение лицензии не назначает место автоматически.</p>
         <p>Лицензия до: {row.expiresAt.replace('T',' ').replace('.000Z',' UTC')}.
           {' '}STATUS до: {row.statusValidUntil.replace('T',' ').replace('.000Z',' UTC')}.</p>
         <details>
           <summary>Функции, квоты и данные подписанной лицензии</summary>
           <p>Версия продукта: {row.signedTerms.productVersion}.</p>
           <p>Функции: {row.signedTerms.featureIds.join(', ')||'Не указаны'}.</p>
           {row.signedTerms.limits.quotas.length>0?<div>
             {row.signedTerms.limits.quotas.map(q=><p key={q.service+':'+q.metric+':'+q.period}>
               {q.metric}: {q.max} {q.unit} / {q.period} ({q.service})
             </p>)}
           </div>:<p>Квоты ресурсов не указаны.</p>}
           <p>Лицензия: {row.licenseId}.</p>
           <p>Цепочка лицензии: {row.lineageId}.
             {row.renewalOf?' Предыдущая лицензия: '+row.renewalOf+'.':' Первичная редакция.'}</p>
           <p>Запрос: {row.requestId}. Издатель: {row.issuerAuthorityId}.</p>
           <p>Подписанный STATUS: {row.signedStatus}.</p>
           <p>SHA-256 LICENSE: <code className="cen04-sha">{row.licenseEnvelopeSha256}</code></p>
           <p>SHA-256 STATUS: <code className="cen04-sha">{row.statusEnvelopeSha256}</code></p>
         </details>
       </section>)}
     </div>}
     {!invoke&&<p className="muted">
       Выбор файла доступен в установленном Admin Center.</p>}
   </div>
 </div>;
}
