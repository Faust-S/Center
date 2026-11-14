import test from "node:test";
import assert from "node:assert/strict";
import { createCase004 } from "../model/logistics/case004-data.ts";
import { auditCold, compareCold, simulateCold, validateColdInput,
  inspectTemperature } from "../model/logistics/case004-coldchain.ts";

const total=(record)=>Object.values(record).reduce((n,x)=>n+x,0);
function conservation(input,result){
  const initial=Object.fromEntries(input.skus.map(s=>[s.skuId,input.opening[s.skuId]??0]));
  const received={},delivered={},destroyed={};
  for(const day of result.days){
    for(const sku of input.skus){
      const row=day.stock.find(x=>x.skuId===sku.skuId);
      assert.ok(row);
      const id=sku.skuId;
      received[id]=(received[id]??0)+row.receipts;
      delivered[id]=(delivered[id]??0)+row.accepted;
      destroyed[id]=(destroyed[id]??0)+row.destroyed;
      assert.equal(row.opening+row.receipts+row.inspectedReturns-row.issued,row.closing);
      assert.ok(row.closing>=0&&row.pendingInspection>=0&&row.pendingQuality>=0);
      assert.equal((initial[id]??0)+(received[id]??0),
        row.closing+(delivered[id]??0)+(destroyed[id]??0)+
        row.pendingInspection+row.pendingQuality,
        "no goods created or lost after quality inspections "+day.day+" "+id);
    }
  }
}
test("CASE-004 has an 8-day 96-order real per-SKU route and temperature-control ledger",()=>{
  const input=createCase004();
  validateColdInput(input);
  assert.equal(input.days.length,8);
  assert.equal(input.customers.length,12);
  assert.equal(input.orders.length,96);
  assert.equal(input.skus.length,4);
  assert.equal(input.loggers.length,input.days.length*input.fleet.length);
  assert.ok(input.loggers.every(x=>x.readings.length>60));
  const result=compareCold(input);
  for(const report of [result.uncontrolled,result.protected]){
    assert.deepEqual(report.audit,[]);
    assert.deepEqual(auditCold(input,report),[]);
    assert.equal(report.days.length,input.days.length);
    assert.equal(report.acceptedOrders+report.pendingOrders.length,input.orders.length);
    assert.ok(report.transportRub>0&&report.coolingRub>0);
    assert.ok(report.days.some(x=>x.events.some(e=>e.vehicleId!==null)));
    conservation(input,report);
  }
  assert.ok(result.uncontrolled.temperatureRejected>0,
    "declared compressor failures must have actual customer consequences");
  assert.ok(result.protected.temperatureRejected<=result.uncontrolled.temperatureRejected);
});
test("exact time above product range counts; missing logger coverage never becomes an accepted delivery",()=>{
  const product={skuId:"TEST",name:"Frozen",regime:"frozen",minC:-24,maxC:-17,
    maxExcursionMinutes:10,unitValueRub:100,unitWeightKg:1,unitVolumeM3:0.01};
  const readings=[
    {minute:400,tempC:-20},{minute:410,tempC:-11},
    {minute:420,tempC:-11},{minute:430,tempC:-20},{minute:440,tempC:-20},
  ];
  assert.deepEqual(inspectTemperature(readings,400,440,product,10),{
    coverage:"complete",minC:-20,maxC:-11,excursionMinutes:20,safe:false,
  });
  assert.equal(inspectTemperature(readings,400,415,product,10).excursionMinutes,5);
  assert.equal(inspectTemperature(readings,395,440,product,10).coverage,"missing");
  assert.equal(inspectTemperature(readings,400,445,product,10).coverage,"missing");
  assert.equal(inspectTemperature([readings[0],readings[4]],400,440,product,15).coverage,"gap");
});
test("controlled mode removes known faulty cold vehicle from physical dispatch without modifying the source order",()=>{
  const input=createCase004();
  const result=compareCold(input);
  const day=input.days[2];
  assert.ok(result.uncontrolled.days[2].events.some(e=>e.vehicleId==="REF-F-1"));
  assert.ok(result.protected.days[2].events.every(e=>e.vehicleId!=="REF-F-1"));
  assert.ok(input.orders.some(o=>o.day===day));
  assert.equal(input.alerts.some(a=>a.vehicleId==="REF-F-1"&&a.day===day),true);
  conservation(input,result.uncontrolled);
  conservation(input,result.protected);
});
test("a late customer refusal is inspected after returning and cannot silently become a sale",()=>{
  const baseline=createCase004({faults:"none"});
  const normal=simulateCold(baseline,"uncontrolled");
  const customer=normal.days[0].events.find(x=>x.quality==="accepted");
  assert.ok(customer,"at least one actual on-time delivery must be available");
  const imported=createCase004({faults:"none",rejectedOrderIds:[customer.orderId]});
  const refused=simulateCold(imported,"uncontrolled");
  assert.equal(refused.days[0].events.find(x=>x.orderId===customer.orderId).quality,
    "customer-refused");
  assert.ok(total(Object.fromEntries(refused.days[0].stock.map(x=>[x.skuId,x.pendingInspection])))>0);
  assert.ok(refused.days.slice(1).some(d=>d.stock.some(x=>x.inspectedReturns>0)));
  assert.deepEqual(auditCold(imported,refused),[]);
  conservation(imported,refused);
});
test("a missing logger blocks product quality release, and the pallet stays quarantined",()=>{
  const baseline=simulateCold(createCase004({faults:"none"}),"uncontrolled");
  const witness=baseline.days[0].events.find(x=>x.quality==="accepted"&&x.vehicleId);
  assert.ok(witness);
  const input=createCase004({faults:"none"});
  const logger=input.loggers.find(x=>x.day===witness.day&&x.vehicleId===witness.vehicleId);
  assert.ok(logger);
  logger.readings=[];
  const report=simulateCold(input,"uncontrolled");
  const affected=report.days[0].events.find(x=>x.orderId===witness.orderId);
  assert.equal(affected.quality,"quality-hold");
  assert.equal(affected.loggerCoverage,"missing");
  assert.ok(report.days[0].stock.some(x=>x.pendingQuality>0));
  assert.ok(!report.days[0].completedOrderIds.includes(witness.orderId));
  conservation(input,report);
  assert.deepEqual(auditCold(input,report),[]);
});
test("temperature excursions cause actual destruction of SKU value and drive later replenishment",()=>{
  const bad=simulateCold(createCase004({faults:"both"}),"uncontrolled");
  const sound=simulateCold(createCase004({faults:"none"}),"uncontrolled");
  assert.ok(bad.destroyedUnits>0);
  assert.ok(bad.destroyedRub>0);
  assert.equal(sound.temperatureRejected,0);
  assert.equal(sound.destroyedUnits,0);
  assert.ok(bad.days.some(day=>day.events.some(event=>event.quality==="quality-rejected")));
  conservation(createCase004({faults:"both"}),bad);
});
test("replenishment, freight shortage and failed refrigeration remain bounded under peak demand",()=>{
  const input=createCase004({demandPercent:150,coolingFleetSize:2,
    trafficPercent:150,coldStoragePercent:75});
  const result=compareCold(input);
  for(const r of [result.uncontrolled,result.protected]){
    assert.deepEqual(r.audit,[]);
    assert.ok(r.days.every(d=>d.stock.every(m=>m.closing>=0)));
    assert.ok(r.pendingOrders.length>0);
    conservation(input,r);
    assert.deepEqual(auditCold(input,r),[]);
  }
});
test("external data with wrong SKU, missing order, malformed event or negative opening is rejected",()=>{
  const mutations=[
    x=>{x.orders[0].lines[0].skuId="UNKNOWN";},
    x=>{x.orders[0].id=x.orders[1].id;},
    x=>{x.orders[0].lines.push({skuId:"C-MILK-03",units:1});},
    x=>{x.fleet[0].vehicle.id=x.fleet[1].vehicle.id;},
    x=>{x.receipts[0].units=-1;},
    x=>{x.opening["F-ICE-01"]=-2;},
    x=>{x.days[1]=x.days[0];},
    x=>{x.loggers[0].readings[1].minute=x.loggers[0].readings[0].minute;},
    x=>{x.customerRefusals=["NO-SUCH-ORDER"];},
    x=>{x.alerts[0].vehicleId="UNKNOWN";},
  ];
  for(const change of mutations){
    const input=createCase004();change(input);
    assert.throws(()=>validateColdInput(input),/D11_COLD_/);
  }
});
test("stored cost, quality decision, logger and original inputs are independently replay-verified",()=>{
  const input=createCase004();
  const result=simulateCold(input,"protected");
  assert.deepEqual(auditCold(input,structuredClone(result)),[]);
  const tampered=structuredClone(result);
  tampered.days[0].stock[0].closing+=2;
  assert.deepEqual(auditCold(input,tampered),["D11_COLD_REPLAY_MISMATCH"]);
  const falsified=structuredClone(result);
  falsified.days[2].events.find(e=>e.vehicleId!==null).quality="accepted";
  assert.deepEqual(auditCold(input,falsified),["D11_COLD_REPLAY_MISMATCH"]);
  const changed=structuredClone(input);
  changed.loggers[0].readings[0].tempC=17;
  assert.deepEqual(auditCold(changed,result),["D11_COLD_REPLAY_MISMATCH"]);
});
