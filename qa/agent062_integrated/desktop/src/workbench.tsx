import {humanState,taskSourceName} from './human-language';
import {TaskEvidencePanel} from './task-evidence-panel';
import {prepareRevisionTaskDraft} from './k01-revision-task-draft.mjs';
import {TaskModelReadback} from './task-model-readback';
import {nextTaskResultTab} from './task-result-tabs';
import {SavedTaskList} from './saved-task-list';
import {AtlasWorkContextPicker,AtlasWorkContextStatus,type AtlasWorkSelection,type LinkedAtlasWork} from './atlas-work-context';
import {ObsidianNotePicker,ExternalContextStatus,type ObsidianSelection,type ExternalObjectLink} from './obsidian-context';
import {ObsidianNoteDraftControl,ObsidianSavedNotes} from './obsidian-note-draft-control';
import {TaskWorkPanel} from './task-work-panel';
import {CorporateWorkControl} from './corporate-work-control';
import {TaskGoalsPanel} from './task-goals-panel';
import {meetingTranscriptFromTask,reviewMeetingTaskSummary} from './meeting-followup-review';
import {TaskActionsPanel} from './task-actions-panel';
import {OwnerError} from './owner-ui';
import {DialogControl,IntegrationsControl,SettingsControl} from './product-controls';
import {HomeDashboard} from './home-dashboard';
import {readConversationCatalog,readConversationDraft,conversationDraftContext,upsertVerifiedChatSource} from './dialog-conversation';
import {LocalTaskModelChoice,readLocalModelPin,type LocalModelPin} from './local-task-model-choice';
import {TaskReasoningControl} from './task-reasoning-control';
import {TaskWaitStatus} from './task-wait-status';
import {taskFailureGuidance} from './task-failure-guidance';
import {planWorkHandoff,acceptedTaskResultForGraphHandoff,savedInteractiveTaskForDraft,pendingTaskIntent,type PendingTaskIntent,type WorkDestination,type WorkHandoff} from './work-handoff';
import {ProjectsControl} from './projects-control';
import {WorkAreaControl,type WorkArea} from './work-areas-control';
import {readActiveWorkAreaTasks,readTaskInActiveWorkArea,readWorkAreas,selectWorkArea} from './work-area-flow';
import {createNavigationViewPersistence,type NavigationView} from './navigation-view-persistence';
import {KnowledgeMemoryControl,type KnowledgeSourceSelection} from './knowledge-memory-control';
import {ToolsReadControl} from './tools-read-control';
import {AgentControl,AutomationsControl,ChainBuilder,ModelsControl,ProgramsCenter} from './deferred-screens';
import {SkillsControl} from './skills-control';
import {Advanced} from './advanced';
import {ProviderConnections} from './provider-connections';
import {ollamaStageText,ollamaNextPage,requestModelHint,type UserReadiness} from './ollama-user-status';
import {DocumentWorkflow} from './document-workflow';
import {reviewedTaskReadbackMatches,recoveredHumanDecisionMatches,taskReviewPreflightMatches,taskFollowupPreflightMatches} from './task-review-readback';
import {fileWriteReviewStamp,readFileWriteReview} from './task-review-file-candidate';
import {N8nWorkflowProposal} from './n8n-workflow-proposal';
import {N8nTaskLifecycle} from './n8n-task-lifecycle';
import {RecoveryControl} from './recovery-control';
import {FilesControl} from './files-control';
import {commitAndReconcileDomainAttachment,DomainReadbackUnconfirmed} from './t2-domain-composer-readback';
import {T2DomainResultControl,type DomainObjectSelection} from './t2-domain-result-control';
import {IwxaExchangeControl} from './iwxa-exchange-control';
import {ApprovalsControl} from './approvals-control';
import {useUiSettings,HelpTip,pageName} from './ui-preferences';
import React,{useCallback,useEffect,useLayoutEffect,useRef,useState} from 'react';
const K03DiscoveryPanel=React.lazy(()=>import('./k03-discovery-panel').then(m=>({default:m.K03DiscoveryPanel})));
import {isTauri} from '@tauri-apps/api/core';
import {getCurrentWindow} from '@tauri-apps/api/window';
import {SafeMarkdown} from './safe-markdown';
import {observedCoreConnection,coreConnectionLabel,type CoreConnectionState} from './core-connection';
import {verifiedTaskComposerReadback} from './task-composer-readback';
import {composerEditableMatches,composerDigestVerified} from './task-composer-revision';
import {ArrowLeft,Home,CheckSquare,MessageCircle,Folder,BookOpen,Boxes,Blocks,FileText,Brain,SlidersHorizontal,ShieldCheck,CloudOff,Settings,Plus,FolderOpen,PanelRightClose,PanelRightOpen,ChevronRight,Play,Save,ListChecks,ClipboardCheck,FilePlus2,RefreshCcw,Globe,PenLine,FileSearch,History,Network,SquareStack,Sparkles} from 'lucide-react';
import{runtime,RuntimeRequestError}from './runtime-client/interaction';
type Task={id:string;title?:string;status?:string;summary?:string;linked_atlas_work?:boolean};
type Claim={text?:string;basis?:string};
type Candidate={candidate_id?:string;ref_id?:string;tool_id?:string;operation?:string;target?:string;description?:string;arguments?:Record<string,unknown>};
type Source={origin?:string;path?:string;sha256?:string;bytes?:number};
type Snapshot={snapshot_id?:string;source_items?:Source[];retrievals?:{policy?:string;selected?:{ref_id?:string;content_digest?:string}[]}[]};
type Detail={task_id:string;model_inference_active?:boolean;background_submission?:{job_id:string;state:string};linked_atlas_work?:LinkedAtlasWork;linked_external_context?:ExternalObjectLink[];objective:string;status:string;run_seq?:number;summary?:string;draft_artifacts?:string[];claims?:Claim[];uncertainties?:string[];action_candidates?:Candidate[];accepted_action_candidate_ids?:string[];review_required?:boolean;accepted_artifact_digest?:string;local_document_mode?:boolean;requested_local_model?:unknown;provider?:{id?:string;model?:string};readback?:{context_snapshots?:Snapshot[];goals?:{goal_id:string;objective:string;contract_digest:string;complete:boolean}[];graph_runs?:{execution_id:string;graph_id:string;goal_id:string;state:string;completed_node_count:number;node_count:number}[];graph_history_limited?:boolean;assistant_runs?:{hosted_run_id:string;goal_id:string;state:string;created_at:string;final_state?:string}[];
 external_notes?:{path?:string;current_state?:string;after_sha256?:string;open_uri?:string|null;write_verified?:boolean}[];
 scheduled_work?:{job_id:string;state:string;next_attempt_at?:string;last_status?:string;last_task_id?:string;needs_attention?:boolean}[];
 scheduled_history_limited?:boolean;work_boards?:{board_id:string;goal_id:string;board_digest:string;complete:boolean;counts?:Record<string,number>}[];tool_plans?:{plan_id?:string;candidate_id?:string;tool_id?:string;execution_state?:string;execution_receipt_id?:string}[];execution_receipts?:{plan_id?:string;tool_id?:string;status?:string;external_effect_state?:string}[];repair_cases?:{case_id?:string;plan_id?:string;contract_state?:string}[]}};
const navigationGroups=[
 {id:'overview',names:['Главная','Home'],root:'Главная',children:[]},
 {id:'work',names:['Работа','Work'],root:'Задачи',children:['Диалоги','Проекты','Цепочки','Работа в организации']},
 {id:'materials',names:['Материалы','Materials'],root:'Файлы',children:['Знания','Память']},
 {id:'capabilities',names:['Возможности','Capabilities'],root:'Модели',children:['Агенты','Программы','Интеграции','Навыки','Инструменты']},
 {id:'automations',names:['Автоматизации','Automations'],root:'Автоматизации',children:[]},
 {id:'attention',names:['Требует внимания','Needs attention'],root:'Согласования',children:['Восстановление']},
] as const;
const pageIcons:Record<string,typeof Home>={
 'Главная':Home,'Задачи':CheckSquare,'Диалоги':MessageCircle,'Файлы':FileText,
 'Рабочие области':SquareStack,'Работа в организации':ShieldCheck,'Проекты':Folder,'Агенты':Brain,'Программы':Boxes,'Модели':Brain,'Знания':BookOpen,
 'Автоматизации':History,'Цепочки':Network,'Навыки':Sparkles,'Память':BookOpen,
 'Домены':Blocks,'Интеграции':Network,'Инструменты':SlidersHorizontal,
 'Согласования':ClipboardCheck,'Восстановление':RefreshCcw,'Настройки':Settings
};
const products=[['Learn','Образование · Развитие'],['ArtBazy','Диагностика · Продажи'],['Комплектовод','Комплектация · Процессы'],['Другие домены','Самостоятельные продукты']];
const label=(status?:string,language:'ru'|'en'='ru')=>{
 // Task details expose lifecycle states; list projections expose human UI states.
 // Both must be presented accurately, never as an unknown or inferred result.
 const ru:Record<string,string>={
  closed:'Завершена',result_imported:'Нужна проверка',awaiting_revision:'Нужна доработка',
  awaiting_result:'Выполняется',created:'Создана',
  completed:'Результат принят',pending_review:'Нужна проверка результата',
  processing:'Выполняется',pending:'Ожидает',failed:'Ошибка выполнения',
  attention:'Требует проверки',cancelled:'Обработка отменена',
  rejected:'Отклонена'
 };
 const en:Record<string,string>={
  closed:'Closed',result_imported:'Needs review',awaiting_revision:'Revision requested',
  awaiting_result:'Running',created:'Created',
  completed:'Result accepted',pending_review:'Review required',
  processing:'Running',pending:'Pending',failed:'Execution failed',
  attention:'Needs attention',cancelled:'Processing cancelled',
  rejected:'Rejected'
 };
 return (language==='ru'?ru:en)[status||'']||humanState(status,language);
};
// The immutable Task lifecycle can remain awaiting_result after a failed
// background inference. Show the Core-owned job state, not "Running".
function visibleTaskStatus(status:string|undefined,taskId:string,
 queued:{taskId:string;state:string}|null,language:'ru'|'en',modelActive=false):string{
 if(status==='awaiting_result'&&modelActive)return label('processing',language);
 if(status==='awaiting_result'&&queued?.taskId===taskId){
  if(queued.state==='PAUSED'||queued.state==='DEAD')
   return language==='ru'?'Обработка остановлена':'Processing stopped';
  if(queued.state==='CANCELLED')
   return language==='ru'?'Обработка отменена':'Processing cancelled';
  if(queued.state==='SCHEDULED')
   return language==='ru'?'Ожидает выполнения':'Queued';
  if(queued.state==='COMPLETED')
   return language==='ru'?'Нужна проверка результата':'Result readback required';
 }
 return label(status,language);
}
// Only a final background job has no future scheduler claim. Keep running
// and resumable jobs mutually exclusive with a manual inference retry.
function taskRetryBlockedByBackground(queued:{taskId:string;state:string}|null,taskId:string,
 saved?:{state:string}|null,modelActive=false):boolean{
 if(modelActive)return true;
 // Fresh Core Task readback wins over a stale in-memory notification.
 const state=saved?.state??(queued?.taskId===taskId?queued.state:undefined);
 return !!state&&!['DEAD','CANCELLED','COMPLETED'].includes(state);
}
function message(error:unknown){return error instanceof Error?error.message:String(error)}
function taskSubmissionFailure(error:unknown,tr:(ru:string,en:string)=>string):string{
 const reason=error instanceof RuntimeRequestError?error.message:'';
 if(reason==='basic_model_not_ready')return tr(
  'Выбранная модель IWXA не готова. Откройте «Модели», проверьте её запуск и ответ. Черновик останется сохранённым.',
  'The selected IWXA model is not ready. Open Models, check activation and its answer. The draft remains saved.');
 if(reason==='basic_runtime_model_pin_changed')return tr(
  'Выбранная GGUF-модель изменилась. Проверьте модель в «Модели» и выбор в черновике. Задача не запускалась.',
  'The selected GGUF model changed. Check Models and the model selected in the draft. The Task was not started.');
 return message(error);
}
const safeName=(n:string)=>n.length>0&&n.length<=120
 &&n===n.normalize('NFC')&&/^[\p{L}\p{N}_ .()-]+$/u.test(n)
 &&!n.includes('..')&&!/[. ]$/.test(n)
 &&!/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/i.test(n);
export function App(){
 const {language,theme,workMode,setWorkMode,toggleLanguage,toggleTheme,tr,persistenceError,t3Enabled,t3Busy,setT3,reloadT3}=useUiSettings();
 const[skills,setSkills]=useState<{skill_id:string;name?:string;description?:string}[]>([]),[skill,setSkill]=useState('');
 const selectedSkillCurrent=useRef(skill);
 selectedSkillCurrent.current=skill;
 const[useMemory,setUseMemory]=useState(true),[useObsidian,setUseObsidian]=useState(false),[useWeb,setUseWeb]=useState(false);
 const[k03Open,setK03Open]=useState(false);
 const k03TaskInput=useRef<HTMLTextAreaElement|null>(null);
 const k03ApplyInFlight=useRef(false);
 const[k03DraftBusy,setK03DraftBusy]=useState(false);
 const[taskReasoningPending,setTaskReasoningPending]=useState(false);
 const[taskReasoningSaving,setTaskReasoningSaving]=useState(false);
 const[returnPage,setReturnPage]=useState<string|null>(null);
 const[page,setPageState]=useState('Главная'),[tasks,setTasks]=useState<Task[]>([]),[selected,setSelected]=useState(''),[detail,setDetail]=useState<Detail|null>(null),[status,setStatus]=useState<Record<string,unknown>|null>(null),[setup,setSetup]=useState<Record<string,unknown>|null>(null);
 const[coreConnection,setCoreConnection]=useState<CoreConnectionState>('checking');
 const currentPage=useRef(page);
 currentPage.current=page;
 const navigationSave=useRef<Promise<void>|null>(null);
 const deferredConversationPage=useRef<string|null>(null);
 const deferredDialogueTask=useRef<string|null>(null);
 const deferredWorkspacePage=useRef<string|null>(null);
 const workspaceSwitchOrigin=useRef<string|null>(null);
 const focusNewTask=useRef(false);
 // Draft readiness belongs to the same initial React state as request navigation.
 const[draftLoaded,setDraftLoaded]=useState(false);
 // Only explicit/app navigation changes this sequence. A delayed saved-view
 // response must never replace a page the user chose while IWXA was opening.
 const navigationActionEpoch=useRef(0);
 // A user may open New request before the first Core Workspace readback.
 // Its initial completion must not overwrite the chosen page.
 const startupNavigationCommitted=useRef(false);
 const documentLeaveGuard=useRef<null|(()=>void)>(null);
 const documentCloseFlush=useRef<null|(()=>Promise<void>)>(null);
 const registerDocumentCloseFlush=useCallback((flush:null|(()=>Promise<void>))=>{
  documentCloseFlush.current=flush;
 },[]);
 const registerDocumentLeaveGuard=useCallback((guard:null|(()=>void))=>{
  documentLeaveGuard.current=guard;
 },[]);
 const checkDocumentExit=()=>{
  try{documentLeaveGuard.current?.();return true}
  catch(err){
   if(message(err)==='document_draft_not_saved'){
    setError(tr('Сохранение черновика документа ещё не подтверждено. Сохраните его перед переходом.',
     'The document draft has not been verified as saved. Save it before leaving.'));
    return false;
   }
   setError(tr('Действие с документом ещё не завершено. Дождитесь результата.',
    'The document action is still in progress. Review its outcome before leaving.'));
   return false;
  }
 };
 // Every exit from a conversation must verify its Core draft before React
 // unmounts the editor, including sidebar, tool and task navigation.
 const setPage:React.Dispatch<React.SetStateAction<string>>=(choice)=>{
  const next=typeof choice==='function'?choice(currentPage.current):choice;
  const commitNavigation=(target:string)=>{
   // A successful user navigation becomes one step of Back history.
   // Restored views are not new user visits.
   setReturnPage(navigationRestored?currentPage.current:null);
   if(!committedWorkAreaId.current)startupNavigationCommitted.current=true;
   // User navigation wins even when Core's startup draft has not finished.
   // Otherwise restoring a saved Overview can overwrite an early New request.
   setNavigationRestored(true);
   setPageState(target);
  };
  navigationActionEpoch.current++;
  if(next!=='Задачи'){
   focusNewTask.current=false;
   deferredDialogueTask.current=null;
  }
  if(currentPage.current==='Диалоги'&&navigationSave.current){
   deferredConversationPage.current=next;return;
  }
  if(workspaceSwitchInFlight.current){
   // Keep even a same-page click: Workspace selection will reset this view.
   deferredWorkspacePage.current=next;
   return;
  }
  if(next===currentPage.current){
   // An explicit same-page choice also supersedes pending saved-view restore.
   if(!committedWorkAreaId.current)startupNavigationCommitted.current=true;
   if(!navigationRestored||navigationRestoreFailure){
    setNavigationRestored(true);
    if(navigationRestoreFailure)setNavigationRestoreFailure('');
   }
   return;
  }
  if(currentPage.current==='Задачи'&&next!=='Задачи'&&!checkDocumentExit())return;
  if(currentPage.current==='Диалоги'&&next!=='Диалоги'){
   deferredConversationPage.current=next;
   const flush=conversationCloseFlush.current;
   if(!flush){
    deferredDialogueTask.current=null;
    setError(tr('Диалог ещё открывается. Повторите переход после восстановления.',
     'The conversation is still loading. Retry navigation once it opens.'));
    return;
   }
   const pending=flush().then(()=>{
    const latest=deferredConversationPage.current;
    if(currentPage.current==='Диалоги'&&latest&&latest!=='Диалоги'){
     commitNavigation(latest);
     if(navigationRestoreFailure){setNavigationRestoreFailure('');setNavigationRestored(true);}
    }
   }).catch(err=>{
    focusNewTask.current=false;
    deferredDialogueTask.current=null;
    setError(tr('Не удалось сохранить диалог перед переходом. Он остался открытым. ',
     'Could not save the conversation before navigation. It remains open. ')+message(err));
   })
   .finally(()=>{deferredConversationPage.current=null;navigationSave.current=null});
   navigationSave.current=pending;
   return;
  }
  commitNavigation(next);
  if(navigationRestoreFailure){setNavigationRestoreFailure('');setNavigationRestored(true);}
 };
 function clearSelectedTaskForRequest(){
  // The saved Core composer stays intact; a new request is not an old Task.
  taskReadSequence.current++;
  selectedTaskCurrent.current='';
  setSelected('');setDetail(null);setDetailFresh(false);
  setDocumentTab('result');setRelatedPanelsTaskId('');setSelectedCandidates([]);
 }
 function focusRequestEditor(){
  const field=document.getElementById('request') as HTMLTextAreaElement|null;
  field?.focus();
  field?.scrollIntoView({block:'nearest'});
 }
 function startNewTask(){
  deferredDialogueTask.current=null;
  // Opening an editor is UI navigation, not a Core write. Even while the
  // Core-owned draft is loading, the user can see where the editor will be.
  if(currentPage.current==='Задачи'&&!workspaceSwitchInFlight.current&&!checkDocumentExit())return;
  focusNewTask.current=true;
  if((currentPage.current==='Задачи'||currentPage.current==='Главная')&&!workspaceSwitchInFlight.current){
   navigationActionEpoch.current++;
   // Focusing the visible request editor on Home or Tasks is an explicit choice,
   // including when Core's saved-view restoration has not finished.
   if(!committedWorkAreaId.current)startupNavigationCommitted.current=true;
   if(!navigationRestored||navigationRestoreFailure){
    setNavigationRestored(true);
    if(navigationRestoreFailure)setNavigationRestoreFailure('');
   }
   clearSelectedTaskForRequest();
   if(draftLoaded){
    focusNewTask.current=false;
    window.requestAnimationFrame(focusRequestEditor);
   }
  }else setPage('Задачи');
 }
 useEffect(()=>{
  if(!['Главная','Задачи'].includes(page)||!focusNewTask.current)return;
  // Hide the old Task result while waiting for the saved composer readback.
  clearSelectedTaskForRequest();
  if(!draftLoaded)return;
  focusNewTask.current=false;
  window.requestAnimationFrame(focusRequestEditor);
 },[page,draftLoaded]);
 const selectedTaskCurrent=useRef(selected);
 selectedTaskCurrent.current=selected;
 const[sessionRecovery,setSessionRecovery]=useState<'recovering'|'restored'|'failed'|null>(null);
 // Increment only after a new Core session has been authenticated.
 // The displayed Task and file-history projections must then be re-read.
 const[sessionReadbackEpoch,setSessionReadbackEpoch]=useState(0);
 const composerReady=useRef(false);
 const composerWorkspace=useRef<string|null>(null);
 const initialRestoredComposerSnapshot=useRef<string|null>(null);
 const composerDraftRevision=useRef<string|null>(null);
 const savedComposerSignature=useRef<string|null>(null);
 const composerSaveBlocked=useRef(false);
 const [composerSaveFailure,setComposerSaveFailure]=useState('');
 const [composerLoadAttempt,setComposerLoadAttempt]=useState(0);
 useEffect(()=>runtime.onSessionNotice(notice=>{
  setSessionRecovery(notice);
  if(notice==='recovering'||notice==='restored')setCoreConnection('checking');
  if(notice==='failed')setCoreConnection('unavailable');
  if(notice==='restored'){
   setSessionReadbackEpoch(epoch=>epoch+1);
   // Retry initial draft read only if it never succeeded. Never replace
   // edits already present in this window with an older Core snapshot.
   if(!composerReady.current)setComposerLoadAttempt(value=>value+1);
   // Do not resubmit any command: reload only Core-owned observations.
   setDetailFresh(false);
   void refresh();
   void reloadT3().catch(()=>{});
  }
 }),[]);
 const[busy,setBusy]=useState(''),[error,setError]=useState(''),[text,setText]=useState(''),[files,setFiles]=useState<{name:string;text:string}[]>([]),[inspector,setInspector]=useState(true);
 const[submissionRecoveryNotice,setSubmissionRecoveryNotice]=useState('');
 const[queuedRequest,setQueuedRequest]=useState<{submissionId:string;taskId:string;state:string;partial:string;errorCode?:string}|null>(null);
 const[knowledgeSources,setKnowledgeSources]=useState<KnowledgeSourceSelection[]>([]);
 const[atlasWork,setAtlasWork]=useState<AtlasWorkSelection|null>(null);
 const[obsidianNote,setObsidianNote]=useState<ObsidianSelection|null>(null);
 const[localPin,setLocalPin]=useState<LocalModelPin|null>(null);
 const[workAreas,setWorkAreas]=useState<WorkArea[]>([]),[activeArea,setActiveArea]=useState<WorkArea|null>(null);
 const[areaLoaded,setAreaLoaded]=useState(false),[areaError,setAreaError]=useState('');
 const workAreaReadEpoch=useRef(0);
 // Retry at most one initial read-only Workspace observation if Core
 // answered status while the parallel Workspace read was unavailable.
 const initialWorkspaceReadRetried=useRef(false);
 // Wait for the existing initial read before deciding whether a quick close
 // can use the verified Workspace; never infer admission from Core status.
 const startupWorkspaceRead=useRef<Promise<boolean>|null>(null);
 const committedWorkAreaId=useRef<string|null>(null);
 const loadWorkAreas=async(knownAreaId?:string)=>{
  const epoch=++workAreaReadEpoch.current;
  try{
   const snapshot=await readActiveWorkAreaTasks<Task>(runtime,100,knownAreaId);
   if(epoch!==workAreaReadEpoch.current)return;
   const data=snapshot.catalog as {active_id:string;areas:WorkArea[]};
   const area=data.areas.find(a=>a.id===data.active_id);
   if(!area)throw Error('work_area_readback_invalid');
   // Updating metadata, permissions or goals of the same Workspace must
   // retain the selected Task, document editor and restored navigation.
   // Only an actual change of active Workspace invalidates those projections.
   const changed=committedWorkAreaId.current!==area.id;
   const keepStartupPage=changed&&committedWorkAreaId.current===null
    &&startupNavigationCommitted.current;
   const externalChange=changed&&committedWorkAreaId.current!==null
    &&!workspaceSwitchInFlight.current;
   if(changed){
    // Never offer a Back route into a different Workspace.
    setReturnPage(null);
    taskReadSequence.current++;
    setQueuedRequest(null);setAtlasWork(null);setObsidianNote(null);
    setSelected('');setDetail(null);setDetailFresh(false);
    setDocumentTab('result');
    // Only an untouched initial view restores from Core preferences.
    // A user who already clicked New request keeps that page.
    setNavigationRestored(keepStartupPage);
    setNavigationRestoreFailure('');lastSavedView.current='';
    startupNavigationCommitted.current=false;
   }
   committedWorkAreaId.current=area.id;
   setWorkAreas(data.areas);setActiveArea(area);
   setAreaLoaded(true);
   setAreaError(externalChange?tr(
    'Рабочая область изменилась вне этого окна. Черновики предыдущей области не переносились. Проверьте сохранённую работу.',
    'Workspace changed outside this window. Drafts from the previous area were not transferred. Check saved work.'
   ):'');
   setTasks(snapshot.tasks);
   if(changed&&!keepStartupPage){
    // An actual Workspace switch still resets the view; the first Core
    // readback must not undo an explicit page choice made during startup.
    setPageState('Главная');
   }
  }catch(e){if(epoch===workAreaReadEpoch.current)throw e;}
 };
 // One initial Workspace/Task/status projection, independent of composer
 // draft restoration. The latter must never auto-select an arbitrary Task.
 useEffect(()=>{
  const pending=refresh();
  startupWorkspaceRead.current=pending;
  const clear=()=>{if(startupWorkspaceRead.current===pending)startupWorkspaceRead.current=null;};
  void pending.then(clear,clear);
 },[]);
 useEffect(()=>{
  if(!activeArea)return;
  let active=true;
  // Recover unfinished model work without introducing another local store.
  // On a confirmed Workspace change the previous area's queued job is not
  // part of this screen. A fresh Core read may restore a job for this area.
  void runtime.query<{jobs:Record<string,unknown>[]}>('automation_jobs',{limit:200}).then(value=>{
   if(!active)return;
   const rows=Array.isArray(value.jobs)?value.jobs:[];
   const job=rows.find(row=>{
    const payload=(row.payload&&typeof row.payload==='object'?row.payload:{}) as Record<string,unknown>;
    return payload.interactive===true&&payload.workspace_id===activeArea.id
      &&['SCHEDULED','RUNNING','PAUSED','DEAD'].includes(String(row.state));
   });
   const p=job?.payload&&typeof job.payload==='object'?job.payload as Record<string,unknown>:null;
   if(p&&typeof p.submission_id==='string'&&typeof p.task_id==='string'){
    setQueuedRequest(current=>current||{
     submissionId:p.submission_id as string,taskId:p.task_id as string,
     state:String(job?.state||'SCHEDULED'),partial:''
    });
   }
  }).catch(()=>{/* Canonical Tasks remain available if job history cannot be read. */});
  return()=>{active=false};
 },[activeArea?.id]);
 const[review,setReview]=useState(false),[decision,setDecision]=useState(''),[notes,setNotes]=useState(''),[selectedCandidates,setSelectedCandidates]=useState<string[]>([]);
 const[fileReviewConfirmed,setFileReviewConfirmed]=useState<string|null>(null);
 useEffect(()=>{setFileReviewConfirmed(null)},[review,selected,decision]);
 const[draftLoadFailure,setDraftLoadFailure]=useState('');
 const[documentTab,setDocumentTab]=useState<'result'|'history'|'sources'|'plan'>('result');
 const[relatedPanelsTaskId,setRelatedPanelsTaskId]=useState('');
 const[focusPlanId,setFocusPlanId]=useState('');
 const[planFocusRequest,setPlanFocusRequest]=useState(0);
 const[navigationRestored,setNavigationRestoredState]=useState(false);
 // Native close may arrive before React rerenders after a valid navigation
 // choice. Mirror the existing restored state for the close callback.
 const navigationRestoredCurrent=useRef(navigationRestored);
 navigationRestoredCurrent.current=navigationRestored;
 const setNavigationRestored=(value:boolean)=>{
  navigationRestoredCurrent.current=value;
  setNavigationRestoredState(value);
 };
 const[navigationRestoreAttempt,setNavigationRestoreAttempt]=useState(0);
 const[navigationRestoreFailure,setNavigationRestoreFailure]=useState('');
 const lastSavedView=useRef('');
 const navigationSaveEpoch=useRef(0);
 const navigationPersistence=useRef(createNavigationViewPersistence(runtime));
 const navigationViewCurrent=useRef<NavigationView>({
  page:'Главная',area_id:'',task_id:'',document_tab:'result'
 });
 navigationViewCurrent.current={
  page,area_id:activeArea?.id||'',task_id:selected,document_tab:documentTab
 };
 async function flushNavigationView(){
  const view=navigationViewCurrent.current,signature=JSON.stringify(view);
  // Distinguish the existing gates without logging Workspace IDs. None may
  // be skipped; Core still acknowledges the final save and readback.
  if(!navigationRestoredCurrent.current)
   throw Error('ui_navigation_context_not_verified:restoration_'+(navigationRestoreFailure?'failed':'pending'));
  if(!view.area_id)throw Error('ui_navigation_context_not_verified:workspace_missing');
  if(committedWorkAreaId.current!==view.area_id)
   throw Error('ui_navigation_context_not_verified:workspace_mismatch');
  // Invalidate the debounce. The existing serializer waits for a preceding
  // preference write before confirming this final view.
  navigationSaveEpoch.current++;
  await navigationPersistence.current.save(view);
  if(JSON.stringify(navigationViewCurrent.current)!==signature
     ||committedWorkAreaId.current!==view.area_id)
   throw Error('ui_navigation_changed_during_save');
  lastSavedView.current=signature;
 }
 const[documentFocus,setDocumentFocus]=useState(0);
 const[recoveryFocusCase,setRecoveryFocusCase]=useState('');
 const[programFocus,setProgramFocus]=useState('');
 const[agentRunFocus,setAgentRunFocus]=useState('');
 const[workHandoff,setWorkHandoff]=useState<WorkHandoff|null>(null);
  const[graphExecutionFocus,setGraphExecutionFocus]=useState('');
 const[automationFocus,setAutomationFocus]=useState('');
 const[relatedActionBusy,setRelatedActionBusy]=useState('');
 const[expandedNavigation,setExpandedNavigation]=useState<string|null>(null);
 const openProgram=(programId:string)=>{setProgramFocus(programId);setPage('Программы');};
 const openGraphExecution=(id:string)=>{
  // The destination focus must not survive a blocked document exit.
  if(currentPage.current==='Задачи'&&!checkDocumentExit())return;
  setWorkHandoff(null);setGraphExecutionFocus(id);setPage('Цепочки');
 };
 function continueTaskIn(target:WorkDestination,source:'draft'|'accepted'|'accepted-result'='draft',linkedGoalId:string|null=null,linkedBoardId:string|null=null){
  try{
   const acceptedResult=detailFresh&&detail?.task_id===selected&&detail?.status==='closed'&&!!detail.accepted_artifact_digest;
   if(source!=='draft'&&!acceptedResult)throw Error('work_handoff_source_not_accepted');
   const useAccepted=source!=='draft';
   if(source==='accepted-result'&&target!=='Цепочки')throw Error('work_handoff_target_invalid');
   // The original objective remains the default for Goals, assistants and
   // schedules. Only this explicit Result action copies the complete
   // accepted text into a new, unexecuted Graph draft.
   const objective=source==='accepted-result'
    ?acceptedTaskResultForGraphHandoff(detail)
    :useAccepted?detail!.objective:text;
   const pin=useAccepted?readLocalModelPin(detail?.requested_local_model):localPin;
   const sourceId=useAccepted?detail!.task_id:null;
   const next=planWorkHandoff(target,objective,pin,files.length>0||knowledgeSources.length>0,
    sourceId,linkedGoalId,linkedBoardId,
    source==='accepted-result'?detail!.objective.slice(0,240):null);
   // A rejected document leave must not leave a latent handoff for later navigation.
   if(currentPage.current==='Задачи'&&!checkDocumentExit())return;
   if(target==='Агенты'&&!window.confirm(tr(
    'Перенести только цель задачи к помощникам? Личные файлы и заметки не передаются. Перед запуском оставьте только открытые или учебные сведения.',
    'Copy only the objective to assistants? Files and notes are not transferred. Before running, use public or sample data only.'
   )))return;
   setWorkHandoff(next);setPage(target);setError('');
  }catch(e){
   const code=message(e);
   setError(code==='work_handoff_objective_missing'
    ?tr('Введите цель в черновике или выберите принятый результат.','Enter a draft objective or choose an accepted result.')
    :code==='work_handoff_source_not_accepted'
    ?tr('Выбранная задача ещё не имеет принятого результата.','The selected task does not yet have an accepted result.')
    :code==='work_handoff_result_unavailable'||code==='work_handoff_result_incomplete'
    ?tr('Полный принятый Result не подтверждён. Откройте задачу и проверьте сохранённый текст перед переносом.',
        'The complete accepted Result is unverified. Open the Task and check its saved text before continuing.')
    :code==='work_handoff_accepted_result_too_long'
    ?tr('Принятый Result превышает предел Graph 500 000 символов. Автоматически обрезать его нельзя. Выберите фрагмент или разделите работу на шаги.',
        'The accepted Result exceeds the Graph limit of 500,000 characters. It cannot be silently truncated. Select an excerpt or split the work into steps.')
    :tr('Цель слишком длинная для выбранного способа. Сократите текст, не удаляя исходный черновик.',
        'The objective is too long for this workflow. Shorten it without deleting your original draft.'));
  }
 }
 const[inlineToolsOpen,setInlineToolsOpen]=useState(false);
 const[inlineWorkflowOpen,setInlineWorkflowOpen]=useState(false);
 const[connectionFocus,setConnectionFocus]=useState('model');
 const[toolFocus,setToolFocus]=useState('');
 async function attachToolReadToDraft(destination:'task'|'dialogue',receiptId:string,data:unknown){
  // The tool has already been read exactly once. This operation only
  // transfers verified evidence into the chosen conversation's existing draft.
  // Keep the selected editor authoritative. Never overwrite uncommitted
  // Task edits while importing a separate tool result.
  if(destination==='task'){
   if(!draftLoaded||composerSaveBlocked.current||submitInFlight.current||acceptedEvidenceTransfer.current)
    throw Error('task_draft_not_ready');
   const before=currentComposer.current;
   draftSaveEpoch.current++;
   await draftWriteQueue.current;
   await persistComposer({text:before.text,attachments:before.files,
     knowledge_sources:before.knowledgeSources,local_model:before.localPin});
   const current=await runtime.query<{draft_digest:string;state:string;attachments:{name:string;text:string}[]}>('composer_draft');
   if(current.state!=='SAVED'||!current.draft_digest)throw Error('task_draft_readback_unavailable');
   const receipt=await runtime.command<{destination:string;receipt_id:string;attachment_name:string;draft_digest:string}>(
    'tool_read_attach_to_draft',{destination,receipt_id:receiptId,data,
     expected_draft_digest:current.draft_digest,confirmed:true});
   const saved=await runtime.query<{draft_digest:string;attachments:{name:string;text:string}[]}>('composer_draft');
   if(saved.draft_digest!==receipt.draft_digest||
      !saved.attachments.some(row=>row.name===receipt.attachment_name))
    throw Error('task_tool_attachment_readback_failed');
   if(JSON.stringify(before)!==JSON.stringify(currentComposer.current))
    throw Error('task_draft_changed_during_tool_import');
   if(!composerDigestVerified(saved.draft_digest))throw Error('task_tool_attachment_revision_unverified');
   composerDraftRevision.current=saved.draft_digest;
   draftSaveEpoch.current++;
   setFiles(saved.attachments);
   setPage('Главная');
   return;
  }
  const {activeKey}=await readConversationCatalog(runtime);
  const current=await readConversationDraft(runtime,activeKey);
  if(current.state!=='SAVED' && current.state!=='EMPTY_OR_UNREADABLE')
   throw Error('conversation_draft_unavailable');
  const receipt=await runtime.command<{destination:string;conversation_key:string;receipt_id:string;attachment_name:string;draft_digest:string}>(
   'tool_read_attach_to_draft',{destination,conversation_key:activeKey,receipt_id:receiptId,
    data,expected_draft_digest:current.draft_digest,confirmed:true});
  const saved=await readConversationDraft(runtime,activeKey);
  if(receipt.conversation_key!==activeKey||receipt.receipt_id!==receiptId||
     saved.draft_digest!==receipt.draft_digest||
     !Array.isArray(saved.attachments)||!saved.attachments.some((a:{name:string})=>a.name===receipt.attachment_name))
    throw Error('tool_dialogue_attachment_readback_mismatch');
  setPage('Диалоги');
 }
 const taskReadSequence=useRef(0),submitInFlight=useRef(false),reviewInFlight=useRef(false),followupInFlight=useRef(false);
 // Rehydrate the currently displayed Task after an authenticated Core
 // restart. refresh() only reloads the catalogue; it does not verify detail.
 // This is a read-only operation and must not submit Task/Review/Tool actions.
 useEffect(()=>{
  if(!sessionReadbackEpoch||!selected)return;
  let active=true;
  const currentTask=selected;
  const read=++taskReadSequence.current;
  setDetailFresh(false);
  void readTaskInActiveWorkArea<Detail>(runtime,currentTask).then(({catalog,task:observed})=>{
   if(!active||read!==taskReadSequence.current)return;
   if(committedWorkAreaId.current!==null&&catalog.active_id!==committedWorkAreaId.current)
    throw Error('task_work_area_changed_during_session_restore');
   setDetail(observed);setDetailFresh(true);
  }).catch(e=>{
   if(active&&read===taskReadSequence.current){
    setDetailFresh(false);
    setError(tr('После восстановления соединения не удалось проверить открытую задачу. Обновите её состояние. ',
     'The open Task could not be verified after reconnection. Refresh its state. ')+message(e));
   }
  });
  return()=>{active=false};
 },[sessionReadbackEpoch]);

 const taskDispatchUnknown=useRef(false);
 const [pendingTask,setPendingTask]=useState<PendingTaskIntent|null>(null);
 const [taskRecoveryBusy,setTaskRecoveryBusy]=useState(false);
 const taskRecoveryInFlight=useRef(false);
 const acceptedEvidenceTransfer=useRef(false);
 const conversationTaskTransferInFlight=useRef(false);
 const draftWriteQueue=useRef<Promise<unknown>>(Promise.resolve()),draftSaveEpoch=useRef(0);
 function persistComposer(next:{text:string;knowledge_sources:KnowledgeSourceSelection[];attachments:{name:string;text:string}[];local_model?:LocalModelPin|null;
  pending_submission?:PendingTaskIntent|null;expected_pending_submission_id?:string;expected_draft_digest?:string;
  clear_submitted_draft?:boolean;cancel_prepared_submission?:boolean;
  expected_pending_workspace_id?:string}){
  const requestedWorkspace=composerWorkspace.current;
  const work=draftWriteQueue.current.catch(()=>undefined).then(async()=>{
   try{
    if(!requestedWorkspace||requestedWorkspace!==committedWorkAreaId.current||
       requestedWorkspace!==composerWorkspace.current)
     throw Error('composer_workspace_changed_before_save');
    const expected=next.expected_draft_digest??composerDraftRevision.current;
    if(!composerDigestVerified(expected)||composerSaveBlocked.current)
     throw Error('composer_draft_revision_not_admitted');
    const reply=await runtime.command<{draft_digest?:unknown;workspace_id?:unknown}>('composer_draft_save',{
     ...next,expected_draft_digest:expected
    });
    if(!composerDigestVerified(reply.draft_digest))throw Error('composer_draft_save_revision_unverified');
    if(reply.workspace_id!==requestedWorkspace||requestedWorkspace!==committedWorkAreaId.current||
       requestedWorkspace!==composerWorkspace.current)
     throw Error('composer_workspace_changed_after_save');
    composerDraftRevision.current=reply.draft_digest;
    if(!('pending_submission' in next)&&!next.clear_submitted_draft)
     savedComposerSignature.current=JSON.stringify([next.text,next.knowledge_sources,next.attachments,next.local_model]);
    return reply;
   }catch(error){
    if(requestedWorkspace!==committedWorkAreaId.current||requestedWorkspace!==composerWorkspace.current)
     throw error; // An old-area reply cannot disable the new area's writer.
    // The command may have reached Core. Never allow a later debounced save
    // to overwrite the unknown version or automatically replay this action.
    composerSaveBlocked.current=true;
    setComposerSaveFailure(tr(
     'Сохранение не подтверждено. Проверьте сохранённую редакцию перед дальнейшими действиями.',
     'Saving is unverified. Check the saved revision before further actions.'));
    throw error;
   }
  });
  draftWriteQueue.current=work;
  return work;
 }
 const currentComposer=useRef({text,files,knowledgeSources,localPin});
 currentComposer.current={text,files,knowledgeSources,localPin};
 // Unsaved edits displaced by another window remain recoverable only in
 // their original area. This is transient editor state, not a second store.
 const displacedDrafts=useRef(new Map<string,{value:typeof currentComposer.current;digest:string|null}>());
 function invalidateWorkspaceComposer(){
  const previous=composerWorkspace.current,before=currentComposer.current;
  const signature=JSON.stringify([before.text,before.knowledgeSources,before.files,before.localPin]);
  if(previous&&composerReady.current&&signature!==savedComposerSignature.current)
   displacedDrafts.current.set(previous,{value:structuredClone(before),digest:composerDraftRevision.current});
  draftSaveEpoch.current++;
  composerReady.current=false;composerWorkspace.current=null;composerDraftRevision.current=null;
  initialRestoredComposerSnapshot.current=null;savedComposerSignature.current=null;
  composerSaveBlocked.current=true;
  currentComposer.current={text:'',files:[],knowledgeSources:[],localPin:null};
  setDraftLoaded(false);setDraftLoadFailure('');setPendingTask(null);taskDispatchUnknown.current=false;
  setText('');setFiles([]);setKnowledgeSources([]);setLocalPin(null);
  setK03Open(false);setAtlasWork(null);setObsidianNote(null);
 }

 // Materials -> Task uses the existing Core composer. Do not replace an
 // unsent draft or treat a file read as authority to write the source file.
 const personalFileImport=useRef(false);
 async function preparePersonalFileAnalysis(file:{name:string;text:string;sourcePath:string;previousText?:string}){
  if(personalFileImport.current)return;
  if(!draftLoaded||composerSaveBlocked.current||!areaLoaded||!activeArea||submitInFlight.current||
     reviewInFlight.current||acceptedEvidenceTransfer.current||conversationTaskTransferInFlight.current||
     workspaceSwitchInFlight.current||nativeCloseBusy.current||
     taskDispatchUnknown.current||pendingTask){
   setError(tr('Нельзя заменить черновик, пока его сохранение или прежняя отправка не проверены.',
     'Cannot replace the draft until its saving or previous submission is verified.'));
   return;
  }
  if(!safeName(file.name)||!/\.(txt|md|csv|json)$/i.test(file.name)||
     new TextEncoder().encode(file.text).length>48000||!file.text.trim()){
   setError(tr('Этот файл не подходит для анализа. Выберите текстовый файл до 48 КБ.',
     'This file cannot be used for analysis. Choose a text file up to 48 KB.'));
   return;
  }
  const before=currentComposer.current;
  if((before.text.trim()||before.files.length||before.knowledgeSources.length)&&
     !window.confirm(tr(
      'Текущий черновик содержит текст или материалы. Новый анализ заменит запрос, вложения и выбранные заметки. Сохраните нужное отдельно до продолжения. Заменить черновик?',
      'The current draft contains text or materials. The new analysis will replace its request, attachments and selected notes. Save anything important before continuing. Replace the draft?')+'\n'+file.sourcePath))return;
  let planned:ReturnType<typeof prepareRevisionTaskDraft>;
  try{planned=prepareRevisionTaskDraft(file,language);}
  catch(e){
   setError(tr('Документы не удалось подготовить: ','Could not prepare the documents: ')+message(e));
   return;
  }
  personalFileImport.current=true;
  const original=JSON.stringify(before),areaId=activeArea.id;
  const navigationAtStart=navigationActionEpoch.current;
  // Historic content is explicitly supplied as a separate attachment, not
  // silently repinned as a current approved project term.
  const nextText=planned.text;
  const attachments=planned.attachments.map(row=>({name:row.name,text:row.text}));
  try{
   // Cancel the old delayed write; serialize with any already dispatched save.
   draftSaveEpoch.current++;
   await draftWriteQueue.current.catch(()=>undefined);
   if(original!==JSON.stringify(currentComposer.current)||
      committedWorkAreaId.current!==areaId)throw Error('task_draft_changed_before_material_import');
   await persistComposer({text:nextText,knowledge_sources:[],attachments,local_model:before.localPin});
   const saved=await runtime.query<{state?:unknown;text?:unknown;attachments?:unknown;
     knowledge_sources?:unknown;local_model?:unknown}>('composer_draft');
   if(saved.state!=='SAVED'||saved.text!==nextText||
      JSON.stringify(saved.attachments)!==JSON.stringify(attachments)||
      JSON.stringify(saved.knowledge_sources)!=='[]'||
      JSON.stringify(readLocalModelPin(saved.local_model))!==JSON.stringify(before.localPin))
    throw Error('material_import_draft_readback_mismatch');
   if(original!==JSON.stringify(currentComposer.current)||
      committedWorkAreaId.current!==areaId)throw Error('task_draft_changed_during_material_import');
   // The existing Core composer has already saved this exact input. Its
   // next editable revision must not be rewritten by the debounced UI effect.
   initialRestoredComposerSnapshot.current=JSON.stringify([nextText,[],attachments,before.localPin]);
   draftSaveEpoch.current++;
   setText(nextText);setFiles(attachments);setKnowledgeSources([]);
   setError('');
   if(navigationActionEpoch.current===navigationAtStart){
    // Starting analysis means opening its new request, not the previously
    // selected Task result. A later user page choice still takes precedence.
    focusNewTask.current=true;
    setPage('Задачи');
   }
  }catch(e){
   setError(tr(
    'Не удалось подтвердить сохранение нового черновика. Проверьте сохранённый запрос и вложения перед повтором. Старый файл не изменялся. ',
    'The new draft could not be verified. Inspect the saved request and attachments before retrying. The source file was not changed. ')+message(e));
  }finally{personalFileImport.current=false;}
 }


 // A deliberate import of one T2 result into the existing Task editor.
 // All current Task materials are preserved; no second Workspace/store.
 const domainResultInFlight=useRef(false);
 const[domainResultBusy,setDomainResultBusy]=useState(false);
 async function addDomainResultToTask(item:DomainObjectSelection,selectedText:string){
  if(domainResultInFlight.current||!draftLoaded||composerSaveBlocked.current||
     !areaLoaded||!activeArea||submitInFlight.current||reviewInFlight.current||
     acceptedEvidenceTransfer.current||conversationTaskTransferInFlight.current||
     personalFileImport.current||workspaceSwitchInFlight.current||
     nativeCloseBusy.current||taskDispatchUnknown.current||pendingTask||!selectedText)
    throw Error('t2_task_draft_not_ready');
  domainResultInFlight.current=true;
  setDomainResultBusy(true);
  const before=currentComposer.current;
  const original=JSON.stringify(before),areaId=activeArea.id;
  try{
   // Stop the pending debounced write, then observe all earlier Core writes.
   draftSaveEpoch.current++;
   await draftWriteQueue.current.catch(()=>undefined);
   if(original!==JSON.stringify(currentComposer.current)||
      committedWorkAreaId.current!==areaId)throw Error('t2_task_draft_changed');
   if(before.files.length>=8)throw Error('t2_task_attachment_limit');
   const snapshot={text:before.text,knowledge_sources:before.knowledgeSources,
     attachments:before.files,local_model:before.localPin};
   let current=verifiedTaskComposerReadback(await runtime.query<unknown>('composer_draft'));
   if(pendingTaskIntent(current.pending_submission))
    throw Error('t2_task_draft_pending_submission');
   if(!composerEditableMatches(current,snapshot)){
    await persistComposer(snapshot);
    current=verifiedTaskComposerReadback(await runtime.query<unknown>('composer_draft'));
   }
   if(!composerEditableMatches(current,snapshot)||pendingTaskIntent(current.pending_submission))
    throw Error('t2_task_draft_changed_during_import');
   const {after,confirmed}=await commitAndReconcileDomainAttachment(
    current,item,selectedText,areaId,
    ()=>runtime.command('t2_domain_attach_to_task',{
     ...item,expected_workspace_id:areaId,expected_draft_digest:current.draft_digest
    }),
    async()=>verifiedTaskComposerReadback(await runtime.query<unknown>('composer_draft')),
    e=>e instanceof RuntimeRequestError&&
      ['ACTION_OUTCOME_UNCONFIRMED','UNCONFIRMED_COMMAND'].includes(e.code),
   );
   if(original!==JSON.stringify(currentComposer.current)||
      committedWorkAreaId.current!==areaId)
    throw new DomainReadbackUnconfirmed('t2_task_draft_changed_during_import');
   composerDraftRevision.current=confirmed.draft_digest;
   savedComposerSignature.current=JSON.stringify([
    after.text,before.knowledgeSources,after.attachments,before.localPin
   ]);
   initialRestoredComposerSnapshot.current=savedComposerSignature.current;
   draftSaveEpoch.current++;
   currentComposer.current={...before,files:[...after.attachments]};
   setFiles([...after.attachments]);
   setError('');
  }catch(e){
   if(e instanceof DomainReadbackUnconfirmed){
    composerSaveBlocked.current=true;
    setComposerSaveFailure(tr(
     'Состояние прикрепления неизвестно. Проверьте сохранённый черновик перед повторением.',
     'Attachment outcome is unknown. Inspect the saved draft before retrying.'));
   }
   setError(tr('Не удалось подтвердить прикрепление доменного результата. Проверьте сохранённый черновик. ',
      'Domain result attachment could not be verified. Inspect the saved draft. ')+message(e));
   throw e;
  }finally{domainResultInFlight.current=false;setDomainResultBusy(false);}
 }

 // A K03 selection is only an editable SessionRuntime draft; P01 alone creates Task.
 async function applyK03DiscoveryDraft(
   selected:import('./k03-discovery-draft').K03Selection,
   discovery:import('./task-discovery-draft').K03DiscoveryBinding['bundle'],
   expectedResult:string,
   hostInput?:{request:Record<string,unknown>;sources:Record<string,unknown>[]},
   acceptanceCriteria:string[]=[]){
  if(k03ApplyInFlight.current||personalFileImport.current||
   !draftLoaded||composerSaveBlocked.current||!areaLoaded||!activeArea||
   submitInFlight.current||reviewInFlight.current||acceptedEvidenceTransfer.current||
   conversationTaskTransferInFlight.current||workspaceSwitchInFlight.current||
   nativeCloseBusy.current||taskDispatchUnknown.current||pendingTask||
   !selected?.selection?.candidate_text?.trim()||!expectedResult.trim())
   throw Error('k03_draft_not_ready');
  const before=currentComposer.current,initial=JSON.stringify(before),areaId=activeArea.id;
  if((before.text.trim()||before.files.length||before.knowledgeSources.length)
    &&!window.confirm(tr(
     'Заменить текущий черновик выбранной гипотезой? Сохраните важные материалы перед заменой.',
     'Replace the current draft with the selected hypothesis? Save important materials first.')))
   throw Error('k03_draft_replacement_cancelled');
  k03ApplyInFlight.current=true;setK03DraftBusy(true);
  try{
   draftSaveEpoch.current++;
   await draftWriteQueue.current.catch(()=>undefined);
   if(initial!==JSON.stringify(currentComposer.current)||
     committedWorkAreaId.current!==areaId)throw Error('k03_draft_changed_before_save');
   const current=await runtime.query<{state?:string;draft_digest?:string}>('composer_draft');
   if(current.state!=='SAVED'||!composerDigestVerified(current.draft_digest)||
      current.draft_digest!==composerDraftRevision.current)
     throw Error('k03_draft_preflight_changed');
   const savedAck=await runtime.command<{
     draft:{state?:unknown;text?:unknown;attachments?:unknown;
      knowledge_sources?:unknown;local_model?:unknown;draft_digest?:unknown};
     task_created?:boolean;result_created?:boolean;
   }>('k03_selection_to_task_draft',{
     confirmed:true,selection:selected.selection,discovery,
     workspace_id:areaId,expected_draft_digest:current.draft_digest,
     expected_result:expectedResult,acceptance_criteria:acceptanceCriteria,
     replace_existing:Boolean(before.text.trim()),
     ...(hostInput?{host_request:hostInput.request,host_sources:hostInput.sources}:{})
   });
   const saved=await runtime.query<{
     state?:unknown;text?:unknown;attachments?:{name:string;text:string}[];
     knowledge_sources?:KnowledgeSourceSelection[];local_model?:unknown;draft_digest?:unknown;
   }>('composer_draft');
   if(savedAck.task_created!==false||savedAck.result_created!==false||
      saved.state!=='SAVED'||!composerDigestVerified(saved.draft_digest)||
      saved.draft_digest!==savedAck.draft?.draft_digest||
      saved.text!==savedAck.draft.text||
      JSON.stringify(saved.attachments)!==JSON.stringify(savedAck.draft.attachments)||
      JSON.stringify(saved.knowledge_sources)!==JSON.stringify(savedAck.draft.knowledge_sources)||
      JSON.stringify(readLocalModelPin(saved.local_model))!==JSON.stringify(before.localPin))
     throw Error('k03_draft_readback_mismatch');
   if(initial!==JSON.stringify(currentComposer.current)||
      committedWorkAreaId.current!==areaId)
     throw Error('k03_draft_changed_after_save');
   const nextText=saved.text as string,attachments=saved.attachments||[],
     notes=saved.knowledge_sources||[];
   composerDraftRevision.current=saved.draft_digest as string;
   initialRestoredComposerSnapshot.current=JSON.stringify([nextText,notes,attachments,before.localPin]);
   savedComposerSignature.current=initialRestoredComposerSnapshot.current;
   draftSaveEpoch.current++;
   currentComposer.current={...before,text:nextText,files:attachments,knowledgeSources:notes};
   setText(nextText);setFiles(attachments);setKnowledgeSources(notes);
   setK03Open(false);setError('');
   // Keyboard returns to the existing editable Task, not an unmounted panel.
   window.requestAnimationFrame(()=>k03TaskInput.current?.focus());
  }finally{k03ApplyInFlight.current=false;setK03DraftBusy(false);}
 }

 // The native window close is the same operation as leaving an editor:
 // flush the existing Core-owned drafts and verify readback before exit.
 // React never acquires a parallel draft store.
 const conversationCloseFlush=useRef<null|(()=>Promise<void>)>(null);
 const registerConversationCloseFlush=useCallback((flush:null|(()=>Promise<void>))=>{
  conversationCloseFlush.current=flush;
 },[]);
 const [closingWindow,setClosingWindow]=useState(false);
 const [closeFailure,setCloseFailure]=useState('');
 const [closeSlow,setCloseSlow]=useState(false);
 const exitWithoutSaveRequested=useRef(false);
 // Slow verification allows an explicit, acknowledged exit without silently
 // losing drafts or treating an unknown Core operation as successfully saved.
 useEffect(()=>{
  if(!closingWindow){setCloseSlow(false);return;}
  const timer=window.setTimeout(()=>setCloseSlow(true),12000);
  return()=>window.clearTimeout(timer);
 },[closingWindow]);
 const nativeCloseBusy=useRef(false);
 const translateClose=useRef(tr);
 translateClose.current=tr;
 function exitWithoutVerifiedSave(){
  if((!closeFailure&&!closeSlow)||exitWithoutSaveRequested.current||!isTauri())return;
  const accepted=window.confirm(tr(
   'Сохранение открытой работы не подтверждено. Изменения в черновиках могут быть потеряны, а результат выполняемых действий — неизвестен. После повторного запуска проверьте историю, прежде чем повторять действия. Всё равно закрыть окно?',
   'Saving open work is unverified. Draft changes may be lost and in-progress actions may have an unknown outcome. After reopening, check history before repeating actions. Close the window anyway?'));
  if(!accepted)return;
  exitWithoutSaveRequested.current=true;
  // Only the explicit user choice bypasses the guard. Never kill Python Core.
  void getCurrentWindow().destroy().catch(err=>{
   exitWithoutSaveRequested.current=false;
   setCloseFailure(tr('Не удалось закрыть окно. ','Could not close the window. ')+message(err));
  });
 }
 const flushBeforeWindowClose=async()=>{
  if(nativeCloseBusy.current&&displacedDrafts.current.size)
   throw Error(tr('Есть несохранённый текст в другой рабочей области. Откройте её, чтобы восстановить черновик.',
    'Another Workspace has unsaved text. Open it to recover that draft.'));
  let expectedArea=committedWorkAreaId.current;
  if(!areaLoaded||!expectedArea){
   // Draft and Workspace startup reads run independently. Await the pending
   // Core-owned Workspace read and, if it failed or lost an epoch race, use
   // the already existing refresh() once. Failure still blocks the exit.
   const pending=startupWorkspaceRead.current;
   let verified=pending?await pending:false;
   if(!verified)verified=await refresh();
   if(!verified)throw Error('workspace_unverified_before_close');
   expectedArea=committedWorkAreaId.current;
  }
  if(!expectedArea)throw Error('workspace_unverified_before_close');
  if(workMode==='checked'){
   const initial=await readWorkAreas(runtime);
   if(initial.active_id!==expectedArea)throw Error('workspace_changed_before_close');
  }
  if(navigationSave.current)await navigationSave.current;
  if(documentCloseFlush.current)await documentCloseFlush.current();
  documentLeaveGuard.current?.();
  if(submitInFlight.current||reviewInFlight.current||followupInFlight.current
    ||personalFileImport.current||acceptedEvidenceTransfer.current||conversationTaskTransferInFlight.current)
   throw Error('unfinished_task_operation');
  // A failed initial read must never be converted into an empty save, nor
  // may a window with an unverified Core draft close successfully.
  if(!draftLoaded)throw Error('task_draft_not_loaded');
  if(composerSaveBlocked.current)throw Error('task_draft_save_needs_reconciliation');
  // Invalidate the queued 700 ms save. All prior writes are serialized by
  // persistComposer; a final verified write wins over an earlier debounce.
  draftSaveEpoch.current++;
  if(draftLoaded&&workMode==='fast'){
   // One Core compare-and-save if changed. Skip unchanged writes and extra reads.
   await draftWriteQueue.current.catch(()=>undefined);
   if(composerSaveBlocked.current)throw Error('task_draft_save_needs_reconciliation');
   const before=currentComposer.current;
   const signature=JSON.stringify([before.text,before.knowledgeSources,before.files,before.localPin]);
   if(signature!==savedComposerSignature.current){
    await persistComposer({text:before.text,knowledge_sources:before.knowledgeSources,
     attachments:before.files,local_model:before.localPin});
   }
   const latest=currentComposer.current;
   if(JSON.stringify([latest.text,latest.knowledgeSources,latest.files,latest.localPin])!==signature)
    throw Error('task_draft_changed_during_close');
  }
  if(draftLoaded&&workMode==='checked'){
   let stable=false;
   for(let attempt=0;attempt<3;attempt++){
    const before=currentComposer.current;
    await draftWriteQueue.current.catch(()=>undefined);
    await persistComposer({text:before.text,knowledge_sources:before.knowledgeSources,
      attachments:before.files,local_model:before.localPin});
    const saved=await runtime.query<{text?:unknown;local_model?:unknown;
     knowledge_sources?:unknown;attachments?:unknown;state?:unknown}>('composer_draft');
    if(saved.state!=='SAVED'||saved.text!==before.text
     ||JSON.stringify(saved.local_model??null)!==JSON.stringify(before.localPin)
     ||JSON.stringify(saved.knowledge_sources??[])!==JSON.stringify(before.knowledgeSources)
     ||JSON.stringify(saved.attachments??[])!==JSON.stringify(before.files))
     throw Error('task_draft_close_readback_mismatch');
    const latest=currentComposer.current;
    if(latest.text===before.text&&JSON.stringify(latest.localPin)===JSON.stringify(before.localPin)
     &&JSON.stringify(latest.knowledgeSources)===JSON.stringify(before.knowledgeSources)
     &&JSON.stringify(latest.files)===JSON.stringify(before.files)){
     stable=true;break;
    }
   }
   if(!stable)throw Error('task_draft_changed_during_close');
  }
  // The active dialogue has a separate composer context, still owned by
  // SessionRuntime. Closing while it is dispatching is explicitly denied.
  if(conversationCloseFlush.current)await conversationCloseFlush.current();
  // Confirm the Core Workspace after the final draft readback as well.
  if(workMode==='checked'){
   const last=await readWorkAreas(runtime);
   if(last.active_id!==expectedArea||committedWorkAreaId.current!==expectedArea)
    throw Error('workspace_changed_during_close');
  }
  // Persist the latest page, Task and document tab before closing or
  // switching Workspace, even when their debounce has not yet fired.
  await flushNavigationView();
  const finalArea=await readWorkAreas(runtime);
  if(finalArea.active_id!==expectedArea||committedWorkAreaId.current!==expectedArea)
   throw Error('workspace_changed_after_navigation_save');
 };
 const closeFlushRef=useRef(flushBeforeWindowClose);
 closeFlushRef.current=flushBeforeWindowClose;
 const workspaceSwitchInFlight=useRef(false);
 const [workspaceSwitching,setWorkspaceSwitching]=useState(false);
 function beginWorkspaceSwitch(){
  if(conversationTaskTransferInFlight.current){
   setError(tr('Сначала завершите перенос ответа из диалога в задачу.',
    'Finish transferring the dialogue answer into the Task draft before changing workspaces.'));
   return false;
  }
  if(workspaceSwitchInFlight.current||nativeCloseBusy.current)return false;
  workspaceSwitchOrigin.current=committedWorkAreaId.current;
  workspaceSwitchInFlight.current=true;setWorkspaceSwitching(true);
  return true;
 }
 function finishWorkspaceSwitch(){
  const origin=workspaceSwitchOrigin.current;
  workspaceSwitchOrigin.current=null;
  workspaceSwitchInFlight.current=false;setWorkspaceSwitching(false);
  const latest=deferredWorkspacePage.current;
  deferredWorkspacePage.current=null;
  if(!latest)return;
  if(!committedWorkAreaId.current){focusNewTask.current=false;return;}
  if(committedWorkAreaId.current===origin){
   // A failed/unchanged switch never authorizes bypassing the old editor.
   setPage(latest);
   if(latest==='Задачи'&&currentPage.current==='Задачи'&&focusNewTask.current){
    focusNewTask.current=false;
    if(!checkDocumentExit())return;
    clearSelectedTaskForRequest();
    window.requestAnimationFrame(focusRequestEditor);
   }
   return;
  }
  // A changed Workspace has already flushed the previous editor; replaying
  // setPage would save the former dialogue into the newly selected Workspace.
  navigationActionEpoch.current++;
  setPageState(latest);
  if(latest==='Задачи'&&focusNewTask.current){
   focusNewTask.current=false;
   clearSelectedTaskForRequest();
   window.requestAnimationFrame(focusRequestEditor);
  }
  // The newest explicit page choice wins over an older saved view of this Workspace.
  setNavigationRestored(true);
  if(navigationRestoreFailure)setNavigationRestoreFailure('');
 }
 function invalidateUnverifiedWorkspace(){
  setReturnPage(null);
  workAreaReadEpoch.current++;taskReadSequence.current++;
  committedWorkAreaId.current=null;
  setAreaLoaded(false);setActiveArea(null);setWorkAreas([]);setTasks([]);
  setSelected('');setDetail(null);setDetailFresh(false);
  setDocumentTab('result');
  setQueuedRequest(null);setNavigationRestored(false);setNavigationRestoreFailure('');lastSavedView.current='';
  setPageState('Главная');
 }
 async function beforeWorkspaceSwitch(expectedPage:string,expectedArea:string,lockedSwitch=false){
  const stable=()=>!!expectedArea&&currentPage.current===expectedPage
   &&committedWorkAreaId.current===expectedArea
   &&!nativeCloseBusy.current&&!personalFileImport.current
   &&!taskDispatchUnknown.current&&!pendingTask
   &&!submitInFlight.current&&!reviewInFlight.current
   &&!followupInFlight.current&&!acceptedEvidenceTransfer.current
   &&!conversationTaskTransferInFlight.current
   &&(lockedSwitch?workspaceSwitchInFlight.current:!workspaceSwitchInFlight.current);
  if(!stable())throw Error('workspace_switch_has_unverified_work');
  await closeFlushRef.current();
  if(!stable())throw Error('workspace_switch_context_changed_during_save');
  const observed=await readWorkAreas(runtime);
  if(!stable()||observed.active_id!==expectedArea)
   throw Error('workspace_switch_context_changed_before_command');
 }
 async function switchWorkspaceFromSidebar(targetId:string){
  const sourceId=committedWorkAreaId.current,sourcePage=currentPage.current;
  if(!sourceId||!areaLoaded||!workAreas.some(area=>area.id===targetId)
     ||targetId===sourceId||!beginWorkspaceSwitch())return;
  setAreaError('');
  let admissionPassed=false;
  try{
   await selectWorkArea(runtime,targetId,async()=>{
    await beforeWorkspaceSwitch(sourcePage,sourceId,true);
    admissionPassed=true;
   });
   await loadWorkAreas(targetId);
   if(committedWorkAreaId.current!==targetId)
    throw Error('workspace_switch_new_selection_unverified');
  }catch(e){
   if(admissionPassed)invalidateUnverifiedWorkspace();
   setAreaError(tr('Выбранная область не подтверждена. Обновите список без повторного переключения. ',
    'Workspace selection is unverified. Refresh the list without repeating the switch. ')+message(e));
  }finally{finishWorkspaceSwitch();}
 }
 useEffect(()=>{
  if(!isTauri())return;
  const windowHandle=getCurrentWindow();
  let active=true,unlisten:(()=>void)|null=null;
  void windowHandle.onCloseRequested(event=>{
   // A close event must be cancelled synchronously, before any awaits.
   event.preventDefault();
   if(exitWithoutSaveRequested.current)return;
   if(workspaceSwitchInFlight.current){
    setCloseFailure(translateClose.current(
     'Переключение рабочей области ещё не подтверждено. Закройте приложение после проверки.',
     'Workspace selection is not yet verified. Close the app after the check finishes.'));
    return;
   }
   if(nativeCloseBusy.current)return;
   nativeCloseBusy.current=true;setClosingWindow(true);setCloseFailure('');
   void closeFlushRef.current().then(()=>windowHandle.destroy()).catch(err=>{
    // On a write/readback failure the window stays open for recovery.
    const cause=message(err);
    const detail=cause.startsWith('workspace_')
      ?translateClose.current('Рабочая область не подтверждена. Обновите сведения и повторите закрытие.',
        'The Workspace is unverified. Refresh its state before closing.')
      :cause==='document_draft_not_staged'
      ?translateClose.current('Завершите подготовку текста документа или закройте его редактор.',
        'Prepare the document text or close its editor first.')
      :cause==='document_operation_not_finished'
      ?translateClose.current('Дождитесь завершения текущего действия с документом.',
        'Wait for the current document action to finish.')
      :cause;
    setCloseFailure(translateClose.current(
     'Закрытие отменено, сохранение работы не подтверждено. ',
     'Exit cancelled because saved work was not verified. ')+detail);
   }).finally(()=>{nativeCloseBusy.current=false;setClosingWindow(false)});
  }).then(fn=>{if(active)unlisten=fn;else fn()}).catch(err=>{
   if(active)setCloseFailure(translateClose.current(
    'Защита сохранения при закрытии недоступна. ','Close-time save protection is unavailable. ')+message(err));
  });
  return()=>{active=false;unlisten?.()};
 },[]);
 const [detailFresh,setDetailFresh]=useState(false);
 const[operational,setOperational]=useState<Record<string,unknown>|null>(null);
 const[localSetup,setLocalSetup]=useState<Record<string,unknown>|null>(null);
 useEffect(()=>{let alive=true;void runtime.query<Record<string,unknown>>('operational_control').then(x=>{if(alive)setOperational(x)}).catch(()=>{if(alive)setOperational(null)});return()=>{alive=false}},[sessionReadbackEpoch]);
 async function refresh(){
  const epoch=++workAreaReadEpoch.current;
  // A failed Workspace read does not prove the Core is offline; a successful
  // status read alone cannot claim a usable Workspace.
  const [statusRead,areaRead]=await Promise.allSettled([
   runtime.query<Record<string,unknown>>('status'),
   readActiveWorkAreaTasks<Task>(runtime)
  ]);
  if(epoch!==workAreaReadEpoch.current)return false;
  setCoreConnection(observedCoreConnection(statusRead.status,areaRead.status));
  setStatus(statusRead.status==='fulfilled'?statusRead.value:null);
  if(areaRead.status==='rejected'){
   setAreaLoaded(false);setDetailFresh(false);
   const reason=message(areaRead.reason);
   setAreaError(reason);setError(reason);
   if(statusRead.status==='fulfilled'&&!committedWorkAreaId.current
      &&!initialWorkspaceReadRetried.current){
    initialWorkspaceReadRetried.current=true;
    // A late-starting Core can already serve status but not the initial
    // Workspace projection. One short, read-only retry, no commands.
    window.setTimeout(()=>{
     if(workAreaReadEpoch.current===epoch&&!committedWorkAreaId.current)
      void refresh();
    },1000);
   }
   return false;
  }
  const snapshot=areaRead.value;
  try{
   const data=snapshot.catalog as {active_id:string;areas:WorkArea[]};
   const area=data.areas.find(a=>a.id===data.active_id);
   if(!area)throw Error('work_area_readback_invalid');
   // Keep selected Task only while the same Core Workspace is active.
   const externalChange=committedWorkAreaId.current!==null
    &&committedWorkAreaId.current!==area.id;
   if(externalChange){
    taskReadSequence.current++;
    setQueuedRequest(null);
    setSelected('');setDetail(null);setDetailFresh(false);
    setDocumentTab('result');
    setNavigationRestored(false);setNavigationRestoreFailure('');lastSavedView.current='';
    setPageState('Главная');
   }
   // A startup navigation can precede the React render that projects the
   // verified Workspace into the view. Keep the existing view coherent
   // synchronously only for that first admitted, explicit user choice.
   if(!committedWorkAreaId.current&&startupNavigationCommitted.current
      &&!navigationViewCurrent.current.area_id){
    navigationViewCurrent.current={...navigationViewCurrent.current,area_id:area.id};
   }
   committedWorkAreaId.current=area.id;
   setWorkAreas(data.areas);setActiveArea(area);
   setAreaLoaded(true);setAreaError(externalChange?tr(
    'Область изменилась вне этого окна. Проверьте черновик и источники перед новой задачей.',
    'Workspace changed outside this window. Review the draft and sources before a new Task.'
   ):'');setTasks(snapshot.tasks);
   if(statusRead.status==='rejected')setError(message(statusRead.reason));
   return true;
  }catch(e){
   setCoreConnection(statusRead.status==='fulfilled'?'partial':'unavailable');
   setAreaLoaded(false);setDetailFresh(false);
   setAreaError(message(e));setError(message(e));
   return false;
  }
 }
 async function refreshDocumentTask(targetId?:string):Promise<void>{
  // A Task list refresh does not update the selected Task's saved receipts.
  // Refresh this exact Task with the existing read-only Workspace admission.
  // This never executes a model, review, file write or automation.
  const read=taskReadSequence.current;
  const areaId=committedWorkAreaId.current;
  await refresh();
  if(!targetId||!areaId||currentPage.current!=='Задачи'
     ||selectedTaskCurrent.current!==targetId
     ||read!==taskReadSequence.current
     ||committedWorkAreaId.current!==areaId)return;
  try{
   const verified=await readTaskInActiveWorkArea<Detail>(runtime,targetId,areaId);
   if(currentPage.current!=='Задачи'||selectedTaskCurrent.current!==targetId
      ||read!==taskReadSequence.current
      ||committedWorkAreaId.current!==areaId)return;
   if(verified.catalog.active_id!==areaId||verified.task.task_id!==targetId)
    throw Error('document_history_workspace_mismatch');
   setDetail(verified.task);setDetailFresh(true);
  }catch(e){
   if(selectedTaskCurrent.current===targetId&&read===taskReadSequence.current){
    setDetailFresh(false);
    setError(tr('Не удалось повторно прочитать историю документа. Проверьте подключение и обновите задачу. ',
      'The document history could not be verified. Check the connection and refresh the Task. ')+message(e));
   }
   throw e;
  }
 }
 async function refreshModelState(){try{
  const [local,ops,user]=await Promise.all([runtime.query<Record<string,unknown>>('local_ai_setup'),runtime.query<Record<string,unknown>>('operational_control'),runtime.query<Record<string,unknown>>('user_setup')]);
  setLocalSetup(local);setOperational(ops);setSetup(user);await refresh();
 }catch(e){setError(message(e));}}
 async function openTask(id:string,navigate=true,verifiedDocumentStage=false){
  if(workspaceSwitchInFlight.current)return;
  const actionAtStart=navigationActionEpoch.current;
  const areaAtStart=committedWorkAreaId.current;
  if(id!==selected&&currentPage.current==='Задачи'&&!verifiedDocumentStage
    &&!checkDocumentExit())return;
  const sequence=++taskReadSequence.current;
  if(id!==selected)setFocusPlanId('');
  if(!verifiedDocumentStage){
   // Keep the previously verified selection until the new Task's Core
   // Workspace membership and detail have both passed readback.
   setDetailFresh(false);setSelectedCandidates([]);
  }
  try{
   const {catalog,task:d}=await readTaskInActiveWorkArea<Detail>(runtime,id,committedWorkAreaId.current||undefined);
   if(sequence!==taskReadSequence.current||navigationActionEpoch.current!==actionAtStart
     ||committedWorkAreaId.current!==areaAtStart){
    if(verifiedDocumentStage)throw Error('document_navigation_superseded');
    return;
   }
   if(committedWorkAreaId.current!==null&&catalog.active_id!==committedWorkAreaId.current)
    throw Error('task_work_area_changed_before_open');
   if(verifiedDocumentStage){
    // The source editor must remain selected until the exact derived Task
    // and its file-write proposal have passed independent Core readback.
    if(!d.action_candidates?.some(c=>c.operation==='files.write_text'))
     throw Error('document_write_task_readback_invalid');
   }
   if(id!==selected){
    setRelatedPanelsTaskId('');
    setSelected(id);
    setDocumentTab('result');
   }else if(verifiedDocumentStage){
    setDocumentTab('result');
   }
   setDetail(d);setDetailFresh(true);
   // A failed scheduler receipt can outlive a successfully imported Result.
   // Only the scoped, verified Task readback may dismiss that notification.
   if(['result_imported','closed','rejected'].includes(d.status)
      &&String(d.summary||'').trim())
    setQueuedRequest(prev=>prev?.taskId===id?null:prev);
   if(navigate)setPage('Задачи');setError('');
  }catch(e){
   if(sequence===taskReadSequence.current&&navigationActionEpoch.current===actionAtStart){
    const reason=message(e);
    setError(reason.startsWith('work_area_task_')||reason.startsWith('task_work_area_')||
      reason==='work_area_context_changed_during_task_readback'
      ?tr('Не удалось проверить задачу в текущей рабочей области. Выберите нужный Workspace и откройте задачу снова.',
        'The Task could not be verified in this Workspace. Select the correct Workspace and reopen the Task.')
      :reason);
   }
   if(verifiedDocumentStage)throw e;
  }
 }
 // A conversation link waits for its existing editor flush before loading a
 // different Task. No stale selection is admitted when that flush fails.
 useEffect(()=>{
  if(page!=='Задачи')return;
  const taskId=deferredDialogueTask.current;
  deferredDialogueTask.current=null;
  if(taskId)void openTask(taskId);
 },[page]);
 useLayoutEffect(()=>{
  const requestedWorkspace=activeArea?.id;
  if(composerWorkspace.current!==requestedWorkspace)invalidateWorkspaceComposer();
  if(!requestedWorkspace)return;
  let active=true;(async()=>{try{
    // The Core-owned composer is independent of the active Task catalogue.
    // A failed Task list must never lock an otherwise recoverable draft.
    // An incomplete Core projection must never become an empty writable UI.
    // Validate every restored source and attachment before changing any state.
    const draft=verifiedTaskComposerReadback(await runtime.query<unknown>('composer_draft'),requestedWorkspace);
    if(!active||committedWorkAreaId.current!==requestedWorkspace)return;
    const intent=pendingTaskIntent(draft.pending_submission);
    const restoredPin=readLocalModelPin(draft.local_model);
    if(draft.local_model!==null&&!restoredPin)throw Error('task_draft_startup_model_unverified');
    // Skip the first autosave when reopening an unchanged Core-owned draft;
    // all subsequent user edits still use the existing serialized writer.
    initialRestoredComposerSnapshot.current=JSON.stringify([
     draft.text,draft.knowledge_sources,draft.attachments,restoredPin
    ]);
    composerDraftRevision.current=draft.draft_digest;
    savedComposerSignature.current=JSON.stringify([draft.text,draft.knowledge_sources,draft.attachments,restoredPin]);
    composerSaveBlocked.current=false;
    setComposerSaveFailure('');
    setPendingTask(intent);taskDispatchUnknown.current=!!intent;
    setText(draft.text);
    setLocalPin(restoredPin);
    setKnowledgeSources(draft.knowledge_sources);
    setFiles(draft.attachments);
    // Arm autosave only after a complete successful Core draft read.
    // Workspace/Task state loads independently and cannot overwrite the
    // saved view or the user's Task selection after this read.
    composerWorkspace.current=requestedWorkspace;
    const displaced=displacedDrafts.current.get(requestedWorkspace);
    if(displaced&&!intent){
     const restore=displaced.digest===draft.draft_digest||window.confirm(tr(
      'Сохранённый черновик изменился. Восстановить несохранённый текст этого окна? Отмена оставит сохранённую редакцию и удалит эту несохранённую копию.',
      'The saved draft changed. Restore unsaved text from this window? Cancel keeps the saved version and discards this unsaved copy.'));
     if(restore){
      currentComposer.current=displaced.value;
      setText(displaced.value.text);setFiles(displaced.value.files);
      setKnowledgeSources(displaced.value.knowledgeSources);setLocalPin(displaced.value.localPin);
     }
     displacedDrafts.current.delete(requestedWorkspace);
    }
    composerReady.current=true;
    setDraftLoaded(true);
    setDraftLoadFailure('');
   }catch(e){if(active&&committedWorkAreaId.current===requestedWorkspace){
    const reason=message(e);
    const detail=reason.startsWith('task_draft_startup_')
     ?tr('Сохранённый черновик не прошёл проверку. Ничего не перезаписано. Повторите чтение.',
       'The saved draft failed verification. Nothing was overwritten. Retry reading it.')
     :reason;
    setError(detail);if(!composerReady.current)setDraftLoadFailure(detail);
   }}
  })();return()=>{active=false}},[composerLoadAttempt,activeArea?.id]);
 useEffect(()=>{
  if(!areaLoaded||!draftLoaded||!activeArea||navigationRestored)return;
  setNavigationRestoreFailure('');
  let cancelled=false;
  const requestArea=activeArea.id;
  const pageAtStart=currentPage.current;
  const selectedAtStart=selectedTaskCurrent.current;
  const readAtStart=taskReadSequence.current;
  const actionAtStart=navigationActionEpoch.current;
  const userChanged=()=>currentPage.current!==pageAtStart
   ||selectedTaskCurrent.current!==selectedAtStart
   ||taskReadSequence.current!==readAtStart
   ||navigationActionEpoch.current!==actionAtStart;
  void (async()=>{
   let targetPage='Главная',targetTab:'result'|'history'|'sources'|'plan'='result';
   let restoredTask:Detail|null=null,restoredViewVerified=false;
   try{
    type StoredView={page?:unknown;area_id?:unknown;task_id?:unknown;document_tab?:unknown};
    const prefs=await runtime.query<{persisted?:unknown;view?:StoredView;views_by_area?:Record<string,StoredView>}>('ui_preferences');
    if(typeof prefs.persisted!=='boolean'||!prefs.views_by_area
      ||typeof prefs.views_by_area!=='object'||Array.isArray(prefs.views_by_area))
     throw Error('saved_navigation_readback_invalid');
    // Each Workspace resumes at its own page and Task, with Core ownership
    // still verified before opening a remembered Task. Legacy files fall back
    // to the single view used by earlier 0.2 builds.
    const areaView=prefs.views_by_area?.[requestArea];
    const view=areaView?.area_id===requestArea?areaView:prefs.view;
    if(view&&view.area_id===requestArea){
     if(prefs.persisted!==true)throw Error('saved_navigation_persistence_unverified');
     const allowed:string[]=[
       ...navigationGroups.flatMap(group=>[group.root,...group.children]),
       'Рабочие области','Настройки','Домены'
      ];
     if(typeof view.page==='string'&&allowed.includes(view.page))targetPage=view.page;
     else throw Error('saved_navigation_page_invalid');
     if(['result','history','sources','plan'].includes(String(view.document_tab)))targetTab=view.document_tab as typeof targetTab;
     else throw Error('saved_navigation_tab_invalid');
     if(typeof view.task_id!=='string')throw Error('saved_navigation_task_reference_invalid');
     if(view.task_id){
      if(!/^TASK-[A-Za-z0-9_-]{1,80}$/.test(view.task_id))
       throw Error('saved_navigation_task_reference_invalid');
      // A saved Task is never inferred from the first item in a list.
      // The existing Core Workspace admission verifies exact membership,
      // Task detail and the active area before any UI state is committed.
      const scoped=await readTaskInActiveWorkArea<Detail>(runtime,view.task_id,requestArea);
      if(scoped.catalog.active_id!==requestArea||scoped.task.task_id!==view.task_id)
       throw Error('saved_task_workspace_readback_invalid');
      restoredTask=scoped.task;
     }else if(targetPage==='Задачи'){
       // A newly started request has a Core-owned draft but no Task ID.
       // This is a valid saved Work view, not a broken restoration.
       targetTab='result';
      }
     restoredViewVerified=true;
    }
   }catch(e){
    // Preference state is presentation only: never expose an unverified
    // Task or block access to the user's durable Workspace and history.
    // Most importantly, do not autosave the default Overview over an unreadable
    // remembered page. A retry or explicit human navigation is required.
    if(cancelled||committedWorkAreaId.current!==requestArea)return;
    if(navigationActionEpoch.current!==actionAtStart){
     setNavigationRestored(true);return;
    }
    setNavigationRestoreFailure(message(e));return;
   }
   if(cancelled||committedWorkAreaId.current!==requestArea)return;
   if(userChanged()){
    // An explicit user choice supersedes the old view. A different async
    // Task/readback update does not authorize overwriting saved navigation.
    if(navigationActionEpoch.current!==actionAtStart)setNavigationRestored(true);
    else setNavigationRestoreFailure('saved_navigation_context_changed');
    return;
   }
   if(restoredTask){
    taskReadSequence.current++;
    setSelected(restoredTask.task_id);setDetail(restoredTask);setDetailFresh(true);
   }
   // An unchanged saved view is already confirmed by Core: do not rewrite it
   // on startup, only after the person changes navigation or closes explicitly.
   if(restoredViewVerified)lastSavedView.current=JSON.stringify({
    page:targetPage,area_id:requestArea,
    task_id:restoredTask?.task_id||'',document_tab:targetTab
   });
   setDocumentTab(targetTab);setPage(targetPage);setNavigationRestored(true);
  })();
  return()=>{cancelled=true;};
 },[areaLoaded,draftLoaded,activeArea?.id,navigationRestored,navigationRestoreAttempt]);
 useEffect(()=>{
  // A startup click may be accepted before the Core draft/Workspace is ready.
  // Never persist a guessed area or unfinished startup view.
  if(!navigationRestored||!areaLoaded||!draftLoaded||!activeArea)return;
  const view:NavigationView={page,area_id:activeArea.id,task_id:selected,document_tab:documentTab};
  const signature=JSON.stringify(view);
  if(lastSavedView.current===signature)return;
  const epoch=++navigationSaveEpoch.current;
  const timer=window.setTimeout(()=>{
   if(navigationSaveEpoch.current!==epoch)return;
   void navigationPersistence.current.save(view).then(()=>{
    if(epoch===navigationSaveEpoch.current
       &&JSON.stringify(navigationViewCurrent.current)===signature)
     lastSavedView.current=signature;
   }).catch(()=>{
    // A failed view save must not hide or invalidate the current Task.
    // Closing or switching first reconciles its actual Core outcome.
   });
  },450);
  return()=>{navigationSaveEpoch.current++;window.clearTimeout(timer)};
 },[navigationRestored,areaLoaded,draftLoaded,activeArea?.id,page,selected,documentTab]);
 useEffect(()=>{let active=true;void runtime.query<{skills?:{skill_id:string;name?:string;description?:string}[]}>('task_skills').then(result=>{if(active)setSkills(result.skills||[])}).catch(e=>{if(active)setError('Каталог навыков недоступен: '+message(e))});return()=>{active=false}},[]);
 useEffect(()=>{if(!draftLoaded)return;
   const loadedSnapshot=initialRestoredComposerSnapshot.current;
   if(loadedSnapshot!==null){
    initialRestoredComposerSnapshot.current=null;
    if(loadedSnapshot===JSON.stringify([text,knowledgeSources,files,localPin]))return;
   }
   // Autosave is compare-and-swap against the Core revision observed at
   // startup or the most recent verified response. Never replay an unknown
   // mutation or erase an edit from another Core session.
   if(composerSaveBlocked.current||taskDispatchUnknown.current||domainResultInFlight.current)return;
   const epoch=++draftSaveEpoch.current;
   const timer=window.setTimeout(()=>{
    if(draftSaveEpoch.current!==epoch||composerSaveBlocked.current||taskDispatchUnknown.current||domainResultInFlight.current)return;
    const expected=composerDraftRevision.current;
    if(!composerDigestVerified(expected)){
     composerSaveBlocked.current=true;
     setComposerSaveFailure(tr('Нет подтверждённой редакции черновика.','The draft revision is unverified.'));
     return;
    }
    const snapshot={text,knowledge_sources:knowledgeSources,attachments:files,local_model:localPin};
    // The earlier revision only checks that saving is currently admissible.
    // The queued writer reads the latest CONFIRMED digest at dispatch, after
    // previous writes from this window have completed. Passing this captured
    // digest to the queue falsely conflicts on overlapping local edits.
    // A write from another window still fails Core's compare-and-save.
    void persistComposer(snapshot).catch(async error=>{
     // A lost acknowledgement may follow a successful CAS. One read-only
     // reconciliation is allowed; another write is never automatic.
     try{
      await draftWriteQueue.current.catch(()=>undefined);
      const observed=verifiedTaskComposerReadback(await runtime.query<unknown>('composer_draft'));
      if(!pendingTaskIntent(observed.pending_submission)&&composerEditableMatches(observed,snapshot)
       &&epoch===draftSaveEpoch.current){
       composerDraftRevision.current=observed.draft_digest;
       savedComposerSignature.current=JSON.stringify([snapshot.text,snapshot.knowledge_sources,snapshot.attachments,snapshot.local_model]);
       composerSaveBlocked.current=false;
       setComposerSaveFailure('');
       return;
      }
     }catch{/* Keep the local text and the error visible. */}
     composerSaveBlocked.current=true;
     setComposerSaveFailure(tr(
      'Сохранение черновика не подтверждено. Локальный текст сохранён в этом окне. Проверьте версию Core перед дальнейшей отправкой.',
      'Draft saving is unverified. Local text remains in this window. Check the Core version before submitting.'));
     setError(tr('Не удалось сохранить черновик: ','Could not save the draft: ')+message(error));
    });
   },700);
   return()=>{draftSaveEpoch.current++;window.clearTimeout(timer);};
 },[text,knowledgeSources,files,localPin,draftLoaded,domainResultBusy]);
  useEffect(()=>{
  if(page!=='Главная'&&page!=='Задачи')return;
  let alive=true;
  void Promise.allSettled([
    runtime.query<Record<string,unknown>>('user_setup'),
    runtime.query<Record<string,unknown>>('local_ai_setup'),
  ]).then(([user,local])=>{
    if(!alive)return;
    setSetup(user.status==='fulfilled'?user.value:null);
    setLocalSetup(local.status==='fulfilled'?local.value:null);
  });
  return()=>{alive=false};
 },[page]);
 async function upload(list:FileList|null){
  if(!list)return;
  const selected=Array.from(list);
  if(selected.length>8){setError(tr('Можно выбрать не более 8 файлов.','Choose up to 8 files.'));return;}
  const docs:{name:string;text:string}[]=[];
  for(const file of selected){
   if(!safeName(file.name)||!/\.(txt|md|csv|json)$/i.test(file.name)){
    setError(tr('Выберите текстовые файлы .txt, .md, .csv или .json с безопасными именами.','Choose .txt, .md, .csv or .json text files with safe names.'));return;
   }
   if(file.size>48000){setError(tr('Размер одного файла не может превышать 48 КБ.','Each file must be 48 KB or smaller.'));return;}
   let content:string;
   try{content=new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());}
   catch{setError(tr('Файл должен содержать текст в UTF-8. Он не добавлен к задаче.','The file must contain UTF-8 text. It was not added to the task.'));return;}
   if(!content.trim()||content.includes('\0')){
    setError(tr('Пустые и бинарные файлы не подходят для анализа.','Empty and binary files cannot be analyzed.'));return;
   }
   docs.push({name:file.name,text:content});
  }
  if(new TextEncoder().encode(docs.map(x=>x.text).join('')).length>48000){
   setError(tr('Общий размер выбранного текста больше 48 КБ.','The selected text exceeds the 48 KB combined limit.'));return;
  }
  setFiles(docs);setKnowledgeSources([]);setError('');
 }
 useEffect(()=>{
  if(!queuedRequest||['PAUSED','DEAD','CANCELLED'].includes(queuedRequest.state))return;
  const request=queuedRequest;
  let alive=true,inspectInFlight=false;
  async function inspect(){
   // A slow Core read must not start a second status/readback chain.
   if(!alive||inspectInFlight)return;
   inspectInFlight=true;
   const areaAtStart=committedWorkAreaId.current;
   const taskReadAtStart=taskReadSequence.current;
   let verifiedWorkerState:string|undefined;
   try{
    const row=await runtime.query<{task_id:string;state:string;task_status?:string;partial_text?:string;error_code?:string}>(
     'interactive_submission_status',{submission_id:request.submissionId});
    if(!alive||committedWorkAreaId.current!==areaAtStart||row.task_id!==request.taskId)return;
    verifiedWorkerState=row.state;
    if(row.state==='COMPLETED'||(
      ['PAUSED','DEAD','CANCELLED'].includes(row.state)
      &&['result_imported','closed','rejected'].includes(row.task_status||''))){
     // Even a terminal failed job can precede a saved Result. Check the
     // canonical Task before showing an obsolete failure notification.
     // A scheduler-completed job is not yet proof that the underlying Task
     // exists and is readable. Keep the recovery card until canonical readback.
     const {catalog,task:durable}=await readTaskInActiveWorkArea<Detail>(runtime,request.taskId);
     if(catalog.active_id!==areaAtStart||durable.task_id!==request.taskId)
      throw Error('interactive_task_work_area_readback_unverified');
     // A scheduler-completed job is not proof of an imported Result.
     // Keep the processing card until the saved Task and its actual
     // user-visible answer pass readback, including after quick review.
     if(!['result_imported','closed','rejected'].includes(durable.status)
        ||!String(durable.summary||'').trim()){
      // The job finished but Core has not confirmed a user-visible Result.
      // Treat this as a readback gap, never as an invitation to rerun
      // inference. Keep observing the same durable submission identity.
      if(alive&&committedWorkAreaId.current===areaAtStart){
       const errorCode=row.state==='COMPLETED'
        ?'interactive_task_result_readback_unverified':row.error_code;
       setQueuedRequest(prev=>prev?.submissionId!==request.submissionId
        ?prev:prev.state===row.state&&prev.errorCode===errorCode&&!prev.partial
         ?prev:{...prev,state:row.state,partial:'',errorCode});
      }
      if(row.state!=='COMPLETED')await refresh();
      return;
     }
     if(!alive||committedWorkAreaId.current!==areaAtStart)return;
     // A newer submission can replace this one during the Core readback.
     setQueuedRequest(prev=>prev?.submissionId===request.submissionId?null:prev);
     // A Task switch may already be reading another result even if React has
     // not yet committed its selection. Never overwrite that new read.
     if(selectedTaskCurrent.current===request.taskId
        &&taskReadSequence.current===taskReadAtStart){
      setDetail(durable);setDetailFresh(true);
     }
     await refresh();
    }else {
     setQueuedRequest(prev=>prev&&prev.submissionId===request.submissionId?
      {...prev,state:row.state,partial:row.partial_text||'',errorCode:row.error_code}:prev);
     // Terminal failure also changes the existing Core task projection.
     if(['PAUSED','DEAD','CANCELLED'].includes(row.state))await refresh();
    }
   }catch(e){
    if(alive&&committedWorkAreaId.current===areaAtStart){
     // Core may have already committed the scheduler terminal state while
     // Task readback is temporarily unavailable. Never display RUNNING
     // after a verified COMPLETED/DEAD/PAUSED/CANCELLED observation.
     if(verifiedWorkerState&&['COMPLETED','PAUSED','DEAD','CANCELLED'].includes(verifiedWorkerState))
      setQueuedRequest(prev=>prev?.submissionId===request.submissionId
       ?{...prev,state:verifiedWorkerState!,partial:'',
         errorCode:verifiedWorkerState==='COMPLETED'
          ?'interactive_task_result_readback_unverified':prev.errorCode}
       :prev);
     setError(tr('Не удалось обновить состояние обработки.','Could not refresh processing status.')+' '+message(e));
    }
   }finally{inspectInFlight=false;}
  }
  void inspect();
  const timer=window.setInterval(()=>void inspect(),2000);
  return()=>{alive=false;window.clearInterval(timer)};
 },[queuedRequest?.submissionId,queuedRequest?.state]);
 // A terminal job can arrive while its Task is already open. Do not keep the
 // earlier RUNNING readback on screen or require a manual reopen before retry.
 // This is one read-only, Workspace-scoped reconciliation per terminal state.
 useEffect(()=>{
  if(!queuedRequest||!['PAUSED','DEAD','CANCELLED'].includes(queuedRequest.state)
     ||queuedRequest.taskId!==selected)return;
  const request=queuedRequest;
  const areaId=committedWorkAreaId.current;
  const sequence=taskReadSequence.current;
  if(!areaId)return;
  let active=true;
  void readTaskInActiveWorkArea<Detail>(runtime,request.taskId,areaId).then(({catalog,task})=>{
   if(!active||catalog.active_id!==areaId||committedWorkAreaId.current!==areaId
      ||selectedTaskCurrent.current!==request.taskId
      ||taskReadSequence.current!==sequence)return;
   setDetail(task);setDetailFresh(true);
   if(['result_imported','closed','rejected'].includes(task.status)
      &&String(task.summary||'').trim())
    setQueuedRequest(prev=>prev?.taskId===request.taskId?null:prev);
  }).catch(()=>{
   if(active&&committedWorkAreaId.current===areaId
      &&selectedTaskCurrent.current===request.taskId
      &&taskReadSequence.current===sequence){
    setDetailFresh(false);
    setError(tr('Не удалось проверить остановленную задачу. Обновите её состояние.',
     'Could not verify the stopped Task. Refresh its state.'));
   }
  });
  return()=>{active=false};
 },[queuedRequest?.submissionId,queuedRequest?.state,selected]);
 // A reopened desktop loses its in-memory queuedRequest, but Core keeps the
 // durable job. Refresh only the currently open, running Task; do not create
 // another submission or run parallel polling with the live send receipt.
 useEffect(()=>{
  // Snapshot a string Workspace ID before the asynchronous observer closes over it.
  const taskId=selected,areaId=committedWorkAreaId.current||'';
  const jobState=detail?.background_submission?.state;
  if(page!=='Задачи'||!detailFresh||!taskId||!areaId
     ||detail?.task_id!==taskId||detail.status!=='awaiting_result'
     ||!['SCHEDULED','RUNNING'].includes(jobState||'')
     ||queuedRequest?.taskId===taskId)return;
  // Capture the verified Detail fields as immutable primitives. The nested
  // asynchronous observer must not dereference nullable React state.
  const observedStatus=detail.status;
  const observedModelActive=Boolean(detail.model_inference_active);
  const sequence=taskReadSequence.current;
  let active=true,inspecting=false,errorReported=false;
  const stillViewing=()=>active&&currentPage.current==='Задачи'
   &&selectedTaskCurrent.current===taskId
   &&taskReadSequence.current===sequence
   &&committedWorkAreaId.current===areaId;
  async function inspect(){
   if(!stillViewing()||inspecting)return;
   inspecting=true;
   try{
    const {catalog,task}=await readTaskInActiveWorkArea<Detail>(runtime,taskId,areaId);
    if(!stillViewing()||catalog.active_id!==areaId||task.task_id!==taskId)return;
    errorReported=false;
    if(task.status===observedStatus
       &&task.background_submission?.state===jobState
       &&Boolean(task.model_inference_active)===observedModelActive)
     return;
    setDetail(task);setDetailFresh(true);
    if(task.status!=='awaiting_result'||!['SCHEDULED','RUNNING'].includes(task.background_submission?.state||'')){
     try{await refresh();}catch{/* Verified Task detail remains available. */}
    }
   }catch{
    if(stillViewing()&&!errorReported){
     errorReported=true;
     setError(tr('Не удалось обновить выполняющуюся задачу. Проверьте её состояние.',
      'Could not update the running Task. Refresh its state.'));
    }
   }finally{inspecting=false;}
  }
  void inspect();
  const timer=window.setInterval(()=>void inspect(),2500);
  return()=>{active=false;window.clearInterval(timer)};
 },[page,selected,detail?.status,detail?.background_submission?.state,
    detail?.model_inference_active,detailFresh,queuedRequest?.taskId]);
 async function reconcileTaskIntent(intent:PendingTaskIntent,submittedSkill?:string){
  // Only query the original Core submission. Never issue submit_task here.
  await draftWriteQueue.current.catch(()=>undefined);
  const stored=await runtime.query<{pending_submission?:unknown;text?:string;knowledge_sources?:unknown;
   attachments?:unknown;local_model?:unknown;draft_digest:string}>('composer_draft');
  const current=pendingTaskIntent(stored.pending_submission);
  if(!current||current.submission_id!==intent.submission_id||
     current.workspace_id!==intent.workspace_id||
     current.draft_digest!==intent.draft_digest)throw Error('task_pending_identity_changed');
  if(activeArea?.id!==intent.workspace_id)throw Error('task_pending_work_area_changed');
  const receipt=await runtime.query<{submission_id:string;task_id:string;job_id:string;state:string}>(
   'interactive_submission_status',{submission_id:intent.submission_id});
  if(receipt.submission_id!==intent.submission_id
    ||!/^TASK-CHAT-[a-f0-9]{24}$/.test(receipt.task_id)
    ||!/^JOB-CHAT-[a-f0-9]{24}$/.test(receipt.job_id))
   throw Error('task_pending_receipt_identity_invalid');
  // Resolve only under Core's exact workspace+job ownership checks.
  // A newer edited draft remains intact because the original digest no
  // longer matches. We still send the canonical contents just read.
  const confirmed=await persistComposer({
   text:String(stored.text??''),
   knowledge_sources:stored.knowledge_sources as KnowledgeSourceSelection[],
   attachments:stored.attachments as {name:string;text:string}[],
   local_model:stored.local_model as LocalModelPin|null,
   pending_submission:null,expected_pending_submission_id:intent.submission_id,
   expected_pending_workspace_id:intent.workspace_id,
   expected_draft_digest:stored.draft_digest,clear_submitted_draft:true,
  });
  void confirmed;
  const after=await runtime.query<{pending_submission?:unknown;text?:string}>('composer_draft');
  if(pendingTaskIntent(after.pending_submission))throw Error('task_pending_resolution_unverified');
  taskDispatchUnknown.current=false;
  setPendingTask(null);
  setQueuedRequest({submissionId:intent.submission_id,taskId:receipt.task_id,
   state:receipt.state,partial:''});
  setSelected(receipt.task_id);setDetail(null);setDetailFresh(false);setPage('Задачи');
  // The UI may have newer unsent edits. Only mirror the resolved draft when
  // its text still equals the snapshot we read before clearing.
  if(currentComposer.current.text===stored.text
    &&JSON.stringify(currentComposer.current.files)===JSON.stringify(stored.attachments)
    &&JSON.stringify(currentComposer.current.knowledgeSources)===JSON.stringify(stored.knowledge_sources)){
   currentComposer.current={...currentComposer.current,text:String(after.text??''),
    files:[],knowledgeSources:[]};
   setText(String(after.text??''));setFiles([]);setKnowledgeSources([]);
   // Clear only the consumed skill; keep a newer choice made while the
   // previous submission was awaiting Core readback.
   if(submittedSkill!==undefined&&selectedSkillCurrent.current===submittedSkill)
    setSkill('');
  }
  // A verified receipt is informational. Keep unrelated concurrent failures.
  // Remove only a previous unknown-submission warning about this receipt.
  setError(previous=>[
   'Исход предыдущей отправки требует проверки.',
   'The previous submission needs verification.',
   'Отправка ещё не подтверждена.',
   'The submission is still unverified.',
   'Предыдущая отправка зарезервирована в Core.',
   'A previous submission is reserved in Core.'
  ].some(prefix=>previous.startsWith(prefix))?'':previous);
  setSubmissionRecoveryNotice(tr('Сохранённая отправка найдена. Повтор не выполнялся.',
   'The saved submission was found. No retry was performed.'));
 }
 async function inspectPendingTask(){
  const intent=pendingTask;
  if(!intent||taskRecoveryInFlight.current||submitInFlight.current)return;
  setSubmissionRecoveryNotice('');
  taskRecoveryInFlight.current=true;setTaskRecoveryBusy(true);
  try{await reconcileTaskIntent(intent);}
  catch(e){setError(tr('Отправка ещё не подтверждена. Проверьте состояние или отмените подготовку, если задача не была принята. ',
    'The submission is still unverified. Inspect it or cancel the reservation if the Task was never accepted. ')+message(e));}
  finally{taskRecoveryInFlight.current=false;setTaskRecoveryBusy(false);}
 }
 async function cancelPendingTask(){
  const intent=pendingTask;
  if(!intent||taskRecoveryInFlight.current||submitInFlight.current)return;
  if(!window.confirm(tr('Отказаться от этой неподтверждённой отправки? Core запретит отказ, если задача уже принята.',
   'Cancel this unverified submission? Core will refuse cancellation if the Task was already accepted.')))return;
  taskRecoveryInFlight.current=true;setTaskRecoveryBusy(true);
  try{
   if(activeArea?.id!==intent.workspace_id)throw Error('task_pending_work_area_changed');
   await draftWriteQueue.current.catch(()=>undefined);
   const stored=await runtime.query<{pending_submission?:unknown;text:string;
    knowledge_sources:KnowledgeSourceSelection[];attachments:{name:string;text:string}[];
    local_model:LocalModelPin|null;draft_digest:string}>('composer_draft');
   const current=pendingTaskIntent(stored.pending_submission);
   if(current&&(current.submission_id!==intent.submission_id
       ||current.workspace_id!==intent.workspace_id))
    throw Error('task_pending_identity_changed');
   // Even if the reservation command never reached Core, cancelling this
   // exact identity writes an immutable tombstone under the SAME mutation
   // lock used to accept a Task. No delayed submit can execute after that.
   await persistComposer({
    text:stored.text,knowledge_sources:stored.knowledge_sources,attachments:stored.attachments,
    local_model:stored.local_model,pending_submission:null,
    expected_pending_submission_id:intent.submission_id,
    expected_pending_workspace_id:intent.workspace_id,
    expected_draft_digest:stored.draft_digest,
    cancel_prepared_submission:true,
   });
   const read=await runtime.query<{pending_submission?:unknown}>('composer_draft');
   if(pendingTaskIntent(read.pending_submission))throw Error('task_pending_cancellation_unverified');
   taskDispatchUnknown.current=false;
   setPendingTask(null);
   setError(tr('Подготовка отменена. Черновик сохранён; новая задача не запускалась.',
    'Reservation cancelled. The draft is preserved; no new Task was run.'));
  }catch(e){setError(tr('Не удалось подтвердить отказ. Повторная отправка заблокирована. ',
   'Cancellation could not be verified. A new submission remains blocked. ')+message(e));}
  finally{taskRecoveryInFlight.current=false;setTaskRecoveryBusy(false);}
 }
 async function submit(){
  if(!text.trim()||busy||submitInFlight.current)return;
  if(taskReasoningPending||taskReasoningSaving){
   setError(tr('Сначала примените выбранную глубину рассуждений или верните прежнее значение. Задача не запускалась.',
    'Apply the selected reasoning effort or revert it first. No Task was started.'));
   return;
  }
  if(composerSaveBlocked.current){
   setError(tr('Проверьте конфликт сохранения черновика перед отправкой.',
     'Resolve the draft saving conflict before submitting.'));
   return;
  }
  if(taskDispatchUnknown.current||pendingTask){
   setError(tr('Предыдущая отправка зарезервирована в Core. Проверьте её перед новой задачей.',
    'A previous submission is reserved in Core. Inspect it before starting another Task.'));
   return;
  }
  setSubmissionRecoveryNotice('');
  submitInFlight.current=true;setBusy(tr('Отправка задачи','Submitting task'));
  let dispatched=false;
  const sent={text,files,knowledgeSources,atlasWork,obsidianNote};
  try{
   // Local documents never go to an unverified model or a remote fallback.
   // This is a read-only preflight: an unavailable model must leave the
   // editable request and selected files untouched.
   if(!areaLoaded||!activeArea){setError(tr('Рабочая область пока не прочитана. Обновите сведения перед отправкой.','Work area state is unavailable. Refresh before submitting.'));return;}
   if(sent.obsidianNote&&(sent.files.length||!activeArea.permissions.obsidian||!activeArea.permissions.selected_notes)){
    setError(tr('Выбранная заметка Obsidian недоступна в этой рабочей области или несовместима с файлами-вложениями.',
      'Selected Obsidian note is not permitted in this Workspace or conflicts with file attachments.'));
    return;
   }
   if(sent.atlasWork&&sent.files.length){
    setError(tr('Используйте работу Atlas без прикреплённых документов.','Link Atlas work without document attachments.'));
    return;
   }
   if(sent.atlasWork&&!activeArea.permissions.selected_notes){
    setError(tr('Выбранные материалы недоступны в этой рабочей области.','Selected materials are not available in this Workspace.'));
    return;
   }
   if(!activeArea.permissions.selected_notes&&knowledgeSources.length){setError(tr('В этой области выбранные заметки недоступны. Уберите их или измените область.','Selected notes are unavailable in this area. Remove them or change areas.'));return;}
   // A request must not create a doomed Task while no real model is
   // selected or the chosen local engine is stopped. Observe the existing
   // Core model slot before reserving a submission ID; do not run inference.
   const modelState=await runtime.query<Record<string,unknown>>('user_setup');
   setSetup(modelState);
   const modelProvider=modelState.active_model_provider_id;
   if(typeof modelProvider!=='string'||!modelProvider.trim()||
      modelProvider==='NONE'||modelProvider==='DEMO_REPLAY_V1'){
    setError(tr(
     'Для выполнения задачи выберите работающую модель в разделе «Модели». Запрос остался в редакторе, задача не запускалась.',
     'Select a working model in Models before running this task. Your request remains in the editor; no Task was started.'));
    return;
   }
   if((sent.files.length>0||activeArea.local_only)&&
      !['OLLAMA_LOCAL_V1','IWXA_BASIC_RUNTIME_V1'].includes(modelProvider)){
    setError(tr(
     'Для этой задачи нужна локальная модель. Выберите её в разделе «Модели»; текст и материалы сохранены.',
     'This task requires a local model. Choose one in Models; your text and materials are retained.'));
    return;
   }
   if(modelProvider==='IWXA_BASIC_RUNTIME_V1'){
    const engineState=await runtime.query<Record<string,unknown>>('iwxa_basic_model_status');
    if(engineState.ready!==true){
     setError(tr(
      'Модель IWXA пока не готова. Откройте «Модели», запустите выбранную модель и проверьте её ответ. Задача не запускалась.',
      'The IWXA model is not ready. Open Models, start the selected model, and verify its response. No Task was started.'));
     return;
    }
    const currentPin=readLocalModelPin(engineState.pin);
    if(localPin&&(!currentPin||currentPin.name!==localPin.name||currentPin.digest!==localPin.digest)){
     setError(tr(
      'В черновике закреплена другая модель. Выберите текущую модель IWXA или «Использовать по умолчанию» перед отправкой. Задача не запускалась.',
      'A different model is pinned in this draft. Select the current IWXA model or Use the default before sending. No Task was started.'));
     return;
    }
   }
   if(modelProvider==='OLLAMA_LOCAL_V1'){
    const localState=await runtime.query<Record<string,unknown>>('local_ai_setup');
    setLocalSetup(localState);
    if(localState.daemon_ready!==true||(!localPin&&localState.ready_for_activation!==true)){
     setError(tr(
      'Локальная Ollama пока не готова к выполнению задачи. Проверьте подключение и модель в разделе «Модели». Запрос сохранён в редакторе.',
      'Local Ollama is not ready to run the task. Check the connection and model in Models. Your request remains in the editor.'));
     return;
    }
    if(localPin){
     const models=Array.isArray(localState.local_models)?localState.local_models:[];
     const available=models.some(item=>{
      const observed=readLocalModelPin(item);
      return observed?.name===localPin.name&&observed.digest===localPin.digest;
     });
     if(!available){
      setError(tr(
       'Закреплённая модель отсутствует в текущем списке Ollama. Обновите выбор модели в черновике; задача не запускалась.',
       'The pinned model is not in the current Ollama inventory. Refresh the model selection in the draft; no Task was started.'));
      return;
     }
    }
   }
   // Extra duplicate warning only in CHECKED mode; normal dispatch remains authoritative.
   if(workMode==='checked'){
   // Read-only duplicate check against the Core-owned durable automation jobs.
   // Never silently create a second Task for a previously accepted prompt.
   const history=await runtime.query<{jobs:unknown[]}>('automation_jobs',{limit:200});
   const prior=savedInteractiveTaskForDraft(history.jobs,activeArea.id,sent.text);
   if(prior){
    const decision=window.confirm(tr('Такой запрос уже сохранялся как задача. Открыть историю вместо новой отправки? Нажмите «Отмена», чтобы создать отдельную задачу.',
     'This request was already saved as a Task. Open history instead? Select Cancel to create a separate Task.'));
    if(decision){await openTask(prior.taskId);return;}
   }
   }
   // Persist the exact Task identity BEFORE any model work can start.
   // This is the existing SessionRuntime composer, not browser storage.
   draftSaveEpoch.current++;
   await draftWriteQueue.current.catch(()=>undefined);
   const snapshot=currentComposer.current;
   if(snapshot.text!==sent.text||snapshot.files!==sent.files||
      snapshot.knowledgeSources!==sent.knowledgeSources||snapshot.localPin!==localPin)
    throw Error('task_draft_changed_before_submission');
   await persistComposer({text:sent.text,knowledge_sources:sent.knowledgeSources,
    attachments:sent.files,local_model:localPin});
   const draft=await runtime.query<{text:string;attachments:unknown;knowledge_sources:unknown;
    local_model:unknown;draft_digest:string;pending_submission?:unknown;state:string}>('composer_draft');
   if(draft.state!=='SAVED'||draft.text!==sent.text
     ||JSON.stringify(draft.attachments)!==JSON.stringify(sent.files)
     ||JSON.stringify(draft.knowledge_sources)!==JSON.stringify(sent.knowledgeSources)
     ||JSON.stringify(draft.local_model??null)!==JSON.stringify(localPin)
     ||pendingTaskIntent(draft.pending_submission))throw Error('task_draft_preflight_unverified');
   const submissionId=crypto.randomUUID().replace(/-/g,'');
   const intent:PendingTaskIntent={submission_id:submissionId,
    draft_digest:draft.draft_digest,workspace_id:activeArea.id};
   // From this point the reservation command itself may have an unknown
   // outcome. Block another send until the existing Core draft is reread.
   taskDispatchUnknown.current=true;setPendingTask(intent);
   const reserved=await persistComposer({text:sent.text,knowledge_sources:sent.knowledgeSources,
    attachments:sent.files,local_model:localPin,pending_submission:intent,
    expected_draft_digest:draft.draft_digest});
   void reserved;
   const witnessed=await runtime.query<{pending_submission?:unknown}>('composer_draft');
   const pending=pendingTaskIntent(witnessed.pending_submission);
   if(!pending||pending.submission_id!==submissionId
      ||pending.workspace_id!==activeArea.id)throw Error('task_reservation_readback_unverified');
   // A failed or lost reply is UNKNOWN; recovery uses this same identity.
   dispatched=true;
   const out=await runtime.command<{task_id:string;job_id:string}>('submit_task',{background:true,submission_id:submissionId,message:sent.text,attachments:sent.files,skill_id:skill||null,use_memory:sent.files.length===0&&useMemory&&activeArea.permissions.memory,use_obsidian:sent.files.length===0&&sent.knowledgeSources.length===0&&useObsidian&&activeArea.permissions.obsidian,use_web:sent.files.length===0&&useWeb&&!activeArea.local_only&&activeArea.permissions.web,local_only_documents:sent.files.length>0,knowledge_sources:sent.files.length?[]:sent.knowledgeSources.map(s=>({path:s.path,expected_sha256:s.expected_sha256,
    ...(s.provider_id&&s.binding_digest?{provider_id:s.provider_id,binding_digest:s.binding_digest}:{})})),artifact_sources:[],...(sent.atlasWork?{atlas_work:sent.atlasWork}:{}),...(sent.obsidianNote?{obsidian_note:sent.obsidianNote}:{}),workspace_id:activeArea.id,conversation_key:'area-'+activeArea.id,...(localPin?{local_model:localPin}:{})});
   const id=String(out.task_id||'');
   if(!id)throw Error('created_task_id_missing');
   const receipt=await runtime.query<{task_id:string;job_id:string;state:string}>('interactive_submission_status',{submission_id:submissionId});
   if(receipt.task_id!==id||receipt.job_id!==out.job_id)throw Error('created_task_readback_mismatch');
   // The durable ACK belongs to this same reservation. Clear it through
   // the Core only after exact receipt readback; newer drafts are preserved.
   await reconcileTaskIntent(intent,skill);
   // Canonical Task readback starts when the queued model work completes.
  }catch(e){
   // A lost reservation ACK may have persisted the intent even when the
   // Task was not dispatched. Keep the send blocked until a Core readback.
   if(dispatched||taskDispatchUnknown.current){
    taskDispatchUnknown.current=true;
    setError(tr('Исход предыдущей отправки требует проверки. Откройте сохранённое состояние перед новым запросом. ',
      'The previous submission needs verification. Inspect the saved state before another request. ')+taskSubmissionFailure(e,tr));
   }else{
    setError(tr('Подготовка не завершена. Задача не отправлялась. ',
      'Preparation did not finish. No Task was submitted. ')+taskSubmissionFailure(e,tr));
   }
  }finally{submitInFlight.current=false;setBusy('');}
 }
 async function doReview(){
  if(!selected||!decision||busy||!detailFresh||reviewInFlight.current||followupInFlight.current)return;
  const taskId=selected,chosenDecision=decision,chosenNotes=notes,shown=detail;
  const admitted=chosenDecision==='approve'?[...selectedCandidates]:[];
  const fileItems=(shown?.action_candidates||[]).map(c=>({c,id:String(c.candidate_id||c.ref_id||'')}))
   .filter(({c,id})=>c.operation==='files.write_text'&&admitted.includes(id));
  const reviewStamp=fileWriteReviewStamp(taskId,fileItems);
  if(fileItems.length&&(!reviewStamp||fileReviewConfirmed!==reviewStamp)){
   setError(tr('Подтвердите полный текст, путь и режим выбранной записи перед принятием результата.',
     'Confirm the exact text, path and write mode before accepting the result.'));
   return;
  }
  const read=taskReadSequence.current,areaId=committedWorkAreaId.current;
  const stillViewing=()=>selectedTaskCurrent.current===taskId
   &&taskReadSequence.current===read
   &&committedWorkAreaId.current===areaId
   &&currentPage.current==='Задачи';
  reviewInFlight.current=true;setBusy(tr('Запись решения','Recording decision'));
  let dispatched=false;
  try{
   await runtime.refreshRevision();
   // Immutable Human Review must use a current Result from this same
   // Core-owned Workspace, not a Task displayed before an async pause.
   const before=await readTaskInActiveWorkArea<Detail>(runtime,taskId);
   if(!areaId||!stillViewing()||before.catalog.active_id!==areaId
      ||!taskReviewPreflightMatches(taskId,chosenDecision,admitted,shown,before.task))
    throw Error('review_task_context_changed_before_dispatch');
   dispatched=true;
   const reply=await runtime.command('review_task',{
    task_id:taskId,decision:chosenDecision,notes:chosenNotes,
    accept_action_candidates:admitted
   },{kind:'task',id:taskId});
   const after=await readTaskInActiveWorkArea<Detail>(runtime,taskId);
   if(!stillViewing()||after.catalog.active_id!==areaId)return;
   if(!reviewedTaskReadbackMatches(taskId,chosenDecision,admitted,reply,after.task))
    throw Error('review_task_readback_mismatch');
   setDetail(after.task);setDetailFresh(true);setReview(false);setFileReviewConfirmed(null);
   if(['result_imported','closed','rejected'].includes(after.task.status)
      &&String(after.task.summary||'').trim())
    setQueuedRequest(prev=>prev?.taskId===taskId?null:prev);
   setDecision('');setNotes('');setSelectedCandidates([]);
   const company=(reply as {companyWorkspace?:{
    state?:string;originalKernelReadback?:boolean}}|null)?.companyWorkspace;
   setError(company&&company.originalKernelReadback!==true
    ?tr('Result принят в Agent, но запись в Workspace компании не подтверждена. Проверьте Workspace, не запускайте задачу повторно.',
       'Result accepted in Agent, but company Workspace readback is unverified. Inspect Workspace; do not rerun the Task.')
    :'');
   try{await refresh();}catch{/* Exact Task readback already succeeded. */}
  }catch(e){
   // The preflight has not sent a mutation. Keep the existing review editable.
   if(!dispatched){
    if(stillViewing())setError(tr(
     'Результат задачи или рабочая область изменились. Решение не отправлено. Обновите сведения.',
     'The Task result or Workspace changed. No decision was sent. Refresh the details.'
    )+' '+message(e));
    return;
   }
   if(!stillViewing())return;
   // A lost reply after dispatch is reconciled read-only, never replayed.
   if(chosenDecision==='approve'||chosenDecision==='reject'){
    try{
     const recovered=await readTaskInActiveWorkArea<Detail>(runtime,taskId);
     if(!stillViewing()||recovered.catalog.active_id!==areaId)return;
     if(recoveredHumanDecisionMatches(taskId,chosenDecision,admitted,chosenNotes,recovered.task)){
      setDetail(recovered.task);setDetailFresh(true);setReview(false);setFileReviewConfirmed(null);
      setDecision('');setNotes('');setSelectedCandidates([]);
      setError(tr('Решение подтверждено сохранённой историей задачи. Повтор не выполнялся.',
       'The saved Task history confirms your decision. No repeat was performed.'));
      try{await refresh();}catch{/* Exact Task readback already succeeded. */}
      return;
     }
    }catch{/* Retain the uncertain outcome without resubmission. */}
   }
   if(stillViewing()){
    setDetailFresh(false);
    setError(tr(
     'Решение могло сохраниться, но подтвердить его не удалось. Обновите задачу и проверьте историю перед новым решением.',
     'The decision may have been saved but could not be verified. Refresh the Task and check its history before another decision.'
    )+' '+message(e));
   }
  }finally{reviewInFlight.current=false;setBusy('');}
 }
 async function prepareCandidate(candidateId:string){
  const shown=detail,taskId=selected;
  if(!shown||!taskId||shown.task_id!==taskId||!candidateId||busy||!detailFresh
     ||shown.status!=='closed'||reviewInFlight.current||followupInFlight.current)return;
  const read=taskReadSequence.current,areaId=committedWorkAreaId.current;
  if(!areaId)return;
  const stillViewing=()=>currentPage.current==='Задачи'
   &&selectedTaskCurrent.current===taskId&&taskReadSequence.current===read
   &&committedWorkAreaId.current===areaId;
  followupInFlight.current=true;setBusy(tr('Подготовка плана','Preparing plan'));setError('');
  let dispatched=false;
  try{
   await runtime.refreshRevision();
   const before=await readTaskInActiveWorkArea<Detail>(runtime,taskId);
   if(!stillViewing()||before.catalog.active_id!==areaId
      ||!taskFollowupPreflightMatches(taskId,'prepare',candidateId,shown,before.task))
    throw Error('task_plan_context_changed_before_dispatch');
   dispatched=true;
   const prepared=await runtime.command<{plan_id:string}>('tool_prepare',
    {task_id:taskId,candidate_id:candidateId},{kind:'action_candidate',id:candidateId});
   const after=await readTaskInActiveWorkArea<Detail>(runtime,taskId);
   if(!stillViewing()||after.catalog.active_id!==areaId)return;
   if(typeof prepared.plan_id!=='string'||!prepared.plan_id
      ||after.task.accepted_artifact_digest!==before.task.accepted_artifact_digest
      ||!after.task.readback?.tool_plans?.some(p=>
       p.plan_id===prepared.plan_id&&p.candidate_id===candidateId))
    throw Error('prepared_plan_readback_mismatch');
   setDetail(after.task);setDetailFresh(true);
   setFocusPlanId(prepared.plan_id);setPlanFocusRequest(value=>value+1);setDocumentTab('plan');
  }catch(e){
   if(!stillViewing())return;
   setDetailFresh(false);
   setError((dispatched?tr(
    'План мог сохраниться. Обновите задачу и откройте существующий план перед новой подготовкой.',
    'A plan may have been saved. Refresh the Task and inspect existing plans before preparing another.'):
    tr('Задача или Workspace изменились. Команда подготовки не отправлена. Обновите задачу.',
       'The Task or Workspace changed. No preparation command was sent. Refresh the Task.'))
    +' '+message(e));
  }finally{followupInFlight.current=false;setBusy('');}
 }
 async function retry(){
  const taskId=selected,shown=detail;
  if(!taskId||!shown||shown.task_id!==taskId||busy||!detailFresh
     ||shown.status!=='awaiting_result'||reviewInFlight.current||followupInFlight.current
     ||taskRetryBlockedByBackground(queuedRequest,taskId,shown.background_submission,shown.model_inference_active))return;
  if(!window.confirm(tr(
   'Повторить вызов модели для этой задачи? Если прежний вызов уже выполнился, возникнет новый запрос.',
   'Retry the model call for this Task? If the earlier call already ran, this starts another request.')))return;
  const read=taskReadSequence.current,areaId=committedWorkAreaId.current;
  if(!areaId)return;
  const stillViewing=()=>currentPage.current==='Задачи'
   &&selectedTaskCurrent.current===taskId&&taskReadSequence.current===read
   &&committedWorkAreaId.current===areaId;
  followupInFlight.current=true;setBusy(tr('Повтор модели','Retrying model'));setError('');
  let dispatched=false;
  try{
   // React's cached job state is not authority. Check the immutable terminal
   // state in Core immediately before requesting a new model generation.
   if(queuedRequest?.taskId===taskId){
    const savedJob=await runtime.query<{task_id:string;state:string}>(
     'interactive_submission_status',{submission_id:queuedRequest.submissionId});
    if(savedJob.task_id!==taskId||!['DEAD','CANCELLED','COMPLETED'].includes(savedJob.state))
     throw Error('task_background_attempt_still_active');
   }
   await runtime.refreshRevision();
   const before=await readTaskInActiveWorkArea<Detail>(runtime,taskId);
   if(!stillViewing()||before.catalog.active_id!==areaId
      ||!taskFollowupPreflightMatches(taskId,'retry',undefined,shown,before.task))
    throw Error('retry_task_context_changed_before_dispatch');
   if(taskRetryBlockedByBackground(queuedRequest,taskId,before.task.background_submission,before.task.model_inference_active))
    throw Error('task_background_attempt_still_active');
   dispatched=true;
   await runtime.command('retry_task',{task_id:taskId},{kind:'task',id:taskId});
   const after=await readTaskInActiveWorkArea<Detail>(runtime,taskId);
   if(!stillViewing()||after.catalog.active_id!==areaId)return;
   if(after.task.run_seq!==before.task.run_seq
      ||!['awaiting_result','result_imported','awaiting_revision','closed'].includes(after.task.status))
    throw Error('retry_task_readback_mismatch');
   setDetail(after.task);setDetailFresh(true);setError('');
   if(after.task.status==='result_imported')
    setQueuedRequest(prev=>prev?.taskId===taskId?null:prev);
  }catch(e){
   if(!stillViewing())return;
   if(dispatched){
    // If the command reply was lost, read the completed Result; never resubmit.
    try{
     const recovered=await readTaskInActiveWorkArea<Detail>(runtime,taskId);
     if(!stillViewing()||recovered.catalog.active_id!==areaId)return;
     if(recovered.task.run_seq===shown.run_seq&&recovered.task.status==='result_imported'){
      setDetail(recovered.task);setDetailFresh(true);
      setQueuedRequest(prev=>prev?.taskId===taskId?null:prev);
      setError(tr('Результат найден в сохранённой задаче. Повторная команда не отправлялась.',
       'The result was found in the saved Task. No second command was sent.'));
      return;
     }
    }catch{/* Unknown outcome remains blocked until the user refreshes. */}
   }
   setDetailFresh(false);
   setError((dispatched?tr(
    'Повтор мог запустить модель, но исход не подтверждён. Проверьте историю задачи перед новым вызовом.',
    'The retry may have started the model, but its outcome is unverified. Check Task history before trying again.'):
    tr('Задача или Workspace изменились. Повтор модели не отправлен. Обновите задачу.',
       'The Task or Workspace changed. No model retry was sent. Refresh the Task.'))
    +' '+message(e));
  }finally{followupInFlight.current=false;setBusy('');}
 }
 async function updateRelatedSchedule(jobId:string,action:'pause'|'resume'){
  if(!detailFresh||!detail||detail.task_id!==selected||relatedActionBusy||busy)return;
  setRelatedActionBusy(jobId);setError('');
  let dispatched=false;
  try{
   const before=await runtime.query<{jobs:{job_id:string;state:string}[]}>('automation_jobs',{job_id:jobId});
   const row=before.jobs?.[0],expected=action==='pause'?'SCHEDULED':'PAUSED';
   if(!row||row.job_id!==jobId||row.state!==expected||
      !detail.readback?.scheduled_work?.some(x=>x.job_id===jobId&&x.state===expected))
    throw Error('related_schedule_stale');
   await runtime.refreshRevision();dispatched=true;
   await runtime.command('automation_'+action,{job_id:jobId},{kind:'automation_job',id:jobId});
   const next=await runtime.query<{jobs:{job_id:string;state:string}[]}>('automation_jobs',{job_id:jobId});
   if(next.jobs?.[0]?.job_id!==jobId||next.jobs[0].state!==(action==='pause'?'PAUSED':'SCHEDULED'))
    throw Error('related_schedule_readback_unverified');
   await openTask(selected,false);
  }catch(e){
   if(dispatched)await openTask(selected,false);
   setError((dispatched?tr('Состояние могло измениться. Проверьте расписание перед повтором. ',
    'State may have changed. Check the schedule before retrying. '):
    tr('Расписание изменилось. Обновите данные задачи. ',
    'The schedule changed. Refresh task data. '))+message(e));
  }finally{setRelatedActionBusy('');}
 }
 const pending=detailFresh&&detail?.task_id===selected?tasks.find(x=>x.id===selected):undefined;
 const verifiedSelectedTask=!!selected&&detailFresh&&detail?.task_id===selected;
 const candidates=(detail?.action_candidates||[]).map(c=>({c,id:String(c.candidate_id||c.ref_id||'')})).filter(x=>x.id);
 const selectedFileCandidates=decision==='approve'?candidates.filter(({id,c})=>
  c.operation==='files.write_text'&&selectedCandidates.includes(id)):[];
 const currentReviewStamp=fileWriteReviewStamp(detail?.task_id||'',selectedFileCandidates);
 const fileReviewReady=selectedFileCandidates.length===0||
  (!!currentReviewStamp&&fileReviewConfirmed===currentReviewStamp);
 const taskSources=(detail?.readback?.context_snapshots||[]).flatMap(s=>(s.source_items||[]).map(x=>({snapshot:s.snapshot_id,...x})));
 const sources=taskSources.filter(x=>x.origin==='interaction_attachment');
 const overviewSources=verifiedSelectedTask?sources:[];
 const accepted=detail?.status==='closed'&&!!detail.accepted_artifact_digest;
 const selectedBackgroundState=detail?.background_submission?.state
  ??(queuedRequest?.taskId===selected?queuedRequest.state:undefined);
 const meetingTaskReview=detailFresh&&detail?.task_id===selected&&detail?reviewMeetingTaskSummary(detail.objective,detail.summary||'',detail.draft_artifacts):null;
 const relatedPanelsOpen=!!selected&&relatedPanelsTaskId===selected;
 const localSelected=operational?.active_model_provider_id==='OLLAMA_LOCAL_V1';
 const basicSelected=operational?.active_model_provider_id==='IWXA_BASIC_RUNTIME_V1';
 const basicHealth=setup?.active_model_health as {ready?:boolean}|undefined;
 const localReady=(localSelected&&localSetup?.ready_for_activation===true)
   ||(basicSelected&&basicHealth?.ready===true);
 const ollamaReadiness=(localSetup?.user_readiness||null) as UserReadiness|null;
 const modelHint=requestModelHint(operational?.active_model_provider_id,setup,ollamaReadiness);
 const modelSetupNeeded=modelHint==='MODEL_REQUIRED';
 const setupDestination=basicSelected||operational?.active_model_provider_id==='NONE'
   ?'Модели':ollamaNextPage(ollamaReadiness);
 const setupMessage=operational?.active_model_provider_id==='NONE'
   ?tr('Для новых запросов не выбран источник модели. Откройте «Модели» и выберите исполнителя.',
     'No model source is selected for new requests. Open Models and choose a provider.')
   :basicSelected
   ?tr('Выбранный IWXA LLM Engine пока не готов к ответу. Откройте «Модели», проверьте GGUF-файл и включите модель. Ollama не требуется.',
     'The selected IWXA LLM Engine is not ready yet. Open Models, check the GGUF file and activate the model. Ollama is not required.')
   :ollamaStageText(ollamaReadiness,tr);
 const openSavedTaskRef=useRef(openTask);
 openSavedTaskRef.current=openTask;
 const openSavedTask=useCallback((id:string)=>{
  // A Task selected from the list below the result must reveal the canonical
  // Result after Workspace-scoped readback, without a second Task submission.
  void openSavedTaskRef.current(id).then(()=>{
   window.requestAnimationFrame(()=>{
    if(currentPage.current!=='Задачи'||selectedTaskCurrent.current!==id)return;
    const panel=document.getElementById('task-document-panel');
    if(panel?.querySelector('.result-lifecycle'))panel.scrollIntoView({block:'start'});
   });
  });
 },[]);
 const taskComposer=(<section className="composer" aria-label={tr('Редактор запроса','Request editor')} aria-busy={!draftLoaded}>
 <div className="composer-heading"><h2>{tr('Ваш запрос','Your request')}</h2>
 <small className="composer-workspace">{areaLoaded&&activeArea
  ?tr('Рабочая область: ','Workspace: ')+activeArea.name
  :tr('Рабочая область ещё не подтверждена','Workspace not yet verified')}</small>
  <span>{!draftLoaded?(draftLoadFailure
   ?tr('Не удалось загрузить черновик. Повторите чтение выше.','Draft unavailable. Retry loading above.')
   :tr('Читаем сохранённый черновик…','Loading your saved draft…'))
   :text.trim()?tr('Продолжите запрос или отправьте его.','Continue editing or send your request.')
   :tr('Опишите задачу. Модель и материалы можно выбрать позже.','Describe your request. You can choose a model and materials later.')}</span></div>
 <textarea id="request" disabled={!draftLoaded||k03DraftBusy} aria-label={tr('Текст задачи','Task text')} ref={k03TaskInput} value={text} onChange={e=>{currentComposer.current={...currentComposer.current,text:e.target.value};setText(e.target.value)}} placeholder={tr('Спросите IWXA или введите новую задачу...','Ask IWXA or describe your next task...')}/>
 <LocalTaskModelChoice value={localPin} onChange={setLocalPin} disabled={!draftLoaded||!!busy} onConnected={()=>void refreshModelState()} onOpenModels={()=>setPage('Модели')}/>
 <TaskReasoningControl disabled={!draftLoaded||!!busy} onPendingChange={setTaskReasoningPending}
  onSavingChange={setTaskReasoningSaving}/>
 {status&&modelHint&&<div className="composer-model-guidance advanced-notice" role="status">
  <strong>{modelSetupNeeded?tr('Проверьте готовность модели','Check model readiness')
   :tr('Состояние модели ещё не подтверждено','Model status is not yet verified')}</strong>
  <p>{modelSetupNeeded?setupMessage:tr(
   'Не удалось подтвердить состояние модели. Можно продолжить писать запрос; проверьте доступность в разделе «Модели».',
   'Model status could not be verified. You can continue writing; check availability in Models.')}</p>
  <button type="button" className="mini-button" onClick={()=>setPage(modelSetupNeeded?setupDestination:'Модели')}>
   {modelSetupNeeded&&setupDestination==='Программы'
    ?tr('Проверить программу','Check program')
    :tr('Проверить модель','Check model')}
  </button>
 </div>}
  {knowledgeSources.length>0&&<div className="composer-options"><HelpTip topic="sources"/><strong>{tr('Выбранные заметки (повторно проверяются при отправке)','Selected notes (rechecked when submitted)')} ({knowledgeSources.length}/8)</strong>
   {knowledgeSources.map(s=><button type="button" key={s.path+':'+s.expected_sha256} className="mini-button" title={s.path} onClick={()=>setKnowledgeSources(items=>items.filter(x=>x.path!==s.path||x.expected_sha256!==s.expected_sha256))}>{s.title} ×</button>)}
   <button type="button" className="mini-button" onClick={()=>setKnowledgeSources([])}>{tr('Убрать все','Clear all')}</button>
  </div>}
  <details className="composer-advanced"><summary>{tr('Дополнительные возможности','More options')}
   <span className="composer-advanced-active">{[
    !files.length&&useMemory&&activeArea?.permissions.memory?tr('Память','Memory'):null,
    !files.length&&useWeb&&!activeArea?.local_only&&activeArea?.permissions.web?tr('Интернет','Web'):null,
    !files.length&&useObsidian&&activeArea?.permissions.obsidian? 'Obsidian':null,
    atlasWork?'Atlas':null,
    obsidianNote?'Obsidian':null
   ].filter(Boolean).join(' · ')}</span></summary>
<div className="composer-options"><button type="button" className="mini-button"
  aria-expanded={k03Open} disabled={k03DraftBusy} onClick={()=>setK03Open(open=>!open)}>
  {tr('При необходимости: уточнить через K03','Optional: clarify with K03')}</button>
  <small>{tr('Обычная задача отправляется сразу. K03 запускается только по вашему выбору, без модели и дополнительных рассуждений.',
   'Regular Tasks can be sent directly. K03 runs only when requested and does not start a model or extra reasoning.')}</small></div>
 {k03Open&&<React.Suspense fallback={<p role="status">{tr('Открываем исследование источника…','Loading source investigation…')}</p>}>
  <K03DiscoveryPanel tr={tr} workspaceId={activeArea?.id||''}
   attachments={files} onApplyDraft={applyK03DiscoveryDraft}/>
 </React.Suspense>}
 <AtlasWorkContextPicker selection={atlasWork} onSelect={setAtlasWork} disabled={!draftLoaded||!!busy||!!pendingTask||taskDispatchUnknown.current} tr={tr}/>
  <ObsidianNotePicker key={'obsidian-'+(activeArea?.id||'personal')} selection={obsidianNote} onSelect={setObsidianNote}
   disabled={!draftLoaded||!!busy||!!pendingTask||taskDispatchUnknown.current||!activeArea?.permissions.obsidian||!activeArea?.permissions.selected_notes} tr={tr}/>
  <div className="composer-options"><HelpTip topic="sources"/><label><input type="checkbox" checked={useMemory&&!!activeArea?.permissions.memory} disabled={files.length>0||!activeArea?.permissions.memory} onChange={e=>setUseMemory(e.target.checked)}/>{tr('Память','Memory')}</label><label><input type="checkbox" checked={useObsidian&&!!activeArea?.permissions.obsidian} disabled={files.length>0||!activeArea?.permissions.obsidian} onChange={e=>setUseObsidian(e.target.checked)}/>Obsidian</label><label><input type="checkbox" checked={useWeb&&!activeArea?.local_only&&!!activeArea?.permissions.web} disabled={files.length>0||activeArea?.local_only||!activeArea?.permissions.web} onChange={e=>setUseWeb(e.target.checked)}/>{tr('Интернет','Web')}</label><label className="composer-skill">{tr('Способ работы','Capability')} <select value={skill} onChange={e=>setSkill(e.target.value)}><option value="">{tr('Подобрать автоматически','Choose automatically')}</option>{skills.map(x=><option value={x.skill_id} key={x.skill_id}>{x.name||x.skill_id}</option>)}</select></label><HelpTip topic="skills"/><button type="button" className="mini-button" onClick={()=>setPage('Навыки')}>{tr('Все возможности','All capabilities')}</button></div>
</details>
{draftLoaded&&!!text.trim()&&(!areaLoaded||!status||!!composerSaveFailure||!!pendingTask||taskDispatchUnknown.current)&&
   <div className="composer-options" role="status">
    <span>{pendingTask||taskDispatchUnknown.current
      ?tr('Предыдущая отправка требует проверки. Используйте «Проверить отправку» в разделе задач.',
        'The previous submission needs verification. Use Inspect submission in Tasks.')
      :composerSaveFailure
      ?tr('Сохранение черновика не подтверждено. Локальный текст остаётся в редакторе.',
        'The draft save is unverified. Your local text remains in the editor.')
      :!areaLoaded
      ?tr('Сведения о рабочей области ещё не подтверждены.',
        'Workspace readback is not yet confirmed.')
      :tr('Ожидаем ответ локального ядра перед отправкой задачи.',
        'Waiting for Core status before sending the Task.')}</span>
    {(!areaLoaded||!status)&&!pendingTask&&
      <button type="button" className="mini-button" disabled={!!busy}
       onClick={()=>void refresh()}>{tr('Обновить состояние','Refresh status')}</button>}
   </div>}
  <div className="composer-footer"><label className="upload-label"><Plus size={15}/>{tr('Файлы','Files')}<input id="upload" type="file" disabled={!draftLoaded} multiple accept=".txt,.md,.csv,.json" onChange={e=>{const input=e.currentTarget;void upload(input.files).catch(error=>setError(message(error))).finally(()=>{input.value='';});}}/></label><span className="composer-files">{files.map(f=>f.name).join(' · ')||tr('Текстовые файлы: TXT, MD, CSV, JSON','Text files: TXT, MD, CSV, JSON')}</span>{files.length>0&&<button type="button" className="mini-button" onClick={()=>setFiles([])}>{tr('Убрать вложения','Remove attachments')}</button>}{files.length>0&&!localReady&&<button type="button" className="mini-button" onClick={()=>setPage('Модели')}>{tr('Подключить модель для документов','Connect model for documents')}</button>}<button className="primary-button" disabled={!draftLoaded||k03DraftBusy||taskReasoningPending||taskReasoningSaving||!!composerSaveFailure||!text.trim()||!!busy||!status||!areaLoaded||!!pendingTask||taskDispatchUnknown.current} onClick={()=>void submit()}><Play size={15}/>{tr('Отправить','Send')}</button></div></section>);
 return <div className={'app'+(!inspector||page!=='Задачи'?' inspector-closed':'')}>
 <aside className="sidebar">
  <div className="brand"><div className="brand-identity"><img src="/desktop/favicon.svg" className="brand-mark" alt=""/><div><strong>IWXA</strong><small>{tr('Персональный помощник','Personal assistant')}</small></div></div><button className="icon-button" aria-label={tr('Свернуть панель сведений','Collapse details panel')} onClick={()=>setInspector(!inspector)}><ChevronRight size={16}/></button></div>
  <nav className="nav-group" aria-label={tr('Разделы приложения','Application sections')}>
    {navigationGroups.map(group=>{
     const Icon=pageIcons[group.root],name=group.names[language==='ru'?0:1];
     const childActive=(group.children as readonly string[]).includes(page);
     const active=page===group.root||childActive;
     const expanded=group.children.length>0&&(expandedNavigation===group.id||(expandedNavigation===null&&childActive));
     return <div className="nav-product-group" key={group.id}>
      <button type="button" className={'nav-link nav-primary'+(active?' active':'')}
       aria-current={page===group.root?'page':undefined}
       onClick={()=>setPage(group.root)}>
       <Icon size={18}/><span>{name}</span>
       {group.root==='Задачи'&&tasks.length>0&&<em>{tasks.length}</em>}
      </button>
      {group.children.length>0&&<button type="button" className="nav-disclosure"
       aria-label={(expanded?tr('Свернуть подразделы','Collapse subsections'):tr('Показать подразделы','Show subsections'))+' '+name}
       aria-expanded={expanded} aria-controls={'nav-children-'+group.id}
       onClick={()=>setExpandedNavigation(expanded?'':group.id)}>
       <ChevronRight size={15} className={expanded?'chevron-expanded':''} aria-hidden="true"/>
      </button>}
      {expanded&&<div id={'nav-children-'+group.id} className="nav-children" aria-label={name}>
       {group.children.map(child=>{const ChildIcon=pageIcons[child];
        return <button type="button" key={child} className={'nav-link nav-child'+(page===child?' active':'')}
         aria-current={page===child?'page':undefined}
         onClick={()=>{if(child==='Программы')setProgramFocus('');if(child==='Агенты')setAgentRunFocus('');
          setExpandedNavigation(group.id);setPage(child);}}>
         <ChildIcon size={15}/><span>{pageName(child,language)}</span>
        </button>;})}
      </div>}
     </div>;
    })}
   </nav>
   <div className="space-list"><div className="nav-caption">{tr('Текущая рабочая область','Current work area')}</div>
   <select className="workspace-switcher" aria-label={tr('Переключить рабочую область','Switch Workspace')}
    value={areaLoaded?activeArea?.id||'':''} disabled={!areaLoaded||workspaceSwitching}
    onChange={e=>void switchWorkspaceFromSidebar(e.currentTarget.value)}>
    {!areaLoaded&&<option value="">{tr('Область не подтверждена','Workspace unverified')}</option>}
    {workAreas.map(area=><option key={area.id} value={area.id}>{area.name}</option>)}
   </select>
   <button type="button" className={'nav-link workspace-manage'+(page==='Рабочие области'?' active':'')}
    aria-label={tr('Управление рабочими областями','Manage workspaces')} onClick={()=>setPage('Рабочие области')}>
    <Folder size={16}/><span>{tr('Создать и настроить области','Create and manage workspaces')}</span><ChevronRight size={16}/></button>
   {workspaceSwitching&&<small className="space-note" role="status">{tr('Проверяем сохранение и переключаем область…','Verifying saved work and switching Workspace…')}</small>}
   {areaError&&<small className="space-note" role="alert">{areaError} <button type="button" className="workspace-reload" onClick={()=>void refresh()}>{tr('Обновить','Refresh')}</button></small>}
   <small className="space-note">{tr('Области группируют задачи. Хранилище общее; права проверяет Core.','Areas group tasks. Storage is shared and Core checks permissions.')}</small></div>
  <div className="sidebar-bottom"><div className="sovereign">
   <div className="mode-row work-mode-row">
    <Play size={18} aria-hidden="true"/>
    <div className="mode-copy"><b>{tr('Режим работы','Work mode')}</b>
     <small id="work-mode-state">{workMode==='fast'?tr('Быстрый','Fast'):tr('С проверками','With checks')}</small></div>
    <button type="button" className="t3-toggle" role="switch"
     aria-label={tr('Дополнительные проверки','Extra checks')}
     aria-describedby="work-mode-state" aria-checked={workMode==='checked'}
     onClick={()=>setWorkMode(workMode==='fast'?'checked':'fast')}>
     <span className="t3-toggle-thumb" aria-hidden="true"/>
    </button>
   </div>
   <div className="sovereign-help"><HelpTip topic="privacy"/></div>
   <div className="mode-row t3-mode-row">
    <ShieldCheck size={18} aria-hidden="true"/>
    <div className="mode-copy">
     <b>{tr('Локальная работа','Local work')}</b>
     <small id="t3-sidebar-state" className={'t3-state '+(t3Enabled===null?'unknown':t3Enabled?'enabled':'disabled')} aria-live="polite" aria-atomic="true">
      {t3Busy?tr('Сохраняется…','Saving…'):t3Enabled===null?tr('Состояние не подтверждено','State unverified'):t3Enabled?tr('Включена','Enabled'):tr('Выключена','Disabled')}
     </small>
    </div>
    {t3Enabled===null?
     <button type="button" className="t3-recheck" disabled={t3Busy}
      onClick={()=>void reloadT3().catch(()=>{})}>{tr('Проверить','Retry')}</button>:
     <button type="button" className="t3-toggle" role="switch"
      aria-label={tr('Локальная работа','Local work')}
      aria-describedby="t3-sidebar-state" aria-checked={t3Enabled}
      aria-busy={t3Busy} disabled={t3Busy}
      onClick={()=>void setT3(!t3Enabled)}>
      <span className="t3-toggle-thumb" aria-hidden="true"/>
     </button>}
   </div>
   <div className="mode-row cloud-row"><CloudOff size={18} aria-hidden="true"/><div className="mode-copy"><b>{tr('Модель для новых ответов','Model for new responses')}</b><small>{operational?.active_model_provider_id==='IWXA_BASIC_RUNTIME_V1'?tr('Выбран IWXA LLM Engine на компьютере','Local IWXA LLM Engine selected'):operational?.active_model_provider_id==='OLLAMA_LOCAL_V1'?tr('Выбрана Ollama на компьютере','Local Ollama selected'):operational?.active_model_provider_id&&!['NONE','OLLAMA_LOCAL_V1'].includes(String(operational.active_model_provider_id))?tr('Выбран внешний источник. Проверьте передачу данных.','External source selected. Check data sharing.'):tr('Модель не выбрана','No model selected')}</small></div></div>
   <button type="button" className="sovereign-link" onClick={()=>setPage('Настройки')}>{tr('Режим работы и подключения','Work mode and connections')} <ChevronRight size={14} aria-hidden="true"/></button>
  </div><button type="button" className="person" onClick={()=>setPage('Настройки')} aria-label={tr('Открыть настройки приложения','Open app settings')}>
   <img src="/desktop/favicon.svg" className="avatar-mark" alt=""/><span><b>{tr('Настройки IWXA','IWXA settings')}</b><small>{coreConnectionLabel(coreConnection,language)}</small></span><Settings size={16}/>
  </button></div>
 {(page==='Настройки'||page==='Домены')&&<button type="button"
     className={'nav-link nav-settings-detail'+(page==='Домены'?' active':'')}
     aria-current={page==='Домены'?'page':undefined} onClick={()=>setPage('Домены')}>
     <Blocks size={15}/><span>{tr('Экосистема IWXA','IWXA ecosystem')}</span>
    </button>}
  </aside>
 <main className="main">
 <header className="top">
   <button type="button" className="top-back" disabled={!returnPage||workspaceSwitching}
    aria-label={tr('Вернуться к предыдущему разделу','Back to previous section')}
    title={returnPage?tr('Назад: ','Back: ')+pageName(returnPage,language):tr('Нет предыдущего раздела','No previous section')}
    onClick={()=>{if(returnPage)setPage(returnPage);}}>
    <ArrowLeft size={17} aria-hidden="true"/>
   </button>
   <div className="top-title"><span>{tr('Раздел','Section')}</span><strong>{page==='Главная'?tr('Главная','Home'):pageName(page,language)}</strong></div>
   <button type="button" className="top-action" onClick={startNewTask}><FilePlus2 size={16}/>{tr('Новый запрос','New request')}</button>
   <button type="button" className="top-action" onClick={()=>setPage('Файлы')}><FolderOpen size={16}/>{tr('Материалы','Materials')}</button>
   <button type="button" className="top-action compact" title={tr('Язык','Language')} onClick={toggleLanguage}>{language.toUpperCase()}</button>
   <button type="button" className="top-action compact" title={tr('Светлая/тёмная тема','Light/dark theme')} onClick={toggleTheme}>{theme==='dark'?'☀':'◐'}</button>
   <div className="top-status"><span className={'live-dot'+(coreConnection==='ready'?' ready':'')}/>{busy||coreConnectionLabel(coreConnection,language)}</div>
   </header>
   {!areaLoaded&&!!areaError&&<div className="advanced-error" role="alert">
    <strong>{tr('Рабочая область пока не загружена.','Workspace is not loaded yet.')}</strong>
    <span>{tr('Чтение Core не подтверждено. Повторите обычное обновление.',
      'Core readback is unverified. Retry the existing refresh.')}</span>
    <button type="button" className="mini-button" onClick={()=>void refresh()}>
     {tr('Обновить рабочую область','Refresh Workspace')}
    </button>
   </div>}
   {sessionRecovery&&<div className={sessionRecovery==='failed'?'advanced-error':'advanced-notice'} role={sessionRecovery==='failed'?'alert':'status'}>
  {sessionRecovery==='recovering'?tr('Восстанавливается соединение с локальным ядром. Черновики остаются открытыми.','Restoring local Core connection. Drafts remain open.'):
   sessionRecovery==='restored'?tr('Соединение восстановлено. Проверьте незавершённые действия в истории перед повтором.','Connection restored. Check unfinished actions in history before retrying.'):
   tr('Соединение не восстановлено. Черновики остаются открытыми; закрытие без проверки сохранения заблокировано.','Connection not restored. Drafts remain open and unverified closing is blocked.')}
  {sessionRecovery==='failed'&&<button type="button" onClick={()=>void runtime.recoverSession().catch(()=>{})}>{tr('Повторить подключение','Reconnect')}</button>}
 </div>}
 {!navigationRestored&&areaLoaded&&draftLoaded&&navigationRestoreFailure&&
  <section className="advanced-error" role="alert">
   <strong>{tr('Последняя открытая работа не восстановлена','The last open work was not restored')}</strong>
   <p>{tr(
    'Сохранённая страница и выбранная задача не перезаписаны. Повторите чтение или явно откройте Главную.',
    'The saved page and selected Task were not overwritten. Retry reading or explicitly open Home.'
   )}</p>
   <button type="button" onClick={()=>{
    setNavigationRestoreFailure('');
    setNavigationRestoreAttempt(n=>n+1);
   }}>{tr('Повторить восстановление','Retry restoration')}</button>
   <button type="button" onClick={()=>{
    if(!areaLoaded||!draftLoaded||!activeArea)return;
    navigationActionEpoch.current++;
    setNavigationRestoreFailure('');
    setSelected('');setDetail(null);setDetailFresh(false);
    setDocumentTab('result');setPageState('Главная');
    setNavigationRestored(true);
   }}>{tr('Открыть Главную','Open Home')}</button>
  </section>}
 {composerSaveFailure&&draftLoaded&&<section className="advanced-error" role="alert">
  <strong>{tr('Сохранение черновика требует сверки','Draft save requires reconciliation')}</strong>
  <p>{composerSaveFailure}</p>
  <p>{tr('Локальный текст остаётся в этом окне. Перед заменой сохраните нужные изменения отдельно.',
    'Your local text remains in this window. Copy changes you need before replacing it.')}</p>
  <details><summary>{tr('Показать текст для копирования','Show text to copy')}</summary>
   <pre className="document-content">{text}</pre>
  </details>
  <button type="button" onClick={()=>{
   draftSaveEpoch.current++;
   if(!window.confirm(tr(
    'Загрузить текущую версию черновика из ядра? Несохранённые изменения в этом окне будут заменены. Сначала скопируйте нужный текст.',
    'Load the current saved draft from Core? Unsaved edits in this window will be replaced. Copy any needed text first.'
   )))return;
   const before=JSON.stringify(currentComposer.current);
   void (async()=>{
    try{
     await draftWriteQueue.current.catch(()=>undefined);
     const draft=verifiedTaskComposerReadback(await runtime.query<unknown>('composer_draft'));
     if(JSON.stringify(currentComposer.current)!==before)
      throw Error('task_draft_changed_during_recovery');
     const intent=pendingTaskIntent(draft.pending_submission);
     const pin=readLocalModelPin(draft.local_model);
     if(draft.local_model!==null&&!pin)throw Error('task_draft_recovery_model_unverified');
     // Re-reading a pending submission never resends the Task.
     initialRestoredComposerSnapshot.current=JSON.stringify([
      draft.text,draft.knowledge_sources,draft.attachments,pin
     ]);
     composerDraftRevision.current=draft.draft_digest;
     setPendingTask(intent);taskDispatchUnknown.current=!!intent;
     setText(draft.text);setKnowledgeSources(draft.knowledge_sources);
     setFiles(draft.attachments);setLocalPin(pin);
     composerSaveBlocked.current=false;setComposerSaveFailure('');
    }catch(e){
     setComposerSaveFailure(tr('Не удалось проверить сохранённую версию: ',
       'Could not verify the saved version: ')+message(e));
    }
   })();
  }}>{tr('Загрузить подтверждённый черновик','Load verified saved draft')}</button>
 </section>}
 {!draftLoaded&&<div className={draftLoadFailure?'advanced-error':'advanced-notice'} role={draftLoadFailure?'alert':'status'}>
  {draftLoadFailure?tr('Не удалось прочитать сохранённый черновик. Редактирование и закрытие пока заблокированы, чтобы не потерять работу.','Saved draft could not be read. Editing and closing are blocked to protect your work.'):
   tr('Читаем сохранённый черновик...','Loading your saved draft...')}
  {draftLoadFailure&&<button type="button" onClick={()=>{setDraftLoadFailure('');setComposerLoadAttempt(value=>value+1);}}>
   {tr('Повторить чтение','Retry loading')}
  </button>}
 </div>}
 {closingWindow&&<div className="advanced-notice" role="status">{tr('Сохраняем открытые черновики перед закрытием...','Saving open drafts before closing...')}
  {closeSlow&&<p>{tr('Подтверждение сохранения задерживается. Можно продолжить ожидание или явно выйти без проверки.','Save verification is taking longer than expected. You may continue waiting or explicitly exit without verification.')}</p>}
 </div>}
 {(closeFailure||closeSlow)&&<div role="alert" className="advanced-error">
  {closeFailure&&<p>{closeFailure}</p>}
  <p>{tr('Открытая работа может быть не сохранена. Выход без проверки выполняется только по вашему подтверждению.','Open work may not be saved. Exit without verification requires your explicit confirmation.')}</p>
  <button type="button" onClick={exitWithoutVerifiedSave}>{tr('Выйти без проверки сохранения','Exit without save verification')}</button>
 </div>}
 {persistenceError&&<div role="alert" className="advanced-error">{tr('Оформление не подтверждено в Core: ','Appearance not yet persisted in Core: ')}{persistenceError}</div>}<div className="page-context-help"><strong>{pageName(page,language)}</strong><HelpTip topic={page}/></div>{page==='Домены'&&<div className="domain-strip">{[['Learn','Образование · Развитие','learn'],['ArtBazy','Диагностики · Продажи','art'],['Комплектовод','Вещи · Коллекции','kit'],['Другие домены','Независимые продукты','more']].map(([p,sub,kind],i)=>{const icons=[BookOpen,PenLine,Boxes,Blocks],Icon=icons[i];return <div key={p} className={'domain-tile domain-static '+kind}><span className="domain-mark"><Icon size={26} aria-hidden="true"/></span><span><b>{p}</b><small>{sub}</small><small>{tr('Отдельный продукт IWXA','Separate IWXA product')}</small></span></div>})}</div>}
 {submissionRecoveryNotice&&<div className="advanced-notice" role="status">
  <span>{submissionRecoveryNotice}</span>
  <button type="button" className="mini-button" onClick={()=>setSubmissionRecoveryNotice('')}
   aria-label={tr('Закрыть уведомление','Dismiss notice')}>×</button>
 </div>}
 {error&&<div className="alert"><OwnerError error={error}/><button onClick={()=>setError('')} aria-label={tr('Закрыть сообщение','Dismiss message')}>×</button></div>}
 {page==='Главная'&&(!areaLoaded||!activeArea?taskComposer:<HomeDashboard
   key={activeArea.id} areaId={activeArea.id} areaName={activeArea.name}
   taskComposer={taskComposer} tasks={tasks}
   taskSources={verifiedSelectedTask?overviewSources.map(source=>source.path||'').filter(Boolean):[]}
   selectedTask={selected?{
    id:selected,
    title:pending?.title||(verifiedSelectedTask?detail?.objective:tr('Проверяем выбранную работу','Checking selected task'))||selected,
    status:pending?visibleTaskStatus(pending.status,pending.id,queuedRequest,language):
     visibleTaskStatus(detail?.status,selected,queuedRequest,language),
    verified:!!verifiedSelectedTask
   }:null}
   taskStatus={task=>visibleTaskStatus(task.status,task.id,queuedRequest,language)}
   onOpenTask={id=>void openTask(id)}
   onNavigate={name=>setPage(name)}
   onOpenProgram={program=>{
    const ids:Record<string,string>={
     'external:goose':'GOOSE_PRIMARY_V1','external:ollama':'OLLAMA_LOCAL_V1',
     'external:obsidian':'OBSIDIAN_V1','external:iwxa-obscura':'OBSCURA_WORKER_V1'
    };
    if(program==='external:mcp'){setPage('Интеграции');return}
    const chosen=ids[program];
    if(chosen)openProgram(chosen);
    else setPage('Программы');
   }} coreReady={coreConnection==='ready'}/>)}

 {page==='Работа в организации'&&<CorporateWorkControl onOpenAgentTask={id=>{setPage('Задачи');void openTask(id);}}/>}
 {['Главная','Задачи'].includes(page)&&<>
 {page==='Задачи'&&!selected&&taskComposer}
 {page==='Задачи'&&selected&&<section className="document-work"><div className="document-tabs">
  <div className="document-tablist" role="tablist" aria-label={tr('Разделы выбранной задачи','Selected Task sections')}
   onKeyDown={e=>{
    const next=nextTaskResultTab(documentTab,e.key);
    if(!next)return;
    e.preventDefault();
    setDocumentTab(next);
    window.requestAnimationFrame(()=>document.getElementById('task-tab-'+next)?.focus());
   }}>
   <button type="button" role="tab" id="task-tab-result" aria-controls="task-document-panel"
    aria-selected={documentTab==='result'} tabIndex={documentTab==='result'?0:-1}
    className={documentTab==='result'?'active':''} onClick={()=>setDocumentTab('result')}>
    <FileText size={15}/>{tr('Результат','Result')}</button>
   <button type="button" role="tab" id="task-tab-history" aria-controls="task-document-panel"
    aria-selected={documentTab==='history'} tabIndex={documentTab==='history'?0:-1}
    className={documentTab==='history'?'active':''} onClick={()=>setDocumentTab('history')}>
    <History size={15}/>{tr('История действий','Action history')}</button>
   <button type="button" role="tab" id="task-tab-plan" aria-controls="task-document-panel"
    aria-selected={documentTab==='plan'} tabIndex={documentTab==='plan'?0:-1}
    className={documentTab==='plan'?'active':''} onClick={()=>setDocumentTab('plan')}>
    <ListChecks size={15}/>{tr('План','Plan')}</button>
   <button type="button" role="tab" id="task-tab-sources" aria-controls="task-document-panel"
    aria-selected={documentTab==='sources'} tabIndex={documentTab==='sources'?0:-1}
    className={documentTab==='sources'?'active':''} onClick={()=>setDocumentTab('sources')}>
    <Globe size={15}/>{tr('Источники','Sources')} ({taskSources.length})</button>
  </div>
  <span className="spacer"/>
  <button type="button" aria-label={inspector?tr('Закрыть панель сведений','Close details panel'):tr('Открыть панель сведений','Open details panel')}
   onClick={()=>setInspector(!inspector)}>{inspector?<PanelRightClose size={16}/>:<PanelRightOpen size={16}/>}</button>
 </div>
 <div className="document-panel" role="tabpanel" id="task-document-panel" aria-labelledby={'task-tab-'+documentTab} tabIndex={0}>{!detailFresh?
 <p role="status">{tr('Читаем состояние выбранной задачи. Последний результат не показывается до обновления.',
  'Loading the selected Task. Its previous result is hidden until it is refreshed.')}</p>
 :documentTab==='plan'&&detail?.task_id===selected?<TaskActionsPanel key={selected} taskId={selected} acceptedDigest={detail?.accepted_artifact_digest} fresh={detailFresh} focusPlanId={focusPlanId} focusRequest={planFocusRequest} onRefreshTask={()=>openTask(selected,false)}
    onDocumentReview={()=>{setPage('Задачи');setDocumentFocus(v=>v+1);}} onOpenRecovery={()=>setPage('Восстановление')} onOpenAutomations={()=>setPage('Автоматизации')}/>:documentTab==='plan'?<p role="status">{tr('Выберите сохранённую задачу, чтобы увидеть её план.','Choose a saved Task to view its plan.')}</p>:(documentTab==='history'||documentTab==='sources')?<TaskEvidencePanel readback={detail?.readback} tab={documentTab} taskId={selected}
 acceptedResult={accepted}
 acceptedTaskCandidates={tasks.filter(item=>item.id!==selected&&item.status==='completed')
  .map(item=>({id:item.id,objective:item.title}))}
 onUseDocumentRevision={file=>preparePersonalFileAnalysis(file)}/>:<><h2>{detail?.objective||tr('Рабочий результат','Work result')}</h2>
 {detail?.task_id===selected&&<p className="result-lifecycle" role="status">
  <strong>{accepted?tr('Результат принят','Result accepted'):visibleTaskStatus(detail.status,selected,detail.background_submission?{taskId:selected,state:detail.background_submission.state}:queuedRequest,language,detail.model_inference_active)}</strong>
 </p>}
 <TaskModelReadback detail={detail} taskId={selected}/>{detail?.summary?<SafeMarkdown text={detail.summary} className="document-content"/>:<p>{detail?tr('Результат ещё не получен.','No result yet.'):tr('Выберите существующую задачу или создайте новую.','Choose an existing task or create a new one.')}</p>}
 {detail?.linked_atlas_work&&<AtlasWorkContextStatus link={detail.linked_atlas_work} tr={tr}/>}
 {Boolean(detail?.linked_external_context?.length)&&<ExternalContextStatus links={detail?.linked_external_context||[]} tr={tr}/>}
 {Boolean(detail?.readback?.external_notes?.length)&&<ObsidianSavedNotes notes={detail?.readback?.external_notes||[]} tr={tr}/>}
 {meetingTaskReview&&<section className="advanced-form" role="status" aria-label={tr('Поручения из сохранённого результата','Actions from saved result')}>
  <h3>{tr('Поручения из результата','Action items from the result')}</h3>
  <p>{meetingTaskReview.status==='VERIFIED_QUOTES'
   ?tr('Цитаты совпадают с протоколом. Проверьте содержание поручений перед дальнейшей работой.','Quotes match the transcript. Review the proposed actions before continuing.')
   :tr('Есть несоответствия с протоколом. Проверьте исходный текст.','There are mismatches with the transcript. Review the original text.')}</p>
  {meetingTaskReview.assignments?.map((item,i)=><div className="owner-row" key={i}>
   <strong>{i+1}. {item.action}</strong>
   <span>{tr('Исполнитель','Assignee')}: {item.assignee==='UNKNOWN'?tr('Не указан','Not specified'):item.assignee}</span>
   <span>{tr('Срок','Due')}: {item.due_date==='UNKNOWN'?tr('Не указан','Not specified'):item.due_date}</span>
   <small>{tr('Из протокола','Source')}: «{item.quote}»</small>
  </div>)}
  {meetingTaskReview.issues.length>0&&<ul>{meetingTaskReview.issues.map((issue,i)=><li key={i}>{issue}</li>)}</ul>}
  {meetingTaskReview.questions.length>0&&<><h4>{tr('Что уточнить','Questions to clarify')}</h4><ul>{meetingTaskReview.questions.map((question,i)=><li key={i}>{question}</li>)}</ul></>}
 </section>}
 {detail?.claims?.length?<><h3>{tr('Основные выводы','Key findings')}</h3><ul>{detail.claims.map((c,i)=><li key={i}>{c.text}{c.basis&&<small> · {c.basis}</small>}</li>)}</ul></>:null}
 {detail?.uncertainties?.length?<><h3>{tr('Неопределённости','Open questions')}</h3><ul>{detail.uncertainties.map((c,i)=><li key={i}>{c}</li>)}</ul></>:null}
 {sources.length?<details className="task-result-sources"><summary>{tr('Материалы и основания','Materials and evidence')} ({sources.length})</summary><ul>{sources.map((s,i)=><li key={i}>{s.path||tr('Источник','Source')}</li>)}</ul></details>:null}
 {detail?.summary&&<div className="document-note">{accepted
  ?tr('Результат принят. Это не подтверждает сохранение файла или внешнее действие; проверьте их отдельно.',
    'Result accepted. This does not verify a saved file or external action; check those separately.')
  :tr('Результат помощника ещё не означает вашего согласия. Изменение файлов требует отдельного разрешения.',
    'An assistant result does not imply your approval. File changes require separate permission.')}</div>}
 {detail?.status==='awaiting_result'&&selectedBackgroundState==='COMPLETED'&&!detail?.model_inference_active&&
  <div className="task-recovery-status" role="status">
   <p>{tr('Фоновая попытка завершена, но Core не подтвердил Result. Сначала проверьте сохранённую задачу, затем при необходимости повторите модель.',
    'The background job finished without a verified Result. Inspect the saved Task first, then retry the model if needed.')}</p>
   <button type="button" className="secondary-button" disabled={!detailFresh||!!busy}
    onClick={()=>void openTask(selected,false)}>{tr('Проверить сохранённый результат','Verify saved Result')}</button>
  </div>}
 {detail?.status==='awaiting_result'&&(taskRetryBlockedByBackground(queuedRequest,selected,detail?.background_submission,detail?.model_inference_active)
  ?<div className="task-recovery-status" role="status">
    <p>{detail?.model_inference_active||['RUNNING','SCHEDULED'].includes(selectedBackgroundState||'')
     ?tr('Модель выполняет запрос. Повторный запуск недоступен.',
       'The model is processing this Task. A second inference is blocked.')
     :selectedBackgroundState==='PAUSED'
     ?tr('Фоновая обработка приостановлена. Продолжите её в «Автоматизациях».',
       'Background processing is paused. Resume it in Automations.')
     :tr('Проверьте состояние фонового задания в «Автоматизациях».',
       'Inspect the background job status in Automations.')}</p>
    {selectedBackgroundState==='PAUSED'&&!detail?.model_inference_active&&
     <button type="button" className="secondary-button" onClick={()=>setPage('Автоматизации')}>
      {tr('Открыть автоматизации','Open Automations')}</button>}
   </div>
  :<button className="secondary-button" disabled={!detailFresh||!!busy} onClick={()=>void retry()}>{tr('Повторить незавершённый вызов модели','Retry the incomplete model request')}</button>)}
 {candidates.length?<><h3>{tr('Предлагаемые действия','Proposed actions')}</h3>{candidates.map(({c,id})=><div className="approval-plan" key={id}><strong>{c.description||tr('Предложенное действие','Proposed action')}</strong>{c.tool_id!=='files.write_text'&&<button disabled={!accepted||!detailFresh||!!busy||!detail?.accepted_action_candidate_ids?.includes(id)} onClick={()=>void prepareCandidate(id)}>{tr('Подготовить план','Prepare plan')}</button>}</div>)}</>:null}
 </>}</div>
 <div className="document-footer">{documentTab==='result'&&accepted&&detail?.local_document_mode&&<button className="secondary-button" onClick={()=>{setPage('Задачи');setDocumentFocus(value=>value+1);}}><FilePlus2 size={15}/>{tr('Документ: создание или обновление','Document: create or update')}</button>}{documentTab==='result'&&<button className="primary-button" disabled={!detail||!detailFresh||detail.status!=='result_imported'||detail.review_required!==true} onClick={()=>{setDecision('');setNotes('');setSelectedCandidates([]);setReview(true);}}><Save size={15}/>{tr('Решение по результату','Review and decide')}</button>}</div></section>}
 {page==='Задачи'&&accepted&&detailFresh&&detail?.task_id===selected&&activeArea&&
  <ObsidianNoteDraftControl key={activeArea.id+':'+selected+':'+detail.accepted_artifact_digest}
   sourceTaskId={selected} acceptedDigest={detail.accepted_artifact_digest||''}
   summary={detail.summary||''} workspaceId={activeArea.id} tr={tr}
   onOpenDraft={async id=>{await openTask(id)}}
   onConfigure={()=>{setConnectionFocus('human_knowledge_workspace');setPage('Интеграции')}}/>}
 {page==='Задачи'&&<div className="advanced-form" aria-label={tr('Продолжить работу','Continue work')}>
    <h3>{tr('Как продолжить работу','How to continue work')}</h3>
    {text.trim()&&<><p>{tr('Черновик: перенесём только текст задачи, сохранив здесь исходные данные.','Draft: copy only the objective and keep existing data here.')}</p>
     <div className="advanced-actions">
      <button type="button" onClick={()=>continueTaskIn('Цепочки','draft')}>{tr('Шаги из черновика','Steps from draft')}</button>
      <button type="button" onClick={()=>continueTaskIn('Агенты','draft')}>{tr('Помощники','Assistants')}</button>
      <button type="button" onClick={()=>continueTaskIn('Автоматизации','draft')}>{tr('Запланировать','Schedule')}</button>
     </div></>}
    {accepted&&detailFresh&&detail?.task_id===selected&&<div>
     <p>{tr('Принятый результат: для новой цепочки сохраняется проверенная связь с задачей. При выборе «Шаги из результата» передаётся именно полный принятый текст, без вложений и без обрезания. Запуск отдельно подтверждается.',
       'Accepted result: a new workflow retains verified Task origin. Choosing Steps from result copies the complete accepted text, without attachments or truncation. Execution requires separate approval.')}</p>
     <div className="advanced-actions">
      <button type="button" onClick={()=>continueTaskIn('Цепочки','accepted-result')}>{tr('Шаги из результата','Steps from result')}</button>
      {Boolean(detail?.readback?.goals?.length)&&<p>{tr(
       'Чтобы продолжить с существующей целью, выберите её ниже. Для нового процесса на основе Result цель выбирается отдельно, автоматически первая цель не назначается.',
       'To continue with an existing Goal, choose it below. A new workflow based on the Result requires a separate Goal choice; the first Goal is never selected automatically.'
      )}</p>}
      <button type="button" onClick={()=>continueTaskIn('Агенты','accepted')}>{tr('Поручить помощникам','Assign assistants')}</button>
      <button type="button" onClick={()=>continueTaskIn('Автоматизации','accepted')}>{tr('Запланировать продолжение','Schedule follow-up')}</button>
     </div>
    </div>}
    {detailFresh&&detail?.task_id===selected&&Boolean(detail.readback?.scheduled_work?.length)&&
    <div className="owner-rows">
     <strong>{tr('Запланированная работа','Scheduled follow-ups')}</strong>
     {(detail.readback?.scheduled_work||[]).map(job=><div className="owner-row" key={job.job_id}>
      <span>{job.needs_attention?tr('Нужна проверка','Needs attention'):
       job.state==='PAUSED'?tr('Приостановлено','Paused'):
       job.state==='COMPLETED'?tr('Завершено','Completed'):
       job.state==='CANCELLED'?tr('Отменено','Cancelled'):
       tr('Запланировано','Scheduled')}</span>
      {(job.state==='SCHEDULED'||job.state==='PAUSED')&&
       <button type="button" disabled={!!relatedActionBusy||!!busy}
        onClick={()=>void updateRelatedSchedule(job.job_id,job.state==='SCHEDULED'?'pause':'resume')}>
        {job.state==='SCHEDULED'?tr('Приостановить','Pause'):tr('Продолжить','Resume')}
       </button>}
      <button type="button" onClick={()=>{setWorkHandoff(null);setAutomationFocus(job.job_id);setPage('Автоматизации')}}>
       {tr('Открыть расписание','Open schedule')}</button>
      {job.last_task_id&&<button type="button" onClick={()=>void openTask(job.last_task_id!)}>
       {tr('Открыть результат','Open result')}</button>}
     </div>)}
     {detail.readback?.scheduled_history_limited&&<small>{tr('Показана часть истории расписаний.','Showing part of the schedule history.')}</small>}
    </div>}
   {accepted&&detailFresh&&Boolean(detail?.readback?.goals?.length)&&<div className="owner-rows">
     <strong>{tr('Связанные цели','Linked goals')}</strong>
     {(detail?.readback?.goals||[]).map(g=><div className="owner-row" key={g.goal_id}>
      <span>{g.objective}</span><small>{g.complete?tr('Цель подтверждена','Goal verified'):tr('В работе','In progress')}</small>
      <button type="button" onClick={()=>continueTaskIn('Цепочки','accepted',g.goal_id)}>{tr('Продолжить с целью','Continue with goal')}</button>
      <button type="button" onClick={()=>continueTaskIn('Цепочки','accepted-result',g.goal_id)}>{tr('Шаги по результату','Use accepted result')}</button>
     </div>)}
    </div>}
   </div>}
 {page==='Задачи'&&detail?.task_id===selected&&<section className="task-related-tools">
  {accepted&&detailFresh&&Boolean(meetingTranscriptFromTask(detail.objective)?.trim())
   &&!relatedPanelsOpen&&<button type="button" className="primary-button"
    onClick={()=>setRelatedPanelsTaskId(selected)}>
    {tr('Проверить и уточнить поручения','Review and clarify action items')}
   </button>}
  <button type="button" className="secondary-button" aria-expanded={relatedPanelsOpen}
   onClick={()=>setRelatedPanelsTaskId(relatedPanelsOpen?'':selected)}>
   {relatedPanelsOpen?tr('Скрыть планы и связанные работы','Hide plans and linked work'):
    tr('Планы и связанные работы','Plans and linked work')}
  </button>
  {relatedPanelsOpen&&<>
 <TaskGoalsPanel taskId={selected} taskObjective={detail.objective} taskSummary={detail.summary} taskDraftArtifacts={detail.draft_artifacts} acceptedDigest={detail.accepted_artifact_digest} reportTasks={tasks}
    onOpenReport={id=>void openTask(id)}
    onRefreshReports={refresh}
    fresh={detailFresh} links={detail.readback} onRefreshTask={()=>openTask(selected,false)}
    onContinueGraph={(goalId,boardId)=>continueTaskIn('Цепочки','accepted',goalId,boardId)}
     onOpenGraph={openGraphExecution}/> <N8nTaskLifecycle task={detail} fresh={detailFresh} busy={!!busy}
   onReview={()=>{setSelectedCandidates((detail.action_candidates||[]).filter(c=>c.operation==='n8n.workflow').map(c=>String(c.candidate_id)));setDecision('approve');setNotes('');setReview(true);}}
   onPrepare={id=>void prepareCandidate(id)}
   onOpenPlan={planId=>{setFocusPlanId(planId);setPlanFocusRequest(v=>v+1);setDocumentTab('plan');}}
   onOpenRecovery={caseId=>{setRecoveryFocusCase(caseId);setPage('Восстановление');}}
   onOpenAutomations={()=>setPage('Автоматизации')}
   onOpenPrograms={()=>openProgram('external:n8n')}/> <TaskWorkPanel taskId={selected} accepted={Boolean(accepted)} fresh={detailFresh} links={detail.readback}
    onOpenGraph={openGraphExecution}
    onOpenAssistant={id=>{setWorkHandoff(null);setAgentRunFocus(id);setPage('Агенты');}}
    onRefreshTask={()=>openTask(selected,false)}/>
    </>}
 </section>}
 {page==='Задачи'&&<T2DomainResultControl
  disabled={!draftLoaded||!!busy||!!pendingTask||!!composerSaveFailure||domainResultBusy}
  onUse={addDomainResultToTask}/>}
 {page==='Задачи'&&<div className="iwxa-task-starters" aria-label={tr('Схемы задач','Task templates')}>
   <strong>{tr('Начните с готовой схемы','Start with a template')}</strong>
   {([
    ['planning-and-prioritization',tr('План работы','Work plan'),tr('Цель:\nСрок:\nДоступные ресурсы:\nОграничения:\nНужный результат: план с шагами, приоритетами и контрольными точками.','Goal:\nDeadline:\nResources:\nConstraints:\nExpected result: prioritized steps and milestones.')],
    ['comparison-and-decision',tr('Сравнение вариантов','Compare alternatives'),tr('Что сравниваем:\nВарианты:\nКритерии:\nОграничения:\nНужный результат: вывод, аргументы, риски.','Compare:\nAlternatives:\nCriteria:\nConstraints:\nExpected result: recommendation and risks.')],
    ['communication-drafting',tr('Подготовка текста','Draft a document'),tr('Для кого:\nЦель текста:\nИсходные материалы:\nТон:\nНужный результат: готовый текст и вопросы для уточнения.','Audience:\nPurpose:\nInputs:\nTone:\nExpected result: complete draft and open questions.')],
    ['triage-and-extract',tr('Поручения из протокола','Meeting action items'),tr('Разбери протокол совещания и подготовь черновик поручений. Для каждого поручения укажи действие, дословную цитату, исполнителя и срок. Неизвестные исполнитель или срок — UNKNOWN. Отдели обсуждения от поручений, перечисли вопросы к человеку. Не отправляй сообщения и не создавай внешние задачи. Соблюдай формат IWXA Task: внешний JSON-объект с полями summary, claims, uncertainties, draft_artifacts, action_candidates. В summary дай краткий читаемый итог, claims и action_candidates оставь пустыми, uncertainties заполни вопросами. В draft_artifacts помести одну JSON-строку с объектом {action_items:[{action,quote,start,end,assignee,due_date}],open_questions:[...]}. Позиции start/end считай по Unicode code points (end не включается); если позиции неизвестны, цитату всё равно приведи дословно.\n\nПротокол:\n','Review the meeting transcript and draft action items. For each proposed assignment include the action, exact source quote, assignee and deadline. Missing owner or deadline = UNKNOWN. Separate discussion from assignment and list questions for the user. Do not send messages or create external tasks. Follow the IWXA Task outer JSON format with keys summary, claims, uncertainties, draft_artifacts and action_candidates. Write a short readable summary; keep claims and action_candidates empty, and put unresolved questions in uncertainties. Put one JSON-serialized string in draft_artifacts containing {action_items:[{action,quote,start,end,assignee,due_date}],open_questions:[...]}. Offsets count Unicode code points with end exclusive; preserve exact quotes even when positions are unknown.\n\nTranscript:\n')]
   ] as const).map(([id,title,template])=><button type="button" key={id} disabled={!draftLoaded}
    onClick={()=>{if(text.trim()&&!window.confirm(tr('Заменить текущий черновик схемой задачи?','Replace the current draft with a task template?')))return;
     setSkill(id);setText(template);}}>{title}</button>)}
  </div>}
 {pendingTask&&<section className="subpage card" role="status">
  <h2>{tr('Проверить сохранённую отправку','Review saved submission')}</h2>
  <p>{tr('Предыдущая задача могла быть принята до обрыва связи. Новая отправка отключена, пока Core не подтвердит результат.',
   'A previous Task may have been accepted before the connection dropped. New submissions remain disabled until Core confirms the outcome.')}</p>
  {pendingTask.workspace_id!==activeArea?.id&&<p>{tr(
   'Перейдите в рабочую область исходной задачи для проверки.',
   'Switch to the original Task workspace before reconciliation.')}</p>}
  <button type="button" disabled={taskRecoveryBusy||!!busy||pendingTask.workspace_id!==activeArea?.id}
   onClick={()=>void inspectPendingTask()}>{tr('Проверить отправку','Inspect submission')}</button>
  <button type="button" disabled={taskRecoveryBusy||!!busy||pendingTask.workspace_id!==activeArea?.id}
   onClick={()=>void cancelPendingTask()}>{tr('Отказаться от подготовки','Cancel reservation')}</button>
 </section>}
 {page==='Задачи'&&!!selected&&taskComposer}
 {page==='Задачи'&&queuedRequest&&<section className="subpage card">
   <h2>{tr('Запрос принят','Request received')}</h2>
   <p>{queuedRequest.state==='CANCELLED'
    ?tr('Обработка отменена. Сохранённое задание можно проверить в истории.',
     'Processing was cancelled. The saved Task can be inspected in history.')
    :queuedRequest.state==='COMPLETED'
    ?tr('Модель завершила выполнение, но сохранённый результат пока не подтверждён. Проверьте задачу и историю выполнения.',
     'The model job has finished, but the saved Result is not verified yet. Check the Task and run history.')
    :queuedRequest.state==='PAUSED'||queuedRequest.state==='DEAD'
    ?tr('Ответ прервался. Проверьте причину и сохранённое задание.',
     'The response stopped. Review the reason and saved Task.')
    :tr('Модель обрабатывает запрос. Можно продолжать работу с агентом.',
     'The model is processing the request. You can keep using the agent.')}</p>
   <TaskWaitStatus key={queuedRequest.taskId} taskId={queuedRequest.taskId}
     state={queuedRequest.state} hasPartial={!!queuedRequest.partial} tr={tr}
     onOpenModels={()=>setPage('Модели')}/>
   {queuedRequest.partial&&<div className="conversation-turn"><strong>{tr('Предварительный ответ','Live response')}</strong>
    <SafeMarkdown text={queuedRequest.partial}/>
    <small>{tr('Окончательный ответ сохранится в задаче','The final output will be saved to the Task')}</small></div>}
   {queuedRequest.errorCode&&['PAUSED','DEAD','CANCELLED','COMPLETED'].includes(queuedRequest.state)&&
    <p role="status">{taskFailureGuidance(queuedRequest.errorCode,tr)}</p>}
   {queuedRequest.errorCode&&<details><summary>{tr('Причина остановки','Failure details')}</summary>
    <code>{queuedRequest.errorCode}</code></details>}
   {(['PAUSED','DEAD','CANCELLED'].includes(queuedRequest.state)||queuedRequest.state==='COMPLETED')&&<>
    <p>{tr('Запрос и состояние обработки сохранены. Откройте историю автоматизаций, чтобы проверить причину остановки.','The request and processing state are saved. Open automation history to inspect the interruption.')}</p>
    <button type="button" className="secondary-button" disabled={!!busy||!activeArea?.id}
      onClick={()=>void openTask(queuedRequest.taskId)}>
     {tr('Открыть задачу','Open Task')}</button>
    <button type="button" onClick={()=>setPage('Автоматизации')}>
     {tr('Проверить состояние','Inspect status')}</button>
   </>}
  </section>}
 {page==='Задачи'&&<section className="subpage card">
  <button type="button" className="secondary-button" aria-expanded={inlineToolsOpen}
   onClick={()=>setInlineToolsOpen(value=>!value)}>
   {inlineToolsOpen?tr('Скрыть источники и инструменты','Hide sources and tools')
    :tr('Прочитать источник для задачи','Read a source for this task')}
  </button>
  {inlineToolsOpen&&<ToolsReadControl inlineDestination="task"
   onConnections={()=>{setConnectionFocus('mcp_tools');setPage('Интеграции')}}
   onAttachToDraft={attachToolReadToDraft}/>}
 </section>}
 {page==='Задачи'&&activeArea?.local_only===false&&<section className="subpage card">
  <button type="button" className="secondary-button" aria-expanded={inlineWorkflowOpen}
   onClick={()=>setInlineWorkflowOpen(value=>!value)}>
   {inlineWorkflowOpen?tr('Скрыть подготовку процесса','Hide workflow proposal')
    :tr('Подготовить процесс n8n','Prepare n8n workflow')}
  </button>
  {inlineWorkflowOpen&&<N8nWorkflowProposal
   initialMessage={text}
   onOpenTask={id=>void openTask(id)}/>}
 </section>}
 {page==='Задачи'&&activeArea?.id&&<IwxaExchangeControl
  key={activeArea.id+':'+(selected||'none')}
  workspaceId={activeArea.id}
  taskId={detailFresh&&detail?.task_id===selected&&detail.status==='closed'&&detail.accepted_artifact_digest?selected:null}
  onImported={id=>{void (async()=>{try{
    if(await refresh())await openTask(id);
  }catch(e){setError(message(e));}})();}}/>}
 {page==='Задачи'&&<DocumentWorkflow focusRequest={documentFocus} readbackEpoch={sessionReadbackEpoch} task={detail} workspaceId={activeArea?.id||''} verified={detailFresh} onRegisterLeaveGuard={registerDocumentLeaveGuard} onRegisterCloseFlush={registerDocumentCloseFlush} onOpenTask={async id=>{await openTask(id,true,true);}} onOpenSourceTask={async id=>{await openTask(id);}}
   onRefreshTasks={refreshDocumentTask} onReviewCandidate={id=>{setSelectedCandidates([id]);setDecision('approve');setNotes('');setReview(true);}}
   onOpenConnections={()=>{setConnectionFocus('file_workspace');setPage('Интеграции');}}
   onOpenRecovery={id=>{setRecoveryFocusCase(id);setPage('Восстановление');}}/>}
  {page==='Задачи'&&<section className="subpage card"><h2>{tr('Сохранённые задачи','Saved tasks')}</h2>
   {!areaLoaded?<p role="status">{tr('Список задач пока не подтверждён. Проверьте подключение.',
    'The saved Task list is not yet verified. Check the connection.')}</p>:
    <SavedTaskList key={activeArea?.id||'workspace'} tasks={tasks} selected={selected}
     onOpenTask={openSavedTask} statusLabel={label}/>}
  </section>}
 </>}
 {page==='Согласования'&&<ApprovalsControl readbackEpoch={sessionReadbackEpoch} attentionTasks={tasks} tasksVerified={areaLoaded} onOpenTask={id=>void openTask(id)} onOpenRecovery={id=>{setRecoveryFocusCase(id||'');setPage('Восстановление');}} onOpenAutomations={()=>setPage('Автоматизации')} onOpenMemory={()=>setPage('Память')}/>}
 {page==='Домены'&&<section className="subpage card"><h2>{tr('Самостоятельные продукты IWXA','Independent IWXA products')}</h2><p>{tr('Learn, ArtBazy, Комплектовод и другие продукты сохраняют собственные права и данные. Подключение возможно только с разрешением.','Learn, ArtBazy, Komplektovod and other products keep their own permissions and data. Connecting them requires authorization.')}</p></section>}
 {page==='Диалоги'&&<DialogControl readbackEpoch={sessionReadbackEpoch} onRegisterCloseFlush={registerConversationCloseFlush} onCreateTask={async(key,messageId)=>{
   if(conversationTaskTransferInFlight.current)return;
   const navigationAtStart=navigationActionEpoch.current;
   if(!draftLoaded||composerSaveBlocked.current||submitInFlight.current||workspaceSwitchInFlight.current
      ||nativeCloseBusy.current||personalFileImport.current||acceptedEvidenceTransfer.current
      ||taskDispatchUnknown.current||pendingTask)
    throw Error('task_draft_not_ready');
   conversationTaskTransferInFlight.current=true;
   try{
   draftSaveEpoch.current++;await draftWriteQueue.current;
   const before=currentComposer.current;
   await persistComposer({text:before.text,knowledge_sources:before.knowledgeSources,
    attachments:before.files,local_model:before.localPin});
   const expected=await runtime.query<{state:string;draft_digest:string}>('composer_draft');
   if(expected.state!=='SAVED')throw Error('task_draft_unavailable');
   const result=await runtime.command<{draft:{draft_digest:string;text:string;attachments:{name:string;text:string}[];local_model?:unknown};attachment_name:string}>(
    'quick_chat_to_task_draft',{conversation_key:key,message_id:messageId,
     expected_draft_digest:expected.draft_digest,confirmed:true});
   const readback=await runtime.query<{draft_digest:string;text:string;attachments:{name:string;text:string}[];local_model?:unknown}>('composer_draft');
   if(readback.draft_digest!==result.draft.draft_digest||readback.text!==result.draft.text||
     !readback.attachments.some(x=>x.name===result.attachment_name)||
     JSON.stringify(readLocalModelPin(readback.local_model))!==JSON.stringify(readLocalModelPin(result.draft.local_model)))
    throw Error('chat_task_transfer_readback_mismatch');
   if(JSON.stringify(currentComposer.current)!==JSON.stringify(before))
    throw Error('task_draft_changed_during_transfer');
   if(!composerDigestVerified(readback.draft_digest))throw Error('chat_task_transfer_revision_unverified');
   composerDraftRevision.current=readback.draft_digest;
   const transferredPin=readLocalModelPin(readback.local_model);
   // This Core mutation is already saved. Skip the redundant 700ms autosave
   // and keep the just-read revision as the next edit's starting point.
   savedComposerSignature.current=JSON.stringify([
    readback.text,before.knowledgeSources,readback.attachments,transferredPin
   ]);
   initialRestoredComposerSnapshot.current=savedComposerSignature.current;
   draftSaveEpoch.current++;
   currentComposer.current={...before,text:readback.text,files:readback.attachments,localPin:transferredPin};
   setText(readback.text);setFiles(readback.attachments);setLocalPin(transferredPin);
   // A conversation turn prepares input; the user still has to send the
   // actual Task. Never hijack a more recent navigation request.
   if(currentPage.current==='Диалоги'&&navigationActionEpoch.current===navigationAtStart){
    focusNewTask.current=true;
    setPage('Задачи');
   }
   }finally{conversationTaskTransferInFlight.current=false;}
  }} onOpenTask={id=>{
   // Keep the Dialogue selected until it has been saved and left successfully.
   // A later user navigation overrides this pending read-only Task target.
   if(currentPage.current!=='Диалоги')return;
   deferredDialogueTask.current=id;
   setPage('Задачи');
  }} onOpenModels={()=>setPage('Модели')} onOpenTools={id=>{setToolFocus(id||'');setPage('Инструменты')}}/>}
 {page==='Агенты'&&<AgentControl onReturnToWork={()=>setPage('Главная')} key={agentRunFocus||'agent-workspace'} initialSourceTaskId={workHandoff?.destination==='Агенты'?workHandoff.sourceTaskId:undefined} initialObjective={workHandoff?.destination==='Агенты'?workHandoff.objective:undefined} onHandoffConsumed={()=>setWorkHandoff(null)} onContinueInDialogue={async(hostedRunId,ticketId)=>{
   const {activeKey}=await readConversationCatalog(runtime);
   const previous=await readConversationDraft(runtime,activeKey);
   if(!/^[0-9a-f]{64}$/.test(String(previous.draft_digest||'')))throw Error('dialogue_draft_unavailable');
   await runtime.refreshRevision();
   const saved=await runtime.command<{conversation_key:string;attachment_name:string;draft:{draft_digest:string;attachments:{name:string;text:string}[]}}>(
    'hosted_reference_dialogue_seed',{hosted_run_id:hostedRunId,ticket_id:ticketId,
     conversation_key:activeKey,expected_draft_digest:previous.draft_digest,confirmed:true},
    {kind:'hosted_reference_run',id:hostedRunId});
   const current=await readConversationDraft(runtime,activeKey);
   if(saved.conversation_key!==activeKey||current.draft_digest!==saved.draft.draft_digest||
      !(Array.isArray(current.attachments)&&current.attachments.some(row=>row.name===saved.attachment_name)))
    throw Error('goose_dialogue_transfer_readback_mismatch');
   setPage('Диалоги');
  }} focusRunId={agentRunFocus} onOpenPrograms={()=>openProgram('GOOSE_PRIMARY_V1')} onOpenModels={()=>setPage('Модели')} onOpenConnections={()=>{setConnectionFocus('file_workspace');setPage('Интеграции');}} onOpenTask={id=>void openTask(id)}
  onContinueWithEvidence={async (hostedRunId,ticketId)=>{
   if(acceptedEvidenceTransfer.current||!draftLoaded||composerSaveBlocked.current||submitInFlight.current)
    throw Error('goose_task_draft_not_ready');
   acceptedEvidenceTransfer.current=true;
   try{
    // Old debounced writes must never erase a newly imported assistant result.
    draftSaveEpoch.current++;
    await draftWriteQueue.current;
    const before=currentComposer.current;
    await persistComposer({text:before.text,attachments:before.files,
      knowledge_sources:before.knowledgeSources,local_model:before.localPin});
    const expected=await runtime.query<{state?:string;draft_digest?:string;
      text?:string;attachments?:{name:string;text:string}[];
      knowledge_sources?:KnowledgeSourceSelection[];local_model?:unknown}>('composer_draft');
    const same=(left:unknown,right:unknown)=>JSON.stringify(left)===JSON.stringify(right);
    if(expected.state!=='SAVED'||!/^[0-9a-f]{64}$/.test(expected.draft_digest||'')
       ||expected.text!==before.text
       ||!same(expected.attachments,before.files)
       ||!same(expected.knowledge_sources,before.knowledgeSources)
       ||!same(readLocalModelPin(expected.local_model),before.localPin)
       ||!same(currentComposer.current,before))
      throw Error('goose_task_draft_preflight_changed');
    await runtime.refreshRevision();
    const response=await runtime.command<{schema?:string;draft?:{draft_digest?:string;
      attachments?:{name:string;text:string}[];text?:string;
      local_model?:unknown;knowledge_sources?:KnowledgeSourceSelection[]};
      attachment_name?:string}>(
      'hosted_reference_task_seed',
      {hosted_run_id:hostedRunId,ticket_id:ticketId,
       expected_draft_digest:expected.draft_digest,confirmed:true},
      {kind:'hosted_reference_run',id:hostedRunId});
    const saved=await runtime.query<{state?:string;draft_digest?:string;
      text?:string;attachments?:{name:string;text:string}[];
      local_model?:unknown;knowledge_sources?:KnowledgeSourceSelection[]}>('composer_draft');
    if(response.schema!=='IWXA_GOOSE_TASK_SEED/1'||saved.state!=='SAVED'
       ||!response.attachment_name
       ||!saved.attachments?.some(row=>row.name===response.attachment_name)
       ||!same(response.draft?.attachments,saved.attachments)
       ||response.draft?.draft_digest!==saved.draft_digest
       ||saved.text!==before.text
       ||!same(saved.knowledge_sources,before.knowledgeSources)
       ||!same(readLocalModelPin(saved.local_model),before.localPin)){
      throw Error('goose_task_draft_readback_mismatch');
    }
    // An unrelated edit during transfer must not be overwritten by readback.
    // No new task/model execution occurs; the canonical draft stays recoverable.
    if(!same(currentComposer.current,before))
      throw Error('goose_task_draft_ui_changed_recovery_required');
    if(!composerDigestVerified(saved.draft_digest))throw Error('goose_task_draft_revision_unverified');
    composerDraftRevision.current=saved.draft_digest;
    draftSaveEpoch.current++;
    setText(saved.text?.trim()?saved.text:tr(
      'Проанализируй принятый результат помощника и предложи следующие шаги.',
      'Analyze the accepted assistant result and propose next steps.'));
    setFiles(saved.attachments);
    setKnowledgeSources(saved.knowledge_sources||[]);
    setLocalPin(readLocalModelPin(saved.local_model));
    setError('');
    setPage('Главная');
   }finally{
    acceptedEvidenceTransfer.current=false;
   }
  }}/>} 
 {page==='Проекты'&&<ProjectsControl/>}
 {page==='Рабочие области'&&<WorkAreaControl active={activeArea}
    onSwitchBegin={beginWorkspaceSwitch} onSwitchEnd={finishWorkspaceSwitch}
    onChanged={async(switchAttempted)=>{
     try{await loadWorkAreas();}
     catch(e){if(switchAttempted)invalidateUnverifiedWorkspace();throw e;}
    }}
    onBeforeSwitch={async()=>{
     await beforeWorkspaceSwitch('Рабочие области',activeArea?.id||'',true);
    }}
    onOpenTask={id=>void openTask(id)} onOpenProjects={()=>setPage('Проекты')}/>}
 {page==='Знания'&&<KnowledgeMemoryControl page="Знания" selectedSources={knowledgeSources} allowSelection={files.length===0&&!!activeArea?.permissions.selected_notes}
    onOpenVaults={()=>openProgram('OBSIDIAN_V1')} onConfigureKnowledge={()=>{setConnectionFocus('human_knowledge_workspace');setPage('Интеграции');}} onOpenMemory={()=>setPage('Память')}
    onUseSource={source=>setKnowledgeSources(items=>upsertVerifiedChatSource(items,source))}
    onOpenComposer={()=>{setPage('Главная');window.setTimeout(()=>document.getElementById('request')?.focus(),0);}}/>}
 {page==='Память'&&<KnowledgeMemoryControl page="Память" selectedSources={knowledgeSources} allowSelection={files.length===0&&!!activeArea?.permissions.selected_notes}
    onOpenVaults={()=>openProgram('OBSIDIAN_V1')} onConfigureKnowledge={()=>{setConnectionFocus('human_knowledge_workspace');setPage('Интеграции');}} onOpenMemory={()=>setPage('Память')}
    onUseSource={source=>setKnowledgeSources(items=>upsertVerifiedChatSource(items,source))}
    onOpenComposer={()=>{setPage('Главная');window.setTimeout(()=>document.getElementById('request')?.focus(),0);}}/>}
 {page==='Автоматизации'&&<AutomationsControl onReturnToWork={()=>setPage('Главная')} focusJobId={automationFocus} initialHandoff={workHandoff?.destination==='Автоматизации'?workHandoff:undefined} onHandoffConsumed={()=>setWorkHandoff(null)} onOpenTask={id=>void openTask(id)} onOpenRecovery={caseId=>{setRecoveryFocusCase(caseId);setPage('Восстановление');}} onOpenModels={()=>setPage('Модели')} onOpenApprovals={()=>setPage('Согласования')}/>}
  {page==='Навыки'&&<SkillsControl onUseTaskSkill={id=>{setSkill(id);setPage('Главная');}}/>}
 {page==='Интеграции'&&<><ProviderConnections initialSlot={connectionFocus}/><IntegrationsControl/></>}
 {page==='Инструменты'&&<ToolsReadControl focusToolId={toolFocus} onAttachToDraft={attachToolReadToDraft} onConnections={()=>{setConnectionFocus('mcp_tools');setPage('Интеграции');}}/>}
 {page==='Восстановление'&&<RecoveryControl readbackEpoch={sessionReadbackEpoch} initialCaseId={recoveryFocusCase} onOpenTask={id=>void openTask(id)}/>}
 {page==='Файлы'&&<FilesControl onConfigure={()=>{setConnectionFocus('file_workspace');setPage('Интеграции');}} onOpenTask={()=>setPage('Задачи')} onAnalyze={file=>{void preparePersonalFileAnalysis(file);}}/>}
 {page==='Модели'&&<ModelsControl onReturnToWork={()=>setPage('Главная')} onNavigate={setPage} onOpenProgram={openProgram} onChanged={()=>void runtime.query<Record<string,unknown>>('operational_control').then(setOperational).catch(()=>setOperational(null))}/>}
 {page==='Настройки'&&<SettingsControl onNavigate={setPage}/>}
 {page==='Программы'&&<ProgramsCenter onReturnToWork={()=>setPage('Главная')} onNavigate={next=>{if(next==='Интеграции')setConnectionFocus('workflow_execution');setPage(next)}}
   onOpenMcpConnections={()=>{setConnectionFocus('mcp_tools');setPage('Интеграции')}}
   onOpenMcpTools={()=>setPage('Инструменты')}
   nativeHostRef={activeArea?.id} focusProgram={programFocus} onOpenTask={id=>void openTask(id)} onOpenGooseReview={id=>{setAgentRunFocus(id);setPage('Агенты');}}/>} 
 {page==='Цепочки'&&<ChainBuilder onReturnToWork={()=>setPage('Главная')} onNavigate={setPage}
 initialExecutionId={graphExecutionFocus} onExecutionFocusConsumed={()=>setGraphExecutionFocus('')}
 initialHandoff={workHandoff?.destination==='Цепочки'?workHandoff:undefined} onHandoffConsumed={()=>setWorkHandoff(null)}/>}
 {!['Главная','Задачи','Диалоги','Домены','Согласования','Программы','Цепочки','Агенты','Навыки','Интеграции','Настройки','Модели','Проекты','Автоматизации','Знания','Память','Инструменты','Восстановление','Файлы','Рабочие области'].includes(page)&&<Advanced page={page} initialRecoveryCaseId={recoveryFocusCase}/>}
 </main>
 {inspector&&page==='Задачи'&&<aside className="inspector"><div className="inspector-header"><h2>{tr('Подробности','Details')}</h2><button className="icon-button" aria-label={tr('Закрыть инспектор','Close inspector')} onClick={()=>setInspector(false)}><ChevronRight size={17}/></button></div><p className="inspector-scope">{tr('Сведения о выбранной задаче. Источники и инструменты открываются из разделов приложения.','Selected Task details. Sources and tools open from their own sections.')}</p>
 <div className="inspector-group"><h3>{tr('Текущий контекст','Current context')}</h3><div className="inspector-item"><FileText size={18}/><span>{detail?.objective||tr('Выберите задачу для просмотра сведений.','Select a task to see details.')}</span></div><p>{tr('Состояние:','Status:')} {label(pending?.id===detail?.task_id?pending?.status:detail?.status,language)}</p></div><div className="inspector-group"><h3>{tr('Связанные элементы','Related items')}</h3><div className="inspector-item"><Folder size={16}/><span>{tr('Личная рабочая область','Personal workspace')}</span></div><div className="inspector-item"><MessageCircle size={16}/><span>{tr('Сохранённые задачи:','Saved tasks:')} {tasks.length}</span></div></div><div className="inspector-group"><h3>{tr('Модель ответа','Response model')}</h3><div className="inspector-item"><Brain size={18}/><span>{detail?.provider?.model||taskSourceName(detail?.provider?.id,language)}</span></div></div>
 <div className="inspector-group"><h3>{tr('Действия с инструментами','Tool actions')}</h3>
  {(detail?.readback?.execution_receipts||[]).filter(r=>r.status==='SUCCEEDED'&&r.external_effect_state==='ACKNOWLEDGED').length>0
   ?(detail?.readback?.execution_receipts||[]).filter(r=>r.status==='SUCCEEDED'&&r.external_effect_state==='ACKNOWLEDGED').map((r,i)=>
    <div className="inspector-item" key={i}><CheckSquare size={16}/><span>{r.tool_id==='files.write_text'?tr('Инструмент сообщил о записи. Проверьте readback файла в задаче.','Tool acknowledged the write. Verify file readback in the Task.'):tr('Инструмент сообщил о выполнении. Проверьте фактический результат.','Tool acknowledged execution. Verify the actual outcome.')}</span></div>)
   :<p>{(detail?.readback?.tool_plans||[]).length
       ?tr('Есть подготовленные действия. Выполнение пока не подтверждено квитанцией.','Actions have been prepared. No receipt has yet confirmed their execution.')
       :tr('Подтверждённых вызовов инструментов нет.','No tool execution has been confirmed.')}</p>}
  <p>{tr('Изменение файлов требует отдельного подтверждения.','File changes require separate approval.')}</p>
 </div><div className="inspector-group"><h3>{tr('Действия','Actions')}</h3><div className="inspector-tools"><button onClick={()=>setPage('Согласования')}><ClipboardCheck size={15}/>{tr('Подтверждения','Confirmations')}</button><button onClick={()=>setPage('Файлы')}><FolderOpen size={15}/>{tr('Файлы и данные','Files and data')}</button><button onClick={()=>void refresh()}><RefreshCcw size={15}/>{tr('Обновить','Refresh')}</button></div></div><button className="primary-button" style={{width:'100%',justifyContent:'center'}} onClick={()=>setPage('Задачи')}>{tr('Продолжить задачу','Continue task')} <ChevronRight size={15}/></button></aside>}
 {review&&<div className="modal-backdrop" onMouseDown={e=>{if(!busy&&e.target===e.currentTarget)setReview(false)}}>
  <div className="modal" role="dialog" aria-modal="true" aria-label={tr('Проверка результата','Review result')} onKeyDown={e=>{if(!busy&&e.key==='Escape')setReview(false)}}>
   <h2>{tr('Проверка результата','Review result')}</h2>
   <p>{tr('Ваше решение сохраняется отдельно от разрешения на действия с файлами.','Your review decision is separate from permission to change files.')}</p>
   <label>{tr('Решение','Decision')}<select value={decision} disabled={!!busy} onChange={e=>setDecision(e.target.value)}>
    <option value="">{tr('Выберите','Choose')}</option><option value="approve">{tr('Принять','Accept')}</option>
    <option value="revise">{tr('Доработать','Revise')}</option><option value="reject">{tr('Отклонить','Reject')}</option>
   </select></label>
   {decision==='approve'&&candidates.some(({c})=>c.operation==='files.write_text')&&!candidates.some(({id,c})=>c.operation==='files.write_text'&&selectedCandidates.includes(id))&&
    <p role="status" className="advanced-notice">{tr('Предложенная запись файла не выбрана. Если сохранить такое решение, результат задачи будет принят, но подготовка записи останется недоступной. Выберите нужный кандидат, если хотите продолжить запись.','No file-write candidate is selected. Saving this decision accepts the result but does not authorize preparing the write. Select the exact candidate if you intend to continue.')}</p>}
   {decision==='approve'&&candidates.map(({id,c})=><label key={id}><input type="checkbox" checked={selectedCandidates.includes(id)} disabled={!!busy}
    onChange={e=>{setFileReviewConfirmed(null);setSelectedCandidates(items=>e.target.checked?[...items,id]:items.filter(x=>x!==id))}}/>{c.description||c.tool_id||tr('Предложенное действие','Proposed action')}</label>)}
   {decision==='approve'&&selectedFileCandidates.map(({id,c})=>{
    const exact=readFileWriteReview(c);
    return <section className="review-file-proposal" key={id} aria-label={tr('Полное предложение изменения файла','Complete file modification proposal')}>
     {exact?<><h3>{tr('Перед принятием проверьте запись','Inspect the file write before acceptance')}</h3>
      <p>{tr('Принятие результата включает этот кандидат, но не разрешает его исполнение. Запись потребует нового отдельного решения.',
       'Accepting the result includes this candidate but does not authorize execution. Writing requires a separate approval.')}</p>
      <dl><dt>{tr('Папка','Root')}</dt><dd>{exact.rootId}</dd>
       <dt>{tr('Путь','Path')}</dt><dd>{exact.path}</dd>
       <dt>{tr('Режим','Mode')}</dt><dd>{exact.mode==='replace'?tr('Заменить','Replace'):tr('Создать','Create')}</dd>
       <dt>{tr('Объём','Size')}</dt><dd>{exact.bytes} {tr('байт','bytes')}</dd></dl>
      {exact.expectedSha256&&<p>{tr('Ожидаемый SHA-256 исходного файла','Expected source file SHA-256')}: <code>{exact.expectedSha256}</code></p>}
      <p>{tr('Полный текст, который предложено записать','Complete proposed file content')}</p>
      <pre className="review-file-content">{exact.text}</pre>
     </>:<p role="alert">{tr('Полные параметры кандидата отсутствуют или недостоверны. Его нельзя принять до проверки.',
       'The candidate lacks trustworthy complete arguments. It cannot be accepted.')}</p>}
    </section>;
   })}
   {decision==='approve'&&selectedFileCandidates.length>0&&currentReviewStamp&&<label>
    <input type="checkbox" checked={fileReviewReady} disabled={!!busy}
     onChange={e=>setFileReviewConfirmed(e.target.checked?currentReviewStamp:null)}/>
    {tr('Я изучил полный текст, путь и режим всех выбранных записей. Принятие кандидата не выполняет запись.',
      'I reviewed the full text, path and mode of every selected write. Accepting the candidate does not write a file.')}
   </label>}
   {decision==='approve'&&selectedFileCandidates.length>0&&!fileReviewReady&&<p role="alert">
    {tr('Перед принятием кандидата подтвердите его полный текст и назначение.',
      'Confirm the complete proposed content and destination before accepting the candidate.')}
   </p>}
   <label>{tr('Замечания','Notes')}<textarea value={notes} onChange={e=>setNotes(e.target.value)}/></label>
   <div className="modal-actions"><button className="secondary-button" disabled={!!busy} onClick={()=>setReview(false)}>{tr('Отмена','Cancel')}</button>
    <button className="primary-button" disabled={!decision||!detailFresh||!!busy||!fileReviewReady||(decision==='revise'&&!notes.trim())} onClick={()=>void doReview()}>{tr('Сохранить решение','Save decision')}</button>
   </div>
  </div>
 </div>}
 </div>;
}
