import {assignmentText} from '../src/organization.mjs';
import {readAppliedResults} from './cen03-applied-results.mjs';
import {readAtlasPortfolio} from '../src/atlas-integration.mjs';
import {serialize as serializeAtlas} from '../vendor/atlas/src/core.mjs';
import {createAtlasSavedRef} from '../vendor/atlas/src/project-host-port.mjs';
const requireValue=(ok,code)=>{if(!ok)throw Error(code);};

// CEN02: bounded adapter, not a package issuer or delivery/receipt database.
// The owning T3 runtime signs Task revisions, receives .iwxa and owns history.
export function createCen02Exchange({runtime,snapshot,bind,openAtlas}) {
  return Object.freeze({
    // Original T3 interop/runtime.mjs owns the employee/organization context.
    // Center only selects a staff identity already present in the owner readback.
    selectStaff({staffId,binding}) {
      const before=bind(binding);
      const selected=Array.isArray(before.staff) ? before.staff.find(x=>
        x?.id===staffId && typeof x.personId==='string' && x.personId &&
        typeof x.workspaceId==='string' && x.workspaceId) : null;
      requireValue(selected,'T3_STAFF_NOT_IN_OWNER');
      requireValue(typeof runtime.selectStaff==='function','T3_STAFF_SELECTION_NOT_CONNECTED');
      const receipt=runtime.selectStaff(staffId);
      const after=snapshot();
      requireValue(receipt?.staffId===staffId &&
        receipt.contextEpoch===after.contextEpoch &&
        after.product==='admin' && after.organizationId===before.organizationId &&
        after.selectedStaffId===staffId &&
        after.personId===selected.personId && after.workspaceId===selected.workspaceId &&
        Number.isSafeInteger(after.contextEpoch) &&
        after.contextEpoch>before.contextEpoch,
        'T3_STAFF_SELECTION_READBACK_HOLD');
      return receipt;
    },
    // Actor identity and key custody remain exclusively in the original T3.
    selectOperator({operatorId,binding}) {
      const before=bind(binding);
      const selected=Array.isArray(before.operators) ? before.operators.find(x=>
        x?.id===operatorId && typeof x.personId==='string' && x.personId) : null;
      requireValue(selected,'T3_OPERATOR_NOT_IN_OWNER');
      requireValue(typeof runtime.selectOperator==='function','T3_OPERATOR_SELECTION_NOT_CONNECTED');
      const receipt=runtime.selectOperator(operatorId);
      const after=snapshot();
      requireValue(receipt?.operatorId===operatorId &&
        receipt.contextEpoch===after.contextEpoch &&
        after.product==='admin' && after.organizationId===before.organizationId &&
        after.workspaceId===before.workspaceId && after.personId===before.personId &&
        after.selectedOperatorId===operatorId &&
        Number.isSafeInteger(after.contextEpoch) &&
        after.contextEpoch>before.contextEpoch,
        'T3_OPERATOR_SELECTION_READBACK_HOLD');
      return receipt;
    },
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
      // Validate the source projection, then use the canonical Atlas
      // WorkRef gate. This does not provide T3 organizational authority.
      readAtlasPortfolio(serializeAtlas(observed.snapshot));
      try {
        // The current canonical Atlas module owns saved ProjectRef/WorkRef.
        // Verify the selected revision before any T3 issuance; never trust
        // a stale link simply because the project/work still exists.
        if(typeof ref.revision!=='string'||!/^(0|[1-9][0-9]*)$/.test(ref.revision))
          throw Object.assign(new Error('ATLAS_WORK_REFERENCE_INVALID'),{code:'ATLAS_WORK_REFERENCE_INVALID'});
        const currentRef=createAtlasSavedRef(observed.snapshot,
          {projectId:ref.projectId,workId:ref.workId},{persisted:true,dirty:false});
        if(currentRef.revision!==ref.revision)
          throw Object.assign(new Error('ATLAS_SOURCE_REVISION_CHANGED'),{code:'ATLAS_SOURCE_REVISION_CHANGED'});
      }
      catch(error) {
        const codes={
          ATLAS_SOURCE_REVISION_CHANGED:'T3_ATLAS_REVISION_CHANGED',
          ATLAS_PROJECT_NOT_IN_SOURCE:'T3_ATLAS_PROJECT_NOT_IN_SOURCE',
          ATLAS_WORK_NOT_IN_SOURCE:'T3_ATLAS_WORK_NOT_IN_SOURCE',
          ATLAS_PROJECT_NOT_FOUND:'T3_ATLAS_PROJECT_NOT_IN_SOURCE',
          ATLAS_WORK_NOT_FOUND:'T3_ATLAS_WORK_NOT_IN_SOURCE',
          ATLAS_PROJECT_ID_INVALID:'T3_ATLAS_WORK_BINDING_REQUIRED',
          ATLAS_WORK_ID_INVALID:'T3_ATLAS_WORK_BINDING_REQUIRED',
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
