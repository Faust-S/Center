/** Presentation-only eligibility for the existing Office/file tools.
 *
 * A local-model document mode is not required to open a reviewed file in an
 * installed program or to ask the original U01 to OCR a scanned PDF. The
 * existing Agent Core and ToolRuntime still independently revalidate Task,
 * Workspace, provider, exact file revision and explicit Human Review.
 */
type AcceptedOfficeTask={
 task_id?:unknown;status?:unknown;accepted_artifact_digest?:unknown;
};
export function acceptedOfficeTaskEntry(
 value:AcceptedOfficeTask|null|undefined,workspaceId:unknown,verified:unknown
):boolean{
 return verified===true&&typeof workspaceId==='string'&&workspaceId.length>0
  &&value!==null&&value!==undefined
  &&typeof value.task_id==='string'&&/^TASK-[A-Za-z0-9-]{1,100}$/.test(value.task_id)
  &&value.status==='closed'
  &&typeof value.accepted_artifact_digest==='string'
  &&value.accepted_artifact_digest.length>0;
}
