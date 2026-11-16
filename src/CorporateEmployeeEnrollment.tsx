import React,{useState} from 'react';

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
export default function CorporateEmployeeEnrollment({session,contacts,execute,run,busy}:{
 session:Session;contacts:Contact[];execute:Exec;run:Run;busy:boolean;
}){
 const [contact,setContact]=useState('');
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
 const [enrollmentProof,setEnrollmentProof]=useState('');
 const [enrollmentAttempted,setEnrollmentAttempted]=useState(false);
 const [enrollmentReceipt,setEnrollmentReceipt]=useState<any>(null);
 const [taskText,setTaskText]=useState('');
 const [taskId,setTaskId]=useState('');
 const [taskAttempted,setTaskAttempted]=useState(false);
 const [taskReceipt,setTaskReceipt]=useState<any>(null);
 const available=session.d3EmployeeEnrollmentAvailable===true;
 const bootstrap=session.d3EmployeeRegistryBootstrapAvailable===true;
 const registryRead=session.d3EmployeeRegistryReadbackAvailable===true;
 const taskIssueAvailable=session.d3EmployeeTaskIssueAvailable===true;
 const personOk=ID.test(personId)&&personId!==session.actorId;
 const credentialOk=credentialReceipt?.state==='ORIGINAL_PROOF_CREDENTIAL_ADMITTED'&&
   credentialReceipt.employeePersonId===personId&&
   credentialReceipt.credentialKeyId===keyId&&
   credentialReceipt.originalReadback===true;
 const enrolled=enrollmentReceipt?.state==='ORIGINAL_GRANTS_ACTIVE'&&
   enrollmentReceipt.employeePersonId===personId&&
   enrollmentReceipt.originalReadback===true&&
   enrollmentReceipt.originalSigned===true;
 const reset=()=>{
   setCredentialChallenge(null);setCredentialProof('');setCredentialAttempted(false);
   setCredentialReceipt(null);setEnrollmentChallenge(null);setRecoveryEnrollmentId('');
   setEnrollmentProof('');
   setEnrollmentAttempted(false);setEnrollmentReceipt(null);
   setTaskId('');setTaskText('');setTaskAttempted(false);setTaskReceipt(null);
 };
 const confirmCredential=()=>run('Подлинность ключа перечитана из оригинального Kernel.',async()=>{
   if(!credentialChallenge)throw Error('CEN_D3_EMPLOYEE_KEY_PROOF_NOT_PREPARED');
   // Once sent, a lost ACK is read-only recovery, never another admission.
   if(credentialAttempted)throw Error('CEN_D3_EMPLOYEE_ADMISSION_OUTCOME_UNKNOWN');
   const employeeProof=proof(credentialProof);
   if(employeeProof.keyId!==keyId)throw Error('CEN_D3_EMPLOYEE_PROOF_KEY_MISMATCH');
   setCredentialAttempted(true);
   const result=await execute('d3EmployeeCredentialAdmit',{
     employeePersonId:personId,credentialKeyId:keyId,
     admissionId:credentialChallenge.admissionId,employeeProof});
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
   const result=await execute('d3EmployeeComplete',{
     enrollmentId:enrollmentChallenge.enrollmentId,employeeProof});
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
      <button data-testid="d3-employee-registry-initialize" disabled={busy}
       onClick={()=>void run('Исходный реестр проверен в оригинальном Kernel.',async()=>{
         const result=await execute('d3EmployeeRegistryInitialize',{confirmed:true});
         if(result?.state!=='ORIGINAL_KERNEL_REGISTRY_CONFIRMED'||
            result.organizationId!==session.organizationId||
            result.workspaceId!==session.workspaceId||
            result.originalReadback!==true||result.originalKernel!==true)
           throw Error('CEN_D3_EMPLOYEE_REGISTRY_READBACK_UNCONFIRMED');
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
     </div>
    </div>}
    {enrollmentAttempted&&!enrolled&&<p className="notice subdued">
       Ответ после записи мог потеряться. Не выдавайте grants повторно.
       Выполните исходный readEnrollment.</p>}
    {enrolled&&<div data-testid="d3-employee-enrolled">
     <p>Подтверждены отдельные ACTION work.prepare и DATA package.export.
        Получатель не получает ключ issuer или полномочия руководителя.
        Доставка приглашения не подтверждена.</p>
     {!taskIssueAvailable&&<p className="notice subdued" data-testid="d3-employee-task-owner-unavailable">
       Подписанная регистрация сотрудника не является разрешением выдать ему
       Task. Нужна оригинальная T3-операция выдачи конкретному адресату
       с отдельным подтверждённым правом на экспорт такой Task.</p>}
     <label>Текст поручения
      <textarea data-testid="d3-employee-task-text" rows={3} maxLength={10000}
        value={taskText} disabled={busy||taskAttempted}
        onChange={e=>setTaskText(e.target.value)}/>
     </label>
     <label>Исходный ID поручения (сохраните до отправки)
      <input data-testid="d3-employee-task-id" value={taskId}
        disabled={busy||taskAttempted} onChange={e=>setTaskId(e.target.value)}/>
     </label>
     <button data-testid="d3-employee-task-create" disabled={!taskIssueAvailable||busy||taskAttempted||
       !/^task:[A-Za-z0-9-]{1,100}$/.test(taskId)||!taskText.trim()}
       onClick={()=>void run('Оригинальная Task подписана адресату, доставка не подтверждена.',async()=>{
        if(taskAttempted||!ID.test(recoveryEnrollmentId))throw Error('CEN_D3_EMPLOYEE_TASK_OUTCOME_UNKNOWN');
        setTaskAttempted(true);
        const result=await execute('d3EmployeeCreateTask',{
          enrollmentId:recoveryEnrollmentId,
          employeePersonId:personId,taskId,task:taskText.trim()});
        if(result?.status!=='SIGNED_TASK_CREATED_NOT_DELIVERED'||
           result.recipientId!==personId||result.taskId!==taskId||
           !HEX.test(result.packageSha256)||!HEX.test(result.taskRevisionId))
          throw Error('CEN_D3_EMPLOYEE_TASK_ORIGINAL_SIGNING_UNCONFIRMED');
        setTaskReceipt(result);
       })}>3. Подписать Task этому сотруднику</button>
     <button data-testid="d3-employee-task-read" disabled={!taskIssueAvailable||busy||!/^task:[A-Za-z0-9-]{1,100}$/.test(taskId)}
       onClick={()=>void run('Подписанная Task перечитана без повторного выпуска.',async()=>{
        const result=await execute('d3EmployeeTaskReadback',{
          enrollmentId:recoveryEnrollmentId,
          employeePersonId:personId,taskId});
        if(result?.found!==true||result?.recipientId!==personId||
           result?.taskId!==taskId||!HEX.test(result.taskRevisionId)||
           !HEX.test(result.packageSha256)||
           result?.status!=='SIGNED_TASK_PERSISTED_NOT_DELIVERED')
          throw Error('CEN_D3_EMPLOYEE_TASK_ORIGINAL_READBACK_HOLD');
        setTaskReceipt(result);setTaskAttempted(true);
       })}>Перечитать подписанную Task</button>
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
