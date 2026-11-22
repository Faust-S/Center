import React,{useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {humanState} from './human-language';
import {compareTaskAttachmentWithFile,type VerifiedTaskDocumentPreview} from './k01-attachment-comparison.mjs';
import {reviewAcceptedResultChange,prepareAcceptedResultComparisonDraft,
 type AcceptedProjectRefresh,type AcceptedComparisonDraftInput} from './k01-accepted-project.mjs';
import {OwnerDetails,record,records,str,type Row} from './owner-ui';
import {useUiSettings} from './ui-preferences';

type Tab='history'|'sources';
type EventRow={key:string;at:string;title:string;state?:string;origin:Row};
const readableTool=(value:unknown,language:'ru'|'en')=>{
 const id=str(value);
 if(id==='files.write_text')return language==='ru'?'Изменение файла':'File change';
 if(id==='files.read')return language==='ru'?'Чтение файла':'File read';
 return language==='ru'?'Действие агента':'Assistant action';
};
const dateText=(value:string,language:'ru'|'en')=>{
 const date=new Date(value);
 return value&&Number.isFinite(date.getTime())?date.toLocaleString(language==='ru'?'ru-RU':'en-GB'):undefined;
};

/** User-initiated Core verification; never a context approval or refresh of K01 fields. */
function SourceStatusCheck({taskId,snapshotId}:{taskId:string;snapshotId:string}){
 const {tr}=useUiSettings();
 const [busy,setBusy]=useState(false),[result,setResult]=useState<Row|null>(null);
 const [error,setError]=useState('');
 const seq=useRef(0),pending=useRef(false);
 useEffect(()=>{seq.current++;pending.current=false;setBusy(false);setResult(null);setError('');},
  [taskId,snapshotId]);
 async function check(){
  if(pending.current)return;
  pending.current=true;const token=++seq.current;
  setBusy(true);setError('');setResult(null);
  try{
   const next=record(await runtime.query<Row>('context_snapshot_status',
    {task_id:taskId,snapshot_id:snapshotId}));
   if(token!==seq.current)return;
   if(next.snapshot_id!==snapshotId||!['FRESH','STALE','UNVERIFIABLE','INTEGRITY_FAIL'].includes(str(next.state))||
      !Array.isArray(next.integrity)||!Array.isArray(next.reasons)||!Array.isArray(next.unverifiable))
    throw Error('context_status_readback_mismatch');
   setResult(next);
  }catch(e){
   if(token===seq.current)setError(e instanceof Error?e.message:String(e));
  }finally{if(token===seq.current){pending.current=false;setBusy(false);}}
 }
 const state=str(result?.state);
 const status=state==='FRESH'?tr('Сохранённые источники актуальны на момент проверки','Saved sources were current when checked'):
  state==='STALE'?tr('Источники изменились. Перед новой задачей проверьте редакции','Sources changed. Review revisions before a new task'):
  state==='UNVERIFIABLE'?tr('Не все источники удалось проверить','Some sources could not be verified'):
  state==='INTEGRITY_FAIL'?tr('Нарушена целостность сохранённого контекста','Saved context integrity failed'):'';
 return <div className="advanced-form">
  <button type="button" className="secondary-button" disabled={busy}
   onClick={()=>void check()}>{busy?tr('Проверяю источники…','Checking sources…'):
    tr('Проверить источники','Check sources')}</button>
  {result&&<><p role={state==='FRESH'?'status':'alert'}>{status}</p>
   {state!=='FRESH'&&<OwnerDetails title={tr('Причины и источники','Reasons and sources')}
    value={{reasons:result.reasons,unverifiable:result.unverifiable,integrity:result.integrity}}/>}
   <small>{tr('Это проверка сохранённой редакции, а не принятие новой сметы или решения.',
     'This checks the saved revision; it does not approve a new estimate or decision.')}</small></>}
  {error&&<p role="alert">{tr('Проверка не завершена: ','Verification failed: ')}{error}</p>}
 </div>;
}

/** Explicit local comparison of an immutable saved attachment and a user-chosen file.
 * It is not K01's approved Project Refresh or a source-authority decision.
 */
function TaskAttachmentComparison({taskId,snapshotId,path,sha256,onUseRevision}:{
 taskId:string;snapshotId:string;path:string;sha256:string;
 onUseRevision?:(file:{name:string;text:string;sourcePath:string;previousText?:string})=>Promise<void>;
}){
 const {tr}=useUiSettings();
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [preview,setPreview]=useState<VerifiedTaskDocumentPreview|null>(null);
 const sequence=useRef(0),inFlight=useRef(false);
 useEffect(()=>{
  sequence.current++;inFlight.current=false;setBusy(false);setError('');setPreview(null);
  return()=>{sequence.current++;};
 },[taskId,snapshotId,path,sha256]);
 async function inspect(file:File){
  if(inFlight.current)return;
  inFlight.current=true;const token=++sequence.current;
  setBusy(true);setError('');setPreview(null);
  try{
   const readback=await compareTaskAttachmentWithFile(
    {query:(query,params)=>runtime.query(query,params)},
    {taskId,snapshotId,path,sha256},file,
    {isCurrent:()=>token===sequence.current});
   if(token===sequence.current)setPreview(readback);
  }catch(e){
   if(token===sequence.current)setError(e instanceof Error?e.message:String(e));
  }finally{
   if(token===sequence.current){inFlight.current=false;setBusy(false);}
  }
 }
 const comparison=preview?.comparison;
 const short=(s:string|null)=>s===null?tr('Нет строки','No line'):
  s.length>240?s.slice(0,240)+'…':s;
 return <details className="owner-details">
  <summary>{tr('Сравнить с новой редакцией','Compare with a new revision')}</summary>
  <p>{tr('Выберите новую локальную копию текстового документа (до 48 КБ). Исходная редакция читается из сохранённой задачи и проверяется по SHA-256.',
   'Choose a newer local text file (up to 48 KB). The old revision is read from the saved Task and verified by SHA-256.')}</p>
  <label className="advanced-field">{tr('Новая редакция','New revision')}
   <input type="file" accept=".txt,.md,.csv,.json" disabled={busy}
    onChange={e=>{
     const file=e.target.files?.[0];e.target.value='';
     if(file)void inspect(file);
    }}/>
  </label>
  {busy&&<p role="status">{tr('Сравниваю редакции…','Comparing revisions…')}</p>}
  {error&&<p role="alert">{tr('Не удалось проверить документ: ','Could not verify the document: ')}{error}</p>}
  {preview&&comparison&&<div className="advanced-form">
   <strong>{comparison.contentChanged?
    tr('Текст документа изменился','Document text changed'):
    tr('Тексты совпадают','Document texts match')}</strong>
   <small>{tr('Сохранённая редакция','Saved revision')}: {preview.oldSha256.slice(0,16)} ·
    {tr('Выбранная редакция','Selected revision')}: {preview.newFile.sha256.slice(0,16)}</small>
   {comparison.contentChanged&&<>
    <p>{tr('Сравнение показывает различия в тексте, но не утверждает новые условия. Для юридического или финансового решения требуется отдельная проверка.',
     'This is a text comparison, not an approval of the new terms. Legal and financial decisions require separate review.')}</p>
    {comparison.structuredChanges.length>0&&<div className="owner-rows">
     {comparison.structuredChanges.map((change,i)=><div className="owner-row" key={change.label+':'+i}>
      <strong>{change.label}</strong>
      <span>{tr('Было','Before')}: {short(change.before)}</span>
      <span>{tr('Стало','After')}: {short(change.after)}</span>
     </div>)}
    </div>}
    {comparison.hiddenStructuredChanges>0&&<p role="status">
     {tr('Других изменённых строк с метками: ','More labeled changes: ')}{comparison.hiddenStructuredChanges}
    </p>}
    {comparison.ambiguousCount>0&&<p role="alert">
     {tr('Повторяющиеся метки требуют ручной проверки: ','Repeated labels require review: ')}
     {comparison.ambiguousLabels.join(', ')}
    </p>}
    {comparison.lineSample&&<details className="owner-details">
     <summary>{tr('Проверить фрагмент изменённого текста','Inspect changed text excerpt')}</summary>
     <strong>{tr('До изменения, строка ','Before, line ')}{comparison.lineSample.beforeStart}</strong>
     <pre className="document-content">{comparison.lineSample.before.map(x=>short(x)).join('\n')}</pre>
     <strong>{tr('После изменения, строка ','After, line ')}{comparison.lineSample.afterStart}</strong>
     <pre className="document-content">{comparison.lineSample.after.map(x=>short(x)).join('\n')}</pre>
     {(comparison.lineSample.beforeOmitted>0||comparison.lineSample.afterOmitted>0)&&
      <p>{tr('Показан только фрагмент; остальной текст не скрыт при вычислении различий.',
       'Only an excerpt is shown; the rest of the text was not omitted from the comparison.')}</p>}
    </details>}
    {preview.oldFile.bytes+preview.newFile.bytes>48000&&<p role="status">
     {tr('Оба документа вместе превышают лимит 48 КБ. В новую задачу можно передать только новую редакцию.',
      'Together the files exceed the 48 KB limit. Only the new revision can be sent to the next Task.')}
    </p>}
    {onUseRevision&&<button type="button" className="secondary-button"
     onClick={()=>void onUseRevision({name:preview.newFile.name,text:preview.newFile.text,
      sourcePath:path,...(preview.oldFile.bytes+preview.newFile.bytes<=48000?
       {previousText:preview.oldFile.text}:{})})}>
     {preview.oldFile.bytes+preview.newFile.bytes<=48000?
      tr('Подготовить Task со сравнением двух редакций','Prepare Task comparing both revisions'):
      tr('Подготовить Task только с новой редакцией','Prepare Task with new revision only')}
    </button>}
   </>}
   <small>{tr('Новый файл не заменяет исходный и не считается согласованным. Его передача в новую задачу требует отдельного действия.',
    'The new file does not replace the old source or become accepted. Adding it to a new Task is a separate action.')}</small>
  </div>}
 </details>;
}

/** Explicit human-requested K01 owner refresh of two accepted Task Results. */
function AcceptedResultRefresh({taskId,candidates,onPrepare}:{
 taskId:string;candidates:{id:string;objective?:string}[];
 onPrepare?:(file:AcceptedComparisonDraftInput)=>Promise<void>;
}){
 const {tr}=useUiSettings();
 const [chosen,setChosen]=useState('');
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [result,setResult]=useState<AcceptedProjectRefresh|null>(null);
 const sequence=useRef(0),pending=useRef(false);
 useEffect(()=>{
  sequence.current++;pending.current=false;
  setChosen('');setResult(null);setBusy(false);setError('');
  return()=>{sequence.current++;};
 },[taskId]);
 async function inspect(){
  if(pending.current||!chosen)return;
  pending.current=true;const token=++sequence.current;
  setBusy(true);setResult(null);setError('');
  try{
   const next=await reviewAcceptedResultChange(
    {query:(name,params)=>runtime.query(name,params)},
    {olderTaskId:taskId,newerTaskId:chosen,isCurrent:()=>token===sequence.current});
   if(token===sequence.current)setResult(next);
  }catch(e){
   if(token===sequence.current){
    const code=e instanceof Error?e.message:String(e);
    setError(code.includes('chronology_invalid')?
     tr('Выбранный результат был принят раньше исходной задачи. Укажите более поздний результат.',
      'The selected result was accepted before the original Task. Choose a later accepted result.'):
     code.includes('no_labeled_fields')||code.includes('fields_require_manual_review')?
     tr('Для автоматического сопоставления нужны однозначные строки вида «Поле: значение». Сравните документы вручную.',
      'Clear label:value lines are required. Compare these documents manually.'):
     code.includes('source_')||code.includes('workspace')?
     tr('Источник или рабочая область изменились. Обновите Task и повторите чтение.',
      'The source or workspace changed. Refresh the Task before checking again.'):
     tr('Проверка K01 не завершена: ','K01 verification did not finish: ')+code);
   }
  }finally{if(token===sequence.current){pending.current=false;setBusy(false);}}
 }
 async function prepare(){
  if(pending.current||!result||!onPrepare)return;
  pending.current=true;const token=++sequence.current;
  setBusy(true);setError('');
  try{
   const file=await prepareAcceptedResultComparisonDraft(
    {query:(name,params)=>runtime.query(name,params)},result,
    {isCurrent:()=>token===sequence.current});
   if(token===sequence.current)await onPrepare(file);
  }catch(e){
   if(token===sequence.current){
    const code=e instanceof Error?e.message:String(e);
    setError(code.includes('over_budget')?
     tr('Оба принятых результата превышают лимит вложений Task 48 КБ.',
      'The accepted Results exceed the 48 KB Task attachment limit.'):
     tr('Продолжение заблокировано: результаты или рабочая область изменились. Сначала повторите проверку K01. ',
      'Continuation blocked: Results or workspace changed. Run the K01 review again. ')+code);
    setResult(null);
   }
  }finally{if(token===sequence.current){pending.current=false;setBusy(false);}}
 }
 const mapped=new Map<string,string>((result?.fieldLabels??[]).map(x=>[x.fieldKey,x.label] as const));
 const issues=result?.issueChanges.appeared??[];
 const status=result?.status;
 return <section className="advanced-form">
  <h3>{tr('Сравнить принятые результаты проекта','Compare accepted project results')}</h3>
  <p>{tr('K01 проверяет строки двух результатов, принятых человеком. Противоречащие условия не считаются автоматически заменёнными.',
    'K01 checks two human-accepted Results. Contradictory terms are not automatically superseded.')}</p>
  <label className="advanced-field">{tr('Другой принятый результат','Another accepted Result')}
   <select value={chosen} disabled={busy} onChange={e=>{sequence.current++;setChosen(e.target.value);setResult(null);setError('');}}>
    <option value="">{tr('Выберите задачу','Select a Task')}</option>
    {candidates.map(c=><option key={c.id} value={c.id}>{(c.objective||c.id).slice(0,110)}</option>)}
   </select>
  </label>
  <button type="button" disabled={!chosen||busy} onClick={()=>void inspect()}>
   {busy?tr('K01 проверяет результаты…','K01 is checking Results…'):
    tr('Проверить различия через K01','Check differences with K01')}
  </button>
  {error&&<p role="alert">{error}</p>}
  {result&&<div className="advanced-form">
   <p role={status==='CURRENT'?'status':'alert'}>
    {status==='INCOMPLETE'?
     tr('Условия противоречат друг другу или недостаточно подтверждены. Требуется решение.',
      'The terms conflict or lack evidence. A decision is required.'):
     status==='UPDATED'?
     tr('K01 обнаружил изменение. Новый контекст требует проверки.',
      'K01 detected a change. Review the updated context.'):
     status==='CURRENT'?
     tr('Сравниваемые поля совпадают на момент проверки.',
      'Compared fields are current at the time of the check.'):
     tr('K01 отклонил сравнение: изменились исходные права или сведения.',
      'K01 rejected the comparison: source permissions or identity changed.')}
   </p>
   <small>{tr('Проверено именованных полей: ','Labeled fields checked: ')}{result.comparedFieldCount}.
    {tr(' Только выбранные результаты, не весь проект.',
      ' Only these Results, not the whole project.')}</small>
   <div className="owner-rows">{result.visual.structuredChanges.map((c,i)=>
    <div className="owner-row" key={c.label+':'+i}>
     <strong>{c.label}</strong>
     <span>{tr('Было','Before')}: {c.before===null?tr('Не найдено','Missing'):c.before.slice(0,240)}</span>
     <span>{tr('Стало','After')}: {c.after===null?tr('Не найдено','Missing'):c.after.slice(0,240)}</span>
    </div>)}</div>
   {issues.length>0&&<div className="owner-rows">
    <strong>{tr('Почему K01 требует проверки','Why K01 requires review')}</strong>
    {issues.map((item,i)=><div className="owner-row" key={item.fieldKey+item.type+':'+i}>
     <strong>{mapped.get(item.fieldKey)||item.fieldKey}</strong>
     <span>{item.type==='contradiction'?
      tr('Разные принятые значения. Замена не подтверждена.',
       'Conflicting accepted values. Supersession is unconfirmed.'):
      item.type==='source_evidence_missing'?
       tr('Заявленное поле отсутствует в содержимом источника.',
        'The declared field is missing from the source content.'):
       item.type}</span>
    </div>)}
   </div>}
   {onPrepare&&result.status!=='REJECTED'&&
    result.sourceBytes[0]+result.sourceBytes[1]<=48000&&
    <button type="button" className="secondary-button" disabled={busy}
     onClick={()=>void prepare()}>
     {tr('Подготовить новую Task с двумя результатами','Prepare a new Task with both Results')}
    </button>}
   {onPrepare&&result.sourceBytes[0]+result.sourceBytes[1]>48000&&
    <p role="status">{tr('Оба результата вместе превышают 48 КБ. Для продолжения выберите меньшие документы.',
     'Together the Results exceed 48 KB. Select smaller documents before continuing.')}</p>}
   <OwnerDetails title={tr('Редакции, доказательства и изменения K01','Revisions, evidence and K01 changes')}
    value={{sourceRevisions:result.sourceRevisions,fieldChanges:result.fieldChanges,
     sourceChanges:result.sourceChanges,issueChanges:result.issueChanges}}/>
   <small>{tr('Это проверка, не новое решение и не сохранение в память. Для изменения условий потребуется отдельное принятие человеком.',
    'This is a review, not a new decision or memory admission. Changing terms requires a separate human approval.')}</small>
  </div>}
 </section>;
}

/** Read-only task history from actual Core readback. No inferred executions. */
export function TaskEvidencePanel({readback,tab,taskId,onUseDocumentRevision,
 acceptedResult=false,acceptedTaskCandidates=[]}: {
 readback?:unknown;tab:Tab;taskId:string;
 onUseDocumentRevision?:(file:{name:string;text:string;sourcePath:string;previousText?:string})=>Promise<void>;
 acceptedResult?:boolean;acceptedTaskCandidates?:{id:string;objective?:string}[];
}){
 const {tr,language}=useUiSettings();
 const data=record(readback);
 const snapshots=records(data.context_snapshots);
 const selectedNotes=snapshots.flatMap(s=>records(s.retrievals)
  .filter(r=>r.policy==='IWXA_HUMAN_KNOWLEDGE_EXPLICIT_SOURCE_V1')
  .flatMap(r=>records(r.selected).map(x=>str(x.ref_id)))).filter(Boolean);
 const plans=records(data.tool_plans);
 const receipts=records(data.execution_receipts);
 const repairs=records(data.repair_cases);
 if(tab==='sources'){
  const sources:Row[]=snapshots.flatMap((snap,index)=>records(snap.source_items).map((source,i)=>({
   ...source,snapshot: index,snapshot_id:str(snap.snapshot_id), key: str(snap.snapshot_id)+':'+i,
  })));
  return <section aria-label={tr('Источники задачи','Task sources')}>
   <h2>{tr('Материалы задачи','Task materials')}</h2>
   {acceptedResult&&acceptedTaskCandidates.length>0&&
    <AcceptedResultRefresh taskId={taskId} candidates={acceptedTaskCandidates}
     onPrepare={onUseDocumentRevision}/>}
   {selectedNotes.length>0&&<div className="advanced-form"><h3>{tr('Заметки, включённые в задачу','Notes included in this task')}</h3>
    <p>{tr('При создании задачи IWXA проверила выбранные заметки и сохранила их содержание вместе с основаниями. Текущие файлы могли измениться.','IWXA verified these selected notes when the task was created and saved their content with its evidence. The live notes may have changed.')}</p>
    <div className="owner-rows">{[...new Set(selectedNotes)].map(path=><div className="owner-row" key={path}><strong>{path}</strong></div>)}</div>
   </div>}
   {!sources.length&&<p>{tr('Для этой задачи нет сохранённых материалов.','No saved materials were found for this task.')}</p>}
   <div className="owner-rows">{sources.map(source=><div className="owner-row" key={str(source.key)}>
    <strong>{str(source.path)||tr('Источник','Source')}</strong>
    <small>{str(source.origin)==='interaction_attachment'&&str(source.trust_level)==='verified_by_evidence'
      &&/^attachments\/[0-9]{2}-tool-read-TRR-[A-Za-z0-9_-]{1,100}\.txt$/.test(str(source.path))
      ?tr('Чтение сверено с исходной квитанцией ToolRuntime','Read verified against the original ToolRuntime receipt')
      :str(source.origin)==='iwxa_retrieval_evidence'&&/^iwxa\/evidence\/tool-read-/.test(str(source.path))
      ?tr('Основание квитанции чтения','Read receipt evidence')
      :tr('Материал из сохранённого контекста задачи','Material from the saved task context')}</small>
    <OwnerDetails title={tr('Происхождение и целостность','Provenance and integrity')} value={source}/>
    {str(source.origin)==='interaction_attachment'
     &&!(str(source.trust_level)==='verified_by_evidence'
       &&/^attachments\/[0-9]{2}-tool-read-TRR-[A-Za-z0-9_-]{1,100}\.txt$/.test(str(source.path)))
     &&/^attachments\/[0-9]{2}-[\w.-]{1,120}$/.test(str(source.path))&&
     /^[a-f0-9]{64}$/.test(str(source.sha256))&&
     <TaskAttachmentComparison taskId={taskId} snapshotId={str(source.snapshot_id)}
      path={str(source.path)} sha256={str(source.sha256)} onUseRevision={onUseDocumentRevision}/>}
   </div>)}</div>
   {snapshots.length>sources.length&&<p>{tr('В задаче также есть сохранённые сведения об извлечении материалов.','The task also contains saved retrieval details.')}</p>}
   {snapshots.filter(s=>/^CSN-[A-Za-z0-9_-]+$/.test(str(s.snapshot_id))).map(s=>
    <div className="owner-row" key={str(s.snapshot_id)}>
     <strong>{tr('Проверка сохранённого контекста','Saved context check')}</strong>
     <small>{str(s.snapshot_id)}</small>
     <SourceStatusCheck taskId={taskId} snapshotId={str(s.snapshot_id)}/>
    </div>)}
   <OwnerDetails title={tr('Сохранённый контекст','Saved context')} value={snapshots}/>
  </section>;
 }
 const events:EventRow[]=[
  ...snapshots.map((item,i)=>({
   key:'source:'+str(item.snapshot_id)+':'+i,at:str(item.created_at),
   title:tr('Сохранены материалы для задачи','Task materials saved'),origin:item,
  })),
  ...plans.map((item,i)=>({
   key:'plan:'+str(item.plan_id)+':'+i,at:str(item.prepared_at),
   title:tr('Подготовлено действие','Action prepared')+' - '+readableTool(item.tool_id,language),
   state:str(item.execution_state),origin:item,
  })),
  ...receipts.map((item,i)=>({
   key:'receipt:'+str(item.receipt_id)+':'+i,at:str(item.finished_at),
   title:tr('Получена квитанция','Execution receipt recorded')+' - '+readableTool(item.tool_id,language),
   state:str(item.status),origin:item,
  })),
  ...repairs.map((item,i)=>({
   key:'repair:'+str(item.case_id)+':'+i,at:str(item.updated_at),
   title:tr('Проверяется результат действия','Action outcome under review'),
   state:str(item.contract_state)||str(item.state),origin:item,
  })),
 ].sort((a,b)=>(Date.parse(b.at)||0)-(Date.parse(a.at)||0));
 return <section aria-label={tr('История работы','Work history')}>
  <h2>{tr('Сохранённая история действий','Saved action history')}</h2>
  <p>{tr('Здесь показаны только действия и материалы, для которых в задаче есть сохранённые записи.','Only actions and materials with saved task records are shown here.')}</p>
  {!events.length&&<p>{tr('Отдельных записей о действиях пока нет. Состояние задачи можно посмотреть в разделе «Результат».','No separate action records are available yet. Check the task under Result.')}</p>}
  <div className="owner-rows">{events.map(event=><div className="owner-row" key={event.key}>
   <strong>{event.title}</strong>
   {dateText(event.at,language)&&<small>{dateText(event.at,language)}</small>}
   {event.state&&<span>{humanState(event.state,language)}</span>}
   <OwnerDetails title={tr('Сохранённая запись','Saved record')} value={event.origin}/>
  </div>)}</div>
 </section>;
}
