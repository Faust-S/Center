import React from "react";
import {createRoot,type Root} from "react-dom/client";
import App from "./App";

// Native Center has one WebView surface. A repeated script evaluation or
// WebView restoration must reuse the same React root, not create a second
// employee enrollment/Task panel with another native signing action.
const element=document.getElementById("root");
if(!element)throw Error("CEN03_APP_ROOT_NOT_FOUND");
const host=element as HTMLElement & {__iwxaAdminRoot?:Root};
if(!host.__iwxaAdminRoot)host.__iwxaAdminRoot=createRoot(host);
host.__iwxaAdminRoot.render(<React.StrictMode><App/></React.StrictMode>);
