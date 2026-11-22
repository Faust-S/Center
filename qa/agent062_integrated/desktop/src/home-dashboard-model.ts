/** Dashboard layout is user presentation, never a Task/Result or Workspace authority. */
export const DASHBOARD_SCHEMA='IWXA_HOME_DASHBOARD_VIEW/1';
export type WidgetKind='composer'|'recent'|'selected'|'review'|'work-status'|
 'conversations'|'files'|'task-sources'|'projects'|'automations'|'programs'|'models'|
 'connections'|'knowledge'|'memory'|'company'|'program-shortcut';
export type ProgramShortcut='external:n8n'|'external:node-red'|'external:goose'|
 'external:ollama'|'external:obsidian'|'external:iwxa-obscura'|'external:mcp';
export type WidgetSpan=4|6|12;
export type DashboardWidget={id:string;kind:WidgetKind;span:WidgetSpan;program?:ProgramShortcut};
export type DashboardLayout={schema:typeof DASHBOARD_SCHEMA;widgets:DashboardWidget[]};
export const PROGRAM_SHORTCUTS:{id:ProgramShortcut;ru:string;en:string}[]=[
 {id:'external:n8n',ru:'n8n',en:'n8n'},
 {id:'external:node-red',ru:'Node-RED',en:'Node-RED'},
 {id:'external:goose',ru:'Goose',en:'Goose'},
 {id:'external:ollama',ru:'Ollama',en:'Ollama'},
 {id:'external:obsidian',ru:'Obsidian',en:'Obsidian'},
 {id:'external:iwxa-obscura',ru:'IWXA Obscura',en:'IWXA Obscura'},
 {id:'external:mcp',ru:'MCP',en:'MCP'}
];
const KINDS:WidgetKind[]=['composer','recent','selected','review','work-status',
 'conversations','files','task-sources','projects','automations','programs','models',
 'connections','knowledge','memory','company','program-shortcut'];
const KNOWN_PROGRAMS=new Set(PROGRAM_SHORTCUTS.map(p=>p.id));
export const DEFAULT_DASHBOARD:DashboardLayout={schema:DASHBOARD_SCHEMA,widgets:[
 {id:'home-composer',kind:'composer',span:12},
 {id:'home-recent',kind:'recent',span:12},
 {id:'home-review',kind:'review',span:6},
 {id:'home-programs',kind:'programs',span:6}
]};
export function dashboardStorageKey(areaId:string):string{
 if(typeof areaId!=='string'||!areaId||areaId.length>200)
  throw Error('dashboard_workspace_invalid');
 return 'iwxa.personal.home-dashboard.v1:'+encodeURIComponent(areaId);
}
export function parseDashboard(value:unknown):DashboardLayout{
 if(!value||typeof value!=='object'||Array.isArray(value))
  return structuredClone(DEFAULT_DASHBOARD);
 const input=value as Record<string,unknown>;
 if(input.schema!==DASHBOARD_SCHEMA||!Array.isArray(input.widgets)||input.widgets.length>24)
  return structuredClone(DEFAULT_DASHBOARD);
 const ids=new Set<string>(),identities=new Set<string>(),widgets:DashboardWidget[]=[];
 for(const raw of input.widgets){
  if(!raw||typeof raw!=='object'||Array.isArray(raw))
   return structuredClone(DEFAULT_DASHBOARD);
  const w=raw as Record<string,unknown>;
  if(typeof w.id!=='string'||!/^[A-Za-z0-9_-]{1,90}$/.test(w.id)||ids.has(w.id)||
    !KINDS.includes(w.kind as WidgetKind)||![4,6,12].includes(w.span as number))
   return structuredClone(DEFAULT_DASHBOARD);
  if(w.kind==='program-shortcut'?!KNOWN_PROGRAMS.has(w.program as ProgramShortcut):w.program!==undefined)
   return structuredClone(DEFAULT_DASHBOARD);
  const identity=w.kind==='program-shortcut'?w.kind+':'+String(w.program):String(w.kind);
  if(identities.has(identity))return structuredClone(DEFAULT_DASHBOARD);
  identities.add(identity);
  ids.add(w.id);
  widgets.push({id:w.id,kind:w.kind as WidgetKind,span:w.span as WidgetSpan,
   ...(w.kind==='program-shortcut'?{program:w.program as ProgramShortcut}:{})});
 }
 return {schema:DASHBOARD_SCHEMA,widgets};
}
export function moveDashboardWidget(layout:DashboardLayout,fromId:string,toId:string):DashboardLayout{
 const source=layout.widgets.findIndex(w=>w.id===fromId),
  target=layout.widgets.findIndex(w=>w.id===toId);
 if(source<0||target<0||source===target)return layout;
 const widgets=layout.widgets.slice(),[moved]=widgets.splice(source,1);
 widgets.splice(target,0,moved);
 return {schema:DASHBOARD_SCHEMA,widgets};
}
export function resizeDashboardWidget(layout:DashboardLayout,id:string,span:WidgetSpan):DashboardLayout{
 if(![4,6,12].includes(span))return layout;
 return {...layout,widgets:layout.widgets.map(w=>w.id===id?{...w,span}:w)};
}
export function removeDashboardWidget(layout:DashboardLayout,id:string):DashboardLayout{
 return {...layout,widgets:layout.widgets.filter(w=>w.id!==id)};
}
export function addDashboardWidget(layout:DashboardLayout,widget:DashboardWidget):DashboardLayout{
 if(layout.widgets.length>=24||layout.widgets.some(w=>w.id===widget.id))return layout;
 const next=parseDashboard({schema:DASHBOARD_SCHEMA,widgets:[...layout.widgets,widget]});
 return next.widgets.length===layout.widgets.length+1?next:layout;
}
