import React,{useId,useState} from 'react';
import {useUiSettings} from './ui-preferences';
import {presentEvidence,evidenceText,type DisplayValue} from './evidence-presentation';
import './owner-evidence.css';

const labels:Record<string,[string,string]>={
 status:['\u0421\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435','Status'],
 state:['\u0421\u043e\u0441\u0442\u043e\u044f\u043d\u0438\u0435','State'],
 path:['\u041f\u0443\u0442\u044c','Path'],
 content:['\u0421\u043e\u0434\u0435\u0440\u0436\u0438\u043c\u043e\u0435','Content'],
 decision:['\u0420\u0435\u0448\u0435\u043d\u0438\u0435','Decision'],
 reason:['\u041f\u0440\u0438\u0447\u0438\u043d\u0430','Reason'],
 error_code:['\u041a\u043e\u0434 \u043f\u0440\u0438\u0447\u0438\u043d\u044b','Reason code'],
 observed_at:['\u041f\u0440\u043e\u0432\u0435\u0440\u0435\u043d\u043e','Observed at'],
 finished_at:['\u0417\u0430\u0432\u0435\u0440\u0448\u0435\u043d\u043e','Finished at'],
 read_only:['\u0422\u043e\u043b\u044c\u043a\u043e \u0447\u0442\u0435\u043d\u0438\u0435','Read only'],
 verified:['\u041f\u0440\u043e\u0432\u0435\u0440\u0435\u043d\u043e','Verified'],
};
/** Phrasing elements deliberately support legacy call sites inside <p>.
 * Opening details only renders the existing projection; it performs no I/O. */
export function OwnerDetails({value,title,initiallyOpen=false}:{value:unknown;title?:string;initiallyOpen?:boolean}){
 const {tr}=useUiSettings();
 const [open,setOpen]=useState(initiallyOpen);
 const id=useId();
 const presentation=open?presentEvidence(value):null;
 const render=(item:DisplayValue,level=0):React.ReactNode=>{
  if(item!==null&&typeof item==='object'){
   const entries=Object.entries(item);
   if(!entries.length)return <span>{tr('\u0417\u0430\u043f\u0438\u0441\u0435\u0439 \u043d\u0435\u0442','No entries')}</span>;
   return <span className="owner-evidence-fields" role="list">{entries.map(([key,child])=>
    <span className="owner-evidence-field" role="listitem" key={key}>
     <span className="owner-evidence-label">{Array.isArray(item)?String(Number(key)+1):labels[key]?tr(...labels[key]):key}</span>
     <span className="owner-evidence-value">{level<2?render(child,level+1):<code>{evidenceText(child)}</code>}</span>
    </span>)}</span>;
  }
  return <code>{item===null?tr('\u041d\u0435 \u0437\u0430\u0434\u0430\u043d\u043e','Not provided'):
   typeof item==='boolean'?(item?tr('\u0414\u0430','Yes'):tr('\u041d\u0435\u0442','No')):String(item)}</code>;
 };
 return <span className="owner-evidence">
  <button type="button" className="owner-evidence-toggle" aria-expanded={open} aria-controls={id}
   onClick={()=>setOpen(previous=>!previous)}>
   <span aria-hidden="true">{open?'\u2212':'+'}</span> {title||tr('\u041f\u043e\u0434\u0440\u043e\u0431\u043d\u043e\u0441\u0442\u0438','Details')}
  </button>
  <span id={id} className="owner-evidence-body" hidden={!open}>
   {presentation&&<>
    <span className="owner-evidence-note">{tr(
     '\u0421\u0432\u0435\u0434\u0435\u043d\u0438\u044f \u043f\u043e\u0441\u043b\u0435\u0434\u043d\u0435\u0433\u043e \u043e\u0442\u0432\u0435\u0442\u0430. \u041e\u0442\u043a\u0440\u044b\u0442\u0438\u0435 \u043d\u0435 \u0437\u0430\u043f\u0443\u0441\u043a\u0430\u0435\u0442 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u0435 \u0438 \u043d\u0435 \u043f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0430\u0435\u0442 \u0435\u0433\u043e \u0443\u0441\u043f\u0435\u0445.',
     'Details from the last response. Opening them neither runs an action nor confirms its success.')}</span>
    {presentation.redacted>0&&<span className="owner-evidence-note">{tr(
     '\u0418\u0437\u0432\u0435\u0441\u0442\u043d\u044b\u0435 \u043f\u043e\u043b\u044f \u0441 \u043a\u043b\u044e\u0447\u0430\u043c\u0438 \u0438 \u0441\u0435\u043a\u0440\u0435\u0442\u0430\u043c\u0438 \u0441\u043a\u0440\u044b\u0442\u044b. \u041d\u0435 \u043f\u0435\u0440\u0435\u0434\u0430\u0432\u0430\u0439\u0442\u0435 \u043b\u0438\u0447\u043d\u044b\u0435 \u0434\u0430\u043d\u043d\u044b\u0435 \u0438\u0437 \u043e\u0442\u0447\u0451\u0442\u0430 \u0431\u0435\u0437 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438.',
     'Recognized credential fields are hidden. Review personal data before sharing any report.')}</span>}
    {presentation.limited&&<span role="alert" className="advanced-error">{tr(
     '\u041f\u043e\u043a\u0430\u0437\u0430\u043d\u0430 \u0447\u0430\u0441\u0442\u044c \u0441\u0432\u0435\u0434\u0435\u043d\u0438\u0439. \u041d\u0435 \u043f\u0440\u0438\u043d\u0438\u043c\u0430\u0439\u0442\u0435 \u0440\u0435\u0448\u0435\u043d\u0438\u0435 \u043e \u0437\u0430\u043f\u0438\u0441\u0438 \u0438\u043b\u0438 \u043f\u043e\u0432\u0442\u043e\u0440\u0435 \u0434\u0435\u0439\u0441\u0442\u0432\u0438\u044f \u043f\u043e \u043d\u0435\u043f\u043e\u043b\u043d\u044b\u043c \u0434\u0430\u043d\u043d\u044b\u043c.',
     'Only part of this evidence is displayed. Do not approve a write or retry based on incomplete evidence.')}</span>}
    {render(presentation.value)}
   </>}
  </span>
 </span>;
}
