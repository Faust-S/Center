/** Read-only dashboard facts from existing Agent Core projections.
 * Layout is local presentation only; no Task/Result/Tool/Provider command here.
 */
export type DashboardPort={query<T>(name:string,params?:Record<string,unknown>):Promise<T>};
export type LiveObservation<T>={state:'ready';value:T}|{state:'unavailable'};
export type LiveAutomation={total:number;scheduled:number;running:number;paused:number;needsAttention:number;limited:boolean};
export type LiveModel={route:string;name:string;answerVerified:boolean;reason:'NONE'|'SELECTED'|'VERIFIED'};
export type LiveConnections={selected:number;healthy:number;total:number};
export type LiveProgramStatus='verified'|'responding'|'unverified';
export type LivePrograms={items:{id:string;status:LiveProgramStatus}[];verified:number;responding:number};
export type HomeLive={
 automations:LiveObservation<LiveAutomation>;
 model:LiveObservation<LiveModel>;
 connections:LiveObservation<LiveConnections>;
 programs:LiveObservation<LivePrograms>;
};
export type HomeLiveNeed='automations'|'model'|'connections'|'programs';
const asRow=(v:unknown):Record<string,unknown>|null=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:null;
const str=(v:unknown)=>typeof v==='string'?v:'';
const rows=(v:unknown):Record<string,unknown>[]|null=>Array.isArray(v)&&v.every(x=>asRow(x)!==null)?v as Record<string,unknown>[]:null;
const unavailable=<T>():LiveObservation<T>=>({state:'unavailable'});
const ready=<T>(value:T):LiveObservation<T>=>({state:'ready',value});
export function summarizeAutomations(value:unknown,areaId:string):LiveObservation<LiveAutomation>{
 const root=asRow(value),all=rows(root?.jobs);
 if(!all)return unavailable();
 // A job with no verified workspace binding must never be counted for an organization.
 const scoped=all.filter(job=>{
  const payload=asRow(job.payload);
  return job.job_kind==='task_prompt'&&payload?.workspace_id===areaId;
 });
 const needsAttention=(job:Record<string,unknown>)=>job.resume_blocked===true
  ||['RECONCILIATION_REQUIRED','EXTERNAL_EFFECT_UNKNOWN_REQUIRES_RECONCILIATION'].includes(str(job.resume_block_reason))
  ||['FAILED','DEAD'].includes(str(job.state));
 return ready({total:scoped.length,scheduled:scoped.filter(j=>j.state==='SCHEDULED').length,
  running:scoped.filter(j=>j.state==='RUNNING').length,
  paused:scoped.filter(j=>j.state==='PAUSED').length,
  needsAttention:scoped.filter(needsAttention).length,limited:all.length>=100});
}
export function summarizeModel(operational:unknown,userSetup:unknown,localSetup:unknown):LiveObservation<LiveModel>{
 const ops=asRow(operational),setup=asRow(userSetup),local=asRow(localSetup);
 if(!ops||!setup||!local)return unavailable();
 const route=str(ops.active_model_provider_id);
 const slots=rows(setup.slots);
 if(!route||!slots)return unavailable();
 const modelSlot=slots.find(x=>x.slot_id==='model');
 const configured=str(modelSlot?.active_provider_id)||str(setup.active_model_provider_id);
 if(configured&&route!==configured)return unavailable();
 if(route==='NONE')return ready({route,name:'',answerVerified:false,reason:'NONE'});
 if(route==='OLLAMA_LOCAL_V1'){
  const status=asRow(local.user_readiness),check=asRow(local.last_local_inference_check);
  const answerVerified=status?.response_verified===true&&check?.selection_matches_last_check===true;
  return ready({route,name:str(local.selected_model)||'Ollama',answerVerified,
   reason:answerVerified?'VERIFIED':'SELECTED'});
 }
 if(route==='IWXA_BASIC_RUNTIME_V1')return ready({route,name:'IWXA LLM Engine',answerVerified:false,reason:'SELECTED'});
 return ready({route,name:route,answerVerified:false,reason:'SELECTED'});
}
export function summarizeConnections(value:unknown):LiveObservation<LiveConnections>{
 const setup=asRow(value),slots=rows(setup?.slots);
 if(!slots)return unavailable();
 const selected=slots.filter(slot=>str(slot.active_provider_id)!==''&&slot.active_provider_id!=='NONE');
 const healthy=selected.filter(slot=>{
  const providers=rows(slot.providers);
  const provider=providers?.find(p=>p.provider_id===slot.active_provider_id);
  return asRow(provider?.health)?.ready===true;
 });
 return ready({selected:selected.length,healthy:healthy.length,total:slots.length});
}
export function summarizePrograms(agents:unknown,local:unknown,knowledge:unknown,mcp:unknown,n8n:unknown):LiveObservation<LivePrograms>{
 const agentRows=rows(asRow(agents)?.runtimes),model=asRow(local),workspaces=rows(asRow(asRow(knowledge)?.workspaces)?.workspaces),
  mcpTools=asRow(mcp),n8nState=asRow(n8n);
 if(!agentRows&&!model&&!workspaces&&!mcpTools&&!n8nState)return unavailable();
 const verifiedGoose=agentRows?.some(r=>r.runtime_id==='GOOSE_PRIMARY_V1'
  &&r.route_admissible===true&&asRow(r.health)?.ready===true
  &&r.execution_verified_for_current_identity===true)===true;
 const readiness=asRow(model?.user_readiness),lastCheck=asRow(model?.last_local_inference_check);
 const verifiedOllama=readiness?.response_verified===true&&lastCheck?.selection_matches_last_check===true;
 const verifiedObsidian=workspaces?.some(r=>r.provider_id==='OBSIDIAN_V1'&&r.active===true
  &&r.status==='connected'&&asRow(r.health)?.ready===true)===true;
 const verifiedMcp=mcpTools?.provider_active===true&&asRow(mcpTools.provider_health)?.ready===true;
 const n8nResponding=n8nState?.responding===true;
 const items=[
  {id:'external:goose',status:verifiedGoose?'verified':'unverified'},
  {id:'external:ollama',status:verifiedOllama?'verified':'unverified'},
  {id:'external:obsidian',status:verifiedObsidian?'verified':'unverified'},
  {id:'external:mcp',status:verifiedMcp?'verified':'unverified'},
  {id:'external:n8n',status:n8nResponding?'responding':'unverified'},
  {id:'external:node-red',status:'unverified'},
  {id:'external:iwxa-obscura',status:'unverified'}
 ] as {id:string;status:LiveProgramStatus}[];
 return ready({items,verified:items.filter(x=>x.status==='verified').length,
  responding:items.filter(x=>x.status==='responding').length});
}
function observedArea(value:unknown,expectedArea:string):boolean{
 const c=asRow(value),areas=rows(c?.areas);
 return c?.active_id===expectedArea&&areas!==null
  &&areas.some(a=>a.id===expectedArea)&&typeof c.catalog_digest==='string'&&!!c.catalog_digest;
}
/** Read each requested projection once, and verify Workspace has not changed across async reads.
 * A slow result for a former Workspace is rejected, never merged with its successor.
 */
export async function readHomeLive(port:DashboardPort,areaId:string,needs:HomeLiveNeed[]):Promise<HomeLive>{
 const blank=():HomeLive=>({automations:unavailable(),model:unavailable(),connections:unavailable(),programs:unavailable()});
 const before=await port.query<unknown>('work_areas');
 if(!observedArea(before,areaId))throw Error('dashboard_workspace_not_active');
 const requested=new Set(needs);
 const names=new Set<string>();
 if(requested.has('automations'))names.add('automation_jobs');
 if(requested.has('model')){names.add('operational_control');names.add('user_setup');names.add('local_ai_setup')}
 if(requested.has('connections'))names.add('user_setup');
 if(requested.has('programs')){
  ['agent_roles','local_ai_setup','knowledge_workspaces','mcp_user_tools','n8n_local_status'].forEach(x=>names.add(x));
 }
 const fields=[...names];
 const results=await Promise.allSettled(fields.map(name=>port.query<unknown>(name,name==='automation_jobs'?{limit:100}:undefined)));
 const after=await port.query<unknown>('work_areas');
 if(!observedArea(after,areaId))throw Error('dashboard_workspace_changed_during_readback');
 const read=(name:string):unknown|undefined=>{
  const index=fields.indexOf(name);
  if(index<0||results[index]?.status!=='fulfilled')return undefined;
  return (results[index] as PromiseFulfilledResult<unknown>).value;
 };
 const output=blank();
 if(requested.has('automations'))output.automations=summarizeAutomations(read('automation_jobs'),areaId);
 if(requested.has('model'))output.model=summarizeModel(read('operational_control'),read('user_setup'),read('local_ai_setup'));
 if(requested.has('connections'))output.connections=summarizeConnections(read('user_setup'));
 if(requested.has('programs'))output.programs=summarizePrograms(read('agent_roles'),read('local_ai_setup'),read('knowledge_workspaces'),read('mcp_user_tools'),read('n8n_local_status'));
 return output;
}