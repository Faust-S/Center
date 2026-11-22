import React,{useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import type {K03Selection} from './k03-discovery-draft';
import {TaskDiscoveryEvidence} from './task-discovery-evidence';
import {K03HostTextPanel} from './k03-host-text-panel';
import type {K03DiscoveryBinding} from './task-discovery-draft';
import {k03SelectionRef} from './k03-selection-identity.mjs';

type Preview={schema:string;status:string;source_kind:string;source_value:string;
 source_revision:string;bundle:K03DiscoveryBinding['bundle']};
type Availability={status:string;reason?:string;modes?:string[]};
type HostInput={request:Record<string,unknown>;sources:Record<string,unknown>[]};
type Props={onApplyDraft:(selection:K03Selection,discovery:K03DiscoveryBinding['bundle'],answer:string,hostInput?:HostInput,criteria?:string[])=>Promise<void>;tr:(ru:string,en:string)=>string;workspaceId:string;attachments?:{name:string;text:string}[]};
const errorText=(err:unknown)=>err instanceof Error?err.message:String(err);

/** Optional public K03 research consumer: preview, human qualification and existing P01 draft only.
 * Never imports K03 at app startup, invokes model/program or creates a Task. */
export function K03DiscoveryPanel({onApplyDraft,tr,workspaceId,attachments=[]}:Props){
 const[availability,setAvailability]=useState<Availability|null>(null);
 const[kind,setKind]=useState<'desk'|'issue'>('desk'),[source,setSource]=useState('CASE-2');
 const[preview,setPreview]=useState<Preview|null>(null);
 const[picked,setPicked]=useState(''),[answer,setAnswer]=useState(''),[criteriaText,setCriteriaText]=useState('');
 const[loading,setLoading]=useState(false),[error,setError]=useState('');
 const[applied,setApplied]=useState(false);
 const alive=useRef(true),generation=useRef(0);
 const[stage,setStage]=useState<'idle'|'reading'|'selecting'|'saving'>('idle');
 const[waitSince,setWaitSince]=useState(0),[elapsed,setElapsed]=useState(0);
 useEffect(()=>{
  if(stage==='idle')return;
  const tick=window.setInterval(()=>setElapsed(Math.floor((Date.now()-waitSince)/1000)),1000);
  return()=>window.clearInterval(tick);
 },[stage,waitSince]);
 function beginStage(next:'reading'|'selecting'|'saving'){
  setStage(next);setWaitSince(Date.now());setElapsed(0);
 }
 function stopWaiting(){
  if(!['reading','selecting'].includes(stage))return;
  generation.current++;setLoading(false);setStage('idle');
  setPreview(null);setPicked('');
  setError(tr('Показ ответа прекращён. Локальная проверка может завершаться; Task не создана.',
   'Stopped waiting for the reply. The local read may still finish; no Task was created.'));
 }
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;generation.current++;};},[]);
 useEffect(()=>{
  let active=true;
  void runtime.query<Availability>('k03_discovery_status').then(v=>{if(active)setAvailability(v);})
   .catch(e=>{if(active)setError(errorText(e));});
  return()=>{active=false;};
 },[]);
 async function inspect(){
  if(loading)return;
  const stamp=++generation.current;
  setLoading(true);beginStage('reading');setError('');setApplied(false);
  setPreview(null);setPicked('');setAnswer('');setCriteriaText('');
  try{
   const data=await runtime.query<Preview>('k03_discovery_preview',{
    source_kind:kind,source_value:source.trim()});
   if(data.source_kind!==kind||data.source_value!==source.trim()||
      data.status!=='SOURCE_BOUND_HYPOTHESES_NOT_TASK'||!data.source_revision||
      !Array.isArray(data.bundle?.task_hypotheses))throw Error('k03_preview_unverified');
   if(alive.current&&generation.current===stamp)setPreview(data);
  }catch(e){if(alive.current&&generation.current===stamp)setError(errorText(e));}
  finally{if(alive.current&&generation.current===stamp){setLoading(false);setStage('idle');}}
 }
 async function select(){
  if(loading||!preview||!picked||answer.trim().length<8)return;
  const criteria=criteriaText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(criteria.length>8||criteria.some(s=>s.length>500)){
   setError(tr('Укажите не более восьми критериев, до 500 символов каждый.',
    'Enter no more than eight criteria, up to 500 characters each.'));return;
  }
  const stamp=++generation.current;
  setLoading(true);beginStage('selecting');setError('');
  try{
   const selected=await runtime.query<K03Selection>('k03_discovery_select',{
    source_kind:preview.source_kind,source_value:preview.source_value,
    source_revision:preview.source_revision,hypothesis_id:picked,
    selection_ref:await k03SelectionRef(
     [workspaceId,preview.source_kind,preview.source_value,preview.source_revision,
      picked,answer.trim(),criteria])});
   if(selected.source_kind!==preview.source_kind||
      selected.source_value!==preview.source_value||
      selected.source_revision!==preview.source_revision||
      selected.selection.hypothesis_id!==picked)throw Error('k03_selection_readback_mismatch');
   if(!alive.current||generation.current!==stamp)return;
   if(source.trim()!==preview.source_value)throw Error('k03_source_changed');
   beginStage('saving');
   await onApplyDraft(selected,preview.bundle,answer,undefined,criteria);
   if(alive.current&&generation.current===stamp)setApplied(true);
  }catch(e){
   if(alive.current&&generation.current===stamp&&errorText(e)!=='k03_draft_replacement_cancelled')setError(errorText(e));
  }
  finally{if(alive.current&&generation.current===stamp){setLoading(false);setStage('idle');}}
 }
 const available=availability?.status==='AVAILABLE_PINNED_ONLY';
 const modeAvailable=available&&availability?.modes?.includes(
  kind==='desk'?'PINNED_SECONDARY_DESK':'PINNED_PUBLIC_GITHUB_ISSUE');
 const hypotheses=preview?.bundle?.task_hypotheses||[];
 const questions=preview?.bundle?.clarification_requests||[];
 return <section className="advanced-form" aria-label={tr('Уточнить потребность через K03','Clarify need with K03')}>
  <h3>{tr('От проблемы к задаче','From a problem to a Task')}</h3>
  <p>{tr('Опишите, что беспокоит, и вставьте свою заметку. Посмотрите основание, выберите подходящее предложение и отредактируйте будущую задачу. Ничего не отправляется автоматически.',
    'Describe your concern and paste a note. Review the evidence, choose a suggestion and edit the resulting Task. Nothing is submitted automatically.')}</p>
  {!available&&<p role="status">{tr('Публичный K03 не подключён. Обычная задача работает независимо.',
    'Public K03 is not connected. Normal tasks remain available.')} {availability?.reason||''}</p>}
  <K03HostTextPanel tr={tr} workspaceId={workspaceId} onApplyDraft={onApplyDraft}
   attachments={attachments}
   enabled={available&&availability?.modes?.includes('AUTHORIZED_TEXT_WITH_PINNED_U1')===true}/>
  <details className="composer-options">
   <summary>{tr('Проверить публичный пример','Explore a pinned public example')}</summary>
  <label>{tr('Тип источника','Source type')}
   <select value={kind} disabled={loading} onChange={e=>{
    const value=e.target.value as 'desk'|'issue';
    setKind(value);setSource(value==='desk'?'CASE-2':'');
    setPreview(null);setPicked('');setAnswer('');setCriteriaText('');setApplied(false);
   }}>
    <option value="desk">{tr('Закреплённый desk-кейс CASE-0…CASE-4','Pinned desk case CASE-0…CASE-4')}</option>
    <option value="issue">{tr('Закреплённое GitHub issue (из восьми)','Pinned GitHub issue (one of eight)')}</option>
   </select></label>
  <label>{tr('Идентификатор источника','Source identity')}
   <input value={source} disabled={loading} onChange={e=>{
    setSource(e.target.value);setPreview(null);setPicked('');setAnswer('');setCriteriaText('');setApplied(false);
   }} placeholder={kind==='desk'?'CASE-2':'https://github.com/owner/repo/issues/123'}/></label>
  <button type="button" className="secondary-button"
   disabled={loading||!modeAvailable||!source.trim()}
   onClick={()=>void inspect()}>{tr('Посмотреть гипотезы и основания','Inspect hypotheses and evidence')}</button>
  {stage!=='idle'&&<div role="status" className="k03-progress">
   <strong>{stage==='reading'?tr('Читаю закреплённый источник','Reading pinned source')
    :stage==='selecting'?tr('Сверяю выбор с актуальным источником','Rechecking the selected source')
    :tr('Сохраняю обычный черновик Task','Saving the regular Task draft')}</strong>
   <span>{tr('В этом окне: ','In this window: ')}{elapsed} {tr('с','s')}. {tr('Время окончания не известно.','No completion estimate.')}</span>
   {stage!=='saving'&&<button type="button" className="mini-button" onClick={stopWaiting}>
    {tr('Прекратить ожидание','Stop waiting')}</button>}
   {stage==='saving'&&<small>{tr('Проверьте черновик перед повтором, если ответ потерян.','Inspect the saved draft before retrying if the reply is lost.')}</small>}
  </div>}
  {error&&<p role="alert">{error}</p>}
  {preview&&<div className="owner-rows">
   <p>{tr('Источник повторно проверен. Это ещё не создание задачи.',
     'Source replayed. No Task has been created.')}</p>
   <small>{preview.source_value} · {preview.source_revision}</small>
   <TaskDiscoveryEvidence
    discovery={{workspaceId,inputText:preview.source_value,
     verifiedForCurrentInput:true,bundle:preview.bundle}}
    workspaceId={workspaceId} inputText={source.trim()}/>
   {hypotheses.length===0?<p>{tr('Квалифицированных гипотез нет. Уточните запрос обычным способом.',
    'No supported hypotheses. Clarify your request directly.')}</p>:<>
    <label>{tr('Выберите гипотезу','Select a hypothesis')}
     <select value={picked} disabled={loading} onChange={e=>setPicked(e.target.value)}>
      <option value="">{tr('Не выбрано','Not selected')}</option>
      {hypotheses.map(h=><option key={h.id} value={h.id}>{h.text}</option>)}
     </select></label>
    {questions.map((q,i)=><p key={i}>{tr('Вопрос для уточнения: ','Clarification question: ')}{q.question}</p>)}
    <label>{tr('Ваш ответ и ожидаемый результат','Your clarification and expected result')}
     <textarea value={answer} disabled={loading} onChange={e=>setAnswer(e.target.value)}
      rows={3} placeholder={tr('Что именно нужно проверить или подготовить?','What should be checked or produced?')}/></label>
    <label>{tr('Как проверить результат? Один критерий в строке (необязательно)',
     'How to verify the result? One criterion per line (optional)')}
     <textarea rows={2} maxLength={4007} value={criteriaText} disabled={loading}
      onChange={e=>setCriteriaText(e.target.value)}/></label>
    <button type="button" disabled={loading||!picked||answer.trim().length<8||applied}
     onClick={()=>void select()}>{tr('Вставить в существующий черновик','Use in existing draft')}</button>
    {applied&&<p role="status">{tr('Черновик сохранён в Agent. Проверьте его и нажмите «Отправить» самостоятельно.',
     'Draft saved in Agent. Review it and press Send yourself.')}</p>}
   </>}
  </div>}
  </details>
 </section>;
}
