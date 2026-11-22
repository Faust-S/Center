import React from 'react';
import {useUiSettings} from './ui-preferences';
import {records,record,str,type Row} from './owner-ui';
import {OfficePdfOcrProposal} from './office-pdf-ocr-proposal';
import {acceptedOfficeTaskEntry} from './office-task-entry';
import {reviewedPdfOcrPlan} from './office-pdf-ocr-review';

type Candidate={candidate_id?:string;ref_id?:string;operation?:string;
 target?:string;arguments?:Row};
type OcrTask={task_id:string;status:string;accepted_artifact_digest?:string;
 accepted_action_candidate_ids?:string[];action_candidates?:Candidate[];
 readback?:{tool_plans?:Row[]}};
type Props={
 task:OcrTask|null;workspaceId:string;verified:boolean;initialSourcePath?:string;
 onOpenTask:(id:string,operation?:'files.ocr_pdf')=>Promise<void>;
 onRefreshTasks:(id?:string)=>Promise<void>;
 onReviewCandidate:(id:string)=>void;
 onPrepareCandidate:(id:string)=>void;
 onOpenPlans:()=>void;
 onOpenConnections:()=>void;
};

/** Pure UI on top of the original Task, Human Review and ToolRuntime owners. */
export function OfficePdfOcrTask({task,workspaceId,verified,onOpenTask,onRefreshTasks,
 onReviewCandidate,onPrepareCandidate,onOpenPlans,onOpenConnections,initialSourcePath=''}:Props){
 const {tr}=useUiSettings();
 const entry=acceptedOfficeTaskEntry(task,workspaceId,verified);
 const candidates=(task?.action_candidates||[]).filter(c=>c.operation==='files.ocr_pdf');
 if(!entry&&!candidates.length&&!initialSourcePath)return null;
 const plans=records(task?.readback?.tool_plans);
 return <div className="advanced-form" aria-label={tr('Работа с PDF и OCR','PDF and OCR work')}>
  <h3>{tr('Сканированные PDF','Scanned PDFs')}</h3>
  <p>{tr('Распознанный документ сохраняется новой копией. Исходный PDF остаётся без изменений. Подготовка задачи, разрешение и выполнение выполняются отдельно.',
   'OCR creates a new PDF copy without changing the original. Task staging, approval and execution are separate actions.')}</p>
  {initialSourcePath&&!entry&&<p role="status">{tr(
   'Выбран сканированный PDF. Подготовьте OCR-задачу прямо из этого файла. Исходный PDF не изменяется.',
   'Scanned PDF selected. Prepare an OCR Task directly from this file. The original PDF is preserved.')} <code>{initialSourcePath}</code></p>}
  {(entry||initialSourcePath)&&<OfficePdfOcrProposal key={(task?.task_id||'selected-file')+'|'+workspaceId+'|'+initialSourcePath}
   initialSourcePath={initialSourcePath}
   taskId={entry?task!.task_id:''} workspaceId={workspaceId} verified={verified}
   onOpenTask={id=>onOpenTask(id,'files.ocr_pdf')}
   onRefreshTasks={onRefreshTasks} onOpenConnections={onOpenConnections}/>}
  {candidates.map(c=>{
   const id=str(c.candidate_id)||str(c.ref_id);
   const plan=reviewedPdfOcrPlan(c.target,c.arguments);
   const accepted=!!task?.accepted_action_candidate_ids?.includes(id);
   const existing=plans.some(p=>p.tool_id==='files.ocr_pdf'&&
    (str(record(p.candidate_ref).ref_id)===id||str(p.candidate_id)===id));
   return <div className="owner-row" key={id||'invalid-ocr'}>
    <strong>{tr('Распознавание PDF: проверка действия','PDF OCR: review action')}</strong>
    {plan?<><span>{tr('Исходный файл','Original')}: {plan.sourcePath}</span>
     <span>{tr('Новая копия','New copy')}: {plan.path}</span>
     <small>SHA-256: {plan.sourceSha256}</small>
     <small>{tr('Исполнитель','Executor')}: OCRmyPDF · SHA-256: {plan.executableSha256}</small>
    </>:<p role="alert">{tr('Параметры OCR не прошли проверку. Действие недоступно.',
     'OCR arguments failed validation. The action is unavailable.')}</p>}
    <div className="advanced-actions">
     {plan&&verified&&!accepted&&task?.status==='result_imported'&&
      <button type="button" onClick={()=>onReviewCandidate(id)}>
       {tr('Проверить результат и кандидат','Review result and candidate')}</button>}
     {plan&&verified&&accepted&&!existing&&
      <button type="button" onClick={()=>onPrepareCandidate(id)}>
       {tr('Подготовить план OCR','Prepare OCR plan')}</button>}
     {plan&&verified&&accepted&&
      <button type="button" className="secondary-button" onClick={onOpenPlans}>
       {tr('Проверить план, разрешение и результат','Review plan, approval and result')}</button>}
    </div>
    <small>{existing?tr('План находится в исходном ToolRuntime. Исполнение не повторяется автоматически.',
     'Plan is in the original ToolRuntime. Execution is never retried automatically.')
     :accepted?tr('Кандидат принят человеком; требуется отдельный план и разрешение.',
       'Candidate accepted; separate plan and approval are still required.')
     :tr('OCR не запускается до принятия кандидата и отдельного разрешения.',
       'OCR does not run before candidate acceptance and separate approval.')}</small>
   </div>;
  })}
 </div>;
}
