import {assignmentText} from '../src/organization.mjs';
const requireValue = (ok, reason) => { if (!ok) throw Error(reason); };

// Existing runtime owns signatures, grants, revisions, decisions and effects.
// The UI cannot use a draft role label as an authorization claim.
export function createT3AdminPort(runtime) {
  requireValue(runtime?.product === 'admin' && typeof runtime.snapshot === 'function', 'T3_ADMIN_RUNTIME_REQUIRED');
  const snapshot = () => runtime.snapshot();
  const bind = expected => {
    const current = snapshot();
    requireValue(current.organizationId === expected.organizationId && current.workspaceId === expected.workspaceId && current.contextEpoch === expected.contextEpoch, 'T3_CONTEXT_CHANGED');
    return current;
  };
  return Object.freeze({
    snapshot,
    issue({organization, assignment, binding}) {
      const current = bind(binding);
      requireValue(binding.draftOrganizationId === organization.id && binding.draftWorkspaceId === assignment.workspaceId && binding.draftAssigneeId === assignment.assigneeId, 'T3_DRAFT_BINDING_CHANGED');
      requireValue(binding.recipientId === current.personId, 'T3_RECIPIENT_CHANGED');
      const bytes = runtime.createTask(assignmentText(organization, assignment));
      const after = snapshot();
      return {bytes, taskId: after.task.id, taskRevisionId: after.task.taskRevisionId, deliveryState: 'NOT_CONFIRMED'};
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
