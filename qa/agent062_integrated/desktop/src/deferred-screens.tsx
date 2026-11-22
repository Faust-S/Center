import React,{lazy,Suspense,useState} from 'react';
import {useUiSettings} from './ui-preferences';

// Only the selected optional screen loads. The Task composer, Core session and
// saved navigation remain owned by the existing Workbench.
function DeferredScreenLoading(){
 const {tr}=useUiSettings();
 return <section className="subpage card" role="status">
  <p>{tr('Открываем раздел…','Opening section…')}</p>
 </section>;
}

function DeferredScreenFailed({onReturnToWork,destination='home'}:{onReturnToWork:()=>void;destination?:'home'|'programs'}){
 const {tr}=useUiSettings();
 return <section className="subpage card" role="alert">
  <h2>{tr('Не удалось открыть раздел','Could not open this section')}</h2>
  <p>{destination==='programs'
   ?tr('Вернитесь к списку программ и повторите выбор.','Return to the program list and try again.')
   :tr('Вернитесь на главную. Раздел можно снова открыть из меню.','Go to Home. You can reopen this section from the menu.')}</p>
  <button type="button" onClick={onReturnToWork}>
   {destination==='programs'?tr('Вернуться к программам','Back to programs'):tr('На главную','Go to Home')}
  </button>
 </section>;
}

// Isolate failed optional JavaScript chunks and component errors from the
// existing Task/Result shell. Navigating away unmounts this boundary.
class DeferredScreenBoundary extends React.Component<{
 onReturnToWork:()=>void;destination?:'home'|'programs';children:React.ReactNode
},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(_error:unknown){return {failed:true};}
 render(){
  if(this.state.failed)return <DeferredScreenFailed onReturnToWork={this.props.onReturnToWork} destination={this.props.destination}/>;
  return this.props.children;
 }
}

const LazyProgramsCenter=lazy(()=>import('./programs-center').then(module=>({default:module.ProgramsCenter})));
const LazyPublicPrograms=lazy(()=>import('./public-programs-control').then(module=>({default:module.PublicProgramsControl})));
const LazyChainBuilder=lazy(()=>import('./chain-builder').then(module=>({default:module.ChainBuilder})));
const LazyAgentControl=lazy(()=>import('./agent-control').then(module=>({default:module.AgentControl})));
const LazyModelsControl=lazy(()=>import('./models-control').then(module=>({default:module.ModelsControl})));
const LazyAutomationsControl=lazy(()=>import('./automations-control').then(module=>({default:module.AutomationsControl})));

export function ProgramsCenter({onReturnToWork,...props}:React.ComponentProps<typeof LazyProgramsCenter>&{onReturnToWork:()=>void}){
 const [showPublic,setShowPublic]=useState(false);
 const {tr}=useUiSettings();
 return <>
  <DeferredScreenBoundary onReturnToWork={onReturnToWork}>
   <Suspense fallback={<DeferredScreenLoading/>}><LazyProgramsCenter {...props}/></Suspense>
  </DeferredScreenBoundary>
  {props.onOpenTask&&<section className="subpage card">
   <button type="button" aria-expanded={showPublic} onClick={()=>setShowPublic(value=>!value)}>
    {showPublic?tr('Скрыть дополнительные программы','Hide additional programs'):tr('Другие консольные программы','Other command-line programs')}
   </button>
   {showPublic&&<DeferredScreenBoundary destination="programs" onReturnToWork={()=>setShowPublic(false)}>
    <Suspense fallback={<DeferredScreenLoading/>}><LazyPublicPrograms onOpenTask={props.onOpenTask}/></Suspense>
   </DeferredScreenBoundary>}
  </section>}
 </>;
}
export function ChainBuilder({onReturnToWork,...props}:React.ComponentProps<typeof LazyChainBuilder>&{onReturnToWork:()=>void}){
 return <DeferredScreenBoundary onReturnToWork={onReturnToWork}>
  <Suspense fallback={<DeferredScreenLoading/>}><LazyChainBuilder {...props}/></Suspense>
 </DeferredScreenBoundary>;
}
export function AgentControl({onReturnToWork,...props}:React.ComponentProps<typeof LazyAgentControl>&{onReturnToWork:()=>void}){
 return <DeferredScreenBoundary onReturnToWork={onReturnToWork}>
  <Suspense fallback={<DeferredScreenLoading/>}><LazyAgentControl {...props}/></Suspense>
 </DeferredScreenBoundary>;
}
export function ModelsControl({onReturnToWork,...props}:React.ComponentProps<typeof LazyModelsControl>&{onReturnToWork:()=>void}){
 return <DeferredScreenBoundary onReturnToWork={onReturnToWork}>
  <Suspense fallback={<DeferredScreenLoading/>}><LazyModelsControl {...props}/></Suspense>
 </DeferredScreenBoundary>;
}
export function AutomationsControl({onReturnToWork,...props}:React.ComponentProps<typeof LazyAutomationsControl>&{onReturnToWork:()=>void}){
 return <DeferredScreenBoundary onReturnToWork={onReturnToWork}>
  <Suspense fallback={<DeferredScreenLoading/>}><LazyAutomationsControl {...props}/></Suspense>
 </DeferredScreenBoundary>;
}
