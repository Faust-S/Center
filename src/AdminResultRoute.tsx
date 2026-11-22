import React,{useState} from 'react';

// UX navigation over the ORIGINAL T3 corporate forms. No duplicate owner,
// signer, IAM, Reconciliation, Kernel or Task/Result state is created here.
const STEPS=[
 {id:'workspace',label:'1 · Организация',targets:['d3-org-onboarding','d3-open-signed-workspace','corporate-panel'],
  help:'Подключите выбранную Workspace и исходного подписанного владельца.'},
 {id:'employees',label:'2 · Сотрудники',targets:['d3-independent-employee','cen02-owner-people','corporate-panel'],
  help:'Сотрудник подтверждает свой ключ отдельно. Контакт в черновике не выдаёт права.'},
 {id:'task',label:'3 · Task',targets:['d3-signed-task-workflow','cen02-section','corporate-panel'],
  help:'Проверьте поручение и адресата перед подписанием и передачей.'},
 {id:'result',label:'4 · Result',targets:['d3-organization-age-recipient','cen03-section','corporate-panel'],
  help:'Получите оригинальный .iwxa или .iwxa.age и проверьте его через Reconciliation.'},
 {id:'review',label:'5 · Review',targets:['d3-original-signed-review','cen03-section','corporate-panel'],
  help:'Сначала прочитайте подписанный Result, затем отдельно подтвердите ACCEPT или REJECT.'},
 {id:'apply',label:'6 · Apply',targets:['d3-apply','cen03-apply','corporate-panel'],
  help:'Принятие Result не заменяет отдельного Human APPLY в исходный Kernel.'},
 {id:'reuse',label:'7 · Продолжить',targets:['cen03-reuse','corporate-panel'],
  help:'Используйте подтверждённый применённый Result как источник новой работы.'}
] as const;
export default function AdminResultRoute(){
 const [selected,setSelected]=useState<string>('');
 const current=STEPS.find(item=>item.id===selected);
 const open=(step:typeof STEPS[number])=>{
  setSelected(step.id);
  const element=step.targets.map(id=>document.querySelector<HTMLElement>(`[data-testid="${id}"]`))
    .find((node):node is HTMLElement=>!!node);
  element?.scrollIntoView({block:'start',behavior:'smooth'});
  // Only native original-owner components enable the signed actions.
  // A rendered section never proves the operation is authorized.
 };
 return <section className="v8-result-journey" data-testid="v8-results-journey"
   aria-label="Этапы корпоративного поручения">
   <div className="v8-result-journey-head"><strong>От поручения к результату</strong>
     <small>Все этапы открывают исходные операции IWXA</small>
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
 </section>;
}
