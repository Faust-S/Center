import {assignmentText,sameAtlasWorkRef} from '../src/organization.mjs';
import {readAppliedResults} from './cen03-applied-results.mjs';
import {readAtlasPortfolio} from '../src/atlas-integration.mjs';
import {serialize as serializeAtlas} from '../vendor/atlas/src/core.mjs';
const requireValue=(ok,code)=>{if(!ok)throw Error(code);};


/**
 * Local issuer correlation before manual file export from Center. T3 alone
 * authenticates signatures, permissions and the signed carrier. This check
 * preserves the original Atlas WorkRef; it is not proof of delivery or Apply.
 * @param {unknown} links
 * @param {any} snapshot
 * @param {string} organizationId
 * @returns {{taskId:string,taskRevisionId:string,recipientId:string,atlasRef:{projectId:string,workId:string,revision:string}} | null}
 */
export function issuedTaskExportSelection(links,snapshot,organizationId){
  if(!Array.isArray(links) || snapshot?.product!=='admin' ||
    snapshot.organizationId!==organizationId ||
    typeof snapshot.workspaceId!=='string' ||
    typeof snapshot.personId!=='string' || !snapshot.personId ||
    typeof snapshot.task?.id!=='string' ||
    !snapshot.task.id.startsWith('task:') ||
    typeof snapshot.task?.taskRevisionId!=='string' ||
    !/^[a-f0-9]{64}$/.test(snapshot.task.taskRevisionId))return null;
  const matching=links.filter(link=>{
    const recipient=link?.recipientId??link?.ownerPersonId;
    if(link && Object.hasOwn(link,'recipientId') && Object.hasOwn(link,'ownerPersonId'))
      return false;
    return link && link.organizationId===organizationId &&
      link.workspaceId===snapshot.workspaceId &&
      link.taskId===snapshot.task.id &&
      link.taskRevisionId===snapshot.task.taskRevisionId &&
      link.deliveryState==='NOT_CONFIRMED' &&
      link.associationProof==='LOCAL_ISSUER_SIDE_REFERENCE_ONLY' &&
      recipient===snapshot.personId &&
      typeof link.assignmentId==='string' && link.assignmentId.length>0 &&
      Number.isSafeInteger(link.assignmentEditNumber) && link.assignmentEditNumber>0 &&
      typeof link.atlasRef?.projectId==='string' && link.atlasRef.projectId.length>0 &&
      typeof link.atlasRef?.workId==='string' && link.atlasRef.workId.length>0 &&
      typeof link.atlasRef?.revision==='string' &&
      /^(0|[1-9][0-9]*)$/.test(link.atlasRef.revision);
  });
  if(matching.length!==1)return null;
  const link=matching[0];
  return {
    taskId:link.taskId,taskRevisionId:link.taskRevisionId,
    recipientId:snapshot.personId,
    atlasRef:{projectId:link.atlasRef.projectId,workId:link.atlasRef.workId,
      revision:link.atlasRef.revision}
  };
}

/**
 * Human-confirmed recovery of the original issuer-side WorkRef after the
 * signed T3 Task was committed but a separate Center draft CAS failed.
 * The signed claims are read back from the owning T3 host, not verified here.
 * This does not issue/sign/export any Task, alter T3, or authorize Atlas writes.
 */
export function prepareIssuedTaskLinkRecovery({organization,assignment,snapshot}={}){
  const fail=(ok,code)=>requireValue(ok,code);
  const task=snapshot?.task,claim=task?.signedClaims;
  fail(organization&&assignment&&Array.isArray(organization.assignments) &&
    assignment.workspaceId && assignment.atlasRef?.workId &&
    typeof organization.id==='string','CEN02_RECOVERY_ASSIGNMENT_NOT_SELECTED');
  fail(snapshot?.product==='admin'&&
    snapshot.organizationId===organization.id &&
    typeof snapshot.workspaceId==='string'&&snapshot.workspaceId &&
    typeof snapshot.personId==='string'&&snapshot.personId &&
    Number.isSafeInteger(snapshot.contextEpoch) &&
    snapshot.productionActivation===true&&snapshot.T3_READY===true,
    'CEN02_RECOVERY_OWNER_NOT_READY');
  // A T3 workspace cannot silently be mapped onto a different local
  // assignment workspace. Mapping belongs to the future authorized host.
  fail(assignment.workspaceId===snapshot.workspaceId,
    'CEN02_RECOVERY_WORKSPACE_MISMATCH');
  fail(typeof task?.id==='string'&&/^task:[a-zA-Z0-9:-]+$/.test(task.id) &&
    typeof task.taskRevisionId==='string'&&/^[a-f0-9]{64}$/.test(task.taskRevisionId) &&
    typeof task.task==='string'&&task.task.length>0&&task.task.length<=10000 &&
    task.organizationId===snapshot.organizationId &&
    task.workspaceId===snapshot.workspaceId &&
    task.assignedTo===snapshot.personId,
    'CEN02_RECOVERY_SIGNED_TASK_NOT_SELECTED');
  // The original T3 snapshot stores the signed claim alongside its current
  // Task. Check its exact selected revision, scope and task text; only T3
  // owns cryptographic verification and JIT authority.
  const change=claim?.changes?.[0];
  fail(claim?.schema==='IWXA_T3_RECONCILIATION_CLAIMS/1' &&
    claim?.profile?.id==='interop.task' &&
    Array.isArray(claim.changes)&&claim.changes.length===1 &&
    claim.scope?.subjectId===snapshot.organizationId &&
    claim.scope?.workspaceId===snapshot.workspaceId &&
    claim.scope?.recipientId===snapshot.personId &&
    change?.id===task.id&&change?.revisionId===task.taskRevisionId &&
    change?.body?.schemaId==='interop.task.v1'&&
    change?.body?.task===task.task,'CEN02_RECOVERY_SIGNED_CLAIMS_CHANGED');
  let expectedText;
  try {expectedText=assignmentText(organization,assignment)}
  catch {throw Error('CEN02_RECOVERY_ASSIGNMENT_CHANGED')}
  fail(expectedText===task.task,'CEN02_RECOVERY_TASK_TEXT_CHANGED');
  // The historical T3 task text doesn't carry the local assignment ID.
  // Equal names/text of two local assignments cannot be disambiguated
  // without a signed issuer-assignment ID, so refuse to guess.
  const matching=organization.assignments.filter(item=>{
    if(!item.atlasRef?.workId)return false;
    try{return assignmentText(organization,item)===task.task}
    catch{return false}
  });
  fail(matching.length===1&&matching[0].id===assignment.id,
    'CEN02_RECOVERY_AMBIGUOUS_ASSIGNMENT');
  const command={
    type:'RECORD_ISSUED_TASK_LINK',organizationId:organization.id,
    assignmentId:assignment.id,assignmentEditNumber:assignment.editNumber,
    workspaceId:assignment.workspaceId,assigneeId:assignment.assigneeId,
    reviewerId:assignment.reviewerId,recipientId:snapshot.personId,
    taskId:task.id,taskRevisionId:task.taskRevisionId,
    atlasRef:{projectId:assignment.atlasRef.projectId,
      workId:assignment.atlasRef.workId,revision:assignment.atlasRef.revision}
  };
  const previous=(organization.issuedTaskLinks??[]).filter(link=>
    link.taskId===command.taskId&&link.taskRevisionId===command.taskRevisionId);
  fail(previous.length<=1,'CEN02_RECOVERY_AMBIGUOUS_ISSUER_LINK');
  const old=previous[0];
  if(old){
    const recipient=old.recipientId??old.ownerPersonId;
    fail(!(Object.hasOwn(old,'recipientId')&&Object.hasOwn(old,'ownerPersonId')) &&
      old.organizationId===command.organizationId &&
      old.workspaceId===command.workspaceId &&
      old.assignmentId===command.assignmentId &&
      old.assignmentEditNumber===command.assignmentEditNumber &&
      old.assigneeId===command.assigneeId &&
      old.reviewerId===command.reviewerId &&
      recipient===command.recipientId &&
      old.deliveryState==='NOT_CONFIRMED' &&
      old.associationProof==='LOCAL_ISSUER_SIDE_REFERENCE_ONLY' &&
      sameAtlasWorkRef(old.atlasRef,command.atlasRef),
      'CEN02_RECOVERY_EXISTING_LINK_CONFLICT');
  }
  return {command,alreadyRecorded:Boolean(old),
    assignmentTitle:assignment.title,taskId:task.id,
    taskRevisionId:task.taskRevisionId,recipientId:snapshot.personId,
    atlasRef:{...command.atlasRef},
    effect:'LOCAL_PREPARATION_LINK_ONLY',taskReissued:false,
    delivered:false,atlasWritePerformed:false};
}

// CEN02: bounded adapter, not a package issuer or delivery/receipt database.
// The owning T3 runtime signs Task revisions, receives .iwxa and owns history.
export function createCen02Exchange({runtime,snapshot,bind,openAtlas}) {
  return Object.freeze({
    async issue({organization,assignment,binding}) {
      const current=bind(binding);
      requireValue(binding.draftOrganizationId===organization.id &&
        binding.draftWorkspaceId===assignment.workspaceId &&
        binding.draftAssigneeId===assignment.assigneeId &&
        binding.draftReviewerId===assignment.reviewerId,'T3_DRAFT_BINDING_CHANGED');
      // No implicit mapping between a local draft and an independently
      // selected T3 authority/workspace. Reject BEFORE the owner signs.
      requireValue(current.organizationId===organization.id,
        'T3_DRAFT_ORGANIZATION_NOT_SELECTED');
      requireValue(current.workspaceId===assignment.workspaceId,
        'T3_DRAFT_WORKSPACE_NOT_SELECTED');
      requireValue(binding.recipientId===current.personId,'T3_RECIPIENT_CHANGED');
      const ref=assignment.atlasRef;
      requireValue(ref && typeof ref.workId==='string' && ref.workId.length>0,
        'T3_ATLAS_WORK_BINDING_REQUIRED');
      requireValue(typeof openAtlas==='function','T3_ATLAS_OWNER_READER_REQUIRED');
      const text=assignmentText(organization,assignment);
      const observed=await openAtlas(organization.id);
      // Do not sign after a context switch while source data was being loaded.
      bind(binding);
      requireValue(observed && observed.organizationId===organization.id &&
        typeof observed.generation==='string' && observed.generation!=='none',
        'T3_ATLAS_ORGANIZATION_MISMATCH');
      const view=readAtlasPortfolio(serializeAtlas(observed.snapshot));
      requireValue(view.revision===ref.revision,'T3_ATLAS_REVISION_CHANGED');
      const project=view.projects.find(x=>x.id===ref.projectId);
      requireValue(project,'T3_ATLAS_PROJECT_NOT_IN_SOURCE');
      requireValue(project.workItems.some(x=>x.id===ref.workId),
        'T3_ATLAS_WORK_NOT_IN_SOURCE');
      if(assignment.sourceResultRef){
        // An unsigned draft reference alone is not evidence of prior application.
        const ref=assignment.sourceResultRef;
        requireValue(ref.organizationId===organization.id&&
          ref.workspaceId===assignment.workspaceId&&
          current.workspaceId===assignment.workspaceId,
          'T3_REUSED_RESULT_SCOPE_MISMATCH');
        const readback=readAppliedResults(snapshot(),organization.id,assignment.workspaceId);
        requireValue(readback.records.some(x=>x.taskId===ref.taskId&&
          x.taskRevisionId===ref.taskRevisionId&&
          x.resultRevisionId===ref.resultRevisionId&&
          x.acceptanceId===ref.acceptanceId),
          'T3_REUSED_RESULT_NOT_IN_DURABLE_STORE');
        bind(binding);
      }
      requireValue(typeof runtime.createTask==='function','T3_TASK_ISSUER_NOT_CONNECTED');
      const bytes=runtime.createTask(text);
      requireValue(bytes instanceof Uint8Array && bytes.byteLength>0,
        'T3_SIGNED_TASK_CARRIER_REQUIRED');
      const after=snapshot();
      requireValue(typeof after.task?.id==='string' && after.task.id.startsWith('task:') &&
        typeof after.task.taskRevisionId==='string' &&
        /^[a-f0-9]{64}$/.test(after.task.taskRevisionId) &&
        after.organizationId===current.organizationId &&
        after.workspaceId===current.workspaceId &&
        after.personId===current.personId,
        'T3_ISSUE_READBACK_REQUIRED');
      // Issuer-side association, not a T3 signature over the Atlas reference.
      return {bytes,taskId:after.task.id,taskRevisionId:after.task.taskRevisionId,
        organizationId:current.organizationId,workspaceId:current.workspaceId,
        assignmentId:assignment.id,recipientId:binding.recipientId,
        atlasRef:{projectId:ref.projectId,workId:ref.workId,revision:ref.revision},
        deliveryState:'NOT_CONFIRMED'};
    },
    // Original T3 interop/runtime.mjs:taskBytes reads the previously signed
    // revision from its own carrier store and performs a fresh owner JIT check.
    // This is a manual export, not a delivery acknowledgment.
    exportIssuedTask({taskId,taskRevisionId,binding}) {
      const current=bind(binding);
      const before=snapshot();
      requireValue(before.task?.id===taskId &&
        before.task?.taskRevisionId===taskRevisionId &&
        typeof taskId==='string' && taskId.startsWith('task:') &&
        typeof taskRevisionId==='string' && /^[a-f0-9]{64}$/.test(taskRevisionId),
        'T3_SIGNED_TASK_REVISION_NOT_SELECTED');
      requireValue(typeof runtime.taskBytes==='function',
        'T3_SIGNED_TASK_EXPORT_NOT_CONNECTED');
      const bytes=runtime.taskBytes();
      requireValue(bytes instanceof Uint8Array && bytes.byteLength>0,
        'T3_SIGNED_TASK_CARRIER_REQUIRED');
      // T3 owns carrier signing and JIT checks. Before reporting an
      // export, revalidate the original operator/workspace/epoch after
      // the T3 read: it may have changed while the file was prepared.
      bind(binding);
      const after=snapshot();
      requireValue(after.organizationId===current.organizationId &&
        after.workspaceId===current.workspaceId &&
        after.personId===current.personId &&
        after.task?.id===taskId &&
        after.task?.taskRevisionId===taskRevisionId,
        'T3_SIGNED_TASK_SOURCE_CHANGED');
      return {bytes,taskId,taskRevisionId,deliveryState:'NOT_CONFIRMED'};
    },
    receive({bytes,binding}) {
      const current=bind(binding);
      requireValue(bytes instanceof Uint8Array,'T3_PACKAGE_BYTES_REQUIRED');
      requireValue(typeof runtime.receive==='function','T3_RECEIVE_NOT_CONNECTED');
      const receipt=runtime.receive(bytes);
      const packageSha256=receipt?.transportReceipt?.packageSha256;
      requireValue(typeof packageSha256==='string' &&
        /^[a-f0-9]{64}$/.test(packageSha256),'T3_RECEIPT_SHAPE_UNSUPPORTED');
      // Original T3 snapshot().packages enumerates its quarantine. A receipt
      // alone cannot establish durable receipt in the owning Store. If the
      // readback fails, do not auto-receive a second time: surface HOLD.
      const observed=bind(binding);
      requireValue(observed.personId===current.personId &&
        Array.isArray(observed.packages) &&
        observed.packages.includes(packageSha256),
        'T3_RECEIVE_STORE_READBACK_HOLD');
      // Never infer ACCEPTED or APPLIED from this original transport receipt.
      return receipt;
    }
  });
}
