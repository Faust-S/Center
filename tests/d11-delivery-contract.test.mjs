import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createCase001 } from "../src/lib/logistics/case001.ts";
import { importDeliveryProject } from "../src/lib/logistics/project-import.ts";
import { runScenario } from "../src/lib/logistics/engine.ts";
import { simulateOperations } from "../src/lib/logistics/execution.ts";
import { buildCase001ProposalData } from "../src/lib/logistics/proposal.ts";
import { buildD11BrowserProposal, serializeD11BrowserProposal, validateD11BrowserProposal, D11_MAX_BYTES } from "../src/components/tools/d11-transfer.ts";

function makeResult(state) {
  const model = createCase001({ days: state.days, dailyOrders: state.orders,
    demandMultiplier: state.demand / 100, fuelMultiplier: state.fuel / 100 });
  const unavailable = model.fleet.filter(v => v.kind === "owned").slice(0, state.breakdown).map(v => v.id);
  const before = runScenario(model, "as-is", unavailable);
  const after = runScenario(model, "to-be", unavailable);
  const settings = { trafficPercent: state.trafficPercent, dockDelayMinutes: state.dockDelayMinutes,
    extraServiceMinutes: state.extraServiceMinutes, latePenaltyRub: 2500, rejectOutOfWindow: true };
  const data = buildCase001ProposalData({ state, model, before, after,
    operationBefore: simulateOperations(model, before, settings),
    operationAfter: simulateOperations(model, after, settings) });
  const proposal = buildD11BrowserProposal({ toolId: "delivery-network-planner",
    toolTitle: "Региональная доставка: AS-IS / TO-BE",
    markdown: "# Результат", data }, "2026-11-13T00:00:00.000Z");
  return { data, proposal };
}
test("D11 transport result roundtrips through the existing preview schema", () => {
  const state = { days: 5, orders: 380, demand: 100, fuel: 100, breakdown: 0,
    trafficPercent: 135, dockDelayMinutes: 20, extraServiceMinutes: 3 };
  const { data, proposal } = makeResult(state);
  assert.equal(data._editorState.trafficPercent, 135);
  assert.equal(data.before.orderCount, 1904);
  assert.equal(data.operation.after.refused > 0, true);
  const wire = serializeD11BrowserProposal(proposal);
  assert.ok(Buffer.byteLength(wire, "utf8") <= D11_MAX_BYTES);
  assert.deepEqual(validateD11BrowserProposal(JSON.parse(wire)), proposal);
});
test("peak project is not lost when readable JSON exceeds transfer size", () => {
  const state = { days: 10, orders: 650, demand: 150, fuel: 100, breakdown: 0,
    trafficPercent: 160, dockDelayMinutes: 40, extraServiceMinutes: 10 };
  const { proposal } = makeResult(state);
  const wire = serializeD11BrowserProposal(proposal);
  assert.ok(Buffer.byteLength(wire, "utf8") <= D11_MAX_BYTES);
  assert.deepEqual(validateD11BrowserProposal(JSON.parse(wire)), proposal);
});
test("D11 T2 registration keeps the exact same transport schema through Host build", () => {
  const read = p => readFileSync(new URL("../" + p, import.meta.url), "utf8");
  const id = "ru.iwxa.advice-logistics.delivery-network.proposal";
  const schema = JSON.parse(read("runtime/d11-schemas/delivery-network.proposal.schema.json"));
  const passport = JSON.parse(read("runtime/t2-config/d11-workspace-passport.json"));
  const moduleManifest = JSON.parse(read("runtime/d11-module/manifest.json"));
  assert.deepEqual(passport.schemas[id].json_schema, schema);
  assert.ok(passport.permissions.objects.write.includes(id));
  assert.ok(passport.permissions.objects.read.includes(id));
  assert.ok(moduleManifest.contributions.commands.some(x =>
    x.id === "ru.iwxa.advice-logistics.command.delivery-network.save-proposal"));
  assert.ok(moduleManifest.contributions.viewers.some(x => x.id === "d11.delivery-network.detail"));
  assert.match(read("scripts/build-t2-integrated-site.mjs"), /ru\.iwxa\.advice-logistics\.delivery-network\.proposal/);
});

test("external operations project roundtrips through T2 proposal with exact source records", () => {
  const importedModel = importDeliveryProject(createCase001({ days: 1, dailyOrders: 80 }));
  const state = { days: 5, orders: 380, demand: 100, fuel: 100, breakdown: 0,
    trafficPercent: 125, dockDelayMinutes: 10, extraServiceMinutes: 3,
    pickingWorkers: 20, maxRunsPerVehicle: 2, maxStopsPerTrip: 12,
    peakTravelPercent: 120, importedModel };
  const before = runScenario(importedModel, "as-is");
  const after = runScenario(importedModel, "to-be");
  const settings = { trafficPercent: 125, dockDelayMinutes: 10, extraServiceMinutes: 3,
    latePenaltyRub: 2500, rejectOutOfWindow: true };
  const data = buildCase001ProposalData({ state, model: importedModel, before, after,
    operationBefore: simulateOperations(importedModel, before, settings),
    operationAfter: simulateOperations(importedModel, after, settings) });
  assert.equal(data.generator, "D11_IMPORTED_PROJECT_V1");
  const proposal = buildD11BrowserProposal({ toolId: "delivery-network-planner",
    toolTitle: "Загруженный проект логистики", markdown: "# План/факт", data },
    "2026-11-13T00:00:00.000Z");
  assert.deepEqual(validateD11BrowserProposal(JSON.parse(serializeD11BrowserProposal(proposal))), proposal);
  assert.deepEqual(proposal.result.data._editorState.importedModel, importedModel);
});
