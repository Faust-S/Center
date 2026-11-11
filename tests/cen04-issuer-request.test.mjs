import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareAdminPublisherTestRequest} from '../runtime/cen04-issuer-request.mjs';
import {decodeTestLicenseRequest} from '../publisher/src/test-license-request.mjs';
const org={id:'org:demo-001',name:'North Workshop',kind:'ORGANIZATION'};
const fixed={organization:org,requestId:'request:admin:demo-001',
  requestedAt:'2026-11-11T12:00:00.000Z',seats:3,termDays:45,version:'0.3.0'};
test('Admin Center request is the existing unsigned Publisher TEST request, not a new format',()=>{
  const result=prepareAdminPublisherTestRequest(fixed);
  const parsed=decodeTestLicenseRequest(result.content);
  assert.deepEqual(parsed,result.request);
  assert.equal(parsed.schema,'IWXA_PUBLISHER_TEST_LICENSE_REQUEST/1');
  assert.equal(parsed.subject.id,org.id);
  assert.equal(parsed.product.id,'IWXA_ADMIN_CENTER');
  assert.deepEqual(parsed.featureIds,['WORKSPACE']);
  assert.equal(parsed.seats,3);
  assert.equal(parsed.termDays,45);
  assert.match(result.suggestedFileName,/^iwxa-test-license-request-.*\.json$/);
  for(const field of ['licenseId','issuerAuthorityId','signature','activeSeats','productionActivation'])
    assert.equal(Object.hasOwn(parsed,field),false);
});
test('organization draft is not a signed issuer or implicit legal organization',()=>{
  // Organizational TEST recipients may be teams, not only legal entities.
  const group=prepareAdminPublisherTestRequest({...fixed,organization:{...org,kind:'GROUP'}});
  assert.equal(group.request.subject.type,'ORGANIZATION');
  assert.equal(group.request.subject.id,org.id);
  assert.throws(()=>prepareAdminPublisherTestRequest({
    ...fixed,organization:{...org,kind:'PERSON'}}),/CEN04_PUBLISHER_ORGANIZATIONAL_DRAFT_REQUIRED/);
  assert.throws(()=>prepareAdminPublisherTestRequest({
    ...fixed,organization:{...org,id:'holder:placeholder'}}),/TEST_REQUEST_SUBJECT_INVALID/);
  assert.throws(()=>prepareAdminPublisherTestRequest({...fixed,seats:0}),/TEST_REQUEST_SEATS_INVALID/);
  assert.throws(()=>prepareAdminPublisherTestRequest({...fixed,featureIds:[]}),/TEST_REQUEST_FEATURES_INVALID/);
  assert.throws(()=>prepareAdminPublisherTestRequest({...fixed,version:'invalid'}),/TEST_REQUEST_PRODUCT_INVALID/);
});
test('second request is independently identified; no original proposal/store is modified',()=>{
  const source=structuredClone(org);
  const first=prepareAdminPublisherTestRequest(fixed);
  const second=prepareAdminPublisherTestRequest({...fixed,requestId:'request:admin:demo-002'});
  assert.notEqual(first.request.requestId,second.request.requestId);
  assert.deepEqual(org,source);
  assert.deepEqual(first.request.subject,second.request.subject);
});
