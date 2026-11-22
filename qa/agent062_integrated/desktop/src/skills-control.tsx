import React,{useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {record,records,str,failure,OwnerDetails,type Row} from './owner-ui';
import {HelpTip,useUiSettings} from './ui-preferences';
import {humanState} from './human-language';

/** Catalog and usage readbacks only. Task selection does not grant new authority. */
export function SkillsControl({onUseTaskSkill}:{onUseTaskSkill:(skillId:string)=>void}){
 const {tr,language}=useUiSettings();
 const [task,setTask]=useState<Row>({}),[operations,setOperations]=useState<Row>({}),[curator,setCurator]=useState<Row>({});
 const [errors,setErrors]=useState<Record<string,string>>({}),[busy,setBusy]=useState(false);
 const loadSequence=useRef(0);
 const load=useCallback(async()=>{
  const seq=++loadSequence.current;
  // Task selection is the primary user path. Optional operational catalogues
  // may answer later or be offline; neither may delay a usable Task Skill.
  setBusy(true);
  const read=async(key:'task_skills'|'operational_skills'|'operational_skill_curator')=>{
   try{
    const value=record(await runtime.query<Row>(key));
    if(seq!==loadSequence.current)return;
    if(key==='task_skills')setTask(value);
    else if(key==='operational_skills')setOperations(value);
    else setCurator(value);
    setErrors(current=>{
     const next={...current};
     delete next[key];
     return next;
    });
   }catch(error){
    if(seq!==loadSequence.current)return;
    if(key==='task_skills')setTask({});
    else if(key==='operational_skills')setOperations({});
    else setCurator({});
    setErrors(current=>({...current,[key]:failure(error)}));
   }finally{
    if(key==='task_skills'&&seq===loadSequence.current)setBusy(false);
   }
  };
  await Promise.all([
   read('task_skills'),
   read('operational_skills'),
   read('operational_skill_curator'),
  ]);
 },[]);
 useEffect(()=>{void load();return()=>{loadSequence.current++}},[load]);
 const taskRows=records(task.skills),operationalRows=records(operations.skills),stats=records(curator.skills);
 const statuses=record(operations.doctor),usage=new Map(stats.map(x=>[str(x.skill_id),x]));
 const taskReady=!busy&&!errors.task_skills&&task.schema==='IWXA_TASK_SKILL_CATALOG/1.0.0';
 return <section className="subpage card advanced">
  <div className="advanced-head"><div><h2>{tr('Возможности агента','Assistant capabilities')} <HelpTip topic="Навыки"/></h2>
   <p>{tr('Выберите способ работы для следующей задачи. Остальные возможности агент использует при выполнении и проверке действий.','Choose a capability for your next task. Other capabilities assist execution and review.')}</p></div>
   <button type="button" disabled={busy} className="secondary-button" onClick={()=>void load()}>{busy?tr('Загрузка…','Loading…'):tr('Обновить','Refresh')}</button></div>
  <section className="advanced-form"><h3>{tr('Для новой задачи','Task skills')} · {taskRows.length}</h3>
   <p>{tr('Агент может сам подобрать способ работы по вашему запросу. Выбор здесь действует только для следующей задачи.','The assistant can choose from your request. A manual choice applies only to the next task.')}</p>
   {errors.task_skills&&<p role="alert" className="advanced-error">{errors.task_skills}</p>}
   <button type="button" disabled={!taskReady} className="mini-button" onClick={()=>onUseTaskSkill('')}>{tr('Выбрать автоматически','Choose automatically')}</button>
   {taskReady&&taskRows.length===0&&<p>{tr('Каталог пуст','No task skills available')}</p>}
   <div className="skills-grid">
    {taskRows.map(x=><article className="skills-card" key={str(x.skill_id)}>
      <h3>{str(x.name)||str(x.skill_id)}</h3><p>{str(x.description)||str(x.skill_id)}</p>
      <p className="skills-meta">{tr('Результат','Result')}: {str(x.output_type).replaceAll('_',' ').toLowerCase()}</p>
      <div className="advanced-actions"><button type="button" disabled={!taskReady||x.task_route_supported!==true} onClick={()=>onUseTaskSkill(str(x.skill_id))}>{tr('Для следующей задачи','Use for next task')}</button></div>
    </article>)}
   </div>
  </section>
  <section className="advanced-form"><h3>{tr('Дополнительные возможности','Additional capabilities')} · {operationalRows.length}</h3>
   <p>{tr('Эти возможности помогают агенту выполнять запланированную работу, проверять результаты и восстанавливать прерванные действия.','These capabilities help the assistant schedule work, review results and recover interrupted actions.')}</p>
   {errors.operational_skills&&<p role="alert" className="advanced-error">{errors.operational_skills}</p>}
   {errors.operational_skill_curator&&<p className="advanced-error">{tr('История применения недоступна: ','Usage history unavailable: ')+errors.operational_skill_curator}</p>}
   <p>{tr('Замечания','Issues')}: {records(curator.issues).length} <span>{humanState(statuses.status||curator.status,language)}</span></p>
   <div className="skills-grid">
    {operationalRows.map(x=>{const s=record(usage.get(str(x.skill_id)));
      return <article className="skills-card" key={str(x.skill_id)}>
       <h3>{str(x.name)||str(x.title)||str(x.description).slice(0,75)||tr('Дополнительная возможность','Additional capability')}</h3><p>{str(x.description)}</p>
       <p className="skills-meta">{tr('Активаций','Activations')}: {s.activation_count===undefined?'—':str(s.activation_count)} · {tr('Последняя','Last')}: {str(s.last_activated_at)||'—'}</p>
       {Array.isArray(x.gotchas)&&x.gotchas.length>0&&<details><summary>{tr('Ограничения и риски','Limits and risks')}</summary><ul>{x.gotchas.map((v,i)=><li key={i}>{str(v)}</li>)}</ul></details>}
       <OwnerDetails title={tr('Технический профиль','Technical descriptor')} value={{skill_id:x.skill_id,required_capabilities:x.required_capabilities,verification_checks:x.verification_checks,risk_ceiling:x.risk_ceiling}}/>
      </article>;
    })}
   </div>
   {records(curator.issues).length>0&&<OwnerDetails title={tr('Замечания каталога','Catalog issues')} value={curator.issues}/>}
  </section>
 </section>;
}
