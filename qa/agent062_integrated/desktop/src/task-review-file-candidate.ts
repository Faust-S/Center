/** UI-only, full fidelity presentation of a file write candidate.
 * Human Review accepts a Task result, not execution authority. This helper
 * never prepares plans, invokes tools or hides a payload before acceptance.
 */
export type FileWriteCandidate={
 candidate_id?:string;ref_id?:string;operation?:string;target?:string;
 arguments?:Record<string,unknown>;
};
export type FileWriteReview={
 rootId:string;path:string;mode:'create'|'replace';text:string;
 bytes:number;expectedSha256:string|null;
};
export function readFileWriteReview(candidate:FileWriteCandidate):FileWriteReview|null{
 if(candidate.operation!=='files.write_text')return null;
 const a=candidate.arguments;
 if(!a||typeof a.root_id!=='string'||!a.root_id
   ||typeof a.path!=='string'||!a.path||candidate.target!==a.path
   ||(a.mode!=='create'&&a.mode!=='replace')
   ||typeof a.text!=='string'||!a.text.trim())return null;
 const bytes=new TextEncoder().encode(a.text).length;
 if(bytes>2_000_000)return null;
 const expected=a.expected_sha256;
 if(a.mode==='replace'&&(typeof expected!=='string'||!/^[0-9a-f]{64}$/.test(expected)))
  return null;
 if(a.mode==='create'&&expected!==undefined&&expected!==null)return null;
 return {rootId:a.root_id,path:a.path,mode:a.mode,text:a.text,bytes,
  expectedSha256:a.mode==='replace' ? expected as string :null};
}
/** A presentation-only key. Switching Task, candidate, destination or content
 * always invalidates the user's acknowledgement of the full write proposal.
 * Never persist this value or mistake it for a cryptographic authority.
 */
export function fileWriteReviewStamp(
 taskId:string,candidates:readonly {id:string;c:FileWriteCandidate}[]
):string|null{
 if(!taskId||candidates.length===0)return null;
 const items=[];
 for(const {id,c} of candidates){
  const details=readFileWriteReview(c);
  if(!id||!details)return null;
  items.push([id,details.rootId,details.path,details.mode,
   details.expectedSha256,details.text]);
 }
 return JSON.stringify([taskId,items]);
}
