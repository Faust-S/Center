import React from 'react';
import {dagTopology,type DagStep} from './graph-dag';
import {useUiSettings} from './ui-preferences';

/** Read-only graph presentation; neither authority nor execution lives here. */
type Props={title:string;steps:DagStep[];statuses?:Record<string,unknown>[];onSelect?:(nodeId:string)=>void};
type Position={id:string;kind:string;x:number;y:number};
const WIDTH=164,HEIGHT=58,X_GAP=215,Y_GAP=90;
export function GraphDagView({title,steps,statuses,onSelect}:Props){
 const {tr}=useUiSettings();
 let edges:ReturnType<typeof dagTopology>['edges'];
 try{edges=dagTopology(steps).edges;}
 catch{return <p role="status">{tr('Схема ещё не завершена: проверьте зависимости и объединение ветвей.',
  'The graph is incomplete: check dependencies and branch joins.')}</p>;}
 const depth=new Map<string,number>(),perLevel=new Map<number,number>();
 const positioned:Position[]=steps.map(step=>{
  const level=step.depends_on.length?1+Math.max(...step.depends_on.map(id=>depth.get(id)??0)):0;
  depth.set(step.node_id,level);
  const row=perLevel.get(level)??0;perLevel.set(level,row+1);
  return {id:step.node_id,kind:step.node_type,x:20+level*X_GAP,y:18+row*Y_GAP};
 });
 const positions=new Map(positioned.map(p=>[p.id,p]));
 const width=Math.max(360,...positioned.map(p=>p.x+WIDTH+20));
 const height=Math.max(105,...positioned.map(p=>p.y+HEIGHT+20));
 const observed=new Map((statuses||[]).map(row=>[String(row.node_id||''),String(row.status||'')]));
 const nodeTitle=(kind:string)=>kind==='MODEL_INVOCATION'?tr('Модель','Model'):kind==='AGENT_RUNTIME'?tr('Агент','Agent'):kind==='TOOL'?tr('Чтение','Read')
  :kind==='PARALLEL_FORK'?tr('Разветвление','Fork'):kind==='JOIN'?tr('Объединение','Join'):tr('Текст','Text');
 const nodeStatus=(id:string)=>{
  if(!statuses)return tr('Черновик','Draft');
  switch(observed.get(id)){
   case 'COMPLETED':return tr('Выполнено','Completed');
   case 'FAILED':return tr('Ошибка','Failed');
   case 'RUNNING':return tr('Выполняется','Running');
   case 'READY':return tr('Готов','Ready');
   case 'PENDING':return tr('Ожидает','Pending');
   default:return tr('Проверить состояние','Check status');
  }
 };
 const style=(p:Position):React.CSSProperties=>({
  position:'absolute',left:p.x,top:p.y,width:WIDTH,height:HEIGHT,
  background:'var(--card-bg, var(--surface, #f8fafc))',color:'inherit',
  border:'1px solid currentColor',borderRadius:8,padding:'7px 9px',
  textAlign:'left',fontSize:12,boxSizing:'border-box',overflow:'hidden',cursor:onSelect?'pointer':'default'
 });
 const content=(p:Position)=><>
  <strong title={p.id} style={{display:'block',whiteSpace:'nowrap',overflow:'hidden',textOverflow:'ellipsis'}}>{p.id}</strong>
  <span style={{display:'block',fontSize:11}}>{nodeTitle(p.kind)} · {nodeStatus(p.id)}</span>
 </>;
 return <figure aria-label={title} style={{margin:'12px 0',flex:'1 1 100%',minWidth:0,width:'100%',maxWidth:'100%',overflow:'hidden'}}>
  <figcaption style={{fontWeight:600,marginBottom:8}}>{title}</figcaption>
  <div role="region" aria-label={title} tabIndex={0} style={{overflowX:'auto',maxWidth:'100%'}}>
   <div style={{position:'relative',width,height,minWidth:width}}>
    <svg aria-hidden="true" width={width} height={height} viewBox={'0 0 '+width+' '+height}
     style={{position:'absolute',inset:0,pointerEvents:'none'}}>
     {edges.map(edge=>{
      const from=positions.get(edge.from)!,to=positions.get(edge.to)!;
      const x1=from.x+WIDTH,y1=from.y+HEIGHT/2,x2=to.x,y2=to.y+HEIGHT/2,mid=x1+(x2-x1)/2;
      return <path key={edge.edge_id} d={'M '+x1+' '+y1+' C '+mid+' '+y1+' '+mid+' '+y2+' '+x2+' '+y2}
       fill="none" stroke="currentColor" strokeWidth={1.5} opacity={0.45}/>;
     })}
    </svg>
    {positioned.map(p=>onSelect?
     <button type="button" key={p.id} style={style(p)} onClick={()=>onSelect(p.id)}
      aria-label={tr('Открыть шаг ','Open step ')+p.id}>{content(p)}</button>
     :<div key={p.id} style={style(p)}>{content(p)}</div>)}
   </div>
  </div>
  <small>{tr('Схема показывает зависимости. Разрешения и исполнение принадлежат Python Core.',
    'This diagram shows dependencies. Python Core owns permissions and execution.')}</small>
 </figure>;
}
