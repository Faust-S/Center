import React,{useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {record,records,str,failure,OwnerDetails,OwnerError,OwnerMessage,useOwnerActions,type Row} from './owner-ui';
import {HelpTip,useUiSettings} from './ui-preferences';
import {sameVerifiedChatSource} from './dialog-conversation';
import {readKnowledgeSource,compareKnowledgeReads,type KnowledgeRead} from './knowledge-source-observation.mjs';

export type KnowledgeSourceSelection={path:string;expected_sha256:string;title:string;provider_id?:string;binding_digest?:string};
export function KnowledgeMemoryControl({page,onUseSource,selectedSources,allowSelection,onOpenComposer,onOpenVaults,onConfigureKnowledge,onOpenMemory}:{
 page:'Знания'|'Память';
 onUseSource:(source:KnowledgeSourceSelection)=>void;
 selectedSources:KnowledgeSourceSelection[];
 allowSelection:boolean;
 onOpenComposer:()=>void;
 onOpenVaults:()=>void;
 onConfigureKnowledge:()=>void;
 onOpenMemory:()=>void;
}){
 const {tr}=useUiSettings();
 const [workspaces,setWorkspaces]=useState<Row[]>([]),[memories,setMemories]=useState<Row[]>([]),[proposals,setProposals]=useState<Row[]>([]);
 const [error,setError]=useState(''),[query,setQuery]=useState(''),[matches,setMatches]=useState<Row[]>([]),[searchRaw,setSearchRaw]=useState<Row|null>(null);
 const [selected,setSelected]=useState<Row|null>(null),[readback,setReadback]=useState<Row|null>(null);
 const [content,setContent]=useState(''),[memoryType,setMemoryType]=useState('note'),[searchBusy,setSearchBusy]=useState(false);
 const [loaded,setLoaded]=useState(false),[sourceBusy,setSourceBusy]=useState(false);
 const loadSeq=useRef(0),searchSeq=useRef(0),sourceSeq=useRef(0);
 const [sourceObservation,setSourceObservation]=useState<KnowledgeRead|null>(null);
 const [sourceChanged,setSourceChanged]=useState(false);
 // Only one previous metadata observation is retained for this screen.
 // Never keep another note-content cache or send these hints as authority.
 const previousSource=useRef<KnowledgeRead|null>(null);
 const MEMORY_TYPES=[['note','Заметка','Note'],['fact','Факт','Fact'],['preference','Предпочтение','Preference'],['decision','Решение','Decision'],['commitment','Обязательство','Commitment'],['routine','Привычка','Routine'],['relationship','Связь','Relationship'],['project_state','Состояние проекта','Project status']];
 const load=useCallback(async(strict=false)=>{
  const seq=++loadSeq.current;
  setLoaded(false);
  if(page==='Знания'){
   try{
    const response=record(await runtime.query<Row>('knowledge_workspaces',{include_file_count:true}));
    const projection=record(response.workspaces);
    if(!Array.isArray(projection.workspaces))throw Error('knowledge_workspaces_response_invalid');
    if(seq===loadSeq.current){setWorkspaces(records(projection.workspaces));setError('');}
   }catch(error){
    if(seq===loadSeq.current){setWorkspaces([]);setError(failure(error));if(strict)throw error;}
   }finally{if(seq===loadSeq.current)setLoaded(true);}
   return;
  }
  const values=await Promise.allSettled([
   runtime.query<Row>('memory',{limit:100}),runtime.query<Row>('memory_proposals',{limit:100})
  ]);
  if(seq!==loadSeq.current)return;
  setMemories(values[0].status==='fulfilled'?records(record(values[0].value).memories):[]);
  setProposals(values[1].status==='fulfilled'?records(record(values[1].value).proposals):[]);
  const failures=values.flatMap((v,i)=>v.status==='rejected'?[(i===0?'memory':'memory_proposals')+': '+failure(v.reason)]:[]);
  setError(failures.join(' · '));setLoaded(true);
  if(strict&&failures.length)throw Error(failures.join(' · '));
 },[page]);
 useEffect(()=>{
  void load();
  return()=>{loadSeq.current++;searchSeq.current++;sourceSeq.current++;};
 },[load]);
 const {run,busy,message,diagnostic}=useOwnerActions(()=>load(true));
 const knowledgeReady=workspaces.some(w=>w.active===true&&w.status==='connected'&&record(w.health).ready===true);
 // A source selected before a vault/provider change cannot be treated as
 // current merely because its path and bytes stayed the same.
 const verifiedSelection:KnowledgeSourceSelection|null=readback?{
  path:str(readback.path),expected_sha256:str(readback.sha256),
  title:str(selected?.title)||str(readback.path),
  provider_id:str(readback.provider_id),
  binding_digest:str(record(readback.binding_ref).binding_digest)
 }:null;
 const selectionAlreadyAdded=verifiedSelection!==null&&selectedSources.some(
  source=>sameVerifiedChatSource(source,verifiedSelection));
 const selectionHasRoom=verifiedSelection!==null&&(
  selectedSources.length<8||selectedSources.some(source=>source.path===verifiedSelection.path));
 async function search(){
  if(!loaded||!knowledgeReady||!query.trim()||searchBusy||sourceBusy)return;
  const sequence=++searchSeq.current;
  ++sourceSeq.current;
  setSearchBusy(true);setMatches([]);setSearchRaw(null);setSelected(null);setReadback(null);setError('');
  try{
   const result=record(await runtime.query<Row>('knowledge_search',{query:query.trim(),limit:30}));
   if(sequence!==searchSeq.current)return;
   if(!Array.isArray(result.results))throw Error('knowledge_search_response_invalid');
   setSearchRaw(result);setMatches(records(result.results));
  }catch(e){
   if(sequence===searchSeq.current){setMatches([]);setSearchRaw(null);setError(failure(e));}
  }finally{if(sequence===searchSeq.current)setSearchBusy(false);}
 }
 async function openSource(item:Row){
  if(searchBusy||sourceBusy||!knowledgeReady)return;
  const path=str(item.path)||str(item.relative_path),digest=str(item.sha256)||str(item.digest_sha256);
  if(!path||!/^[a-f0-9]{64}$/i.test(digest))return;
  const sequence=++sourceSeq.current;
  setSelected(null);setReadback(null);setSourceObservation(null);setSourceChanged(false);
  setSourceBusy(true);setError('');
  try{
   const provenance=record(item.provenance);
   const providerId=str(provenance.provider_id),bindingDigest=str(provenance.binding_digest);
   if(!providerId||!/^[a-f0-9]{64}$/i.test(bindingDigest))
    throw Error('knowledge_source_binding_missing');
   const verified=await readKnowledgeSource(runtime,{
    path,expected_sha256:digest.toLowerCase(),provider_id:providerId,binding_digest:bindingDigest},
    {isCurrent:()=>sequence===sourceSeq.current});
   if(sequence!==sourceSeq.current)return;
   setSourceChanged(previousSource.current!==null&&
    compareKnowledgeReads(previousSource.current,verified).status==='CHANGED');
   previousSource.current={...verified,source:{}};
   setSourceObservation(verified);setSelected(item);setReadback(verified.source);
  }catch(e){if(sequence===sourceSeq.current)setError(failure(e));}
  finally{if(sequence===sourceSeq.current)setSourceBusy(false);}
 }
 async function proposeFromSource(){
  if(!selected||!readback||!content.trim()||!str(readback.path)||!str(readback.sha256))return;
  const path=str(selected.path)||str(selected.relative_path),digest=str(selected.sha256)||str(selected.digest_sha256);
  const result=await run(tr('Предложить запись в память? Сохранение требует отдельного решения.','Propose the entry? Saving requires separate human approval.'),
   'memory_propose_from_knowledge',{path,expected_sha256:digest,content:content.trim(),memory_type:memoryType,classification:'personal',tags:[],
    provider_id:str(readback.provider_id),binding_digest:str(record(readback.binding_ref).binding_digest)});
  if(result)setContent('');
 }
 return <section className="subpage card advanced">
  <div className="advanced-head"><div><h2>{page==='Знания'?tr('Знания и Obsidian','Knowledge and Obsidian'):tr('Память и решения','Memory and decisions')} <HelpTip topic={page}/></h2>
  <p>{page==='Знания'?tr('Найдите нужную заметку, проверьте её содержимое и добавьте источник к задаче. Файлы остаются в своей папке.','Find a note, verify its contents and add it to a task. Files stay in their original folder.'):tr('Предложите запись, проверьте ожидающие решения и сохраните только то, что действительно нужно.','Propose an entry, review pending decisions and keep only what is needed.')}</p></div>
  <button className="secondary-button" disabled={busy||searchBusy||sourceBusy} onClick={()=>void load()}>{tr('Обновить','Refresh')}</button></div>
  {error&&<OwnerError error={error}/>}{message&&<OwnerMessage diagnostic={diagnostic}>{message}</OwnerMessage>}
  {page==='Знания'&&<>
  <div className="advanced-form"><h3>{tr('Доступные рабочие пространства','Available workspaces')}</h3>
   <p>{knowledgeReady?tr('Активный источник знаний доступен для проверенного чтения.','Active knowledge source is available for verified reads.'):tr('Сейчас нет подтверждённого доступного источника. Можно подключить найденный Obsidian vault без переноса заметок либо настроить провайдера вручную.','No verified knowledge source is available. Adopt a discovered Obsidian vault in place or configure a provider manually.')}</p>
    <div className="advanced-actions"><button type="button" disabled={busy} onClick={onOpenVaults}>{tr('Подключить Obsidian','Connect Obsidian')}</button>
     <button type="button" disabled={busy} onClick={onConfigureKnowledge}>{tr('Настроить подключение','Configure provider')}</button></div>
   <p>{tr('Проверенных источников в следующей задаче:','Verified sources for next task:')} {selectedSources.length}/8.</p>
   {!loaded?<p role="status">{tr('Проверяем подключение заметок...','Checking note connections...')}</p>:workspaces.length?workspaces.map((w,i)=><div className="owner-row" key={str(w.id)||str(w.workspace_id)||i}><strong>{str(w.name)||str(w.workspace_id)||tr('Рабочее пространство','Workspace')}</strong><span>{w.active===true&&record(w.health).ready===true?tr('Подключено. Можно искать заметки.','Connected. Notes can be searched.'):tr('Сейчас недоступно. Проверьте подключение.','Unavailable. Check the connection.')}</span></div>):<p>{tr('Нет доступных рабочих пространств. Подключите Obsidian или другой источник знаний.','No workspaces are available. Connect Obsidian or another knowledge source.')}</p>}
  </div>
  <div className="advanced-form"><h3>{tr('Найти и проверить источник','Search and verify a source')}</h3>
   <label className="advanced-field">{tr('Запрос','Search query')}<input value={query} onChange={e=>setQuery(e.target.value)}/></label>
   <button disabled={busy||searchBusy||sourceBusy||!loaded||!query.trim()||!knowledgeReady} onClick={()=>void search()}>{tr('Искать','Search')}</button>
   {searchBusy&&<p role="status">{tr('Ищем заметки...','Searching notes...')}</p>}
   {matches.map((item,i)=>{
    const path=str(item.path)||str(item.relative_path),digest=str(item.sha256)||str(item.digest_sha256);
    return <div className="owner-row" key={path+':'+i}><strong>{str(item.title)||path||tr('Источник','Source')}</strong>
     <small>{str(item.excerpt)||str(item.snippet)||''}</small>
     <button disabled={busy||searchBusy||sourceBusy||!path||!/^[a-f0-9]{64}$/i.test(digest)} onClick={()=>void openSource(item)}>{tr('Открыть проверенный источник','Open verified source')}</button>
     </div>;
   })}
   {sourceBusy&&<p role="status">{tr('Проверяем содержимое заметки...','Verifying note content...')}</p>}
   {searchRaw&&matches.length===0&&<><p role="status">{tr('По этому запросу заметки не найдены. Попробуйте другое слово или проверьте подключённое хранилище.','No notes matched this search. Try another word or check the connected vault.')}</p></>}
   {readback&&<><h3>{tr('Проверенный источник','Verified source')}</h3>
    {sourceChanged&&<p role="status">{tr('Содержимое изменилось с прошлого просмотра. Показана заново проверенная редакция.',
     'The source changed since its previous view. This is the newly verified revision.')}</p>}
    {sourceObservation&&<OwnerDetails title={tr('Связь с источником и редакцией','Source identity and revision')}
     value={{pin:sourceObservation.pin,provenance:sourceObservation.observation.provenance,
      bytes:sourceObservation.observation.bytes,authority:'OBSERVATION_ONLY'}}/>}
    <pre className="document-content">{str(readback.content)}</pre> 
    <div className="advanced-actions">
     <button disabled={busy||!allowSelection||!selectionHasRoom||selectionAlreadyAdded}
       onClick={()=>{if(verifiedSelection)onUseSource(verifiedSelection)}}>
       {selectionAlreadyAdded?tr('Уже добавлено в задачу','Already added to task'):tr('Добавить в задачу','Add to task')}
     </button>
     <button disabled={!selectedSources.length} onClick={onOpenComposer}>{tr('К задаче с источниками','Continue to task')}</button>
    </div>
    <details className="owner-details"><summary>{tr('Предложить запись в память','Propose a memory entry')}</summary>
     <p>{tr('Сохранение записи потребует отдельного решения человека.','Saving the entry requires separate human approval.')}</p>
     <label className="advanced-field">{tr('Что сохранить','What to remember')}<textarea rows={4} value={content} onChange={e=>setContent(e.target.value)}/></label>
     <label className="advanced-field">{tr('Тип записи','Entry type')}<select value={memoryType} onChange={e=>setMemoryType(e.target.value)}>
      {MEMORY_TYPES.map(([id,ru,en])=><option value={id} key={id}>{tr(ru,en)}</option>)}
     </select></label>
     <div className="advanced-actions">
      <button disabled={busy||!content.trim()} onClick={()=>void proposeFromSource()}>{tr('Отправить на проверку','Submit for review')}</button>
      <button className="secondary-button" onClick={onOpenMemory}>{tr('Открыть решения по памяти','Open memory reviews')}</button>
     </div>
    </details>
    <p>{allowSelection?tr('Выбранные заметки передаются как проверенные источники только в следующую задачу.','Selected notes are sent as verified context only with your next task.'):tr('Сначала удалите вложенные локальные файлы задачи: их анализ не допускает дополнительных источников.','Remove local document attachments first; their analysis cannot include other sources.')}</p>
   </>}
  </div>
  </>}
  {page==='Память'&&<>
  <div className="advanced-form"><h3>{tr('Сохранённая память','Saved memory')}</h3>
   {memories.map((item,i)=><div className="owner-row" key={str(item.memory_id)||i}><strong>{str(item.content)||tr('Запись без текста','Entry without visible content')}</strong><small>{item.status==='ACTIVE'?tr('Сохранена','Saved'):tr('Неактивна','Inactive')}</small><OwnerDetails value={item}/></div>)}
   {loaded&&memories.length===0&&<p>{tr('Сохранённых записей пока нет.','No saved entries yet.')}</p>}
   <label className="advanced-field">{tr('Новая запись памяти','New memory proposal')}<textarea rows={3} value={content} onChange={e=>setContent(e.target.value)}/></label>
   <label className="advanced-field">{tr('Тип записи','Entry type')}<select value={memoryType} onChange={e=>setMemoryType(e.target.value)}>{MEMORY_TYPES.map(([id,ru,en])=><option value={id} key={id}>{tr(ru,en)}</option>)}</select></label>
   <button disabled={busy||!content.trim()} onClick={()=>void run(tr('Создать предложение памяти с отдельным человеческим принятием?','Create a proposal requiring separate human acceptance?'),
    'memory_propose',{operation:'CREATE',memory_type:memoryType,content:content.trim(),classification:'personal',tags:[]})}>{tr('Предложить запись','Propose entry')}</button>
  </div>
  <div className="advanced-form"><h3>{tr('Предложения, ожидающие решения','Proposals awaiting decision')}</h3>
   {proposals.filter(p=>!p.decision).map((p,i)=>{
    const id=str(p.proposal_id),state=str(p.decision)||'PENDING',canReview=!!id&&!p.decision;
    return <div className="owner-row" key={id||i}><strong>{str(p.content_preview)||tr('Предложение','Proposal')}</strong><span>{state==='PENDING'?tr('Ожидает решения','Awaiting review'):state==='APPROVE'?tr('Принято','Accepted'):tr('Отклонено','Rejected')}</span>
     <OwnerDetails value={p}/>{canReview&&<div className="advanced-actions">
     <button disabled={busy||!canReview} onClick={()=>void run(tr('Принять предложение памяти '+id+'?','Admit memory proposal '+id+'?'),'memory_review',{proposal_id:id,decision:'APPROVE'},{kind:'memory_proposal',id})}>{tr('Принять','Admit')}</button>
     <button disabled={busy||!canReview} onClick={()=>void run(tr('Отклонить предложение '+id+'?','Reject proposal '+id+'?'),'memory_review',{proposal_id:id,decision:'REJECT'},{kind:'memory_proposal',id})}>{tr('Отклонить','Reject')}</button></div>}
    </div>;
   })}
   {loaded&&!proposals.some(p=>!p.decision)&&<p>{tr('Новых предложений нет.','There are no new proposals.')}</p>}
   {proposals.some(p=>!!p.decision)&&<details className="owner-details">
    <summary>{tr('Ранее рассмотренные предложения','Previously reviewed proposals')}</summary>
    {proposals.filter(p=>!!p.decision).map((p,i)=><div className="owner-row" key={str(p.proposal_id)||i}>
     <strong>{str(p.content_preview)||tr('Предложение','Proposal')}</strong>
     <span>{p.decision==='APPROVE'?tr('Принято','Accepted'):tr('Отклонено','Rejected')}</span>
     <OwnerDetails value={p}/>
    </div>)}
   </details>}
  </div>
  </>}
 </section>;
}
