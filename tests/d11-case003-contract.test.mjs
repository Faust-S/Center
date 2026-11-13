import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createCase003} from "../src/lib/logistics/case003-data.ts";
import {compareNetwork,auditNetwork,networkFingerprint} from "../src/lib/logistics/case003-network.ts";
import {buildD11BrowserProposal,serializeD11BrowserProposal,
  validateD11BrowserProposal,D11_MAX_BYTES} from "../src/components/tools/d11-transfer.ts";

function actualProposal(options){
  const input=createCase003(options);
  const comparison=compareNetwork(input);
  const data={caseId:"D11-CASE-003",input,inputFingerprint:networkFingerprint(input),comparison};
  const proposal=buildD11BrowserProposal({
    toolId:"delivery-network-planner",
    toolTitle:"CASE-003: расширение распределительной сети",
    stage:"Фактические рейсы, SKU и сравнительная экономика рассчитаны",
    markdown:"# CASE-003. Расширение распределительной сети\n\n"+
      "Завершено заказов: "+comparison.regional.deliveredOrders+
      ". Дополнительно своевременно: "+comparison.additionalOnTime,
    data,
  },"2026-11-14T00:00:00.000Z");
  const serialized=serializeD11BrowserProposal(proposal);
  return {input,comparison,proposal,serialized,bytes:Buffer.byteLength(serialized,"utf8")};
}
test("CASE-003 base project fully roundtrips existing D11 Host preview proposal",()=>{
  const {input,comparison,proposal,serialized,bytes}=actualProposal();
  assert.ok(bytes<=D11_MAX_BYTES);
  const recovered=validateD11BrowserProposal(JSON.parse(serialized));
  assert.deepEqual(recovered,proposal);
  assert.equal(recovered.result.data.caseId,"D11-CASE-003");
  assert.deepEqual(recovered.result.data.input,input);
  for(const field of ["baseline","regional"])
    assert.deepEqual(auditNetwork(input,recovered.result.data.comparison[field]),[]);
  assert.equal(recovered.result.data.inputFingerprint,networkFingerprint(input));
  console.log("D11_CASE003_T2_BYTES",bytes);
});
test("stress input remains a complete T2 proposal with actual warehouse and fleet costs",()=>{
  const {input,comparison,serialized,bytes,proposal}=actualProposal({
    demandPercent:150,supplierDelayDays:2,regionalSelection:"north",
    trafficPercent:180,regionalRentRubPerDay:22000,fuelMultiplier:1.6,
  });
  assert.ok(bytes<=D11_MAX_BYTES);
  assert.deepEqual(validateD11BrowserProposal(JSON.parse(serialized)),proposal);
  assert.deepEqual(auditNetwork(input,comparison.baseline),[]);
  assert.deepEqual(auditNetwork(input,comparison.regional),[]);
  console.log("D11_CASE003_PEAK_T2_BYTES",bytes);
});
test("CASE-003 is registered as live interactive site route, not report-only narrative",()=>{
  const read=path=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
  assert.match(read("src/site-routes.ts"),/\/tools\/distribution-network-expansion\//);
  assert.match(read("src/routes/tools.index.tsx"),/\/tools\/distribution-network-expansion/);
  const page=read("src/routes/tools.distribution-network-expansion.tsx");
  assert.match(page,/compareNetwork\(input\)/);
  assert.match(page,/auditNetwork\(input,compared\.regional\)/);
  assert.match(page,/D11ProposalExport/);
  assert.match(page,/buildD11BrowserProposal/);
  assert.match(page,/inTransit/);
  assert.match(page,/inspectedReturns/);
  assert.match(page,/Применить факты отказов/);
  assert.doesNotMatch(page,/indexedDB|localStorage\.setItem|putObject\(/);
});
