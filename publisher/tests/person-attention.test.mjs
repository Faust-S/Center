import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectPublisherPersonOwnerInventory as inspect,
  projectPublisherPersonAttention as project} from '../src/person-attention.mjs';

const now=Date.parse('2026-11-22T12:00:00.000Z');
const hex='a'.repeat(64);
const record=(overrides={})=>({
  licenseId:'license:person:one',requestId:'proposal:one',
  issuerAuthorityId:'publisher:person:one',personId:'person:one',
  productId:'IWXA_ATLAS',requestDigest:hex,sequence:2,
  activeSeats:0,deviceLimit:2,quotaCount:1,
  issuedAt:'2026-11-01T00:00:00.000Z',
  notBefore:'2026-11-01T00:00:00.000Z',
  expiresAt:'2026-12-01T00:00:00.000Z',
  status:'ACTIVE',statusIssuedAt:'2026-11-22T00:00:00.000Z',
  statusValidUntil:'2026-11-25T00:00:00.000Z',
  ...overrides
});
const inventory=(rows=[record()],overrides={})=>({
  operation:'PERSON_INVENTORY',productionActivation:false,activeSeats:0,
  licenses:rows,total:rows.length,truncated:false,...overrides
});
test('PERSON issuer overview reads original owner ledger without claiming delivery or active seats',()=>{
  const before=inventory(),serialized=JSON.stringify(before);
  assert.equal(inspect(before).length,1);
  const out=project(before,{now});
  assert.equal(out.source,'ORIGINAL_T3_ISSUER_INVENTORY_ONLY');
  assert.equal(out.total,1);
  assert.equal(out.attentionInShown,0);
  assert.equal(out.recipientConfirmed,false);
  assert.equal(out.productionActivation,false);
  assert.equal(out.activeSeats,0);
  assert.equal(JSON.stringify(before),serialized);
});
test('PERSON attention prioritizes expiry, unactivated, suspended, revoked and stale STATUS',()=>{
  const cases=[
    {status:'REVOKED',priority:1, title:/Отзыв/},
    {expiresAt:'2026-11-22T10:00:00.000Z',priority:2,title:/Срок лицензии завершился/},
    {status:'NOT_ACTIVATED',statusIssuedAt:undefined,statusValidUntil:undefined,priority:3,title:/без подписанного STATUS/},
    {status:'SUSPENDED',priority:4,title:/Приостановление/},
    {statusValidUntil:'2026-11-22T11:00:00.000Z',priority:5,title:/STATUS устарел/},
    {expiresAt:'2026-11-26T00:00:00.000Z',statusValidUntil:'2026-11-25T00:00:00.000Z',priority:6,title:/7 дней/},
    {statusValidUntil:'2026-11-22T14:00:00.000Z',priority:7,title:/обновления STATUS/}
  ];
  const rows=cases.map(({priority,title,...patch},i)=>record({
    licenseId:'license:person:'+i,...patch
  }));
  const result=project(inventory(rows),{now});
  assert.deepEqual(result.items.map(x=>x.priority),cases.map(x=>x.priority));
  for(let i=0;i<cases.length;i++)
    assert.match(result.items[i].title,cases[i].title);
});
test('truncated owner search never reports complete coverage',()=>{
  const out=project(inventory([record()],{total:103,truncated:true}),{now});
  assert.equal(out.shown,1);assert.equal(out.total,103);
  assert.equal(out.truncated,true);
  assert.equal(out.attentionInShown,0);
});
test('unknown, forged or malformed ledger cannot become action summary',()=>{
  const bad=[
    {operation:'TEST_INVENTORY'},
    {productionActivation:true},
    {activeSeats:1},
    {total:0},
    {truncated:'false'},
    {licenses:[record(),record()]},
    {licenses:[record({requestDigest:'forged'})]},
    {licenses:[record({status:'ACTIVATED'})]},
    {licenses:[record({status:'ACTIVE',statusIssuedAt:undefined})]},
    {licenses:[record({statusValidUntil:'2027-01-01T00:00:00.000Z'})]},
    {licenses:[record({licenseId:42})]},
    {licenses:[record({productId:'IWXA_ADMIN_CENTER'})]}
  ];
  for(const patch of bad)
    assert.throws(()=>project(inventory([record()],patch),{now}),
      /PUBLISHER_ATTENTION_ORIGINAL_/);
  assert.throws(()=>project(inventory(),{now:Number.NaN}),
    /PUBLISHER_ATTENTION_TIME_INVALID/);
});
