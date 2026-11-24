import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectCorporateEnrollment,inspectCorporateCapabilities,
 inspectCorporatePinnedTrust,inspectCorporateRead,inspectCorporateReceived}
 from '../runtime/cen04-corporate-receipt.mjs';
import {parseCorporateDeliveryHandoff,matchesCorporateDeliveryReceipt} from '../runtime/cen04-corporate-carrier.mjs';
const ORG='org:company',SHA='a'.repeat(64),STORED='b'.repeat(64);
const base=(operation,rest={})=>({
 schema:'IWXA_T3_CORPORATE_CONSUMER_NATIVE_RECEIPT/1',operation,
 activeSeats:0,assignablePersonalAgentSeats:0,productionActivation:false,
 ...rest
});
const enrolled=()=>base('CORPORATE_ENROLLED',{
 organizationId:ORG,fingerprint:SHA,intakeConfigured:true,
 publicOnly:true,recipientConfirmed:false,
 trustOrigin:'HOST_PREINSTALLED_PUBLIC_POLICY'
});
const caps=()=>base('CORPORATE_CAPABILITIES',{
 organizationId:ORG,productId:'IWXA_ADMIN_CENTER',intakeConfigured:true,
 fingerprint:SHA,recipientConfirmed:false,trustOrigin:'HOST_PREINSTALLED_PUBLIC_POLICY'
});
const received=()=>base('CORPORATE_RECEIVE',{
 organizationId:ORG,productId:'IWXA_ADMIN_CENTER',
 licenseId:'license:company',requestId:'request:company',
 issuerAuthorityId:'publisher:original',tariffId:'TEAM',tariffRevision:2,
 status:'ACTIVE',sequence:3,revision:4,outcome:'ALREADY_RECEIVED',
 packageSha256:SHA,storedPackageSha256:STORED,
 trustOrigin:'HOST_PREINSTALLED_PUBLIC_POLICY',
 signatureVerified:true,statusVerified:true,statusFloorVerified:true,
 signedLicenseAccepted:true,recipientConfirmed:true,
 originalHolderReceiptRequired:true,holderApplied:false
});
const view=()=>base('CORPORATE_READ',{view:{
 schema:'IWXA_T3_CORPORATE_PRODUCT_LICENSE_CONSUMER_VIEW/1',
 organizationId:ORG,productId:'IWXA_ADMIN_CENTER',
 revision:4,trustOrigin:'HOST_PREINSTALLED_PUBLIC_POLICY',
 activeSeats:0,assignablePersonalAgentSeats:0,productionActivation:false,
 licenses:[{licenseId:'license:company',requestId:'request:company',
 issuerAuthorityId:'publisher:original',organizationId:ORG,
 productId:'IWXA_ADMIN_CENTER',tariffId:'TEAM',tariffRevision:2,
 status:'STATUS_STALE',sequence:3,current:false,
 signatureVerified:true,statusVerified:true,recipientConfirmed:true,
 originalHolderReceiptRequired:true,activeSeats:0,
 assignablePersonalAgentSeats:0,productionActivation:false}]
}});
test('independent corporate first-use and capabilities never grant rights',()=>{
 assert.equal(inspectCorporateEnrollment(enrolled(),ORG,SHA).intakeConfigured,true);
 assert.equal(inspectCorporateCapabilities(caps(),ORG).intakeConfigured,true);
 for(const change of [
  {recipientConfirmed:true},{publicOnly:false},
  {activeSeats:1},{productionActivation:true},
  {trustOrigin:'IWXA_ENVELOPE'}
 ])assert.throws(()=>inspectCorporateEnrollment({...enrolled(),...change},ORG,SHA),
  /CEN04_CORPORATE_ORIGINAL_T3_RECEIPT_REQUIRED/);
 assert.throws(()=>inspectCorporateEnrollment(enrolled(),'org:other',SHA));
 assert.throws(()=>inspectCorporateCapabilities({...caps(),organizationId:'org:other'},ORG));
});
test('after a lost corporate first-use ACK only the same pinned publisher is recoverable',()=>{
 const recorded=inspectCorporatePinnedTrust(caps(),ORG,SHA);
 assert.equal(recorded.intakeConfigured,true);
 assert.equal(recorded.fingerprint,SHA);
 assert.equal(Object.isFrozen(recorded),true);
 for(const evidence of [
   {...caps(),fingerprint:'b'.repeat(64)},
   {...caps(),fingerprint:'INVALID'},
   {...caps(),organizationId:'org:other'},
   {...caps(),trustOrigin:'IWXA_PACKAGE'},
   {...caps(),activeSeats:1}
 ])assert.throws(()=>inspectCorporatePinnedTrust(evidence,ORG,SHA),
   /CEN04_CORPORATE_ORIGINAL_T3_RECEIPT_REQUIRED/);
 assert.throws(()=>inspectCorporatePinnedTrust(caps(),ORG,'b'.repeat(64)));
 assert.throws(()=>inspectCorporatePinnedTrust(caps(),'org:other',SHA));
});
test('source signed receive verifies exact incoming SHA, idempotent carrier and no seats',()=>{
 const evidence=inspectCorporateReceived(received(),ORG,SHA);
 assert.equal(evidence.licenseId,'license:company');
 assert.equal(evidence.outcome,'ALREADY_RECEIVED');
 assert.equal(evidence.packageSha256,SHA);
 assert.equal(evidence.holderApplied,false);
 assert.equal(evidence.assignablePersonalAgentSeats,0);
 assert.equal(Object.isFrozen(evidence),true);
 for(const bad of [
  {operation:'TEST_RECEIVE'}, {organizationId:'org:other'},
  {packageSha256:STORED},{storedPackageSha256:'invalid'},
  {signatureVerified:false},{statusVerified:false},
  {statusFloorVerified:false},{signedLicenseAccepted:false},
  {recipientConfirmed:false},{holderApplied:true},
  {activeSeats:2},{assignablePersonalAgentSeats:1},
  {status:'NOT_SIGNED'},{sequence:0},{revision:0}
 ])assert.throws(()=>inspectCorporateReceived({...received(),...bad},ORG,SHA),
   /CEN04_CORPORATE_ORIGINAL_T3_RECEIPT_REQUIRED/);
});
test('corporate read preserves expired history and rejects forged license row',()=>{
 const historical=inspectCorporateRead(view(),ORG);
 assert.equal(historical.licenses[0].status,'STATUS_STALE');
 assert.equal(historical.licenses[0].current,false);
 assert.equal(historical.activeSeats,0);
 assert.throws(()=>inspectCorporateRead(view(),'org:other'));
 const forged=view();forged.view.licenses[0].recipientConfirmed=false;
 assert.throws(()=>inspectCorporateRead(forged,ORG));
 const duplicate=view();duplicate.view.licenses.push({...duplicate.view.licenses[0]});
 assert.throws(()=>inspectCorporateRead(duplicate,ORG));
 const bypass=view();bypass.view.licenses[0].activeSeats=2;
 assert.throws(()=>inspectCorporateRead(bypass,ORG));
});

const publisherTransfer=()=>({
 licenseId:'license:company',requestId:'request:company',
 issuerAuthorityId:'publisher:original',organizationId:ORG,
 productId:'IWXA_ADMIN_CENTER',tariffId:'TEAM',tariffRevision:2,
 status:'ACTIVE',sequence:3,
 licenseEnvelopeSha256:'c'.repeat(64),statusEnvelopeSha256:'d'.repeat(64),
 packageSha256:SHA,bytes:7312,
 recipientConfirmed:false,assignablePersonalAgentSeats:0
});
test('existing Publisher handoff transfers file evidence and exact signed identity in one paste',()=>{
 const handoff=parseCorporateDeliveryHandoff(JSON.stringify(publisherTransfer()),ORG);
 assert.equal(handoff.packageSha256,SHA);
 assert.equal(handoff.bytes,7312);
 assert.equal(handoff.recipientConfirmed,false);
 assert.equal(Object.isFrozen(handoff),true);
 const native=inspectCorporateReceived(received(),ORG,SHA);
 assert.equal(matchesCorporateDeliveryReceipt(native,handoff),true);
});
test('Publisher handoff is never accepted for another organization or as a grant',()=>{
 const valid=publisherTransfer();
 assert.throws(()=>parseCorporateDeliveryHandoff(JSON.stringify(valid),'org:other'),
  /CEN04_PUBLISHER_HANDOFF_WRONG_ORGANIZATION/);
 for(const change of [{productId:'OTHER'},{status:'NOT_ACTIVATED'},
   {sequence:0},{tariffRevision:0},{recipientConfirmed:true},
   {assignablePersonalAgentSeats:1},{signature:'forged'},
   {packageSha256:'bad'},{bytes:4194305},{licenseEnvelopeSha256:'bad'}]){
  assert.throws(()=>parseCorporateDeliveryHandoff(JSON.stringify({...valid,...change}),ORG));
 }
 for(const raw of ['','not json','[]','null','x'.repeat(8193)])
   assert.throws(()=>parseCorporateDeliveryHandoff(raw,ORG));
});
test('an original T3 receipt cannot be displayed as the exact Publisher transfer if its signed identity differs',()=>{
 const handoff=parseCorporateDeliveryHandoff(JSON.stringify(publisherTransfer()),ORG);
 for(const change of [{licenseId:'license:other'},{requestId:'request:other'},
   {issuerAuthorityId:'publisher:other'},{tariffId:'OTHER'},{tariffRevision:3},
   {status:'SUSPENDED'},{sequence:4}]){
  const native=inspectCorporateReceived({...received(),...change},ORG,SHA);
  assert.equal(matchesCorporateDeliveryReceipt(native,handoff),false);
 }
});
