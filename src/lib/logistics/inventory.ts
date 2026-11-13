/** SKU stock movements and reverse-logistics bookkeeping for the existing D11 project. */
import type { Order, Project, Scenario } from "./engine.ts";
import type { OperationReport } from "./execution.ts";

export interface ProductStock {
  skuId: string;
  openingUnits: number;
  unitWeightKg?: number; unitVolumeM3?: number;
  receipts?: { day: string; units: number }[];
}
export interface OrderLine { skuId: string; units: number; }
export interface StockMovement {
  skuId: string; openingUnits: number; receipts: number;
  issued: number; returned: number; closingUnits: number;
  delivered: number; awaitingInspection: number;
}
export interface InventoryDay {
  day: string; movements: StockMovement[];
  issuedOrders: number; deliveredOrders: number; returnedOrders: number;
  excludedShortages: number;
}
export interface InventoryReport {
  modelId: string; inputFingerprint: string; mode: Scenario["mode"];
  days: InventoryDay[]; totalReceipts: number; totalIssued: number;
  totalDelivered: number; totalReturned: number;
  pendingReturnUnits: number; audit: string[];
}
export function initialStock(model: Project): Map<string, number> {
  return new Map((model.inventory ?? []).map(s => [s.skuId, s.openingUnits]));
}
export function receiveStock(model: Project, day: string, stock: Map<string, number>): Map<string, number> {
  const received = new Map<string, number>();
  for (const sku of model.inventory ?? []) {
    const qty = (sku.receipts ?? []).filter(r => r.day === day).reduce((n, r) => n + r.units, 0);
    if (qty) {
      stock.set(sku.skuId, (stock.get(sku.skuId) ?? 0) + qty);
      received.set(sku.skuId, qty);
    }
  }
  return received;
}
export function orderUnits(order: Order): Map<string, number> {
  return new Map((order.lines ?? []).map(line => [line.skuId, line.units]));
}
export function subtractDeliveredStock(
  model: Project, dayOrders: readonly Order[], deliveredIds: ReadonlySet<string>,
  stock: Map<string, number>,
): void {
  if (!model.inventory) return;
  for (const order of dayOrders) {
    if (!deliveredIds.has(order.id)) continue;
    for (const line of order.lines ?? []) {
      const available = stock.get(line.skuId) ?? 0;
      if (available < line.units) throw Error("D11_STOCK_OVERCOMMITTED:" + line.skuId);
      stock.set(line.skuId, available - line.units);
    }
  }
}
/** Plan/fact SKU movements. Returned consignments enter the warehouse *next*
 * working day after the vehicle comes back, never on the day of refusal.
 * Unschedulable and never-loaded orders do not consume inventory. */
export function calculateInventory(
  model: Project, plan: Scenario, actual?: OperationReport,
): InventoryReport {
  if (!model.inventory) return {
    modelId: model.id, inputFingerprint: plan.inputFingerprint, mode: plan.mode,
    days: [], totalReceipts: 0, totalIssued: 0, totalDelivered: 0,
    totalReturned: 0, pendingReturnUnits: 0, audit: [],
  };
  if (plan.modelId !== model.id || plan.days.length !== model.days.length ||
      (actual && (actual.inputFingerprint !== plan.inputFingerprint || actual.mode !== plan.mode ||
        actual.days.length !== plan.days.length))) throw Error("D11_INVENTORY_INPUT_MISMATCH");
  const stock = initialStock(model);
  const byId = new Map(model.orders.map(o => [o.id, o]));
  const pending = new Map<string, number>();
  const result: InventoryDay[] = [];
  const violations: string[] = [];
  let totalReceipts = 0, totalIssued = 0, totalDelivered = 0, totalReturned = 0;
  for (let i = 0; i < model.days.length; i++) {
    const day = model.days[i], planned = plan.days[i], operational = actual?.days[i];
    if (planned.day !== day || (operational && operational.day !== day)) throw Error("D11_INVENTORY_DAY_MISMATCH");
    const opening = new Map(stock);
    const pendingFromYesterday = new Map(pending);
    const receipts = receiveStock(model, day, stock);
    // Items rejected by a customer are physically returned to the depot and
    // released only after next-day inspection. No same-day stock reuse.
    for (const [sku, units] of pendingFromYesterday) {
      stock.set(sku, (stock.get(sku) ?? 0) + units);
      pending.delete(sku);
    }
    const visits = planned.runs.flatMap(r => r.stops.map(s => s.orderId));
    const deliveredIds = operational
      ? operational.trips.flatMap(r => r.deliveries.filter(d => d.status !== "refused").map(d => d.orderId))
      : visits;
    const refusedIds = operational
      ? operational.trips.flatMap(r => r.deliveries.filter(d => d.status === "refused").map(d => d.orderId))
      : [];
    const issued = new Map<string, number>();
    const delivered = new Map<string, number>();
    const refused = new Map<string, number>();
    const add = (target: Map<string, number>, orderId: string) => {
      const order = byId.get(orderId);
      if (!order || order.day !== day) {
        violations.push("INVENTORY_ORDER_INVALID:" + orderId); return;
      }
      for (const line of order.lines ?? [])
        target.set(line.skuId, (target.get(line.skuId) ?? 0) + line.units);
    };
    for (const id of visits) add(issued, id);
    for (const id of deliveredIds) add(delivered, id);
    for (const id of refusedIds) add(refused, id);
    for (const [sku, units] of issued) {
      const available = stock.get(sku) ?? 0;
      if (available < units) violations.push("INVENTORY_NEGATIVE_STOCK:" + day + ":" + sku);
      stock.set(sku, available - units);
    }
    for (const [sku, units] of refused) pending.set(sku, (pending.get(sku) ?? 0) + units);
    const movements = model.inventory.map(entry => {
      const sku = entry.skuId, start = opening.get(sku) ?? 0, receiptsUnits = receipts.get(sku) ?? 0;
      const returned = pendingFromYesterday.get(sku) ?? 0;
      const issuedUnits = issued.get(sku) ?? 0, deliveredUnits = delivered.get(sku) ?? 0;
      const returnedUnits = refused.get(sku) ?? 0;
      const closing = stock.get(sku) ?? 0;
      if (closing !== start + receiptsUnits + returned - issuedUnits ||
          issuedUnits !== deliveredUnits + returnedUnits)
        violations.push("INVENTORY_BALANCE_MISMATCH:" + day + ":" + sku);
      totalReceipts += receiptsUnits; totalIssued += issuedUnits;
      totalDelivered += deliveredUnits; totalReturned += returned;
      return { skuId: sku, openingUnits: start, receipts: receiptsUnits,
        issued: issuedUnits, returned, closingUnits: closing,
        delivered: deliveredUnits, awaitingInspection: pending.get(sku) ?? 0 };
    });
    result.push({ day, movements, issuedOrders: visits.length,
      deliveredOrders: deliveredIds.length, returnedOrders: refusedIds.length,
      excludedShortages: planned.unserved.filter(v => v.reason === "stock-shortage").length });
  }
  const pendingReturnUnits = [...pending.values()].reduce((n, x) => n + x, 0);
  if (result.some(d => d.movements.some(m => m.closingUnits < 0))) violations.push("INVENTORY_NEGATIVE_CLOSING");
  return { modelId: model.id, inputFingerprint: plan.inputFingerprint, mode: plan.mode,
    days: result, totalReceipts, totalIssued, totalDelivered, totalReturned,
    pendingReturnUnits, audit: violations };
}
