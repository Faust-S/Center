import {assignmentText} from '../src/organization.mjs';
import {readAtlasPortfolio} from '../src/atlas-integration.mjs';
import {serialize as serializeAtlas} from '../vendor/atlas/src/core.mjs';
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
      const view=readAtlasPortfolio(serializeAtlas(observed.snapshot));
      requireValue(view.revision===ref.revision,'T3_ATLAS_REVISION_CHANGED');
      const project=view.projects.find(x=>x.id===ref.projectId);
      requireValue(project,'T3_ATLAS_PROJECT_NOT_IN_SOURCE');
      requireValue(project.workItems.some(x=>x.id===ref.workId),
        'T3_ATLAS_WORK_NOT_IN_SOURCE');
      requireValue(typeof runtime.createTask==='function','T3_TASK_ISSUER_NOT_CONNECTED');
      const bytes=runtime.createTask(text);
      const after=snapshot();
      requireValue(after.task?.id && after.task?.taskRevisionId,
        'T3_ISSUE_READBACK_REQUIRED');
      return {bytes,taskId:after.task.id,taskRevisionId:after.task.taskRevisionId,
        atlasRef:{projectId:ref.projectId,workId:ref.workId,revision:ref.revision},
        deliveryState:'NOT_CONFIRMED'};
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
