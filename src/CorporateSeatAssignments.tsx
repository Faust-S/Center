import React,{useEffect,useState} from 'react';
import {readOriginalSeatView,prepareOriginalSeatCommand,readOriginalSeatChange,readOriginalSeatPolicy,readOriginalSeatCommandRecovery,seatIntentKey,readSeatIntent,saveSeatIntent,clearSeatIntent,prepareOriginalSeatDelivery,readOriginalSeatDelivery}
 from '../runtime/cen03-corporate-seats.mjs';

type Employee={personId:string;enrollmentId:string};
type Exec=(operation:string,input?:Record<string,unknown>)=>Promise<any>;
type Run=(message:string,task:()=>Promise<void|boolean>)=>Promise<void>;
type Kind='ASSIGN'|'RELEASE'|'TRANSFER';
const labels:Record<string,string>={
 VERIFIED_CAPACITY_CANDIDATE:'Подписанная лицензия актуальна',
 LINEAGE_INCOMPLETE:'Не хватает истории продлений',
 MULTIPLE_CURRENT_LICENSES:'Несколько независимых лицензий',
 NO_CURRENT_LICENSE:'Нет действующей лицензии',
 LICENSE_SOURCE_UNAVAILABLE:'Исходный Consumer недоступен',
};
const statusLabels:Record<string,string>={ACTIVE:'Назначено',SUSPENDED:'Приостановлено',
 REVOKED:'Освобождено',SUPERSEDED:'Заменено'};
export default function CorporateSeatAssignments({organizationId,workspaceId,actorId,employee,
 available,execute,run,busy}:{
 organizationId:string;workspaceId:string;actorId:string;employee:Employee|null;available:boolean;
 execute:Exec;run:Run;busy:boolean;
}){
 const [view,setView]=useState<any>(null);
 const intentKey=seatIntentKey(organizationId,workspaceId,actorId);
 const [restored]=useState(()=>{
  try{return {command:readSeatIntent(localStorage,intentKey),blocked:false}}
  catch{return {command:null,blocked:true}}
 });
 const [pending,setPending]=useState<string|null>(restored.command?.commandId??null);
 const [intentBlocked,setIntentBlocked]=useState(restored.blocked);
 const [employeeChoice,setEmployeeChoice]=useState('');
 const [source,setSource]=useState('');
 const [receipt,setReceipt]=useState('');
 const [deliveryChoice,setDeliveryChoice]=useState('');
 const [deliveryReceipt,setDeliveryReceipt]=useState('');
 const selectedDelivery=view?.eligibleEmployees.find((r:any)=>r.personId===deliveryChoice);
 const refresh=(offset=0,employeeOffset=0)=>run('Распределение мест перечитано из исходного T3.',async()=>{
  setSource('');setDeliveryChoice('');setDeliveryReceipt('');
  // Reopen the exact outstanding intent even if the signed owner epoch changed.
  let outstanding;
  try{outstanding=readSeatIntent(localStorage,intentKey);setIntentBlocked(false)}
  catch(e){setIntentBlocked(true);throw e}
  if(outstanding){
   setPending(outstanding.commandId);
   // Recovery is a separate original read-only verb; it cannot sign or
   // repeat the pending command. Unknown remains visible and blocks writes.
   const {confirmed,...request}=outstanding;
   const result=readOriginalSeatCommandRecovery(await execute('d3EmployeeSeatCommandReadback',request),
    outstanding,organizationId,workspaceId);
   setView(result.view);
   if(result.outcome==='OUTCOME_UNKNOWN')return false;
   clearSeatIntent(localStorage,intentKey,outstanding);
   setPending(null);
   setReceipt(result.outcome==='ALREADY_COMMITTED'?'Подтверждено исходным чтением: '+request.commandId:
    'Исходный реестр не изменился. Команда не записана; автоматического повтора нет.');
   return;
  }
  const result=readOriginalSeatView(await execute('d3EmployeeSeatView',{offset,employeeOffset}),organizationId,workspaceId);
  setView(result);setEmployeeChoice('');setPending(null);
 });
 const locked=busy||!available||!view||pending!==null||intentBlocked;
 const rosterEmployee=view?.eligibleEmployees.find((r:any)=>r.personId===employeeChoice&&!r.reserved);
 const target:Employee|null=employeeChoice?(rosterEmployee??null):employee;
 const assigned=!!target&&(view?.assignments.some((r:any)=>r.reserved&&r.personId===target.personId)||
  view?.eligibleEmployees.some((r:any)=>r.personId===target.personId&&r.reserved));
 const from=view?.assignments.find((r:any)=>r.reserved&&r.grantId===source);
 const [clock,setClock]=useState(Date.now);
 // A suspended window may outlive a signed license or STATUS. The native
 // owner always rechecks; also remove stale apparent availability in UI.
 useEffect(()=>{
  setClock(Date.now());
  const timer=setInterval(()=>setClock(Date.now()),1000);
  return ()=>clearInterval(timer);
 },[]);
 const currentLicense=!!view?.candidate&&
  Date.parse(view.candidate.expiresAt)>clock&&Date.parse(view.candidate.statusValidUntil)>clock;
 const enable=()=>run('Продуктовая политика подтверждена исходным T3.',async()=>{
  if(locked)throw Error('CEN_D3_CORPORATE_SEAT_READBACK_REQUIRED');
  setPending('Подключение продуктовой политики');setReceipt('');
  try{
   const result=await execute('d3EmployeeSeatPolicyEnable',{confirmed:true,
    expectedRegistryDigest:view.registryDigest});
   setView(readOriginalSeatPolicy(result,organizationId,workspaceId));setPending(null);
  }catch(e){
   if(String(e).includes('CEN_D3_CORPORATE_SEAT_HUMAN_CANCELLED'))setPending(null);
   throw e;
  }
 });
 const exportUpdate=()=>run('Подписанное обновление сохранено. Получение сотрудником ещё не подтверждено.',async()=>{
  if(locked||!selectedDelivery)throw Error('CEN_D3_CORPORATE_SEAT_DELIVERY_EMPLOYEE_REQUIRED');
  const request=prepareOriginalSeatDelivery(view,deliveryChoice);
  setDeliveryReceipt('');
  const result=readOriginalSeatDelivery(await execute('d3EmployeeExportInvite',request),request,workspaceId);
  if(!result)return false;
  setDeliveryReceipt('Сотрудник: '+result.employeePersonId+' · статус '+result.statusSequence+
   '. Подписанный файл сохранён, получение не подтверждено.');
 });
 const change=(kind:Kind)=>run('Изменение мест подтверждено исходным T3.',async()=>{
  if(locked)throw Error('CEN_D3_CORPORATE_SEAT_READBACK_REQUIRED');
  const commandId='seat:'+crypto.randomUUID();
  const command=prepareOriginalSeatCommand(view,kind,commandId,target,
   kind==='ASSIGN'?null:source);
  try{saveSeatIntent(localStorage,intentKey,command)}
  catch(e){setIntentBlocked(true);throw e}
  setPending(commandId);setReceipt('');setDeliveryReceipt('');
  try{
   const result=await execute('d3EmployeeSeatChange',command);
   setView(readOriginalSeatChange(result,command,organizationId,workspaceId));
   clearSeatIntent(localStorage,intentKey,command);
   setSource('');setEmployeeChoice('');setPending(null);
   setReceipt('Подтверждённая операция: '+commandId);
  }catch(e){
   if(String(e).includes('CEN_D3_CORPORATE_SEAT_HUMAN_CANCELLED')){
    clearSeatIntent(localStorage,intentKey,command);
    setPending(null);
   }
   throw e;
  }
 });
 return <div className="nested-form" data-testid="d3-corporate-seat-assignments" tabIndex={-1}>
  <h3>Распределение корпоративных мест Personal Agent</h3>
  <p className="muted">Места учитываются в подписанном реестре T3 отдельно от задач и доступа к данным. Назначение места не подтверждает подключение установленного Agent.</p>
  {!available?<p role="status">Подключите исходный реестр сотрудников и совместимый T3 Host.</p>:<>
   <button className="secondary" data-testid="d3-seat-view-refresh" disabled={busy}
    onClick={()=>void refresh()}>Перечитать распределение</button>
   {intentBlocked&&<p role="alert">Не удалось прочитать сохранённое намерение операции. Назначения заблокированы до восстановления чтения.</p>}
   {pending&&<p role="alert" data-testid="d3-seat-unknown">Результат операции {pending} не подтверждён. Перечитайте исходный реестр для восстановления результата. Пока он неизвестен, новые действия заблокированы; автоматического повтора нет.</p>}
   {view&&<>
    <p role="status">{view.candidate&&!currentLicense?'Срок последней подписанной проверки истёк. Перечитайте распределение.':labels[view.licenseState]??view.licenseState}</p>
    <div className="form-grid" data-testid="d3-seat-capacity">
     <div><small>Зарегистрированные сотрудники / лимит</small><strong>{' '}{view.independentlyEnrolledEmployees} / {view.employeeLimit??'—'}</strong></div>
     <div><small>Зарезервированные места / лимит</small><strong>{' '}{view.reservedSeats} / {view.seatLimit??'—'}</strong></div>
     <div><small>Свободно для назначения</small><strong>{' '}{currentLicense?view.availableSeats:0}</strong></div>
    </div>
    {(view.overSeatLimit>0||view.overEmployeeLimit>0)&&<p role="alert">Лимит превышен. Сотрудники: {view.overEmployeeLimit??0}; места: {view.overSeatLimit??0}. Сохранённые назначения не удалены. Сократите распределение или уточните тариф.</p>}
    {view.candidate&&!view.existingLineageMatches&&<p role="alert">Сохранённые места относятся к другой цепочке лицензии. Проверьте основания перед назначением.</p>}
    {!view.seatPolicyReady&&<div>
     <p>Организация создана до подключения продуктовых мест. Требуется однократное расширение исходной политики; сотрудники и их права сохраняются.</p>
     <button data-testid="d3-seat-policy-enable" disabled={locked} onClick={()=>void enable()}>Подключить распределение мест</button>
    </div>}
    <label>Подтверждённый сотрудник
     <select data-testid="d3-seat-employee" value={employeeChoice} disabled={locked}
      onChange={e=>setEmployeeChoice(e.target.value)}>
      <option value="">{employee?'Сотрудник из подключения: '+employee.personId:'Выберите из исходного реестра'}</option>
      {view.eligibleEmployees.map((m:any)=><option key={m.personId} value={m.personId}
       disabled={m.reserved}>{m.personId}{m.reserved?' (место уже назначено)':''}</option>)}
     </select>
    </label>
    <div className="form-actions">
     <button className="secondary" disabled={locked||view.employeeOffset===0}
      onClick={()=>void refresh(view.assignmentOffset,Math.max(0,view.employeeOffset-64))}>Предыдущие сотрудники</button>
     <small>{view.employeeTotal?view.employeeOffset+1:0}–{view.employeeOffset+view.eligibleEmployees.length} из {view.employeeTotal}</small>
     <button className="secondary" disabled={locked||view.employeeNextOffset===null}
      onClick={()=>void refresh(view.assignmentOffset,view.employeeNextOffset)}>Следующие сотрудники</button>
    </div>
    {!target&&<p className="muted">Для назначения выберите зарегистрированного сотрудника из реестра T3.</p>}
    <button data-testid="d3-seat-assign" disabled={locked||!target||assigned||!currentLicense||
      !view.seatPolicyReady||!view.withinLimits||view.availableSeats<=0} onClick={()=>void change('ASSIGN')}>Назначить место</button>
    <label>Назначение для освобождения или передачи
     <select data-testid="d3-seat-source" value={source} disabled={locked}
      onChange={e=>setSource(e.target.value)}>
      <option value="">Выберите действующее назначение</option>
      {view.assignments.filter((r:any)=>r.reserved).map((r:any)=>
       <option key={r.grantId} value={r.grantId}>{r.personId} ({statusLabels[r.status]})</option>)}
     </select>
    </label>
    <div className="form-actions">
     <button className="secondary" data-testid="d3-seat-release" disabled={locked||!from}
      onClick={()=>void change('RELEASE')}>Освободить место</button>
     <button className="secondary" data-testid="d3-seat-transfer" disabled={locked||!from||!target||
      assigned||!currentLicense||!view.seatPolicyReady||!view.withinLimits}
      onClick={()=>void change('TRANSFER')}>Передать выбранному сотруднику</button>
    </div>
    <h4>Передача обновлённых полномочий</h4>
    <p className="muted">После назначения, освобождения или передачи места сохраните актуальное подписанное приглашение для каждого затронутого сотрудника. Повторная регистрация и выдача грантов не выполняются. Передайте также актуальные подписанные файлы LICENSE/STATUS от Publisher. Офлайн-сотрудник получает изменения после их импорта; сохранение файла не подтверждает доставку.</p>
    <label>Получатель обновления
     <select data-testid="d3-seat-delivery-employee" value={deliveryChoice} disabled={locked}
      onChange={e=>{setDeliveryChoice(e.target.value);setDeliveryReceipt('')}}>
      <option value="">Выберите сотрудника из текущей страницы реестра</option>
      {view.eligibleEmployees.map((r:any)=><option key={r.personId} value={r.personId}>{r.personId}{r.reserved?' (место назначено)':''}</option>)}
     </select>
    </label>
    <button className="secondary" data-testid="d3-seat-delivery-export" disabled={locked||!selectedDelivery}
      onClick={()=>void exportUpdate()}>Сохранить подписанное обновление .iwxa</button>
    {deliveryReceipt&&<p role="status" data-testid="d3-seat-delivery-receipt">{deliveryReceipt}</p>}
    <h4>История назначений</h4>
    {view.assignments.length===0?<p className="muted">Назначений нет.</p>:
     <ul data-testid="d3-seat-assignment-history">{view.assignments.map((r:any)=>
      <li key={r.grantId}><strong>{r.personId}</strong> · {r.reserved?statusLabels[r.status]:
       r.status==='ACTIVE'||r.status==='SUSPENDED'?'Срок истёк':statusLabels[r.status]} · до {new Date(r.expiresAt).toLocaleString('ru-RU')}</li>)}</ul>}
    <div className="form-actions">
     <button className="secondary" disabled={busy||!!pending||view.assignmentOffset===0}
      onClick={()=>void refresh(Math.max(0,view.assignmentOffset-64),view.employeeOffset)}>Предыдущие</button>
     <span>{view.assignmentTotal?view.assignmentOffset+1:0}–{view.assignmentOffset+view.assignments.length} из {view.assignmentTotal}</span>
     <button className="secondary" disabled={busy||!!pending||view.assignmentNextOffset===null}
      onClick={()=>void refresh(view.assignmentNextOffset,view.employeeOffset)}>Следующие</button>
    </div>
   </>}
   {receipt&&<p role="status">{receipt}</p>}
  </>}
 </div>;
}
