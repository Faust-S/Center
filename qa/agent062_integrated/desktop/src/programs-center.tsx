import React,{useCallback,useEffect,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
import {record,records,str,failure,OwnerDetails,OwnerError,OwnerMessage,useOwnerActions,type Row} from './owner-ui';
import {useUiSettings} from './ui-preferences';
import {GooseControl} from './goose-control';
import {N8nWorkflowProposal} from './n8n-workflow-proposal';
import {ollamaStageText,type UserReadiness} from './ollama-user-status';
import {programWorkState,networkActionAvailable,type ProgramWorkState} from './program-availability';
import {NativeProgramLink} from './native-program-link';
import {invoke,isTauri} from '@tauri-apps/api/core';
import {loadNativeU04Controller} from './u04-native-host';
import type {U03Observation,U04Observation,U04SurfaceObservation,VerifiedWindow} from './native-program-observation';

type Library=Record<string,unknown>;

/** Presentation metadata only. Install/adoption authority belongs to Core. */
type LocalCatalogEntry={ref:string;name:string;purposeRu:string;purposeEn:string;license:string;group:'base'|'local'|'optional'|'server'|'account';official?:string;runtime?:string};
type LocalCatalogRow=[string,string,string,string,string,LocalCatalogEntry['group'],string?,string?];
const LOCAL_PROGRAM_CHOICES_ROWS:LocalCatalogRow[]=[
 ['external:ollama','Ollama','Локальные модели','Local inference','MIT','base','https://ollama.com/download/windows','OLLAMA_LOCAL_V1'],
 ['external:goose','Goose','Помощник для выполнения заданий','Task assistant','Apache-2.0','base','https://block.github.io/goose/docs/getting-started/installation/','GOOSE_PRIMARY_V1'],
 ['external:iwxa-obscura','IWXA Obscura','Локальное чтение разрешённых HTTPS-страниц','Local reading of permitted HTTPS pages','Лицензия исходного выпуска / Upstream license','local',undefined,'OBSCURA_WORKER_V1'],
 ['external:obsidian','Obsidian','Личные заметки и знания','Personal notes and knowledge','Бесплатное локальное использование / Free local use','base','https://obsidian.md/download','OBSIDIAN_V1'],
 ['external:n8n','n8n','Локальные автоматизации и процессы','Self-hosted workflows','Sustainable Use License','local','https://docs.n8n.io/hosting/installation/'],
 ['external:node-red','Node-RED','Автоматизации и устройства','Automations and devices','Apache-2.0','local','https://nodered.org/docs/getting-started/'],
 ['external:joplin','Joplin','Локальные заметки','Local notes','AGPL-3.0-or-later (часть файлов имеет иные лицензии)','local','https://joplinapp.org/help/install/','JOPLIN_V1'],
 ['external:mcp','MCP','Подключение локальных инструментов','Connect local tools','Лицензия зависит от сервера / Server-specific','local','https://modelcontextprotocol.io/'],
 ['external:llama-cpp','llama.cpp','Альтернативный движок моделей','Alternative inference runtime','MIT','optional','https://github.com/ggml-org/llama.cpp'],
 ['external:localai','LocalAI','Самостоятельный сервер моделей','Self-hosted inference','Проверить лицензию выпуска / Verify license','optional','https://localai.io/'],
 ['external:hermes-agent','Hermes Agent','Альтернативный помощник','Alternative assistant','MIT (проверенный выпуск)','optional','https://github.com/NousResearch/hermes-agent'],
 ['external:openclaw','OpenClaw','Агент с дополнительными возможностями','Additional assistant','MIT','optional','https://github.com/openclaw/openclaw'],
 ['external:agent-zero','Agent Zero','Агент с отдельной изоляцией','Isolated agent','Лицензия требует проверки / Verify license','optional','https://github.com/agent0ai/agent-zero'],
 ['external:activepieces','Activepieces','Альтернативные автоматизации','Alternative automations','Зависит от редакции / Edition-specific','optional','https://github.com/activepieces/activepieces'],
 ['external:firecrawl','Firecrawl','Сбор открытых материалов','Public information retrieval','AGPL-3.0 (открытый код)','optional','https://github.com/firecrawl/firecrawl'],
 ['external:litellm','LiteLLM','Необязательный шлюз моделей','Optional model gateway','Условия зависят от выпуска / Verify terms','optional','https://github.com/BerriAI/litellm'],
 ['external:bifrost','Bifrost','Локальный шлюз моделей','Local model gateway','Apache-2.0','optional','https://github.com/maximhq/bifrost'],
 ['external:vllm','vLLM','Модели на сервере Linux','Linux server inference','Apache-2.0','server','https://github.com/vllm-project/vllm'],
 ['external:sglang','SGLang','Сервер моделей высокой производительности','High-performance inference','Apache-2.0','server','https://github.com/sgl-project/sglang'],
 ['external:mlx-lm','MLX-LM','Модели на Apple Silicon','Apple Silicon inference','MIT','server','https://github.com/ml-explore/mlx-lm'],
 ['external:runtipi','Runtipi','Программы на домашнем сервере','Home server applications','GPL-3.0','server','https://github.com/runtipi/runtipi'],
 ['external:umbrelos','umbrelOS','Платформа домашнего сервера','Home server platform','Проверить условия / Verify terms','server','https://github.com/getumbrel/umbrel'],
 ['external:openai-codex','Codex','Необязательный внешний сервис','Optional account-based service','Требуется внешний аккаунт / External account','account'],
 ['external:claude-code','Claude Code','Необязательный внешний сервис','Optional account-based service','Требуется внешний аккаунт / External account','account'],
 ['external:google-antigravity','Google Antigravity','Необязательный внешний сервис','Optional account-based service','Требуется внешний аккаунт / External account','account'],
];
const PORTFOLIO_CAPABILITIES:Record<string,string[]>={
 'external:ollama':['MODELS'],'external:goose':['AGENTS','WORKFLOWS','TOOLS'],
 'external:iwxa-obscura':['KNOWLEDGE','TOOLS'],
 'external:obsidian':['KNOWLEDGE','MEMORY'],'external:n8n':['AUTOMATIONS','WORKFLOWS','INTEGRATIONS'],
 'external:node-red':['AUTOMATIONS','WORKFLOWS','INTEGRATIONS'],
 'external:joplin':['KNOWLEDGE','MEMORY'],'external:mcp':['TOOLS','INTEGRATIONS'],
 'external:llama-cpp':['MODELS'],'external:localai':['MODELS'],
 'external:hermes-agent':['AGENTS','TOOLS'],'external:openclaw':['AGENTS','TOOLS','INTEGRATIONS'],
 'external:agent-zero':['AGENTS','WORKFLOWS'],
 'external:activepieces':['AUTOMATIONS','WORKFLOWS'],
 'external:firecrawl':['KNOWLEDGE','TOOLS'],
 'external:litellm':['MODELS','INTEGRATIONS'],'external:bifrost':['MODELS','INTEGRATIONS'],
 'external:vllm':['MODELS'],'external:sglang':['MODELS'],'external:mlx-lm':['MODELS'],
 'external:runtipi':['INTEGRATIONS','AUTOMATIONS'],'external:umbrelos':['INTEGRATIONS'],
 'external:openai-codex':['AGENTS','TOOLS'],
 'external:claude-code':['AGENTS','TOOLS'],
 'external:google-antigravity':['AGENTS','TOOLS'],
};
const LOCAL_PROGRAM_CHOICES:LocalCatalogEntry[]=LOCAL_PROGRAM_CHOICES_ROWS.map(
 ([ref,name,purposeRu,purposeEn,license,group,official,runtime])=>
  ({ref,name,purposeRu,purposeEn,license,group,official,runtime}));
const LOCAL_PROGRAM_GROUPS=[
 {id:'base',ru:'Основа',en:'Essentials'},
 {id:'local',ru:'Локальные расширения',en:'Local extensions'},
 {id:'optional',ru:'Другие программы',en:'Alternatives'},
 {id:'server',ru:'Домашний сервер',en:'Home server'},
 {id:'account',ru:'Облачные сервисы (необязательно)',en:'Cloud services (optional)'},
] as const;

const ADOPTABLE=['OLLAMA_LOCAL_V1','GOOSE_PRIMARY_V1','GOOGLE_ANTIGRAVITY_SPECIALIST_V1'];
const UPDATABLE=['OLLAMA_LOCAL_V1','GOOSE_PRIMARY_V1','CODEX_CHATGPT_CLI_V1','OBSIDIAN_V1','GOOGLE_ANTIGRAVITY_SPECIALIST_V1'];

export function ProgramsCenter({onNavigate,focusProgram='',onOpenGooseReview,onOpenTask,onOpenMcpConnections,onOpenMcpTools,nativeHostRef,nativeU03,nativeU04,nativeU04Surface,onActivateNative}:{
 onNavigate:(page:string)=>void;focusProgram?:string;onOpenGooseReview?:(hostedRunId:string)=>void;
 onOpenTask?:(taskId:string)=>void;onOpenMcpConnections:()=>void;onOpenMcpTools:()=>void;
 nativeHostRef?:string;nativeU03?:U03Observation;nativeU04?:U04Observation;
 nativeU04Surface?:U04SurfaceObservation;
 onActivateNative?:(binding:VerifiedWindow)=>Promise<U04Observation>;
}){
  const {tr,t3Enabled}=useUiSettings();
  const [software,setSoftware]=useState<Library>({}),[lifecycle,setLifecycle]=useState<Library>({}),[authority,setAuthority]=useState<Library>({}),[catalog,setCatalog]=useState<Library>({}),[catalogFilter,setCatalogFilter]=useState('');
  const loadSequence=useRef(0);
   const [portfolioGroup,setPortfolioGroup]=useState('base');
  const [error,setError]=useState(''),[check,setCheck]=useState<Row|null>(null),[choice,setChoice]=useState('OLLAMA_LOCAL_V1');
  const [programHealth,setProgramHealth]=useState<Record<string,boolean>>({});
  const [programBlocked,setProgramBlocked]=useState<Record<string,boolean>>({});
  const [agentRuntimeRows,setAgentRuntimeRows]=useState<Row[]>([]);
  const [basicExecutor,setBasicExecutor]=useState<Row|null>(null);
  const [basicModules,setBasicModules]=useState<Row[]>([]);
  const [programCategories,setProgramCategories]=useState<Record<string,string[]>>({});
  const [capabilityFilter,setCapabilityFilter]=useState('ALL');
  const matchesCategory=(ids:string[])=>capabilityFilter==='ALL'||ids.includes(capabilityFilter);
  const categoryName=(id:string)=>{const row=basicModules.find(m=>str(m.category_id)===id);const value=tr(str(row?.display_ru),str(row?.display_en));return value.replace(/^IWXA Basic\s*-\s*/,'')||id;};
  const [ollamaReadiness,setOllamaReadiness]=useState<UserReadiness|null>(null);
  const [gooseHealth,setGooseHealth]=useState<Row|null>(null),[obsidianHealth,setObsidianHealth]=useState<Row|null>(null);
  const [joplinHealth,setJoplinHealth]=useState<Row|null>(null);
  const [mcpState,setMcpState]=useState<Row|null>(null),[vaultPickerBusy,setVaultPickerBusy]=useState(false);
  const [connectingGoose,setConnectingGoose]=useState(false);
   const [joplinToken,setJoplinToken]=useState(''),[joplinPort,setJoplinPort]=useState('41184'),[connectingJoplin,setConnectingJoplin]=useState(false);
  const [checkingJoplin,setCheckingJoplin]=useState(false);
  const [n8nHealth,setN8nHealth]=useState<Row|null>(null),[n8nBusy,setN8nBusy]=useState(false);
  const [n8nProposalOpen,setN8nProposalOpen]=useState(false);
  const [openProgram,setOpenProgram]=useState(focusProgram),[manualVault,setManualVault]=useState('');
   const programDialogRef=useRef<HTMLDivElement|null>(null);
  useEffect(()=>{
    if(!focusProgram)return;
    setOpenProgram(focusProgram);setChoice(focusProgram);setCheck(null);
    setGooseHealth(null);setObsidianHealth(null);setInstallPlan(null);
  },[focusProgram]);
  const [instance,setInstance]=useState(''),[readiness,setReadiness]=useState<Row|null>(null);
  const [connectionKey,setConnectionKey]=useState(''),[prepared,setPrepared]=useState<Row|null>(null);
  const [selectedOperation,setSelectedOperation]=useState('software_lifecycle_stage_readiness');
  const [installPlan,setInstallPlan]=useState<Row|null>(null),[consent,setConsent]=useState(false);
  const [installDirectory,setInstallDirectory]=useState(''),[folderBusy,setFolderBusy]=useState(false);
  const [obscuraOrigins,setObscuraOrigins]=useState(''),[obscuraConnecting,setObscuraConnecting]=useState(false);
   const [toRevision,setToRevision]=useState(''),[preview,setPreview]=useState<Row|null>(null);
  const nativeController=useRef<Awaited<ReturnType<typeof loadNativeU04Controller>>|null>(null);
  const nativeControllerHost=useRef(''),nativeLease=useRef(0);
  const [nativeView,setNativeView]=useState<U04Observation|undefined>();
  const [nativeChecking,setNativeChecking]=useState(false);
  useEffect(()=>{
    nativeLease.current++;
    setNativeView(undefined);setNativeChecking(false);
    return()=>{
      nativeLease.current++;
      const previous=nativeController.current;
      nativeController.current=null;nativeControllerHost.current='';
      if(previous)void previous.detach();
    };
  },[nativeHostRef]);
  async function inspectNativeWindow():Promise<void>{
    if(!nativeHostRef||!isTauri())return;
    const lease=nativeLease.current;
    setNativeView(undefined);setNativeChecking(true);
    try{
      let controller=nativeController.current;
      if(!controller||nativeControllerHost.current!==nativeHostRef){
        controller=await loadNativeU04Controller(nativeHostRef,(command,params)=>invoke(command,params));
        if(lease!==nativeLease.current){void controller.detach();return;}
        nativeController.current=controller;nativeControllerHost.current=nativeHostRef;
      }
      const receipt=await controller.inspect();
      if(lease===nativeLease.current)setNativeView(receipt);
    }catch{
      if(lease===nativeLease.current)setNativeView({
        schema:'IWXA_PRESENTATION_BRIDGE/1.0.0',status:'WINDOW_OBSERVATION_FAILED'});
    }finally{if(lease===nativeLease.current)setNativeChecking(false);}
  }
  async function activateNativeWindow(binding:VerifiedWindow):Promise<U04Observation>{
    const controller=nativeController.current;
    if(controller&&nativeControllerHost.current===nativeHostRef){
      const lease=nativeLease.current;
      const receipt=await controller.activate(binding);
      if(lease===nativeLease.current)setNativeView(receipt);
      return receipt;
    }
    if(onActivateNative)return onActivateNative(binding);
    return {schema:'IWXA_PRESENTATION_BRIDGE/1.0.0',status:'BINDING_NOT_FOUND',focused:false};
  }
  const load=useCallback(async(strict=false)=>{
    const seq=++loadSequence.current;
    const entries=await Promise.allSettled([
      runtime.query<Row>('existing_software'),runtime.query<Row>('software_lifecycle'),
      runtime.query<Row>('explorer_installed_update_readiness'),runtime.query<Row>('component_catalog'),
      runtime.query<Row>('agent_roles'),runtime.query<Row>('local_ai_setup'),
      runtime.query<Row>('knowledge_workspaces'),runtime.query<Row>('mcp_user_tools')]);
    // A slow result from an earlier refresh must not replace a later
    // connection or installation decision.
    if(seq!==loadSequence.current)return;
    setSoftware(entries[0].status==='fulfilled'?entries[0].value:{});
    setLifecycle(entries[1].status==='fulfilled'?entries[1].value:{});
    setAuthority(entries[2].status==='fulfilled'?entries[2].value:{});
    setCatalog(entries[3].status==='fulfilled'?entries[3].value:{});
    // A discovered executable alone does not mean a working program.
    // All readiness evidence comes from current Core read-only projections.
    const health:Record<string,boolean>={};
    const agents=entries[4].status==='fulfilled'?records(entries[4].value.runtimes):[];
    setAgentRuntimeRows(agents);
    setBasicExecutor(entries[4].status==='fulfilled'?records(entries[4].value.builtin_executors).find(row=>row.runtime_id==='IWXA_BASIC_WORKER_V1')||null:null);
    setBasicModules(entries[4].status==='fulfilled'?records(record(entries[4].value.builtin_modules).modules):[]);
    setProgramCategories(Object.fromEntries((entries[4].status==='fulfilled'?records(record(entries[4].value.builtin_modules).external_category_hints):[])
      .map(item=>[str(item.runtime_id),records(item.category_ids).map(x=>str(x)).filter(Boolean)])));
    const blocked:Record<string,boolean>={};
    for(const row of agents){
      const id=str(row.runtime_id);
      blocked[id]=row.route_admissible===false;
      // CLI readiness alone does not prove a completed assistant task.
      health[id]=id==='GOOSE_PRIMARY_V1'&&row.route_admissible===true
        &&record(row.health).ready===true
        &&row.execution_verified_for_current_identity===true;
    }
    setProgramBlocked(blocked);
    const ollama=entries[5].status==='fulfilled'?record(entries[5].value):{};
    // One Core projection is shared by Programs, Models and Home.
    const readiness=record(ollama.user_readiness) as UserReadiness;
    setOllamaReadiness(readiness);
    health.OLLAMA_LOCAL_V1=readiness.response_verified===true;
    const knowledge=entries[6].status==='fulfilled'?record(entries[6].value):{};
    const connectedObsidian=records(record(knowledge.workspaces).workspaces).find(row=>
      row.provider_id==='OBSIDIAN_V1'&&row.active===true);
    setObsidianHealth(connectedObsidian||null);
    health.OBSIDIAN_V1=connectedObsidian?.status==='connected'&&record(connectedObsidian.health).ready===true;
    const connectedJoplin=records(record(knowledge.workspaces).workspaces).find(row=>row.provider_id==='JOPLIN_V1'&&row.active===true);
    setJoplinHealth(connectedJoplin||null);
    health.JOPLIN_V1=connectedJoplin?.status==='connected'&&record(connectedJoplin.health).ready===true;
    setMcpState(entries[7].status==='fulfilled'?record(entries[7].value):null);
    setProgramHealth(health);
    const failures=entries.flatMap((entry,i)=>entry.status==='rejected'
      ?[['existing_software','software_lifecycle','explorer_installed_update_readiness','component_catalog',
          'agent_roles','local_ai_setup','knowledge_workspaces','mcp_user_tools'][i]+': '+failure(entry.reason)]:[]);
    setError(failures.join(' · '));
    // Catalog metadata is optional for verified program operations.
    if(strict&&entries.slice(0,3).some(entry=>entry.status==='rejected'))
      throw Error(failures.join(' · '));
  },[]);
  useEffect(()=>{void load();return()=>{loadSequence.current++}},[load]);
  const {run,busy,message,diagnostic,setMessage}=useOwnerActions(()=>load(true));
  const obscuraInstall=records(record(software.program_install).plans).find(row=>row.program_id==='OBSCURA_WORKER_V1');
  const obscuraConnection=record(record(software.program_install).obscura_connection);
  // The original installation receipt is the only owner of HTTPS consent.
  // Refresh the editable draft only when the reviewed receipt identity changes.
  useEffect(()=>{
    if(openProgram!=='OBSCURA_WORKER_V1')return;
    const origins=Array.isArray(obscuraConnection.allowed_origins)
      ?obscuraConnection.allowed_origins.map(str):[];
    setObscuraOrigins(origins.join('\n'));
  },[openProgram,obscuraConnection.connection_digest]);
  const programs=[...records(software.runtimes),{...record(software.obsidian),runtime_id:'OBSIDIAN_V1',display_name:'Obsidian',system_installation_detected:record(software.obsidian).application_detected===true},{...record(software.joplin),runtime_id:'JOPLIN_V1',display_name:'Joplin',system_installation_detected:record(software.joplin).application_detected===true},{runtime_id:'OBSCURA_WORKER_V1',display_name:'IWXA Obscura',system_installation_detected:obscuraInstall?.already_installed===true,selected_source:'UNSELECTED',managed:{staged:false}}];
  // Core facts are projected once, without a new program registry or probe.
  // A connected notes vault is ready for reading, not an executed read.
  const workState=(p:Row):ProgramWorkState=>{
    const id=str(p.runtime_id),agent=agentRuntimeRows.find(row=>row.runtime_id===id);
    const note=id==='OBSIDIAN_V1'?obsidianHealth:id==='JOPLIN_V1'?joplinHealth:null;
    const connected=id==='OLLAMA_LOCAL_V1'?ollamaReadiness?.source_confirmed===true
      :note!==null?note.active===true&&note.status==='connected'
      :['SYSTEM_ADOPTED','IWXA_MANAGED'].includes(str(p.selected_source));
    const ready=id==='GOOSE_PRIMARY_V1'
      ?agent?.route_admissible===true&&record(agent.health).ready===true
      :id==='OLLAMA_LOCAL_V1'
      ?ollamaReadiness?.server_responding===true&&ollamaReadiness?.model_available===true
        &&ollamaReadiness?.provider_active===true
      :(id==='OBSIDIAN_V1'||id==='JOPLIN_V1')&&programHealth[id]===true;
    const detected=p.system_installation_detected===true||record(p.managed).staged===true
      ||id==='OBSIDIAN_V1'&&records(record(software.obsidian).vaults).some(v=>v.adoption_eligible===true);
    // A model probe or runtime verification is not a completed user Task.
    // Only verified Task/Result evidence could justify EXECUTED here.
    return programWorkState({detected,connected,ready,executed:false});
  };
  const stateLabel=(state:ProgramWorkState)=>state==='EXECUTED'
    ?tr('Получен проверенный ответ','Verified response received')
    :state==='READY_FOR_TASK'?tr('Доступ подтверждён','Access verified')
    :state==='CONNECTED'?tr('Подключена. Проверьте работу','Connected. Check operation')
    :state==='DETECTED'?tr('Найдена. Подключение ещё не проверено','Found. Connection not yet checked')
    :state==='EXECUTION_FAILED'?tr('Ошибка исполнения','Execution failed')
    :tr('Не обнаружена','Not detected');
  const verified=(p:Row)=>['READY_FOR_TASK','EXECUTED'].includes(workState(p));
  const categoriesFor=(id:string)=>programCategories[id]?.length?programCategories[id]:
    id==='JOPLIN_V1'||id==='OBSIDIAN_V1'?['KNOWLEDGE','MEMORY']:
    id==='OLLAMA_LOCAL_V1'?['MODELS']:
    id==='GOOSE_PRIMARY_V1'?['AGENTS','WORKFLOWS','TOOLS']:
    id==='OBSCURA_WORKER_V1'?['KNOWLEDGE','TOOLS']:[];
  const readyPrograms=programs.filter(p=>verified(p));
  const pendingPrograms=programs.filter(p=>['DETECTED','CONNECTED','EXECUTION_FAILED'].includes(workState(p)));
  const availablePrograms=programs.filter(p=>workState(p)==='NOT_DETECTED');
  const programName=(p:Row)=>str(p.display_name)||({GOOSE_PRIMARY_V1:'Goose',OLLAMA_LOCAL_V1:'Ollama',OBSIDIAN_V1:'Obsidian',OBSCURA_WORKER_V1:'IWXA Obscura'} as Record<string,string>)[str(p.runtime_id)]||tr('Программа','Program');
   const installReceipts=records(record(software.program_install).receipts);
   const installPlans=records(record(software.program_install).plans);
  const installationRunning=record(software.program_install).installation_running===true;
  // The installer runs independently in Python. While it is active, only
  // refresh its read-only projection. Never send another installation request.
  useEffect(()=>{
    if(!installationRunning)return;
    let alive=true;
    const timer=window.setInterval(()=>{
      void runtime.query<Row>('existing_software')
        .then(value=>{if(alive)setSoftware(record(value));})
        .catch(error=>{if(alive)setError(failure(error));});
    },3000);
    return()=>{alive=false;window.clearInterval(timer);};
  },[installationRunning]);
  const installState=(state:string,operation:string='INSTALL')=>{
    if(state==='UPGRADE_RECHECKED_COMPATIBLE')return tr('Совместимая Ollama подтверждена. Теперь подключите её.','Compatible Ollama confirmed. Connect it next.');
    if(state==='UPGRADE_RECHECKED_INCOMPATIBLE')return tr('После обновления Ollama остаётся несовместимой.','Ollama remains incompatible after rechecking.');
    if(state==='UPGRADE_RECHECK_REQUIRED')return tr('Команда обновления завершена. Проверьте версию.','Upgrade command completed. Verify the installed version.');
    if(state==='UPGRADE_INTERRUPTED_OUTCOME_UNKNOWN')return tr('Прежнее обновление могло продолжиться после перезапуска. Повтор заблокирован; проверьте Ollama в Windows.','An earlier upgrade might still be running after restart. Retry is blocked; check Ollama in Windows.');
    if(state==='UPGRADE_RECHECK_INCONCLUSIVE')return tr('После обновления версию и возможности Ollama проверить не удалось. Повтор заблокирован.','Ollama version and capabilities could not be verified after upgrading. Retry is blocked.');
    if(state==='INSTALL_INTERRUPTED_OUTCOME_UNKNOWN')return tr('Исход установки неизвестен после перезапуска. Повтор заблокирован.','Installation outcome is unknown after restart. Retry is blocked.');
    if(state==='INSTALL_RECHECK_INCONCLUSIVE')return tr('Найден файл программы, но его принадлежность проверенной установке не подтверждена. IWXA не будет его заменять. Проверьте файл и подключение вручную.','A program file was found, but its identity does not match the verified install. IWXA will not overwrite it. Inspect the file and connect it manually.');
    if(state.startsWith('UPGRADE_'))return tr('Исход обновления неизвестен. Проверьте версию перед повтором.','Upgrade outcome unknown. Verify the version before retrying.');
    if(state==='STARTED')return installationRunning
      ?operation==='UPGRADE'?tr('Обновление продолжается.','Upgrade is running.'):tr('Установка продолжается.','Installation is running.')
      :tr('После перезапуска результат действия неизвестен. Сначала проверьте программу.','The outcome is unknown after restart. Check the program first.');
    if(state==='INSTALLED_DETECTED'||state==='RECHECKED_INSTALLED')return tr('Программа обнаружена. Осталось проверить совместимость.','Program detected. Compatibility still needs checking.');
    if(state==='RECHECK_REQUIRED')return tr('Установщик завершился. Проверьте, появилась ли программа.','Installer finished. Check whether the program is available.');
    if(state==='RECHECKED_NOT_DETECTED')return tr('Программа не найдена. Можно заново выбрать установку и подтвердить её.','The program was not found. You can select and authorize a new installation.');
    if(state==='INSTALLER_FAILED_RECHECK_REQUIRED')return tr('Установщик сообщил об ошибке. Проверьте наличие программы.','The installer reported an error. Check whether the program is installed.');
    if(state==='LAUNCH_FAILED_RECHECK_REQUIRED')return tr('Не удалось запустить установщик. Проверьте его доступность.','The installer could not start. Check its availability.');
    if(state==='TIMEOUT_OUTCOME_UNKNOWN')return tr('Установщик перестал отвечать. Проверьте результат перед новой попыткой.','Installer timed out. Check the outcome before trying again.');
    return tr('Результат установки не подтверждён. Проверьте состояние.','Installation outcome is unconfirmed. Recheck before proceeding.');
  };
  const installBlocker=(reason:string)=>{
    if(reason==='update_requires_older_verified_version')return tr('Обновление доступно только после проверки несовместимой старой версии.','Upgrade requires a verified older incompatible version.');
    if(reason==='program_not_installed')return tr('Программа не обнаружена. Используйте установку.','Program not found. Use installation.');
    if(reason==='already_installed')return tr('Программа уже найдена. Можно проверить и подключить её.','The program is present. Check it before connecting.');
    if(reason==='previous_install_outcome_unknown')return tr('Предыдущая установка не подтверждена. Сначала проверьте её результат.','Previous installation is unconfirmed. Recheck its outcome first.');
    if(reason==='install_in_progress'||reason==='another_install_in_progress')return tr('Установка продолжается. Состояние обновляется автоматически.','An installation is running. The status refreshes automatically.');
    if(reason==='goose_windows_x64_profile_required')return tr('Для установки Goose требуется Windows x64 и доступная личная папка.','Goose installation needs Windows x64 and a usable user profile.');
    if(reason==='goose_existing_file_conflict')return tr('На компьютере уже есть файлы Goose. Автоматическая перезапись запрещена.','Goose files already exist. Automatic replacement is forbidden.');
    if(reason==='goose_release_network_unavailable')return tr('Не удалось загрузить Goose. Проверьте доступ к GitHub из Windows и повторите только после проверки результата установки.','Goose could not be downloaded. Check GitHub access from Windows and verify the previous installation outcome before retrying.');
    if(reason==='goose_release_archive_unreadable')return tr('Загруженный архив Goose не открывается. Программа не установлена.','The downloaded Goose archive could not be opened. The program was not installed.');
    if(reason==='goose_release_sha256_mismatch')return tr('Проверка подлинности архива Goose не пройдена. Установка остановлена.','Goose archive integrity verification failed. Installation was stopped.');
    if(reason==='goose_install_write_denied')return tr('Windows запретила запись в папку установки Goose. Проверьте доступ к личной папке.','Windows denied writing to the Goose installation folder. Check access to your user directory.');
    if(reason==='goose_release_install_io_error')return tr('Не удалось сохранить или распаковать Goose. Проверьте свободное место и доступ к папке.','Goose could not be saved or unpacked. Check free disk space and folder access.');
    if(reason==='goose_release_install_failed')return tr('Установка Goose завершилась с ошибкой. Проверьте результат и подробности, прежде чем повторять.','Goose installation failed. Recheck the outcome and details before retrying.');
    if(reason==='goose_release_redirect_forbidden'||reason==='goose_release_origin_untrusted')return tr('Источник загрузки Goose не прошёл проверку. Установка остановлена.','The Goose download source was not trusted. Installation was stopped.');
    if(reason.startsWith('goose_'))return tr('Goose установить не удалось. Откройте сведения об установке для уточнения причины.','Goose could not be installed. Open the installation details for the cause.');
    if(reason==='obscura_native_bundle_not_in_this_package')return tr('В этом пакете Agent отсутствует нативный модуль Obscura. Установите сборку Agent с U01.','This Agent package lacks native Obscura. Install the Agent build with U01.');
    if(reason==='obscura_software_folder_unavailable')return tr('Не выбрана доступная папка программ в IWXA Setup Core.','No usable software folder is configured in IWXA Setup Core.');
    if(reason==='windows_x64_required')return tr('Для этого выпуска Obscura необходим Windows x64.','This Obscura release requires Windows x64.');
    if(reason==='winget_unavailable')return tr('Установка из приложения недоступна: WinGet не найден. Используйте официальный установщик.','WinGet is unavailable. Use the official installer.');
    if(reason==='local_only_network_forbidden')return tr('Сетевая установка отключена в локальном режиме.','Network installation is disabled in local-only mode.');
    if(reason==='windows_required')return tr('Автоматическая установка доступна только в Windows.','Automatic installation requires Windows.');
    return tr('Установка пока недоступна. Обновите сведения.','Installation is unavailable. Refresh the status.');
  };
  async function prepareInstall(id:string,operation:'INSTALL'|'UPGRADE'='INSTALL'){
    setInstallPlan(null);setConsent(false);
    try{setInstallPlan(record(await runtime.query<Row>('program_install_plan',{program_id:id,operation,...(id==='GOOSE_PRIMARY_V1'&&installDirectory?{install_directory:installDirectory}:{})})));setError('');}
    catch(e){setError(failure(e));}
  }
  async function chooseInstallFolder(){
    if(folderBusy||busy)return;
    setFolderBusy(true);setError('');
    try{
     const chosen=record(await runtime.command<Row>('program_install_folder_choose',{}));
     if(chosen.selected===true&&str(chosen.path)){
      const folder=str(chosen.path);
      setInstallDirectory(folder);setConsent(false);
      setInstallPlan(record(await runtime.query<Row>('program_install_plan',{program_id:'GOOSE_PRIMARY_V1',operation:'INSTALL',install_directory:folder})));
     }
    }catch(e){setError(failure(e));}finally{setFolderBusy(false);}
  }
  async function install(){
    if(!installPlan||installPlan.ready!==true||!consent)return;
    if(installPlan.network_download_required!==false&&!networkActionAvailable(t3Enabled)){
      setError(tr('Для сетевой загрузки выключите локальную работу.','Turn off local mode for network downloading.'));
      return;
    }
    const id=str(installPlan.program_id);
    const upgrading=str(installPlan.operation)==='UPGRADE';
    const goose=id==='GOOSE_PRIMARY_V1',obscura=id==='OBSCURA_WORKER_V1';
    const out=await run<Row>(goose
       ?tr('Загрузить проверенный выпуск Goose в личную папку без перезаписи существующих файлов?','Download the verified official Goose CLI into your user folder without overwriting files?')
       :obscura?tr('Установить встроенный headless Obscura из Agent через U01? Права на сайты задаются отдельно.','Install bundled headless Obscura from Agent through U01? Website permissions are separate.')
       :(upgrading?tr('Разрешить обновление ','Allow upgrade of '):tr('Разрешить установку ','Allow installation of '))+str(installPlan.package_id)+tr(' через WinGet с принятием условий?',' through WinGet and accept vendor terms?'),
      'program_install_apply',{program_id:id,operation:str(installPlan.operation)||'INSTALL',plan_digest:installPlan.plan_digest,confirmed:true,accept_terms:true,...(goose&&installDirectory?{install_directory:installDirectory}:{})},{kind:'program',id});
    if(out){setInstallPlan(null);setConsent(false);setMessage(upgrading?tr('Обновление запрошено. После завершения проверьте совместимость Ollama.','Upgrade requested. Recheck Ollama compatibility afterward.'):tr('Установка запущена. Проверьте её результат.','Installation started. Verify its outcome.'));}
  }
  async function readJoplinConnection():Promise<boolean>{
    // Reuse the Core-owned knowledge workspace, its active provider and the
    // live Web Clipper health check. This call never reads note content.
    const response=record(await runtime.query<Row>('knowledge_workspaces',{include_file_count:false}));
    const projection=record(response.workspaces);
    if(projection.slot_id!=='human_knowledge_workspace'||!Array.isArray(projection.workspaces))
      throw Error('joplin_connection_readback_invalid');
    const connected=records(projection.workspaces).find(row=>
      row.provider_id==='JOPLIN_V1'&&row.active===true);
    return connected?.status==='connected'&&record(connected?.health).ready===true;
  }
  async function inspectJoplin(){
    if(busy||connectingJoplin||checkingJoplin)return;
    const seq=++loadSequence.current;
    setCheckingJoplin(true);setError('');
    try{
      const connected=await readJoplinConnection();
      if(seq!==loadSequence.current)return;
      setProgramHealth(prev=>({...prev,JOPLIN_V1:connected}));
      if(connected)setMessage(tr('Доступ к заметкам Joplin проверен. Откройте раздел знаний.',
        'Joplin notes access is verified. Open Knowledge to search your notes.'));
      else setError(tr('Joplin пока не отвечает. Запустите Web Clipper в Joplin и проверьте сохранённое подключение. Токен заново вводить не нужно, пока вы не меняете его.',
        'Joplin is not responding. Start Web Clipper in Joplin and recheck the saved connection. You do not need to re-enter the token unless changing it.'));
    }catch(e){
      if(seq===loadSequence.current){
        setProgramHealth(prev=>({...prev,JOPLIN_V1:false}));
        setError(tr('Не удалось проверить подключение Joplin. Попробуйте ещё раз без изменения настроек.',
          'Could not check Joplin. Retry without changing connection settings.')+' '+failure(e));
      }
    }finally{setCheckingJoplin(false);}
  }
  async function connectJoplin(){
    if(busy||connectingJoplin||checkingJoplin||!joplinToken.trim()||!/^411(8[4-9]|9[0-4])$/.test(joplinPort))return;
    setConnectingJoplin(true);setError('');
    try{
      const result=record(await runtime.command<Row>('provider_connection_configure',{
        slot_id:'human_knowledge_workspace',provider_id:'JOPLIN_V1',
        values:{access_token:joplinToken.trim(),port:joplinPort},activate:true
      },{kind:'provider',id:'JOPLIN_V1'}));
      if(result.activated!==true)throw Error('joplin_notes_connection_unverified');
      const connected=await readJoplinConnection();
      if(!connected)throw Error('joplin_notes_readback_unverified');
      setProgramHealth(prev=>({...prev,JOPLIN_V1:true}));
      setJoplinToken('');setOpenProgram('');onNavigate('Знания');
      void load();
    }catch(e){
      setError(tr('Новое подключение не подтверждено. Проверьте текущий доступ без повторного сохранения токена.',
        'The new connection was not confirmed. Check the current connection before submitting the token again.')+' '+failure(e));
    }finally{setConnectingJoplin(false);}
  }
  async function connectGoose(){
    if(busy||connectingGoose||installationRunning)return;
    setConnectingGoose(true);setError('');setCheck(null);setChoice('GOOSE_PRIMARY_V1');
    try{
      const source=record(await runtime.query<Row>('existing_software'));
      const found=records(source.runtimes).find(row=>str(row.runtime_id)==='GOOSE_PRIMARY_V1');
      if(record(found?.managed).staged===true){
        const selected=await run<Row>(
          tr('Использовать Goose, установленный IWXA? Личные файлы и инструменты останутся недоступны.','Use Goose installed by IWXA? Private files and tools remain unavailable.'),
          'use_managed_runtime',{runtime_id:'GOOSE_PRIMARY_V1',confirmed:true},
          {kind:'runtime',id:'GOOSE_PRIMARY_V1'});
        if(!selected)return;
        const state=record(await runtime.query<Row>('existing_software'));
        const chosen=records(state.runtimes).find(row=>str(row.runtime_id)==='GOOSE_PRIMARY_V1');
        if(chosen?.selected_source!=='IWXA_MANAGED'){
          setError(tr('Выбор Goose не подтверждён. Обновите сведения перед повтором.','The Goose selection is not verified. Refresh before retrying.'));
          return;
        }
        const available=await inspectGoose();
        if(available)setMessage(tr('Goose выбран. Проверьте локальную модель и выполните учебное задание.','Goose selected. Check the local model and run a sample task.'));
        // On a blocked route inspectGoose preserves a useful next step.;
        return;
      }
      if(found?.system_installation_detected!==true){
        setError(tr('Goose ещё не обнаружен. Сначала завершите установку и обновите сведения.','Goose was not detected. Complete the installation and refresh first.'));
        return;
      }
      // Compatibility probe is read-only. The exact digest binds the
      // subsequent explicit owner decision to that observed executable.
      await runtime.refreshRevision();
      const checked=record(await runtime.command<Row>('check_existing_runtime',
       {runtime_id:'GOOSE_PRIMARY_V1'},{kind:'runtime',id:'GOOSE_PRIMARY_V1'}));
      setCheck(checked);
      if(checked.compatible!==true||! /^[a-f0-9]{64}$/i.test(str(checked.compatibility_digest))){
        setError(tr('Найденный Goose пока не прошёл проверку. Откройте причину и установите поддерживаемую версию, если это необходимо.','The detected Goose did not pass compatibility checks. Review the cause and use a supported version if needed.'));
        return;
      }
      const chosen=await run<Row>(tr('Подключить проверенный Goose для разрешённых заданий? Файловые права не выдаются.','Connect the verified Goose for authorized tasks? No file permissions are granted.'),
       'adopt_existing_runtime',{runtime_id:'GOOSE_PRIMARY_V1',compatibility_digest:checked.compatibility_digest,confirmed:true},
       {kind:'runtime',id:'GOOSE_PRIMARY_V1'});
      if(!chosen)return;
      const verified=record(await runtime.query<Row>('existing_software'));
      const row=records(verified.runtimes).find(r=>str(r.runtime_id)==='GOOSE_PRIMARY_V1');
      if(row?.selected_source!=='SYSTEM_ADOPTED'){
        setError(tr('Выбор Goose отправлен, но подтверждение сохранения не получено. Обновите сведения перед повтором.','Goose was selected but the saved selection could not be verified. Refresh before retrying.'));
        return;
      }
      setCheck(null);
      const available=await inspectGoose();
      if(available)setMessage(tr('Goose выбран. Готовность модели и выполнение задания проверяются отдельно.','Goose selected. Model readiness and task execution are checked separately.'));
      // Do not overwrite the reason from inspectGoose if the route is blocked.;
    }catch(e){
      setError(tr('Подключение Goose не подтверждено. Проверьте сохранённое состояние, прежде чем повторять.','Goose connection is not verified. Recheck saved state before retrying.')+' '+failure(e));
    }finally{setConnectingGoose(false);}
  }
  async function selectedOllamaRuntime(expected:'SYSTEM_ADOPTED'|'IWXA_MANAGED'):Promise<boolean>{
    // An action acknowledgement is not a persisted runtime selection. Read
    // the existing Core selection back before navigating into Models.
    const response=record(await runtime.query<Row>('existing_software'));
    if(!Array.isArray(response.runtimes))throw Error('ollama_runtime_readback_unavailable');
    const row=records(response.runtimes).find(r=>r.runtime_id==='OLLAMA_LOCAL_V1');
    return row?.selected_source===expected&&(expected==='SYSTEM_ADOPTED'
      ?row?.system_adopted===true&&row?.system_installation_detected===true
      :record(row?.managed).staged===true);
  }
  async function connectInstalledOllama(){
    // This is still two separate owner decisions. A successful WinGet status
    // alone never authorizes using the detected binary.
    const checked=await run<Row>(tr('Проверить версию, возможности и SHA-256 установленной Ollama?','Check the installed Ollama version, capabilities and SHA-256?'),
      'check_existing_runtime',{runtime_id:'OLLAMA_LOCAL_V1'},
      {kind:'runtime',id:'OLLAMA_LOCAL_V1'});
    if(!checked)return;
    const digest=str(checked.compatibility_digest);
    if(checked.compatible!==true||!/^[0-9a-f]{64}$/i.test(digest)){
      setCheck(record(checked));setChoice('OLLAMA_LOCAL_V1');
      setError(checked.reason==='version_older_than_qualified_baseline'
        ?tr('Найденная Ollama старее поддерживаемой версии. Обновите её официальным установщиком или подключите уже работающий локальный сервер в разделе «Модели».','The discovered Ollama is older than the supported version. Update it using the official installer, or connect a running local server in Models.')
        :tr('Не удалось подтвердить совместимость Ollama. Откройте технические сведения проверки перед подключением.','Ollama compatibility could not be verified. Inspect the check details before connecting.'));
      return;
    }
    const adopted=await run<Row>(tr('Использовать проверенную системную Ollama без переустановки?','Use the verified system Ollama without reinstalling it?'),
      'adopt_existing_runtime',{runtime_id:'OLLAMA_LOCAL_V1',compatibility_digest:digest,confirmed:true},
      {kind:'runtime',id:'OLLAMA_LOCAL_V1'});
    if(!adopted)return;
    try{
      if(!await selectedOllamaRuntime('SYSTEM_ADOPTED')){
        setError(tr('Выбор Ollama не подтвердился. Обновите сведения о программе перед повтором.',
          'Ollama selection was not confirmed. Refresh program status before retrying.'));
        return;
      }
      setChoice('OLLAMA_LOCAL_V1');setCheck(null);onNavigate('Модели');
    }catch(e){
      setError(tr('Не удалось подтвердить сохранённый выбор Ollama. ','Could not verify saved Ollama selection. ')+failure(e));
    }
  }
  async function connectManagedOllama(){
    const selected=await run<Row>(tr('Использовать подготовленную Ollama из IWXA?','Use the Ollama runtime prepared by IWXA?'),
      'use_managed_runtime',{runtime_id:'OLLAMA_LOCAL_V1',confirmed:true},
      {kind:'runtime',id:'OLLAMA_LOCAL_V1'});
    if(!selected)return;
    try{
      if(!await selectedOllamaRuntime('IWXA_MANAGED')){
        setError(tr('Версия Ollama от IWXA не подтверждена. Проверьте состояние установки.',
          'IWXA-managed Ollama selection was not confirmed. Check the installation.'));
        return;
      }
      onNavigate('Модели');
    }catch(e){
      setError(tr('Не удалось подтвердить сохранённый выбор Ollama. ','Could not verify saved Ollama selection. ')+failure(e));
    }
  }
  async function recheckInstall(id:string){
    await run<Row>(tr('Проверить прежнюю установку без повторного запуска?','Check the previous installation without starting it again?'),'program_install_recheck',
      {program_id:id},{kind:'program',id});
  }
  async function connectObscura(){
    if(busy||obscuraConnecting||str(selectedReceipt?.program_id)!=='OBSCURA_WORKER_V1'
       ||selectedReceipt?.installed_after!==true)return;
    const origins=obscuraOrigins.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    if(origins.length<1||origins.length>8){
      setError(tr('Укажите от одного до восьми точных HTTPS-источников, по одному на строку.','Enter one to eight exact HTTPS origins, one per line.'));
      return;
    }
    setObscuraConnecting(true);setError('');
    try{
      const saved=await run<Row>(tr('Разрешить Obscura читать указанные HTTPS-сайты после перезапуска Agent? Установка не запускается.','Allow Obscura to read the selected HTTPS sites after restarting Agent? No installation is started.'),
        'program_obscura_connect',{
          program_id:'OBSCURA_WORKER_V1',receipt_id:str(selectedReceipt?.receipt_id),
          allowed_origins:origins,confirmed:true,
        },{kind:'program',id:'OBSCURA_WORKER_V1'});
      if(saved?.saved===true&&saved?.core_restart_required===true){
        setMessage(tr('Выбор сохранён. Перезапустите Agent, затем проверьте выбор Obscura в «Подключениях». Для чтения внешних сайтов выключите T3.','Choice saved. Restart Agent, then verify Obscura in Connections. Turn off T3 to read external sites.'));
        void load();
      }
    }catch(e){setError(failure(e));}
    finally{setObscuraConnecting(false);}
  }
  async function manageObscura(operation:'REPLACE'|'REVOKE'){
    if(busy||obscuraConnecting||!['APPROVED','REVOKED'].includes(str(obscuraConnection.state)))return;
    const origins=operation==='REVOKE'?[]
      :obscuraOrigins.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
    if(operation==='REPLACE'&&(origins.length<1||origins.length>8)){
      setError(tr('Укажите от одного до восьми HTTPS-сайтов.','Enter one to eight HTTPS origins.'));
      return;
    }
    setObscuraConnecting(true);setError('');
    try{
      const prompt=operation==='REVOKE'
        ?tr('Отозвать доступ Obscura ко всем HTTPS-сайтам? Новые чтения будут заблокированы сразу. Установка и сохранённые задачи останутся.','Revoke Obscura access to every HTTPS site? New reads will be blocked immediately. Installation and saved tasks remain.')
        :tr('Заменить разрешённые HTTPS-сайты? Новые права требуют проверки установленной Obscura.','Replace the allowed HTTPS sites? New permissions require verification of the installed Obscura.');
      const saved=await run<Row>(prompt,'program_obscura_manage',{
        program_id:'OBSCURA_WORKER_V1',
        receipt_id:str(obscuraConnection.receipt_id),
        expected_connection_digest:str(obscuraConnection.connection_digest),
        operation,allowed_origins:origins,confirmed:true,
      },{kind:'program',id:'OBSCURA_WORKER_V1'});
      if(saved?.saved===true){
        setMessage(operation==='REVOKE'
          ?tr('Доступ отозван. Новые HTTPS-чтения заблокированы. Сохранённые задачи доступны.','Access revoked. New HTTPS reads are blocked. Saved tasks remain available.')
          :saved.core_restart_required===true
          ?tr('Новый список сохранён. Перезапустите Agent для применения.','The new list is saved. Restart Agent to apply it.')
          :tr('Разрешённые сайты обновлены. Новые чтения используют этот список.','Allowed websites updated. New reads use this list.'));
        void load();
      }
    }catch(e){setError(failure(e));}
    finally{setObscuraConnecting(false);}
  }
  function vendor(value:unknown){
    try{const u=new URL(str(value));return u.protocol==='https:'&&['ollama.com','obsidian.md','joplinapp.org','developers.openai.com','block.github.io'].includes(u.hostname)?u.href:'';}catch{return '';}
  }
  const rows=records(software.runtimes);
  const catalogSlots=records(catalog.slots),catalogComponents=records(catalog.components);
  const relevant=catalogComponents.filter(x=>!catalogFilter||(Array.isArray(x.slot_ids)&&x.slot_ids.includes(catalogFilter)));
  const selected=rows.find(r=>r.runtime_id===choice);
  const activeProgram=programs.find(p=>str(p.runtime_id)===openProgram);
  const programDialogAvailable=!!activeProgram;
  // Enter the real dialog on open and return to the triggering program card
  // after close. No program is started by entering or leaving this surface.
  useEffect(()=>{
    if(!openProgram||!programDialogAvailable)return;
    const origin=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const dialog=programDialogRef.current;
    if(!dialog)return;
    dialog.querySelector<HTMLButtonElement>('.program-modal-header button')?.focus();
    return()=>{if(origin?.isConnected)origin.focus();};
  },[openProgram,programDialogAvailable]);
  const onProgramDialogKeyDown=(event:React.KeyboardEvent<HTMLDivElement>)=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();setOpenProgram('');return;}
    if(event.key!=='Tab')return;
    const dialog=event.currentTarget;
    const focusable=Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]),a[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])'
    )).filter(item=>item.getClientRects().length>0);
    if(!focusable.length){event.preventDefault();dialog.focus();return;}
    const first=focusable[0],last=focusable[focusable.length-1];
    const active=document.activeElement;
    if(event.shiftKey&&(active===first||!dialog.contains(active))){
      event.preventDefault();last.focus();
    }else if(!event.shiftKey&&(active===last||!dialog.contains(active))){
      event.preventDefault();first.focus();
    }
  };

  const selectedReceipt=installReceipts.filter(p=>str(p.program_id)===openProgram).slice(-1)[0];
  const activePlan=installPlans.find(p=>str(p.program_id)===openProgram);
  const obsidian=record(software.obsidian);
  const vaults=records(obsidian.vaults);
  const mcpConnected=mcpState?.provider_active===true&&record(mcpState.provider_health).ready===true;
  const mcpToolCount=records(mcpState?.tools).length;
  const lifecycleGuard=record(authority);
  const instances=records(lifecycle.managed_instance_inventory);
  const connection=records(readiness?.candidate_connections).find(x=>JSON.stringify([str(x.integration_id),str(x.connection_ref)])===connectionKey);
  async function compatibility(){
    const target=openProgram||choice;
    if(!ADOPTABLE.includes(target))return;
    const program=programs.find(p=>str(p.runtime_id)===target);
    if(program?.system_installation_detected!==true)return;
    setChoice(target);setCheck(null);setGooseHealth(null);
    const out=await run<Row>(tr('Проверить совместимость программы ','Check compatibility of ')+(str(program.display_name)||target)+'?',
      'check_existing_runtime',{runtime_id:target},{kind:'runtime',id:target});
    setCheck(out&&str(out.runtime_id)===target?record(out):null);
    if(out&&str(out.runtime_id)!==target)setError(tr('Результат проверки относится к другой программе. Обновите сведения.','The check returned a different program. Refresh before connecting.'));
  }
  async function inspectN8n(){
     if(n8nBusy)return;
     setN8nBusy(true);setN8nHealth(null);
     try{setN8nHealth(record(await runtime.query<Row>('n8n_local_status')));}
     catch(e){setError(failure(e));}
     finally{setN8nBusy(false);}
   }
   async function inspectGoose():Promise<boolean>{
    // The latest owner-initiated check takes precedence over an earlier
    // Programs refresh. The Agent runtime remains the sole authority.
    const seq=++loadSequence.current;
    setGooseHealth(null);
    try{
      const result=record(await runtime.query<Row>('agent_roles'));
      if(seq!==loadSequence.current)return false;
      if(!Array.isArray(result.runtimes))throw Error('agent_roles_runtime_list_invalid');
      const candidate=records(result.runtimes).find(p=>str(p.runtime_id)==='GOOSE_PRIMARY_V1');
      setGooseHealth(candidate||{health:{ready:false}});
      const allowed=candidate?.route_admissible===true&&record(candidate?.health).ready===true;
      const proved=allowed&&candidate?.execution_verified_for_current_identity===true;
      setProgramHealth(prev=>({...prev,GOOSE_PRIMARY_V1:proved}));
      setProgramBlocked(prev=>({...prev,GOOSE_PRIMARY_V1:candidate?.route_admissible===false}));
      if(!candidate){
        setError(tr('Goose пока не готов. Проверьте программу и локальную модель.','Goose is not ready. Check the program and local model.'));
        return false;
      }
      if(!allowed){
        setError(tr('Goose обнаружен, но выполнение сейчас недоступно. Проверьте локальную модель и разрешения.',
          'Goose is detected, but execution is unavailable. Check the local model and permissions.'));
        return false;
      }
      setError('');
      return true;
    }catch(e){
      if(seq===loadSequence.current){
        setProgramHealth(prev=>({...prev,GOOSE_PRIMARY_V1:false}));
        setError(failure(e));
      }
      return false;
    }
  }
  async function inspectObsidian():Promise<boolean>{
    const seq=++loadSequence.current;
    setObsidianHealth(null);
    try{
      const response=record(await runtime.query<Row>('knowledge_workspaces',{include_file_count:true}));
      if(seq!==loadSequence.current)return false;
      const projection=record(response.workspaces);
      if(projection.slot_id!=='human_knowledge_workspace'||!Array.isArray(projection.workspaces))
        throw Error('knowledge_workspaces_response_invalid');
      const active=records(projection.workspaces).find(row=>row.provider_id==='OBSIDIAN_V1'&&row.active===true);
      setObsidianHealth(active||{status:'disconnected',health:{ready:false}});
      const ready=active?.status==='connected'&&record(active.health).ready===true;
      setProgramHealth(prev=>({...prev,OBSIDIAN_V1:ready}));
      if(ready){setError('');return true;}
      setError(tr('Доступ к Obsidian пока не подтверждён. Проверьте папку и подключение, прежде чем повторять действие.','Obsidian access is not verified. Check the vault and connection before trying again.'));
      return false;
    }catch(e){
      if(seq===loadSequence.current){
        setProgramHealth(prev=>({...prev,OBSIDIAN_V1:false}));
        setError(failure(e));
      }
      return false;
    }
  }
  async function chooseObsidianVault(){
    if(busy||vaultPickerBusy)return;
    setVaultPickerBusy(true);setError('');
    try{
      await runtime.refreshRevision();
      const result=record(await runtime.command<Row>('obsidian_vault_choose',
        {provider_id:'OBSIDIAN_V1'},{kind:'provider',id:'OBSIDIAN_V1'}));
      if(result.cancelled===true)return;
      if(result.selected!==true||result.vault_marker_present!==true
          ||result.access_granted!==false||!str(result.path)){
        throw Error('obsidian_vault_selection_unconfirmed');
      }
      setManualVault(str(result.path));
      setMessage(tr('Хранилище выбрано. Проверьте его и подтвердите подключение.',
        'Vault selected. Review it and confirm the connection.'));
    }catch(error){
      setError(tr('Не удалось выбрать хранилище. Откройте существующую папку Obsidian или проверьте её путь. ',
        'The vault could not be selected. Choose an existing Obsidian folder or check the path. ')+failure(error));
    }finally{setVaultPickerBusy(false);}
  }

  async function adoptObsidian(){
    const path=manualVault.trim();
    if(!path||busy)return;
    const result=await run<Row>(tr('Подключить существующее хранилище без изменения файлов?','Connect the existing vault without changing its files?'),
      'adopt_existing_obsidian',{provider_id:'OBSIDIAN_V1',vault_path:path},{kind:'provider',id:'OBSIDIAN_V1'});
    if(!result)return;
    // Connection configuration alone does not prove that notes are readable.
    if(await inspectObsidian()){setOpenProgram('');onNavigate('Знания');}
  }
  async function inspectReadiness(){
    if(!instance.trim())return;
    setReadiness(null);setPrepared(null);setMessage('');
    try{
      const found=await runtime.query<Row>(selectedOperation,{instance_id:instance.trim()});
      setReadiness(record(found));setConnectionKey('');
    }catch(e){setMessage('Не удалось получить готовность: '+failure(e));}
  }
  async function prepareLifecycle(){
    if(!instance||!readiness)return;
    const commands:Record<string,string>={
      software_lifecycle_stage_readiness:'software_lifecycle_stage',
      software_lifecycle_configure_readiness:'software_lifecycle_configure_prepare',
      software_lifecycle_connect_readiness:'software_lifecycle_connect_prepare',
      software_lifecycle_rollback_readiness:'software_lifecycle_rollback_preview'
    };
    const command=commands[selectedOperation];if(!command)return;
    const input:Row={instance_id:instance};
    if(command==='software_lifecycle_connect_prepare'){
      if(!connection)return;
      input.integration_id=connection.integration_id;input.connection_ref=connection.connection_ref;
    }
    const result=await run<Row>('Подготовить '+command+' для '+instance+'? Без разрешения применения.',command,input,{kind:'software_instance',id:instance});
    if(result){setPrepared(record(result));setReadiness(null);}
  }
  async function previewLifecycle(){
    if(!instance||!toRevision.trim())return;
    setPreview(null);
    const out=await run<Row>('Подготовить синтетический Preview для '+instance+' к '+toRevision.trim()+'? Ни установка, ни применение не выполняются.',
     'software_lifecycle_preview',{instance_id:instance,to_revision_ref:toRevision.trim()},{kind:'software_instance',id:instance});
    if(out&&out.mode==='SYNTHETIC_NO_EFFECT'&&out.real_effects_possible===false&&out.preview_is_authorization===false)
      setPreview(record(out));
    else if(out)setMessage('Ограничения синтетического Preview не подтверждены. Результат отклонён.');
   }
   const canPrepare=!!readiness&&(
    (selectedOperation==='software_lifecycle_stage_readiness'&&readiness.status==='READY')||
    (selectedOperation==='software_lifecycle_configure_readiness'&&readiness.status==='READY_TO_PREPARE')||
    (selectedOperation==='software_lifecycle_connect_readiness'&&readiness.status==='READY_TO_PREPARE'&&!!connection)||
    (selectedOperation==='software_lifecycle_rollback_readiness'&&readiness.status==='READY_TO_PREVIEW'));
  return <section className="subpage card advanced programs-center">
    <div className="advanced-head"><div><h2>{tr('Программы','Programs')}</h2><p>{tr('Установите нужную программу или подключите уже найденную. После установки проверьте готовность к работе.','Install a program or connect an existing one. Then verify it is ready to use.')}</p></div><button className="secondary-button" onClick={()=>void load()} disabled={busy}>{tr('Обновить','Refresh')}</button></div>
    {error&&<OwnerError error={error}/>}{message&&<OwnerMessage diagnostic={diagnostic}>{message}</OwnerMessage>}
    <div className="advanced-form">
      <label className="advanced-field">{tr('Возможности программ','Program capabilities')}
       <select value={capabilityFilter} onChange={e=>setCapabilityFilter(e.target.value)}>
        <option value="ALL">{tr('Все возможности','All capabilities')}</option>
        {basicModules.map(item=><option key={str(item.category_id)} value={str(item.category_id)}>
          {categoryName(str(item.category_id))}
        </option>)}
       </select>
      </label>
      <small>{tr('Программа может выполнять несколько функций. Категория не подтверждает установку или права на действия.',
       'One program may serve several purposes. Category membership does not prove installation or permissions.')}</small>
    </div>
    <div className="advanced-form"><h3>{tr('Встроенные возможности и подключения','Built-in capabilities and connections')}</h3>
      {basicExecutor&&<div className="advanced-form">
       <h4>{tr('Встроенные инструменты IWXA Basic','Built-in IWXA Basic tools')}</h4>
       <p>{tr('Каждый инструмент использует существующие функции приложения. Для работы с моделями выберите установленную модель.',
        'Each tool reuses existing application capabilities. Select an installed model for AI work.')}</p>
       <div className="programs-overview">
        {basicModules.filter(m=>matchesCategory([str(m.category_id)])).map(m=><button type="button" className="program-tile" key={str(m.module_id)}
          onClick={()=>onNavigate(str(m.page)||'Программы')}>
          <strong>{str(tr(str(m.display_ru),str(m.display_en)))}</strong>
          <span>{tr(str(m.description_ru),str(m.description_en))}</span>
          <small>{tr('Открыть','Open')} →</small>
        </button>)}
       </div>
      </div>}
      {basicExecutor&&<div className="owner-row">
       <strong>{tr('IWXA Basic - встроенный исполнитель','IWXA Basic - built-in executor')}</strong>
       <span>{tr('Входит в IWXA, отдельная установка не нужна.','Included with IWXA; no separate installation required.')}</span>
       <small>{tr('Выполняет шаги плана через выбранную модель. Для ответов ИИ необходима работающая модель.','Runs plan steps using the chosen model. AI responses require an available model.')}</small>
       <div className="advanced-actions">
        <button type="button" onClick={()=>onNavigate('Задачи')}>{tr('Открыть задачи','Open tasks')}</button>
        <button type="button" className="secondary-button" onClick={()=>onNavigate('Модели')}>{tr('Выбрать модель','Choose model')}</button>
       </div>
      </div>}
      <div className="programs-overview">{readyPrograms.filter(p=>matchesCategory(categoriesFor(str(p.runtime_id)))).map(p=>{
        const id=str(p.runtime_id),present=p.system_installation_detected===true,managed=record(p.managed).staged===true;
        const notesConnected=id==='OBSIDIAN_V1'||id==='JOPLIN_V1';
        return <button type="button" className="program-tile" key={id} onClick={()=>{setOpenProgram(id);setChoice(id);setCheck(null);setGooseHealth(null);setObsidianHealth(null);setManualVault('');setInstallPlan(null);}}>
          <strong>{programName(p)}</strong>
          <span>{stateLabel(workState(p))}</span>
         <small>{present?tr('На этом компьютере','On this computer')
          :managed?tr('Подготовлена IWXA','Prepared by IWXA')
          :notesConnected?tr('Доступ к заметкам проверен','Note access verified')
          :tr('Соединение проверено','Connection checked')}</small>
         {programCategories[id]?.length>0&&<small>{programCategories[id].map(categoryName).join(' · ')}</small>}
         {id==='OLLAMA_LOCAL_V1'&&<small>{ollamaStageText(ollamaReadiness,tr)}</small>}
        </button>;
      })}</div>
      {!readyPrograms.length&&<p>{tr('Пока нет подтверждённых работающих подключений. Проверьте найденные программы ниже или подключите существующую.','No program connection has been verified yet. Check detected programs below or connect one already on this computer.')}</p>}
    </div>
    {pendingPrograms.length>0&&<div className="advanced-form"><h3>{tr('Найдены - завершите подключение','Detected - finish setup')}</h3><div className="programs-overview">
      {pendingPrograms.filter(p=>matchesCategory(categoriesFor(str(p.runtime_id)))).map(p=>{
       const id=str(p.runtime_id);
       return <button type="button" className="program-tile" key={id} onClick={()=>{setOpenProgram(id);setChoice(id);setCheck(null);setInstallPlan(null);}}>
        <strong>{programName(p)}</strong><span>{programBlocked[id]&&t3Enabled===true
        ?tr('Локальный режим ограничивает запуск этой программы','Local work currently restricts this program')
        :stateLabel(workState(p))}</span>
        <small>{tr('Проверить','Verify')} →</small>
       </button>;
      })}</div></div>}
     <div className="advanced-form"><h3>{tr('Установить или подключить','Install or connect')}</h3>
     <p>{tr('Найденные, но пока не готовые программы можно проверить и подключить. Для отсутствующих доступна установка.','Detected programs that are not ready can be checked and connected. Missing programs have installation options.')}</p>
     <div className="programs-overview">{availablePrograms.filter(p=>matchesCategory(categoriesFor(str(p.runtime_id)))).map(p=>{
      const id=str(p.runtime_id);
      const discoveredVault=id==='OBSIDIAN_V1'&&records(record(software.obsidian).vaults).some(v=>v.adoption_eligible===true);
      return <button type="button" className="program-tile" key={id} onClick={()=>{setOpenProgram(id);setChoice(id);setCheck(null);setInstallPlan(null);setGooseHealth(null);setObsidianHealth(null);}}>
       <strong>{programName(p)}</strong>
       <span>{p.system_installation_detected===true||record(p.managed).staged===true
        ?tr('Программа найдена, требуется настройка или проверка','Detected, requires setup or verification')
        :discoveredVault?tr('Найдено хранилище заметок - можно подключить','A note vault is available to connect')
        :tr('Не обнаружена на компьютере','Not detected on this computer')}</span>
       {programCategories[id]?.length>0&&<small>{programCategories[id].map(categoryName).join(' · ')}</small>}
        <small>{p.system_installation_detected===true||record(p.managed).staged===true
        ?tr('Подключить и проверить →','Connect and verify →')
        :discoveredVault?tr('Подключить хранилище →','Connect note vault →')
        :['OLLAMA_LOCAL_V1','OBSIDIAN_V1','GOOSE_PRIMARY_V1','JOPLIN_V1','OBSCURA_WORKER_V1'].includes(id)
         ?tr('Установить или подключить →','Install or connect →')
         :tr('Посмотреть подключение →','View connection →')}</small>
      </button>;
     })}</div>
    </div>
    {openProgram&&activeProgram&&<div className="modal-backdrop" role="presentation" onMouseDown={e=>{if(e.target===e.currentTarget)setOpenProgram('')}}><div ref={programDialogRef} className="modal program-modal" role="dialog" aria-modal="true"
     aria-labelledby="iwxa-program-dialog-title" onKeyDown={onProgramDialogKeyDown}>
      <div className="program-modal-header"><h2 id="iwxa-program-dialog-title">{str(activeProgram.display_name)||programName(activeProgram)}</h2><button type="button" onClick={()=>setOpenProgram('')} aria-label={tr('Закрыть','Close')}>×</button></div>
      <p>{verified(activeProgram)?tr('Связь с программой проверена. Выберите, что сделать дальше.','The program connection is checked. Choose what to do next.'):activeProgram.system_installation_detected===true?tr('Программа найдена. Для работы IWXA ещё может потребоваться проверка и подключение.','Program found. IWXA may still need to verify and connect it.'):record(activeProgram.managed).staged===true?tr('Компонент подготовлен IWXA. Проверьте его работу перед использованием.','IWXA prepared this component. Verify it before use.'):openProgram==='OBSIDIAN_V1'&&vaults.some(v=>v.adoption_eligible===true)?tr('Найдены ваши заметки. Их можно подключить даже если файл приложения не обнаружен.','Your notes were found. You can connect them even when the app executable is not detected.'):tr('Программа не обнаружена в известных местах. Можно проверить установку или выбрать доступный способ подключения.','The program was not found in known locations. Check installation or choose an available connection method.')}</p>
      <p role="status">{stateLabel(workState(activeProgram))}</p>
      {openProgram==='OBSIDIAN_V1'&&<NativeProgramLink
       appRef="external:obsidian" detected={activeProgram.system_installation_detected===true}
       connected={obsidianHealth?.active===true&&obsidianHealth.status==='connected'}
       dataReady={programHealth.OBSIDIAN_V1===true}
       hostRef={nativeHostRef} u03={nativeU03} u04={nativeView??nativeU04} u04Surface={nativeU04Surface}
        onInspect={nativeHostRef&&isTauri()?inspectNativeWindow:undefined} inspecting={nativeChecking}
        onActivate={nativeController.current?activateNativeWindow:onActivateNative}
       onReturnToTask={()=>{setOpenProgram('');onNavigate('Задачи')}}/>}
      {openProgram==='OLLAMA_LOCAL_V1'&&<p role="status">{ollamaStageText(ollamaReadiness,tr)}</p>}
      <div className="advanced-actions">
        {openProgram==='OLLAMA_LOCAL_V1'&&<button onClick={()=>{setOpenProgram('');onNavigate('Модели')}}>{tr('Модель и её работа','Models and readiness')}</button>}
        {openProgram==='OBSIDIAN_V1'&&<><button disabled={busy} onClick={()=>void inspectObsidian()}>{tr('Проверить доступ к заметкам','Check note access')}</button><button onClick={()=>{setOpenProgram('');onNavigate('Знания')}}>{tr('Найти заметку','Find a note')}</button></>}
        {openProgram==='JOPLIN_V1'&&<><button type="button" disabled={busy||connectingJoplin||checkingJoplin}
         onClick={()=>void inspectJoplin()}>{checkingJoplin?tr('Проверяем доступ…','Checking access…'):tr('Проверить сохранённое подключение','Check saved connection')}</button>
         {programHealth.JOPLIN_V1===true&&<button type="button" onClick={()=>{setOpenProgram('');onNavigate('Знания')}}>
          {tr('Открыть заметки','Open notes')}</button>}</>}
        {openProgram==='OBSCURA_WORKER_V1'&&<p role="status">{str(obscuraInstall?.blocker)
          ?installBlocker(str(obscuraInstall?.blocker))
          :tr('Headless Obscura включена в пакет Agent. Установите её локально через U01 после подтверждения.','Headless Obscura is included with Agent. Install locally through U01 with confirmation.')} {tr('Разрешённые сайты выбираются отдельно в «Подключениях».','Allowed websites are selected separately in Connections.')}</p>}
        {openProgram==='GOOSE_PRIMARY_V1'&&<><button disabled={busy||connectingGoose||installationRunning} onClick={()=>void connectGoose()}>{connectingGoose?tr('Проверяю подключение…','Verifying connection…'):tr('Подключить или перепроверить Goose','Connect or recheck Goose')}</button><button disabled={busy||connectingGoose} onClick={()=>void inspectGoose()}>{tr('Проверить программу','Check program')}</button></>}
        {activeProgram.system_installation_detected===true&&ADOPTABLE.includes(openProgram)&&openProgram!=='GOOSE_PRIMARY_V1'&&<button disabled={busy} onClick={()=>void compatibility()}>{tr('Проверить совместимость','Check compatibility')}</button>}
        {openProgram==='OLLAMA_LOCAL_V1'&&check&&check.compatible===false&&check.reason==='version_older_than_qualified_baseline'&&<button disabled={busy||installationRunning} onClick={()=>void prepareInstall('OLLAMA_LOCAL_V1','UPGRADE')}>{tr('Подготовить обновление Ollama','Prepare Ollama upgrade')}</button>}
        {record(activeProgram.managed).staged===true&&ADOPTABLE.includes(openProgram)&&<button disabled={busy} onClick={()=>void run(tr('Выбрать подготовленную версию программы?','Use the prepared program?'),'use_managed_runtime',{runtime_id:openProgram,confirmed:true},{kind:'runtime',id:openProgram})}>{tr('Использовать версию IWXA','Use IWXA version')}</button>}
        {activeProgram.system_installation_detected===true&&UPDATABLE.includes(openProgram)&&<button disabled={busy||!networkActionAvailable(t3Enabled)} onClick={()=>void run(tr('Проверить наличие обновления без установки?','Check for updates without installing?'),'check_program_updates',{program_id:openProgram},{kind:'program',id:openProgram})}>{tr('Проверить обновления','Check for updates')}</button>}
        {selectedReceipt&&<button disabled={busy||installationRunning} onClick={()=>void recheckInstall(openProgram)}>{str(selectedReceipt.operation)==='UPGRADE'?tr('Проверить результат обновления','Check upgrade outcome'):tr('Проверить результат установки','Check installation outcome')}</button>}
        {!verified(activeProgram)&&!activeProgram.system_installation_detected&&record(activeProgram.managed).staged!==true&&['OLLAMA_LOCAL_V1','OBSIDIAN_V1','GOOSE_PRIMARY_V1','JOPLIN_V1','OBSCURA_WORKER_V1'].includes(openProgram)&&<button disabled={busy||activePlan?.ready===false} onClick={()=>void prepareInstall(openProgram)}>{tr('Подготовить установку','Prepare installation')}</button>}
        {vendor(activeProgram.install_url)&&<a className="mini-button" href={vendor(activeProgram.install_url)} rel="noopener noreferrer" target="_blank">{tr('Сайт программы','Official website')}</a>}
      </div>
      {openProgram==='JOPLIN_V1'&&<details className="advanced-form" open={programHealth.JOPLIN_V1!==true}>
         <summary>{programHealth.JOPLIN_V1===true
          ?tr('Изменить подключение Joplin','Change Joplin connection')
          :tr('Подключить заметки Joplin','Connect Joplin notes')}</summary>
         {programHealth.JOPLIN_V1===true&&<p role="status">{tr(
          'Joplin уже подключён. Для поиска заметок повторно вводить токен не нужно.',
          'Joplin is connected. You do not need to re-enter the token to search notes.')}</p>}
         <p>{tr('В Joplin откройте Настройки - Web Clipper, включите сервис и скопируйте токен авторизации. IWXA будет читать выбранные заметки только через локальный интерфейс Joplin.','Open Joplin Settings - Web Clipper, enable the service and copy the authorization token. IWXA will read notes through the local Joplin API only.')}</p>
         <label className="advanced-field">{tr('Токен Joplin','Joplin token')}<input type="password" autoComplete="off" value={joplinToken} onChange={e=>setJoplinToken(e.target.value)} placeholder={tr('Вставьте токен','Paste token')}/></label>
         <label className="advanced-field">{tr('Порт локального Joplin (из Web Clipper)','Local Joplin port (from Web Clipper)')}<input type="number" min={41184} max={41194} step={1} value={joplinPort} onChange={e=>setJoplinPort(e.target.value)}/></label>
         <button type="button" disabled={busy||connectingJoplin||!joplinToken.trim()||!/^411(8[4-9]|9[0-4])$/.test(joplinPort)} onClick={()=>void connectJoplin()}>{connectingJoplin?tr('Проверяем доступ…','Verifying access…'):tr('Подключить заметки','Connect notes')}</button>
        </details>}
       {openProgram==='OBSIDIAN_V1'&&obsidianHealth&&<div className="advanced-form">
        <p role="status">{obsidianHealth.active===true&&obsidianHealth.status==='connected'&&record(obsidianHealth.health).ready===true
          ?tr('Активное подключение заметок отвечает. Можно перейти к поиску.','The active notes connection is responding. You can start searching.')
          :tr('Доступ к заметкам не подтверждён. Выберите существующее хранилище и подключите его.','Note access is not verified. Choose an existing vault and connect it.')}</p>
        
      </div>}
      {openProgram==='OBSCURA_WORKER_V1'&&(
          ['APPROVED','REVOKED'].includes(str(obscuraConnection.state))
          ||selectedReceipt?.installed_after===true
             &&['INSTALLED_DETECTED','RECHECKED_INSTALLED'].includes(str(selectedReceipt.status))
        )&&<div className="advanced-form">
         <p>{tr('Области доступа Obscura. Укажите точные HTTPS-адреса сайтов без пути, по одному на строку. Управление сайтами не запускает установку.','Obscura site permissions. Enter exact HTTPS origins without paths, one per line. Managing sites never installs software.')}</p>
         {str(obscuraConnection.state)==='REVOKED'
           ?<p role="status">{tr('Доступ ко всем сайтам отозван. Ранее сохранённые задачи доступны.','Access to all sites is revoked. Previously saved tasks remain available.')}</p>
           :str(obscuraConnection.state)==='APPROVED'
           ?<p role="status">{tr('Выбранные сайты разрешены. Вы можете изменить или отозвать доступ.','Selected sites are permitted. You can change or revoke access.')}</p>
           :<p role="status">{tr('Подключение ещё не разрешено.','The connection is not yet permitted.')}</p>}
         <label className="advanced-field">{tr('Разрешённые HTTPS-сайты','Allowed HTTPS sites')}
           <textarea rows={3} value={obscuraOrigins} onChange={e=>setObscuraOrigins(e.target.value)}
             placeholder="https://www.python.org"/></label>
         {['APPROVED','REVOKED'].includes(str(obscuraConnection.state))
          ?<div className="advanced-actions">
             <button type="button" disabled={busy||obscuraConnecting||!obscuraOrigins.trim()}
               onClick={()=>void manageObscura('REPLACE')}>{obscuraConnecting?tr('Проверяем выбор…','Verifying selection…'):tr('Сохранить новый список сайтов','Save revised site list')}</button>
             <button type="button" disabled={busy||obscuraConnecting||str(obscuraConnection.state)==='REVOKED'}
               onClick={()=>void manageObscura('REVOKE')}>{tr('Отозвать доступ ко всем сайтам','Revoke access to all sites')}</button>
           </div>
          :<button type="button" disabled={busy||obscuraConnecting||!obscuraOrigins.trim()}
             onClick={()=>void connectObscura()}>{obscuraConnecting?tr('Сохраняем выбор…','Saving choice…'):tr('Разрешить чтение после перезапуска','Allow reading after restart')}</button>}
       </div>}
      {openProgram==='GOOSE_PRIMARY_V1'&&<GooseControl onReview={id=>{setOpenProgram('');if(onOpenGooseReview)onOpenGooseReview(id);else onNavigate('Агенты');}} onChanged={()=>{void load().then(()=>inspectGoose());}}/>}
      {openProgram==='GOOSE_PRIMARY_V1'&&gooseHealth&&<div className="advanced-form"><p role="status">{gooseHealth.execution_verified_for_current_identity===true
      ?tr('Получен и сохранён ответ Goose с текущей моделью. Проверка всего задания выполняется отдельно.','A Goose response with the current model was saved. Full task review is separate.')
      :record(gooseHealth.health).ready===true
      ?tr('Программа и модель доступны. Для проверки работы запустите учебное задание ниже.','The program and model are available. Run a sample task below to verify them.')
      :tr('Goose пока не готов. Проверьте программу и локальную модель.','Goose is not ready. Check the program and local model.')}</p></div>}
      {check&&openProgram===choice&&str(check.runtime_id)===openProgram&&<div className="advanced-form"><p>{check.compatible===true?tr('Совместимость подтверждена. Вы можете подключить найденную программу.','Compatibility verified. You can connect this program.'):tr('Совместимость пока не подтверждена. Проверьте сведения или обновите программу.','Compatibility not verified. Check details or update the program.')}</p>
        {check.compatible===true&&openProgram!=='GOOSE_PRIMARY_V1'&&/^[a-f0-9]{64}$/i.test(str(check.compatibility_digest))&&<button disabled={busy} onClick={()=>void (async()=>{const result=await run(tr('Использовать проверенную программу?','Use the verified program?'),'adopt_existing_runtime',{runtime_id:openProgram,compatibility_digest:check.compatibility_digest,confirmed:true},{kind:'runtime',id:openProgram});if(result){setCheck(null);if(openProgram==='GOOSE_PRIMARY_V1'){setGooseHealth(null);setMessage(tr('Goose подключён. Теперь проверьте модель и назначение роли.','Goose was selected. Check its model and role assignment next.'));await inspectGoose();}else if(openProgram==='OLLAMA_LOCAL_V1'){setOpenProgram('');onNavigate('Модели');}}})()}>{tr('Подключить и продолжить','Connect and continue')}</button>}
        
      </div>}
      {openProgram==='OBSIDIAN_V1'&&<div className="advanced-form"><h3>{tr('Ваши заметки Obsidian','Your Obsidian notes')}</h3>
        <p>{tr('Выберите найденные заметки или укажите путь к папке с настройками .obsidian. Папка останется на месте. Если она ещё не настроена, сначала откройте её в Obsidian.','Choose a detected vault or its existing folder containing .obsidian settings. No notes will be moved. If the folder is not configured yet, open it in Obsidian first.')}</p>
        {vaults.map(v=><button type="button" className={'owner-row'+(str(v.path)===manualVault?' selected':'')} key={str(v.path)} disabled={v.adoption_eligible!==true||vaultPickerBusy} onClick={()=>setManualVault(str(v.path))}><strong>{str(v.name)||tr('Хранилище','Vault')}</strong><small>{v.adoption_eligible===true?(str(v.path)===manualVault?tr('Выбрано для подключения','Selected for connection'):tr('Можно подключить','Available to connect')):tr('В этой папке не найдены настройки Obsidian','Obsidian settings were not found in this folder')}</small></button>)}
        <button type="button" disabled={busy||vaultPickerBusy} onClick={()=>void chooseObsidianVault()}>{vaultPickerBusy?tr('Открываем папки…','Opening folders…'):tr('Выбрать папку в Windows…','Choose folder in Windows…')}</button>
        <label className="advanced-field">{tr('Папка с заметками','Vault folder')}<input value={manualVault} onChange={e=>setManualVault(e.target.value)} placeholder={tr('Путь к существующему хранилищу','Path to existing vault')}/></label>
        {vaults.length===0&&<p>{tr('Obsidian не сообщил о хранилищах. Можно указать папку с уже существующими заметками вручную.','No vaults were discovered. You can enter the location of an existing Obsidian vault manually.')}</p>}
        <button disabled={busy||vaultPickerBusy||!manualVault.trim()} onClick={()=>void adoptObsidian()}>{tr('Подключить и проверить заметки','Connect and verify notes')}</button>
      </div>}
      {installPlan&&str(installPlan.program_id)===openProgram&&<div className="advanced-form">{openProgram==='GOOSE_PRIMARY_V1'&&<div className="advanced-actions"><p>{tr('Папка установки:','Install folder:')} {str(installPlan.installation_directory)||tr('Не выбрана','Not selected')}</p><button type="button" disabled={busy||folderBusy} onClick={()=>void chooseInstallFolder()}>{tr('Выбрать папку','Choose folder')}</button></div>}<p>{installPlan.ready===true?(openProgram==='GOOSE_PRIMARY_V1'?tr('Goose будет загружен из официального выпуска с проверкой SHA-256. Существующие файлы не заменяются. Подключение выполняется отдельно.','Goose comes from a pinned official release checked by SHA-256. Existing files are not replaced. Connection is separate.'):openProgram==='OBSCURA_WORKER_V1'?tr('Нативная Obscura уже включена в пакет Agent. Установка выполняется локально через U01, без загрузки из сети. Сайты подключаются отдельно.','Native Obscura is already bundled with Agent. U01 installs it locally without downloading. Website permissions are separate.'):tr('Для установки потребуется сеть и согласие с условиями производителя.','Installation needs network access and agreement with vendor terms.')):installBlocker(str(installPlan.blocker))}</p>
        {installPlan.ready===true&&<><label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>{str(installPlan.operation)==='UPGRADE'?tr('Разрешить сетевое обновление Ollama. После завершения потребуется повторная проверка.','Allow the network upgrade of Ollama. Compatibility must be rechecked afterward.'):str(installPlan.program_id)==='GOOSE_PRIMARY_V1'?tr('Разрешить установку проверенного выпуска Goose','Allow installation of the verified Goose CLI'):str(installPlan.program_id)==='OBSCURA_WORKER_V1'?tr('Разрешить локальную установку неподписанной Obscura из Agent после проверки SHA-256','Allow local installation of unsigned Obscura bundled with Agent after SHA-256 verification'):tr('Разрешить загрузку и установку','Allow download and installation')}</label><button disabled={busy||!consent||(installPlan.network_download_required!==false&&!networkActionAvailable(t3Enabled))} onClick={()=>void install()}>{str(installPlan.operation)==='UPGRADE'?tr('Обновить Ollama','Upgrade Ollama'):tr('Установить','Install')}</button></>}
        
      </div>}
      {selectedReceipt&&<div role="status">
        <p>{installState(str(selectedReceipt.status),str(selectedReceipt.operation))}</p>
        {str(selectedReceipt.install_issue)&&<p className="advanced-error">{installBlocker(str(selectedReceipt.install_issue))}</p>}

       </div>}
      
    </div></div>}
    <div className="advanced-form local-portfolio">
      <h3>{tr('Программы для расширения работы','Programs to extend your work')}</h3>
      <p>{tr('Выберите программу по задаче. Уже подключённые находятся в «Моих программах». Остальные варианты приведены с действующим или планируемым способом подключения.',
        'Choose software for your task. Verified installations appear in My programs. Other options show the available or planned connection route.')}</p>
      <label className="advanced-field">{tr('Назначение','Purpose')}<select value={portfolioGroup} onChange={e=>setPortfolioGroup(e.target.value)}>
        {LOCAL_PROGRAM_GROUPS.map(g=><option key={g.id} value={g.id}>{tr(g.ru,g.en)}</option>)}
      </select></label>
      {portfolioGroup==='server'&&<p>{tr('Подключение домашнего сервера пока недоступно. Здесь можно посмотреть программы для него. Работа с сервером потребует отдельной настройки и разрешения сети.',
        'Home server connections are not available yet. You can explore server programs here. Using one will require separate setup and network permission.')}</p>}
      {portfolioGroup==='account'&&<p>{tr('Эти программы не входят в обязательный локальный набор. Работа с внешними аккаунтами и данными требует отдельного согласия.',
        'These programs are not required for local work. External accounts and data transfers need separate consent.')}</p>}
      <div className="programs-overview">{LOCAL_PROGRAM_CHOICES.filter(p=>p.group===portfolioGroup&&matchesCategory(PORTFOLIO_CAPABILITIES[p.ref]||[])&&
         !(p.runtime&&programs.some(x=>str(x.runtime_id)===p.runtime))).map(p=>{
        const observed=programs.find(x=>str(x.runtime_id)===p.runtime);
        const tested=p.runtime?programHealth[p.runtime]===true:false;
        const found=!!observed&&(observed.system_installation_detected===true||record(observed.managed).staged===true);
        const known=catalogComponents.some(x=>str(x.component_ref)===p.ref);
        return <div className="local-portfolio-card" key={p.ref}>
          <strong>{p.name}</strong>
          <p>{tr(p.purposeRu,p.purposeEn)}</p>
          <small>{p.license}</small>
          <span>{p.ref==='external:mcp'
            ?mcpState===null?tr('Состояние сервера пока не получено.','Server state is not yet available.')
            :mcpConnected?(mcpToolCount?tr('Сервер подключён. Выбрано инструментов: ','Server connected. Allowed tools: ')+mcpToolCount
              :tr('Сервер подключён. Выберите инструменты.','Server connected. Choose tools.'))
            :tr('Сервер ещё не подключён.','Server not connected.')
            :tested?tr('Работа подтверждена','Working'):found?tr('Найдена, требуется проверка','Detected, needs verification'):
            known?tr('Есть в каталоге. Подключение через IWXA пока не готово.','Catalogued; IWXA connection not yet available.'):
            tr('Подключение пока недоступно','Connection not available yet')}</span>
          <div className="local-portfolio-actions">
            {p.runtime&&<button type="button" onClick={()=>{setOpenProgram(p.runtime||'');setChoice(p.runtime||'');setCheck(null);setInstallPlan(null);}}>
              {tested?tr('Управлять','Manage'):tr('Установить или подключить','Install or connect')}</button>}
            {p.ref==='external:n8n'&&<button type="button" disabled={n8nBusy} onClick={()=>void inspectN8n()}>{n8nBusy?tr('Проверяю…','Checking…'):tr('Проверить локальный n8n','Check local n8n')}</button>}
             {p.ref==='external:n8n'&&n8nHealth&&<p role="status">{n8nHealth.responding===true
               ?tr('n8n отвечает на этом компьютере. Для выполнения процессов необходимо отдельно настроить разрешённые действия.','n8n responds locally. Approved workflow actions must be configured separately.')
               :n8nHealth.configured!==true?tr('Сначала укажите адрес локального n8n в разделе подключений.','First configure the local n8n address under Connections.')
               :tr('Локальный n8n пока не отвечает по настроенному адресу.','Local n8n is not responding at the configured address.')}</p>}
             {p.ref==='external:n8n'&&<button type="button" onClick={()=>onNavigate('Интеграции')}>{tr('Настроить процессы','Configure workflows')}</button>}
             {p.ref==='external:n8n'&&<button type="button"
               onClick={()=>setN8nProposalOpen(value=>!value)}>{n8nProposalOpen
                ?tr('Скрыть подготовку','Hide workflow proposal')
                :tr('Подготовить процесс','Prepare workflow')}</button>}
             {p.ref==='external:n8n'&&n8nProposalOpen&&<N8nWorkflowProposal
               onOpenTask={id=>onOpenTask?.(id)}/>}

             {p.ref==='external:mcp'&&<>
               <button type="button" onClick={onOpenMcpConnections}>{mcpConnected?tr('Изменить сервер MCP','Change MCP server'):tr('Подключить MCP-сервер','Connect MCP server')}</button>
               <button type="button" onClick={onOpenMcpTools}>{mcpToolCount?tr('Управлять инструментами','Manage tools'):tr('Выбрать инструменты','Choose tools')}</button>
             </>}
            {p.official&&<a href={p.official} target="_blank" rel="noopener noreferrer">{tr('Инструкция разработчика','Developer instructions')}</a>}
          </div>
        </div>;
      })}</div>
      <p>{tr('Программы без установленного маршрута IWXA здесь можно изучить, но нельзя запустить или обновить одной кнопкой. Новые права не выдаются при добавлении в каталог.',
        'Programs without an implemented IWXA route can be reviewed here, but not launched or updated by one click. Catalog inclusion does not grant permissions.')}</p>
    </div>
    <details className="programs-advanced"><summary>{tr('Дополнительные сведения каталога','Additional catalog details')}</summary>
    <div className="advanced-form"><h3>{tr('Другие возможности','Other capabilities')}</h3>
      <p>{tr('Некоторые программы пока есть только в каталоге. Для них ещё нет готового подключения.',
        'Some programs are listed for reference. IWXA cannot connect to them yet.')}</p>
      <label className="advanced-field">{tr('Назначение','Purpose')}<select value={catalogFilter} onChange={e=>setCatalogFilter(e.target.value)}><option value="">{tr('Все компоненты','All components')}</option>{catalogSlots.map(x=><option key={str(x.slot_id)} value={str(x.slot_id)}>{str(x.slot_id)}</option>)}</select></label>
      <div className="owner-rows">{relevant.map(x=><div className="owner-row" key={str(x.component_ref)}><strong>{str(x.component_class)||str(x.component_ref)}</strong><span>{str(x.integration_state)==='RECIPE_READY'?tr('Подключение подготовлено','Connection prepared'):tr('Только в каталоге','Catalog only')}</span><small>{Array.isArray(x.slot_ids)?x.slot_ids.map(str).join(' · '):''}</small></div>)}</div>
      <p>{catalogSlots.length} {tr('направлений','categories')} · {catalogComponents.length} {tr('компонентов. Наличие в каталоге не разрешает запуск.','components. Catalog inclusion does not authorize execution.')}</p>
    </div>
    </details>
    <details className="programs-advanced"><summary>{tr('Установка и история','Installation and history')}</summary>
    <div className="advanced-form"><h3>{tr('Добавить программу','Add a program')}</h3>
      <p>{tr('Ollama, Obsidian и Joplin устанавливаются через WinGet, Goose - из проверенного официального выпуска. Obscura входит в Agent как нативный headless-модуль и устанавливается локально через U01 после подтверждения. Права на сайты задаются отдельно.','Ollama, Obsidian and Joplin use WinGet; Goose uses a verified official release. Obscura is bundled with Agent as a native headless module and installs locally through U01 after confirmation. Website access requires separate approval.')}</p>
      <div className="owner-rows">{programs.map(item=>{
        const id=str(item.runtime_id),inWindows=item.system_installation_detected===true;
        const inProduct=record(item.managed).staged===true,installed=inWindows||inProduct;
        const url=vendor(item.install_url),last=installReceipts.filter(r=>r.program_id===id).slice(-1)[0],plan=installPlans.find(r=>r.program_id===id);
        return <div className="owner-row" key={id}><strong>{str(item.display_name)||id}</strong>
          <span>{inWindows?tr('Установлена в Windows','Installed in Windows'):inProduct?tr('Подготовлена в IWXA','Prepared in IWXA'):tr('Не обнаружена','Not detected')}</span>
          <span>{str(item.selected_source)||tr('Источник не выбран','No source selected')}</span>
          {last&&<small role="status">{installState(str(last.status),str(last.operation))}</small>}
          {last&&<button disabled={busy||installationRunning} onClick={()=>void recheckInstall(id)}>{tr('Проверить установку','Check installation')}</button>}
          {!inWindows&&plan?.ready===false&&<small className="advanced-error">{installBlocker(str(plan.blocker))}</small>}
          {!installed&&['OLLAMA_LOCAL_V1','OBSIDIAN_V1','GOOSE_PRIMARY_V1','JOPLIN_V1','OBSCURA_WORKER_V1'].includes(id)&&<button disabled={busy||plan?.ready===false} onClick={()=>void prepareInstall(id)}>{tr('Установить в Windows','Install in Windows')}</button>}
          {!inWindows&&url&&<a href={url} target="_blank" rel="noopener noreferrer" className="mini-button">{tr('Официальный установщик','Official installer')}</a>}
          {inWindows&&id==='OLLAMA_LOCAL_V1'&&<button disabled={busy} onClick={()=>void connectInstalledOllama()}>{tr('Подключить Ollama Windows','Connect Windows Ollama')}</button>}
          {inProduct&&id==='OLLAMA_LOCAL_V1'&&<button disabled={busy} onClick={()=>void connectManagedOllama()}>{tr('Использовать Ollama IWXA','Use IWXA Ollama')}</button>}
          {installed&&id!=='OLLAMA_LOCAL_V1'&&<button onClick={()=>{setOpenProgram(id);setChoice(id);setCheck(null);setGooseHealth(null);setObsidianHealth(null);setManualVault('');}}>{tr('Открыть подключение','Open connection setup')}</button>}
        </div>;
      })}</div>
      {installReceipts.length>0&&<details className="owner-details"><summary>{tr('История установок','Installation history')}</summary>
        <div className="owner-rows">{installReceipts.slice(-12).reverse().map(row=><div className="owner-row" key={str(row.receipt_id)}>
          <strong>{programName(programs.find(p=>str(p.runtime_id)===str(row.program_id))||{runtime_id:row.program_id})}</strong><span>{installState(str(row.status),str(row.operation))}</span>
          <OwnerDetails value={row} title={tr('Квитанция установки','Installation receipt')}/>
          {row.manager==='WINDOWS_PACKAGE_MANAGER'&&typeof row.return_code==='number'&&<OwnerDetails title={tr('Ответ установщика','Installer result')} value={{return_code:row.return_code}}/>}
          <small>{row.installed_after===true?tr('Программа обнаружена. Подключение требует проверки.','Program detected. Connection still requires verification.'):tr('Результат установки не подтверждён. Повторите обнаружение.','Installation outcome is unverified. Check again.')}</small>
        </div>)}</div>
      </details>}
      {installPlan&&<div className="owner-details"><h3>{programName(programs.find(p=>str(p.runtime_id)===str(installPlan.program_id))||{runtime_id:installPlan.program_id})}</h3>
        {installPlan.ready!==true?<p role="alert">{installBlocker(str(installPlan.blocker))}</p>:<>
        {installPlan.network_download_required!==false&&!networkActionAvailable(t3Enabled)&&<p role="status">{t3Enabled===true
         ?tr('Сетевая установка и обновление выключены в режиме локальной работы. Изменить режим можно в левом меню.',
             'Network installation and updates are disabled in local work mode. Change the mode in the left menu.')
         :tr('Не удалось подтвердить режим работы. Проверьте подключение к агенту в левом меню.',
              'Current mode could not be verified. Check the agent connection in the left menu.')}</p>}
        <label><input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)}/>{str(installPlan.operation)==='UPGRADE'?tr('Разрешаю обновление Ollama через WinGet. Понадобится повторная проверка.','I authorize an Ollama upgrade through WinGet. Rechecking is required.'):str(installPlan.program_id)==='GOOSE_PRIMARY_V1'?tr('Разрешаю загрузить официальный выпуск Goose в личную папку без замены файлов.','I authorize downloading the official Goose CLI into my user folder without replacing files.'):str(installPlan.program_id)==='OBSCURA_WORKER_V1'?tr('Разрешаю установить неподписанный, проверенный по SHA-256 headless Obscura из пакета Agent. Права на сайты отдельно.','I approve installing unsigned, SHA-256 verified headless Obscura bundled with Agent. Website permissions are separate.'):tr('Разрешаю загрузку и принимаю условия WinGet и производителя.','I authorize download and accept WinGet and vendor terms.')}</label>
        <div className="advanced-actions"><button disabled={busy||!consent||(installPlan.network_download_required!==false&&!networkActionAvailable(t3Enabled))} onClick={()=>void install()}>{str(installPlan.operation)==='UPGRADE'?tr('Подтвердить обновление','Confirm upgrade'):tr('Подтвердить установку','Confirm installation')}</button></div></>}
        <OwnerDetails value={installPlan} title={tr('План установки','Installation plan')}/>
      </div>}
    </div>
    </details>

  </section>;
}
