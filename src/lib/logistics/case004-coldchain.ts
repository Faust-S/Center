/** D11 CASE-004 | Temperature-controlled distribution.
 * A quality decision is made for each SKU consignment from timestamped
 * thermologger readings, and actual D11 vehicle visits. Only verified,
 * inspected returns become stock. Unqualified goods never become sales.
 */
import { runScenario, type Order, type Project, type Vehicle } from "./engine.ts";
import { simulateOperations, calculateVerifiedInventory, type OperationSettings } from "./execution.ts";
import { inspectionReleaseDay } from "./inventory.ts";

export type TemperatureRegime = "frozen" | "chilled";
export type ColdMode = "uncontrolled" | "protected";
export interface ColdSku {
  skuId: string; name: string; regime: TemperatureRegime;
  minC: number; maxC: number; maxExcursionMinutes: number;
  unitValueRub: number; unitWeightKg: number; unitVolumeM3: number;
}
export interface ColdVehicle {
  vehicle: Vehicle; regime: TemperatureRegime;
  coolingRubPerHour: number;
}
export interface ColdCustomer { id: string; name: string; xKm: number; yKm: number; zone: number; }
export interface ColdOrder {
  id: string; day: string; customerId: string; windowStart: number; windowEnd: number;
  lines: { skuId: string; units: number }[];
}
export interface ColdReading { minute: number; tempC: number; }
export interface ColdLogger { day: string; vehicleId: string; readings: ColdReading[]; }
export interface ColdEquipmentAlert {
  day: string; vehicleId: string; startMinute: number; endMinute: number;
  reason: string;
}
export interface ColdInput {
  id: string; days: string[]; skus: ColdSku[];
  customers: ColdCustomer[]; orders: ColdOrder[];
  fleet: ColdVehicle[]; coldStorageMaxUnits: Record<TemperatureRegime, number>;
  opening: Record<string, number>;
  receipts: { day: string; skuId: string; units: number }[];
  loggers: ColdLogger[]; alerts: ColdEquipmentAlert[];
  customerRefusals: string[];
  road: Project["road"]; warehouse: Project["warehouse"];
  operation: Partial<OperationSettings>;
  fixedWarehouseRubPerDay: number; fuelMultiplier: number;
  ownedDailyFixedRub: number; failureRubPerUnfilledDay: number;
  maxSensorGapMinutes: number;
}
export type ColdQuality = "accepted" | "customer-refused" | "quality-rejected" |
  "quality-hold" | "not-scheduled";
export interface ColdEvent {
  orderId: string; dueDay: string; day: string; customerId: string;
  regime: TemperatureRegime; vehicleId: string | null; quality: ColdQuality;
  arrivalMinute: number | null; completionMinute: number | null;
  units: number; minObservedC: number | null; maxObservedC: number | null;
  excursionMinutes: number | null;
  loggerCoverage: "complete" | "missing" | "gap" | "not-applicable";
  reason: string;
}
export interface ColdStockMovement {
  skuId: string; opening: number; receipts: number; inspectedReturns: number;
  issued: number; accepted: number; destroyed: number;
  closing: number; pendingInspection: number; pendingQuality: number;
}
export interface ColdDay {
  day: string; events: ColdEvent[]; stock: ColdStockMovement[];
  completedOrderIds: string[]; pendingOrderIds: string[];
  transportRub: number; coolingRub: number; destroyedRub: number;
  warehouseRub: number; unfilledRub: number; totalRub: number;
}
export interface ColdResult {
  caseId: "D11-CASE-004"; inputFingerprint: string; projectId: string;
  mode: ColdMode; days: ColdDay[];
  ordered: number; acceptedOrders: number; pendingOrders: string[];
  customerRefusals: number; temperatureRejected: number; temperatureHolds: number;
  destroyedUnits: number; recoveredUnits: number; acceptedUnits: number;
  transportRub: number; coolingRub: number; destroyedRub: number;
  warehouseRub: number; unfilledRub: number; totalRub: number;
  audit: string[];
}
export interface ColdComparison {
  uncontrolled: ColdResult; protected: ColdResult;
  additionalAccepted: number; preventedDestructionRub: number;
  costDifferenceRub: number; qualityImproved: boolean;
  recommendation: "protected" | "uncontrolled" | "no-dominant-option";
}
const round = (n:number)=>Math.round(n*100)/100;
const validDate=(day:string)=>/^\d{4}-\d{2}-\d{2}$/.test(day)&&
  Number.isFinite(Date.parse(day+"T00:00:00.000Z"))&&
  new Date(day+"T00:00:00.000Z").toISOString().slice(0,10)===day;
const add=(dest:Record<string,number>,sku:string,n:number)=>{
  dest[sku]=(dest[sku]??0)+n;
};
const sum=(value:Record<string,number>)=>Object.values(value).reduce((n,x)=>n+x,0);
const int=(n:unknown)=>Number.isSafeInteger(n)&&(n as number)>=0;
const positive=(n:unknown)=>typeof n==="number"&&Number.isFinite(n)&&n>0;
const nonnegative=(n:unknown)=>typeof n==="number"&&Number.isFinite(n)&&n>=0;
const unique=(keys:string[],label:string)=>{
  if(keys.some(id=>typeof id!=="string"||!id.trim())||
     keys.length!==new Set(keys).size)throw Error("D11_COLD_DUPLICATE_"+label);
};
const count=(lines:readonly {units:number}[])=>lines.reduce((n,line)=>n+line.units,0);
function fingerprint(value:unknown){
  const raw=JSON.stringify(value);let h=2166136261,a=1;
  for(let i=0;i<raw.length;i++){
    const c=raw.charCodeAt(i);h=Math.imul(h^c,16777619);
    a=(a+c)%65521;
  }
  return "d11-cold-"+(h>>>0).toString(16).padStart(8,"0")+a.toString(16).padStart(4,"0");
}
export const coldFingerprint=(input:ColdInput)=>fingerprint(input);
export function validateColdInput(input:ColdInput):void{
  if(!input||typeof input.id!=="string"||!input.id||
     !Array.isArray(input.days)||!input.days.length||input.days.length>45||
     input.days.some((d,i)=>!validDate(d)||(i>0&&d<=input.days[i-1]))||
     !Array.isArray(input.skus)||!input.skus.length||input.skus.length>40||
     !Array.isArray(input.customers)||!input.customers.length||input.customers.length>100||
     !Array.isArray(input.orders)||!input.orders.length||input.orders.length>8000||
     !Array.isArray(input.fleet)||!input.fleet.length||input.fleet.length>30||
     !Array.isArray(input.receipts)||!Array.isArray(input.loggers)||
     !Array.isArray(input.alerts)||!Array.isArray(input.customerRefusals)||
     !input.road||!input.warehouse||
     !positive(input.fuelMultiplier)||!nonnegative(input.fixedWarehouseRubPerDay)||
     !nonnegative(input.ownedDailyFixedRub)||
     !nonnegative(input.failureRubPerUnfilledDay)||
     !int(input.maxSensorGapMinutes)||input.maxSensorGapMinutes<5||
     input.maxSensorGapMinutes>120||
     !int(input.coldStorageMaxUnits?.frozen)||
     !int(input.coldStorageMaxUnits?.chilled))
    throw Error("D11_COLD_INPUT_INVALID");
  unique(input.skus.map(s=>s.skuId),"SKU");
  unique(input.customers.map(x=>x.id),"CUSTOMER");
  unique(input.orders.map(x=>x.id),"ORDER");
  unique(input.fleet.map(x=>x.vehicle.id),"VEHICLE");
  unique(input.loggers.map(x=>x.day+":"+x.vehicleId),"LOGGER");
  unique(input.alerts.map(x=>x.day+":"+x.vehicleId),"ALERT");
  unique(input.customerRefusals,"REFUSAL");
  const sku=new Map(input.skus.map(x=>[x.skuId,x]));
  const customer=new Set(input.customers.map(x=>x.id));
  const vehicles=new Map(input.fleet.map(x=>[x.vehicle.id,x]));
  if(!input.fleet.some(v=>v.regime==="frozen")||
     !input.fleet.some(v=>v.regime==="chilled"))
    throw Error("D11_COLD_FLEET_REGIME_MISSING");
  for(const s of input.skus){
    if(!["frozen","chilled"].includes(s.regime)||
       !s.name||!Number.isFinite(s.minC)||!Number.isFinite(s.maxC)||
       s.maxC<=s.minC||!int(s.maxExcursionMinutes)||
       !nonnegative(s.unitValueRub)||!positive(s.unitWeightKg)||
       !positive(s.unitVolumeM3))
      throw Error("D11_COLD_SKU_INVALID:"+s.skuId);
  }
  if(!input.opening||typeof input.opening!=="object"||Array.isArray(input.opening)||
     Object.keys(input.opening).some(id=>!sku.has(id))||
     Object.values(input.opening).some(n=>!int(n)))
    throw Error("D11_COLD_STOCK_INVALID");
  for(const regime of ["frozen","chilled"] as const){
    const initial=input.skus.filter(s=>s.regime===regime)
      .reduce((n,s)=>n+(input.opening[s.skuId]??0),0);
    if(initial>input.coldStorageMaxUnits[regime])
      throw Error("D11_COLD_STORE_OVERFLOW:"+regime);
  }
  for(const c of input.customers)
    if(!c.name||!Number.isFinite(c.xKm)||!Number.isFinite(c.yKm)||
       !int(c.zone))throw Error("D11_COLD_CUSTOMER_INVALID");
  for(const o of input.orders){
    if(!input.days.includes(o.day)||!customer.has(o.customerId)||
       !Array.isArray(o.lines)||!o.lines.length||
       !int(o.windowStart)||!int(o.windowEnd)||o.windowEnd>1440||
       o.windowStart>=o.windowEnd||
       o.lines.some(l=>!sku.has(l.skuId)||!int(l.units)||!l.units)||
       new Set(o.lines.map(l=>l.skuId)).size!==o.lines.length||
       new Set(o.lines.map(l=>sku.get(l.skuId)!.regime)).size!==1)
      throw Error("D11_COLD_ORDER_INVALID:"+o.id);
  }
  for(const v of input.fleet){
    if(!["frozen","chilled"].includes(v.regime)||
       !nonnegative(v.coolingRubPerHour)||
       !positive(v.vehicle.capacityKg)||!positive(v.vehicle.capacityM3)||
       !int(v.vehicle.shiftStart)||!int(v.vehicle.shiftEnd)||
       v.vehicle.shiftEnd<=v.vehicle.shiftStart||
       !nonnegative(v.vehicle.kmRateRub)||!nonnegative(v.vehicle.hourRateRub)||
       !nonnegative(v.vehicle.activationRub))
      throw Error("D11_COLD_VEHICLE_INVALID:"+v.vehicle.id);
  }
  for(const r of input.receipts)
    if(!input.days.includes(r.day)||!sku.has(r.skuId)||!int(r.units)||!r.units)
      throw Error("D11_COLD_RECEIPT_INVALID");
  for(const l of input.loggers){
    if(!input.days.includes(l.day)||!vehicles.has(l.vehicleId)||
       !Array.isArray(l.readings)||l.readings.length>300||
       l.readings.some((p,i)=>!int(p.minute)||p.minute>3000||
         !Number.isFinite(p.tempC)||
         (i>0&&p.minute<=l.readings[i-1].minute)))
      throw Error("D11_COLD_LOGGER_INVALID");
  }
  for(const alert of input.alerts)
    if(!input.days.includes(alert.day)||!vehicles.has(alert.vehicleId)||
       !int(alert.startMinute)||!int(alert.endMinute)||
       alert.endMinute<=alert.startMinute||!alert.reason)
      throw Error("D11_COLD_ALERT_INVALID");
  const orders=new Set(input.orders.map(x=>x.id));
  if(input.customerRefusals.some(id=>!orders.has(id)))
    throw Error("D11_COLD_REFUSAL_UNKNOWN");
}
/** Exact observed air-temperature coverage between loading and handover.
 * No samples, holes, or missing end readings are NEVER classified as safe.
 * Sensor values hold until the next logged reading; this is conservative
 * compared with interpolating away short, hot excursions. */
export function inspectTemperature(
  readings:readonly ColdReading[] | undefined,
  startMinute:number,endMinute:number,product:ColdSku,
  gapLimitMinutes:number,
):{coverage:"complete"|"missing"|"gap";minC:number|null;maxC:number|null;
  excursionMinutes:number|null; safe:boolean}{
  if(!readings?.length||!Number.isFinite(startMinute)||
     !Number.isFinite(endMinute)||endMinute<=startMinute||
     readings[0].minute>startMinute||
     readings[readings.length-1].minute<endMinute)
    return {coverage:"missing",minC:null,maxC:null,excursionMinutes:null,safe:false};
  let excursion=0,min=Infinity,max=-Infinity;
  for(let i=0;i<readings.length-1;i++){
    const from=readings[i],to=readings[i+1];
    const left=Math.max(startMinute,from.minute),right=Math.min(endMinute,to.minute);
    if(right<=left)continue;
    if(to.minute-from.minute>gapLimitMinutes)
      return {coverage:"gap",minC:null,maxC:null,excursionMinutes:null,safe:false};
    min=Math.min(min,from.tempC);max=Math.max(max,from.tempC);
    if(from.tempC<product.minC||from.tempC>product.maxC)excursion+=right-left;
  }
  if(!Number.isFinite(min))
    return {coverage:"missing",minC:null,maxC:null,excursionMinutes:null,safe:false};
  return {coverage:"complete",minC:min,maxC:max,excursionMinutes:excursion,
    safe:excursion<=product.maxExcursionMinutes};
}
/** Pre-dispatch qualification checks the entire intended shift, not only the
 * readings around already loaded consignments. If the recorder is offline,
 * protected dispatch must use another vehicle or leave the order unplanned. */
function loggerReady(readings:readonly ColdReading[]|undefined,
  start:number,end:number,maxGap:number):boolean{
  if(!readings?.length||readings[0].minute>start||
     readings[readings.length-1].minute<end)return false;
  for(let i=0;i<readings.length-1;i++){
    if(readings[i].minute>=end)break;
    if(readings[i+1].minute>start&&
       readings[i+1].minute-readings[i].minute>maxGap)return false;
  }
  return true;
}
function orderRegime(input:ColdInput,order:ColdOrder){
  return input.skus.find(s=>s.skuId===order.lines[0].skuId)!.regime;
}
function weightVolume(input:ColdInput,order:ColdOrder){
  return {
    weightKg:round(order.lines.reduce((n,l)=>n+
      l.units*input.skus.find(s=>s.skuId===l.skuId)!.unitWeightKg,0)),
    volumeM3:round(order.lines.reduce((n,l)=>n+
      l.units*input.skus.find(s=>s.skuId===l.skuId)!.unitVolumeM3,0)),
  };
}
function planningModel(input:ColdInput,day:string,regime:TemperatureRegime,
  orders:ColdOrder[],available:Record<string,number>):Project{
  const customers=new Map(input.customers.map(x=>[x.id,x]));
  const roadOrders:Order[]=orders.map(o=>{
    const destination=customers.get(o.customerId)!;
    const phys=weightVolume(input,o);
    return {id:o.id,day,customerId:o.customerId,zone:destination.zone,
      xKm:destination.xKm,yKm:destination.yKm,
      windowStart:o.windowStart,windowEnd:o.windowEnd,serviceMinutes:15,
      ...phys,lines:o.lines.map(l=>({...l}))};
  });
  return {id:input.id+":"+regime+":"+day,days:[day],
    orders:roadOrders,warehouse:input.warehouse,road:input.road,
    fleet:input.fleet.filter(v=>v.regime===regime).map(v=>v.vehicle),
    inventory:input.skus.filter(s=>s.regime===regime).map(s=>({
      skuId:s.skuId,openingUnits:available[s.skuId]??0,
      unitWeightKg:s.unitWeightKg,unitVolumeM3:s.unitVolumeM3,
    })),
    fuelMultiplier:input.fuelMultiplier,ownedDailyFixedRub:input.ownedDailyFixedRub};
}
function validInspectionRelease(input:ColdInput,day:string,returnMinute:number){
  return inspectionReleaseDay({days:input.days} as Project,day,returnMinute);
}
interface PendingRelease{day:string|null;skuId:string;units:number;}
/** The operational ledger is fully replayable; no separate route planner or
 * persistence is introduced. Controlled dispatch avoids declared failed
 * refrigeration units; actual logger samples determine acceptance in BOTH modes. */
export function simulateCold(input:ColdInput,mode:ColdMode):ColdResult{
  validateColdInput(input);
  if(mode!=="uncontrolled"&&mode!=="protected")throw Error("D11_COLD_MODE_INVALID");
  const stock:Record<string,number>={};
  for(const sku of input.skus)stock[sku.skuId]=input.opening[sku.skuId]??0;
  const fulfilled=new Set<string>();
  const refusalUsed=new Set<string>();
  const quarantine:Record<string,number>={};
  const withheld:Record<string,number>={};
  const releases:PendingRelease[]=[];
  const days:ColdDay[]=[];
  let customerRefusals=0,temperatureRejected=0,temperatureHolds=0,
    destroyedUnits=0,recoveredUnits=0,acceptedUnits=0,
    transportRub=0,coolingRub=0,destroyedRub=0,
    warehouseRub=0,unfilledRub=0;
  const products=new Map(input.skus.map(s=>[s.skuId,s]));
  const trace=new Map(input.loggers.map(l=>[l.day+":"+l.vehicleId,l.readings]));
  const supplier:Record<string,number>={};
  const accepted:Record<string,number>={};
  const destroyed:Record<string,number>={};
  for(const day of input.days){
    const opening={...stock};
    const received:Record<string,number>={},inspected:Record<string,number>={};
    const issued:Record<string,number>={},customerAccepted:Record<string,number>={},
      waste:Record<string,number>={};
    const events:ColdEvent[]=[];
    const completedOrderIds:string[]=[];
    let dayTransport=0,dayCooling=0,dayWaste=0;
    for(const r of input.receipts.filter(r=>r.day===day)){
      add(stock,r.skuId,r.units);add(received,r.skuId,r.units);
      add(supplier,r.skuId,r.units);
    }
    for(let i=releases.length-1;i>=0;i--){
      if(releases[i].day!==day)continue;
      const item=releases.splice(i,1)[0];
      add(stock,item.skuId,item.units);add(inspected,item.skuId,item.units);
      add(quarantine,item.skuId,-item.units);
      recoveredUnits+=item.units;
    }
    for(const regime of ["frozen","chilled"] as const){
      const inStore=input.skus.filter(s=>s.regime===regime)
        .reduce((n,s)=>n+stock[s.skuId],0);
      if(inStore>input.coldStorageMaxUnits[regime])
        throw Error("D11_COLD_STORE_CAPACITY:"+day+":"+regime);
    }
    for(const regime of ["frozen","chilled"] as const){
      const waiting=input.orders.filter(o=>o.day<=day&&!fulfilled.has(o.id)&&
        orderRegime(input,o)===regime).sort((a,b)=>
          a.day.localeCompare(b.day)||a.windowEnd-b.windowEnd||a.id.localeCompare(b.id));
      const project=planningModel(input,day,regime,waiting,stock);
      const excluded=mode==="protected"?
        project.fleet.filter(v=>input.alerts.some(a=>
          a.day===day&&a.vehicleId===v.id&&a.startMinute<v.shiftEnd&&
          a.endMinute>v.shiftStart)||
          !loggerReady(trace.get(day+":"+v.id),v.shiftStart,v.shiftEnd,
            input.maxSensorGapMinutes)).map(v=>v.id):[];
      const plan=runScenario(project,mode==="protected"?"to-be":"as-is",excluded);
      if(plan.audit.length)throw Error("D11_COLD_PLAN:"+plan.audit[0]);
      const manual=input.customerRefusals.filter(id=>
        waiting.some(o=>o.id===id)&&!refusalUsed.has(id));
      const actual=simulateOperations(project,plan,{
        ...input.operation,customerRefusalOrderIds:manual,
      });
      const checked=calculateVerifiedInventory(project,plan,actual);
      if(actual.audit.length||checked.audit.length)
        throw Error("D11_COLD_OPERATION:"+(actual.audit[0]??checked.audit[0]));
      for(const row of checked.days[0].movements){
        stock[row.skuId]=row.closingUnits;
        add(issued,row.skuId,row.issued);
      }
      dayTransport+=actual.totalCostRub;
      const routeFacts=new Map(actual.days[0].trips.flatMap(t=>{
        const v=input.fleet.find(x=>x.vehicle.id===t.vehicleId)!;
        dayCooling+=round(Math.max(0,t.returnMinute-t.loadStartMinute)/60*v.coolingRubPerHour);
        return t.deliveries.map(d=>[d.orderId,{delivery:d,trip:t}] as const);
      }));
      for(const order of waiting){
        const run=routeFacts.get(order.id);
        if(!run){
          events.push({orderId:order.id,dueDay:order.day,day,
            customerId:order.customerId,regime,vehicleId:null,
            quality:"not-scheduled",arrivalMinute:null,completionMinute:null,
            units:count(order.lines),minObservedC:null,maxObservedC:null,
            excursionMinutes:null,loggerCoverage:"not-applicable",
            reason:plan.days[0].unserved.find(x=>x.orderId===order.id)?.reason??"fleet-unavailable"});
          continue;
        }
        const {delivery,trip}=run;
        const byProduct=order.lines.map(line=>inspectTemperature(
          trace.get(day+":"+trip.vehicleId),
          trip.loadStartMinute,delivery.completionMinute,
          products.get(line.skuId)!,input.maxSensorGapMinutes));
        const coverage=byProduct.some(x=>x.coverage==="missing")?"missing":
          byProduct.some(x=>x.coverage==="gap")?"gap":"complete";
        const breach=byProduct.some(x=>x.coverage==="complete"&&!x.safe);
        const quality:ColdQuality=coverage!=="complete"?"quality-hold":
          breach?"quality-rejected":
          delivery.status==="refused"?"customer-refused":"accepted";
        const min=coverage==="complete"?Math.min(...byProduct.map(x=>x.minC!)):null;
        const max=coverage==="complete"?Math.max(...byProduct.map(x=>x.maxC!)):null;
        const excursion=coverage==="complete"?Math.max(...byProduct.map(x=>x.excursionMinutes!)):null;
        if(quality==="accepted"){
          fulfilled.add(order.id);completedOrderIds.push(order.id);
          for(const line of order.lines){
            add(customerAccepted,line.skuId,line.units);
            add(accepted,line.skuId,line.units);
            acceptedUnits+=line.units;
          }
        }else if(quality==="quality-rejected"){
          temperatureRejected++;
          for(const line of order.lines){
            add(waste,line.skuId,line.units);add(destroyed,line.skuId,line.units);
            destroyedUnits+=line.units;
            dayWaste+=line.units*products.get(line.skuId)!.unitValueRub;
          }
        }else if(quality==="quality-hold"){
          temperatureHolds++;
          for(const line of order.lines){
            add(quarantine,line.skuId,line.units);
            add(withheld,line.skuId,line.units);
          }
        }else {
          customerRefusals++;
          refusalUsed.add(order.id);
          const eligibility=validInspectionRelease(input,day,trip.returnMinute);
          for(const line of order.lines){
            add(quarantine,line.skuId,line.units);
            releases.push({day:eligibility,skuId:line.skuId,units:line.units});
          }
        }
        events.push({orderId:order.id,dueDay:order.day,day,
          customerId:order.customerId,regime,vehicleId:trip.vehicleId,
          quality,arrivalMinute:delivery.arrivalMinute,
          completionMinute:delivery.completionMinute,units:count(order.lines),
          minObservedC:min,maxObservedC:max,excursionMinutes:excursion,
          loggerCoverage:coverage,reason:quality==="accepted"?"verified":
            quality==="customer-refused"?"client-refusal-or-window":
            quality==="quality-rejected"?"temperature-excursion":"sensor-data-unavailable"});
      }
    }
    const pending=input.orders.filter(o=>o.day<=day&&!fulfilled.has(o.id)).map(o=>o.id);
    const dayUnfilled=pending.length*input.failureRubPerUnfilledDay;
    const warehouse=input.fixedWarehouseRubPerDay;
    unfilledRub+=dayUnfilled;warehouseRub+=warehouse;
    destroyedRub+=dayWaste;transportRub+=dayTransport;coolingRub+=dayCooling;
    for(const regime of ["frozen","chilled"] as const){
      const held=input.skus.filter(s=>s.regime===regime)
        .reduce((n,s)=>n+stock[s.skuId],0);
      if(held>input.coldStorageMaxUnits[regime])
        throw Error("D11_COLD_STORE_CAPACITY:"+day+":"+regime);
    }
    const rows:ColdStockMovement[]=input.skus.map(sku=>({
      skuId:sku.skuId,opening:opening[sku.skuId]??0,
      receipts:received[sku.skuId]??0,
      inspectedReturns:inspected[sku.skuId]??0,
      issued:issued[sku.skuId]??0,
      accepted:customerAccepted[sku.skuId]??0,
      destroyed:waste[sku.skuId]??0,
      closing:stock[sku.skuId]??0,
      pendingInspection:(quarantine[sku.skuId]??0)-(withheld[sku.skuId]??0),
      pendingQuality:withheld[sku.skuId]??0,
    }));
    for(const r of rows){
      if(r.opening+r.receipts+r.inspectedReturns-r.issued!==r.closing||
         r.closing<0||r.pendingInspection<0||r.pendingQuality<0)
        throw Error("D11_COLD_SKU_LEDGER:"+day+":"+r.skuId);
      // Physical conservation across depot, accepted shops, destruction and hold.
      if((input.opening[r.skuId]??0)+(supplier[r.skuId]??0)!==
         r.closing+(accepted[r.skuId]??0)+(destroyed[r.skuId]??0)+
         (quarantine[r.skuId]??0))
        throw Error("D11_COLD_CONSERVATION:"+day+":"+r.skuId);
    }
    const totalRub=round(dayTransport+dayCooling+dayWaste+warehouse+dayUnfilled);
    days.push({day,events,stock:rows,completedOrderIds,pendingOrderIds:pending,
      transportRub:round(dayTransport),coolingRub:round(dayCooling),
      destroyedRub:round(dayWaste),warehouseRub:round(warehouse),
      unfilledRub:round(dayUnfilled),totalRub});
  }
  return {caseId:"D11-CASE-004",inputFingerprint:coldFingerprint(input),projectId:input.id,
    mode,days,ordered:input.orders.length,
    acceptedOrders:fulfilled.size,pendingOrders:input.orders.filter(o=>!fulfilled.has(o.id)).map(o=>o.id),
    customerRefusals,temperatureRejected,temperatureHolds,
    destroyedUnits,recoveredUnits,acceptedUnits,
    transportRub:round(transportRub),coolingRub:round(coolingRub),
    destroyedRub:round(destroyedRub),warehouseRub:round(warehouseRub),
    unfilledRub:round(unfilledRub),
    totalRub:round(transportRub+coolingRub+destroyedRub+warehouseRub+unfilledRub),
    audit:[]};
}
export function compareCold(input:ColdInput):ColdComparison{
  const uncontrolled=simulateCold(input,"uncontrolled");
  const protectedPlan=simulateCold(input,"protected");
  const additionalAccepted=protectedPlan.acceptedOrders-uncontrolled.acceptedOrders;
  const preventedDestructionRub=round(uncontrolled.destroyedRub-protectedPlan.destroyedRub);
  const costDifferenceRub=round(uncontrolled.totalRub-protectedPlan.totalRub);
  const qualityImproved=protectedPlan.acceptedOrders>=uncontrolled.acceptedOrders&&
    protectedPlan.temperatureRejected<=uncontrolled.temperatureRejected&&
    protectedPlan.temperatureHolds<=uncontrolled.temperatureHolds;
  const preference=qualityImproved&&protectedPlan.totalRub<=uncontrolled.totalRub?
    "protected":uncontrolled.acceptedOrders>=protectedPlan.acceptedOrders&&
    uncontrolled.temperatureRejected<=protectedPlan.temperatureRejected&&
    uncontrolled.totalRub<=protectedPlan.totalRub?"uncontrolled":"no-dominant-option";
  return {uncontrolled,protected:protectedPlan,additionalAccepted,
    preventedDestructionRub,costDifferenceRub,qualityImproved,
    recommendation:preference};
}
export function auditCold(input:ColdInput,result:ColdResult):string[]{
  try{
    if(result.audit.length)return ["D11_COLD_DECLARED_AUDIT"];
    if(JSON.stringify(simulateCold(input,result.mode))!==JSON.stringify(result))
      return ["D11_COLD_REPLAY_MISMATCH"];
    return [];
  }catch{return ["D11_COLD_REPLAY_FAILED"];}
}
