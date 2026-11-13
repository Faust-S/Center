import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCase002 } from "../src/lib/logistics/case002-data.ts";
import { compareDepotSupply, auditDepotSupply, supplyFingerprint } from "../src/lib/logistics/case002-supply.ts";
import { buildD11BrowserProposal, serializeD11BrowserProposal, validateD11BrowserProposal,
  D11_MAX_BYTES } from "../src/components/tools/d11-transfer.ts";

test("CASE-002 end-to-end output survives existing D11 T2 proposal contract unaltered", () => {
  const input = createCase002();
  const comparison = compareDepotSupply(input);
  const data = { caseId: "D11-CASE-002", input,
    inputFingerprint: supplyFingerprint(input), comparison };
  const proposal = buildD11BrowserProposal({
    toolId: "delivery-network-planner", toolTitle: "CASE-002: снабжение ремонтных парков",
    markdown: "# CASE-002\n\nРемонтные задания, фактические рейсы и склад",
    data,
  }, "2026-11-13T00:00:00.000Z");
  const serialized = serializeD11BrowserProposal(proposal);
  assert.ok(Buffer.byteLength(serialized, "utf8") <= D11_MAX_BYTES);
  const restored = validateD11BrowserProposal(JSON.parse(serialized));
  assert.deepEqual(restored, proposal);
  assert.equal(restored.result.data.caseId, "D11-CASE-002");
  assert.deepEqual(auditDepotSupply(input, restored.result.data.comparison.advance), []);
  assert.deepEqual(auditDepotSupply(input, restored.result.data.comparison.reactive), []);
  assert.deepEqual(restored.result.data.input, input);
});

test("CASE-002 page is a registered public route with live domain model", () => {
  const read = p => readFileSync(new URL("../" + p, import.meta.url),"utf8");
  assert.match(read("src/site-routes.ts"), /\/tools\/depot-maintenance-supply\//);
  assert.match(read("src/routes/tools.index.tsx"), /\/tools\/depot-maintenance-supply/);
  const page = read("src/routes/tools.depot-maintenance-supply.tsx");
  assert.match(page, /compareDepotSupply\(input\)/);
  assert.match(page, /auditDepotSupply\(input/);
  assert.match(page, /D11ProposalExport/);
  assert.match(page, /buildD11BrowserProposal/);
  assert.doesNotMatch(page, /indexedDB|localStorage\.setItem|putObject\(/);
});
