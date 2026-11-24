import React,{useEffect,useState} from 'react';
import CorporateSeatAssignments from './CorporateSeatAssignments';
import {readOriginalEmployeeRegistryReceipt,readOriginalSeatView} from '../runtime/cen03-corporate-seats.mjs';
import {validateOriginalEmployeeTaskIssueReceipt,validateOriginalEmployeeTaskReadback,readOriginalEmployeeBootstrap,readOriginalEmployeePublicCandidate,
 employeeTaskContinuationKey,readEmployeeTaskContinuation,saveEmployeeTaskContinuation,clearEmployeeTaskContinuation,
 readOriginalEmployeeEnrollmentIdentity,readOriginalEmployeeCredentialIdentity,
 inspectOriginalEmployeeWorkspaceRights,inspectOriginalEmployeeTaskGrant}
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
  d3EmployeeTaskIssueAvailable?:boolean;
  d3EmployeeWorkspaceRightsAvailable?:boolean;
  d3EmployeeCorporateSeatsAvailable?:boolean};
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
export default function CorporateEmployeeEnrollment({session,contacts,preferredContactId=null,autoReadSeats=false,requireRegistryAbsence=false,registryAbsent=false,execute,run,busy,onOpenLicenses}:{
 session:Session;contacts:Contact[];preferredContactId?:string|null;autoReadSeats?:boolean;requireRegistryAbsence?:boolean;registryAbsent?:boolean;execute:Exec;run:Run;busy:boolean;onOpenLicenses?:()=>void;
}){
 // A preselected organizational contact is only a local draft hint;
 // never infer an employee PROOF key, signed identity or active grant.
 const [contact,setContact]=useState(()=>contacts.some(c=>c.id===preferredContactId)?preferredContactId??'':'');
 const [roster,setRoster]=useState<any>(null);
 const [rosterChoice,setRosterChoice]=useState('');
 const [personId,setPersonId]=useState('');
 const [keyId,setKeyId]=useState('');
 const [publicRecord,setPublicRecord]=useState('');
 const [bootstrapProfile,setBootstrapProfile]=useState<{profile:Record<string,unknown>;profileDigest:string}|null>(null);
 const [publicCandidate,setPublicCandidate]=useState('');
 const [copyNotice,setCopyNotice]=useState('');
 async function copyPublic(value:string){
  try{await navigator.clipboard.writeText(value);setCopyNotice('Скопировано.')}
  catch{setCopyNotice('Выделите и скопируйте текст вручную.')}
 }
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
 const [workspaceRightsAttempted,setWorkspaceRightsAttempted]=useState(false);
 const [workspaceRightsReceipt,setWorkspaceRightsReceipt]=useState<any>(null);
 const [workspaceReadHold,setWorkspaceReadHold]=useState(false);
 const [taskGrantAttempted,setTaskGrantAttempted]=useState(false);
 const [taskGrantReceipt,setTaskGrantReceipt]=useState<any>(null);
 const [taskGrantReadHold,setTaskGrantReadHold]=useState(false);
 const [taskText,setTaskText]=useState('');
 const [taskId,setTaskId]=useState('');
 const [taskAttempted,setTaskAttempted]=useState(false);
 const [taskReceipt,setTaskReceipt]=useState<any>(null);
 const [taskReadbackCurrent,setTaskReadbackCurrent]=useState(false);
 const [taskRecoveryHold,setTaskRecoveryHold]=useState(false);
 const [taskRecoveryAttempted,setTaskRecoveryAttempted]=useState(false);
 const [taskNeedsRebind,setTaskNeedsRebind]=useState(false);
 const [loadedTaskScope,setLoadedTaskScope]=useState<string|null>(null);
 const [taskContinuationBlocked,setTaskContinuationBlocked]=useState(false);
 const available=session.d3EmployeeEnrollmentAvailable===true;
 const bootstrap=session.d3EmployeeRegistryBootstrapAvailable===true;
 const registryRead=session.d3EmployeeRegistryReadbackAvailable===true;
 const taskIssueAvailable=session.d3EmployeeTaskIssueAvailable===true;
 const workspaceRightsAvailable=session.d3EmployeeWorkspaceRightsAvailable===true;
 const contactSelected=contacts.some(x=>x.id===contact);
 const personOk=ID.test(personId)&&personId!==session.actorId;
 const credentialOk=credentialReceipt?.state==='ORIGINAL_PROOF_CREDENTIAL_ADMITTED'&&
   credentialReceipt.employeePersonId===personId&&
   credentialReceipt.credentialKeyId===keyId&&
   credentialReceipt.originalReadback===true;
 // A status flag alone must never display another employee's corporate
 // rights as belonging to the currently selected identity. Original T3
 // verifies every signed envelope; the UI binds its exact public readback.
 let enrolled=false;
 if(credentialOk&&personOk){
   try{
     const identity=readOriginalEmployeeEnrollmentIdentity(enrollmentReceipt,{
       organizationId:session.organizationId,workspaceId:session.workspaceId,
       actorId:session.actorId,employeePersonId:personId,enrollmentId:recoveryEnrollmentId
     });
     enrolled=identity.credentialKeyId===keyId;
   }catch{/* No original bound enrollment: no employee authority in this form. */}
 }
 // A card is only a projection of current original signed readback, never
 // a second grant evaluator or local source of authority.
 const grantScope={organizationId:session.organizationId,workspaceId:session.workspaceId,
   actorId:session.actorId,employeePersonId:personId,
   enrollmentId:recoveryEnrollmentId,credentialKeyId:keyId};
 function inspected(kind:'workspace'|'task',receipt:any,scope=grantScope){
   try{return kind==='workspace'?inspectOriginalEmployeeWorkspaceRights(receipt,scope):
     inspectOriginalEmployeeTaskGrant(receipt,scope)}
   catch{return 'UNVERIFIED'}
 }
 const workspaceRightsOk=enrolled&&!workspaceReadHold&&
   inspected('workspace',workspaceRightsReceipt)==='ACTIVE';
 const managerTaskGrantOk=enrolled&&!taskGrantReadHold&&
   inspected('task',taskGrantReceipt)==='ACTIVE';
 const taskGrantKnownHold=inspected('task',taskGrantReceipt)==='HOLD';
 async function readGrant(kind:'workspace'|'task',scope=grantScope){
   const workspace=kind==='workspace';
   const setHold=workspace?setWorkspaceReadHold:setTaskGrantReadHold;
   const setReceipt=workspace?setWorkspaceRightsReceipt:setTaskGrantReceipt;
   // Old receipts cannot survive a failed current read.
   setHold(true);setReceipt(null);
   const result=await execute(workspace?'d3EmployeeWorkspaceGrantReadback':'d3EmployeeTaskGrantReadback',{
     employeePersonId:scope.employeePersonId,enrollmentId:scope.enrollmentId});
   const state=workspace?inspectOriginalEmployeeWorkspaceRights(result,scope):
     inspectOriginalEmployeeTaskGrant(result,scope);
   setReceipt(result);setHold(false);
   return state;
 }
 // The employee must import the current signed manager DATA + STATUS.
 const invitationCurrentForTask=managerTaskGrantOk&&workspaceRightsOk&&
   employeeInviteReceipt?.originalSigned===true&&
   employeeInviteReceipt.originalKernelReadback===true&&
   employeeInviteReceipt.enrollmentId===enrollmentReceipt.enrollmentId&&
   Number.isSafeInteger(employeeInviteReceipt.statusSequence)&&
   employeeInviteReceipt.statusSequence>=taskGrantReceipt.statusSequence&&
   employeeInviteReceipt.statusSequence>=workspaceRightsReceipt.statusSequence;
 // Do not couple the next Task to the employee's first-use form. The
 // continuation is scoped to the exact original enrollment and manager.
 // Retain a dispatched ID across contact navigation, owner epoch changes
 // and process restart, but never treat local storage as native readback.
 const taskScope=enrolled?employeeTaskContinuationKey(session.organizationId,
   session.workspaceId,session.actorId,personId,enrollmentReceipt.enrollmentId):null;
 const taskScopeReady=taskScope!==null&&loadedTaskScope===taskScope&&!taskContinuationBlocked;
 useEffect(()=>{
   setTaskId('');setTaskText('');setTaskAttempted(false);setTaskReceipt(null);setTaskReadbackCurrent(false);
   setTaskRecoveryHold(false);setTaskRecoveryAttempted(false);setTaskNeedsRebind(false);
   setLoadedTaskScope(null);setTaskContinuationBlocked(false);
   if(!taskScope)return;
   try{
     const pending=readEmployeeTaskContinuation(localStorage,taskScope);
     if(pending){setTaskId(pending);setTaskAttempted(true);}
     setLoadedTaskScope(taskScope);
   }catch{setTaskContinuationBlocked(true);}
 },[taskScope]);
 const freshTaskReadback=taskReadbackCurrent&&taskReceipt?.schema==='IWXA_T3_ORIGINAL_EMPLOYEE_TASK_READBACK/1'&&
   taskReceipt.found===true&&taskReceipt.originalKernelReadback===true&&
   taskReceipt.taskId===taskId&&taskReceipt.recipientId===personId&&
   taskReceipt.enrollmentId===enrollmentReceipt?.enrollmentId&&
   !taskNeedsRebind&&!taskRecoveryHold;
 const prepareNextTask=()=>run('Подготовлено новое поручение для того же сотрудника.',async()=>{
   if(!taskScopeReady||!taskScope||(taskAttempted&&!freshTaskReadback))
     throw Error('CEN_D3_EMPLOYEE_TASK_READBACK_BEFORE_NEW_REQUIRED');
   if(taskAttempted){
     try{clearEmployeeTaskContinuation(localStorage,taskScope,taskId)}
     catch(e){setTaskContinuationBlocked(true);throw e}
   }else{
     try{
       if(readEmployeeTaskContinuation(localStorage,taskScope)!==null)
         throw Error('CEN_D3_EMPLOYEE_TASK_CONTINUATION_ALREADY_PENDING');
     }catch(e){setTaskContinuationBlocked(true);throw e}
   }
   setTaskId('task:'+crypto.randomUUID());setTaskText('');
   setTaskAttempted(false);setTaskReceipt(null);setTaskReadbackCurrent(false);setTaskRecoveryHold(false);
   setTaskRecoveryAttempted(false);setTaskNeedsRebind(false);
 });
 const reset=()=>{
   setCredentialChallenge(null);setCredentialProof('');setCredentialAttempted(false);
   setCredentialReceipt(null);setEnrollmentChallenge(null);setRecoveryEnrollmentId('');
   setEnrollmentProof('');
   setEnrollmentAttempted(false);setEnrollmentReceipt(null);
   setEmployeeInviteReceipt(null);
   setWorkspaceRightsAttempted(false);setWorkspaceRightsReceipt(null);setWorkspaceReadHold(false);
   setTaskGrantAttempted(false);setTaskGrantReceipt(null);setTaskGrantReadHold(false);
   setTaskId('');setTaskText('');setTaskAttempted(false);setTaskReceipt(null);setTaskReadbackCurrent(false);
   setTaskRecoveryHold(false);setTaskRecoveryAttempted(false);
   setTaskNeedsRebind(false);setLoadedTaskScope(null);setTaskContinuationBlocked(false);
 };
 const refreshRoster=(employeeOffset=0)=>run('Исходный список сотрудников перечитан.',async()=>{
   setRoster(null);setRosterChoice('');
   const result=readOriginalSeatView(await execute('d3EmployeeSeatView',{offset:0,employeeOffset}),
     session.organizationId,session.workspaceId);
   setRoster(result);
 });
 const restoreRosterEmployee=()=>run('Подключённый сотрудник восстановлен из исходного T3 без выдачи новых прав.',async()=>{
   const selected=roster?.eligibleEmployees.find((row:any)=>row.personId===rosterChoice);
   if(!selected)throw Error('CEN_D3_EMPLOYEE_ROSTER_SELECTION_REQUIRED');
   // A selected row is only a locator, not an authorization. Read the
   // current same page, enrollment and exact independent PROOF key.
   setRoster(null);
   const current=readOriginalSeatView(await execute('d3EmployeeSeatView',{
     offset:0,employeeOffset:roster.employeeOffset}),session.organizationId,session.workspaceId);
   setRoster(current);
   const row=current.eligibleEmployees.find((m:any)=>m.personId===selected.personId&&
     m.enrollmentId===selected.enrollmentId);
   if(!row)throw Error('CEN_D3_EMPLOYEE_ROSTER_SELECTION_STALE');
   const same=personId===row.personId&&recoveryEnrollmentId===row.enrollmentId;
   // Failed reads of the active selection must invalidate its authority
   // presentation. Pending Task identity survives in the scoped continuation.
   if(same)setEnrollmentReceipt(null);
   setWorkspaceRightsReceipt(null);setWorkspaceReadHold(true);
   setTaskGrantReceipt(null);setTaskGrantReadHold(true);
   setEmployeeInviteReceipt(null);setTaskReadbackCurrent(false);
   const result=await execute('d3EmployeeRead',{
     employeePersonId:row.personId,enrollmentId:row.enrollmentId});
   const identity=readOriginalEmployeeEnrollmentIdentity(result,{
     organizationId:session.organizationId,workspaceId:session.workspaceId,
     actorId:session.actorId,employeePersonId:row.personId,enrollmentId:row.enrollmentId});
   const credential=readOriginalEmployeeCredentialIdentity(
     await execute('d3EmployeeCredentialRead',{
       employeePersonId:identity.employeePersonId,credentialKeyId:identity.credentialKeyId}),identity);
   if(!same||keyId!==identity.credentialKeyId){
     reset();setContact('');setPublicRecord('');setPublicCandidate('');setCopyNotice('');
   }
   setPersonId(identity.employeePersonId);setKeyId(identity.credentialKeyId);
   setRecoveryEnrollmentId(identity.enrollmentId);setCredentialReceipt(credential);
   setEnrollmentReceipt(result);
   // Reopen the exact employee and both independent rights in one action.
   // A missing right is different from a revoked or unreadable right.
   const scope={organizationId:session.organizationId,workspaceId:session.workspaceId,
     actorId:session.actorId,employeePersonId:identity.employeePersonId,
     enrollmentId:identity.enrollmentId,credentialKeyId:identity.credentialKeyId};
   let held=false;
   if(workspaceRightsAvailable){
     try{await readGrant('workspace',scope)}catch{held=true}
   }
   if(taskIssueAvailable){
     try{await readGrant('task',scope)}catch{held=true}
   }
   if(held)throw Error('CEN_D3_EMPLOYEE_EXISTING_RIGHTS_READBACK_HOLD');
 });
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
 return <section className="nested-form" data-testid="d3-independent-employee" tabIndex={-1}>
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
         const result=readOriginalEmployeeRegistryReceipt(await execute('d3EmployeeRegistryReadback',{}),
           session.organizationId,session.workspaceId);
         if(result==='WORKSPACE_NOT_READY')
           throw Error('CEN_D3_ORIGINAL_EMPLOYEE_WORKSPACE_NOT_READY');
         if(result==='NOT_FOUND')
           throw Error('CEN_D3_EMPLOYEE_REGISTRY_NOT_PRESENT_USE_EXPLICIT_INITIALIZE');
       })}>Проверить реестр без записи</button>
     </div>}
     {bootstrap&&(!requireRegistryAbsence||registryAbsent)&&<div>
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
  <>
  {session.d3EmployeeCorporateSeatsAvailable===true&&<div className="nested-form" data-testid="d3-employee-roster">
   <h4>Ранее подключённые сотрудники</h4>
   <p>Откройте сотрудника из подписанного реестра, чтобы восстановить его полномочия и поручения.
     Повторное подключение или выдача ключей не требуются.</p>
   <button type="button" className="secondary" data-testid="d3-employee-roster-read" disabled={busy}
     onClick={()=>void refreshRoster()}>Прочитать подключённых сотрудников</button>
   {roster&&<>
    <label>Сотрудник из исходного T3
     <select value={rosterChoice} data-testid="d3-employee-roster-person" disabled={busy}
       onChange={e=>setRosterChoice(e.target.value)}>
      <option value="">Выберите сотрудника</option>
      {roster.eligibleEmployees.filter((m:any)=>m.personId!==session.actorId).map((m:any)=>
        <option key={m.personId} value={m.personId}>{m.personId}</option>)}
     </select>
    </label>
    <div className="actions">
     <button type="button" className="secondary" disabled={busy||roster.employeeOffset===0}
       onClick={()=>void refreshRoster(Math.max(0,roster.employeeOffset-64))}>Предыдущие</button>
     <span>{roster.employeeTotal===0?'0':roster.employeeOffset+1}–{roster.employeeOffset+roster.eligibleEmployees.length} из {roster.employeeTotal}</span>
     <button type="button" className="secondary" disabled={busy||roster.employeeNextOffset===null}
       onClick={()=>void refreshRoster(roster.employeeNextOffset)}>Следующие</button>
     <button type="button" data-testid="d3-employee-roster-open" disabled={busy||!rosterChoice}
       onClick={()=>void restoreRosterEmployee()}>Открыть подключённого сотрудника</button>
    </div>
   </>}
  </div>}
  <div className="nested-form" data-testid="d3-employee-bootstrap">
   <h4>Первое подключение сотрудника</h4>
   <label>Сотрудник в организации
    <select data-testid="d3-employee-contact" value={contact} disabled={busy}
      onChange={e=>{
        // The contact is a draft hint only; never carry another person's
        // candidate, key or unfinished proof to a newly selected contact.
        setContact(e.target.value);setPersonId('');setKeyId('');
        setPublicCandidate('');setCopyNotice('');setPublicRecord('');reset();
      }}>
     <option value="">Выберите сотрудника</option>
     {contacts.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
    </select>
   </label>
   {!contactSelected&&<p className="muted">{contacts.length===0
    ?'Добавьте сотрудника в структуру организации перед переносом его публичной записи.'
    :'Сначала выберите сотрудника, затем перенесите полученную от него запись.'}
    {' '}Публичный профиль организации можно получить заранее.</p>}
   <p>Передайте сотруднику исходный публичный профиль организации. Контрольный отпечаток сообщите отдельно. Agent создаст собственные ключи на компьютере сотрудника.</p>
   <button type="button" data-testid="d3-employee-bootstrap-profile" disabled={busy}
    onClick={()=>void run('Исходный профиль подключения прочитан.',async()=>{
     setBootstrapProfile(null);setPublicCandidate('');setCopyNotice('');
     const receipt=await execute('d3EmployeeBootstrapProfile',{});
     setBootstrapProfile(readOriginalEmployeeBootstrap(receipt,session));
    })}>Получить профиль подключения</button>
   {bootstrapProfile&&<>
    <label>Публичный профиль для Agent
     <textarea readOnly rows={4} value={JSON.stringify(bootstrapProfile.profile,null,2)}
      onFocus={e=>e.currentTarget.select()} data-testid="d3-employee-bootstrap-profile-json"/></label>
    <button className="secondary" type="button" onClick={()=>void copyPublic(JSON.stringify(bootstrapProfile.profile,null,2))}>Скопировать профиль</button>
    <label>Контрольный отпечаток SHA-256
     <input readOnly value={bootstrapProfile.profileDigest} onFocus={e=>e.currentTarget.select()}
      data-testid="d3-employee-bootstrap-fingerprint"/></label>
    <button type="button" className="secondary" onClick={()=>void copyPublic(bootstrapProfile.profileDigest)}>Скопировать отпечаток</button>
    <label>Публичная запись, полученная от Agent
     <textarea rows={4} maxLength={32768} value={publicCandidate} disabled={busy}
      onChange={e=>setPublicCandidate(e.target.value)} data-testid="d3-employee-bootstrap-candidate"/></label>
    <button type="button" disabled={busy||!contactSelected||!publicCandidate.trim()||!!credentialChallenge||!!enrollmentChallenge||
      credentialAttempted||enrollmentAttempted}
      data-testid="d3-employee-bootstrap-candidate-read"
      onClick={()=>void run('Публичная запись перенесена. Ключ ещё не подтверждён.',async()=>{
       if(!contactSelected)throw Error('CEN_D3_EMPLOYEE_CONTACT_REQUIRED');
       const c=readOriginalEmployeePublicCandidate(publicCandidate,session,bootstrapProfile);
       setPersonId(c.employeePersonId);setKeyId(c.credentialKeyId);
       setPublicRecord(JSON.stringify(c.keyRecord,null,2));reset();
      })}>Перенести публичную запись</button>
    {copyNotice&&<p role="status">{copyNotice}</p>}
   </>}
  </div>
  <div className="form-grid">
   <label>Подписанная личность T3 сотрудника
    <input data-testid="d3-employee-person" value={personId} disabled={busy}
      placeholder="person:..." onChange={e=>{setPersonId(e.target.value.trim());reset();}}/>
   </label>
   <label>Идентификатор публичного PROOF-ключа
    <input data-testid="d3-employee-key" value={keyId} disabled={busy}
      placeholder="key:..." onChange={e=>{setKeyId(e.target.value.trim());reset();}}/>
   </label>
  </div></>}
  {available&&<div data-testid="d3-employee-steps">
   <label>Публичная запись ключа, полученная от сотрудника
    <textarea data-testid="d3-employee-key-record" value={publicRecord} rows={3}
      disabled={busy} onChange={e=>{setPublicRecord(e.target.value);reset();}}
      placeholder='{"subjectId":"person:...","publicKey":"-----BEGIN PUBLIC KEY-----..."}'/>
   </label>
   <div className="actions">
    <button data-testid="d3-employee-credential-begin" disabled={busy||!contactSelected||!personOk||
      !ID.test(keyId)||!!credentialChallenge||credentialAttempted||credentialOk}
     onClick={()=>void run('Запрос оригинального подтверждения ключа создан.',async()=>{
       if(!contactSelected)throw Error('CEN_D3_EMPLOYEE_CONTACT_REQUIRED');
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
    <textarea aria-label="Запрос подтверждения ключа" data-testid="d3-employee-credential-challenge" readOnly rows={4}
      value={JSON.stringify({request:credentialChallenge.employeeRequest,
        challenge:credentialChallenge.employeeChallenge},null,2)} onFocus={e=>e.currentTarget.select()}/>
    <button className="secondary" type="button" onClick={()=>void copyPublic(JSON.stringify({request:credentialChallenge.employeeRequest,
      challenge:credentialChallenge.employeeChallenge},null,2))}>Скопировать запрос ключа</button>
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
     <textarea aria-label="Запрос подтверждения подключения" data-testid="d3-employee-enrollment-challenge" readOnly rows={4}
       value={JSON.stringify({request:enrollmentChallenge.request,
         challenge:enrollmentChallenge.challenge},null,2)} onFocus={e=>e.currentTarget.select()}/>
     <button className="secondary" type="button" onClick={()=>void copyPublic(JSON.stringify({request:enrollmentChallenge.request,
       challenge:enrollmentChallenge.challenge},null,2))}>Скопировать запрос подключения</button>
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
     <div className="nested-form" data-testid="d3-employee-workspace-rights">
       <h3>Доступ сотрудника к Workspace</h3>
       <p>Чтобы сотрудник работал с данными компании, руководитель отдельно
         разрешает чтение, сохранение, создание Workspace и импорт полного
         архива через Exchange. Само членство этих прав не предоставляет.</p>
       <div className="actions">
         <button data-testid="d3-employee-workspace-grants-issue"
           disabled={!workspaceRightsAvailable||busy||
             workspaceRightsAttempted||workspaceRightsOk||workspaceReadHold}
           onClick={()=>void run('Исходный Kernel подтвердил четыре права Workspace.',async()=>{
             if(workspaceRightsAttempted||workspaceReadHold)
               throw Error('CEN_D3_EMPLOYEE_WORKSPACE_RIGHTS_USE_READBACK');
             const before=await readGrant('workspace');
             if(before==='ACTIVE')return;
             if(before!=='NOT_FOUND')throw Error('CEN_D3_EMPLOYEE_WORKSPACE_RIGHTS_READBACK_REQUIRED');
             setWorkspaceRightsAttempted(true);
             let r:any;
             try {
               r=await execute('d3EmployeeWorkspaceGrantIssue',{
                 employeePersonId:personId,
                 enrollmentId:enrollmentReceipt.enrollmentId,
                 confirmed:true
               });
             } catch(e) {
               if(String(e).replace(/^Error:\s*/,'').trim()===
                  'CEN_D3_EMPLOYEE_WORKSPACE_RIGHTS_HUMAN_CANCELLED')
                 setWorkspaceRightsAttempted(false);
               throw e;
             }
             if(r?.state!=='ORIGINAL_EMPLOYEE_WORKSPACE_RIGHTS_ACTIVE'||
               r.originalReadback!==true||r.safeToReissue!==false)
               throw Error('CEN_D3_EMPLOYEE_WORKSPACE_RIGHTS_READBACK_REQUIRED');
             if(await readGrant('workspace')!=='ACTIVE')
               throw Error('CEN_D3_EMPLOYEE_WORKSPACE_RIGHTS_READBACK_REQUIRED');
           })}>Разрешить работу и перенос Workspace</button>
         <button className="secondary" data-testid="d3-employee-workspace-grants-read"
           disabled={!workspaceRightsAvailable||busy}
           onClick={()=>void run('Подписанные права перечитаны без новой выдачи.',async()=>{
             await readGrant('workspace');
           })}>Проверить выданные права</button>
       </div>
       {workspaceRightsOk&&<p role="status" data-testid="d3-employee-workspace-rights-confirmed">
         Четыре права подтверждены исходным Kernel. Импорт будет разрешён
         только в выбранную корпоративную Workspace.</p>}
       {workspaceReadHold&&<p role="alert" data-testid="d3-employee-workspace-rights-hold">
         Не удалось подтвердить состояние прав Workspace. Перечитайте исходные права перед новой выдачей.</p>}
       {workspaceRightsAttempted&&!workspaceRightsOk&&<p className="notice subdued">
         Ответ мог потеряться после записи. Не выдавайте права повторно.
         Используйте проверку выданных прав.</p>}
       {!workspaceRightsAvailable&&<p className="notice subdued">
         Подключите исходный T2 Kernel с поддержкой корпоративного Exchange.
         Пока права недоступны, приглашение к передаче Workspace не выдаётся.</p>}
     </div>
     <p>Приглашение содержит только подтверждённые права сотрудника
        и текущий подписанный STATUS. Сотрудник открывает Workspace
        и импортирует архив через штатный Exchange.</p>
     <p>Оригинальный T3 сохраняет ранее выданные этому сотруднику права
       в персональное подписанное приглашение .iwxa. Выдача грантов
       не повторяется. Приём файла в Agent ещё требуется подтвердить.</p>
     <button data-testid="d3-employee-invitation-export" disabled={busy||!workspaceRightsOk}
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
        disabled={busy||!taskIssueAvailable||taskGrantAttempted||managerTaskGrantOk||taskGrantReadHold||taskGrantKnownHold}
        onClick={()=>void run('Оригинальный Kernel подтвердил адресный DATA-грант.',async()=>{
          if(taskGrantAttempted||taskGrantReadHold||taskGrantKnownHold)
            throw Error('CEN_D3_EMPLOYEE_TASK_DATA_USE_READBACK');
          const before=await readGrant('task');
          if(before==='ACTIVE')return;
          if(before!=='NOT_FOUND')throw Error('CEN_D3_EMPLOYEE_TASK_DATA_READBACK_HOLD');
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
          if(await readGrant('task')!=='ACTIVE')
            throw Error('CEN_D3_EMPLOYEE_TASK_DATA_UNKNOWN_READBACK_REQUIRED');
        })}>Выдать адресное право на Task</button>
       <button className="secondary" data-testid="d3-employee-task-grant-read"
        disabled={busy} onClick={()=>void run('Адресный DATA-грант перечитан без записи.',async()=>{
          await readGrant('task');
        })}>Перечитать исходный DATA-грант</button>
      </div>
      {(taskGrantReadHold||taskGrantKnownHold)&&<p role="alert" data-testid="d3-employee-task-grant-hold">
        Адресное право не подтверждено, отозвано или истекло. Перечитайте исходный грант.
        Новая выдача и подписание поручений недоступны.</p>}
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
     <h3>Поручения сотруднику</h3>
     <p>Подготовьте новое поручение или восстановите ранее подписанное по исходному ID.
       Повторное подключение сотрудника для следующего поручения не требуется.</p>
     {taskContinuationBlocked&&<p role="alert" data-testid="d3-employee-task-continuation-blocked">
       Не удалось прочитать или сохранить идентификатор операции. Новая подпись заблокирована.
       Перечитайте исходное поручение. После устранения ошибки хранения заново откройте раздел сотрудника.</p>}
     <button type="button" className="secondary" data-testid="d3-employee-task-new"
       disabled={busy||!taskScopeReady||(taskAttempted&&!freshTaskReadback)}
       onClick={()=>void prepareNextTask()}>Новое поручение</button>
     <label>Текст поручения
      <textarea data-testid="d3-employee-task-text" rows={3} maxLength={10000}
        value={taskText} disabled={busy||taskAttempted||!taskScopeReady}
        onChange={e=>setTaskText(e.target.value)}/>
     </label>
     <label>Исходный ID поручения
      <input data-testid="d3-employee-task-id" value={taskId}
        maxLength={105} disabled={busy||taskAttempted||(!taskScopeReady&&!taskContinuationBlocked)}
        onChange={e=>setTaskId(e.target.value.trim())}/>
     </label>
     <p className="muted">Перед отправкой ID сохраняется локально. Содержимое, подпись и каталог Task
       принадлежат оригинальному T3. При потере ответа сначала перечитайте Task.</p>
     <button data-testid="d3-employee-task-create" disabled={!taskIssueAvailable||
        !invitationCurrentForTask||busy||taskAttempted||!taskScopeReady||
       !/^task:[A-Za-z0-9-]{1,100}$/.test(taskId)||!taskText.trim()}
       onClick={()=>void run('Оригинальная Task подписана адресату, доставка не подтверждена.',async()=>{
        if(taskAttempted||!managerTaskGrantOk||!invitationCurrentForTask||
            !taskScopeReady||!taskScope||!ID.test(enrollmentReceipt.enrollmentId))
           throw Error('CEN_D3_EMPLOYEE_TASK_ORIGINAL_DATA_GRANT_REQUIRED');
         // Persist only the exact operation ID before an irreversible
         // native call. Any write failure prevents dispatch.
         try{saveEmployeeTaskContinuation(localStorage,taskScope,taskId)}
         catch(e){setTaskContinuationBlocked(true);throw e}
         setTaskAttempted(true);
         let result:any;
         try{
           result=await execute('d3EmployeeCreateTask',{
             enrollmentId:enrollmentReceipt.enrollmentId,
             employeePersonId:personId,taskId,task:taskText.trim(),confirmed:true
           });
         }catch(e){
           if(String(e).replace(/^Error:\s*/,'').trim()===
             'CEN_D3_EMPLOYEE_TASK_HUMAN_CANCELLED'){
             try{clearEmployeeTaskContinuation(localStorage,taskScope,taskId)}
             catch(clearError){setTaskContinuationBlocked(true);throw clearError}
             setTaskAttempted(false);
           }
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
        setTaskReadbackCurrent(false);
        const result=await execute('d3EmployeeTaskReadback',{
          enrollmentId:enrollmentReceipt.enrollmentId,
           employeePersonId:personId,taskId});
         const observed=validateOriginalEmployeeTaskReadback(result,{
           employeePersonId:personId,enrollmentId:enrollmentReceipt.enrollmentId,taskId
         },taskReceipt??null);
         if(!observed.found&&observed.status==='NOT_IN_ORIGINAL_TASK_INVENTORY'){
           // A missing inventory record does not establish a safe retry.
           // Keep any persisted attempt; a manually entered unused ID may
           // still be changed, but cannot be reported as a signed Task.
           throw Error('CEN_D3_EMPLOYEE_TASK_ORIGINAL_READBACK_HOLD');
         }
         if(taskScopeReady&&taskScope){
           try{
             const pending=readEmployeeTaskContinuation(localStorage,taskScope);
             if(pending===null)saveEmployeeTaskContinuation(localStorage,taskScope,taskId);
             else if(pending!==taskId)throw Error('CEN_D3_EMPLOYEE_TASK_CONTINUATION_CHANGED');
           }catch(e){setTaskContinuationBlocked(true);throw e}
         }
         if(!observed.found){
           setTaskAttempted(true);setTaskReceipt(null);setTaskReadbackCurrent(false);
           setTaskRecoveryHold(true);
           return;
         }
        setTaskRecoveryHold(false);setTaskReceipt(observed);setTaskAttempted(true);
        setTaskNeedsRebind(false);setTaskReadbackCurrent(true);
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
        disabled={busy||!taskIssueAvailable||!freshTaskReadback}
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
      {taskAttempted&&!taskReceipt&&<p className="notice subdued" data-testid="d3-employee-task-awaiting-readback">
       Task могла быть подписана до потери ответа. Сохранён её исходный ID.
       Повторный выпуск запрещён: сначала перечитайте Task.</p>}
     {taskReceipt&&<p data-testid="d3-employee-task-receipt">
       Подписанная Task: {taskReceipt.taskId} · {taskReceipt.taskRevisionId}.
       Доставка сотруднику не подтверждена.</p>}
     {freshTaskReadback&&<p role="status" data-testid="d3-employee-task-next-ready">
       Исходный каталог подтверждён. Сохраните .iwxa для передачи или подготовьте
       следующее поручение тому же сотруднику.</p>}
    </div>}
   </div>}
  </div>}
  <CorporateSeatAssignments key={JSON.stringify([session.organizationId,session.workspaceId,session.actorId])}
    organizationId={session.organizationId} workspaceId={session.workspaceId} actorId={session.actorId}
   employee={enrolled?{personId,enrollmentId:enrollmentReceipt.enrollmentId}:null}
   available={available&&session.d3EmployeeCorporateSeatsAvailable===true} autoRead={autoReadSeats}
   execute={execute} run={run} busy={busy} onOpenLicenses={onOpenLicenses}/>
 </section>;
}
