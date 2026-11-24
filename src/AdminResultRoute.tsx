import type {AdminRouteId} from './admin-navigation';
import React,{useState} from 'react';

// UX navigation over the ORIGINAL T3 corporate forms. No duplicate owner,
// signer, IAM, Reconciliation, Kernel or Task/Result state is created here.
const STEPS=[
 {id:'workspace',label:'1 · Организация',route:'signed-workspace',
  help:'Подключите выбранную корпоративную Workspace исходного T3. Черновые рабочие области не заменяют подписанную Workspace.'},
 {id:'employees',label:'2 · Сотрудники',route:'employees-t3',
  help:'Сотрудник подтверждает свой ключ отдельно. Контакт в черновике не выдаёт права.'},
 {id:'task',label:'3 · Task',route:'signed-tasks',
  help:'Подготовьте поручение в корпоративном контексте, подтвердите адресата и права. Обычная работа относится к выбранной Workspace.'},
 {id:'result',label:'4 · Result',route:'receive',
  help:'Корпоративная передача охватывает целую Workspace через штатный T2 Exchange. Ниже остаются исходные операции Reconciliation ранее выданных отдельных пакетов.'},
 {id:'review',label:'5 · Review',route:'review',
  help:'Там, где требуется Human Review, проверьте исходный Result до решения ACCEPT или REJECT. Само решение не переносит данные из личной области.'},
 {id:'apply',label:'6 · Apply',route:'apply',
  help:'ACCEPT и APPLY разные действия. Отдельный APPLY нужен только для разрешённого изменения исходного Kernel.'},
 {id:'reuse',label:'7 · Продолжить',route:'reuse',
  help:'Начните следующую Task от сохранённого корпоративного результата в той же Workspace. История и связи остаются у исходного T2.'}
] as const;
type Props={
 route:AdminRouteId;
 onNavigate:(route:AdminRouteId)=>void;
 organizationName:string;
 nativeHost:boolean;
 signedWorkspaceOpen:boolean;
 signedWorkspaceVisible:boolean;
 onOpenWorkspace:()=>Promise<void>;
 focusedEmployeeName?:string|null;
};
export default function AdminResultRoute({route,onNavigate,organizationName,nativeHost,signedWorkspaceOpen,signedWorkspaceVisible,onOpenWorkspace,focusedEmployeeName}:Props){
 const [opening,setOpening]=useState(false);
 const [openIssue,setOpenIssue]=useState('');
 const openWorkspace=async()=>{
  if(!nativeHost||opening)return;
  setOpening(true);setOpenIssue('');
  try{await onOpenWorkspace();}
  catch{setOpenIssue('Нативная Workspace не открыта. Проверьте подключение исходного T3 и выбранную организацию в корпоративных операциях.');}
  finally{setOpening(false);}
 };
 const current=STEPS.find(item=>item.route===route);
 const open=(step:typeof STEPS[number])=>onNavigate(step.route);
 return <div className="v8-result-layout">
  {focusedEmployeeName&&<div className="v8-employee-target" data-testid="v8-employee-focus">
    <strong>Подключение сотрудника: {focusedEmployeeName}</strong>
    <span>Выбран контакт организации. Подписанный T3 отдельно проверяет личность, ключ и полномочия. Никакие права при переходе не выдаются.</span>
    <button type="button" className="secondary" onClick={()=>open(STEPS[1])}>К подключению T3</button>
   </div>}
  <section className="v8-workspace-entry" data-testid="v8-workspace-entry" hidden={route!=='results'&&route!=='signed-workspace'}>
   <div className="v8-workspace-heading">
    <div><small>КОРПОРАТИВНАЯ РАБОТА IWXA</small><h2>Одна Workspace. Вся работа организации.</h2>
     <p>Поручения, результаты, связи, документы и история принадлежат исходной Workspace T2.
      Для передачи используется штатный экспорт всей выбранной Workspace через IWXA Exchange.</p></div>
    <div className="v8-workspace-actions">
     <button type="button" className="primary" data-testid="v8-workspace-open"
      disabled={!nativeHost||opening} onClick={()=>{void openWorkspace()}}>
      {opening?'Открываем Workspace...':signedWorkspaceOpen?'Вернуться в Workspace T3':'Открыть корпоративную Workspace'}</button>
     <button type="button" className="secondary" data-testid="v8-workspace-enrollment"
      onClick={()=>open(STEPS[0])}>Подключение и полномочия</button>
    </div>
   </div>
   <div className="v8-workspace-facts">
    <div><strong>Выбранная организация</strong><span>{organizationName}</span></div>
    <div><strong>Единица сохранения</strong><span>Корпоративная Workspace целиком</span></div>
    <div><strong>Обмен и продолжение</strong><span>Одна Workspace, её история и связи</span></div>
   </div>
   <p className="v8-workspace-status" data-testid="v8-workspace-status" role="status">
    {signedWorkspaceOpen
      ?signedWorkspaceVisible?'Нативное окно T3 открыто. Проверьте выбранную Workspace и действующие полномочия внутри.':'Нативный сеанс T3 сохранён. Окно скрыто для работы в Admin Center.'
      :nativeHost?'Подписанная Workspace ещё не открыта в этом сеансе.':'Работа с подписанной Workspace доступна в установленном Admin Center.'}
   </p>
   {openIssue&&<p className="v8-workspace-error" role="alert" data-testid="v8-workspace-error">{openIssue}</p>}
   <p className="v8-workspace-boundary">Локальные черновики и планы Atlas остаются отдельно до подтверждённой операции исходного владельца. Личные области Personal Agent и другие организации в корпоративный экспорт не входят.</p>
  </section>
  <section className="v8-result-journey" data-testid="v8-results-journey"
   aria-label="Этапы корпоративного поручения">
   <div className="v8-result-journey-head"><strong>Связанные действия: от поручения до принятия</strong>
     <small>Используются существующие операции оригинального T3</small>
   </div>
   <nav className="v8-result-journey-steps" aria-label="Маршрут Task и Result">
    {STEPS.map(step=><button key={step.id} type="button" aria-pressed={route===step.route}
       className={route===step.route?'active':''} data-testid={'v8-result-step-'+step.id}
       onClick={()=>open(step)}>{step.label}</button>)}
   </nav>
   {current&&<div className="v8-result-journey-hint" role="status">
      <span>{current.help}</span>
      <button type="button" aria-label="Все корпоративные операции" onClick={()=>onNavigate('results')}>×</button>
    </div>}
 </section>
 </div>;
}
