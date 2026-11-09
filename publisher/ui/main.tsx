import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './App';

type RecoveryState={failed:boolean;details:string};
class PublisherRenderBoundary extends React.Component<{children:React.ReactNode},RecoveryState> {
 state:RecoveryState={failed:false,details:''};
 static getDerivedStateFromError(error:unknown):RecoveryState {
  return {failed:true,details:error instanceof Error?error.message:String(error)};
 }
 componentDidCatch(error:Error){
  console.error('PUBLISHER_DESKTOP_RENDER_FAILURE',error);
 }
 render(){
  if(!this.state.failed)return this.props.children;
  return <main className="publisher-startup" role="alert" data-testid="publisher-recovery">
   <strong>Не удалось открыть интерфейс Publisher</strong>
   <p>Попробуйте повторить запуск. Сохранённые черновики не удаляются.</p>
   <button type="button" onClick={()=>window.location.reload()}>Повторить запуск</button>
   <details><summary>Сведения об ошибке</summary><code>{this.state.details}</code></details>
  </main>;
 }
}
createRoot(document.getElementById('root')!).render(
 <React.StrictMode><PublisherRenderBoundary><App/></PublisherRenderBoundary></React.StrictMode>
);
