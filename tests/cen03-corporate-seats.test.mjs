import test from 'node:test';
import assert from 'node:assert/strict';
import {readOriginalSeatView,prepareOriginalSeatCommand,readOriginalSeatChange,readOriginalSeatPolicy,readOriginalSeatCommandRecovery}
 from '../runtime/cen03-corporate-seats.mjs';
const H='a'.repeat(64),org='org:one',ws='workspace:one';
const member={personId:'person:one',enrollmentId:'enrollment:one'};
const row={grantId:'grant:seat:one',personId:'person:two',enrollmentId:'enrollment:two',
 workGrantId:'grant:work:two',credentialKeyId:'key:two',lineageDigest:H,licenseDigest:H,
 status:'ACTIVE',reserved:true,expiresAt:'2030-01-01T00:00:00.000Z'};
const view=()=>({schema:'IWXA_T3_ORIGINAL_CORPORATE_SEAT_VIEW/1',organizationId:org,workspaceId:ws,
 originalReadback:true,productionActivation:false,registryDigest:H,licenseState:'VERIFIED_CAPACITY_CANDIDATE',
 licenseEvidenceDigest:H,seatPolicyReady:true,withinLimits:true,existingLineageMatches:true,
 reservedSeats:1,independentlyEnrolledEmployees:2,availableSeats:1,seatLimit:2,employeeLimit:5,
 overSeatLimit:0,overEmployeeLimit:0,assignmentTotal:1,assignmentOffset:0,assignmentNextOffset:null,
 eligibleEmployees:[{...member,reserved:false},{personId:row.personId,enrollmentId:row.enrollmentId,reserved:true}],
 employeeTotal:2,employeeOffset:0,employeeNextOffset:null,
 candidate:{licenseId:'license:one',lineageId:'lineage:one',lineageDigest:H,licenseDigest:H,
 seatLimit:2,employeeLimit:5,expiresAt:'2030-01-01T00:00:00.000Z',statusValidUntil:'2029-12-31T00:00:00.000Z'},assignments:[{...row}]});
const read=v=>readOriginalSeatView(v,org,ws);
test('only exact original organization and workspace projection is accepted',()=>{
 assert.equal(read(view()).reservedSeats,1);
 for(const bad of [{workspaceId:'workspace:two'},{organizationId:'org:two'},
  {originalReadback:false},{productionActivation:true},{availableSeats:5},{assignmentTotal:2},
  {registryDigest:'x'},{reservedSeats:0}]){
  assert.throws(()=>read({...view(),...bad}),/READBACK_INVALID/);
 }
});
test('assign and transfer bind exact registry, commercial digest, and enrolled person',()=>{
 const v=read(view());
 const a=prepareOriginalSeatCommand(v,'ASSIGN','seat:one',member);
 assert.deepEqual(a,{confirmed:true,kind:'ASSIGN',commandId:'seat:one',expectedRegistryDigest:H,
  expectedLicenseDigest:H,employeePersonId:member.personId,enrollmentId:member.enrollmentId,fromGrantId:null});
 assert.equal(prepareOriginalSeatCommand(v,'TRANSFER','seat:two',member,row.grantId).fromGrantId,row.grantId);
 assert.throws(()=>prepareOriginalSeatCommand(v,'ASSIGN','seat:one',null),/NOT_AVAILABLE/);
 assert.throws(()=>prepareOriginalSeatCommand(v,'ASSIGN','seat:one',{personId:row.personId,enrollmentId:row.enrollmentId}),/NOT_AVAILABLE/);
 assert.throws(()=>prepareOriginalSeatCommand(v,'TRANSFER','seat:one',member,'grant:other'),/SOURCE_REQUIRED/);
});
test('release remains available without an active license and no new employee identity is sent',()=>{
 const v=read({...view(),licenseState:'LICENSE_SOURCE_UNAVAILABLE',licenseEvidenceDigest:null,
  candidate:null,availableSeats:0,seatLimit:null,employeeLimit:null,overSeatLimit:null,overEmployeeLimit:null,
  withinLimits:false,existingLineageMatches:false});
 const r=prepareOriginalSeatCommand(v,'RELEASE','seat:release',member,row.grantId);
 assert.equal(r.employeePersonId,null);assert.equal(r.enrollmentId,null);assert.equal(r.expectedLicenseDigest,null);
 assert.throws(()=>prepareOriginalSeatCommand(v,'ASSIGN','seat:a',member),/NOT_AVAILABLE/);
});
test('policy and seat results require exact native receipt; unknown cannot be marked committed',()=>{
 const v=read(view()),a=prepareOriginalSeatCommand(v,'ASSIGN','seat:one',member);
 const receipt={originalReadback:true,outcome:'COMMITTED',commandId:a.commandId,
  grantId:'grant:seat:new',releasedGrantId:null,view:v};
 assert.equal(readOriginalSeatChange(receipt,a,org,ws),v);
 assert.throws(()=>readOriginalSeatChange({...receipt,commandId:'seat:other'},a,org,ws),/OUTCOME_UNKNOWN/);
 assert.throws(()=>readOriginalSeatChange({...receipt,originalReadback:false},a,org,ws),/OUTCOME_UNKNOWN/);
 assert.equal(readOriginalSeatPolicy({originalReadback:true,outcome:'ENABLED',view:v},org,ws),v);
 assert.throws(()=>readOriginalSeatPolicy({originalReadback:true,outcome:'ENABLED',
  view:{...v,seatPolicyReady:false,availableSeats:0}},org,ws),/OUTCOME_UNKNOWN/);
});
test('old policy, over-capacity and non-reserved history cannot authorize new assignment',()=>{
 const v=read({...view(),seatPolicyReady:false,availableSeats:0});
 assert.throws(()=>prepareOriginalSeatCommand(v,'ASSIGN','seat:a',member),/NOT_AVAILABLE/);
 const over=read({...view(),candidate:{...view().candidate,seatLimit:0},seatLimit:0,
  overSeatLimit:1,withinLimits:false,availableSeats:0});
 assert.throws(()=>prepareOriginalSeatCommand(over,'TRANSFER','seat:a',member,row.grantId),/NOT_AVAILABLE/);
 assert.equal(prepareOriginalSeatCommand(over,'RELEASE','seat:r',null,row.grantId).fromGrantId,row.grantId);
});

test('verified roster selection and uncertain command recovery require exact original scope',()=>{
 const v=read(view()),a=prepareOriginalSeatCommand(v,'ASSIGN','seat:recovery',member);
 assert.throws(()=>read({...view(),eligibleEmployees:[{...member,reserved:true},{personId:row.personId,enrollmentId:row.enrollmentId,reserved:true}]}),/READBACK_INVALID/);
 assert.throws(()=>prepareOriginalSeatCommand(v,'ASSIGN','seat:bad',{...member,enrollmentId:'enrollment:wrong'}),/NOT_AVAILABLE/);
 const recovered={outcome:'ALREADY_COMMITTED',commandId:a.commandId,originalReadback:true,
  automaticRetryAllowed:false,grantId:'grant:seat:received',releasedGrantId:null,view:v};
 assert.equal(readOriginalSeatCommandRecovery(recovered,a,org,ws).outcome,'ALREADY_COMMITTED');
 const absent={...recovered,outcome:'NOT_COMMITTED',grantId:null};
 assert.equal(readOriginalSeatCommandRecovery(absent,a,org,ws).outcome,'NOT_COMMITTED');
 assert.throws(()=>readOriginalSeatCommandRecovery({...absent,view:{...v,registryDigest:'b'.repeat(64)}},a,org,ws),/OUTCOME_UNKNOWN/);
 assert.equal(readOriginalSeatCommandRecovery({...absent,outcome:'OUTCOME_UNKNOWN'},a,org,ws).outcome,'OUTCOME_UNKNOWN');
 assert.throws(()=>readOriginalSeatCommandRecovery({...recovered,automaticRetryAllowed:true},a,org,ws),/OUTCOME_UNKNOWN/);
});
