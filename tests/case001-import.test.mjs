import test from "node:test";
import assert from "node:assert/strict";
import { createCase001 } from "../model/logistics/case001.ts";
import { importDeliveryProject, MAX_D11_PROJECT_JSON_BYTES } from "../model/logistics/project-import.ts";
import { fingerprintModel, runScenario } from "../model/logistics/engine.ts";
import { simulateOperations } from "../model/logistics/execution.ts";
import { buildCase001ProposalData } from "../model/logistics/proposal.ts";

test("real Project JSON and existing full browser report load without dropping fields", () => {
  const source = createCase001({ days: 2, dailyOrders: 120 });
  const restored = importDeliveryProject(JSON.parse(JSON.stringify(source)));
  assert.deepEqual(restored, source);
  const wrapped = importDeliveryProject({ kind: "D11_CASE001_BROWSER_REPORT",
    parameters: {}, model: source, before: {}, after: {}, comparison: {}, operation: {} });
  assert.deepEqual(wrapped, source);
  assert.equal(fingerprintModel(restored), fingerprintModel(source));
});

test("imported orders, fleet and optional directed road distances use the same calculation engine", () => {
  const model = createCase001({ days: 1, dailyOrders: 50 });
  model.orders = model.orders.slice(0, 2);
  const nodes = ["DEPOT", ...new Set(model.orders.map(o => o.customerId))];
  const distances = Object.fromEntries(nodes.map(a => [a,
    Object.fromEntries(nodes.map(b => [b, a === b ? 0 : 7]))]));
  const minutes = Object.fromEntries(nodes.map(a => [a,
    Object.fromEntries(nodes.map(b => [b, a === b ? 0 : 35]))]));
  model.road.distanceMatrixKm = distances;
  model.road.travelTimeMatrix = minutes;
  const parsed = importDeliveryProject(JSON.parse(JSON.stringify(model)));
  const scenario = runScenario(parsed, "to-be");
  assert.deepEqual(scenario.audit, []);
  assert.ok(scenario.totalKm > 0);
  assert.ok(scenario.totalKm <= 4 * 7);
});

test("imported project persists its exact input model with actual plan/fact lineage", () => {
  const model = importDeliveryProject(createCase001({ days: 1, dailyOrders: 50 }));
  const state = { days: 5, orders: 380, demand: 100, fuel: 100, breakdown: 0,
    trafficPercent: 125, dockDelayMinutes: 10, extraServiceMinutes: 3,
    pickingWorkers: 20, maxRunsPerVehicle: 2, maxStopsPerTrip: 12, peakTravelPercent: 120,
    importedModel: model };
  const before = runScenario(model, "as-is");
  const after = runScenario(model, "to-be");
  const operationalSettings = { trafficPercent: 125, dockDelayMinutes: 10,
    extraServiceMinutes: 3, latePenaltyRub: 2500, rejectOutOfWindow: true };
  const data = buildCase001ProposalData({ state, model, before, after,
    operationBefore: simulateOperations(model, before, operationalSettings),
    operationAfter: simulateOperations(model, after, operationalSettings) });
  assert.equal(data.generator, "D11_IMPORTED_PROJECT_V1");
  assert.deepEqual(data._editorState.importedModel, model);
  assert.equal(data.modelFingerprint, fingerprintModel(model));
  const different = { ...model, ownedDailyFixedRub: model.ownedDailyFixedRub + 1 };
  assert.throws(() => buildCase001ProposalData({ state, model: different, before, after,
    operationBefore: simulateOperations(model, before, operationalSettings),
    operationAfter: simulateOperations(model, after, operationalSettings) }),
    /D11_CASE001_PROPOSAL_PLAN_INVALID/);
});

test("import explicitly rejects unexpected fields, missing fields and invalid dates", () => {
  const model = createCase001({ days: 1, dailyOrders: 20 });
  assert.throws(() => importDeliveryProject({ ...model, hostile: 1 }), /D11_PROJECT_SHAPE_INVALID/);
  const missing = { ...model }; delete missing.fleet;
  assert.throws(() => importDeliveryProject(missing), /D11_PROJECT_SHAPE_INVALID/);
  assert.throws(() => importDeliveryProject({ ...model, days: ["2026-02-30"] }),
    /D11_PROJECT_SIZE_OR_DATES_INVALID/);
  assert.throws(() => importDeliveryProject({ ...model, orders: [{ ...model.orders[0], additional: true }] }),
    /D11_PROJECT_SHAPE_INVALID/);
});

test("oversized project payload does not enter browser calculation or T2 handoff", () => {
  const model = createCase001({ days: 1, dailyOrders: 20 });
  model.id = "x".repeat(MAX_D11_PROJECT_JSON_BYTES + 100);
  assert.throws(() => importDeliveryProject(model), /D11_PROJECT_TOO_LARGE/);
});
