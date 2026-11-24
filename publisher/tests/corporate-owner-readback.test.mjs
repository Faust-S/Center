import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCorporateIssuePreflight as inspect,
  inspectUnknownCorporateMutationReadback as reconcile,
  inspectCorporateRenewalPreflight as renewal,inspectCorporateIssueLineage as lineage}
  from '../src/corporate-owner-readback.mjs';

const requestId='proposal:company:one';
const empty=(overrides={})=>({
 operation:'CORPORATE_INVENTORY',lookupId:requestId,
 matches:0,licenses:[],total:3,truncated:false,
 productionActivation:false,activeSeats:0,...overrides
});
const signed=(overrides={})=>empty({
 matches:1,licenses:[{requestId,licenseId:'license:corporate:one'}],
 ...overrides
});

test('exact original corporate T3 ledger absence permits a guarded first ISSUE',()=>{
 const result=inspect(empty(),requestId);
 assert.deepEqual(result,{state:'NOT_SIGNED',requestId});
 assert.equal(Object.isFrozen(result),true);
 assert.equal(result.licenseId,undefined);
});
test('preexisting original corporate signed request prevents duplicate ISSUE',()=>{
 const result=inspect(signed(),requestId);
 assert.deepEqual(result,{
  state:'ALREADY_SIGNED',requestId,licenseId:'license:corporate:one'
 });
 assert.equal(Object.isFrozen(result),true);
});
test('preflight fails closed on a partial, wrong or ambiguous T3 readback',()=>{
 for(const malformed of [
  empty({lookupId:'proposal:another'}),
  empty({truncated:true}),
  empty({operation:'TEST_INVENTORY'}),
  empty({productionActivation:true}),
  empty({activeSeats:1}),
  empty({matches:2,licenses:[{requestId,licenseId:'l:1'},{requestId,licenseId:'l:2'}]}),
  empty({matches:1,licenses:[]}),
  empty({total:0,matches:1,licenses:[{requestId,licenseId:'l:1'}]}),
  empty({matches:-1}),
  empty({matches:NaN}),
  empty({licenses:{}}),
  signed({licenses:[{requestId:'proposal:other',licenseId:'l:1'}]}),
  signed({licenses:[{requestId,licenseId:'../escape'}]}),
  null
 ]){
  assert.throws(()=>inspect(malformed,requestId),{
   code:malformed?.matches===1&&
     malformed?.licenses?.[0]?.requestId==='proposal:other'
      ?'CORPORATE_PREFLIGHT_SIGNED_SCOPE_INVALID':
     malformed?.matches===1&&malformed?.licenses?.[0]?.licenseId==='../escape'
      ?'CORPORATE_PREFLIGHT_SIGNED_SCOPE_INVALID':
     'CORPORATE_PREFLIGHT_EXACT_ORIGINAL_LEDGER_REQUIRED'
  });
 }
 assert.throws(()=>inspect(empty(),'../escape'),{
  code:'CORPORATE_PREFLIGHT_REQUEST_ID_INVALID'});
});
test('original preflight is read-only and never mints rights',()=>{
 const source=signed(),before=structuredClone(source);
 const result=inspect(source,requestId);
 assert.deepEqual(source,before);
 assert.equal(result.activeSeats,undefined);
 assert.equal(result.issuerAuthorityId,undefined);
 assert.equal(result.signature,undefined);
});

const verified=(o={})=>({
 operation:'CORPORATE_SIGNED_READBACK',requestId,
 licenseId:'license:corporate:one',issuerAuthorityId:'issuer:corporate:one',
 organizationId:'org:company',productId:'IWXA_ADMIN_CENTER',
 tariffId:'TEAM',tariffRevision:2,status:'ACTIVE',sequence:1,
 lineageId:'lineage:one',renewalOf:null,activeSeats:0,productionActivation:false,recipientConfirmed:false,
 ...o
});
const issuePending={kind:'ISSUE',requestId,issuerId:'issuer:corporate:one',
 organizationId:'org:company',tariffId:'TEAM',tariffRevision:2};
const statusPending={kind:'STATUS',requestId,licenseId:'license:corporate:one',
 expectedStatus:'ACTIVE',expectedSequence:1};
test('lost ISSUE receipt reconciles exact original T3 issuer, organization and tariff',()=>{
 assert.deepEqual(reconcile(issuePending,verified()),
  {state:'ORIGINAL_COMMIT_CONFIRMED',
   licenseId:'license:corporate:one',requestId});
 for(const malformed of [
  verified({requestId:'proposal:other'}),
  verified({issuerAuthorityId:'issuer:other'}),
  verified({organizationId:'org:other'}),
  verified({tariffId:'BASIC'}),
  verified({tariffRevision:1}),
  verified({licenseId:'../file'}),
  verified({productId:'IWXA_ATLAS'})
 ]){
  assert.throws(()=>reconcile(issuePending,malformed),/CORPORATE_UNKNOWN_/);
 }
});
test('lost STATUS ACK must not be cleared by stale or unrelated original readback',()=>{
 assert.equal(reconcile(statusPending,verified()).state,'ORIGINAL_COMMIT_CONFIRMED');
 for(const malformed of [
  verified({sequence:0,status:'NOT_ACTIVATED'}),
  verified({sequence:2}),
  verified({status:'SUSPENDED'}),
  verified({licenseId:'license:another'}),
  verified({requestId:'proposal:other'})
 ]){
  assert.throws(()=>reconcile(statusPending,malformed),/CORPORATE_UNKNOWN_/);
 }
 assert.throws(()=>reconcile({...statusPending,kind:'MISSING'},verified()),
  {code:'CORPORATE_UNKNOWN_OPERATION_INVALID'});
 assert.throws(()=>reconcile(null,verified()),/CORPORATE_UNKNOWN_/);
});

test('renewal must resolve the signed predecessor in the exact issuer organization scope',()=>{
 const scope={priorRequestId:requestId,issuerId:'issuer:corporate:one',organizationId:'org:company'};
 const prior=renewal(signed(),verified(),scope);
 assert.deepEqual(prior,{licenseId:'license:corporate:one',lineageId:'lineage:one'});
 assert.equal(Object.isFrozen(prior),true);
 for(const invalid of [verified({status:'REVOKED'}),verified({organizationId:'org:other'}),
  verified({issuerAuthorityId:'issuer:other'}),verified({lineageId:null}),verified({licenseId:'license:other'}),
  verified({activeSeats:1}),verified({productionActivation:true})]){
  assert.throws(()=>renewal(signed(),invalid,scope),/CORPORATE_RENEWAL_/);
 }
 assert.throws(()=>renewal(empty(),verified(),scope),/CORPORATE_RENEWAL_/);
 const successor=verified({licenseId:'license:corporate:two',renewalOf:prior.licenseId});
 assert.equal(lineage(successor,prior),successor);
 for(const invalid of [verified(),{...successor,lineageId:'lineage:other'},
  {...successor,renewalOf:'license:unrelated'}]){
  assert.throws(()=>lineage(invalid,prior),/CORPORATE_ISSUE_LINEAGE_MISMATCH/);
 }
 assert.throws(()=>lineage(successor,null),/CORPORATE_ISSUE_LINEAGE_MISMATCH/);
 assert.equal(reconcile({...issuePending,renewal:prior},successor).state,'ORIGINAL_COMMIT_CONFIRMED');
 assert.throws(()=>reconcile({...issuePending,renewal:prior},verified()),/CORPORATE_ISSUE_LINEAGE_MISMATCH/);
});
