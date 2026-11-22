import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const ts=createRequire(import.meta.url)('typescript');
const file=fileURLToPath(new URL('../src/work-area-flow.ts',import.meta.url));
const compiled=ts.transpileModule(readFileSync(file,'utf8'),{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},
 reportDiagnostics:true
});
assert.deepEqual(compiled.diagnostics||[],[]);
const api=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputText).toString('base64'));

const PERSONAL={id:'personal',name:'Личное'};
function port(){
 const values={areas:[PERSONAL],active:'personal',commands:[],revision:0};
 return {values,
  refreshRevision:async()=>{values.revision++;},
  query:async(name)=>{
   if(name!=='work_areas')throw Error('unexpected '+name);
   return {active_id:values.active,areas:values.areas.map(x=>({...x})),catalog_digest:'digest'};
  },
  command:async(name,input)=>{
   values.commands.push([name,input]);
   if(name==='work_area_create'){
    const area={id:'AREA-012345abcdef',name:input.name};
    values.areas.push(area);
    return {area};
   }
   if(name==='work_area_select'){
    if(!values.areas.some(row=>row.id===input.area_id))throw Error('unknown_area');
    values.active=input.area_id;
    return {active_id:values.active,area:values.areas.find(row=>row.id===values.active)};
   }
   throw Error('unexpected '+name);
  }
 };
}
const policy={memory:false,obsidian:false,web:false,selected_notes:false};
test('create, select and restart restore the same Core-owned work area',async()=>{
 const p=port();
 const response=await api.createAndSelectWorkArea(p,{
  name:'Исследование',purpose:'',local_only:true,permissions:policy
 });
 assert.equal(response.active_id,'AREA-012345abcdef');
 assert.deepEqual(p.values.commands.map(row=>row[0]),['work_area_create','work_area_select']);
 assert.equal((await api.readWorkAreas(p)).active_id,'AREA-012345abcdef');
 await api.selectWorkArea(p,'personal');
 assert.equal((await api.readWorkAreas(p)).active_id,'personal');
 await api.selectWorkArea(p,'AREA-012345abcdef');
 assert.equal((await api.readWorkAreas(p)).active_id,'AREA-012345abcdef');
});
test('failed selection does not repeat the successful creation',async()=>{
 const p=port();
 const original=p.command;
 p.command=async(name,input)=>{
  if(name==='work_area_select')throw Error('synthetic_transport_error');
  return original(name,input);
 };
 await assert.rejects(()=>api.createAndSelectWorkArea(p,{
  name:'Исследование',purpose:'',local_only:true,permissions:policy
 }),/synthetic_transport_error/);
 assert.equal(p.values.commands.filter(x=>x[0]==='work_area_create').length,1);
 assert.equal(p.values.areas.length,2);
 assert.equal(p.values.active,'personal');
});
test('readback rejects false-positive success and untrusted active area',async()=>{
 const p=port();
 p.command=async()=>({active_id:'personal',area:PERSONAL});
 await assert.rejects(()=>api.selectWorkArea(p,'AREA-012345abcdef'),/selection_not_confirmed/);
 p.query=async()=>({active_id:'AREA-something',areas:[PERSONAL],catalog_digest:'digest'});
 await assert.rejects(()=>api.readWorkAreas(p),/catalog_readback_invalid/);
 await assert.rejects(()=>api.selectWorkArea(p,'../escape'),/selection_invalid/);
});

test('local work area controls expose permissioned local sources but never web search',()=>{
 const src=readFileSync(new URL('../src/work-areas-control.tsx',import.meta.url),'utf8');
 const parsed=ts.createSourceFile('component.tsx',src,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
 assert.deepEqual(parsed.parseDiagnostics,[]);
 assert.match(src,/Object\.keys\(permissions\)\.filter\(key=>!localOnly\|\|key!=='web'\)/);
 assert.match(src,/Object\.keys\(editPermissions\)\.filter\(key=>!editLocal\|\|key!=='web'\)/);
 assert.match(src,/permissions:localOnly\?\{\.\.\.permissions,web:false\}:permissions/);
 assert.match(src,/permissions:editLocal\?\{\.\.\.editPermissions,web:false\}:editPermissions/);
});

test('task composer uses existing per-area permissions for local memory and vault sources',()=>{
 const src=readFileSync(new URL('../src/workbench.tsx',import.meta.url),'utf8');
 const parsed=ts.createSourceFile('component.tsx',src,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
 assert.deepEqual(parsed.parseDiagnostics,[]);
 assert.match(src,/use_memory:sent\.files\.length===0&&useMemory&&activeArea\.permissions\.memory/);
 assert.match(src,/use_obsidian:sent\.files\.length===0&&sent\.knowledgeSources\.length===0&&useObsidian&&activeArea\.permissions\.obsidian/);
 assert.match(src,/use_web:sent\.files\.length===0&&useWeb&&!activeArea\.local_only&&activeArea\.permissions\.web/);
 assert.match(src,/if\(!activeArea\.permissions\.selected_notes&&knowledgeSources\.length\)/);
});

test('automation form pins work area and Core validates it at command time',()=>{
 const ui=readFileSync(new URL('../src/automations-control.tsx',import.meta.url),'utf8');
 const parsed=ts.createSourceFile('automations-control.tsx',ui,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
 assert.deepEqual(parsed.parseDiagnostics,[]);
 assert.match(ui,/workspaceId:activeWorkspaceId/);
 assert.match(ui,/initialDraft\(activeAreaId\)/);
 assert.match(ui,/setDraft\(previous=>previous&&!previous\.workspaceId/);
 assert.match(ui,/const selectedArea=draft\.workspaceId/);
 const checked=ui.indexOf("runtime.query<{active_id:string;areas:{id:string;name:string}[]}>('work_areas')");
 const dispatched=ui.indexOf("const out=await run<Row>(label,command,input");
 assert.ok(checked>=0&&dispatched>checked);
 assert.match(ui,/expected_workspace_id:selectedArea/);
 assert.match(ui,/live\.active_id!==selectedArea/);
});

test('automation history is read-only and bound to exact job and immutable run receipts',()=>{
 const ui=readFileSync(new URL('../src/automations-control.tsx',import.meta.url),'utf8');
 const parsed=ts.createSourceFile('automations-control.tsx',ui,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
 assert.deepEqual(parsed.parseDiagnostics,[]);
 const start=ui.indexOf('async function showHistory(jobId:string)');
 const end=ui.indexOf('function hideHistory()',start);
 assert.ok(start>=0&&end>start);
 const load=ui.slice(start,end);
 assert.match(load,/runtime\.query<Row>\('automation_jobs',\{job_id:jobId\}\)/);
 assert.match(load,/str\(selected\[0\]\.job_id\)!==jobId/);
 assert.match(load,/item\.read_only!==true\|\|str\(item\.job_id\)!==jobId/);
 assert.match(load,/item\.run_digest/);
 assert.match(load,/historyRequest\.current/);
 assert.doesNotMatch(load,/runtime\.command|automation_resume|automation_run_due/);
 assert.match(ui,/out\.verified===true/);
 assert.match(ui,/result\.verified===true/);
 assert.match(ui,/onOpenTask\(str\(result\.task_id\)\)/);
});

test('Workspace task projection is verified against the selected area before display',async()=>{
 const p=port();
 p.query=async(name)=>{
  if(name==='work_areas')return {active_id:'personal',areas:[PERSONAL],catalog_digest:'digest'};
  if(name==='work_area_tasks')return {area_id:'personal',tasks:[{id:'TASK-one',status:'created'}]};
  throw Error('unexpected '+name);
 };
 const snapshot=await api.readActiveWorkAreaTasks(p);
 assert.equal(snapshot.catalog.active_id,'personal');
 assert.deepEqual(snapshot.tasks,[{id:'TASK-one',status:'created'}]);
 p.query=async name=>name==='work_areas'
  ?{active_id:'personal',areas:[PERSONAL],catalog_digest:'digest'}
  :{area_id:'AREA-other',tasks:[{id:'TASK-private'}]};
 await assert.rejects(()=>api.readActiveWorkAreaTasks(p),/work_area_tasks_readback_mismatch/);
});
test('Workspace switch during Task read fails closed rather than mixing projections',async()=>{
 const p=port();
 let catalogReads=0;
 p.query=async name=>{
  if(name==='work_areas'){
   catalogReads++;
   const active=catalogReads===1?'personal':'AREA-next';
   return {active_id:active,areas:[PERSONAL,{id:'AREA-next'}],catalog_digest:'digest'};
  }
  if(name==='work_area_tasks')return {area_id:'personal',tasks:[{id:'TASK-old'}]};
  throw Error('unexpected '+name);
 };
 await assert.rejects(()=>api.readActiveWorkAreaTasks(p),/work_area_context_changed_during_readback/);
});
test('Workspace and Task screens share the verified Core area projection',()=>{
 const bench=readFileSync(new URL('../src/workbench.tsx',import.meta.url),'utf8');
 const areas=readFileSync(new URL('../src/work-areas-control.tsx',import.meta.url),'utf8');
 assert.match(bench,/readActiveWorkAreaTasks<Task>\(runtime\)/);
 assert.match(bench,/epoch!==workAreaReadEpoch\.current/);
 assert.match(areas,/readActiveWorkAreaTasks<Row>\(runtime\)/);
 assert.match(areas,/epoch!==readEpoch\.current/);
});

test('confirmed Workspace selection invalidates previous Task detail reads',()=>{
 const bench=readFileSync(new URL('../src/workbench.tsx',import.meta.url),'utf8');
 const begin=bench.indexOf('const loadWorkAreas=async(knownAreaId?:string)=>');
 const end=bench.indexOf(' // One initial Workspace/Task/status projection',begin);
 assert.ok(begin>=0&&end>begin);
 const change=bench.slice(begin,end);
 assert.match(change,/taskReadSequence\.current\+\+/);
 assert.ok(change.indexOf('taskReadSequence.current++')<change.indexOf('setActiveArea(area)'));
 const taskRead=bench.indexOf('async function openTask(');
 const detail=bench.indexOf('read!==taskReadSequence.current',taskRead);
 assert.ok(taskRead>=0);
 assert.match(bench.slice(taskRead,taskRead+1800),/sequence!==taskReadSequence\.current/);
});

test('external Workspace selection clears stale Task and Review state before a refresh commits',()=>{
 const bench=readFileSync(new URL('../src/workbench.tsx',import.meta.url),'utf8');
 const refreshStart=bench.indexOf('async function refresh(){');
 const refreshEnd=bench.indexOf('async function refreshModelState()',refreshStart);
 assert.ok(refreshStart>=0&&refreshEnd>refreshStart);
 const code=bench.slice(refreshStart,refreshEnd);
 assert.match(code,/committedWorkAreaId\.current!==area\.id/);
 assert.match(code,/taskReadSequence\.current\+\+/);
 assert.match(code,/setSelected\(''\);setDetail\(null\);setDetailFresh\(false\)/);
 assert.match(code,/setNavigationRestored\(false\)/);
 assert.ok(code.indexOf("setSelected('');setDetail(null)")<code.indexOf("setActiveArea(area)"));
});

test('Workspace selection does not mutate Core when draft preflight fails',async()=>{
 const p=port();
 p.values.areas.push({id:'AREA-next',name:'Other'});
 await assert.rejects(()=>api.selectWorkArea(p,'AREA-next',async()=>{
  throw Error('document_draft_not_saved');
 }),/document_draft_not_saved/);
 assert.equal(p.values.active,'personal');
 assert.deepEqual(p.values.commands,[]);
 assert.equal(p.values.revision,0);
});

test('Workspace creation does not create an orphan when editor flush fails',async()=>{
 const p=port();
 await assert.rejects(()=>api.createAndSelectWorkArea(p,{
  name:'New workspace',purpose:'',local_only:true,permissions:policy
 },async()=>{throw Error('dialogue_draft_not_saved')}),/dialogue_draft_not_saved/);
 assert.deepEqual(p.values.commands,[]);
 assert.equal(p.values.areas.length,1);
});

test('verified flush runs before the only Core switch command',async()=>{
 const p=port();p.values.areas.push({id:'AREA-next'});
 const order=[];
 const command=p.command;
 p.command=async(name,input)=>{order.push(name);return command(name,input);};
 const switched=await api.selectWorkArea(p,'AREA-next',async()=>{
  order.push('flush_document_task_dialogue');
  assert.deepEqual(p.values.commands,[]);
 });
 assert.equal(switched.active_id,'AREA-next');
 assert.deepEqual(order,['flush_document_task_dialogue','work_area_select']);
});

test('Workspace UI binds preflight to shared close readback without deleting drafts',()=>{
 const view=readFileSync(new URL('../src/workbench.tsx',import.meta.url),'utf8');
 const controls=readFileSync(new URL('../src/work-areas-control.tsx',import.meta.url),'utf8');
 assert.match(view,/onBeforeSwitch=\{async\(\)=>\{/);
 assert.match(view,/beforeWorkspaceSwitch\('Рабочие области',activeArea\?\.id\|\|'',true\)/);
 assert.match(view,/await closeFlushRef\.current\(\)/);
 assert.match(view,/taskDispatchUnknown\.current\|\|pendingTask/);
 assert.match(controls,/createAndSelectWorkArea\(runtime,input as Parameters<typeof createAndSelectWorkArea>\[1\],preflight\)/);
 assert.match(controls,/selectWorkArea\(runtime,str\(input\.area_id\),preflight\)/);
 assert.match(controls,/if\(switching&&!onSwitchBegin\(\)\)/);
 assert.match(controls,/finally\{setBusy\(false\);if\(switching\)onSwitchEnd\(\);\}/);
});


test('exact Task open requires positive membership and prevents cross-Workspace detail access',async()=>{
 const p=port(),taskId='TASK-verified';
 const calls=[];
 p.query=async(name,params={})=>{
  calls.push([name,params]);
  if(name==='work_areas')return {active_id:'personal',areas:[PERSONAL],catalog_digest:'digest'};
  if(name==='work_area_tasks')return {area_id:'personal',read_only:true,tasks:[{id:taskId}]};
  if(name==='task')return {task_id:taskId,status:'closed',objective:'Accepted'};
  throw Error('unexpected query '+name);
 };
 const result=await api.readTaskInActiveWorkArea(p,taskId);
 assert.equal(result.task.task_id,taskId);
 assert.deepEqual(calls.map(row=>row[0]),['work_areas','work_area_tasks','task','work_areas']);
 assert.deepEqual(calls[1][1],{area_id:'personal',task_id:taskId});
 assert.deepEqual(calls[2][1],{task_id:taskId});
 assert.deepEqual(p.values.commands,[]);
 p.query=async name=>name==='work_areas'
  ?{active_id:'personal',areas:[PERSONAL],catalog_digest:'digest'}
  :{area_id:'personal',read_only:true,tasks:[]};
 await assert.rejects(()=>api.readTaskInActiveWorkArea(p,taskId),/work_area_task_not_in_active_workspace/);
});

test('Task open fails closed on readback switch, mismatch or wrong status',async()=>{
 const p=port(),taskId='TASK-verified';
 for(const bad of ['other area','other task','no read-only claim','workspace switched']){
  let reads=0;
  p.query=async name=>{
   if(name==='work_areas'){
    reads++;
    const current=bad==='workspace switched'&&reads>1?'AREA-other':'personal';
    return {active_id:current,areas:[PERSONAL,{id:'AREA-other'}],catalog_digest:'digest'};
   }
   if(name==='work_area_tasks')return {area_id:bad==='other area'?'AREA-other':'personal',
    read_only:bad!=='no read-only claim',tasks:[{id:taskId}]};
   if(name==='task')return {task_id:bad==='other task'?'TASK-different':taskId,status:'closed'};
   throw Error('unexpected');
  };
  await assert.rejects(()=>api.readTaskInActiveWorkArea(p,taskId),
   /work_area_task_not_in_active_workspace|work_area_task_identity_mismatch|work_area_context_changed_during_task_readback/);
 }
 await assert.rejects(()=>api.readTaskInActiveWorkArea(p,'TASK-../escape'),/work_area_task_id_invalid/);
});

test('Task opening keeps old selection until scoped detail is verified',()=>{
 const bench=readFileSync(new URL('../src/workbench.tsx',import.meta.url),'utf8');
 const start=bench.indexOf('async function openTask('),end=bench.indexOf('useEffect(()=>{let active=true;',start);
 const open=bench.slice(start,end);
 assert.match(open,/readTaskInActiveWorkArea<Detail>\(runtime,id,committedWorkAreaId\.current\|\|undefined\)/);
 assert.ok(open.indexOf('setSelected(id)')>open.indexOf('readTaskInActiveWorkArea<Detail>'));
 assert.match(bench,/readTaskInActiveWorkArea<Detail>\(runtime,currentTask\)/);
 assert.match(bench,/readTaskInActiveWorkArea<Detail>\(runtime,request\.taskId\)/);
});

test('Workspace editor error fallback remains parseable and preserves the original error',()=>{
 const source=readFileSync(new URL('../src/work-areas-control.tsx',import.meta.url),'utf8');
 const parsed=ts.createSourceFile('work-areas-control.tsx',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
 assert.deepEqual(parsed.parseDiagnostics,[]);
 assert.match(source,/reason\.startsWith\('work_area_creation_'\)/);
 assert.match(source,/try\{await onChanged\(switching&&preflightPassed\);\}catch/);
 assert.match(source,/try\{await load\(\);\}catch/);
});

test('sidebar selection runs Core Workspace admission only after draft readback',()=>{
 const view=readFileSync(new URL('../src/workbench.tsx',import.meta.url),'utf8');
 const css=readFileSync(new URL('../src/style.css',import.meta.url),'utf8');
 const parsed=ts.createSourceFile('workbench.tsx',view,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
 assert.deepEqual(parsed.parseDiagnostics,[]);
 assert.match(view,/className="workspace-switcher"/);
 assert.match(view,/onChange=\{e=>void switchWorkspaceFromSidebar\(e\.currentTarget\.value\)\}/);
 assert.match(view,/workAreas\.map\(area=><option/);
 const start=view.indexOf(' async function switchWorkspaceFromSidebar(');
 const stop=view.indexOf(' useEffect(()=>{',start);
 assert.ok(start>=0&&stop>start);
 const body=view.slice(start,stop);
 assert.match(body,/await selectWorkArea\(runtime,targetId,async\(\)=>\{/);
 assert.ok(body.indexOf('await beforeWorkspaceSwitch(')<body.indexOf('admissionPassed=true'));
 assert.match(body,/await loadWorkAreas\(targetId\)/);
 assert.match(body,/if\(admissionPassed\)invalidateUnverifiedWorkspace\(\)/);
 assert.doesNotMatch(body,/createAndSelectWorkArea|localStorage|sessionStorage/);
 const guard=view.slice(view.indexOf(' async function beforeWorkspaceSwitch('),start);
 assert.match(guard,/await closeFlushRef\.current\(\)/);
 assert.match(guard,/await readWorkAreas\(runtime\)/);
 assert.match(guard,/followupInFlight\.current/);
 assert.ok(guard.indexOf('await closeFlushRef.current()')<guard.indexOf('await readWorkAreas(runtime)'));
 assert.match(view,/submitInFlight\.current\|\|reviewInFlight\.current\|\|followupInFlight\.current/);
 assert.match(css,/\.space-list\{display:flex;align-items:center/);
});

test('both Workspace switches share one lock and cannot flush the former editor after switch',()=>{
 const view=readFileSync(new URL('../src/workbench.tsx',import.meta.url),'utf8');
 const control=readFileSync(new URL('../src/work-areas-control.tsx',import.meta.url),'utf8');
 const begin=view.indexOf('const loadWorkAreas=async(knownAreaId?:string)=>');
 const end=view.indexOf(' // One initial Workspace/Task/status projection',begin);
 const loading=view.slice(begin,end);
 assert.ok(begin>=0&&end>begin);
 assert.match(loading,/setPageState\('Главная'\)/);
 assert.doesNotMatch(loading,/setPage\('Главная'\)/);
 assert.match(loading,/externalChange=changed&&committedWorkAreaId\.current!==null/);
 const sidebar=view.slice(view.indexOf(' async function switchWorkspaceFromSidebar('),
  view.indexOf(' useEffect(()=>{',view.indexOf(' async function switchWorkspaceFromSidebar(')));
 assert.match(sidebar,/!beginWorkspaceSwitch\(\)/);
 assert.match(sidebar,/await loadWorkAreas\(targetId\)/);
 assert.match(sidebar,/finally\{finishWorkspaceSwitch\(\);\}/);
 assert.match(view,/onSwitchBegin=\{beginWorkspaceSwitch\} onSwitchEnd=\{finishWorkspaceSwitch\}/);
 assert.match(view,/onChanged=\{async\(switchAttempted\)=>\{/);
 assert.match(view,/if\(switchAttempted\)invalidateUnverifiedWorkspace\(\)/);
 assert.match(view,/lockedSwitch\?workspaceSwitchInFlight\.current:!workspaceSwitchInFlight\.current/);
 assert.match(control,/await onChanged\(switching&&preflightPassed\);await load\(\)/);
 assert.match(control,/if\(switching&&!onSwitchBegin\(\)\)/);
 assert.match(control,/if\(switching\)onSwitchEnd\(\)/);
 const close=view.slice(view.indexOf('windowHandle.onCloseRequested('),
  view.indexOf('.then(fn=>{if(active)unlisten=fn()'));
 assert.match(close,/event\.preventDefault\(\);\s*if\(exitWithoutSaveRequested\.current\)return;\s*if\(workspaceSwitchInFlight\.current\)/);
 assert.ok(close.indexOf('if(workspaceSwitchInFlight.current)')<close.indexOf('windowHandle.destroy()'));
});

test('J3 readback failure revokes the old Task before any further action',()=>{
 const bench=readFileSync(new URL('../src/workbench.tsx',import.meta.url),'utf8');
 const start=bench.indexOf(' async function refresh(){');
 const end=bench.indexOf(' async function refreshDocumentTask(',start);
 const refresh=bench.slice(start,end);
 assert.match(refresh,/setAreaLoaded\(false\);setDetailFresh\(false\)/);
 assert.match(refresh,/const externalChange=committedWorkAreaId\.current!==null/);
 assert.match(refresh,/setPageState\('Главная'\)/);
 assert.match(refresh,/setDocumentTab\('result'\)/);
 // The initial effect delegates to refresh(), whose failure must revoke
 // stale Task controls rather than retaining an earlier Workspace.
 assert.match(bench,/useEffect\(\(\)=>\{\s*const pending=refresh\(\)/);
 assert.match(bench,/startupWorkspaceRead\.current=pending/);
 assert.match(refresh,/setStatus\(statusRead\.status==='fulfilled'\?statusRead\.value:null\)/);
 assert.match(refresh,/if\(areaRead\.status==='rejected'\)\{\s*setAreaLoaded\(false\);setDetailFresh\(false\)/);
 const close=bench.slice(bench.indexOf(' const flushBeforeWindowClose=async()=>'),
  bench.indexOf(' const closeFlushRef=useRef('));
 assert.ok(close.indexOf('const initial=await readWorkAreas(runtime)')<
  close.indexOf('if(navigationSave.current)'));
 assert.ok(close.indexOf('const last=await readWorkAreas(runtime)')>
  close.indexOf('if(conversationCloseFlush.current)'));
 assert.match(close,/last.active_id!==expectedArea\|\|committedWorkAreaId\.current!==expectedArea/);
});

test('document attachment readback stays in the original Workspace after asynchronous reads',async()=>{
 const taskId='TASK-SOURCE-123',snapshotId='CSN-1234567890';
 const path='attachments/00-evidence.txt',sha256='a'.repeat(64);
 const input={areaId:'personal',taskId,snapshotId,path,sha256};
 const selected={task_id:taskId,snapshot_id:snapshotId,path,sha256,
  text:'Exact local source'};
 const p=port();
 const calls=[];
 p.query=async(name,args)=>{
  calls.push(name);
  if(name==='task_document_source'){
   assert.deepEqual(args,{task_id:taskId,snapshot_id:snapshotId,path,expected_sha256:sha256});
   return selected;
  }
  if(name==='work_areas')
   return {active_id:p.values.active,areas:p.values.areas,catalog_digest:'digest'};
  throw Error('unexpected '+name);
 };
 assert.deepEqual(await api.readDocumentSourceInActiveWorkArea(p,input),selected);
 assert.deepEqual(calls,['task_document_source','work_areas']);
 assert.deepEqual(p.values.commands,[]);
 // A delayed Core reply must not be shown if another window switched areas.
 p.query=async name=>{
  if(name==='task_document_source'){
   p.values.active='AREA-other';
   p.values.areas.push({id:'AREA-other'});
   return selected;
  }
  if(name==='work_areas')
   return {active_id:p.values.active,areas:p.values.areas,catalog_digest:'digest'};
  throw Error('unexpected '+name);
 };
 await assert.rejects(()=>api.readDocumentSourceInActiveWorkArea(p,input),
  /document_source_readback_context_changed/);
 // A matching active area cannot make a different Task/source look verified.
 p.values.active='personal';
 for(const change of [{task_id:'TASK-foreign'},{snapshot_id:'CSN-other'},
   {path:'attachments/01-other.txt'},{sha256:'b'.repeat(64)},{text:null}]){
  p.query=async name=>name==='task_document_source'?{...selected,...change}:
   {active_id:'personal',areas:p.values.areas,catalog_digest:'digest'};
  await assert.rejects(()=>api.readDocumentSourceInActiveWorkArea(p,input),
   /document_source_readback_context_changed/);
 }
 for(const bad of [{taskId:'../foreign'}, {snapshotId:'OTHER'},
   {path:'../source'}, {sha256:'wrong'}]){
  await assert.rejects(()=>api.readDocumentSourceInActiveWorkArea(p,{...input,...bad}),
   /document_source_request_invalid/);
 }
 assert.deepEqual(p.values.commands,[]);
});

test('already selected Workspace opens a Task with three reads, not four',async()=>{
 const calls=[];
 const port={query:async(name,params)=>{
  calls.push(name);
  if(name==='work_areas')return {active_id:'personal',catalog_digest:'known',areas:[{id:'personal'}]};
  if(name==='work_area_tasks')return{area_id:'personal',read_only:true,tasks:[{id:'TASK-example'}]};
  if(name==='task')return{task_id:'TASK-example',objective:'An existing Task'};
  throw Error('unexpected query: '+name);
 }};
 const value=await api.readTaskInActiveWorkArea(port,'TASK-example','personal');
 assert.equal(value.task.objective,'An existing Task');
 assert.equal(calls.length,3);
 assert.equal(calls.filter(x=>x==='work_areas').length,1);
 const cold=[];
 const coldPort={query:async(name,params)=>{cold.push(name);return port.query(name,params);}};
 await api.readTaskInActiveWorkArea(coldPort,'TASK-example');
 assert.equal(cold.length,4);
});

test('known Workspace Task list skips redundant initial catalog read',async()=>{
 const calls=[];
 const port={query:async(name)=>{
  calls.push(name);
  if(name==='work_areas')return{active_id:'personal',catalog_digest:'known',areas:[{id:'personal'}]};
  if(name==='work_area_tasks')return{area_id:'personal',tasks:[{id:'TASK-example'}]};
  throw Error('unexpected query');
 }};
 const snapshot=await api.readActiveWorkAreaTasks(port,100,'personal');
 assert.equal(snapshot.tasks.length,1);
 assert.deepEqual(calls,['work_area_tasks','work_areas']);
});
