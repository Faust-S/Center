import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const path=new URL('../src/models-core-snapshot.ts',import.meta.url);
const compiled=ts.transpileModule(readFileSync(path,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},reportDiagnostics:true});
assert.deepEqual(compiled.diagnostics||[],[]);
const api=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputText).toString('base64'));
const engine={pin:{name:'gguf-test',digest:'a'.repeat(64)},active:true,ready:true};
const stable={local_ai_setup:{},user_setup:{slots:[{slot_id:'model',active_provider_id:'IWXA_BASIC_RUNTIME_V1'}]},operational_control:{active_model_provider_id:'IWXA_BASIC_RUNTIME_V1'},status:{},iwxa_basic_model_status:engine};
function client(resolve){const calls=[];return {calls,query:async(name)=>{calls.push(name);return resolve(name,calls);}};}
const zero=async()=>{};
test('active provider and pin restore from one Core-backed screen read',async()=>{
 const apiClient=client(name=>stable[name]);
 const result=await api.readModelsCoreSnapshot(apiClient.query,zero);
 assert.equal(result.route.route,'IWXA_BASIC_RUNTIME_V1');
 assert.equal(result.route.issue,null);
 assert.equal(result.attempts,1);
 assert.equal(apiClient.calls.filter(name=>name==='iwxa_basic_model_status').length,1);
 assert.equal(apiClient.calls.at(-1),'iwxa_basic_model_status');
});
test('temporary NONE versus saved model slot triggers bounded re-read',async()=>{
 let attempt=0;
 const apiClient=client(name=>{
  if(name==='iwxa_basic_model_status')attempt++;
  if(name==='operational_control'&&attempt===0)return {active_model_provider_id:'NONE'};
  return stable[name];
 });
 const result=await api.readModelsCoreSnapshot(apiClient.query,zero);
 assert.equal(result.attempts,2);
 assert.equal(result.route.route,'IWXA_BASIC_RUNTIME_V1');
 assert.equal(result.faults.length,0);
});
test('temporary rejected operational query does not become a fake NONE',async()=>{
 let attempt=0;
 const apiClient=client(name=>{
  if(name==='iwxa_basic_model_status')attempt++;
  if(name==='operational_control'&&attempt===0)throw Error('bootstrap warming');
  return stable[name];
 });
 const result=await api.readModelsCoreSnapshot(apiClient.query,zero);
 assert.equal(result.attempts,2);
 assert.equal(result.route.route,'IWXA_BASIC_RUNTIME_V1');
 assert.equal(result.faults.length,0);
});
test('permanent route disagreement stays unconfirmed, never reports deselected',async()=>{
 const apiClient=client(name=>name==='operational_control'?{active_model_provider_id:'NONE'}:stable[name]);
 const result=await api.readModelsCoreSnapshot(apiClient.query,zero);
 assert.equal(result.attempts,3);
 assert.equal(result.route.route,null);
 assert.equal(result.route.issue,'MODEL_ROUTE_CONFLICT');
 assert.equal(apiClient.calls.filter(name=>name==='iwxa_basic_model_status').length,1);
});
test('real unassigned route remains NONE and model selection is not automatically activated',async()=>{
 const apiClient=client(name=>name==='operational_control'?{active_model_provider_id:'NONE'}:name==='user_setup'?{slots:[{slot_id:'model',active_provider_id:'NONE'}]}:stable[name]);
 const result=await api.readModelsCoreSnapshot(apiClient.query,zero);
 assert.equal(result.route.route,'NONE');
 assert.equal(result.route.issue,null);
 assert.equal(result.attempts,1);
 assert.equal(apiClient.calls.length,5);
});
test('unrelated status failure does not trigger repeated GGUF hashing',async()=>{
 const apiClient=client(name=>{
  if(name==='status')throw Error('optional status unavailable');
  return stable[name];
 });
 const result=await api.readModelsCoreSnapshot(apiClient.query,zero);
 assert.equal(result.route.route,'IWXA_BASIC_RUNTIME_V1');
 assert.equal(result.attempts,1);
 assert.equal(result.faults[0].name,'status');
 assert.equal(apiClient.calls.filter(name=>name==='iwxa_basic_model_status').length,1);
 assert.equal(apiClient.calls.length,5);
});
test('transient GGUF status failure retries only the failed model read',async()=>{
 let modelReads=0;
 const apiClient=client(name=>{
  if(name==='iwxa_basic_model_status'&&++modelReads===1)throw Error('model-read warming');
  return stable[name];
 });
 const result=await api.readModelsCoreSnapshot(apiClient.query,zero);
 assert.equal(result.attempts,2);
 assert.equal(result.route.route,'IWXA_BASIC_RUNTIME_V1');
 assert.equal(result.faults.length,0);
 assert.equal(apiClient.calls.filter(name=>name==='iwxa_basic_model_status').length,2);
 assert.equal(apiClient.calls.filter(name=>name==='user_setup').length,1);
 assert.equal(apiClient.calls.filter(name=>name==='operational_control').length,1);
});
test('unmount invalidates pending hydration and prevents late retry',async()=>{
 let current=true;
 const apiClient=client(name=>name==='operational_control'?{active_model_provider_id:'NONE'}:stable[name]);
 const result=await api.readModelsCoreSnapshot(apiClient.query,async()=>{current=false;},()=>current);
 assert.equal(result,null);
 assert.equal(apiClient.calls.length,5);
});
test('IWXA GGUF status is hydrated by parent rather than queried twice on mount',()=>{
 const child=readFileSync(new URL('../src/basic-model-try.tsx',import.meta.url),'utf8');
 const initial=child.slice(child.indexOf('useEffect(()=>{'),child.indexOf('async function addonRefresh'));
 assert.doesNotMatch(initial,/runtime\.query<Row>\('iwxa_basic_model_status'\)/);
 assert.doesNotMatch(initial,/runtime\.query<Row>\('user_setup'\)/);
 assert.match(child,/modelStatus:Row\|null/);
 assert.match(child,/userSetup:Row/);
 const parent=readFileSync(new URL('../src/models-control.tsx',import.meta.url),'utf8');
 assert.match(parent,/userSetup=\{setup\}/);
 assert.match(child,/reasoningDraftRef\.current/);
});

test('model verification checks actual response, matching receipt and no duplicate reload',()=>{
 const ui=readFileSync(new URL('../src/conversation-model-choice.tsx',import.meta.url),'utf8');
 const result=ts.transpileModule(ui,{reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX}});
 assert.deepEqual(result.diagnostics||[],[]);
 const verify=ui.slice(ui.indexOf(' async function verify(){'),ui.indexOf(' return <div className=',ui.indexOf(' async function verify(){')));
 assert.match(verify,/await checkSelectedLocal\(name,digest\)/);
 assert.doesNotMatch(verify,/await load\(\)/);
 assert.match(ui,/!str\(response.actual_response\)\.trim\(\)/);
 assert.match(ui,/receipt.state!=='SUCCEEDED'\|\|!str\(receipt.response_excerpt\)\.trim\(\)/);
 assert.match(ui,/checked.selection_matches_last_check===true/);
 assert.match(ui,/<pre className="document-content">\{currentAnswer\}<\/pre>/);
});

test('model selection uses one final Core refresh rather than repeated reads',()=>{
 const ui=readFileSync(new URL('../src/conversation-model-choice.tsx',import.meta.url),'utf8');
 const apply=ui.slice(ui.indexOf(' async function apply(chosen:string){'),ui.indexOf(' async function verify(){'));
 assert.equal((apply.match(/await load\(\)/g)||[]).length,1);
 assert.match(apply,/try\{await load\(\);\}catch/);
 assert.match(apply,/if\(notifyParent\)onChanged\?\.\(\)/);
 assert.match(apply,/switchRef\.current=false;setSwitching\(false\)/);
 assert.doesNotMatch(apply,/await load\(\);onChanged\?\.\(\)/);
});

test('active model projection cannot revive an unselected saved GGUF or old Ollama response',()=>{
 const selected=api.activeModelPresentation;
 const pin={name:'saved-gguf',digest:'a'.repeat(64)};
 assert.deepEqual(selected('NONE',pin,'old-ollama',true,true),
  {kind:'NONE',name:'',responseVerified:false});
 assert.deepEqual(selected('IWXA_BASIC_RUNTIME_V1',pin,'old-ollama',true,true),
  {kind:'ENGINE',name:'saved-gguf',responseVerified:false});
 assert.deepEqual(selected('IWXA_BASIC_RUNTIME_V1',{},'old-ollama',true,true),
  {kind:'ENGINE',name:'IWXA LLM Engine',responseVerified:false});
 assert.deepEqual(selected('OLLAMA_LOCAL_V1',pin,'local-model',true,false),
  {kind:'OLLAMA',name:'local-model',responseVerified:false});
 assert.deepEqual(selected('OLLAMA_LOCAL_V1',pin,'local-model',true,true),
  {kind:'OLLAMA',name:'local-model',responseVerified:true});
 assert.deepEqual(selected('THIRD_PARTY_V1',pin,'old-ollama',true,true),
  {kind:'OTHER',name:'',responseVerified:false});
 assert.deepEqual(selected('THIRD_PARTY_V1',pin,'old-ollama',true,true,'Verified provider'),
  {kind:'OTHER',name:'Verified provider',responseVerified:false});
});

test('model screen places the human action ahead of internal model routing details',()=>{
 const ui=readFileSync(new URL('../src/models-control.tsx',import.meta.url),'utf8');
 const parsed=ts.createSourceFile('models-control.tsx',ui,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX);
 assert.deepEqual(parsed.parseDiagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')),[]);
 assert.match(ui,/activeModelPresentation\(route,engine\.pin,ai\.selected_model/);
 assert.match(ui,/activeModel\.kind==='NONE'\?tr\('Не выбрана','Not selected'\)/);
 assert.match(ui,/activeModel\.responseVerified/);
 assert.match(ui,/Модель для новых запросов пока не выбрана/);
 assert.match(ui,/Выберите модель для запросов/);
 assert.doesNotMatch(ui,/route==='NONE'\?\(str\(record\(engine\.pin\)\.name\)/);
 assert.doesNotMatch(ui,/tr\('.*Python Core/);
});
