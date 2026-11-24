import React, {useEffect, useRef, useState} from 'react';
import {emptyDraft, applyDraftCommand, decodeDraft, encodeDraft, overview} from './organization.mjs';
import {linkableAtlasProject, linkableAtlasWork, atlasLinkReadback, atlasWorkReadback, compareAtlasSourceCopies, selectAtlasReferenceSource, selectAtlasTargetWorkspace, atlasWorkspaceBindingMatches} from './atlas-integration.mjs';
import {readAtlasSourceFile} from './atlas-file-import.mjs';
import NativeAtlasPanel from './NativeAtlasPanel';
import CorporatePanel from './CorporatePanel';
import ManagerContextPanel from './ManagerContextPanel';
import AdminDashboard, {AdminCompanyStructure} from './AdminDashboard';
import AdminResultRoute from './AdminResultRoute';
import {retainSignedWorkspaceForPage,mayOpenSignedWorkspaceOnPage} from './signed-workspace-navigation.mjs';
import type {ManagerOriginalSelection} from './manager-original-selection';
import Cen04LicensePanel from './Cen04LicensePanel';
import AgeExchangePanel from './AgeExchangePanel';
import iwxaBrandMark from './assets/iwxa-admin-center.svg?url';
import './style.css';
import './admin-v8.css';

type Participant = {id: string; name: string; roleLabel: string; credentialState: string; personalAgentPlan?: 'NONE'|'PLANNED'};
type AtlasRef = {projectId:string;revision:string;workId?:string};
type SourceResultRef={organizationId:string;workspaceId:string;taskId:string;taskRevisionId:string;resultRevisionId:string;acceptanceId:string};
type Assignment = {sourceResultRef?:SourceResultRef|null;id: string; title: string; workspaceId: string; assigneeId: string | null; reviewerId: string | null; description: string; criteria: string; dueDate: string; priority: string; editNumber: number; status: string; atlasRef: AtlasRef|null; createdAt: string; updatedAt: string};
type Organization = {id: string; name: string; kind: string; workspaces: {id: string; name: string; atlasRef?: AtlasRef|null}[]; participants: Participant[]; assignments: Assignment[]};
type Draft = {format: string; version: number; organizations: Organization[]; activeOrganizationId: string | null; updatedAt: string};
type AtlasPortfolioView = {source:string;revision:string;authorization:string;mode:string;projects:Array<{id:string;name:string;status:string;owner:string;dueDate:string;total:number;done:number;blocked:number;progress:number|null;stages:number;workItems:Array<{id:string;title:string;state:string;dueDate:string;priority:string}>}>;dependencies:Array<{from:string;to:string;kind:string}>};
type AtlasCopyDelta={previousRevision:string;revision:string;sharedProjects:number;addedProjects:number;removedProjects:number;changedProjects:number;addedWorks:number;removedWorks:number;changedWorks:number;changedDependencies:number;revisionRelation:string;contentChanged:boolean};
type Editor = {sourceResultRef:SourceResultRef|null;assignmentId?: string; expectedEditNumber?: number; title: string; workspaceId: string; assigneeId: string; reviewerId: string; description: string; criteria: string; dueDate: string; priority: string; atlasRef: AtlasRef|null};
type Page = 'overview'|'context'|'work'|'results'|'resources'|'people'|'programs'|'data';
type InspectorPreview = {key:string;kind:'assignment'|'person'|'workspace'|'atlas-project';id:string;organizationId:string;label:string};
const pages: [Page, string, string][] = [['overview','Главная','⌂'],['context','Контекст организации','◎'],['work','Поручения','☷'],['results','Результаты','▤'],['people','Сотрудники и роли','♧'],['resources','Планы Atlas','◇'],['programs','Personal Agent и лицензии','▦'],['data','Профиль и данные','◈']];
const workStatusLabels:Record<string,string>={
  NOT_OBSERVED:'Источник Atlas не открыт - редакция не проверена.',
  WORK_NOT_LINKED:'В поручении пока не выбрана работа Atlas.',
  PROJECT_MISSING_IN_SOURCE:'Проект отсутствует в открытом Atlas.',
  WORK_MISSING_IN_SOURCE:'Работа отсутствует в открытом проекте.',
  SOURCE_REVISION_CHANGED:'План Atlas изменился - проверьте связь перед выдачей.',
  SOURCE_REVISION_MATCHES:'Работа и редакция совпадают с открытым Atlas. Права T3 не проверены.'
};
const initialEditor = (org: Organization): Editor => ({title:'', workspaceId: org.workspaces[0]?.id ?? '', assigneeId: org.participants[0]?.id ?? '', reviewerId: org.participants[1]?.id ?? org.participants[0]?.id ?? '', description:'', criteria:'', dueDate:'', priority:'normal',atlasRef:org.workspaces[0]?.atlasRef??null,sourceResultRef:null});
const errors: Record<string,string> = {
  DRAFT_FORMAT_INVALID:'Это не файл черновиков Admin Center.',
  DRAFT_JSON_INVALID:'Файл повреждён или имеет неподдерживаемый формат.',
  DRAFT_SIZE_INVALID:'Файл черновиков превышает допустимый размер.',
  DRAFT_EDIT_CONFLICT:'Поручение изменилось. Откройте его актуальный черновик.',
  ORGANIZATION_CONTEXT_CHANGED:'Выбрана другая организация. Откройте поручение заново.',
  DUE_DATE_INVALID:'Проверьте дату выполнения.',
  DRAFT_AUTHORITY_CLAIM_DENIED:'Черновик не может содержать подтверждённые корпоративные решения.',
  DRAFT_CREDENTIAL_CLAIM_DENIED:'В этом файле допустимы контакты, но не выданные полномочия.',
  ACTIVE_ORGANIZATION_INVALID:'В файле отсутствует выбранная организация.',
  ATLAS_REFERENCE_INVALID:'Укажите идентификатор и редакцию проекта Atlas.',
  AGENT_SEAT_PLAN_INVALID:'Не удалось изменить план доступа к Personal Agent.',
  ATLAS_SNAPSHOT_INVALID:'Не удалось прочитать портфель Atlas. Выберите корректный файл экспорта.',
  ATLAS_SNAPSHOT_SIZE_INVALID:'Файл Atlas слишком велик для предварительного просмотра.',
  ATLAS_SOURCE_FILE_INVALID:'Выберите архив проектов .iwxa или ранее сохранённую копию JSON.',
  ATLAS_SOURCE_FILE_SIZE_INVALID:'Файл проекта пуст или превышает допустимый размер.',
  ATLAS_SOURCE_IWXA_INVALID:'Не удалось открыть архив .iwxa. Файл повреждён или содержит неподдерживаемые данные.',
  ATLAS_SOURCE_DIGEST_UNAVAILABLE:'Не удалось сравнить содержимое архива на этом компьютере.',
  ATLAS_PROJECT_NOT_IN_PREVIEW:'Выбранный проект отсутствует в открытом портфеле Atlas.',
  ATLAS_WORK_NOT_IN_PREVIEW:'Выбранная работа отсутствует в открытом проекте Atlas.'
};

async function nativeInvoke(command: string, args?: Record<string, unknown>): Promise<any> {
  const internal = (window as any).__TAURI_INTERNALS__;
  if (!internal) throw Error('NATIVE_HOST_UNAVAILABLE');
  return internal.invoke(command, args);
}
function V8RailIcon({name}:{name:Page}) {
 const paths:Record<Page,string>={
  overview:'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  context:'M12 3 2.7 8.4 12 13.8l9.3-5.4L12 3z M3 13l9 5.3 9-5.3 M3 17.3 12 22l9-4.7',
  work:'M5 3h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2z M7.5 12l3 3 6-6',
  results:'M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z M14 2v6h6 M8 12h8 M8 16h8',
  people:'M12 21a9 9 0 1 0-9-9c0 1.7.5 3.1 1.2 4.3L3 21l4.7-1.2A9 9 0 0 0 12 21z',
  resources:'M3 6h7l2.3 2H21v11H3V6z',
  programs:'M12 3v3 M4 10h16v10H4V10z M9 14v2 M15 14v2 M8 6h8a4 4 0 0 1 4 4H4a4 4 0 0 1 4-4z',
  data:'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16z'
 };
 return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
  strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
  <path d={paths[name]}/>
 </svg>;
}

export default function App() {
  const nativeHost = Boolean((window as any).__TAURI_INTERNALS__);
  const [nativeRestoring,setNativeRestoring] = useState(nativeHost);
  const [state,setState] = useState<Draft>(() => emptyDraft() as Draft);
  const [page,setPage] = useState<Page>('overview');
  const mainScrollRef=useRef<HTMLElement|null>(null);
  // Desktop navigation is not a website. A new section or organization
  // opens from the top, rather than inheriting the previous long-form scroll.
  React.useLayoutEffect(()=>{
    if(mainScrollRef.current)mainScrollRef.current.scrollTop=0;
  },[page,state.activeOrganizationId]);
  const [managerOriginal,setManagerOriginal]=useState<ManagerOriginalSelection|null>(null);
  const [focusedEmployeeContact,setFocusedEmployeeContact]=useState<string|null>(null);
  const [seatRouteOrganization,setSeatRouteOrganization]=useState<string|null>(null);
  useEffect(()=>setSeatRouteOrganization(null),[state.activeOrganizationId]);
  // UI-only presence of the original signed child WebView; signing state,
  // Control bearer and Kernel remain owned by the private installed Host.
  const [signedWorkspaceOrg,setSignedWorkspaceOrg] = useState<string|null>(null);
  const [signedWorkspaceVisible,setSignedWorkspaceVisible] = useState(false);
  const checkedNativeChildFor=useRef<string|null>(null);
  // Native WebView close releases its ORIGINAL signed D3 owner. Refresh the
  // existing corporate panel so APPLY cannot remain shown from a stale
  // Kernel binding; the authoritative capabilities are read from T3 again.
  const [signedWorkspaceGeneration,setSignedWorkspaceGeneration] = useState(0);
  useEffect(()=>{
    if(!nativeHost)return;
    let live=true,unlisten:(()=>void)|null=null;
    void import('@tauri-apps/api/event')
      .then(({listen})=>listen('iwxa:d3-signed-workspace-closed',()=>{
        if(live){
          setSignedWorkspaceOrg(null);
          setSignedWorkspaceVisible(false);
          setSignedWorkspaceGeneration(value=>value+1);
        }
      }))
      .then(dispose=>{if(live)unlisten=dispose;else dispose();})
      .catch(()=>{/* The native close still revokes the original session. */});
    return ()=>{live=false;unlisten?.();};
  },[nativeHost]);
  const [editor,setEditor] = useState<Editor|null>(null);
  const [creatingOrg,setCreatingOrg] = useState(false);
  const [menuOpen,setMenuOpen] = useState(false);
  const [navQuery,setNavQuery]=useState('');
  const [v8Menu,setV8Menu]=useState('');
  const [inspectorVisible,setInspectorVisible]=useState(false);
  const [inspectorTab,setInspectorTab]=useState<'context'|'tasks'|'sources'|'selected'>('context');
  const [inspectorPreviews,setInspectorPreviews]=useState<InspectorPreview[]>([]);
  const [activePreviewKey,setActivePreviewKey]=useState('');
  const [inspectorWidth,setInspectorWidth]=useState(()=>{
    try{const width=Number(localStorage.getItem('iwxa.admin-center.v8.inspector.width'));
      return Number.isFinite(width)&&width>=310&&width<=680?width:355;}
    catch{return 355;}
  });
  const inspectorPointer=useRef<{x:number;width:number}|null>(null);
  const navigationHistory=useRef<Page[]>(['overview']);
  const navigationCursor=useRef(0);
  const [navigationVersion,setNavigationVersion]=useState(0);
  const [dirty,setDirty] = useState(false);
  const [saving,setSaving] = useState(false);
  const revisionRef = useRef(0);
  const savingRef = useRef(false);
  const editorBaselineRef = useRef<string|null>(null);
  const pendingCloseRef = useRef(false);
  const closeDialogOpenRef = useRef(false);
  const closeConfirmedRef = useRef(false);
  // A file preview belongs only to the organization where it was opened.
  // It must never become a cross-organization project/authorization source.
  const [atlasFile,setAtlasFile] = useState<{organizationId:string;view:AtlasPortfolioView;filename:string;delta:AtlasCopyDelta|null;contentSha256:string;contentSame:boolean|null}|null>(null);
  const atlasFileRequest=useRef(0);
  const [atlasObservationMode,setAtlasObservationMode]=useState<'file'|'native'>('file');
  const activeOrganizationRef=useRef<string|null>(null);
  const [nativeAtlas,setNativeAtlas] = useState<{organizationId:string;view:AtlasPortfolioView}|null>(null);
  const [atlasSelected,setAtlasSelected] = useState('');
  const [atlasWorkspace,setAtlasWorkspace] = useState('');
  const atlasInput = useRef<HTMLInputElement>(null);
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const editorChanged=!!editor&&JSON.stringify(editor)!==editorBaselineRef.current;
  pendingCloseRef.current=dirty||!!editor||saving;
  useEffect(()=>{
    if(nativeHost){
      let active=true;
      let unlisten:(()=>void)|undefined;
      import('@tauri-apps/api/window')
        .then(({getCurrentWindow})=>{
          const appWindow=getCurrentWindow();
          return appWindow.onCloseRequested(event=>{
            // Cancel synchronously; an awaited dialog cannot undo WM_CLOSE.
            if(closeConfirmedRef.current||!pendingCloseRef.current)return;
            event.preventDefault();
            if(closeDialogOpenRef.current)return;
            closeDialogOpenRef.current=true;
            void import('@tauri-apps/plugin-dialog')
              .then(({confirm})=>confirm(
                'Есть несохранённые изменения. Закрыть Admin Center без сохранения?',
                {title:'IWXA Admin Center',kind:'warning'}
              ))
              .then(async approved=>{
                if(!approved)return;
                closeConfirmedRef.current=true;
                try {await appWindow.destroy();}
                catch {
                  closeConfirmedRef.current=false;
                  if(active)setError('Не удалось закрыть окно. Сохраните работу перед выходом.');
                }
              })
              .catch(()=>{
                if(active)setError('Не удалось запросить подтверждение закрытия. Работа сохранена в редакторе.');
              })
              .finally(()=>{closeDialogOpenRef.current=false;});
          });
        })
        .then(dispose=>{if(active)unlisten=dispose;else dispose();})
        .catch(()=>{if(active)setError('Не удалось подключить защиту закрытия окна. Сохраните работу перед выходом.');});
      return ()=>{active=false;unlisten?.();};
    }
    const beforeUnload=(event:BeforeUnloadEvent)=>{
      if(!pendingCloseRef.current)return;
      event.preventDefault();
      event.returnValue='';
    };
    window.addEventListener('beforeunload',beforeUnload);
    return ()=>window.removeEventListener('beforeunload',beforeUnload);
  },[nativeHost]);
  useEffect(() => {
    if (!nativeHost) return;
    let cancelled=false;
    nativeInvoke('center_draft_read_local').then((content: string|null)=>{
      if(cancelled || content===null)return;
      const restored=decodeDraft(content) as Draft;
      setState(current=>current.organizations.length===0 ? restored : current);
      setDirty(false);
      setMessage('Открыты черновики с этого компьютера. Они не являются организационным реестром T3.');
    }).catch((e: unknown)=>{
      if(!cancelled)setError('Локальный черновик не открыт. Исходные данные сохранены: '+String(e));
    }).finally(()=>{if(!cancelled)setNativeRestoring(false)});
    return ()=>{cancelled=true};
  }, []);
  const org = state.organizations.find(row => row.id === state.activeOrganizationId);
  activeOrganizationRef.current=state.activeOrganizationId;
  const atlasView = atlasFile?.organizationId===org?.id ? atlasFile?.view ?? null : null;
  const matchingNativeAtlas=nativeAtlas&&nativeAtlas.organizationId===org?.id ? nativeAtlas.view : null;
  const observedAtlas=selectAtlasReferenceSource(atlasView,matchingNativeAtlas,atlasObservationMode) as AtlasPortfolioView|null;
  const currentFile=atlasFile?.organizationId===org?.id?atlasFile:null;
  const selectedPreview=inspectorPreviews.find(p=>p.key===activePreviewKey&&p.organizationId===org?.id);
  const previewTask=selectedPreview?.kind==='assignment'?org?.assignments.find(t=>t.id===selectedPreview.id):null;
  const previewPerson=selectedPreview?.kind==='person'?org?.participants.find(p=>p.id===selectedPreview.id):null;
  const previewWorkspace=selectedPreview?.kind==='workspace'?org?.workspaces.find(w=>w.id===selectedPreview.id):null;
  const previewProject=selectedPreview?.kind==='atlas-project'?observedAtlas?.projects.find(p=>p.id===selectedPreview.id):null;
  const fileLinksToReview=atlasView?(org?.assignments??[]).filter(a=>
    a.atlasRef?.workId&&atlasWorkReadback(atlasView,a.atlasRef)!=='SOURCE_REVISION_MATCHES').length:0;
  const stats = overview(state);
  const title = pages.find(row => row[0] === page)![1];
  const navGroups:Record<Page,Page[]>={
    overview:['overview','context'],context:['context','overview'],
    work:['work','resources','results'],results:['results','work','people'],
    people:['people','programs','results'],resources:['resources','work','context'],
    programs:['programs','people'],data:['data','programs','results']
  };
  const queryText=navQuery.trim().toLocaleLowerCase('ru');
  const contextualPages=pages.filter(([id,label])=>
    queryText?label.toLocaleLowerCase('ru').includes(queryText)
      :navGroups[page].includes(id));
  const draftMatches=queryText&&org?[
    ...org.participants.map(p=>({key:'p:'+p.id,name:p.name,label:'Сотрудник',page:'people' as Page})),
    ...org.workspaces.map(w=>({key:'w:'+w.id,name:w.name,label:'Рабочая область',page:'resources' as Page})),
    ...org.assignments.map(a=>({key:'a:'+a.id,name:a.title,label:'Поручение',page:'work' as Page}))
  ].filter(entry=>entry.name.toLocaleLowerCase('ru').includes(queryText)).slice(0,18):[];

  const problem = (e: unknown) => {
    const code = e instanceof Error ? e.message : String(e);
    setError(errors[code] ?? 'Изменение не выполнено. Проверьте поля и повторите действие.');
    setMessage('');
  };
  // React reload does not terminate the already mounted native T3 child.
  // Its UI buttons are transient, but the existing Tauri Session knows
  // exactly which signed organization owns it and whether it is hidden.
  // Recover this ONE child without reopening any signer or browser Kernel.
  useEffect(()=>{
    if(!nativeHost||nativeRestoring)return;
    if(!org){
      // Without a restored organization a previously signed child must not
      // cover the empty startup screen under an unknown corporate scope.
      void nativeInvoke('center_corporate_close_signed_workspace')
        .catch(()=>{});
      return;
    }
    if(checkedNativeChildFor.current===org.id)return;
    checkedNativeChildFor.current=org.id;
    let active=true;
    void nativeInvoke('center_corporate_signed_workspace_status',{
      organizationId:org.id
    }).then(async info=>{
      if(!active||info?.schema!=='IWXA_CEN_D3_SIGNED_WORKSPACE_UI/1')return;
      if(info.foreignOrOrphaned===true){
        // Cross-organization/orphaned native child cannot be recovered into
        // the currently selected actor's React Review or Kernel.
        await nativeInvoke('center_corporate_close_signed_workspace');
        if(active){
          setSignedWorkspaceOrg(null);setSignedWorkspaceVisible(false);
          setSignedWorkspaceGeneration(n=>n+1);
        }
      }else if(info.open===true&&active){
        setSignedWorkspaceOrg(org.id);
        setSignedWorkspaceVisible(info.visible===true);
        setPage('results');
        setSignedWorkspaceGeneration(n=>n+1);
      }
    }).catch(()=>{
      if(active)setError('Не удалось проверить открытый подписанный T3. Завершите его сеанс перед продолжением.');
    });
    return()=>{active=false};
  },[nativeHost,nativeRestoring,org?.id]);
  const command = (value: any) => {
    try {
      const next = applyDraftCommand(state,value) as Draft;
      revisionRef.current++;
      setState(next); setDirty(true); setError(''); setMessage('Черновик изменён. Сохраните его в файл.'); return true;
    } catch(e) {problem(e); return false;}
  };
  useEffect(()=>{
    if(!signedWorkspaceOrg||!nativeHost)return;
    // D2 manager search lives on Overview/Corporate Context. Closing the
    // ORIGINAL Kernel when moving there makes signed Object/Event reads
    // impossible. Keep the SAME signed child alive, hidden, only for the
    // same organization; other sections or a context change still close it.
    if(retainSignedWorkspaceForPage(page,state.activeOrganizationId,signedWorkspaceOrg))return;
    let active=true;
    void nativeInvoke('center_corporate_close_signed_workspace')
      .then(()=>{if(active){setSignedWorkspaceOrg(null);setSignedWorkspaceVisible(false)}})
      .catch(()=>{if(active)setError('Не удалось закрыть подписанную Workspace T3. Закройте её перед сменой организации.')});
    return ()=>{active=false};
  },[signedWorkspaceOrg,page,state.activeOrganizationId,nativeHost]);
  const openSignedWorkspace=async(organizationId:string)=>{
    if(!nativeHost||!mayOpenSignedWorkspaceOnPage(
      page,state.activeOrganizationId,organizationId,signedWorkspaceOrg))
      throw Error('CEN_D3_ORIGINAL_WORKSPACE_CONTEXT_CHANGED');
    if(signedWorkspaceOrg===organizationId){
      // The previously opened trusted T2 Kernel remains alive when its
      // native child is hidden so the manager can perform Human APPLY.
      await nativeInvoke('center_corporate_show_signed_workspace',{organizationId});
    }else{
      await nativeInvoke('center_corporate_open_signed_workspace',{organizationId});
    }
    setSignedWorkspaceOrg(organizationId);
    setSignedWorkspaceVisible(true);
  };
  const hideSignedWorkspace=async()=>{
    await nativeInvoke('center_corporate_hide_signed_workspace');
    setSignedWorkspaceVisible(false);
    // The original trusted Kernel may have attached while its child was
    // visible. Re-read signed APPLY availability before showing Review.
    setSignedWorkspaceGeneration(value=>value+1);
  };
  const closeSignedWorkspace=async()=>{
    await nativeInvoke('center_corporate_close_signed_workspace');
    setSignedWorkspaceOrg(null);
    setSignedWorkspaceVisible(false);
    // No native event is emitted if an already-destroyed child was absent.
    setSignedWorkspaceGeneration(value=>value+1);
  };
  const go = (next: Page) => {
    if(next!=='results'){setManagerOriginal(null);setFocusedEmployeeContact(null);setSeatRouteOrganization(null);}
    const history=navigationHistory.current;
    if(history[navigationCursor.current]!==next){
      navigationHistory.current=[...history.slice(0,navigationCursor.current+1),next];
      navigationCursor.current=navigationHistory.current.length-1;
      setNavigationVersion(value=>value+1);
    }
    setPage(next);setMenuOpen(false);setV8Menu('');
  };
  const openEmployeeConnection=(contactId:string)=>{
    // Draft roster selection is only navigation; T3 grants, PROOF and native
    // Human confirmation are still handled by the existing signed owner.
    if(!org||!org.participants.some(person=>person.id===contactId))return;
    setSeatRouteOrganization(null);
    setFocusedEmployeeContact(contactId);
    setManagerOriginal(null);
    go('results');
  };
  const openCorporateSeats=()=>{
    if(!org)return;
    setFocusedEmployeeContact(null);setManagerOriginal(null);
    setSeatRouteOrganization(org.id);
    go('results');
  };
  const goHistory=(delta:number)=>{
    const target=navigationCursor.current+delta;
    if(target<0||target>=navigationHistory.current.length)return;
    navigationCursor.current=target;
    const next=navigationHistory.current[target];
    if(next!=='results'){setManagerOriginal(null);setFocusedEmployeeContact(null);setSeatRouteOrganization(null);}
    setPage(next);setNavigationVersion(value=>value+1);setV8Menu('');
  };
  const openManagerOriginal=(selection:ManagerOriginalSelection)=>{
    if(!org||selection.organizationId!==org.id)return;
    setSeatRouteOrganization(null);
    setFocusedEmployeeContact(null);
    setManagerOriginal(selection);
    go('results');
  };
  const openInspectorPreview=(kind:InspectorPreview['kind'],id:string,label:string)=>{
    if(!org)return;
    const key=kind+':'+org.id+':'+id;
    const item:InspectorPreview={key,kind,id,label,organizationId:org.id};
    setInspectorPreviews(prev=>[...prev.filter(p=>p.key!==key),item].slice(-8));
    setActivePreviewKey(key);setInspectorTab('selected');setInspectorVisible(true);
  };
  const closeInspectorPreview=(key:string)=>{
    setInspectorPreviews(prev=>prev.filter(p=>p.key!==key));
    if(activePreviewKey===key){setActivePreviewKey('');setInspectorTab('context');}
  };
  const openContextEntry = (entry:{kind:string;id:string}) => {
    if(!org)return;
    if(entry.kind==='assignment'){
      const item=org.assignments.find(a=>a.id===entry.id);
      if(item)startAssignment(item);
      return;
    }
    const destination:Record<string,Page>={
      organization:'overview',workspace:'resources',person:'people',
      'atlas-project':'resources','atlas-work':'resources',
      'signed-task':'results','signed-result-package':'results'
    };
    if(entry.kind==='person'){
      const person=org.participants.find(p=>p.id===entry.id);
      if(person)openInspectorPreview('person',person.id,person.name);
    } else if(entry.kind==='workspace'){
      const space=org.workspaces.find(w=>w.id===entry.id);
      if(space)openInspectorPreview('workspace',space.id,space.name);
    }
    go(destination[entry.kind]??'context');
  };
  const openContextAttention = (item:{destination:string;assignmentId:string|null}) => {
    if(!org)return;
    if(item.assignmentId&&item.destination==='work'){
      const task=org.assignments.find(a=>a.id===item.assignmentId);
      if(task){startAssignment(task);return;}
    }
    if(item.destination==='work'&&org.workspaces.length&&org.participants.length){
      startAssignment();return;
    }
    const next=item.destination as Page;
    if(pages.some(([name])=>name===next))go(next);
  };
  const reuseAppliedResult = ({description,source}:{description:string;source:SourceResultRef}) => {
    if(!org)return;
    if(editor){setError('Сначала сохраните или закройте редактор поручения.');return;}
    const workspace=org.workspaces.find(w=>w.id===source.workspaceId);
    if(source.organizationId!==org.id||!workspace){
      setError('Исходный Result принадлежит другой организации или рабочей области.');return;
    }
    editorBaselineRef.current=JSON.stringify(initialEditor(org));
    setEditor({...initialEditor(org),workspaceId:workspace.id,
      atlasRef:workspace.atlasRef??null,sourceResultRef:source,description});
    setError('');go('work');
  };
  const startAssignment = (item?: Assignment) => {
    if (!org) return;
    // A manager may navigate to Results while an assignment editor is open.
    // Returning through "Prepare assignment" must not replace the live draft,
    // its exact Atlas revision, or a manually selected applied Result source.
    if (editor) {
      setError('Уже открыт редактор поручения. Сохраните или закройте его перед созданием другого.');
      go('work');
      return;
    }
    const next=item ? {assignmentId:item.id, expectedEditNumber:item.editNumber, title:item.title, workspaceId:item.workspaceId, assigneeId:item.assigneeId ?? '', reviewerId:item.reviewerId ?? '', description:item.description, criteria:item.criteria, dueDate:item.dueDate, priority:item.priority, atlasRef:item.atlasRef,sourceResultRef:item.sourceResultRef??null} : initialEditor(org);
    editorBaselineRef.current=JSON.stringify(next);
    setEditor(next);
    if(item)openInspectorPreview('assignment',item.id,item.title);
    setError('');
    go('work');
  };
  const closeEditor=()=>{
    if(editorChanged&&!window.confirm('Закрыть редактор? Несохранённые изменения поручения будут потеряны.'))return;
    editorBaselineRef.current=null;
    setEditor(null);
  };
  const editorField = (name: Exclude<keyof Editor,'atlasRef'>, value: string) => setEditor(old => {
    if (!old) return null;
    if (name==='workspaceId') return {...old,workspaceId:value,
      atlasRef:org?.workspaces.find(w=>w.id===value)?.atlasRef??null,
      sourceResultRef:old.sourceResultRef?.workspaceId===value?old.sourceResultRef:null};
    return {...old,[name]:value};
  });
  // Revising an existing link is a deliberate manager action. Reopening a
  // source file, or viewing a different revision, never rewrites the draft.
  const confirmAtlasWorkRevision = () => {
    const previous=editor?.atlasRef;
    if(!previous?.workId||!observedAtlas||
       atlasWorkReadback(observedAtlas,previous)!=='SOURCE_REVISION_CHANGED')return;
    let candidate: AtlasRef;
    try{candidate=linkableAtlasWork(observedAtlas,previous.projectId,previous.workId);}
    catch(e){problem(e);return;}
    const project=observedAtlas.projects.find(p=>p.id===previous.projectId);
    const work=project?.workItems.find(w=>w.id===previous.workId);
    if(!project||!work)return;
    const accepted=window.confirm('Обновить ссылку на работу Atlas?\n\n'+
      'Проект: '+project.name+'\nРабота: '+work.title+'\n'+
      'Была редакция: '+previous.revision+'\nОткрыта редакция: '+candidate.revision+'\n\n'+
      'Проверьте изменения в Atlas перед подтверждением. Изменится только ссылка в черновике. Поручение не будет выдано.');
    if(!accepted)return;
    setEditor(old=>old?.atlasRef?.projectId===previous.projectId&&
      old.atlasRef.workId===previous.workId&&old.atlasRef.revision===previous.revision
      ?{...old,atlasRef:candidate}:old);
    setError('');
    setMessage('Ссылка на открытую редакцию обновлена в редакторе. Чтобы сохранить её, сохраните черновик поручения.');
  };
  const prepareAtlasWork = (ref: AtlasRef, selectedWorkspaceId=atlasWorkspace) => {
    if (!org) return;
    if (editor) {
      setError('Сохраните или закройте открытый редактор перед выбором другой работы Atlas.');
      return;
    }
    const workspace=selectAtlasTargetWorkspace(org.workspaces,selectedWorkspaceId,ref);
    if (!atlasWorkspaceBindingMatches(workspace,ref)) {
      setError('Выберите рабочую область и свяжите её с этой редакцией проекта Atlas.');
      return;
    }
    editorBaselineRef.current=JSON.stringify(initialEditor(org));
    setEditor({...initialEditor(org),workspaceId:workspace.id,atlasRef:ref});
    setError('');go('work');
  };
  const importAtlas = async (file: File) => {
    const organizationId=org?.id;
    if(!organizationId){setError('Сначала выберите организацию.');return;}
    const request=++atlasFileRequest.current;
    const previous=atlasFile?.organizationId===organizationId?atlasFile:null;
    try{
      const {view:preview,format,contentSha256}=await readAtlasSourceFile(file) as {view:AtlasPortfolioView;format:'iwxa'|'json';contentSha256:string};
      if(activeOrganizationRef.current!==organizationId||atlasFileRequest.current!==request)return;
      const delta=previous?(compareAtlasSourceCopies(previous.view,preview) as AtlasCopyDelta):null;
      const contentSame=previous?previous.contentSha256===contentSha256:null;
      setAtlasFile({organizationId,view:preview,filename:file.name.slice(0,160),delta,
        contentSha256,contentSame});
      setAtlasSelected(selected=>preview.projects.some(p=>p.id===selected)?selected:preview.projects[0]?.id??'');
      setNativeAtlas(null);setAtlasObservationMode('file');
      setError('');setMessage('Портфель Atlas прочитан: '+preview.projects.length+' проектов. '+(format==='iwxa'?'Архив .iwxa открыт для просмотра. Данные не скопированы в Center, синхронизация не включена.':'Это просмотр выбранного файла, не живая синхронизация.'));
    }catch(e){
      if(activeOrganizationRef.current!==organizationId||atlasFileRequest.current!==request)return;
      const code=e instanceof Error?e.message:String(e);
      setError((previous?'Новый файл не открыт. Предыдущая копия осталась на экране. ':'')+
        (errors[code]??'Не удалось прочитать выбранный файл Atlas.'));
      setMessage('');
    }
  };
  const selectOrg = (organizationId: string) => {
    if (editor) {setError('Сохраните или закройте открытый редактор поручения перед сменой организации.'); return;}
    if(command({type:'SELECT_ORGANIZATION',organizationId})){
      setManagerOriginal(null);setFocusedEmployeeContact(null);
      setInspectorPreviews([]);setActivePreviewKey('');setInspectorTab('context');
      atlasFileRequest.current++;
      setAtlasFile(null);setAtlasSelected('');setAtlasWorkspace('');setNativeAtlas(null);
      setAtlasObservationMode('file');
    }
  };
  async function exportFile() {
    if (editor) {setError('Сначала сохраните изменения поручения.'); return;}
    if(savingRef.current){setError('Сначала завершите текущее сохранение.');return;}
    try {
      const content=encodeDraft(state);
      if (nativeHost) {
        const exported=await nativeInvoke('save_draft_file',{content});
        if(!exported)return;
      } else {
        const url=URL.createObjectURL(new Blob([content],{type:'application/json'}));
        const link=document.createElement('a');link.href=url;link.download='admin-center-draft.json';link.click();
        setTimeout(()=>URL.revokeObjectURL(url),10000);
      }
      // A browser download does not prove a durable disk write.
      setError('');
      setMessage(nativeHost
        ? 'Файл черновиков экспортирован и проверен. Это не .iwxa и не резервная копия организации.'
        : 'Начата загрузка файла черновиков. Проверьте сохранённый файл перед закрытием.');
    } catch(e){problem(e);}
  }
  // Signing an original organization must never refer to a Workspace that
  // existed only in transient React state. Use Center's established native
  // atomic draft persistence and independent readback; no extra T3 Store.
  const ensureDraftForSignedEnrollment=async(organizationId:string,workspaceId:string):Promise<void>=>{
    if(!nativeHost||savingRef.current||editor!==null||
       state.activeOrganizationId!==organizationId||
       !state.organizations.some(o=>o.id===organizationId&&
         o.workspaces.some(w=>w.id===workspaceId)))
      throw Error('CEN_D3_SIGNED_ENROLLMENT_DRAFT_NOT_READY');
    const revision=revisionRef.current;
    const content=encodeDraft(state);
    savingRef.current=true;setSaving(true);
    try{
      const saved=await nativeInvoke('center_draft_save_local',{content});
      if(saved!==true)
        throw Error('CEN_D3_SIGNED_ENROLLMENT_DRAFT_SAVE_UNCONFIRMED');
      const readback=await nativeInvoke('center_draft_read_local');
      if(readback!==content)
        throw Error('CEN_D3_SIGNED_ENROLLMENT_DRAFT_READBACK_MISMATCH');
      if(revisionRef.current!==revision||
         activeOrganizationRef.current!==organizationId)
        throw Error('CEN_D3_SIGNED_ENROLLMENT_DRAFT_CHANGED');
      setDirty(false);setError('');
      setMessage('Рабочая область и организация сохранены на этом компьютере до подписанного подключения T3.');
    }finally{savingRef.current=false;setSaving(false);}
  };
  async function saveFile() {
    if (editor) {setError('Сначала сохраните изменения поручения.'); return;}
    if(savingRef.current){setError('Сохранение уже выполняется.');return;}
    if(!nativeHost){await exportFile();return;}
    const revision=revisionRef.current;
    savingRef.current=true;setSaving(true);
    try {
      const content=encodeDraft(state);
      const saved=await nativeInvoke('center_draft_save_local',{content});
      if(!saved)throw Error('Не удалось сохранить черновик');
      if(revisionRef.current===revision){
        setDirty(false);setError('');
        setMessage('Черновики сохранены на этом компьютере. Подписанные полномочия T3 пока не подключены.');
      }else{
        setDirty(true);setError('');
        setMessage('Черновики изменены во время сохранения. Сохраните новую редакцию повторно.');
      }
    } catch(e){problem(e);}
    finally{savingRef.current=false;setSaving(false);}
  }
  async function readDraft(raw: string) {
    try {
      const next = decodeDraft(raw) as Draft;
      if(pendingCloseRef.current&&!window.confirm('Заменить открытые черновики выбранным файлом? Несохранённые изменения будут потеряны.'))return;
      revisionRef.current++;
      editorBaselineRef.current=null;
      setState(next);setFocusedEmployeeContact(null);setDirty(nativeHost);atlasFileRequest.current++;setAtlasFile(null);setNativeAtlas(null);setAtlasObservationMode('file');setAtlasSelected('');setAtlasWorkspace('');setEditor(null);setPage('overview');setCreatingOrg(false);setError('');setMessage('Черновики открыты. Полномочия и корпоративные решения из этого файла не выдаются.');
    } catch(e) {problem(e);}
  }
  async function openFile() {
    if ((window as any).__TAURI_INTERNALS__) {
      try {const content=await nativeInvoke('open_draft_file');if(content!==null)await readDraft(content);}catch(e){problem(e);}
    } else fileInput.current?.click();
  }

  const organizationForm = <form className="card form-panel" data-testid="organization-form" onSubmit={e=>{
    e.preventDefault();const data=new FormData(e.currentTarget);
    if(command({type:'CREATE_ORGANIZATION',name:data.get('name'),kind:data.get('kind')})){
      setCreatingOrg(false);setAtlasFile(null);setNativeAtlas(null);setAtlasSelected('');setAtlasWorkspace('');
    }
  }}>
    <div className="section-head"><h2>Новая организация</h2>{org && <button type="button" className="quiet" onClick={()=>setCreatingOrg(false)}>Отмена</button>}</div>
    <p className="muted">Начните с названия. Юридический статус и права не возникают из создания черновика.</p>
    <div className="form-grid">
      <label>Название<input name="name" data-testid="org-name" maxLength={160} required autoFocus={creatingOrg} placeholder="Например, рабочая группа" /></label>
      <label>Тип<select name="kind"><option value="GROUP">Группа или команда</option><option value="ORGANIZATION">Организация</option></select></label>
    </div>
    <button className="primary" data-testid="create-org">Создать черновик организации</button>
  </form>;

  if(nativeRestoring)return <div className="app"><main className="main"><div className="card padded" role="status">Открываем сохранённую работу...</div></main></div>;
  return <div className={`app v8-app ${menuOpen?'menu-open':''} ${inspectorVisible?'with-inspector':''}`}
      style={{'--v8-inspector-width':inspectorWidth+'px'} as React.CSSProperties}>
    <header className="v8-titlebar" aria-label="IWXA Admin Center">
      <img className="v8-logo" src={iwxaBrandMark} alt="IWXA Admin Center"/>
      <button type="button" className="v8-topicon" title="Назад" disabled={navigationCursor.current===0} onClick={()=>goHistory(-1)} aria-label="Назад">‹</button>
      <button type="button" className="v8-topicon" title="Вперёд" disabled={navigationCursor.current>=navigationHistory.current.length-1} onClick={()=>goHistory(1)} aria-label="Вперёд">›</button>
      <button type="button" className="v8-topicon" title="Показать или скрыть разделы" onClick={()=>setMenuOpen(value=>!value)} aria-label="Разделы">◫</button>
      <span className="v8-title-divider"/>
      <strong className="v8-title">IWXA Admin Center</strong>
      {(['file','edit','view','help'] as const).map(kind=><div key={kind} className="v8-menubox">
        <button type="button" aria-expanded={v8Menu===kind} onClick={()=>setV8Menu(value=>value===kind?'':kind)}>{({file:'Файл',edit:'Правка',view:'Вид',help:'Справка'} as const)[kind]}</button>
        {v8Menu===kind&&<div className="v8-menu-pop" role="menu">
          <span className="v8-menu-label">{({file:'ФАЙЛЫ И РАБОТА',edit:'ДЕЙСТВИЯ',view:'ОКНО',help:'НАВИГАЦИЯ'} as const)[kind]}</span>
          {kind==='file'&&<>
            <button onClick={()=>{setV8Menu('');void saveFile();}}>Сохранить черновики</button>
            <button onClick={()=>{setV8Menu('');void openFile();}}>Открыть файл</button>
            <button onClick={()=>{setV8Menu('');void exportFile();}}>Экспортировать JSON</button>
          </>}
          {kind==='edit'&&<>
            <button onClick={()=>{setV8Menu('');if(org)startAssignment();else {setCreatingOrg(true);go('overview');}}}>Новое поручение</button>
            <button onClick={()=>go('people')}>Сотрудники и роли</button>
            <button onClick={()=>go('resources')}>Рабочие области</button>
          </>}
          {kind==='view'&&<>
            <button onClick={()=>go('overview')}>Главная</button>
            <button onClick={()=>go('context')}>Контекст организации</button>
            <button onClick={()=>{setV8Menu('');setInspectorVisible(value=>!value);}}>Показать / скрыть просмотр справа</button>
          </>}
          {kind==='help'&&<>
            <button onClick={()=>go('context')}>Структура и связи IWXA</button>
            <button onClick={()=>go('results')}>Корпоративный T3</button>
            <button onClick={()=>go('data')}>О программе и настройки</button>
          </>}
        </div>}
      </div>)}
      <div className="v8-headspacer"/>
      <button type="button" className="v8-topicon" title="Панель просмотра" aria-label="Панель просмотра" onClick={()=>setInspectorVisible(value=>!value)}>◧</button>
    </header>
    <nav className="v8-rail" aria-label="Основные разделы">
      {pages.filter(([id])=>id!=='data').map(([id,label])=><button key={id} type="button"
        className={page===id?'active':''} aria-label={id==='overview'?'Обзор · Admin Center':label}
        title={label} data-testid={`nav-${id}`} onClick={()=>go(id)}>
        <V8RailIcon name={id}/>
      </button>)}
      <div className="v8-rail-space"/>
      <div className="v8-rail-rule"/>
      <button type="button" title="Выбрать организацию" aria-label="Выбрать организацию" onClick={()=>go('overview')}><V8RailIcon name="context"/></button>
      <button type="button" className="v8-rail-profile" data-testid="nav-data" aria-label="Профиль и настройки" title="Профиль и настройки" onClick={()=>go('data')}>
        <img className="v8-profile-mark" src={iwxaBrandMark} alt="IWXA Admin Center"/>
      </button>
    </nav>
    <aside className="sidebar" aria-label="Навигация по разделам">
      <div className="v8-nav-search"><span aria-hidden="true">⌕</span><input type="search"
        value={navQuery} onChange={e=>setNavQuery(e.target.value)} aria-label="Найти раздел"
        placeholder="Найти работу или команду"/></div>
      <div className="v8-nav-caption">{queryText?'РЕЗУЛЬТАТЫ ПОИСКА':'РАЗДЕЛ'}</div>
      <nav>{contextualPages.map(([id,label])=>
        <button key={id} className={`nav-link ${page===id?'active':''}`} aria-current={page===id?'page':undefined}
          onClick={()=>{setNavQuery('');go(id);}}>
          <span className="nav-icon" aria-hidden="true"><V8RailIcon name={id}/></span><span>{label}</span>{id==='work'&&!!stats.drafts&&<em>{stats.drafts}</em>}
        </button>)}
        {draftMatches.length>0&&<div className="v8-nav-caption">ЧЕРНОВИКИ ОРГАНИЗАЦИИ</div>}
        {draftMatches.map(hit=><button key={hit.key} className="nav-link" type="button"
          onClick={()=>{setNavQuery('');if(hit.key.startsWith('a:')){
            const task=org?.assignments.find(a=>a.id===hit.key.slice(2));if(task)startAssignment(task);
          }else go(hit.page);}}>
          <span className="nav-icon" aria-hidden="true">·</span><span>{hit.name}<small className="v8-nav-kind">{hit.label}</small></span>
        </button>)}
      </nav>
      <div className="sidebar-bottom">
        <div className="organization-select">
          <label htmlFor="active-organization">Текущая организация</label>
          <select id="active-organization" aria-label="Организация" value={state.activeOrganizationId??''} onChange={e=>selectOrg(e.target.value)}>
            {!org&&<option value="">Организация не выбрана</option>}
            {state.organizations.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <p className="v8-footer-hint">{org?`${org.workspaces.length} областей · ${org.participants.length} сотрудников`:'Сначала создайте организацию'}</p>
          <button className="sidebar-add" onClick={()=>{if(editor){setError('Сначала сохраните открытый редактор.');return;}setCreatingOrg(true);go('overview');}}>＋ Добавить организацию</button>
        </div>
      </div>
    </aside>

    <main ref={mainScrollRef} className="main">
      <header className="top" aria-label="Текущий раздел"><div className="v8-page-location"><strong>{title}</strong><small>{org?.name??'IWXA Admin Center · рабочее место руководителя'}</small></div>
       {signedWorkspaceOrg&&<>
        {signedWorkspaceVisible
          ? <button className="secondary" data-testid="d3-return-to-review"
              onClick={()=>{void hideSignedWorkspace().catch(()=>setError('Не удалось вернуться к приёмке.'));}}>К приёмке</button>
          : <button className="secondary" data-testid="d3-show-signed-workspace"
              onClick={()=>{void openSignedWorkspace(signedWorkspaceOrg).catch(()=>setError('Не удалось показать подписанную Workspace T3.'));}}>Workspace T3</button>}
        <button className="quiet" data-testid="d3-close-signed-workspace"
          aria-label="Завершить подписанную Workspace T3" title="Завершить сеанс Workspace T3"
          onClick={()=>{void closeSignedWorkspace().catch(()=>setError('Не удалось завершить Workspace T3.'));}}>×</button>
       </>}
       <button className="secondary top-save" onClick={saveFile} disabled={!org||saving}>{nativeHost?'Сохранить на компьютере':'Сохранить файл'}</button></header>
      {page!=='overview'&&page!=='results'&&<div className="page-heading"><div><div className="eyebrow">РАБОЧЕЕ МЕСТО РУКОВОДИТЕЛЯ</div><h1>{title}</h1></div><span className="status neutral">Черновики</span></div>}
      {error && <div className="notice error" role="alert">{error}</div>}
      {message && <div className="notice" role="status">{message}</div>}
      {page==='overview'&&<AdminDashboard key={org?.id??'_start'} organization={org}
        nativeHost={nativeHost} atlasView={observedAtlas}
        managerContext={org?<ManagerContextPanel key={'home|'+org.id}
          organization={org} atlasView={observedAtlas} view="overview"
          atlasStatus={ref=>atlasWorkReadback(observedAtlas,ref)}
          sourceGeneration={signedWorkspaceGeneration} invoke={nativeHost?nativeInvoke:null}
          onNavigate={go} onOpenEntry={openContextEntry} onOpenAttention={openContextAttention}
          onOpenOriginal={openManagerOriginal}/>:null}
        onNavigate={go}
        onCreateOrganization={()=>{
          setCreatingOrg(true);
          requestAnimationFrame(()=>document.querySelector<HTMLInputElement>('[data-testid="org-name"]')?.focus());
        }}
        onNewAssignment={()=>{if(org)startAssignment();else setCreatingOrg(true);}}
        onEnrollEmployee={openEmployeeConnection}
        onOpenAssignment={id=>{const found=org?.assignments.find(t=>t.id===id);if(found)startAssignment(found);}}
      />}
      {(!org || creatingOrg) && organizationForm}

      {org && page==='context' && <ManagerContextPanel key={'context|'+org.id} organization={org}
        atlasView={observedAtlas} view="context" atlasStatus={ref=>atlasWorkReadback(observedAtlas,ref)}
        sourceGeneration={signedWorkspaceGeneration}
        invoke={nativeHost?nativeInvoke:null}
        onNavigate={go} onOpenEntry={openContextEntry} onOpenAttention={openContextAttention}
        onOpenOriginal={openManagerOriginal}/>}

      {org && page==='resources' && <section className="card padded"><h2>Планы Atlas и рабочие области</h2><p className="muted">Atlas показывает проекты и зависимости. Привязка к работе необязательна. Только проектные поручения требуют проверки точной редакции установленного Atlas перед подписанием. Обычные поручения работают через T3 без Atlas.</p>
        <form className="inline-form" onSubmit={e=>{e.preventDefault();const form=e.currentTarget;if(command({type:'ADD_WORKSPACE',organizationId:org.id,name:new FormData(form).get('name')}))form.reset();}}><input aria-label="Название рабочей области" name="name" required maxLength={160} placeholder="Название рабочей области" data-testid="workspace-name"/><button className="primary" data-testid="add-workspace">Добавить</button></form>
        {org.workspaces.map(w=><div className="simple-row" key={w.id}><span className="small-mark">◇</span><div><strong>{w.name}</strong><small>{w.atlasRef ? `Связанный план Atlas: ${w.atlasRef.projectId} (редакция ${w.atlasRef.revision})` : 'План Atlas пока не указан'}</small></div><span className="muted">{org.assignments.filter(a=>a.workspaceId===w.id).length} поручений</span><button type="button" className="secondary" onClick={()=>openInspectorPreview('workspace',w.id,w.name)}>Подробнее</button></div>)}
        <NativeAtlasPanel key={org.id} organizationId={org.id} workspaces={org.workspaces}
          targetWorkspaceId={atlasWorkspace} onChooseWorkspace={setAtlasWorkspace}
          onLink={(ref,workspaceId)=>command({type:'LINK_ATLAS_WORKSPACE',organizationId:org.id,workspaceId,atlasRef:ref})}
          onLinkWork={prepareAtlasWork} onObserved={(id,view)=>{setNativeAtlas(view?{organizationId:id,view}:null);if(view)setAtlasObservationMode('native')}}/>
        <div className="card nested-form" data-testid="atlas-link-panel">
          <div className="section-head"><h3>Проекты Atlas</h3><button type="button" className="secondary" onClick={()=>atlasInput.current?.click()} data-testid="atlas-import-button">Открыть портфель Atlas</button></div>
          <p className="muted">Откройте архив проектов .iwxa из Atlas. Для проверки изменений повторно выберите файл через ту же кнопку. Старые копии JSON также поддерживаются. Ссылки на поручения автоматически не меняются.</p>
          <input type="file" hidden ref={atlasInput} accept=".iwxa,.json,application/json,application/octet-stream" data-testid="atlas-import-file" onChange={async e=>{const file=e.target.files?.[0];if(file)await importAtlas(file);e.target.value='';}} />
          {currentFile&&atlasView&&<div className="atlas-file-review" data-testid="atlas-file-review" role="status">
            <strong>Открыта копия: {currentFile.filename}</strong>
            {currentFile.delta ? <>
              <p>Предыдущая редакция {currentFile.delta.previousRevision}, выбранная сейчас — {currentFile.delta.revision}.</p>
              <p data-testid="atlas-copy-difference">{currentFile.delta.contentChanged
                ? 'Изменения в копии: проектов добавлено '+currentFile.delta.addedProjects+', убрано '+currentFile.delta.removedProjects+
                  '; работ добавлено '+currentFile.delta.addedWorks+', убрано '+currentFile.delta.removedWorks+
                  ', изменено '+currentFile.delta.changedWorks+'; изменено свойств проектов '+currentFile.delta.changedProjects+
                  ', связей '+currentFile.delta.changedDependencies+'.'
                : currentFile.contentSame
                  ? 'Содержимое портфеля совпадает с предыдущей копией.'
                  : 'Содержимое копии отличается, но краткие показатели совпадают. Проверьте изменения и редакцию в Atlas.'}</p>
              {currentFile.delta.revisionRelation==='lower'&&<p className="muted" data-testid="atlas-file-older">У выбранного файла меньшая редакция. Проверьте, какую копию нужно использовать.</p>}
              {currentFile.delta.revisionRelation==='same'&&currentFile.contentSame===false&&<p className="muted" data-testid="atlas-file-same-revision">Состав изменился без изменения номера редакции. Проверьте источник.</p>}
              {currentFile.delta.revisionRelation==='unrelated'&&<p className="muted">У нового файла нет общих проектов с предыдущим. Редакции не сопоставляются.</p>}
            </> : <p>Для повторной проверки выберите копию файла ещё раз.</p>}
            <p data-testid="atlas-file-links-review">{fileLinksToReview>0
              ? 'Поручений со ссылками, требующими проверки: '+fileLinksToReview+'. Старые ссылки сохранены.'
              : 'Ссылки на работы совпадают с редакцией открытого файла. Актуальность проекта в Atlas не проверена.'}</p>
            <p className="muted">Файл не обновляется автоматически. Совпадение редакции не подтверждает выполнение работ или права доступа.</p>
            {observedAtlas?.mode==='NATIVE_ATLAS_PUBLIC_READ_ONLY'&&
              <p className="muted" data-testid="atlas-file-vs-installed">Для проверки ссылок поручений используется отдельно открытый установленный Atlas. Здесь показана копия файла.</p>}
          </div>}
          {atlasView ? <>
            <div className="metrics atlas-summary">
              <div className="card metric"><span>Проекты Atlas</span><strong data-testid="atlas-project-count">{atlasView.projects.length}</strong></div>
              <div className="card metric"><span>Зависимости</span><strong>{atlasView.dependencies.length}</strong></div>
              <div className="card metric"><span>Редакция</span><strong data-testid="atlas-revision">{atlasView.revision}</strong></div>
            </div>
            <div className="atlas-project-list">{atlasView.projects.map(project=><button type="button" key={project.id} data-testid="atlas-project-card" className={`assignment-row atlas-project-card ${atlasSelected===project.id?'chosen':''}`} onClick={()=>{setAtlasSelected(project.id);openInspectorPreview('atlas-project',project.id,project.name);}}>
              <span className="task-mark">◇</span><span className="row-content"><strong>{project.name}</strong><small>{project.total} работ · {project.done} завершено · {project.blocked} заблокировано · {project.stages} этапов</small></span><span className="status neutral">{project.progress===null?'Нет работ':project.progress+'%'}</span>
            </button>)}</div>
            {!!org.workspaces.length && !!atlasView.projects.length && <form onSubmit={e=>{e.preventDefault();if(!atlasSelected)return;const workspaceId=atlasWorkspace||org.workspaces[0].id;const link=linkableAtlasProject(atlasView,atlasSelected);command({type:'LINK_ATLAS_WORKSPACE',organizationId:org.id,workspaceId,atlasRef:link});}}>
              <h3>Связать выбранный проект с рабочей областью</h3><div className="form-grid"><label>Рабочая область<select data-testid="atlas-workspace-select" value={atlasWorkspace||org.workspaces[0].id} onChange={e=>setAtlasWorkspace(e.target.value)}>{org.workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label><label>Выбранный проект<input readOnly value={atlasView.projects.find(p=>p.id===atlasSelected)?.name??''} /></label></div>
              <button className="secondary" data-testid="link-atlas">Связать с планом</button>
            </form>}
            {!!atlasSelected && atlasView.projects.find(p=>p.id===atlasSelected)?.workItems.map(item=>
              <button type="button" key={item.id} className="secondary" data-testid="atlas-file-work-to-assignment"
                onClick={()=>prepareAtlasWork(linkableAtlasWork(atlasView,atlasSelected,item.id))}>Подготовить поручение: {item.title}</button>)}
            <p className="muted fine-print">Открыта копия портфеля Atlas, редакция {atlasView.revision}. Это снимок, а не синхронизация. Перед выдачей поручения проверьте актуальность проекта в Atlas и права на него.</p>
          </> : <Empty title="Откройте портфель Atlas" text="Когда вы выберете файл экспорта Atlas, здесь появятся проекты, прогресс и зависимости."/>}
          {org.workspaces.some(w=>w.atlasRef)&&<div className="atlas-link-readback">{org.workspaces.filter(w=>w.atlasRef).map(w=><p key={w.id}><strong>{w.name}:</strong> {w.atlasRef?.projectId} · {atlasLinkReadback(atlasView,w.atlasRef)==='SOURCE_REVISION_MATCHES'?'Редакция совпадает':atlasLinkReadback(atlasView,w.atlasRef)==='SOURCE_REVISION_CHANGED'?'Редакция плана изменилась':atlasView?'Проект отсутствует в открытом файле':'Файл Atlas не открыт'}</p>)}</div>}
        </div>
        <div className="notice subdued">Atlas подключается для проектных работ. Обычное поручение и приёмка Result не требуют Atlas. Проекты, зависимости и портфели остаются у Atlas.</div>
      </section>}

      {org && page==='people' && <>
        <section className="card v8-people-structure">
          <div className="section-head"><h2>Структура компании</h2><span className="status neutral">Рабочие области · роли · ответственность</span></div>
          <p className="muted">Состав организации строится из сохранённых рабочих областей и сотрудников. Подписанные полномочия T3 проверяются отдельно.</p>
          <AdminCompanyStructure key={org.id} organization={org} onNavigate={go}
             onEnrollEmployee={openEmployeeConnection}
             onOpenAssignment={id=>{const task=org.assignments.find(item=>item.id===id);if(task)startAssignment(task);}}/>
        </section>
        <section className="card v8-people-structure"><h2>Матрица сотрудников и подключений</h2>
          <div className="v8-role-grid">
            <div className="v8-role-head">Сотрудник / функция</div>
            <div className="v8-role-head">Personal Agent</div>
            <div className="v8-role-head">Подписанное подключение</div>
            {org.participants.map(person=><React.Fragment key={person.id}>
              <div><strong>{person.name}</strong><small>{person.roleLabel||'Функция не указана'}</small></div>
              <div>{person.personalAgentPlan==='PLANNED'?'Место запланировано':'Место не запланировано'}</div>
              <div>По этому черновику не подтверждено</div>
            </React.Fragment>)}
            {!org.participants.length&&<p className="muted">Добавьте сотрудников, чтобы появилась матрица ролей.</p>}
          </div>
        </section>
        <section className="card padded"><h2>Сотрудники и их обязанности</h2><p className="muted">Руководитель определяет участников и их обязанности. Подписанные полномочия появятся после подключения действующих организационных механизмов.</p>
        <form className="form-grid member-form" onSubmit={e=>{e.preventDefault();const form=e.currentTarget;const data=new FormData(form);if(command({type:'ADD_PARTICIPANT',organizationId:org.id,name:data.get('name'),roleLabel:data.get('role')}))form.reset();}}>
          <label>Имя<input name="name" required maxLength={160} data-testid="person-name"/></label><label>Функция в команде<input name="role" maxLength={160} placeholder="Например, руководитель"/></label><button className="primary" data-testid="add-person">Добавить участника</button>
        </form>
        {org.participants.map(person=><div className="simple-row" key={person.id}><span className="avatar">{person.name.slice(0,1)}</span><div><strong>{person.name}</strong><small>{person.roleLabel||'Функция не указана'} · {person.personalAgentPlan==='PLANNED'?'Доступ к Personal Agent запланирован':'Место Personal Agent не запланировано'}</small></div><span className="status neutral">Нет подтверждённого допуска</span><button type="button" className="secondary" onClick={()=>openInspectorPreview('person',person.id,person.name)}>Карточка</button></div>)}
        {!org.participants.length && <Empty title="Добавьте первого участника" text="Организация может начинать работу с одного человека. Тестовые участники автоматически не создаются."/>}
      </section></>}

      {org && page==='work' && <>
        <div className="section-head"><p className="muted">Черновик не считается выданным поручением.</p>
          <div className="actions">
            {!editor&&org.assignments.length>0&&<button className="secondary" type="button"
              data-testid="open-signed-t3-task" onClick={()=>go('results')}>
              Подписать поручение T3
            </button>}
            <button className="primary" disabled={!org.workspaces.length||!!editor}
              onClick={()=>startAssignment()}>＋ Новое поручение</button>
          </div>
        </div>
        {editor ? <form className="card form-panel" data-testid="assignment-form" onSubmit={e=>{e.preventDefault();if(command({type:'SAVE_ASSIGNMENT',organizationId:org.id,...editor})){editorBaselineRef.current=null;setEditor(null);}}}>
          <div className="section-head"><h2>{editor.assignmentId?'Редактировать поручение':'Новое поручение'}</h2><button type="button" className="quiet" onClick={closeEditor}>Закрыть редактор</button></div>
          <label>Что нужно сделать<input autoFocus value={editor.title} maxLength={200} required onChange={e=>editorField('title',e.target.value)} data-testid="task-title"/></label>
          <div className="form-grid">
            <label>Рабочая область<select value={editor.workspaceId} onChange={e=>editorField('workspaceId',e.target.value)}>{org.workspaces.map(w=><option value={w.id} key={w.id}>{w.name}</option>)}</select></label>
            <label>Срок<input type="date" value={editor.dueDate} onChange={e=>editorField('dueDate',e.target.value)}/></label>
            <label>Исполнитель<select value={editor.assigneeId} onChange={e=>editorField('assigneeId',e.target.value)}><option value="">Выбрать позже</option>{org.participants.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
            <label>Кто принимает результат<select value={editor.reviewerId} onChange={e=>editorField('reviewerId',e.target.value)}><option value="">Выбрать позже</option>{org.participants.map(p=><option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          </div>
          <label>Описание<textarea rows={3} maxLength={6000} value={editor.description} onChange={e=>editorField('description',e.target.value)} placeholder="Входные сведения и ожидаемый результат"/></label>
          <label>Критерии приёмки<textarea rows={3} maxLength={2000} value={editor.criteria} onChange={e=>editorField('criteria',e.target.value)} placeholder="Как понять, что работа выполнена?" data-testid="task-criteria"/></label>
          <p className="muted" data-testid="assignment-atlas-binding">{editor.atlasRef
            ? `Черновая связь: проект ${editor.atlasRef.projectId}, редакция ${editor.atlasRef.revision}${editor.atlasRef.workId?', работа '+editor.atlasRef.workId:''}. При редактировании редакция не меняется автоматически.`
            : 'Без связи с Atlas. Поручение можно подготовить и подписать через T3 независимо от проектного плана.'}</p>
          {editor.atlasRef&&<button type="button" className="quiet"
            data-testid="remove-assignment-atlas"
            onClick={()=>setEditor(old=>old?{...old,atlasRef:null}:old)}>
            Убрать связь с Atlas только у этого поручения
          </button>}
          <p className="muted" data-testid="assignment-atlas-source">{observedAtlas?.mode==='NATIVE_ATLAS_PUBLIC_READ_ONLY'
            ? 'Проверка по последнему чтению установленного Atlas. Это не подтверждение прав или выполнения работы.'
            : observedAtlas?.mode==='READ_ONLY_USER_SELECTED_FILE'
              ? 'Проверка по выбранной копии проекта. Файл не обновляется автоматически.'
              : 'Источник Atlas для проверки не открыт. Локальный план Center не заменяет установленный Atlas.'}</p>
          <p className="muted" data-testid="assignment-atlas-currentness">{workStatusLabels[atlasWorkReadback(observedAtlas,editor.atlasRef)]}</p>
          {editor.sourceResultRef&&<p className="muted" data-testid="assignment-source-result">Источник: Task {editor.sourceResultRef.taskId}, Result revision {editor.sourceResultRef.resultRevisionId}. Ссылка будет проверена перед выпуском новой подписанной Task.
            <button type="button" className="quiet" onClick={()=>setEditor(old=>old?{...old,sourceResultRef:null}:old)}>Убрать связь</button>
          </p>}
          {editor.atlasRef?.workId && observedAtlas &&
            atlasWorkReadback(observedAtlas,editor.atlasRef)==='SOURCE_REVISION_CHANGED' &&
            <button type="button" className="secondary" data-testid="refresh-assignment-atlas"
              onClick={confirmAtlasWorkRevision}>
              Проверить и обновить редакцию ссылки
            </button>}
          <div className="form-footer"><span className="muted">
           Сохраните черновик, затем откройте «Результаты» и выпустите подписанную Task через установленный T3.
           Черновик не является подписанным поручением.
          </span><button className="primary" data-testid="save-assignment">Сохранить черновик</button></div>
        </form> : <section className="card padded">{org.assignments.map(a=><AssignmentRow key={a.id} item={a} org={org} atlasView={observedAtlas} onClick={()=>startAssignment(a)}/>)}{!org.assignments.length && <Empty title="Начните с первого поручения" text={org.workspaces.length?'Укажите цель, ожидаемый результат и срок.':'Сначала добавьте рабочую область в разделе «Проекты и ресурсы».'}/>}</section>}
      </>}

       {org && page==='results' && <AdminResultRoute organizationName={org.name} nativeHost={nativeHost}
          signedWorkspaceOpen={signedWorkspaceOrg===org.id} signedWorkspaceVisible={signedWorkspaceOrg===org.id&&signedWorkspaceVisible}
          onOpenWorkspace={()=>openSignedWorkspace(org.id)}
          focusedEmployeeName={org.participants.find(person=>person.id===focusedEmployeeContact)?.name??null}/> }
       {org && page==='results' && <CorporatePanel key={org.id} organization={org} managerOriginal={managerOriginal}
          preferredEmployeeContactId={focusedEmployeeContact} preferCorporateSeats={seatRouteOrganization===org.id}
          signedWorkspaceOpen={signedWorkspaceOrg===org.id}
          signedWorkspaceVisible={signedWorkspaceOrg===org.id&&signedWorkspaceVisible} invoke={nativeHost?nativeInvoke:null} signedWorkspaceGeneration={signedWorkspaceGeneration} onReuse={reuseAppliedResult} onPrepare={()=>startAssignment()} onSetupWorkspace={()=>go('resources')} onEnsureDraftSaved={ensureDraftForSignedEnrollment} onOpenSignedWorkspace={openSignedWorkspace} onOpenLicenses={()=>go('programs')}/>} 
      {org && page==='programs' && <section className="card padded"><h2>Personal Agent и рабочие лицензии</h2><p className="muted">Получите подписанную лицензию Publisher, подключите сотрудников к организации и распределите места через исходный реестр T3. План потребности не является назначением места.</p>
        <div className="actions">
          <button className="primary" type="button" data-testid="open-corporate-seat-registry" onClick={openCorporateSeats}>Управление корпоративными местами</button>
        </div>
        <div className="metrics"><div className="card metric"><span>Контакты в плане</span><strong>{org.participants.length}</strong></div><div className="card metric"><span>Места запланированы</span><strong data-testid="planned-agent-seats">{org.participants.filter(p=>p.personalAgentPlan==='PLANNED').length}</strong></div></div>
        {org.participants.map(person=><div className="simple-row" key={person.id}><span className="avatar">{person.name.slice(0,1)}</span><div><strong>{person.name}</strong><small>{person.personalAgentPlan==='PLANNED'?'Место запланировано - лицензия ещё не выдана':'Доступ к Personal Agent пока не запланирован'}</small></div><div className="actions"><button className="secondary" data-testid="plan-agent-seat" onClick={()=>command({type:'PLAN_PERSONAL_AGENT_ACCESS',organizationId:org.id,participantId:person.id,plan:person.personalAgentPlan==='PLANNED'?'NONE':'PLANNED'})}>{person.personalAgentPlan==='PLANNED'?'Убрать план':'Запланировать место'}</button><button className="secondary" type="button" data-testid={'open-employee-t3-'+person.id} onClick={()=>openEmployeeConnection(person.id)}>Подключение T3</button></div></div>)}
        {!org.participants.length && <Empty title="Сначала добавьте сотрудников" text="Для каждого сотрудника можно подготовить план доступа к Personal Agent."/>}
        <div className="notice subdued">Разделение ответственности: Publisher выпускает программные лицензии и издательские статусы; Admin Center распределяет подтверждённые места организации и управляет организационными полномочиями. Назначение места проверяется в исходном реестре; сотрудник получает подписанное обновление отдельно.</div>
        <AgeExchangePanel invoke={nativeHost?nativeInvoke:null} prefix="center" recipientOnly/>
         <Cen04LicensePanel key={org.id} organizationId={org.id} organizationName={org.name}
          organizationKind={org.kind==='ORGANIZATION'?'ORGANIZATION':'GROUP'}
          participants={org.participants} invoke={nativeHost?nativeInvoke:null} onManageSeats={openCorporateSeats}/>
      </section>}
      {org && page==='data' && <section className="card padded"><h2>Черновики и защищённый обмен</h2><p>Сохраните рабочие черновики перед закрытием. Для поручений и результатов в полном выпуске используется существующий подписанный обмен IWXA с шифрованием age для выбранных получателей.</p><div className="actions"><button className="primary" disabled={saving} onClick={saveFile}>{nativeHost?'Сохранить локально':'Сохранить файл черновиков'}</button><button className="secondary" onClick={openFile}>Открыть файл черновиков</button>{nativeHost&&<button className="secondary" onClick={exportFile}>Экспортировать JSON</button>}</div><div className="notice subdued">Локальное сохранение и экспорт содержат только подготовительные черновики. Это не .iwxa и не .iwxa.age, в них нет ключей или принятых решений. Защищённый файловый обмен доступен ниже при установленном компоненте T3. Расшифровка не означает корпоративного принятия; оригинальный T3 отдельно проверяет и применяет полученный пакет.</div></section>}
      {page==='data'&&<>
        <section className="card padded" data-testid="admin-profile-settings">
          <h2>Профиль, настройки и сведения о программе</h2>
          <div className="v8-profile-details"><strong>IWXA Admin Center</strong>
            <p>Версия программы: 0.4.1</p>
            <p>Источник: действующая ветка Center. Управленческие данные и подписанные права остаются в оригинальных T2/T3 и связанных приложениях.</p>
          </div>
        </section>
        <AgeExchangePanel invoke={nativeHost?nativeInvoke:null} prefix="center"/>
      </>}
      {!org && <div className="landing-actions"><button className="secondary" onClick={openFile}>Открыть файл черновиков</button><p className="muted">Работа руководителя связана с Atlas и Personal Agent сотрудников. Сейчас доступна подготовка структуры, без реальной отправки поручений.</p></div>}
      <input ref={fileInput} type="file" accept=".json,application/json" hidden data-testid="open-draft" onChange={async e=>{const file=e.target.files?.[0];if(file)await readDraft(await file.text());e.target.value='';}}/>
      <footer className="footer"><span>IWXA Admin Center</span><span>{saving?'Сохранение выполняется':dirty||editorChanged?'Есть несохранённые изменения':nativeHost?'Локальный черновик открыт':'Черновик в текущем окне'}</span></footer>
    </main>
    <aside className="inspector" aria-label="Панель просмотра">
      <div className="v8-inspector-grip" role="separator" tabIndex={0} aria-label="Изменить ширину панели"
        aria-valuenow={inspectorWidth} aria-valuemin={310} aria-valuemax={680}
        onPointerDown={event=>{inspectorPointer.current={x:event.clientX,width:inspectorWidth};event.currentTarget.setPointerCapture(event.pointerId);}}
        onPointerMove={event=>{const origin=inspectorPointer.current;if(origin)setInspectorWidth(Math.max(310,Math.min(680,origin.width+origin.x-event.clientX)));}}
        onPointerUp={event=>{if(!inspectorPointer.current)return;inspectorPointer.current=null;
          try{localStorage.setItem('iwxa.admin-center.v8.inspector.width',String(inspectorWidth));}catch{}event.currentTarget.releasePointerCapture(event.pointerId);}}
        onKeyDown={event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();setInspectorWidth(v=>Math.max(310,Math.min(680,v+(event.key==='ArrowLeft'?18:-18))));}}}
      />
      <div className="v8-inspector-header"><strong>Просмотр</strong><button type="button" aria-label="Закрыть панель" onClick={()=>setInspectorVisible(false)}>×</button></div>
      <div className="v8-inspector-tabs" role="tablist" aria-label="Просмотр">
        {([['context','Контекст'],['tasks','Поручения'],['sources','Источники']] as const).map(([id,label])=>
          <button type="button" role="tab" key={id} aria-selected={inspectorTab===id}
            className={inspectorTab===id?'active':''} onClick={()=>setInspectorTab(id)}>{label}</button>)}
        {inspectorPreviews.filter(item=>item.organizationId===org?.id).map(item=>
          <div className={'v8-inspector-tab-wrap '+(inspectorTab==='selected'&&activePreviewKey===item.key?'active':'')} key={item.key}>
            <button type="button" role="tab" aria-selected={inspectorTab==='selected'&&activePreviewKey===item.key}
              title={item.label} onClick={()=>{setActivePreviewKey(item.key);setInspectorTab('selected');}}>
              {item.label}
            </button>
            <button type="button" className="v8-inspector-tab-close" aria-label={'Закрыть материал: '+item.label}
              onClick={()=>closeInspectorPreview(item.key)}>×</button>
          </div>)}
      </div>
      <div className="v8-inspector-content">
        {inspectorTab==='context'&&<>
          <div className="eyebrow">КОНТЕКСТ РУКОВОДИТЕЛЯ</div><h2>{org?.name??'Ваша организация'}</h2>
          <p className="muted">{org?'Работа относится только к выбранной организации.':'Создайте группу или организацию и подготовьте первые поручения.'}</p>
          <div className="inspector-card"><strong>Следующий шаг</strong><p>{!org?'Укажите название организации.':!org.workspaces.length?'Добавьте рабочую область.':!org.participants.length?'Добавьте сотрудников и определите роли.':!org.assignments.length?'Подготовьте поручение для сотрудника.':'Проверьте критерии результата, источник Atlas и подписанный T3.'}</p></div>
        </>}
        {inspectorTab==='tasks'&&<>
          <h2>Поручения организации</h2><p className="muted">Сохранённые черновики, не подписанные Task.</p>
          {org?.assignments.map(item=><button className="v8-inspector-task" key={item.id}
            type="button" onClick={()=>startAssignment(item)}><strong>{item.title}</strong><small>{item.dueDate||'Без срока'}</small></button>)}
          {!org?.assignments.length&&<p className="muted">Поручений пока нет.</p>}
          <button className="secondary" type="button" onClick={()=>go('work')}>Открыть поручения</button>
        </>}
        {inspectorTab==='selected'&&<div className="v8-inspector-detail" data-testid="v8-inspector-detail">
          {!selectedPreview&&<p className="muted">Выберите работу, сотрудника, рабочую область или проект.</p>}
          {previewTask&&<>
            <div className="eyebrow">ПОРУЧЕНИЕ</div><h2>{previewTask.title}</h2>
            <p className="muted">Черновик {previewTask.editNumber} · {previewTask.dueDate||'Без срока'}</p>
            <div className="inspector-card"><strong>Что требуется</strong><p>{previewTask.description||'Описание не указано'}</p></div>
            <div className="inspector-card"><strong>Критерии приёмки</strong><p>{previewTask.criteria||'Не указаны'}</p></div>
            <div className="inspector-card"><strong>Исполнитель</strong><p>{org?.participants.find(p=>p.id===previewTask.assigneeId)?.name||'Не выбран'}</p>
              <strong>Кто принимает Result</strong><p>{org?.participants.find(p=>p.id===previewTask.reviewerId)?.name||'Не выбран'}</p>
              <strong>Atlas</strong><p>{previewTask.atlasRef?previewTask.atlasRef.projectId+' · редакция '+previewTask.atlasRef.revision:'Без связи с Atlas'}</p>
            </div>
            <button className="primary" type="button" onClick={()=>startAssignment(previewTask)}>Редактировать поручение</button>
          </>}
          {previewPerson&&<>
            <div className="eyebrow">СОТРУДНИК</div><h2>{previewPerson.name}</h2>
            <div className="inspector-card"><strong>Функция</strong><p>{previewPerson.roleLabel||'Не указана'}</p>
              <strong>Personal Agent</strong><p>{previewPerson.personalAgentPlan==='PLANNED'?'Место запланировано':'Место не запланировано'}</p>
              <strong>Подписанные права</strong><p>Проверяются отдельно в исходном T3 Kernel.</p>
            </div>
            <button className="secondary" type="button" onClick={()=>openEmployeeConnection(previewPerson.id)}>
              Открыть подключение T3
            </button>
          </>}
          {previewWorkspace&&<>
            <div className="eyebrow">РАБОЧАЯ ОБЛАСТЬ</div><h2>{previewWorkspace.name}</h2>
            <div className="inspector-card"><strong>План Atlas</strong><p>{previewWorkspace.atlasRef?previewWorkspace.atlasRef.projectId+' · редакция '+previewWorkspace.atlasRef.revision:'Не привязан'}</p></div>
            <h3>Поручения</h3>
            {org?.assignments.filter(a=>a.workspaceId===previewWorkspace.id).map(a=>
              <button key={a.id} type="button" className="v8-inspector-task"
                onClick={()=>startAssignment(a)}><strong>{a.title}</strong><small>{a.dueDate||'Без срока'}</small></button>)}
            {!org?.assignments.some(a=>a.workspaceId===previewWorkspace.id)&&<p className="muted">Поручений пока нет.</p>}
            <button type="button" className="secondary" onClick={()=>go('resources')}>Все рабочие области</button>
          </>}
          {previewProject&&<>
            <div className="eyebrow">ПРОЕКТ ATLAS</div><h2>{previewProject.name}</h2>
            <div className="inspector-card"><strong>Редакция портфеля</strong><p>{observedAtlas?.revision||'Не определена'}</p>
              <strong>Работы</strong><p>{previewProject.total} всего · {previewProject.done} завершены · {previewProject.blocked} заблокированы</p></div>
            <h3>Работы проекта</h3>
            {previewProject.workItems.slice(0,20).map(item=><button type="button" className="v8-inspector-task" key={item.id}
              onClick={()=>{if(observedAtlas)prepareAtlasWork(linkableAtlasWork(observedAtlas,previewProject.id,item.id));}}>
              <strong>{item.title}</strong><small>{item.state} · {item.dueDate||'Без срока'}</small>
            </button>)}
          </>}
          {selectedPreview&&!previewTask&&!previewPerson&&!previewWorkspace&&!previewProject&&
            <p className="muted">Материал не найден в текущем контексте. Выберите его снова.</p>}
        </div>}
        {inspectorTab==='sources'&&<>
          <h2>Корпоративные источники</h2>
          <div className="inspector-card"><strong>Исходный T3 Owner</strong>
            <p>Сведения доступны только после оригинального подписанного чтения.</p></div>
          <div className="inspector-card"><strong>Atlas</strong>
            <p>{observedAtlas?'Открыто проектов: '+observedAtlas.projects.length:'Источник не открыт'}</p></div>
          <button className="secondary" type="button" onClick={()=>go('results')}>Открыть Result / Review</button>
        </>}
      </div>
    </aside>
  </div>;
}
function Empty({title,text}:{title:string;text:string}) {return <div className="empty"><span className="empty-icon" aria-hidden="true">◇</span><h3>{title}</h3><p>{text}</p></div>;}
function AssignmentRow({item,org,atlasView,onClick}:{item:Assignment;org:Organization;atlasView:AtlasPortfolioView|null;onClick:()=>void}) {
 const status=atlasWorkReadback(atlasView,item.atlasRef);
 return <button className="assignment-row" onClick={onClick} data-testid="assignment-row"><span className="task-mark">▤</span><span className="row-content"><strong>{item.title}</strong><small>{org.participants.find(p=>p.id===item.assigneeId)?.name??'Исполнитель не выбран'} · {item.dueDate||'Без срока'}</small><small className="muted" data-testid="assignment-atlas-status">{workStatusLabels[status]}</small></span><span className="status neutral">Черновик {item.editNumber}</span><span aria-hidden="true">›</span></button>;
}
