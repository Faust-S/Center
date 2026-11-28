// Controlled original Workspace / D1 ports; real Project/Work owner and reader.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const root=resolve(process.argv[2],'packages/t3-core/src');
const load=p=>import(pathToFileURL(resolve(root,p)).href);
const {createProjectProcessSourceOwnerQualificationHarness}=await load('modules/base/owners/project-process-source-owner.mjs');
const {createWorkspaceMethodThroughSourceOwner}=await load('modules/base/owners/project-process-method-materialization.mjs');
const {createTrustedWorkspaceMethodProgramInputReader}=await load('t3/workspace-method-stage-reader.mjs');
const input=JSON.parse(readFileSync(0,'utf8'));
const ws='workflow-program-workspace',projectId='allocation',stepId='solve',time='2026-11-28T00:00:00Z';
const material={workspace_id:ws,object_id:'source',schema_id:'note',schema_version:'1.0.0',revision:1,data:{title:'Allocation input'}};
const {owner}=await createProjectProcessSourceOwnerQualificationHarness();
const result=await createWorkspaceMethodThroughSourceOwner({owner,workspaceId:ws,objects:[material],
  draft:{templateId:'allocation-method',templateRevision:'1',projectId,name:'Resource allocation',
    objective:'Распределение работ',domainApplicability:['generic'],materials:[{object_id:'source',revision:1}],
    steps:[{id:stepId,name:'Solve',actor:'program',instruction:'Минимизировать стоимость распределения.',dependsOn:[],materialIds:['source']}]},
  recordIds:{project:'allocation-project-source',works:{'allocation.solve':'allocation-work-source'}},knowledgeAt:time});
const workspace={workspace_id:ws,deleted_at:null};
const currentWorkspace={get:()=>workspace,subscribe:()=>()=>{}};
const context={kind:'PERSONAL',context_id:'ctx:work',actor_id:'person:owner',principal_id:'person:owner',
  role_id:'role:owner',grant_id:'grant:owner',realm_id:'realm:personal',audience:'host:t3',resource:ws,
  purpose:'work',workspace_id:ws,organization_id:null,scope_revision:1};
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const access={currentContext:()=>context,actionFor:()=> 'object.read',operationDigest:sha,
  authorize:request=>({schema:'IWXA_T3_AUTHORIZATION_DECISION/1',allowed:true,outcome:'PERMITTED',
    evidenceOnly:true,requestDigest:sha(request),policyDigest:sha('policy'),statusSequence:1,
    validUntil:new Date(Date.now()+60000).toISOString(),statusObservedAt:new Date().toISOString(),
    evaluatedAt:new Date().toISOString(),authorityPath:[{grantId:context.grant_id}]}),
  verifyDecisionBinding:(request,decision)=>decision.requestDigest===sha(request)};
const bytes=new TextEncoder().encode(input.raw);
const asset={workspace_id:ws,object_id:'source',asset_id:'asset:1',revision:1,mime:'application/json',size:bytes.byteLength,
  service_id:'svc',created_at:time,updated_at:time,updated_by_service:'svc'};
const kernel={sessionInfo:{contract_version:'1.3.0'},hasOperation:op=>['t1.getWorkspace','t1.getObject','t1.listAssets','t1.getAsset'].includes(op),
  getWorkspace:async w=>w===ws?workspace:null,
  getObject:async(w,id)=>w===ws&&id==='source'?{object:{...material,extensions:{}},relations:{incoming:[],outgoing:[]}}:null,
  listAssets:async q=>q.object_id==='source'?[asset]:[],
  getAsset:async(w,id)=>{assert.equal(w,ws);assert.equal(id,asset.asset_id);return {asset,bytes:bytes.slice()};}};
const reader=createTrustedWorkspaceMethodProgramInputReader({kernel,accessForRead:async()=>access,currentWorkspace,sourceOwner:owner,isHostActive:()=>true});
const selection={workspaceId:ws,projectId,stepId,expected:{projectRef:result.method.projectRef,workRefs:result.method.workRefs},
  sourceAsset:{objectId:'source',assetId:asset.asset_id,revision:1,name:'allocation.json'},
  program:{providerId:'ORTOOLS_ALLOCATION_V1',operation:'allocate_resources',parameters:{specification:JSON.stringify({time_limit_seconds:5,random_seed:17})},
    connectionEpoch:input.epoch,trustedCodeConfirmed:false}};
if(input.selection)assert.deepEqual(selection,input.selection);
const prepared=await reader.readInputs(selection);
assert.equal(prepared.modelingSource.text,input.raw);
assert.equal(prepared.taskCreated,false);
assert.equal(prepared.executionAuthority,false);
assert.equal((await owner.audit()).length,2);
process.stdout.write(JSON.stringify({selection,prepared}));
