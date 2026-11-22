import React,{useState} from 'react';

// UX navigation over the ORIGINAL T3 corporate forms. No duplicate owner,
// signer, IAM, Reconciliation, Kernel or Task/Result state is created here.
const STEPS=[
 {id:'workspace',label:'1 · Организация',targets:['d3-org-onboarding','d3-open-signed-workspace','corporate-panel'],
  help:'Подключите выбранную корпоративную Workspace исходного T3. Черновые рабочие области не заменяют подписанную Workspace.'},
 {id:'employees',label:'2 · Сотрудники',targets:['d3-independent-employee','cen02-owner-people','corporate-panel'],
  help:'Сотрудник подтверждает свой ключ отдельно. Контакт в черновике не выдаёт права.'},
 {id:'task',label:'3 · Task',targets:['d3-signed-task-workflow','cen02-section','corporate-panel'],
  help:'Подготовьте поручение в корпоративном контексте, подтвердите адресата и права. Обычная работа относится к выбранной Workspace.'},
 {id:'result',label:'4 · Result',targets:['d3-organization-age-recipient','cen03-section','corporate-panel'],
  help:'Корпоративная передача охватывает целую Workspace через штатный T2 Exchange. Ниже остаются исходные операции Reconciliation ранее выданных отдельных пакетов.'},
 {id:'review',label:'5 · Review',targets:['d3-original-signed-review','cen03-section','corporate-panel'],
  help:'Там, где требуется Human Review, проверьте исходный Result до решения ACCEPT или REJECT. Само решение не переносит данные из личной области.'},
 {id:'apply',label:'6 · Apply',targets:['d3-apply','cen03-apply','corporate-panel'],
  help:'ACCEPT и APPLY разные действия. Отдельный APPLY нужен только для разрешённого изменения исходного Kernel.'},
 {id:'reuse',label:'7 · Продолжить',targets:['cen03-reuse','corporate-panel'],
  help:'Начните следующую Task от сохранённого корпоративного результата в той же Workspace. История и связи остаются у исходного T2.'}
] as const;
type Props={
 organizationName:string;
 nativeHost:boolean;
 signedWorkspaceOpen:boolean;
 signedWorkspaceVisible:boolean;
 onOpenWorkspace:()=>Promise<void>;
};
export default function AdminResultRoute({organizationName,nativeHost,signedWorkspaceOpen,signedWorkspaceVisible,onOpenWorkspace}:Props){
 const [selected,setSelected]=useState<string>('');
 const [opening,setOpening]=useState(false);
 const [openIssue,setOpenIssue]=useState('');
 const openWorkspace=async()=>{
  if(!nativeHost||opening)return;
  setOpening(true);setOpenIssue('');
  try{await onOpenWorkspace();}
  catch{setOpenIssue('Нативная Workspace не открыта. Проверьте подключение исходного T3 и выбранную организацию в корпоративных операциях.');}
  finally{setOpening(false);}
 };
 const current=STEPS.find(item=>item.id===selected);
 const open=(step:typeof STEPS[number])=>{
  setSelected(step.id);
  const element=step.targets.map(id=>document.querySelector<HTMLElement>(`[data-testid="${id}"]`))
    .find((node):node is HTMLElement=>!!node);
  element?.scrollIntoView({block:'start',behavior:'smooth'});
  // Only native original-owner components enable the signed actions.
  // A rendered section never proves the operation is authorized.
 };
 return <div className="v8-result-layout">
  <section className="v8-workspace-entry" data-testid="v8-workspace-entry">
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
    {STEPS.map(step=><button key={step.id} type="button" aria-pressed={selected===step.id}
       className={selected===step.id?'active':''} data-testid={'v8-result-step-'+step.id}
       onClick={()=>open(step)}>{step.label}</button>)}
   </nav>
   {current&&<div className="v8-result-journey-hint" role="status">
      <span>{current.help}</span>
      <button type="button" aria-label="Закрыть пояснение" onClick={()=>setSelected('')}>×</button>
    </div>}
 </section>
 </div>;
}
