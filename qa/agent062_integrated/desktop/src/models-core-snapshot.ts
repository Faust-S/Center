/** Read-only, bounded model-screen hydration from the existing Python Core.
 * No browser cache, alternate model storage, or implicit provider activation.
 */
export type CoreModelRow=Record<string,unknown>;
export type ModelRouteObservation={route:string|null;issue:string|null};
export type ModelsCoreSnapshot={
  values:Record<string,CoreModelRow>;
  successful:string[];
  faults:{name:string;reason:unknown}[];
  route:ModelRouteObservation;
  attempts:number;
};
const names=['local_ai_setup','user_setup','operational_control','status','iwxa_basic_model_status'] as const;
type QueryName=typeof names[number];
const row=(value:unknown):CoreModelRow=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as CoreModelRow:{};
const str=(value:unknown):string=>typeof value==='string'?value.trim():'';

export function observeModelRoute(operational:unknown,setup:unknown):ModelRouteObservation{
  const active=str(row(operational).active_model_provider_id);
  const user=row(setup);
  const slot=Array.isArray(user.slots)?user.slots.map(row).find(item=>item.slot_id==='model'):undefined;
  const configured=str(slot?.active_provider_id)||str(user.active_model_provider_id);
  if(!active)return {route:null,issue:'MODEL_ROUTE_NOT_OBSERVED'};
  if(configured&&configured!==active)return {route:null,issue:'MODEL_ROUTE_CONFLICT'};
  return {route:active,issue:null};
}

/** Read the expensive GGUF identity once. Only a missing or contradictory
 * model route is retried; never repeat unrelated status or file hashing.
 * A selected GGUF with route NONE is a legitimate unassigned configuration.
 */
export async function readModelsCoreSnapshot(
  query:(name:string)=>Promise<unknown>,
  wait:(milliseconds:number)=>Promise<void>,
  isCurrent:()=>boolean=()=>true,
):Promise<ModelsCoreSnapshot|null>{
  const primary=await Promise.allSettled(names.slice(0,4).map(name=>query(name)));
  if(!isCurrent())return null;
  const [model]=await Promise.allSettled([query('iwxa_basic_model_status')]);
  if(!isCurrent())return null;
  const observed:Record<QueryName,PromiseSettledResult<unknown>>={
    local_ai_setup:primary[0],user_setup:primary[1],
    operational_control:primary[2],status:primary[3],iwxa_basic_model_status:model,
  };
  for(let attempt=0;attempt<3;attempt++){
    if(!isCurrent())return null;
    const values:Record<string,CoreModelRow>={};
    const successful:string[]=[];
    const faults:{name:string;reason:unknown}[]=[];
    for(const name of names){
      const result=observed[name];
      if(result.status==='fulfilled'){
        values[name]=row(result.value);
        successful.push(name);
      }else{
        values[name]={};
        faults.push({name,reason:result.reason});
      }
    }
    const route=successful.includes('user_setup')&&successful.includes('operational_control')
      ?observeModelRoute(values.operational_control,values.user_setup)
      :{route:null,issue:'MODEL_ROUTE_UNAVAILABLE'};
    const result={values,successful,faults,route,attempts:attempt+1};
    const retryNames:QueryName[]=[];
    if(route.issue){
      retryNames.push('user_setup','operational_control');
    }
    if(route.route==='IWXA_BASIC_RUNTIME_V1'&&!successful.includes('iwxa_basic_model_status')){
      retryNames.push('iwxa_basic_model_status');
    }
    if(attempt===2||retryNames.length===0)return result;
    await wait(attempt===0?250:650);
    if(!isCurrent())return null;
    const next=await Promise.allSettled(retryNames.map(name=>query(name)));
    if(!isCurrent())return null;
    retryNames.forEach((name,i)=>{observed[name]=next[i];});
  }
  return null;
}

/** Read-only active model label. A saved GGUF pin or the last Ollama probe
 * cannot be presented as the active model when Core selected NONE or another
 * provider. Match the last local probe to the current selection before calling
 * its response verified.
 */
export type ActiveModelPresentation={
 kind:'NONE'|'ENGINE'|'OLLAMA'|'OTHER';
 name:string;
 responseVerified:boolean;
};
export function activeModelPresentation(
 route:string,enginePin:unknown,ollamaName:unknown,
 ollamaResponseVerified:unknown,selectionMatchesLastCheck:unknown,
 otherProviderName:unknown='',
):ActiveModelPresentation{
 if(route==='NONE')return {kind:'NONE',name:'',responseVerified:false};
 if(route==='IWXA_BASIC_RUNTIME_V1')return {
  kind:'ENGINE',name:str(row(enginePin).name)||'IWXA LLM Engine',responseVerified:false
 };
 if(route==='OLLAMA_LOCAL_V1')return {
  kind:'OLLAMA',name:str(ollamaName)||'Ollama',
  responseVerified:ollamaResponseVerified===true&&selectionMatchesLastCheck===true
 };
 return {kind:'OTHER',name:str(otherProviderName),responseVerified:false};
}
