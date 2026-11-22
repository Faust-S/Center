/** Read-only projection of locally observed Ollama model identities.
 * The configured IWXA Ollama source wins over an unrelated default-port probe.
 * No model installation, provider switch, permission, or model ownership here.
 */
export type LocalModelPin={name:string;digest:string};
export type ModelSource='CONFIGURED'|'DEFAULT_PORT'|'UNAVAILABLE';
type Row=Record<string,unknown>;
const row=(value:unknown):Row=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
export const normalizedLocalDigest=(value:unknown):string=>
 typeof value==='string'?value.trim().toLowerCase().replace(/^sha256:/,''):'';

/** Only an explicit, successfully read unconfigured state permits probing the
 * standard Ollama port. Missing or contradictory Core observations fail closed.
 */
export const canDiscoverDefaultOllama=(value:unknown):boolean=>
 row(value).source_confirmed===false;

export function observedLocalModels(value:unknown):LocalModelPin[]{
 if(!Array.isArray(value))return [];
 const result:LocalModelPin[]=[];
 const seen=new Set<string>();
 for(const item of value){
  const candidate=row(item);
  const name=typeof candidate.name==='string'?candidate.name:'';
  const digest=normalizedLocalDigest(candidate.digest);
  if(!name.trim()||name.toLowerCase().endsWith(':cloud')||candidate.remote_host||candidate.remote_model
    ||new TextEncoder().encode(name).length>240||!/^[a-f0-9]{64}$/.test(digest))continue;
  const key=JSON.stringify([name,digest]);
  if(seen.has(key))continue;
  seen.add(key);result.push({name,digest});
 }
 return result;
}

export function localModelSource(localValue:unknown,existingValue:unknown,routeValue:unknown):{
 source:ModelSource;models:LocalModelPin[];configuredReady:boolean;active:boolean;
}{
 const local=row(localValue),existing=row(existingValue),route=row(routeValue);
 const configuredReady=local.source_confirmed===true&&local.daemon_ready===true;
 const active=configuredReady&&route.active_model_provider_id==='OLLAMA_LOCAL_V1';
 if(configuredReady){
  return {source:'CONFIGURED',models:observedLocalModels(local.local_models),configuredReady,active};
 }
 // A confirmed source remains authoritative even when temporarily down.
 // Never borrow model identities from a different default-port daemon.
 if(canDiscoverDefaultOllama(local)&&existing.responding===true){
  return {source:'DEFAULT_PORT',models:observedLocalModels(existing.models),configuredReady:false,active:false};
 }
 return {source:'UNAVAILABLE',models:[],configuredReady:false,active:false};
}

export const hasObservedPin=(catalogue:LocalModelPin[],value:LocalModelPin|null):boolean=>
 !!value&&catalogue.some(m=>m.name===value.name&&m.digest===normalizedLocalDigest(value.digest));
