import test from "node:test";
import assert from "node:assert/strict";
import {createCase003} from "../model/logistics/case003-data.ts";
import {validateNetworkInput,simulateNetwork,compareNetwork,auditNetwork,
  networkFingerprint} from "../model/logistics/case003-network.ts";

const total=(r)=>Object.values(r).reduce((n,v)=>n+v,0);
const skuUnits=(lines)=>lines.reduce((n,line)=>n+line.units,0);

function physicalConservation(input,report){
  const initial={};
  for(const center of input.centers)
    for(const [sku,units] of Object.entries(center.opening))
      initial[sku]=(initial[sku]??0)+units;
  const inbound={}, delivered={};
  for(const day of report.days){
    for(const r of input.receipts.filter(r=>r.day===day.day))
      inbound[r.skuId]=(inbound[r.skuId]??0)+r.units;
    for(const [sku,units] of Object.entries(day.deliveredUnits))
      delivered[sku]=(delivered[sku]??0)+units;
    for(const sku of input.skus){
      const id=sku.skuId;
      let accounted=(day.inTransit[id]??0)+(day.returnInspection[id]??0);
      for(const node of day.centers){
        accounted+=node.closing[id]??0;
        assert.equal(node.closing[id]??0,(node.opening[id]??0)+
          (node.supplierReceipts[id]??0)+(node.transfersIn[id]??0)+
          (node.inspectedReturns[id]??0)-(node.customerIssued[id]??0)-
          (node.transferIssued[id]??0));
        assert.ok(node.closing[id]>=0);
      }
      assert.equal(accounted,(initial[id]??0)+(inbound[id]??0)-(delivered[id]??0),
        "SKU goods must be conserved across depots, trucks and inspection: "+day.day+":"+id);
    }
  }
}
test("CASE-003 executes two distinct 10-day 24-shop projects using the original transport engine",()=>{
  const input=createCase003();
  validateNetworkInput(input);
  assert.equal(input.days.length,10);
  assert.equal(input.stores.length,24);
  assert.equal(input.skus.length,6);
  assert.equal(input.orders.length,240);
  const compared=compareNetwork(input);
  for(const result of [compared.baseline,compared.regional]){
    assert.deepEqual(result.audit,[]);
    assert.deepEqual(auditNetwork(input,result),[]);
    assert.equal(result.days.length,10);
    assert.equal(result.deliveredOrders+result.pendingOrders.length,result.orderCount);
    assert.ok(result.transportRub>0);
    assert.equal(result.totalRub,Math.round((result.transportRub+
      result.facilitiesRub+result.holdingRub+result.delayedOrdersRub)*100)/100);
    physicalConservation(input,result);
  }
  assert.notDeepEqual(compared.baseline.days,compared.regional.days);
  assert.equal(compared.baseline.days[0].centers.length,1);
  assert.equal(compared.regional.days[0].centers.length,3);
  assert.ok(compared.regional.trunkKm>0);
  assert.equal(compared.baseline.trunkKm,0);
  assert.equal(compared.baseline.inputFingerprint,networkFingerprint(input));
});
test("regional stock arrives after actual linehaul and never on its departure day",()=>{
  const input=createCase003();
  const result=simulateNetwork(input,"regional-network");
  const trunks=result.days.flatMap(d=>d.transfers);
  const arrived=trunks.filter(t=>t.status==="delivered"&&t.arrivalDay!==null);
  assert.ok(arrived.length>=2,"real transfer voyages must be accepted");
  for(const transfer of arrived){
    assert.ok(transfer.arrivalDay>transfer.day);
    const dispatch=result.days.find(d=>d.day===transfer.day);
    const receipt=result.days.find(d=>d.day===transfer.arrivalDay);
    for(const line of transfer.lines){
      assert.ok((dispatch.inTransit[line.skuId]??0)>=line.units);
      if(receipt)assert.ok((receipt.centers.find(c=>c.centerId===transfer.toId)
        .transfersIn[line.skuId]??0)>=line.units);
    }
  }
  physicalConservation(input,result);
});
test("location choice genuinely changes fleet assignments, geographic routes and operating costs",()=>{
  const both=compareNetwork(createCase003({regionalSelection:"both"}));
  const north=compareNetwork(createCase003({regionalSelection:"north"}));
  const south=compareNetwork(createCase003({regionalSelection:"south"}));
  for(const report of [both.regional,north.regional,south.regional])
    assert.deepEqual(report.audit,[]);
  assert.equal(both.regional.days[0].centers.length,3);
  assert.equal(north.regional.days[0].centers.length,2);
  assert.equal(south.regional.days[0].centers.length,2);
  assert.notDeepEqual(north.regional.days.flatMap(d=>d.customerEvents),
    south.regional.days.flatMap(d=>d.customerEvents));
  assert.notEqual(north.regional.transportRub,south.regional.transportRub);
  assert.notEqual(both.regional.totalRub,north.regional.totalRub);
  physicalConservation(createCase003({regionalSelection:"north"}),north.regional);
});
test("supplier receipts late beyond the horizon do not materialize as inventory",()=>{
  const input=createCase003({supplierDelayDays:2,demandPercent:150,trafficPercent:150});
  const compared=compareNetwork(input);
  assert.equal(input.receipts.some(r=>r.day>input.days.at(-1)),false);
  for(const report of [compared.baseline,compared.regional]){
    assert.deepEqual(report.audit,[]);
    physicalConservation(input,report);
  }
  assert.notDeepEqual(compared.regional.days.map(d=>d.centers.find(c=>c.centerId==="HUB").supplierReceipts),
    compareNetwork(createCase003({demandPercent:150,trafficPercent:150}))
      .regional.days.map(d=>d.centers.find(c=>c.centerId==="HUB").supplierReceipts));
});
test("explicitly refused store delivery is quarantined and reattempted, not credited as customer sale",()=>{
  const input=createCase003();
  const normal=simulateNetwork(input,"regional-network");
  const first=normal.days[0].customerEvents.find(e=>e.status==="on-time"||e.status==="late");
  assert.ok(first,"day-one store deliveries must be physical");
  const disrupted=createCase003({refusedStoreOrderIds:[first.orderId]});
  const actual=simulateNetwork(disrupted,"regional-network");
  const refused=actual.days[0].customerEvents.find(e=>e.orderId===first.orderId);
  assert.equal(refused.status,"refused");
  assert.ok(total(actual.days[0].returnInspection)>=refused.units);
  assert.equal(actual.days[0].completedOrderIds.includes(first.orderId),false);
  assert.ok(actual.days.some((d,i)=>i>0&&d.customerEvents.some(e=>
    e.orderId===first.orderId&&e.status!=="refused")));
  physicalConservation(disrupted,actual);
  assert.deepEqual(auditNetwork(disrupted,actual),[]);
});
test("linehaul refusal leaves the cargo in quarantine instead of inventing a regional receipt",()=>{
  const input=createCase003();
  const initial=simulateNetwork(input,"regional-network");
  const first=initial.days.flatMap(d=>d.transfers).find(t=>t.status==="delivered");
  assert.ok(first);
  const disrupted=createCase003({refusedTransferIds:[first.id]});
  const actual=simulateNetwork(disrupted,"regional-network");
  const refused=actual.days.flatMap(d=>d.transfers).find(t=>t.id===first.id);
  assert.equal(refused.status,"refused");
  assert.equal(refused.arrivalDay,null);
  const day=actual.days.find(d=>d.day===refused.day);
  assert.ok(total(day.returnInspection)>=skuUnits(refused.lines));
  physicalConservation(disrupted,actual);
});
test("reported savings cannot be approved by weakening service or ignoring fixed warehouses",()=>{
  const lowRent=compareNetwork(createCase003({regionalRentRubPerDay:3500}));
  const highRent=compareNetwork(createCase003({regionalRentRubPerDay:22000}));
  assert.ok(highRent.regional.facilitiesRub>lowRent.regional.facilitiesRub);
  assert.ok(highRent.regional.totalRub>lowRent.regional.totalRub);
  for(const result of [lowRent,highRent])
    if(result.recommendation==="regional-network"){
      assert.ok(result.regional.deliveredOrders>=result.baseline.deliveredOrders);
      assert.ok(result.regional.onTimeOrders>=result.baseline.onTimeOrders);
      assert.ok(result.regional.totalRub<=result.baseline.totalRub);
    }
});
test("tampering with stored stock, routes, cost or source fingerprint is rejected by replay",()=>{
  const input=createCase003();
  const result=simulateNetwork(input,"regional-network");
  const candidate=structuredClone(result);
  candidate.days[1].centers[0].closing["FMCG-01"]+=5;
  assert.deepEqual(auditNetwork(input,candidate),["D11_NETWORK_REPLAY_MISMATCH"]);
  const cost=structuredClone(result);
  cost.totalRub-=1000000;
  assert.deepEqual(auditNetwork(input,cost),["D11_NETWORK_REPLAY_MISMATCH"]);
  const model=structuredClone(input);
  model.centers[0].opening["FMCG-01"]+=1;
  assert.deepEqual(auditNetwork(model,result),["D11_NETWORK_REPLAY_MISMATCH"]);
});
test("invalid SKU, depot, order, receipt, region choice and material limits cannot be silently used",()=>{
  const make=createCase003;
  const changes=[
    i=>{i.orders[0].lines[0].skuId="UNKNOWN";},
    i=>{i.orders[0].id=i.orders[1].id;},
    i=>{i.orders[0].storeId="UNKNOWN";},
    i=>{i.centers[1].opening["FMCG-01"]=-3;},
    i=>{i.centers[1].capacityUnits=10;},
    i=>{i.centers[1].id="HUB";},
    i=>{i.days[1]=i.days[0];},
    i=>{i.receipts[0].units=-1;},
    i=>{i.selectedRegionalCenterIds=["UNKNOWN"];},
    i=>{i.transferLeadDays=0;},
    i=>{i.refusedOrderIds=["UNKNOWN"];},
    i=>{i.refusedTransferIds=["TR:UNKNOWN"];},
  ];
  for(const change of changes){
    const source=make();change(source);
    assert.throws(()=>validateNetworkInput(source),/D11_NETWORK_/);
  }
});
test("high demand, fewer usable depots, delayed supplier and fuel inflation remain physical and auditable",()=>{
  const project=createCase003({demandPercent:150,supplierDelayDays:2,
    regionalSelection:"north",trafficPercent:180,fuelMultiplier:1.6});
  const compared=compareNetwork(project);
  physicalConservation(project,compared.baseline);
  physicalConservation(project,compared.regional);
  assert.deepEqual(auditNetwork(project,compared.regional),[]);
  assert.ok(compared.regional.pendingOrders.length>0||
    compared.regional.delayedOrderDays>0);
  assert.notEqual(compared.regional.totalRub,compareNetwork(createCase003()).regional.totalRub);
});


test("actual SKU purchase prices change carrying costs, not delivery quantities",()=>{
  const lower=createCase003({annualCapitalRatePercent:12});
  const higher=createCase003({annualCapitalRatePercent:36});
  const a=simulateNetwork(lower,"regional-network");
  const b=simulateNetwork(higher,"regional-network");
  assert.equal(a.deliveredOrders,b.deliveredOrders);
  assert.equal(a.onTimeOrders,b.onTimeOrders);
  assert.equal(a.transportRub,b.transportRub);
  assert.ok(b.holdingRub>a.holdingRub);
  assert.ok(b.totalRub>a.totalRub);
  physicalConservation(lower,a);
  physicalConservation(higher,b);
});

test("receiving bottlenecks cannot silently accept excess supplier or crossdock cargo",()=>{
  const input=createCase003();
  const invalid=structuredClone(input);
  invalid.centers[0].dailyInboundCapacityUnits=50;
  assert.throws(()=>validateNetworkInput(invalid),/D11_NETWORK_SUPPLIER_CAPACITY/);
  const constrained=createCase003();
  constrained.centers.find(c=>c.id==="DC-N").dailyInboundCapacityUnits=35;
  const result=simulateNetwork(constrained,"regional-network");
  physicalConservation(constrained,result);
  for(const day of result.days)
    assert.ok(total(day.centers.find(c=>c.centerId==="DC-N").transfersIn)<=35);
});


test("CASE-003 production decision produces a traceable ten-day operating scorecard",()=>{
  const input=createCase003();
  const result=compareNetwork(input);
  const summary=(x)=>({
    servicePercent:x.servicePercent,onTimePercent:x.onTimePercent,
    deliveredOrders:x.deliveredOrders,onTimeOrders:x.onTimeOrders,
    waitingOrderDays:x.delayedOrderDays,transportRub:x.transportRub,
    facilitiesRub:x.facilitiesRub,holdingRub:x.holdingRub,
    lostServiceRub:x.delayedOrdersRub,totalRub:x.totalRub,
    lastMileKm:x.lastMileKm,trunkKm:x.trunkKm,
    deliveredTransfers:x.days.flatMap(d=>d.transfers).filter(t=>t.status==="delivered").length,
  });
  console.log("D11_CASE003_DECISION",JSON.stringify({
    orderCount:input.orders.length,
    baseline:summary(result.baseline),regional:summary(result.regional),
    economics: {avoidedOrderDays:result.avoidedOrderDays,
      additionalDelivered:result.additionalDelivered,
      additionalOnTime:result.additionalOnTime,
      totalCostDifferenceRub:result.totalCostDifferenceRub,
      recommendation:result.recommendation},
  }));
  assert.ok(result.baseline.orderCount===240&&result.regional.orderCount===240);
  assert.deepEqual(result.baseline.audit,[]);
  assert.deepEqual(result.regional.audit,[]);
});
