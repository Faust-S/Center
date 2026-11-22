import {humanState} from './human-language';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {record,records,str,failure,OwnerDetails,useOwnerActions,type Row} from './owner-ui';
import {HelpTip,useUiSettings} from './ui-preferences';
import {isCompleteDecisionEvidence,presentEvidence} from './evidence-presentation';
import {recoveryObservationLevel} from './recovery-observation';

type Outcome='APPLIED'|'NOT_APPLIED'|'UNKNOWN';
const openStates=new Set(['OPEN_UNKNOWN','EVIDENCE_PENDING','REMAINS_UNKNOWN']);
const readyRetry=(entry:Row)=>entry.contract_state==='RESOLVED_NOT_APPLIED'&&entry.state==='RETRY_ALLOWED';
const verifiedCase=(entry:Row)=>/^REPAIR-[A-Za-z0-9_-]+$/.test(str(entry.case_id));

export function RecoveryControl({initialCaseId,onOpenTask,readbackEpoch=0}:{initialCaseId?:string;onOpenTask:(id:string)=>void;readbackEpoch?:number}){
 const {tr}=useUiSettings();
 const [cases,setCases]=useState<Row[]>([]),[receipts,setReceipts]=useState<Row[]>([]),[error,setError]=useState('');
 const [selectedId,setSelectedId]=useState(initialCaseId||''),[observed,setObserved]=useState<Row|null>(null);
 const [outcome,setOutcome]=useState<Outcome|' '> (' '),[note,setNote]=useState(''),[confirmed,setConfirmed]=useState(false);
 const [busyObservation,setBusyObservation]=useState(false),[observedCase,setObservedCase]=useState('');
 const [loaded,setLoaded]=useState(false),[lastPlan,setLastPlan]=useState<Row|null>(null);
 const caseEpoch=useRef(0),loadEpoch=useRef(0);
 const load=useCallback(async()=>{
  const epoch=++loadEpoch.current;
  caseEpoch.current++;setObserved(null);setObservedCase('');setBusyObservation(false);
  setOutcome(' ');setConfirmed(false);setNote('');setLoaded(false);
  const result=await Promise.allSettled([
   runtime.query<Row>('tool_repair_cases',{limit:100}),
   runtime.query<Row>('tool_execution_receipts',{limit:100}),
  ]);
  if(epoch!==loadEpoch.current)return;
  const faults=result.flatMap((r,i)=>r.status==='rejected'?[(i===0?'tool_repair_cases':'tool_execution_receipts')+': '+failure(r.reason)]:[]);
  const next=result[0].status==='fulfilled'?records(record(result[0].value).cases):[];
  setCases(next);setReceipts(result[1].status==='fulfilled'?records(record(result[1].value).receipts):[]);
  setLoaded(result[0].status==='fulfilled');setError(faults.join(' · '));
 },[]);
 useEffect(()=>{void load();return()=>{loadEpoch.current++;caseEpoch.current++;};},[load,readbackEpoch]);
 useEffect(()=>{
  if(initialCaseId){
   caseEpoch.current++;
   setSelectedId(initialCaseId);
   setObserved(null);setObservedCase('');setBusyObservation(false);setConfirmed(false);setOutcome(' ');
  }
 },[initialCaseId]);
 const {run,busy,message}=useOwnerActions(load);
 const entry=cases.find(c=>str(c.case_id)===selectedId);
 const isOpen=!!entry&&openStates.has(str(entry.contract_state));
 // UNKNOWN is always available after a read-only observation. An affirmative
 // historical claim requires unredacted and untruncated visible evidence.
 const receiptId=str(record(entry?.receipt_ref).ref_id);
 const planId=str(record(entry?.plan_ref).ref_id);
 const observationLevel=observed&&observedCase===selectedId
  ?recoveryObservationLevel(observed,selectedId,planId):'INVALID';
 const observationEvidence=observed&&observedCase===selectedId?presentEvidence(observed):null;
 const evidenceComplete=observationLevel==='READABLE'&&isCompleteDecisionEvidence(observationEvidence);
 const canResolve=loaded&&isOpen&&!!observed&&observedCase===selectedId
  &&observationLevel!=='INVALID'&&(outcome==='UNKNOWN'||evidenceComplete)&&!!note.trim()&&confirmed;
 const latest=receipts.find(x=>x.receipt_id===receiptId);
 function select(id:string){
  // Read-only Core observations can finish after a different case is chosen.
  // Invalidate the old response before changing the selection.
  caseEpoch.current++;
  setSelectedId(id);setObserved(null);setObservedCase('');setBusyObservation(false);
  setOutcome(' ');setNote('');setConfirmed(false);setLastPlan(null);
 }
 async function observe(){
  if(!loaded||!entry||!verifiedCase(entry)||busy||busyObservation)return;
  const requestedCase=selectedId,epoch=++caseEpoch.current;
  setBusyObservation(true);setObserved(null);setObservedCase('');setConfirmed(false);setOutcome(' ');setNote('');setError('');
  try{
   const result=record(await runtime.query<Row>('tool_recovery_file_observation',{case_id:requestedCase}));
   if(epoch!==caseEpoch.current)return;
   setObserved(result);setObservedCase(requestedCase);
  }catch(e){if(epoch===caseEpoch.current)setError(failure(e))}
  finally{if(epoch===caseEpoch.current)setBusyObservation(false)}
 }
 async function decide(){
  if(!entry||!canResolve||outcome===' ')return;
  const result=await run<Row>(tr('Сохранить ваше доказательное решение по результату предыдущего действия? Оно не запустит инструмент повторно.','Record your evidence-based decision about the previous effect? No tool will be invoked again.'),
   'tool_reconcile',{case_id:selectedId,outcome,evidence_note:note.trim()},{kind:'reconciliation_case',id:selectedId});
  if(result){setObserved(null);setConfirmed(false);setNote('');setOutcome(' ');setObservedCase('');}
 }
 async function reprepare(){
  if(!entry||!verifiedCase(entry)||!loaded||!readyRetry(entry))return;
  const result=await run<Row>(tr('Создать новый план после подтверждённого отсутствия прежнего действия? Выполнение потребует отдельного Human Review и ToolRuntime Approval.','Prepare a new plan after the previous action was confirmed NOT APPLIED? Execution will need fresh human approval.'),
   'tool_reprepare',{case_id:selectedId},{kind:'reconciliation_case',id:selectedId});
  if(result){
   setLastPlan(record(result));
   // Navigate only after showing the newly prepared plan ID to the human.
  }
 }
 return <section className="subpage card advanced">
  <div className="advanced-head"><div><h2>{tr('Проверка прежних действий','Review previous actions')} <HelpTip topic="Восстановление"/></h2>
   <p>{tr('Если действие прервалось, сначала проверьте его результат. Пока результат неизвестен, повтор может изменить данные второй раз.','Check the result of an interrupted action before retrying. A second attempt may change data twice.')}</p></div>
   <button className="secondary-button" disabled={busy||busyObservation} onClick={()=>void load()}>{tr('Обновить','Refresh')}</button>
  </div>
  {error&&<p role="alert" className="advanced-error">{error}</p>}{message&&<p role="status" className="advanced-notice">{message}</p>}
  <div className="advanced-form"><h3>{tr('Действия, требующие проверки','Actions requiring review')}</h3>
   <label className="advanced-field">{tr('Случай','Case')}<select value={selectedId} onChange={e=>select(e.target.value)}>
    <option value="">{tr('Выберите действие','Choose an action')}</option>
    {cases.filter(verifiedCase).map(c=><option value={str(c.case_id)} key={str(c.case_id)}>
     {str(c.task_id)||tr('Действие без задачи','Action without task')} · {humanState(c.contract_state,tr('ru','en') as 'ru'|'en')}
    </option>)}
    {selectedId&&!cases.some(c=>c.case_id===selectedId)&&<option value={selectedId}>{tr('Случай больше не виден в последних записях','Case absent from current page')} · {selectedId}</option>}
   </select></label>
   {loaded&&cases.length===0&&<p>{tr('Нет сохранённых случаев восстановления.','No recovery cases recorded.')}</p>}
   {entry&&<>
    <div className="owner-row"><strong>{str(entry.task_id)||tr('Проверяемое действие','Action to review')}</strong><span>{humanState(entry.contract_state,tr('ru','en') as 'ru'|'en')}</span>
     <OwnerDetails title={tr('Связанные записи','Related records')} value={{plan_id:planId,receipt_id:receiptId,case_id:selectedId}}/>
     {Boolean(entry.task_id)&&<button disabled={busy} onClick={()=>onOpenTask(str(entry.task_id))}>{tr('Открыть связанную задачу','Open associated task')}</button>}
    </div>
    {latest&&<OwnerDetails title={tr('Квитанция связанного исполнения','Related execution receipt')} value={latest}/>}
    <OwnerDetails title={tr('Каноническая запись и основания','Canonical case and evidence')} value={entry}/>
   </>}
  </div>
  {entry&&isOpen&&<div className="advanced-form">
   <h3>{tr('Проверка результата','Verify the outcome')}</h3>
   <button disabled={!loaded||busy||busyObservation} onClick={()=>void observe()}>{tr('Проверить фактическое состояние файла','Observe current file state')}</button>
   {observed&&observedCase===selectedId&&<><OwnerDetails title={tr('Наблюдение Core (только чтение)','Read-only Core observation')} value={observed} initiallyOpen/>
    {observationLevel==='INVALID'&&<p role="alert" className="advanced-error">{tr('Это наблюдение не подтверждено для выбранного случая и плана. Обновите данные.','The observation does not match the selected case and plan. Refresh the data.')}</p>}
    {observationLevel==='UNKNOWN_ONLY'&&<p role="status">{tr('Файл не прочитан или рабочая папка изменилась. Доступно только решение о неизвестном исходе.','The file is unavailable or the workspace changed. Only UNKNOWN is available.')}</p>}
    {observationLevel==='READABLE'&&!evidenceComplete&&<p role="alert" className="advanced-error">{tr(
      'Наблюдение содержит скрытые или обрезанные сведения. Достоверный вывод о выполнении или невыполнении заблокирован. Можно сохранить только «Не удалось установить», без повторного запуска.',
      'Some observed evidence is hidden or truncated. An APPLIED or NOT_APPLIED conclusion is blocked. You can record UNKNOWN without retrying execution.'
    )}</p>}
    <p>{tr('После изучения фактического состояния выберите ваш обоснованный вывод. UNKNOWN безопаснее предположения о неисполнении.','Choose an evidence-based conclusion. UNKNOWN is safer than guessing that an effect was not applied.')}</p>
    <label className="advanced-field">{tr('Доказательный вывод','Evidence-based outcome')}<select value={outcome} onChange={e=>{setOutcome(e.target.value as Outcome|' ');setConfirmed(false);}}>
     <option value=" ">{tr('Сначала определите исход','Determine outcome')}</option>
     <option value="APPLIED" disabled={!evidenceComplete}>{tr('Действие выполнено','APPLIED — confirmed applied')}</option>
     <option value="NOT_APPLIED" disabled={!evidenceComplete}>{tr('Действие не выполнено','NOT_APPLIED — confirmed not applied')}</option>
     <option value="UNKNOWN">{tr('Не удалось установить','UNKNOWN — evidence insufficient')}</option>
    </select></label>
    <label className="advanced-field">{tr('Основания (не сохраняйте секреты)','Evidence note (never enter secrets)')}<textarea rows={4} maxLength={4000} value={note} onChange={e=>{setNote(e.target.value);setConfirmed(false);}}/></label>
    <label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/>
     {tr('Я отдельно проверил основания. Моё решение не доказывается одним совпадением текущего файла.','I independently verified the evidence; matching current content alone does not prove historical execution.')}
    </label>
    <button disabled={busy||!canResolve||outcome===' '} onClick={()=>void decide()}>{tr('Сохранить решение человека','Record human resolution')}</button>
   </>}
  </div>}
  {entry&&readyRetry(entry)&&<div className="advanced-form">
   <h3>{tr('Подготовить новое действие','Prepare a new action')}</h3>
   <p>{tr('Core подтверждает, что прежнее действие не применено. Разрешено подготовить новый план, но не выполнить его автоматически.','Core has a recorded NOT_APPLIED resolution. You may prepare a new plan, but it cannot execute automatically.')}</p>
   <button disabled={busy||!loaded} onClick={()=>void reprepare()}>{tr('Подготовить новый план','Prepare fresh plan in ToolRuntime')}</button>
   {lastPlan&&<><OwnerDetails title={tr('Новый план (ещё не одобрен)','Fresh unapproved plan')} value={lastPlan}/>
    <button onClick={()=>onOpenTask(str(entry.task_id))} disabled={!entry.task_id}>{tr('Открыть задачу и принять отдельное решение','Open task for a separate approval')}</button>
   </>}
  </div>}
  {entry&&!isOpen&&!readyRetry(entry)&&<p>{tr('Решение зафиксировано в Core. Повторное выполнение не предлагается.','The resolution is recorded in Core; the UI does not offer a replay.')}</p>}
 </section>;
}
