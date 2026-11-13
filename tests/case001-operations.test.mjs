import test from "node:test";
import assert from "node:assert/strict";
import { createCase001 } from "../model/logistics/case001.ts";
import { runScenario } from "../model/logistics/engine.ts";
import { simulateOperations, auditOperations, compareOperations } from "../model/logistics/execution.ts";

test("plan and fact reconcile without traffic delays", () => {
  const model = createCase001({ days: 3, dailyOrders: 240 });
  const plan = runScenario(model, "to-be");
  const actual = simulateOperations(model, plan);
  assert.deepEqual(actual.audit, []);
  assert.equal(actual.scheduled, plan.delivered);
  assert.equal(actual.executed, plan.delivered);
  assert.equal(actual.refused, 0);
  assert.equal(actual.late, 0);
  assert.equal(actual.totalCostRub, plan.totalCostRub);
  assert.equal(actual.executed + actual.refused + actual.notScheduled, plan.orderCount);
});

test("the same congestion events can change service levels for AS-IS and TO-BE", () => {
  const model = createCase001({ days: 5 });
  const conditions = { trafficPercent: 135, dockDelayMinutes: 20, extraServiceMinutes: 3 };
  const asis = simulateOperations(model, runScenario(model, "as-is"), conditions);
  const tobe = simulateOperations(model, runScenario(model, "to-be"), conditions);
  assert.deepEqual(asis.audit, []);
  assert.deepEqual(tobe.audit, []);
  assert.ok(asis.refused > 0);
  assert.ok(tobe.refused > 0);
  assert.equal(asis.executed + asis.refused + asis.notScheduled, model.orders.length);
  assert.equal(tobe.executed + tobe.refused + tobe.notScheduled, model.orders.length);
  const cmp = compareOperations(asis, tobe);
  assert.equal(cmp.comparable, false);
  assert.equal(cmp.costDifferenceRub, null);
});

test("late but accepted delivery changes service KPI without phantom missing orders", () => {
  const model = createCase001({ days: 1, dailyOrders: 100 });
  const scenario = runScenario(model, "to-be");
  const actual = simulateOperations(model, scenario,
    { trafficPercent: 160, dockDelayMinutes: 40, extraServiceMinutes: 10,
      rejectOutOfWindow: false });
  assert.deepEqual(actual.audit, []);
  assert.equal(actual.refused, 0);
  assert.ok(actual.late > 0);
  assert.equal(actual.executed, scenario.delivered);
});

test("independent event replay catches manipulated timestamp and truck attribution", () => {
  const model = createCase001({ days: 1, dailyOrders: 60 });
  const plan = runScenario(model, "to-be");
  const actual = simulateOperations(model, plan);
  assert.deepEqual(actual.audit, []);
  actual.days[0].trips[0].deliveries[0].completionMinute += 1;
  assert.ok(auditOperations(model, plan, actual).some(x => x.startsWith("OPERATION_TRIP_REPLAY_INVALID")));
});

test("invalid operational conditions are rejected before any report is produced", () => {
  const model = createCase001({ days: 1, dailyOrders: 30 });
  const plan = runScenario(model, "to-be");
  assert.throws(() => simulateOperations(model, plan, { trafficPercent: Infinity }),
    /D11_OPERATION_SETTINGS_INVALID/);
  assert.throws(() => simulateOperations(model, { ...plan, inputFingerprint: "other" }),
    /D11_OPERATION_PLAN_INVALID/);
});

test("replay yields identical event and cost histories for the same settings", () => {
  const model = createCase001({ days: 2, dailyOrders: 150 });
  const plan = runScenario(model, "as-is");
  const opts = { trafficPercent: 125, dockDelayMinutes: 10 };
  assert.deepEqual(simulateOperations(model, plan, opts), simulateOperations(model, plan, opts));
});
