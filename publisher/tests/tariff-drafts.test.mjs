import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyPublisherDraft,applyPublisherDraftCommand,encodePublisherDraft,decodePublisherDraft} from '../src/preparation.mjs';
import {prepareTestLicenseRequest} from '../src/test-license-request.mjs';
const apply=(s,c)=>applyPublisherDraftCommand(s,c);
function source(){let s=emptyPublisherDraft();s=apply(s,{kind:'addProduct',id:'IWXA_ADMIN_CENTER',name:'Center',version:'0.3.0'});s=apply(s,{kind:'addHolder',id:'org:one',name:'Company',type:'ORGANIZATION'});s=apply(s,{kind:'addHolder',id:'person:one',name:'Person',type:'PERSON'});return s;}
const tariff=(type='ORGANIZATION')=>({kind:'addTariff',id:'PLAN',name:'Plan',productId:'IWXA_ADMIN_CENTER',holderType:type,revision:1,features:['F1'],termDays:365,productSeats:type==='PERSON'?1:10,employeeLimit:type==='PERSON'?0:20,deviceLimit:type==='PERSON'?2:0,quotas:[{metric:'TOKENS',service:'CLOUD',unit:'TOKENS',period:'MONTH',max:100}]});
test('legacy v1 archives remain readable and are upgraded without losing proposals',()=>{let s=source();s=apply(s,{kind:'addProposal',holderId:'org:one',productId:'IWXA_ADMIN_CENTER',features:[],termDays:30});const legacy={...s,version:1};delete legacy.tariffs;const v=decodePublisherDraft(JSON.stringify(legacy));assert.equal(v.version,2);assert.deepEqual(v.proposals,s.proposals);assert.deepEqual(v.tariffs,[]);assert.deepEqual(decodePublisherDraft(encodePublisherDraft(v)),v);});
test('tariff versions create immutable recipient-bound draft snapshots',()=>{let s=apply(source(),tariff());s=apply(s,{kind:'addTariffProposal',tariffId:'PLAN',revision:1,holderId:'org:one'});assert.equal(s.proposals[0].tariffSnapshot.employeeLimit,20);assert.equal(s.proposals[0].status,'DRAFT_NOT_ISSUED');s=apply(s,{...tariff(),revision:2,productSeats:15});s=apply(s,{kind:'addTariffProposal',tariffId:'PLAN',revision:2,holderId:'org:one'});assert.deepEqual(s.proposals.map(p=>p.tariffSnapshot.productSeats),[10,15]);assert.throws(()=>apply(s,tariff()),{code:'DUPLICATE_TARIFF_REVISION'});let person=apply(source(),tariff('PERSON'));person=apply(person,{kind:'addTariffProposal',tariffId:'PLAN',revision:1,holderId:'person:one'});assert.equal(person.proposals[0].tariffSnapshot.deviceLimit,2);assert.throws(()=>apply(person,{kind:'addTariffProposal',tariffId:'PLAN',revision:1,holderId:'org:one'}),{code:'TARIFF_PROPOSAL_HOLDER_MISMATCH'});assert.deepEqual(decodePublisherDraft(encodePublisherDraft(person)),person);});
test('invalid tariff limits, spoofed fields and modified terms fail closed',()=>{let s=source();assert.throws(()=>apply(s,{...tariff(),deviceLimit:1}),{code:'TARIFF_ORGANIZATION_LIMITS_INVALID'});assert.throws(()=>apply(s,{...tariff('PERSON'),productSeats:2}),{code:'TARIFF_PERSON_LIMITS_INVALID'});assert.throws(()=>apply(s,{...tariff(),secret:'key'}),{code:'TARIFF_FIELDS_INVALID'});s=apply(s,tariff());s=apply(s,{kind:'addTariffProposal',tariffId:'PLAN',revision:1,holderId:'org:one'});assert.throws(()=>prepareTestLicenseRequest(s,{proposalId:s.proposals[0].id,seats:11}),{code:'TEST_REQUEST_SEATS_EXCEED_TARIFF'});const bad=structuredClone(s);bad.proposals[0].tariffSnapshot.productSeats=100;assert.throws(()=>decodePublisherDraft(JSON.stringify(bad)),{code:'PROPOSAL_TARIFF_MISMATCH'});});

test('identical tariff codes are independent across products and client types',()=>{
 let s=source();
 s=apply(s,{kind:'addProduct',id:'IWXA_ATLAS',name:'Atlas',version:'0.4.0'});
 s=apply(s,tariff());
 s=apply(s,{...tariff('PERSON'),productId:'IWXA_ATLAS'});
 const restored=decodePublisherDraft(encodePublisherDraft(s));
 assert.equal(restored.tariffs.length,2);
 assert.throws(()=>apply(s,{kind:'addTariffProposal',tariffId:'PLAN',revision:1,holderId:'org:one'}),
   {code:'TARIFF_PROPOSAL_AMBIGUOUS'});
 const org=apply(s,{kind:'addTariffProposal',productId:'IWXA_ADMIN_CENTER',
   tariffId:'PLAN',revision:1,holderId:'org:one'});
 assert.equal(org.proposals[0].tariffSnapshot.productId,'IWXA_ADMIN_CENTER');
 const person=apply(s,{kind:'addTariffProposal',productId:'IWXA_ATLAS',
   tariffId:'PLAN',revision:1,holderId:'person:one'});
 assert.equal(person.proposals[0].tariffSnapshot.productId,'IWXA_ATLAS');
 assert.equal(person.proposals[0].tariffSnapshot.deviceLimit,2);
});
test('tariff-based followup can prepare a new edition without altering original terms',()=>{
 let s=apply(source(),tariff());
 s=apply(s,{kind:'addTariffProposal',productId:'IWXA_ADMIN_CENTER',
   tariffId:'PLAN',revision:1,holderId:'org:one'});
 const original=structuredClone(s.proposals[0]);
 s=apply(s,{...tariff(),revision:2,productSeats:20,termDays:730});
 s=apply(s,{kind:'prepareFollowupProposal',previousProposalId:original.id,
   productId:'IWXA_ADMIN_CENTER',tariffId:'PLAN',revision:2});
 assert.equal(s.proposals.length,2);
 assert.deepEqual(s.proposals[0],original);
 const replacement=s.proposals[1];
 assert.equal(replacement.previousProposalId,original.id);
 assert.equal(replacement.tariffSnapshot.productSeats,20);
 assert.equal(replacement.tariffSnapshot.termDays,730);
 assert.equal(replacement.status,'DRAFT_NOT_ISSUED');
 assert.equal('signature' in replacement,false);
 assert.deepEqual(decodePublisherDraft(encodePublisherDraft(s)),s);
 assert.throws(()=>apply(s,{kind:'removeProposal',id:original.id}),
   {code:'PROPOSAL_HAS_FOLLOWUPS'});
 const deleted=apply(s,{kind:'removeProposal',id:replacement.id});
 assert.equal(deleted.proposals.length,1);
 assert.throws(()=>apply(deleted,{kind:'prepareFollowupProposal',previousProposalId:'missing',
  productId:'IWXA_ADMIN_CENTER',tariffId:'PLAN',revision:2}),
  {code:'PROPOSAL_FOLLOWUP_SOURCE_INVALID'});
});
test('followup rejects cross-product and cross-recipient forgery and cyclic chains',()=>{
 let s=source();
 s=apply(s,{kind:'addProduct',id:'IWXA_ATLAS',name:'Atlas',version:'0.4.0'});
 s=apply(s,tariff());
 s=apply(s,{...tariff('PERSON'),id:'PERSONAL',productId:'IWXA_ATLAS'});
 s=apply(s,{kind:'addTariffProposal',productId:'IWXA_ADMIN_CENTER',
   tariffId:'PLAN',revision:1,holderId:'org:one'});
 assert.throws(()=>apply(s,{kind:'prepareFollowupProposal',previousProposalId:s.proposals[0].id,
   productId:'IWXA_ATLAS',tariffId:'PERSONAL',revision:1}),
   {code:'TARIFF_PROPOSAL_HOLDER_MISMATCH'});
 const repeated=apply(s,{kind:'prepareFollowupProposal',previousProposalId:s.proposals[0].id,
   productId:'IWXA_ADMIN_CENTER',tariffId:'PLAN',revision:1});
 const forged=structuredClone(repeated);
 forged.proposals[1].holderId='person:one';
 assert.throws(()=>decodePublisherDraft(JSON.stringify(forged)),{code:'PROPOSAL_TARIFF_MISMATCH'});
 const cycle=structuredClone(repeated);
 cycle.proposals[0].previousProposalId=cycle.proposals[1].id;
 assert.throws(()=>decodePublisherDraft(JSON.stringify(cycle)),{code:'PROPOSAL_FOLLOWUP_CYCLE'});
 const reordered=structuredClone(repeated);
 reordered.tariffs[0]={revision:reordered.tariffs[0].revision,
   ...Object.fromEntries(Object.entries(reordered.tariffs[0]).filter(([k])=>k!=='revision'))};
 assert.deepEqual(decodePublisherDraft(JSON.stringify(reordered)).proposals,repeated.proposals);
});

test('same metric can have different local/cloud quotas without joining balances',()=>{
 let s=source();
 const limits=[
  {metric:'STORAGE',service:'LOCAL',unit:'GIB',period:'MONTH',max:20},
  {metric:'STORAGE',service:'CLOUD',unit:'GIB',period:'MONTH',max:5}
 ];
 s=apply(s,{...tariff(),quotas:limits});
 s=apply(s,{kind:'addTariffProposal',productId:'IWXA_ADMIN_CENTER',
   tariffId:'PLAN',revision:1,holderId:'org:one'});
 const p=decodePublisherDraft(encodePublisherDraft(s)).proposals[0];
 assert.equal(p.tariffSnapshot.quotas.length,2);
 assert.deepEqual(p.tariffSnapshot.quotas.map(q=>q.max),[20,5]);
 assert.throws(()=>apply(source(),{...tariff(),quotas:[limits[0],{...limits[0],max:30}]}),
  {code:'TARIFF_QUOTA_DUPLICATE'});
});

test('same product, code and edition are independently selectable for organizations and people',()=>{
 let s=source();
 s=apply(s,tariff('ORGANIZATION'));
 s=apply(s,{...tariff('PERSON'),name:'Personal plan'});
 assert.equal(s.tariffs.length,2);
 const org=apply(s,{kind:'addTariffProposal',productId:'IWXA_ADMIN_CENTER',
   tariffId:'PLAN',revision:1,holderId:'org:one'});
 assert.equal(org.proposals[0].tariffSnapshot.holderType,'ORGANIZATION');
 assert.equal(org.proposals[0].tariffSnapshot.productSeats,10);
 assert.equal(org.proposals[0].tariffSnapshot.employeeLimit,20);
 assert.equal(org.proposals[0].tariffSnapshot.deviceLimit,0);
 const person=apply(org,{kind:'addTariffProposal',productId:'IWXA_ADMIN_CENTER',
   tariffId:'PLAN',revision:1,holderId:'person:one'});
 assert.equal(person.proposals[1].tariffSnapshot.holderType,'PERSON');
 assert.equal(person.proposals[1].tariffSnapshot.productSeats,1);
 assert.equal(person.proposals[1].tariffSnapshot.employeeLimit,0);
 assert.equal(person.proposals[1].tariffSnapshot.deviceLimit,2);
 assert.deepEqual(person.proposals.map(p=>p.status),['DRAFT_NOT_ISSUED','DRAFT_NOT_ISSUED']);
 assert.deepEqual(decodePublisherDraft(encodePublisherDraft(person)),person);
 // An unscoped request must still be rejected: never silently pick a product.
 assert.throws(()=>apply(person,{kind:'addTariffProposal',tariffId:'PLAN',
   revision:1,holderId:'org:one'}),{code:'TARIFF_PROPOSAL_AMBIGUOUS'});
});
test('same-code followup chooses the preceding owner type, preserving the old snapshot',()=>{
 let s=apply(source(),tariff());
 s=apply(s,tariff('PERSON'));
 s=apply(s,{kind:'addTariffProposal',productId:'IWXA_ADMIN_CENTER',
   tariffId:'PLAN',revision:1,holderId:'org:one'});
 s=apply(s,{kind:'addTariffProposal',productId:'IWXA_ADMIN_CENTER',
   tariffId:'PLAN',revision:1,holderId:'person:one'});
 const [oldOrg,oldPerson]=structuredClone(s.proposals);
 s=apply(s,{...tariff(),revision:2,productSeats:12});
 s=apply(s,{...tariff('PERSON'),revision:2,deviceLimit:4});
 s=apply(s,{kind:'prepareFollowupProposal',previousProposalId:oldOrg.id,
   productId:'IWXA_ADMIN_CENTER',tariffId:'PLAN',revision:2});
 s=apply(s,{kind:'prepareFollowupProposal',previousProposalId:oldPerson.id,
   productId:'IWXA_ADMIN_CENTER',tariffId:'PLAN',revision:2});
 assert.deepEqual(s.proposals[0],oldOrg);
 assert.deepEqual(s.proposals[1],oldPerson);
 assert.equal(s.proposals[2].tariffSnapshot.productSeats,12);
 assert.equal(s.proposals[2].tariffSnapshot.holderType,'ORGANIZATION');
 assert.equal(s.proposals[3].tariffSnapshot.deviceLimit,4);
 assert.equal(s.proposals[3].tariffSnapshot.holderType,'PERSON');
 assert.equal(s.proposals[2].previousProposalId,oldOrg.id);
 assert.equal(s.proposals[3].previousProposalId,oldPerson.id);
 assert.ok(s.proposals.every(p=>p.status==='DRAFT_NOT_ISSUED'&&!('signature' in p)));
 assert.deepEqual(decodePublisherDraft(encodePublisherDraft(s)),s);
});
