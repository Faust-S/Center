import React,{useEffect,useRef,useState} from 'react';
import {useUiSettings} from './ui-preferences';
import {confirmedNativeActivation,nativeWindowLost,presentProgramIntegration,
 type U03Observation,type U04Observation,type U04SurfaceObservation,type VerifiedWindow} from './native-program-observation';

type Props={detected:boolean;connected:boolean;dataReady:boolean;
 appRef:string;hostRef?:string;u03?:U03Observation;u04?:U04Observation;
 u04Surface?:U04SurfaceObservation;
 onActivate?:(binding:VerifiedWindow)=>Promise<U04Observation>;
 onInspect?:()=>Promise<void>;inspecting?:boolean;
 onReturnToTask:()=>void};
type Phase='idle'|'working'|'focused'|'lost'|'unknown';

/** In-card native-window UX. Never starts a process or submits a Task. */
export function NativeProgramLink({detected,connected,dataReady,appRef,hostRef,u03,u04,u04Surface,
 onActivate,onInspect,inspecting=false,onReturnToTask}:Props){
 const {tr}=useUiSettings();
 const view=presentProgramIntegration({detected,dataReady,u03,u04,u04Surface,appRef,hostRef});
 const key=JSON.stringify([appRef,hostRef||'',view.activation?.bindingRef||'',
  view.activation?.processId||0,view.activation?.processStamp||'',
  view.activation?.windowRef||'',view.windowState]);
 const latestKey=useRef(key);
 latestKey.current=key;
 const mounted=useRef(true),busy=useRef<{key:string;lease:number}|null>(null),mountEpoch=useRef(0);
 const [feedback,setFeedback]=useState<{key:string;phase:Phase}>({key,phase:'idle'});
 const phase=feedback.key===key?feedback.phase:'idle';
 useEffect(()=>{
  mounted.current=true;
  setFeedback(previous=>previous.phase==='working'
   ?{key:latestKey.current,phase:'idle'}:previous);
  return()=>{mounted.current=false;mountEpoch.current++};
 },[]);
 async function activate(){
  const binding=view.activation;
  if(!binding||!onActivate||busy.current?.key===key)return;
  const lease=mountEpoch.current;
  busy.current={key,lease};
  setFeedback({key,phase:'working'});
  try{
   const receipt=await onActivate(binding);
   if(!mounted.current||mountEpoch.current!==lease||latestKey.current!==key)return;
   setFeedback({key,phase:confirmedNativeActivation(receipt,binding)?'focused':
    receipt?.schema==='IWXA_PRESENTATION_BRIDGE/1.0.0'
     &&nativeWindowLost(receipt.status)?'lost':'unknown'});
  }catch{
   if(mounted.current&&mountEpoch.current===lease&&latestKey.current===key)
    setFeedback({key,phase:'unknown'});
  }finally{
   if(busy.current?.key===key&&busy.current.lease===lease)busy.current=null;
   // A previous host's completion must not leave a disabled button or stale
   // success notice in the currently displayed Workspace.
   if(mounted.current&&(mountEpoch.current!==lease||latestKey.current!==key))
    setFeedback(previous=>previous.key===key&&previous.phase==='working'
     ?{key:latestKey.current,phase:'idle'}:previous);
  }
 }
 const activePhase=view.windowState==='lost'?'lost':phase;
 return <div className="native-program-link" aria-label={tr('Связанное окно программы','Linked application window')}>
  <p role="status">{!view.discovered?tr('Программа пока не обнаружена.','Application not detected.'):
   connected?tr('Доступ к заметкам подключён; состояние окна проверяется отдельно.',
    'Notes connection is available; window state is verified separately.'):
   tr('Программа обнаружена, но подключение к заметкам не подтверждено.',
    'Application detected; notes connection is not confirmed.')}</p>
  <details className="native-program-details">
   <summary>{tr('Подробности подключения','Connection details')}</summary>
   <dl className="native-program-levels">
   <dt>{tr('Данные','Data')}</dt><dd>{view.dataReady?tr('Подтверждены','Verified'):tr('Не подтверждены','Not verified')}</dd>
   <dt>{tr('Функции','Functions')}</dt><dd>{view.functionsVerified?tr('Подтверждены','Verified'):tr('Не подтверждены','Not verified')}</dd>
   <dt>{tr('Работа с окном','Window support')}</dt>
   <dd>{view.nativeWindowSupported?tr('Поддерживается','Supported'):tr('Не подтверждена','Not confirmed')}</dd>
   <dt>{tr('Текущее окно','Current window')}</dt><dd>{view.windowState==='lost'
    ?tr('Связь потеряна','Connection lost')
    :view.windowVerified?tr('Окно найдено','Window found'):tr('Не подтверждено','Not verified')}</dd>
   <dt>{tr('Встраивание','Embedding support')}</dt>
   <dd>{view.embeddedSupported?tr('Поддерживается','Supported'):tr('Не подтверждено','Not confirmed')}</dd>
   <dt>{tr('Встроенное окно','Embedded window')}</dt>
   <dd>{view.embeddedVerified?tr('Подключено','Attached'):tr('Не подтверждено','Not verified')}</dd>
   </dl>
  </details>
  {onInspect&&<button type="button" className="secondary-button" disabled={inspecting}
   onClick={()=>void onInspect()}>{inspecting?tr('Ищем открытое окно…','Checking open window…'):
    tr('Проверить окно программы','Check application window')}</button>}
  {onInspect&&u04?.status==='WINDOW_NOT_FOUND'&&<p role="status">{tr(
   'Открытое окно не найдено. Запустите программу обычным способом и проверьте снова.',
   'No open window was found. Start the application normally, then check again.')}</p>}
  {onInspect&&u04?.status==='WINDOW_OBSERVATION_FAILED'&&<p role="alert">{tr(
   'Не удалось проверить окно. Повторите проверку после открытия программы.',
   'Could not check the window. Try again after opening the application.')}</p>}
  {view.activation&&onActivate?<button type="button" disabled={busy.current?.key===key||activePhase==='working'}
   onClick={()=>void activate()}>
   {activePhase==='working'||busy.current?.key===key?tr('Проверяем окно…','Verifying window…'):
    tr('Перейти к программе','Go to application')}</button>:
   <p role="status">{tr('Переход к окну пока недоступен. Откройте программу обычным способом, затем вернитесь к задаче.',
    'Switching to the window is not available yet. Open the program normally, then return to the task.')}</p>}
  {activePhase==='focused'&&view.activation&&<p role="status">{tr('Окно программы подтверждено.','Application window confirmed.')}</p>}
  {activePhase==='lost'&&<p role="alert">{tr('Окно не найдено или его состояние изменилось. Вернитесь к программе и проверьте её вручную.',
   'Window not found or its identity changed. Check the application manually.')}</p>}
  {activePhase==='unknown'&&<p role="alert">{tr('Не удалось подтвердить переход. Проверьте окно программы; повторного запуска не было.',
   'Could not confirm the switch. Check the program window; it was not started again.')}</p>}
  <button type="button" className="secondary-button" onClick={onReturnToTask}>
   {tr('Вернуться к задаче','Return to Task')}</button>
 </div>;
}
