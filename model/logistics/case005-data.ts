/** D11 CASE-005 | ten operating days of retail crossdock and shared dock yard.
 * The existing site project on retail supply-chain operations motivates scope.
 * All trucks, invoices, SKUs, road constraints and costs are editable inputs.
 */
import type { YardConfig,YardSku,YardStore,SupplierTruck } from "./case005-yard.ts";
import type { Vehicle } from "./engine.ts";
export interface Case005Options {
  stagingCapacity?:80|120|200|300;
  docks?:2|3|4|6;
  supplierDelayMinutes?:0|45|120|240;
  customerDemandPercent?:75|100|125|150;
  trafficPercent?:100|120|150;
  inspectionMinutes?:10|20|40;
  refuseCustomerIds?:string[];
  documentDelays?:boolean;
}
const DAYS=["2026-11-16","2026-11-17","2026-11-18","2026-11-19","2026-11-20",
  "2026-11-23","2026-11-24","2026-11-25","2026-11-26","2026-11-27"];
const SKUS:YardSku[]=[
  {skuId:"DRY-01",name:"Крупа 1 кг, короб 8 шт.",weightKg:8.8,volumeM3:0.027,valueRub:1200},
  {skuId:"DRY-02",name:"Макароны, короб 12 шт.",weightKg:7,volumeM3:0.038,valueRub:980},
  {skuId:"DRY-03",name:"Сахар, короб 10 кг",weightKg:10.4,volumeM3:0.019,valueRub:1100},
  {skuId:"DRY-04",name:"Подсолнечное масло, короб 6 л",weightKg:6.3,volumeM3:0.015,valueRub:850},
  {skuId:"NFO-05",name:"Бытовая химия, короб 8 шт.",weightKg:9.4,volumeM3:0.042,valueRub:1530},
  {skuId:"NFO-06",name:"Бумажная продукция, упаковка",weightKg:3.2,volumeM3:0.056,valueRub:650},
  {skuId:"DRY-07",name:"Мука, короб 10 кг",weightKg:10.5,volumeM3:0.025,valueRub:870},
  {skuId:"DRY-08",name:"Консервы, короб 24 шт.",weightKg:12.5,volumeM3:0.025,valueRub:2130},
  {skuId:"NFO-09",name:"Средства гигиены, короб",weightKg:5.2,volumeM3:0.041,valueRub:1270},
  {skuId:"DRY-10",name:"Чай, короб 40 пачек",weightKg:4.4,volumeM3:0.049,valueRub:1750},
];
const SHOPS:YardStore[]=Array.from({length:24},(_,i)=>({
  id:"SHOP-"+String(i+1).padStart(2,"0"),name:"Розничный магазин "+(i+1),
  zone:Math.floor(i/8),xKm:(i%8)*6+8,yKm:(Math.floor(i/8)-1)*16+(i%4)*3,
}));
const VANS:Vehicle[]=Array.from({length:6},(_,i)=>({
  id:"OUT-"+(i+1),kind:i<4?"owned":"contracted",
  zone:i%3,capacityKg:650,capacityM3:4,
  shiftStart:615,shiftEnd:1230,
  kmRateRub:22,hourRateRub:360,activationRub:i<4?0:3800,
}));
export function createCase005(options:Case005Options={}):YardConfig{
  const stagingCapacityUnits=options.stagingCapacity??120;
  const dockCount=options.docks??4;
  const supplierDelayMinutes=options.supplierDelayMinutes??0;
  const customerDemandPercent=options.customerDemandPercent??100;
  const trafficPercent=options.trafficPercent??120;
  const inspectionMinutes=options.inspectionMinutes??10;
  const documentDelays=options.documentDelays??true;
  if(![80,120,200,300].includes(stagingCapacityUnits)||
     ![2,3,4,6].includes(dockCount)||
     ![0,45,120,240].includes(supplierDelayMinutes)||
     ![75,100,125,150].includes(customerDemandPercent)||
     ![100,120,150].includes(trafficPercent)||
     ![10,20,40].includes(inspectionMinutes))
     throw Error("D11_CASE005_OPTIONS_INVALID");
  const incoming:SupplierTruck[]=[];
  const orders:YardConfig["orders"]=[];
  for(let di=0;di<DAYS.length;di++){
    for(let ti=0;ti<16;ti++){
      const a=(di*3+ti*7)%SKUS.length,b=(a+3)%SKUS.length;
      const s=ti%4;
      const docsLate=documentDelays&&ti%13===0&&di<DAYS.length-1;
      incoming.push({
        id:"IN:"+DAYS[di]+":"+String(ti+1).padStart(2,"0"),
        bookedDay:DAYS[di],actualArrivalMinute:315+(ti%8)*37+
          (Math.floor(ti/8))*180+supplierDelayMinutes,
        unloadMinutes:25+(ti%4)*8,supplierId:"SUPPLIER-"+(s+1),
        documentationAvailableDay:docsLate?DAYS[di+1]:DAYS[di],
        lines:[{skuId:SKUS[a].skuId,units:6+(ti+di)%5},
          {skuId:SKUS[b].skuId,units:5+(di+ti*2)%6}],
      });
    }
    for(let oi=0;oi<SHOPS.length;oi++){
      const a=(di*2+oi*3)%SKUS.length,b=(a+2)%SKUS.length;
      orders.push({
        id:"ORD:"+DAYS[di]+":"+SHOPS[oi].id,day:DAYS[di],
        storeId:SHOPS[oi].id,
        priority:(oi+di)%5===0?"urgent":"routine",
        lines:[{skuId:SKUS[a].skuId,units:Math.max(1,Math.ceil((2+(oi+di)%3)*customerDemandPercent/100))},
          {skuId:SKUS[b].skuId,units:Math.max(1,Math.ceil((1+(oi*2+di)%3)*customerDemandPercent/100))}],
        windowStart:710,windowEnd:(oi+di)%7===0?980:1170,
      });
    }
  }
  return {
    id:"D11-CASE-005-RETAIL-YARD",days:[...DAYS],
    skus:SKUS.map(x=>({...x})),stores:SHOPS.map(x=>({...x})),
    incoming,orders,openingStock:Object.fromEntries(SKUS.map(s=>[s.skuId,5])),
    dockCount,stagingCapacityUnits,pickingStartMinute:600,
    unloadOpenMinute:300,maxTruckWaitMinutes:210,
    inspectionMinutes,laborCrews:4,
    unloadingCostRubPerHour:1150,demurrageRubPerHour:920,
    holdingCostRubPerUnitDay:2.8,lostServiceRubPerOrderDay:4900,
    outboundFleet:VANS.map(x=>({...x})),
    warehouse:{bays:dockCount,loadMinutes:24,
      dailyOrderCapacity:55,pickers:8,pickMinutesPerOrder:5,
      pickingStartMinute:600,pickingEndMinute:1050,
      turnaroundMinutes:20,maxRunsPerVehicle:2,maxStopsPerTrip:8},
    road:{gridDetourFactor:1.18,avgKmHour:42,
      trafficPeriods:[{fromMinute:480,toMinute:640,travelMultiplier:1.16},
        {fromMinute:930,toMinute:1110,travelMultiplier:1.2}]},
    fuelMultiplier:1.06,ownedDailyFixedRub:1750,
    operation:{trafficPercent,dockDelayMinutes:8,
      extraServiceMinutes:2,latePenaltyRub:1300,rejectOutOfWindow:true},
    refusedCustomerIds:[...(options.refuseCustomerIds??[])],
  };
}
