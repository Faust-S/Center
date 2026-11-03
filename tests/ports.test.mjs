import test from 'node:test';
import assert from 'node:assert/strict';
import {createDraftRepository} from '../runtime/t3-draft-repository.mjs';
import {createT3AdminPort} from '../runtime/t3-admin-port.mjs';
import {emptyDraft} from '../src/organization.mjs';
// Explicit contract doubles: these tests do not qualify signatures, T3 or native persistence.
function storeDouble() {let revision=0, bytes=null;return {read:()=>({revision,bytes}),write(expected,data){if(expected!==revision)throw Error('SUBJECT_CONCURRENT_REVISION');bytes=Buffer.from(data);return {revision:++revision};},close(){}};}
test('repository delegates commit and obtains same bytes on readback',()=>{const repo=createDraftRepository(storeDouble()),data=emptyDraft('2026-11-04T00:00:00Z');const saved=repo.save(data,0);assert.equal(saved.revision,1);assert.deepEqual(repo.load().draft,data);assert.throws(()=>repo.save(data,0),/CONCURRENT_REVISION/);});
test('failed write never reports persisted success',()=>{const repo=createDraftRepository({read:()=>({revision:0,bytes:null}),write(){throw Error('disk full');}});assert.throws(()=>repo.save(emptyDraft(),0),/disk full/);});
test('readback mismatch is visible',()=>{const repo=createDraftRepository({read:()=>({revision:0,bytes:null}),write:()=>({revision:1})});assert.throws(()=>repo.save(emptyDraft(),0),/READBACK_MISMATCH/);});
function runtimeDouble() {const calls=[];const state={organizationId:'org',workspaceId:'work',contextEpoch:1,personId:'person'};return {product:'admin',snapshot:()=>structuredClone(state),calls,state,decide(...args){calls.push(args);return {acceptanceState:'ACCEPTED'};},receive(){return {packageSha256:'abc'};},review(hash){return {hash,acceptanceState:'PENDING'};},previewApplication(args){return {args,writeAllowed:false};}};}
const binding={organizationId:'org',workspaceId:'work',contextEpoch:1};
test('acceptance uses owning runtime and does not imply application',()=>{const runtime=runtimeDouble(),port=createT3AdminPort(runtime);const r=port.decide({packageSha256:'abc',previewDigest:'preview',decision:'ACCEPT',binding});assert.equal(r.acceptanceState,'ACCEPTED');assert.equal(runtime.calls.length,1);assert.deepEqual(runtime.calls[0],['abc',{previewDigest:'preview',decision:'ACCEPT',reason:''}]);assert.equal(r.applied,undefined);});
test('context switch prevents a stale decision',()=>{const runtime=runtimeDouble(),port=createT3AdminPort(runtime);runtime.state.contextEpoch++;assert.throws(()=>port.decide({decision:'ACCEPT',binding}),/CONTEXT_CHANGED/);assert.equal(runtime.calls.length,0);});
test('return for changes is not silently substituted with rejection',()=>{const runtime=runtimeDouble(),port=createT3AdminPort(runtime);assert.throws(()=>port.decide({decision:'CHANGES_REQUESTED',binding}),/RETURN_OPERATION_NOT_AVAILABLE/);assert.equal(runtime.calls.length,0);});
test('inspection does not perform acceptance',()=>{const runtime=runtimeDouble();assert.equal(createT3AdminPort(runtime).inspect({bytes:Buffer.from('synthetic'),binding}).acceptanceState,'PENDING');assert.equal(runtime.calls.length,0);});
test('wrong runtime cannot be bound',()=>assert.throws(()=>createT3AdminPort({product:'control'}),/ADMIN_RUNTIME_REQUIRED/));
