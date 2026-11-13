/** D11 CASE-001: deterministic, auditable logistics planning. Domain-owned, no UI or storage. */
import { pickWarehouseOrders, selectDock, warehouseOptions } from "./warehouse.ts";
import { initialStock, receiveStock, subtractDeliveredStock, type ProductStock, type OrderLine } from "./inventory.ts";
export type Mode = "as-is" | "to-be";
export interface Order {
  id: string; day: string; customerId: string; zone: number; xKm: number; yKm: number;
  weightKg: number; volumeM3: number; serviceMinutes: number; windowStart: number; windowEnd: number;
  lines?: OrderLine[];
}
export interface Vehicle {
  id: string; kind: "owned" | "contracted"; zone: number; capacityKg: number; capacityM3: number;
  shiftStart: number; shiftEnd: number; kmRateRub: number; hourRateRub: number; activationRub: number;
}
export interface Project {
  id: string; days: string[]; orders: Order[]; fleet: Vehicle[];
  warehouse: {
    bays: number; loadMinutes: number; dailyOrderCapacity: number;
    pickers?: number; pickMinutesPerOrder?: number; pickingStartMinute?: number;
    pickingEndMinute?: number; turnaroundMinutes?: number; maxRunsPerVehicle?: number; maxStopsPerTrip?: number;
  };
  road: {
    gridDetourFactor: number; avgKmHour: number;
    trafficPeriods?: { fromMinute: number; toMinute: number; travelMultiplier: number }[];
    travelTimeMatrix?: Record<string, Record<string, number>>;
    distanceMatrixKm?: Record<string, Record<string, number>>;
  };
  ownedDailyFixedRub: number; fuelMultiplier: number;
  inventory?: ProductStock[];
}
export interface Stop {
  orderId: string; arrivalMinute: number; departureMinute: number; waitMinutes: number;
  legKm: number; weightKg: number; volumeM3: number;
}
export interface Run {
  day: string; vehicleId: string; kind: "owned" | "contracted";
  tripNumber: number; loadingBay: number; loadStartMinute: number;
  driverBreakStartMinute: number; lastBreakEndMinute: number;
  departMinute: number; returnMinute: number; breakMinutes: number; km: number;
  weightKg: number; volumeM3: number; costRub: number; stops: Stop[];
}
export interface DayResult {
  day: string; ordered: number; delivered: number; unserved: { orderId: string; reason: string }[];
  runs: Run[]; fixedOwnedCostRub: number; totalCostRub: number;
}
export interface Scenario {
  modelId: string; inputFingerprint: string; mode: Mode; orderCount: number; delivered: number; unserved: number;
  totalKm: number; totalCostRub: number; costPerDeliveredRub: number | null;
  ownedRuns: number; hiredRuns: number; totalBreakMinutes: number;
  unavailableVehicleIds: string[]; days: DayResult[]; audit: string[];
}
const round = (n: number): number => Math.round(n * 100) / 100;
/** A reproducibility marker, not a cryptographic proof or security mechanism. */
export function fingerprintModel(model: Project): string {
  const content = JSON.stringify(model);
  let fnv = 2166136261, adlerA = 1, adlerB = 0;
  for (let i = 0; i < content.length; i++) {
    const code = content.charCodeAt(i);
    fnv = Math.imul(fnv ^ code, 16777619) >>> 0;
    adlerA = (adlerA + code) % 65521;
    adlerB = (adlerB + adlerA) % 65521;
  }
  return fnv.toString(16).padStart(8, "0") +
    (((adlerB << 16) | adlerA) >>> 0).toString(16).padStart(8, "0");
}
const depot = { xKm: 0, yKm: 0 };
export const distance = (a: { xKm: number; yKm: number }, b: { xKm: number; yKm: number }, factor: number) =>
  (Math.abs(a.xKm - b.xKm) + Math.abs(a.yKm - b.yKm)) * factor;

/** Road-distance costs and vehicle loading must use the same physical arc lengths. */
export function legDistanceKm(
  model: Project, from: { customerId?: string; xKm: number; yKm: number },
  to: { customerId?: string; xKm: number; yKm: number },
): number {
  const sourceId = from.customerId ?? "DEPOT", targetId = to.customerId ?? "DEPOT";
  if (sourceId === targetId) return 0;
  const matrix = model.road.distanceMatrixKm;
  if (matrix) {
    const value = matrix[sourceId]?.[targetId];
    if (!Number.isFinite(value) || value! < 0) throw Error("D11_ROAD_DISTANCE_ARC_MISSING");
    return value!;
  }
  return distance(from, to, model.road.gridDetourFactor);
}
/** Both the planner and operational replay use the same time-dependent road calculation.
 * An explicit customer-to-customer matrix takes precedence over coordinate approximation. */
export function travelMinutes(
  model: Project, from: { customerId?: string; xKm: number; yKm: number },
  to: { customerId?: string; xKm: number; yKm: number }, departMinute: number, factor = 1,
): number {
  const sourceId = from.customerId ?? "DEPOT", targetId = to.customerId ?? "DEPOT";
  let base: number;
  const matrix = model.road.travelTimeMatrix;
  if (sourceId === targetId) base = 0;
  else if (matrix) {
    const value = matrix[sourceId]?.[targetId];
    if (!Number.isFinite(value) || value! < 0) throw Error("D11_ROAD_MATRIX_EDGE_MISSING");
    base = value!;
  } else base = legDistanceKm(model, from, to) / model.road.avgKmHour * 60;
  const traffic = model.road.trafficPeriods?.find(p => departMinute >= p.fromMinute && departMinute < p.toMinute);
  return Math.ceil(base * (traffic?.travelMultiplier ?? 1) * factor);
}

export function validate(model: Project): void {
  if (!model.id || !model.days.length || new Set(model.days).size !== model.days.length || !model.fleet.length ||
      !Number.isSafeInteger(model.warehouse.bays) || model.warehouse.bays < 1 ||
      !Number.isFinite(model.warehouse.loadMinutes) || model.warehouse.loadMinutes <= 0 ||
      !Number.isSafeInteger(model.warehouse.dailyOrderCapacity) || model.warehouse.dailyOrderCapacity < 1 ||
      !Number.isFinite(model.road.gridDetourFactor) || model.road.gridDetourFactor < 1 ||
      !Number.isFinite(model.road.avgKmHour) || model.road.avgKmHour <= 0 ||
      !Number.isFinite(model.fuelMultiplier) || model.fuelMultiplier <= 0 ||
      !Number.isFinite(model.ownedDailyFixedRub) || model.ownedDailyFixedRub < 0) throw Error("D11_MODEL_INVALID");
  const ids = new Set<string>();
  for (const v of model.fleet) {
    if (!v.id || ids.has(v.id) || !Number.isSafeInteger(v.zone) || v.zone < 0 ||
        (v.kind !== "owned" && v.kind !== "contracted") ||
        !Number.isFinite(v.capacityKg) || !Number.isFinite(v.capacityM3) ||
        v.capacityKg <= 0 || v.capacityM3 <= 0 ||
        !Number.isFinite(v.shiftStart) || !Number.isFinite(v.shiftEnd) ||
        v.shiftStart < 0 || v.shiftEnd > 1440 || v.shiftEnd <= v.shiftStart ||
        !Number.isFinite(v.kmRateRub) || !Number.isFinite(v.hourRateRub) ||
        !Number.isFinite(v.activationRub) || v.kmRateRub < 0 || v.hourRateRub < 0 || v.activationRub < 0)
      throw Error("D11_VEHICLE_INVALID");
    ids.add(v.id);
  }
  const wh = warehouseOptions(model);
  if (!Number.isSafeInteger(wh.pickers) || wh.pickers < 1 || wh.pickers > 300 ||
      !Number.isSafeInteger(wh.pickMinutesPerOrder) || wh.pickMinutesPerOrder < 1 ||
      !Number.isSafeInteger(wh.pickingStartMinute) || wh.pickingStartMinute < 0 ||
      !Number.isSafeInteger(wh.pickingEndMinute) || wh.pickingEndMinute > 1440 ||
      wh.pickingEndMinute <= wh.pickingStartMinute ||
      !Number.isSafeInteger(wh.turnaroundMinutes) || wh.turnaroundMinutes < 0 ||
      !Number.isSafeInteger(wh.maxRunsPerVehicle) || wh.maxRunsPerVehicle < 1 || wh.maxRunsPerVehicle > 4 ||
      !Number.isSafeInteger(wh.maxStopsPerTrip) || wh.maxStopsPerTrip < 1 || wh.maxStopsPerTrip > 100)
    throw Error("D11_WAREHOUSE_CONFIG_INVALID");
  const trafficPeriods = model.road.trafficPeriods ?? [];
  if (!Array.isArray(trafficPeriods) || trafficPeriods.some((p, i) =>
      !Number.isSafeInteger(p.fromMinute) || !Number.isSafeInteger(p.toMinute) ||
      p.fromMinute < 0 || p.toMinute > 1440 || p.fromMinute >= p.toMinute ||
      !Number.isFinite(p.travelMultiplier) || p.travelMultiplier < 0.5 || p.travelMultiplier > 4 ||
      trafficPeriods.slice(i + 1).some(next => p.fromMinute < next.toMinute && next.fromMinute < p.toMinute)))
    throw Error("D11_TRAFFIC_PROFILE_INVALID");
  ids.clear();
  const customerLocations = new Map<string, string>();
  for (const o of model.orders) {
    if (!o.id || !o.customerId || ids.has(o.id) || !model.days.includes(o.day) ||
        !Number.isSafeInteger(o.zone) || o.zone < 0 ||
        !Number.isFinite(o.weightKg) || !Number.isFinite(o.volumeM3) ||
        o.weightKg <= 0 || o.volumeM3 <= 0 ||
        !Number.isFinite(o.serviceMinutes) || o.serviceMinutes <= 0 ||
        !Number.isFinite(o.windowStart) || !Number.isFinite(o.windowEnd) ||
        o.windowStart < 0 || o.windowEnd > 1440 || o.windowEnd <= o.windowStart ||
        !Number.isFinite(o.xKm) || !Number.isFinite(o.yKm)) throw Error("D11_ORDER_INVALID");
    const location = JSON.stringify([o.zone, o.xKm, o.yKm]);
    if (customerLocations.has(o.customerId) && customerLocations.get(o.customerId) !== location)
      throw Error("D11_CUSTOMER_LOCATION_CONFLICT");
    customerLocations.set(o.customerId, location);
    ids.add(o.id);
  }
  // SKU demand must be explicit and traceable to a unique stock item.
  if (model.inventory !== undefined) {
    if (!Array.isArray(model.inventory) || !model.inventory.length || model.inventory.length > 250)
      throw Error("D11_INVENTORY_INVALID");
    const skuIds = new Set<string>();
    const skuPhysical = new Map<string, { weight: number | undefined; volume: number | undefined }>();
    for (const item of model.inventory) {
      if (!item.skuId || skuIds.has(item.skuId) ||
          !Number.isSafeInteger(item.openingUnits) || item.openingUnits < 0 ||
          (item.unitWeightKg !== undefined && (!Number.isFinite(item.unitWeightKg) || item.unitWeightKg <= 0)) ||
          (item.unitVolumeM3 !== undefined && (!Number.isFinite(item.unitVolumeM3) || item.unitVolumeM3 <= 0)) ||
          (item.receipts !== undefined && (!Array.isArray(item.receipts) ||
            item.receipts.some(v => !model.days.includes(v.day) ||
              !Number.isSafeInteger(v.units) || v.units <= 0))))
        throw Error("D11_INVENTORY_INVALID");
      skuIds.add(item.skuId);
      skuPhysical.set(item.skuId, { weight: item.unitWeightKg, volume: item.unitVolumeM3 });
    }
    for (const order of model.orders) {
      if (!Array.isArray(order.lines) || !order.lines.length) throw Error("D11_ORDER_LINES_MISSING");
      const seenSku = new Set<string>();
      let expectedWeight = 0, expectedVolume = 0;
      let allWeights = true, allVolumes = true;
      for (const line of order.lines) {
        if (!skuIds.has(line.skuId) || seenSku.has(line.skuId) ||
            !Number.isSafeInteger(line.units) || line.units <= 0) throw Error("D11_ORDER_LINES_INVALID");
        seenSku.add(line.skuId);
        const sku = skuPhysical.get(line.skuId)!;
        if (sku.weight === undefined) allWeights = false;
        else expectedWeight += line.units * sku.weight;
        if (sku.volume === undefined) allVolumes = false;
        else expectedVolume += line.units * sku.volume;
      }
      if ((allWeights && Math.abs(order.weightKg - expectedWeight) > 0.01) ||
          (allVolumes && Math.abs(order.volumeM3 - expectedVolume) > 0.01))
        throw Error("D11_ORDER_CARGO_MISMATCH:" + order.id);
    }
  } else if (model.orders.some(o => o.lines !== undefined)) {
    throw Error("D11_INVENTORY_MISSING");
  }
  const nodes = ["DEPOT", ...customerLocations.keys()];
  // A declared matrix must be complete for the project's clients. Never guess missing arcs.
  for (const spec of [
    { matrix: model.road.travelTimeMatrix, missing: "D11_ROAD_MATRIX_EDGE_MISSING" },
    { matrix: model.road.distanceMatrixKm, missing: "D11_ROAD_DISTANCE_ARC_MISSING" },
  ]) {
    if (!spec.matrix) continue;
    for (const from of nodes) {
      if (!spec.matrix[from] || typeof spec.matrix[from] !== "object") throw Error(spec.missing);
      for (const to of nodes) {
        if (from === to) continue;
        const value = spec.matrix[from][to];
        if (!Number.isFinite(value) || value < 0) throw Error(spec.missing);
      }
    }
  }
}
/** Context is explicit so replay uses exactly the same dock, shift and prior break state. */
export interface RouteSchedule {
  loadStartMinute: number; loadingBay: number; tripNumber: number;
  driverBreakStartMinute: number;
}
/** Evaluate all legs, vehicle capacity, road periods and driver breaks. */
export function evaluateRun(
  model: Project, vehicle: Vehicle, day: string, sequence: Order[], vehicleIndex: number,
  schedule?: RouteSchedule,
): Run | null {
  if (!sequence.length) return null;
  const loadStartMinute = schedule?.loadStartMinute ??
    vehicle.shiftStart + Math.floor(vehicleIndex / model.warehouse.bays) * model.warehouse.loadMinutes;
  const loadingBay = schedule?.loadingBay ?? vehicleIndex % model.warehouse.bays;
  const tripNumber = schedule?.tripNumber ?? 1;
  const driverBreakStartMinute = schedule?.driverBreakStartMinute ?? vehicle.shiftStart;
  const departMinute = loadStartMinute + model.warehouse.loadMinutes;
  const weightKg = sequence.reduce((n, o) => n + o.weightKg, 0);
  const volumeM3 = sequence.reduce((n, o) => n + o.volumeM3, 0);
  if (loadStartMinute < vehicle.shiftStart || departMinute >= vehicle.shiftEnd ||
      !Number.isSafeInteger(tripNumber) || tripNumber < 1 ||
      !Number.isSafeInteger(loadingBay) || loadingBay < 0 || loadingBay >= model.warehouse.bays ||
      weightKg > vehicle.capacityKg || volumeM3 > vehicle.capacityM3 ||
      sequence.length > warehouseOptions(model).maxStopsPerTrip) return null;
  let at: { xKm: number; yKm: number; customerId?: string } = depot;
  let now = departMinute, km = 0, breakMinutes = 0, lastBreakEndMinute = driverBreakStartMinute;
  const stops: Stop[] = [];
  const takeBreak = () => {
    if (now - lastBreakEndMinute >= 240) {
      now += 30; breakMinutes += 30; lastBreakEndMinute = now;
    }
  };
  for (const o of sequence) {
    if (o.day !== day) return null;
    takeBreak();
    const legKm = legDistanceKm(model, at, o);
    now += travelMinutes(model, at, o, now);
    const waitMinutes = Math.max(0, o.windowStart - now);
    now += waitMinutes;
    if (now + o.serviceMinutes > o.windowEnd || now + o.serviceMinutes > vehicle.shiftEnd) return null;
    const arrivalMinute = now; now += o.serviceMinutes;
    stops.push({ orderId: o.id, arrivalMinute, departureMinute: now, waitMinutes,
      legKm: round(legKm), weightKg: o.weightKg, volumeM3: o.volumeM3 });
    km += legKm; at = o;
  }
  takeBreak();
  const returnKm = legDistanceKm(model, at, depot);
  now += travelMinutes(model, at, depot, now); km += returnKm;
  if (now > vehicle.shiftEnd) return null;
  const roundedKm = round(km);
  // The driver's paid shift includes loading and service, but excludes statutory breaks.
  // Fixed own-fleet ownership costs remain a single per-day line on DayResult.
  const costRub = round(roundedKm * vehicle.kmRateRub * (0.65 + 0.35 * model.fuelMultiplier) +
    Math.max(0, now - loadStartMinute - breakMinutes) / 60 * vehicle.hourRateRub +
    (vehicle.kind === "contracted" ? vehicle.activationRub : 0));
  return { day, vehicleId: vehicle.id, kind: vehicle.kind,
    tripNumber, loadingBay, loadStartMinute, driverBreakStartMinute, lastBreakEndMinute,
    departMinute, returnMinute: now, breakMinutes, km: roundedKm, weightKg, volumeM3, costRub, stops };
}
export function planDay(model: Project, day: string, mode: Mode, unavailableIds: readonly string[] = [], stock?: ReadonlyMap<string, number>): DayResult {
  const all = model.orders.filter(o => o.day === day);
  const picked = pickWarehouseOrders(model, day, stock);
  const pending = new Map(picked.accepted.map(o => [o.id, o]));
  const fleet = model.fleet.filter(v => !unavailableIds.includes(v.id));
  const cfg = warehouseOptions(model), bayFreeAt = new Array<number>(model.warehouse.bays).fill(
    Math.min(...model.fleet.map(v => v.shiftStart)));
  const states = new Map(fleet.map(v => [v.id, {
    nextAvailableMinute: v.shiftStart, lastBreakEndMinute: v.shiftStart, trips: 0,
  }]));
  const runs: Run[] = [];
  // A vehicle can return, wait for the turnaround/picking/dock and make a new
  // trip. All runs share the one physical dock calendar and each driver's rest.
  for (let roundNumber = 1; roundNumber <= cfg.maxRunsPerVehicle && pending.size; roundNumber++) {
    for (let index = 0; index < fleet.length && pending.size; index++) {
      const vehicle = fleet[index], state = states.get(vehicle.id)!;
      if (state.trips !== roundNumber - 1) continue;
      const selected: Order[] = [];
      let current: Run | null = null;
      while (pending.size) {
        let best: Order | null = null, bestRun: Run | null = null, bestScore = Infinity;
        const previousStop = selected.length ? selected[selected.length - 1] : depot;
        const distanceToDepot = selected.length
          ? legDistanceKm(model, previousStop, depot) : 0;
        const choices = [...pending.values()]
          .filter(order => mode !== "as-is" || order.zone === vehicle.zone)
          .map(order => ({
            order,
            lowerBound: mode === "as-is"
              ? Math.round(order.xKm / 5) * 1000 + Math.round(order.yKm / 5) * 20 + order.windowEnd / 1000
              : legDistanceKm(model, previousStop, order) +
                legDistanceKm(model, order, depot) - distanceToDepot,
          }))
          .sort((a, b) => a.lowerBound - b.lowerBound || a.order.id.localeCompare(b.order.id));
        for (const item of choices) {
          // An external distance matrix may not satisfy a metric lower bound.
          // Keep exact candidate evaluation in that case, rather than prune a feasible route.
          if (mode === "to-be" && !model.road.distanceMatrixKm &&
              best && item.lowerBound > bestScore + 0.03) break;
          const selectedWithCandidate = [...selected, item.order];
          const readyMinute = Math.max(...selectedWithCandidate.map(o => picked.readyAt.get(o.id)!));
          const dock = selectDock(bayFreeAt,
            Math.max(state.nextAvailableMinute, readyMinute), model.warehouse.loadMinutes);
          const candidate = evaluateRun(model, vehicle, day, selectedWithCandidate, index, {
            loadStartMinute: dock.startMinute, loadingBay: dock.bay,
            tripNumber: roundNumber, driverBreakStartMinute: state.lastBreakEndMinute,
          });
          if (!candidate) continue;
          const score = mode === "as-is" ? item.lowerBound
            : candidate.km - (current?.km ?? 0) +
              candidate.stops[candidate.stops.length - 1].waitMinutes * 0.1;
          if (score < bestScore || (score === bestScore && best && item.order.id < best.id)) {
            best = item.order; bestRun = candidate; bestScore = score;
          }
          if (mode === "as-is") break;
        }
        if (!best || !bestRun) break;
        selected.push(best); pending.delete(best.id); current = bestRun;
      }
      if (!current) continue;
      runs.push(current);
      bayFreeAt[current.loadingBay] = current.departMinute;
      state.nextAvailableMinute = current.returnMinute + cfg.turnaroundMinutes;
      state.lastBreakEndMinute = current.lastBreakEndMinute;
      state.trips++;
    }
  }
  const unserved = [
    ...picked.missed.map(o => ({ orderId: o.id, reason: "warehouse-throughput" })),
    ...picked.shortages.map(o => ({ orderId: o.id, reason: "stock-shortage" })),
    ...[...pending.values()].map(o => ({ orderId: o.id, reason: "fleet-capacity-or-time-window" })),
  ];
  const fixedOwnedCostRub = model.fleet.filter(v => v.kind === "owned").length * model.ownedDailyFixedRub;
  return { day, ordered: all.length, delivered: all.length - unserved.length, runs, unserved,
    fixedOwnedCostRub, totalCostRub: round(fixedOwnedCostRub + runs.reduce((n, r) => n + r.costRub, 0)) };
}
/** Reconstruct the warehouse, dock and vehicle calendars independently of the stored ledger. */
export function auditScenario(model: Project, days: DayResult[], unavailableIds: readonly string[] = []): string[] {
  const issues: string[] = [];
  if (days.length !== model.days.length || new Set(days.map(d => d.day)).size !== model.days.length ||
      model.days.some(day => !days.some(d => d.day === day))) issues.push("DAYS_INCOMPLETE_OR_DUPLICATE");
  const orders = new Map(model.orders.map(o => [o.id, o]));
  const vehicles = new Map(model.fleet.map(v => [v.id, v]));
  const cfg = warehouseOptions(model);
  const inventoryStock = initialStock(model);
  for (const day of days) {
    receiveStock(model, day.day, inventoryStock);
    const picked = pickWarehouseOrders(model, day.day, model.inventory ? inventoryStock : undefined);
    const pickedIds = new Set(picked.accepted.map(o => o.id));
    const missedIds = new Set(picked.missed.map(o => o.id));
    const shortageIds = new Set(picked.shortages.map(o => o.id));
    const observed = new Set<string>();
    const available = model.fleet.filter(v => !unavailableIds.includes(v.id));
    const dockAvailable = new Array<number>(model.warehouse.bays).fill(
      Math.min(...model.fleet.map(v => v.shiftStart)));
    const vehicleStates = new Map(available.map(v => [v.id, {
      nextAvailableMinute: v.shiftStart, lastBreakEndMinute: v.shiftStart, trips: 0,
    }]));
    for (const run of day.runs) {
      const vehicle = vehicles.get(run.vehicleId), index = available.findIndex(v => v.id === run.vehicleId);
      const state = vehicleStates.get(run.vehicleId);
      if (!vehicle || index < 0 || !state) {
        issues.push("UNKNOWN_OR_UNAVAILABLE_VEHICLE:" + run.vehicleId); continue;
      }
      if (state.trips >= cfg.maxRunsPerVehicle || run.tripNumber !== state.trips + 1)
        issues.push("TRIP_LIMIT_OR_SEQUENCE:" + run.vehicleId);
      const sequence = run.stops.map(s => orders.get(s.orderId));
      if (!sequence.length || sequence.some(o => !o || o.day !== day.day || !pickedIds.has(o.id))) {
        issues.push("INVALID_OR_UNPICKED_ROUTE:" + run.vehicleId); continue;
      }
      const readyMinute = Math.max(...(sequence as Order[]).map(o => picked.readyAt.get(o.id)!));
      const dock = selectDock(dockAvailable,
        Math.max(state.nextAvailableMinute, readyMinute), model.warehouse.loadMinutes);
      const recalculated = evaluateRun(model, vehicle, day.day, sequence as Order[], index, {
        loadStartMinute: dock.startMinute, loadingBay: dock.bay,
        tripNumber: state.trips + 1, driverBreakStartMinute: state.lastBreakEndMinute,
      });
      if (!recalculated || JSON.stringify(recalculated) !== JSON.stringify(run))
        issues.push("INVALID_ROUTE_OR_DOCK:" + run.vehicleId);
      // Even if the ledger is damaged, never trust it to derive future calendar authority.
      if (recalculated) {
        dockAvailable[recalculated.loadingBay] = recalculated.departMinute;
        state.nextAvailableMinute = recalculated.returnMinute + cfg.turnaroundMinutes;
        state.lastBreakEndMinute = recalculated.lastBreakEndMinute;
        state.trips++;
      }
      for (const stop of run.stops) {
        if (observed.has(stop.orderId)) issues.push("DUPLICATE_DELIVERY:" + stop.orderId);
        observed.add(stop.orderId);
      }
    }
    for (const item of day.unserved) {
      if (observed.has(item.orderId)) issues.push("DELIVERED_AND_UNSERVED:" + item.orderId);
      const omitted = orders.get(item.orderId);
      if (!omitted || omitted.day !== day.day ||
          (missedIds.has(item.orderId) ? item.reason !== "warehouse-throughput" :
            shortageIds.has(item.orderId) ? item.reason !== "stock-shortage" :
            !pickedIds.has(item.orderId) || item.reason !== "fleet-capacity-or-time-window"))
        issues.push("INVALID_UNSERVED:" + item.orderId);
      observed.add(item.orderId);
    }
    const expected = model.orders.filter(o => o.day === day.day);
    if (expected.some(o => !observed.has(o.id)) || observed.size !== expected.length ||
        day.ordered !== expected.length || day.delivered !== day.runs.reduce((n, r) => n + r.stops.length, 0) ||
        day.delivered + day.unserved.length !== day.ordered) issues.push("COUNT_MISMATCH:" + day.day);
    try {
      subtractDeliveredStock(model, expected, new Set(day.runs.flatMap(r => r.stops.map(s => s.orderId))), inventoryStock);
    } catch { issues.push("STOCK_OVERCOMMITTED:" + day.day); }
    const fixed = model.fleet.filter(v => v.kind === "owned").length * model.ownedDailyFixedRub;
    if (day.fixedOwnedCostRub !== fixed || Math.abs(day.totalCostRub -
      round(fixed + day.runs.reduce((n, r) => n + r.costRub, 0))) > 0.01)
      issues.push("COST_MISMATCH:" + day.day);
  }
  return issues;
}
export function runScenario(model: Project, mode: Mode, unavailableIds: readonly string[] = []): Scenario {
  validate(model);
  if (mode !== "as-is" && mode !== "to-be") throw Error("D11_UNKNOWN_MODE");
  if (unavailableIds.some(id => !model.fleet.some(v => v.id === id))) throw Error("D11_UNKNOWN_UNAVAILABLE_VEHICLE");
  const stock = initialStock(model);
  const days: DayResult[] = [];
  for (const day of model.days) {
    receiveStock(model, day, stock);
    const planned = planDay(model, day, mode, unavailableIds, model.inventory ? stock : undefined);
    subtractDeliveredStock(model, model.orders.filter(o => o.day === day),
      new Set(planned.runs.flatMap(r => r.stops.map(s => s.orderId))), stock);
    days.push(planned);
  }
  const delivered = days.reduce((n, d) => n + d.delivered, 0);
  const totalCostRub = round(days.reduce((n, d) => n + d.totalCostRub, 0));
  return { modelId: model.id, inputFingerprint: fingerprintModel(model), mode, orderCount: model.orders.length, delivered,
    unserved: model.orders.length - delivered,
    totalKm: round(days.reduce((n, d) => n + d.runs.reduce((m, r) => m + r.km, 0), 0)),
    totalCostRub, costPerDeliveredRub: delivered ? round(totalCostRub / delivered) : null,
    ownedRuns: days.reduce((n, d) => n + d.runs.filter(r => r.kind === "owned").length, 0),
    hiredRuns: days.reduce((n, d) => n + d.runs.filter(r => r.kind === "contracted").length, 0),
    totalBreakMinutes: days.reduce((n, d) => n + d.runs.reduce((m, r) => m + r.breakMinutes, 0), 0),
    unavailableVehicleIds: [...new Set(unavailableIds)].sort(), days,
    audit: auditScenario(model, days, unavailableIds) };
}
export interface Comparison {
  comparable: boolean; reason: string | null; savedRub: number | null; savedPercent: number | null;
  distanceDeltaKm: number; deliveryDelta: number;
}
export function compareScenarios(before: Scenario, after: Scenario): Comparison {
  if (before.modelId !== after.modelId || before.inputFingerprint !== after.inputFingerprint || before.orderCount !== after.orderCount ||
      before.mode !== "as-is" || after.mode !== "to-be" ||
      JSON.stringify(before.unavailableVehicleIds) !== JSON.stringify(after.unavailableVehicleIds))
    throw Error("D11_COMPARISON_INPUT_INVALID");
  const comparable = !before.audit.length && !after.audit.length && !before.unserved && !after.unserved;
  const savedRub = comparable ? round(before.totalCostRub - after.totalCostRub) : null;
  return { comparable, reason: comparable ? null : "INCOMPLETE_OR_UNAUDITED_DELIVERY", savedRub,
    savedPercent: savedRub !== null && before.totalCostRub > 0 ? round(100 * savedRub / before.totalCostRub) : null,
    distanceDeltaKm: round(before.totalKm - after.totalKm), deliveryDelta: after.delivered - before.delivered };
}
