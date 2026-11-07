import React,{useEffect,useRef,useState} from 'react';
import {createNativeAtlasPort} from './atlas-native.mjs';
import {linkableAtlasProject,linkableAtlasWork} from './atlas-integration.mjs';
import {createCen05NativePort,describeCen05Status,describeCen05Error,presentationMatchesWork} from './cen05-native.mjs';

// Genuine desktop host. Browser preview intentionally has no native authority.
const isDesktop=()=>Boolean((window as any).__TAURI_INTERNALS__);
const invoke=(name:string,args:any)=>(window as any).__TAURI_INTERNALS__.invoke(name,args);
type Session={organizationId:string;generation:string;snapshot:any;sourceKind:'CENTER_LOCAL_PREPARATION'|'PUBLIC_ATLAS_READ_ONLY'};
type View={source:string;revision:string;mode:string;authorization:string;projects:Array<{id:string;name:string;status:string;owner:string;dueDate:string;total:number;done:number;blocked:number;progress:number|null;stages:number;workItems:Array<{id:string;title:string;state:string;dueDate:string;priority:string}>}>;dependencies:Array<{from:string;to:string;kind:string}>};
export default function NativeAtlasPanel({organizationId,onLink,onLinkWork,onObserved}:{organizationId:string;onLink:(ref:{projectId:string;revision:string})=>void;onLinkWork:(ref:{projectId:string;revision:string;workId:string})=>void;onObserved?:(organizationId:string,view:View|null)=>void}){
 const [session,setSession]=useState<Session|null>(null);
 const [view,setView]=useState<View|null>(null);
 const [selected,setSelected]=useState('');
 const [selectedWork,setSelectedWork]=useState('');
 const [projectName,setProjectName]=useState('');
 const [workName,setWorkName]=useState('');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);
 const [presentation,setPresentation]=useState<{organizationId:string;projectId:string;workId:string;revision:string;bindingRef:string}|null>(null);
 const [presentationStatus,setPresentationStatus]=useState('');
 const epoch=useRef(0),locked=useRef(false);
 const observedCallback=useRef(onObserved);
 observedCallback.current=onObserved;
 const port=()=>createNativeAtlasPort(invoke);
 useEffect(()=>{epoch.current++;setSession(null);setView(null);setSelected('');setSelectedWork('');setError('');setProjectName('');setWorkName('');setPresentation(null);setPresentationStatus('');observedCallback.current?.(organizationId,null);},[organizationId]);
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
     setSession(s);setView(next);observedCallback.current?.(organizationId,next);
     const nextSelected=result.projectId??(next.projects.find(x=>x.id===selected)?.id||next.projects[0]?.id||'');
     setSelected(nextSelected);
     const works=next.projects.find(x=>x.id===nextSelected)?.workItems??[];
     setSelectedWork(result.workId&&works.some(x=>x.id===result.workId)?result.workId:
       works.some(x=>x.id===selectedWork)?selectedWork:(works[0]?.id||''));
   }catch(e){if(current===epoch.current)setError(e instanceof Error?e.message:String(e));}
   finally{locked.current=false;setBusy(false);}
 }
 async function present(operation:'open'|'activate'|'return'|'detach') {
   if(locked.current||!session||session.sourceKind!=='PUBLIC_ATLAS_READ_ONLY'||!view)return;
   locked.current=true;setBusy(true);setError('');
   const current=epoch.current;
   try {
     const api=createCen05NativePort(invoke);
     const ref=operation==='open'?linkableAtlasWork(view,selected,selectedWork||selectedProject?.workItems[0]?.id||''):presentation;
     if(!ref)throw Error('Сначала выберите работу Atlas.');
     const request={organizationId,projectId:ref.projectId,workId:ref.workId,revision:ref.revision};
     let result;
     if(operation==='open')result=await api.open(request);
     else if(operation==='activate')result=await api.activate({...request,bindingRef:presentation!.bindingRef});
     else if(operation==='return')result=await api.returnToCenter({...request,bindingRef:presentation!.bindingRef});
     else result=await api.detach({organizationId,bindingRef:presentation!.bindingRef});
     if(current!==epoch.current)return;
     if(operation==='open'&&['WINDOW_OBSERVED','LAUNCHED_NO_WINDOW','BINDING_REUSED'].includes(result.status)){
       setPresentation({...request,bindingRef:result.bindingRef});
     }
     if(operation==='detach'&&result.status==='BINDING_CLOSED')setPresentation(null);
     if(!['WINDOW_OBSERVED','LAUNCHED_NO_WINDOW','BINDING_REUSED','WINDOW_FOCUSED','CENTER_WINDOW_FOCUSED','WORK_SOURCE_NOT_CURRENT','BINDING_CLOSED'].includes(result.status))
       throw Error(result.status);
     // The manager returns to Center even if the readback is stale or fails.
     // Show that return receipt before asking the canonical Atlas owner again.
     if(operation==='return'&&result.status==='WORK_SOURCE_NOT_CURRENT')
       setPresentationStatus(describeCen05Status(operation,result));
     if(operation==='return'){
       // Refresh only the read-only source projection; never silently rewrite
       // an assignment's older revision or an unsaved editor.
       const latest=await port().openPublicAtlas(organizationId);
       if(current!==epoch.current)return;
       const updated=port().view(latest) as View;
       setSession(latest as Session);setView(updated);observedCallback.current?.(organizationId,updated);
     }
     setPresentationStatus(describeCen05Status(operation,result));
   }catch(e){if(current===epoch.current)setError(describeCen05Error(e));}
   finally{locked.current=false;setBusy(false);}
 }
 const selectedProject=view?.projects.find(x=>x.id===selected);
 const selectedWorkRef=session?.sourceKind==='PUBLIC_ATLAS_READ_ONLY'&&view&&
   selectedProject?.workItems.length
   ?linkableAtlasWork(view,selected,selectedWork||selectedProject.workItems[0].id)
   :null;
 const bindingForSelectedWork=presentationMatchesWork(presentation,selectedWorkRef&&{
   organizationId,...selectedWorkRef
 });
 return <div className="card nested-form" data-testid="native-atlas-panel">
   <div className="section-head"><h3>Планы Atlas</h3><div className="inline-form"><button className="primary" disabled={busy} onClick={()=>void act(p=>p.openPublicAtlas(organizationId))} data-testid="native-atlas-public-open">Открыть Atlas Desktop</button><button className="secondary" disabled={busy} onClick={()=>void act(p=>p.open(organizationId))} data-testid="native-atlas-open" aria-label="Открыть локальный Atlas">Локальный план Center</button></div></div>
   <p className="muted">Atlas Desktop читается из исходного нативного каталога этой учётной записи, без копирования проектов. Локальные планы Center — отдельная подготовительная область. Оба просмотра не подтверждают корпоративные полномочия T3.</p>
   {error&&<div className="notice error" role="alert">{error}</div>}
   {session&&view&&<div>
     <p className="muted" data-testid="native-atlas-revision">{session.sourceKind==='PUBLIC_ATLAS_READ_ONLY'?'Atlas Desktop · только чтение':'Локальная подготовка Center'} · редакция портфеля: {view.revision}. Проектов: {view.projects.length}.</p>
     {session.sourceKind!=='PUBLIC_ATLAS_READ_ONLY'&&<form className="inline-form" onSubmit={e=>{e.preventDefault();void act(async p=>{
       const result=await p.addProject(session,{name:projectName,type:'business'});
       setProjectName('');return result;
     });}}>
       <input aria-label="Новый проект Atlas" maxLength={160} value={projectName} onChange={e=>setProjectName(e.target.value)} required placeholder="Название проекта"/>
       <button className="secondary" disabled={busy||!projectName.trim()} data-testid="native-atlas-create-project">Создать проект</button>
     </form>}
     {view.projects.map(p=><button key={p.id} className={`assignment-row ${selected===p.id?'chosen':''}`} onClick={()=>{setSelected(p.id);setSelectedWork(p.workItems[0]?.id||'');}} data-testid="native-atlas-project">
       <span className="row-content"><strong>{p.name}</strong><small>Работ: {p.total}, завершено: {p.done}, заблокировано: {p.blocked}</small></span><span className="status neutral">{p.progress===null?'Без работ':p.progress+'%'}</span>
     </button>)}
     {!!selected&&<>
       {session.sourceKind!=='PUBLIC_ATLAS_READ_ONLY'&&<form className="inline-form" onSubmit={e=>{e.preventDefault();void act(async p=>{
         const result=await p.addWork(session,{projectId:selected,title:workName});
         setWorkName('');return result;
       });}}>
         <input aria-label="Работа Atlas" maxLength={160} value={workName} required onChange={e=>setWorkName(e.target.value)} placeholder="Работа в выбранном проекте"/>
         <button className="secondary" disabled={busy||!workName.trim()} data-testid="native-atlas-add-work">Добавить работу</button>
       </form>}
       <button className="secondary" disabled={busy} onClick={()=>onLink(linkableAtlasProject(view,selected))} data-testid="native-atlas-link">Связать с рабочей областью</button>
       {selectedProject && selectedProject.workItems.length>0 && <div className="inline-form">
         <label>Работа Atlas <select aria-label="Выбранная работа Atlas" value={selectedWork||selectedProject.workItems[0].id} onChange={e=>setSelectedWork(e.target.value)}>
           {selectedProject.workItems.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}
         </select></label>
         <button type="button" className="secondary" disabled={busy} data-testid="native-atlas-work-to-assignment"
           onClick={()=>onLinkWork(linkableAtlasWork(view,selected,selectedWork||selectedProject.workItems[0].id))}>Подготовить поручение по работе</button>
       </div>}
     </>}
     {session.sourceKind==='PUBLIC_ATLAS_READ_ONLY'&&selectedProject&&selectedProject.workItems.length>0&&<div className="nested-form" data-testid="cen05-native-presentation">
       <h4>Открыть установленный Atlas</h4>
       <p className="muted">Работа и редакция проверяются в оригинальном Atlas перед запуском и возвратом. При отсутствии официальной ссылки работа внутри окна не выбирается автоматически.</p>
       <div className="actions">
         <button type="button" className="secondary" disabled={busy||bindingForSelectedWork} data-testid="cen05-u04-open" onClick={()=>void present('open')}>Открыть окно Atlas</button>
         <button type="button" className="secondary" disabled={busy||!bindingForSelectedWork} data-testid="cen05-u04-activate" onClick={()=>void present('activate')}>Фокус Atlas</button>
         <button type="button" className="secondary" disabled={busy||!bindingForSelectedWork} data-testid="cen05-u04-return" onClick={()=>void present('return')}>Вернуться в Center и проверить</button>
         <button type="button" className="secondary" disabled={busy||!presentation} data-testid="cen05-u04-detach" onClick={()=>void present('detach')}>Отсоединить окно</button>
       </div>
       {presentation&&!bindingForSelectedWork&&<p className="muted" data-testid="cen05-u04-context-changed">Выбрана другая работа или редакция Atlas. Нажмите «Открыть окно Atlas», чтобы переключить привязку. Прежнее окно не закрывается.</p>}
       {presentationStatus&&<p className="muted" role="status" data-testid="cen05-u04-status">{presentationStatus}</p>}
     </div>}
     <p className="muted">{session.sourceKind==='PUBLIC_ATLAS_READ_ONLY'?'Связь с работой Atlas Desktop — только черновая ссылка. Выдача требует отдельной проверки источника и полномочий перед подписанием.':'Сохранение локального плана Center не делает его общим проектом Atlas Desktop.'}</p>
   </div>}
 </div>;
}
