/** P01 personal reviewed Obsidian action: UI admission and durable readback.
 * All real authority and writes belong to DailyDriver/ToolRuntime, not this helper.
 */
export type ObsidianDraftMode='create'|'replace';
export type ObsidianDraftRequest={
 source_task_id:string;path:string;text:string;mode:ObsidianDraftMode;
 confirmed:true;expected_sha256?:string;
};
export type ObsidianDraftExpectation={
 sourceTaskId:string;workspaceId:string;acceptedDigest:string;
 path:string;text:string;mode:ObsidianDraftMode;expectedSha256?:string;
};
type Row=Record<string,unknown>;
const sha=(value:unknown):value is string=>
 typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const taskId=(value:unknown):value is string=>
 typeof value==='string'&&/^TASK-[A-Za-z0-9_-]{1,80}$/.test(value);
const row=(value:unknown):Row|null=>
 value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Row:null;
const reserved=/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i;

/** Path is Vault-relative, not a filesystem path or a source of authority. */
export function validObsidianDraftPath(path:string):boolean{
 if(typeof path!=='string'||!path||path!==path.trim()||path.length>240||
    path.startsWith('/')||path.includes('\\')||!/\.(md|txt)$/i.test(path))return false;
 return path.split('/').every(part=>
  !!part&&part!=='.'&&part!=='..'&&!part.startsWith('.')&&
  !/[. ]$/.test(part)&&!/[<>:"|?*\u0000-\u001f]/.test(part)&&!reserved.test(part));
}
export function draftRequest(input:ObsidianDraftExpectation):ObsidianDraftRequest|null{
 const {sourceTaskId,workspaceId,acceptedDigest,path,text,mode,expectedSha256}=input;
 if(!taskId(sourceTaskId)||!workspaceId||!sha(acceptedDigest)||
    !validObsidianDraftPath(path)||typeof text!=='string'||!text.trim()||
    new TextEncoder().encode(text).length>48000||
    (mode!=='create'&&mode!=='replace'))return null;
 if(mode==='replace'&&!sha(expectedSha256))return null;
 if(mode==='create'&&expectedSha256!==undefined)return null;
 return {source_task_id:sourceTaskId,path,text,mode,confirmed:true,
  ...(mode==='replace'?{expected_sha256:expectedSha256}:{})};
}
export function acceptedSourceMatches(
 source:unknown,expected:Pick<ObsidianDraftExpectation,'sourceTaskId'|'acceptedDigest'>,
):boolean{
 const data=row(source);
 return !!data&&data.task_id===expected.sourceTaskId&&data.status==='closed'&&
  sha(data.accepted_artifact_digest)&&data.accepted_artifact_digest===expected.acceptedDigest;
}
/** An ACK alone cannot assert a new Task exists or that a Vault was changed. */
export function obNoteDraftReadbackMatches(
 ack:unknown,derived:unknown,expectation:ObsidianDraftExpectation,
):boolean{
 const response=row(ack),task=row(derived);
 if(!response||!task||!taskId(response.task_id)||
    !/^TASK-OBSN-[a-f0-9]{20}$/.test(response.task_id)||
    typeof response.candidate_id!=='string'||!/^AC-OBSN-[a-f0-9]{20}$/.test(response.candidate_id)||
    response.workspace_id!==expectation.workspaceId||
    response.source_task_id!==expectation.sourceTaskId||
    response.execution_performed!==false||response.model_invoked!==false||
    task.task_id!==response.task_id)return false;
 const actions=task.action_candidates;
 if(!Array.isArray(actions))return false;
 const candidates=actions.filter(item=>{
  const c=row(item),args=row(c?.arguments);
  return !!c&&!!args&&c.candidate_id===response.candidate_id&&
   c.operation==='obsidian.write_governed'&&c.target===expectation.path&&
   args.path===expectation.path&&args.content===expectation.text&&
   (expectation.mode==='create'?args.expected_sha256===undefined:
    args.expected_sha256===expectation.expectedSha256);
 });
 return candidates.length===1&&['result_imported','closed'].includes(String(task.status))&&
  response.review_required===(task.status!=='closed');
}
/** Replacement comes from exact provider/binding/source readback, not a typed digest. */
export function verifiedReplacement(
 path:string,source:unknown,providerId:string,bindingDigest:string,
):string|null{
 const data=row(source),binding=row(data?.binding_ref);
 if(!data||!binding||data.path!==path||data.provider_id!==providerId||
    !sha(data.sha256)||!sha(bindingDigest)||
    binding.binding_digest!==bindingDigest)return null;
 return data.sha256 as string;
}
