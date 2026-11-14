import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCase004 } from "../src/lib/logistics/case004-data.ts";
import { compareCold, auditCold, coldFingerprint } from "../src/lib/logistics/case004-coldchain.ts";
import { buildD11BrowserProposal, serializeD11BrowserProposal,
  validateD11BrowserProposal, D11_MAX_BYTES } from "../src/components/tools/d11-transfer.ts";
import { d11CaseEditorPath, d11CaseLineage } from "../runtime/d11-module/editor-source-path.ts";

function preview(options={}){
  const input=createCase004(options);
  const comparison=compareCold(input);
  const state={demand:100,traffic:120,faults:"both",gap:"none",
    fleet:4,storage:100,refusedOrderIds:[],imported:null};
  const payload={
    toolId:"delivery-network-planner",
    toolTitle:"CASE-004: контроль холодовой цепи",
    markdown:"# CASE-004. Температурный контроль\nВходные термограммы и факт рейсов.",
    data:{caseId:"D11-CASE-004",input,
      inputFingerprint:coldFingerprint(input),_editorState:state,comparison},
  };
  const proposal=buildD11BrowserProposal(payload,"2026-11-14T09:00:00.000Z");
  const wire=serializeD11BrowserProposal(proposal);
  return {proposal,wire,input,comparison,bytes:Buffer.byteLength(wire,"utf8")};
}
test("CASE-004 full actual thermologger and stock journal roundtrips native D11 preview",()=>{
  const {proposal,wire,input,comparison,bytes}=preview();
  assert.ok(bytes<=D11_MAX_BYTES,"entire per-order result must fit original contract");
  const restored=validateD11BrowserProposal(JSON.parse(wire));
  assert.deepEqual(restored,proposal);
  assert.deepEqual(restored.result.data.input,input);
  assert.equal(restored.result.data.caseId,"D11-CASE-004");
  for(const scenario of [comparison.uncontrolled,comparison.protected]){
    assert.deepEqual(auditCold(input,scenario),[]);
    assert.equal(scenario.days.length,8);
  }
  console.log("D11_CASE004_T2_BYTES",bytes);
});
test("peak traffic and cooling failure are kept as executable evidence inside full T2 proposal",()=>{
  const {proposal,wire,input,comparison,bytes}=preview({
    demandPercent:150,trafficPercent:150,coolingFleetSize:2,
    coldStoragePercent:75,faults:"both",
  });
  assert.ok(bytes<=D11_MAX_BYTES);
  assert.deepEqual(validateD11BrowserProposal(JSON.parse(wire)),proposal);
  assert.equal(comparison.protected.days.length,input.days.length);
  assert.equal(input.loggers.length,input.days.length*input.fleet.length);
  assert.deepEqual(auditCold(input,comparison.protected),[]);
  console.log("D11_CASE004_PEAK_T2_BYTES",bytes);
});
test("D11 existing editor resolver resumes original CASE-004 rather than CASE-001",()=>{
  const {proposal}=preview();
  assert.equal(d11CaseLineage(proposal),"D11-CASE-004");
  assert.equal(d11CaseEditorPath(proposal),"/tools/cold-chain-control");
  const replaced=structuredClone(proposal);
  replaced.result.data.caseId="D11-CASE-003";
  assert.equal(d11CaseEditorPath(replaced),"/tools/distribution-network-expansion");
  replaced.result.data.caseId="D11-CASE-002";
  assert.equal(d11CaseEditorPath(replaced),"/tools/depot-maintenance-supply");
  replaced.result.data.caseId="D11-CASE-001";
  assert.equal(d11CaseEditorPath(replaced),null);
});
test("CASE-004 is real site route with live order events, QA decisions and supported T2 resume",()=>{
  const read=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
  const page=read("src/routes/tools.cold-chain-control.tsx");
  assert.match(read("src/site-routes.ts"),/\/tools\/cold-chain-control\//);
  assert.match(read("src/routes/tools.index.tsx"),/\/tools\/cold-chain-control/);
  assert.match(page,/compareCold\(input\)/);
  assert.match(page,/auditCold\(input,comparison\.protected\)/);
  assert.match(page,/D11ProposalExport/);
  assert.match(page,/buildD11BrowserProposal/);
  assert.match(page,/quality-hold/);
  assert.match(page,/pendingInspection/);
  const hook=read("src/components/tools/useToolDraft.ts");
  assert.match(hook,/"cold-chain-control": "delivery-network-planner"/);
  assert.match(hook,/cold-chain-control"\]\.includes\(toolId\)/);
  assert.doesNotMatch(page,/putObject\(|indexedDB|localStorage\.setItem/);
});
