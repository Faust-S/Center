import React from "react";
import {createRoot,type Root} from "react-dom/client";
import App from "./App";

// If the React tree itself fails, never leave the installed Windows
// application as a silent empty surface. Import failures still preserve the
// static fallback in index.html until a successful mount.
class CenterRenderBoundary extends React.Component<
  {children:React.ReactNode},{failed:boolean}
> {
  state={failed:false};
  static getDerivedStateFromError(){return {failed:true};}
  componentDidCatch(){
    // No license, organization, file path or stack is sent to the UI.
    console.error("IWXA_CENTER_REACT_RENDER_FAILED");
  }
  render(){
    if(this.state.failed)return <main role="alert" data-testid="center-boot-failure"
      style={{fontFamily:'Segoe UI, sans-serif',padding:'32px',maxWidth:'540px',
        margin:'60px auto',background:'#fff',border:'1px solid #d5dce6',
        borderRadius:'12px',color:'#293747'}}>
      <h1>Admin Center не открыл рабочее место</h1>
      <p>Программа запущена, но интерфейс не удалось отобразить.
        Завершите приложение и повторите запуск. Данные не сбрасываются.</p>
      <p>Код: IWXA_CENTER_REACT_RENDER_FAILED</p>
    </main>;
    return this.props.children;
  }
}

// Native Center has one WebView surface. A repeated script evaluation or
// WebView restoration must reuse the same React root, not create a second
// employee enrollment/Task panel with another native signing action.
const element=document.getElementById("root");
if(!element)throw Error("CEN03_APP_ROOT_NOT_FOUND");
const host=element as HTMLElement & {__iwxaAdminRoot?:Root};
if(!host.__iwxaAdminRoot)host.__iwxaAdminRoot=createRoot(host);
host.__iwxaAdminRoot.render(
  <React.StrictMode><CenterRenderBoundary><App/></CenterRenderBoundary></React.StrictMode>
);
