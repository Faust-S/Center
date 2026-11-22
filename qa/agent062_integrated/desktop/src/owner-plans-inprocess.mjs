// In-process owner planning for Agent 0.5. The two imported libraries are
// pinned K02/K04 source, apart from their documented Node-API compatibility shim.
// This is a draft computation: only the existing Python Core can save a Graph,
// execute a model, authorize effects or issue U01 receipts.
import {utf8ByteLength} from './owner-hash-shim.mjs';
import {resolveRequirements, buildInvocationPlan} from './public-k02/index.mjs';
import {recommendModelForStep} from './public-k02/model-step-selection.mjs';
import {resolveK02OwnerChoice} from './owner-k02-recommendation-port.mjs';
import {resolveModelAndSkills, resolveRequiredCapabilities,
  createHostNeutralPlan} from './public-k04/index.mjs';

export const INPROCESS_PLAN_VERSION='PA.K02_K04.INPROCESS_DRAFT/0.1.0';
const REQUEST_VERSION='PA.K02_K04.OWNER_REQUEST/0.1.0';
const TASK=/^TASK-[A-Za-z0-9_-]{1,100}$/;
const isObject=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const pinEqual=(a,b)=>isObject(a)&&isObject(b)&&
  a.name===b.name&&a.digest===b.digest;
function fail(code){throw new Error(code);}
function boundedJson(value,maxBytes) {
  let serialized;
  try { serialized=JSON.stringify(value); }
  catch { fail('OWNER_REQUEST_INVALID'); }
  if(typeof serialized!=='string'||utf8ByteLength(serialized)>maxBytes)
    fail('OWNER_REQUEST_TOO_LARGE');
  return serialized;
}
function sourceRequest(request,taskId,section){
  if(!isObject(request)||request.schema!==REQUEST_VERSION||
    request.task_id!==taskId||!isObject(request[section]))
    fail('OWNER_REQUEST_INVALID');
  return request[section];
}
function ensureModel(step,reqId){
  return isObject(step)&&step.requirementId===reqId&&
    step.kind==='model'&&step.capabilityId==='text.generate'&&
    isObject(step.modelPin);
}
function onlyMatchingModel(k02Plan,k04Plan,requirementId){
  const k02=k02Plan.steps.filter(step=>ensureModel(step,requirementId));
  const k04=k04Plan.steps.filter(step=>step?.type==='CAPABILITY_REQUEST'&&
    ensureModel(step.selected,requirementId)).map(step=>step.selected);
  if(k02.length!==1||k04.length!==1||
    k02[0].providerId!==k04[0].providerId||
    !pinEqual(k02[0].modelPin,k04[0].modelPin))
    fail('OWNER_MODEL_PLANS_DISAGREE');
  return {providerId:k02[0].providerId,modelPin:k02[0].modelPin};
}

/** Exact owner request payloads, as previously consumed by the two EXEs.
 * This function reads no files, runs no subprocesses, invokes no models, and
 * never invents a receipt. K04 plan mode remains the owner's own choice.
 */
export function prepareInProcessK02K04({
  taskId,k02Request,k04Request,requirementId,
}){
  if(typeof taskId!=='string'||!TASK.test(taskId)||
    typeof requirementId!=='string'||!requirementId)fail('OWNER_TASK_INVALID');
  boundedJson(k02Request,1_000_000);
  boundedJson(k04Request,1_000_000);
  const k02=sourceRequest(k02Request,taskId,'k02');
  const k04=sourceRequest(k04Request,taskId,'k04');
  if(!isObject(k02.solution)||!Array.isArray(k02.providers)||
    !Array.isArray(k02.selected_skills)||!isObject(k04.task)||
    k04.task.taskId!==taskId||!isObject(k04.availability))
    fail('OWNER_REQUEST_INVALID');
  // Keep the same optional recommendation/negative-evidence semantics as the
  // pinned owner CLI. An absent recommendation retains the fast plain resolver.
  const k02Resolution=resolveK02OwnerChoice(k02,{
    resolveRequirements,recommendModelForStep,
  });
  if(k02Resolution.status!=='SUPPORTED')fail('K02_REQUIREMENTS_UNSUPPORTED');
  const k02Plan=buildInvocationPlan(
    {taskId,solutionId:k02.solution.solutionId},
    k02.selected_skills,k02Resolution);
  let k04Resolution,k04Plan;
  if(k04.mode==='model_skills'){
    if(!isObject(k04.model_requirement)||
      !Array.isArray(k04.tool_requirements)||
      !Array.isArray(k04.selected_skill_ids))fail('OWNER_REQUEST_INVALID');
    k04Resolution=resolveModelAndSkills({
      modelRequirement:k04.model_requirement,
      toolRequirements:k04.tool_requirements,
      selectedSkillIds:k04.selected_skill_ids,
    },k04.availability);
    if(k04Resolution.status!=='SUPPORTED')fail('K04_REQUIREMENTS_UNSUPPORTED');
    k04Plan=createHostNeutralPlan({
      task:k04.task,resolution:k04Resolution,mode:'model_skills',
      selectedSkills:k04.selected_skill_ids,
    });
  }else if(k04.mode==='solution'){
    if(!isObject(k04.solution))fail('OWNER_REQUEST_INVALID');
    k04Resolution=resolveRequiredCapabilities(
      k04.solution,k04.availability,k04.options??{});
    if(k04Resolution.status!=='SUPPORTED')fail('K04_REQUIREMENTS_UNSUPPORTED');
    k04Plan=createHostNeutralPlan({
      task:k04.task,solution:k04.solution,resolution:k04Resolution,
      mode:'solution',
    });
  }else fail('OWNER_REQUEST_INVALID');
  if(k04Plan.taskRef!==taskId||k02Plan.taskId!==taskId)
    fail('OWNER_MODEL_PLANS_DISAGREE');
  boundedJson(k02Plan,120_000);
  boundedJson(k04Plan,120_000);
  const chosen=onlyMatchingModel(k02Plan,k04Plan,requirementId);
  return {
    schema:INPROCESS_PLAN_VERSION,taskId,requirementId,
    selected:chosen,k02Plan,k04Plan,
    executionPerformed:false,hostAuthorityGranted:false,
    ownerReceipts:null,verifiedByCore:false,
  };
}
