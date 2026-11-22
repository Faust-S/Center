import React,{memo} from 'react';
import {useUiSettings} from './ui-preferences';

type ModelPin={name:string;digest:string};
type ModelProvider={id?:unknown;model?:unknown};
export type ModelTaskDetail={task_id:string;run_seq?:unknown;provider?:ModelProvider;requested_local_model?:unknown};
export type ModelTaskView={state:'reported'|'not-invoked'|'unknown';providerId:string;modelName:string;
 pinnedName:string;runSeq:number|null;requestedAndReportedDiffer:boolean};
const stringValue=(value:unknown)=>typeof value==='string'?value.trim().slice(0,180):'';
const validPin=(value:unknown):value is ModelPin=>{
 if(!value||typeof value!=='object'||Array.isArray(value))return false;
 const pin=value as Record<string,unknown>;
 return !!stringValue(pin.name)&&typeof pin.digest==='string'&&/^(sha256:)?[a-fA-F0-9]{64}$/.test(pin.digest);
};

/** Only saved Task detail, not a prediction about a pending provider call. */
export function projectTaskModelReadback(detail:ModelTaskDetail|null|undefined,taskId:string):ModelTaskView|null{
 if(!detail||!taskId||detail.task_id!==taskId)return null;
 const providerId=stringValue(detail.provider?.id),modelName=stringValue(detail.provider?.model);
 const pinnedName=validPin(detail.requested_local_model)?stringValue(detail.requested_local_model.name):'';
 const runSeq=typeof detail.run_seq==='number'&&Number.isSafeInteger(detail.run_seq)&&detail.run_seq>0
  ?detail.run_seq:null;
 const state=modelName==='NOT_INVOKED'?'not-invoked':providerId&&modelName&&modelName.toLowerCase()!=='unknown'
  ?'reported':'unknown';
 return {state,providerId,modelName:state==='reported'?modelName:'',pinnedName,runSeq,
  requestedAndReportedDiffer:state==='reported'&&!!pinnedName&&pinnedName!==modelName};
}

/** Read-only, compact disclosure next to the existing Result and Review UI. */
export const TaskModelReadback=memo(function TaskModelReadback({detail,taskId}:{
 detail:ModelTaskDetail|null|undefined;taskId:string
}){
 const {tr}=useUiSettings();
 const view=projectTaskModelReadback(detail,taskId);
 if(!view)return null;
 return <section className="task-model-readback" aria-label={tr('\u041c\u043e\u0434\u0435\u043b\u044c \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u0430','Result model')}>
  <p><strong>{view.state==='reported'
   ?tr('\u041c\u043e\u0434\u0435\u043b\u044c \u0440\u0435\u0437\u0443\u043b\u044c\u0442\u0430\u0442\u0430','Result model')
   :view.state==='not-invoked'?tr('\u041c\u043e\u0434\u0435\u043b\u044c \u043d\u0435 \u0432\u044b\u0437\u044b\u0432\u0430\u043b\u0430\u0441\u044c','No model inference was invoked')
   :tr('\u041c\u043e\u0434\u0435\u043b\u044c \u0435\u0449\u0451 \u043d\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0430','Model not yet verified')}</strong>
   {view.state==='reported'&&<>: {view.modelName}</>}</p>
  {view.requestedAndReportedDiffer&&<p role="status">{tr(
   '\u0412\u044b\u0431\u0440\u0430\u043d\u043d\u0430\u044f \u0438 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u043e\u0432\u0430\u043d\u043d\u0430\u044f \u043c\u043e\u0434\u0435\u043b\u0438 \u0440\u0430\u0437\u043b\u0438\u0447\u0430\u044e\u0442\u0441\u044f. \u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u0438\u0441\u0442\u043e\u0440\u0438\u044e.',
   'The requested and reported model differ. Check the history.')}</p>}
  {(view.providerId||view.pinnedName||view.runSeq!==null)&&<details>
   <summary>{tr('\u041f\u043e\u0434\u0440\u043e\u0431\u043d\u043e\u0441\u0442\u0438 \u043c\u043e\u0434\u0435\u043b\u0438','Model details')}</summary>
   {view.providerId&&<p>{tr('\u041f\u0440\u043e\u0432\u0430\u0439\u0434\u0435\u0440','Provider')}: {view.providerId}</p>}
   {view.pinnedName&&<p>{tr('\u041c\u043e\u0434\u0435\u043b\u044c \u0437\u0430\u043f\u0440\u043e\u0448\u0435\u043d\u0430 \u0432\u0440\u0443\u0447\u043d\u0443\u044e','Manually pinned model')}: {view.pinnedName}</p>}
   {view.runSeq!==null&&<p>{tr('\u041d\u043e\u043c\u0435\u0440 \u0437\u0430\u043f\u0443\u0441\u043a\u0430','Run sequence')}: {view.runSeq}</p>}
   <p>{tr('\u041f\u0440\u0438\u0447\u0438\u043d\u0430 \u0432\u044b\u0431\u043e\u0440\u0430 \u0438 \u0441\u043c\u0435\u043d\u0430 \u043c\u043e\u0434\u0435\u043b\u0438 \u043c\u0435\u0436\u0434\u0443 \u044d\u0442\u0430\u043f\u0430\u043c\u0438 \u043d\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u044b Core.',
    'Selection reason and step-to-step model changes are not verified by Core.')}</p>
  </details>}
 </section>;
});
