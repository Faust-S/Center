import React,{useState} from 'react';
import {validateOriginalEmployeeTaskIssueReceipt}
 from '../runtime/cen03-d3-owner.mjs';

// This is a manager's view of the ORIGINAL installed T3 employee enrollment.
// It does not generate signatures, enroll keys, issue grants or persist status.
// Every transition requires exact native owner readback on the same signed scope.
type Exec=(operation:string,input?:Record<string,unknown>)=>Promise<any>;
type Run=(message:string,task:()=>Promise<void|boolean>)=>Promise<void>;
type Contact={id:string;name:string};
type Session={organizationId:string;workspaceId:string;actorId:string;
  d3EmployeeEnrollmentAvailable?:boolean;
  d3EmployeeRegistryBootstrapAvailable?:boolean;
  d3EmployeeRegistryReadbackAvailable?:boolean;
  d3EmployeeTaskIssueAvailable?:boolean};
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const HEX=/^[a-f0-9]{64}$/;
function jsonObject(raw:string,code:string):Record<string,any>{
  let parsed:unknown;
  try{parsed=JSON.parse(raw);}catch{throw Error(code);}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed)||
    Object.getPrototypeOf(parsed)!==Object.prototype)throw Error(code);
  return parsed as Record<string,any>;
}
function proof(raw:string){
  const value=jsonObject(raw,'CEN_D3_EMPLOYEE_SIGNED_PROOF_REQUIRED');
  // Original T3 makeProof returns an envelope. The kind is in its payload.
  if(value.schema!=='IWXA_T3_ACCESS_SIGNED/1'||!ID.test(value.keyId)||
    value.payload?.kind!=='PROOF'||typeof value.payload?.challenge!=='string'||
    !HEX.test(value.payload?.requestDigest)||
    typeof value.signature!=='string'||!/^[A-Za-z0-9_-]{86}$/.test(value.signature))
    throw Error('CEN_D3_EMPLOYEE_SIGNED_PROOF_REQUIRED');
  return value;
}
function keyRecord(raw:string,personId:string){
  const k=jsonObject(raw,'CEN_D3_EMPLOYEE_PUBLIC_KEY_RECORD_INVALID');
  if(Object.keys(k).sort().join()!==
    ['subjectId','environment','publicKey','status','uses','notBefore','expiresAt'].sort().join()||
    k.subjectId!==personId||k.status!=='ACTIVE'||
    !Array.isArray(k.uses)||k.uses.length!==1||k.uses[0]!=='PROOF'||
    typeof k.publicKey!=='string'||!k.publicKey.includes('PUBLIC KEY')||
    [k.notBefore,k.expiresAt].some(x=>typeof x!=='string'))
    throw Error('CEN_D3_EMPLOYEE_PUBLIC_KEY_RECORD_INVALID');
  return k;
}
export default function CorporateEmployeeEnrollment({session,contacts,preferredContactId=null,execute,run,busy}:{
 session:Session;contacts:Contact[];preferredContactId?:string|null;execute:Exec;run:Run;busy:boolean;
}){
 // A preselected organizational contact is only a local draft hint;
 // never infer an employee PROOF key, signed identity or active grant.
 const [contact,setContact]=useState(()=>contacts.some(c=>c.id===preferredContactId)?preferredContactId??'':'');
 const [personId,setPersonId]=useState('');
 const [keyId,setKeyId]=useState('');
 const [publicRecord,setPublicRecord]=useState('');
 const [credentialChallenge,setCredentialChallenge]=useState<any>(null);
 const [credentialProof,setCredentialProof]=useState('');
 const [credentialAttempted,setCredentialAttempted]=useState(false);
 const [credentialReceipt,setCredentialReceipt]=useState<any>(null);
 const [enrollmentChallenge,setEnrollmentChallenge]=useState<any>(null);
 // Cold recovery reads the original Kernel using an ID saved by the manager,
 // not a React cache or a second enrollment created after lost ACK.
 const [recoveryEnrollmentId,setRecoveryEnrollmentId]=useState('');
 // A lost native ACK can follow an ORIGINAL Kernel commit. Never re-dispatch.
 const [registryInitAttempted,setRegistryInitAttempted]=useState(false);
 const [enrollmentProof,setEnrollmentProof]=useState('');
 const [enrollmentAttempted,setEnrollmentAttempted]=useState(false);
 const [enrollmentReceipt,setEnrollmentReceipt]=useState<any>(null);
 const [employeeInviteReceipt,setEmployeeInviteReceipt]=useState<any>(null);
 const [taskGrantAttempted,setTaskGrantAttempted]=useState(false);
 const [taskGrantReceipt,setTaskGrantReceipt]=useState<any>(null);
 const [taskText,setTaskText]=useState('');
 const [taskId,setTaskId]=useState('');
 const [taskAttempted,setTaskAttempted]=useState(false);
 const [taskReceipt,setTaskReceipt]=useState<any>(null);
 const [taskRecoveryHold,setTaskRecoveryHold]=useState(false);
 const [taskRecoveryAttempted,setTaskRecoveryAttempted]=useState(false);
 const [taskNeedsRebind,setTaskNeedsRebind]=useState(false);
 const available=session.d3EmployeeEnrollmentAvailable===true;
 const bootstrap=session.d3EmployeeRegistryBootstrapAvailable===true;
 const registryRead=session.d3EmployeeRegistryReadbackAvailable===true;
 const taskIssueAvailable=session.d3EmployeeTaskIssueAvailable===true;
 const personOk=ID.test(personId)&&personId!==session.actorId;
 const credentialOk=credentialReceipt?.state==='ORIGINAL_PROOF_CREDENTIAL_ADMITTED'&&
   credentialReceipt.employeePersonId===personId&&
   credentialReceipt.credentialKeyId===keyId&&
   credentialReceipt.originalReadback===true;
 // A status flag alone must never display another employee's corporate
 // rights as belonging to the currently selected identity. Original T3
 // verifies every signed envelope; the UI binds its exact public readback.
 const exportResources=[
   'workspace:'+session.workspaceId,'subject:'+session.organizationId,
   'recipient:'+session.organizationId,'field:result','operation:UPSERT'
 ];
 const enrolled=credentialOk&&personOk&&
   enrollmentReceipt?.state==='ORIGINAL_GRANTS_ACTIVE'&&
   enrollmentReceipt.employeePersonId===personId&&
   enrollmentReceipt.organizationId===session.organizationId&&
   enrollmentReceipt.originalReadback===true&&
   enrollmentReceipt.originalSigned===true&&
   enrollmentReceipt.safeToReissue===false&&
   enrollmentReceipt.membership?.personId===personId&&
   enrollmentReceipt.membership?.organizationId===session.organizationId&&
   enrollmentReceipt.membership?.workspaceId===session.workspaceId&&
   enrollmentReceipt.credential?.holderPersonId===personId&&
   enrollmentReceipt.credential?.publicKeyRef===keyId&&
   enrollmentReceipt.binding?.holderPersonId===personId&&
   enrollmentReceipt.binding?.organizationId===session.organizationId&&
   enrollmentReceipt.binding?.grantId===enrollmentReceipt.workGrant?.payload?.id&&
   enrollmentReceipt.workGrant?.payload?.holderId===personId&&
   enrollmentReceipt.workGrant?.payload?.rightClass==='ACTION'&&
   JSON.stringify(enrollmentReceipt.workGrant?.payload?.actions)==='["work.prepare"]'&&
   JSON.stringify(enrollmentReceipt.workGrant?.payload?.resources)===
     JSON.stringify([session.workspaceId])&&
   enrollmentReceipt.exportGrant?.payload?.holderId===personId&&
   enrollmentReceipt.exportGrant?.payload?.rightClass==='DATA'&&
   JSON.stringify(enrollmentReceipt.exportGrant?.payload?.actions)==='["package.export"]'&&
   JSON.stringify(enrollmentReceipt.exportGrant?.payload?.resources)===
     JSON.stringify(exportResources)&&
   enrollmentReceipt.originalEnrollment?.payload?.personId===personId&&
   enrollmentReceipt.originalEnrollment?.payload?.organizationId===session.organizationId&&
   enrollmentReceipt.originalEnrollment?.payload?.workspaceId===session.workspaceId&&
   enrollmentReceipt.originalEnrollment?.payload?.credentialPublicKeyRef===keyId&&
   Number.isSafeInteger(enrollmentReceipt.statusSequence)&&
   enrollmentReceipt.statusSequence>0;
 // A second signed DATA grant belongs to the manager, not the worker.
 const managerTaskResources=[
   'workspace:'+session.workspaceId,'subject:'+session.organizationId,
   'recipient:'+personId,'field:task','operation:UPSERT'
 ];
 const managerTaskGrantOk=enrolled&&
   taskGrantReceipt?.schema==='IWXA_T3_ORIGINAL_EMPLOYEE_TASK_DATA_READBACK/1'&&
   taskGrantReceipt.state==='ORIGINAL_MANAGER_TASK_DATA_ACTIVE'&&
   taskGrantReceipt.organizationId===session.organizationId&&
   taskGrantReceipt.workspaceId===session.workspaceId&&
   taskGrantReceipt.recipientId===personId&&
   taskGrantReceipt.employeePersonId===personId&&
   taskGrantReceipt.managerPersonId===session.actorId&&
   taskGrantReceipt.enrollmentId===enrollmentReceipt.enrollmentId&&
   taskGrantReceipt.originalReadback===true&&
   taskGrantReceipt.safeToReissue===false&&
   taskGrantReceipt.grant?.payload?.holderId===session.actorId&&
   taskGrantReceipt.grant?.payload?.roleId==='assigner'&&
   taskGrantReceipt.grant?.payload?.rightClass==='DATA'&&
   JSON.stringify(taskGrantReceipt.grant?.payload?.actions)==='["package.export"]'&&
   JSON.stringify(taskGrantReceipt.grant?.payload?.purposes)==='["assignment"]'&&
   JSON.stringify(taskGrantReceipt.grant?.payload?.resources)===
     JSON.stringify(managerTaskResources)&&
   Number.isSafeInteger(taskGrantReceipt.statusSequence)&&
   taskGrantReceipt.statusSequence>0;
 // The employee must import the current signed manager DATA + STATUS.
 const invitationCurrentForTask=managerTaskGrantOk&&
   employeeInviteReceipt?.originalSigned===true&&
   employeeInviteReceipt.originalKernelReadback===true&&
   employeeInviteReceipt.enrollmentId===enrollmentReceipt.enrollmentId&&
   Number.isSafeInteger(employeeInviteReceipt.statusSequence)&&
   employeeInviteReceipt.statusSequence>=taskGrantReceipt.statusSequence;
 const reset=()=>{
   setCredentialChallenge(null);setCredentialProof('');setCredentialAttempted(false);
   setCredentialReceipt(null);setEnrollmentChallenge(null);setRecoveryEnrollmentId('');
   setEnrollmentProof('');
   setEnrollmentAttempted(false);setEnrollmentReceipt(null);
   setEmployeeInviteReceipt(null);
   setTaskGrantAttempted(false);setTaskGrantReceipt(null);
   setTaskId('');setTaskText('');setTaskAttempted(false);setTaskReceipt(null);
   setTaskRecoveryHold(false);setTaskRecoveryAttempted(false);
   setTaskNeedsRebind(false);
 };
 const confirmCredential=()=>run('Подлинность ключа перечитана из оригинального Kernel.',async()=>{
   if(!credentialChallenge)throw Error('CEN_D3_EMPLOYEE_KEY_PROOF_NOT_PREPARED');
   // Once sent, a lost ACK is read-only recovery, never another admission.
   if(credentialAttempted)throw Error('CEN_D3_EMPLOYEE_ADMISSION_OUTCOME_UNKNOWN');
   const employeeProof=proof(credentialProof);
   if(employeeProof.keyId!==keyId)throw Error('CEN_D3_EMPLOYEE_PROOF_KEY_MISMATCH');
   setCredentialAttempted(true);
   let result:any;
   try{
     result=await execute('d3EmployeeCredentialAdmit',{
       employeePersonId:personId,credentialKeyId:keyId,
       admissionId:credentialChallenge.admissionId,employeeProof});
   }catch(e){
     // This exact Windows consent refusal is raised BEFORE reaching the
     // private original Kernel. Only this definite pre-dispatch refusal
     // can unlock the UI; unknown/post-dispatch outcomes remain blocked.
     if(String(e).replace(/^Error:\s*/,'').trim()===
       'CEN_D3_EMPLOYEE_CREDENTIAL_HUMAN_CANCELLED')
       setCredentialAttempted(false);
     throw e;
   }
   if(result?.state!=='ORIGINAL_PROOF_CREDENTIAL_ADMITTED'||
      result.employeePersonId!==personId||result.credentialKeyId!==keyId||
      result.exactReadback!==true)
     throw Error('CEN_D3_EMPLOYEE_ORIGINAL_KEY_READBACK_REQUIRED');
   const cold=await execute('d3EmployeeCredentialRead',{employeePersonId:personId,credentialKeyId:keyId});
   if(cold?.state!=='ORIGINAL_PROOF_CREDENTIAL_ADMITTED'||
      cold.employeePersonId!==personId||cold.credentialKeyId!==keyId||
      cold.originalReadback!==true)
     throw Error('CEN_D3_EMPLOYEE_ORIGINAL_KEY_READBACK_REQUIRED');
   setCredentialReceipt(cold);
 });
 const confirmEnrollment=()=>run('Оригинальные ACTION/DATA и signed STATUS перечитаны из Kernel.',async()=>{
   if(!credentialOk||!enrollmentChallenge||enrollmentAttempted)
     throw Error('CEN_D3_EMPLOYEE_ENROLLMENT_CHALLENGE_REQUIRED');
   const employeeProof=proof(enrollmentProof);
   if(employeeProof.keyId!==keyId)throw Error('CEN_D3_EMPLOYEE_PROOF_KEY_MISMATCH');
   setEnrollmentAttempted(true);
   let result:any;
   try{
     result=await execute('d3EmployeeComplete',{
       enrollmentId:enrollmentChallenge.enrollmentId,
       employeePersonId:personId,credentialKeyId:keyId,employeeProof});
   }catch(e){
     if(String(e).replace(/^Error:\s*/,'').trim()===
       'CEN_D3_EMPLOYEE_GRANTS_HUMAN_CANCELLED')
       setEnrollmentAttempted(false);
     throw e;
   }
   if(result?.state!=='SIGNED_EMPLOYEE_ENROLLED_NOT_DELIVERED'||
      result.employeePersonId!==personId||result.enrollmentId!==enrollmentChallenge.enrollmentId||
      result.originalSigned!==true||result.invitationDelivered!==false)
     throw Error('CEN_D3_EMPLOYEE_ORIGINAL_ENROLLMENT_UNCONFIRMED');
   const cold=await execute('d3EmployeeRead',{
     employeePersonId:personId,enrollmentId:enrollmentChallenge.enrollmentId});
   if(cold?.state!=='ORIGINAL_GRANTS_ACTIVE'||cold.originalSigned!==true||
      cold.originalReadback!==true||cold.employeePersonId!==personId||
      cold.enrollmentId!==enrollmentChallenge.enrollmentId)
     throw Error('CEN_D3_EMPLOYEE_ORIGINAL_ENROLLMENT_READBACK_HOLD');
   setEnrollmentReceipt(cold);
 });
 const readEnrollment=()=>run('Прочитана исходная квитанция без повторной выдачи прав.',async()=>{
   if(!ID.test(personId)||!ID.test(recoveryEnrollmentId))
     throw Error('CEN_D3_EMPLOYEE_ENROLLMENT_RECOVERY_IDENTIFIERS_REQUIRED');
   const result=await execute('d3EmployeeRead',{
     employeePersonId:personId,enrollmentId:recoveryEnrollmentId});
   if(result?.employeePersonId!==personId||
     result.enrollmentId!==recoveryEnrollmentId||
     result.originalReadback!==true||result.safeToReissue!==false)
     throw Error('CEN_D3_EMPLOYEE_ORIGINAL_ENROLLMENT_READBACK_HOLD');
   setEnrollmentReceipt(result);
 });
 const readCredential=()=>run('Ключ перечитан из исходного подписанного реестра.',async()=>{
   if(!personOk||!ID.test(keyId))throw Error('CEN_D3_EMPLOYEE_KEY_IDENTIFIERS_REQUIRED');
   const result=await execute('d3EmployeeCredentialRead',{
     employeePersonId:personId,credentialKeyId:keyId});
   if(result?.originalReadback!==true||result.employeePersonId!==personId||
      result.credentialKeyId!==keyId||result.safeToRetry!==false)
     throw Error('CEN_D3_EMPLOYEE_ORIGINAL_KEY_READBACK_REQUIRED');
   setCredentialReceipt(result);
 });
 return <section className="nested-form" data-testid="d3-independent-employee">
  <h3>Независимый сотрудник организации</h3>
  <p className="muted">Подписывает только оригинальный T3 в доверенном Host. Сотрудник подтверждает
   собственный Ed25519-ключ в установленном Agent; руководитель никогда не получает закрытый ключ.
   Черновик контакта и лицензия Publisher не являются полномочиями.</p>
  {!available?<div className="notice subdued" data-testid="d3-employee-owner-unavailable">
     <p>Оригинальный Kernel-backed владелец регистрации сотрудника ещё не подтверждён
     в установленной сессии. Выдача полномочий и поручений заблокирована.</p>
     {registryRead&&<div>
      <p>После перезапуска сначала перечитайте исходный реестр. Эта операция
      не создаёт гранты, не выполняет запись и не повторяет потерянную команду.</p>
      <button data-testid="d3-employee-registry-readback" disabled={busy}
       onClick={()=>void run('Исходный реестр перечитан без повторной записи.',async()=>{
         const receipt=await execute('d3EmployeeRegistryReadback',{});
         if(receipt?.schema!=='IWXA_T3_ORIGINAL_EMPLOYEE_REGISTRY_READBACK/1'||
            receipt.organizationId!==session.organizationId||
            receipt.workspaceId!==session.workspaceId||
            receipt.originalReadback!==true||receipt.originalKernel!==true||
            !['ORIGINAL_KERNEL_REGISTRY_CONFIRMED',
              'ORIGINAL_KERNEL_REGISTRY_NOT_FOUND'].includes(receipt.state)||
            receipt.automaticRetryAllowed!==false)
           throw Error('CEN_D3_EMPLOYEE_REGISTRY_READBACK_INVALID');
         if(receipt.state!=='ORIGINAL_KERNEL_REGISTRY_CONFIRMED')
           throw Error('CEN_D3_EMPLOYEE_REGISTRY_NOT_PRESENT_USE_EXPLICIT_INITIALIZE');
       })}>Проверить реестр без записи</button>
     </div>}
     {bootstrap&&<div>
      <p>Откройте оригинальную T3 Workspace, затем подтвердите подключение
      исходного реестра в отдельном нативном окне Windows.
      После записи будет выполнено чтение того же Kernel.</p>
      <button data-testid="d3-employee-registry-initialize"
       disabled={busy||registryInitAttempted}
       onClick={()=>void run('Исходный реестр проверен в оригинальном Kernel.',async()=>{
         if(registryInitAttempted)
           throw Error('CEN_D3_EMPLOYEE_REGISTRY_USE_READBACK');
         setRegistryInitAttempted(true);
         try{
           const result=await execute('d3EmployeeRegistryInitialize',{confirmed:true});
           if(result?.state!=='ORIGINAL_KERNEL_REGISTRY_CONFIRMED'||
              result.organizationId!==session.organizationId||
              result.workspaceId!==session.workspaceId||
              result.originalReadback!==true||result.originalKernel!==true)
             throw Error('CEN_D3_EMPLOYEE_REGISTRY_READBACK_UNCONFIRMED');
         }catch(e){
           // Only an exact Windows refusal BEFORE original dispatch permits
           // manual confirmation again. All other outcomes require readback.
           if(String(e).replace(/^Error:\s*/,'').trim()===
             'CEN_D3_EMPLOYEE_REGISTRY_HUMAN_CANCELLED')
             setRegistryInitAttempted(false);
           throw e;
         }
       })}>Подключить исходный реестр T3</button>
     </div>}
    </div>:
  <div className="form-grid">
   <label>Контакт в черновике
    <select data-testid="d3-employee-contact" value={contact} disabled={busy}
      onChange={e=>{
        // A draft contact has NO T3 identity. Never display the previously
        // selected employee key as belonging to a different contact.
        setContact(e.target.value);setPersonId('');setKeyId('');
        setPublicRecord('');reset();
      }}>
     <option value="">Выберите сотрудника</option>
     {contacts.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
    </select>
   </label>
   <label>Подписанная личность T3 сотрудника
    <input data-testid="d3-employee-person" value={personId} disabled={busy}
      placeholder="person:..." onChange={e=>{setPersonId(e.target.value.trim());reset();}}/>
   </label>
   <label>Идентификатор публичного PROOF-ключа
    <input data-testid="d3-employee-key" value={keyId} disabled={busy}
      placeholder="key:..." onChange={e=>{setKeyId(e.target.value.trim());reset();}}/>
   </label>
  </div>}
  {available&&<div data-testid="d3-employee-steps">
   <label>Публичная запись ключа, полученная от сотрудника
    <textarea data-testid="d3-employee-key-record" value={publicRecord} rows={3}
      disabled={busy} onChange={e=>{setPublicRecord(e.target.value);reset();}}
      placeholder='{"subjectId":"person:...","publicKey":"-----BEGIN PUBLIC KEY-----..."}'/>
   </label>
   <div className="actions">
    <button data-testid="d3-employee-credential-begin" disabled={busy||!contact||!personOk||
      !ID.test(keyId)||!!credentialChallenge||credentialAttempted||credentialOk}
     onClick={()=>void run('Запрос оригинального подтверждения ключа создан.',async()=>{
       const result=await execute('d3EmployeeCredentialBegin',{
         employeePersonId:personId,credentialKeyId:keyId,
         keyRecord:keyRecord(publicRecord,personId)});
       if(result?.state!=='AWAITING_EMPLOYEE_CREDENTIAL_PROOF'||
          result.employeePersonId!==personId||result.credentialKeyId!==keyId||
          !ID.test(result.admissionId)||!result.employeeRequest||!result.employeeChallenge)
         throw Error('CEN_D3_EMPLOYEE_CREDENTIAL_CHALLENGE_INVALID');
       setCredentialChallenge(result);
     })}>1. Запросить подтверждение ключа</button>
    <button data-testid="d3-employee-credential-read" disabled={busy||!personOk||!ID.test(keyId)}
      onClick={()=>void readCredential()}>Проверить исходный ключ</button>
   </div>
   {credentialChallenge&&<div>
    <p>Передайте запрос сотруднику. Agent подписывает его собственным
    Ed25519-ключом. Подпись действует ограниченное время: при истечении срока
    отмените только ещё не отправленный запрос и создайте новый.</p>
    <textarea data-testid="d3-employee-credential-challenge" readOnly rows={4}
      value={JSON.stringify({request:credentialChallenge.employeeRequest,
        challenge:credentialChallenge.employeeChallenge},null,2)}/>
    <label>Оригинальный подписанный ответ сотрудника
     <textarea data-testid="d3-employee-credential-proof" rows={3}
      value={credentialProof} disabled={busy||credentialAttempted}
      onChange={e=>setCredentialProof(e.target.value)}/>
    </label>
    <button data-testid="d3-employee-credential-admit" disabled={busy||credentialAttempted||
      !credentialProof.trim()} onClick={()=>void confirmCredential()}>
      Подтвердить ключ и перечитать Kernel</button>
    <button className="secondary" data-testid="d3-employee-credential-cancel"
      disabled={busy||credentialAttempted}
      onClick={()=>void run('Неподписанный запрос отменён без Kernel-записи.',async()=>{
        const result=await execute('d3EmployeeCredentialCancel',{
          employeePersonId:personId,credentialKeyId:keyId,
          admissionId:credentialChallenge.admissionId});
        if(result?.schema!=='IWXA_T3_ORIGINAL_EMPLOYEE_CREDENTIAL_CANCEL/1'||
           result?.state!=='CHALLENGE_CANCELLED_NO_KERNEL_WRITE'||
           result?.admissionId!==credentialChallenge.admissionId||
           result?.kernelWriteAttempted!==false)
          throw Error('CEN_D3_EMPLOYEE_CREDENTIAL_CANCEL_UNCONFIRMED');
        setCredentialChallenge(null);
        setCredentialProof('');
      })}>Отменить запрос до отправки и получить новый</button>
   </div>}
   {credentialAttempted&&!credentialOk&&<p className="notice subdued">
      Исход подтверждения ключа неизвестен. Не отправляйте запись повторно.
      Используйте только «Проверить исходный ключ».</p>}
   {credentialOk&&<div className="nested-form" data-testid="d3-employee-key-admitted">
    <p>Публичный PROOF-ключ подтверждён оригинальным Kernel. Права ещё не выданы.</p>
    <button data-testid="d3-employee-begin" disabled={busy||!!enrollmentChallenge||enrollmentAttempted||enrolled}
      onClick={()=>void run('Создана исходная проверка сотрудника без выдачи прав.',async()=>{
       const result=await execute('d3EmployeeBegin',{
         employeePersonId:personId,credentialKeyId:keyId});
       if(result?.state!=='AWAITING_EMPLOYEE_PROOF'||!ID.test(result.enrollmentId)||
          result.credentialKeyId!==keyId||!result.request||!result.challenge||
          result.signed!==false||result.member!==false)
         throw Error('CEN_D3_EMPLOYEE_ENROLLMENT_CHALLENGE_INVALID');
       setEnrollmentChallenge(result);
       setRecoveryEnrollmentId(result.enrollmentId);
      })}>2. Запросить подтверждение сотрудника</button>
    <label>Идентификатор исходного подключения для холодного чтения
     <input data-testid="d3-employee-enrollment-id" value={recoveryEnrollmentId}
       disabled={busy||enrollmentAttempted} onChange={e=>setRecoveryEnrollmentId(e.target.value.trim())}/>
    </label>
    <button data-testid="d3-employee-read" disabled={busy||!ID.test(recoveryEnrollmentId)}
      onClick={()=>void readEnrollment()}>Восстановить исходную квитанцию</button>
    {enrollmentChallenge&&<div>
     <p>Испытание ключа действует ограниченное время. Если сотрудник
       ещё не отправил ответ, прежний вызов можно отменить без Kernel-записи.</p>
     <textarea data-testid="d3-employee-enrollment-challenge" readOnly rows={4}
       value={JSON.stringify({request:enrollmentChallenge.request,
         challenge:enrollmentChallenge.challenge},null,2)}/>
     <label>Подписанный ответ сотрудника
      <textarea data-testid="d3-employee-enrollment-proof" rows={3}
        value={enrollmentProof} disabled={busy||enrollmentAttempted}
        onChange={e=>setEnrollmentProof(e.target.value)}/>
     </label>
     <div className="actions">
      <button data-testid="d3-employee-complete" disabled={busy||enrollmentAttempted||
        !enrollmentProof.trim()} onClick={()=>void confirmEnrollment()}>
        Выдать ACTION/DATA и перечитать STATUS</button>
      <button className="secondary" data-testid="d3-employee-cancel"
        disabled={busy||enrollmentAttempted}
        onClick={()=>void run('Неподписанное подключение отменено без выдачи грантов.',async()=>{
          const result=await execute('d3EmployeeCancel',{
            employeePersonId:personId,
            enrollmentId:enrollmentChallenge.enrollmentId});
          if(result?.state!=='UNSUBMITTED_EMPLOYEE_CHALLENGE_CANCELLED'||
             result.enrollmentId!==enrollmentChallenge.enrollmentId||
             result.employeePersonId!==personId||
             result.originalKernelWriteAttempted!==false)
            throw Error('CEN_D3_EMPLOYEE_CANCEL_UNCONFIRMED');
          setEnrollmentChallenge(null);
          setRecoveryEnrollmentId('');
          setEnrollmentProof('');
        })}>Отменить неподписанное подключение</button>
     </div>
    </div>}
    {enrollmentAttempted&&!enrolled&&<p className="notice subdued">
       Ответ после записи мог потеряться. Не выдавайте grants повторно.
       Выполните исходный readEnrollment.</p>}
    {enrolled&&<div data-testid="d3-employee-enrolled">
     <p>Подтверждены отдельные ACTION work.prepare и DATA package.export.
        Получатель не получает ключ issuer или полномочия руководителя.
        Доставка приглашения не подтверждена.</p>
     <p>Оригинальный T3 сохраняет ранее выданные этому сотруднику права
       в персональное подписанное приглашение .iwxa. Выдача грантов
       не повторяется. Приём файла в Agent ещё требуется подтвердить.</p>
     <button data-testid="d3-employee-invitation-export" disabled={busy}
       onClick={()=>void run('Подписанное приглашение сохранено, доставка не подтверждена.',async()=>{
         const receipt=await execute('d3EmployeeExportInvite',{
           employeePersonId:personId,
           enrollmentId:enrollmentReceipt.enrollmentId
         });
         if(receipt?.status==='CANCELLED')return false;
         if(receipt?.schema!=='IWXA_T3_ORIGINAL_EMPLOYEE_INVITATION_EXPORT/1'||
            receipt.state!=='SIGNED_INVITATION_EXPORTED_NOT_DELIVERED'||
            receipt.employeePersonId!==personId||
            receipt.enrollmentId!==enrollmentReceipt.enrollmentId||
            receipt.recipientId!==personId||
            receipt.workspaceId!==session.workspaceId||
            receipt.originalSigned!==true||
            receipt.originalKernelReadback!==true||
            receipt.invitationDelivered!==false||
             !Number.isSafeInteger(receipt.statusSequence)||
             receipt.statusSequence<=0||
             !HEX.test(receipt.packageSha256)||
            !Number.isSafeInteger(receipt.bytes)||receipt.bytes<=0)
           throw Error('CEN_D3_EMPLOYEE_INVITATION_ORIGINAL_EXPORT_HOLD');
         setEmployeeInviteReceipt(receipt);
       })}>Сохранить персональное приглашение .iwxa</button>
     {employeeInviteReceipt?.originalSigned===true&&
      <p data-testid="d3-employee-invitation-export-receipt">
       Подписанный .iwxa сохранён, доставка не подтверждена. SHA-256:
       <code>{employeeInviteReceipt.packageSha256}</code>
      </p>}
     <div data-testid="d3-employee-manager-task-data">
      <p>Руководитель отдельно получает DATA package.export только для
         этого сотрудника. Это не создаёт Task и не доставляет файл.</p>
      <div className="actions">
       <button data-testid="d3-employee-task-grant-issue"
        disabled={busy||taskGrantAttempted||managerTaskGrantOk}
        onClick={()=>void run('Оригинальный Kernel подтвердил адресный DATA-грант.',async()=>{
          if(taskGrantAttempted)throw Error('CEN_D3_EMPLOYEE_TASK_DATA_USE_READBACK');
          setTaskGrantAttempted(true);
          let result:any;
          try{
            result=await execute('d3EmployeeTaskGrantIssue',{
              employeePersonId:personId,
              enrollmentId:enrollmentReceipt.enrollmentId,confirmed:true
            });
          }catch(e){
            if(String(e).replace(/^Error:\s*/,'').trim()===
              'CEN_D3_EMPLOYEE_TASK_DATA_HUMAN_CANCELLED')
              setTaskGrantAttempted(false);
            throw e;
          }
          if(result?.state!=='ORIGINAL_MANAGER_TASK_DATA_ACTIVE'||
             result.originalReadback!==true||result.safeToReissue!==false||
             result.recipientId!==personId||result.taskSigned!==false||
             result.taskDelivered!==false)
            throw Error('CEN_D3_EMPLOYEE_TASK_DATA_UNKNOWN_READBACK_REQUIRED');
          const cold=await execute('d3EmployeeTaskGrantReadback',{
            employeePersonId:personId,enrollmentId:enrollmentReceipt.enrollmentId
          });
          setTaskGrantReceipt(cold);
          if(cold?.state!=='ORIGINAL_MANAGER_TASK_DATA_ACTIVE')
            throw Error('CEN_D3_EMPLOYEE_TASK_DATA_UNKNOWN_READBACK_REQUIRED');
        })}>Выдать адресное право на Task</button>
       <button className="secondary" data-testid="d3-employee-task-grant-read"
        disabled={busy} onClick={()=>void run('Адресный DATA-грант перечитан без записи.',async()=>{
          const cold=await execute('d3EmployeeTaskGrantReadback',{
            employeePersonId:personId,enrollmentId:enrollmentReceipt.enrollmentId
          });
          if(cold?.schema!=='IWXA_T3_ORIGINAL_EMPLOYEE_TASK_DATA_READBACK/1'||
             cold.originalReadback!==true||cold.safeToReissue!==false||
             cold.organizationId!==session.organizationId||
             cold.workspaceId!==session.workspaceId||
             cold.employeePersonId!==personId||cold.recipientId!==personId||
             cold.managerPersonId!==session.actorId||
             cold.enrollmentId!==enrollmentReceipt.enrollmentId)
            throw Error('CEN_D3_EMPLOYEE_TASK_DATA_READBACK_HOLD');
          setTaskGrantReceipt(cold);
        })}>Перечитать исходный DATA-грант</button>
      </div>
      {taskGrantAttempted&&!managerTaskGrantOk&&<p className="notice subdued">
         После отправки запись могла завершиться без ответа. Повторное
         подтверждение запрещено; только оригинальный readback.</p>}
      {managerTaskGrantOk&&<p data-testid="d3-employee-task-grant-confirmed">
         Подтверждено отдельное DATA-право руководителя для {personId}.
         Task ещё не подписана и не доставлена.</p>}
      {managerTaskGrantOk&&!invitationCurrentForTask&&
       <p className="notice subdued" data-testid="d3-employee-task-invite-stale">
        После выдачи DATA-гранта сохраните персональное приглашение .iwxa
        с новым подписанным STATUS. Ранее сохранённый файл устарел.</p>}
     </div>
     {!taskIssueAvailable&&<p className="notice subdued" data-testid="d3-employee-task-owner-unavailable">
       Оригинальный Kernel сейчас не подключён к владельцу Task.
        Откройте доверенную Workspace и перечитайте адресный DATA-грант.</p>}
     <label>Текст поручения
      <textarea data-testid="d3-employee-task-text" rows={3} maxLength={10000}
        value={taskText} disabled={busy||taskAttempted}
        onChange={e=>setTaskText(e.target.value)}/>
     </label>
     <label>Исходный ID поручения (сохраните до отправки)
      <input data-testid="d3-employee-task-id" value={taskId}
        disabled={busy||taskAttempted} onChange={e=>setTaskId(e.target.value)}/>
     </label>
     <button data-testid="d3-employee-task-create" disabled={!taskIssueAvailable||
        !invitationCurrentForTask||busy||taskAttempted||
       !/^task:[A-Za-z0-9-]{1,100}$/.test(taskId)||!taskText.trim()}
       onClick={()=>void run('Оригинальная Task подписана адресату, доставка не подтверждена.',async()=>{
        if(taskAttempted||!managerTaskGrantOk||
            !ID.test(enrollmentReceipt.enrollmentId))
           throw Error('CEN_D3_EMPLOYEE_TASK_ORIGINAL_DATA_GRANT_REQUIRED');
         setTaskAttempted(true);
         let result:any;
         try{
           result=await execute('d3EmployeeCreateTask',{
             enrollmentId:enrollmentReceipt.enrollmentId,
             employeePersonId:personId,taskId,task:taskText.trim(),confirmed:true
           });
         }catch(e){
           if(String(e).replace(/^Error:\s*/,'').trim()===
             'CEN_D3_EMPLOYEE_TASK_HUMAN_CANCELLED')setTaskAttempted(false);
           throw e;
         }
        const confirmed=validateOriginalEmployeeTaskIssueReceipt(result,{
          employeePersonId:personId,
          enrollmentId:enrollmentReceipt.enrollmentId,taskId
        });
        setTaskReceipt(confirmed);
       })}>3. Подписать Task этому сотруднику</button>
     <button data-testid="d3-employee-task-read" disabled={!taskIssueAvailable||busy||!/^task:[A-Za-z0-9-]{1,100}$/.test(taskId)}
       onClick={()=>void run('Состояние исходной подписанной Task проверено без повторного выпуска.',async()=>{
        const result=await execute('d3EmployeeTaskReadback',{
          enrollmentId:enrollmentReceipt.enrollmentId,
           employeePersonId:personId,taskId});
         if(result?.schema==='IWXA_T3_ORIGINAL_EMPLOYEE_TASK_READBACK/1'&&
            result.found===false&&result.taskId===taskId&&
            result.status==='ORIGINAL_SIGNED_CARRIER_WITHOUT_INVENTORY_HOLD'&&
            result.automaticReissueAllowed===false){
           setTaskAttempted(true);setTaskReceipt(null);
           setTaskRecoveryHold(true);
           return;
         }
         if(result?.schema!=='IWXA_T3_ORIGINAL_EMPLOYEE_TASK_READBACK/1'||
            result.found!==true||result.recipientId!==personId||
            result.enrollmentId!==enrollmentReceipt.enrollmentId||
            result.originalKernelReadback!==true||result.taskDelivered!==false||
            result.taskId!==taskId||!HEX.test(result.taskRevisionId)||
           !HEX.test(result.packageSha256)||
           result?.status!=='SIGNED_TASK_PERSISTED_NOT_DELIVERED')
          throw Error('CEN_D3_EMPLOYEE_TASK_ORIGINAL_READBACK_HOLD');
        setTaskRecoveryHold(false);setTaskReceipt(result);setTaskAttempted(true);
        setTaskNeedsRebind(false);
       })}>Перечитать подписанную Task</button>
     {taskRecoveryHold&&<div data-testid="d3-employee-task-orphan-recovery">
       <p className="notice subdued">Исходный подписанный .iwxa найден, но
         запись Task в каталоге отсутствует после прерванной операции.
         Новая подпись запрещена. Перечитайте исходный DATA-грант
         и восстановите каталог с отдельным согласием. Повторное
         сохранение персонального приглашения здесь не требуется.</p>
       <button data-testid="d3-employee-task-recover" disabled={busy||
         !taskIssueAvailable||!managerTaskGrantOk||taskRecoveryAttempted}
         onClick={()=>void run('Каталог Task восстановлен из исходных подписанных байтов.',async()=>{
          setTaskRecoveryAttempted(true);
          let result:any;
          try{
            result=await execute('d3EmployeeRecoverOrphanTask',{
              employeePersonId:personId,
              enrollmentId:enrollmentReceipt.enrollmentId,taskId,
              confirmed:true
            });
          }catch(e){
            if(String(e).replace(/^Error:\s*/,'').trim()===
              'CEN_D3_EMPLOYEE_TASK_RECOVERY_HUMAN_CANCELLED')
              setTaskRecoveryAttempted(false);
            throw e;
          }
          if(result?.schema!=='IWXA_T3_ORIGINAL_EMPLOYEE_TASK_RECOVERY/1'||
             result.found!==true||result.taskId!==taskId||
             result.recipientId!==personId||
             result.enrollmentId!==enrollmentReceipt.enrollmentId||
             result.status!=='SIGNED_TASK_PERSISTED_NOT_DELIVERED'||
             result.recoveredOriginalCarrier!==true||
             result.originalKernelReadback!==true||
             result.signatureReissued!==false||
             result.automaticReissueAllowed!==false||
             result.taskDelivered!==false||
             !HEX.test(result.packageSha256)||
             !HEX.test(result.taskRevisionId))
            throw Error('CEN_D3_EMPLOYEE_TASK_ORIGINAL_RECOVERY_HOLD');
          setTaskReceipt(result);setTaskRecoveryHold(false);setTaskAttempted(true);
          // The original native owner advanced its signed D1 epoch. A
          // separate cold readback in the reattached Kernel is required
          // before the archive can be exported again.
          setTaskNeedsRebind(true);
         })}>Восстановить каталог без новой подписи</button>
       {taskRecoveryAttempted&&<p className="notice subdued">
         Если ответ потерян, не запускайте восстановление повторно.
         Перезапустите подписанную Workspace и перечитайте Task.</p>}
     </div>}
     {taskNeedsRebind&&<p className="notice subdued"
        data-testid="d3-employee-task-recovery-rebind">
        Каталог восстановлен без новой подписи. Откройте доверенную
        Workspace заново и перечитайте Task перед сохранением .iwxa.</p>}
     <button className="secondary" data-testid="d3-employee-task-export"
        disabled={busy||taskNeedsRebind||!taskIssueAvailable||
          taskReceipt?.originalKernelReadback!==true||
          taskReceipt?.taskId!==taskId||taskReceipt?.recipientId!==personId}
        onClick={()=>void run('Оригинальный подписанный .iwxa сохранён, доставка не подтверждена.',async()=>{
         const result=await execute('d3EmployeeExportTask',{
           employeePersonId:personId,
           enrollmentId:enrollmentReceipt.enrollmentId,taskId
         });
         if(result?.status==='CANCELLED')return false;
         if(result?.schema!=='IWXA_T3_ORIGINAL_EMPLOYEE_TASK_EXPORT/1'||
            result.status!=='EXPORTED_UNDELIVERED'||
            result.originalSigned!==true||result.taskDelivered!==false||
            result.taskId!==taskId||result.recipientId!==personId||
            result.taskRevisionId!==taskReceipt.taskRevisionId||
            result.packageSha256!==taskReceipt.packageSha256||
            !Number.isSafeInteger(result.bytes)||result.bytes<=0)
           throw Error('CEN_D3_EMPLOYEE_TASK_EXPORT_READBACK_HOLD');
        })}>Сохранить подписанную Task .iwxa</button>
      {taskAttempted&&!taskReceipt&&<p className="notice subdued">
       Task могла быть подписана до потери ACK. Повторный выпуск запрещён:
       используйте только исходный readback.</p>}
     {taskReceipt&&<p data-testid="d3-employee-task-receipt">
       Подписанная Task: {taskReceipt.taskId} · {taskReceipt.taskRevisionId}.
       Доставка сотруднику не подтверждена.</p>}
    </div>}
   </div>}
  </div>}
 </section>;
}
