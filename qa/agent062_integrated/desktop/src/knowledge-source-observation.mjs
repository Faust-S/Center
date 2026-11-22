/** U02 projection of one existing Core-authorized read, not a second connector.
 * Normal Task submission still re-reads through HumanKnowledge/ContextCell.
 * No store, program start, provider selection or additional HTTP request.
 */
import {sourceDescriptor,sourceObservation,pinSource,sourceChange} from './public-u02/port.mjs';
const HEX=/^[a-f0-9]{64}$/;
const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&
 !/[\x00-\x1f\x7f]/.test(value);
const row=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value:{};
const fail=code=>{throw Error(code);};
async function sha(bytes){
 if(!globalThis.crypto?.subtle)fail('knowledge_source_crypto_unavailable');
 return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),
  byte=>byte.toString(16).padStart(2,'0')).join('');
}
export async function readKnowledgeSource(port,selection,{isCurrent=()=>true,now=()=>new Date().toISOString()}={}){
 if(!port||typeof port.query!=='function'||typeof isCurrent!=='function'||typeof now!=='function')
  fail('knowledge_source_port_invalid');
 // Snapshot the exact selected identity before the async owner read.
 const expected={path:selection?.path,expected_sha256:selection?.expected_sha256,
  provider_id:selection?.provider_id,binding_digest:selection?.binding_digest};
 if(!text(expected.path,2048)||!text(expected.provider_id,200)||
    !HEX.test(expected.expected_sha256??'')||!HEX.test(expected.binding_digest??''))
  fail('knowledge_source_binding_missing');
 if(!isCurrent())fail('knowledge_source_request_superseded');
 const raw=row(await port.query('knowledge_source',expected));
 if(!isCurrent())fail('knowledge_source_request_superseded');
 const binding=row(raw.binding_ref);
 if(raw.path!==expected.path||raw.provider_id!==expected.provider_id||
    raw.sha256!==expected.expected_sha256||binding.binding_digest!==expected.binding_digest||
    binding.provider_id!==expected.provider_id||raw.admission_status!=='SOURCE_ONLY'||
    typeof raw.content!=='string'||raw.content.length>1_000_000)
  fail('knowledge_source_verified_readback_mismatch');
 // Strings are immutable: snapshot fields before hashing an asynchronously
 // returned view. The provider remains the source of rights and currentness.
 const source={...raw,binding_ref:{...binding}};
 const bytes=new TextEncoder().encode(source.content);
 if(bytes.length>1_000_000)fail('knowledge_source_size_exceeded');
 if(await sha(bytes)!==expected.expected_sha256)fail('knowledge_source_content_digest_mismatch');
 const identity=await sha(new TextEncoder().encode(JSON.stringify([
  expected.provider_id,expected.binding_digest,expected.path])));
 if(!isCurrent())fail('knowledge_source_request_superseded');
 const descriptor=sourceDescriptor({providerId:'personal.knowledge',
  sourceRef:'hkw://iwxa-personal-agent/'+identity});
 const observation=sourceObservation(descriptor,{
  status:'OK',observedAt:now(),revision:'sha256:'+expected.expected_sha256,
  contentRef:'sha256:'+expected.expected_sha256,bytes:bytes.length,
  provenance:{provider:expected.provider_id,bindingDigest:expected.binding_digest,
   sourcePath:expected.path,admission:'SOURCE_ONLY',authority:'OBSERVATION_ONLY'}
 });
 return {source,observation,pin:pinSource(descriptor,observation)};
}
export function compareKnowledgeReads(previous,next){
 // U02 rejects cross-provider/binding/path observations as incomparable.
 return sourceChange(previous?.observation,next?.observation);
}
