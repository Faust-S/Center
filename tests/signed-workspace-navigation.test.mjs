import test from 'node:test';
import assert from 'node:assert/strict';
import {retainSignedWorkspaceForPage,mayOpenSignedWorkspaceOnPage}
  from '../src/signed-workspace-navigation.mjs';
const A='org:A',B='org:B';
test('D2 manager navigation retains exactly the same original Kernel session',()=>{
 for(const page of ['results','overview','context']){
  assert.equal(retainSignedWorkspaceForPage(page,A,A),true);
  assert.equal(mayOpenSignedWorkspaceOnPage(page,A,A,A),true);
 }
 assert.equal(mayOpenSignedWorkspaceOnPage('overview',A,A,null),false,
  'manager cannot silently open a new signed Host outside Review');
 assert.equal(mayOpenSignedWorkspaceOnPage('results',A,A,null),true,
  'explicit original Review may open and attach the native Host');
});
test('other organization and unrelated pages close original signer, not retain cross-scope',()=>{
 for(const page of ['work','resources','people','programs','data','missing']){
  assert.equal(retainSignedWorkspaceForPage(page,A,A),false);
  assert.equal(mayOpenSignedWorkspaceOnPage(page,A,A,A),false);
 }
 for(const page of ['results','overview','context']){
  assert.equal(retainSignedWorkspaceForPage(page,B,A),false);
  assert.equal(mayOpenSignedWorkspaceOnPage(page,B,A,A),false);
  assert.equal(mayOpenSignedWorkspaceOnPage(page,A,B,A),false);
 }
 assert.equal(retainSignedWorkspaceForPage('overview',null,A),false);
 assert.equal(retainSignedWorkspaceForPage('overview',A,null),false);
 assert.equal(mayOpenSignedWorkspaceOnPage('overview',A,A,B),false);
});
