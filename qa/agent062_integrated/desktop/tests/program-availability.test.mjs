import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';

const require=createRequire(import.meta.url);
const ts=require('typescript');
const source=readFileSync(new URL('../src/program-availability.ts',import.meta.url),'utf8');
const transpiled=ts.transpileModule(source,{reportDiagnostics:true,compilerOptions:{
  module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022
}});
assert.deepEqual(transpiled.diagnostics||[],[]);
const exports={};
new Function('exports','require',transpiled.outputText)(exports,require);
const {programAvailability,programWorkState,networkActionAvailable}=exports;

test('a verified local connection is ready even without an EXE',()=>{
 assert.equal(programAvailability(false,false,true),'READY');
 assert.equal(programAvailability(true,false,true),'READY');
 assert.equal(programAvailability(false,true,true),'READY');
});
test('installed and staged programs without execution evidence need checking',()=>{
 assert.equal(programAvailability(true,false,false),'NEEDS_CHECK');
 assert.equal(programAvailability(false,true,false),'NEEDS_CHECK');
 assert.equal(programAvailability(false,false,false),'NOT_CONNECTED');
});
test('Core facts distinguish discovery, connection, readiness and real execution',()=>{
 const stage=facts=>programWorkState({detected:false,connected:false,ready:false,executed:false,...facts});
 assert.equal(stage({}),'NOT_DETECTED');
 assert.equal(stage({detected:true}),'DETECTED');
 assert.equal(stage({connected:true}),'CONNECTED');
 assert.equal(stage({ready:true}),'READY_FOR_TASK');
 assert.equal(stage({executed:true}),'EXECUTED');
 assert.equal(stage({executionFailed:true}),'EXECUTION_FAILED');
 assert.equal(stage({detected:true,connected:false}),'DETECTED');
 assert.equal(stage({detected:false,ready:true}),'READY_FOR_TASK');
});
test('a network action requires T3 OFF confirmed by Core',()=>{
 assert.equal(networkActionAvailable(true),false);
 assert.equal(networkActionAvailable(null),false);
 assert.equal(networkActionAvailable(false),true);
});
test('Programs uses Core readiness and guards network actions',()=>{
 const ui=readFileSync(new URL('../src/programs-center.tsx',import.meta.url),'utf8');
 assert.match(ui,/const readyPrograms=programs.filter\(p=>verified\(p\)\)/);
 assert.match(ui,/const workState=\(p:Row\):ProgramWorkState=>/);
 assert.match(ui,/return programWorkState\(\{detected,connected,ready,executed:false\}\)/);
 assert.doesNotMatch(ui,/executed:\(id==='GOOSE_PRIMARY_V1'\|\|id==='OLLAMA_LOCAL_V1'\)/);
 // Current program health may be a probe response, not proof of a Task/Result.
 assert.match(ui,/A model probe or runtime verification is not a completed user Task/);
 assert.match(ui,/stateLabel\(workState\(p\)\)/);
 assert.match(ui,/execution_verified_for_current_identity===true/);
 assert.match(ui,/row.route_admissible===true/);
 assert.match(ui,/connectedJoplin\?\.status==='connected'/);
 assert.match(ui,/!networkActionAvailable\(t3Enabled\)/);
});

test('known installed note programs remain visible if category metadata is unavailable',()=>{
 const ui=readFileSync(new URL('../src/programs-center.tsx',import.meta.url),'utf8');
 assert.match(ui,/const categoriesFor=\(id:string\)=>/);
 assert.match(ui,/id==='JOPLIN_V1'\|\|id==='OBSIDIAN_V1'\?\['KNOWLEDGE','MEMORY'\]/);
 assert.match(ui,/matchesCategory\(categoriesFor\(str\(p.runtime_id\)\)\)/);
});

test('Joplin keeps the saved Core connection usable without entering a new token',()=>{
 const ui=readFileSync(new URL('../src/programs-center.tsx',import.meta.url),'utf8');
 const readback=ui.slice(ui.indexOf('async function readJoplinConnection()'),ui.indexOf('async function inspectJoplin()'));
 const inspect=ui.slice(ui.indexOf('async function inspectJoplin()'),ui.indexOf('async function connectJoplin()'));
 assert.match(readback,/knowledge_workspaces/);
 assert.match(readback,/include_file_count:false/);
 assert.match(readback,/projection\.slot_id!=='human_knowledge_workspace'/);
 assert.match(readback,/row\.provider_id==='JOPLIN_V1'&&row\.active===true/);
 assert.match(readback,/connected\?\.status==='connected'&&record\(connected\?\.health\)\.ready===true/);
 assert.doesNotMatch(readback+inspect,/provider_connection_configure|access_token|joplinToken/);
 assert.match(ui,/onClick=\{\(\)=>void inspectJoplin\(\)\}/);
 assert.match(ui,/programHealth\.JOPLIN_V1===true&&<button type="button" onClick=\{\(\)=>\{setOpenProgram\(''\);onNavigate\('Знания'\)\}\}/);
 assert.match(ui,/open=\{programHealth\.JOPLIN_V1!==true\}/);
 assert.match(ui,/Новое подключение не подтверждено\. Проверьте текущий доступ без повторного сохранения токена/);
});
test('the newer Programs refresh wins over earlier asynchronous responses',()=>{
 const ui=readFileSync(new URL('../src/programs-center.tsx',import.meta.url),'utf8');
 assert.match(ui,/const loadSequence=useRef\(0\)/);
 assert.match(ui,/const seq=\+\+loadSequence\.current/);
 assert.match(ui,/if\(seq!==loadSequence\.current\)return;/);
 assert.match(ui,/return\(\)=>\{loadSequence\.current\+\+\}/);
 const jsx=ts.transpileModule(ui,{reportDiagnostics:true,compilerOptions:{
  module:ts.ModuleKind.ESNext,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX
 }});
 assert.deepEqual(jsx.diagnostics||[],[]);
});


test('Ollama system adoption and managed selection require persisted Core readback before Models',()=>{
 const ui=readFileSync(new URL('../src/programs-center.tsx',import.meta.url),'utf8');
 const selection=ui.slice(ui.indexOf('async function selectedOllamaRuntime('),ui.indexOf('async function connectInstalledOllama()'));
 assert.match(selection,/runtime\.query<Row>\('existing_software'\)/);
 assert.match(selection,/row\?\.selected_source===expected/);
 assert.match(selection,/row\?\.system_adopted===true&&row\?\.system_installation_detected===true/);
 assert.match(selection,/record\(row\?\.managed\)\.staged===true/);
 const system=ui.slice(ui.indexOf('async function connectInstalledOllama()'),ui.indexOf('async function connectManagedOllama()'));
 const managed=ui.slice(ui.indexOf('async function connectManagedOllama()'),ui.indexOf('async function recheckInstall('));
 assert.ok(system.indexOf("await selectedOllamaRuntime('SYSTEM_ADOPTED')")>=0);
 assert.ok(managed.indexOf("await selectedOllamaRuntime('IWXA_MANAGED')")>=0);
 assert.ok(system.indexOf("await selectedOllamaRuntime('SYSTEM_ADOPTED')")<system.indexOf("onNavigate('Модели')"));
 assert.ok(managed.indexOf("await selectedOllamaRuntime('IWXA_MANAGED')")<managed.indexOf("onNavigate('Модели')"));
});

test('program inspection only promotes Goose after admissible execution proof, Obsidian after live vault health',()=>{
 const ui=readFileSync(new URL('../src/programs-center.tsx',import.meta.url),'utf8');
 const goose=ui.slice(ui.indexOf('async function inspectGoose()'),ui.indexOf('async function inspectObsidian()'));
 const obsidian=ui.slice(ui.indexOf('async function inspectObsidian()'),ui.indexOf('async function chooseObsidianVault()'));
 assert.match(goose,/route_admissible===true&&record\(candidate\?\.health\)\.ready===true/);
 assert.match(goose,/const proved=allowed&&candidate\?\.execution_verified_for_current_identity===true/);
 assert.match(goose,/setProgramHealth\(prev=>\(\{\.\.\.prev,GOOSE_PRIMARY_V1:proved\}\)\)/);
 assert.match(goose,/setProgramBlocked\(prev=>\(\{\.\.\.prev,GOOSE_PRIMARY_V1:candidate\?\.route_admissible===false\}\)\)/);
 assert.match(obsidian,/projection\.slot_id!=='human_knowledge_workspace'/);
 assert.match(obsidian,/active\?\.status==='connected'&&record\(active\.health\)\.ready===true/);
 assert.match(obsidian,/setProgramHealth\(prev=>\(\{\.\.\.prev,OBSIDIAN_V1:ready\}\)\)/);
 assert.match(obsidian,/setProgramHealth\(prev=>\(\{\.\.\.prev,OBSIDIAN_V1:false\}\)\)/);
 assert.match(goose,/if\(seq!==loadSequence\.current\)return false/);
 assert.match(obsidian,/if\(seq!==loadSequence\.current\)return false/);
});

test('manual Joplin inspection cannot replace the result of a newer refresh',()=>{
 const ui=readFileSync(new URL('../src/programs-center.tsx',import.meta.url),'utf8');
 const inspect=ui.slice(ui.indexOf('async function inspectJoplin()'),ui.indexOf('async function connectJoplin()'));
 assert.match(inspect,/const seq=\+\+loadSequence\.current/);
 assert.match(inspect,/if\(seq!==loadSequence\.current\)return/);
 assert.match(inspect,/if\(seq===loadSequence\.current\)/);
});


test('GooseControl refreshes inventory before reading current runtime health',()=>{
 const ui=readFileSync(new URL('../src/programs-center.tsx',import.meta.url),'utf8');
 assert.match(ui,/onChanged=\{\(\)=>\{void load\(\)\.then\(\(\)=>inspectGoose\(\)\);\}\}/);
});
