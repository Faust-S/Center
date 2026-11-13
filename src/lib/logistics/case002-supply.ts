/** D11 CASE-002: maintenance spare-parts distribution across bus depots.
 * Domain business logic only; dispatches use the existing D11 transport engine.
 * Operational numbers belong to the input project, not to a named operator. */
import { fingerprintModel, runScenario, type Project } from "./engine.ts";
import { simulateOperations, type OperationSettings } from "./execution.ts";
import { calculateVerifiedInventory, inspectionReleaseDay } from "./inventory.ts";

export type SupplyMode = "reactive" | "advance";
export interface SparePart {
  skuId: string; name: string; unitWeightKg: number; unitVolumeM3: number; valueRub: number;
}
export interface ServiceDepot {
  id: string; name: string; xKm: number; yKm: number; zone: number;
  opening: Record<string, number>;
}
export interface MaintenanceJob {
  id: string; depotId: string; dueDay: string; priority: "safety" | "routine";
  parts: { skuId: string; units: number }[];
  downtimeRubPerDay: number; workDescription: string;
}
export interface SupplyInput {
  id: string; days: string[]; parts: SparePart[]; depots: ServiceDepot[];
  jobs: MaintenanceJob[];
  hubOpening: Record<string, number>;
  receipts: { day: string; skuId: string; units: number }[];
  fleet: Project["fleet"]; warehouse: Project["warehouse"]; road: Project["road"];
  fuelMultiplier: number; ownedDailyFixedRub: number;
  operation: Partial<OperationSettings>;
  refusedShipmentIds?: string[];
}
export interface SupplyShipment {
  id: string; depotId: string; day: string;
  parts: { skuId: string; units: number }[];
  routeStatus: "delivered" | "refused" | "not-routed";
  availableDay: string | null; vehicleId: string | null;
}
export interface SupplyDay {
  day: string;
  openingHub: Record<string, number>; closingHub: Record<string, number>;
  depotStock: Record<string, Record<string, number>>;
  receipts: Record<string, number>; acceptedReturns: Record<string, number>;
  completedJobs: string[]; waitingJobs: string[];
  shipments: SupplyShipment[];
  issued: Record<string, number>; receivedAtDepots: Record<string, number>;
  inTransit: Record<string, number>; pendingReturns: Record<string, number>;
  costTransportRub: number; costDowntimeRub: number;
}
export interface SupplyResult {
  caseId: "D11-CASE-002"; modelId: string; fingerprint: string; mode: SupplyMode;
  days: SupplyDay[]; totalJobs: number; completedJobs: number; waitingJobs: string[];
  delayJobDays: number; downtimeRub: number; transportRub: number; totalRub: number;
  shippedUnits: number; acceptedUnits: number; audit: string[];
}
export interface SupplyComparison { reactive: SupplyResult; advance: SupplyResult;
  additionalCompleted: number; avoidedJobDays: number; totalDifferenceRub: number; }

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const round = (n: number) => Math.round(n * 100) / 100;
const add = (target: Record<string, number>, sku: string, units: number) =>
  { target[sku] = (target[sku] ?? 0) + units; };
const copy = (input: Record<string, number>) => ({ ...input });
const capacity = (n: unknown) => Number.isSafeInteger(n) && (n as number) >= 0;
const nextDay = (days: string[], day: string) => days[days.indexOf(day) + 1] ?? null;
const date = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) &&
  !Number.isNaN(Date.parse(day + "T00:00:00.000Z")) &&
  new Date(day + "T00:00:00.000Z").toISOString().slice(0, 10) === day;

export function validateSupplyInput(input: SupplyInput): void {
  if (!input || typeof input.id !== "string" || !input.id ||
      !Array.isArray(input.days) || !input.days.length || input.days.length > 65 ||
      input.days.some((day, i) => !date(day) || (i > 0 && day <= input.days[i - 1])) ||
      !Array.isArray(input.parts) || !input.parts.length || input.parts.length > 250 ||
      !Array.isArray(input.depots) || !input.depots.length || input.depots.length > 100 ||
      !Array.isArray(input.jobs) || input.jobs.length > 15000 ||
      !Array.isArray(input.receipts) || !Array.isArray(input.fleet) ||
      input.fleet.length === 0 || !input.warehouse || !input.road ||
      !Number.isFinite(input.fuelMultiplier) || input.fuelMultiplier <= 0 ||
      !Number.isFinite(input.ownedDailyFixedRub) || input.ownedDailyFixedRub < 0)
    throw Error("D11_SUPPLY_INPUT_INVALID");
  const skus = new Set<string>(), depots = new Set<string>(), jobs = new Set<string>();
  for (const p of input.parts) {
    if (!p.skuId || skus.has(p.skuId) || !p.name ||
        !Number.isFinite(p.unitWeightKg) || p.unitWeightKg <= 0 ||
        !Number.isFinite(p.unitVolumeM3) || p.unitVolumeM3 <= 0 ||
        !Number.isFinite(p.valueRub) || p.valueRub < 0 ||
        !capacity(input.hubOpening[p.skuId])) throw Error("D11_SUPPLY_SKU_INVALID");
    skus.add(p.skuId);
  }
  if (Object.keys(input.hubOpening).some(sku => !skus.has(sku))) throw Error("D11_SUPPLY_HUB_UNKNOWN_SKU");
  const customerLocations = new Set<string>();
  for (const d of input.depots) {
    if (!d.id || depots.has(d.id) || !d.name || !Number.isSafeInteger(d.zone) ||
        d.zone < 0 || !Number.isFinite(d.xKm) || !Number.isFinite(d.yKm) ||
        customerLocations.has(JSON.stringify([d.xKm, d.yKm, d.zone])) ||
        Object.entries(d.opening).some(([sku, units]) => !skus.has(sku) || !capacity(units)))
      throw Error("D11_SUPPLY_DEPOT_INVALID");
    depots.add(d.id);
    customerLocations.add(JSON.stringify([d.xKm, d.yKm, d.zone]));
  }
  for (const job of input.jobs) {
    if (!job.id || jobs.has(job.id) || !depots.has(job.depotId) ||
        !input.days.includes(job.dueDay) || !["safety","routine"].includes(job.priority) ||
        !Array.isArray(job.parts) || !job.parts.length ||
        !Number.isFinite(job.downtimeRubPerDay) || job.downtimeRubPerDay < 0 ||
        !job.workDescription || new Set(job.parts.map(p => p.skuId)).size !== job.parts.length ||
        job.parts.some(p => !skus.has(p.skuId) || !capacity(p.units) || p.units === 0))
      throw Error("D11_SUPPLY_JOB_INVALID");
    jobs.add(job.id);
  }
  if (input.receipts.some(r => !input.days.includes(r.day) ||
      !skus.has(r.skuId) || !capacity(r.units) || r.units === 0) ||
      input.refusedShipmentIds?.some(id => typeof id !== "string" || !id) ||
      new Set(input.refusedShipmentIds ?? []).size !== (input.refusedShipmentIds ?? []).length)
    throw Error("D11_SUPPLY_RECEIPT_INVALID");
}
export function supplyFingerprint(input: SupplyInput): string {
  const stable = JSON.stringify(input);
  let h = 2166136261;
  for (let i = 0; i < stable.length; i++) {
    h ^= stable.charCodeAt(i); h = Math.imul(h, 16777619);
  }
  return "d11c2-" + (h >>> 0).toString(16).padStart(8, "0");
}

interface Allocation { depotId: string; skuId: string; units: number;
  importance: number; dueDay: string; jobId: string; }
function replenishmentRequests(input: SupplyInput, mode: SupplyMode, day: string,
  depots: Map<string, Record<string, number>>, completed: Set<string>,
  transit: Map<string, Record<string, number>>): Allocation[] {
  const horizon = mode === "advance" ? nextDay(input.days, day) ?? day : day;
  const requests: Allocation[] = [];
  for (const depot of input.depots) {
    const needs = input.jobs.filter(j => j.depotId === depot.id && !completed.has(j.id) &&
      j.dueDay <= horizon).sort((a,b) =>
        (a.priority === "safety" ? 0 : 1) - (b.priority === "safety" ? 0 : 1) ||
        a.dueDay.localeCompare(b.dueDay) || a.id.localeCompare(b.id));
    const assigned = copy(depots.get(depot.id)!);
    const future = transit.get(depot.id) ?? {};
    for (const [sku, units] of Object.entries(future)) add(assigned, sku, units);
    for (const job of needs) {
      for (const line of job.parts) {
        const usable = Math.min(assigned[line.skuId] ?? 0, line.units);
        assigned[line.skuId] = (assigned[line.skuId] ?? 0) - usable;
        if (usable < line.units) requests.push({ depotId: depot.id, skuId: line.skuId,
          units: line.units - usable, importance: job.priority === "safety" ? 0 : 1,
          dueDay: job.dueDay, jobId: job.id });
      }
    }
  }
  return requests.sort((a,b) => a.importance - b.importance ||
    a.dueDay.localeCompare(b.dueDay) || a.jobId.localeCompare(b.jobId) ||
    a.depotId.localeCompare(b.depotId) || a.skuId.localeCompare(b.skuId));
}
function shippingModel(input: SupplyInput, day: string,
  hub: Record<string, number>, orders: Project["orders"]): Project {
  return {
    id: input.id + ":" + day, days: [day], orders, fleet: input.fleet,
    warehouse: input.warehouse, road: input.road,
    fuelMultiplier: input.fuelMultiplier, ownedDailyFixedRub: input.ownedDailyFixedRub,
    inventory: input.parts.map(p => ({
      skuId: p.skuId, openingUnits: hub[p.skuId] ?? 0,
      unitWeightKg: p.unitWeightKg, unitVolumeM3: p.unitVolumeM3,
    })),
  };
}

/** Execute complete working days, with maintenance, transport dispatch, actual
 * refusal, hub quarantine and next-day depot receipts in distinct ledgers. */
export function simulateDepotSupply(input: SupplyInput, mode: SupplyMode): SupplyResult {
  validateSupplyInput(input);
  if (mode !== "reactive" && mode !== "advance") throw Error("D11_SUPPLY_MODE_INVALID");
  const hub = copy(input.hubOpening);
  const depots = new Map(input.depots.map(d => [d.id, copy(d.opening)]));
  const completed = new Set<string>();
  const inbound = new Map<string, { depotId: string; parts: { skuId: string; units: number }[] }[]>();
  const returned = new Map<string, Record<string, number>>();
  const recordedShipments = new Set<string>();
  const history: SupplyDay[] = [];
  let downtimeRub = 0, transportRub = 0, delayJobDays = 0, shippedUnits = 0, acceptedUnits = 0;

  for (const day of input.days) {
    const openingHub = copy(hub), receipts: Record<string, number> = {},
      acceptedReturns: Record<string, number> = {}, depotReceived: Record<string, number> = {};
    for (const r of input.receipts.filter(r => r.day === day)) {
      add(hub, r.skuId, r.units); add(receipts, r.skuId, r.units);
    }
    for (const [sku, units] of Object.entries(returned.get(day) ?? {})) {
      add(hub, sku, units); add(acceptedReturns, sku, units);
    }
    returned.delete(day);
    for (const arrival of inbound.get(day) ?? []) {
      const available = depots.get(arrival.depotId)!;
      for (const line of arrival.parts) {
        add(available, line.skuId, line.units);
        add(depotReceived, line.skuId, line.units);
      }
    }
    inbound.delete(day);

    const todayJobs = input.jobs.filter(j => !completed.has(j.id) && j.dueDay <= day)
      .sort((a,b) => (a.priority === "safety" ? 0 : 1) -
        (b.priority === "safety" ? 0 : 1) || a.dueDay.localeCompare(b.dueDay) ||
        a.id.localeCompare(b.id));
    const completedJobs: string[] = [], waitingJobs: string[] = [];
    let costDowntimeRub = 0;
    for (const job of todayJobs) {
      const stock = depots.get(job.depotId)!;
      if (job.parts.every(p => (stock[p.skuId] ?? 0) >= p.units)) {
        for (const p of job.parts) stock[p.skuId] -= p.units;
        completed.add(job.id); completedJobs.push(job.id);
      } else {
        waitingJobs.push(job.id); delayJobDays++;
        costDowntimeRub += job.downtimeRubPerDay;
      }
    }
    downtimeRub += costDowntimeRub;

    const transitStock = new Map<string, Record<string, number>>();
    for (const [arrivalDay, shipments] of inbound) if (arrivalDay > day)
      for (const ship of shipments) {
        const held = transitStock.get(ship.depotId) ?? {};
        for (const p of ship.parts) add(held, p.skuId, p.units);
        transitStock.set(ship.depotId, held);
      }
    const allocations = new Map<string, Record<string, number>>();
    const uncommitted = copy(hub);
    for (const req of replenishmentRequests(input, mode, day, depots, completed, transitStock)) {
      const units = Math.min(uncommitted[req.skuId] ?? 0, req.units);
      if (!units) continue;
      const chosen = allocations.get(req.depotId) ?? {};
      add(chosen, req.skuId, units);
      allocations.set(req.depotId, chosen);
      uncommitted[req.skuId] -= units;
    }
    const orders: Project["orders"] = [];
    const byOrder = new Map<string, { depotId: string; parts: { skuId: string; units: number }[] }>();
    for (const depot of input.depots) {
      const allocation = allocations.get(depot.id);
      if (!allocation) continue;
      const lines = Object.entries(allocation).filter(([, units]) => units > 0)
        .sort(([a],[b]) => a.localeCompare(b)).map(([skuId, units]) => ({ skuId, units }));
      if (!lines.length) continue;
      const orderId = day + ":" + depot.id;
      if (recordedShipments.has(orderId)) throw Error("D11_SUPPLY_DUPLICATE_SHIPMENT");
      recordedShipments.add(orderId);
      byOrder.set(orderId, { depotId: depot.id, parts: lines });
      orders.push({ id: orderId, day, customerId: depot.id, zone: depot.zone,
        xKm: depot.xKm, yKm: depot.yKm, serviceMinutes: 15,
        windowStart: 550, windowEnd: 1110,
        weightKg: round(lines.reduce((n,l) => n + l.units *
          input.parts.find(p => p.skuId === l.skuId)!.unitWeightKg, 0)),
        volumeM3: round(lines.reduce((n,l) => n + l.units *
          input.parts.find(p => p.skuId === l.skuId)!.unitVolumeM3, 0)),
        lines });
    }
    const deliveryModel = shippingModel(input, day, hub, orders);
    const plan = runScenario(deliveryModel, "to-be");
    if (plan.audit.length) throw Error("D11_SUPPLY_PLAN_AUDIT:" + plan.audit[0]);
    const appliedSettings = {
      ...input.operation, customerRefusalOrderIds: (input.refusedShipmentIds ?? [])
        .filter(id => byOrder.has(id)),
    };
    const fact = simulateOperations(deliveryModel, plan, appliedSettings);
    if (fact.audit.length) throw Error("D11_SUPPLY_FACT_AUDIT:" + fact.audit[0]);
    const inventory = calculateVerifiedInventory(deliveryModel, plan, fact);
    const closingHub: Record<string, number> = {};
    for (const line of inventory.days[0].movements) {
      hub[line.skuId] = line.closingUnits;
      closingHub[line.skuId] = line.closingUnits;
    }
    const visit = new Map(fact.days[0].trips.flatMap(trip =>
      trip.deliveries.map(item => [item.orderId, { ...item,
        vehicleId: trip.vehicleId, returnMinute: trip.returnMinute }] as const)));
    const shipments: SupplyShipment[] = [];
    const issued: Record<string, number> = {};
    for (const order of orders) {
      const status = visit.get(order.id), source = byOrder.get(order.id)!;
      const routeStatus = !status ? "not-routed" : status.status === "refused" ? "refused" : "delivered";
      const availableDay = routeStatus === "delivered" ? nextDay(input.days, day) : null;
      shipments.push({ id: order.id, depotId: source.depotId, day, parts: source.parts,
        routeStatus, availableDay, vehicleId: status?.vehicleId ?? null });
      if (!status) continue;
      for (const p of source.parts) { add(issued, p.skuId, p.units); shippedUnits += p.units; }
      if (status.status !== "refused") {
        for (const p of source.parts) acceptedUnits += p.units;
        if (availableDay) {
          const row = inbound.get(availableDay) ?? [];
          row.push({ depotId: source.depotId, parts: source.parts });
          inbound.set(availableDay, row);
        }
      } else {
        const releaseDay = inspectionReleaseDay(input.days.length
          ? { days: input.days } as Project : deliveryModel, day, status.returnMinute);
        if (releaseDay) {
          const held = returned.get(releaseDay) ?? {};
          for (const p of source.parts) add(held, p.skuId, p.units);
          returned.set(releaseDay, held);
        }
      }
    }
    const inTransit: Record<string, number> = {}, pendingReturns: Record<string, number> = {};
    for (const rows of inbound.values()) for (const item of rows)
      for (const p of item.parts) add(inTransit, p.skuId, p.units);
    for (const held of returned.values())
      for (const [skuId, units] of Object.entries(held)) add(pendingReturns, skuId, units);
    const costTransportRub = fact.totalCostRub;
    transportRub += costTransportRub;
    history.push({ day, openingHub, closingHub, depotStock: Object.fromEntries(
      [...depots].map(([id,stock]) => [id,copy(stock)])), receipts, acceptedReturns,
      completedJobs, waitingJobs, shipments, issued, receivedAtDepots: depotReceived,
      inTransit, pendingReturns, costTransportRub, costDowntimeRub });
  }
  const waitingJobs = input.jobs.filter(j => !completed.has(j.id)).map(j => j.id);
  const audit: string[] = [];
  for (const day of history) {
    for (const sku of input.parts) {
      const id = sku.skuId, expected = (day.openingHub[id] ?? 0) + (day.receipts[id] ?? 0) +
        (day.acceptedReturns[id] ?? 0) - (day.issued[id] ?? 0);
      if (expected !== (day.closingHub[id] ?? 0) || expected < 0)
        audit.push("D11_SUPPLY_HUB_BALANCE:" + day.day + ":" + id);
    }
    for (const [depot, stock] of Object.entries(day.depotStock))
      for (const [sku, units] of Object.entries(stock)) if (!capacity(units))
        audit.push("D11_SUPPLY_DEPOT_BALANCE:" + depot + ":" + sku);
  }
  return {
    caseId: "D11-CASE-002", modelId: input.id, fingerprint: supplyFingerprint(input),
    mode, days: history, totalJobs: input.jobs.length, completedJobs: completed.size,
    waitingJobs, delayJobDays, downtimeRub: round(downtimeRub),
    transportRub: round(transportRub), totalRub: round(downtimeRub + transportRub),
    shippedUnits, acceptedUnits, audit,
  };
}
export function compareDepotSupply(input: SupplyInput): SupplyComparison {
  const reactive = simulateDepotSupply(input, "reactive");
  const advance = simulateDepotSupply(input, "advance");
  if (reactive.audit.length || advance.audit.length) throw Error("D11_SUPPLY_AUDIT_FAILED");
  return { reactive, advance,
    additionalCompleted: advance.completedJobs - reactive.completedJobs,
    avoidedJobDays: reactive.delayJobDays - advance.delayJobDays,
    totalDifferenceRub: round(reactive.totalRub - advance.totalRub) };
}
export function auditDepotSupply(input: SupplyInput, value: SupplyResult): string[] {
  try {
    if (value.audit.length) return ["D11_SUPPLY_STORED_AUDIT"];
    if (!same(value, simulateDepotSupply(input, value.mode)))
      return ["D11_SUPPLY_REPLAY_MISMATCH"];
    return [];
  } catch { return ["D11_SUPPLY_REPLAY_FAILED"]; }
}
