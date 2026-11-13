/** D11 accepts real, externally supplied delivery projects, not only CASE-001 generators. */
import { validate, type Project } from "./engine.ts";
export const MAX_D11_PROJECT_JSON_BYTES = 2 * 1024 * 1024;
export const MAX_D11_REPORT_JSON_BYTES = 16 * 1024 * 1024;
type RecordValue = Record<string, unknown>;
const record = (v: unknown): v is RecordValue =>
  v !== null && typeof v === "object" && !Array.isArray(v);

function requireFields(raw: unknown, allowed: readonly string[], required: readonly string[], label: string): RecordValue {
  if (!record(raw) || Object.keys(raw).some(k => !allowed.includes(k)) ||
      required.some(k => !Object.prototype.hasOwnProperty.call(raw, k)))
    throw Error("D11_PROJECT_SHAPE_INVALID:" + label);
  return raw;
}
const ORDER_FIELDS = [
  "id", "day", "customerId", "zone", "xKm", "yKm", "weightKg", "volumeM3",
  "serviceMinutes", "windowStart", "windowEnd", "lines",
] as const;
const REQUIRED_ORDER_FIELDS = ORDER_FIELDS.filter(v => v !== "lines");
const VEHICLE_FIELDS = [
  "id", "kind", "zone", "capacityKg", "capacityM3", "shiftStart", "shiftEnd",
  "kmRateRub", "hourRateRub", "activationRub",
] as const;
const WAREHOUSE_FIELDS = [
  "bays", "loadMinutes", "dailyOrderCapacity", "pickers", "pickMinutesPerOrder",
  "pickingStartMinute", "pickingEndMinute", "turnaroundMinutes", "maxRunsPerVehicle", "maxStopsPerTrip",
] as const;
const ROAD_FIELDS = [
  "gridDetourFactor", "avgKmHour", "trafficPeriods", "travelTimeMatrix", "distanceMatrixKm",
] as const;
/** Parse an input Project or the full JSON report exported by the D11 browser. */
export function importDeliveryProject(input: unknown): Project {
  const envelope = record(input) && input.kind === "D11_CASE001_BROWSER_REPORT"
    ? requireFields(input, ["kind", "parameters", "model", "before", "after", "comparison", "operation", "inventory"], ["model"], "report")
    : null;
  const source = envelope ? envelope.model : input;
  const root = requireFields(source, [
    "id", "days", "orders", "fleet", "warehouse", "road", "ownedDailyFixedRub", "fuelMultiplier", "inventory",
  ], ["id", "days", "orders", "fleet", "warehouse", "road", "ownedDailyFixedRub", "fuelMultiplier"], "project");
  let serialized: string;
  try { serialized = JSON.stringify(root); } catch { throw Error("D11_PROJECT_NOT_JSON"); }
  if (new TextEncoder().encode(serialized).byteLength > MAX_D11_PROJECT_JSON_BYTES)
    throw Error("D11_PROJECT_TOO_LARGE");
  const doc = JSON.parse(serialized) as Project;
  if (!Array.isArray(doc.days) || doc.days.length > 65 ||
      !doc.days.every(d => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d) &&
        !Number.isNaN(Date.parse(d + "T00:00:00.000Z")) &&
        new Date(d + "T00:00:00.000Z").toISOString().slice(0, 10) === d) ||
      !Array.isArray(doc.orders) || doc.orders.length > 15000 ||
      !Array.isArray(doc.fleet) || doc.fleet.length > 250)
    throw Error("D11_PROJECT_SIZE_OR_DATES_INVALID");
  for (const o of doc.orders) {
    requireFields(o, ORDER_FIELDS, REQUIRED_ORDER_FIELDS, "order");
    if (o.lines !== undefined) {
      if (!Array.isArray(o.lines)) throw Error("D11_ORDER_LINES_INVALID");
      for (const line of o.lines) requireFields(line, ["skuId", "units"], ["skuId", "units"], "line");
    }
  }
  if (doc.inventory !== undefined) {
    if (!Array.isArray(doc.inventory) || doc.inventory.length > 250) throw Error("D11_INVENTORY_INVALID");
    for (const sku of doc.inventory) {
      requireFields(sku, ["skuId", "openingUnits", "unitWeightKg", "unitVolumeM3", "receipts"],
        ["skuId", "openingUnits"], "sku");
      if (sku.receipts !== undefined) {
        if (!Array.isArray(sku.receipts)) throw Error("D11_INVENTORY_INVALID");
        for (const receipt of sku.receipts)
          requireFields(receipt, ["day", "units"], ["day", "units"], "receipt");
      }
    }
  }
  for (const v of doc.fleet) requireFields(v, VEHICLE_FIELDS, VEHICLE_FIELDS, "vehicle");
  requireFields(doc.warehouse, WAREHOUSE_FIELDS, WAREHOUSE_FIELDS.slice(0, 3), "warehouse");
  requireFields(doc.road, ROAD_FIELDS, ROAD_FIELDS.slice(0, 2), "road");
  if (doc.road.trafficPeriods !== undefined) {
    if (!Array.isArray(doc.road.trafficPeriods)) throw Error("D11_TRAFFIC_PROFILE_INVALID");
    for (const p of doc.road.trafficPeriods)
      requireFields(p, ["fromMinute", "toMinute", "travelMultiplier"],
        ["fromMinute", "toMinute", "travelMultiplier"], "traffic");
  }
  for (const matrix of [doc.road.travelTimeMatrix, doc.road.distanceMatrixKm]) {
    if (matrix === undefined) continue;
    if (!record(matrix) || Object.keys(matrix).length > 1001) throw Error("D11_MATRIX_INVALID");
    for (const row of Object.values(matrix)) {
      if (!record(row) || Object.keys(row).length > 1001 ||
          Object.values(row).some(v => typeof v !== "number" || !Number.isFinite(v)))
        throw Error("D11_MATRIX_INVALID");
    }
  }
  // The domain validator owns all business rules, including windows,
  // vehicles, road arc coverage and finite warehouse capacity.
  validate(doc);
  return doc;
}
