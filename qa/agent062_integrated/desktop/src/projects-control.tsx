import {humanState} from './human-language';
import React,{useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {record,records,str,failure,OwnerDetails,useOwnerActions,type Row} from './owner-ui';
import {HelpTip,useUiSettings} from './ui-preferences';

const rowsOf=(value:unknown,key:string)=>records(record(value)[key]);
const lines=(value:string)=>value.split('\n').map(s=>s.trim()).filter(Boolean);
const BOARD_WORKER='model-worker';

export function ProjectsControl(){
 const {tr}=useUiSettings();
 const [goals,setGoals]=useState<Row[]>([]),[boards,setBoards]=useState<Row[]>([]);
 const [goalId,setGoalId]=useState(''),[boardId,setBoardId]=useState('');
 const [goalDetail,setGoalDetail]=useState<Row>({}),[boardDetail,setBoardDetail]=useState<Row>({});
 const [error,setError]=useState(''),[objective,setObjective]=useState(''),[criteria,setCriteria]=useState(''),[steps,setSteps]=useState('');
 const [criterionId,setCriterionId]=useState(''),[decision,setDecision]=useState('UNKNOWN'),[evidenceKey,setEvidenceKey]=useState('');
 const serial=useRef(0);
 const load=useCallback(async()=>{
  const seq=++serial.current;
  const requests=[runtime.query<Row>('goals',{limit:100}),runtime.query<Row>('work_boards',{limit:100}),
   ...(goalId?[runtime.query<Row>('goal_status',{goal_id:goalId})]:[]),
   ...(boardId?[runtime.query<Row>('work_board_status',{board_id:boardId})]:[])];
  const results=await Promise.allSettled(requests);
  if(seq!==serial.current)return;
  const names=['goals','work_boards',...(goalId?['goal_status']:[]),...(boardId?['work_board_status']:[])];
  setError(results.flatMap((r,i)=>r.status==='rejected'?[names[i]+': '+failure(r.reason)]:[]).join(' · '));
  const gs=results[0].status==='fulfilled'?rowsOf(results[0].value,'goals'):[];
  const bs=results[1].status==='fulfilled'?rowsOf(results[1].value,'boards'):[];
  if(results[0].status==='fulfilled'){setGoals(gs);setGoalId(old=>old||str(record(gs[0]?.goal).goal_id));}
  if(results[1].status==='fulfilled')setBoards(bs);
  if(goalId){
   const idx=names.indexOf('goal_status'),out=results[idx];
   setGoalDetail(out?.status==='fulfilled'?record(out.value):{});
  }else setGoalDetail({});
  if(boardId){
   const idx=names.indexOf('work_board_status'),out=results[idx];
   setBoardDetail(out?.status==='fulfilled'?record(out.value):{});
  }else setBoardDetail({});
 },[goalId,boardId]);
 useEffect(()=>{void load()},[load]);
 const {run,busy,message}=useOwnerActions(load);
 const goal=record(goalDetail.goal),goalRows=records(goalDetail.criteria);
 const selectedBoard=record(boardDetail.board),tickets=records(boardDetail.tickets);
 const relatedBoards=boards.filter(row=>str(record(record(row.board).goal_ref).ref_id)===goalId);
 const evidence=records(goalDetail.verified_board_evidence);
 const selectedEvidence=evidence.find(row=>JSON.stringify([str(row.board_id),str(row.ticket_id),str(row.verification_id)])===evidenceKey);
 const selectedCriterion=goalRows.find(row=>str(record(row.criterion).criterion_id)===criterionId);
 const selectedGoalSummary=goals.find(row=>str(record(row.goal).goal_id)===goalId);
 function selectGoal(id:string){setGoalId(id);setBoardId('');setCriterionId('');setEvidenceKey('');setGoalDetail({});setBoardDetail({});}
 function selectBoard(id:string){setBoardId(id);setBoardDetail({});}
 async function createGoal(){
  const acceptance_criteria=lines(criteria),plan_steps=lines(steps);
  if(!objective.trim()||!acceptance_criteria.length||!plan_steps.length)return;
  const result=await run<Row>(tr('Создать цель с этими критериями и шагами?','Create a goal with these criteria and steps?'),
   'goal_create',{objective:objective.trim(),acceptance_criteria,plan_steps});
  const id=str(result?.goal_id);
  if(id){setObjective('');setCriteria('');setSteps('');selectGoal(id);}
 }
 async function createBoard(){
  if(!goalId||relatedBoards.length)return;
  const result=await run<Row>(tr('Создать последовательную доску из сохранённых шагов цели?','Create a sequential board from this goal’s saved steps?'),
   'work_board_create',{goal_id:goalId,sequential:true,max_parallel:1},{kind:'goal',id:goalId});
  if(result?.board_id)selectBoard(str(result.board_id));
 }
 async function stepAction(command:string,ticketId:string,input:Row){
  if(!boardId)return;
  await run(tr('Подтвердить действие над шагом '+ticketId+'? Состояние и квитанции проверит Python Core.','Confirm action on ticket '+ticketId+'? Python Core validates and records the result.'),
   command,{board_id:boardId,ticket_id:ticketId,...input},{kind:'work_board',id:boardId});
 }
 async function claimTicket(ticketId:string){
  if(!boardId)return;
  await run(tr('Закрепить один доступный шаг за локальным исполнителем?','Claim one available ticket for the local worker?'),
   'work_board_claim',{board_id:boardId,worker_id:BOARD_WORKER,limit:1},{kind:'work_board',id:boardId});
 }
 async function recordProof(){
  if(!goalId||!criterionId||(decision!=='UNKNOWN'&&!selectedEvidence))return;
  const refs=selectedEvidence?[selectedEvidence.evidence_ref]:[];
  if(refs.some(x=>!record(x).ref_id||!record(x).digest_sha256))return;
  await run(tr('Записать решение человека по критерию '+criterionId+' с указанными основаниями?','Record the human decision for criterion '+criterionId+' using the selected evidence?'),
   'goal_proof',{goal_id:goalId,criterion_id:criterionId,status:decision,evidence_refs:refs,verifier_mode:decision==='UNKNOWN'?'system':'human'},
   {kind:'goal',id:goalId});
 }
 const stateByTicket=new Map(tickets.map(t=>[str(record(t.ticket).ticket_id),record(t.state)]));
 const nextClaimable=tickets.find(row=>{
  const ticket=record(row.ticket),state=record(row.state);
  return state.status==='TODO'&&(Array.isArray(ticket.depends_on)?ticket.depends_on:[]).every(dep=>stateByTicket.get(str(dep))?.status==='DONE');
 });
 const nextClaimableId=str(record(nextClaimable?.ticket).ticket_id);
 return <section className="subpage card advanced">
  <div className="advanced-head"><div><h2>{tr('Цели и планы','Goals and plans')} <HelpTip topic="Проекты"/></h2>
    <p>{tr('Определите результат, разбейте работу на шаги и проверяйте, что действительно выполнено.','Define the result, organize the steps and verify completed work.')}</p></div>
    <button className="secondary-button" disabled={busy} onClick={()=>void load()}>{tr('Обновить','Refresh')}</button></div>
  {error&&<p role="alert" className="advanced-error">{error}</p>}
  {message&&<p role="status" className="advanced-notice">{message}</p>}
  <div className="advanced-form"><h3>{tr('Сохранённые цели','Saved goals')}</h3>
   <label className="advanced-field">{tr('Выбрать цель','Select goal')}<select value={goalId} onChange={e=>selectGoal(e.target.value)}>
    <option value="">{tr('Новая цель / не выбрано','New goal / none')}</option>
    {goals.map(row=>{const g=record(row.goal);return <option value={str(g.goal_id)} key={str(g.goal_id)}>{str(g.objective).slice(0,100)} · {row.complete===true?tr('завершена','complete'):tr('в работе','in progress')}</option>;})}
   </select></label>
   {selectedGoalSummary&&<p>{tr('Результат:','Result:')} {selectedGoalSummary.complete===true?tr('доказан','verified'):tr('не завершён','not complete')} · {tr('Критерии:','Criteria:')} {str(record(selectedGoalSummary.criteria_summary).pass)} {tr('выполнено','met')}, {str(record(selectedGoalSummary.criteria_summary).fail)} {tr('не выполнено','not met')}, {str(record(selectedGoalSummary.criteria_summary).unknown)} {tr('ожидает проверки','awaiting review')}</p>}
   {!goals.length&&<p>{tr('Цели пока не созданы.','No saved goals yet.')}</p>}
  </div>
  <div className="advanced-form"><h3>{tr('Создать цель','Create goal')}</h3>
   <label className="advanced-field">{tr('Ожидаемый результат','Objective')}<textarea rows={2} value={objective} onChange={e=>setObjective(e.target.value)}/></label>
   <label className="advanced-field">{tr('Критерии, каждый с новой строки','Criteria, one per line')}<textarea rows={4} value={criteria} onChange={e=>setCriteria(e.target.value)}/></label>
   <label className="advanced-field">{tr('Последовательные шаги, каждый с новой строки','Steps, one per line')}<textarea rows={4} value={steps} onChange={e=>setSteps(e.target.value)}/></label>
   <button disabled={busy||!objective.trim()||!lines(criteria).length||!lines(steps).length} onClick={()=>void createGoal()}>{tr('Создать цель','Create goal')}</button>
  </div>
  {goalId&&<div className="advanced-form"><h3>{tr('Доска выбранной цели','Boards for selected goal')}</h3>
   <label className="advanced-field">{tr('Сохранённая доска','Saved board')}<select value={relatedBoards.some(row=>record(row.board).board_id===boardId)?boardId:''} onChange={e=>selectBoard(e.target.value)}>
    <option value="">{tr('Выберите доску','Choose board')}</option>
    {relatedBoards.map(row=><option key={str(record(row.board).board_id)} value={str(record(row.board).board_id)}>{tr('Доска','Board')} {relatedBoards.indexOf(row)+1} · {row.complete===true?tr('готова','complete'):tr('в работе','in progress')}</option>)}
   </select></label>
   <button disabled={busy||!goal.goal_id||relatedBoards.length>0} onClick={()=>void createBoard()}>{tr('Создать доску из шагов','Create board from steps')}</button>
   {relatedBoards.length>0&&<p>{tr('Для этой цели уже существуют доски. Новые шаги добавляются через отдельный процесс, а не заменой истории.','Existing boards remain immutable. Do not overwrite persisted tickets to edit a goal.')}</p>}
   {Boolean(goalDetail.source_task)&&<OwnerDetails title={tr('Источник цели','Goal source')} value={goalDetail.source_task}/>}
  </div>}
  {boardId&&selectedBoard.board_id===boardId&&<div className="advanced-form"><h3>{tr('Шаги выбранной доски','Steps of selected board')}</h3>
   <p>{tr('Состояние доски:','Board state:')} {boardDetail.complete===true?tr('все шаги проверены','all tickets verified'):tr('выполняется','in progress')} · {Object.entries(record(boardDetail.counts)).map(([key,val])=>key+': '+str(val)).join(' · ')}</p>
   <div className="owner-rows">{tickets.map(row=>{
    const ticket=record(row.ticket),state=record(row.state),id=str(ticket.ticket_id),status=str(state.status);
    const deps=Array.isArray(ticket.depends_on)?ticket.depends_on.map(str):[];
    const dependenciesMet=deps.every(dep=>stateByTicket.get(dep)?.status==='DONE');
    const proofRefs=records(state.evidence_refs);
    const worker=record(row.worker_result);
    const hasEvidence=proofRefs.length>0;
    return <div className="owner-row" key={id}>
     <strong>{str(ticket.description)}</strong><span>{humanState(status,tr('ru','en') as 'ru'|'en')}</span>
     <small>{deps.length?tr('Зависит от: ','Depends on: ')+deps.join(', '):tr('Первый шаг','First step')} · {tr('Попыток:','Attempts:')} {str(state.attempt_count)||'0'}</small>
     {status==='RUNNING'&&<p>{tr('Задача закреплена до:','Claim expires:')} {str(state.claim_expires_at)||'—'}</p>}
     {status==='BLOCKED'&&<p className="advanced-error">{str(state.block_reason)||tr('Заблокировано ядром','Blocked by Core')}</p>}
     {status==='VERIFY'&&<p>{tr('Ожидает человеческой проверки.','Awaiting human verification.')}</p>}
     {worker.output!==undefined&&<details><summary>{tr('Фактический результат исполнителя','Actual worker output')}</summary><pre>{JSON.stringify(worker.output,null,2)}</pre></details>}
     {hasEvidence&&<details><summary>{tr('Сохранённые evidence и состояние','Persisted evidence and state')}</summary><OwnerDetails value={state}/></details>}
     <div className="advanced-actions">
      {status==='TODO'&&<button disabled={busy||!dependenciesMet||id!==nextClaimableId} onClick={()=>void claimTicket(id)}>{tr('Взять доступный шаг','Claim available ticket')}</button>}
      {status==='RUNNING'&&<button disabled={busy||!str(state.claim_token)} onClick={()=>void stepAction('work_board_run_worker',id,{claim_token:state.claim_token,worker_id:BOARD_WORKER})}>{tr('Выполнить шаг','Run step')}</button>}
      {status==='VERIFY'&&<><button disabled={busy||!hasEvidence} onClick={()=>void stepAction('work_board_verify',id,{decision:'PASS',verifier_mode:'human'})}>{tr('Принять результат','Approve result')}</button>
       <button disabled={busy||!hasEvidence} onClick={()=>void stepAction('work_board_verify',id,{decision:'FAIL',verifier_mode:'human'})}>{tr('Вернуть на доработку','Reject and revise')}</button></>}
      {status==='BLOCKED'&&<button disabled={busy} onClick={()=>void stepAction('work_board_retry_blocked',id,{})}>{tr('Разблокировать после проверки','Retry blocked ticket')}</button>}
     </div>
    </div>;
   })}</div>
  </div>}
  {goalId&&goal.goal_id===goalId&&<div className="advanced-form"><h3>{tr('Проверка критериев цели','Goal acceptance criteria')}</h3>
   <p>{tr('Выберите сохранённый результат шага и проверьте его перед принятием решения.','Choose a saved step result and review it before making a decision.')}</p>
   <div className="owner-rows">{goalRows.map(row=><div className="owner-row" key={str(record(row.criterion).criterion_id)}>
    <strong>{str(record(row.criterion).criterion_id)} · {str(record(row.criterion).description)}</strong>
    <span>{humanState(row.status,tr('ru','en') as 'ru'|'en')}</span>
    {Boolean(row.proof)&&<OwnerDetails title={tr('Последнее решение и основания','Last decision and evidence')} value={row.proof}/>}
   </div>)}</div>
   <label className="advanced-field">{tr('Критерий','Criterion')}<select value={criterionId} onChange={e=>setCriterionId(e.target.value)}>
    <option value="">{tr('Выберите критерий','Choose criterion')}</option>
    {goalRows.map(row=><option key={str(record(row.criterion).criterion_id)} value={str(record(row.criterion).criterion_id)}>{str(record(row.criterion).criterion_id)} · {str(record(row.criterion).description)}</option>)}
   </select></label>
   <label className="advanced-field">{tr('Подтверждённый результат','Verified result')}<select value={evidenceKey} onChange={e=>setEvidenceKey(e.target.value)}>
    <option value="">{tr('Нет / требуется для PASS и FAIL','None / required for PASS and FAIL')}</option>
    {evidence.map(row=>{const key=JSON.stringify([str(row.board_id),str(row.ticket_id),str(row.verification_id)]);
     return <option key={key} value={key}>{str(row.ticket_description).slice(0,110)} · {str(row.verification_id)}</option>;})}
   </select></label>
   <label className="advanced-field">{tr('Решение','Decision')}<select value={decision} onChange={e=>setDecision(e.target.value)}>
    <option value="UNKNOWN">{tr('Пока неизвестно','Not yet known')}</option><option value="PASS">{tr('Выполнено','Met')}</option><option value="FAIL">{tr('Не выполнено','Not met')}</option>
   </select></label>
   <button disabled={busy||!selectedCriterion||(decision!=='UNKNOWN'&&!selectedEvidence)} onClick={()=>void recordProof()}>{tr('Сохранить решение','Save decision')}</button>
   {evidence.length===0&&<p>{tr('Проверенных результатов досок пока нет. Сначала завершите шаг и подтвердите его результат.','No verified board evidence yet. Finish a ticket and review its result first.')}</p>}
   <p>{tr('Цель завершена:','Goal complete:')} {goalDetail.complete===true?tr('да','yes'):tr('нет','no')}</p>
  </div>}
 </section>;
}
