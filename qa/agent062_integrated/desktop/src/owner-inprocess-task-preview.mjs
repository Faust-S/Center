// Read-only in-process compatibility preview for a *real, existing* Core Task.
// The source of Task/Skill/model identities is fresh Python Core readback;
// K02/K04 compute the draft only. No model ranking without observation.
import {prepareInProcessK02K04} from './owner-plans-inprocess.mjs';
import {digest} from './public-k02/index.mjs';

export const CORE_TASK_MODEL_PREVIEW='PA.K02_K04.CORE_TASK_PREVIEW/0.1.0';
const TASK=/^TASK-[A-Za-z0-9_-]{1,80}$/;
const HEX=/^[0-9a-f]{64}$/;
const LOCAL=new Set(['OLLAMA_LOCAL_V1','IWXA_BASIC_RUNTIME_V1']);
const record=v=>v!==null&&typeof v==='object'&&!Array.isArray(v);
const observedDigest=v=>typeof v==='string'?
 v.trim().toLowerCase().replace(/^sha256:/,''):'';
const pin=v=>record(v)&&typeof v.name==='string'&&
 !v.name.toLowerCase().endsWith(':cloud')&&
 /^[A-Za-z0-9][A-Za-z0-9_.:/-]{0,159}$/.test(v.name)&&
 typeof v.digest==='string'&&HEX.test(v.digest);
function fail(code){throw new Error('model_preview_'+code);}
const schema={type:'object',additionalProperties:false,required:['input'],
  properties:{input:{type:'string'}}};
const checkedPin=value=>{
 const candidate={name:value?.name,digest:observedDigest(value?.digest)};
 if(!pin(candidate))fail('model_pin_invalid');
 return candidate;
};
/** The active model is an observation, never a request to switch providers.
 * Existing explicit per-step pins continue to take precedence.
 */
function observedCurrentPin(provider,observation){
 if(!record(observation))fail('model_observation_missing');
 if(provider==='IWXA_BASIC_RUNTIME_V1'){
   if(observation.ready!==true||observation.active!==true)
     fail('active_model_unavailable');
   return checkedPin(observation.pin);
 }
 if(provider==='OLLAMA_LOCAL_V1'){
   if(observation.source_confirmed!==true||observation.daemon_ready!==true||
     observation.selected_identity_matches!==true)
     fail('active_model_unavailable');
   return checkedPin({
     name:observation.selected_model,
     digest:observation.selected_model_expected_digest,
   });
 }
 fail('model_binding_unavailable');
}
/** The adapter declares only the one observed text-generation capability of
 * this selected local model. Fees/latency are not measured; never invent them.
 * A Core Task Skill is a Task route here, not an independently executed Skill.
 */
export function previewCoreTaskModel({task,skills,modelBinding,observation,selectedModelPin=null}){
 if(!record(task)||typeof task.task_id!=='string'||!TASK.test(task.task_id)||
    typeof task.objective!=='string'||!task.objective.trim()||
    typeof task.skill_id!=='string'||typeof task.created_at!=='string'||
    !task.created_at||task.status!=='closed'||
    typeof task.accepted_artifact_digest!=='string'||
    !HEX.test(task.accepted_artifact_digest))fail('task_unavailable');
 if(!record(skills)||skills.schema!=='IWXA_TASK_SKILL_CATALOG/1.0.0'||
    !Array.isArray(skills.skills)||!skills.skills.some(x=>record(x)&&
      x.skill_id===task.skill_id&&x.task_route_supported===true))
    fail('task_skill_unavailable');
 if(!record(modelBinding)||!LOCAL.has(modelBinding.provider_id)||
    modelBinding.ready!==true||typeof modelBinding.binding_digest!=='string'||
    !modelBinding.binding_digest||typeof modelBinding.authority_ref!=='string'||
    modelBinding.authority_ref!=='model-binding:'+modelBinding.binding_digest)
    fail('model_binding_unavailable');
 const selectionOrigin=selectedModelPin===null?'CURRENT_ACTIVE_MODEL':'EXPLICIT_STEP_PIN';
 const chosen=selectionOrigin==='CURRENT_ACTIVE_MODEL'
   ?observedCurrentPin(modelBinding.provider_id,observation)
   :checkedPin(selectedModelPin);
 // A Task may have been created with another model. The user can explicitly
 // select a different model for this Graph step, but must see that difference.
 let taskModelMatch=null;
 if(task.requested_local_model!==undefined&&task.requested_local_model!==null){
   const original=checkedPin(task.requested_local_model);
   taskModelMatch=original.name===chosen.name&&original.digest===chosen.digest;
 }
 if(!record(observation))fail('model_observation_missing');
 let matches=false;
 if(modelBinding.provider_id==='OLLAMA_LOCAL_V1'){
   if(observation.source_confirmed!==true||observation.daemon_ready!==true||
      !Array.isArray(observation.local_models))fail('model_source_not_ready');
   matches=observation.local_models.some(x=>record(x)&&x.name===chosen.name&&
     !x.remote_host&&!x.remote_model&&observedDigest(x.digest)===chosen.digest);
 }else{
   matches=observation.ready===true&&observation.active===true&&
      record(observation.pin)&&observation.pin.name===chosen.name&&
      observedDigest(observation.pin.digest)===chosen.digest;
 }
 if(!matches)fail('selected_model_changed');
 // The Task and current model are live observed data; these descriptors are
 // *compatibility hypotheses*, never positive trial evidence or owner grants.
 const capability={kind:'model',capabilityId:'text.generate',supported:true,
   inputSchema:schema,outputSchema:schema,effectClass:'MODEL_INFERENCE',
   providerFeeUsd:null,latencyMsP50:null,inputModes:['text'],outputModes:['text'],
   modelPin:chosen};
 const provider={contractVersion:'IWXA.K02.INTEROP/0.1.0',
   providerId:modelBinding.provider_id,availability:'available',capabilities:[capability]};
 const requirement={requirementId:'MODEL',kind:'model',capabilityId:'text.generate',
   required:true,inputSchema:schema,outputSchema:schema,effectClass:'MODEL_INFERENCE',
   inputModes:['text'],outputModes:['text'],modelPin:chosen};
 const skill={schema:'IWXA.K02.SKILL/0.1.0',skillId:task.skill_id,
   requiredCapabilities:['text.generate']};
 const taskRef=task.task_id;
 const ownerTask={taskId:taskRef,kind:'personal_task',
   input:{transcript_text:task.objective},source:{
     ref:'task:'+taskRef,
     revision:digest({taskId:taskRef,createdAt:task.created_at,
       objective:task.objective,skillId:task.skill_id,
       acceptedArtifactDigest:task.accepted_artifact_digest}),
     rights:'USER_PROVIDED',authorized:true,
   }};
 const proposal=prepareInProcessK02K04({
   taskId:taskRef,requirementId:'MODEL',
   k02Request:{schema:'PA.K02_K04.OWNER_REQUEST/0.1.0',task_id:taskRef,k02:{
     solution:{solutionId:'agent-personal-text-step',requirements:[requirement]},
     providers:[provider],selected_skills:[],trial_evidence:null,
   }},
   k04Request:{schema:'PA.K02_K04.OWNER_REQUEST/0.1.0',task_id:taskRef,k04:{
     mode:'model_skills',task:ownerTask,
     availability:{providers:[provider],skills:[skill]},
     model_requirement:requirement,tool_requirements:[],
     selected_skill_ids:[skill.skillId],
   }},
 });
 return {schema:CORE_TASK_MODEL_PREVIEW,taskId:taskRef,
   acceptedTaskResultDigest:task.accepted_artifact_digest,
   skillId:task.skill_id,providerId:modelBinding.provider_id,
   modelPin:chosen,bindingDigest:modelBinding.binding_digest,
   k02PlanDigest:proposal.k02Plan.planDigest,
   k04PlanDigest:proposal.k04Plan.planDigest,
   compatible:true,kind:'SINGLE_SELECTED_LOCAL_MODEL',
   sourceCoverage:'TASK_OBJECTIVE_ONLY',
   modelSelectionOrigin:selectionOrigin,
   taskModelMatch,
   modelQualityAssessed:false,taskOutcomeAssessed:false,
   executionPerformed:false,verifiedByCore:false,
   ownerReceipts:null};
}


/** Bind a user-requested K02/K04 compatibility check to a saved Graph proposal.
 * This is source provenance, never an owner receipt or execution authority.
 * Only an explicitly pinned Graph model can carry durable evidence; an
 * unpinned current model could change between the preview and execution.
 */
export function graphEvidenceForCoreTaskModelPreview(preview,{
  taskId,acceptedTaskResultDigest,skillId,providerId,bindingDigest,modelPin,
}){
 const samePin=record(modelPin)&&pin(modelPin)&&
   preview?.modelPin?.name===modelPin.name&&
   preview?.modelPin?.digest===modelPin.digest;
 if(!record(preview)||preview.schema!==CORE_TASK_MODEL_PREVIEW||
    preview.compatible!==true||preview.kind!=='SINGLE_SELECTED_LOCAL_MODEL'||
    preview.sourceCoverage!=='TASK_OBJECTIVE_ONLY'||
    preview.modelSelectionOrigin!=='EXPLICIT_STEP_PIN'||
    preview.executionPerformed!==false||preview.verifiedByCore!==false||
    preview.ownerReceipts!==null||
    typeof taskId!=='string'||!TASK.test(taskId)||
    !HEX.test(acceptedTaskResultDigest||'')||
    typeof skillId!=='string'||!skillId||
    typeof providerId!=='string'||!LOCAL.has(providerId)||
    typeof bindingDigest!=='string'||!bindingDigest||
    preview.taskId!==taskId||preview.skillId!==skillId||
    preview.acceptedTaskResultDigest!==acceptedTaskResultDigest||
    preview.providerId!==providerId||preview.bindingDigest!==bindingDigest||
    !samePin||!HEX.test(preview.k02PlanDigest||'')||
    !HEX.test(preview.k04PlanDigest||''))
   fail('graph_evidence_stale');
 return {
   evidence_refs:[
     'task:'+taskId,
     'task-accepted-result:'+acceptedTaskResultDigest,
     'k02-inprocess-preview:'+preview.k02PlanDigest,
     'k04-inprocess-preview:'+preview.k04PlanDigest,
     'model-pin:'+modelPin.digest,
   ],
   uncertainties:['K02_K04_PREVIEW_ONLY_NOT_OWNER_ATTESTED'],
 };
}
