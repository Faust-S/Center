import test from "node:test";
import assert from "node:assert/strict";
import {createCase005} from "../model/logistics/case005-data.ts";
import {validateYardInput,simulateYard,compareYard,auditYard} from "../model/logistics/case005-yard.ts";
import {selectDock} from "../model/logistics/warehouse.ts";
import {runScenario} from "../model/logistics/engine.ts";

function physics(input,report){
  const initial=Object.fromEntries(input.skus.map(s=>[s.skuId,input.openingStock[s.skuId]??0]));
  const acquired={},delivered={};
  const truckById=new Map(input.incoming.map(t=>[t.id,t]));
  const orderById=new Map(input.orders.map(o=>[o.id,o]));
  const seenTrucks=new Set(),seenOrders=new Set();
  for(const day of report.days){
    for(const truck of day.incoming.filter(t=>t.status.startsWith("unloaded"))){
      assert.ok(!seenTrucks.has(truck.id),"one supplier consignment must be unloaded at most once");
      seenTrucks.add(truck.id);
      for(const line of truckById.get(truck.id).lines)
        acquired[line.skuId]=(acquired[line.skuId]??0)+line.units;
    }
    for(const order of day.outbound.filter(t=>t.status==="delivered")){
      assert.ok(!seenOrders.has(order.orderId),"outbound order must be accepted only once");
      seenOrders.add(order.orderId);
      for(const line of orderById.get(order.orderId).lines)
        delivered[line.skuId]=(delivered[line.skuId]??0)+line.units;
    }
    for(const sku of day.sku){
      assert.equal(sku.opening+sku.receivedSameDay+sku.receivedFromStaging+
        sku.inspectedReturns-sku.dispatched,sku.closing);
      assert.equal(sku.dispatched,sku.delivered+sku.customerReturned);
      assert.equal(sku.closing+sku.staged+sku.awaitingReturn,
        (initial[sku.skuId]??0)+(acquired[sku.skuId]??0)-(delivered[sku.skuId]??0));
      assert.ok(sku.closing>=0);
    }
    const visited=new Set();
    for(const order of day.outbound.filter(o=>o.vehicleId!==null)){
      const key=order.vehicleId+":"+order.loadStartMinute;
      if(visited.has(key))continue;
      visited.add(key);
      assert.ok(day.dockBlocks.filter(d=>d.bay===order.loadingBay).every(b=>
        order.loadStartMinute>=b.endMinute||
        order.loadStartMinute+input.warehouse.loadMinutes<=b.startMinute),
        "incoming and outgoing trucks must never occupy the same loading bay");
    }
  }
  assert.equal(seenOrders.size,report.deliveredOrders);
}
test("CASE-005 executes 10 operational days, 160 supplier vehicles and 240 store orders",()=>{
  const input=createCase005();
  validateYardInput(input);
  assert.equal(input.days.length,10);
  assert.equal(input.incoming.length,160);
  assert.equal(input.orders.length,240);
  assert.equal(input.skus.length,10);
  const report=compareYard(input);
  for(const alternative of [report.traditional,report.crossdock]){
    assert.deepEqual(alternative.audit,[]);
    assert.deepEqual(auditYard(input,alternative),[]);
    assert.equal(alternative.deliveredOrders+alternative.outstandingOrders.length,240);
    assert.ok(alternative.transportRub>0&&alternative.handlingRub>0);
    physics(input,alternative);
  }
  assert.equal(report.traditional.directCrossdockTrucks,0);
  assert.ok(report.crossdock.directCrossdockTrucks>0);
  assert.notDeepEqual(report.traditional.days,report.crossdock.days);
});
test("physical same-day acceptance requires unload and inspection before warehouse picking",()=>{
  const input=createCase005();
  const report=compareYard(input);
  const direct=report.crossdock.days[0].incoming.find(t=>t.status==="unloaded-crossdock");
  assert.ok(direct);
  assert.equal(direct.availableDay,input.days[0]);
  assert.ok(direct.unloadFinishMinute<=input.pickingStartMinute);
  assert.ok(report.traditional.days[0].incoming.every(t=>t.status!=="unloaded-crossdock"));
  const staged=report.crossdock.days[0].incoming.find(t=>t.status==="unloaded-staged");
  assert.ok(staged);
  assert.equal(staged.availableDay,input.days[1]);
  physics(input,report.crossdock);
});
test("existing D11 dock scheduler shifts outbound load past physical inbound appointment",()=>{
  const day="2026-11-16";
  const project={
    id:"SHARED-DOCK-TEST",days:[day],
    orders:[{id:"OUT-1",day,customerId:"STORE-1",zone:0,xKm:15,yKm:5,
      weightKg:15,volumeM3:0.05,serviceMinutes:15,windowStart:650,windowEnd:1100}],
    fleet:[{id:"TRUCK-1",kind:"owned",zone:0,capacityKg:1000,capacityM3:8,
      shiftStart:600,shiftEnd:1230,kmRateRub:5,hourRateRub:200,activationRub:0}],
    warehouse:{bays:1,loadMinutes:30,dailyOrderCapacity:4,pickers:1,
      pickMinutesPerOrder:5,pickingStartMinute:600,pickingEndMinute:900,
      dockBlocks:[{day,bay:0,startMinute:595,endMinute:685,reference:"IN-1"}]},
    road:{gridDetourFactor:1.2,avgKmHour:55},ownedDailyFixedRub:300,fuelMultiplier:1,
  };
  const plan=runScenario(project,"to-be");
  assert.deepEqual(plan.audit,[]);
  assert.equal(plan.days[0].runs[0].loadStartMinute,685);
  assert.throws(()=>runScenario({...project,warehouse:{...project.warehouse,
    dockBlocks:[...project.warehouse.dockBlocks,
      {day,bay:0,startMinute:630,endMinute:700,reference:"IN-2"}]}},"to-be"),
    /D11_DOCK_BLOCKS_INVALID/);
  assert.equal(selectDock([600,600],600,40,
    [{bay:0,startMinute:610,endMinute:680}]).bay,1);
});
test("missing supplier paperwork keeps the goods physically off the outgoing stock ledger",()=>{
  const input=createCase005({documentDelays:true});
  const result=simulateYard(input,"crossdock");
  const held=result.days[0].incoming.find(t=>t.status==="document-hold");
  assert.ok(held);
  assert.ok(result.days.slice(1).some(d=>d.incoming.some(x=>x.id===held.id&&
    x.status.startsWith("unloaded"))));
  physics(input,result);
  assert.deepEqual(auditYard(input,result),[]);
});
test("constrained docks, late trucks and less staging capacity create real unserved orders",()=>{
  const input=createCase005({docks:2,stagingCapacity:80,
    supplierDelayMinutes:240,customerDemandPercent:150,trafficPercent:150});
  const report=simulateYard(input,"crossdock");
  assert.ok(report.postponedTrucks>0);
  assert.ok(report.outstandingOrders.length>0||report.orderDelayDays>0);
  physics(input,report);
  assert.deepEqual(auditYard(input,report),[]);
});
test("customer refusal enters next-day inspection, never immediate usable stock",()=>{
  const source=createCase005();
  const original=simulateYard(source,"crossdock");
  const first=original.days[0].outbound.find(e=>e.status==="delivered");
  assert.ok(first);
  const interrupted=createCase005({refuseCustomerIds:[first.orderId]});
  const actual=simulateYard(interrupted,"crossdock");
  assert.equal(actual.days[0].outbound.find(x=>x.orderId===first.orderId).status,"refused");
  assert.ok(actual.days[0].sku.some(s=>s.awaitingReturn>0));
  assert.ok(actual.days.slice(1).some(d=>d.sku.some(s=>s.inspectedReturns>0)));
  physics(interrupted,actual);
  assert.deepEqual(auditYard(interrupted,actual),[]);
});
test("forged dock, price, and SKU results are rejected by domain replay",()=>{
  const input=createCase005(),base=simulateYard(input,"crossdock");
  assert.deepEqual(auditYard(input,JSON.parse(JSON.stringify(base))),[]);
  const forged=structuredClone(base);
  forged.days[0].sku[0].closing+=5;
  assert.deepEqual(auditYard(input,forged),["D11_YARD_REPLAY_MISMATCH"]);
  const altered=structuredClone(input);
  altered.openingStock["DRY-01"]+=3;
  assert.deepEqual(auditYard(altered,base),["D11_YARD_REPLAY_MISMATCH"]);
});
test("malformed appointments, orders, stock, SKU, dock counts and refusal IDs are refused",()=>{
  const edits=[
    i=>{i.incoming[0].lines[0].skuId="MISSING";},
    i=>{i.orders[0].storeId="MISSING";},
    i=>{i.orders[0].id=i.orders[1].id;},
    i=>{i.incoming[0].unloadMinutes=-4;},
    i=>{i.openingStock["DRY-01"]=-3;},
    i=>{i.warehouse.bays=i.dockCount+1;},
    i=>{i.stagingCapacityUnits=0;},
    i=>{i.days[1]=i.days[0];},
    i=>{i.refusedCustomerIds=["INVALID"];},
    i=>{i.incoming[0].documentationAvailableDay="invalid";},
  ];
  for(const change of edits){
    const input=createCase005();change(input);
    assert.throws(()=>validateYardInput(input),/D11_YARD_/);
  }
});
