import {assignmentText} from '../src/organization.mjs';
import {readAtlasPortfolio} from '../src/atlas-integration.mjs';
import {serialize as serializeAtlas} from '../vendor/atlas/src/core.mjs';
const requireValue = (ok, reason) => { if (!ok) throw Error(reason); };

// Existing runtime owns signatures, grants, revisions, decisions and effects.
// The UI cannot use a draft role label as an authorization claim.
// Host-owned Atlas readback verifies plan freshness only. T3 still owns
// organization rights, signing, acceptance and publication of each .iwxa.
export function createT3AdminPort(runtime, {openAtlas} = {}) {
  requireValue(runtime?.product === 'admin' && typeof runtime.snapshot === 'function', 'T3_ADMIN_RUNTIME_REQUIRED');
  const snapshot = () => runtime.snapshot();
  const bind = expected => {
    const current = snapshot();
    requireValue(current.organizationId === expected.organizationId && current.workspaceId === expected.workspaceId && current.contextEpoch === expected.contextEpoch, 'T3_CONTEXT_CHANGED');
    return current;
  };
  return Object.freeze({
    snapshot,
    async issue({organization, assignment, binding}) {
      const current = bind(binding);
      requireValue(binding.draftOrganizationId === organization.id &&
        binding.draftWorkspaceId === assignment.workspaceId &&
        binding.draftAssigneeId === assignment.assigneeId &&
        binding.draftReviewerId === assignment.reviewerId,
        'T3_DRAFT_BINDING_CHANGED');
      requireValue(binding.recipientId === current.personId, 'T3_RECIPIENT_CHANGED');
      const ref = assignment.atlasRef;
      requireValue(ref && typeof ref.workId === 'string' && ref.workId.length > 0,
        'T3_ATLAS_WORK_BINDING_REQUIRED');
      requireValue(typeof openAtlas === 'function', 'T3_ATLAS_OWNER_READER_REQUIRED');
      const text = assignmentText(organization, assignment);
      const observed = await openAtlas(organization.id);
      // An organizational context switch while reading the source invalidates issue.
      bind(binding);
      requireValue(observed && observed.organizationId === organization.id &&
        typeof observed.generation === 'string' && observed.generation !== 'none',
        'T3_ATLAS_ORGANIZATION_MISMATCH');
      const view = readAtlasPortfolio(serializeAtlas(observed.snapshot));
      requireValue(view.revision === ref.revision, 'T3_ATLAS_REVISION_CHANGED');
      const project = view.projects.find(x => x.id === ref.projectId);
      requireValue(project, 'T3_ATLAS_PROJECT_NOT_IN_SOURCE');
      requireValue(project.workItems.some(x => x.id === ref.workId),
        'T3_ATLAS_WORK_NOT_IN_SOURCE');
      // Only the existing T3 runtime creates the signed Task package.
      const bytes = runtime.createTask(text);
      const after = snapshot();
      requireValue(after.task?.id && after.task?.taskRevisionId,
        'T3_ISSUE_READBACK_REQUIRED');
      return {bytes, taskId: after.task.id, taskRevisionId: after.task.taskRevisionId,
        atlasRef: {projectId:ref.projectId,workId:ref.workId,revision:ref.revision},
        deliveryState:'NOT_CONFIRMED'};
    },
    inspect({bytes, binding}) {
      bind(binding);
      const received = runtime.receive(bytes);
      requireValue(typeof received.packageSha256 === 'string', 'T3_RECEIPT_SHAPE_UNSUPPORTED');
      return runtime.review(received.packageSha256);
    },
    decide({packageSha256, previewDigest, decision, reason = '', binding}) {
      bind(binding);
      // Return-for-changes needs an owning T3 business operation, not a relabelled reject.
      requireValue(decision !== 'CHANGES_REQUESTED', 'T3_RETURN_OPERATION_NOT_AVAILABLE');
      requireValue(['ACCEPT', 'REJECT'].includes(decision), 'DECISION_INVALID');
      return runtime.decide(packageSha256, {previewDigest, decision, reason});
    },
    previewApplication({acceptanceId, revisionIds, binding}) {
      bind(binding); return runtime.previewApplication({acceptanceId, revisionIds});
    }
  });
}
