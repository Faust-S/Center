import React,{useCallback,useEffect,useState} from 'react';
import {runtime} from './runtime-client/interaction';

type RecordValue=Record<string,unknown>;
type Target={kind:string;id:string};
const sections:Record<string,{title:string;queries:string[]}> = {
 'Проекты':{title:'Цели и рабочие доски',queries:['goals','work_boards']},
 'Интеграции':{title:'Подключения и роли',queries:['user_setup','agent_roles','integration_control','google_oauth_status']},
 'Файлы':{title:'Файлы и источники',queries:['knowledge_workspaces','tool_catalog','tool_execution_receipts']},
 'Инструменты':{title:'Инструменты и программы',queries:['tool_catalog','existing_software','software_lifecycle','mcp_user_tools']},
 'Настройки':{title:'Управление и восстановление',queries:['operational_control','user_instructions','recovery_view','explorer_diagnostics']},
 'Цепочки':{title:'Процессы и цепочки',queries:['graph_revision_editor','graph_control_requests','graph_node_configs']},
 'Агенты':{title:'Агенты и роли',queries:['agent_roles','hosted_reference_activity']},
 'Программы':{title:'Programs Center',queries:['existing_software','software_lifecycle','software_lifecycle_surface_authority','explorer_installed_update_readiness']},
 'Восстановление':{title:'Восстановление операций',queries:['tool_repair_cases','tool_execution_receipts','recovery_view']}
};
const obj=(v:unknown):RecordValue=>v&&typeof v==='object'&&!Array.isArray(v)?v as RecordValue:{};
const str=(v:unknown)=>typeof v==='string'?v:typeof v==='number'||typeof v==='boolean'?String(v):'';
const first=(v:RecordValue,...keys:string[])=>keys.map(k=>str(v[k])).find(Boolean)||'';
const errorMessage=(e:unknown)=>e instanceof Error?e.message:String(e);
function Item({value}:{value:unknown}){
 const [expanded,setExpanded]=useState(false);
 if(Array.isArray(value))return <div className="advanced-items">{value.length?value.slice(0,100).map((entry,i)=><Item key={i} value={entry}/>):<p>Записей нет.</p>}</div>;
 if(value&&typeof value==='object'){
  const v=obj(value),entries=Object.entries(v);
  const label=first(v,'title','objective','name','description','job_id','goal_id','board_id','provider_id','instance_id','id','state','status')||'Запись';
  return <div className="advanced-item"><div className="advanced-item-head"><strong>{label.slice(0,180)}</strong><button type="button" className="mini-button" onClick={()=>setExpanded(x=>!x)}>{expanded?'Свернуть':'Подробнее'}</button></div>
  {entries.filter(([k,x])=>!Array.isArray(x)&&x!==null&&typeof x!=='object'&&k!=='title'&&k!=='objective').slice(0,7).map(([k,x])=><div className="key-value" key={k}><b>{k}</b><span>{String(x).slice(0,350)}</span></div>)}
  {expanded&&<pre>{JSON.stringify(value,null,2)}</pre>}</div>;
 }
 return <p>{str(value)||'Нет данных'}</p>;
}
export function Advanced({page,initialRecoveryCaseId}:{page:string;initialRecoveryCaseId?:string}){
 const cfg=sections[page], [data,setData]=useState<Record<string,unknown>>({}),[errors,setErrors]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const [objective,setObjective]=useState(''),[criteria,setCriteria]=useState(''),[steps,setSteps]=useState('');
 const [goalId,setGoalId]=useState(''),[boardId,setBoardId]=useState(''),[ticketId,setTicketId]=useState(''),[claimToken,setClaimToken]=useState(''),[criterionId,setCriterionId]=useState(''),[proof,setProof]=useState('PASS'),[evidence,setEvidence]=useState('');
 const [searchData,setSearchData]=useState<unknown>(null);
 const [caseId,setCaseId]=useState(''),[outcome,setOutcome]=useState(''),[note,setNote]=useState(''),[observation,setObservation]=useState<unknown>(null),[toolId,setToolId]=useState(''),[toolArgs,setToolArgs]=useState('{}'),[toolReadback,setToolReadback]=useState<unknown>(null);
 const [graphId,setGraphId]=useState(''),[sourcePath,setSourcePath]=useState(''),[sourceDigest,setSourceDigest]=useState(''),[sourceData,setSourceData]=useState<unknown>(null);
 useEffect(()=>{if(page==='Восстановление'&&initialRecoveryCaseId){setCaseId(initialRecoveryCaseId);setObservation(null);}},[page,initialRecoveryCaseId]);
 const load=useCallback(async()=>{
  if(!cfg)return;
  const results=await Promise.all(cfg.queries.map(async q=>{
   try{return {q,value:await runtime.query<unknown>(q),error:''};}
   catch(e){return {q,value:null,error:errorMessage(e)};}
  }));
  const d:Record<string,unknown>={},e:Record<string,string>={};
  for(const x of results){if(x.error)e[x.q]=x.error;else d[x.q]=x.value;}
  setData(d);setErrors(e);
 },[page]);
 useEffect(()=>{void load()},[load]);
 if(!cfg)return null;
 async function action(command:string,input:RecordValue,target?:Target){
  if(busy)return;
  if(!window.confirm('Подтвердить действие «'+command+'» в существующем Python Runtime?'))return;
  setBusy(true);setNotice('');
  try{
   // Always read a fresh owner revision before consequential commands.
   await runtime.refreshRevision();
   const result=await runtime.command<unknown>(command,input,target);
   setNotice('Команда принята Python Runtime: '+command+'. '+JSON.stringify(result).slice(0,300));
   await load();
   return result;
  }catch(e){
   // Unknown outcome is not retried automatically. A new user decision is required.
   setNotice('Исход команды требует проверки состояния перед повтором: '+errorMessage(e));
   await load();
  }finally{setBusy(false);}
 }
 const lines=(value:string)=>value.split('\n').map(x=>x.trim()).filter(Boolean);
 const field=(title:string,value:string,update:(s:string)=>void,placeholder='')=><label className="advanced-field">{title}<input value={value} onChange={e=>update(e.target.value)} placeholder={placeholder}/></label>;
 return <section className="subpage card advanced"><div className="advanced-head"><div><h2>{cfg.title}</h2><p>Состояние и действия действующего Python Core. Ничего не сохраняется в отдельном desktop-хранилище.</p></div><button className="secondary-button" onClick={()=>void load()} disabled={busy}>Обновить</button></div>
 {notice&&<p className="advanced-notice" role="status">{notice}</p>}
 {page==='Проекты'&&<>
 <div className="advanced-form"><h3>Создать цель</h3>{field('Цель',objective,setObjective,'Ожидаемый результат')}{field('Критерии (каждый с новой строки)',criteria,setCriteria)}{field('Шаги (каждый с новой строки)',steps,setSteps)}<button className="primary-button" disabled={!objective.trim()||!criteria.trim()||!steps.trim()||busy} onClick={()=>void action('goal_create',{objective,acceptance_criteria:lines(criteria),plan_steps:lines(steps)})}>Создать цель</button></div>
 <div className="advanced-form"><h3>Рабочая доска и проверка</h3>{field('ID цели',goalId,setGoalId,'GOAL-...')}{field('ID критерия',criterionId,setCriterionId,'C1')}<select value={proof} onChange={e=>setProof(e.target.value)}><option>PASS</option><option>FAIL</option><option>UNKNOWN</option></select>{field('Ссылка на основание',evidence,setEvidence)}<div className="advanced-actions"><button disabled={!goalId||busy} onClick={()=>void action('work_board_create',{goal_id:goalId,sequential:true,max_parallel:1},{kind:'goal',id:goalId})}>Создать доску</button><button disabled={!goalId||!criterionId||busy} onClick={()=>void action('goal_proof',{goal_id:goalId,criterion_id:criterionId,status:proof,evidence_refs:evidence?[evidence]:[],verifier_mode:proof==='UNKNOWN'?'system':'human'},{kind:'goal',id:goalId})}>Проверить критерий</button></div></div>
 <div className="advanced-form"><h3>Выполнение доски</h3>{field('ID доски',boardId,setBoardId,'BOARD-...')}{field('ID шага',ticketId,setTicketId,'TKT-...')}{field('Токен закреплённого шага',claimToken,setClaimToken)}<div className="advanced-actions"><button disabled={!boardId||busy} onClick={()=>void (async()=>{const result=obj(await action('work_board_claim',{board_id:boardId,worker_id:'model-worker',limit:1},{kind:'work_board',id:boardId}));const claims=Array.isArray(result.claimed)?result.claimed:[];const c=obj(claims[0]);if(typeof c.ticket_id==='string')setTicketId(c.ticket_id);if(typeof c.claim_token==='string')setClaimToken(c.claim_token);})()}>Взять шаг</button><button disabled={!boardId||!ticketId||!claimToken||busy} onClick={()=>void action('work_board_run_worker',{board_id:boardId,ticket_id:ticketId,claim_token:claimToken,worker_id:'model-worker'},{kind:'work_board',id:boardId})}>Запустить исполнителя</button><button disabled={!boardId||!ticketId||busy} onClick={()=>void action('work_board_verify',{board_id:boardId,ticket_id:ticketId,decision:'PASS',verifier_mode:'human'},{kind:'work_board',id:boardId})}>Принять шаг</button><button disabled={!boardId||!ticketId||busy} onClick={()=>void action('work_board_verify',{board_id:boardId,ticket_id:ticketId,decision:'FAIL',verifier_mode:'human'},{kind:'work_board',id:boardId})}>Вернуть шаг</button><button disabled={!boardId||!ticketId||busy} onClick={()=>void action('work_board_retry_blocked',{board_id:boardId,ticket_id:ticketId},{kind:'work_board',id:boardId})}>Возобновить блокировку</button></div></div>
 </>}
 {page==='Восстановление'&&<div className="advanced-form"><h3>Сверка неоднозначного результата</h3><p>Откройте квитанцию и независимо прочитайте фактическое состояние файла. Совпадение текущих байтов не доказывает историю внешнего действия. Никакого автоматического повторения записи.</p>{field('ID случая',caseId,setCaseId)}<button disabled={!caseId||busy} onClick={()=>void (async()=>{setBusy(true);setObservation(null);try{const value=await runtime.query('tool_recovery_file_observation',{case_id:caseId});setObservation(value);setNotice('Получено независимое наблюдение состояния файла от ToolRuntime.')}catch(e){setNotice(errorMessage(e))}finally{setBusy(false)}})()}>Проверить текущий файл</button>{observation!==null&&<Item value={observation}/>}<label className="advanced-field">Исход по подтверждённым основаниям<select value={outcome} onChange={e=>setOutcome(e.target.value)}><option value="">Укажите исход</option><option value="SUCCEEDED">Операция действительно выполнена</option><option value="FAILED">Операция не выполнена</option><option value="UNKNOWN">Доказательств недостаточно</option></select></label>{field('Основание решения',note,setNote)}<button disabled={!caseId||!outcome||!note||busy} onClick={()=>void action('tool_reconcile',{case_id:caseId,outcome,evidence_note:note},{kind:'reconciliation_case',id:caseId})}>Сохранить решение о результате</button></div>}
 {page==='Файлы'&&<div className="advanced-form"><h3>Прочитать проверенный источник</h3><p>Укажите путь и SHA-256 из каталога рабочего пространства. Чтение выполняет существующий Python Core.</p>{field('Путь источника',sourcePath,setSourcePath)}{field('SHA-256',sourceDigest,setSourceDigest)}<button disabled={busy||!sourcePath||!/^[a-f0-9]{64}$/.test(sourceDigest)} onClick={()=>void (async()=>{setBusy(true);try{setSourceData(await runtime.query('knowledge_source',{path:sourcePath,expected_sha256:sourceDigest}));setNotice('Источник прочитан без изменения файлов.')}catch(e){setNotice(errorMessage(e))}finally{setBusy(false)}})()}>Открыть источник</button>{sourceData!==null&&<Item value={sourceData}/>}</div>}
 {page==='Цепочки'&&<div className="advanced-form"><h3>Сохранённое исполнение графа</h3>{field('Execution ID',graphId,setGraphId)}<button disabled={!graphId||busy} onClick={async()=>{setBusy(true);try{const v=await runtime.query('graph_revision_editor',{execution_id:graphId,limit:50});setSearchData(v);setNotice('Граф прочитан из действующего ядра.')}catch(e){setNotice(errorMessage(e))}finally{setBusy(false)}}}>Открыть ревизии графа</button>{searchData!==null&&<Item value={searchData}/>}</div>}
 {cfg.queries.map(q=><section className="advanced-query" key={q}><h3>{q}</h3>{errors[q]?<p className="advanced-error">{errors[q]}</p>:data[q]===undefined?<p>Загрузка…</p>:<Item value={data[q]}/>}</section>)}
 </section>;
}
