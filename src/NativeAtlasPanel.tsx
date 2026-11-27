import React,{useEffect,useMemo,useRef,useState} from 'react';
import {createNativeAtlasPort,readNativeAtlasPlan} from './atlas-native.mjs';
import {linkableAtlasProject,linkableAtlasWork,selectAtlasTargetWorkspace,atlasWorkspaceBindingMatches,selectAtlasAfterRead} from './atlas-integration.mjs';
import {createCen05NativePort,describeCen05Status,describeCen05Error,presentationMatchesWork} from './cen05-native.mjs';
import {selectAcceptedAtlasWork} from './atlas-result-context.mjs';
import type {AcceptedAtlasFocus} from './atlas-result-context.mjs';

// Genuine desktop host. Browser preview intentionally has no native authority.
const isDesktop=()=>Boolean((window as any).__TAURI_INTERNALS__);
const invoke=(name:string,args:any)=>(window as any).__TAURI_INTERNALS__.invoke(name,args);
type Session={organizationId:string;generation:string;snapshot:any;sourceKind:'CENTER_LOCAL_PREPARATION'|'PUBLIC_ATLAS_READ_ONLY'};
type View={source:string;revision:string;mode:string;authorization:string;projects:Array<{id:string;name:string;status:string;owner:string;dueDate:string;total:number;done:number;blocked:number;progress:number|null;stages:number;workItems:Array<{id:string;title:string;state:string;dueDate:string;priority:string;assignee:string;resourceId:string|null;resourceLabel:string;allocationPct:number|null}>}>;dependencies:Array<{from:string;to:string;kind:string}>};
type PlanView={projectId:string;revision:string;projectedFinish:string|null;deadlineSlipDays:number|null;
 totals:{ready:number;waiting:number;review:number;blocked:number;no_dates:number};
 works:Array<{id:string;label:string;startDate:string|null;finishDate:string|null;reasons:string[];
  resource:{id:string;label:string;allocationPct:number}|null}>;note:string};
type EditionComparison=Awaited<ReturnType<ReturnType<typeof createNativeAtlasPort>['comparePublicAtlasWork']>>;
type EditionWork=NonNullable<NonNullable<EditionComparison['original']>['work']>;
const workStates:Record<string,string>={todo:'Не начата',in_progress:'В работе',blocked:'Заблокирована',done:'Завершена'};
const priorities:Record<string,string>={low:'Низкий',normal:'Обычный',high:'Высокий',critical:'Критический'};
function WorkEditionTable({comparison}:{comparison:EditionComparison}){
 const before=comparison.original?.work,after=comparison.current?.work;
 const rows:Array<{label:string;keys:string[];value:(work:EditionWork)=>string|null}>=[
  {label:'Название',keys:['title'],value:w=>w.title},
  {label:'Состояние',keys:['state'],value:w=>workStates[w.state]??w.state},
  {label:'Приоритет',keys:['priority'],value:w=>priorities[w.priority]??w.priority},
  {label:'Плановое начало',keys:['plannedStart'],value:w=>w.plannedStart},
  {label:'Расчётное завершение',keys:['plannedFinish'],value:w=>w.plannedFinish},
  {label:'Установленный срок',keys:['dueDate'],value:w=>w.dueDate},
  {label:'Длительность, дн.',keys:['estimateDays'],value:w=>String(w.estimateDays)},
  {label:'Записанное фактическое начало',keys:['actualStart'],value:w=>w.actualStart},
  {label:'Записанное фактическое завершение',keys:['actualFinish'],value:w=>w.actualFinish},
  {label:'Исполнитель в плане',keys:['assignee'],value:w=>w.assignee||null},
  {label:'Ресурс',keys:['resource'],value:w=>w.resource?w.resource.label+' ('+w.resource.allocationPct+'%)':null},
  {label:'Зависимости',keys:['predecessors','successors'],value:w=>w.predecessors.length+' предшествующих, '+w.successors.length+' последующих'},
  {label:'Расчётное завершение проекта',keys:['projectedProjectFinish'],value:w=>w.projectedProjectFinish}
 ];
 return <div data-testid="atlas-work-edition-comparison">
   <p className="muted">{comparison.originalStatus==='NOT_RETAINED'?
     'Исходная редакция не найдена в сохранённой истории Atlas. Исторические значения не восстановлены.':
     comparison.originalStatus!=='FOUND'?'Работа отсутствует в указанной исходной редакции.':
     'Исходная редакция прочитана из оригинального хранилища Atlas.'}</p>
   {comparison.current?.status!=='FOUND'&&<p>Работа отсутствует в текущем плане. Другая работа не подставляется.</p>}
   {(before||after)&&<div style={{overflowX:'auto'}}><table style={{width:'100%',borderCollapse:'collapse',fontSize:'0.9em'}}>
    <thead><tr><th scope="col" style={{textAlign:'left'}}>Показатель</th>
     <th scope="col" style={{textAlign:'left'}}>При выдаче ({comparison.sourceRevision})</th>
     <th scope="col" style={{textAlign:'left'}}>Сейчас ({comparison.current?.revision})</th></tr></thead>
    <tbody>{rows.map(row=>{
      const changed=row.keys.some(k=>comparison.changedFields.includes(k));
      return <tr key={row.label} style={{borderTop:'1px solid var(--border, #b0b0b0)'}}>
       <th scope="row" style={{textAlign:'left',fontWeight:400,padding:'6px 4px'}}>{row.label}</th>
       <td style={{padding:'6px 4px'}}>{before?(row.value(before)||'Не указано'):'Нет данных'}</td>
       <td style={{padding:'6px 4px',fontWeight:changed?600:400}}>{after?(row.value(after)||'Не указано'):'Нет данных'}
        {changed&&<small style={{display:'block'}}>Изменилось</small>}</td>
      </tr>;
    })}</tbody>
   </table></div>}
   <small className="muted">Даты расчёта принадлежат Atlas. Фактические даты показаны только при их записи в плане, не выводятся из текста Result.</small>
 </div>;
}
type WorkspaceChoice={id:string;name:string;atlasRef?:{projectId:string;revision:string}|null};
export default function NativeAtlasPanel({organizationId,workspaces,targetWorkspaceId,onChooseWorkspace,onLink,onLinkWork,onObserved,participants,resourceBindings,onBindResource,resultFocus=null,onClearResultFocus,onReturnToResult}:{
 organizationId:string;workspaces:WorkspaceChoice[];targetWorkspaceId:string;onChooseWorkspace:(id:string)=>void;
 onLink:(ref:{projectId:string;revision:string},workspaceId:string)=>boolean;
 onLinkWork:(ref:{projectId:string;revision:string;workId:string},workspaceId:string,source:View)=>void;
 participants:{id:string;name:string}[];
 resourceBindings:{resourceId:string;participantId:string}[];
 onBindResource:(ref:{projectId:string;revision:string;workId:string},workspaceId:string,participantId:string,source:View)=>void;
 onObserved?:(organizationId:string,view:View|null)=>void;
 resultFocus?:AcceptedAtlasFocus|null;onClearResultFocus?:()=>void;onReturnToResult?:()=>void}){
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
 const [preparationExportStatus,setPreparationExportStatus]=useState('');
 const [editionComparison,setEditionComparison]=useState<EditionComparison|null>(null);
 const [editionError,setEditionError]=useState('');
 const epoch=useRef(0),locked=useRef(false);
 const observedCallback=useRef(onObserved);
 observedCallback.current=onObserved;
 const port=()=>createNativeAtlasPort(invoke);
 useEffect(()=>{epoch.current++;setSession(null);setView(null);setSelected('');setSelectedWork('');setError('');setProjectName('');setWorkName('');setPresentation(null);setPresentationStatus('');setPreparationExportStatus('');setEditionComparison(null);setEditionError('');observedCallback.current?.(organizationId,null);return()=>{epoch.current++;};},[organizationId]);
 const planning=useMemo<{plan:PlanView|null;error:string}>(()=>{
   if(!session||!selected||!session.snapshot.projects.some((p:any)=>p.id===selected))
     return {plan:null,error:''};
   try{return {plan:readNativeAtlasPlan(session,selected) as PlanView,error:''};}
   catch{return {plan:null,error:'Расчёт плана Atlas недоступен для этой редакции.'};}
 },[session,selected]);
 // Defer the first read until the mounted organization is established.
 // The StrictMode probe's discarded effect cannot consume the real request.
 useEffect(()=>{
   if(!isDesktop()||!resultFocus||resultFocus.organizationId!==organizationId)return;
   let active=true;
   queueMicrotask(()=>{if(active)void act(p=>p.openPublicAtlas(organizationId),resultFocus.workRef);});
   return ()=>{active=false;};
 },[resultFocus,organizationId]);
 if(!isDesktop())return null;
 async function exportPreparation(){
   if(locked.current||session?.sourceKind!=='CENTER_LOCAL_PREPARATION')return;
   locked.current=true;setBusy(true);setError('');setPreparationExportStatus('');
   const current=epoch.current;
   try{
     const result=await port().exportPreparation(session);
     if(current===epoch.current&&result!==null)
       setPreparationExportStatus(result+'. Откройте файл в Atlas, выберите «Добавить проекты в черновик» и сохраните портфель.');
   }catch(e){
     if(current===epoch.current)setError(e instanceof Error?e.message:String(e));
   }finally{locked.current=false;setBusy(false);}
 }
 async function refreshEdition(p:ReturnType<typeof createNativeAtlasPort>,s:Session,current:number){
   if(current!==epoch.current)return;
   setEditionComparison(null);setEditionError('');
   if(!resultFocus||s.sourceKind!=='PUBLIC_ATLAS_READ_ONLY'||s.organizationId!==resultFocus.organizationId)return;
   try{
     const compared=await p.comparePublicAtlasWork(s,resultFocus.workRef);
     if(current===epoch.current)setEditionComparison(compared);
   }catch(e){
     if(current===epoch.current){
       const code=e instanceof Error?e.message:String(e);
       setEditionError(code.includes('ATLAS_HISTORY_HEAD_CHANGED')?
         'План изменился во время чтения истории. Перечитайте связанную работу.':
         'Исходная редакция не подтверждена. '+code);
     }
   }
 }
 async function act(run:(p:ReturnType<typeof createNativeAtlasPort>)=>Promise<any>,
   focusRef?:AcceptedAtlasFocus['workRef']){
   if(locked.current)return;
   locked.current=true;setBusy(true);setError('');
   const current=epoch.current;
   try{
     setEditionComparison(null);setEditionError('');
     const p=port(),result=await run(p),s=result.session??result;
     if(current!==epoch.current)return;
     if(s.organizationId!==organizationId)throw Error('Контекст организации изменился.');
     const next=p.view(s) as View;
     setSession(s);setView(next);
     observedCallback.current?.(organizationId,s.sourceKind==='PUBLIC_ATLAS_READ_ONLY'?next:null);
     const selection=focusRef&&s.sourceKind==='PUBLIC_ATLAS_READ_ONLY'?
       selectAcceptedAtlasWork(next,focusRef):selectAtlasAfterRead(next,{projectId:selected,workId:selectedWork},{
       sameSource:session?.sourceKind===s.sourceKind,createdProjectId:result.projectId,createdWorkId:result.workId
     });
     setSelected(selection.projectId);setSelectedWork(selection.workId);
     await refreshEdition(p,s,current);
   }catch(e){if(current===epoch.current)setError(e instanceof Error?e.message:String(e));}
   finally{locked.current=false;setBusy(false);}
 }
 async function present(operation:'open'|'activate'|'return'|'detach',exactSelection?:{projectId:string;workId:string}) {
   if(locked.current||!session||session.sourceKind!=='PUBLIC_ATLAS_READ_ONLY'||!view)return;
   locked.current=true;setBusy(true);setError('');
   const current=epoch.current;
   try {
     const api=createCen05NativePort(invoke);
     const ref=operation==='open'?linkableAtlasWork(view,exactSelection?.projectId??selected,exactSelection?.workId??selectedWork):presentation;
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
       setEditionComparison(null);setEditionError('');
       const p=port();
       const latest=await p.openPublicAtlas(organizationId);
       if(current!==epoch.current)return;
       const updated=p.view(latest) as View;
       setSession(latest as Session);setView(updated);observedCallback.current?.(organizationId,updated);
       const selection=resultFocus?
         selectAcceptedAtlasWork(updated,resultFocus.workRef):
         selectAtlasAfterRead(updated,{projectId:selected,workId:selectedWork},{sameSource:true});
       setSelected(selection.projectId);setSelectedWork(selection.workId);
       await refreshEdition(p,latest as Session,current);
     }
     setPresentationStatus(describeCen05Status(operation,result));
   }catch(e){if(current===epoch.current)setError(describeCen05Error(e));}
   finally{locked.current=false;setBusy(false);}
 }
 const selectedProject=view?.projects.find(x=>x.id===selected);
 const projectRef=view&&selectedProject?linkableAtlasProject(view,selected):null;
 const target=selectAtlasTargetWorkspace(workspaces,targetWorkspaceId,projectRef) as WorkspaceChoice|null;
 const bindingCurrent=atlasWorkspaceBindingMatches(target,projectRef);
 const selectedWorkRef=session?.sourceKind==='PUBLIC_ATLAS_READ_ONLY'&&view&&
   selectedProject?.workItems.some(w=>w.id===selectedWork)
   ?linkableAtlasWork(view,selected,selectedWork)
   :null;
 const selectedPlanWork=planning.plan?.works.find(w=>w.id===selectedWork);
 const resourceId=selectedPlanWork?.resource?.id;
 const boundParticipantId=resourceBindings.find(row=>row.resourceId===resourceId)?.participantId??'';
 const hasSelectedWork=!!selectedProject?.workItems.some(w=>w.id===selectedWork);
 const resultWork=resultFocus&&session?.sourceKind==='PUBLIC_ATLAS_READ_ONLY'&&view?
   view.projects.find(p=>p.id===resultFocus.workRef.projectId)?.workItems.find(w=>w.id===resultFocus.workRef.workId):null;
 const resultComparison=resultFocus&&session?.sourceKind==='PUBLIC_ATLAS_READ_ONLY'&&view?
   selectAcceptedAtlasWork(view,resultFocus.workRef):null;
 const bindingForSelectedWork=presentationMatchesWork(presentation,selectedWorkRef&&{
   organizationId,...selectedWorkRef
 });
 return <div className="card nested-form" data-testid="native-atlas-panel">
   <div className="section-head"><h3>Планы Atlas</h3><div className="inline-form"><button className="primary" disabled={busy} onClick={()=>void act(p=>p.openPublicAtlas(organizationId))} data-testid="native-atlas-public-open">Открыть Atlas Desktop</button><button className="secondary" disabled={busy} onClick={()=>void act(p=>p.open(organizationId))} data-testid="native-atlas-open" aria-label="Открыть локальный Atlas">Локальный план Center</button></div></div>
   <p className="muted">Atlas Desktop читается из исходного нативного каталога этой учётной записи, без копирования проектов. Локальные планы Center — отдельная подготовительная область и не используются для проверки ссылок на установленный Atlas. Просмотр не подтверждает корпоративные полномочия T3.</p>
   {resultFocus&&<div className="nested-form" data-testid="native-atlas-accepted-result">
     <div className="section-head"><h3>Принятый результат и исходный план</h3>
       <button type="button" className="secondary" disabled={busy} onClick={onClearResultFocus}>Завершить сопоставление</button>
     </div>
     <p>Поручение {resultFocus.taskId}. Исходная редакция плана: {resultFocus.workRef.revision}.</p>
     <p><strong>{resultFocus.resultTruncated?'Фрагмент принятого результата':'Принятый результат'}</strong></p>
     <p style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{resultFocus.resultExcerpt}{resultFocus.resultTruncated?'…':''}</p>
     {!resultComparison?<p>Перечитайте установленный Atlas для сравнения.</p>:
       resultWork?<>
         <p><strong>{resultWork.title}</strong> · состояние: {resultWork.state} · срок: {resultWork.dueDate||'не указан'}</p>
         <p role="status">{resultComparison.status==='SOURCE_REVISION_MATCHES'?
           'Исходная редакция совпадает с текущим планом.':
           'Текущая редакция '+view!.revision+' отличается от исходной. Проверьте изменения перед корректировкой.'}</p>
       </>:<p role="status">Исходная работа или проект больше не найдены. Другая работа автоматически не выбирается.</p>}
     {editionComparison&&<WorkEditionTable comparison={editionComparison}/>}
     {editionError&&<p role="status" data-testid="atlas-work-edition-unavailable">{editionError}</p>}
     <button type="button" className="secondary" disabled={busy}
       onClick={()=>void act(p=>p.openPublicAtlas(organizationId),resultFocus.workRef)}>Перечитать связанную работу</button>
     {resultWork&&resultComparison&&<button type="button" className="secondary" disabled={busy}
       data-testid="native-atlas-open-result-work" onClick={()=>{
         setSelected(resultComparison.projectId);setSelectedWork(resultComparison.workId);
         void present('open',resultComparison);
       }}>Открыть текущую редакцию этой работы в Atlas</button>}
     {onReturnToResult&&<button type="button" className="secondary" disabled={busy}
       data-testid="native-atlas-return-to-result" onClick={onReturnToResult}>Вернуться к принятому Result</button>}
     <small className="muted">Принятый Result остаётся у оригинального T3. Здесь показано сопоставление; план не изменяется автоматически.</small>
   </div>}
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
     {session.sourceKind==='CENTER_LOCAL_PREPARATION'&&<div className="inline-form">
       <button type="button" className="secondary" disabled={busy||!view.projects.length}
         data-testid="native-atlas-export-preparation" onClick={()=>void exportPreparation()}>
         Сохранить подготовленные проекты .iwxa
       </button>
       {preparationExportStatus&&<p role="status" className="muted">{preparationExportStatus}</p>}
     </div>}
     {view.projects.map(p=><button key={p.id} className={`assignment-row ${selected===p.id?'chosen':''}`} disabled={busy} onClick={()=>{setSelected(p.id);setSelectedWork(p.workItems[0]?.id||'');}} data-testid="native-atlas-project">
       <span className="row-content"><strong>{p.name}</strong><small>Работ: {p.total}, завершено: {p.done}, заблокировано: {p.blocked}</small></span><span className="status neutral">{p.progress===null?'Без работ':p.progress+'%'}</span>
     </button>)}
     {planning.error&&<p className="muted" role="status">{planning.error}</p>}
     {planning.plan&&<div className="nested-form" data-testid="native-atlas-planning-overview">
       <p><strong>Расчёт плана Atlas</strong> · завершение: {planning.plan.projectedFinish??'не определено'}
         {planning.plan.deadlineSlipDays!==null&&planning.plan.deadlineSlipDays>0&&
           <> · отклонение: +{planning.plan.deadlineSlipDays} дн.</>}</p>
       <p className="muted">Готовы по плану: {planning.plan.totals.ready}; ждут предшественников: {planning.plan.totals.waiting};
         требуют проверки ресурсов: {planning.plan.totals.review}; заблокированы: {planning.plan.totals.blocked};
         без расчётных дат: {planning.plan.totals.no_dates}.</p>
       {selectedPlanWork&&<div data-testid="native-atlas-selected-work-plan">
         <strong>{selectedPlanWork.label}</strong>
         <p className="muted">{selectedPlanWork.startDate??'Начало не определено'} / {selectedPlanWork.finishDate??'Завершение не определено'}
           {selectedPlanWork.resource&&<> · {selectedPlanWork.resource.label} ({selectedPlanWork.resource.allocationPct}%)</>}</p>
         {!!selectedPlanWork.reasons.length&&<p className="muted">{selectedPlanWork.reasons.join('; ')}</p>}
         {selectedWorkRef&&resourceId&&view&&<div className="inline-form">
           <label>Сотрудник для планового ресурса
             <select value={boundParticipantId} disabled={busy||!target||!bindingCurrent}
               data-testid="native-atlas-resource-participant"
               onChange={e=>{if(target&&bindingCurrent)onBindResource(selectedWorkRef,target.id,e.target.value,view);}}>
               <option value="">Не связан с сотрудником</option>
               {participants.map(person=><option key={person.id} value={person.id}>{person.name}</option>)}
             </select>
           </label>
           <small className="muted">Связь используется в новых черновиках этой организации, но не выдаёт полномочия.</small>
         </div>}
       </div>}
       <p className="muted">{planning.plan.note}</p>
     </div>}
     {!!selected&&<>
       {session.sourceKind!=='PUBLIC_ATLAS_READ_ONLY'&&<form className="inline-form" onSubmit={e=>{e.preventDefault();void act(async p=>{
         const result=await p.addWork(session,{projectId:selected,title:workName});
         setWorkName('');return result;
       });}}>
         <input aria-label="Работа Atlas" maxLength={160} value={workName} required onChange={e=>setWorkName(e.target.value)} placeholder="Работа в выбранном проекте"/>
         <button className="secondary" disabled={busy||!workName.trim()} data-testid="native-atlas-add-work">Добавить работу</button>
       </form>}
       <label>Целевая рабочая область Atlas
         <select aria-label="Целевая рабочая область Atlas" data-testid="native-atlas-workspace"
           value={target?.id??''} disabled={busy} onChange={e=>onChooseWorkspace(e.target.value)}>
           <option value="">Выберите рабочую область</option>
           {workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}
         </select>
       </label>
       <p role="status" data-testid="native-atlas-binding-status">
         {bindingCurrent?'Связь с выбранной редакцией подтверждена в черновике':
           target?'Связь с выбранной редакцией пока не установлена':'Выберите целевую рабочую область'}
       </p>
       <button type="button" className="secondary" disabled={busy||!target||!projectRef||bindingCurrent}
         onClick={()=>{if(target&&projectRef&&onLink(projectRef,target.id))onChooseWorkspace(target.id);}}
         data-testid="native-atlas-link">Связать с рабочей областью</button>
       {selectedProject && selectedProject.workItems.length>0 && <div className="inline-form">
         <label>Работа Atlas <select aria-label="Выбранная работа Atlas" value={selectedWork} disabled={busy} onChange={e=>setSelectedWork(e.target.value)}>
           <option value="">Выберите работу</option>
           {selectedProject.workItems.map(item=><option key={item.id} value={item.id}>{item.title}</option>)}
         </select></label>
         <button type="button" className="secondary" disabled={busy||!target||!bindingCurrent||!hasSelectedWork} data-testid="native-atlas-work-to-assignment"
           onClick={()=>{if(target&&bindingCurrent&&hasSelectedWork)onLinkWork(linkableAtlasWork(view,selected,selectedWork),target.id,view);}}>Подготовить поручение по работе</button>
       </div>}
     </>}
     {session.sourceKind==='PUBLIC_ATLAS_READ_ONLY'&&selectedProject&&selectedProject.workItems.length>0&&<div className="nested-form" data-testid="cen05-native-presentation">
       <h4>Открыть установленный Atlas</h4>
       <p className="muted">При новом запуске Atlas получает ссылку на выбранную сохранённую работу. Если окно уже открыто, используйте ссылку ниже в разделе «Сохранение и копии» Atlas. Редакция проверяется при открытии и возврате.</p>
       {selectedWorkRef&&<details>
         <summary>Ссылка на выбранную работу</summary>
         <label>Скопируйте ссылку для открытого Atlas
           <textarea readOnly rows={3} aria-label="Ссылка на выбранную работу Atlas"
             data-testid="cen05-work-reference"
             value={JSON.stringify(selectedWorkRef)} onFocus={event=>event.currentTarget.select()}/>
         </label>
       </details>}
       <div className="actions">
         <button type="button" className="secondary" disabled={busy||!selectedWorkRef||bindingForSelectedWork} data-testid="cen05-u04-open" onClick={()=>void present('open')}>Открыть окно Atlas</button>
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
