import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyPublisherDraft,applyPublisherDraftCommand} from '../src/preparation.mjs';
import {prepareUnsignedPersonLicenseRequest,validateUnsignedPersonLicenseRequest,
  PERSON_REQUEST_SCHEMA,preparePersonRenewalDraftCommand,
  validatePersonRenewalSource} from '../src/person-license-request.mjs';

const quota={metric:'tokenBudget',service:'CLOUD',unit:'TOKENS',period:'MONTH',max:25000};
function fixture(productId='IWXA_ATLAS'){
 let s=emptyPublisherDraft();
 s=applyPublisherDraftCommand(s,{kind:'addProduct',id:productId,name:'Installed product',version:'0.5.0'});
 s=applyPublisherDraftCommand(s,{kind:'addHolder',id:'person:valid:one',
   name:'Example person',type:'PERSON'});
 s=applyPublisherDraftCommand(s,{kind:'addTariff',id:'PERSONAL',productId,
   name:'Personal',holderType:'PERSON',revision:1,features:['WORKSPACE'],
   termDays:30,productSeats:1,employeeLimit:0,deviceLimit:2,quotas:[quota]});
 s=applyPublisherDraftCommand(s,{kind:'addTariffProposal',tariffId:'PERSONAL',
   revision:1,productId,holderId:'person:valid:one'});
 return s;
}
test('PERSON proposal preserves device, quota, source version, subject and identity',()=>{
 const draft=fixture(),before=JSON.stringify(draft),proposalId=draft.proposals[0].id;
 const r=prepareUnsignedPersonLicenseRequest(draft,{proposalId});
 assert.equal(r.schema,PERSON_REQUEST_SCHEMA);assert.equal(r.environment,'PRODUCTION');
 assert.equal(r.kind,'PERSON_LICENSE_REQUEST');assert.equal(r.status,'UNSIGNED_REQUEST');
 assert.equal(r.subject.type,'PERSON');assert.equal(r.subject.id,'person:valid:one');
 assert.equal(r.product.id,'IWXA_ATLAS');assert.equal(r.product.version,'0.5.0');
 assert.equal(r.seats,1);assert.equal(r.deviceLimit,2);
 assert.deepEqual(r.quotas,[quota]);assert.deepEqual(r.featureIds,['WORKSPACE']);
 assert.equal(r.requestId,proposalId);assert.equal(JSON.stringify(draft),before);
 assert.ok(!('privateKey' in r)&&!('issuerAuthorityId' in r)&&!('signature' in r));
 assert.deepEqual(validateUnsignedPersonLicenseRequest(r),r);
});
test('PERSON contract also supports Personal Agent without altering Atlas scope',()=>{
 const draft=fixture('IWXA_PERSONAL_AGENT');
 const request=prepareUnsignedPersonLicenseRequest(draft,{proposalId:draft.proposals[0].id});
 assert.equal(request.product.id,'IWXA_PERSONAL_AGENT');
 assert.equal(request.productionActivation,undefined);
});
test('existing legacy PERSON drafts do not silently become signed requests',()=>{
 let draft=fixture();
 draft=applyPublisherDraftCommand(draft,{kind:'addProposal',productId:'IWXA_ATLAS',
   holderId:'person:valid:one',features:['WORKSPACE'],termDays:30});
 assert.throws(()=>prepareUnsignedPersonLicenseRequest(draft,{
   proposalId:draft.proposals[1].id}),{code:'PERSON_REQUEST_SIGNED_SOURCE_NOT_READY'});
});
test('organization, other product, fake person id and missing features fail closed',()=>{
 const draft=fixture(),r=prepareUnsignedPersonLicenseRequest(draft,{
   proposalId:draft.proposals[0].id});
 for(const changed of [
  {...r,environment:'TEST'}, {...r,status:'ISSUED'},
  {...r,subject:{type:'ORGANIZATION',id:r.subject.id,name:r.subject.name}},
  {...r,subject:{...r.subject,id:'holder:fake'}},
  {...r,product:{...r.product,id:'IWXA_ADMIN_CENTER'}},
  {...r,featureIds:[]}, {...r,deviceLimit:0}, {...r,seats:2},
  {...r,signature:'forged'}, {...r,issuerAuthorityId:'publisher:fake'}
 ])assert.throws(()=>validateUnsignedPersonLicenseRequest(changed));
});
test('tampered quota limits, duplicated quotas and mismatched edition are rejected',()=>{
 const draft=fixture(),r=prepareUnsignedPersonLicenseRequest(draft,{
   proposalId:draft.proposals[0].id});
 for(const changed of [
  {...r,quotas:[{...quota,max:-1}]},
  {...r,quotas:[quota,quota]},
  {...r,quotas:[{...quota,unit:'USD'}]},
  {...r,termDays:3660}
 ])assert.throws(()=>validateUnsignedPersonLicenseRequest(changed));
 const wrong=structuredClone(draft);
 wrong.proposals[0].tariffSnapshot.deviceLimit=99;
 assert.throws(()=>prepareUnsignedPersonLicenseRequest(wrong,{
   proposalId:wrong.proposals[0].id}));
});


test('PERSON renewal produces a fresh unsigned followup without changing issued source',()=>{
 const before=fixture(),previous=before.proposals[0];
 const signed={licenseId:'license:issued:one',requestId:previous.id,
   issuerAuthorityId:'publisher:fixture',personId:'person:valid:one',
   productId:'IWXA_ATLAS',deviceLimit:2,quotaCount:1,
   status:'ACTIVE',sequence:1,activeSeats:0};
 const command=preparePersonRenewalDraftCommand(before,{sourceLicense:signed,
   issuerAuthorityId:signed.issuerAuthorityId,tariffId:'PERSONAL',
   revision:1,issuedRecords:[signed]});
 assert.deepEqual(command,{kind:'prepareFollowupProposal',
   previousProposalId:previous.id,productId:'IWXA_ATLAS',
   tariffId:'PERSONAL',revision:1});
 const after=applyPublisherDraftCommand(before,command);
 assert.deepEqual(after.proposals[0],previous);
 assert.notEqual(after.proposals[1].id,previous.id);
 assert.equal(after.proposals[1].previousProposalId,previous.id);
 const fresh=prepareUnsignedPersonLicenseRequest(after,{proposalId:after.proposals[1].id});
 assert.equal(fresh.subject.id,signed.personId);
 assert.equal(fresh.product.id,signed.productId);
 assert.equal(fresh.requestId,after.proposals[1].id);
 assert.equal(fresh.renewalOfRequestId,previous.id);
 assert.equal(fresh.status,'UNSIGNED_REQUEST');
 assert.equal(fresh.seats,1);
 assert.throws(()=>preparePersonRenewalDraftCommand(after,{sourceLicense:signed,
   issuerAuthorityId:signed.issuerAuthorityId,tariffId:'PERSONAL',
   revision:1,issuedRecords:[signed]}),{code:'PERSON_RENEWAL_FOLLOWUP_ALREADY_EXISTS'});
});
test('forged PERSON renewal linkage cannot be mixed into an independent request',()=>{
 const draft=fixture(),original=prepareUnsignedPersonLicenseRequest(draft,{
   proposalId:draft.proposals[0].id});
 assert.equal(Object.hasOwn(original,'renewalOfRequestId'),false);
 assert.throws(()=>validateUnsignedPersonLicenseRequest({
   ...original,renewalOfRequestId:original.requestId
 }),{code:'PERSON_RENEWAL_SOURCE_REQUEST_INVALID'});
 assert.throws(()=>validateUnsignedPersonLicenseRequest({
   ...original,renewalOfRequestId:'holder:bad',signature:'forged'
 }));
});

test('PERSON renewal requires signed native source, exact identity, approved tariff and issuer',()=>{
 const state=fixture(),p=state.proposals[0];
 const signed={licenseId:'license:one',requestId:p.id,
   issuerAuthorityId:'publisher:real',personId:'person:valid:one',
   productId:'IWXA_ATLAS',deviceLimit:2,quotaCount:1,
   status:'ACTIVE',sequence:1,activeSeats:0};
 const plan=(sourceLicense=signed,issuerAuthorityId='publisher:real')=>
   preparePersonRenewalDraftCommand(state,{sourceLicense,issuerAuthorityId,
     tariffId:'PERSONAL',revision:1,issuedRecords:[signed]});
 for(const bad of [
   {...signed,status:'REVOKED'}, {...signed,status:'NOT_ACTIVATED'},
   {...signed,sequence:0}, {...signed,activeSeats:1}
 ])assert.throws(()=>plan(bad),{code:'PERSON_RENEWAL_SIGNED_SOURCE_REQUIRED'});
 assert.throws(()=>plan(signed,'publisher:other'),
   {code:'PERSON_RENEWAL_SIGNED_SOURCE_REQUIRED'});
 for(const bad of [
   {...signed,personId:'person:other'},
   {...signed,productId:'IWXA_PERSONAL_AGENT'},
   {...signed,deviceLimit:3},
   {...signed,quotaCount:3}
 ])assert.throws(()=>plan(bad),{code:'PERSON_RENEWAL_SOURCE_BINDING_MISMATCH'});
 assert.throws(()=>plan({...signed,licenseId:'license:invented'}),
   {code:'PERSON_RENEWAL_NATIVE_INVENTORY_REQUIRED'});
 assert.throws(()=>preparePersonRenewalDraftCommand(state,{sourceLicense:signed,
   issuerAuthorityId:'publisher:real',tariffId:'UNKNOWN',revision:1,
   issuedRecords:[signed]}),{code:'PERSON_RENEWAL_TARIFF_SCOPE_MISMATCH'});
 assert.deepEqual(validatePersonRenewalSource(state,{sourceLicense:signed,
   issuerAuthorityId:'publisher:real'}),{
     proposalId:p.id,personId:'person:valid:one',productId:'IWXA_ATLAS',
     issuerAuthorityId:'publisher:real'});
});
