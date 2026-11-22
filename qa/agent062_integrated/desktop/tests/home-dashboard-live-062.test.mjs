import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const ts=require('typescript');
const source=readFileSync(new URL('../src/home-dashboard-live.ts',import.meta.url),'utf8');
const transpiled=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ES2022},reportDiagnostics:true});
assert.equal(transpiled.diagnostics?.length||0,0);
const lib=await import('data:text/javascript;base64,'+Buffer.from(transpiled.outputText).toString('base64'));
const area=(active)=>({active_id:active,catalog_digest:'abc123',areas:[{id:'personal',name:'Personal'},{id:'corp',name:'Corp'}]});
const ports=(active='personal',overrides={})=>{
 const log=[];let checks=0;
 return {log,query:async(name,params)=>{
  log.push({name,params});
  if(name==='work_areas')return area(typeof active==='function'?active(++checks):active);
  if(name in overrides){const v=overrides[name];if(v instanceof Error)throw v;return v}
  throw Error('Unexpected query '+name);
 }};
};
test('automation list never includes other Workspace or unbound jobs',async()=>{
 const p=ports('corp',{automation_jobs:{jobs:[
  {job_id:'J1',job_kind:'task_prompt',state:'SCHEDULED',payload:{workspace_id:'corp'}},
  {job_id:'J2',job_kind:'task_prompt',state:'RUNNING',payload:{workspace_id:'personal'}},
  {job_id:'J3',job_kind:'task_prompt',state:'PAUSED',payload:{}},
  {job_id:'J4',job_kind:'approved_action',state:'RUNNING',payload:{workspace_id:'corp'}},
  {job_id:'J5',job_kind:'task_prompt',state:'PAUSED',resume_blocked:true,payload:{workspace_id:'corp'}}
 ]}});
 const result=await lib.readHomeLive(p,'corp',['automations']);
 assert.deepEqual(result.automations,{state:'ready',value:{total:2,scheduled:1,running:0,paused:1,needsAttention:1,limited:false}});
 assert.deepEqual(p.log.map(x=>x.name),['work_areas','automation_jobs','work_areas']);
});
test('active Workspace change during queries invalidates entire dashboard snapshot',async()=>{
 const p=ports(c=>c===1?'corp':'personal',{automation_jobs:{jobs:[]}});
 await assert.rejects(()=>lib.readHomeLive(p,'corp',['automations']),/workspace_changed_during_readback/);
});
test('missing Core source is unavailable, not a fabricated empty list',async()=>{
 const p=ports('personal',{automation_jobs:new Error('Core disconnected')});
 const x=await lib.readHomeLive(p,'personal',['automations']);
 assert.deepEqual(x.automations,{state:'unavailable'});
 assert.deepEqual(x.model,{state:'unavailable'});
});
test('model must match provider route and latest verification identity',()=>{
 const ops={active_model_provider_id:'OLLAMA_LOCAL_V1'};
 const user={slots:[{slot_id:'model',active_provider_id:'OLLAMA_LOCAL_V1'}]};
 const local={selected_model:'qwen',user_readiness:{response_verified:true},last_local_inference_check:{selection_matches_last_check:false}};
 assert.deepEqual(lib.summarizeModel(ops,user,local),{state:'ready',value:{route:'OLLAMA_LOCAL_V1',name:'qwen',answerVerified:false,reason:'SELECTED'}});
 assert.equal(lib.summarizeModel(ops,{slots:[{slot_id:'model',active_provider_id:'IWXA_BASIC_RUNTIME_V1'}]},local).state,'unavailable');
 assert.equal(lib.summarizeModel(ops,user,{...local,last_local_inference_check:{selection_matches_last_check:true}}).value.answerVerified,true);
});
test('connection panel distinguishes selected and healthy rather than assuming connection',()=>{
 const projected={slots:[
  {slot_id:'model',active_provider_id:'OLLAMA_LOCAL_V1',providers:[{provider_id:'OLLAMA_LOCAL_V1',health:{ready:true}}]},
  {slot_id:'web',active_provider_id:'NONE',providers:[]},
  {slot_id:'mcp_tools',active_provider_id:'MCP',providers:[{provider_id:'MCP',health:{ready:false}}]}
 ]};
 assert.deepEqual(lib.summarizeConnections(projected),{state:'ready',value:{selected:2,healthy:1,total:3}});
});
test('n8n responding is not reported as verified executable; unknown Node-RED not ready',()=>{
 const summary=lib.summarizePrograms({runtimes:[]},{user_readiness:{response_verified:false}},
   {workspaces:{workspaces:[]}},{provider_active:false},{responding:true});
 assert.equal(summary.state,'ready');
 assert.deepEqual(summary.value.items.find(x=>x.id==='external:n8n'),{id:'external:n8n',status:'responding'});
 assert.deepEqual(summary.value.items.find(x=>x.id==='external:node-red'),{id:'external:node-red',status:'unverified'});
 assert.equal(summary.value.verified,0);
});
test('when only automations widget is added there are no unrelated model/provider calls',async()=>{
 const p=ports('personal',{automation_jobs:{jobs:[]}});
 await lib.readHomeLive(p,'personal',['automations']);
 assert.equal(p.log.some(x=>x.name==='local_ai_setup'||x.name==='agent_roles'),false);
});