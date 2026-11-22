import {createHash, utf8ByteLength} from '../owner-hash-shim.mjs';
const Buffer = {byteLength: utf8ByteLength};

export const CONTRACT_VERSION = 'IWXA.K02.INTEROP/0.1.0';
export const PLAN_BINDING_VERSION = 'IWXA.K02.PLAN_BINDING/0.1.0';
export const MODEL_SELECTION_VERSION = 'IWXA.K02.MODEL_SELECTION/0.1.0';
const HEX64 = /^[a-f0-9]{64}$/;
const TYPES = new Set(['object', 'array', 'string', 'integer', 'number', 'boolean', 'null']);
const SCHEMA_KEYS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'minLength', 'maxLength', 'minimum', 'maximum', 'minItems', 'maxItems']);
const MAX_JSON_BYTES = 1_000_000;

export class InteropError extends Error {
  constructor(code, detail = '') {
    super(code + (detail ? ':' + detail : ''));
    this.name = 'InteropError';
    this.code = code;
  }
}

function fail(code, detail = '') { throw new InteropError(code, detail); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function name(value, field) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/.test(value)) fail('INVALID_DESCRIPTOR', field);
}
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (object(value)) return Object.fromEntries(Object.keys(value).sort().map(k => [k, stable(value[k])]));
  return value;
}
export function canonical(value) {
  let encoded;
  try { encoded = JSON.stringify(stable(value)); } catch { fail('INVALID_JSON'); }
  if (typeof encoded !== 'string' || Buffer.byteLength(encoded) > MAX_JSON_BYTES) fail('INVALID_JSON');
  try { if (JSON.stringify(JSON.parse(encoded)) === undefined) fail('INVALID_JSON'); } catch { fail('INVALID_JSON'); }
  return encoded;
}
export function digest(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function requireKeys(value, keys, label) {
  if (!object(value) || Object.keys(value).some(k => !keys.includes(k))) fail('INVALID_DESCRIPTOR', label);
}
function checkSchema(schema, depth = 0) {
  if (!object(schema) || depth > 24) fail('UNSUPPORTED_SCHEMA', 'object_or_depth');
  for (const key of Object.keys(schema)) if (!SCHEMA_KEYS.has(key)) fail('UNSUPPORTED_SCHEMA', key);
  if (!TYPES.has(schema.type)) fail('UNSUPPORTED_SCHEMA', 'type');
  if (schema.enum !== undefined && (!Array.isArray(schema.enum) || schema.enum.length === 0)) fail('UNSUPPORTED_SCHEMA', 'enum');
  for (const key of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) {
    if (key in schema && (typeof schema[key] !== 'number' || !Number.isFinite(schema[key]) || (key.startsWith('min') || key.startsWith('max')) && !Number.isInteger(schema[key]))) fail('UNSUPPORTED_SCHEMA', key);
  }
  if (schema.type === 'object') {
    if (!object(schema.properties) || schema.additionalProperties !== false || !Array.isArray(schema.required)) fail('UNSUPPORTED_SCHEMA', 'closed_object_required');
    if (new Set(schema.required).size !== schema.required.length || schema.required.some(k => typeof k !== 'string' || !(k in schema.properties))) fail('UNSUPPORTED_SCHEMA', 'required');
    for (const s of Object.values(schema.properties)) checkSchema(s, depth + 1);
  } else if (schema.type === 'array') {
    if (!schema.items || !object(schema.items)) fail('UNSUPPORTED_SCHEMA', 'items');
    checkSchema(schema.items, depth + 1);
  } else if (schema.properties !== undefined || schema.required !== undefined || schema.additionalProperties !== undefined || schema.items !== undefined) fail('UNSUPPORTED_SCHEMA', 'mixed_type');
  canonical(schema);
  return schema;
}
export function validateSchema(schema) { return checkSchema(schema); }
function typeMatches(value, type) {
  if (type === 'null') return value === null;
  if (type === 'object') return object(value);
  if (type === 'array') return Array.isArray(value);
  if (type === 'integer') return typeof value === 'number' && Number.isSafeInteger(value);
  if (type === 'number') return typeof value === 'number' && Number.isFinite(value);
  return typeof value === type;
}
function walk(schema, value, path) {
  if (!typeMatches(value, schema.type)) fail('SCHEMA_VALUE_INVALID', path + ':type');
  if (schema.enum && !schema.enum.some(candidate => canonical(candidate) === canonical(value))) fail('SCHEMA_VALUE_INVALID', path + ':enum');
  if (schema.type === 'string') {
    if (schema.minLength !== undefined && value.length < schema.minLength) fail('SCHEMA_VALUE_INVALID', path + ':minLength');
    if (schema.maxLength !== undefined && value.length > schema.maxLength) fail('SCHEMA_VALUE_INVALID', path + ':maxLength');
  }
  if (schema.type === 'number' || schema.type === 'integer') {
    if (schema.minimum !== undefined && value < schema.minimum) fail('SCHEMA_VALUE_INVALID', path + ':minimum');
    if (schema.maximum !== undefined && value > schema.maximum) fail('SCHEMA_VALUE_INVALID', path + ':maximum');
  }
  if (schema.type === 'object') {
    for (const k of Object.keys(value)) if (!Object.prototype.hasOwnProperty.call(schema.properties, k)) fail('SCHEMA_VALUE_INVALID', path + '.' + k + ':unknown');
    for (const k of schema.required) if (!Object.prototype.hasOwnProperty.call(value, k)) fail('SCHEMA_VALUE_INVALID', path + '.' + k + ':required');
    for (const [k, v] of Object.entries(value)) walk(schema.properties[k], v, path + '.' + k);
  }
  if (schema.type === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) fail('SCHEMA_VALUE_INVALID', path + ':minItems');
    if (schema.maxItems !== undefined && value.length > schema.maxItems) fail('SCHEMA_VALUE_INVALID', path + ':maxItems');
    value.forEach((v, i) => walk(schema.items, v, path + '[' + i + ']'));
  }
}
export function validatePayload(schema, value) {
  checkSchema(schema);
  canonical(value);
  walk(schema, value, '$');
  return value;
}
function positiveOrNull(value, name) {
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value) || value < 0)) fail('INVALID_DESCRIPTOR', name);
}
function verifyModes(modes, label) {
  if (!Array.isArray(modes) || modes.length < 1 || modes.length > 16 ||
    modes.some(m => typeof m !== 'string' || !/^[a-z][a-z0-9._-]{0,63}$/.test(m)) ||
    new Set(modes).size !== modes.length) fail('INVALID_DESCRIPTOR', label);
}
function verifyModelPin(pin, label) {
  if (!object(pin) || Object.keys(pin).sort().join(',') !== 'digest,name' ||
      typeof pin.name !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/.test(pin.name) ||
      pin.name.toLowerCase().endsWith(':cloud') ||
      typeof pin.digest !== 'string' || !HEX64.test(pin.digest)) fail('INVALID_DESCRIPTOR', label);
}
function capability(cap) {
  requireKeys(cap, ['kind', 'capabilityId', 'supported', 'unsupportedReason', 'inputSchema', 'outputSchema', 'effectClass', 'providerFeeUsd', 'latencyMsP50', 'inputModes', 'outputModes', 'modelPin'], 'capability');
  if (!['tool', 'model'].includes(cap.kind)) fail('INVALID_DESCRIPTOR', 'kind');
  name(cap.capabilityId, 'capabilityId');
  if (typeof cap.supported !== 'boolean') fail('INVALID_DESCRIPTOR', 'supported');
  if (!cap.supported && (typeof cap.unsupportedReason !== 'string' || !cap.unsupportedReason)) fail('INVALID_DESCRIPTOR', 'unsupportedReason');
  name(cap.effectClass, 'effectClass');
  checkSchema(cap.inputSchema); checkSchema(cap.outputSchema);
  positiveOrNull(cap.providerFeeUsd, 'providerFeeUsd');
  positiveOrNull(cap.latencyMsP50, 'latencyMsP50');
  if (cap.kind === 'model') {
    verifyModes(cap.inputModes, 'model_input_modes');
    verifyModes(cap.outputModes, 'model_output_modes');
    if (cap.modelPin !== undefined) verifyModelPin(cap.modelPin, 'model_pin');
  } else if (cap.inputModes !== undefined || cap.outputModes !== undefined || cap.modelPin !== undefined) {
    fail('INVALID_DESCRIPTOR', 'tool_model_fields');
  }
}
function descriptor(desc) {
  requireKeys(desc, ['contractVersion', 'providerId', 'availability', 'unavailableReason', 'capabilities'], 'provider');
  if (desc.contractVersion !== CONTRACT_VERSION) fail('CONTRACT_VERSION_MISMATCH');
  name(desc.providerId, 'providerId');
  if (!['available', 'unavailable'].includes(desc.availability)) fail('INVALID_DESCRIPTOR', 'availability');
  if (desc.availability === 'unavailable' && (typeof desc.unavailableReason !== 'string' || !desc.unavailableReason)) fail('INVALID_DESCRIPTOR', 'unavailableReason');
  if (!Array.isArray(desc.capabilities)) fail('INVALID_DESCRIPTOR', 'capabilities');
  const seen = new Set();
  for (const cap of desc.capabilities) {
    capability(cap);
    const id = cap.kind + ':' + cap.capabilityId;
    if (seen.has(id)) fail('INVALID_DESCRIPTOR', 'duplicate_capability');
    seen.add(id);
  }
  canonical(desc);
  return desc;
}
export async function describeCapabilities(provider) {
  if (!provider || typeof provider.describeCapabilities !== 'function') fail('PROVIDER_UNAVAILABLE', 'missing_probe');
  return descriptor(await provider.describeCapabilities());
}
function requirement(req) {
  requireKeys(req, ['requirementId', 'kind', 'capabilityId', 'inputSchema', 'outputSchema', 'effectClass', 'required', 'inputModes', 'outputModes', 'modelPin'], 'requirement');
  name(req.requirementId, 'requirementId');
  name(req.capabilityId, 'capabilityId');
  name(req.effectClass, 'effectClass');
  if (!['tool', 'model'].includes(req.kind) || typeof req.required !== 'boolean') fail('INVALID_DESCRIPTOR', 'requirement');
  checkSchema(req.inputSchema); checkSchema(req.outputSchema);
  if (req.kind === 'model') {
    if (req.inputModes !== undefined) verifyModes(req.inputModes, 'required_input_modes');
    if (req.outputModes !== undefined) verifyModes(req.outputModes, 'required_output_modes');
    if (req.modelPin !== undefined) verifyModelPin(req.modelPin, 'required_model_pin');
  } else if (req.inputModes !== undefined || req.outputModes !== undefined || req.modelPin !== undefined) {
    fail('INVALID_DESCRIPTOR', 'tool_model_requirements');
  }
}
function rank(cap, providerId) {
  return [cap.providerFeeUsd === null ? Infinity : cap.providerFeeUsd, cap.latencyMsP50 === null ? Infinity : cap.latencyMsP50, providerId];
}
function cmp(a, b) {
  const x = rank(a.cap, a.provider.providerId), y = rank(b.cap, b.provider.providerId);
  return x[0] - y[0] || x[1] - y[1] || x[2].localeCompare(y[2], 'en');
}
// Optional, host-supplied negative observations only. This is NOT an agent
// selector, an evidence store, or proof that any executor ran within IWXA.
// Omitted configuration fields mean "not qualified"; never extrapolate a trial.
const TRIAL_FAILURES = new Set([
  'NO_REQUIRED_CHANGE', 'INCORRECT_RESULT', 'INCOMPLETE_TASK',
  'REPEATED_EXTERNAL_EFFECTS',
]);
function nonemptyString(value, field) {
  if (typeof value !== 'string' || value.length === 0 || value.trim() !== value ||
      value.length > 256) fail('INVALID_DESCRIPTOR', field);
}
function trialStack(row, failure = false) {
  requireKeys(row, ['providerId', 'kind', 'capabilityId', 'modelId',
    'executorVersion', 'mode', 'operatingSystem',
    ...(failure ? ['taskKey', 'failureKind', 'proofRef'] : [])],
  failure ? 'observed_failure' : 'candidate_configuration');
  name(row.providerId, 'trial_provider');
  name(row.capabilityId, 'trial_capability');
  if (!['model', 'tool'].includes(row.kind)) fail('INVALID_DESCRIPTOR', 'trial_kind');
  for (const field of ['modelId', 'mode']) {
    if (row[field] !== null) nonemptyString(row[field], 'trial_' + field);
  }
  nonemptyString(row.executorVersion, 'trial_executor_version');
  nonemptyString(row.operatingSystem, 'trial_operating_system');
  if (failure) {
    nonemptyString(row.taskKey, 'trial_task_key');
    if (!TRIAL_FAILURES.has(row.failureKind)) fail('INVALID_DESCRIPTOR', 'trial_failure_kind');
    nonemptyString(row.proofRef, 'trial_proof_ref');
  }
}
function trialKey(taskKey, row) {
  // JSON tuple avoids separator collisions in versions, IDs and model tags.
  return canonical([taskKey, row.providerId, row.kind, row.capabilityId,
    row.modelId, row.executorVersion, row.mode, row.operatingSystem]);
}
function negativeEvidenceIndex(scope) {
  if (scope == null) return null;
  requireKeys(scope, ['taskKey', 'candidateConfigurations', 'failures'], 'trial_scope');
  nonemptyString(scope.taskKey, 'task_key');
  if (!Array.isArray(scope.candidateConfigurations) || !Array.isArray(scope.failures) ||
      scope.candidateConfigurations.length > 128 || scope.failures.length > 512) {
    fail('INVALID_DESCRIPTOR', 'trial_observation_size');
  }
  const configurations = new Map();
  for (const entry of scope.candidateConfigurations) {
    trialStack(entry);
    const key = canonical([entry.providerId, entry.kind, entry.capabilityId]);
    if (configurations.has(key)) fail('INVALID_DESCRIPTOR', 'duplicate_trial_configuration');
    configurations.set(key, entry);
  }
  const failed = new Map();
  for (const row of scope.failures) {
    trialStack(row, true);
    const key = trialKey(row.taskKey, row);
    if (failed.has(key)) fail('INVALID_DESCRIPTOR', 'duplicate_observed_failure');
    failed.set(key, row);
  }
  return { taskKey: scope.taskKey, configurations, failed };
}
function matchedObservedFailure(evidence, provider, cap) {
  if (evidence === null) return null;
  const stack = evidence.configurations.get(canonical([provider.providerId, cap.kind, cap.capabilityId]));
  if (!stack) return null; // Unknown candidate version/model/mode/OS is NOT a trial match.
  // For direct model capabilities do not accept host metadata that contradicts
  // the pinned model name. Tool runtimes bind their model via the owning host.
  if (cap.kind === 'model' && cap.modelPin && stack.modelId !== cap.modelPin.name) return null;
  return evidence.failed.get(trialKey(evidence.taskKey, stack)) ?? null;
}

export function resolveRequirements(solution, available, trialEvidence = null) {
  if (!object(solution) || typeof solution.solutionId !== 'string' || !Array.isArray(solution.requirements) || !Array.isArray(available)) fail('INVALID_DESCRIPTOR', 'resolution_input');
  name(solution.solutionId, 'solutionId');
  const observationIndex = negativeEvidenceIndex(trialEvidence);
  const evidenceExclusions = [];
  const providerIds = new Set();
  for (const provider of available) { descriptor(provider); if (providerIds.has(provider.providerId)) fail('INVALID_DESCRIPTOR', 'duplicate_provider'); providerIds.add(provider.providerId); }
  const reqIds = new Set(), selected = [], missing = [];
  for (const req of solution.requirements) {
    requirement(req);
    if (reqIds.has(req.requirementId)) fail('INVALID_DESCRIPTOR', 'duplicate_requirement');
    reqIds.add(req.requirementId);
    const candidates = [], causes = new Set();
    for (const provider of available) {
      const cap = provider.capabilities.find(c => c.kind === req.kind && c.capabilityId === req.capabilityId);
      if (!cap) continue;
      if (provider.availability !== 'available') { causes.add('UNAVAILABLE'); continue; }
      if (!cap.supported) { causes.add('UNSUPPORTED'); continue; }
      if (cap.effectClass !== req.effectClass) { causes.add('EFFECT_MISMATCH'); continue; }
      if (canonical(cap.inputSchema) !== canonical(req.inputSchema) || canonical(cap.outputSchema) !== canonical(req.outputSchema)) { causes.add('SCHEMA_MISMATCH'); continue; }
      if (req.kind === 'model') {
        if ((req.inputModes && !req.inputModes.every(mode => cap.inputModes.includes(mode))) ||
            (req.outputModes && !req.outputModes.every(mode => cap.outputModes.includes(mode)))) {
          causes.add('MODE_MISMATCH'); continue;
        }
        if (req.modelPin && (!cap.modelPin || canonical(cap.modelPin) !== canonical(req.modelPin))) {
          causes.add('PIN_MISMATCH'); continue;
        }
      }
      // Do not rank a known exact task-result failure by price or latency.
      // Vendor success / CLI exit 0 never creates a positive IWXA verdict.
      const failedTrial = matchedObservedFailure(observationIndex, provider, cap);
      if (failedTrial) {
        causes.add('OBSERVED_TASK_FAILURE');
        evidenceExclusions.push({
          requirementId: req.requirementId, providerId: provider.providerId,
          reason: 'OBSERVED_TASK_FAILURE', failureKind: failedTrial.failureKind,
          proofRef: failedTrial.proofRef,
        });
        continue;
      }
      candidates.push({ provider, cap });
    }
    candidates.sort(cmp);
    if (candidates.length) {
      const pick = candidates[0];
      selected.push({
        requirementId: req.requirementId, providerId: pick.provider.providerId,
        kind: req.kind, capabilityId: req.capabilityId, effectClass: req.effectClass,
        inputSchema: req.inputSchema, outputSchema: req.outputSchema,
        providerFeeUsd: pick.cap.providerFeeUsd, latencyMsP50: pick.cap.latencyMsP50,
        ...(req.kind === 'model' && pick.cap.modelPin ? { modelPin: pick.cap.modelPin } : {}),
        capabilityDigest: digest({ contractVersion: CONTRACT_VERSION, providerId: pick.provider.providerId, capability: pick.cap })
      });
    } else missing.push({ requirementId: req.requirementId, required: req.required,
      reason: ['OBSERVED_TASK_FAILURE', 'UNAVAILABLE', 'UNSUPPORTED', 'SCHEMA_MISMATCH', 'PIN_MISMATCH', 'MODE_MISMATCH', 'EFFECT_MISMATCH'].find(x => causes.has(x)) || 'ABSENT' });
  }
  const requiredMissing = missing.some(m => m.required);
  const totalProviderFeeUsd = selected.every(s => s.providerFeeUsd !== null) ? selected.reduce((n,s) => n + s.providerFeeUsd, 0) : null;
  const estimatedLatencyMs = selected.every(s => s.latencyMsP50 !== null) ? selected.reduce((n,s) => n + s.latencyMsP50, 0) : null;
  return { contractVersion: CONTRACT_VERSION, solutionId: solution.solutionId, status: requiredMissing ? 'UNSUPPORTED' : 'SUPPORTED',
    selected, missing, estimates: { providerFeeUsd: totalProviderFeeUsd, latencyMs: estimatedLatencyMs, hostComputeCostUsd: null },
    ...(observationIndex === null ? {} : { evidenceExclusions }) };
}
export function buildInvocationPlan(task, selectedSkills, resolution) {
  if (!object(task) || !task.taskId || !task.solutionId || !Array.isArray(selectedSkills) || !object(resolution)) fail('INVALID_PLAN', 'inputs');
  name(task.taskId, 'taskId'); name(task.solutionId, 'solutionId');
  if (resolution.status !== 'SUPPORTED' || resolution.solutionId !== task.solutionId || resolution.contractVersion !== CONTRACT_VERSION) fail('INVALID_PLAN', 'unresolved');
  const covered = new Set(resolution.selected.map(s => s.capabilityId));
  if (resolution.selected.some(s => !object(s) || !HEX64.test(s.capabilityDigest ?? '') ||
      typeof s.providerId !== 'string' || typeof s.kind !== 'string' ||
      typeof s.capabilityId !== 'string')) fail('INVALID_PLAN', 'unbound_capability');
  const skills = [];
  const selectedSkillIds = new Set();
  for (const skill of selectedSkills) {
    if (!object(skill) || skill.schema !== 'IWXA.K02.SKILL/0.1.0' || typeof skill.skillId !== 'string' || !Array.isArray(skill.requiredCapabilities) || !skill.requiredCapabilities.every(x => covered.has(x)) || !skill.instructionRef || !skill.verification || !HEX64.test(skill.instructionDigest ?? '') ||
      !/^skills\/[A-Za-z0-9._/-]+$/.test(skill.instructionRef) ||
      skill.instructionRef.split('/').includes('..')) fail('INVALID_PLAN', 'skill_dependency');
    name(skill.skillId, 'skillId');
    if (selectedSkillIds.has(skill.skillId)) fail('INVALID_PLAN', 'duplicate_skill');
    selectedSkillIds.add(skill.skillId);
    validateSchema(skill.parametersSchema);
    skills.push({ skillId: skill.skillId, instructionRef: skill.instructionRef,
      instructionDigest: skill.instructionDigest, descriptorDigest: digest(skill), verification: skill.verification });
  }
  const body = { contractVersion: CONTRACT_VERSION, bindingVersion: PLAN_BINDING_VERSION,
    taskId: task.taskId, solutionId: task.solutionId,
    skills, steps: resolution.selected.map(s => ({ requirementId: s.requirementId, providerId: s.providerId,
      kind: s.kind, capabilityId: s.capabilityId, capabilityDigest: s.capabilityDigest,
      ...(s.kind === 'model' && s.modelPin ? { modelPin: s.modelPin } : {}),
      effectClass: s.effectClass,
      inputSchema: s.inputSchema, outputSchema: s.outputSchema, hostApprovalRequired: true,
      invocationAuthority: 'HOST_ONLY', invocationState: 'NOT_INVOKED', proofOfInvoke: null })),
    estimates: resolution.estimates };
  return { ...body, planDigest: digest(body) };
}
export function validateInvocationInput(step, input) {
  if (!object(step) || step.invocationAuthority !== 'HOST_ONLY') fail('INVALID_PLAN', 'step');
  return validatePayload(step.inputSchema, input);
}
export function validateInvocationOutput(step, output) {
  if (!object(step) || step.invocationAuthority !== 'HOST_ONLY') fail('INVALID_PLAN', 'step');
  return validatePayload(step.outputSchema, output);
}

function assertTrustedPlan(plan, trustedPlanDigest) {
  if (!object(plan) || plan.contractVersion !== CONTRACT_VERSION ||
      plan.bindingVersion !== PLAN_BINDING_VERSION ||
      !HEX64.test(trustedPlanDigest ?? '') || !HEX64.test(plan.planDigest ?? '') ||
      trustedPlanDigest !== plan.planDigest) fail('INVALID_PLAN', 'untrusted_plan');
  const body = { ...plan };
  delete body.planDigest;
  if (digest(body) !== trustedPlanDigest || !Array.isArray(plan.steps) ||
      !Array.isArray(plan.skills)) fail('INVALID_PLAN', 'plan_changed');
  const skillIds = new Set();
  for (const skill of plan.skills) {
    if (!object(skill) || typeof skill.skillId !== 'string' ||
        skillIds.has(skill.skillId) || typeof skill.instructionRef !== 'string' ||
        !HEX64.test(skill.instructionDigest ?? '') ||
        !HEX64.test(skill.descriptorDigest ?? '')) {
      fail('INVALID_PLAN', 'skill_binding');
    }
    skillIds.add(skill.skillId);
  }
  const seen = new Set();
  for (const step of plan.steps) {
    if (!object(step) || typeof step.requirementId !== 'string' ||
        seen.has(step.requirementId) || typeof step.providerId !== 'string' ||
        !HEX64.test(step.capabilityDigest ?? '') ||
        !['model', 'tool'].includes(step.kind) ||
        step.hostApprovalRequired !== true ||
        step.invocationAuthority !== 'HOST_ONLY' ||
        step.invocationState !== 'NOT_INVOKED' || step.proofOfInvoke !== null) {
      fail('INVALID_PLAN', 'step_binding');
    }
    seen.add(step.requirementId);
  }
  return plan;
}

// This is a compatibility check, NOT an execution grant. The host alone
// supplies the trusted digest and the authority to invoke its existing port.
function verifySelectedStepAgainstDescriptor(step, current, trustedPlanDigest) {
  if (current.availability !== 'available') fail('PROVIDER_UNAVAILABLE', 'provider_no_longer_available');
  if (current.providerId !== step.providerId) fail('BINDING_CHANGED', 'provider_id');
  const cap = current.capabilities.find(x => x.kind === step.kind && x.capabilityId === step.capabilityId);
  if (!cap || !cap.supported || cap.effectClass !== step.effectClass ||
      canonical(cap.inputSchema) !== canonical(step.inputSchema) ||
      canonical(cap.outputSchema) !== canonical(step.outputSchema) ||
      canonical(cap.modelPin ?? null) !== canonical(step.modelPin ?? null) ||
      digest({ contractVersion: CONTRACT_VERSION, providerId: current.providerId, capability: cap }) !== step.capabilityDigest) {
    fail('BINDING_CHANGED', 'capability');
  }
  return { status: 'MATCHED_NOT_AUTHORIZED', planDigest: trustedPlanDigest,
    requirementId: step.requirementId, providerId: current.providerId,
    capabilityDigest: step.capabilityDigest };
}

// Each invocation preflight probes the current provider again. Restored-plan
// snapshot optimization below does not cache or authorize actual invocations.
export async function verifyInvocationReadiness(plan, requirementId, provider, trustedPlanDigest) {
  assertTrustedPlan(plan, trustedPlanDigest);
  const step = plan.steps.find(x => x.requirementId === requirementId);
  if (!step) fail('INVALID_PLAN', 'requirement_not_in_plan');
  const current = await describeCapabilities(provider);
  // Provider discovery is asynchronous; a mutable plan may change while it runs.
  assertTrustedPlan(plan, trustedPlanDigest);
  return verifySelectedStepAgainstDescriptor(step, current, trustedPlanDigest);
}

// Host supplies the originally selected descriptor and loaded raw instruction
// bytes. Neither text nor descriptor confers permission to call a runtime.
export function verifySkillBinding(plan, skillId, skillDescriptor, instructionBytes, trustedPlanDigest) {
  assertTrustedPlan(plan, trustedPlanDigest);
  const selected = plan.skills.find(x => x.skillId === skillId);
  if (!selected || !object(skillDescriptor) || skillDescriptor.skillId !== skillId ||
      digest(skillDescriptor) !== selected.descriptorDigest ||
      skillDescriptor.instructionRef !== selected.instructionRef ||
      skillDescriptor.instructionDigest !== selected.instructionDigest) {
    fail('BINDING_CHANGED', 'skill_descriptor');
  }
  if (!(instructionBytes instanceof Uint8Array) ||
      instructionBytes.byteLength > 1_000_000 ||
      createHash('sha256').update(instructionBytes).digest('hex') !== selected.instructionDigest) {
    fail('BINDING_CHANGED', 'skill_instructions');
  }
  return { status: 'MATCHED_NOT_ACTIVATED', skillId, instructionDigest: selected.instructionDigest };
}


// Generic, host-owned recovery check for a plan loaded from JSON or another
// transport. Caller supplies the trusted digest OUTSIDE the received plan and
// the host's registered provider objects and Skill instruction bytes.
// No provider invoke, no Skill activation and no native Agent port calls.
export async function verifyPortablePlan(plan, trustedPlanDigest, providers, skillBindings) {
  assertTrustedPlan(plan, trustedPlanDigest);
  if (!Array.isArray(providers) || !Array.isArray(skillBindings)) {
    fail('INVALID_PLAN', 'host_bindings');
  }
  const runtimeProviders = new Map();
  for (const entry of providers) {
    if (!object(entry) || typeof entry.providerId !== 'string' ||
        !entry.provider || typeof entry.provider.describeCapabilities !== 'function' ||
        runtimeProviders.has(entry.providerId)) {
      fail('INVALID_PLAN', 'provider_registry');
    }
    runtimeProviders.set(entry.providerId, entry.provider);
  }
  const hostSkills = new Map();
  for (const entry of skillBindings) {
    if (!object(entry) || !object(entry.descriptor) ||
        typeof entry.descriptor.skillId !== 'string' ||
        !(entry.instructionBytes instanceof Uint8Array) ||
        hostSkills.has(entry.descriptor.skillId)) {
      fail('INVALID_PLAN', 'skill_registry');
    }
    hostSkills.set(entry.descriptor.skillId, entry);
  }
  if (hostSkills.size !== plan.skills.length ||
      plan.skills.some(skill => !hostSkills.has(skill.skillId))) {
    fail('INVALID_PLAN', 'selected_skills_missing_or_unexpected');
  }
  // Check instructions before contacting providers; a mismatched Skill
  // must not be disguised by a separate provider availability failure.
  const verifiedSkills = [];
  for (const skill of plan.skills) {
    const entry = hostSkills.get(skill.skillId);
    const check = verifySkillBinding(
      plan, skill.skillId, entry.descriptor, entry.instructionBytes, trustedPlanDigest);
    verifiedSkills.push({ skillId: check.skillId, status: check.status });
  }
  // Build one capability snapshot per referenced provider. When multiple plan
  // steps share the same registered provider, do not repeat network/model probes.
  // Unused registered providers must not cause extra calls or failures.
  const referenced = new Map();
  for (const step of plan.steps) {
    const provider = runtimeProviders.get(step.providerId);
    if (!provider) fail('PROVIDER_UNAVAILABLE', 'host_provider_not_registered');
    referenced.set(step.providerId, provider);
  }
  const snapshots = new Map(await Promise.all(
    [...referenced].map(async ([providerId, provider]) =>
      [providerId, await describeCapabilities(provider)]),
  ));
  // This preflight uses a single current snapshot, not an execution authority.
  // Actual invocation must separately probe through verifyInvocationReadiness.
  assertTrustedPlan(plan, trustedPlanDigest);
  const verifiedSteps = [];
  for (const step of plan.steps) {
    const checked = verifySelectedStepAgainstDescriptor(
      step, snapshots.get(step.providerId), trustedPlanDigest);
    verifiedSteps.push({
      requirementId: checked.requirementId, providerId: checked.providerId, status: checked.status,
    });
  }
  assertTrustedPlan(plan, trustedPlanDigest);
  return {
    status: 'RESTORED_NOT_AUTHORIZED', planDigest: trustedPlanDigest,
    checkedSteps: verifiedSteps, checkedSkills: verifiedSkills,
    providerInvocations: 0, taskCreated: false, resultProduced: false,
  };
}
