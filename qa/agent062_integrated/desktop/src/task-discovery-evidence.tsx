import React from 'react';
import {useUiSettings} from './ui-preferences';
import {presentK03,type K03DiscoveryBinding,type DiscoveryEvidence} from './task-discovery-draft';

type Props={
 discovery?:K03DiscoveryBinding;
 workspaceId:string;
 inputText:string;
 /** Selecting a hypothesis only asks the current host to prepare its existing draft. */
 onChoose?:(id:string)=>void;
};

function evidenceLabel(kind:DiscoveryEvidence['kind'],tr:(ru:string,en:string)=>string){
 switch(kind){
  case 'observation':return tr('Наблюдение в источнике','Observation in source');
  case 'computed':return tr('Вычисленная связь','Computed association');
  case 'reported':return tr('Сообщение источника','Source report');
  case 'inference':return tr('Предположение','Inference');
  default:return tr('Недостаточно данных','Insufficient data');
 }
}

/** Optional, source-bound UI only. No network requests, source replay or Task creation. */
export function TaskDiscoveryEvidence({discovery,workspaceId,inputText,onChoose}:Props){
 const {tr}=useUiSettings();
 const view=presentK03(discovery,workspaceId,inputText);
 if(!view.fromK03)return <p role="status">{tr(
  'Подтверждённые основания K03 для этого запроса недоступны. Можно продолжить обычную задачу.',
  'Verified K03 evidence for this request is unavailable. You can continue the normal Task.')}</p>;
 return <section className="task-discovery-evidence-view" aria-label={tr('Гипотезы и основания','Hypotheses and evidence')}>
  <p>{tr('Гипотезы требуют уточнения человеком. Совпадение времени датчика и видео не доказывает, кто действовал.',
   'Hypotheses require human clarification. Sensor and video timing does not establish who acted.')}</p>
  {view.candidates.length===0&&<p role="status">{tr('Недостаточно данных для предложения задачи.',
   'Insufficient data to propose a Task.')}</p>}
  {view.candidates.map(candidate=><article key={candidate.id} className="task-discovery-candidate">
   <p><strong>{candidate.text.length>220?candidate.text.slice(0,220)+'…':candidate.text}</strong></p>
   {candidate.text.length>220&&<details><summary>{tr('Полная формулировка','Full description')}</summary><p>{candidate.text}</p></details>}
   {candidate.missingEvidence&&<p role="status">{tr('Недостаточно данных — гипотеза не готова к выбору.',
    'Insufficient data — this hypothesis is not ready for selection.')}</p>}
   <details className="task-discovery-evidence">
    <summary>{tr('Основания и неопределённость','Evidence and uncertainty')} ({candidate.evidence.length})</summary>
    <ul>{candidate.evidence.slice(0,5).map(e=><li key={e.id}>
     <strong>{evidenceLabel(e.kind,tr)}</strong>
     <p>{e.detail||tr('Описание не указано','No description supplied')}</p>
     {e.sourceUrls.length?<div>{e.sourceUrls.map(url=><a key={url} href={url} target="_blank" rel="noopener noreferrer">{tr('Источник','Source')}</a>)}</div>
      :<small>{tr('Проверяемая ссылка отсутствует','No verifiable source link')}</small>}
     {e.metadata.length>0&&<details><summary>{tr('Время, источник и ревизия','Time, source and revision')}</summary>
      <dl>{e.metadata.map(item=><React.Fragment key={item.key}><dt>{item.key}</dt><dd>{item.value}</dd></React.Fragment>)}</dl>
     </details>}
    </li>)}</ul>
    {candidate.evidence.length>5&&<p>{tr('Показаны первые пять оснований','Showing the first five evidence records')}</p>}
   </details>
   {onChoose&&<button type="button" disabled={candidate.missingEvidence} onClick={()=>onChoose(candidate.id)}>
    {tr('Уточнить эту задачу','Clarify this Task')}</button>}
  </article>)}
  {view.question&&<p><strong>{tr('Вопрос для уточнения:','Clarification question:')}</strong> {view.question}</p>}
 </section>;
}
