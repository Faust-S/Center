// Controlled Host/D1 fixture; actual original Project/Work owner and reader.
// Native QGIS Result is supplied by the real Agent receipt owner in Python.
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
const ws='workflow-road-workspace',projectId='road-method',time='2026-11-28T00:00:00Z';
const ids=['layer','road'],materials=ids.map(id=>({workspace_id:ws,object_id:id,schema_id:'note',
  schema_version:'1.0.0',revision:1,data:{title:id}}));
const {owner}=await createProjectProcessSourceOwnerQualificationHarness();
const created=await createWorkspaceMethodThroughSourceOwner({owner,workspaceId:ws,objects:materials,
  draft:{templateId:'road-method',templateRevision:'1',projectId,name:'Delivery geography',
    objective:'Prepare an exact road matrix',domainApplicability:['generic'],materials:ids.map(id=>({object_id:id,revision:1})),
    steps:[{id:'points',name:'Prepare geographic points',actor:'program',instruction:'Transform original coordinates',dependsOn:[],materialIds:['layer']},
      {id:'matrix',name:'Road calculation',actor:'program',instruction:'Calculate road distances from verified points',dependsOn:['points'],materialIds:['road']}]},
  recordIds:{project:'road-project-source',works:{'road-method.points':'points-work-source','road-method.matrix':'matrix-work-source'}},knowledgeAt:time});
const workspace={workspace_id:ws,deleted_at:null};
const context={kind:'PERSONAL',context_id:'ctx:road',actor_id:'person:owner',principal_id:'person:owner',
  role_id:'role:owner',grant_id:'grant:owner',realm_id:'realm:personal',audience:'host:t3',resource:ws,
  purpose:'work',workspace_id:ws,organization_id:null,scope_revision:1};
const sha=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const access={currentContext:()=>context,actionFor:()=> 'object.read',operationDigest:sha,
  authorize:request=>({schema:'IWXA_T3_AUTHORIZATION_DECISION/1',allowed:true,outcome:'PERMITTED',
    evidenceOnly:true,requestDigest:sha(request),policyDigest:sha('policy'),statusSequence:1,
    validUntil:new Date(Date.now()+60000).toISOString(),statusObservedAt:new Date().toISOString(),
    evaluatedAt:new Date().toISOString(),authorityPath:[{grantId:context.grant_id}]}),
  verifyDecisionBinding:(request,decision)=>decision.requestDigest===sha(request)};
const bodies={layer:input.qgisText,road:input.roadText??''};
const bytes=id=>new TextEncoder().encode(bodies[id]);
const asset=id=>({workspace_id:ws,object_id:id,asset_id:'asset:'+id,revision:1,mime:'application/json',
  size:bytes(id).byteLength,service_id:'svc',created_at:time,updated_at:time,updated_by_service:'svc'});
const kernel={sessionInfo:{contract_version:'1.3.0'},hasOperation:op=>['t1.getWorkspace','t1.getObject','t1.listAssets','t1.getAsset'].includes(op),
  getWorkspace:async w=>w===ws?workspace:null,
  getObject:async(w,id)=>w===ws&&ids.includes(id)?{object:{...materials.find(m=>m.object_id===id),extensions:{}},relations:{incoming:[],outgoing:[]}}:null,
  listAssets:async q=>ids.includes(q.object_id)?[asset(q.object_id)]:[],
  getAsset:async(w,id)=>{assert.equal(w,ws);const key=id.slice('asset:'.length);assert.ok(ids.includes(key));return {asset:asset(key),bytes:bytes(key)};}};
const prior=input.prior;
const reader=createTrustedWorkspaceMethodProgramInputReader({kernel,accessForRead:async()=>access,
  currentWorkspace:{get:()=>workspace,subscribe:()=>()=>{}},sourceOwner:owner,isHostActive:()=>true,
  ...(prior?{originalProgramResultOwner:{readVerified:async(s,ctx)=>{
    assert.equal(ctx.workspace_id,ws);
    assert.deepEqual(s,{stepId:'points',taskId:prior.taskId,receiptId:prior.receiptId,candidateDigest:prior.candidateDigest});
    return prior;
  }}}:{})});
const rootWork=input.step==='points';
const id=rootWork?'layer':'road';
const selection={workspaceId:ws,projectId,stepId:input.step,expected:{projectRef:created.method.projectRef,workRefs:created.method.workRefs},
  sourceAsset:{objectId:id,assetId:'asset:'+id,revision:1,name:id+'.json'},
  program:{providerId:rootWork?'QGIS_PROCESSING_V1':'VALHALLA_ROUTING_V1',operation:rootWork?'reproject_points':'road_matrix',
    parameters:{specification:JSON.stringify(input.specification)},connectionEpoch:input.epoch,trustedCodeConfirmed:false},
  ...(rootWork?{}:{programResultSelections:[{stepId:'points',taskId:prior.taskId,receiptId:prior.receiptId,candidateDigest:prior.candidateDigest}]})};
if(input.selection)assert.deepEqual(selection,input.selection);
const prepared=await reader.readInputs(selection);
assert.equal(prepared.modelingSource.text,bodies[id]);
assert.equal(prepared.taskCreated,false);assert.equal(prepared.executionAuthority,false);
assert.equal(prepared.reference.predecessorResults.length,rootWork?0:1);
assert.equal((await owner.audit()).length,3);
process.stdout.write(JSON.stringify({selection,prepared}));
