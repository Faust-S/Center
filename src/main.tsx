import React from "react";
import {createRoot,type Root} from "react-dom/client";
import App from "./App";

// The native Center has exactly ONE desktop WebView root. Repeated script
// evaluation (including WebView lifecycle restoration) must render through
// this same React root rather than appending duplicate corporate actions.
const element=document.getElementById("root");
if(!element)throw Error("CEN03_APP_ROOT_NOT_FOUND");
const host=element as HTMLElement & {__iwxaAdminRoot?:Root};
if(!host.__iwxaAdminRoot)host.__iwxaAdminRoot=createRoot(host);
host.__iwxaAdminRoot.render(<React.StrictMode><App/></React.StrictMode>);
