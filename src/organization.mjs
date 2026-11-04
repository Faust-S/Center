// Product preparation model. It cannot issue grants, sign transfers or accept results.
export const DRAFT_FORMAT = 'iwxa.admin-center.draft';
const clone = value => structuredClone(value);
const fail = code => { throw Object.assign(new Error(code), {code}); };
const requireValue = (ok, code) => { if (!ok) fail(code); };
const text = (value, code, max = 4000) => {
  requireValue(typeof value === 'string' && value.trim().length > 0 && value.length <= max, code);
  return value.trim();
};
const byId = (rows, id, code) => rows.find(row => row.id === id) ?? fail(code);
const unique = rows => new Set(rows.map(row => row.id)).size === rows.length;
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value));
const day = value => value === '' || (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value);

export function emptyDraft(now = new Date().toISOString()) {
  return {format: DRAFT_FORMAT, version: 1, organizations: [], activeOrganizationId: null, updatedAt: now};
}

export function validateDraft(state) {
  requireValue(state && state.format === DRAFT_FORMAT && state.version === 1, 'DRAFT_FORMAT_INVALID');
  requireValue(Array.isArray(state.organizations) && state.organizations.length <= 100 && unique(state.organizations), 'ORGANIZATIONS_INVALID');
  requireValue(iso(state.updatedAt), 'DRAFT_DATE_INVALID');
  for (const org of state.organizations) {
    text(org.id, 'ORGANIZATION_ID_INVALID', 160); text(org.name, 'ORGANIZATION_NAME_REQUIRED', 160);
    requireValue(['GROUP', 'ORGANIZATION'].includes(org.kind), 'ORGANIZATION_KIND_INVALID');
    for (const key of ['workspaces', 'participants', 'assignments']) {
      requireValue(Array.isArray(org[key]) && org[key].length <= 2000 && unique(org[key]), 'COLLECTION_INVALID');
    }
    for (const workspace of org.workspaces) {
      text(workspace.id, 'WORKSPACE_ID_INVALID', 160); text(workspace.name, 'WORKSPACE_NAME_REQUIRED', 160);
      if (workspace.atlasRef !== undefined && workspace.atlasRef !== null) validateAtlasRef(workspace.atlasRef);
    }
    for (const person of org.participants) {
      text(person.id, 'PARTICIPANT_ID_INVALID', 160); text(person.name, 'PARTICIPANT_NAME_REQUIRED', 160);
      requireValue(typeof person.roleLabel === 'string' && person.roleLabel.length <= 160, 'ROLE_LABEL_INVALID');
      requireValue(person.credentialState === 'NOT_ENROLLED', 'DRAFT_CREDENTIAL_CLAIM_DENIED');
      // Planning a Personal Agent seat does not issue a Publisher license or an organization grant.
      requireValue(person.personalAgentPlan === undefined || ['NONE', 'PLANNED'].includes(person.personalAgentPlan), 'AGENT_SEAT_PLAN_INVALID');
    }
    for (const assignment of org.assignments) validateAssignment(org, assignment);
  }
  requireValue(state.activeOrganizationId === null || state.organizations.some(org => org.id === state.activeOrganizationId), 'ACTIVE_ORGANIZATION_INVALID');
  return state;
}

function validateAtlasRef(value) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value), 'ATLAS_REFERENCE_INVALID');
  const keys = Object.keys(value);
  requireValue((keys.length === 2 || (keys.length === 3 && Object.hasOwn(value, 'workId'))) &&
    keys.every(key => ['projectId', 'revision', 'workId'].includes(key)), 'ATLAS_REFERENCE_INVALID');
  text(value.projectId, 'ATLAS_REFERENCE_INVALID', 160);
  text(value.revision, 'ATLAS_REFERENCE_INVALID', 160);
  if (Object.hasOwn(value, 'workId')) text(value.workId, 'ATLAS_REFERENCE_INVALID', 160);
  // A draft link is never evidence that Atlas has verified this project or revision.
}

// Pointer to the original applied Result, not a grant or a second result store.
function validateSourceResultRef(org,assignment,ref){
  requireValue(ref&&typeof ref==='object'&&!Array.isArray(ref)&&
    Object.keys(ref).length===6&&Object.keys(ref).every(k=>
      ['organizationId','workspaceId','taskId','taskRevisionId','resultRevisionId','acceptanceId'].includes(k)),
    'DRAFT_SOURCE_RESULT_REFERENCE_INVALID');
  requireValue(ref.organizationId===org.id&&ref.workspaceId===assignment.workspaceId,
    'DRAFT_SOURCE_RESULT_SCOPE_CHANGED');
  requireValue(typeof ref.taskId==='string'&&ref.taskId.startsWith('task:')&&
    typeof ref.taskRevisionId==='string'&&/^[a-f0-9]{64}$/.test(ref.taskRevisionId)&&
    typeof ref.resultRevisionId==='string'&&/^[a-f0-9]{64}$/.test(ref.resultRevisionId)&&
    typeof ref.acceptanceId==='string'&&ref.acceptanceId.length>0&&ref.acceptanceId.length<=160,
    'DRAFT_SOURCE_RESULT_REFERENCE_INVALID');
}
function validateAssignment(org, assignment) {
  text(assignment.id, 'ASSIGNMENT_ID_INVALID', 160); text(assignment.title, 'ASSIGNMENT_TITLE_REQUIRED', 200);
  requireValue(assignment.status === 'DRAFT', 'DRAFT_AUTHORITY_CLAIM_DENIED');
  byId(org.workspaces, assignment.workspaceId, 'WORKSPACE_NOT_FOUND');
  if (assignment.assigneeId) byId(org.participants, assignment.assigneeId, 'ASSIGNEE_NOT_FOUND');
  if (assignment.reviewerId) byId(org.participants, assignment.reviewerId, 'REVIEWER_NOT_FOUND');
  requireValue(typeof assignment.description === 'string' && assignment.description.length <= 6000, 'DESCRIPTION_INVALID');
  requireValue(typeof assignment.criteria === 'string' && assignment.criteria.length <= 2000, 'CRITERIA_INVALID');
  requireValue(day(assignment.dueDate), 'DUE_DATE_INVALID');
  requireValue(['normal', 'high'].includes(assignment.priority), 'PRIORITY_INVALID');
  requireValue(Number.isSafeInteger(assignment.editNumber) && assignment.editNumber > 0, 'EDIT_NUMBER_INVALID');
  requireValue(iso(assignment.createdAt) && iso(assignment.updatedAt), 'ASSIGNMENT_DATE_INVALID');
  if (assignment.atlasRef !== null) validateAtlasRef(assignment.atlasRef);
  if (assignment.sourceResultRef != null) validateSourceResultRef(org,assignment,assignment.sourceResultRef);
}

export function applyDraftCommand(current, command, {id = () => crypto.randomUUID(), now = () => new Date().toISOString()} = {}) {
  validateDraft(current);
  requireValue(command && typeof command.type === 'string', 'COMMAND_REQUIRED');
  const state = clone(current), at = now();
  if (command.type === 'CREATE_ORGANIZATION') {
    const org = {id: id(), name: text(command.name, 'ORGANIZATION_NAME_REQUIRED', 160), kind: command.kind ?? 'GROUP', workspaces: [], participants: [], assignments: []};
    state.organizations.push(org); state.activeOrganizationId = org.id;
  } else if (command.type === 'SELECT_ORGANIZATION') {
    state.activeOrganizationId = byId(state.organizations, command.organizationId, 'ORGANIZATION_NOT_FOUND').id;
  } else {
    const org = byId(state.organizations, command.organizationId, 'ORGANIZATION_NOT_FOUND');
    requireValue(state.activeOrganizationId === org.id, 'ORGANIZATION_CONTEXT_CHANGED');
    if (command.type === 'ADD_WORKSPACE') {
      org.workspaces.push({id: id(), name: text(command.name, 'WORKSPACE_NAME_REQUIRED', 160), atlasRef: null});
    } else if (command.type === 'ADD_PARTICIPANT') {
      org.participants.push({id: id(), name: text(command.name, 'PARTICIPANT_NAME_REQUIRED', 160), roleLabel: command.roleLabel?.trim() ?? '', credentialState: 'NOT_ENROLLED', personalAgentPlan: 'NONE'});
    } else if (command.type === 'PLAN_PERSONAL_AGENT_ACCESS') {
      const person = byId(org.participants, command.participantId, 'PARTICIPANT_NOT_FOUND');
      requireValue(['NONE', 'PLANNED'].includes(command.plan), 'AGENT_SEAT_PLAN_INVALID');
      person.personalAgentPlan = command.plan;
    } else if (command.type === 'LINK_ATLAS_WORKSPACE') {
      const workspace = byId(org.workspaces, command.workspaceId, 'WORKSPACE_NOT_FOUND');
      const ref = command.atlasRef;
      if (ref !== null) validateAtlasRef(ref);
      workspace.atlasRef = ref;
    } else if (command.type === 'SAVE_ASSIGNMENT') {
      const old = command.assignmentId ? byId(org.assignments, command.assignmentId, 'ASSIGNMENT_NOT_FOUND') : null;
      if (old) requireValue(old.editNumber === command.expectedEditNumber, 'DRAFT_EDIT_CONFLICT');
      const record = {id: old?.id ?? id(), title: text(command.title, 'ASSIGNMENT_TITLE_REQUIRED', 200), workspaceId: command.workspaceId,
        assigneeId: command.assigneeId || null, reviewerId: command.reviewerId || null,
        description: command.description ?? '', criteria: command.criteria ?? '', dueDate: command.dueDate ?? '', priority: command.priority ?? 'normal',
        atlasRef: Object.hasOwn(command, 'atlasRef') ? command.atlasRef : (old?.atlasRef ?? null),
        sourceResultRef: Object.hasOwn(command, 'sourceResultRef') ? command.sourceResultRef : (old?.sourceResultRef ?? null),
        status: 'DRAFT', editNumber: (old?.editNumber ?? 0) + 1,
        createdAt: old?.createdAt ?? at, updatedAt: at};
      validateAssignment(org, record);
      if (old) org.assignments[org.assignments.findIndex(row => row.id === old.id)] = record;
      else org.assignments.push(record);
    } else fail('COMMAND_UNKNOWN');
  }
  state.updatedAt = at;
  return validateDraft(state);
}

export function encodeDraft(state) {
  validateDraft(state);
  return JSON.stringify(state, null, 2) + '\n';
}
export function decodeDraft(raw) {
  requireValue(typeof raw === 'string' && raw.length <= 8 * 1024 * 1024, 'DRAFT_SIZE_INVALID');
  let parsed;
  try { parsed = JSON.parse(raw); } catch { fail('DRAFT_JSON_INVALID'); }
  return clone(validateDraft(parsed));
}
export function overview(state, today = new Date().toISOString().slice(0, 10)) {
  const org = state.organizations.find(row => row.id === state.activeOrganizationId);
  return {workspaces: org?.workspaces.length ?? 0, participants: org?.participants.length ?? 0,
    drafts: org?.assignments.length ?? 0, overdueDrafts: org?.assignments.filter(row => row.dueDate && row.dueDate < today).length ?? 0,
    issued: null, accepted: null};
}

export function assignmentText(org, assignment) {
  validateAssignment(org, assignment);
  requireValue(assignment.criteria.trim() && assignment.assigneeId && assignment.reviewerId, 'ASSIGNMENT_NOT_READY');
  const assignee = byId(org.participants, assignment.assigneeId, 'ASSIGNEE_NOT_FOUND');
  const reviewer = byId(org.participants, assignment.reviewerId, 'REVIEWER_NOT_FOUND');
  const atlas = assignment.atlasRef ? `\nAtlas project: ${assignment.atlasRef.projectId} @ ${assignment.atlasRef.revision}${assignment.atlasRef.workId ? `\nAtlas work: ${assignment.atlasRef.workId}` : ''}` : '';
  const source=assignment.sourceResultRef;
  const prior=source ? `\nPreviously applied Result reference:\nTask: ${source.taskId}\nTask revision: ${source.taskRevisionId}\nResult revision: ${source.resultRevisionId}\nAcceptance: ${source.acceptanceId}` : '';
  const value = `${assignment.title}\n\n${assignment.description}\n\nAcceptance criteria:\n${assignment.criteria}\n\nAssignee: ${assignee.name}\nReviewer: ${reviewer.name}\nDue: ${assignment.dueDate || 'Not specified'}${atlas}${prior}`;
  requireValue(value.length <= 10000, 'ASSIGNMENT_TEXT_TOO_LARGE');
  return value;
}
