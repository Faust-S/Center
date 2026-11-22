import React,{useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {record,records,str,OwnerError,type Row} from './owner-ui';
import {useUiSettings} from './ui-preferences';
import {programResultMatchesTask} from './program-result-readback';

/** Task-scoped view of the existing ToolRuntime. No local plan, approval or
 * execution authority is created; every state comes from Python Core. */
type Props={
 taskId:string;acceptedDigest?:string;fresh:boolean;focusPlanId?:string;focusRequest?:number;
 onRefreshTask:()=>Promise<void>;onDocumentReview:()=>void;
 onOpenRecovery:()=>void;onOpenAutomations:()=>void;
};
const planId=(p:Row)=>str(p.plan_id);
const approvalPlanId=(a:Row)=>str(a.plan_id)||str(record(a.plan_ref).ref_id);
const future=(date:unknown)=>{const time=Date.parse(str(date));return Number.isFinite(time)&&time>Date.now();};
const approved=(a:Row)=>a.decision==='approve'&&a.state==='APPROVED'&&a.active===true
 &&a.binding_valid!==false&&future(a.expires_at);
const validPlan=(p:Row,taskId:string,digest:string)=>/^TPLAN-[A-Za-z0-9_-]{1,100}$/.test(planId(p))
 &&str(record(p.task_ref).ref_id)===taskId
 &&str(record(p.accepted_artifact_ref).digest_sha256)===digest
 &&!!str(p.operation)&&!!str(p.target)&&!!str(p.tool_id)
 &&!!str(record(p.candidate_ref).ref_id)
 &&p.arguments!==null&&typeof p.arguments==='object'&&!Array.isArray(p.arguments);
const stateText=(value:string,tr:(ru:string,en:string)=>string)=>{
 switch(value){
  case 'NOT_STARTED':return tr('Ожидает решения','Awaiting a decision');
  case 'SUCCEEDED':return tr('Исполнение сохранено','Execution recorded');
  case 'OUTCOME_UNKNOWN':return tr('Исход неизвестен - требуется проверка','Outcome unknown - review required');
  case 'ATTEMPTED':return tr('Попытка сохранена - проверьте результат','Attempt recorded - check result');
  default:return tr('Состояние требует проверки','State needs review');
 }
};
const actionTitle=(p:Row,tr:(ru:string,en:string)=>string)=>{
 if(p.tool_id==='files.write_text')return tr('Изменение документа','Change a document');
 if(p.tool_id==='n8n.workflow')return tr('Запуск процесса','Run a workflow');
 if(p.tool_id==='program.invoke')return tr('Запуск программы','Run a program');
 return tr('Предложенное действие','Proposed action');
};

export function TaskActionsPanel({taskId,acceptedDigest,fresh,focusPlanId,focusRequest=0,onRefreshTask,
 onDocumentReview,onOpenRecovery,onOpenAutomations}:Props){
 const {tr}=useUiSettings();
 const [snapshot,setSnapshot]=useState<Row|null>(null);
 const [selected,setSelected]=useState('');
 const [confirmed,setConfirmed]=useState(false);
 const [proof,setProof]=useState<Row|null>(null);
 const [programOutput,setProgramOutput]=useState<{planId:string;receiptId:string;text:string}|null>(null);
 const [outputPage,setOutputPage]=useState(0),[readingOutput,setReadingOutput]=useState(false);
 const [error,setError]=useState<unknown>(null),[notice,setNotice]=useState('');
 const [readError,setReadError]=useState<unknown>(null);
 const [loading,setLoading]=useState(false),[acting,setActing]=useState(false);
 const [recoveryCase,setRecoveryCase]=useState('');
 const sequence=useRef(0),inFlight=useRef(false),attempted=useRef(new Set<string>()),focused=useRef('');
 const outputToken=useRef(0);
 const readScoped=useCallback(async()=>{
  const data=record(await runtime.query<Row>('tool_plans',{task_id:taskId}));
  if(str(data.task_id)!==taskId||data.read_only!==true
   ||!Array.isArray(data.plans)||!Array.isArray(data.approvals)
   ||records(data.plans).some(p=>str(record(p.task_ref).ref_id)!==taskId))
   throw Error('task_tool_plans_readback_mismatch');
  return data;
 },[taskId]);
 const load=useCallback(async()=>{
  const id=++sequence.current;
  outputToken.current++;setProgramOutput(null);setReadingOutput(false);setOutputPage(0);
  setLoading(true);setError(null);setReadError(null);
  try{
   const next=await readScoped();
   if(id!==sequence.current)return;
   setSnapshot(next);
   const all=records(next.plans);
   setSelected(current=>all.some(p=>planId(p)===current)?current:planId(all[0]||{}));
  }catch(e){
   if(id===sequence.current){setSnapshot(null);setError(e);}
  }finally{if(id===sequence.current)setLoading(false);}
 },[readScoped]);
 useEffect(()=>{setSnapshot(null);setSelected('');setConfirmed(false);setProof(null);
  attempted.current.clear();focused.current='';setRecoveryCase('');setNotice('');
  void load();return()=>{sequence.current+=1;outputToken.current+=1;};
 },[taskId,load]);
 useEffect(()=>{outputToken.current++;setProgramOutput(null);setReadingOutput(false);setOutputPage(0);
  setReadError(null);},[taskId,selected]);
 const plans=records(snapshot?.plans),approvals=records(snapshot?.approvals),states=record(snapshot?.execution_by_plan);
 useEffect(()=>{
  const request=focusPlanId+':'+focusRequest;
  if(focusPlanId&&snapshot&&!plans.some(p=>planId(p)===focusPlanId)){
   setSelected('');setConfirmed(false);setProof(null);
  }else if(focusPlanId&&request!==focused.current&&plans.some(p=>planId(p)===focusPlanId)){
   setSelected(focusPlanId);focused.current=request;setConfirmed(false);setProof(null);setNotice('');
  }
 },[focusPlanId,focusRequest,plans,snapshot]);
 const chosen=plans.find(p=>planId(p)===selected);
 const state=record(states[selected]),currentState=str(state.state),receiptId=str(state.receipt_id);
 const decisions=approvals.filter(a=>approvalPlanId(a)===selected);
 const activeApproval=decisions.find(approved);
 const rejected=decisions.some(a=>a.decision==='reject'||a.state==='REJECTED');
 const expired=!future(chosen?.expires_at);
 const valid=!!chosen&&validPlan(chosen,taskId,str(acceptedDigest));
 const isFile=chosen?.tool_id==='files.write_text';
 const hasArgs=!!chosen&&JSON.stringify(chosen.arguments||{}).length<=64000;
 const canDecide=!!snapshot&&!loading&&!acting&&!error&&fresh&&valid&&!expired
  &&currentState==='NOT_STARTED'&&!rejected&&!activeApproval&&!isFile&&hasArgs;
 const canExecute=!!snapshot&&!loading&&!acting&&!error&&fresh&&valid&&!expired
  &&currentState==='NOT_STARTED'&&!rejected&&!!activeApproval&&!isFile&&hasArgs&&!attempted.current.has(selected);

 async function verifiedCurrent(p:Row){
  const source=record(await runtime.query<Row>('task',{task_id:taskId}));
  if(str(source.task_id)!==taskId||source.status!=='closed'
   ||!acceptedDigest||str(source.accepted_artifact_digest)!==acceptedDigest)
   throw Error('task_action_source_changed');
  const scoped=await readScoped();
  const freshPlan=records(scoped.plans).find(x=>planId(x)===planId(p));
  if(!freshPlan||!validPlan(freshPlan,taskId,acceptedDigest)
    ||str(freshPlan.plan_digest)!==str(p.plan_digest))throw Error('task_action_plan_changed');
  return {data:scoped,plan:freshPlan,view:record(record(scoped.execution_by_plan)[planId(p)]),
   approvals:records(scoped.approvals).filter(x=>approvalPlanId(x)===planId(p))};
 }
 async function proofFor(plan:Row,receipt:string,includeOutput=false){
  const result=record(await runtime.query<Row>('tool_execution_receipt',{receipt_id:receipt}));
  if(result.task_id!==taskId||result.plan_id!==planId(plan)||result.tool_id!==plan.tool_id
   ||str(record(result.receipt).receipt_id)!==receipt)throw Error('task_action_receipt_link_changed');
  if(plan.tool_id!=='program.invoke')return result;
  const savedReceipt=record(result.receipt);
  if(savedReceipt.status!=='SUCCEEDED'||savedReceipt.external_effect_state!=='ACKNOWLEDGED')
   return {...result,program_output_state:'NOT_APPLICABLE'};
  // A ToolRuntime receipt proves the external effect, not the durability of
  // the program's output. Ask the existing U01 owner for an exact readback;
  // never execute or reconnect the program to obtain missing output.
  let verified=false,savedOutput:unknown;
  try{
   const output=includeOutput
    ?await runtime.query<Row>('public_program_result',{receipt_id:receipt})
    :await runtime.query<Row>('public_program_result',{receipt_id:receipt,metadata_only:true});
   verified=programResultMatchesTask(output,taskId,receipt,str(savedReceipt.output_digest));
   if(includeOutput&&verified)savedOutput=record(output.data).output;
  }catch{
   // Missing or unverified output must never become a successful Task Result.
  }
  return {...result,program_output_state:verified?'VERIFIED':'UNAVAILABLE',
   ...(includeOutput&&verified&&typeof savedOutput==='string'?{saved_output:savedOutput}:{})};
 }
 async function readProgramOutput(){
  if(!chosen||chosen.tool_id!=='program.invoke'||!receiptId||loading||acting||readingOutput)return;
  const token=++outputToken.current;
  setReadingOutput(true);setProgramOutput(null);setOutputPage(0);setReadError(null);setNotice('');
  try{
   // This read-only request verifies the receipt and saved output. It never
   // reconnects, approves or invokes the external CLI.
   const result=await proofFor(chosen,receiptId,true);
   if(token!==outputToken.current)return;
   const {saved_output,...attestation}=result;
   setProof(attestation);
   if(result.program_output_state!=='VERIFIED'||typeof saved_output!=='string')
    throw Error('u01_output_unavailable');
   setProgramOutput({planId:planId(chosen),receiptId,text:saved_output});
  }catch(e){if(token===outputToken.current){setProgramOutput(null);setReadError(e);}}
  finally{if(token===outputToken.current)setReadingOutput(false);}
 }
 async function inspectReceipt(){
  if(!chosen||!receiptId||loading||acting||readingOutput)return;
  const token=++outputToken.current;
  setReadError(null);setNotice('');setProgramOutput(null);setOutputPage(0);
  try{
   const result=await proofFor(chosen,receiptId);
   if(token!==outputToken.current)return;
   setProof(result);
   setNotice(tr('Квитанция прочитана из сохранённой истории.','Receipt read from saved history.'));
  }catch(e){if(token===outputToken.current){setProof(null);setReadError(e);}}
 }
 async function act(choice:'approve'|'reject'|'execute'|'recover'){
  if(!chosen||inFlight.current||!fresh||!snapshot||loading||acting||error)return;
  if(choice==='execute'&&(!canExecute||!confirmed))return;
  if(choice==='approve'&&(!canDecide||!confirmed))return;
  if(choice==='reject'&&!canDecide)return;
  if(choice==='recover'&&currentState!=='OUTCOME_UNKNOWN')return;
  const ask=choice==='approve'?tr('Разрешить точное действие без исполнения?','Approve the exact action without executing it?')
   :choice==='reject'?tr('Отклонить этот план? Его нельзя будет выполнить.','Reject this plan? It will not be executable.')
   :choice==='execute'?tr('Выполнить разрешённое действие один раз? При потере ответа повтор запрещён до сверки.',
      'Execute the approved action once? If the response is lost, do not retry before checking.')
   :tr('Прочитать прерванное действие без повторного исполнения?','Read the interrupted action without rerunning it?');
  if(!window.confirm(ask))return;
  inFlight.current=true;outputToken.current++;setReadingOutput(false);setProgramOutput(null);
  setActing(true);setError(null);setReadError(null);setNotice('');setProof(null);setRecoveryCase('');
  const p=chosen,id=planId(p);let dispatched=false;
  if(choice==='execute')attempted.current.add(id);
  try{
   const before=await verifiedCurrent(p),s=str(before.view.state);
   if(choice==='recover'){
    if(s!=='OUTCOME_UNKNOWN')throw Error('task_action_outcome_changed');
   }else if(s!=='NOT_STARTED'||!future(p.expires_at))throw Error('task_action_state_changed');
   const otherApproved=before.approvals.find(approved);
   if(choice==='execute'){
    if(!otherApproved||str(otherApproved.approval_id)!==str(activeApproval?.approval_id)
       ||before.approvals.some(a=>a.decision==='reject'||a.state==='REJECTED'))
     throw Error('task_action_approval_changed');
    if(p.tool_id==='n8n.workflow'){
     // A delayed approved_action must not silently compete with a manual run.
     const jobs=record(await runtime.query<Row>('automation_jobs',{limit:500}));
     const existing=records(jobs.jobs);
     if(existing.length>=500)throw Error('task_action_schedule_history_limited');
     if(existing.some(j=>j.job_kind==='approved_action'&&
        str(record(j.payload).plan_id)===id&&j.state!=='CANCELLED'))
       throw Error('task_action_already_scheduled');
    }
   }else if(choice!=='recover'&&(otherApproved||before.approvals.some(a=>a.decision==='reject'||a.state==='REJECTED')))
    throw Error('task_action_decision_changed');
   let command='',input:Row={},target:{kind:string;id:string}={kind:'tool_plan',id};
   if(choice==='recover'){command='tool_recover_interrupted';input={plan_id:id};}
   else if(choice==='execute'){command='tool_execute';input={plan_id:id,approval_id:str(otherApproved?.approval_id)};}
   else{command='tool_approve';input={plan_id:id,decision:choice};}
   await runtime.refreshRevision();dispatched=true;
   const ack=record(await runtime.command<Row>(command,input,target));
   const after=await verifiedCurrent(p);
   const finalState=str(after.view.state),afterApprovals=after.approvals;
   if(choice==='approve'||choice==='reject'){
    const matching=afterApprovals.find(a=>str(a.approval_id)===str(ack.approval_id)
     &&a.decision===choice&&(choice==='reject'?a.state==='REJECTED':approved(a)));
    if(!matching)throw Error('task_action_decision_readback_unverified');
    setNotice(choice==='approve'?tr('Разрешение сохранено. Для исполнения потребуется отдельное действие.',
      'Approval saved. Execution requires a separate action.'):tr('Отклонение сохранено. Действие не выполнено.',
      'Rejection recorded. No action was executed.'));
   }else if(choice==='execute'){
    const savedId=str(after.view.receipt_id);
    if(finalState==='SUCCEEDED'&&savedId){
     const result=await proofFor(p,savedId),receipt=record(result.receipt),ackReceipt=record(ack.receipt);
     if(receipt.status!=='SUCCEEDED'||receipt.external_effect_state!=='ACKNOWLEDGED'
        ||(ackReceipt.receipt_id&&ackReceipt.receipt_id!==savedId))
      throw Error('task_action_receipt_unverified');
     setProof(result);
     if(p.tool_id==='program.invoke'){
      setNotice(str(result.program_output_state)==='VERIFIED'
       ?tr('Программа выполнена. Квитанция и сохранённый вывод проверены.',
          'Program executed. Receipt and saved output were verified.')
       :tr('Выполнение программы подтверждено квитанцией, но сохранённый вывод недоступен. Не запускайте её повторно.',
          'Program execution was acknowledged, but the saved output is unavailable. Do not rerun it.'));
     }else{
      setNotice(tr('Действие выполнено. Сохранённая квитанция подтверждена.',
       'Action completed. Its saved receipt was verified.'));
     }
    }else{
     setNotice(tr('Попытка сохранена, но успешное завершение не подтверждено. Повтор запрещён до проверки.',
       'An attempt was recorded, but completion is unverified. Do not retry until the outcome is checked.'));
    }
   }else{
    const caseId=str(ack.repair_case_id)||str(record(ack.repair_case).case_id);
    setRecoveryCase(caseId);
    setNotice(tr('Состояние прерванного действия прочитано. Исполнение не повторялось.',
      'Interrupted action state inspected. No execution was repeated.'));
   }
   setSnapshot(after.data);setConfirmed(false);
   await onRefreshTask();
  }catch(e){
   setError(e);
   setNotice(dispatched?tr('Исход действия требует сверки. Обновите состояние, прежде чем принимать новое решение.',
      'The outcome requires verification. Refresh before deciding again.'):
     tr('Состояние изменилось. Обновите сведения задачи.',
      'State changed. Refresh task details.'));
   // The new state is read-only. No command replay after an uncertain result.
   try{setSnapshot(await readScoped());}catch{setSnapshot(null);}
  }finally{inFlight.current=false;setActing(false);}
 }
 if(!fresh)return <p role="alert">{tr('Текущее состояние задачи не подтверждено. Обновите её перед действиями.',
   'The task state is unverified. Refresh it before taking action.')}</p>;
 return <section className="advanced-form" aria-label={tr('Планы действий по задаче','Task action plans')}>
  <div className="advanced-head"><div><h3>{tr('Планы и результаты действий','Action plans and outcomes')}</h3>
   <p>{tr('Каждое действие требует отдельного решения. Выполнение подтверждается сохранённой квитанцией.',
      'Each action requires a separate decision. Saved receipts confirm execution.')}</p></div>
   <button type="button" className="secondary-button" disabled={loading||acting} onClick={()=>void load()}>
    {tr('Обновить','Refresh')}</button></div>
  {loading&&<p role="status">{tr('Читаю сохранённые планы…','Reading saved plans…')}</p>}
  {Boolean(error)&&<OwnerError error={error}/>}
  {Boolean(readError)&&<OwnerError error={readError}/>}
  {notice&&<p role="status">{notice}</p>}
  {!loading&&!error&&plans.length===0&&<p>{tr('Подготовленных действий пока нет. Примите результат задачи, затем подготовьте подходящее предложение.',
    'No prepared actions yet. Accept the Task result, then prepare a proposed action.')}</p>}
  {snapshot&&focusPlanId&&!plans.some(p=>planId(p)===focusPlanId)&&<p role="alert">{tr('Выбранный план не найден в этой задаче. Обновите сведения задачи.',
    'The selected plan was not found in this task. Refresh task details.')}</p>}
  {plans.length>0&&<label className="advanced-field">{tr('Действие для проверки','Action to review')}
   <select value={selected} disabled={acting} onChange={e=>{setSelected(e.target.value);setConfirmed(false);setProof(null);setNotice('');setError(null);}}>
    {!selected&&<option value="">{tr('Выберите план','Select a plan')}</option>}
    {plans.map((p,i)=><option key={planId(p)} value={planId(p)}>
     {actionTitle(p,tr)} {i+1} - {str(p.target).slice(0,90)}</option>)}
   </select></label>}
  {chosen&&<div className="owner-row">
   <strong>{actionTitle(chosen,tr)} - {str(chosen.target)}</strong>
   <span>{stateText(currentState,tr)}{expired?' · '+tr('срок плана истёк','plan expired'):''}</span>
   {!valid&&<p role="alert">{tr('Связь плана с принятым результатом больше не подтверждается. Исполнение недоступно.',
     'The plan is no longer verified against the accepted result. Execution is unavailable.')}</p>}
   {isFile?<div className="advanced-actions">
    <p>{tr('Изменение файла выполняется в документном сценарии с проверкой полного текста и текущей версии.',
      'File changes use document review, including full text and the current file version.')}</p>
    <button type="button" onClick={onDocumentReview}>{tr('Открыть проверку документа','Review document')}</button>
   </div>:<>
    <p>{tr('Предложение:','Proposed action:')} {str(chosen.operation)} · {str(chosen.target)}</p>
    <details><summary>{tr('Точные параметры и адрес действия','Exact operation arguments and destination')}</summary>
     {hasArgs?<pre className="document-content">{JSON.stringify(chosen.arguments,null,2)}</pre>:
      <p role="alert">{tr('Параметры слишком велики для просмотра здесь. Для разрешения откройте расширенное согласование.',
        'Arguments are too large to inspect here. Open the full review before approving.')}</p>}
    </details>
    {!hasArgs&&<button type="button" onClick={onOpenAutomations}>{tr('Открыть сведения о процессах','Open workflow details')}</button>}
    {decisions.length>0&&<p>{rejected?tr('Этот план отклонён.','This plan was rejected.'):
     activeApproval?tr('Разрешение действительно. Для исполнения нужно отдельное подтверждение.',
       'Approval is valid. Execution needs separate confirmation.'):
     tr('Ранее принятое решение больше не разрешает исполнение.','An earlier decision no longer authorizes execution.')}</p>}
    {(canDecide||canExecute)&&<label><input type="checkbox" checked={confirmed} disabled={acting}
     onChange={e=>setConfirmed(e.target.checked)}/>
     {tr('Я проверил точные параметры, адрес и последствия этого действия.',
       'I reviewed the exact arguments, destination and consequences.')}</label>}
    {canDecide&&<div className="advanced-actions">
     <button type="button" disabled={!confirmed} onClick={()=>void act('approve')}>{tr('Разрешить без исполнения','Approve without execution')}</button>
     <button type="button" onClick={()=>void act('reject')}>{tr('Отклонить план','Reject plan')}</button>
    </div>}
    {canExecute&&<button className="primary-button" type="button" disabled={!confirmed}
     onClick={()=>void act('execute')}>{tr('Выполнить один раз','Execute once')}</button>}
   </>}
   {attempted.current.has(selected)&&<p role="alert">{tr('Запуск уже запрашивался в этом сеансе. Сверьте квитанцию перед новым действием.',
     'An execution was already requested in this session. Check the receipt before any further action.')}</p>}
   {currentState==='OUTCOME_UNKNOWN'&&<div>
    <p role="alert">{tr('Возможны последствия незавершённого действия. Повтор запрещён.',
      'The interrupted action may have had effects. Re-execution is blocked.')}</p>
    <button type="button" disabled={acting||loading} onClick={()=>void act('recover')}>
     {tr('Проверить прерванное действие','Inspect interrupted action')}</button>
    <button type="button" onClick={onOpenRecovery}>{tr('Открыть восстановление','Open recovery')}</button>
   </div>}
   {recoveryCase&&<button type="button" onClick={onOpenRecovery}>{tr('Проверить восстановление','Review recovery')}</button>}
   {receiptId&&<button type="button" disabled={acting||loading||readingOutput} onClick={()=>void inspectReceipt()}>
    {tr('Прочитать квитанцию исполнения','Read execution receipt')}</button>}
   {chosen.tool_id==='program.invoke'&&receiptId&&currentState==='SUCCEEDED'&&<button type="button"
    disabled={acting||loading||readingOutput} onClick={()=>void readProgramOutput()}>
    {readingOutput?tr('Читаю сохранённый вывод…','Reading saved output…'):
     tr('Прочитать вывод программы','Read program output')}</button>}
   {programOutput&&programOutput.planId===selected&&programOutput.receiptId===receiptId&&
    chosen.tool_id==='program.invoke'&&<div className="owner-row">
     <strong>{tr('Сохранённый вывод программы','Saved program output')}</strong>
     <small>{tr('Только чтение','Read only')} · {outputPage+1}/
      {Math.max(1,Math.ceil(programOutput.text.length/24000))}</small>
     <pre className="document-content">{programOutput.text.slice(outputPage*24000,(outputPage+1)*24000)}</pre>
     <div className="advanced-actions">
      <button type="button" disabled={outputPage===0} onClick={()=>setOutputPage(p=>p-1)}>
       {tr('Назад','Previous')}</button>
      <button type="button" disabled={(outputPage+1)*24000>=programOutput.text.length}
       onClick={()=>setOutputPage(p=>p+1)}>{tr('Далее','Next')}</button>
     </div>
    </div>}
   {proof&&<p role={chosen.tool_id==='program.invoke'&&
    str(proof.program_output_state)==='UNAVAILABLE'?'alert':'status'}>{
     chosen.tool_id==='program.invoke'&&
      record(proof.receipt).status==='SUCCEEDED'&&
      record(proof.receipt).external_effect_state==='ACKNOWLEDGED'
      ?str(proof.program_output_state)==='VERIFIED'
       ?tr('Квитанция и сохранённый вывод программы проверены.',
         'Program receipt and saved output are verified.')
       :tr('Квитанция подтверждает выполнение, но сохранённый вывод недоступен. Повтор запрещён до выяснения исхода.',
         'Receipt confirms execution, but saved output is unavailable. Do not retry.')
      :record(proof.receipt).status==='SUCCEEDED'&&
       record(proof.receipt).external_effect_state==='ACKNOWLEDGED'
       ?tr('Квитанция подтверждает успешное исполнение.','Receipt confirms successful execution.')
       :tr('Квитанция есть, но успешное завершение не подтверждено.','Receipt exists, but successful completion is unverified.')
    }</p>}
  </div>}
 </section>;
}
