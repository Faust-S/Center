import React,{useEffect,useState} from 'react';
import {readOriginalSeatView,prepareOriginalSeatCommand,readOriginalSeatChange,readOriginalSeatPolicy}
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
export default function CorporateSeatAssignments({organizationId,workspaceId,employee,
 available,execute,run,busy}:{
 organizationId:string;workspaceId:string;employee:Employee|null;available:boolean;
 execute:Exec;run:Run;busy:boolean;
}){
 const [view,setView]=useState<any>(null);
 const [pending,setPending]=useState<string|null>(null);
 const [source,setSource]=useState('');
 const [receipt,setReceipt]=useState('');
 const refresh=(offset=0)=>run('Распределение мест перечитано из исходного T3.',async()=>{
  setView(null);setSource('');
  const result=readOriginalSeatView(await execute('d3EmployeeSeatView',{offset}),organizationId,workspaceId);
  setView(result);setPending(null);
 });
 const locked=busy||!available||!view||pending!==null;
 const assigned=!!employee&&view?.assignments.some((r:any)=>r.reserved&&r.personId===employee.personId);
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
 const change=(kind:Kind)=>run('Изменение мест подтверждено исходным T3.',async()=>{
  if(locked)throw Error('CEN_D3_CORPORATE_SEAT_READBACK_REQUIRED');
  const commandId='seat:'+crypto.randomUUID();
  const command=prepareOriginalSeatCommand(view,kind,commandId,employee,
   kind==='ASSIGN'?null:source);
  setPending(commandId);setReceipt('');
  try{
   const result=await execute('d3EmployeeSeatChange',command);
   setView(readOriginalSeatChange(result,command,organizationId,workspaceId));
   setSource('');setPending(null);setReceipt(commandId);
  }catch(e){
   if(String(e).includes('CEN_D3_CORPORATE_SEAT_HUMAN_CANCELLED'))setPending(null);
   throw e;
  }
 });
 return <div className="nested-form" data-testid="d3-corporate-seat-assignments">
  <h3>Распределение корпоративных мест Personal Agent</h3>
  <p className="muted">Места учитываются в подписанном реестре T3 отдельно от задач и доступа к данным. Назначение места не подтверждает подключение установленного Agent.</p>
  {!available?<p role="status">Подключите исходный реестр сотрудников и совместимый T3 Host.</p>:<>
   <button className="secondary" data-testid="d3-seat-view-refresh" disabled={busy}
    onClick={()=>void refresh()}>Перечитать распределение</button>
   {pending&&<p role="alert">Результат операции {pending} не подтверждён. Перед новым действием перечитайте исходный реестр. Автоматического повтора нет.</p>}
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
    {employee?<p>Подтверждённый сотрудник для назначения: <strong>{employee.personId}</strong>.</p>:
     <p className="muted">Для назначения или передачи сначала перечитайте подтверждённое подключение нужного сотрудника выше.</p>}
    <button data-testid="d3-seat-assign" disabled={locked||!employee||assigned||!currentLicense||
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
     <button className="secondary" data-testid="d3-seat-transfer" disabled={locked||!from||!employee||
      assigned||!currentLicense||!view.seatPolicyReady||!view.withinLimits}
      onClick={()=>void change('TRANSFER')}>Передать выбранному сотруднику</button>
    </div>
    <h4>История назначений</h4>
    {view.assignments.length===0?<p className="muted">Назначений нет.</p>:
     <ul data-testid="d3-seat-assignment-history">{view.assignments.map((r:any)=>
      <li key={r.grantId}><strong>{r.personId}</strong> · {r.reserved?statusLabels[r.status]:
       r.status==='ACTIVE'||r.status==='SUSPENDED'?'Срок истёк':statusLabels[r.status]} · до {new Date(r.expiresAt).toLocaleString('ru-RU')}</li>)}</ul>}
    <div className="form-actions">
     <button className="secondary" disabled={busy||!!pending||view.assignmentOffset===0}
      onClick={()=>void refresh(Math.max(0,view.assignmentOffset-64))}>Предыдущие</button>
     <span>{view.assignmentTotal?view.assignmentOffset+1:0}–{view.assignmentOffset+view.assignments.length} из {view.assignmentTotal}</span>
     <button className="secondary" disabled={busy||!!pending||view.assignmentNextOffset===null}
      onClick={()=>void refresh(view.assignmentNextOffset)}>Следующие</button>
    </div>
   </>}
   {receipt&&<p role="status">Подтверждённая операция: {receipt}.</p>}
  </>}
 </div>;
}
