import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyPublisherDraft,applyPublisherDraftCommand,encodePublisherDraft}
 from '../src/preparation.mjs';
import {CORPORATE_OFFER_REVIEW_SCHEMA,prepareCorporateOfferReview as prepare,
  projectCorporateOfferReviews as project,
  projectCorporateSigningOffers as signing} from '../src/corporate-offer-review.mjs';

const quota={metric:'CLOUD_TOKENS',service:'CLOUD',unit:'TOKENS',period:'MONTH',max:150000};
function fixture({productSeats=5,employeeLimit=10}={}){
 let state=emptyPublisherDraft();
 state=applyPublisherDraftCommand(state,{kind:'addProduct',
   id:'IWXA_ADMIN_CENTER',name:'IWXA Admin Center',version:'0.5.0'});
 state=applyPublisherDraftCommand(state,{kind:'addHolder',
   id:'org:company',name:'Example Company',type:'ORGANIZATION'});
 state=applyPublisherDraftCommand(state,{kind:'addTariff',
   id:'TEAM',name:'Organization',revision:1,productId:'IWXA_ADMIN_CENTER',
   holderType:'ORGANIZATION',features:['CORPORATE_WORKSPACE'],
   termDays:365,productSeats,employeeLimit,deviceLimit:0,quotas:[quota]});
 state=applyPublisherDraftCommand(state,{kind:'addTariffProposal',
   tariffId:'TEAM',revision:1,productId:'IWXA_ADMIN_CENTER',holderId:'org:company'});
 return state;
}
test('corporate review binds exact Admin Center organization, tariff, features and quotas',()=>{
 const draft=fixture(),before=encodePublisherDraft(draft);
 const result=prepare(draft,{proposalId:draft.proposals[0].id});
 assert.equal(result.schema,CORPORATE_OFFER_REVIEW_SCHEMA);
 assert.equal(result.status,'LOCAL_PREPARATION_NOT_SIGNED');
 assert.equal(result.organization.type,'ORGANIZATION');
 assert.equal(result.organization.id,'org:company');
 assert.deepEqual(result.product,{id:'IWXA_ADMIN_CENTER',version:'0.5.0'});
 assert.deepEqual(result.tariff,{id:'TEAM',name:'Organization',revision:1});
 assert.deepEqual(result.featureIds,['CORPORATE_WORKSPACE']);
 assert.equal(result.termDays,365);
 assert.equal(result.limits.adminCenterProductSeats,5);
 assert.equal(result.limits.employeeLimit,10);
 assert.deepEqual(result.limits.quotas,[{...quota,enforcement:'ONLINE_SERVICE_REQUIRED'}]);
 assert.equal(encodePublisherDraft(draft),before,'Read-only review cannot change saved source');
});
test('neither Admin Center product places nor employee limit become personal-agent seats',()=>{
 const draft=fixture({productSeats:999,employeeLimit:1000});
 const result=prepare(draft,{proposalId:draft.proposals[0].id});
 assert.equal(result.limits.personalAgentSeats,null);
 assert.equal(result.coverage.personalAgentSeatPool,'NOT_DEFINED_BY_THIS_TARIFF');
 assert.equal(result.coverage.employeeLimitIsAgentSeatPool,false);
 assert.equal(result.coverage.adminCenterSeatsAreAgentSeats,false);
 assert.equal(result.coverage.organizationLicenseProfile,'PRODUCTION_ORIGINAL_T3_REQUIRED');
 assert.equal(result.coverage.signedTariffIdAndRevision,false);
 assert.equal(result.coverage.originalPublisherAuthorityRead,false);
 assert.equal(result.coverage.installedAdminCenterReceiptRead,false);
 assert.equal(result.signedCorporateLicense,false);
 assert.equal(result.verifiedCorporateEntitlement,false);
 assert.equal(result.assignablePersonalAgentSeats,0);
 assert.equal(result.authorizedToAllocate,false);
});
test('only corporate tariff proposals on IWXA_ADMIN_CENTER are previewed',()=>{
 let draft=fixture();
 draft=applyPublisherDraftCommand(draft,{kind:'addProduct',
   id:'IWXA_PERSONAL_AGENT',name:'Personal Agent',version:'0.6.0'});
 draft=applyPublisherDraftCommand(draft,{kind:'addTariff',id:'TEAM',
   name:'Unrelated',revision:1,productId:'IWXA_PERSONAL_AGENT',
   holderType:'ORGANIZATION',features:['WORKSPACE'],termDays:180,
   productSeats:2,employeeLimit:8,deviceLimit:0,quotas:[]});
 draft=applyPublisherDraftCommand(draft,{kind:'addTariffProposal',tariffId:'TEAM',
   revision:1,productId:'IWXA_PERSONAL_AGENT',holderId:'org:company'});
 const org=project(draft);
 assert.equal(org.total,1);
 assert.equal(org.shown,1);
 assert.equal(org.items[0].product.id,'IWXA_ADMIN_CENTER');
 assert.throws(()=>prepare(draft,{proposalId:draft.proposals[1].id}),{
   code:'CORPORATE_OFFER_ADMIN_CENTER_ORGANIZATION_REQUIRED'});
 assert.throws(()=>prepare(draft,{proposalId:'missing'}),{
   code:'CORPORATE_OFFER_PROPOSAL_NOT_FOUND'});
 assert.throws(()=>project(draft,{limit:0}),{
   code:'CORPORATE_OFFER_PREVIEW_LIMIT_INVALID'});
});
test('legacy no-tariff TEST requests cannot manufacture a corporate commercial review',()=>{
 let draft=fixture();
 draft=applyPublisherDraftCommand(draft,{kind:'addProposal',
   productId:'IWXA_ADMIN_CENTER',holderId:'org:company',
   features:['CORPORATE_WORKSPACE'],termDays:30});
 assert.equal(project(draft).total,1);
 assert.throws(()=>prepare(draft,{proposalId:draft.proposals[1].id}),{
   code:'CORPORATE_OFFER_SIGNED_TARIFF_SOURCE_REQUIRED'});
});
test('local review preserves followup lineage without claiming signed renewal',()=>{
 let draft=fixture();
 draft=applyPublisherDraftCommand(draft,{kind:'prepareFollowupProposal',
   previousProposalId:draft.proposals[0].id,
   productId:'IWXA_ADMIN_CENTER',tariffId:'TEAM',revision:1});
 const latest=project(draft);
 assert.equal(latest.total,2);
 assert.equal(latest.items[0].priorPreparationId,draft.proposals[0].id);
 assert.equal(latest.items[0].signedCorporateLicense,false);
 assert.equal(latest.assignablePersonalAgentSeats,0);
});

test('focused older corporate preparation is selectable even beyond last 20',()=>{
 let draft=fixture();
 const originalId=draft.proposals[0].id;
 for(let i=0;i<23;i++)
  draft=applyPublisherDraftCommand(draft,{kind:'addTariffProposal',
   tariffId:'TEAM',revision:1,productId:'IWXA_ADMIN_CENTER',
   holderId:'org:company'});
 const original=encodePublisherDraft(draft);
 const recent=project(draft,{limit:20});
 assert.equal(recent.total,24);
 assert.ok(!recent.items.some(x=>x.proposalId===originalId));
 const focused=signing(draft,{focusProposalId:originalId});
 assert.equal(focused.total,24);
 assert.equal(focused.shown,21);
 assert.equal(focused.truncated,true);
 assert.equal(focused.items[0].proposalId,originalId);
 assert.equal(new Set(focused.items.map(x=>x.proposalId)).size,21);
 assert.equal(focused.items[0].status,'LOCAL_PREPARATION_NOT_SIGNED');
 assert.equal(focused.items[0].signedCorporateLicense,false);
 assert.equal(encodePublisherDraft(draft),original,
  'A focused link must not change any source or stored entitlement');
 const absent=signing(draft,{focusProposalId:'missing'});
 assert.deepEqual(absent.items,recent.items);
});
