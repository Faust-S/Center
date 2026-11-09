import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyPublisherDraft,applyPublisherDraftCommand,encodePublisherDraft,decodePublisherDraft}
  from '../src/preparation.mjs';
import {OFFLINE_PLAN_PREVIEW_SCHEMA,prepareOfflineLicensePlanPreview}
  from '../src/offline-license-plan.mjs';

const source=()=>{
  let state=emptyPublisherDraft();
  state=applyPublisherDraftCommand(state,{kind:'addProduct',id:'IWXA_PERSONAL_AGENT',
    name:'IWXA Personal Agent',version:'0.4.0'});
  state=applyPublisherDraftCommand(state,{kind:'addHolder',id:'org:alpha',
    name:'Example organization',type:'ORGANIZATION'});
  state=applyPublisherDraftCommand(state,{kind:'addHolder',id:'person:local-1',
    name:'Personal license holder',type:'PERSON'});
  return state;
};
const input=(holderId)=>({
  holderId,productId:'IWXA_PERSONAL_AGENT',tariffCode:'PERSONAL_PRO',
  features:['LOCAL_MODELS','WORKSPACES'],termDays:365,
  productSeats:1,employeeLimit:0,deviceLimit:2,
  quotas:[{metric:'LOCAL_PROJECTS',service:'LOCAL',unit:'COUNT',period:'TOTAL',max:50},
    {metric:'CLOUD_MODEL_TOKENS',service:'CLOUD',unit:'TOKENS',period:'MONTH',max:100000}]
});

test('personal offline license preview bypasses Admin Center but grants no rights',()=>{
  const before=source();
  const previous=encodePublisherDraft(before);
  const preview=prepareOfflineLicensePlanPreview(before,input('person:local-1'));
  assert.equal(preview.schema,OFFLINE_PLAN_PREVIEW_SCHEMA);
  assert.equal(preview.entitlementRoute,'PERSON_DIRECT_IN_PRODUCT');
  assert.equal(preview.installationBinding,'PERSON_INSTALLATION_PROOF_REQUIRED');
  assert.equal(preview.limits.productSeats,1);
  assert.equal(preview.limits.employees,0);
  assert.equal(preview.limits.devices,2);
  assert.equal(preview.limits.quotas[0].enforcement,'LOCAL_PRODUCT_CHECK');
  assert.equal(preview.limits.quotas[1].enforcement,'ONLINE_SERVICE_REQUIRED');
  assert.equal(preview.status,'UNSIGNED_PREPARATION_ONLY');
  assert.equal(preview.effectiveLicense,false);
  assert.equal(preview.signedDelivery,false);
  assert.equal(preview.productionActivation,false);
  assert.equal(preview.activeSeats,0);
  assert.equal(encodePublisherDraft(before),previous,'preview must not modify saved Publisher drafts');
  assert.ok(!('privateKey' in preview)&&!('signature' in preview));
});

test('organization licensing has distinct seats, employee cap and delegated administration',()=>{
  const offer={...input('org:alpha'),tariffCode:'BUSINESS_START',
    productSeats:30,employeeLimit:50,deviceLimit:0};
  const preview=prepareOfflineLicensePlanPreview(source(),offer);
  assert.equal(preview.entitlementRoute,'ORGANIZATION_ADMIN_CENTER');
  assert.equal(preview.limits.productSeats,30);
  assert.equal(preview.limits.employees,50);
  assert.equal(preview.limits.devices,0);
  assert.equal(preview.subject.type,'ORGANIZATION');
  assert.equal(preview.effectiveLicense,false);
  assert.equal(preview.activeSeats,0);
});

test('PERSON cannot silently create staff delegation, seats or fake an organization',()=>{
  const draft=source(),person=input('person:local-1');
  assert.throws(()=>prepareOfflineLicensePlanPreview(draft,{...person,employeeLimit:5}),
    {code:'OFFLINE_PLAN_PERSON_LIMITS_INVALID'});
  assert.throws(()=>prepareOfflineLicensePlanPreview(draft,{...person,productSeats:3}),
    {code:'OFFLINE_PLAN_PERSON_LIMITS_INVALID'});
  assert.throws(()=>prepareOfflineLicensePlanPreview(draft,{...person,deviceLimit:0}),
    {code:'OFFLINE_PLAN_PERSON_LIMITS_INVALID'});
  assert.throws(()=>prepareOfflineLicensePlanPreview(draft,{...person,subject:{type:'ORGANIZATION'}}),
    {code:'OFFLINE_PLAN_INPUT_FIELDS_INVALID'});
});

test('ORGANIZATION cannot use personal device pool or have zero employees',()=>{
  const org={...input('org:alpha'),tariffCode:'BUSINESS',
    productSeats:20,employeeLimit:100,deviceLimit:0};
  assert.throws(()=>prepareOfflineLicensePlanPreview(source(),{...org,deviceLimit:3}),
    {code:'OFFLINE_PLAN_ORGANIZATION_LIMITS_INVALID'});
  assert.throws(()=>prepareOfflineLicensePlanPreview(source(),{...org,employeeLimit:0}),
    {code:'OFFLINE_PLAN_ORGANIZATION_LIMITS_INVALID'});
});

test('quota validation rejects fake entitlement fields and duplicate resources',()=>{
  const person=input('person:local-1'),draft=source();
  assert.throws(()=>prepareOfflineLicensePlanPreview(draft,{...person,issuerSecret:'x'}),
    {code:'OFFLINE_PLAN_INPUT_FIELDS_INVALID'});
  assert.throws(()=>prepareOfflineLicensePlanPreview(draft,{...person,quotas:[
    person.quotas[0],{...person.quotas[0]}]}),
    {code:'OFFLINE_PLAN_QUOTAS_DUPLICATE'});
  assert.throws(()=>prepareOfflineLicensePlanPreview(draft,{...person,quotas:[
    {...person.quotas[0],max:-1}]}),
    {code:'OFFLINE_PLAN_QUOTA_MAX_INVALID'});
  assert.throws(()=>prepareOfflineLicensePlanPreview(draft,{...person,quotas:[
    {...person.quotas[1],unit:'SERVER_SECRET'}]}),
    {code:'OFFLINE_PLAN_QUOTA_UNIT_INVALID'});
});

test('unchanged Publisher v1 draft roundtrips and invalid references fail',()=>{
  const saved=decodePublisherDraft(encodePublisherDraft(source()));
  assert.equal(saved.holders.length,2);
  assert.equal(saved.products[0].id,'IWXA_PERSONAL_AGENT');
  assert.throws(()=>prepareOfflineLicensePlanPreview(saved,
    {...input('person:missing')}),{code:'OFFLINE_PLAN_REFERENCE_MISSING'});
  assert.throws(()=>prepareOfflineLicensePlanPreview(saved,
    {...input('person:local-1'),productId:'NOT_INSTALLED'}),{code:'OFFLINE_PLAN_REFERENCE_MISSING'});
});

test('one resource metric may have independent local and cloud limits in the same period',()=>{
  const p=input('person:local-1');
  const quotas=[
    {metric:'MODEL_TOKENS',service:'LOCAL',unit:'TOKENS',period:'MONTH',max:100000},
    {metric:'MODEL_TOKENS',service:'CLOUD',unit:'TOKENS',period:'MONTH',max:5000}
  ];
  const preview=prepareOfflineLicensePlanPreview(source(),{...p,quotas});
  assert.equal(preview.limits.quotas.length,2);
  assert.equal(preview.limits.quotas[0].enforcement,'LOCAL_PRODUCT_CHECK');
  assert.equal(preview.limits.quotas[1].enforcement,'ONLINE_SERVICE_REQUIRED');
  assert.deepEqual(preview.limits.quotas.map(v=>v.max),[100000,5000]);
  assert.equal(preview.activeSeats,0);
});
