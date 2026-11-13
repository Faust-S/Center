/** D11 CASE-003. Physical multi-echelon distribution network expansion.
 * All customer and interwarehouse trips use the existing D11 route, operations,
 * and verified SKU inventory engines. This module creates no persistence layer.
 */
import { runScenario, type Order, type Project, type Vehicle } from "./engine.ts";
import { calculateVerifiedInventory, simulateOperations, type OperationSettings } from "./execution.ts";
import { inspectionReleaseDay } from "./inventory.ts";

export type NetworkMode = "central-only" | "regional-network";
export interface NetworkSku { skuId: string; name: string; unitWeightKg: number;
  unitVolumeM3: number; unitCostRub: number; }
export interface NetworkCenter { id: string; name: string; kind: "hub" | "regional";
  xKm: number; yKm: number; capacityUnits: number; dailyInboundCapacityUnits: number;
  fixedRubPerDay: number; opening: Record<string,number>;
  fleet: Vehicle[]; warehouse: Project["warehouse"]; }
export interface NetworkStore { id: string; name: string; xKm: number; yKm: number; zone: number; }
export interface NetworkOrder { id: string; day: string; storeId: string;
  priority: "urgent"|"regular"; lines: { skuId:string; units:number }[];
  windowStart: number; windowEnd: number; }
export interface NetworkReceipt { day: string; skuId:string; units:number; }
export interface NetworkInput {
  id:string; days:string[]; skus:NetworkSku[]; centers:NetworkCenter[];
  stores:NetworkStore[]; orders:NetworkOrder[]; receipts:NetworkReceipt[];
  trunkFleet:Vehicle[]; trunkWarehouse:Project["warehouse"];
  road:Project["road"]; fuelMultiplier:number; ownedDailyFixedRub:number;
  operation:Partial<OperationSettings>; transferLeadDays:number;
  forecastDays:number; holdingRubPerUnitDay:number;
  missedOrderRubPerDay:number;
  refusedOrderIds?:string[]; refusedTransferIds?:string[];
  selectedRegionalCenterIds?:string[];
}
export interface NetworkDelivery {
  orderId:string; warehouseId:string; storeId:string; originalDay:string;
  attemptedDay:string; status:"on-time"|"late"|"refused"|"not-routed";
  vehicleId:string|null; arrivalMinute:number|null; completionMinute:number|null;
  units:number; reason?:string;
}
export interface NetworkTransfer {
  id:string; day:string; fromId:string; toId:string;
  lines:{skuId:string; units:number}[]; vehicleId:string|null;
  status:"delivered"|"refused"|"not-routed";
  arrivalDay:string|null; actualArrivalMinute:number|null;
}
export interface CenterLedger {
  centerId:string; opening:Record<string,number>;
  supplierReceipts:Record<string,number>; transfersIn:Record<string,number>;
  inspectedReturns:Record<string,number>;
  customerIssued:Record<string,number>; transferIssued:Record<string,number>;
  closing:Record<string,number>; routeKm:number;
  routeCostRub:number; fixedCostRub:number; holdingCostRub:number;
}
export interface NetworkDay {
  day:string; centers:CenterLedger[]; customerEvents:NetworkDelivery[];
  transfers:NetworkTransfer[]; completedOrderIds:string[]; pendingOrderIds:string[];
  deliveredUnits:Record<string,number>;
  inTransit:Record<string,number>; returnInspection:Record<string,number>;
  transportRub:number; facilitiesRub:number; holdingRub:number;
  delayedOrderRub:number; outstandingOrderDays:number;
}
export interface NetworkResult {
  caseId:"D11-CASE-003"; modelId:string; inputFingerprint:string; mode:NetworkMode;
  days:NetworkDay[]; orderCount:number; deliveredOrders:number; onTimeOrders:number;
  pendingOrders:string[]; delayedOrderDays:number; lastMileKm:number; trunkKm:number;
  transportRub:number; facilitiesRub:number; holdingRub:number;
  delayedOrdersRub:number; totalRub:number;
  servicePercent:number; onTimePercent:number; audit:string[];
}
export interface NetworkComparison { baseline:NetworkResult; regional:NetworkResult;
  additionalDelivered:number; additionalOnTime:number; avoidedOrderDays:number;
  totalCostDifferenceRub:number; comparable:boolean; recommendation:
    "regional-network"|"central-only"|"no-dominant-option"; }

const round = (n:number) => Math.round(n*100)/100;
const copy = (r:Record<string,number>) => ({...r});
const add = (a:Record<string,number>, id:string, n:number) =>
  { a[id] = (a[id]??0) + n; };
const units = (r:Record<string,number>) =>
  Object.values(r).reduce((sum,n)=>sum+n,0);
const count = (lines:readonly {units:number}[]) => lines.reduce((n,line)=>n+line.units,0);
const validDate = (d:string) => /^\d{4}-\d{2}-\d{2}$/.test(d) &&
  Number.isFinite(Date.parse(d+"T00:00:00.000Z")) &&
  new Date(d+"T00:00:00.000Z").toISOString().slice(0,10)===d;
function nextBusinessDate(day:string):string {
  let t=Date.parse(day+"T00:00:00.000Z");
  do {t+=86400000;} while([0,6].includes(new Date(t).getUTCDay()));
  return new Date(t).toISOString().slice(0,10);
}
function afterWorkdays(days:readonly string[],day:string,lag=1):string {
  let actual=day;
  for(let step=0;step<lag;step++){
    const next=days.find(d=>d>actual);
    actual=next??nextBusinessDate(actual);
  }
  return actual;
}
function dateAtMinute(day:string,minute:number):string {
  if(!Number.isFinite(minute)||minute<0)throw Error("D11_NETWORK_TIME_INVALID");
  return new Date(Date.parse(day+"T00:00:00.000Z")+
    Math.floor(minute/1440)*86400000).toISOString().slice(0,10);
}
function distance(a:{xKm:number;yKm:number},b:{xKm:number;yKm:number},factor=1):number{
  return (Math.abs(a.xKm-b.xKm)+Math.abs(a.yKm-b.yKm))*factor;
}
function assertUnique(ids:readonly string[],name:string) {
  if(ids.some(id=>typeof id!=="string"||!id.trim())||new Set(ids).size!==ids.length)
    throw Error("D11_NETWORK_DUPLICATE_"+name);
}
function positive(n:unknown) {return typeof n==="number"&&Number.isFinite(n)&&n>0;}
function nonnegative(n:unknown){return typeof n==="number"&&Number.isFinite(n)&&n>=0;}
function natural(n:unknown){return Number.isSafeInteger(n)&&(n as number)>=0;}
export function validateNetworkInput(input:NetworkInput):void {
  if(!input||typeof input.id!=="string"||!input.id||
     !Array.isArray(input.days)||!input.days.length||input.days.length>65||
     input.days.some((d,i)=>!validDate(d)||(i>0&&d<=input.days[i-1]))||
     !Array.isArray(input.skus)||!input.skus.length||input.skus.length>60||
     !Array.isArray(input.centers)||input.centers.length<2||input.centers.length>8||
     !Array.isArray(input.stores)||input.stores.length<2||input.stores.length>200||
     !Array.isArray(input.orders)||!input.orders.length||input.orders.length>20000||
     !Array.isArray(input.receipts)||!Array.isArray(input.trunkFleet)||!input.trunkFleet.length||
     !input.trunkWarehouse||!input.road||!positive(input.fuelMultiplier)||
     !nonnegative(input.ownedDailyFixedRub)||
     ![1,2,3].includes(input.transferLeadDays)||!Number.isSafeInteger(input.forecastDays)||
     input.forecastDays<1||input.forecastDays>6||
     !nonnegative(input.holdingRubPerUnitDay)||!nonnegative(input.missedOrderRubPerDay))
    throw Error("D11_NETWORK_INPUT_INVALID");
  assertUnique(input.skus.map(s=>s.skuId),"SKU");
  assertUnique(input.centers.map(s=>s.id),"CENTER");
  assertUnique(input.stores.map(s=>s.id),"STORE");
  assertUnique(input.orders.map(s=>s.id),"ORDER");
  const skus=new Set(input.skus.map(s=>s.skuId));
  const stores=new Set(input.stores.map(s=>s.id));
  const centers=new Set(input.centers.map(s=>s.id));
  if(input.centers.filter(c=>c.kind==="hub").length!==1||
     input.centers.filter(c=>c.kind==="regional").length<1)
    throw Error("D11_NETWORK_CENTER_TYPES_INVALID");
  for(const item of input.skus)
    if(!item.name||!positive(item.unitWeightKg)||!positive(item.unitVolumeM3)||
       !nonnegative(item.unitCostRub))
      throw Error("D11_NETWORK_SKU_INVALID");
  for(const center of input.centers){
    if(!center.name||!["hub","regional"].includes(center.kind)||
       !Number.isFinite(center.xKm)||!Number.isFinite(center.yKm)||
       !natural(center.capacityUnits)||center.capacityUnits===0||
       !natural(center.dailyInboundCapacityUnits)||center.dailyInboundCapacityUnits===0||
       !nonnegative(center.fixedRubPerDay)||!Array.isArray(center.fleet)||!center.fleet.length||
       !center.warehouse||Object.keys(center.opening).some(id=>!skus.has(id))||
       Object.values(center.opening).some(n=>!natural(n))||
       units(center.opening)>center.capacityUnits)
      throw Error("D11_NETWORK_CENTER_INVALID:"+center.id);
  }
  if(new Set(input.stores.map(s=>JSON.stringify([s.xKm,s.yKm,s.zone]))).size!==input.stores.length)
    throw Error("D11_NETWORK_STORE_LOCATION_DUPLICATE");
  for(const store of input.stores)
    if(!store.name||!Number.isFinite(store.xKm)||!Number.isFinite(store.yKm)||
       !natural(store.zone))throw Error("D11_NETWORK_STORE_INVALID");
  for(const o of input.orders)
    if(!input.days.includes(o.day)||!stores.has(o.storeId)||
       !["regular","urgent"].includes(o.priority)||
       !Array.isArray(o.lines)||!o.lines.length||
       new Set(o.lines.map(l=>l.skuId)).size!==o.lines.length||
       o.lines.some(l=>!skus.has(l.skuId)||!natural(l.units)||l.units===0)||
       !natural(o.windowStart)||!natural(o.windowEnd)||o.windowEnd>1440||
       o.windowEnd<=o.windowStart)
       throw Error("D11_NETWORK_ORDER_INVALID:"+o.id);
  if(input.receipts.some(r=>!input.days.includes(r.day)||
       !skus.has(r.skuId)||!natural(r.units)||r.units===0))
    throw Error("D11_NETWORK_RECEIPT_INVALID");
  const fleetIds=input.centers.flatMap(c=>c.fleet.map(v=>v.id))
    .concat(input.trunkFleet.map(v=>v.id));
  assertUnique(fleetIds,"VEHICLE");
  const orderIds=new Set(input.orders.map(o=>o.id));
  if((input.refusedOrderIds??[]).some(id=>!orderIds.has(id)))
    throw Error("D11_NETWORK_REFUSAL_UNKNOWN");
  assertUnique(input.refusedOrderIds??[],"REFUSAL");
  const allRegional=new Set(input.centers.filter(c=>c.kind==="regional").map(c=>c.id));
  if(input.selectedRegionalCenterIds?.some(id=>!allRegional.has(id))||
     input.selectedRegionalCenterIds?.length===0)
    throw Error("D11_NETWORK_REGION_SELECTION_INVALID");
  assertUnique(input.selectedRegionalCenterIds??[...allRegional],"SELECTED_REGION");
  const transferIds=new Set(input.days.flatMap(d=>input.centers
    .filter(c=>c.kind==="regional").map(c=>"TR:"+d+":"+c.id)));
  if((input.refusedTransferIds??[]).some(id=>!transferIds.has(id)))
    throw Error("D11_NETWORK_TRANSFER_REFUSAL_UNKNOWN");
  assertUnique(input.refusedTransferIds??[],"TRANSFER_REFUSAL");
  if(!centers.has("HUB")||input.centers.find(c=>c.kind==="hub")?.id!=="HUB")
    throw Error("D11_NETWORK_HUB_ID_INVALID");
  if(input.centers.some(c=>c.kind==="regional"&&c.id==="HUB"))
    throw Error("D11_NETWORK_HUB_ID_INVALID");
}
export function networkFingerprint(input:NetworkInput):string {
  const raw=JSON.stringify(input);let a=2166136261,b=1;
  for(let i=0;i<raw.length;i++){
    a=Math.imul(a^raw.charCodeAt(i),16777619);
    b=(b+raw.charCodeAt(i))%65521;
  }
  return "d11c3-"+(a>>>0).toString(16).padStart(8,"0")+b.toString(16).padStart(4,"0");
}
interface ScheduledLinehaul{orderId:string;toId:string;lines:{skuId:string;units:number}[];}
interface Quarantine{centerId:string;lines:{skuId:string;units:number}[];releaseDay:string|null;}
function cargo(input:NetworkInput,lines:Order["lines"]):{weightKg:number;volumeM3:number}{
  return {weightKg:round((lines??[]).reduce((n,l)=>n+l.units*input.skus.find(s=>s.skuId===l.skuId)!.unitWeightKg,0)),
    volumeM3:round((lines??[]).reduce((n,l)=>n+l.units*input.skus.find(s=>s.skuId===l.skuId)!.unitVolumeM3,0))};
}
function localProject(input:NetworkInput,day:string,center:NetworkCenter,
  fleet:Vehicle[],stock:Record<string,number>,orders:Order[],trunk=false):Project {
  return {
    id:input.id+":"+day+":"+center.id+(trunk?":TRUNK":":RETAIL"),
    days:[day],orders,fleet,
    warehouse:trunk?input.trunkWarehouse:center.warehouse,
    road:input.road,fuelMultiplier:input.fuelMultiplier,
    ownedDailyFixedRub:input.ownedDailyFixedRub,
    inventory:input.skus.map(s=>({skuId:s.skuId,openingUnits:stock[s.skuId]??0,
      unitWeightKg:s.unitWeightKg,unitVolumeM3:s.unitVolumeM3})),
  };
}
function emptyCenterLedger(c:NetworkCenter,opening:Record<string,number>):CenterLedger{
  return {centerId:c.id,opening:copy(opening),supplierReceipts:{},
    transfersIn:{},inspectedReturns:{},customerIssued:{},transferIssued:{},
    closing:{},routeKm:0,routeCostRub:0,fixedCostRub:c.fixedRubPerDay,holdingCostRub:0};
}
function inspectionDay(days:string[],dispatchDay:string,returnMinute:number):string|null{
  return inspectionReleaseDay({days} as Project,dispatchDay,returnMinute);
}
function tally(lines:readonly {skuId:string;units:number}[],dest:Record<string,number>){
  for(const line of lines)add(dest,line.skuId,line.units);
}
function same(a:unknown,b:unknown){return JSON.stringify(a)===JSON.stringify(b);}

/** Recompute every physical daily route; inventories include trunk cargo that
 * is travelling, refused on a truck, or awaiting next-day depot inspection. */
export function simulateNetwork(input:NetworkInput,mode:NetworkMode):NetworkResult{
  validateNetworkInput(input);
  if(mode!=="central-only"&&mode!=="regional-network")throw Error("D11_NETWORK_MODE_INVALID");
  const hub=input.centers.find(c=>c.id==="HUB")!;
  const selected=new Set(input.selectedRegionalCenterIds??
    input.centers.filter(c=>c.kind==="regional").map(c=>c.id));
  const active=mode==="central-only"?[hub]:
    input.centers.filter(c=>c.kind==="hub"||selected.has(c.id));
  const skuIds=input.skus.map(s=>s.skuId);
  const stock=new Map<string,Record<string,number>>();
  for(const c of active)stock.set(c.id,copy(c.opening));
  // Both alternatives start with exactly the same material inventory.
  // A non-operational regional location keeps its stock and trucks at the hub.
  for(const region of input.centers.filter(c=>
    c.kind==="regional"&&(mode==="central-only"||!selected.has(c.id))))
    tally(Object.entries(region.opening).map(([skuId,units])=>({skuId,units})),
      stock.get("HUB")!);
  const ordered=new Map(input.orders.map(o=>[o.id,o]));
  const stores=new Map(input.stores.map(o=>[o.id,o]));
  const completed=new Set<string>();
  const manuallyRefused=new Set<string>();
  const quarantines:Quarantine[]=[];
  const receivedTransfers=new Map<string,ScheduledLinehaul[]>();
  const timeline:NetworkDay[]=[];
  let completedOrders=0,onTimeOrders=0,delayedOrderDays=0,
    lastMileKm=0,trunkKm=0,transportRub=0,facilitiesRub=0,holdingRub=0,delayedOrdersRub=0;
  const cumulativeDelivered:Record<string,number>={};
  const supplierCumulative:Record<string,number>={};
  const openingTotal:Record<string,number>={};
  for(const center of input.centers)
    for(const [skuId,n] of Object.entries(center.opening))add(openingTotal,skuId,n);

  for(const day of input.days){
    const logs=new Map(active.map(c=>[c.id,emptyCenterLedger(c,stock.get(c.id)!)]));
    const customerEvents:NetworkDelivery[]=[], transfers:NetworkTransfer[]=[];
    const deliveredUnits:Record<string,number>={};
    const completedOrderIds:string[]=[];
    let costTransport=0,facilities=0,holding=0;
    for(const c of active)facilities+=c.fixedRubPerDay;

    // Only actually received upstream consignments become stock.
    for(const receipt of input.receipts.filter(r=>r.day===day)){
      add(stock.get("HUB")!,receipt.skuId,receipt.units);
      add(logs.get("HUB")!.supplierReceipts,receipt.skuId,receipt.units);
      add(supplierCumulative,receipt.skuId,receipt.units);
    }
    // A linehaul can be used only after its scheduled physical arrival and QC.
    for(const arrival of receivedTransfers.get(day)??[]){
      const dest=stock.get(arrival.toId);
      if(!dest)throw Error("D11_NETWORK_TRANSFER_TARGET_INVALID");
      tally(arrival.lines,dest);
      tally(arrival.lines,logs.get(arrival.toId)!.transfersIn);
    }
    receivedTransfers.delete(day);
    for(let qi=quarantines.length-1;qi>=0;qi--){
      const held=quarantines[qi];
      if(held.releaseDay!==day)continue;
      tally(held.lines,stock.get(held.centerId)!);
      tally(held.lines,logs.get(held.centerId)!.inspectedReturns);
      quarantines.splice(qi,1);
    }
    for(const c of active)
      if(units(stock.get(c.id)!)>c.capacityUnits)
        throw Error("D11_NETWORK_PHYSICAL_CAPACITY:"+day+":"+c.id);

    // Nominal assignment uses physical distance, never a fabricated remote
    // stock balance. Unserved or refused store orders remain outstanding.
    const candidates=input.orders.filter(o=>o.day<=day&&!completed.has(o.id))
      .sort((a,b)=>(a.priority==="urgent"?0:1)-(b.priority==="urgent"?0:1)||
        a.day.localeCompare(b.day)||a.id.localeCompare(b.id));
    const byCenter=new Map(active.map(c=>[c.id,[] as Order[]]));
    for(const original of candidates){
      const dest=stores.get(original.storeId)!;
      const chosen=[...active].sort((a,b)=>
        distance(a,dest,input.road.gridDetourFactor)-distance(b,dest,input.road.gridDetourFactor)||
        a.id.localeCompare(b.id))[0];
      const lines=original.lines.map(l=>({...l}));
      const size=cargo(input,lines);
      byCenter.get(chosen.id)!.push({
        id:original.id,day,customerId:dest.id,zone:dest.zone,
        xKm:dest.xKm-chosen.xKm,yKm:dest.yKm-chosen.yKm,
        windowStart:original.windowStart,windowEnd:original.windowEnd,
        serviceMinutes:12,weightKg:size.weightKg,volumeM3:size.volumeM3,lines,
      });
    }
    for(const c of active){
      const ledger=logs.get(c.id)!,available=stock.get(c.id)!;
      const fleet=c.id==="HUB"?
        input.centers.filter(x=>mode==="central-only"||x.kind==="hub"||
          !selected.has(x.id)).flatMap(x=>x.fleet):c.fleet;
      const project=localProject(input,day,c,fleet,available,byCenter.get(c.id)!);
      const plan=runScenario(project,"to-be");
      if(plan.audit.length)throw Error("D11_NETWORK_PLAN:"+c.id+":"+plan.audit[0]);
      const refusals=(input.refusedOrderIds??[]).filter(id=>
        byCenter.get(c.id)!.some(o=>o.id===id)&&!manuallyRefused.has(id));
      const actual=simulateOperations(project,plan,{
        ...input.operation,customerRefusalOrderIds:refusals,
      });
      const inventory=calculateVerifiedInventory(project,plan,actual);
      if(actual.audit.length||inventory.audit.length)
        throw Error("D11_NETWORK_FACT:"+c.id+":"+(actual.audit[0]??inventory.audit[0]));
      for(const row of inventory.days[0].movements)available[row.skuId]=row.closingUnits;
      tally(inventory.days[0].movements.map(m=>({skuId:m.skuId,units:m.issued})),
        ledger.customerIssued);
      ledger.routeCostRub=actual.totalCostRub;
      ledger.routeKm=plan.totalKm;
      lastMileKm+=plan.totalKm;
      costTransport+=actual.totalCostRub;
      const attempted=new Map(actual.days[0].trips.flatMap(t=>t.deliveries.map(event=>[
        event.orderId,{...event,returnMinute:t.returnMinute,vehicleId:t.vehicleId}
      ] as const)));
      for(const source of byCenter.get(c.id)!){
        const original=ordered.get(source.id)!;
        const event=attempted.get(source.id);
        if(!event){
          const reason=plan.days[0].unserved.find(o=>o.orderId===source.id)?.reason;
          customerEvents.push({orderId:source.id,storeId:original.storeId,
            warehouseId:c.id,originalDay:original.day,attemptedDay:day,
            status:"not-routed",vehicleId:null,arrivalMinute:null,
            completionMinute:null,units:count(original.lines),
            reason:reason??"unknown"});
          continue;
        }
        if(event.status==="refused"){
          if(refusals.includes(source.id))manuallyRefused.add(source.id);
          const release=inspectionDay(input.days,day,event.returnMinute);
          quarantines.push({centerId:c.id,lines:original.lines,
            releaseDay:release});
        }else{
          completed.add(original.id);
          completedOrderIds.push(original.id);
          completedOrders++;
          if(original.day===day&&event.status==="on-time")onTimeOrders++;
          tally(original.lines,cumulativeDelivered);
          tally(original.lines,deliveredUnits);
        }
        customerEvents.push({orderId:source.id,storeId:original.storeId,
          warehouseId:c.id,originalDay:original.day,attemptedDay:day,
          status:event.status,vehicleId:event.vehicleId,
          arrivalMinute:event.arrivalMinute,completionMinute:event.completionMinute,
          units:count(original.lines)});
      }
    }

    // Build next-day regional replenishments only after customer dispatch,
    // so neither the hub nor its routes can use the same SKU twice.
    if(mode==="regional-network"){
      const hubAvailable=stock.get("HUB")!;
      const wanted=new Map<string,Order>();
      for(const region of active.filter(c=>c.kind==="regional")){
        const forecast=input.orders.filter(o=>!completed.has(o.id)&&
          o.day<=afterWorkdays(input.days,day,input.forecastDays)&&
          [...active].sort((a,b)=>distance(a,stores.get(o.storeId)!)-distance(b,stores.get(o.storeId)!)||
            a.id.localeCompare(b.id))[0].id===region.id);
        const desired:Record<string,number>={};
        for(const order of forecast)tally(order.lines,desired);
        const reserved:Record<string,number>={};
        for(const rows of receivedTransfers.values())
          for(const row of rows.filter(s=>s.toId===region.id))tally(row.lines,reserved);
        const regional=stock.get(region.id)!;
        let capacityLeft=Math.max(0,region.capacityUnits-units(regional)-units(reserved));
        let inboundLeft=Math.max(0,region.dailyInboundCapacityUnits);
        const lines:{skuId:string;units:number}[]=[];
        for(const sku of skuIds){
          const need=Math.max(0,(desired[sku]??0)-(regional[sku]??0)-(reserved[sku]??0));
          const load=Math.min(need,hubAvailable[sku]??0,capacityLeft,inboundLeft);
          if(load>0){
            lines.push({skuId:sku,units:load});
            capacityLeft-=load;inboundLeft-=load;
          }
        }
        if(!lines.length)continue;
        const size=cargo(input,lines);
        const id="TR:"+day+":"+region.id;
        wanted.set(id,{
          id,day,customerId:region.id,zone:0,
          xKm:region.xKm-hub.xKm,yKm:region.yKm-hub.yKm,
          windowStart:540,windowEnd:1170,serviceMinutes:25,
          weightKg:size.weightKg,volumeM3:size.volumeM3,lines,
        });
      }
      const trunkProject=localProject(input,day,hub,input.trunkFleet,hubAvailable,
        [...wanted.values()],true);
      const trunkPlan=runScenario(trunkProject,"to-be");
      if(trunkPlan.audit.length)throw Error("D11_NETWORK_TRUNK_PLAN:"+trunkPlan.audit[0]);
      const trunkFact=simulateOperations(trunkProject,trunkPlan,{
        ...input.operation,customerRefusalOrderIds:(input.refusedTransferIds??[])
          .filter(id=>wanted.has(id)),
      });
      const inventory=calculateVerifiedInventory(trunkProject,trunkPlan,trunkFact);
      if(trunkFact.audit.length||inventory.audit.length)
        throw Error("D11_NETWORK_TRUNK_FACT:"+(trunkFact.audit[0]??inventory.audit[0]));
      for(const m of inventory.days[0].movements)hubAvailable[m.skuId]=m.closingUnits;
      tally(inventory.days[0].movements.map(m=>({skuId:m.skuId,units:m.issued})),
        logs.get("HUB")!.transferIssued);
      const attempts=new Map(trunkFact.days[0].trips.flatMap(t=>t.deliveries.map(v=>[
        v.orderId,{...v,returnMinute:t.returnMinute}
      ] as const)));
      for(const [id,order] of wanted){
        const event=attempts.get(id);
        const status=!event?"not-routed":event.status==="refused"?"refused":"delivered";
        let arrivalDay:string|null=null;
        if(event&&event.status!=="refused"){
          // Crossdock stock is never available the same day as the trunk trip.
          const physicalDate=dateAtMinute(day,event.completionMinute);
          arrivalDay=afterWorkdays(input.days,physicalDate,input.transferLeadDays);
          const scheduled=receivedTransfers.get(arrivalDay)??[];
          scheduled.push({orderId:id,toId:order.customerId,
            lines:order.lines!.map(l=>({...l}))});
          receivedTransfers.set(arrivalDay,scheduled);
        }
        if(event?.status==="refused")
          quarantines.push({centerId:"HUB",lines:order.lines!.map(l=>({...l})),
            releaseDay:inspectionDay(input.days,day,event.returnMinute)});
        transfers.push({id,day,fromId:"HUB",toId:order.customerId,
          lines:order.lines!.map(l=>({...l})),status,
          arrivalDay,actualArrivalMinute:event?.completionMinute??null,
          vehicleId:event?.vehicleId??null});
      }
      trunkKm+=trunkPlan.totalKm;
      costTransport+=trunkFact.totalCostRub;
      logs.get("HUB")!.routeKm+=trunkPlan.totalKm;
      logs.get("HUB")!.routeCostRub+=trunkFact.totalCostRub;
    }
    const pending=input.orders.filter(o=>o.day<=day&&!completed.has(o.id))
      .map(o=>o.id);
    const delayUnits=pending.reduce((n,id)=>n+
      (ordered.get(id)!.priority==="urgent"?2:1),0);
    const delayedOrderRub=delayUnits*input.missedOrderRubPerDay;
    delayedOrderDays+=pending.length;
    delayedOrdersRub+=delayedOrderRub;
    for(const c of active){
      const log=logs.get(c.id)!;
      log.closing=copy(stock.get(c.id)!);
      log.holdingCostRub=round(units(log.closing)*input.holdingRubPerUnitDay);
      holding+=log.holdingCostRub;
    }
    facilitiesRub+=facilities;
    holdingRub+=holding;
    transportRub+=costTransport;

    const inTransit:Record<string,number>={};
    for(const arrivals of receivedTransfers.values())
      for(const item of arrivals)tally(item.lines,inTransit);
    const returnInspection:Record<string,number>={};
    for(const item of quarantines)tally(item.lines,returnInspection);
    const audit:string[]=[];
    for(const c of active){
      const log=logs.get(c.id)!;
      for(const sku of skuIds){
        const computed=(log.opening[sku]??0)+(log.supplierReceipts[sku]??0)+
          (log.transfersIn[sku]??0)+(log.inspectedReturns[sku]??0)-
          (log.customerIssued[sku]??0)-(log.transferIssued[sku]??0);
        if(computed!==(log.closing[sku]??0)||computed<0)
          audit.push("D11_NETWORK_LEDGER:"+day+":"+c.id+":"+sku);
      }
      if(mode==="regional-network"&&units(log.closing)>c.capacityUnits)
        audit.push("D11_NETWORK_CAPACITY:"+day+":"+c.id);
    }
    for(const sku of skuIds){
      const allWarehouses=active.reduce((n,c)=>n+(stock.get(c.id)![sku]??0),0);
      const expected=(openingTotal[sku]??0)+(supplierCumulative[sku]??0)-
        (cumulativeDelivered[sku]??0);
      const observed=allWarehouses+(inTransit[sku]??0)+(returnInspection[sku]??0);
      if(observed!==expected) audit.push("D11_NETWORK_CONSERVATION:"+day+":"+sku);
    }
    if(audit.length)throw Error("D11_NETWORK_AUDIT:"+audit[0]);
    timeline.push({day,centers:[...logs.values()],customerEvents,transfers,
      completedOrderIds,pendingOrderIds:pending,deliveredUnits,
      inTransit,returnInspection,transportRub:round(costTransport),
      facilitiesRub:round(facilities),holdingRub:round(holding),
      delayedOrderRub:round(delayedOrderRub),outstandingOrderDays:pending.length});
  }
  return {caseId:"D11-CASE-003",modelId:input.id,
    inputFingerprint:networkFingerprint(input),mode,days:timeline,
    orderCount:input.orders.length,deliveredOrders:completedOrders,
    onTimeOrders,pendingOrders:input.orders.filter(o=>!completed.has(o.id)).map(o=>o.id),
    delayedOrderDays,lastMileKm:round(lastMileKm),trunkKm:round(trunkKm),
    transportRub:round(transportRub),facilitiesRub:round(facilitiesRub),
    holdingRub:round(holdingRub),delayedOrdersRub:round(delayedOrdersRub),
    totalRub:round(transportRub+facilitiesRub+holdingRub+delayedOrdersRub),
    servicePercent:round(completedOrders/input.orders.length*100),
    onTimePercent:round(onTimeOrders/input.orders.length*100),audit:[]};
}
export function compareNetwork(input:NetworkInput):NetworkComparison{
  const baseline=simulateNetwork(input,"central-only");
  const regional=simulateNetwork(input,"regional-network");
  const additionalDelivered=regional.deliveredOrders-baseline.deliveredOrders;
  const additionalOnTime=regional.onTimeOrders-baseline.onTimeOrders;
  const comparable=regional.deliveredOrders>=baseline.deliveredOrders&&
    regional.onTimeOrders>=baseline.onTimeOrders;
  const lessCostly=regional.totalRub<=baseline.totalRub;
  const recommendation=comparable&&lessCostly?"regional-network":
    baseline.deliveredOrders>=regional.deliveredOrders&&baseline.onTimeOrders>=regional.onTimeOrders&&
    baseline.totalRub<=regional.totalRub?"central-only":"no-dominant-option";
  return {baseline,regional,additionalDelivered,additionalOnTime,
    avoidedOrderDays:baseline.delayedOrderDays-regional.delayedOrderDays,
    totalCostDifferenceRub:round(baseline.totalRub-regional.totalRub),
    comparable,recommendation};
}
export function auditNetwork(input:NetworkInput,value:NetworkResult):string[]{
  try{
    if(value.audit.length)return ["D11_NETWORK_DECLARED_AUDIT"];
    if(!same(simulateNetwork(input,value.mode),value))
      return ["D11_NETWORK_REPLAY_MISMATCH"];
    return [];
  }catch{return ["D11_NETWORK_REPLAY_FAILED"];}
}
