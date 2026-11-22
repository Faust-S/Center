import {createHash, utf8ByteLength} from '../owner-hash-shim.mjs';
const Buffer = {byteLength: utf8ByteLength};

export const CONTRACT_VERSION = 'IWXA.K04.SOLUTION/0.3.0';
export const PLAN_VERSION = 'IWXA.K04.HOST_PLAN/0.3.0';
export const K02_VERSION = 'IWXA.K02.INTEROP/0.1.0';
export const K02_SKILL_VERSION = 'IWXA.K02.SKILL/0.1.0';
const MAX_INPUT_BYTES = 1_000_000;

export class ComposerError extends Error {
  constructor(code, detail = '') {
    super(code + (detail ? ':' + detail : ''));
    this.name = 'ComposerError';
    this.code = code;
  }
}
const fail = (code, detail = '') => { throw new ComposerError(code, detail); };
const obj = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const str = value => typeof value === 'string' && value.trim().length > 0;
const copy = value => JSON.parse(JSON.stringify(value));
const stable = value => Array.isArray(value) ? value.map(stable) :
  obj(value) ? Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])])) : value;

export function digest(value) {
  let serialized;
  try { serialized = JSON.stringify(stable(value)); } catch { fail('NON_JSON_INPUT'); }
  if (typeof serialized !== 'string' || Buffer.byteLength(serialized) > 2_000_000) fail('NON_JSON_INPUT');
  return createHash('sha256').update(serialized).digest('hex');
}
function requirements(solution) {
  if (!obj(solution) || solution.schema !== CONTRACT_VERSION ||
    !str(solution.id) || !/^[0-9]+\.[0-9]+\.[0-9]+$/.test(solution.version) ||
    !Array.isArray(solution.taskKinds) || !solution.taskKinds.length ||
    !Array.isArray(solution.inputs) || !obj(solution.requires) ||
    !Array.isArray(solution.requires.fixed) || !solution.requires.fixed.length ||
    !Array.isArray(solution.requires.alternatives) || !solution.requires.alternatives.length ||
    !Array.isArray(solution.requires.skills) || !solution.requires.skills.length ||
    !Array.isArray(solution.stages) || solution.stages.join(',') !== 'input,extract,audit,human_review' ||
    !Array.isArray(solution.allowedExternalEffects) || solution.allowedExternalEffects.length ||
    !obj(solution.provenance) || solution.provenance.thirdPartyCodeCopied !== false ||
    !obj(solution.qualification) || solution.qualification.iwxaVerified !== false)
    fail('INVALID_SOLUTION');
  const seen = new Set();
  for (const r of [...solution.requires.fixed, ...solution.requires.alternatives]) {
    if (!obj(r) || !str(r.requirementId) || !str(r.capabilityId) ||
      !['model', 'tool'].includes(r.kind) || !str(r.effectClass) ||
      !obj(r.inputSchema) || !obj(r.outputSchema) || seen.has(r.requirementId))
      fail('INVALID_REQUIREMENT');
    seen.add(r.requirementId);
  }
  for (const s of solution.requires.skills) {
    if (!obj(s) || !str(s.skillId) || s.schema !== K02_SKILL_VERSION) fail('INVALID_SKILL_REQUIREMENT');
  }
  return solution;
}
export function describeSolution(id, version, registry) {
  if (!str(id) || !str(version) || !Array.isArray(registry)) fail('INVALID_LOOKUP');
  const matching = registry.filter(item => item?.id === id && item?.version === version);
  if (matching.length !== 1) fail(matching.length ? 'DUPLICATE_SOLUTION' : 'SOLUTION_NOT_FOUND');
  return copy(requirements(matching[0]));
}
export function matchTask(task, solutions) {
  if (!obj(task) || !str(task.taskId) || !str(task.kind) || !obj(task.input) ||
    !Array.isArray(solutions)) fail('INVALID_TASK');
  const candidates = solutions.map(def => {
    const solution = requirements(def);
    const kindMatched = solution.taskKinds.includes(task.kind);
    const missing = solution.inputs.filter(field => field.required &&
      (!str(task.input[field.name]) ||
        (field.minLength && task.input[field.name].length < field.minLength))).map(field => field.name);
    return {id: solution.id, version: solution.version, kindMatched,
      missingInputs: missing, status: kindMatched ? (missing.length ? 'NEEDS_INPUT' : 'CANDIDATE') : 'NOT_MATCHED'};
  }).filter(r => r.kindMatched).sort((a, b) => a.id.localeCompare(b.id) || a.version.localeCompare(b.version));
  return {schema: CONTRACT_VERSION, taskId: task.taskId, candidates,
    alternative: {mode: 'model_skills', hostResolutionRequired: true, allowed: true},
    taskCreated: false, executionStarted: false};
}
function validateAvailability(available) {
  if (!obj(available) || !Array.isArray(available.providers) ||
      !Array.isArray(available.skills)) fail('INVALID_AVAILABILITY');
  const providerIds = new Set(), skillIds = new Set();
  for (const p of available.providers) {
    if (!obj(p) || p.contractVersion !== K02_VERSION || !str(p.providerId) ||
        !Array.isArray(p.capabilities) || !['available', 'unavailable'].includes(p.availability) ||
        providerIds.has(p.providerId)) fail('INVALID_PROVIDER_DESCRIPTOR');
    providerIds.add(p.providerId);
    const capIds = new Set();
    for (const cap of p.capabilities) {
      if (!obj(cap) || !['model', 'tool'].includes(cap.kind) || !str(cap.capabilityId) ||
          typeof cap.supported !== 'boolean' ||
          (cap.kind === 'model' && (!Array.isArray(cap.inputModes) || !Array.isArray(cap.outputModes))) ||
          !obj(cap.inputSchema) || !obj(cap.outputSchema) ||
          capIds.has(cap.kind + ':' + cap.capabilityId)) fail('INVALID_PROVIDER_DESCRIPTOR');
      capIds.add(cap.kind + ':' + cap.capabilityId);
    }
  }
  for (const skill of available.skills) {
    if (!obj(skill) || skill.schema !== K02_SKILL_VERSION || !str(skill.skillId) ||
        !Array.isArray(skill.requiredCapabilities) || skillIds.has(skill.skillId))
      fail('INVALID_SKILL_DESCRIPTOR');
    skillIds.add(skill.skillId);
  }
}
function selectSkills(requirements, available, selected, missing) {
  const skills = [];
  for (const req of requirements) {
    const skill = available.skills.find(s => s.schema === K02_SKILL_VERSION && s.skillId === req.skillId);
    if (!skill) { missing.push({skillId: req.skillId, reason: 'SKILL_ABSENT'}); continue; }
    if (skill.requiredCapabilities.some(id => !selected.some(s => s.capabilityId === id))) {
      missing.push({skillId: req.skillId, reason: 'SKILL_CAPABILITY_MISSING'}); continue;
    }
    skills.push({skillId: skill.skillId, descriptorDigest: digest(skill)});
  }
  return skills;
}
function withResolutionDigest(value) {
  return {...value, resolutionDigest: digest(value)};
}
function verifyResolutionDigest(resolution) {
  if (!obj(resolution) || !/^[0-9a-f]{64}$/.test(resolution.resolutionDigest ?? ''))
    fail('UNBOUND_RESOLUTION');
  const {resolutionDigest, ...unsigned} = resolution;
  if (digest(unsigned) !== resolutionDigest) fail('RESOLUTION_DIGEST_MISMATCH');
}
function verifySelections(selected) {
  if (!Array.isArray(selected)) fail('UNBOUND_CAPABILITIES');
  const ids = new Set();
  for (const item of selected) {
    if (!obj(item) || !str(item.requirementId) || !str(item.providerId) ||
        !str(item.capabilityId) || !['model', 'tool'].includes(item.kind) ||
        !str(item.effectClass) || !/^[0-9a-f]{64}$/.test(item.descriptorDigest ?? '') ||
        ids.has(item.requirementId) ||
        (item.kind === 'model' && (!obj(item.modelPin) ||
          !str(item.modelPin.name) || !/^[a-f0-9]{64}$/.test(item.modelPin.digest ?? ''))))
        fail('UNBOUND_CAPABILITIES');
    ids.add(item.requirementId);
  }
}
function verifySkills(skills) {
  if (!Array.isArray(skills)) fail('UNBOUND_SKILLS');
  const ids = new Set();
  for (const item of skills) {
    if (!obj(item) || !str(item.skillId) ||
        !/^[0-9a-f]{64}$/.test(item.descriptorDigest ?? '') ||
        ids.has(item.skillId)) fail('UNBOUND_SKILLS');
    ids.add(item.skillId);
  }
}
function selectionMatches(req, selection) {
  return selection?.requirementId === req.requirementId &&
    selection.kind === req.kind && selection.capabilityId === req.capabilityId &&
    selection.effectClass === req.effectClass;
}
function findProvider(req, providers) {
  const reasons = new Set();
  const matches = [];
  for (const provider of providers) {
    if (!obj(provider) || provider.contractVersion !== K02_VERSION ||
      !str(provider.providerId) || !Array.isArray(provider.capabilities)) {
      reasons.add('INVALID_PROVIDER_DESCRIPTOR'); continue;
    }
    const cap = provider.capabilities.find(x => obj(x) &&
      x.kind === req.kind && x.capabilityId === req.capabilityId);
    if (!cap) continue;
    if (provider.availability !== 'available') { reasons.add('UNAVAILABLE'); continue; }
    if (cap.supported !== true) { reasons.add('UNSUPPORTED'); continue; }
    if (cap.effectClass !== req.effectClass) { reasons.add('EFFECT_MISMATCH'); continue; }
    if (digest(cap.inputSchema) !== digest(req.inputSchema) ||
        digest(cap.outputSchema) !== digest(req.outputSchema)) {
      reasons.add('SCHEMA_MISMATCH'); continue;
    }
    if (req.kind === 'model' &&
      (!obj(cap.modelPin) || !str(cap.modelPin.name) ||
       !/^[a-f0-9]{64}$/.test(cap.modelPin.digest ?? ''))) {
      reasons.add('PIN_REQUIRED'); continue;
    }
    if (req.kind === 'model' &&
      (req.inputModes || []).some(mode => !cap.inputModes?.includes(mode))) {
      reasons.add('MODE_MISMATCH'); continue;
    }
    if (req.kind === 'model' &&
      (req.outputModes || []).some(mode => !cap.outputModes?.includes(mode))) {
      reasons.add('MODE_MISMATCH'); continue;
    }
    if (req.modelPin && (!cap.modelPin || digest(req.modelPin) !== digest(cap.modelPin))) {
      reasons.add('PIN_MISMATCH'); continue;
    }
    matches.push({requirementId: req.requirementId, kind: req.kind,
      capabilityId: req.capabilityId, effectClass: req.effectClass,
      providerId: provider.providerId,
      ...(req.kind === 'model' ? {modelPin: copy(cap.modelPin)} : {}),
      descriptorDigest: digest({providerId: provider.providerId, cap})});
  }
  matches.sort((a, b) => a.providerId.localeCompare(b.providerId, 'en'));
  return {match: matches[0] ?? null, reason: [...reasons].sort()[0] ?? 'ABSENT'};
}
export function resolveRequiredCapabilities(solution, available, options = {}) {
  requirements(solution);
  validateAvailability(available);
  if (!obj(options)) fail('INVALID_AVAILABILITY');
  const selected = [], missing = [];
  for (const req of solution.requires.fixed) {
    const r = findProvider(req, available.providers);
    if (r.match) selected.push(r.match);
    else missing.push({requirementId: req.requirementId, reason: r.reason});
  }
  const ordered = [...solution.requires.alternatives];
  if (options.preferOption) {
    if (!ordered.some(r => r.requirementId === options.preferOption)) fail('UNKNOWN_OPTION');
    ordered.sort((a, b) => (a.requirementId === options.preferOption ? -1 :
      b.requirementId === options.preferOption ? 1 : 0));
  }
  let chosenOption = null;
  for (const req of ordered) {
    const r = findProvider(req, available.providers);
    if (r.match) { chosenOption = req.requirementId; selected.push(r.match); break; }
  }
  if (!chosenOption) missing.push({requirementId: 'extraction_alternative', reason: 'NO_COMPATIBLE_OPTION'});
  const skills = selectSkills(solution.requires.skills, available, selected, missing);
  return withResolutionDigest({schema: CONTRACT_VERSION, mode: 'solution',
    solutionId: solution.id, solutionVersion: solution.version, solutionDigest: digest(solution),
    status: missing.length ? 'UNSUPPORTED' : 'SUPPORTED', chosenOption, selected, skills, missing,
    hostAuthorityGranted: false, invocationOccurred: false});
}

/** Resolve plain model+Skills without requiring a specialized Agent Solution. */
export function resolveModelAndSkills({modelRequirement, toolRequirements = [], selectedSkillIds = []}, available) {
  validateAvailability(available);
  if (!obj(modelRequirement) || modelRequirement.kind !== 'model' ||
      modelRequirement.capabilityId !== 'text.generate' || !str(modelRequirement.requirementId) ||
      !Array.isArray(toolRequirements) || !Array.isArray(selectedSkillIds) ||
      !selectedSkillIds.length || new Set(selectedSkillIds).size !== selectedSkillIds.length ||
      selectedSkillIds.some(id => !str(id))) fail('INVALID_MODEL_SKILLS_REQUEST');
  const requirements = [modelRequirement, ...toolRequirements], ids = new Set();
  for (const req of requirements) {
    if (!obj(req) || !str(req.requirementId) || !str(req.capabilityId) ||
        !['model', 'tool'].includes(req.kind) || !str(req.effectClass) ||
        !obj(req.inputSchema) || !obj(req.outputSchema) || ids.has(req.requirementId))
      fail('INVALID_MODEL_SKILLS_REQUEST');
    ids.add(req.requirementId);
  }
  const selected = [], missing = [];
  for (const req of requirements) {
    const match = findProvider(req, available.providers);
    if (match.match) selected.push(match.match);
    else missing.push({requirementId: req.requirementId, reason: match.reason});
  }
  const skills = selectSkills(selectedSkillIds.map(skillId => ({skillId})),
    available, selected, missing);
  return withResolutionDigest({schema: CONTRACT_VERSION, mode: 'model_skills',
    solutionId: null, solutionVersion: null, solutionDigest: null,
    requirementsDigest: digest(requirements), requiredSelections: requirements.map(x => x.requirementId),
    status: missing.length ? 'UNSUPPORTED' : 'SUPPORTED', selected, skills, missing,
    hostAuthorityGranted: false, invocationOccurred: false});

}
function validateTask(task, solution = null) {
  if (!obj(task) || !str(task.taskId) || !str(task.kind) ||
    !obj(task.input) || !str(task.input.transcript_text) ||
    Buffer.byteLength(task.input.transcript_text) > MAX_INPUT_BYTES ||
    !obj(task.source) || !str(task.source.ref) || !str(task.source.revision) ||
    !str(task.source.rights) || task.source.authorized !== true) fail('INVALID_OR_UNAUTHORIZED_INPUT');
  if (solution && (!solution.taskKinds.includes(task.kind) || solution.inputs.some(
    f => f.required && (!str(task.input[f.name]) || task.input[f.name].length < (f.minLength ?? 1))))) {
    fail('TASK_NOT_ELIGIBLE');
  }
}
export function createHostNeutralPlan({task, solution = null, resolution, mode = 'solution', selectedSkills = []}) {
  if (!['solution', 'model_skills'].includes(mode) || !obj(resolution) ||
    resolution.schema !== CONTRACT_VERSION || resolution.mode !== mode ||
    resolution.status !== 'SUPPORTED' || resolution.hostAuthorityGranted !== false ||
    resolution.invocationOccurred !== false || !Array.isArray(selectedSkills))
    fail('INVALID_PLAN_INPUT');
  verifyResolutionDigest(resolution);
  verifySelections(resolution.selected);
  verifySkills(resolution.skills);
  if (mode === 'solution') {
    requirements(solution);
    validateTask(task, solution);
    const chosen = solution.requires.alternatives.find(r => r.requirementId === resolution.chosenOption);
    const expected = [...solution.requires.fixed, chosen].filter(Boolean);
    if (resolution.solutionId !== solution.id || resolution.solutionVersion !== solution.version ||
        resolution.solutionDigest !== digest(solution) || !chosen ||
        resolution.selected.length !== expected.length ||
        !expected.every(r => resolution.selected.some(s => selectionMatches(r, s))) ||
        resolution.skills.length !== solution.requires.skills.length ||
        !solution.requires.skills.every(r => resolution.skills.some(s => s.skillId === r.skillId)) ||
        selectedSkills.length) fail('UNRESOLVED_REQUIREMENTS');
  } else {
    validateTask(task);
    if (solution !== null || resolution.solutionId !== null ||
        resolution.solutionDigest !== null ||
        !Array.isArray(resolution.requiredSelections) ||
        resolution.selected.length !== resolution.requiredSelections.length ||
        !resolution.requiredSelections.every(id => resolution.selected.some(s => s.requirementId === id)) ||
        !resolution.selected.some(s => s.kind === 'model' && s.capabilityId === 'text.generate') ||
        !selectedSkills.length || new Set(selectedSkills).size !== selectedSkills.length ||
        selectedSkills.some(s => !str(s)) ||
        selectedSkills.length !== resolution.skills.length ||
        !selectedSkills.every(id => resolution.skills.some(s => s.skillId === id)))
      fail('MODEL_SKILLS_NOT_RESOLVED');
  }
  const common = {schema: PLAN_VERSION, mode, taskRef: task.taskId,
    input: {sourceRef: task.source.ref, sourceRevision: task.source.revision,
      sourceRights: task.source.rights, transcriptDigest: digest(task.input.transcript_text)},
    solutionRef: mode === 'solution' ? {id: solution.id, version: solution.version} : null,
    branches: mode === 'solution' ? {extraction: resolution.chosenOption} : null,
    resolutionDigest: resolution.resolutionDigest,
    hostApprovalRequired: true, executionState: 'NOT_EXECUTED',
    resultState: 'NOT_PRODUCED', externalEffectsAuthorized: false};
  const selected = resolution.selected;
  let steps;
  if (mode === 'solution') {
    const extract = {id: 'extract', type: 'CAPABILITY_REQUEST', dependsOn: ['input'],
      selected: copy(selected.find(s => s.requirementId === resolution.chosenOption))};
    const modelPath = extract.selected.kind === 'model';
    steps = [{id: 'input', type: 'HOST_INPUT', authorizedSourceRef: task.source.ref},
      extract, ...(modelPath ? [{id: 'normalize', type: 'HOST_TRANSFORM',
        operation: 'PARSE_JSON_ACTION_DRAFT', dependsOn: ['extract'],
        expectedOutputSchema: copy(solution.requires.alternatives.find(s =>
          s.requirementId === 'structured_rule')?.outputSchema ?? solution.requires.fixed[0].inputSchema.properties.draft),
        executionState: 'NOT_EXECUTED'}] : []),
      {id: 'audit', type: 'CAPABILITY_REQUEST',
        dependsOn: [modelPath ? 'normalize' : 'extract'],
        selected: copy(selected.find(s => s.requirementId === solution.requires.fixed[0].requirementId))},
      {id: 'human_review', type: 'HOST_GATE', dependsOn: ['audit'],
        decision: 'PENDING', createsTask: false, authorizesExternalEffects: false}];
  } else {
    steps = [{id: 'model', type: 'CAPABILITY_REQUEST', selected: copy(selected.find(s =>
      s.kind === 'model' && s.capabilityId === 'text.generate'))},
      {id: 'skills', type: 'HOST_SKILLS_REQUEST',
        selectedSkillIds: [...selectedSkills],
        selectedCapabilities: copy(selected.filter(s => s.kind === 'tool')),
        dependsOn: ['model']},
      {id: 'human_review', type: 'HOST_GATE', decision: 'PENDING', dependsOn: ['skills']}];
  }
  const plan = {...common, steps};
  return {...plan, planDigest: digest(plan)};
}
/** Strict conversion of completed K02 model output; no invocation or Task mutation. */
export function normalizeModelDraft(output, expectedPin) {
  if (!obj(expectedPin) || !str(expectedPin.name) ||
      !/^[a-f0-9]{64}$/.test(expectedPin.digest ?? '')) fail('MODEL_PIN_REQUIRED');
  if (!obj(output) || !str(output.text) || output.model !== expectedPin.name ||
      output.model_digest !== expectedPin.digest ||
      Buffer.byteLength(output.text, 'utf8') > 65536)
    fail('MODEL_OUTPUT_NOT_PINNED');
  const raw = output.text.trim();
  const mark = String.fromCharCode(96).repeat(3);
  let candidate = raw;
  if (raw.startsWith(mark)) {
    const firstNewline = raw.indexOf('\n');
    if (firstNewline < 0 || ![mark, mark + 'json'].includes(raw.slice(0, firstNewline).trim()) ||
        !raw.endsWith(mark)) fail('MODEL_DRAFT_NOT_JSON');
    candidate = raw.slice(firstNewline + 1, -mark.length).trim();
  }
  let draft;
  try { draft = JSON.parse(candidate); } catch { fail('MODEL_DRAFT_NOT_JSON'); }
  if (!obj(draft) || !Array.isArray(draft.action_items) ||
      !Array.isArray(draft.open_questions) ||
      Object.keys(draft).some(k => !['action_items', 'open_questions'].includes(k)) ||
      draft.action_items.length > 100 || draft.open_questions.length > 100)
    fail('MODEL_DRAFT_STRUCTURE_INVALID');
  for (const item of draft.action_items) {
    if (!obj(item) ||
        Object.keys(item).some(k => ![
          'action','quote','start','end','assignee','due_date','worker_kind','actual_work_status'
        ].includes(k)) ||
        !['human','unassigned'].includes(item.worker_kind) ||
        item.actual_work_status !== 'NOT_EXECUTED')
      fail('MODEL_DRAFT_STRUCTURE_INVALID');
  }
  return draft;
}

export function checkMeetingEvidence(transcript, draft) {
  const errors = [];
  if (!str(transcript) || !obj(draft) ||
      !Array.isArray(draft.action_items) || !Array.isArray(draft.open_questions))
    return {passed: false, errors: ['INVALID_DRAFT'], accepted: []};
  const chars = Array.from(transcript);
  const seen = new Set(), accepted = [];
  if (!draft.action_items.length && !draft.open_questions.length) errors.push('EMPTY_WITHOUT_QUESTION');
  for (const [index, item] of draft.action_items.entries()) {
    const code = 'ITEM_' + index + '_';
    if (!obj(item) || !str(item.action) || !str(item.quote) ||
      !Number.isSafeInteger(item.start) || !Number.isSafeInteger(item.end) ||
      item.start < 0 || item.end <= item.start || item.end > chars.length ||
      chars.slice(item.start, item.end).join('') !== item.quote) {
      errors.push(code + 'SOURCE_MISMATCH'); continue;
    }
    if (!str(item.assignee) || !str(item.due_date) ||
      (item.assignee !== 'UNKNOWN' && !item.quote.includes(item.assignee)) ||
      (item.due_date !== 'UNKNOWN' && !item.quote.includes(item.due_date))) {
      errors.push(code + 'UNSUPPORTED_ASSIGNMENT'); continue;
    }
    if (item.worker_kind !== (item.assignee === 'UNKNOWN' ? 'unassigned' : 'human') ||
      item.actual_work_status !== 'NOT_EXECUTED') {
      errors.push(code + 'WORKER_OR_EXECUTION_CLAIM'); continue;
    }
    const key = JSON.stringify([item.start, item.end, item.action, item.assignee, item.due_date]);
    if (seen.has(key)) { errors.push(code + 'DUPLICATE'); continue; }
    seen.add(key);
    accepted.push(item);
  }
  if (draft.open_questions.some(q => !str(q))) errors.push('INVALID_QUESTIONS');
  return {passed: errors.length === 0, errors, accepted};
}
export function evaluateResultAgainstCriteria(observation) {
  const errors = [];
  if (!obj(observation) || !obj(observation.plan) ||
    observation.plan.schema !== PLAN_VERSION || observation.plan.mode !== 'solution')
    return {passed: false, status: 'REVIEW_REQUIRED', errors: ['INVALID_PLAN']};
  const {plan, transcript, draft, receipts} = observation;
  const {planDigest, ...unsigned} = plan;
  if (planDigest !== digest(unsigned)) errors.push('PLAN_DIGEST_MISMATCH');
  if (!str(transcript) || digest(transcript) !== plan.input?.transcriptDigest)
    errors.push('SOURCE_DIGEST_MISMATCH');
  const verified = checkMeetingEvidence(transcript, draft);
  errors.push(...verified.errors);
  const modelBranch = plan.branches?.extraction === 'model_json';
  if (!Array.isArray(receipts)) errors.push('RECEIPTS_REQUIRED');
  else {
    const expected = modelBranch ? ['extract', 'normalize', 'audit'] : ['extract', 'audit'];
    if (receipts.length !== expected.length ||
        new Set(receipts.map(r => r?.stepId)).size !== expected.length ||
        receipts.some(r => !expected.includes(r?.stepId)))
      errors.push('RECEIPT_COUNT');
    const extract = receipts.find(r => r?.stepId === 'extract');
    for (const stepId of expected) {
      const receipt = receipts.find(r => r?.stepId === stepId);
      const step = plan.steps.find(s => s.id === stepId);
      const requiredInputDigest = stepId === 'extract' ? digest(transcript) :
        stepId === 'normalize' ? (obj(extract?.output) ? digest(extract.output) : null) :
          digest({transcript, draft});
      if (!obj(receipt) || !step || receipt.status !== 'SUCCEEDED' ||
          receipt.planDigest !== planDigest ||
          receipt.inputDigest !== requiredInputDigest ||
          !obj(receipt.output) || receipt.outputDigest !== digest(receipt.output)) {
        errors.push('RECEIPT_INVALID_' + stepId); continue;
      }
      if (stepId === 'normalize') {
        if (receipt.operation !== 'PARSE_JSON_ACTION_DRAFT' ||
            receipt.providerId !== 'HOST_TRANSFORM' || !obj(extract?.output)) {
          errors.push('NORMALIZATION_BINDING_INVALID'); continue;
        }
        try {
          const normalized = normalizeModelDraft(extract.output,
            plan.steps.find(s => s.id === 'extract').selected.modelPin);
          if (digest(normalized) !== digest(receipt.output) ||
              digest(normalized) !== digest(draft))
            errors.push('NORMALIZATION_OUTPUT_MISMATCH');
        } catch { errors.push('NORMALIZATION_OUTPUT_INVALID'); }
        continue;
      }
      if (receipt.descriptorDigest !== step.selected?.descriptorDigest ||
          receipt.providerId !== step.selected?.providerId ||
          receipt.capabilityId !== step.selected?.capabilityId) {
        errors.push('RECEIPT_CAPABILITY_MISMATCH_' + stepId); continue;
      }
      if (stepId === 'extract' && !modelBranch && digest(receipt.output) !== digest(draft))
        errors.push('EXTRACT_OUTPUT_MISMATCH');
      if (stepId === 'extract' && modelBranch) {
        try { normalizeModelDraft(receipt.output, step.selected.modelPin); }
        catch { errors.push('MODEL_EXTRACT_OUTPUT_INVALID'); }
      }
      if (stepId === 'audit' &&
          (receipt.output.passed !== true || !Array.isArray(receipt.output.errors) ||
           receipt.output.errors.length ||
           digest(receipt.output.accepted) !== digest(draft?.action_items)))
        errors.push('AUDIT_OUTPUT_MISMATCH');
    }
  }
  const review = observation.humanReview?.status ?? 'PENDING';
  if (!['PENDING', 'APPROVED', 'REJECTED'].includes(review)) errors.push('INVALID_HUMAN_REVIEW');
  const report = observation.taskReport?.status ?? 'NOT_SUBMITTED';
  if (!['NOT_SUBMITTED', 'SUBMITTED', 'ACCEPTED', 'REJECTED'].includes(report))
    errors.push('INVALID_TASK_REPORT');
  const status = errors.length ? 'REVIEW_REQUIRED' :
    review === 'PENDING' ? 'DRAFT_READY_FOR_HUMAN_REVIEW' :
    review === 'REJECTED' ? 'DRAFT_REJECTED_BY_HUMAN' : 'DRAFT_REVIEWED';
  return {passed: errors.length === 0 && review !== 'REJECTED', status, errors,
    quoteEvidenceVerified: verified.passed && errors.length === 0,
    humanReviewStatus: review, taskReportStatus: report,
    assignmentsExecuted: false, goalCompletionAttested: false,
    hostGoalDecisionObserved: observation.goalDecision?.status ?? 'NOT_DECIDED',
    taskCreated: false, externalEffectsPerformed: false,
    receiptBindingChecked: errors.length === 0,
    hostAuthorityVerified: false};
}
