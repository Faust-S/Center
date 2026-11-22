import React from 'react';
import {useUiSettings} from './ui-preferences';
import {summarizeN8nTask,type N8nTaskLike} from './n8n-workflow-intent';

type Props={
 task:N8nTaskLike;fresh:boolean;busy:boolean;
 onReview:()=>void;onPrepare:(candidateId:string)=>void;
 onOpenPlan:(planId:string)=>void;onOpenRecovery:(caseId:string)=>void;
 onOpenAutomations:()=>void;onOpenPrograms:()=>void;
};
/** Read-only, Task-scoped entry points. All actions, decisions, and recovery
 * remain in the existing TaskActionsPanel / Human Review / ToolRuntime. */
export function N8nTaskLifecycle({task,fresh,busy,onReview,onPrepare,onOpenPlan,
 onOpenRecovery,onOpenAutomations,onOpenPrograms}:Props){
 const {tr}=useUiSettings();
 const flow=summarizeN8nTask(task);
 if(!flow.candidates.length)return null;
 return <section className="advanced-form" aria-label={tr('Работа с процессом n8n','n8n workflow')}>
  <h3>{tr('Процесс n8n','n8n workflow')}</h3>
  <p>{tr('Проверка подключения в Центре программ не подтверждает выполнение процесса.','Programs Center connection readiness does not prove workflow execution.')}</p>
  <button type="button" className="secondary-button" onClick={onOpenPrograms}>
   {tr('Проверить подключение n8n','Check n8n connection')}</button>
  {task.status==='rejected'
   ?<p>{tr('Предложение отклонено. Запуск недоступен.','The proposal was rejected. Execution is unavailable.')}</p>
   :flow.unresolved
   ?<p role="alert">{tr('Исход предыдущего действия требует проверки. Новый запуск не предлагайте.','A previous outcome needs reconciliation. Do not execute again.')}</p>
   :!flow.accepted
   ?<p>{tr('Проверьте предложение и выберите, какие действия принять.','Review the proposal and choose which actions to accept.')}</p>
   :flow.acceptedCandidates.length===0
   ?<p>{tr('Процесс не включён в принятое решение. Выполнение недоступно.','The workflow was not included in the accepted decision. Execution is unavailable.')}</p>
   :<p>{tr('Следующие действия сохраняются в задаче и требуют отдельного разрешения.','The next steps are recorded in this task and require separate approval.')}</p>}
  {!flow.accepted&&task.status!=='rejected'&&<button type="button" disabled={!fresh||busy} onClick={onReview}>
   {tr('Проверить предложение','Review proposal')}</button>}
  {flow.accepted&&flow.acceptedCandidates.map(c=>{
   const exists=flow.plans.some(p=>p.candidate_id===c.candidate_id);
   return !exists?<button type="button" key={c.candidate_id}
    disabled={!fresh||busy||flow.unresolved} onClick={()=>onPrepare(c.candidate_id!)}>
     {tr('Подготовить план','Prepare action plan')}: {c.target||tr('выбранный процесс','selected workflow')}
    </button>:null;
  })}
  {flow.plans.map((plan,i)=>{
   const related=flow.receipts.filter(r=>r.plan_id===plan.plan_id);
   const repairs=flow.repairs.filter(r=>r.plan_id===plan.plan_id);
   const openCase=repairs.find(r=>r.case_id&&['OPEN_UNKNOWN','EVIDENCE_PENDING','REMAINS_UNKNOWN'].includes(r.contract_state||''));
   const complete=related.some(r=>r.status==='SUCCEEDED'&&r.external_effect_state==='ACKNOWLEDGED');
   const unknown=['OUTCOME_UNKNOWN','INTERRUPTED'].includes(plan.execution_state||'')
    ||related.some(r=>r.external_effect_state==='UNKNOWN')||!!openCase;
   return <div key={plan.plan_id} className="owner-row">
    <strong>{tr('Действие','Action')} {i+1}</strong>
    <span>{unknown?tr('Требуется проверка результата','Outcome needs review'):
      complete?tr('Квитанция сохранена','Receipt saved'):
      tr('Проверьте план и разрешения','Review plan and permissions')}</span>
    {openCase?<button type="button" disabled={!fresh||busy}
     onClick={()=>onOpenRecovery(openCase.case_id!)}>{tr('Проверить исход','Reconcile outcome')}</button>
     :<button type="button" disabled={!fresh||busy}
      onClick={()=>onOpenPlan(plan.plan_id!)}>{unknown?tr('Проверить прежнее действие','Inspect previous action'):
       complete?tr('Посмотреть квитанцию','Inspect receipt'):tr('Открыть план','Open action plan')}</button>}
   </div>;
  })}
  {flow.scheduled.length>0&&<button type="button" className="secondary-button"
    onClick={onOpenAutomations}>{tr('Проверить расписание','Review schedule')}</button>}
  <details><summary>{tr('История процесса','Workflow history')}</summary>
   <p>{tr('Планы: ','Plans: ')}{flow.plans.length}.
     {tr(' Квитанции: ',' Receipts: ')}{flow.receipts.length}.
     {tr(' Случаи восстановления: ',' Recovery cases: ')}{flow.repairs.length}.</p>
  </details>
 </section>;
}
