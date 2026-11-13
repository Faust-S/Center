import test from "node:test";
import assert from "node:assert/strict";
import { createCase001 } from "../model/logistics/case001.ts";
import { auditScenario, runScenario } from "../model/logistics/engine.ts";
import { simulateOperations, calculateVerifiedInventory } from "../model/logistics/execution.ts";
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

test("forged delivery/refusal events cannot change the accepted SKU ledger", () => {
  const model = createCase001({ days: 2, dailyOrders: 100 });
  const plan = runScenario(model, "to-be");
  const actual = simulateOperations(model, plan, settings);
  assert.deepEqual(actual.audit, []);
  assert.deepEqual(calculateVerifiedInventory(model, plan, actual).audit, []);
  const victim = actual.days[0].trips.find(t => t.deliveries.length > 0);
  assert.ok(victim);
  for (const changed of ["status", "orderId", "completionMinute"]) {
    const forged = structuredClone(actual);
    const record = forged.days[0].trips.find(t => t.deliveries.length > 0).deliveries[0];
    if (changed === "status") record.status = record.status === "refused" ? "on-time" : "refused";
    else if (changed === "orderId") record.orderId = "FAKE-ORDER-ID";
    else record.completionMinute += 20;
    assert.throws(() => calculateVerifiedInventory(model, plan, forged),
      /D11_INVENTORY_EVENTS_UNVERIFIED/);
  }
});

test("modified route or stale input fingerprint cannot create a verified inventory report", () => {
  const model = createCase001({ days: 1, dailyOrders: 40 });
  const plan = runScenario(model, "to-be");
  const altered = structuredClone(plan);
  altered.days[0].runs[0].costRub += 1;
  assert.throws(() => calculateVerifiedInventory(model, altered),
    /D11_INVENTORY_PLAN_UNVERIFIED/);
  const changedModel = structuredClone(model);
  changedModel.inventory[0].openingUnits++;
  assert.throws(() => calculateVerifiedInventory(changedModel, plan),
    /D11_INVENTORY_PLAN_UNVERIFIED/);
});

test("imported working days must progress in chronological order for receipts and returned goods", () => {
  const model = createCase001({ days: 3, dailyOrders: 30 });
  const reversed = structuredClone(model);
  reversed.days = [...model.days].reverse();
  assert.throws(() => runScenario(reversed, "to-be"), /D11_DAYS_NOT_CHRONOLOGICAL/);
  const impossible = structuredClone(model);
  impossible.days[1] = "2026-02-30";
  assert.throws(() => runScenario(impossible, "to-be"), /D11_DAYS_NOT_CHRONOLOGICAL/);
});


function threeDayReturnModel() {
  const days = ["2026-11-16", "2026-11-17", "2026-11-18"];
  return {
    id: "D11-RETURN-REPLAN-001", days,
    orders: days.map((day, index) => ({
      id: "ORDER-" + (index + 1), day, customerId: "C-1", zone: 0,
      xKm: 20, yKm: 0, weightKg: 5, volumeM3: 0.05,
      serviceMinutes: 20, windowStart: 500, windowEnd: index === 0 ? 560 : 900,
      lines: [{ skuId: "SKU-01", units: 5 }],
    })),
    fleet: [{ id: "OWN-1", kind: "owned", zone: 0, capacityKg: 500,
      capacityM3: 5, shiftStart: 480, shiftEnd: 1080,
      kmRateRub: 10, hourRateRub: 100, activationRub: 0 }],
    warehouse: { bays: 1, loadMinutes: 20, dailyOrderCapacity: 30,
      pickers: 1, pickMinutesPerOrder: 5, pickingStartMinute: 480,
      pickingEndMinute: 1000, maxRunsPerVehicle: 1 },
    road: { gridDetourFactor: 1, avgKmHour: 50 },
    ownedDailyFixedRub: 100, fuelMultiplier: 1,
    inventory: [{ skuId: "SKU-01", openingUnits: 5, unitWeightKg: 1,
      unitVolumeM3: 0.01, receipts: [] }],
  };
}
const returnSettings = { trafficPercent: 200, dockDelayMinutes: 0,
  extraServiceMinutes: 0, latePenaltyRub: 2500, rejectOutOfWindow: true };

test("actual refused stock changes the next working day's real vehicle plan", async () => {
  const { replanAfterReturns, auditReplanning } = await import("../model/logistics/execution.ts");
  const model = threeDayReturnModel();
  const baseline = runScenario(model, "to-be");
  assert.deepEqual(baseline.days.map(d => d.delivered), [1, 0, 0]);
  const result = replanAfterReturns(model, baseline, returnSettings);
  assert.deepEqual(result.revised.days.map(d => d.delivered), [1, 1, 0]);
  assert.deepEqual(result.actual.days.map(d => d.refused), [1, 0, 0]);
  assert.equal(result.changes[0].acceptedReturns.length, 0);
  assert.deepEqual(result.changes[1].acceptedReturns, [{ skuId: "SKU-01", units: 5 }]);
  assert.deepEqual(result.changes[1].newlyScheduledOrders, ["ORDER-2"]);
  assert.equal(result.inventory.days[0].movements[0].awaitingInspection, 5);
  assert.equal(result.inventory.days[0].movements[0].closingUnits, 0);
  assert.equal(result.inventory.days[1].movements[0].returned, 5);
  assert.equal(result.inventory.days[1].movements[0].issued, 5);
  assert.equal(result.inventory.days[1].movements[0].closingUnits, 0);
  assert.equal(result.inventory.days[2].movements[0].closingUnits, 0);
  assert.deepEqual(result.audit, []);
  assert.deepEqual(auditReplanning(model, result), []);
  assert.deepEqual(replanAfterReturns(model, baseline, returnSettings), result);
  assert.equal(baseline.days[1].delivered, 0, "initial plan remains unchanged");
});

test("replanning cannot invent returned SKU, fake an order or backdate inspection", async () => {
  const { replanAfterReturns, auditReplanning } = await import("../model/logistics/execution.ts");
  const model = threeDayReturnModel();
  const baseline = runScenario(model, "to-be");
  const result = replanAfterReturns(model, baseline, returnSettings);
  const forged = structuredClone(result);
  forged.changes[1].acceptedReturns[0].units = 500;
  assert.match(auditReplanning(model, forged).join(","), /D11_REPLAN_REPLAY_MISMATCH:changes/);
  const tamperedRoute = structuredClone(result);
  tamperedRoute.revised.days[1].runs[0].stops[0].orderId = "ORDER-3";
  assert.match(auditReplanning(model, tamperedRoute).join(","), /D11_REPLAN_REPLAY_MISMATCH:revised/);
  const tamperedEvent = structuredClone(result);
  tamperedEvent.actual.days[0].trips[0].deliveries[0].status = "on-time";
  assert.match(auditReplanning(model, tamperedEvent).join(","), /D11_REPLAN_REPLAY_MISMATCH:actual/);
  const tamperedLedger = structuredClone(result);
  tamperedLedger.inventory.days[1].movements[0].closingUnits += 5;
  assert.match(auditReplanning(model, tamperedLedger).join(","), /D11_REPLAN_REPLAY_MISMATCH:inventory/);
  const changedModel = structuredClone(model);
  changedModel.inventory[0].openingUnits += 5;
  assert.match(auditReplanning(changedModel, result).join(","), /D11_REPLAN_REPLAY_FAILED/);
});

test("browser report with adaptive routes retains its complete imported source project", async () => {
  const { replanAfterReturns } = await import("../model/logistics/execution.ts");
  const model = threeDayReturnModel();
  const before = runScenario(model, "as-is");
  const after = runScenario(model, "to-be");
  const replanning = replanAfterReturns(model, after, returnSettings);
  const loaded = importDeliveryProject({
    kind: "D11_CASE001_BROWSER_REPORT", parameters: {},
    model, before, after, comparison: {},
    operation: {}, inventory: {}, replanning,
  });
  assert.deepEqual(loaded, model);
});


test("the T2 proposal records exact order events from the second, re-dispatched schedule", async () => {
  const model = threeDayReturnModel();
  const state = { days: 3, orders: 1, demand: 100, fuel: 100, breakdown: 0,
    trafficPercent: returnSettings.trafficPercent,
    dockDelayMinutes: 0, extraServiceMinutes: 0, importedModel: model };
  const before = runScenario(model, "as-is");
  const after = runScenario(model, "to-be");
  const operationBefore = simulateOperations(model, before, returnSettings);
  const operationAfter = simulateOperations(model, after, returnSettings);
  const payload = buildCase001ProposalData({
    state, model, before, after, operationBefore, operationAfter,
  });
  assert.equal(payload.replanning.originalScheduled, 1);
  assert.equal(payload.replanning.revisedScheduled, 2);
  assert.equal(payload.replanning.actualRefused, 1);
  assert.equal(payload.replanning.actual.days[0].trips[0].events[0][1], 2);
  assert.equal(payload.replanning.actual.days[1].trips[0].events[0][1], 0);
  const { restoreReplannedDays, restoreCompactDeliveryEvents } = await import("../model/logistics/proposal.ts");
  const fullDays = restoreReplannedDays(payload.after, payload.replanning);
  assert.equal(fullDays[1].runs[0].stops[0], "ORDER-2");
  const recovered = restoreCompactDeliveryEvents(model, fullDays, payload.replanning.actual);
  const generated = (await import("../model/logistics/execution.ts"))
    .replanAfterReturns(model, after, returnSettings);
  assert.deepEqual(recovered, generated.actual.days.map(d => d.trips.map(t => t.deliveries)));
  const initialEvents = restoreCompactDeliveryEvents(model, payload.after.days, payload.operation.after);
  assert.deepEqual(initialEvents, operationAfter.days.map(d => d.trips.map(t => t.deliveries)));
  const corrected = recovered[1][0][0];
  assert.equal(corrected.orderId, "ORDER-2");
  assert.equal(corrected.status, "on-time");
  assert.ok(corrected.completionMinute > corrected.arrivalMinute);
  assert.equal(corrected.contractualEndMinute, 900);
  const modified = structuredClone(payload.replanning);
  modified.changedDays.push({ ...modified.changedDays[0] });
  assert.throws(() => restoreReplannedDays(payload.after, modified), /D11_REPLAN_DAY_PATCH_INVALID/);
  const tampered = structuredClone(payload.replanning.actual);
  tampered.days[0].trips[0].events[0][1] = 9;
  assert.throws(() => restoreCompactDeliveryEvents(model, fullDays, tampered),
    /D11_EVENTS_ORDER_INVALID/);
  assert.deepEqual(payload.replanning.changes[1].acceptedReturns,
    [{ skuId: "SKU-01", units: 5 }]);
  assert.equal(payload.replanning.inventory.days[1].movements[0].issued, 5);
  assert.deepEqual(payload.replanning.audit, []);
  // The initial operational fact is an independent, unmodified journal.
  assert.equal(payload.operation.after.days[1].trips.length, 0);
});
