/** Deterministic warehouse picking and dock calendar for D11 transport plans. */
import type { Order, Project } from "./engine.ts";

export interface WarehouseDay {
  accepted: Order[];
  missed: Order[];
  shortages: Order[];
  readyAt: ReadonlyMap<string, number>;
}
export interface DockReservation { bay: number; startMinute: number; endMinute: number; }
export interface DockBlock extends DockReservation { day: string; reference: string; }
export function warehouseOptions(model: Project) {
  return {
    pickers: model.warehouse.pickers ?? 20,
    pickMinutesPerOrder: model.warehouse.pickMinutesPerOrder ?? 4,
    pickingStartMinute: model.warehouse.pickingStartMinute ?? 360,
    pickingEndMinute: model.warehouse.pickingEndMinute ?? 1140,
    turnaroundMinutes: model.warehouse.turnaroundMinutes ?? 15,
    maxRunsPerVehicle: model.warehouse.maxRunsPerVehicle ?? 1,
    maxStopsPerTrip: model.warehouse.maxStopsPerTrip ?? 100,
  };
}
export function pickWarehouseOrders(model: Project, day: string, stockAvailable?: ReadonlyMap<string, number>): WarehouseDay {
  const cfg = warehouseOptions(model);
  const sorted = model.orders.filter(o => o.day === day)
    .sort((a, b) => a.windowEnd - b.windowEnd || a.windowStart - b.windowStart || a.id.localeCompare(b.id));
  const workers = new Array<number>(cfg.pickers).fill(cfg.pickingStartMinute);
  const ready = new Map<string, number>();
  const accepted: Order[] = [], missed: Order[] = [], shortages: Order[] = [];
  const available = stockAvailable ? new Map(stockAvailable) : undefined;
  for (const order of sorted) {
    if (accepted.length >= model.warehouse.dailyOrderCapacity) { missed.push(order); continue; }
    if (available && order.lines?.some(line => (available.get(line.skuId) ?? 0) < line.units)) {
      shortages.push(order); continue;
    }
    let first = 0;
    for (let i = 1; i < workers.length; i++) if (workers[i] < workers[first]) first = i;
    const completed = workers[first] + cfg.pickMinutesPerOrder;
    if (completed > cfg.pickingEndMinute) { missed.push(order); continue; }
    workers[first] = completed;
    for (const line of order.lines ?? [])
      if (available) available.set(line.skuId, (available.get(line.skuId) ?? 0) - line.units);
    ready.set(order.id, completed);
    accepted.push(order);
  }
  return { accepted, missed, shortages, readyAt: ready };
}
/** Reserve the earliest feasible bay without colliding with real inbound
 * reservations. The old three-argument call remains byte-for-byte equivalent
 * for projects with no reserved inbound/maintenance windows. */
export function selectDock(
  bayFreeAt: readonly number[], requiredAt: number, loadMinutes: number,
  blocked: readonly DockReservation[] = [],
): DockReservation {
  if (!bayFreeAt.length || !Number.isFinite(requiredAt) ||
      !Number.isFinite(loadMinutes) || loadMinutes <= 0)
    throw Error("D11_DOCK_REQUEST_INVALID");
  const beginsAt = (bay: number) => {
    let start = Math.max(requiredAt, bayFreeAt[bay]);
    for (const block of blocked.filter(x => x.bay === bay)
      .sort((a,b) => a.startMinute - b.startMinute)) {
      if (start < block.endMinute && start + loadMinutes > block.startMinute)
        start = block.endMinute;
    }
    return start;
  };
  let best = 0, startMinute = beginsAt(0);
  for (let bay = 1; bay < bayFreeAt.length; bay++) {
    const t = beginsAt(bay);
    if (t < startMinute) { best = bay; startMinute = t; }
  }
  return { bay: best, startMinute, endMinute: startMinute + loadMinutes };
}
