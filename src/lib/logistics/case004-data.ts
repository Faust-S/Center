/** D11 CASE-004: eight working days of frozen and chilled FMCG dispatch.
 * Input data includes full 10-minute thermologger streams. The declared
 * temperature envelopes are product specifications, not generic legal limits.
 */
import type { ColdInput, ColdSku, ColdCustomer, ColdVehicle,
  ColdLogger, ColdEquipmentAlert, ColdQualityReview } from "./case004-coldchain.ts";
import type { Vehicle } from "./engine.ts";

export const CASE004_REFERENCE={
  temperatureControl:"https://legalacts.ru/doc/mr-230352-24-23-gigiena-pitanija-metodicheskie-rekomendatsii-pri-okazanii/",
  temperatureRecording:"https://base.garant.ru/77703274/62ca3c9a93aac147338fa0b3dccb5683/",
};
export interface Case004Options {
  demandPercent?:75|100|125|150;
  trafficPercent?:100|120|150;
  faults?:"none"|"frozen"|"both";
  loggerGap?:"none"|"frozen-day3"|"chilled-day5";
  coolingFleetSize?:2|4|6;
  rejectedOrderIds?:string[];
  qualityReviews?:ColdQualityReview[];
  coldStoragePercent?:75|100|125;
}
const DAYS=[
  "2026-11-16","2026-11-17","2026-11-18","2026-11-19",
  "2026-11-20","2026-11-23","2026-11-24","2026-11-25",
];
const SKUS:ColdSku[]=[
  {skuId:"F-ICE-01",name:"Мороженое в коробах",regime:"frozen",
    minC:-24,maxC:-17,maxExcursionMinutes:15,unitValueRub:640,
    unitWeightKg:5,unitVolumeM3:0.034},
  {skuId:"F-FISH-02",name:"Рыбная продукция шоковой заморозки",regime:"frozen",
    minC:-23,maxC:-18,maxExcursionMinutes:10,unitValueRub:1850,
    unitWeightKg:9,unitVolumeM3:0.029},
  {skuId:"C-MILK-03",name:"Молочная продукция",regime:"chilled",
    minC:2,maxC:6,maxExcursionMinutes:12,unitValueRub:470,
    unitWeightKg:8,unitVolumeM3:0.022},
  {skuId:"C-FOOD-04",name:"Охлаждённые полуфабрикаты",regime:"chilled",
    minC:1,maxC:5,maxExcursionMinutes:15,unitValueRub:960,
    unitWeightKg:6,unitVolumeM3:0.03},
];
const CUSTOMERS:ColdCustomer[]=Array.from({length:12},(_,i)=>({
  id:(i<6?"F-CUSTOMER-":"C-CUSTOMER-")+String(i+1).padStart(2,"0"),
  name:(i<6?"Замороженная витрина ":"Охлаждённая витрина ")+(i+1),
  zone:0,
  xKm:9+((i*7)%27),
  yKm:(i%2===0?1:-1)*(7+((i*11)%23)),
}));
function makeVehicle(index:number,regime:"frozen"|"chilled"):ColdVehicle{
  const id=(regime==="frozen"?"REF-F-":"REF-C-")+String(index);
  const vehicle:Vehicle={
    id,kind:"owned",zone:0,capacityKg:350,capacityM3:3.2,
    shiftStart:420,shiftEnd:1170,kmRateRub:27,hourRateRub:370,
    activationRub:0,
  };
  return {vehicle,regime,coolingRubPerHour:regime==="frozen"?490:330};
}
export function createCase004(options:Case004Options={}):ColdInput{
  const demandPercent=options.demandPercent??100;
  const trafficPercent=options.trafficPercent??120;
  const faults=options.faults??"both";
  const loggerGap=options.loggerGap??"none";
  const coolingFleetSize=options.coolingFleetSize??4;
  const coldStoragePercent=options.coldStoragePercent??100;
  if(![75,100,125,150].includes(demandPercent)||
     ![100,120,150].includes(trafficPercent)||
     !["none","frozen","both"].includes(faults)||
     !["none","frozen-day3","chilled-day5"].includes(loggerGap)||
     ![2,4,6].includes(coolingFleetSize)||
     ![75,100,125].includes(coldStoragePercent))
    throw Error("D11_CASE004_OPTIONS_INVALID");
  const n=coolingFleetSize/2;
  const fleet:ColdVehicle[]=[
    ...Array.from({length:n},(_,i)=>makeVehicle(i+1,"frozen")),
    ...Array.from({length:n},(_,i)=>makeVehicle(i+1,"chilled")),
  ];
  const orders:ColdInput["orders"]=[];
  for(let di=0;di<DAYS.length;di++)
    for(let ci=0;ci<CUSTOMERS.length;ci++){
      const c=CUSTOMERS[ci],frozen=ci<6;
      const same=SKUS.filter(s=>s.regime===(frozen?"frozen":"chilled"));
      const a=Math.max(1,Math.ceil((3+(ci+di)%3)*demandPercent/100));
      const b=Math.max(1,Math.ceil((1+(ci*2+di)%2)*demandPercent/100));
      orders.push({
        id:"COLD:"+DAYS[di]+":"+c.id,day:DAYS[di],customerId:c.id,
        windowStart:550,windowEnd:(ci+di)%5===0?845:1080,
        lines:[{skuId:same[0].skuId,units:a},{skuId:same[1].skuId,units:b}],
      });
    }
  const receipts:ColdInput["receipts"]=[];
  for(const di of [2,5])
    for(const product of SKUS)receipts.push({
      day:DAYS[di],skuId:product.skuId,units:di===2?52:58,
    });
  const alerts:ColdEquipmentAlert[]=[];
  if(faults==="frozen"||faults==="both")
    alerts.push({day:DAYS[2],vehicleId:"REF-F-1",
      startMinute:545,endMinute:915,reason:"Длительное отключение холодильной установки"});
  if(faults==="both")
    alerts.push({day:DAYS[4],vehicleId:"REF-C-1",
      startMinute:630,endMinute:875,reason:"Неисправность компрессора и превышение температуры"});
  const loggers:ColdLogger[]=[];
  for(const day of DAYS){
    for(const vehicle of fleet){
      const id=vehicle.vehicle.id;
      const alert=alerts.find(a=>a.day===day&&a.vehicleId===id);
      const readings=[];
      for(let minute=350;minute<=1570;minute+=10){
        const normal=vehicle.regime==="frozen"?-20.5:3.3;
        const fluctuation= ((minute/10+id.length)%4-1)*0.16;
        const fault=alert&&minute>=alert.startMinute&&minute<alert.endMinute;
        const tempC=Number((fault?
          vehicle.regime==="frozen"?-10.4:12.3:normal+fluctuation).toFixed(2));
        if(loggerGap==="frozen-day3"&&day===DAYS[2]&&id==="REF-F-1"&&
           minute>=660&&minute<=770)continue;
        if(loggerGap==="chilled-day5"&&day===DAYS[4]&&id==="REF-C-1"&&
           minute>=620&&minute<=720)continue;
        readings.push({minute,tempC});
      }
      loggers.push({day,vehicleId:id,readings});
    }
  }
  return {
    id:"D11-CASE-004-TEMPERATURE-CONTROL",days:[...DAYS],
    skus:SKUS.map(s=>({...s})),customers:CUSTOMERS.map(c=>({...c})),
    orders,opening:Object.fromEntries(SKUS.map((s,i)=>[s.skuId,i%2===0?130:85])),
    receipts,fleet,loggers,alerts,
    coldStorageMaxUnits:{frozen:Math.floor(430*coldStoragePercent/100),
      chilled:Math.floor(430*coldStoragePercent/100)},
    road:{gridDetourFactor:1.22,avgKmHour:43,
      trafficPeriods:[
        {fromMinute:460,toMinute:640,travelMultiplier:1.18},
        {fromMinute:920,toMinute:1100,travelMultiplier:1.23},
      ]},
    warehouse:{bays:2,loadMinutes:25,dailyOrderCapacity:30,
      pickers:5,pickMinutesPerOrder:6,pickingStartMinute:380,
      pickingEndMinute:1060,turnaroundMinutes:20,maxRunsPerVehicle:2,
      maxStopsPerTrip:8},
    operation:{trafficPercent,dockDelayMinutes:8,extraServiceMinutes:2,
      latePenaltyRub:1700,rejectOutOfWindow:true},
    customerRefusals:[...(options.rejectedOrderIds??[])],
    qualityReviews:(options.qualityReviews??[]).map(x=>({...x})),
    fixedWarehouseRubPerDay:11500,fuelMultiplier:1.08,
    ownedDailyFixedRub:1900,failureRubPerUnfilledDay:10500,
    maxSensorGapMinutes:30,
  };
}
