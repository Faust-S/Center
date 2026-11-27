// Qualification-only fixture, not a product native transport or a new owner.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const agent=resolve(process.argv[2]),knowledge=resolve(process.argv[3]);
const root=mkdtempSync(join(tmpdir(),'iwxa-original-composer-'));
const source=path=>import(pathToFileURL(join(knowledge,'packages/t3-core',path)).href);
const python=fileURLToPath(new URL('./workflow-original-composer.py',import.meta.url));
const call=(op,extra={})=>{
  const result=JSON.parse(execFileSync('python',[python,agent,root],{
    input:JSON.stringify({op,...extra}),encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:30000}));
  if(!result.ok)throw Error('ORIGINAL_COMPOSER_REFUSED');
  return result.result;
};
let phase='INITIAL';
try{
  assert.equal(execFileSync('git',['-C',agent,'rev-parse','HEAD'],{encoding:'utf8'}).trim(),'68128b4c9a2c7140ec3503ff0f775e5bcb50743e');
  const {createProjectProcessSourceOwnerQualificationHarness}=await source('src/modules/base/owners/project-process-source-owner.mjs');
  const {createWorkspaceMethodThroughSourceOwner}=await source('src/modules/base/owners/project-process-method-materialization.mjs');
  const {previewWorkspaceMethodStageHandoff,buildWorkspaceMethodPersonalTaskDraft}=await source('src/modules/base/owners/project-process-method-stage-input.mjs');
  const {saveOriginalPersonalWorkflowDraft}=await source('src/t3/workspace-method-personal-draft.mjs');
  const workspaceId='stage-result-workspace',projectId='research',time='2026-11-27T14:00:00Z';
  const material={workspace_id:workspaceId,object_id:'source',schema_id:'note',schema_version:'1.0.0',revision:1,
    data:{title:'Synthetic analysis material',value:42},extensions:{}};
  const bytes=new TextEncoder().encode('Exact synthetic input\nLine two\n');
  const asset={workspace_id:workspaceId,object_id:'source',asset_id:'attachment',revision:1,mime:'text/plain',
    size:bytes.length,service_id:'svc',created_at:time,updated_at:time,updated_by_service:'svc'};
  const {owner}=await createProjectProcessSourceOwnerQualificationHarness();
  const {method}=await createWorkspaceMethodThroughSourceOwner({owner,workspaceId,objects:[material],
    draft:{templateId:'method',templateRevision:'1',projectId,name:'Research',objective:'Review original material',
      domainApplicability:['generic'],materials:[{object_id:'source',revision:1}],steps:[
        {id:'analyse',name:'Analyse',actor:'agent',instruction:'Analyse original',dependsOn:[],materialIds:['source']}]},
    recordIds:{project:'method-source',works:{[projectId+'.analyse']:'analyse-source'}},knowledgeAt:time});
  const args={owner,workspaceId,projectId,expected:method,stepId:'analyse',resultSelections:[],
    includeMaterialEvidence:true,subjectKind:'PERSONAL',readObject:async(w,id)=>w===workspaceId&&id==='source'?{object:structuredClone(material)}:null,
    listAssets:async()=>[asset],getAsset:async()=>({asset,bytes})};
  const preview=await previewWorkspaceMethodStageHandoff(args);
  const build=()=>buildWorkspaceMethodPersonalTaskDraft({...args,expectedCandidateDigest:preview.candidateDigest});
  const plan=await build();
  let saves=0,approvals=0,drop=true;
  const composer={currentBinding:async()=>call('binding'),
    composerDraft:async(input,binding)=>{
      const result=call('composer',{input,binding});
      if(Object.hasOwn(input,'text')){saves++;if(drop){drop=false;throw Error('simulated lost acknowledgement');}}
      return result;
    }};
  const run=(recoverOnly=false,confirm=()=>{approvals++;return true;})=>saveOriginalPersonalWorkflowDraft({
    plan,refreshPlan:build,composer,guarded:fn=>fn(),confirm,recoverOnly});
  phase='COMPOSER';
  const personal=call('binding');
  assert.equal(personal.agentWorkspaceId,'personal');
  assert.equal((await run()).state,'DRAFT_CONFIRMED');
  const persisted=call('composer',{input:{context:'task'},binding:personal});
  assert.equal(persisted.state,'SAVED');
  assert.equal(persisted.text,plan.draft.text);
  assert.deepEqual(persisted.attachments,plan.draft.attachments);
  assert.equal(persisted.attachments[1].text,'Exact synthetic input\nLine two\n');
  assert.equal(JSON.parse(persisted.attachments[2].text).candidateDigest,preview.candidateDigest);
  assert.equal((await run(true)).state,'DRAFT_ALREADY_PRESENT');
  assert.equal((await run()).state,'DRAFT_ALREADY_PRESENT');
  assert.equal(saves,1);assert.equal(approvals,1);
  const created=call('area',{name:'Independent fixture area'});
  const area=created.area.id;
  call('select',{area});
  assert.notEqual(call('binding').agentWorkspaceId,personal.agentWorkspaceId);
  const active=call('binding');
  const empty=call('composer',{input:{context:'task'},binding:active});
  assert.equal(empty.text,'');
  assert.throws(()=>call('composer',{input:{context:'task',text:plan.draft.text,attachments:plan.draft.attachments,
    knowledge_sources:[],expected_draft_digest:empty.draft_digest},binding:personal}),/REFUSED/);
  call('seed',{text:'Independent user draft'});
  assert.equal((await run()).state,'DRAFT_OCCUPIED');
  assert.equal((await run(true)).state,'OUTCOME_UNKNOWN');
  assert.equal(call('composer',{input:{context:'task'},binding:active}).text,'Independent user draft');
  call('select',{area:'personal'});
  assert.equal(call('composer',{input:{context:'task'},binding:personal}).draft_digest,persisted.draft_digest);
  assert.equal(saves,1);assert.equal(approvals,1);
  assert.equal((await owner.audit()).length,2);
  // Separately exercise the original Task, its demo provider and original
  // Human Review. This is qualification, not a product automatic dispatch.
  phase='TASK_EXECUTE';
  const nativeTask=fileURLToPath(new URL('./workflow-original-task.py',import.meta.url));
  const taskCall=(op,extra={})=>{
    const response=JSON.parse(execFileSync('python',[nativeTask,agent,join(root,'actual-task')],{
      input:JSON.stringify({op,...extra}),encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:60000}));
    if(!response.ok){
      if(['IMPORT','CONFIG','ENGINE_INIT','AREA','DRAFT_READ','DRAFT_SAVE','TASK_CHAT','TASK_REVIEW','ACCEPTED_READ','ARTIFACT_VERIFY','SNAPSHOT_MATCH','DOCUMENT_READ'].includes(response.phase))
        console.log('WORKFLOW_QUALIFICATION_FAILURE_PHASE='+response.phase);
      throw Error('ORIGINAL_TASK_FIXTURE_REFUSED');
    }
    return response.result;
  };
  const {inspectOriginalPersonalWorkflowTask}=await source('src/t3/workspace-method-personal-draft.mjs');
  const {taskId}=taskCall('execute',{draft:plan.draft});
  const taskOwner={
    readAcceptedRun:async(taskId,binding)=>{assert.equal(binding.agentWorkspaceId,'personal');return taskCall('run',{taskId});},
    taskDocumentSource:async(taskId,snapshotId,path,sha256,binding)=>{assert.equal(binding.agentWorkspaceId,'personal');return taskCall('document',{taskId,snapshotId,path,sha256});}
  };
  phase='TASK_INSPECT';
  const inspection=await inspectOriginalPersonalWorkflowTask({plan,taskId,composer,taskOwner,guarded:fn=>fn(),refreshPlan:build});
  assert.equal(inspection.state,'ORIGINAL_ACCEPTED_TASK_DECLARED_INPUTS_MATCHED');
  assert.equal(inspection.declaredDraftInputsVerified,true);assert.equal(inspection.workCompleted,false);
  assert.equal(inspection.resultReuseProven,false);assert.equal(inspection.allAssetsProven,false);
  assert.match(inspection.acceptedSummarySha256,/^[a-f0-9]{64}$/);
  console.log('ORIGINAL_AGENT_ACCEPTED_TASK_DECLARED_INPUTS_PASS');
  console.log('ORIGINAL_AGENT_COMPOSER_COLD_READBACK_AND_SCOPE_CAS_PASS');
}catch(error){
  console.log('WORKFLOW_QUALIFICATION_FAILURE_PHASE='+phase);
  if(['T3_METHOD_PERSONAL_TASK_ACCEPTED_RUN_MISMATCH','T3_METHOD_PERSONAL_TASK_INPUT_CHANGED',
    'T3_METHOD_PERSONAL_TASK_ACCEPTED_RUN_CHANGED','T3_METHOD_PERSONAL_DRAFT_EVIDENCE_CHANGED'].includes(error?.code))
    console.log('WORKFLOW_QUALIFICATION_FAILURE_CODE='+error.code);
  process.exitCode=1;
}finally{rmSync(root,{recursive:true,force:true});}
