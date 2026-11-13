import test from "node:test";
import assert from "node:assert/strict";
import { createCase001 } from "../model/logistics/case001.ts";
import { runScenario, compareScenarios, auditScenario } from "../model/logistics/engine.ts";

test("ten-day logistics case has linked orders, 30 owned vehicles and outside capacity", () => {
  const m = createCase001();
  assert.equal(m.days.length, 10);
  assert.equal(m.fleet.length, 45);
  assert.equal(m.fleet.filter(v => v.kind === "owned").length, 30);
  assert.ok(m.orders.length >= 3000);
  assert.ok(m.orders.every(o => o.customerId && o.weightKg > 0 && o.windowEnd > o.windowStart));
});

test("full reconciliation before and after uses exactly the same shipments", () => {
  const m = createCase001({ days: 5 });
  const baseline = runScenario(m, "as-is");
  const target = runScenario(m, "to-be");
  assert.deepEqual(baseline.audit, []);
  assert.deepEqual(target.audit, []);
  assert.equal(baseline.orderCount, target.orderCount);
  assert.equal(baseline.delivered + baseline.unserved, baseline.orderCount);
  assert.equal(target.delivered + target.unserved, target.orderCount);
  const comparison = compareScenarios(baseline, target);
  if (comparison.comparable) {
    assert.equal(baseline.unserved, 0);
    assert.equal(target.unserved, 0);
    assert.equal(comparison.savedRub, Math.round((baseline.totalCostRub - target.totalCostRub) * 100) / 100);
  } else assert.equal(comparison.savedRub, null);
});

test("warehouse bottleneck blocks any incomplete-plan savings claim", () => {
  const m = createCase001({ days: 2, dailyOrders: 650, demandMultiplier: 1.5 });
  const baseline = runScenario(m, "as-is");
  const target = runScenario(m, "to-be");
  assert.ok(target.unserved > 0);
  assert.ok(target.days.some(d => d.unserved.some(x => x.reason === "warehouse-throughput")));
  assert.equal(compareScenarios(baseline, target).savedRub, null);
});

test("fleet breakdown does not silently replace vehicles or avoid fixed fleet cost", () => {
  const m = createCase001({ days: 1 });
  const unavailable = m.fleet.filter(v => v.kind === "owned").slice(0, 18).map(v => v.id);
  const scenario = runScenario(m, "to-be", unavailable);
  assert.deepEqual(scenario.audit, []);
  assert.ok(scenario.days[0].runs.every(r => !unavailable.includes(r.vehicleId)));
  assert.equal(scenario.days[0].fixedOwnedCostRub, 30 * 1900);
});

test("independent audit rejects tampered kilometres, double entries and corrupted cost", () => {
  const m = createCase001({ days: 1, dailyOrders: 50 });
  const r = runScenario(m, "to-be");
  assert.deepEqual(r.audit, []);
  r.days[0].runs[0].km += 50;
  r.days[0].totalCostRub = 1;
  const failures = auditScenario(m, r.days);
  assert.ok(failures.some(s => s.startsWith("INVALID_ROUTE")));
  assert.ok(failures.some(s => s.startsWith("COST_MISMATCH")));
});

test("deterministic replay and explicitly failed delivery capacity", () => {
  const model = createCase001({ days: 2, dailyOrders: 80 });
  assert.deepEqual(runScenario(model, "to-be"), runScenario(model, "to-be"));
  const impossible = { ...model, fleet: model.fleet.map(v => ({ ...v, shiftEnd: 510 })) };
  assert.equal(runScenario(impossible, "to-be").delivered, 0);
});

test("refuse to compare different fleet availability as if like-for-like", () => {
  const model = createCase001({ days: 1, dailyOrders: 50 });
  assert.throws(() => compareScenarios(
    runScenario(model, "as-is", [model.fleet[0].id]),
    runScenario(model, "to-be")), /D11_COMPARISON_INPUT_INVALID/);
});

test("service completion must fit the contractual delivery window", () => {
  const m = createCase001({ days: 1, dailyOrders: 15 });
  const sample = m.orders[0];
  const tight = { ...m, orders: [{
    ...sample, windowStart: 600, windowEnd: 607, serviceMinutes: 8,
  }] };
  assert.equal(runScenario(tight, "to-be").delivered, 0);
});

test("different input with same descriptive project ID is not a valid comparison", () => {
  const m = createCase001({ days: 1, dailyOrders: 60 });
  const baseline = runScenario(m, "as-is");
  const alteredCostModel = { ...m, ownedDailyFixedRub: m.ownedDailyFixedRub + 30 };
  assert.notEqual(baseline.inputFingerprint, runScenario(alteredCostModel, "to-be").inputFingerprint);
  assert.throws(() => compareScenarios(baseline, runScenario(alteredCostModel, "to-be")),
    /D11_COMPARISON_INPUT_INVALID/);
});

test("audit requires all unique planned days and rejects invalid unserved IDs", () => {
  const m = createCase001({ days: 2, dailyOrders: 20 });
  const run = runScenario(m, "as-is");
  assert.ok(auditScenario(m, run.days.slice(0, 1)).includes("DAYS_INCOMPLETE_OR_DUPLICATE"));
  run.days[0].unserved.push({ orderId: "nonexistent", reason: "warehouse-throughput" });
  assert.ok(auditScenario(m, run.days).some(x => x.startsWith("INVALID_UNSERVED")));
});

test("reject invalid input parameters rather than returning a misleading report", () => {
  const m = createCase001({ days: 1 });
  assert.throws(() => runScenario({ ...m, road: { ...m.road, avgKmHour: NaN } }, "to-be"),
    /D11_MODEL_INVALID/);
  assert.throws(() => runScenario(m, "incorrect"), /D11_UNKNOWN_MODE/);
});
