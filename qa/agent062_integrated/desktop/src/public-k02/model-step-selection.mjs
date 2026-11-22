// K02 model decision is an optional, pure step-level view of the existing
// resolveRequirements compatibility selector. It is NOT a second runtime,
// classifier, task evaluator, model server, or execution authority.
import { CONTRACT_VERSION, InteropError, resolveRequirements } from './index.mjs';

export const STEP_MODEL_RECOMMENDATION_VERSION = 'IWXA.K02.STEP_MODEL_RECOMMENDATION/0.1.0';
const DIFFICULTY = new Set(['simple', 'moderate', 'complex']);
const HEX64 = /^[a-f0-9]{64}$/;
function invalid(reason) { throw new InteropError('INVALID_MODEL_RECOMMENDATION', reason); }
function record(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function finite(value) { return typeof value === 'number' && Number.isFinite(value); }
function bounded(value, min, max, name) {
  if (!finite(value) || value < min || value > max) invalid(name);
}
function str(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > 180) invalid(name);
}
function pinKey(pin) {
  return pin ? pin.name + '@' + pin.digest : null;
}
function checkPin(pin, name) {
  if (!record(pin) || Object.keys(pin).sort().join(',') !== 'digest,name' ||
      typeof pin.name !== 'string' || pin.name.length > 160 ||
      !HEX64.test(pin.digest ?? '')) invalid(name);
}
function strictKeys(obj, fields, name) {
  if (!record(obj) || Object.keys(obj).some(key => !fields.includes(key))) invalid(name);
}
function compare(a, b) {
  // Qualified models: least projected expense, then p50 latency and memory.
  // Null means unknown, NEVER assumed free.
  for (const key of ['estimatedTotalUsd', 'estimatedProviderFeeUsd',
    'projectedLatencyMs', 'memoryMiB']) {
    const aa = a.estimates[key] ?? Infinity;
    const bb = b.estimates[key] ?? Infinity;
    if (aa !== bb) return aa - bb;
  }
  return a.providerId.localeCompare(b.providerId);
}
function attemptsAt(observedRate, maxAttempts) {
  if (observedRate === null) return null;
  let expected = 0;
  for (let k = 0; k < maxAttempts; k++) expected += (1 - observedRate) ** k;
  return Number(expected.toFixed(8));
}
function evidenceFor(row, pin, step, environment, version) {
  if (!pin) return null; // Unpinned model cannot inherit exact-model quality.
  return row.find(x =>
    x.providerId === step.providerId &&
    x.modelPin.name === pin.name && x.modelPin.digest === pin.digest &&
    x.taskClass === step.taskClass && x.difficulty === step.difficulty &&
    x.operatingSystem === environment.operatingSystem &&
    x.runtimeVersion === version) ?? null;
}
function summarize(evidence, step) {
  if (!evidence || evidence.attempts < step.minSamples) return {
    status: 'UNKNOWN', observedRate: null, samples: evidence?.attempts ?? 0,
    proofRef: evidence?.proofRef ?? null,
  };
  const observedRate = evidence.passed / evidence.attempts;
  return { status: observedRate >= step.minObservedSuccessRate ? 'MEETS_OBSERVED_FLOOR' : 'BELOW_OBSERVED_FLOOR',
    observedRate, samples: evidence.attempts, proofRef: evidence.proofRef,
    qualification: 'OBSERVED_SAMPLE_NOT_FUTURE_SUCCESS_GUARANTEE' };
}
function validate({ solution, requirementId, step, available, profiles,
  qualityEvidence, environment, userModelPin, previousFailure, externalRouter }) {
  if (!record(solution) || !Array.isArray(solution.requirements) ||
    !Array.isArray(available) || !Array.isArray(profiles) ||
    !Array.isArray(qualityEvidence) || !record(step) ||
    !record(environment)) invalid('inputs');
  str(requirementId, 'requirement_id');
  strictKeys(step, ['taskClass', 'difficulty', 'minObservedSuccessRate', 'minSamples',
    'maxAttempts', 'maxLatencyMs', 'maxMemoryMiB'], 'step_fields');
  str(step.taskClass, 'task_class');
  if (!DIFFICULTY.has(step.difficulty)) invalid('difficulty');
  bounded(step.minObservedSuccessRate, 0, 1, 'quality_floor');
  if (!Number.isSafeInteger(step.minSamples) || step.minSamples < 1 || step.minSamples > 100000) invalid('min_samples');
  if (!Number.isSafeInteger(step.maxAttempts) || step.maxAttempts < 1 || step.maxAttempts > 4) invalid('max_attempts');
  if (step.maxLatencyMs != null) bounded(step.maxLatencyMs, 0.001, 1e9, 'max_latency');
  if (step.maxMemoryMiB != null) bounded(step.maxMemoryMiB, 1, 1e9, 'max_memory');
  strictKeys(environment, ['operatingSystem'], 'environment_fields');
  str(environment.operatingSystem, 'os');
  if (userModelPin !== null) checkPin(userModelPin, 'user_pin');
  const matching = solution.requirements.filter(r => r.requirementId === requirementId);
  if (matching.length !== 1 || matching[0].kind !== 'model') invalid('model_step_requirement');
  if (matching[0].modelPin && userModelPin && pinKey(matching[0].modelPin) !== pinKey(userModelPin))
    invalid('conflicting_pins');
  if (profiles.length > 128 || qualityEvidence.length > 512) invalid('too_many_profiles');
  const ids = new Set();
  for (const profile of profiles) {
    strictKeys(profile, ['providerId', 'modelPin', 'runtimeVersion', 'memoryMiB',
      'computeUsdPerAttempt', 'costBasis'], 'profile_fields');
    str(profile.providerId,'profile_provider');
    checkPin(profile.modelPin, 'profile_pin');
    str(profile.runtimeVersion,'runtime_version');
    if (profile.memoryMiB !== null) bounded(profile.memoryMiB, 1, 1e9, 'memory');
    if (profile.computeUsdPerAttempt !== null) bounded(profile.computeUsdPerAttempt, 0, 1e8, 'compute_cost');
    if (!['MEASURED','ESTIMATED','UNKNOWN'].includes(profile.costBasis)) invalid('cost_basis');
    if ((profile.costBasis === 'UNKNOWN') !== (profile.computeUsdPerAttempt === null)) invalid('cost_unknown_mismatch');
    if (ids.has(profile.providerId)) invalid('duplicate_profile');
    ids.add(profile.providerId);
  }
  const unique = new Set();
  for (const e of qualityEvidence) {
    strictKeys(e, ['providerId','modelPin','taskClass','difficulty','operatingSystem',
      'runtimeVersion','passed','attempts','proofRef'], 'evidence_fields');
    str(e.providerId,'evidence_provider');
    checkPin(e.modelPin,'evidence_pin');
    str(e.taskClass,'evidence_task');
    if (!DIFFICULTY.has(e.difficulty)) invalid('evidence_difficulty');
    str(e.operatingSystem,'evidence_os');
    str(e.runtimeVersion,'evidence_runtime');
    str(e.proofRef,'evidence_proof');
    if (!Number.isSafeInteger(e.attempts) || e.attempts <= 0 || e.attempts > 1000000 ||
      !Number.isSafeInteger(e.passed) || e.passed < 0 || e.passed > e.attempts) invalid('evidence_counts');
    const key = JSON.stringify([e.providerId, pinKey(e.modelPin),e.taskClass,e.difficulty,e.operatingSystem,e.runtimeVersion]);
    if (unique.has(key)) invalid('duplicate_quality_evidence');
    unique.add(key);
  }
  if (previousFailure !== null) {
    strictKeys(previousFailure, ['providerId','modelPin','taskClass','difficulty','operatingSystem','runtimeVersion','proofRef','verified'],
      'previous_failure_fields');
    str(previousFailure.providerId,'failed_provider');
    checkPin(previousFailure.modelPin,'failed_pin');
    str(previousFailure.proofRef,'failed_proof');
    str(previousFailure.operatingSystem,'failed_os');
    str(previousFailure.runtimeVersion,'failed_runtime_version');
    if (previousFailure.verified !== true || previousFailure.taskClass !== step.taskClass ||
      previousFailure.difficulty !== step.difficulty) invalid('failure_not_exact_or_verified');
  }
  if (externalRouter !== null) {
    strictKeys(externalRouter, ['directProviderId','additionalFeeUsd','additionalLatencyMs'],
      'external_router_fields');
    str(externalRouter.directProviderId,'direct_provider');
    bounded(externalRouter.additionalFeeUsd,0,1e8,'router_cost');
    bounded(externalRouter.additionalLatencyMs,0,1e8,'router_latency');
  }
  return matching[0];
}
// Inputs from K04: solution's EXISTING model requirement + structured step
// class/difficulty/threshold. Host provides exact OS, model bindings and K05
// observations. No prompt inspection, model call, ML dependencies, scores or
// inference authority. Negative vendor evidence is handled by resolveRequirements.
export function recommendModelForStep({
  solution, requirementId, step, available, profiles = [], qualityEvidence = [],
  environment, userModelPin = null, allowPinnedAlternatives = false,
  trialEvidence = null, previousFailure = null, externalRouter = null,
}) {
  if (typeof allowPinnedAlternatives !== 'boolean') invalid('pinned_alternatives_flag');
  const required = validate({ solution, requirementId, step, available,
    profiles, qualityEvidence, environment, userModelPin, previousFailure, externalRouter });
  const selectedPin = userModelPin ?? required.modelPin ?? null;
  const scopedSolution = { solutionId: solution.solutionId, requirements: [required] };
  const profileById = new Map(profiles.map(p => [p.providerId,p]));
  const compatible = [], exclusions = [];
  for (const provider of available) {
    // Reuse existing K02 gates: availability, capabilities, IO schemas, modality,
    // exact negative trials and optional modelPin.
    const resolved = resolveRequirements(scopedSolution, [provider], trialEvidence);
    if (resolved.status !== 'SUPPORTED') {
      exclusions.push({providerId:provider.providerId,
        reason:resolved.missing[0]?.reason ?? 'INCOMPATIBLE'});
      continue;
    }
    const chosen = resolved.selected[0];
    const profile = profileById.get(chosen.providerId) ?? null;
    const pin = chosen.modelPin ?? null;
    if (profile && pinKey(profile.modelPin) !== pinKey(pin)) {
      exclusions.push({providerId:chosen.providerId,reason:'BINDING_CHANGED'});
      continue;
    }
    const observed = profile && pin && pinKey(pin) === pinKey(profile.modelPin)
      ? evidenceFor(qualityEvidence, pin,
        {providerId: chosen.providerId,taskClass:step.taskClass,difficulty:step.difficulty},
        environment,profile.runtimeVersion) : null;
    const quality = summarize(observed, step);
    const expectedAttempts = attemptsAt(quality.observedRate, step.maxAttempts);
    const memoryMiB = profile?.memoryMiB ?? null;
    const fee = chosen.providerFeeUsd;
    const compute = profile?.computeUsdPerAttempt ?? null;
    const projectedLatencyMs = chosen.latencyMsP50 === null || expectedAttempts === null
      ? null : Number((chosen.latencyMsP50*expectedAttempts).toFixed(4));
    const estimatedProviderFeeUsd = fee === null || expectedAttempts === null
      ? null : Number((fee * expectedAttempts).toFixed(8));
    const estimatedTotalUsd = compute === null || fee === null || expectedAttempts === null
      ? null : Number(((fee+compute)*expectedAttempts).toFixed(8));
    const candidate = {
      providerId:chosen.providerId,requirementId, capabilityId:chosen.capabilityId,
      capabilityDigest: chosen.capabilityDigest, modelPin:pin,
      quality, estimates: {
        expectedAttempts, estimatedProviderFeeUsd, estimatedTotalUsd,
        projectedLatencyMs, memoryMiB, hostComputeCostBasis:profile?.costBasis ?? 'UNKNOWN',
        costKind:'PROJECTED_NOT_MEASURED_TASK_COST',
      },
      uncertainty: [
        ...(quality.status === 'UNKNOWN' ? ['QUALITY_UNKNOWN'] : ['OBSERVED_RATE_NOT_GUARANTEED']),
        ...(compute === null ? ['HOST_COMPUTE_COST_UNKNOWN'] : []),
        ...(chosen.latencyMsP50 === null ? ['LATENCY_UNKNOWN'] : ['P50_TIMES_ATTEMPTS_IS_ONLY_AN_ESTIMATE']),
        ...(profile?.costBasis === 'ESTIMATED' ? ['COMPUTE_PRICE_ESTIMATED_NOT_MEASURED'] : []),
      ],
      reasons: [],
    };
    if (selectedPin && pinKey(pin) !== pinKey(selectedPin)) {
      exclusions.push({providerId:chosen.providerId,reason:'USER_PIN_NOT_MATCHED'});
      // Keep as potential alternative only if explicitly requested.
      if (allowPinnedAlternatives) candidate.reasons.push('REQUIRES_HOST_APPROVAL_TO_CHANGE_PIN');
      else continue;
    }
    if (previousFailure && previousFailure.providerId === chosen.providerId &&
      pinKey(previousFailure.modelPin) === pinKey(pin) &&
      previousFailure.operatingSystem === environment.operatingSystem &&
      previousFailure.runtimeVersion === profile?.runtimeVersion) {
      exclusions.push({providerId:chosen.providerId,reason:'VERIFIED_STEP_FAILURE',
        proofRef:previousFailure.proofRef});
      continue;
    }
    if (quality.status === 'BELOW_OBSERVED_FLOOR') {
      exclusions.push({providerId:chosen.providerId,reason:'BELOW_OBSERVED_QUALITY_FLOOR',
        proofRef:quality.proofRef});
      continue;
    }
    if (step.maxMemoryMiB != null && (memoryMiB === null || memoryMiB > step.maxMemoryMiB)) {
      exclusions.push({providerId:chosen.providerId,
        reason:memoryMiB === null?'RESOURCE_UNKNOWN':'RESOURCE_LIMIT'});
      continue;
    }
    if (step.maxLatencyMs != null &&
      (projectedLatencyMs === null || projectedLatencyMs > step.maxLatencyMs)) {
      exclusions.push({providerId:chosen.providerId,
        reason:projectedLatencyMs === null?'LATENCY_UNKNOWN':'LATENCY_LIMIT'});
      continue;
    }
    candidate.reasons.push(quality.status === 'MEETS_OBSERVED_FLOOR'
      ? 'OBSERVED_QUALITY_FLOOR_MET' : 'UNVERIFIED_QUALITY');
    if (pin && selectedPin && pinKey(pin) === pinKey(selectedPin)) candidate.reasons.push('USER_PIN_PRESERVED');
    compatible.push(candidate);
  }
  compatible.sort(compare);
  const qualified = compatible.filter(c => c.quality.status === 'MEETS_OBSERVED_FLOOR');
  const pinned = selectedPin ? compatible.find(c=>pinKey(c.modelPin)===pinKey(selectedPin))??null : null;
  // Never silently override the user's pin, including when a different model
  // appears stronger and cheaper. Alternatives are suggestions, not actions.
  const selected = selectedPin
    ? (pinned && pinned.quality.status !== 'BELOW_OBSERVED_FLOOR' ? pinned : null)
    : (qualified[0] ?? null);
  const unknown = compatible.filter(c => c.quality.status === 'UNKNOWN');
  const decision = selected?.quality.status === 'UNKNOWN' && selectedPin
    ? 'PINNED_UNVERIFIED_NOT_AUTHORIZED'
    : selected ? 'RECOMMENDED_NOT_AUTHORIZED'
    : selectedPin ? 'PINNED_MODEL_NOT_QUALIFIED'
    : unknown.length ? 'QUALITY_UNKNOWN' : 'NO_QUALIFIED_MODEL';
  const direct = externalRouter
    ? qualified.find(c => c.providerId === externalRouter.directProviderId) ?? null
    : null;
  const routeSaving = selected && direct && selected.estimates.estimatedTotalUsd !== null &&
      direct.estimates.estimatedTotalUsd !== null
    ? direct.estimates.estimatedTotalUsd - selected.estimates.estimatedTotalUsd : null;
  const matchedPreviousFailure = previousFailure &&
    previousFailure.operatingSystem === environment.operatingSystem &&
    profileById.get(previousFailure.providerId)?.runtimeVersion === previousFailure.runtimeVersion;
  const originalFailureQuality = matchedPreviousFailure
    ? qualityEvidence.find(e => e.providerId === previousFailure.providerId &&
        pinKey(e.modelPin) === pinKey(previousFailure.modelPin) &&
        e.taskClass === step.taskClass && e.difficulty === step.difficulty &&
        e.operatingSystem === environment.operatingSystem &&
        e.runtimeVersion === profileById.get(e.providerId)?.runtimeVersion &&
        e.runtimeVersion === previousFailure.runtimeVersion)
    : null;
  const previousRate = originalFailureQuality?.attempts >= step.minSamples
    ? originalFailureQuality.passed / originalFailureQuality.attempts : null;
  const latencySaving = selected && direct &&
    selected.estimates.projectedLatencyMs !== null &&
    direct.estimates.projectedLatencyMs !== null
    ? direct.estimates.projectedLatencyMs - selected.estimates.projectedLatencyMs : null;
  const externalRouting = externalRouter ? {
    advice: (routeSaving !== null && externalRouter.additionalFeeUsd >= routeSaving) ||
      (latencySaving !== null && externalRouter.additionalLatencyMs >= latencySaving)
      ? 'SKIP_EXTRA_ROUTER' : 'BENEFIT_NOT_PROVEN',
    additionalFeeUsd:externalRouter.additionalFeeUsd,
    additionalLatencyMs:externalRouter.additionalLatencyMs,
    estimatedSavingsBeforeOverheadUsd:routeSaving,
    estimatedLatencySavedBeforeOverheadMs:latencySaving,
  } : null;
  return {
    version:STEP_MODEL_RECOMMENDATION_VERSION,
    contractVersion:CONTRACT_VERSION,
    requirementId, taskClass:step.taskClass,difficulty:step.difficulty,
    decision,selected,
    alternatives:compatible.filter(c=>c!==selected),
    excluded:exclusions,
    externalRouting,
    escalation:matchedPreviousFailure ? {
      status: !selected ? 'NO_QUALIFIED_ESCALATION'
        : previousRate !== null && selected.quality.observedRate > previousRate
          ? 'STRONGER_MODEL_PROPOSED_NOT_EXECUTED'
          : 'ALTERNATIVE_MODEL_REQUIRES_REVIEW',
      proofRef:previousFailure.proofRef,
    } : null,
    uncertainties: selected ? selected.uncertainty : ['NO_VERIFIED_SUITABLE_SELECTION',...(unknown.length ? ['QUALITY_UNKNOWN'] : [])],
    hostAuthorityGranted:false,proofOfInvoke:null,
    executionState:'NOT_INVOKED',
  };
}
