import {assignmentText} from '../src/organization.mjs';
import {readAppliedResults} from './cen03-applied-results.mjs';
import {readAtlasPortfolio} from '../src/atlas-integration.mjs';
import {serialize as serializeAtlas} from '../vendor/atlas/src/core.mjs';
import {requireCurrentWorkReference} from '../vendor/atlas/src/project-reference.mjs';
const requireValue=(ok,code)=>{if(!ok)throw Error(code);};

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
      // Retain Center's bounded source validation, then ask the canonical Atlas
      // owner model to enforce exact portfolio revision and work identity.
      readAtlasPortfolio(serializeAtlas(observed.snapshot));
      try {requireCurrentWorkReference(observed.snapshot,ref);}
      catch(error){
        const codes={
          ATLAS_SOURCE_REVISION_CHANGED:'T3_ATLAS_REVISION_CHANGED',
          ATLAS_PROJECT_NOT_IN_SOURCE:'T3_ATLAS_PROJECT_NOT_IN_SOURCE',
          ATLAS_WORK_NOT_IN_SOURCE:'T3_ATLAS_WORK_NOT_IN_SOURCE',
          ATLAS_WORK_REFERENCE_INVALID:'T3_ATLAS_WORK_BINDING_REQUIRED'
        };
        throw Error(codes[error?.code]||'T3_ATLAS_SNAPSHOT_INVALID');
      }
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
      return {bytes,taskId:after.task.id,taskRevisionId:after.task.taskRevisionId,
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
      bind(binding);
      requireValue(bytes instanceof Uint8Array,'T3_PACKAGE_BYTES_REQUIRED');
      requireValue(typeof runtime.receive==='function','T3_RECEIVE_NOT_CONNECTED');
      const receipt=runtime.receive(bytes);
      requireValue(typeof receipt?.transportReceipt?.packageSha256==='string' &&
        /^[a-f0-9]{64}$/.test(receipt.transportReceipt.packageSha256),'T3_RECEIPT_SHAPE_UNSUPPORTED');
      // Return the original owner receipt. Receiving never accepts or applies.
      return receipt;
    }
  });
}
