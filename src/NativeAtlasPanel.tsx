import React,{useEffect,useRef,useState} from 'react';
import {createNativeAtlasPort} from './atlas-native.mjs';
import {linkableAtlasProject} from './atlas-integration.mjs';

// Genuine desktop host. Browser preview intentionally has no native authority.
const isDesktop=()=>Boolean((window as any).__TAURI_INTERNALS__);
const invoke=(name:string,args:any)=>(window as any).__TAURI_INTERNALS__.invoke(name,args);
type Session={organizationId:string;generation:string;snapshot:any};
type View={source:string;revision:string;mode:string;authorization:string;projects:Array<{id:string;name:string;total:number;done:number;blocked:number;progress:number|null}>};
export default function NativeAtlasPanel({organizationId,onLink}:{organizationId:string;onLink:(ref:{projectId:string;revision:string})=>void}){
 const [session,setSession]=useState<Session|null>(null);
 const [view,setView]=useState<View|null>(null);
 const [selected,setSelected]=useState('');
 const [projectName,setProjectName]=useState('');
 const [workName,setWorkName]=useState('');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const epoch=useRef(0),locked=useRef(false);
 const port=()=>createNativeAtlasPort(invoke);
 useEffect(()=>{epoch.current++;setSession(null);setView(null);setSelected('');setError('');setProjectName('');setWorkName('');},[organizationId]);
 if(!isDesktop())return null;
 async function act(run:(p:ReturnType<typeof createNativeAtlasPort>)=>Promise<any>){
   if(locked.current)return;
   locked.current=true;setBusy(true);setError('');
   const current=epoch.current;
   try{
     const p=port(),result=await run(p),s=result.session??result;
     if(current!==epoch.current)return;
     if(s.organizationId!==organizationId)throw Error('Контекст организации изменился.');
     const next=p.view(s) as View;
     setSession(s);setView(next);
     setSelected(result.projectId??(next.projects.find(x=>x.id===selected)?.id||next.projects[0]?.id||''));
   }catch(e){if(current===epoch.current)setError(e instanceof Error?e.message:String(e));}
   finally{locked.current=false;setBusy(false);}
 }
 return <div className="card nested-form" data-testid="native-atlas-panel">
   <div className="section-head"><h3>Планы организации</h3><button className="primary" disabled={busy} onClick={()=>void act(p=>p.open(organizationId))} data-testid="native-atlas-open">Открыть локальный Atlas</button></div>
   <p className="muted">Проекты сохраняются через оригинальное нативное хранилище Atlas, отдельно для каждой организации. Подтверждение организационных полномочий T3 ещё не подключено.</p>
   {error&&<div className="notice error" role="alert">{error}</div>}
   {session&&view&&<div>
     <p className="muted" data-testid="native-atlas-revision">Редакция портфеля: {view.revision}. Проектов: {view.projects.length}.</p>
     <form className="inline-form" onSubmit={e=>{e.preventDefault();void act(async p=>{
       const result=await p.addProject(session,{name:projectName,type:'business'});
       setProjectName('');return result;
     });}}>
       <input aria-label="Новый проект Atlas" maxLength={160} value={projectName} onChange={e=>setProjectName(e.target.value)} required placeholder="Название проекта"/>
       <button className="secondary" disabled={busy||!projectName.trim()} data-testid="native-atlas-create-project">Создать проект</button>
     </form>
     {view.projects.map(p=><button key={p.id} className={`assignment-row ${selected===p.id?'chosen':''}`} onClick={()=>setSelected(p.id)} data-testid="native-atlas-project">
       <span className="row-content"><strong>{p.name}</strong><small>Работ: {p.total}, завершено: {p.done}, заблокировано: {p.blocked}</small></span><span className="status neutral">{p.progress===null?'Без работ':p.progress+'%'}</span>
     </button>)}
     {!!selected&&<>
       <form className="inline-form" onSubmit={e=>{e.preventDefault();void act(async p=>{
         const result=await p.addWork(session,{projectId:selected,title:workName});
         setWorkName('');return result;
       });}}>
         <input aria-label="Работа Atlas" maxLength={160} value={workName} required onChange={e=>setWorkName(e.target.value)} placeholder="Работа в выбранном проекте"/>
         <button className="secondary" disabled={busy||!workName.trim()} data-testid="native-atlas-add-work">Добавить работу</button>
       </form>
       <button className="secondary" disabled={busy} onClick={()=>onLink(linkableAtlasProject(view,selected))} data-testid="native-atlas-link">Связать с рабочей областью</button>
     </>}
     <p className="muted">Сохранение и повторное чтение проверяются нативным Atlas. Это локальная подготовка, не корпоративная приёмка или T3-допуск.</p>
   </div>}
 </div>;
}
