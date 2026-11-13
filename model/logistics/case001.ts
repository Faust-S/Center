import type { Order, Vehicle, Project } from "./engine.ts";

export interface Case001Options {
  days?: number; dailyOrders?: number; demandMultiplier?: number; fuelMultiplier?: number;
  pickingWorkers?: number; maxRunsPerVehicle?: number; peakTravelPercent?: number; maxStopsPerTrip?: number;
  stockCoveragePercent?: number;
}
// Reproducible regional distribution operator, anchored to published industry-scale use cases.
// No fabricated parameters are represented as actual customer measurements.
const seeded = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 4294967296;
};
const round = (x: number) => Math.round(x * 100) / 100;
export function createCase001(options: Case001Options = {}): Project {
  const nDays = options.days ?? 10, dailyOrders = options.dailyOrders ?? 380;
  const demand = options.demandMultiplier ?? 1, fuel = options.fuelMultiplier ?? 1;
  const pickingWorkers = options.pickingWorkers ?? 20;
  const maxRunsPerVehicle = options.maxRunsPerVehicle ?? 2;
  const peakTravelPercent = options.peakTravelPercent ?? 120;
  const maxStopsPerTrip = options.maxStopsPerTrip ?? 12;
  const stockCoveragePercent = options.stockCoveragePercent ?? 100;
  if (!Number.isInteger(nDays) || nDays < 1 || nDays > 65 ||
      !Number.isInteger(dailyOrders) || dailyOrders < 1 || dailyOrders > 800 ||
      !Number.isFinite(demand) || demand < 0.5 || demand > 1.8 ||
      !Number.isFinite(fuel) || fuel < 0.5 || fuel > 3 ||
      !Number.isSafeInteger(pickingWorkers) || pickingWorkers < 2 || pickingWorkers > 60 ||
      !Number.isSafeInteger(maxRunsPerVehicle) || maxRunsPerVehicle < 1 || maxRunsPerVehicle > 3 ||
      !Number.isSafeInteger(peakTravelPercent) || peakTravelPercent < 100 || peakTravelPercent > 200 ||
      !Number.isSafeInteger(maxStopsPerTrip) || maxStopsPerTrip < 2 || maxStopsPerTrip > 100 ||
      !Number.isSafeInteger(stockCoveragePercent) || stockCoveragePercent < 5 || stockCoveragePercent > 150)
    throw Error("D11_CASE001_PARAMETERS");
  const rng = seeded(0xd11ca501);
  const goods = seeded(0xd11ca702);
  const products = Array.from({ length: 12 }, (_, i) => ({
    skuId: "SKU-" + String(i + 1).padStart(3, "0"),
    unitWeightKg: 10 + (i % 6) * 4,
    unitVolumeM3: round(0.08 + (i % 5) * 0.025),
  }));
  const days: string[] = [], orders: Order[] = [];
  const customers = Array.from({ length: 200 }, (_, i) => {
    const zone = i % 4, dx = 5 + rng() * 17, dy = 4 + rng() * 17;
    return { customerId: "C-" + String(i + 1).padStart(3, "0"), zone,
      xKm: round(dx * (zone === 0 || zone === 3 ? 1 : -1)),
      yKm: round(dy * (zone === 0 || zone === 1 ? 1 : -1)) };
  });
  let cursor = new Date("2026-10-05T00:00:00.000Z");
  let dayIndex = 0;
  while (days.length < nDays) {
    const weekday = cursor.getUTCDay(), day = cursor.toISOString().slice(0, 10);
    cursor = new Date(cursor.getTime() + 86400000);
    if (weekday === 0 || weekday === 6) continue;
    days.push(day);
    const weekdayScale = [1.09, 1.06, 1.02, 0.99, 0.85][days.length % 5];
    const count = Math.round(dailyOrders * demand * weekdayScale);
    for (let i = 0; i < count; i++) {
      const customer = customers[Math.floor(rng() * customers.length)];
      const profile = rng();
      const windowStart = profile < 0.25 ? 570 : profile < 0.60 ? 690 : 540;
      const windowEnd = profile < 0.25 ? 900 : profile < 0.60 ? 1110 : 1140;
      const primary = Math.floor(goods() * products.length);
      const secondary = (primary + 1 + Math.floor(goods() * (products.length - 1))) % products.length;
      const lines = [
        { skuId: products[primary].skuId, units: 2 + Math.floor(goods() * 3) },
        ...(goods() < 0.65 ? [{ skuId: products[secondary].skuId, units: 1 + Math.floor(goods() * 3) }] : []),
      ];
      const weightKg = lines.reduce((n, l) => n + l.units * products.find(p => p.skuId === l.skuId)!.unitWeightKg, 0);
      const volumeM3 = round(lines.reduce((n, l) => n +
        l.units * products.find(p => p.skuId === l.skuId)!.unitVolumeM3, 0));
      orders.push({
        id: "D" + String(dayIndex + 1).padStart(2, "0") + "-" + String(i + 1).padStart(4, "0"),
        day, customerId: customer.customerId, zone: customer.zone,
        xKm: customer.xKm, yKm: customer.yKm,
        weightKg, volumeM3, lines,
        serviceMinutes: 6 + Math.floor(rng() * 7), windowStart, windowEnd
      });
    }
    dayIndex++;
  }
  const fleet: Vehicle[] = Array.from({ length: 45 }, (_, i) => {
    const owned = i < 30, medium = i % 3 === 0;
    return { id: (owned ? "OWN" : "HIRE") + "-" + String(i + 1).padStart(2, "0"),
      kind: owned ? "owned" : "contracted", zone: i % 4,
      capacityKg: medium ? 2800 : 1850, capacityM3: medium ? 18 : 12,
      shiftStart: 480, shiftEnd: 1170,
      kmRateRub: owned ? (medium ? 37 : 27) : (medium ? 68 : 60),
      hourRateRub: owned ? 390 : 0, activationRub: owned ? 0 : 2350 };
  });
  return { id: "D11-CASE-001|d" + nDays + "|o" + dailyOrders + "|q" + demand +
    "|f" + fuel + "|w" + pickingWorkers + "|r" + maxRunsPerVehicle + "|p" + peakTravelPercent + "|s" + maxStopsPerTrip + "|stock" + stockCoveragePercent,
    days, orders, fleet,
    inventory: products.map(product => ({
      ...product,
      openingUnits: Math.round(2500 * stockCoveragePercent / 100),
      receipts: days.filter((_, i) => (i + 1) % 6 === 0)
        .map(day => ({ day, units: 600 })),
    })),
    warehouse: {
      bays: 6, loadMinutes: 22, dailyOrderCapacity: 510,
      pickers: pickingWorkers, pickMinutesPerOrder: 4,
      pickingStartMinute: 360, pickingEndMinute: 1050,
      turnaroundMinutes: 15, maxRunsPerVehicle, maxStopsPerTrip,
    },
    road: {
      gridDetourFactor: 1.12, avgKmHour: 34,
      trafficPeriods: [
        { fromMinute: 480, toMinute: 600, travelMultiplier: peakTravelPercent / 100 },
        { fromMinute: 960, toMinute: 1110, travelMultiplier: (peakTravelPercent + 10) / 100 },
      ],
    },
    ownedDailyFixedRub: 1900, fuelMultiplier: fuel };
}
