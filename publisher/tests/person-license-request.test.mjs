import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyPublisherDraft,applyPublisherDraftCommand} from '../src/preparation.mjs';
import {prepareUnsignedPersonLicenseRequest,validateUnsignedPersonLicenseRequest,
  PERSON_REQUEST_SCHEMA} from '../src/person-license-request.mjs';

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
