import test from "node:test";
import assert from "node:assert/strict";
import { createCase002 } from "../model/logistics/case002-data.ts";
import { validateSupplyInput, simulateDepotSupply, compareDepotSupply, auditDepotSupply } from "../model/logistics/case002-supply.ts";

test("CASE-002 has ten real working-day ledgers, four depots and distinct repair jobs", () => {
  const input = createCase002();
  validateSupplyInput(input);
  assert.equal(input.days.length, 10);
  assert.equal(input.depots.length, 4);
  assert.equal(input.parts.length, 8);
  assert.equal(input.jobs.length, 120);
  assert.equal(new Set(input.jobs.map(job => job.id)).size, 120);
  const reactive = simulateDepotSupply(input, "reactive");
  const advance = simulateDepotSupply(input, "advance");
  assert.deepEqual(reactive.audit, []);
  assert.deepEqual(advance.audit, []);
  assert.deepEqual(auditDepotSupply(input, reactive), []);
  assert.deepEqual(auditDepotSupply(input, advance), []);
  assert.equal(reactive.days.length, 10);
  assert.equal(advance.days.length, 10);
  assert.equal(reactive.completedJobs + reactive.waitingJobs.length, 120);
  assert.equal(advance.completedJobs + advance.waitingJobs.length, 120);
});

test("advance ordering is physically tied to routes and changes actual maintenance coverage", () => {
  const input = createCase002();
  const comparison = compareDepotSupply(input);
  const { reactive, advance } = comparison;
  assert.ok(reactive.delayJobDays > 0);
  assert.ok(advance.delayJobDays < reactive.delayJobDays,
    "forecasted spare-part dispatch must prevent real repair-day shortages");
  assert.ok(advance.completedJobs >= reactive.completedJobs);
  assert.ok(comparison.avoidedJobDays > 0);
  assert.deepEqual(advance.audit, []);
  assert.ok(advance.days.some((d, index) => index < 9 &&
    d.shipments.some(x => x.routeStatus === "delivered")));
  for (const d of advance.days) {
    for (const p of input.parts) {
      const sku = p.skuId;
      assert.equal(d.closingHub[sku], d.openingHub[sku] +
        (d.receipts[sku] ?? 0) + (d.acceptedReturns[sku] ?? 0) -
        (d.issued[sku] ?? 0));
      assert.ok(d.closingHub[sku] >= 0);
    }
    const shipmentIds = d.shipments.map(x => x.id);
    assert.equal(new Set(shipmentIds).size, shipmentIds.length);
    assert.ok(d.shipments.every(x => input.depots.some(dp => dp.id === x.depotId)));
  }
});

test("completed repairs never consume parts twice, and stored result has reproducible ledger", () => {
  const input = createCase002();
  const result = simulateDepotSupply(input, "advance");
  const allCompleted = result.days.flatMap(d => d.completedJobs);
  assert.equal(new Set(allCompleted).size, allCompleted.length);
  assert.equal(allCompleted.length, result.completedJobs);
  assert.ok(result.shippedUnits >= result.acceptedUnits);
  assert.equal(result.totalRub, Math.round((result.transportRub + result.downtimeRub) * 100) / 100);
  const recovered = JSON.parse(JSON.stringify(result));
  assert.deepEqual(auditDepotSupply(input, recovered), []);
  recovered.days[0].closingHub[input.parts[0].skuId] += 7;
  assert.deepEqual(auditDepotSupply(input, recovered), ["D11_SUPPLY_REPLAY_MISMATCH"]);
  const changedInput = structuredClone(input);
  changedInput.hubOpening[input.parts[0].skuId] += 1;
  assert.deepEqual(auditDepotSupply(changedInput, result), ["D11_SUPPLY_REPLAY_MISMATCH"]);
});

test("customer refusal of an actual hub route sends units to inspection, not depot maintenance", () => {
  const ordinary = createCase002();
  const baseline = simulateDepotSupply(ordinary, "advance");
  const candidate = baseline.days[0].shipments.find(x => x.routeStatus === "delivered");
  assert.ok(candidate, "day one must produce a physical delivery");
  const interrupted = createCase002({ refusalIds: [candidate.id] });
  const result = simulateDepotSupply(interrupted, "advance");
  assert.deepEqual(result.audit, []);
  const rejected = result.days[0].shipments.find(x => x.id === candidate.id);
  assert.equal(rejected.routeStatus, "refused");
  assert.equal(rejected.availableDay, null);
  for (const part of rejected.parts) {
    assert.ok((result.days[0].pendingReturns[part.skuId] ?? 0) >= part.units);
    assert.ok((result.days[1].acceptedReturns[part.skuId] ?? 0) >= part.units);
  }
  assert.ok(result.acceptedUnits < result.shippedUnits);
  assert.deepEqual(auditDepotSupply(interrupted, result), []);
});

test("source input refuses nonexistent depots, unknown SKU, duplicate repairs and negative stock", () => {
  const input = createCase002();
  for (const edit of [
    (a) => { a.jobs[0].depotId = "UNKNOWN"; },
    (a) => { a.jobs[0].parts[0].skuId = "INVALID"; },
    (a) => { a.jobs[0].id = a.jobs[1].id; },
    (a) => { a.hubOpening["BRK-01"] = -3; },
    (a) => { a.days[1] = a.days[0]; },
    (a) => { a.depots[0].opening["BRK-01"] = -1; },
    (a) => { a.receipts[0].units = -2; },
  ]) {
    const altered = structuredClone(input);
    edit(altered);
    assert.throws(() => validateSupplyInput(altered), /D11_SUPPLY_/);
  }
});

test("few trucks and supplier delay change actual plans, rather than just labels", () => {
  const supply = compareDepotSupply(createCase002({ fleetVehicles: 1, supplierDelayDays: 2,
    openingCoveragePercent: 40, trafficPercent: 160 }));
  assert.deepEqual(supply.advance.audit, []);
  const normal = compareDepotSupply(createCase002()).advance;
  // Physical fleet, inbound timing and material supply must affect the
  // actual truck allocation and economic ledger, not only the UI labels.
  assert.notDeepEqual(supply.advance.days.map(d => d.shipments),
    normal.days.map(d => d.shipments));
  assert.notEqual(supply.advance.totalRub, normal.totalRub);
});


test("last-day shipments and refused consignments remain in transit after the project window", () => {
  const input = createCase002();
  // A new critical spare first requested on the final working day requires a
  // genuinely physical shipment, even under a reactive dispatch policy.
  input.parts.push({ skuId: "END-09", name: "Критичная запасная деталь",
    unitWeightKg: 2, unitVolumeM3: 0.01, valueRub: 5500 });
  input.hubOpening["END-09"] = 5;
  input.depots.forEach(depot => { depot.opening["END-09"] = 0; });
  input.jobs.push({ id:"REPAIR-END-001", depotId:"AP-01",
    dueDay:input.days.at(-1), priority:"safety",
    parts:[{skuId:"END-09",units:1}], downtimeRubPerDay:18000,
    workDescription:"Срочный ремонт в последнюю смену" });
  const normal = simulateDepotSupply(input, "reactive");
  const last = normal.days.at(-1);
  const shipped = last.shipments.find(s => s.routeStatus === "delivered" &&
    s.parts.some(p => p.skuId === "END-09"));
  assert.ok(shipped, "the last-day maintenance job must result in a real shipment");
  assert.equal(shipped.availableDay, "2026-11-30", "next actual working day");
  for (const part of shipped.parts)
    assert.ok((last.inTransit[part.skuId] ?? 0) >= part.units);
  const interrupted = structuredClone(input);
  interrupted.refusedShipmentIds = [shipped.id];
  const broken = simulateDepotSupply(interrupted, "reactive");
  assert.deepEqual(broken.audit, []);
  assert.deepEqual(auditDepotSupply(interrupted, broken), []);
  assert.equal(broken.days.at(-1).shipments.find(s=>s.id===shipped.id).routeStatus, "refused");
  for (const part of shipped.parts)
    assert.ok((broken.days.at(-1).pendingReturns[part.skuId] ?? 0) >= part.units,
      "stock remains held until an inspection beyond the model horizon");
});
