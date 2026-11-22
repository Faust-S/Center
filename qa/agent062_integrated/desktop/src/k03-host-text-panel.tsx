/** Optional K03 authorized-text intake. P01 alone owns Task creation and drafts.
 * Source bytes are only sent to local Core on explicit Inspect / Select clicks.
 */
import React,{useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import type {K03Selection} from './k03-discovery-draft';
import type {K03DiscoveryBinding} from './task-discovery-draft';
import {k03SourceExcerpt} from './k03-evidence-context.mjs';
import {k03SelectionRef} from './k03-selection-identity.mjs';

type Tr=(ru:string,en:string)=>string;
type Row=Record<string,unknown>;
type HostInput={request:Row;sources:Row[]};
type Hypothesis={id:string;text:string;status:string;evidence_links?:unknown[]};
type HostBundle={schema:string;route:string;task_hypotheses:Hypothesis[];
 activity_observations?:Row[];
 clarification_requests?:{question:string}[];task_created:boolean;result_created:boolean;
 accepted_task_count:number;};
type HostSelection={schema:string;hypothesis_id:string;selection_ref:string;
 candidate_text:string;task_created:boolean;result_created:boolean;
 evidence_links:unknown[];next_owner:string;};
type Props={
 tr:Tr;workspaceId:string;enabled:boolean;attachments?:{name:string;text:string}[];
 onApplyDraft:(selection:K03Selection,discovery:K03DiscoveryBinding['bundle'],
  answer:string,hostInput?:HostInput,criteria?:string[])=>Promise<void>;
};
type Snapshot={input:HostInput;bundle:HostBundle;fingerprint:string};

const issue=(e:unknown)=>e instanceof Error?e.message:String(e);
const sha256=async(text:string):Promise<string>=>{
 const raw=new TextEncoder().encode(text);
 const digest=await crypto.subtle.digest('SHA-256',raw);
 return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
};

export function K03HostTextPanel({tr,workspaceId,enabled,onApplyDraft,attachments=[]}:Props){
 const[need,setNeed]=useState(''),[sourceText,setSourceText]=useState('');
 const[selectedAttachment,setSelectedAttachment]=useState('');
 const[expectedResult,setExpectedResult]=useState(''),[criteriaText,setCriteriaText]=useState('');
 const[consent,setConsent]=useState(false),[busy,setBusy]=useState(false);
 const[picked,setPicked]=useState(''),[error,setError]=useState('');
 const[snapshot,setSnapshot]=useState<Snapshot|null>(null),[applied,setApplied]=useState(false);
 const live=useRef(''),generation=useRef(0);
 const[stage,setStage]=useState<'idle'|'preparing'|'reading'|'selecting'|'saving'>('idle');
 const[waitSince,setWaitSince]=useState(0),[elapsed,setElapsed]=useState(0);
 useEffect(()=>{
  if(stage==='idle')return;
  const ticker=window.setInterval(()=>setElapsed(Math.floor((Date.now()-waitSince)/1000)),1000);
  return()=>window.clearInterval(ticker);
 },[stage,waitSince]);
 useEffect(()=>()=>{generation.current++;},[]);
 function beginStage(next:'preparing'|'reading'|'selecting'|'saving'){
  setStage(next);setElapsed(0);setWaitSince(Date.now());
 }
 // Cancels observation of a read-only K03 request, not a Core mutation.
 // A stale response may still arrive, but cannot be applied to the draft.
 function stopWaiting(){
  if(!['preparing','reading','selecting'].includes(stage))return;
  generation.current++;
  setBusy(false);setStage('idle');setSnapshot(null);setPicked('');
  setError(tr('Прекратили ожидание. Запрос к локальному Core может завершаться; задача не запускалась.',
   'Stopped waiting. The local Core request may still finish; no Task was started.'));
 }
 // Reuse an already chosen Task attachment; never open a second file picker.
 // If it was edited/removed after inspection, old source evidence becomes stale.
 const attached=selectedAttachment
  ?attachments.find(row=>row.name===selectedAttachment):null;
 const attachmentCurrent=!selectedAttachment||attached?.text===sourceText;
 // Do not trust a preview if the user has changed any field after inspection.
 const fingerprint=JSON.stringify([need,sourceText,consent,workspaceId,
  selectedAttachment,attachmentCurrent]);
 live.current=fingerprint;
 const selectedHypothesis=snapshot?.bundle.task_hypotheses.find(h=>h.id===picked);
 const sourceEvidence=selectedHypothesis&&snapshot
  ?k03SourceExcerpt(selectedHypothesis,snapshot.bundle.activity_observations||[],snapshot.input.sources)
  :null;
 function invalidate(){generation.current++;setSnapshot(null);setPicked('');setApplied(false);setError('');}
 async function inspect(){
  const hasSource=Boolean(sourceText.trim());
  if(!enabled||busy||(!need.trim()&&!hasSource)||
     (hasSource&&!consent)||!attachmentCurrent)return;
  const stamp=++generation.current,initial=live.current;
  setBusy(true);beginStage('preparing');setError('');setSnapshot(null);setPicked('');setApplied(false);
  try{
   // Need-only intake reuses the owner's existing clarification question.
   // With a document and no formulated goal, search only the source cues.
   const searchNeed=need.trim()||sourceText.trim().slice(0,4000);
   const expectedRevisions:Record<string,string>={};
   const sourceRows:Row[]=[];
   if(hasSource){
    const bytes=new TextEncoder().encode(sourceText);
   if(bytes.length>128000)throw Error('k03_host_source_too_large');
   const digest=await sha256(sourceText);
   const now=new Date(), asOf=now.toISOString().slice(0,10);
   const retention=new Date(now.valueOf()+365*86400000).toISOString().slice(0,10);
   const revision='sha256:'+digest;
   expectedRevisions['doc-1']=revision;
   const source:Row={
    source_id:'doc-1',revision,text:sourceText,epistemic:'reported',
    manifest:{
     schema:'IWXA_ENGINE_UNIVERSAL_EVIDENCE/0.1',
     kind:'PERSONAL_NOTE_UTF8',
     owner_ref:'host-user-provided-source',jurisdiction:'UNDETERMINED',
     as_of:asOf,retention_until:retention,
     purpose:'ENGINE_RESEARCH_AND_TEST',disclosure:'PERSONAL',
     access_basis:'OWNER_AUTHORIZATION_CLAIM',
     authorization_ref:'host-user-explicit-consent',
     permission_asserted:true,authorized_actions:['LOCAL_ANALYSIS'],
     revocation_status:'ACTIVE',sha256:digest,
     source_reference:'host://provided/doc-1',
    },
   };
    sourceRows.push(source);
   }
   const request:Row={mode:'NEED',text:searchNeed,
    expected_revisions:expectedRevisions};
   if(live.current!==initial||generation.current!==stamp)return;
   beginStage('reading');
   const result=await runtime.query<HostBundle>('k03_host_preview',{request,sources:sourceRows});
   if(live.current!==initial||generation.current!==stamp)return;
   if(result.schema!=='IWXA_K03_HOST_DISCOVERY/0.2.0'
      ||result.task_created!==false||result.result_created!==false
      ||result.accepted_task_count!==0||!Array.isArray(result.task_hypotheses)
      ||!['QUALIFICATION_REQUIRED','CLARIFICATION_REQUIRED'].includes(result.route))
     throw Error('k03_host_preview_unverified');
   setSnapshot({input:{request,sources:sourceRows},bundle:result,fingerprint:initial});
  }catch(e){if(generation.current===stamp)setError(issue(e));}
  finally{if(generation.current===stamp){setBusy(false);setStage('idle');}}
 }
 async function choose(){
  if(!enabled||busy||!consent||!snapshot||!picked||!sourceEvidence||
     !attachmentCurrent||expectedResult.trim().length<8)return;
  const stamp=++generation.current,initial=live.current,view=snapshot;
  if(view.fingerprint!==initial){setError('k03_host_input_changed');return;}
  const criteria=criteriaText.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(criteria.length>8||criteria.some(s=>s.length>500)){
   setError(tr('Укажите не более восьми критериев, до 500 символов каждый.',
    'Enter no more than eight criteria, up to 500 characters each.'));return;
  }
  setBusy(true);beginStage('selecting');setError('');
  try{
   const chosen=await runtime.query<HostSelection>('k03_host_select',{
    discovery:view.bundle,hypothesis_id:picked,
    selection_ref:await k03SelectionRef([workspaceId,
     view.input.request.text,view.input.sources.map(s=>[
      s.source_id,s.revision,(s.manifest as Row)?.sha256]),
     picked,expectedResult.trim(),criteria]),
    request:view.input.request,sources:view.input.sources,
   });
   if(live.current!==initial||generation.current!==stamp)return;
   if(chosen.schema!=='IWXA_K03_HOST_SELECTION/0.2.0'
      ||chosen.hypothesis_id!==picked||chosen.task_created!==false
      ||chosen.result_created!==false
      ||chosen.next_owner!=='P01_EXISTING_TASK_QUALIFICATION'
      ||!view.bundle.task_hypotheses.some(h=>h.id===picked
           &&h.status==='PROPOSED_NOT_QUALIFIED_TASK'
           &&h.text===chosen.candidate_text))
     throw Error('k03_host_selection_readback_unverified');
   const wrapped:K03Selection={
    schema:'PA.K03_DISCOVERY_HOST/0.1.0',status:'SELECTED_FOR_USER_DRAFT_ONLY',
    source_kind:'host',source_value:'host://provided/doc-1',
    source_revision:String(view.input.sources[0].revision),
    // Preserve the owner's exact selection (no fabricated case_id).
    selection:chosen as unknown as K03Selection['selection'],
    clarification_requests:view.bundle.clarification_requests||[],task_created:false,
   };
   beginStage('saving');
   await onApplyDraft(wrapped,view.bundle as unknown as K03DiscoveryBinding['bundle'],
                      expectedResult.trim(),view.input,criteria);
   if(live.current===initial&&generation.current===stamp)setApplied(true);
  }catch(e){if(generation.current===stamp)setError(issue(e));}
  finally{if(generation.current===stamp){setBusy(false);setStage('idle');}}
 }
 return <details open className="composer-options" aria-label={tr('Уточнить потребность по своему тексту','Clarify a need from your text')}>
  <summary>{tr('Моя проблема и источник','My problem and source')}</summary>
  <p>{tr('Опишите проблему или вставьте разрешённый документ. Если известна только проблема, Agent задаст уточняющий вопрос. Если есть только документ, K03 ищет подсказки в нём. Задача не создаётся без вашего решения.',
   'Describe a problem or paste an authorized document. With only a problem, Agent asks a clarification question. With only a document, K03 searches it for evidence cues. No Task is created without your decision.')}</p>
  {!enabled&&<p role="status">{tr('Для исследования собственного текста нужна подключённая проверенная версия K03/U1. Обычная задача доступна без неё.',
   'A connected, verified K03/U1 owner is required for text research. Regular Tasks remain available.')}</p>}
  <label>{tr('Что нужно выяснить?','What needs clarification?')}
   <textarea rows={2} value={need} maxLength={4000} disabled={busy}
    placeholder={tr('Необязательно: что хочется выяснить?','Optional: what would you like to clarify?')}
    onChange={e=>{setNeed(e.target.value);invalidate();}}/></label>
  {attachments.length>0&&<label>{tr('Взять текст из уже выбранного документа','Use text from an attached document')}
   <select disabled={busy} value={selectedAttachment} onChange={e=>{
    const name=e.target.value;
    const selected=attachments.find(row=>row.name===name);
    setSelectedAttachment(name);
    if(selected)setSourceText(selected.text);
    invalidate();
   }}>
    <option value="">{tr('Вставить текст самостоятельно','Paste my own text')}</option>
    {attachments.map(row=><option key={row.name} value={row.name}>{row.name}</option>)}
   </select></label>}
  {selectedAttachment&&!attachmentCurrent&&<p role="alert">{tr(
   'Выбранный документ изменился или удалён. Выберите его заново.',
   'The attached document changed or was removed. Select it again.')}</p>}
  <label>{tr('Разрешённый вами текст источника','User-authorized source text')}
   <textarea rows={4} value={sourceText} disabled={busy} onChange={e=>{
    setSelectedAttachment('');setSourceText(e.target.value);invalidate();
   }}/></label>
  {Boolean(sourceText.trim())&&<label><input type="checkbox" checked={consent} disabled={busy}
   onChange={e=>{setConsent(e.target.checked);invalidate();}}/>
   {tr('Подтверждаю разрешение на локальный исследовательский анализ введённого текста.',
    'I confirm permission for local research analysis of the supplied text.')}</label>}
  <button type="button" disabled={!enabled||busy||(!need.trim()&&!sourceText.trim())||
    (Boolean(sourceText.trim())&&!consent)||!attachmentCurrent}
   onClick={()=>void inspect()}>{tr(sourceText.trim()?'Проверить источник и гипотезы':'Уточнить потребность',
    sourceText.trim()?'Inspect source and hypotheses':'Clarify the need')}</button>
  {stage!=='idle'&&<div className="k03-progress" role="status" aria-live="polite">
   <strong>{stage==='preparing'?tr('Подготавливаю источник','Preparing source')
    :stage==='reading'?tr('K03 проверяет основания, модель не запускается','K03 is checking evidence; no model is running')
    :stage==='selecting'?tr('Сверяю выбранное предложение с источником','Checking the selected proposal against the source')
    :tr('Сохраняю редактируемый черновик в Core','Saving editable draft in Core')}</strong>
   <span>{tr('Ожидаем в этом окне: ','Waiting in this window: ')}{elapsed} {tr('с','s')}
    {tr('. Время окончания не известно.','. Completion time is unknown.')}</span>
   {stage!=='saving'&&<button type="button" className="mini-button"
     onClick={stopWaiting}>{tr('Прекратить ожидание','Stop waiting')}</button>}
   {stage==='saving'&&<small>{tr(
    'Сохранение может завершиться даже при потере ответа. Перед повтором проверьте черновик.',
    'The draft may save despite a lost reply. Inspect it before trying again.')}</small>}
  </div>}
  {error&&<p role="alert">{error}</p>}
  {snapshot&&<>
   <p role="status">{tr('Гипотезы из источника не являются принятыми задачами.','Source hypotheses are not accepted Tasks.')}</p>
   {(snapshot.bundle.clarification_requests||[]).map((q,i)=><p key={i}>{q.question}</p>)}
   {snapshot.bundle.task_hypotheses.length===0&&<p role="status">{tr(
    'Пока недостаточно оснований для предложения. Ответьте на уточняющий вопрос, добавьте источник или создайте обычную задачу в основном поле Agent.',
    'Not enough evidence for a specific suggestion yet. Answer the clarification question, add a source, or create a regular Task in the main Agent input.')}</p>}
   {snapshot.bundle.task_hypotheses.length>0&&<>
    <label>{tr('Выберите гипотезу','Choose hypothesis')}
     <select value={picked} disabled={busy} onChange={e=>setPicked(e.target.value)}>
      <option value="">{tr('Не выбрано','Not selected')}</option>
      {snapshot.bundle.task_hypotheses.filter(h=>h.status==='PROPOSED_NOT_QUALIFIED_TASK')
       .map(h=><option key={h.id} value={h.id}>{h.text}</option>)}
     </select></label>
    {picked&&sourceEvidence&&<div className="owner-row" role="status">
     <strong>{tr('Основание из вашего текста','Evidence from your text')}</strong>
     <p>{sourceEvidence.text}</p>
     <small>{sourceEvidence.sourceId} · {sourceEvidence.sourceRevision} · {sourceEvidence.evidenceId}</small>
     <small>{tr('Это фрагмент источника, а не независимое подтверждение задачи.',
      'This is a source excerpt, not independent confirmation of a Task.')}</small>
    </div>}
    {picked&&!sourceEvidence&&<p role="alert">{tr(
     'Не удалось подтвердить исходный фрагмент. Проверьте текст заново.',
     'Could not verify the source excerpt. Reinspect the text.')}</p>}
    <label>{tr('Ожидаемый результат','Expected result')}
     <textarea rows={2} value={expectedResult} disabled={busy}
      onChange={e=>setExpectedResult(e.target.value)}/></label>
    <label>{tr('Как проверить готовность? Один критерий в строке (необязательно)',
     'How will you verify completion? One criterion per line (optional)')}
     <textarea rows={2} value={criteriaText} disabled={busy} maxLength={4007}
      onChange={e=>setCriteriaText(e.target.value)}/></label>
    <button type="button" disabled={!enabled||busy||!picked||!sourceEvidence||!attachmentCurrent||expectedResult.trim().length<8||applied}
     onClick={()=>void choose()}>{tr('Добавить в существующий черновик','Add to existing draft')}</button>
   </>}
   {applied&&<p role="status">{tr('Черновик сохранён. Отправьте задачу отдельно после проверки.','Draft saved. Review it, then submit the Task separately.')}</p>}
  </>}
 </details>;
}
