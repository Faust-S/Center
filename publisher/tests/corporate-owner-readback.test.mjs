import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCorporateIssuePreflight as inspect}
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
