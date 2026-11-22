/** U02 read-only evidence for an output already verified by Core.
 * One existing public_program_result read; no second provider observation,
 * executable invocation, content cache, or Task authority.
 */
import {sourceDescriptor,sourceObservation,pinSource} from './public-u02/port.mjs';

const HEX=/^[a-f0-9]{64}$/;
async function sha(bytes){
 const subtle=globalThis.crypto?.subtle;
 if(!subtle)throw Error('u02_program_source_crypto_unavailable');
 return Array.from(new Uint8Array(await subtle.digest('SHA-256',bytes)),
  b=>b.toString(16).padStart(2,'0')).join('');
}
export async function observeSavedProgramOutput(result,now=()=>new Date().toISOString()){
 if(!result||result.execution_performed!==false||result.read_only!==true||
    result.output_verified!==true||result.metadata_only!==false||
    typeof result.workspace_id!=='string'||!result.workspace_id||
    typeof result.task_id!=='string'||!/^TASK-[A-Za-z0-9_-]+$/.test(result.task_id)||
    typeof result.receipt_id!=='string'||!/^TXR-[A-Za-z0-9_-]{1,100}$/.test(result.receipt_id)||
    typeof result.output_digest!=='string'||!HEX.test(result.output_digest)||
    typeof result.data?.output!=='string')
  throw Error('u02_program_source_readback_invalid');
 const body=new TextEncoder().encode(result.data.output);
 if(body.length>1_000_000)throw Error('u02_program_source_too_large');
 const revision='sha256:'+await sha(body);
 const key=await sha(new TextEncoder().encode(JSON.stringify([
  result.workspace_id,result.task_id,result.receipt_id,result.output_digest])));
 const descriptor=sourceDescriptor({providerId:'personal.program-output',
  sourceRef:'u01-output://sha256/'+key,capabilities:[
   {id:'source.describe',available:true},
   {id:'source.refresh',available:false},
   {id:'source.read',available:false}
  ]});
 const observation=sourceObservation(descriptor,{status:'OK',observedAt:now(),
  revision,contentRef:revision,bytes:body.length,
  provenance:{provider:'U01_CORE_RECEIPT',taskId:result.task_id,
   receiptId:result.receipt_id,workspaceId:result.workspace_id,
   outputDigest:result.output_digest,authority:'OBSERVATION_ONLY'}});
 return {pin:pinSource(descriptor,observation),observation};
}
