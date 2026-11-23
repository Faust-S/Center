import test from 'node:test';
import assert from 'node:assert/strict';
import {checkCorporateCarrierExpectation as expectFile,
 checkCorporateCarrierMatch as check} from '../runtime/cen04-corporate-carrier.mjs';

const expected={organizationId:'org:north',sha256:'a'.repeat(64),bytes:7312};
const receipt=(override={})=>({
 operation:'CORPORATE_CARRIER_SHA256_MATCHED',
 organizationId:'org:north',productId:'IWXA_ADMIN_CENTER',
 packageSha256:'a'.repeat(64),bytes:7312,
 signatureVerified:false,statusVerified:false,recipientConfirmed:false,
 productionActivation:false,activeSeats:0,assignablePersonalAgentSeats:0,
 ...override
});

test('preflight accepts only a real organization and exact Publisher SHA and size',()=>{
 assert.deepEqual(expectFile(expected),expected);
 assert.equal(Object.isFrozen(expectFile(expected)),true);
 for(const change of [
  {organizationId:'../outside'}, {sha256:'A'.repeat(64)},
  {sha256:'almost'}, {bytes:0}, {bytes:4*1024*1024+1},
  {bytes:1.5}, {bytes:NaN}, {bytes:Infinity}
 ]){
  assert.throws(()=>expectFile({...expected,...change}),
   /CEN04_CORPORATE_(ORGANIZATION|SHA256|BYTES)_REQUIRED/);
 }
});

test('a matching file hash is a read-only transport observation, never a license',()=>{
 const input=receipt(),before=structuredClone(input);
 const matched=check(input,expected);
 assert.deepEqual(matched,{
  organizationId:expected.organizationId,
  packageSha256:expected.sha256,bytes:expected.bytes,
  signedLicenseAccepted:false,assignablePersonalAgentSeats:0
 });
 assert.deepEqual(input,before);
 assert.equal(Object.isFrozen(matched),true);
 assert.equal(Object.hasOwn(matched,'licenseId'),false);
});

test('wrong organization, file, size or forged T3 authority fail closed',()=>{
 for(const change of [
  {organizationId:'org:south'}, {operation:'CORPORATE_RECEIVE'},
  {productId:'IWXA_ATLAS'}, {packageSha256:'b'.repeat(64)},
  {bytes:7313}, {signatureVerified:true}, {statusVerified:true},
  {recipientConfirmed:true}, {productionActivation:true},
  {activeSeats:1}, {assignablePersonalAgentSeats:1},
  {licenseId:'license:spoof'}, {trustedIssuer:'publisher:spoof'},
  {entitlement:{personalAgentSeats:10}}
 ]){
  assert.throws(()=>check(receipt(change),expected),
   /CEN04_CORPORATE_FILE_ONLY_RECEIPT_REQUIRED/);
 }
 assert.throws(()=>check(null,expected),
   /CEN04_CORPORATE_FILE_ONLY_RECEIPT_REQUIRED/);
});
