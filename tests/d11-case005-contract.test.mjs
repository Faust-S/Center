import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createCase005} from "../src/lib/logistics/case005-data.ts";
import {compareYard,auditYard,yardFingerprint} from "../src/lib/logistics/case005-yard.ts";
import {buildD11BrowserProposal,serializeD11BrowserProposal,
  validateD11BrowserProposal,D11_MAX_BYTES} from "../src/components/tools/d11-transfer.ts";
import {d11CaseEditorPath,d11CaseLineage} from "../runtime/d11-module/editor-source-path.ts";

function make(options={}){
  const input=createCase005(options),comparison=compareYard(input);
  const editor={docks:options.docks??4,staging:options.stagingCapacity??120,
    supplierDelay:options.supplierDelayMinutes??0,demand:options.customerDemandPercent??100,
    traffic:options.trafficPercent??120,inspection:options.inspectionMinutes??10,
    refusedCustomerIds:[],imported:null};
  const proposal=buildD11BrowserProposal({
    toolId:"delivery-network-planner",
    toolTitle:"CASE-005: входящие поставки и кросс-докинг",
    markdown:"# CASE-005\n\nПлан, поставщики, фактические доки и магазинные рейсы",
    data:{caseId:"D11-CASE-005",input,
      inputFingerprint:yardFingerprint(input),_editorState:editor,comparison},
  },"2026-11-14T00:00:00.000Z");
  const wire=serializeD11BrowserProposal(proposal);
  return {input,comparison,proposal,wire,bytes:Buffer.byteLength(wire,"utf8")};
}
test("CASE-005 complete supplier arrivals, 240 retail orders and SKU actuals survive the original D11 T2 browser proposal",()=>{
  const {input,comparison,proposal,wire,bytes}=make();
  assert.ok(bytes<=D11_MAX_BYTES);
  const restored=validateD11BrowserProposal(JSON.parse(wire));
  assert.deepEqual(restored,proposal);
  assert.equal(restored.result.data.caseId,"D11-CASE-005");
  assert.deepEqual(restored.result.data.input,input);
  assert.deepEqual(auditYard(input,restored.result.data.comparison.traditional),[]);
  assert.deepEqual(auditYard(input,restored.result.data.comparison.crossdock),[]);
  assert.deepEqual(restored.result.data.comparison,comparison);
  console.log("D11_CASE005_T2_BYTES",bytes);
});
test("overloaded yard still transfers entire physical queue and inspection journal without truncation",()=>{
  const {input,comparison,proposal,wire,bytes}=make({
    docks:2,stagingCapacity:80,supplierDelayMinutes:240,
    customerDemandPercent:150,trafficPercent:150,
  });
  assert.ok(bytes<=D11_MAX_BYTES);
  assert.deepEqual(validateD11BrowserProposal(JSON.parse(wire)),proposal);
  assert.deepEqual(auditYard(input,comparison.crossdock),[]);
  assert.ok(comparison.crossdock.postponedTrucks>0);
  console.log("D11_CASE005_PEAK_T2_BYTES",bytes);
});
test("existing T2 approved editor resolver chooses CASE-005 original tool, not transport CASE-001",()=>{
  const {proposal}=make();
  assert.equal(d11CaseLineage(proposal),"D11-CASE-005");
  assert.equal(d11CaseEditorPath(proposal),"/tools/inbound-yard-crossdock");
  const changed=structuredClone(proposal);
  changed.result.data.caseId="D11-CASE-004";
  assert.equal(d11CaseEditorPath(changed),"/tools/cold-chain-control");
  changed.result.data.caseId="D11-CASE-001";
  assert.equal(d11CaseEditorPath(changed),null);
});
test("CASE-005 web route is actually registered and contains T2, operational dock and SKU components",()=>{
  const read=(p)=>readFileSync(new URL("../"+p,import.meta.url),"utf8");
  const route=read("src/routes/tools.inbound-yard-crossdock.tsx");
  assert.match(read("src/site-routes.ts"),/\/tools\/inbound-yard-crossdock\//);
  assert.match(read("src/routes/tools.index.tsx"),/\/tools\/inbound-yard-crossdock/);
  assert.match(read("src/components/tools/useToolDraft.ts"),
    /"inbound-yard-crossdock": "delivery-network-planner"/);
  assert.match(route,/compareYard\(input\)/);
  assert.match(route,/auditYard\(input,comparison\.crossdock\)/);
  assert.match(route,/dayResult\.dockBlocks/);
  assert.match(route,/row\.receivedSameDay/);
  assert.match(route,/D11ProposalExport/);
  assert.match(route,/buildD11BrowserProposal/);
  assert.doesNotMatch(route,/putObject\(|indexedDB|localStorage\.setItem/);
});
