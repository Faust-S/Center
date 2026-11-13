/** D11: reproducible operational replay and plan/fact ledger for route scenarios. */
import { assembleScenario, auditScenario, fingerprintModel, planDay, runScenario, travelMinutes, type Order, type Project, type Scenario, type Vehicle } from "./engine.ts";
import { warehouseOptions } from "./warehouse.ts";
import { calculateInventory, initialStock, receiveStock, subtractDeliveredStock, type InventoryReport } from "./inventory.ts";

export interface OperationSettings {
  trafficPercent: number; dockDelayMinutes: number; extraServiceMinutes: number;
  latePenaltyRub: number; rejectOutOfWindow: boolean;
}
export interface DeliveryActual {
  orderId: string; vehicleId: string; arrivalMinute: number; completionMinute: number;
  contractualEndMinute: number; status: "on-time" | "late" | "refused"; latenessMinutes: number;
}
export interface TripActual {
  vehicleId: string; day: string; tripNumber: number; loadingBay: number; loadStartMinute: number;
  driverBreakStartMinute: number; lastBreakEndMinute: number;
  departMinute: number; returnMinute: number;
  plannedDepartMinute: number; plannedReturnMinute: number;
  actualCostRub: number; extraCostRub: number; latePenaltyRub: number;
  overtimeMinutes: number; breakMinutes: number; deliveries: DeliveryActual[];
}
export interface OperationDay {
  day: string; scheduled: number; executed: number; refused: number; late: number;
  onTime: number; notScheduled: number; actualCostRub: number; plannedCostRub: number;
  trips: TripActual[];
}
export interface OperationReport {
  modelId: string; inputFingerprint: string; mode: Scenario["mode"]; settings: OperationSettings;
  days: OperationDay[]; scheduled: number; executed: number; refused: number; late: number;
  notScheduled: number; onTime: number; totalCostRub: number; plannedCostRub: number;
  overtimeMinutes: number; audit: string[];
}
const round = (x: number): number => Math.round(x * 100) / 100;
const depot = { xKm: 0, yKm: 0 };
const DEFAULT: OperationSettings = {
  trafficPercent: 100, dockDelayMinutes: 0, extraServiceMinutes: 0,
  latePenaltyRub: 2500, rejectOutOfWindow: true,
};
function settingsOf(input: Partial<OperationSettings>): OperationSettings {
  const options = { ...DEFAULT, ...input };
  if (!Number.isFinite(options.trafficPercent) || options.trafficPercent < 50 || options.trafficPercent > 250 ||
      !Number.isSafeInteger(options.dockDelayMinutes) || options.dockDelayMinutes < 0 || options.dockDelayMinutes > 240 ||
      !Number.isSafeInteger(options.extraServiceMinutes) || options.extraServiceMinutes < 0 || options.extraServiceMinutes > 60 ||
      !Number.isFinite(options.latePenaltyRub) || options.latePenaltyRub < 0 ||
      typeof options.rejectOutOfWindow !== "boolean") throw Error("D11_OPERATION_SETTINGS_INVALID");
  return options;
}
/** Operational trips share physical dock and driver calendars across repeated vehicle runs. */
function actualTrip(
  model: Project, vehicle: Vehicle, orders: ReadonlyMap<string, Order>,
  run: Scenario["days"][number]["runs"][number], settings: OperationSettings,
  loadStartMinute: number, driverBreakStartMinute: number,
): TripActual {
  const departMinute = loadStartMinute + model.warehouse.loadMinutes;
  let now = departMinute, previous: { xKm: number; yKm: number; customerId?: string } =
    { xKm: 0, yKm: 0 };
  let breakMinutes = 0, lastBreakEndMinute = driverBreakStartMinute;
  let penaltyRub = 0;
  const deliveries: DeliveryActual[] = [];
  const takeBreak = () => {
    if (now - lastBreakEndMinute >= 240) {
      now += 30; breakMinutes += 30; lastBreakEndMinute = now;
    }
  };
  for (const stop of run.stops) {
    const order = orders.get(stop.orderId);
    if (!order || order.day !== run.day) throw Error("D11_OPERATION_ORDER_MISSING");
    takeBreak();
    now += travelMinutes(model, previous, order, now, settings.trafficPercent / 100);
    const arrivalMinute = Math.max(now, order.windowStart);
    const completionMinute = arrivalMinute + order.serviceMinutes + settings.extraServiceMinutes;
    const latenessMinutes = Math.max(0, completionMinute - order.windowEnd);
    const status: DeliveryActual["status"] = latenessMinutes === 0 ? "on-time"
      : settings.rejectOutOfWindow ? "refused" : "late";
    if (latenessMinutes) penaltyRub += settings.latePenaltyRub;
    deliveries.push({ orderId: order.id, vehicleId: vehicle.id, arrivalMinute, completionMinute,
      contractualEndMinute: order.windowEnd, status, latenessMinutes });
    now = completionMinute;
    previous = order;
  }
  takeBreak();
  now += travelMinutes(model, previous, { xKm: 0, yKm: 0 }, now,
    settings.trafficPercent / 100);
  const overtimeMinutes = Math.max(0, now - vehicle.shiftEnd);
  const variable = round(run.km * vehicle.kmRateRub * (0.65 + 0.35 * model.fuelMultiplier) +
    Math.max(0, now - loadStartMinute - breakMinutes) / 60 * vehicle.hourRateRub +
    (vehicle.kind === "contracted" ? vehicle.activationRub : 0));
  const actualCostRub = round(variable + penaltyRub);
  return { vehicleId: vehicle.id, day: run.day, tripNumber: run.tripNumber, loadingBay: run.loadingBay,
    loadStartMinute, driverBreakStartMinute, lastBreakEndMinute,
    departMinute, returnMinute: now,
    plannedDepartMinute: run.departMinute, plannedReturnMinute: run.returnMinute,
    actualCostRub, extraCostRub: round(actualCostRub - run.costRub), latePenaltyRub: penaltyRub,
    overtimeMinutes, breakMinutes, deliveries };
}
/** Replay one working day in the dispatcher order, respecting shared docks and vehicle returns. */
function replayDayTrips(
  model: Project, day: Scenario["days"][number], settings: OperationSettings,
  orders: ReadonlyMap<string, Order>, vehicles: ReadonlyMap<string, Vehicle>,
): TripActual[] {
  const bayAvailable = new Array<number>(model.warehouse.bays).fill(
    Math.min(...model.fleet.map(v => v.shiftStart)));
  const lastTrip = new Map<string, TripActual>();
  const turnaroundMinutes = warehouseOptions(model).turnaroundMinutes;
  return day.runs.map(run => {
    const vehicle = vehicles.get(run.vehicleId);
    if (!vehicle) throw Error("D11_OPERATION_VEHICLE_MISSING");
    const previous = lastTrip.get(run.vehicleId);
    const readyForNextTrip = previous
      ? previous.returnMinute + turnaroundMinutes : vehicle.shiftStart;
    const loadStartMinute = Math.max(
      run.loadStartMinute + settings.dockDelayMinutes,
      bayAvailable[run.loadingBay], readyForNextTrip,
    );
    const trip = actualTrip(model, vehicle, orders, run, settings, loadStartMinute,
      previous?.lastBreakEndMinute ?? vehicle.shiftStart);
    bayAvailable[run.loadingBay] = trip.departMinute;
    lastTrip.set(run.vehicleId, trip);
    return trip;
  });
}
export function auditOperations(model: Project, plan: Scenario, report: OperationReport): string[] {
  const problems: string[] = [];
  if (report.modelId !== plan.modelId || report.inputFingerprint !== fingerprintModel(model) ||
      report.inputFingerprint !== plan.inputFingerprint || report.mode !== plan.mode ||
      report.days.length !== plan.days.length) problems.push("OPERATION_SCOPE_INVALID");
  const sourceOrders = new Map(model.orders.map(o => [o.id, o]));
  const vehicles = new Map(model.fleet.map(v => [v.id, v]));
  let executed = 0, refused = 0, late = 0, onTime = 0, notScheduled = 0;
  let cost = 0, planned = 0, overtime = 0;
  for (let di = 0; di < plan.days.length; di++) {
    const expected = plan.days[di], actual = report.days[di];
    if (!actual || actual.day !== expected.day || actual.trips.length !== expected.runs.length) {
      problems.push("OPERATION_DAY_INVALID:" + expected.day); continue;
    }
    const plannedVisits = new Set(expected.runs.flatMap(r => r.stops.map(s => s.orderId)));
    const expectedTrips = replayDayTrips(model, expected, report.settings, sourceOrders, vehicles);
    const seen = new Set<string>();
    let dayExecuted = 0, dayRefused = 0, dayLate = 0, dayOnTime = 0, dayCost = expected.fixedOwnedCostRub;
    for (let i = 0; i < actual.trips.length; i++) {
      const trip = actual.trips[i], run = expected.runs[i];
      if (!run || JSON.stringify(trip) !== JSON.stringify(expectedTrips[i])) {
        problems.push("OPERATION_TRIP_REPLAY_INVALID:" + trip.vehicleId);
      }
      if (!expected.runs.some(r => r.vehicleId === trip.vehicleId)) problems.push("OPERATION_VEHICLE_INVALID:" + trip.vehicleId);
      if (!Number.isFinite(trip.actualCostRub) || trip.actualCostRub < 0 ||
          !Number.isFinite(trip.overtimeMinutes) || trip.overtimeMinutes < 0)
        problems.push("OPERATION_TRIP_COST_INVALID:" + trip.vehicleId);
      dayCost += trip.actualCostRub; overtime += trip.overtimeMinutes;
      for (const stop of trip.deliveries) {
        if (!plannedVisits.has(stop.orderId) || seen.has(stop.orderId) ||
            sourceOrders.get(stop.orderId)?.day !== expected.day)
          problems.push("OPERATION_DELIVERY_SCOPE:" + stop.orderId);
        seen.add(stop.orderId);
        if (stop.completionMinute < stop.arrivalMinute ||
            stop.contractualEndMinute !== sourceOrders.get(stop.orderId)?.windowEnd ||
            stop.latenessMinutes !== Math.max(0, stop.completionMinute - stop.contractualEndMinute))
          problems.push("OPERATION_TIMELINE_INVALID:" + stop.orderId);
        if (stop.status === "on-time") {
          if (stop.latenessMinutes !== 0) problems.push("OPERATION_STATUS_INVALID:" + stop.orderId);
          dayExecuted++; dayOnTime++;
        } else if (stop.status === "late") {
          if (stop.latenessMinutes <= 0) problems.push("OPERATION_STATUS_INVALID:" + stop.orderId);
          dayExecuted++; dayLate++;
        } else if (stop.status === "refused") {
          if (stop.latenessMinutes <= 0) problems.push("OPERATION_STATUS_INVALID:" + stop.orderId);
          dayRefused++; dayLate++;
        } else problems.push("OPERATION_UNKNOWN_STATUS:" + stop.orderId);
      }
    }
    if (seen.size !== plannedVisits.size || dayExecuted + dayRefused !== expected.delivered)
      problems.push("OPERATION_ATTEMPT_COVERAGE:" + expected.day);
    if (actual.scheduled !== expected.delivered || actual.notScheduled !== expected.unserved.length ||
        actual.executed !== dayExecuted || actual.refused !== dayRefused ||
        actual.late !== dayLate || actual.onTime !== dayOnTime ||
        Math.abs(actual.actualCostRub - round(dayCost)) > 0.01 ||
        actual.plannedCostRub !== expected.totalCostRub)
      problems.push("OPERATION_DAY_LEDGER:" + expected.day);
    executed += dayExecuted; refused += dayRefused; late += dayLate;
    onTime += dayOnTime; notScheduled += actual.notScheduled;
    cost += actual.actualCostRub; planned += actual.plannedCostRub;
  }
  if (report.executed !== executed || report.refused !== refused ||
      report.late !== late || report.onTime !== onTime || report.notScheduled !== notScheduled ||
      report.scheduled !== plan.delivered || report.executed + report.refused !== plan.delivered ||
      report.executed + report.refused + report.notScheduled !== plan.orderCount ||
      Math.abs(report.totalCostRub - round(cost)) > 0.01 ||
      Math.abs(report.plannedCostRub - round(planned)) > 0.01 ||
      report.overtimeMinutes !== overtime) problems.push("OPERATION_TOTAL_LEDGER");
  return problems;
}
export function simulateOperations(model: Project, plan: Scenario,
  input: Partial<OperationSettings> = {}): OperationReport {
  if (plan.inputFingerprint !== fingerprintModel(model) || plan.modelId !== model.id ||
      plan.audit.length || auditScenario(model, plan.days, plan.unavailableVehicleIds).length ||
      plan.orderCount !== model.orders.length ||
      plan.days.length !== model.days.length) throw Error("D11_OPERATION_PLAN_INVALID");
  const settings = settingsOf(input);
  const orders = new Map(model.orders.map(o => [o.id, o]));
  const vehicles = new Map(model.fleet.map(v => [v.id, v]));
  return summarizeOperations(model, plan, settings,
    plan.days.map(day => operateDay(model, day, settings, orders, vehicles)));
}

/** One day's actual fleet and depot calendar, reused by fixed and adaptive plans. */
function operateDay(
  model: Project, day: Scenario["days"][number], settings: OperationSettings,
  orders: ReadonlyMap<string, Order>, vehicles: ReadonlyMap<string, Vehicle>,
): OperationDay {
  const trips = replayDayTrips(model, day, settings, orders, vehicles);
  const all = trips.flatMap(t => t.deliveries);
  return { day: day.day, scheduled: day.delivered,
    executed: all.filter(x => x.status !== "refused").length,
    refused: all.filter(x => x.status === "refused").length,
    late: all.filter(x => x.latenessMinutes > 0).length,
    onTime: all.filter(x => x.status === "on-time").length,
    notScheduled: day.unserved.length,
    actualCostRub: round(day.fixedOwnedCostRub + trips.reduce((n, t) => n + t.actualCostRub, 0)),
    plannedCostRub: day.totalCostRub, trips };
}
function summarizeOperations(
  model: Project, plan: Scenario, settings: OperationSettings, days: OperationDay[],
): OperationReport {
  const sum = (f: (d: OperationDay) => number) => days.reduce((n, d) => n + f(d), 0);
  const report: OperationReport = {
    modelId: model.id, inputFingerprint: plan.inputFingerprint, mode: plan.mode, settings, days,
    scheduled: plan.delivered, executed: sum(d => d.executed), refused: sum(d => d.refused),
    late: sum(d => d.late), onTime: sum(d => d.onTime), notScheduled: sum(d => d.notScheduled),
    totalCostRub: round(sum(d => d.actualCostRub)), plannedCostRub: round(sum(d => d.plannedCostRub)),
    overtimeMinutes: days.reduce((n, d) => n + d.trips.reduce((k, t) => k + t.overtimeMinutes, 0), 0),
    audit: [],
  };
  report.audit = auditOperations(model, plan, report);
  return report;
}

export function compareOperations(before: OperationReport, after: OperationReport): {
  comparable: boolean; costDifferenceRub: number | null; serviceDelta: number; lateDelta: number;
} {
  if (before.inputFingerprint !== after.inputFingerprint || before.mode !== "as-is" ||
      after.mode !== "to-be" || JSON.stringify(before.settings) !== JSON.stringify(after.settings))
    throw Error("D11_OPERATION_COMPARISON_SCOPE_INVALID");
  const comparable = before.audit.length === 0 && after.audit.length === 0 &&
    before.refused + before.notScheduled === 0 && after.refused + after.notScheduled === 0;
  return { comparable, costDifferenceRub: comparable ? round(before.totalCostRub - after.totalCostRub) : null,
    serviceDelta: after.executed - before.executed, lateDelta: after.late - before.late };
}

/** Verified item-level ledger for a saved project. Never derive stock from an
 * arbitrary browser delivery journal: rebuild every route and delivery event
 * from the input model before releasing or consuming SKU inventory. */
export function calculateVerifiedInventory(
  model: Project, plan: Scenario, actual?: OperationReport,
): InventoryReport {
  if (plan.modelId !== model.id || plan.inputFingerprint !== fingerprintModel(model) ||
      plan.audit.length || plan.orderCount !== model.orders.length ||
      plan.days.length !== model.days.length ||
      auditScenario(model, plan.days, plan.unavailableVehicleIds).length)
    throw Error("D11_INVENTORY_PLAN_UNVERIFIED");
  if (actual && (actual.audit.length || auditOperations(model, plan, actual).length))
    throw Error("D11_INVENTORY_EVENTS_UNVERIFIED");
  const inventory = calculateInventory(model, plan, actual);
  if (inventory.audit.length) throw Error("D11_INVENTORY_BALANCE_UNVERIFIED");
  return inventory;
}

/** Each day is planned only after the previous day's verifiable returns have
 * entered the next working-day inspection cycle. The original plan is immutable. */
export interface ReplanningChange {
  day: string;
  acceptedReturns: { skuId: string; units: number }[];
  originalScheduled: number; revisedScheduled: number;
  newlyScheduledOrders: string[]; removedScheduledOrders: string[];
}
export interface ReplanningResult {
  original: Scenario; revised: Scenario; actual: OperationReport;
  inventory: InventoryReport; changes: ReplanningChange[]; audit: string[];
}
export function replanAfterReturns(
  model: Project, original: Scenario, input: Partial<OperationSettings> = {},
): ReplanningResult {
  if (original.modelId !== model.id || original.inputFingerprint !== fingerprintModel(model) ||
      original.audit.length || original.days.length !== model.days.length ||
      JSON.stringify(original) !== JSON.stringify(
        runScenario(model, original.mode, original.unavailableVehicleIds)))
    throw Error("D11_REPLAN_ORIGINAL_UNVERIFIED");
  const settings = settingsOf(input);
  const orders = new Map(model.orders.map(o => [o.id, o]));
  const vehicles = new Map(model.fleet.map(v => [v.id, v]));
  const stock = initialStock(model);
  const pendingInspection = new Map<string, number>();
  const acceptedReturnsByDay = new Map<string, Map<string, number>>();
  const days: Scenario["days"] = [], actualDays: OperationDay[] = [];
  const changes: ReplanningChange[] = [];

  for (let index = 0; index < model.days.length; index++) {
    const day = model.days[index];
    receiveStock(model, day, stock);
    // No rejected consignment is available again during the day of rejection.
    const accepted = new Map(pendingInspection);
    pendingInspection.clear();
    for (const [sku, units] of accepted) stock.set(sku, (stock.get(sku) ?? 0) + units);
    acceptedReturnsByDay.set(day, accepted);

    const planned = planDay(model, day, original.mode, original.unavailableVehicleIds,
      model.inventory ? stock : undefined);
    const performed = operateDay(model, planned, settings, orders, vehicles);
    days.push(planned);
    actualDays.push(performed);
    subtractDeliveredStock(model, ordersForDay(model, day),
      new Set(planned.runs.flatMap(run => run.stops.map(stop => stop.orderId))), stock);

    for (const rejected of performed.trips.flatMap(trip =>
      trip.deliveries.filter(delivery => delivery.status === "refused"))) {
      const order = orders.get(rejected.orderId);
      if (!order || order.day !== day) throw Error("D11_REPLAN_REFUSAL_INVALID");
      for (const line of order.lines ?? [])
        pendingInspection.set(line.skuId, (pendingInspection.get(line.skuId) ?? 0) + line.units);
    }

    const initialDay = original.days[index];
    const initiallyScheduled = new Set(initialDay.runs.flatMap(run => run.stops.map(stop => stop.orderId)));
    const newlyScheduled = new Set(planned.runs.flatMap(run => run.stops.map(stop => stop.orderId)));
    changes.push({ day,
      acceptedReturns: [...accepted].sort(([a], [b]) => a.localeCompare(b))
        .map(([skuId, units]) => ({ skuId, units })),
      originalScheduled: initialDay.delivered, revisedScheduled: planned.delivered,
      newlyScheduledOrders: [...newlyScheduled].filter(id => !initiallyScheduled.has(id)).sort(),
      removedScheduledOrders: [...initiallyScheduled].filter(id => !newlyScheduled.has(id)).sort() });
  }

  const revised = assembleScenario(model, original.mode, original.unavailableVehicleIds,
    days, acceptedReturnsByDay);
  const actual = summarizeOperations(model, revised, settings, actualDays);
  const inventory = calculateInventory(model, revised, actual);
  const audit = [...revised.audit, ...actual.audit, ...inventory.audit];
  if (audit.length) throw Error("D11_REPLAN_AUDIT_FAILED:" + audit[0]);
  return { original, revised, actual, inventory, changes, audit };
}
function ordersForDay(model: Project, day: string): Order[] {
  return model.orders.filter(order => order.day === day);
}
/** Independent deterministic replay rejects a forged route, returned SKU,
 * delivery event or copied/stale plan before it reaches the T2 Result. */
export function auditReplanning(model: Project, candidate: ReplanningResult): string[] {
  try {
    if (candidate.audit.length) return ["D11_REPLAN_DECLARED_AUDIT"];
    const checked = replanAfterReturns(model, candidate.original, candidate.actual.settings);
    return (["revised", "actual", "inventory", "changes"] as const).flatMap(field =>
      JSON.stringify(candidate[field]) === JSON.stringify(checked[field])
        ? [] : ["D11_REPLAN_REPLAY_MISMATCH:" + field]);
  } catch {
    return ["D11_REPLAN_REPLAY_FAILED"];
  }
}
