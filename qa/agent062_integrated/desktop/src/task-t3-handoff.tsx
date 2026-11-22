import React,{useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {acceptedT3HandoffPreview} from './work-handoff';
import {useUiSettings} from './ui-preferences';

type Claim={text?:string;basis?:string};
type Selection={summary:boolean;claims:number[];uncertainties:number[];
 draft_artifacts:number[];evidence_refs:boolean};
type Projection={status:string;task_id:string;result_id:string;text:string;
 exported:boolean;t3_signed:boolean};
type Props={taskId:string;acceptedDigest:string;summary?:string;claims?:Claim[];uncertainties?:string[];
 draftArtifacts?:string[]};
const initial=():Selection=>({summary:true,claims:[],uncertainties:[],draft_artifacts:[],evidence_refs:false});

/** A manual text projection, never a signed .iwxa export or organization approval. */
export function TaskT3Handoff({taskId,acceptedDigest,summary='',claims=[],uncertainties=[],draftArtifacts=[]}:Props){
 const {tr}=useUiSettings();
 const [selection,setSelection]=useState<Selection>(()=>({...initial(),summary:summary.trim().length>0}));
 const [preview,setPreview]=useState<string|null>(null);
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const seq=useRef(0);
 const chosen=selection.summary||selection.claims.length>0||selection.uncertainties.length>0
  ||selection.draft_artifacts.length>0;
 function change(next:Selection){
  // Release the old preview immediately; its late response cannot become current.
  seq.current+=1;setBusy(false);setSelection(next);setPreview(null);setNotice('');setError('');
 }
 function toggle(key:'claims'|'uncertainties'|'draft_artifacts',i:number){
  const current=selection[key];
  const updated=current.includes(i)?current.filter(x=>x!==i):[...current,i].sort((a,b)=>a-b);
  change({...selection,[key]:updated,...(key==='claims'&&updated.length===0?{evidence_refs:false}:{})});
 }
 async function prepare(){
  if(!chosen||busy)return;
  const token=++seq.current;setBusy(true);setPreview(null);setError('');setNotice('');
  try{
   const result=await runtime.query<Projection>('task_t3_result_projection',{
    task_id:taskId,selection,
   });
   if(!acceptedT3HandoffPreview(result,taskId,acceptedDigest))
    throw Error('t3_result_projection_readback_invalid');
   if(token===seq.current)setPreview(result.text);
  }catch(e){
   if(token===seq.current)setError(e instanceof Error?e.message:String(e));
  }finally{if(token===seq.current)setBusy(false);}
 }
 async function copy(){
  if(!preview)return;
  try{
   await navigator.clipboard.writeText(preview);
   setNotice(tr('Текст скопирован. Перенос в организацию ещё не выполнен.',
     'Text copied. Nothing has been transferred to the organization.'));
  }catch{
   setNotice(tr('Копирование недоступно. Выделите текст в поле и скопируйте вручную.',
     'Clipboard unavailable. Select the text and copy it manually.'));
  }
 }
 return <details className="advanced-form">
  <summary>{tr('Подготовить результат для организации','Prepare result for organization')}</summary>
  <p>{tr('Выберите только нужные сведения. Это локальная подготовка текста, а не подписанный файл .iwxa. Передача и приёмка выполняются отдельно в T3 и Admin Center.',
    'Choose only the needed details. This prepares local text, not a signed .iwxa file. Transfer and approval happen separately in T3 and Admin Center.')}</p>
  <label><input type="checkbox" checked={selection.summary}
   disabled={!summary.trim()} onChange={e=>change({...selection,summary:e.target.checked})}/>
   {tr('Краткий результат','Summary')}</label>
  {claims.length>0&&<fieldset><legend>{tr('Выводы','Claims')}</legend>
   {claims.map((c,i)=><label key={i}><input type="checkbox"
    checked={selection.claims.includes(i)} onChange={()=>toggle('claims',i)}/>
    {c.text?.slice(0,180)||tr('Вывод без текста','Claim without text')}
    {c.text&&c.text.length>180?'…':''}</label>)}
   <label><input type="checkbox" checked={selection.evidence_refs}
     disabled={selection.claims.length===0}
     onChange={e=>change({...selection,evidence_refs:e.target.checked})}/>
     {tr('Добавить пути к источникам выбранных выводов','Include source references for selected claims')}</label>
  </fieldset>}
  {uncertainties.length>0&&<fieldset><legend>{tr('Открытые вопросы','Uncertainties')}</legend>
   {uncertainties.map((v,i)=><label key={i}><input type="checkbox"
    checked={selection.uncertainties.includes(i)} onChange={()=>toggle('uncertainties',i)}/>
    {v.slice(0,180)}{v.length>180?'…':''}</label>)}
  </fieldset>}
  {draftArtifacts.length>0&&<fieldset><legend>{tr('Черновики','Drafts')}</legend>
   {draftArtifacts.map((v,i)=><label key={i}><input type="checkbox"
    checked={selection.draft_artifacts.includes(i)} onChange={()=>toggle('draft_artifacts',i)}/>
    {v.slice(0,180)}{v.length>180?'…':''}</label>)}
  </fieldset>}
  <div className="advanced-actions"><button type="button" disabled={busy||!chosen}
   onClick={()=>void prepare()}>{busy?tr('Подготавливаю…','Preparing…'):
      tr('Показать выбранный текст','Show selected text')}</button></div>
  {error&&<p role="alert">{tr('Не удалось прочитать принятый результат: ','Cannot read accepted result: ')}{error}</p>}
  {preview!==null&&<div className="advanced-form">
   <label className="advanced-field">{tr('Текст для ручного переноса','Text for manual transfer')}
    <textarea className="document-content" readOnly value={preview} rows={12}
     style={{width:'100%',whiteSpace:'pre-wrap'}}/>
   </label>
   <div className="advanced-actions"><button type="button" onClick={()=>void copy()}>
    {tr('Скопировать выбранный текст','Copy selected text')}</button></div>
   <p>{tr('В T3 используйте только своё действующее подписанное поручение; текст не создаёт прав и не отправляется автоматически.',
     'Use your existing signed assignment in T3. This text grants no authority and is not sent automatically.')}</p>
  </div>}
  {notice&&<p role="status">{notice}</p>}
 </details>;
}
