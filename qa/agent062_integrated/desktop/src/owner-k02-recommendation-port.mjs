// Optional, non-executing K02 owner decision for the existing U01 plan route.
// The original K02 module remains the only compatibility and quality selector.
export class K02RecommendationHold extends Error {
  constructor(code) { super(code); this.code = code; }
}

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const pinMatches = (a, b) => object(a) && object(b) &&
  typeof a.name === 'string' && a.name === b.name &&
  typeof a.digest === 'string' && a.digest === b.digest;
const hold = code => { throw new K02RecommendationHold(code); };
// Preserve the original K02 negative-evidence verdict when the *required*
// model for the current Task was explicitly excluded. Optional/unrelated
// failed providers must not masquerade as a failure of the requested model.
function requiredModelFailed(resolution, solution) {
  if (!Array.isArray(resolution?.missing) ||
      !Array.isArray(resolution.evidenceExclusions) ||
      !Array.isArray(solution?.requirements)) return false;
  return resolution.missing.some(row => row.required === true &&
    row.reason === 'OBSERVED_TASK_FAILURE' &&
    solution.requirements.some(req => req.requirementId === row.requirementId &&
      req.kind === 'model' && req.capabilityId === 'text.generate') &&
    resolution.evidenceExclusions.some(x => x.requirementId === row.requirementId &&
      x.reason === 'OBSERVED_TASK_FAILURE'));
}
const allowed = new Set([
  'requirement_id', 'step', 'profiles', 'quality_evidence', 'environment',
  'user_model_pin', 'previous_failure', 'external_router',
]);

export function resolveK02OwnerChoice(k02, {resolveRequirements, recommendModelForStep}) {
  const evidence = k02.trial_evidence ?? null;
  const base = resolveRequirements(k02.solution, k02.providers, evidence);
  if (base.status !== 'SUPPORTED') {
    if (requiredModelFailed(base, k02.solution)) hold('OWNER_KNOWN_NATIVE_TASK_FAILURE');
    hold('OWNER_MODEL_UNAVAILABLE');
  }
  const input = k02.model_recommendation;
  if (input === undefined) return base; // Preserve the existing fast/explicit path.
  if (!object(input) || Object.keys(input).some(key => !allowed.has(key)) ||
      typeof input.requirement_id !== 'string' || !input.requirement_id ||
      !object(input.step) || !object(input.environment) ||
      !Array.isArray(input.profiles) || !Array.isArray(input.quality_evidence))
    hold('OWNER_RECOMMENDATION_INPUT_INVALID');
  const requirementId = input.requirement_id;
  const requirements = k02.solution.requirements.filter(item =>
    item.requirementId === requirementId && item.kind === 'model' &&
    item.capabilityId === 'text.generate');
  if (requirements.length !== 1 ||
      base.selected.filter(item => item.requirementId === requirementId).length !== 1)
    hold('OWNER_RECOMMENDATION_REQUIREMENT_MISMATCH');

  // Never ask the owner to offer an implicit replacement for the user's pin.
  const recommendation = recommendModelForStep({
    solution: k02.solution, requirementId, step: input.step,
    available: k02.providers, profiles: input.profiles,
    qualityEvidence: input.quality_evidence, environment: input.environment,
    userModelPin: input.user_model_pin ?? null, allowPinnedAlternatives: false,
    trialEvidence: evidence, previousFailure: input.previous_failure ?? null,
    externalRouter: input.external_router ?? null,
  });
  if (!object(recommendation) ||
      recommendation.version !== 'IWXA.K02.STEP_MODEL_RECOMMENDATION/0.1.0' ||
      recommendation.requirementId !== requirementId ||
      recommendation.hostAuthorityGranted !== false ||
      recommendation.executionState !== 'NOT_INVOKED' ||
      recommendation.proofOfInvoke !== null)
    hold('OWNER_RECOMMENDATION_INVALID');
  if (['QUALITY_UNKNOWN', 'PINNED_UNVERIFIED_NOT_AUTHORIZED'].includes(recommendation.decision))
    hold('OWNER_MODEL_QUALITY_UNKNOWN');
  if (recommendation.decision !== 'RECOMMENDED_NOT_AUTHORIZED' ||
      recommendation.selected?.quality?.status !== 'MEETS_OBSERVED_FLOOR')
    hold('OWNER_MODEL_NOT_QUALIFIED');
  const chosen = recommendation.selected;
  const matchingProvider = k02.providers.filter(p => p.providerId === chosen.providerId);
  if (matchingProvider.length !== 1 || chosen.requirementId !== requirementId ||
      chosen.capabilityId !== 'text.generate' ||
      !pinMatches(chosen.modelPin, input.user_model_pin ??
      requirements[0].modelPin ?? chosen.modelPin))
    hold('OWNER_RECOMMENDATION_BINDING_CHANGED');

  // Reuse the owner's full IO/capability/pin/negative-trial checks for this
  // exact provider. Never splice a model from an unverified recommendation.
  const scoped = resolveRequirements({
    solutionId: k02.solution.solutionId, requirements,
  }, matchingProvider, evidence);
  const exact = scoped.selected?.[0];
  if (scoped.status !== 'SUPPORTED' &&
      requiredModelFailed(scoped, {requirements})) hold('OWNER_KNOWN_NATIVE_TASK_FAILURE');
  if (scoped.status !== 'SUPPORTED' || scoped.selected.length !== 1 ||
      exact.requirementId !== requirementId || exact.kind !== 'model' ||
      exact.capabilityId !== 'text.generate' ||
      exact.providerId !== chosen.providerId ||
      exact.capabilityDigest !== chosen.capabilityDigest ||
      !pinMatches(exact.modelPin, chosen.modelPin))
    hold('OWNER_RECOMMENDATION_BINDING_CHANGED');
  const steps = base.selected.map(item => item.requirementId === requirementId ? exact : item);
  const providerFeeUsd = steps.every(item => typeof item.providerFeeUsd === 'number')
    ? steps.reduce((sum, item) => sum + item.providerFeeUsd, 0) : null;
  const latencyMs = steps.every(item => typeof item.latencyMsP50 === 'number')
    ? steps.reduce((sum, item) => sum + item.latencyMsP50, 0) : null;
  return {...base, selected: steps, estimates: {...base.estimates,
    providerFeeUsd, latencyMs, hostComputeCostUsd: null}};
}
