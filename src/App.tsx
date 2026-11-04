import React, {useEffect, useRef, useState} from 'react';
import {emptyDraft, applyDraftCommand, decodeDraft, encodeDraft, overview} from './organization.mjs';
import {readAtlasPortfolio, linkableAtlasProject, linkableAtlasWork, atlasLinkReadback, atlasWorkReadback} from './atlas-integration.mjs';
import NativeAtlasPanel from './NativeAtlasPanel';
import CorporatePanel from './CorporatePanel';
import './style.css';

type Participant = {id: string; name: string; roleLabel: string; credentialState: string; personalAgentPlan?: 'NONE'|'PLANNED'};
type AtlasRef = {projectId:string;revision:string;workId?:string};
type SourceResultRef={organizationId:string;workspaceId:string;taskId:string;taskRevisionId:string;resultRevisionId:string;acceptanceId:string};
type Assignment = {sourceResultRef?:SourceResultRef|null;id: string; title: string; workspaceId: string; assigneeId: string | null; reviewerId: string | null; description: string; criteria: string; dueDate: string; priority: string; editNumber: number; status: string; atlasRef: AtlasRef|null; createdAt: string; updatedAt: string};
type Organization = {id: string; name: string; kind: string; workspaces: {id: string; name: string; atlasRef?: AtlasRef|null}[]; participants: Participant[]; assignments: Assignment[]};
type Draft = {format: string; version: number; organizations: Organization[]; activeOrganizationId: string | null; updatedAt: string};
type AtlasPortfolioView = {source:string;revision:string;authorization:string;mode:string;projects:Array<{id:string;name:string;status:string;owner:string;dueDate:string;total:number;done:number;blocked:number;progress:number|null;stages:number;workItems:Array<{id:string;title:string;state:string;dueDate:string;priority:string}>}>;dependencies:Array<{from:string;to:string;kind:string}>};
type Editor = {sourceResultRef:SourceResultRef|null;assignmentId?: string; expectedEditNumber?: number; title: string; workspaceId: string; assigneeId: string; reviewerId: string; description: string; criteria: string; dueDate: string; priority: string; atlasRef: AtlasRef|null};
type Page = 'overview'|'work'|'results'|'resources'|'people'|'programs'|'data';
const pages: [Page, string, string][] = [['overview','Обзор','◫'],['resources','Планы Atlas','◇'],['work','Поручения','☷'],['results','Результаты','▤'],['people','Сотрудники и роли','♧'],['programs','Personal Agent и лицензии','▦'],['data','Данные и настройки','⚙']];
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
  ATLAS_PROJECT_NOT_IN_PREVIEW:'Выбранный проект отсутствует в открытом портфеле Atlas.',
  ATLAS_WORK_NOT_IN_PREVIEW:'Выбранная работа отсутствует в открытом проекте Atlas.'
};

async function nativeInvoke(command: string, args?: Record<string, unknown>): Promise<any> {
  const internal = (window as any).__TAURI_INTERNALS__;
  if (!internal) throw Error('NATIVE_HOST_UNAVAILABLE');
  return internal.invoke(command, args);
}
export default function App() {
  const nativeHost = Boolean((window as any).__TAURI_INTERNALS__);
  const [nativeRestoring,setNativeRestoring] = useState(nativeHost);
  const [state,setState] = useState<Draft>(() => emptyDraft() as Draft);
  const [page,setPage] = useState<Page>('overview');
  const [editor,setEditor] = useState<Editor|null>(null);
  const [creatingOrg,setCreatingOrg] = useState(false);
  const [menuOpen,setMenuOpen] = useState(false);
  const [dirty,setDirty] = useState(false);
  // A file preview belongs only to the organization where it was opened.
  // It must never become a cross-organization project/authorization source.
  const [atlasFile,setAtlasFile] = useState<{organizationId:string;view:AtlasPortfolioView}|null>(null);
  const activeOrganizationRef=useRef<string|null>(null);
  const [nativeAtlas,setNativeAtlas] = useState<{organizationId:string;view:AtlasPortfolioView}|null>(null);
  const [atlasSelected,setAtlasSelected] = useState('');
  const [atlasWorkspace,setAtlasWorkspace] = useState('');
  const atlasInput = useRef<HTMLInputElement>(null);
  const [message,setMessage] = useState('');
  const [error,setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
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
  const observedAtlas = nativeAtlas?.organizationId===org?.id ? nativeAtlas?.view ?? null : atlasView;
  const stats = overview(state);
  const title = pages.find(row => row[0] === page)![1];

  const problem = (e: unknown) => {
    const code = e instanceof Error ? e.message : String(e);
    setError(errors[code] ?? 'Изменение не выполнено. Проверьте поля и повторите действие.');
    setMessage('');
  };
  const command = (value: any) => {
    try {
      const next = applyDraftCommand(state,value) as Draft;
      setState(next); setDirty(true); setError(''); setMessage('Черновик изменён. Сохраните его в файл.'); return true;
    } catch(e) {problem(e); return false;}
  };
  const go = (next: Page) => {setPage(next); setMenuOpen(false);};
  const reuseAppliedResult = ({description,source}:{description:string;source:SourceResultRef}) => {
    if(!org)return;
    if(editor){setError('Сначала сохраните или закройте редактор поручения.');return;}
    const workspace=org.workspaces.find(w=>w.id===source.workspaceId);
    if(source.organizationId!==org.id||!workspace){
      setError('Исходный Result принадлежит другой организации или рабочей области.');return;
    }
    setEditor({...initialEditor(org),workspaceId:workspace.id,
      atlasRef:workspace.atlasRef??null,sourceResultRef:source,description});
    setError('');go('work');
  };
  const startAssignment = (item?: Assignment) => {
    if (!org) return;
    setEditor(item ? {assignmentId:item.id, expectedEditNumber:item.editNumber, title:item.title, workspaceId:item.workspaceId, assigneeId:item.assigneeId ?? '', reviewerId:item.reviewerId ?? '', description:item.description, criteria:item.criteria, dueDate:item.dueDate, priority:item.priority, atlasRef:item.atlasRef,sourceResultRef:item.sourceResultRef??null} : initialEditor(org));
    go('work');
  };
  const editorField = (name: Exclude<keyof Editor,'atlasRef'>, value: string) => setEditor(old => {
    if (!old) return null;
    if (name==='workspaceId') return {...old,workspaceId:value,
      atlasRef:org?.workspaces.find(w=>w.id===value)?.atlasRef??null,
      sourceResultRef:old.sourceResultRef?.workspaceId===value?old.sourceResultRef:null};
    return {...old,[name]:value};
  });
  const prepareAtlasWork = (ref: AtlasRef) => {
    if (!org) return;
    if (editor) {
      setError('Сохраните или закройте открытый редактор перед выбором другой работы Atlas.');
      return;
    }
    const workspace=org.workspaces.find(w=>w.atlasRef?.projectId===ref.projectId && w.atlasRef?.revision===ref.revision);
    if (!workspace) {
      setError('Сначала свяжите рабочую область с этой редакцией проекта Atlas.');
      return;
    }
    setEditor({...initialEditor(org),workspaceId:workspace.id,atlasRef:ref});
    setError('');go('work');
  };
  const importAtlas = async (file: File) => {
    const sourceOrganizationId=org?.id;
    if(!sourceOrganizationId){setError('Сначала выберите организацию.');return;}
    try {
      const preview=readAtlasPortfolio(await file.text()) as AtlasPortfolioView;
      // File reading may finish after the manager selected another organization.
      if(activeOrganizationRef.current!==sourceOrganizationId)return;
      setAtlasFile({organizationId:sourceOrganizationId,view:preview});
      setAtlasSelected(preview.projects[0]?.id??'');
      setError('');setMessage(`Портфель Atlas прочитан: ${preview.projects.length} проектов. Это просмотр выбранного файла, не живая синхронизация.`);
    } catch(e){if(activeOrganizationRef.current===sourceOrganizationId)problem(e);}
  };
  const selectOrg = (organizationId: string) => {
    if (editor) {setError('Сохраните или закройте открытый редактор поручения перед сменой организации.'); return;}
    if(command({type:'SELECT_ORGANIZATION',organizationId})){
      setAtlasFile(null);setAtlasSelected('');setAtlasWorkspace('');setNativeAtlas(null);
    }
  };
  async function exportFile() {
    if (editor) {setError('Сначала сохраните изменения поручения.'); return;}
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
      if (!nativeHost)setDirty(false);
      setError('');
      setMessage('Файл черновиков экспортирован. Это не .iwxa и не резервная копия организации.');
    } catch(e){problem(e);}
  }
  async function saveFile() {
    if (editor) {setError('Сначала сохраните изменения поручения.'); return;}
    if(!nativeHost){await exportFile();return;}
    try {
      const content=encodeDraft(state);
      const saved=await nativeInvoke('center_draft_save_local',{content});
      if(!saved)throw Error('Не удалось сохранить черновик');
      setDirty(false);setError('');
      setMessage('Черновики сохранены на этом компьютере. Подписанные полномочия T3 пока не подключены.');
    } catch(e){problem(e);}
  }
  async function readDraft(raw: string) {
    try {
      const next = decodeDraft(raw) as Draft;
      if ((dirty || editor) && !window.confirm('Заменить открытые черновики выбранным файлом? Несохранённые изменения будут потеряны.')) return;
      setState(next);setDirty(nativeHost);setAtlasFile(null);setNativeAtlas(null);setAtlasSelected('');setAtlasWorkspace('');setEditor(null);setPage('overview');setCreatingOrg(false);setError('');setMessage('Черновики открыты. Полномочия и корпоративные решения из этого файла не выдаются.');
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
      <label>Название<input name="name" data-testid="org-name" maxLength={160} required autoFocus placeholder="Например, рабочая группа" /></label>
      <label>Тип<select name="kind"><option value="GROUP">Группа или команда</option><option value="ORGANIZATION">Организация</option></select></label>
    </div>
    <button className="primary" data-testid="create-org">Создать черновик организации</button>
  </form>;

  if(nativeRestoring)return <div className="app"><main className="main"><div className="card padded" role="status">Открываем сохранённую работу...</div></main></div>;
  return <div className={`app ${menuOpen?'menu-open':''}`}>
    <aside className="sidebar" aria-label="Основная навигация">
      <div className="brand"><div><strong>IWXA</strong><small>Admin Center</small></div><span className="version">0.1</span></div>
      <div className="organization-select">
        <label htmlFor="active-organization">Организация</label>
        <select id="active-organization" value={state.activeOrganizationId??''} onChange={e=>selectOrg(e.target.value)}>
          {!org && <option value="">Не выбрана</option>}{state.organizations.map(item=><option key={item.id} value={item.id}>{item.name}</option>)}
        </select>
        <button className="sidebar-add" onClick={()=>{if(editor){setError('Сначала сохраните открытый редактор.');return;}setCreatingOrg(true);go('overview');}}>＋ Добавить организацию</button>
      </div>
      <nav>{pages.map(([id,label,icon])=><button key={id} className={`nav-link ${page===id?'active':''}`} aria-current={page===id?'page':undefined} onClick={()=>go(id)} data-testid={`nav-${id}`}><span className="nav-icon" aria-hidden="true">{icon}</span><span>{label}</span>{id==='work' && !!stats.drafts && <em>{stats.drafts}</em>}</button>)}</nav>
      <div className="sidebar-bottom"><div className="local-label"><span className="dot" />Рабочее место руководителя</div><p>Atlas и Personal Agent обязательны для полного маршрута. Подключение пока не завершено.</p></div>
    </aside>

    <main className="main">
      <header className="top"><button className="menu-button quiet" aria-label="Открыть меню" aria-expanded={menuOpen} onClick={()=>setMenuOpen(!menuOpen)}>☰</button><div className="breadcrumb">{org?.name??'Начало работы'} <span>/ {title}</span></div><button className="secondary top-save" onClick={saveFile} disabled={!org}>{nativeHost?'Сохранить на компьютере':'Сохранить файл'}</button></header>
      <div className="page-heading"><div><div className="eyebrow">УПРАВЛЕНИЕ ОРГАНИЗАЦИЕЙ</div><h1>{title}</h1></div><span className="status neutral">Черновики</span></div>
      {error && <div className="notice error" role="alert">{error}</div>}
      {message && <div className="notice" role="status">{message}</div>}
      {(!org || creatingOrg) && organizationForm}

      {org && !creatingOrg && page==='overview' && <>
        <section className="hero"><div className="eyebrow">РАБОТА РУКОВОДИТЕЛЯ</div><h2>Видеть работу целиком и принимать решения</h2><p>План находится в Atlas. Сотрудник выполняет поручение в Personal Agent. Здесь вы управляете работой и принимаете результат.</p><div className="actions"><button className="primary" onClick={()=>startAssignment()} disabled={!org.workspaces.length}>＋ Новое поручение</button><button className="secondary" onClick={()=>go(org.workspaces.length?'people':'resources')}>{org.workspaces.length?'Добавить участника':'Создать рабочую область'}</button></div></section>
        <div className="metrics">
          {[['Рабочие области',stats.workspaces],['Участники',stats.participants],['Черновики поручений',stats.drafts]].map(([label,value])=><div className="card metric" key={label}><span>{label}</span><strong>{value}</strong></div>)}
        </div>
        <section className="card padded"><div className="section-head"><h2>Продолжить работу</h2><button className="quiet" onClick={()=>go('work')}>Все поручения →</button></div>
          {!org.assignments.length ? <Empty title="Пока нет поручений" text="Создайте рабочую область и подготовьте первое поручение с критериями результата."/> : org.assignments.slice(-4).reverse().map(a=><AssignmentRow key={a.id} item={a} org={org} atlasView={observedAtlas} onClick={()=>startAssignment(a)}/>)}
        </section>
      </>}

      {org && page==='resources' && <section className="card padded"><h2>Планы Atlas и рабочие области</h2><p className="muted">Atlas показывает общую картину проектов и зависимостей. Здесь руководитель связывает рабочую область с конкретной редакцией плана. Пока это только черновая ссылка - подключение Atlas ещё не проверено.</p>
        <form className="inline-form" onSubmit={e=>{e.preventDefault();const form=e.currentTarget;if(command({type:'ADD_WORKSPACE',organizationId:org.id,name:new FormData(form).get('name')}))form.reset();}}><input aria-label="Название рабочей области" name="name" required maxLength={160} placeholder="Название рабочей области" data-testid="workspace-name"/><button className="primary" data-testid="add-workspace">Добавить</button></form>
        {org.workspaces.map(w=><div className="simple-row" key={w.id}><span className="small-mark">◇</span><div><strong>{w.name}</strong><small>{w.atlasRef ? `Связанный план Atlas: ${w.atlasRef.projectId} (редакция ${w.atlasRef.revision})` : 'План Atlas пока не указан'}</small></div><span className="muted">{org.assignments.filter(a=>a.workspaceId===w.id).length} поручений</span></div>)}
        <NativeAtlasPanel organizationId={org.id} onLink={ref=>{const workspaceId=org.workspaces.some(w=>w.id===atlasWorkspace)?atlasWorkspace:org.workspaces[0]?.id;if(workspaceId)command({type:'LINK_ATLAS_WORKSPACE',organizationId:org.id,workspaceId,atlasRef:ref});}} onLinkWork={prepareAtlasWork} onObserved={(id,view)=>setNativeAtlas(view?{organizationId:id,view}:null)}/>
        <div className="card nested-form" data-testid="atlas-link-panel">
          <div className="section-head"><h3>Проекты Atlas</h3><button type="button" className="secondary" onClick={()=>atlasInput.current?.click()} data-testid="atlas-import-button">Открыть портфель Atlas</button></div>
          <p className="muted">Откройте файл портфеля из Atlas. Admin Center читает настоящую модель Atlas и показывает проекты, работы и зависимости. Данные проекта не копируются в корпоративные черновики.</p>
          <input type="file" hidden ref={atlasInput} accept=".json,application/json" data-testid="atlas-import-file" onChange={async e=>{const file=e.target.files?.[0];if(file)await importAtlas(file);e.target.value='';}} />
          {atlasView ? <>
            <div className="metrics atlas-summary">
              <div className="card metric"><span>Проекты Atlas</span><strong data-testid="atlas-project-count">{atlasView.projects.length}</strong></div>
              <div className="card metric"><span>Зависимости</span><strong>{atlasView.dependencies.length}</strong></div>
              <div className="card metric"><span>Редакция</span><strong data-testid="atlas-revision">{atlasView.revision}</strong></div>
            </div>
            <div className="atlas-project-list">{atlasView.projects.map(project=><button type="button" key={project.id} data-testid="atlas-project-card" className={`assignment-row atlas-project-card ${atlasSelected===project.id?'chosen':''}`} onClick={()=>setAtlasSelected(project.id)}>
              <span className="task-mark">◇</span><span className="row-content"><strong>{project.name}</strong><small>{project.total} работ · {project.done} завершено · {project.blocked} заблокировано · {project.stages} этапов</small></span><span className="status neutral">{project.progress===null?'Нет работ':project.progress+'%'}</span>
            </button>)}</div>
            {!!org.workspaces.length && !!atlasView.projects.length && <form onSubmit={e=>{e.preventDefault();if(!atlasSelected)return;const workspaceId=atlasWorkspace||org.workspaces[0].id;const link=linkableAtlasProject(atlasView,atlasSelected);command({type:'LINK_ATLAS_WORKSPACE',organizationId:org.id,workspaceId,atlasRef:link});}}>
              <h3>Связать выбранный проект с рабочей областью</h3><div className="form-grid"><label>Рабочая область<select data-testid="atlas-workspace-select" value={atlasWorkspace||org.workspaces[0].id} onChange={e=>setAtlasWorkspace(e.target.value)}>{org.workspaces.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select></label><label>Выбранный проект<input readOnly value={atlasView.projects.find(p=>p.id===atlasSelected)?.name??''} /></label></div>
              <button className="secondary" data-testid="link-atlas">Связать с планом</button>
            </form>}
            {!!atlasSelected && atlasView.projects.find(p=>p.id===atlasSelected)?.workItems.map(item=>
              <button type="button" key={item.id} className="secondary" data-testid="atlas-file-work-to-assignment"
                onClick={()=>prepareAtlasWork(linkableAtlasWork(atlasView,atlasSelected,item.id))}>Подготовить поручение: {item.title}</button>)}
            <p className="muted fine-print">Источник: Atlas project/1 · редакция {atlasView.revision}. Права на проект и актуальность файла не проверены. Связь сохраняет только ID и редакцию.</p>
          </> : <Empty title="Откройте портфель Atlas" text="Когда вы выберете файл экспорта Atlas, здесь появятся проекты, прогресс и зависимости."/>}
          {org.workspaces.some(w=>w.atlasRef)&&<div className="atlas-link-readback">{org.workspaces.filter(w=>w.atlasRef).map(w=><p key={w.id}><strong>{w.name}:</strong> {w.atlasRef?.projectId} · {atlasLinkReadback(atlasView,w.atlasRef)==='SOURCE_REVISION_MATCHES'?'Редакция совпадает':atlasLinkReadback(atlasView,w.atlasRef)==='SOURCE_REVISION_CHANGED'?'Редакция плана изменилась':atlasView?'Проект отсутствует в открытом файле':'Файл Atlas не открыт'}</p>)}</div>}
        </div>
        <div className="notice subdued">Для эксплуатационного выпуска связь с Atlas обязательна. Дублировать проекты, зависимости и портфели в Admin Center не будем.</div>
      </section>}

      {org && page==='people' && <section className="card padded"><h2>Сотрудники и их обязанности</h2><p className="muted">Руководитель определяет участников и их обязанности. Подписанные полномочия появятся после подключения действующих организационных механизмов.</p>
        <form className="form-grid member-form" onSubmit={e=>{e.preventDefault();const form=e.currentTarget;const data=new FormData(form);if(command({type:'ADD_PARTICIPANT',organizationId:org.id,name:data.get('name'),roleLabel:data.get('role')}))form.reset();}}>
          <label>Имя<input name="name" required maxLength={160} data-testid="person-name"/></label><label>Функция в команде<input name="role" maxLength={160} placeholder="Например, руководитель"/></label><button className="primary" data-testid="add-person">Добавить участника</button>
        </form>
        {org.participants.map(person=><div className="simple-row" key={person.id}><span className="avatar">{person.name.slice(0,1)}</span><div><strong>{person.name}</strong><small>{person.roleLabel||'Функция не указана'} · {person.personalAgentPlan==='PLANNED'?'Доступ к Personal Agent запланирован':'Место Personal Agent не запланировано'}</small></div><span className="status neutral">Нет подтверждённого допуска</span></div>)}
        {!org.participants.length && <Empty title="Добавьте первого участника" text="Организация может начинать работу с одного человека. Тестовые участники автоматически не создаются."/>}
      </section>}

      {org && page==='work' && <>
        <div className="section-head"><p className="muted">Черновик не считается выданным поручением.</p><button className="primary" disabled={!org.workspaces.length||!!editor} onClick={()=>startAssignment()}>＋ Новое поручение</button></div>
        {editor ? <form className="card form-panel" data-testid="assignment-form" onSubmit={e=>{e.preventDefault();if(command({type:'SAVE_ASSIGNMENT',organizationId:org.id,...editor}))setEditor(null);}}>
          <div className="section-head"><h2>{editor.assignmentId?'Редактировать поручение':'Новое поручение'}</h2><button type="button" className="quiet" onClick={()=>setEditor(null)}>Закрыть редактор</button></div>
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
            : 'Для полного маршрута свяжите рабочую область с проектом Atlas.'}</p>
          <p className="muted" data-testid="assignment-atlas-currentness">{workStatusLabels[atlasWorkReadback(observedAtlas,editor.atlasRef)]}</p>
          {editor.sourceResultRef&&<p className="muted" data-testid="assignment-source-result">Источник: Task {editor.sourceResultRef.taskId}, Result revision {editor.sourceResultRef.resultRevisionId}. Ссылка будет проверена перед выпуском новой подписанной Task.
            <button type="button" className="quiet" onClick={()=>setEditor(old=>old?{...old,sourceResultRef:null}:old)}>Убрать связь</button>
          </p>}
          {editor.atlasRef?.workId && observedAtlas &&
            atlasWorkReadback(observedAtlas,editor.atlasRef)==='SOURCE_REVISION_CHANGED' &&
            <button type="button" className="secondary" data-testid="refresh-assignment-atlas"
              onClick={()=>setEditor(old=>old?.atlasRef?.workId ? {...old,
                atlasRef:linkableAtlasWork(observedAtlas,old.atlasRef.projectId,old.atlasRef.workId)} : old)}>
              Привязать к открытой редакции плана
            </button>}
          <div className="form-footer"><span className="muted">Выдача через T3 пока не выполняется.</span><button className="primary" data-testid="save-assignment">Сохранить черновик</button></div>
        </form> : <section className="card padded">{org.assignments.map(a=><AssignmentRow key={a.id} item={a} org={org} atlasView={observedAtlas} onClick={()=>startAssignment(a)}/>)}{!org.assignments.length && <Empty title="Начните с первого поручения" text={org.workspaces.length?'Укажите цель, ожидаемый результат и срок.':'Сначала добавьте рабочую область в разделе «Проекты и ресурсы».'}/>}</section>}
      </>}

       {org && page==='results' && <CorporatePanel key={org.id} organization={org} invoke={nativeHost?nativeInvoke:null} onReuse={reuseAppliedResult} onPrepare={()=>startAssignment()}/>} 
      {org && page==='programs' && <section className="card padded"><h2>Personal Agent и рабочие лицензии</h2><p className="muted">Руководитель определяет, каким сотрудникам нужен Personal Agent. В этой версии можно подготовить распределение мест. Настоящее предоставление лицензии требует подтверждённого права организации, а выдача организационных полномочий - отдельного действия.</p>
        <div className="metrics"><div className="card metric"><span>Сотрудники</span><strong>{org.participants.length}</strong></div><div className="card metric"><span>Места запланированы</span><strong data-testid="planned-agent-seats">{org.participants.filter(p=>p.personalAgentPlan==='PLANNED').length}</strong></div><div className="card metric"><span>Выданные лицензии</span><strong>—</strong></div></div>
        {org.participants.map(person=><div className="simple-row" key={person.id}><span className="avatar">{person.name.slice(0,1)}</span><div><strong>{person.name}</strong><small>{person.personalAgentPlan==='PLANNED'?'Место запланировано - лицензия ещё не выдана':'Доступ к Personal Agent пока не запланирован'}</small></div><button className="secondary" data-testid="plan-agent-seat" onClick={()=>command({type:'PLAN_PERSONAL_AGENT_ACCESS',organizationId:org.id,participantId:person.id,plan:person.personalAgentPlan==='PLANNED'?'NONE':'PLANNED'})}>{person.personalAgentPlan==='PLANNED'?'Убрать план':'Запланировать место'}</button></div>)}
        {!org.participants.length && <Empty title="Сначала добавьте сотрудников" text="Для каждого сотрудника можно подготовить план доступа к Personal Agent."/>}
        <div className="notice subdued">Разделение ответственности: Publisher выпускает программные лицензии и издательские статусы; Admin Center распределяет подтверждённые места организации и управляет организационными полномочиями. Ни одна кнопка здесь пока не активирует программу.</div>
      </section>}
      {org && page==='data' && <section className="card padded"><h2>Черновики и защищённый обмен</h2><p>Сохраните рабочие черновики перед закрытием. Для поручений и результатов в полном выпуске используется существующий подписанный обмен IWXA с шифрованием age для выбранных получателей.</p><div className="actions"><button className="primary" onClick={saveFile}>{nativeHost?'Сохранить локально':'Сохранить файл черновиков'}</button><button className="secondary" onClick={openFile}>Открыть файл черновиков</button>{nativeHost&&<button className="secondary" onClick={exportFile}>Экспортировать JSON</button>}</div><div className="notice subdued">Локальное сохранение и экспорт содержат только подготовительные черновики. Это не .iwxa и не .iwxa.age, в них нет ключей или принятых решений. Шифрование, получение и восстановление организационных пакетов подключаются к действующему механизму T3 и пока не доступны в интерфейсе.</div></section>}
      {!org && <div className="landing-actions"><button className="secondary" onClick={openFile}>Открыть файл черновиков</button><p className="muted">Работа руководителя связана с Atlas и Personal Agent сотрудников. Сейчас доступна подготовка структуры, без реальной отправки поручений.</p></div>}
      <input ref={fileInput} type="file" accept=".json,application/json" hidden data-testid="open-draft" onChange={async e=>{const file=e.target.files?.[0];if(file)await readDraft(await file.text());e.target.value='';}}/>
      <footer className="footer"><span>IWXA Admin Center · 0.1.0-dev.1</span><span>{dirty||editor?'Есть несохранённые изменения':nativeHost?'Локальный черновик открыт':'Черновик в текущем окне'}</span></footer>
    </main>
    <aside className="inspector" aria-label="Контекст работы руководителя"><div className="eyebrow">КОНТЕКСТ РУКОВОДИТЕЛЯ</div><h2>{org?.name??'Ваша организация'}</h2><p className="muted">{org?'Работа относится только к выбранной организации.':'Создайте группу или организацию и подготовьте первые поручения.'}</p><div className="inspector-card"><strong>Следующий шаг</strong><p>{!org?'Укажите название организации.':!org.workspaces.length?'Добавьте рабочую область и свяжите план Atlas.':!org.participants.length?'Добавьте сотрудников и запланируйте доступ к Personal Agent.':!org.assignments.length?'Подготовьте поручение для сотрудника.':'Проверьте связь с планом и критерии результата.'}</p></div><div className="inspector-card"><strong>Текущий этап</strong><p>Подготовка структуры и поручений.</p><small>В полном выпуске Admin Center управляет корпоративными правами, пакетами и приёмкой через существующие механизмы уровня T3.</small></div></aside>
  </div>;
}
function Empty({title,text}:{title:string;text:string}) {return <div className="empty"><span className="empty-icon" aria-hidden="true">◇</span><h3>{title}</h3><p>{text}</p></div>;}
function AssignmentRow({item,org,atlasView,onClick}:{item:Assignment;org:Organization;atlasView:AtlasPortfolioView|null;onClick:()=>void}) {
 const status=atlasWorkReadback(atlasView,item.atlasRef);
 return <button className="assignment-row" onClick={onClick} data-testid="assignment-row"><span className="task-mark">▤</span><span className="row-content"><strong>{item.title}</strong><small>{org.participants.find(p=>p.id===item.assigneeId)?.name??'Исполнитель не выбран'} · {item.dueDate||'Без срока'}</small><small className="muted" data-testid="assignment-atlas-status">{workStatusLabels[status]}</small></span><span className="status neutral">Черновик {item.editNumber}</span><span aria-hidden="true">›</span></button>;
}
