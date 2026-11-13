/** Canonical D11 CASE-001 proposal: same result model for the browser and T2 Workspace. */
import { createCase001 } from "./case001.ts";
import { importDeliveryProject } from "./project-import.ts";
import type { InventoryReport } from "./inventory.ts";
import { auditScenario, compareScenarios, fingerprintModel, type Project, type Scenario } from "./engine.ts";
import { auditOperations, compareOperations, calculateVerifiedInventory, replanAfterReturns, auditReplanning, type OperationReport, type ReplanningResult } from "./execution.ts";

export const CASE001_ALGORITHM_VERSION = "d11.delivery-network-planner/1.5.0";
export interface DeliveryEditorState {
  days: number; orders: number; demand: number; fuel: number; breakdown: number;
  trafficPercent: number; dockDelayMinutes: number; extraServiceMinutes: number;
  pickingWorkers?: number; maxRunsPerVehicle?: number; peakTravelPercent?: number; maxStopsPerTrip?: number;
  stockCoveragePercent?: number;
  importedModel?: Project | null;
}
export interface DeliveryProjectInput {
  state: DeliveryEditorState; model: Project; before: Scenario; after: Scenario;
  operationBefore: OperationReport; operationAfter: OperationReport;
}
function compactPlan(s: Scenario) {
  return {
    mode: s.mode, inputFingerprint: s.inputFingerprint,
    orderCount: s.orderCount, delivered: s.delivered, unserved: s.unserved,
    totalKm: s.totalKm, totalCostRub: s.totalCostRub,
    costPerDeliveredRub: s.costPerDeliveredRub,
    ownedRuns: s.ownedRuns, hiredRuns: s.hiredRuns, audit: s.audit,
    days: s.days.map(d => ({
      day: d.day, ordered: d.ordered, delivered: d.delivered,
      unservedByReason: {
        warehouse: d.unserved.filter(v => v.reason === "warehouse-throughput").map(v => v.orderId),
        transport: d.unserved.filter(v => v.reason === "fleet-capacity-or-time-window").map(v => v.orderId),
        stock: d.unserved.filter(v => v.reason === "stock-shortage").map(v => v.orderId),
      },
      fixedOwnedCostRub: d.fixedOwnedCostRub, totalCostRub: d.totalCostRub,
      runs: d.runs.map(r => ({
        vehicleId: r.vehicleId, kind: r.kind, km: r.km, costRub: r.costRub,
        tripNumber: r.tripNumber, loadingBay: r.loadingBay,
        loadStartMinute: r.loadStartMinute, driverBreakStartMinute: r.driverBreakStartMinute,
        lastBreakEndMinute: r.lastBreakEndMinute,
        departMinute: r.departMinute, returnMinute: r.returnMinute,
        stops: r.stops.map(stop => stop.orderId),
      })),
    })),
  };
}
function compactFact(r: OperationReport) {
  return {
    mode: r.mode, settings: r.settings,
    executed: r.executed, refused: r.refused, notScheduled: r.notScheduled,
    late: r.late, onTime: r.onTime, totalCostRub: r.totalCostRub,
    plannedCostRub: r.plannedCostRub, overtimeMinutes: r.overtimeMinutes, audit: r.audit,
    days: r.days.map(d => ({
      day: d.day, executed: d.executed, refused: d.refused, late: d.late,
      onTime: d.onTime, actualCostRub: d.actualCostRub, plannedCostRub: d.plannedCostRub,
      trips: d.trips.map(t => ({
        vehicleId: t.vehicleId, tripNumber: t.tripNumber,
        loadingBay: t.loadingBay, loadStartMinute: t.loadStartMinute,
        departMinute: t.departMinute, returnMinute: t.returnMinute,
        extraCostRub: t.extraCostRub, overtimeMinutes: t.overtimeMinutes,
        refusedOrders: t.deliveries.filter(v => v.status === "refused").map(v => v.orderId),
        lateOrders: t.deliveries.filter(v => v.latenessMinutes > 0).map(v => v.orderId),
      })),
    })),
  };
}
function compactInventory(report: InventoryReport) {
  return {
    totalReceipts: report.totalReceipts, totalIssued: report.totalIssued,
    totalDelivered: report.totalDelivered, totalReturned: report.totalReturned,
    pendingReturnUnits: report.pendingReturnUnits, audit: report.audit,
    days: report.days.map(d => ({
      day: d.day, issuedOrders: d.issuedOrders, deliveredOrders: d.deliveredOrders,
      returnedOrders: d.returnedOrders, excludedShortages: d.excludedShortages,
      movements: d.movements.map(m => ({
        skuId: m.skuId, openingUnits: m.openingUnits, receipts: m.receipts,
        issued: m.issued, returned: m.returned, closingUnits: m.closingUnits,
        delivered: m.delivered, awaitingInspection: m.awaitingInspection,
      })),
    })),
  };
}
export function compactReplanning(result: ReplanningResult) {
  return {
    initialPlanFingerprint: result.original.inputFingerprint,
    revisedPlanFingerprint: result.revised.inputFingerprint,
    originalScheduled: result.original.delivered,
    revisedScheduled: result.revised.delivered,
    actualDelivered: result.actual.executed,
    actualRefused: result.actual.refused,
    revisedTotalKm: result.revised.totalKm,
    revisedPlanCostRub: result.revised.totalCostRub,
    revisedActualCostRub: result.actual.totalCostRub,
    inventory: compactInventory(result.inventory),
    changes: result.changes,
    days: result.revised.days.map(d => ({
      day: d.day, delivered: d.delivered, unserved: d.unserved,
      runs: d.runs.map(r => ({ vehicleId: r.vehicleId, tripNumber: r.tripNumber,
        departMinute: r.departMinute, returnMinute: r.returnMinute,
        stops: r.stops.map(s => s.orderId) })),
    })),
    audit: result.audit,
  };
}
export function buildCase001ProposalData(input: DeliveryProjectInput) {
  const { state, model, before, after, operationBefore, operationAfter } = input;
  const reconstructed = state.importedModel
    ? importDeliveryProject(state.importedModel)
    : createCase001({
      days: state.days, dailyOrders: state.orders,
      demandMultiplier: state.demand / 100, fuelMultiplier: state.fuel / 100,
      pickingWorkers: state.pickingWorkers, maxRunsPerVehicle: state.maxRunsPerVehicle,
      peakTravelPercent: state.peakTravelPercent, maxStopsPerTrip: state.maxStopsPerTrip,
      stockCoveragePercent: state.stockCoveragePercent,
    });
  const signature = fingerprintModel(model);
  if (signature !== fingerprintModel(reconstructed) ||
      model.id !== before.modelId || model.id !== after.modelId ||
      before.inputFingerprint !== signature || after.inputFingerprint !== signature ||
      auditScenario(model, before.days, before.unavailableVehicleIds).length ||
      auditScenario(model, after.days, after.unavailableVehicleIds).length ||
      before.audit.length || after.audit.length) throw Error("D11_CASE001_PROPOSAL_PLAN_INVALID");
  const unavailable = model.fleet.filter(v => v.kind === "owned").slice(0, state.breakdown).map(v => v.id).sort();
  if (JSON.stringify(unavailable) !== JSON.stringify(before.unavailableVehicleIds) ||
      JSON.stringify(unavailable) !== JSON.stringify(after.unavailableVehicleIds))
    throw Error("D11_CASE001_PROPOSAL_FLEET_INVALID");
  const actualSettings = { trafficPercent: state.trafficPercent,
    dockDelayMinutes: state.dockDelayMinutes, extraServiceMinutes: state.extraServiceMinutes,
    latePenaltyRub: 2500, rejectOutOfWindow: true };
  if (operationBefore.inputFingerprint !== signature || operationAfter.inputFingerprint !== signature ||
      JSON.stringify(operationBefore.settings) !== JSON.stringify(actualSettings) ||
      JSON.stringify(operationAfter.settings) !== JSON.stringify(actualSettings) ||
      auditOperations(model, before, operationBefore).length ||
      auditOperations(model, after, operationAfter).length ||
      operationBefore.audit.length || operationAfter.audit.length)
    throw Error("D11_CASE001_PROPOSAL_EXECUTION_INVALID");
  const inventoryBefore = calculateVerifiedInventory(model, before, operationBefore);
  const inventoryAfter = calculateVerifiedInventory(model, after, operationAfter);
  if (inventoryBefore.audit.length || inventoryAfter.audit.length)
    throw Error("D11_CASE001_INVENTORY_INVALID");
  const comparison = compareScenarios(before, after);
  const operationalComparison = compareOperations(operationBefore, operationAfter);
  const adaptive = model.inventory ? replanAfterReturns(model, after, actualSettings) : null;
  if (adaptive && auditReplanning(model, adaptive).length)
    throw Error("D11_CASE001_REPLAN_INVALID");
  return {
    _editorState: { ...state },
    generator: state.importedModel ? "D11_IMPORTED_PROJECT_V1" : "D11_CASE001_DETERMINISTIC_V1",
    modelId: model.id, algorithmVersion: CASE001_ALGORITHM_VERSION,
    modelFingerprint: signature,
    scenarioInputs: state.importedModel
      ? { source: "IMPORTED_PROJECT", projectId: model.id,
          days: model.days.length, orders: model.orders.length,
          vehicles: model.fleet.length, unavailableOwnedVehicles: state.breakdown }
      : { source: "CASE001_GENERATOR", days: state.days, dailyOrders: state.orders,
          demandMultiplier: state.demand / 100, fuelMultiplier: state.fuel / 100,
          unavailableOwnedVehicles: state.breakdown,
          pickingWorkers: state.pickingWorkers ?? 20,
          maxRunsPerVehicle: state.maxRunsPerVehicle ?? 2,
          peakTravelPercent: state.peakTravelPercent ?? 120, maxStopsPerTrip: state.maxStopsPerTrip ?? 12,
          stockCoveragePercent: state.stockCoveragePercent ?? 100 },
    before: compactPlan(before), after: compactPlan(after), comparison,
    replanning: adaptive ? compactReplanning(adaptive) : null,
    inventory: model.inventory ? { before: compactInventory(inventoryBefore), after: compactInventory(inventoryAfter) } : null,
    operation: { before: compactFact(operationBefore), after: compactFact(operationAfter),
      comparison: operationalComparison },
  };
}
