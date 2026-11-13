/** CASE-002 reproducible operating project: 4 maintenance depots, 8 critical
 * spare categories, 10 working days, inbound hub lots and actual repair jobs. */
import type { SupplyInput, SparePart, MaintenanceJob } from "./case002-supply.ts";

export interface Case002Options {
  openingCoveragePercent?: number;
  fleetVehicles?: number;
  trafficPercent?: number;
  supplierDelayDays?: number;
  refusalIds?: string[];
}
export const CASE002_SOURCE = {
  subject: "Maintenance materials distribution for an urban bus operator",
  domainProject: "material-resources-transport-operator",
  publicReference: "https://advice-logistics.ru/primery-realizovannyh-proektov/",
  procurementReference: "https://avtobus.spb.ru/about/raskrytie-informatsii/informatsiya-o-zakupkakh/",
};
const DAYS = ["2026-11-16","2026-11-17","2026-11-18","2026-11-19","2026-11-20",
  "2026-11-23","2026-11-24","2026-11-25","2026-11-26","2026-11-27"];
const PARTS: SparePart[] = [
  { skuId:"BRK-01",name:"Тормозные колодки",unitWeightKg:6,unitVolumeM3:0.007,valueRub:5200 },
  { skuId:"AIR-02",name:"Фильтр воздуха",unitWeightKg:1.8,unitVolumeM3:0.012,valueRub:2100 },
  { skuId:"BLT-03",name:"Ремень привода",unitWeightKg:0.7,unitVolumeM3:0.004,valueRub:3100 },
  { skuId:"LMP-04",name:"Блок освещения",unitWeightKg:1.2,unitVolumeM3:0.008,valueRub:1800 },
  { skuId:"VLV-05",name:"Пневматический клапан",unitWeightKg:2.4,unitVolumeM3:0.006,valueRub:8900 },
  { skuId:"SNS-06",name:"Датчик давления",unitWeightKg:0.5,unitVolumeM3:0.002,valueRub:4800 },
  { skuId:"BRG-07",name:"Подшипник ступицы",unitWeightKg:3,unitVolumeM3:0.005,valueRub:6900 },
  { skuId:"FLT-08",name:"Масляный фильтр",unitWeightKg:1.1,unitVolumeM3:0.006,valueRub:1700 },
];
const PARKS = [
  { id:"AP-01",name:"Автобусный парк 1",xKm:8,yKm:6,zone:1 },
  { id:"AP-02",name:"Автобусный парк 2",xKm:21,yKm:5,zone:1 },
  { id:"AP-05",name:"Автобусный парк 5",xKm:-14,yKm:13,zone:2 },
  { id:"AP-07",name:"Автобусный парк 7",xKm:6,yKm:-18,zone:3 },
] as const;
/** Orders are generated explicitly and individually so each blocked bus can be
 * audited, not hidden behind aggregate daily consumption statistics. */
export function createCase002(options: Case002Options = {}): SupplyInput {
  const openingCoveragePercent = options.openingCoveragePercent ?? 100;
  const fleetVehicles = options.fleetVehicles ?? 3;
  const trafficPercent = options.trafficPercent ?? 115;
  const supplierDelayDays = options.supplierDelayDays ?? 0;
  if (![40,70,100,140].includes(openingCoveragePercent) ||
      ![1,2,3].includes(fleetVehicles) ||
      ![100,115,135,160,200].includes(trafficPercent) ||
      ![0,1,2].includes(supplierDelayDays))
    throw Error("D11_CASE002_OPTIONS_INVALID");
  const scale = (amount: number) => Math.floor(amount * openingCoveragePercent / 100);
  const depots = PARKS.map((depot, index) => ({ ...depot,
    opening: Object.fromEntries(PARTS.map((p,i) =>
      [p.skuId, (i + index) % 3 === 0 ? 1 : 0])) }));
  const jobs: MaintenanceJob[] = [];
  for (let dayIndex = 0; dayIndex < DAYS.length; dayIndex++) {
    for (let depotIndex = 0; depotIndex < depots.length; depotIndex++) {
      for (let task = 0; task < 3; task++) {
        const safety = task === 0 || (dayIndex + depotIndex) % 5 === 0;
        const i = (dayIndex * 3 + depotIndex * 2 + task * 5) % PARTS.length;
        const secondaryIndex = (i + 3) % PARTS.length;
        jobs.push({
          id: "REPAIR-" + String(dayIndex+1).padStart(2,"0") + "-" + depots[depotIndex].id +
            "-" + String(task+1),
          depotId: depots[depotIndex].id, dueDay: DAYS[dayIndex],
          priority: safety ? "safety" : "routine",
          parts: [
            { skuId: PARTS[i].skuId, units: safety ? 2 : 1 },
            { skuId: PARTS[secondaryIndex].skuId, units: 1 },
          ],
          downtimeRubPerDay: safety ? 18000 : 4600,
          workDescription: safety ? "Восстановление автобуса перед выпуском на линию"
            : "Плановый технический ремонт подвижного состава",
        });
      }
    }
  }
  const inbound = [
    { day: DAYS[2],units: 22 },{ day: DAYS[5],units: 22 },{ day: DAYS[8],units: 18 },
  ];
  const receipts = inbound.flatMap((record, lotIndex) => PARTS.map((part, i) => ({
    day: DAYS[Math.min(DAYS.length-1, DAYS.indexOf(record.day) + supplierDelayDays)],
    skuId: part.skuId, units: record.units + ((i + lotIndex) % 3) * 3,
  })));
  return {
    id: "D11-CASE-002-BUS-DEPOTS",
    days: [...DAYS], parts: PARTS.map(p => ({ ...p })), depots, jobs,
    hubOpening: Object.fromEntries(PARTS.map((p,i) =>
      [p.skuId, scale(14 + i % 4 * 3)])),
    receipts,
    fleet: Array.from({ length: fleetVehicles }, (_, index) => ({
      id: "HUB-VAN-" + (index+1), kind: "owned" as const,
      zone: index === 0 ? 1 : index === 1 ? 2 : 3,
      capacityKg: 480,capacityM3:4.5,shiftStart:420,shiftEnd:1080,
      kmRateRub:21,hourRateRub:380,activationRub:0,
    })),
    warehouse: { bays:2, loadMinutes:25, dailyOrderCapacity:15,
      pickers:3,pickMinutesPerOrder:7,pickingStartMinute:385,
      pickingEndMinute:980,turnaroundMinutes:15,maxRunsPerVehicle:2,maxStopsPerTrip:4 },
    road: { gridDetourFactor:1.3, avgKmHour:37,
      trafficPeriods:[{fromMinute:450,toMinute:630,travelMultiplier:1.32},
        {fromMinute:930,toMinute:1140,travelMultiplier:1.24}] },
    fuelMultiplier:1,ownedDailyFixedRub:1650,
    operation: { trafficPercent,dockDelayMinutes:5,extraServiceMinutes:2,
      latePenaltyRub:2500,rejectOutOfWindow:true },
    refusedShipmentIds: [...(options.refusalIds ?? [])],
  };
}
