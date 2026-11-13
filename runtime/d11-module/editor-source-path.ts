/** Resolve the original D11 editor without changing the T2 command identity.
 * CASE-001/002/003 deliberately share one approved delivery-network proposal
 * schema, but their real user interfaces and local drafts are different. */
export interface D11EditorProposal {
  producer: {toolId:string};
  result: {data:unknown};
}
function record(v:unknown):v is Record<string,unknown>{
  return v!==null&&typeof v==="object"&&!Array.isArray(v);
}
export function d11CaseLineage(proposal:D11EditorProposal):string|null{
  const data=proposal.result.data;
  if(!record(data))return null;
  const value=data.caseId;
  return typeof value==="string"&&value.length>0&&value.length<=80?value:null;
}
/** Never accept route text from a user file. Only recognized semantic case IDs
 * select code-owned tool routes; all legacy proposals keep their old editor. */
export function d11CaseEditorPath(proposal:D11EditorProposal):string|null{
  if(proposal.producer.toolId!=="delivery-network-planner")return null;
  switch(d11CaseLineage(proposal)){
    case "D11-CASE-002":return "/tools/depot-maintenance-supply";
    case "D11-CASE-003":return "/tools/distribution-network-expansion";
    default:return null;
  }
}
