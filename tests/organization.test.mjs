import test from 'node:test';
import assert from 'node:assert/strict';
import {emptyDraft, applyDraftCommand as apply, encodeDraft, decodeDraft, overview, assignmentText} from '../src/organization.mjs';
const time = '2026-11-04T12:00:00.000Z';
function fixture() {
  let sequence = 0, state = emptyDraft(time);
  const run = command => state = apply(state, command, {id: () => `id-${++sequence}`, now: () => time});
  run({type:'CREATE_ORGANIZATION', name:'North group'}); const orgId = state.activeOrganizationId;
  run({type:'ADD_WORKSPACE', organizationId:orgId, name:'Operations'});
  run({type:'ADD_PARTICIPANT', organizationId:orgId, name:'Anna', roleLabel:'Coordinator'});
  run({type:'ADD_PARTICIPANT', organizationId:orgId, name:'Boris', roleLabel:'Reviewer'});
  const org = state.organizations[0];
  const assignment = {type:'SAVE_ASSIGNMENT', organizationId:orgId, title:'Prepare a proposal', workspaceId:org.workspaces[0].id,
    assigneeId:org.participants[0].id, reviewerId:org.participants[1].id, criteria:'Three alternatives', description:'Compare suppliers', dueDate:'2026-11-10'};
  return {run, assignment, get state() {return state;}, orgId};
}
test('starts empty, no seeded people or authority', () => {const s=emptyDraft(time); assert.equal(s.organizations.length,0); assert.equal(overview(s).accepted,null);});
test('zero, one and multiple participants are valid', () => {let s=apply(emptyDraft(time),{type:'CREATE_ORGANIZATION',name:'One'},{id:()=> 'org'});assert.equal(s.organizations[0].participants.length,0);s=apply(s,{type:'ADD_PARTICIPANT',organizationId:'org',name:'Person'},{id:()=> 'person'});assert.equal(s.organizations[0].participants.length,1);assert.equal(s.organizations[0].participants[0].credentialState,'NOT_ENROLLED');});
test('two independent drafts for the same person', () => {const f=fixture(); f.run(f.assignment); f.run({...f.assignment,title:'Second'});const a=f.state.organizations[0].assignments;assert.equal(a.length,2);assert.equal(a[0].assigneeId,a[1].assigneeId);assert.notEqual(a[0].id,a[1].id);});
test('draft edits retain id but cannot overwrite concurrent edit', () => {const f=fixture();f.run(f.assignment);const a=f.state.organizations[0].assignments[0];f.run({...f.assignment,assignmentId:a.id,expectedEditNumber:1,title:'Updated'});assert.equal(f.state.organizations[0].assignments[0].editNumber,2);assert.throws(()=>f.run({...f.assignment,assignmentId:a.id,expectedEditNumber:1}),/DRAFT_EDIT_CONFLICT/);});
test('switching org invalidates old command context', () => {const f=fixture(); f.run({type:'CREATE_ORGANIZATION',name:'South'});assert.throws(()=>f.run(f.assignment),/ORGANIZATION_CONTEXT_CHANGED/);assert.equal(f.state.organizations[1].assignments.length,0);});
test('foreign workspace or person is rejected', () => {const f=fixture();assert.throws(()=>f.run({...f.assignment,workspaceId:'foreign'}),/WORKSPACE_NOT_FOUND/);assert.throws(()=>f.run({...f.assignment,assigneeId:'foreign'}),/ASSIGNEE_NOT_FOUND/);});
test('draft snapshot roundtrip retains Unicode, ids and editor metadata', () => {const f=fixture();f.run({...f.assignment,title:'\u041f\u043e\u0440\u0443\u0447\u0435\u043d\u0438\u0435 \ud83c\udf0d'});assert.deepEqual(decodeDraft(encodeDraft(f.state)),f.state);});
test('corrupt snapshot is not an empty organization', () => {assert.throws(()=>decodeDraft('{broken'),/DRAFT_JSON_INVALID/);assert.throws(()=>decodeDraft('{"format":"other"}'),/DRAFT_FORMAT_INVALID/);});
test('draft file cannot claim issued credentials or accepted result', () => {const f=fixture();f.run(f.assignment);const s=structuredClone(f.state);s.organizations[0].assignments[0].status='ACCEPTED';assert.throws(()=>decodeDraft(JSON.stringify(s)),/DRAFT_AUTHORITY_CLAIM_DENIED/);s.organizations[0].assignments[0].status='DRAFT';s.organizations[0].participants[0].credentialState='ACTIVE';assert.throws(()=>decodeDraft(JSON.stringify(s)),/DRAFT_CREDENTIAL_CLAIM_DENIED/);});
test('format for existing T3 task preserves criteria and recipient', () => {const f=fixture();f.run(f.assignment);const org=f.state.organizations[0];const s=assignmentText(org,org.assignments[0]);assert.match(s,/Three alternatives/);assert.match(s,/Anna/);assert.match(s,/Boris/);assert.match(s,/2026-11-10/);});
test('blank fields and invalid date are rejected', () => {const f=fixture();assert.throws(()=>f.run({...f.assignment,title:'  '}),/TITLE_REQUIRED/);assert.throws(()=>f.run({...f.assignment,dueDate:'2026-02-30'}),/DUE_DATE_INVALID/);});
test('pure command never mutates old state on success or failure', () => {const f=fixture();const before=encodeDraft(f.state);const old=f.state;f.run(f.assignment);assert.equal(encodeDraft(old),before);const next=encodeDraft(f.state);assert.throws(()=>f.run({...f.assignment,priority:'invalid'}));assert.equal(encodeDraft(f.state),next);});

test('manager plans Personal Agent access without issuing a license or a grant', () => {
  const f=fixture(), person=f.state.organizations[0].participants[0];
  f.run({type:'PLAN_PERSONAL_AGENT_ACCESS',organizationId:f.orgId,participantId:person.id,plan:'PLANNED'});
  const updated=f.state.organizations[0].participants[0];
  assert.equal(updated.personalAgentPlan,'PLANNED');
  assert.equal(updated.credentialState,'NOT_ENROLLED');
  assert.equal('licenseId' in updated,false);
  assert.equal('entitlement' in updated,false);
  assert.throws(()=>f.run({type:'PLAN_PERSONAL_AGENT_ACCESS',organizationId:f.orgId,participantId:person.id,plan:'ACTIVE'}),/AGENT_SEAT_PLAN_INVALID/);
  assert.equal(f.state.organizations[0].participants[0].personalAgentPlan,'PLANNED');
  f.run({type:'PLAN_PERSONAL_AGENT_ACCESS',organizationId:f.orgId,participantId:person.id,plan:'NONE'});
  assert.equal(f.state.organizations[0].participants[0].personalAgentPlan,'NONE');
});

test('Atlas plan link follows exact project revision and survives manager draft roundtrip', () => {
  const f=fixture(), workspace=f.state.organizations[0].workspaces[0];
  f.run({type:'LINK_ATLAS_WORKSPACE',organizationId:f.orgId,workspaceId:workspace.id,
    atlasRef:{projectId:'atlas:project-42',revision:'revision-1'}});
  const link=f.state.organizations[0].workspaces[0].atlasRef;
  f.run({...f.assignment,atlasRef:link});
  f.run({type:'LINK_ATLAS_WORKSPACE',organizationId:f.orgId,workspaceId:workspace.id,
    atlasRef:{projectId:'atlas:project-42',revision:'revision-2'}});
  assert.equal(f.state.organizations[0].assignments[0].atlasRef.revision,'revision-1');
  assert.equal(f.state.organizations[0].workspaces[0].atlasRef.revision,'revision-2');
  assert.deepEqual(decodeDraft(encodeDraft(f.state)),f.state);
  const org=f.state.organizations[0];
  assert.match(assignmentText(org,org.assignments[0]),/atlas:project-42 @ revision-1/);
  assert.throws(()=>f.run({type:'LINK_ATLAS_WORKSPACE',organizationId:f.orgId,workspaceId:workspace.id,atlasRef:{projectId:'',revision:'revision-3'}}),/ATLAS_REFERENCE_INVALID/);
});

test('Atlas and license plans cannot be edited across organizational contexts', () => {
  const f=fixture(),org=f.state.organizations[0],person=org.participants[0],workspace=org.workspaces[0];
  f.run({type:'CREATE_ORGANIZATION',name:'Second'});
  assert.throws(()=>f.run({type:'LINK_ATLAS_WORKSPACE',organizationId:f.orgId,workspaceId:workspace.id,atlasRef:null}),/ORGANIZATION_CONTEXT_CHANGED/);
  assert.throws(()=>f.run({type:'PLAN_PERSONAL_AGENT_ACCESS',organizationId:f.orgId,participantId:person.id,plan:'PLANNED'}),/ORGANIZATION_CONTEXT_CHANGED/);
});

test('older manager draft without Agent and Atlas fields still loads', () => {
  const f=fixture(), old=structuredClone(f.state);
  for(const p of old.organizations[0].participants)delete p.personalAgentPlan;
  for(const w of old.organizations[0].workspaces)delete w.atlasRef;
  assert.deepEqual(decodeDraft(JSON.stringify(old)),old);
});
