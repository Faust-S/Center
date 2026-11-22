import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const source=readFileSync(new URL('../src/home-dashboard-model.ts',import.meta.url),'utf8');
const transpiled=ts.transpileModule(source,{
 compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},
 reportDiagnostics:true
});
assert.deepEqual(transpiled.diagnostics||[],[]);
const api=await import('data:text/javascript;base64,'+Buffer.from(transpiled.outputText).toString('base64'));
const copy=()=>api.parseDashboard(api.DEFAULT_DASHBOARD);

test('each Workspace has an independent dashboard presentation key',()=>{
 const personal=api.dashboardStorageKey('personal'),company=api.dashboardStorageKey('AREA-123');
 assert.notEqual(personal,company);
 assert.equal(api.dashboardStorageKey('AREA-123'),company);
 assert.throws(()=>api.dashboardStorageKey(''),/workspace_invalid/);
});
test('default layout preserves the original request and recent work paths',()=>{
 const layout=copy();
 assert.equal(layout.schema,api.DASHBOARD_SCHEMA);
 assert.deepEqual(layout.widgets.map(x=>x.kind).slice(0,2),['composer','recent']);
 assert.ok(layout.widgets.some(w=>w.kind==='review'));
 assert.equal(layout.widgets[0].span,12);
});
test('user may reorder, resize and remove without changing other blocks',()=>{
 const first=copy();
 const second=api.moveDashboardWidget(first,'home-recent','home-composer');
 assert.deepEqual(second.widgets.map(w=>w.id).slice(0,2),['home-recent','home-composer']);
 assert.equal(first.widgets[0].id,'home-composer');
 const resized=api.resizeDashboardWidget(second,'home-recent',4);
 assert.equal(resized.widgets[0].span,4);
 const removed=api.removeDashboardWidget(resized,'home-recent');
 assert.equal(removed.widgets.some(w=>w.id==='home-recent'),false);
 assert.deepEqual(api.moveDashboardWidget(first,'nonexistent','home-recent'),first);
});
test('new cards may select known program targets only',()=>{
 let layout=copy();
 layout=api.addDashboardWidget(layout,{id:'custom-one',kind:'program-shortcut',span:6,program:'external:n8n'});
 assert.equal(layout.widgets.at(-1).program,'external:n8n');
 assert.equal(api.addDashboardWidget(layout,{id:'custom-one',kind:'files',span:6}),layout);
 assert.deepEqual(api.addDashboardWidget(layout,{id:'danger',kind:'program-shortcut',span:6,
   program:'external:unknown'}),layout);
});
test('saved layout validator rejects unknown sources and malformed storage',()=>{
 for(const bad of [null,{schema:'legacy',widgets:[]},{schema:api.DASHBOARD_SCHEMA,widgets:[{id:'bad',kind:'unsafe',span:6}]},
  {schema:api.DASHBOARD_SCHEMA,widgets:[{id:'x',kind:'program-shortcut',span:6,program:'evil'}]},
  {schema:api.DASHBOARD_SCHEMA,widgets:[{id:'x',kind:'files',span:6},{id:'x',kind:'files',span:6}]},
  {schema:api.DASHBOARD_SCHEMA,widgets:[{id:'one',kind:'composer',span:12},{id:'two',kind:'composer',span:6}]},
  {schema:api.DASHBOARD_SCHEMA,widgets:[{id:'one',kind:'program-shortcut',span:6,program:'external:n8n'},{id:'two',kind:'program-shortcut',span:4,program:'external:n8n'}]},
  {schema:api.DASHBOARD_SCHEMA,widgets:[{id:'x',kind:'composer',span:3}]}]){
  assert.deepEqual(api.parseDashboard(bad),api.DEFAULT_DASHBOARD);
 }
 assert.deepEqual(api.parseDashboard({schema:api.DASHBOARD_SCHEMA,widgets:[]}).widgets,[]);
});
test('React dashboard uses real Task scope and does not add a parallel Task owner',()=>{
 const ui=readFileSync(new URL('../src/home-dashboard.tsx',import.meta.url),'utf8');
 const parser=ts.createSourceFile('home-dashboard.tsx',ui,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
 assert.deepEqual(parser.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[]);
 for(const term of ['dashboardStorageKey(areaId)','taskComposer','onOpenTask(task.id)','onNavigate(page)',
  'onPointerDown={event=>handlePointerDown(event,w.id)}','setPointerCapture',
  'pointerTarget(event.clientX,event.clientY)','resizeDashboardWidget','removeDashboardWidget',
  'PROGRAM_SHORTCUTS','taskSources.slice(0,5)','readHomeLive(runtime,areaId']){
  assert.ok(ui.includes(term),term);
 }
 const workbench=readFileSync(new URL('../src/workbench.tsx',import.meta.url),'utf8');
 assert.ok(workbench.includes('key={activeArea.id} areaId={activeArea.id}'));
 assert.ok(workbench.includes('onOpenTask={id=>void openTask(id)}'));
 assert.ok(workbench.includes('taskSources={verifiedSelectedTask?overviewSources.map'));
 assert.ok(workbench.includes('onOpenProgram={program=>'));


 assert.equal(workbench.includes("page==='Главная'&&taskComposer"),false);
});
