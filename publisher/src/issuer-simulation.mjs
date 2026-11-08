import {validateTestLicenseRequest} from './test-license-request.mjs';

export const SIMULATED_ISSUER_EVENT_SCHEMA = 'IWXA_PUBLISHER_ISSUER_SIMULATION/1';
export const SIMULATED_DECISIONS = Object.freeze([
  'SIMULATED_ISSUED', 'SIMULATED_SUSPENDED', 'SIMULATED_REVOKED'
]);
export class PublisherSimulationError extends Error {
  constructor(code){super(code);this.name='PublisherSimulationError';this.code=code;}
}
const fail=code=>{throw new PublisherSimulationError(code);};
const plain=v=>v!==null&&typeof v==='object'&&!Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const keys=(v,ks,code)=>{
  if(!plain(v)||Object.keys(v).length!==ks.length||ks.some(k=>!Object.hasOwn(v,k)))fail(code);
};
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);

// No license envelope, signature, signer or private key ever exists in this
// module. This models the business handoff while the original T3 product issuer
// and consumer are developed by their owner.
export function validateSimulatedIssuerEvent(value) {
  keys(value,[
    'schema','kind','request','observedAt','expiresAt','sequence','decision',
    'origin','authority','effectiveSeats','status'
  ],'SIMULATION_FIELDS_INVALID');
  if(value.schema!==SIMULATED_ISSUER_EVENT_SCHEMA||value.kind!=='ISSUER_SIMULATION'||
     value.origin!=='TEST_MODEL_ONLY'||value.authority!==false||
     value.effectiveSeats!==0||value.status!=='NOT_LICENSE')
    fail('SIMULATION_AUTHORITY_FORBIDDEN');
  const request=validateTestLicenseRequest(value.request);
  if(!iso(value.observedAt)||!iso(value.expiresAt)||
      Date.parse(value.expiresAt)<=Date.parse(value.observedAt))
    fail('SIMULATION_INTERVAL_INVALID');
  if(!Number.isSafeInteger(value.sequence)||value.sequence<1||value.sequence>2147483647)
    fail('SIMULATION_SEQUENCE_INVALID');
  if(!SIMULATED_DECISIONS.includes(value.decision))
    fail('SIMULATION_DECISION_INVALID');
  return {...structuredClone(value),request};
}

export function simulateIssuerEvent(request,{decision='SIMULATED_ISSUED',observedAt,sequence=1}={}) {
  const original=validateTestLicenseRequest(request);
  if(!iso(observedAt))fail('SIMULATION_TIME_REQUIRED');
  const start=Date.parse(observedAt);
  // A request proposes duration; the model does not authorize it.
  const end=start+original.termDays*86400000;
  if(!Number.isSafeInteger(end)||!Number.isFinite(end))fail('SIMULATION_INTERVAL_INVALID');
  return validateSimulatedIssuerEvent({
    schema:SIMULATED_ISSUER_EVENT_SCHEMA,
    kind:'ISSUER_SIMULATION',
    request:original,
    observedAt,
    expiresAt:new Date(end).toISOString(),
    sequence,
    decision,
    origin:'TEST_MODEL_ONLY',
    authority:false,
    effectiveSeats:0,
    status:'NOT_LICENSE'
  });
}

export function matchSimulatedEventToRequest(request,event) {
  const r=validateTestLicenseRequest(request);
  const e=validateSimulatedIssuerEvent(event);
  // Strict field-bound match: a simulated issuer cannot change product,
  // organization, duration, features, or seat count without a new request.
  return equal(r,e.request);
}
