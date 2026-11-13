import test from "node:test";
import assert from "node:assert/strict";
import { createCase001 } from "../model/logistics/case001.ts";
import { auditScenario, runScenario } from "../model/logistics/engine.ts";
import { simulateOperations, auditOperations } from "../model/logistics/execution.ts";
import { pickWarehouseOrders } from "../model/logistics/warehouse.ts";

test("same-day repeated trips use a physical vehicle and ordered dock reservations", () => {
  const model = createCase001({ days: 1, dailyOrders: 380, maxStopsPerTrip: 8 });
  const missing = model.fleet.filter(v => v.kind === "owned").slice(0, 29).map(v => v.id);
  const plan = runScenario(model, "to-be", missing);
  assert.deepEqual(plan.audit, []);
  assert.ok(plan.days[0].runs.some(r => r.tripNumber === 2));
  const cfg = model.warehouse;
  const picked = pickWarehouseOrders(model, model.days[0]);
  for (const run of plan.days[0].runs) {
    assert.ok(run.stops.length <= cfg.maxStopsPerTrip);
    const latestReady = Math.max(...run.stops.map(s => picked.readyAt.get(s.orderId)));
    assert.ok(run.loadStartMinute >= latestReady);
    assert.equal(run.departMinute, run.loadStartMinute + cfg.loadMinutes);
    assert.ok(run.returnMinute <= model.fleet.find(v => v.id === run.vehicleId).shiftEnd);
  }
  for (let bay = 0; bay < cfg.bays; bay++) {
    const runs = plan.days[0].runs.filter(r => r.loadingBay === bay)
      .sort((a, b) => a.loadStartMinute - b.loadStartMinute);
    for (let i = 1; i < runs.length; i++)
      assert.ok(runs[i].loadStartMinute >= runs[i - 1].departMinute);
  }
  for (const v of model.fleet) {
    const runs = plan.days[0].runs.filter(r => r.vehicleId === v.id)
      .sort((a, b) => a.tripNumber - b.tripNumber);
    for (let i = 1; i < runs.length; i++) {
      assert.equal(runs[i].tripNumber, i + 1);
      assert.ok(runs[i].loadStartMinute >= runs[i - 1].returnMinute + cfg.turnaroundMinutes);
      assert.equal(runs[i].driverBreakStartMinute, runs[i - 1].lastBreakEndMinute);
    }
  }
});

test("unexpected dock overlap or forged trip number fails independent audit", () => {
  const model = createCase001({ days: 1, dailyOrders: 120 });
  const scenario = runScenario(model, "to-be");
  const original = structuredClone(scenario.days);
  scenario.days[0].runs[0].loadStartMinute += 5;
  assert.ok(auditScenario(model, scenario.days).some(v => v.startsWith("INVALID_ROUTE_OR_DOCK")));
  const altered = structuredClone(original);
  altered[0].runs[0].tripNumber = 3;
  assert.ok(auditScenario(model, altered).some(v => v.startsWith("TRIP_LIMIT_OR_SEQUENCE")));
});

test("actual congestion cascades from first to second trip without vehicle teleportation", () => {
  const model = createCase001({ days: 1, dailyOrders: 380, maxStopsPerTrip: 8 });
  const unavailable = model.fleet.filter(v => v.kind === "owned").slice(0, 29).map(v => v.id);
  const plan = runScenario(model, "to-be", unavailable);
  const report = simulateOperations(model, plan, {
    trafficPercent: 175, dockDelayMinutes: 25, extraServiceMinutes: 4,
  });
  assert.deepEqual(report.audit, []);
  let cascaded = 0;
  const day = report.days[0];
  for (const v of model.fleet) {
    const first = day.trips.find(t => t.vehicleId === v.id);
    const second = day.trips.filter(t => t.vehicleId === v.id)[1];
    if (!first || !second) continue;
    const source = plan.days[0].runs.filter(r => r.vehicleId === v.id)[1];
    assert.ok(second.loadStartMinute >= first.returnMinute + model.warehouse.turnaroundMinutes);
    assert.ok(second.loadStartMinute >= source.loadStartMinute);
    if (second.loadStartMinute > source.loadStartMinute) cascaded++;
  }
  assert.ok(cascaded > 0);
  const altered = structuredClone(report);
  const second = altered.days[0].trips.find(t => t.driverBreakStartMinute !== model.fleet.find(v => v.id === t.vehicleId)?.shiftStart);
  if (second) {
    second.driverBreakStartMinute += 1;
    assert.ok(auditOperations(model, plan, altered).some(v => v.startsWith("OPERATION_TRIP_REPLAY_INVALID")));
  }
});

test("warehouse picking and finite bays can become the limiting resource", () => {
  const model = createCase001({ days: 1, dailyOrders: 650, demandMultiplier: 1.5, pickingWorkers: 2 });
  const picked = pickWarehouseOrders(model, model.days[0]);
  const plan = runScenario(model, "to-be");
  assert.deepEqual(plan.audit, []);
  assert.ok(picked.missed.length > 0);
  assert.equal(plan.days[0].unserved.filter(v => v.reason === "warehouse-throughput").length, picked.missed.length);
  assert.equal(plan.delivered + plan.unserved, model.orders.length);
});

test("declared road time matrix is used; absent arcs and overlapping peak periods reject model", () => {
  const model = createCase001({ days: 1, dailyOrders: 20 });
  model.orders = model.orders.slice(0, 2);
  const nodes = ["DEPOT", ...new Set(model.orders.map(o => o.customerId))];
  const matrix = Object.fromEntries(nodes.map(from => [from,
    Object.fromEntries(nodes.map(to => [to, from === to ? 0 : 35]))]));
  model.road.travelTimeMatrix = matrix;
  assert.deepEqual(runScenario(model, "to-be").audit, []);
  delete matrix.DEPOT[nodes[1]];
  assert.throws(() => runScenario(model, "to-be"), /D11_ROAD_MATRIX_EDGE_MISSING/);
  delete model.road.travelTimeMatrix;
  model.road.trafficPeriods.push({ fromMinute: 500, toMinute: 550, travelMultiplier: 1.3 });
  assert.throws(() => runScenario(model, "to-be"), /D11_TRAFFIC_PROFILE_INVALID/);
});

test("default multi-day transportation project keeps every order accounted for", () => {
  const model = createCase001({ days: 10 });
  const scenario = runScenario(model, "to-be");
  assert.deepEqual(scenario.audit, []);
  assert.equal(scenario.delivered + scenario.unserved, model.orders.length);
  assert.ok(scenario.days.every(d => d.fixedOwnedCostRub === 30 * model.ownedDailyFixedRub));
  const actual = simulateOperations(model, scenario);
  assert.deepEqual(actual.audit, []);
  assert.equal(actual.executed + actual.refused + actual.notScheduled, model.orders.length);
});
