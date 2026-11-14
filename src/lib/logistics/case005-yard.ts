/** D11 CASE-005 | Real dock appointments and warehouse cross-docking.
 * Existing D11 selectDock, route engine, operation replay and inventory audit
 * are the only calendar/dispatch/persistence mechanisms; this module joins
 * inbound supplier operations to outbound customer distribution physically.
 */
import { runScenario, type Project, type Vehicle, type Order } from "./engine.ts";
import { calculateVerifiedInventory, simulateOperations, type OperationSettings } from "./execution.ts";
import { inspectionReleaseDay, type OrderLine } from "./inventory.ts";
import { selectDock } from "./warehouse.ts";

export type YardMode = "traditional" | "crossdock";
export interface YardSku { skuId:string; name:string; weightKg:number; volumeM3:number; valueRub:number; }
export interface SupplierTruck {
  id:string; bookedDay:string; actualArrivalMinute:number;
  unloadMinutes:number; supplierId:string; documentationAvailableDay:string;
  lines:OrderLine[];
}
export interface YardStore { id:string; name:string; xKm:number; yKm:number; zone:number; }
export interface YardOrder { id:string; day:string; storeId:string;
  lines:OrderLine[]; windowStart:number; windowEnd:number;
  priority:"urgent"|"routine"; }
export interface YardConfig {
  id:string; days:string[]; skus:YardSku[];
  incoming:SupplierTruck[]; stores:YardStore[]; orders:YardOrder[];
  openingStock:Record<string,number>; dockCount:number; stagingCapacityUnits:number;
  pickingStartMinute:number; unloadOpenMinute:number; maxTruckWaitMinutes:number;
  unloadingCostRubPerHour:number; demurrageRubPerHour:number;
  holdingCostRubPerUnitDay:number; lostServiceRubPerOrderDay:number;
  inspectionMinutes:number; laborCrews:number;
  outboundFleet:Vehicle[]; warehouse:Project["warehouse"];
  road:Project["road"]; fuelMultiplier:number; ownedDailyFixedRub:number;
  operation:Partial<OperationSettings>; refusedCustomerIds?:string[];
}
export interface InboundFact {
  id:string; bookedDay:string; operatingDay:string; supplierId:string;
  arrivalMinute:number; dock:number|null; unloadStartMinute:number|null;
  unloadFinishMinute:number|null; queueMinutes:number;
  units:number; status:"unloaded-crossdock"|"unloaded-staged"|"queue-next-day"|"document-hold";
  availableDay:string|null; reason:string;
}
export interface OutboundFact {
  orderId:string; dueDay:string; operatingDay:string; storeId:string;
  vehicleId:string|null; loadingBay:number|null; loadStartMinute:number|null;
  status:"delivered"|"refused"|"unserved";
  reason:string; units:number; completionMinute:number|null;
}
export interface YardSkuLedger {
  skuId:string; opening:number; receivedSameDay:number; receivedFromStaging:number;
  inspectedReturns:number; dispatched:number; delivered:number;
  customerReturned:number; closing:number; staged:number; awaitingReturn:number;
}
export interface YardDay {
  day:string; incoming:InboundFact[]; outbound:OutboundFact[];
  sku:YardSkuLedger[]; dockBlocks:{day:string;bay:number;startMinute:number;endMinute:number;reference:string}[];
  completedOrders:string[]; waitingOrders:string[];
  queueNextDay:string[]; documentsHeld:string[];
  dockingRub:number; demurrageRub:number; storageRub:number;
  transportRub:number; unfilledRub:number; totalRub:number;
}
export interface YardResult {
  caseId:"D11-CASE-005"; inputFingerprint:string; projectId:string; mode:YardMode;
  days:YardDay[]; supplierTruckCount:number; outboundOrderCount:number;
  unloadedTrucks:number; stagedTrucks:number; directCrossdockTrucks:number;
  postponedTrucks:number; deliveredOrders:number; outstandingOrders:string[];
  refusedOrders:number; orderDelayDays:number; handlingRub:number;
  demurrageRub:number; storageRub:number; transportRub:number;
  unfilledRub:number; totalRub:number; audit:string[];
}
export interface YardComparison {
  traditional:YardResult; crossdock:YardResult;
  additionalDelivered:number; avoidedOrderDelayDays:number; savedTotalRub:number;
  recommendation:"traditional"|"crossdock"|"no-dominant-option";
}
const round=(n:number)=>Math.round(n*100)/100;
const positive=(x:unknown)=>typeof x==="number"&&Number.isFinite(x)&&x>0;
const money=(x:unknown)=>typeof x==="number"&&Number.isFinite(x)&&x>=0;
const nonnegative=(x:unknown)=>Number.isSafeInteger(x)&&(x as number)>=0;
const units=(lines:readonly OrderLine[])=>lines.reduce((n,x)=>n+x.units,0);
const total=(r:Record<string,number>)=>Object.values(r).reduce((n,x)=>n+x,0);
const add=(r:Record<string,number>,skuId:string,n:number)=>{r[skuId]=(r[skuId]??0)+n;};
const copy=(r:Record<string,number>)=>({...r});
const date=(s:string)=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&
  Number.isFinite(Date.parse(s+"T00:00:00.000Z"))&&
  new Date(s+"T00:00:00.000Z").toISOString().slice(0,10)===s;
function unique(ids:string[],what:string){
  if(new Set(ids).size!==ids.length||ids.some(x=>!x||typeof x!=="string"))
    throw Error("D11_YARD_DUPLICATE_"+what);
}
function fingerprint(data:unknown):string{
  let fnv=2166136261,adler=1;const str=JSON.stringify(data);
  for(let i=0;i<str.length;i++){
    const c=str.charCodeAt(i);fnv=Math.imul(fnv^c,16777619);adler=(adler+c)%65521;
  }
  return "d11-yard-"+(fnv>>>0).toString(16).padStart(8,"0")+adler.toString(16).padStart(4,"0");
}
export const yardFingerprint=(input:YardConfig)=>fingerprint(input);
export function validateYardInput(input:YardConfig):void{
  if(!input||typeof input.id!=="string"||!input.id||
     !Array.isArray(input.days)||!input.days.length||input.days.length>45||
     input.days.some((d,i)=>!date(d)||(i>0&&d<=input.days[i-1]))||
     !Array.isArray(input.skus)||!input.skus.length||input.skus.length>80||
     !Array.isArray(input.incoming)||input.incoming.length>3000||
     !Array.isArray(input.stores)||!input.stores.length||input.stores.length>200||
     !Array.isArray(input.orders)||!input.orders.length||input.orders.length>10000||
     !input.openingStock||typeof input.openingStock!=="object"||
     !nonnegative(input.dockCount)||input.dockCount<1||input.dockCount>12||
     !nonnegative(input.stagingCapacityUnits)||input.stagingCapacityUnits<1||
     !nonnegative(input.unloadOpenMinute)||input.unloadOpenMinute>1200||
     !nonnegative(input.pickingStartMinute)||input.pickingStartMinute>1400||
     input.pickingStartMinute<=input.unloadOpenMinute||
     !nonnegative(input.maxTruckWaitMinutes)||input.maxTruckWaitMinutes>1440||
     !money(input.unloadingCostRubPerHour)||!money(input.demurrageRubPerHour)||
     !money(input.holdingCostRubPerUnitDay)||!money(input.lostServiceRubPerOrderDay)||
     !nonnegative(input.inspectionMinutes)||!nonnegative(input.laborCrews)||
     input.laborCrews<1||input.laborCrews>20||
     !Array.isArray(input.outboundFleet)||!input.outboundFleet.length||
     !input.warehouse||!input.road||!positive(input.fuelMultiplier)||
     !money(input.ownedDailyFixedRub))
    throw Error("D11_YARD_INPUT_INVALID");
  unique(input.skus.map(x=>x.skuId),"SKU");
  unique(input.incoming.map(x=>x.id),"TRUCK");
  unique(input.stores.map(x=>x.id),"STORE");
  unique(input.orders.map(x=>x.id),"ORDER");
  unique(input.outboundFleet.map(x=>x.id),"VEHICLE");
  const sku=new Set(input.skus.map(x=>x.skuId));
  const store=new Set(input.stores.map(x=>x.id));
  for(const s of input.skus)
    if(!s.name||!positive(s.weightKg)||!positive(s.volumeM3)||!money(s.valueRub))
      throw Error("D11_YARD_SKU_INVALID");
  if(Object.keys(input.openingStock).some(x=>!sku.has(x))||
     Object.values(input.openingStock).some(x=>!nonnegative(x)))
    throw Error("D11_YARD_OPENING_INVALID");
  for(const s of input.stores)
    if(!s.name||!Number.isFinite(s.xKm)||!Number.isFinite(s.yKm)||
       !nonnegative(s.zone))
      throw Error("D11_YARD_STORE_INVALID");
  const validLines=(lines:OrderLine[])=>Array.isArray(lines)&&lines.length>0&&
    lines.length<=80&&new Set(lines.map(x=>x.skuId)).size===lines.length&&
    lines.every(line=>sku.has(line.skuId)&&nonnegative(line.units)&&line.units>0);
  for(const truck of input.incoming)
    if(!truck.id||!truck.supplierId||!input.days.includes(truck.bookedDay)||
       !date(truck.documentationAvailableDay)||
       !nonnegative(truck.actualArrivalMinute)||truck.actualArrivalMinute>1440||
       !nonnegative(truck.unloadMinutes)||truck.unloadMinutes<5||
       truck.unloadMinutes>240||!validLines(truck.lines))
      throw Error("D11_YARD_SUPPLIER_INVALID:"+truck.id);
  for(const order of input.orders)
    if(!input.days.includes(order.day)||!store.has(order.storeId)||
       !validLines(order.lines)||!["urgent","routine"].includes(order.priority)||
       !nonnegative(order.windowStart)||!nonnegative(order.windowEnd)||
       order.windowEnd>1440||order.windowEnd<=order.windowStart)
      throw Error("D11_YARD_ORDER_INVALID:"+order.id);
  const refused=new Set(input.orders.map(o=>o.id));
  if(input.refusedCustomerIds?.some(id=>!refused.has(id)))
    throw Error("D11_YARD_REFUSAL_INVALID");
  unique(input.refusedCustomerIds??[],"REFUSAL");
  // The outbound scheduler uses exactly this physical bay count.
  if(input.warehouse.bays!==input.dockCount)
    throw Error("D11_YARD_SHARED_DOCK_COUNT_INVALID");
}
interface AcceptedTruck {
  truckId:string; lines:OrderLine[];
  releaseDay:string|null; crossdock:boolean;
}
interface HeldReturn {skuId:string;units:number;releaseDay:string|null;}
function nextConfiguredDay(input:YardConfig,day:string):string|null{
  return input.days.find(d=>d>day)??null;
}
function physicalDeliveryModel(input:YardConfig,day:string,
  ready:Record<string,number>,orders:YardOrder[],
  blocks:YardDay["dockBlocks"]):Project{
  const stores=new Map(input.stores.map(s=>[s.id,s]));
  const skus=new Map(input.skus.map(s=>[s.skuId,s]));
  const all:Order[]=orders.map(o=>{
    const shop=stores.get(o.storeId)!;
    return {id:o.id,day,customerId:shop.id,zone:shop.zone,
      xKm:shop.xKm,yKm:shop.yKm,windowStart:o.windowStart,
      windowEnd:o.windowEnd,serviceMinutes:14,lines:o.lines.map(l=>({...l})),
      weightKg:round(o.lines.reduce((n,l)=>n+l.units*skus.get(l.skuId)!.weightKg,0)),
      volumeM3:round(o.lines.reduce((n,l)=>n+l.units*skus.get(l.skuId)!.volumeM3,0))};
  });
  return {id:input.id+":"+day,days:[day],orders:all,fleet:input.outboundFleet,
    warehouse:{...input.warehouse,dockBlocks:blocks},
    road:input.road,fuelMultiplier:input.fuelMultiplier,
    ownedDailyFixedRub:input.ownedDailyFixedRub,
    inventory:input.skus.map(s=>({skuId:s.skuId,openingUnits:ready[s.skuId]??0,
      unitWeightKg:s.weightKg,unitVolumeM3:s.volumeM3}))};
}
/** A supplier load must physically unload AND pass documents & inspection.
 * Crossdock stock is only released when its inbound check completes BEFORE
 * outbound picking opens. All later or traditional arrivals wait overnight.
 * Inbound dock time blocks are passed into the existing outbound planner. */
export function simulateYard(input:YardConfig,mode:YardMode):YardResult{
  validateYardInput(input);
  if(mode!=="traditional"&&mode!=="crossdock")
    throw Error("D11_YARD_MODE_INVALID");
  const stock:Record<string,number>={};
  const skus=input.skus.map(x=>x.skuId);
  for(const sku of skus)stock[sku]=input.openingStock[sku]??0;
  const supplier=new Map(input.incoming.map(t=>[t.id,t]));
  const stores=new Map(input.orders.map(o=>[o.id,o]));
  const received=new Set<string>();
  const completed=new Set<string>();
  const customerRefusalUsed=new Set<string>();
  const pendingSupplier=new Set<string>();
  const staged:AcceptedTruck[]=[];
  const customerReturns:HeldReturn[]=[];
  const ledger:YardDay[]=[];
  const deliveredTotal:Record<string,number>={};
  const acceptedInboundTotal:Record<string,number>={};
  const initial=copy(stock);
  let unloadedTrucks=0,stagedTrucks=0,directCrossdockTrucks=0,
    postponedTrucks=0,deliveredOrders=0,refusedOrders=0,orderDelayDays=0;
  let handlingRub=0,demurrageRub=0,storageRub=0,transportRub=0,unfilledRub=0;
  for(const day of input.days){
    const opening=copy(stock),receiptSame:Record<string,number>={},
      receiptStaged:Record<string,number>={},releaseReturns:Record<string,number>={},
      dispatched:Record<string,number>={},delivered:Record<string,number>={},
      customerReturned:Record<string,number>={};
    const incoming:InboundFact[]=[],outbound:OutboundFact[]=[];
    const dockBlocks:YardDay["dockBlocks"]=[];
    let costDock=0,costWait=0;
    for(let i=staged.length-1;i>=0;i--){
      if(staged[i].releaseDay!==day)continue;
      const truck=staged.splice(i,1)[0];
      for(const line of truck.lines){
        add(stock,line.skuId,line.units);
        add(receiptStaged,line.skuId,line.units);
      }
    }
    for(let i=customerReturns.length-1;i>=0;i--){
      if(customerReturns[i].releaseDay!==day)continue;
      const item=customerReturns.splice(i,1)[0];
      add(stock,item.skuId,item.units);
      add(releaseReturns,item.skuId,item.units);
    }
    const bayFree=new Array<number>(input.dockCount).fill(input.unloadOpenMinute);
    const laborAvailable=new Array<number>(input.laborCrews).fill(input.unloadOpenMinute);
    const today=[...input.incoming.filter(t=>t.bookedDay===day).map(t=>t.id),...pendingSupplier];
    pendingSupplier.clear();
    const due=[...new Set(today)].filter(id=>!received.has(id))
      .map(id=>supplier.get(id)!).sort((a,b)=>
        (a.bookedDay===day?a.actualArrivalMinute:input.unloadOpenMinute)-
        (b.bookedDay===day?b.actualArrivalMinute:input.unloadOpenMinute)||
        a.id.localeCompare(b.id));
    for(const truck of due){
      const qty=units(truck.lines);
      const arriving=truck.bookedDay===day?
        Math.max(input.unloadOpenMinute,truck.actualArrivalMinute):
        input.unloadOpenMinute;
      const heldDoc=truck.documentationAvailableDay>day;
      const state={
        id:truck.id,bookedDay:truck.bookedDay,operatingDay:day,
        supplierId:truck.supplierId,arrivalMinute:arriving,
        dock:null as number|null,unloadStartMinute:null as number|null,
        unloadFinishMinute:null as number|null,queueMinutes:0,units:qty,
        status:"queue-next-day" as InboundFact["status"],availableDay:null as string|null,
        reason:"dock-unavailable",
      };
      if(heldDoc){
        state.status="document-hold";state.reason="missing-valid-supplier-documents";
        pendingSupplier.add(truck.id);incoming.push(state);continue;
      }
      const crew=Math.min(...laborAvailable);
      const crewIndex=laborAvailable.indexOf(crew);
      const dock=selectDock(bayFree,Math.max(arriving,crew),
        truck.unloadMinutes+input.inspectionMinutes);
      const waited=Math.max(0,dock.startMinute-arriving);
      state.queueMinutes=waited;
      if(waited>input.maxTruckWaitMinutes||dock.endMinute>1440){
        state.reason="supplier-queue-or-working-hours";
        pendingSupplier.add(truck.id);postponedTrucks++;
        incoming.push(state);continue;
      }
      const direct=mode==="crossdock"&&dock.endMinute<=input.pickingStartMinute;
      // No unbounded staging: direct unload needs no overnight floor position.
      const occupied=staged.reduce((n,t)=>n+units(t.lines),0);
      if(!direct&&occupied+qty>input.stagingCapacityUnits){
        state.reason="staging-capacity";
        pendingSupplier.add(truck.id);postponedTrucks++;
        incoming.push(state);continue;
      }
      state.dock=dock.bay;state.unloadStartMinute=dock.startMinute;
      state.unloadFinishMinute=dock.endMinute;
      state.status=direct?"unloaded-crossdock":"unloaded-staged";
      state.availableDay=direct?day:nextConfiguredDay(input,day);
      state.reason=direct?"qualified-before-picking":"overnight-staging-required";
      bayFree[dock.bay]=dock.endMinute;
      laborAvailable[crewIndex]=dock.endMinute;
      dockBlocks.push({day,bay:dock.bay,startMinute:dock.startMinute,
        endMinute:dock.endMinute,reference:truck.id});
      costDock+=round((truck.unloadMinutes+input.inspectionMinutes)/60*
        input.unloadingCostRubPerHour);
      costWait+=round(Math.max(0,waited-30)/60*input.demurrageRubPerHour);
      received.add(truck.id);unloadedTrucks++;
      if(direct){
        for(const line of truck.lines)add(stock,line.skuId,line.units);
        for(const line of truck.lines)add(receiptSame,line.skuId,line.units);
        directCrossdockTrucks++;
      }else{
        staged.push({truckId:truck.id,lines:truck.lines,releaseDay:state.availableDay,
          crossdock:false});
        stagedTrucks++;
      }
      for(const line of truck.lines)add(acceptedInboundTotal,line.skuId,line.units);
      incoming.push(state);
    }
    const waiting=input.orders.filter(o=>o.day<=day&&!completed.has(o.id))
      .sort((a,b)=>(a.priority==="urgent"?0:1)-(b.priority==="urgent"?0:1)||
        a.day.localeCompare(b.day)||a.id.localeCompare(b.id));
    const project=physicalDeliveryModel(input,day,stock,waiting,dockBlocks);
    const scenario=runScenario(project,"to-be");
    if(scenario.audit.length)throw Error("D11_YARD_PLAN:"+scenario.audit[0]);
    const manual=(input.refusedCustomerIds??[]).filter(id=>
      waiting.some(o=>o.id===id)&&!customerRefusalUsed.has(id));
    const actual=simulateOperations(project,scenario,{
      ...input.operation,customerRefusalOrderIds:manual});
    const inventory=calculateVerifiedInventory(project,scenario,actual);
    if(inventory.audit.length||actual.audit.length)
      throw Error("D11_YARD_EXECUTION:"+(actual.audit[0]??inventory.audit[0]));
    const tripByOrder=new Map(actual.days[0].trips.flatMap(t=>t.deliveries.map(e=>[
      e.orderId,{...e,returnMinute:t.returnMinute,vehicleId:t.vehicleId,
        loadingBay:t.loadingBay,loadStartMinute:t.loadStartMinute},
    ] as const)));
    for(const row of inventory.days[0].movements){
      stock[row.skuId]=row.closingUnits;
      add(dispatched,row.skuId,row.issued);
      add(delivered,row.skuId,row.delivered);
      add(customerReturned,row.skuId,row.issued-row.delivered);
      add(deliveredTotal,row.skuId,row.delivered);
    }
    for(const order of waiting){
      const event=tripByOrder.get(order.id);
      if(!event){
        outbound.push({orderId:order.id,dueDay:order.day,operatingDay:day,
          storeId:order.storeId,vehicleId:null,loadingBay:null,loadStartMinute:null,
          status:"unserved",
          reason:scenario.days[0].unserved.find(r=>r.orderId===order.id)?.reason??"fleet-limit",
          units:units(order.lines),completionMinute:null});
      }else{
        if(event.status==="refused"){
          refusedOrders++;
          if(manual.includes(order.id))customerRefusalUsed.add(order.id);
          const release=inspectionReleaseDay(
            {days:input.days} as Project,day,event.returnMinute);
          for(const line of order.lines)
            customerReturns.push({skuId:line.skuId,units:line.units,releaseDay:release});
        }else{
          completed.add(order.id);deliveredOrders++;
        }
        outbound.push({orderId:order.id,dueDay:order.day,operatingDay:day,
          storeId:order.storeId,vehicleId:event.vehicleId,
          loadingBay:event.loadingBay,loadStartMinute:event.loadStartMinute,
          status:event.status==="refused"?"refused":"delivered",
          reason:event.status==="refused"?"customer-or-window-refusal":"completed",
          units:units(order.lines),completionMinute:event.completionMinute});
      }
    }
    const waitingOrders=input.orders.filter(o=>o.day<=day&&!completed.has(o.id))
      .map(o=>o.id);
    orderDelayDays+=waitingOrders.length;
    const dayUnfilledRub=waitingOrders.length*input.lostServiceRubPerOrderDay;
    const storageRubDay=round((total(stock)+staged.reduce((n,t)=>n+units(t.lines),0))*
      input.holdingCostRubPerUnitDay);
    const transport=actual.totalCostRub;
    const dayTotal=round(costDock+costWait+storageRubDay+transport+dayUnfilledRub);
    handlingRub+=costDock;demurrageRub+=costWait;
    storageRub+=storageRubDay;transportRub+=transport;unfilledRub+=dayUnfilledRub;
    const stagedTotal:Record<string,number>={},pendingReturn:Record<string,number>={};
    for(const item of staged)for(const line of item.lines)add(stagedTotal,line.skuId,line.units);
    for(const item of customerReturns)add(pendingReturn,item.skuId,item.units);
    const sku:YardSkuLedger[]=skus.map(skuId=>({
      skuId,opening:opening[skuId]??0,
      receivedSameDay:receiptSame[skuId]??0,
      receivedFromStaging:receiptStaged[skuId]??0,
      inspectedReturns:releaseReturns[skuId]??0,
      dispatched:dispatched[skuId]??0,delivered:delivered[skuId]??0,
      customerReturned:customerReturned[skuId]??0,
      closing:stock[skuId]??0,staged:stagedTotal[skuId]??0,
      awaitingReturn:pendingReturn[skuId]??0,
    }));
    for(const row of sku){
      if(row.opening+row.receivedSameDay+row.receivedFromStaging+
         row.inspectedReturns-row.dispatched!==row.closing||row.closing<0||
         row.delivered+row.customerReturned!==row.dispatched)
        throw Error("D11_YARD_STOCK_LEDGER:"+day+":"+row.skuId);
      const balance=(initial[row.skuId]??0)+(acceptedInboundTotal[row.skuId]??0)-
        (deliveredTotal[row.skuId]??0);
      if(balance!==row.closing+row.staged+row.awaitingReturn)
        throw Error("D11_YARD_PHYSICAL_CONSERVATION:"+day+":"+row.skuId);
    }
    const sorted=dockBlocks.sort((a,b)=>a.bay-b.bay||a.startMinute-b.startMinute);
    if(sorted.some((block,i)=>sorted.slice(i+1).some(other=>
      other.bay===block.bay&&block.startMinute<other.endMinute&&
      other.startMinute<block.endMinute)))
      throw Error("D11_YARD_DOCK_OVERLAP");
    ledger.push({day,incoming,outbound,sku,dockBlocks:sorted,
      completedOrders:outbound.filter(o=>o.status==="delivered").map(o=>o.orderId),
      waitingOrders,queueNextDay:[...pendingSupplier],documentsHeld:incoming
        .filter(x=>x.status==="document-hold").map(x=>x.id),
      dockingRub:round(costDock),demurrageRub:round(costWait),
      storageRub:storageRubDay,transportRub:transport,unfilledRub:dayUnfilledRub,
      totalRub:dayTotal});
  }
  const outstandingOrders=input.orders.filter(o=>!completed.has(o.id)).map(o=>o.id);
  return {caseId:"D11-CASE-005",inputFingerprint:yardFingerprint(input),projectId:input.id,
    mode,days:ledger,supplierTruckCount:input.incoming.length,
    outboundOrderCount:input.orders.length,unloadedTrucks,stagedTrucks,
    directCrossdockTrucks,postponedTrucks,deliveredOrders,outstandingOrders,
    refusedOrders,orderDelayDays,handlingRub:round(handlingRub),
    demurrageRub:round(demurrageRub),storageRub:round(storageRub),
    transportRub:round(transportRub),unfilledRub:round(unfilledRub),
    totalRub:round(handlingRub+demurrageRub+storageRub+transportRub+unfilledRub),
    audit:[]};
}
export function compareYard(input:YardConfig):YardComparison{
  const traditional=simulateYard(input,"traditional");
  const crossdock=simulateYard(input,"crossdock");
  const additionalDelivered=crossdock.deliveredOrders-traditional.deliveredOrders;
  const avoidedOrderDelayDays=traditional.orderDelayDays-crossdock.orderDelayDays;
  const savedTotalRub=round(traditional.totalRub-crossdock.totalRub);
  const better=crossdock.deliveredOrders>=traditional.deliveredOrders;
  const reverse=traditional.deliveredOrders>=crossdock.deliveredOrders;
  const recommendation=better&&savedTotalRub>=0?"crossdock":
    reverse&&savedTotalRub<=0?"traditional":"no-dominant-option";
  return {traditional,crossdock,additionalDelivered,avoidedOrderDelayDays,
    savedTotalRub,recommendation};
}
export function auditYard(input:YardConfig,result:YardResult):string[]{
  try{
    if(result.audit.length)return ["D11_YARD_DECLARED_AUDIT"];
    return JSON.stringify(simulateYard(input,result.mode))===JSON.stringify(result)
      ?[]:["D11_YARD_REPLAY_MISMATCH"];
  }catch{return ["D11_YARD_REPLAY_FAILED"];}
}
