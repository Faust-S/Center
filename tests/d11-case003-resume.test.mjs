import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {d11CaseEditorPath,d11CaseLineage} from "../runtime/d11-module/editor-source-path.ts";
import {createCase003} from "../src/lib/logistics/case003-data.ts";
import {compareNetwork,networkFingerprint} from "../src/lib/logistics/case003-network.ts";
import {buildD11BrowserProposal,validateD11BrowserProposal,
  serializeD11BrowserProposal} from "../src/components/tools/d11-transfer.ts";

const proposal = (caseId,fields={})=>({
  producer:{toolId:"delivery-network-planner"},
  result:{data:{caseId,...fields}},
});
test("saved CASE-003 always resumes its own original tool route, not CASE-001",()=>{
  assert.equal(d11CaseEditorPath(proposal("D11-CASE-003")),
    "/tools/distribution-network-expansion");
  assert.equal(d11CaseEditorPath(proposal("D11-CASE-002")),
    "/tools/depot-maintenance-supply");
  assert.equal(d11CaseEditorPath(proposal("D11-CASE-001")),null);
  assert.equal(d11CaseEditorPath(proposal("/tools/../../evil")),null);
  assert.equal(d11CaseEditorPath({producer:{toolId:"as-is-to-be-process"},result:{
    data:{caseId:"D11-CASE-003"}}}),null);
  assert.notEqual(d11CaseLineage(proposal("D11-CASE-003")),
    d11CaseLineage(proposal("D11-CASE-002")));
});
test("exact network draft and its large source project fit the real T2 preview envelope",()=>{
  const input=createCase003({supplierDelayDays:2,demandPercent:150});
  const options={
    demand:150,rent:7000,region:"both",delay:2,traffic:120,fuel:1,capitalRate:24,
    imported:input,appliedRefusals:[],appliedTransfers:[],
  };
  const data={caseId:"D11-CASE-003",input,inputFingerprint:networkFingerprint(input),
    _editorState:options,comparison:compareNetwork(input)};
  const packet=buildD11BrowserProposal({
    toolId:"delivery-network-planner",toolTitle:"CASE-003: расширение распределительной сети",
    markdown:"# CASE-003. Распределение",data,
  },"2026-11-14T00:00:00.000Z");
  const restored=validateD11BrowserProposal(JSON.parse(serializeD11BrowserProposal(packet)));
  assert.deepEqual(restored.result.data._editorState,options);
  assert.equal(d11CaseEditorPath(restored),"/tools/distribution-network-expansion");
  assert.deepEqual(restored.result.data.input,input);
});
test("CASE-003 is bound to the native T2 resume lifecycle, with separate draft namespace",()=>{
  const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
  const page=read("src/routes/tools.distribution-network-expansion.tsx");
  const hook=read("src/components/tools/useToolDraft.ts");
  const workspace=read("runtime/d11-module/D11WorkspaceCard.tsx");
  const viewer=read("runtime/d11-module/D11ProposalViewer.tsx");
  assert.match(page,/useToolDraft\("distribution-network-expansion",INITIAL_DRAFT\)/);
  assert.match(page,/_editorState:draft/);
  assert.match(hook,/"distribution-network-expansion": "delivery-network-planner"/);
  assert.match(workspace,/d11CaseEditorPath\(opened\.proposal\)/);
  assert.match(workspace,/d11CaseLineage\(proposal\) !== d11CaseLineage\(binding\.source\.proposal\)/);
  assert.match(viewer,/d11CaseEditorPath\(proposal\)/);
});
