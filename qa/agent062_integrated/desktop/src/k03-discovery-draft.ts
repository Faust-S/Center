/** Pinned K03 selection -> existing editable Task composer, never an accepted Task. */
export type K03Selection={
 schema:string;status:string;source_kind:string;source_value:string;source_revision:string;
 selection:{candidate_text:string;hypothesis_id:string;case_id:string;selection_ref:string;
  evidence_links:{evidence_id:string;relation:string}[];task_created:boolean;result_created:boolean};
 clarification_requests:{question:string}[];
 task_created:boolean;
};
export function k03SelectionDraft(output:K03Selection,answer:string):string{
 if(output?.status!=='SELECTED_FOR_USER_DRAFT_ONLY'||output.task_created!==false
  ||output.selection?.task_created!==false||output.selection?.result_created!==false
  ||!['desk','issue'].includes(output.source_kind)
  ||!output.selection.candidate_text?.trim()
  ||typeof output.source_revision!=='string'||!output.source_revision.trim()
  ||!Array.isArray(output.selection.evidence_links)
  ||typeof answer!=='string'||answer.trim().length<8)
  throw Error('k03_selection_not_qualified_for_draft');
 const questions=(output.clarification_requests||[])
  .map(row=>row.question).filter(value=>typeof value==='string'&&value.trim().length>0);
 const evidence=output.selection.evidence_links
  .map(row=>row.evidence_id).filter(x=>typeof x==='string'&&x.trim()).join(', ');
 return [
  'Черновик задачи по выбранной гипотезе K03 (не подтверждённый факт):',
  output.selection.candidate_text.trim(),
  '',
  'Уточнение пользователя:',answer.trim(),
  ...(questions.length?['','Вопросы K03:',...questions.map(q=>'- '+q)]:[]),
  '',
  'Источник и происхождение гипотезы (не самостоятельное доказательство результата):',
  output.source_value+' @ '+output.source_revision,
  'Hypothesis: '+output.selection.hypothesis_id,
  'Evidence IDs: '+(evidence||'нет подтверждённых ссылок'),
  '',
  'Проверь исходные сведения, отдели подтверждённые факты от гипотез,',
  'укажи недостающие данные и подготовь полезный результат для проверки человеком.',
 ].join('\n');
}
