import React,{createContext,useContext,useEffect,useMemo,useRef,useState} from 'react';
import {runtime} from './runtime-client/interaction';
export type Language='ru'|'en';
export type Theme='light'|'dark';
export type WorkMode='fast'|'checked';
type Preferences={language:Language;theme:Theme;workMode:WorkMode;setWorkMode:(mode:WorkMode)=>void;toggleLanguage:()=>void;toggleTheme:()=>void;tr:(ru:string,en:string)=>string;persistenceError:string;t3Enabled:boolean|null;t3Busy:boolean;setT3:(enabled:boolean)=>Promise<void>;reloadT3:()=>Promise<void>};
const storageKey='iwxa.desktop.appearance.v1',workModeStorageKey='iwxa.desktop.work-mode.v1';
const context=createContext<Preferences|undefined>(undefined);
function initialWorkMode():WorkMode{
 try{return window.localStorage.getItem(workModeStorageKey)==='checked'?'checked':'fast'}
 catch{return 'fast'}
}
function initial():{language:Language;theme:Theme}{
 let language:Language='ru',theme:Theme='light';
 try{const v=JSON.parse(window.localStorage.getItem(storageKey)||'{}');if(v.language==='ru'||v.language==='en')language=v.language;if(v.theme==='light'||v.theme==='dark')theme=v.theme;}catch{/* Presentation defaults. */}
 return {language,theme};
}
type DisplayState={language:Language;theme:Theme};
type SavedState=DisplayState&{persisted?:boolean};
function isDisplayState(value:unknown):value is DisplayState{
 if(!value||typeof value!=='object')return false;
 const row=value as Record<string,unknown>;
 return (row.language==='ru'||row.language==='en')&&(row.theme==='light'||row.theme==='dark');
}
export function UiSettingsProvider({children}:{children:React.ReactNode}){
 const [state,setState]=useState<DisplayState>(initial);
 const [workMode,setWorkModeState]=useState<WorkMode>(initialWorkMode);
 function setWorkMode(mode:WorkMode){
  // UI workflow preference; Core access and durable write rules remain unchanged.
  setWorkModeState(mode);
  try{window.localStorage.setItem(workModeStorageKey,mode)}catch{/* Presentation remains usable. */}
 }
 const [persistenceError,setPersistenceError]=useState('');
 const active=useRef(state);
 const loaded=useRef(false);
 const touched=useRef(false);
 const saving=useRef<Promise<unknown>>(Promise.resolve());
 const mounted=useRef(true);
 const [t3Enabled,setT3Enabled]=useState<boolean|null>(null);
 const [t3Busy,setT3Busy]=useState(false);
 const t3Pending=useRef(false);
 async function reloadT3(){
  try{
   const saved=await runtime.query<SavedState&{t3_enabled?:unknown}>('ui_preferences');
   if(typeof saved.t3_enabled!=='boolean')throw Error('t3_state_unverified');
   setT3Enabled(saved.t3_enabled);
  }catch(e){
   setT3Enabled(null);
   throw e;
  }
 }
 async function setT3(enabled:boolean){
  if(t3Pending.current)return;
  t3Pending.current=true;setT3Busy(true);
  try{
   const reply=await runtime.command<SavedState&{t3_enabled?:unknown}>('ui_preferences_update',
    {t3_enabled:enabled},{kind:'ui_preferences',id:'desktop'});
   if(reply.persisted!==true||reply.t3_enabled!==enabled)throw Error('t3_save_unverified');
   await reloadT3();
   if(mounted.current)setPersistenceError('');
  }catch(e){
   setT3Enabled(null);
   if(mounted.current)setPersistenceError(String(e instanceof Error?e.message:e));
  }finally{t3Pending.current=false;setT3Busy(false);}
 }
 function save(next:DisplayState){
  // Serialize rapid toggle actions so older requests cannot overwrite newer
  // preferences. A rejected request is visible, never silently replayed.
  saving.current=saving.current.catch(()=>{}).then(async()=>{
   const reply=await runtime.command<SavedState>('ui_preferences_update',next,{kind:'ui_preferences',id:'desktop'});
   if(!isDisplayState(reply)||reply.language!==next.language||reply.theme!==next.theme||reply.persisted!==true)
    throw Error('ui_preferences_readback_mismatch');
   if(mounted.current)setPersistenceError('');
  }).catch(e=>{
   if(mounted.current)setPersistenceError(String(e instanceof Error?e.message:e));
  });
 }
 useEffect(()=>{
  mounted.current=true;
  let cancelled=false;
  void runtime.query<SavedState>('ui_preferences').then(stored=>{
   if(cancelled)return;
   if(!isDisplayState(stored))throw Error('ui_preferences_invalid_projection');
   if(typeof (stored as SavedState&{t3_enabled?:unknown}).t3_enabled!=='boolean')throw Error('t3_state_unverified');
   setT3Enabled((stored as SavedState&{t3_enabled:boolean}).t3_enabled);
   loaded.current=true;
   if(touched.current){
    save(active.current);
   }else if(stored.persisted===true){
    active.current={language:stored.language,theme:stored.theme};
    setState(active.current);
    setPersistenceError('');
   }else if(active.current.language!=='ru'||active.current.theme!=='light'){
    // One-time migration from the former WebView-only presentation values.
    save(active.current);
   }
  }).catch(e=>{
   if(!cancelled){loaded.current=false;setT3Enabled(null);setPersistenceError(String(e instanceof Error?e.message:e));}
  });
  return ()=>{cancelled=true;mounted.current=false;};
 },[]);
 useEffect(()=>{
  document.documentElement.lang=state.language;
  document.documentElement.dataset.theme=state.theme;
  document.documentElement.style.colorScheme=state.theme;
  runtime.setLocale(state.language);
  try{window.localStorage.setItem(storageKey,JSON.stringify(state));}catch{/* WebView storage optional. */}
 },[state]);
 function update(changes:Partial<DisplayState>){
  touched.current=true;
  const next={...active.current,...changes};
  active.current=next;
  setState(next);
  if(loaded.current)save(next);
 }
 const value=useMemo<Preferences>(()=>({
  ...state,workMode,setWorkMode,persistenceError,t3Enabled,t3Busy,setT3,reloadT3,
  toggleLanguage:()=>update({language:active.current.language==='ru'?'en':'ru'}),
  toggleTheme:()=>update({theme:active.current.theme==='light'?'dark':'light'}),
  tr:(ru,en)=>state.language==='ru'?ru:en
 }),[state,workMode,persistenceError,t3Enabled,t3Busy]);
 return <context.Provider value={value}>{children}</context.Provider>;
}
export function useUiSettings(){const v=useContext(context);if(!v)throw Error('Missing UiSettingsProvider');return v;}
const titles:Record<string,string>={
 'Главная':'Home','Задачи':'Tasks','Работа в организации':'Work in organization','Диалоги':'Conversations','Проекты':'Goals & boards',
 'Автоматизации':'Automations','Цепочки':'Processes','Агенты':'Assistants','Программы':'Programs',
 'Знания':'Knowledge','Навыки':'Capabilities','Память':'Memory','Домены':'Domains','Интеграции':'Connections',
 'Файлы':'Files','Модели':'Models','Инструменты':'Tools','Согласования':'Confirmations',
 'Восстановление':'Recovery','Настройки':'Settings',
};
const humanTitlesRu:Record<string,string>={
 'Цепочки':'Процессы','Агенты':'Помощники','Навыки':'Возможности',
 'Интеграции':'Подключения','Согласования':'Подтверждения',
 'Восстановление':'Проверка действий','Домены':'Направления',
};
export function pageName(name:string,lang:Language){
 return lang==='en'?(name==='Рабочие области'?'Work areas':titles[name]||name):humanTitlesRu[name]||name;
}
const explanations:Record<string,[string,string]>={
 'Главная':['Опишите задачу или выберите документы. Агент покажет результат для вашей проверки.','Describe a task or choose documents. You can review the result before accepting it.'],
 'Задачи':['Откройте выполненную работу, внесите замечания и отдельно разрешите изменение файла, если оно потребуется.','Review completed work, suggest changes and separately approve any file edits.'],
 'Работа в организации':['Получите оригинальное подписанное поручение T3, выполните его в Agent и отдельно подпишите выбранный результат.','Receive an original signed T3 assignment, execute it in Agent, then separately sign the selected result.'],
 'Диалоги':['Вернитесь к прежнему разговору или начните новый.','Continue a conversation or start a new one.'],
 'Проекты':['Сформулируйте цель, определите шаги и проверяйте их выполнение.','Set a goal, organize the steps and review their progress.'],
 'Автоматизации':['Настройте повторяющуюся работу и проверяйте результаты каждого запуска.','Schedule recurring work and review the result of each run.'],
 'Цепочки':['Составьте последовательность действий. Перед запуском просмотрите изменения и подтвердите решение.','Arrange a sequence of steps. Review proposed changes before running it.'],
 'Агенты':['Выберите исполнителя и проверяющего. Для работы им потребуется настроенная программа.','Choose an assistant and reviewer. Each needs a configured program to work.'],
 'Навыки':['Посмотрите доступные способы работы агента и выберите нужный для задачи.','Browse the available capabilities and choose one for your task.'],
 'Программы':['Установите нужную программу или подключите уже найденную. Состояние установки и готовность к работе показаны отдельно.','Install a program or connect an existing one. Installation and readiness are shown separately.'],
 'Знания':['Подключите нужные материалы и выберите, что агенту разрешено читать.','Connect reference materials and choose what the assistant may read.'],
 'Память':['Просматривайте сведения, которые агент предлагает сохранить для будущих задач.','Review information the assistant proposes to remember for later work.'],
 'Интеграции':['Подключайте нужные программы и учётные записи. Каждое подключение требует отдельного решения.','Connect programs and accounts. Each connection requires your approval.'],
 'Модели':['Установите Ollama, выберите модель и проверьте её реальный ответ.','Install Ollama, choose a model and verify that it responds.'],
 'Инструменты':['Узнайте, какие действия доступны агенту. Изменение данных требует отдельного разрешения.','See what the assistant can do. Changes to data require separate approval.'],
 'Согласования':['Проверьте предложенный результат и решите, можно ли его принять. Запись файла подтверждается отдельно.','Review the proposed result before accepting it. File changes need separate approval.'],
 'Восстановление':['Проверьте результат прерванного действия, прежде чем повторять его.','Check the outcome of an interrupted action before retrying it.'],
 'Настройки':['Выберите язык и оформление. Изменения сохраняются для следующих запусков.','Choose a language and appearance. Your preferences are kept for the next session.'],
 'sources':['Для каждой задачи выберите нужные источники. При работе с личными файлами внешние источники отключаются.','Choose the sources for each task. External sources are disabled for personal files.'],
 'skills':['Автоматический выбор подбирает подходящий способ работы. Можно выбрать его самостоятельно.','Automatic selection chooses a suitable capability, or you can select one yourself.'],
 'privacy':['При включённой локальной работе IWXA ограничивает внешние подключения. Выключение режима само по себе ничего не отправляет и не меняет разрешения.','With local work enabled, IWXA restricts external connections. Turning the mode off does not send data or change permissions.'],
 'theme':['Смените светлое и тёмное оформление.','Switch between light and dark appearance.'],
 'language':['Выберите язык интерфейса. Он сохранится после перезапуска.','Choose your interface language. It is restored after restart.'],
};
export function HelpTip({topic}:{topic:string}){
 const [open,setOpen]=useState(false),{language,tr}=useUiSettings();
 const copy=explanations[topic]||explanations['Главная'];
 return <span className="ui-help-wrap"><button type="button" className="ui-help-trigger" title={tr('Пояснение','Help')} aria-label={tr('Пояснение','Help')+': '+pageName(topic,language)} onClick={()=>setOpen(true)}>?</button>
 {open&&<div className="ui-help-backdrop" onClick={()=>setOpen(false)}><div role="dialog" aria-modal="true" className="ui-help-dialog" onClick={e=>e.stopPropagation()}>
 <button className="ui-help-close" aria-label={tr('Закрыть','Close')} onClick={()=>setOpen(false)}>×</button><h2>{pageName(topic,language)}</h2><p>{copy[language==='ru'?0:1]}</p><button className="secondary-button" onClick={()=>setOpen(false)}>{tr('Понятно','Got it')}</button></div></div>}</span>;
}
