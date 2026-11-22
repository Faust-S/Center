import React,{useMemo,useRef,useState} from 'react';
import {useUiSettings} from './ui-preferences';
import {SafeMarkdown} from './safe-markdown';
import {workResultPageOffsets} from './work-result-pages';

/** This is a presentation of the existing verified WorkBoard worker output.
 * It never creates or changes a Result, authority, approval or receipt. */
export type WorkTicketOutput={
 worker_run_id?:unknown;
 output?:unknown;
 output_digest?:unknown;
 integrity_verified?:unknown;
 unavailable?:unknown;
};

/** A review token is valid only for a digest-verified complete worker output
 * and one particular durable ticket state. No page prefix can satisfy it. */
export function workerReviewToken(boardId:string,ticketId:string,stateDigest:string,worker:WorkTicketOutput):string{
 if(worker.integrity_verified!==true||worker.unavailable===true
  ||typeof worker.output!=='string'||worker.output.length===0
  ||typeof worker.worker_run_id!=='string'||!/^WRUN-[A-Za-z0-9_-]+$/.test(worker.worker_run_id)
  ||typeof worker.output_digest!=='string'||!/^[0-9a-f]{64}$/.test(worker.output_digest)
  ||!/^[0-9a-f]{64}$/.test(stateDigest)||!boardId||!ticketId)return '';
 return [boardId,ticketId,stateDigest,worker.worker_run_id,worker.output_digest].join(':');
}

export function WorkTicketResult({worker,reviewToken,reviewed,onReview,allowReview}:{
 worker:WorkTicketOutput;reviewToken:string;reviewed:boolean;
 onReview:(reviewed:boolean)=>void;allowReview:boolean;
}){
 const {tr}=useUiSettings();
 const text=typeof worker.output==='string'?worker.output:'';
 // Compute boundaries, not copies of every 8k-character page. Only the
 // visible page is sliced and rendered after the user expands the result.
 const offsets=useMemo(()=>workResultPageOffsets(text),[text]);
 const pageCount=offsets.length-1;
 const [page,setPage]=useState(0);
 const [seen,setSeen]=useState<number[]>([]);
 const [expanded,setExpanded]=useState(false);
 const pre=useRef<HTMLDivElement>(null);
 const activePage=Math.min(page,Math.max(0,pageCount-1));
 const confirmed=Boolean(reviewToken)&&worker.integrity_verified===true&&worker.unavailable!==true;
 const allVisited=pageCount>0&&seen.length>=pageCount
  &&offsets.slice(1).every((_,i)=>seen.includes(i));
 function choose(n:number){
  if(n<0||n>=pageCount)return;
  setPage(n);setSeen(old=>old.includes(n)?old:[...old,n]);
  if(pre.current)pre.current.scrollTop=0;
 }
 if(!text)return null;
 return <div className="advanced-form">
  <details onToggle={event=>{
   const visible=event.currentTarget.open;
   setExpanded(visible);
   if(visible)setSeen(old=>old.includes(activePage)?old:[...old,activePage]);
  }}>
   <summary>{tr('Прочитать полный результат исполнителя','Read the full worker result')}
     {pageCount>1?' ('+pageCount+' '+tr('части','parts')+')':''}
   </summary>
   {expanded&&<>
    {!confirmed&&<p role="alert">{tr('Не удалось подтвердить целостность сохранённого результата. Принятие недоступно.',
      'The saved result could not be verified. Approval is unavailable.')}</p>}
    <p>{tr('Часть','Part')} {activePage+1} {tr('из','of')} {pageCount}.
      {tr(' Результат доступен целиком, без сокращения текста.',' The full result is available without shortening.')}</p>
    <div ref={pre} className="document-content" style={{maxHeight:'30rem',overflow:'auto',overflowWrap:'anywhere'}}>
     <SafeMarkdown text={text.slice(offsets[activePage],offsets[activePage+1])}/>
    </div>
    {pageCount>1&&<div className="advanced-actions">
     <button type="button" disabled={activePage===0} onClick={()=>choose(activePage-1)}>
      {tr('Предыдущая часть','Previous part')}</button>
     <button type="button" disabled={activePage===pageCount-1} onClick={()=>choose(activePage+1)}>
      {tr('Следующая часть','Next part')}</button>
    </div>}
    {allowReview&&confirmed&&<div>
     {!allVisited&&<p>{tr('Откройте все части результата перед принятием решения.',
       'Open every part of the result before making a decision.')}</p>}
     <label>
      <input type="checkbox" checked={reviewed} disabled={!allVisited}
       onChange={e=>onReview(e.target.checked)}/>
      {tr('Я ознакомился с полным сохранённым результатом этого шага.',
        'I reviewed the complete saved result for this step.')}
     </label>
    </div>}
   </>}
  </details>
  {allowReview&&reviewed&&confirmed&&<p role="status">{tr('Полный результат просмотрен. Можно принять шаг или вернуть его на доработку.',
    'Full result reviewed. You may accept this step or request revision.')}</p>}
 </div>;
}
