import test from 'node:test';
import assert from 'node:assert/strict';
import {personOwnerOutcomeLookupId,inspectOriginalPersonMutationReadback as inspect}
  from '../src/person-owner-readback.mjs';

const hash='a'.repeat(64);
const request={requestId:'proposal:one',subject:{id:'person:one'},
  product:{id:'IWXA_ATLAS'},termDays:30,deviceLimit:2,quotas:[{}]};
const license={licenseId:'license:one',requestId:request.requestId,
  issuerAuthorityId:'issuer:one',personId:request.subject.id,
  productId:'IWXA_ATLAS',requestDigest:hash,sequence:0,status:'NOT_ACTIVATED',
  deviceLimit:2,quotaCount:1,activeSeats:0,
  notBefore:'2026-11-16T00:00:00.000Z',expiresAt:'2026-12-16T00:00:00.000Z'};
const issue={kind:'ISSUE',request,issuerAuthorityId:'issuer:one',requestDigest:hash};
const status={kind:'STATUS',license,state:'REVOKED'};
const receipt=(intent,entries=[license],extra={})=>({
  operation:'PERSON_INVENTORY',lookupId:personOwnerOutcomeLookupId(intent),
  productionActivation:false,activeSeats:0,truncated:false,
  matches:entries.length,licenses:entries,...extra
});
test('lost ISSUE ACK needs exact signed request digest and issuer original ledger readback',()=>{
 assert.deepEqual(inspect(issue,receipt(issue)),
   {status:'COMMITTED',licenseId:'license:one',sequence:0});
 assert.equal(inspect(issue,receipt(issue,[])).status,'OUTCOME_UNKNOWN');
 for(const patch of [{requestDigest:'b'.repeat(64)},{issuerAuthorityId:'issuer:other'},
   {personId:'person:other'},{deviceLimit:3},{quotaCount:2},
   {expiresAt:'2026-12-17T00:00:00.000Z'}])
  assert.equal(inspect(issue,receipt(issue,[{...license,...patch}])).status,
    'CONFLICT');
});
test('STATUS readback confirms only next original sequence and exact requested state',()=>{
 assert.deepEqual(inspect(status,receipt(status,[{...license,sequence:1,status:'REVOKED'}])),
   {status:'COMMITTED',licenseId:'license:one',sequence:1});
 assert.equal(inspect(status,receipt(status)).status,'OUTCOME_UNKNOWN');
 for(const patch of [{sequence:1,status:'ACTIVE'},{sequence:2,status:'REVOKED'},
   {sequence:1,status:'REVOKED',personId:'person:other'}])
  assert.equal(inspect(status,receipt(status,[{...license,...patch}])).status,
    'CONFLICT');
});
test('untrusted/ambiguous carrier, stale UI cache or TEST context cannot settle a lost ACK',()=>{
 for(const patch of [{operation:'PERSON_IWXA_EXPORTED'},
   {productionActivation:true},{activeSeats:1},{truncated:true},
   {lookupId:'wrong'},{matches:0,licenses:[license]}])
  assert.throws(()=>inspect(issue,receipt(issue,[license],patch)),
    /PERSON_OUTCOME_ORIGINAL_DURABLE_READBACK_REQUIRED/);
 assert.equal(inspect(issue,receipt(issue,[license],{matches:2})).status,
   'OUTCOME_UNKNOWN');
});
