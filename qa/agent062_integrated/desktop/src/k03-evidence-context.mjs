/** Show literal, bounded K03 evidence from the exact user-supplied source.
 * Display-only. No model inference, source fetch, second U1, or Task authority.
 */
const HEX=/^[a-f0-9]{64}$/;
const positive=n=>Number.isInteger(n)&&n>=0;

export function k03SourceExcerpt(hypothesis,observations,sources){
 if(!hypothesis||!Array.isArray(hypothesis.evidence_links)||
    !Array.isArray(observations)||!Array.isArray(sources))return null;
 const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
 for(const link of hypothesis.evidence_links){
  if(!link||typeof link!=='object'||typeof link.evidence_id!=='string')continue;
  const observed=observations.find(o=>o?.id===link.evidence_id);
  const row=sources.find(s=>s?.source_id===link.source_id);
  if(!observed||!row||typeof row.text!=='string'||typeof row.revision!=='string'||
     row.revision!==link.source_revision||row.source_id!==link.source_id||
     !HEX.test(link.source_sha256)||row.manifest?.sha256!==link.source_sha256||
     row.manifest?.source_reference!==link.source_ref||
     observed.source_id!==link.source_id||observed.source_sha256!==link.source_sha256||
     observed.source_revision!==link.source_revision||observed.source_ref!==link.source_ref)
   continue;
  const at=link.locator,owner=observed.locator;
  if(!at||!owner||!positive(at.byte_start)||!positive(at.byte_end)||
     at.byte_end<=at.byte_start||at.byte_start!==owner.byte_start||
     at.byte_end!==owner.byte_end)continue;
  const bytes=encoder.encode(row.text);
  if(at.byte_end>bytes.length||bytes.length>128000)continue;
  try{
   const cue=decoder.decode(bytes.subarray(at.byte_start,at.byte_end)).trim();
   if(!cue)return null;
   let begin=at.byte_start,end=at.byte_end;
   while(begin>0&&bytes[begin-1]!==10&&bytes[begin-1]!==13)begin--;
   while(end<bytes.length&&bytes[end]!==10&&bytes[end]!==13)end++;
   const line=decoder.decode(bytes.subarray(begin,end)).trim();
   const excerpt=line.length<=600?line:(cue.slice(0,240));
   if(!excerpt)return null;
   return {text:excerpt,sourceId:link.source_id,
           sourceRevision:link.source_revision,
           sourceSha256:link.source_sha256,
           locator:{byte_start:at.byte_start,byte_end:at.byte_end},
           evidenceId:link.evidence_id};
  }catch(_){
   // Invalid byte boundaries never justify a Task suggestion.
   continue;
  }
 }
 return null;
}
