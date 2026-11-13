/** CASE-003: ten-day territorial distribution expansion.
 * The existing site project "supply-chain-distribution-growth" motivates the
 * process scope. Rates, volumes, routes and receipts are fully editable project
 * parameters, NOT assertions about a named customer's actual accounts.
 */
import type { NetworkInput,NetworkCenter,NetworkSku,NetworkStore } from "./case003-network.ts";
import type { Vehicle } from "./engine.ts";

export const CASE003_RELATED_PROJECT="supply-chain-distribution-growth";
export interface Case003Options {
  demandPercent?:75|100|125|150;
  supplierDelayDays?:0|1|2;
  regionalSelection?:"both"|"north"|"south";
  trafficPercent?:100|120|150|180;
  regionalRentRubPerDay?:3500|7000|12000|22000;
  fuelMultiplier?:1|1.3|1.6;
  refusedStoreOrderIds?:string[];
  refusedTransferIds?:string[];
}
const DAYS=["2026-11-16","2026-11-17","2026-11-18","2026-11-19","2026-11-20",
  "2026-11-23","2026-11-24","2026-11-25","2026-11-26","2026-11-27"];
const SKU:NetworkSku[]=[
  {skuId:"FMCG-01",name:"Крупа 1 кг",unitWeightKg:1.1,unitVolumeM3:0.003,unitCostRub:165},
  {skuId:"FMCG-02",name:"Макароны 0,5 кг",unitWeightKg:0.6,unitVolumeM3:0.0025,unitCostRub:95},
  {skuId:"FMCG-03",name:"Растительное масло 1 л",unitWeightKg:1.2,unitVolumeM3:0.0035,unitCostRub:205},
  {skuId:"FMCG-04",name:"Консервы 0,4 кг",unitWeightKg:0.5,unitVolumeM3:0.0015,unitCostRub:135},
  {skuId:"FMCG-05",name:"Бытовая химия 1 л",unitWeightKg:1.4,unitVolumeM3:0.0045,unitCostRub:240},
  {skuId:"FMCG-06",name:"Средства гигиены",unitWeightKg:0.35,unitVolumeM3:0.002,unitCostRub:180},
];
const fleet=(prefix:string,count:number,kind:Vehicle["kind"]="owned"):Vehicle[] =>
  Array.from({length:count},(_,index)=>({
    id:prefix+"-"+(index+1),kind,zone:0,capacityKg:1350,capacityM3:12,
    shiftStart:420,shiftEnd:1230,kmRateRub:29,hourRateRub:420,
    activationRub:kind==="contracted"?5500:0,
  }));
const regionFleet=(prefix:string):Vehicle[]=>fleet(prefix,2);
const hubWarehouse={
  bays:4,loadMinutes:23,dailyOrderCapacity:80,
  pickers:8,pickMinutesPerOrder:5,pickingStartMinute:380,pickingEndMinute:1040,
  turnaroundMinutes:20,maxRunsPerVehicle:2,maxStopsPerTrip:10,
};
const branchWarehouse={
  bays:2,loadMinutes:17,dailyOrderCapacity:45,
  pickers:4,pickMinutesPerOrder:5,pickingStartMinute:385,pickingEndMinute:1040,
  turnaroundMinutes:16,maxRunsPerVehicle:2,maxStopsPerTrip:10,
};
const STORE_AREAS=[
  {id:"C",label:"Центральная зона",cx:7,cy:-4,zone:0},
  {id:"N",label:"Северная зона",cx:151,cy:84,zone:1},
  {id:"S",label:"Южная зона",cx:-132,cy:-93,zone:2},
] as const;
function stores():NetworkStore[]{
  const result:NetworkStore[]=[];
  for(const area of STORE_AREAS)
    for(let index=0;index<8;index++)
      result.push({
        id:area.id+"-"+String(index+1).padStart(2,"0"),
        name:"Магазин "+area.id+" "+(index+1),
        zone:area.zone,
        xKm:area.cx+((index*7)%23)-11,
        yKm:area.cy+((index*11)%19)-9,
      });
  return result;
}
const delayReceipts=(days:string[],baseIndex:number,shift:number)=>days[baseIndex+shift]??null;
export function createCase003(options:Case003Options={}):NetworkInput{
  const demandPercent=options.demandPercent??100;
  const supplierDelayDays=options.supplierDelayDays??0;
  const regionalSelection=options.regionalSelection??"both";
  const trafficPercent=options.trafficPercent??120;
  const regionalRentRubPerDay=options.regionalRentRubPerDay??7000;
  const fuelMultiplier=options.fuelMultiplier??1;
  if(![75,100,125,150].includes(demandPercent)||
    ![0,1,2].includes(supplierDelayDays)||
    !["both","north","south"].includes(regionalSelection)||
    ![100,120,150,180].includes(trafficPercent)||
    ![3500,7000,12000,22000].includes(regionalRentRubPerDay)||
    ![1,1.3,1.6].includes(fuelMultiplier))
    throw Error("D11_CASE003_OPTIONS_INVALID");
  const selectedRegionalCenterIds=regionalSelection==="both"?["DC-N","DC-S"]:
    regionalSelection==="north"?["DC-N"]:["DC-S"];
  const opening=(unitsPerSku:number):Record<string,number> =>
    Object.fromEntries(SKU.map(s=>[s.skuId,unitsPerSku]));
  const centers:NetworkCenter[]=[
    {id:"HUB",name:"Центральный распределительный центр",kind:"hub",
      xKm:0,yKm:0,capacityUnits:3000,dailyInboundCapacityUnits:850,
      fixedRubPerDay:14000,opening:opening(165),fleet:fleet("HUB",2),
      warehouse:{...hubWarehouse}},
    {id:"DC-N",name:"Северный распределительный склад",kind:"regional",
      xKm:150,yKm:80,capacityUnits:530,dailyInboundCapacityUnits:160,
      fixedRubPerDay:regionalRentRubPerDay,opening:opening(36),
      fleet:regionFleet("N"),warehouse:{...branchWarehouse}},
    {id:"DC-S",name:"Южный распределительный склад",kind:"regional",
      xKm:-130,yKm:-95,capacityUnits:530,dailyInboundCapacityUnits:160,
      fixedRubPerDay:regionalRentRubPerDay,opening:opening(36),
      fleet:regionFleet("S"),warehouse:{...branchWarehouse}},
  ];
  const siteStores=stores();
  const orders:NetworkInput["orders"]=[];
  for(let dayIndex=0;dayIndex<DAYS.length;dayIndex++)
    for(let shopIndex=0;shopIndex<siteStores.length;shopIndex++){
      const site=siteStores[shopIndex];
      const a=(dayIndex*2+shopIndex*3)%SKU.length;
      const b=(a+2+(shopIndex%2))%SKU.length;
      const quantityA=Math.max(1,Math.ceil((2+(shopIndex+dayIndex)%4)*demandPercent/100));
      const quantityB=Math.max(1,Math.ceil((1+(dayIndex*2+shopIndex)%3)*demandPercent/100));
      orders.push({
        id:"SALE:"+DAYS[dayIndex]+":"+site.id,day:DAYS[dayIndex],
        storeId:site.id,priority:(shopIndex+dayIndex)%5===0?"urgent":"regular",
        lines:[{skuId:SKU[a].skuId,units:quantityA},
          {skuId:SKU[b].skuId,units:quantityB}],
        windowStart:610,windowEnd:(shopIndex+dayIndex)%5===0?955:1100,
      });
    }
  const receipts:NetworkInput["receipts"]=[];
  for(const baseIndex of [2,5,8]){
    const arrival=delayReceipts(DAYS,baseIndex,supplierDelayDays);
    // Supplier cargo beyond the project horizon remains outside inventory.
    if(!arrival)continue;
    for(let i=0;i<SKU.length;i++)
      receipts.push({day:arrival,skuId:SKU[i].skuId,units:65+(i%3)*7});
  }
  return {
    id:"D11-CASE-003-REGIONAL-DISTRIBUTION",days:[...DAYS],
    skus:SKU.map(s=>({...s})),centers,stores:siteStores,
    orders,receipts,
    selectedRegionalCenterIds,transferLeadDays:1,forecastDays:2,
    trunkFleet:fleet("LINEHAUL",2),
    trunkWarehouse:{...hubWarehouse,bays:2,loadMinutes:35,
      dailyOrderCapacity:12,pickers:3,pickMinutesPerOrder:9,maxStopsPerTrip:3},
    road:{gridDetourFactor:1.17,avgKmHour:52,trafficPeriods:[
      {fromMinute:450,toMinute:640,travelMultiplier:1.22},
      {fromMinute:970,toMinute:1130,travelMultiplier:1.17}]},
    fuelMultiplier,ownedDailyFixedRub:1700,
    operation:{trafficPercent,dockDelayMinutes:6,
      extraServiceMinutes:2,latePenaltyRub:1800,rejectOutOfWindow:true},
    holdingRubPerUnitDay:2.5,missedOrderRubPerDay:8500,
    refusedOrderIds:[...(options.refusedStoreOrderIds??[])],
    refusedTransferIds:[...(options.refusedTransferIds??[])],
  };
}
