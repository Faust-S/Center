// Read-only native projection and bound UI command preparation. Not an IAM,
// seat ledger or license evaluator. The original signed T3 owner decides.
const ID=/^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,159}$/;
const SHA=/^[a-f0-9]{64}$/;
const id=v=>typeof v==='string'&&ID.test(v);
const sha=v=>typeof v==='string'&&SHA.test(v);
const count=v=>Number.isSafeInteger(v)&&v>=0;
const nullableCount=v=>v===null||count(v);
const states=['VERIFIED_CAPACITY_CANDIDATE','LINEAGE_INCOMPLETE','MULTIPLE_CURRENT_LICENSES',
 'NO_CURRENT_LICENSE','LICENSE_SOURCE_UNAVAILABLE'];
const statuses=['ACTIVE','SUSPENDED','REVOKED','SUPERSEDED'];
const check=(ok,code='CEN_D3_CORPORATE_SEAT_READBACK_INVALID')=>{if(!ok)throw Error(code);};
export function readOriginalSeatView(value,organizationId,workspaceId){
 const v=value;
 check(id(organizationId)&&id(workspaceId)&&v?.schema==='IWXA_T3_ORIGINAL_CORPORATE_SEAT_VIEW/1'&&
  v.organizationId===organizationId&&v.workspaceId===workspaceId&&v.originalReadback===true&&
  v.productionActivation===false&&sha(v.registryDigest)&&states.includes(v.licenseState)&&
  (v.licenseEvidenceDigest===null||sha(v.licenseEvidenceDigest))&&
  typeof v.seatPolicyReady==='boolean'&&typeof v.withinLimits==='boolean'&&
  typeof v.existingLineageMatches==='boolean'&&count(v.reservedSeats)&&
  count(v.independentlyEnrolledEmployees)&&count(v.availableSeats)&&
  nullableCount(v.seatLimit)&&nullableCount(v.employeeLimit)&&nullableCount(v.overSeatLimit)&&
  nullableCount(v.overEmployeeLimit)&&count(v.assignmentTotal)&&count(v.assignmentOffset)&&
  v.assignmentOffset<=v.assignmentTotal&&v.reservedSeats<=v.assignmentTotal&&
  Array.isArray(v.assignments)&&v.assignments.length<=64&&
  v.assignments.length===Math.min(64,v.assignmentTotal-v.assignmentOffset)&&
  v.assignmentNextOffset===(v.assignmentOffset+64<v.assignmentTotal?v.assignmentOffset+64:null)&&
  count(v.employeeTotal)&&v.employeeTotal<=v.independentlyEnrolledEmployees&&count(v.employeeOffset)&&
  v.employeeOffset<=v.employeeTotal&&Array.isArray(v.eligibleEmployees)&&
  v.eligibleEmployees.length===Math.min(64,v.employeeTotal-v.employeeOffset)&&
  v.employeeNextOffset===(v.employeeOffset+64<v.employeeTotal?v.employeeOffset+64:null));
 const c=v.candidate;
 if(c===null){
  check(v.licenseState!=='VERIFIED_CAPACITY_CANDIDATE'&&v.availableSeats===0&&
   v.withinLimits===false&&v.seatLimit===null&&v.employeeLimit===null&&
   v.overSeatLimit===null&&v.overEmployeeLimit===null);
 }else{
  check(v.licenseState==='VERIFIED_CAPACITY_CANDIDATE'&&sha(v.licenseEvidenceDigest)&&
   id(c?.licenseId)&&id(c?.lineageId)&&sha(c?.lineageDigest)&&sha(c?.licenseDigest)&&
   count(c?.seatLimit)&&count(c?.employeeLimit)&&
   typeof c.expiresAt==='string'&&Number.isFinite(Date.parse(c.expiresAt))&&
   typeof c.statusValidUntil==='string'&&Number.isFinite(Date.parse(c.statusValidUntil))&&
   c.seatLimit===v.seatLimit&&
   c.employeeLimit===v.employeeLimit&&
   v.overSeatLimit===Math.max(0,v.reservedSeats-v.seatLimit)&&
   v.overEmployeeLimit===Math.max(0,v.independentlyEnrolledEmployees-v.employeeLimit)&&
   (!v.withinLimits||(v.existingLineageMatches&&v.overSeatLimit===0&&v.overEmployeeLimit===0))&&
   v.availableSeats===(v.seatPolicyReady&&v.withinLimits?Math.max(0,v.seatLimit-v.reservedSeats):0));
 }
 const grants=new Set(),reservedPeople=new Set();
 for(const [index,row] of v.assignments.entries()){
  check(row&&id(row.grantId)&&id(row.personId)&&id(row.enrollmentId)&&id(row.workGrantId)&&
   id(row.credentialKeyId)&&sha(row.lineageDigest)&&sha(row.licenseDigest)&&
   typeof row.expiresAt==='string'&&Number.isFinite(Date.parse(row.expiresAt))&&
   statuses.includes(row.status)&&typeof row.reserved==='boolean'&&!grants.has(row.grantId)&&
   row.reserved===(index+v.assignmentOffset<v.reservedSeats)&&
   (!row.reserved||(['ACTIVE','SUSPENDED'].includes(row.status)&&!reservedPeople.has(row.personId))));
  grants.add(row.grantId);if(row.reserved)reservedPeople.add(row.personId);
 }
 const roster=new Set();
 for(const m of v.eligibleEmployees){
  check(id(m?.personId)&&id(m?.enrollmentId)&&typeof m.reserved==='boolean'&&
    !roster.has(m.personId));
  const row=v.assignments.find(r=>r.personId===m.personId&&r.reserved);
  check(!row||m.reserved);
  if(v.assignmentOffset===0&&v.assignmentNextOffset===null)check(m.reserved===!!row);
  roster.add(m.personId);
 }
 return v;
}
// Return a fresh command bound to the exact independently-read native state.
// No price/seat calculations, actor selection, or proof keys are sent by UI.
/** @param {any} view @param {string} kind @param {string} commandId
 * @param {{personId:string,enrollmentId:string}|null} employee @param {string|null} [fromGrantId] */
export function prepareOriginalSeatCommand(view,kind,commandId,employee,fromGrantId=null){
 check(view?.originalReadback===true&&id(commandId)&&['ASSIGN','RELEASE','TRANSFER'].includes(kind),
  'CEN_D3_CORPORATE_SEAT_COMMAND_INVALID');
 const assign=kind!=='RELEASE',release=kind!=='ASSIGN';
 const from=release?view.assignments.find(r=>r.grantId===fromGrantId&&r.reserved):null;
 check(!release||!!from,'CEN_D3_CORPORATE_SEAT_SOURCE_REQUIRED');
 check(release||fromGrantId===null,'CEN_D3_CORPORATE_SEAT_SOURCE_REQUIRED');
 if(assign){
  check(id(employee?.personId)&&id(employee?.enrollmentId)&&
   view.seatPolicyReady===true&&view.withinLimits===true&&sha(view.licenseEvidenceDigest)&&
   (kind!=='ASSIGN'||view.availableSeats>0)&&
   !view.assignments.some(r=>r.personId===employee.personId&&r.reserved)&&
   !view.eligibleEmployees.some(r=>r.personId===employee.personId&&
    (r.reserved||r.enrollmentId!==employee.enrollmentId)),
   'CEN_D3_CORPORATE_SEAT_ASSIGNMENT_NOT_AVAILABLE');
 }
 return {confirmed:true,kind,commandId,expectedRegistryDigest:view.registryDigest,
  expectedLicenseDigest:view.licenseEvidenceDigest,
  employeePersonId:assign?employee.personId:null,enrollmentId:assign?employee.enrollmentId:null,
  fromGrantId:release?fromGrantId:null};
}
export function readOriginalSeatChange(result,command,organizationId,workspaceId){
 check(result?.originalReadback===true&&['COMMITTED','ALREADY_COMMITTED'].includes(result.outcome)&&
  result.commandId===command.commandId&&
  (command.kind==='RELEASE'?result.grantId===null:id(result.grantId))&&
  result.releasedGrantId===command.fromGrantId,'CEN_D3_CORPORATE_SEAT_OUTCOME_UNKNOWN');
 return readOriginalSeatView(result.view,organizationId,workspaceId);
}
export function readOriginalSeatPolicy(result,organizationId,workspaceId){
 check(result?.originalReadback===true&&['ENABLED','ALREADY_ENABLED'].includes(result.outcome),
  'CEN_D3_CORPORATE_SEAT_POLICY_OUTCOME_UNKNOWN');
 const view=readOriginalSeatView(result.view,organizationId,workspaceId);
 check(view.seatPolicyReady,'CEN_D3_CORPORATE_SEAT_POLICY_OUTCOME_UNKNOWN');return view;
}

export function readOriginalSeatCommandRecovery(result,command,organizationId,workspaceId){
 check(result?.originalReadback===true&&result.automaticRetryAllowed===false&&
   result.commandId===command.commandId&&['ALREADY_COMMITTED','NOT_COMMITTED','OUTCOME_UNKNOWN'].includes(result.outcome),
   'CEN_D3_CORPORATE_SEAT_OUTCOME_UNKNOWN');
 if(result.outcome==='ALREADY_COMMITTED')
   return {outcome:result.outcome,view:readOriginalSeatChange(result,command,organizationId,workspaceId)};
 check(result.grantId===null&&result.releasedGrantId===null,'CEN_D3_CORPORATE_SEAT_OUTCOME_UNKNOWN');
 const view=readOriginalSeatView(result.view,organizationId,workspaceId);
 check(result.outcome!=='NOT_COMMITTED'||view.registryDigest===command.expectedRegistryDigest,
   'CEN_D3_CORPORATE_SEAT_OUTCOME_UNKNOWN');
 return {outcome:result.outcome,view};
}

// UI continuation only. Never stores a roster, license, proof, assignment,
// or decision. The original owner determines the command outcome.
export function seatIntentKey(organizationId,workspaceId,actorId){
 check([organizationId,workspaceId,actorId].every(id),'CEN_D3_CORPORATE_SEAT_INTENT_SCOPE_INVALID');
 return 'iwxa.center.pending-seat.v1:'+JSON.stringify([organizationId,workspaceId,actorId]);
}
export function validateSeatIntent(v){
 check(v&&Object.keys(v).sort().join(',')==='commandId,confirmed,employeePersonId,enrollmentId,expectedLicenseDigest,expectedRegistryDigest,fromGrantId,kind'&&
  v.confirmed===true&&id(v.commandId)&&sha(v.expectedRegistryDigest)&&
  (v.expectedLicenseDigest===null||sha(v.expectedLicenseDigest))&&
  ['ASSIGN','RELEASE','TRANSFER'].includes(v.kind),'CEN_D3_CORPORATE_SEAT_INTENT_INVALID');
 const assign=v.kind!=='RELEASE',release=v.kind!=='ASSIGN';
 check(assign?(id(v.employeePersonId)&&id(v.enrollmentId)&&sha(v.expectedLicenseDigest)):
  (v.employeePersonId===null&&v.enrollmentId===null),'CEN_D3_CORPORATE_SEAT_INTENT_INVALID');
 check(release?id(v.fromGrantId):v.fromGrantId===null,'CEN_D3_CORPORATE_SEAT_INTENT_INVALID');
 return v;
}
export function readSeatIntent(storage,key){
 const raw=storage.getItem(key);
 return raw===null?null:validateSeatIntent(JSON.parse(raw));
}
export function saveSeatIntent(storage,key,command){
 const v=validateSeatIntent(command);
 check(storage.getItem(key)===null,'CEN_D3_CORPORATE_SEAT_INTENT_ALREADY_PENDING');
 storage.setItem(key,JSON.stringify(v));
 check(JSON.stringify(readSeatIntent(storage,key))===JSON.stringify(v),'CEN_D3_CORPORATE_SEAT_INTENT_NOT_SAVED');
 return v;
}
export function clearSeatIntent(storage,key,command){
 const current=readSeatIntent(storage,key);
 check(current===null||JSON.stringify(current)===JSON.stringify(validateSeatIntent(command)),
  'CEN_D3_CORPORATE_SEAT_INTENT_CHANGED');
 if(current!==null)storage.removeItem(key);
}
