import React,{useState} from 'react';
import{createRoot}from'react-dom/client';
import{isTauri}from '@tauri-apps/api/core';
import{App}from './workbench';
import{UiSettingsProvider}from './ui-preferences';
import{exchangeStartupDesktopTicket,renewDesktopSession}from './runtime-client/session-bootstrap';
import './style.css';

// The first ticket exchange can fail if the installed Core was restarting.
// Preserve the native window and offer the existing safe Core recovery path.
// Never call a model or replay an application command from this screen.
function DesktopStartup({authenticated}:{authenticated:boolean}){
 const[connected,setConnected]=useState(authenticated);
 const[recovering,setRecovering]=useState(false);
 const[retryFailed,setRetryFailed]=useState(false);
 const native=isTauri();
 const ru=navigator.language.toLowerCase().startsWith('ru');
 const tr=(russian:string,english:string)=>ru?russian:english;
 async function retry(){
  if(!native||recovering)return;
  setRecovering(true);setRetryFailed(false);
  try{
   await renewDesktopSession();
   setConnected(true);
  }catch{
   setRetryFailed(true);
  }finally{
   setRecovering(false);
  }
 }
 if(connected)return <UiSettingsProvider><App/></UiSettingsProvider>;
 return <main className="iwxa-startup-recovery">
  <section className="iwxa-startup-panel" aria-labelledby="iwxa-startup-title">
   <h1 id="iwxa-startup-title">IWXA Personal</h1>
   <p role="status">{tr('Не удалось открыть локальную сессию. Сохранённые данные не изменялись.',
    'The local session could not be opened. Saved data was not changed.')}</p>
   {native?
    <button type="button" disabled={recovering} onClick={()=>void retry()}>
     {recovering?tr('Восстанавливаем соединение...','Restoring connection...'):
      tr('Повторить подключение','Reconnect')}
    </button>:
    <p>{tr('Откройте приложение через установленный ярлык IWXA Personal.',
      'Open the application using the installed IWXA Personal shortcut.')}</p>}
   {retryFailed&&<p role="alert">{tr(
    'Ядро приложения пока недоступно. Проверьте, что другая установка не заняла адрес, затем повторите подключение.',
    'The application Core is still unavailable. Check whether another installation is using its address, then reconnect.')}</p>}
  </section>
 </main>;
}

const root=createRoot(document.getElementById('root')!);
// Render a visible connection state while the first one-use ticket exchange
// is pending; a delayed local server response must not look like a frozen app.
const startingInRussian=navigator.language.toLowerCase().startsWith('ru');
root.render(<main className="iwxa-startup-recovery"><section className="iwxa-startup-panel" role="status">
 <h1>IWXA Personal</h1>
 <p>{startingInRussian?'Подключаемся к локальному ядру…':'Connecting to the local Core…'}</p>
</section></main>);
// A one-use ticket must be removed before its first exchange: on a failed
// exchange the native recovery command requires the exact /desktop/ URL.
const startup=exchangeStartupDesktopTicket(location.hash,
 ()=>history.replaceState(null,'',location.pathname));
void startup.then(authenticated=>root.render(<React.StrictMode><DesktopStartup authenticated={authenticated}/></React.StrictMode>))
 .catch(()=>root.render(<React.StrictMode><DesktopStartup authenticated={false}/></React.StrictMode>));
