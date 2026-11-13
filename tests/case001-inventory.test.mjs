import test from "node:test";
import assert from "node:assert/strict";
import { createCase001 } from "../model/logistics/case001.ts";
import { auditScenario, runScenario } from "../model/logistics/engine.ts";
import { simulateOperations } from "../model/logistics/execution.ts";
import { calculateInventory, initialStock } from "../model/logistics/inventory.ts";
import { importDeliveryProject } from "../model/logistics/project-import.ts";
import { buildCase001ProposalData } from "../model/logistics/proposal.ts";

const settings = { trafficPercent: 160, dockDelayMinutes: 40, extraServiceMinutes: 10,
  latePenaltyRub: 2500, rejectOutOfWindow: true };

test("SKU lines equal physically measured cargo and repeatable inventory is nonnegative", () => {
  const model = createCase001({ days: 10 });
  assert.equal(model.inventory.length, 12);
  assert.ok(model.orders.every(o => o.lines.length > 0));
  const scenario = runScenario(model, "to-be");
  assert.deepEqual(scenario.audit, []);
  assert.equal(scenario.unserved, 0);
  const report = calculateInventory(model, scenario);
  assert.deepEqual(report.audit, []);
  assert.equal(report.days.length, model.days.length);
  for (const day of report.days)
    for (const m of day.movements) {
      assert.equal(m.closingUnits, m.openingUnits + m.receipts + m.returned - m.issued);
      assert.ok(m.closingUnits >= 0);
    }
  assert.deepEqual(report, calculateInventory(model, scenario));
});

test("low SKU coverage creates stock shortages without pretending a delivery was made", () => {
  const model = createCase001({ days: 5, dailyOrders: 380, stockCoveragePercent: 10 });
  const before = runScenario(model, "as-is");
  const after = runScenario(model, "to-be");
  assert.deepEqual(before.audit, []);
  assert.deepEqual(after.audit, []);
  assert.ok(after.days.some(d => d.unserved.some(x => x.reason === "stock-shortage")));
  assert.equal(after.delivered + after.unserved, model.orders.length);
  const inventory = calculateInventory(model, after);
  assert.deepEqual(inventory.audit, []);
  assert.ok(inventory.days.every(d => d.movements.every(m => m.closingUnits >= 0)));
  assert.equal(after.unserved > 0, true);
  assert.equal(after.orderCount, before.orderCount);
});

test("refused deliveries stay out of available stock until the next working day", () => {
  const model = createCase001({ days: 5 });
  const plan = runScenario(model, "to-be");
  const actual = simulateOperations(model, plan, settings);
  assert.deepEqual(actual.audit, []);
  assert.ok(actual.refused > 0);
  const report = calculateInventory(model, plan, actual);
  assert.deepEqual(report.audit, []);
  assert.equal(report.days.length, 5);
  assert.ok(report.days.some(d => d.returnedOrders > 0));
  assert.ok(report.days.slice(1).some(d => d.movements.some(m => m.returned > 0)));
  assert.ok(report.pendingReturnUnits >= 0);
  assert.equal(report.totalIssued, report.totalDelivered +
    report.days.flatMap(d => d.movements).reduce((n, m) => n + m.awaitingInspection, 0) +
    report.totalReturned - report.days.slice(0, -1).flatMap(d => d.movements)
      .reduce((n, m) => n + m.awaitingInspection, 0));
});

test("inconsistent SKU units, duplicate line and missing receipts fail before routing", () => {
  const source = createCase001({ days: 1, dailyOrders: 20 });
  const mismatch = structuredClone(source);
  mismatch.orders[0].weightKg += 1;
  assert.throws(() => runScenario(mismatch, "to-be"), /D11_ORDER_CARGO_MISMATCH/);
  const duplicate = structuredClone(source);
  duplicate.orders[0].lines.push({ ...duplicate.orders[0].lines[0] });
  assert.throws(() => runScenario(duplicate, "to-be"), /D11_ORDER_LINES_INVALID/);
  const missing = structuredClone(source);
  missing.inventory = missing.inventory.slice(1);
  assert.throws(() => runScenario(missing, "to-be"), /D11_ORDER_LINES_INVALID/);
});

test("independent replay detects unrecorded stock use and altered shortage reason", () => {
  const model = createCase001({ days: 3, dailyOrders: 380, stockCoveragePercent: 10 });
  const scenario = runScenario(model, "to-be");
  assert.deepEqual(scenario.audit, []);
  const bad = structuredClone(scenario.days);
  const shortage = bad.flatMap(d => d.unserved).find(o => o.reason === "stock-shortage");
  assert.ok(shortage);
  shortage.reason = "warehouse-throughput";
  assert.ok(auditScenario(model, bad).some(x => x.startsWith("INVALID_UNSERVED")));
});

test("replayable T2 proposal retains all SKU movement balances and shortages", () => {
  const state = { days: 3, orders: 380, demand: 100, fuel: 100, breakdown: 0,
    pickingWorkers: 20, maxRunsPerVehicle: 2, maxStopsPerTrip: 12,
    peakTravelPercent: 120, stockCoveragePercent: 10,
    trafficPercent: 160, dockDelayMinutes: 40, extraServiceMinutes: 10 };
  const model = createCase001({ days: state.days, dailyOrders: state.orders,
    stockCoveragePercent: state.stockCoveragePercent });
  const before = runScenario(model, "as-is");
  const after = runScenario(model, "to-be");
  const operationBefore = simulateOperations(model, before, settings);
  const operationAfter = simulateOperations(model, after, settings);
  const payload = buildCase001ProposalData({ state, model, before, after,
    operationBefore, operationAfter });
  assert.equal(payload.inventory.after.days.length, 3);
  assert.ok(payload.inventory.after.days.some(d => d.excludedShortages > 0));
  assert.equal(payload.modelFingerprint, after.inputFingerprint);
  assert.ok(payload.inventory.after.days.every(d => d.movements.length === 12));
});

test("imported enterprise model with no SKU-level detail stays supported", () => {
  const model = createCase001({ days: 1, dailyOrders: 40 });
  delete model.inventory;
  for (const o of model.orders) delete o.lines;
  const imported = importDeliveryProject(model);
  assert.deepEqual(imported, model);
  const scenario = runScenario(imported, "to-be");
  assert.deepEqual(scenario.audit, []);
  assert.deepEqual(calculateInventory(imported, scenario).days, []);
});
