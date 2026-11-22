/** A truthful clock for a model job observed in this desktop window.
 * No fictional percentage, ETA, model quality score, or attempt to cancel
 * an already running durable automation claim.
 */
import {useEffect,useState} from 'react';

export const taskJobIsActive=(state:string)=>
 !['COMPLETED','PAUSED','DEAD','CANCELLED'].includes(state);

export function TaskWaitStatus({taskId,state,hasPartial,tr,onOpenModels}:{
 taskId:string;state:string;hasPartial:boolean;tr:(ru:string,en:string)=>string;
 onOpenModels?:()=>void;
}){
 const active=taskJobIsActive(state);
 const [seconds,setSeconds]=useState(0);
 useEffect(()=>{
  if(!active)return;
  const started=Date.now();
  setSeconds(0);
  const tick=window.setInterval(()=>setSeconds(Math.max(0,Math.floor((Date.now()-started)/1000))),1000);
  return()=>window.clearInterval(tick);
 },[taskId,active]);
 if(!active)return null;
 return <div className="task-wait-status" role="status">
  <strong>{state==='SCHEDULED'
   ?tr('Задача ожидает запуска','Task is queued')
   :hasPartial?tr('Модель формирует ответ','The model is producing a response')
   :tr('Модель обрабатывает запрос','The model is processing the request')}</strong>
  <span>{tr('Наблюдаем в этом окне: ','Observed in this window: ')}{seconds} {tr('с','s')}.</span>
  {seconds>=20&&!hasPartial&&<small>{tr(
   'Это не индикатор зависания: локальная модель может долго загружаться или рассуждать. Время завершения неизвестно. Можно перейти к другим разделам, задача останется в Core.',
   'This does not mean a freeze: a local model may take time to load or reason. Completion time is unknown. You may use other sections; the Task stays in Core.')}</small>}
  <small>{tr(
   'Глубина рассуждений выбирается до отправки и относится только к новым запросам. Уже запущенную модель эта настройка не прерывает.',
   'Reasoning depth is selected before Send and applies to new requests. Changing it does not interrupt a running model.')}</small>
  {seconds>=20&&onOpenModels&&<button type="button" className="mini-button"
   onClick={onOpenModels}>{tr('Управлять моделью','Manage model')}</button>}
  {seconds>=20&&onOpenModels&&<small>{tr(
   'На странице моделей можно проверить доступность остановки. Остановка локальной модели может также прервать другие её запросы; созданная Task не удаляется.',
   'The Models page shows whether stopping is available. Stopping a local model can also interrupt other requests; the saved Task is not deleted.')}</small>}
 </div>;
}
