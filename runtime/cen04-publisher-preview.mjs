import {validateDraft} from '../src/organization.mjs';
import {validateTestLicenseRequest} from '../publisher/src/test-license-request.mjs';
import {validateSimulatedIssuerEvent, matchSimulatedEventToRequest} from '../publisher/src/issuer-simulation.mjs';

// CEN04's owner is the original T3 runtime. This file only previews a TEST
// simulation against the existing Center organization draft. It never imports
// signing code, creates grants or sets an entitlement to ACTIVE.
export const CENTER_PUBLISHER_SIMULATION_SCHEMA='IWXA_CEN04_PUBLISHER_SIMULATION_PREVIEW/1';

export class CenterPublisherPreviewError extends Error {
 constructor(code){super(code);this.name='CenterPublisherPreviewError';this.code=code;}
}
const fail=code=>{throw new CenterPublisherPreviewError(code);};
const iso=v=>typeof v==='string'&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString()===v;

export function previewSimulatedPublisherSeats({
 centerDraft,request,event,observedAt,priorSequenceFloor=0,simulatedAssigneeIds=[]
}){
 const draft=validateDraft(structuredClone(centerDraft));
 const desired=validateTestLicenseRequest(request);
 const sample=validateSimulatedIssuerEvent(event);
 if(!iso(observedAt))fail('CEN04_PREVIEW_TIME_INVALID');
 if(!Number.isSafeInteger(priorSequenceFloor)||priorSequenceFloor<0)
   fail('CEN04_PREVIEW_SEQUENCE_FLOOR_INVALID');
 const org=draft.organizations.find(x=>x.id===desired.subject.id);
 // Hypothetical assignments must be explicitly supplied for THIS product.
 // A Personal Agent seat plan in CEN01 is not a Publisher/Center license seat.
 if(!Array.isArray(simulatedAssigneeIds)||simulatedAssigneeIds.length>10000||
   simulatedAssigneeIds.some(id=>typeof id!=='string'||id.length<1||id.length>160)||
   new Set(simulatedAssigneeIds).size!==simulatedAssigneeIds.length)
   fail('CEN04_SIMULATION_ASSIGNEES_INVALID');
 const planned=simulatedAssigneeIds.length;
 let state='MATCHED_TEST_SIMULATION';
 if(!org||org.kind!=='ORGANIZATION')state='ORGANIZATION_NOT_FOUND';
 else if(draft.activeOrganizationId!==org.id)state='ORGANIZATION_CONTEXT_CHANGED';
 else if(!matchSimulatedEventToRequest(desired,sample))state='REQUEST_BINDING_CHANGED';
 else if(simulatedAssigneeIds.some(id=>!org.participants.some(p=>p.id===id)))
   state='SIMULATED_ASSIGNEE_NOT_FOUND';
 else if(simulatedAssigneeIds.length>desired.seats)state='SIMULATED_SEATS_EXCEEDED';
 else if(sample.sequence<=priorSequenceFloor)state='SIMULATED_EVENT_REPLAY';
 else if(Date.parse(sample.observedAt)>Date.parse(observedAt))state='SIMULATED_EVENT_IN_FUTURE';
 else if(Date.parse(sample.expiresAt)<=Date.parse(observedAt))state='SIMULATED_EVENT_EXPIRED';
 else if(sample.decision==='SIMULATED_REVOKED')state='SIMULATED_REVOKED';
 else if(sample.decision==='SIMULATED_SUSPENDED')state='SIMULATED_SUSPENDED';
 // Presentation numbers never feed a license engine or modify the Admin draft.
 const matched=state==='MATCHED_TEST_SIMULATION';
 return Object.freeze({
  schema:CENTER_PUBLISHER_SIMULATION_SCHEMA,
  kind:'NON_AUTHORIZING_TEST_PREVIEW',
  state,organizationId:desired.subject.id,
  productId:desired.product.id,requestId:desired.requestId,
  modeledRequestedSeats:matched?desired.seats:0,
  modeledPlannedSeats:matched?planned:0,
  modeledUnassignedCapacity:matched?Math.max(0,desired.seats-planned):0,
  actualLicensedSeats:0,
  actualGrantedSeats:0,
  canAssignSeats:false,
  canActivateProduct:false,
  signedLicenseVerified:false,
  issuerTrust:'NOT_EVALUATED',
  centerDraftUnchanged:true
 });
}
