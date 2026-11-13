import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { SiteLayout } from "@/components/SiteLayout";
import { D11ProposalExport } from "@/components/tools/D11ProposalExport";
import { buildD11BrowserProposal } from "@/components/tools/d11-transfer";
import { createCase003, type Case003Options } from "@/lib/logistics/case003-data";
import { auditNetwork, compareNetwork, networkFingerprint, validateNetworkInput,
  type NetworkInput, type NetworkMode, type NetworkResult } from "@/lib/logistics/case003-network";
import { canonicalFor } from "@/site-routes";

const CANONICAL = canonicalFor("/tools/distribution-network-expansion/");
const panel = "rounded border border-white/10 bg-white/[0.025] p-5 sm:p-6";
const inputCls = "mt-2 w-full rounded border border-white/20 bg-background px-3 py-3 text-foreground";
const money = (n:number)=>new Intl.NumberFormat("ru-RU",{maximumFractionDigits:0}).format(n)+" ₽";
const qty = (n:number)=>new Intl.NumberFormat("ru-RU").format(n);
const simpleTime = (v:number|null)=>{
  if(v===null)return "Нет";
  return String(Math.floor(v/60)).padStart(2,"0")+":"+String(v%60).padStart(2,"0");
};
const sum = (x:Record<string,number>)=>Object.values(x).reduce((n,v)=>n+v,0);
type Choice=NonNullable<Case003Options["regionalSelection"]>;

export const Route=createFileRoute("/tools/distribution-network-expansion")({
  head:()=>({
    meta:[
      {title:"CASE-003: расширение распределительной сети | Advice Logistics"},
      {name:"description",content:"Сравнение централизованной и региональной логистики. Магазины, склады, запасы, рейсы, поставщики, уровень сервиса и полные расходы."},
      {property:"og:url",content:CANONICAL},
    ],
    links:[{rel:"canonical",href:CANONICAL}],
  }),
  component:DistributionNetworkExpansion,
});
function Metric({label,value,details}:{label:string;value:string;details:string}){
  return <div className={panel}>
    <div className="text-xs uppercase tracking-wide text-muted">{label}</div>
    <div className="mt-2 font-display text-2xl">{value}</div>
    <p className="mt-2 text-sm text-muted">{details}</p>
  </div>;
}
function dayStatus(r:NetworkResult,day:string){
  const d=r.days.find(x=>x.day===day);
  return d?d.customerEvents.filter(e=>e.status==="on-time"||e.status==="late").length:0;
}
function parseIds(value:string):string[]{
  const parts=value.split(/[,;\n]+/).map(v=>v.trim()).filter(Boolean);
  if(new Set(parts).size!==parts.length)throw Error("ID повторяются; укажите каждый отказ один раз.");
  if(value.length>12000)throw Error("Список отказов слишком длинный.");
  return parts.sort();
}
function DistributionNetworkExpansion(){
  const [demand,setDemand]=useState<75|100|125|150>(100);
  const [rent,setRent]=useState<3500|7000|12000|22000>(7000);
  const [region,setRegion]=useState<Choice>("both");
  const [delay,setDelay]=useState<0|1|2>(0);
  const [traffic,setTraffic]=useState<100|120|150|180>(120);
  const [fuel,setFuel]=useState<1|1.3|1.6>(1);
  const [refusalText,setRefusalText]=useState("");
  const [transferText,setTransferText]=useState("");
  const [appliedRefusals,setAppliedRefusals]=useState<string[]>([]);
  const [appliedTransfers,setAppliedTransfers]=useState<string[]>([]);
  const [refusalError,setRefusalError]=useState("");
  const [imported,setImported]=useState<NetworkInput|null>(null);
  const [importError,setImportError]=useState("");
  const [selectedDay,setSelectedDay]=useState("");
  const [selectedCenter,setSelectedCenter]=useState("HUB");
  const [viewMode,setViewMode]=useState<NetworkMode>("regional-network");

  async function readProject(file?:File){
    if(!file)return;
    try{
      if(file.size>2*1024*1024)throw Error("Файл превышает 2 МБ.");
      const source=JSON.parse(await file.text()) as NetworkInput;
      validateNetworkInput(source);
      setImported(source);setImportError("");
      setSelectedDay("");setSelectedCenter("HUB");
      setRefusalText((source.refusedOrderIds??[]).join(", "));
      setTransferText((source.refusedTransferIds??[]).join(", "));
    }catch(error){setImportError(error instanceof Error?error.message:"Не удалось прочитать проект.");}
  }
  const evaluation=useMemo(()=>{
    try{
      const input=imported??createCase003({
        demandPercent:demand,regionalSelection:region,
        regionalRentRubPerDay:rent,supplierDelayDays:delay,
        trafficPercent:traffic,fuelMultiplier:fuel,
        refusedStoreOrderIds:appliedRefusals,refusedTransferIds:appliedTransfers,
      });
      validateNetworkInput(input);
      const compared=compareNetwork(input);
      const errors=[
        ...auditNetwork(input,compared.baseline),
        ...auditNetwork(input,compared.regional),
      ];
      if(errors.length)throw Error("Не удалось подтвердить физический журнал: "+errors[0]);
      return {input,compared,error:""};
    }catch(error){
      return {input:null,compared:null,error:error instanceof Error?error.message:"Ошибка исполнения маршрутов"};
    }
  },[demand,region,rent,delay,traffic,fuel,appliedRefusals,appliedTransfers,imported]);

  const input=evaluation.input, comparison=evaluation.compared;
  const baseline=comparison?.baseline, regional=comparison?.regional;
  const visible=viewMode==="central-only"?baseline:regional;
  const day=selectedDay&&input?.days.includes(selectedDay)?selectedDay:input?.days[0]??"";
  const info=visible?.days.find(d=>d.day===day);
  const node=info?.centers.find(c=>c.centerId===selectedCenter)??info?.centers[0];
  const sourceNode=input?.centers.find(c=>c.id===node?.centerId);
  const hasChangedDraft=refusalText.trim()!==appliedRefusals.join(", ")||
    transferText.trim()!==appliedTransfers.join(", ");

  function applyRefusals(){
    try{
      const customer=parseIds(refusalText), transfer=parseIds(transferText);
      const candidate=imported??createCase003({
        demandPercent:demand,regionalSelection:region,
        regionalRentRubPerDay:rent,supplierDelayDays:delay,
        trafficPercent:traffic,fuelMultiplier:fuel,
      });
      const known=new Set(candidate.orders.map(o=>o.id));
      const trunk=new Set(candidate.days.flatMap(d=>candidate.centers.filter(c=>c.kind==="regional")
        .map(c=>"TR:"+d+":"+c.id)));
      if(customer.some(id=>!known.has(id)))throw Error("Неизвестный ID заказа магазина.");
      if(transfer.some(id=>!trunk.has(id)))throw Error("Неизвестный ID межскладского рейса.");
      if(imported)setImported(prev=>prev?{...prev,refusedOrderIds:customer,refusedTransferIds:transfer}:prev);
      else{setAppliedRefusals(customer);setAppliedTransfers(transfer);}
      setRefusalError("");
    }catch(error){setRefusalError(error instanceof Error?error.message:"Ошибка списка отказов.");}
  }
  function downloadProject(){
    if(!input)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(input,null,2)],
      {type:"application/json;charset=utf-8"}));
    const link=document.createElement("a");
    link.href=url;link.download="d11-case003-distribution-network.json";
    document.body.appendChild(link);link.click();link.remove();
    window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  const result=useMemo(()=>{
    if(!input||!comparison)return null;
    const {baseline,regional}=comparison;
    const payload={
      toolId:"delivery-network-planner",toolTitle:"CASE-003: расширение распределительной сети",
      filenameBase:"d11-case003-distribution-network",
      stage:"Фактические рейсы, SKU и сравнительная экономика рассчитаны",
      markdown:[
        "# CASE-003. Расширение распределительной сети",
        "Проект: "+input.id+". Период: "+input.days[0]+" / "+input.days.at(-1)+".",
        "Проверяемый отпечаток входной модели: "+networkFingerprint(input),
        "Исходная централизованная сеть: "+baseline.deliveredOrders+" из "+baseline.orderCount+
          " заказов; доставлено в исходный день "+baseline.onTimeOrders+
          "; затраты "+money(baseline.totalRub)+".",
        "Региональная сеть: "+regional.deliveredOrders+" из "+regional.orderCount+
          "; доставлено в исходный день "+regional.onTimeOrders+
          "; затраты "+money(regional.totalRub)+".",
        "Перемещение по магистралям "+regional.trunkKm+" км. Последняя миля: "+
          regional.lastMileKm+" км.",
        "Изменение своевременных заказов "+comparison.additionalOnTime+
          "; разница затрат "+money(comparison.totalCostDifferenceRub)+".",
        "Рекомендация расчёта: "+(comparison.recommendation==="regional-network"
          ?"открытие выбранных складов улучшает или сохраняет сервис и сокращает затраты"
          :comparison.recommendation==="central-only"
          ?"централизованный вариант не уступает по сервису и затратам"
          :"нет доминирующего варианта; требуется управленческий выбор уровня сервиса и затрат"),
        "В журнале: исходные заказы, исполнение доставки, межскладские рейсы, приходные партии, "+
          "физические остатки и ожидание возврата после проверки.",
      ].join("\n\n"),
      data:{caseId:"D11-CASE-003",input,inputFingerprint:networkFingerprint(input),comparison},
    };
    try{
      buildD11BrowserProposal(payload,"2026-11-14T00:00:00.000Z");
      return payload;
    }catch{return null;}
  },[input,comparison]);

  return <SiteLayout>
    <main className="mx-auto max-w-6xl px-6 pb-24 pt-24 md:pt-32">
      <nav className="mb-6 text-xs uppercase tracking-widest text-muted">
        <Link to="/tools/" className="hover:text-foreground">Проектная лаборатория</Link>
        {" / "}Распределительная сеть
      </nav>
      <p className="text-xs uppercase tracking-[0.25em] text-[#3B82F6]">
        Инженерный проект / CASE-003
      </p>
      <h1 className="mt-3 max-w-5xl font-display text-3xl sm:text-5xl">
        Расширение сети распределительных складов
      </h1>
      <p className="mt-5 max-w-4xl text-muted">
        Сравните доставку всех магазинов из центрального распределительного центра
        и поставки через один или два региональных склада. Проверяются сроки передачи товара,
        фактические рейсы, доступные SKU, невыполненные заказы и полные затраты.
      </p>
      <p className="mt-3 text-sm text-muted">
        Связанный предметный проект: «Перестройка цепи поставок при расширении
        распределительной сети». Используется единый D11 планировщик для маршрутов
        магазинов и межскладских перевозок.
      </p>

      <section className={"mt-8 "+panel}>
        <h2 className="font-display text-2xl">Исходная сеть и управляемые решения</h2>
        <p className="mt-2 text-sm text-muted">
          Рабочая модель: 24 торговых объекта, шесть SKU, 240 заказов,
          десять рабочих дней, один центральный и два региональных склада.
          Расчёт выполняется локально; можно загрузить собственные данные.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block text-sm text-muted">
            Импорт полного JSON-проекта
            <input type="file" accept=".json,application/json" className={inputCls}
              onChange={e=>{void readProject(e.currentTarget.files?.[0]);e.currentTarget.value="";}}/>
          </label>
          <button type="button" onClick={downloadProject} disabled={!input}
            className="rounded border border-white/20 px-4 py-3 text-sm hover:border-[#3B82F6] disabled:opacity-50">
            Скачать исходную модель
          </button>
          {imported&&<button type="button"
            className="rounded border border-white/20 px-4 py-3 text-sm"
            onClick={()=>{setImported(null);setImportError("");setSelectedDay("");setSelectedCenter("HUB");}}>
            Вернуться к CASE-003
          </button>}
        </div>
        {importError&&<p role="alert" className="mt-2 text-sm text-red-400">{importError}</p>}
        <fieldset disabled={Boolean(imported)} className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <label className="block text-sm text-muted">Какие региональные склады открыть
            <select className={inputCls} value={region}
              onChange={e=>setRegion(e.target.value as Choice)}>
              <option value="both">Северный и Южный</option>
              <option value="north">Только Северный</option>
              <option value="south">Только Южный</option>
            </select>
          </label>
          <label className="block text-sm text-muted">Спрос магазинов
            <select className={inputCls} value={demand}
              onChange={e=>setDemand(Number(e.target.value) as 75|100|125|150)}>
              {[75,100,125,150].map(v=><option key={v} value={v}>{v}%</option>)}
            </select>
          </label>
          <label className="block text-sm text-muted">Аренда одного регионального склада
            <select className={inputCls} value={rent}
              onChange={e=>setRent(Number(e.target.value) as 3500|7000|12000|22000)}>
              {[3500,7000,12000,22000].map(v=><option key={v} value={v}>
                {money(v)} / рабочий день
              </option>)}
            </select>
          </label>
          <label className="block text-sm text-muted">Задержка поставщика
            <select className={inputCls} value={delay}
              onChange={e=>setDelay(Number(e.target.value) as 0|1|2)}>
              {[0,1,2].map(v=><option key={v} value={v}>{v} рабочих дня</option>)}
            </select>
          </label>
          <label className="block text-sm text-muted">Дорожные задержки
            <select className={inputCls} value={traffic}
              onChange={e=>setTraffic(Number(e.target.value) as 100|120|150|180)}>
              {[100,120,150,180].map(v=><option key={v} value={v}>{v}% времени</option>)}
            </select>
          </label>
          <label className="block text-sm text-muted">Стоимость топлива
            <select className={inputCls} value={fuel}
              onChange={e=>setFuel(Number(e.target.value) as 1|1.3|1.6)}>
              <option value={1}>100%</option><option value={1.3}>130%</option>
              <option value={1.6}>160%</option>
            </select>
          </label>
        </fieldset>
        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <label className="block text-sm text-muted">
            Фактические отказы магазинов (ID заказов)
            <textarea className={inputCls} rows={2} value={refusalText}
              onChange={e=>setRefusalText(e.target.value)}
              placeholder="SALE:2026-11-16:N-01"/>
          </label>
          <label className="block text-sm text-muted">
            Фактические отказы по межскладским накладным
            <textarea className={inputCls} rows={2} value={transferText}
              onChange={e=>setTransferText(e.target.value)}
              placeholder="TR:2026-11-16:DC-N"/>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button type="button" onClick={applyRefusals} disabled={!hasChangedDraft}
            className="rounded border border-[#3B82F6] px-4 py-2 text-sm hover:bg-[#3B82F6]/10 disabled:opacity-50">
            Применить факты отказов
          </button>
          {hasChangedDraft&&<span role="status" className="text-sm text-muted">
            Введённые факты ещё не применены.
          </span>}
        </div>
        {refusalError&&<p role="alert" className="mt-2 text-sm text-red-400">{refusalError}</p>}
        {input&&<p className="mt-4 text-xs text-muted">
          Идентификатор: {input.id}. Отпечаток источника: {networkFingerprint(input)}.
          {" "}В обоих вариантах сохраняются общий объём запасов и количество автомобилей.
        </p>}
      </section>

      {evaluation.error&&<section role="alert" className={"mt-8 "+panel}>
        {evaluation.error}
      </section>}
      {comparison&&baseline&&regional&&input&&<>
        <section className="mt-8">
          <h2 className="mb-4 font-display text-2xl">Итоги полного расчёта</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Выполнено заказов" value={qty(regional.deliveredOrders)+" / "+regional.orderCount}
              details={"Центральная сеть: "+baseline.deliveredOrders}/>
            <Metric label="Доставлено в срок" value={regional.onTimePercent+"%"}
              details={"Центральная сеть: "+baseline.onTimePercent+"%"}/>
            <Metric label="Просроченных заказо-дней" value={qty(regional.delayedOrderDays)}
              details={"Центральная сеть: "+qty(baseline.delayedOrderDays)}/>
            <Metric label="Затраты сети" value={money(regional.totalRub)}
              details={"Центральная сеть: "+money(baseline.totalRub)}/>
          </div>
          <div className={"mt-4 "+panel}>
            <h3 className="font-display text-xl">Решение по конфигурации складов</h3>
            <p className="mt-3 text-sm">
              Дополнительно выполнено заказов: <strong>{comparison.additionalDelivered}</strong>.
              {" "}Изменение своевременных заказов: <strong>{comparison.additionalOnTime}</strong>.
              {" "}Разница всех затрат: <strong>{money(comparison.totalCostDifferenceRub)}</strong>.
            </p>
            <p className="mt-3 text-sm text-muted">
              {comparison.recommendation==="regional-network"
                ?"Региональная сеть не уступает по уровню обслуживания и стоит дешевле."
                :comparison.recommendation==="central-only"
                ?"Централизованный вариант не уступает по обслуживанию и расходам."
                :"Нет однозначно лучшего варианта: стоимость и уровень обслуживания нужно выбирать совместно."}
            </p>
            <p className="mt-3 text-xs text-muted">
              Полная стоимость включает физические рейсы, эксплуатацию складов, хранение и
              затраты от просроченных заказов. При ухудшении уровня обслуживания разница затрат
              не признаётся доказанной экономией.
            </p>
          </div>
        </section>

        <section className={"mt-8 "+panel}>
          <h2 className="font-display text-2xl">Ежедневный журнал исполнения</h2>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <button type="button" aria-pressed={viewMode==="central-only"}
              onClick={()=>setViewMode("central-only")}
              className={"rounded border px-4 py-2 text-sm "+(viewMode==="central-only"
                ?"border-[#3B82F6] bg-[#3B82F6]/10":"border-white/20")}>
              Центральная сеть
            </button>
            <button type="button" aria-pressed={viewMode==="regional-network"}
              onClick={()=>setViewMode("regional-network")}
              className={"rounded border px-4 py-2 text-sm "+(viewMode==="regional-network"
                ?"border-[#3B82F6] bg-[#3B82F6]/10":"border-white/20")}>
              Региональная сеть
            </button>
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[840px] text-left text-sm">
              <thead><tr className="border-b border-white/15 text-muted">
                <th className="py-2 pr-3">День</th>
                <th className="p-2">Доставлено</th><th className="p-2">Не выполнено</th>
                <th className="p-2">Межскладские рейсы</th>
                <th className="p-2">В пути (шт.)</th><th className="p-2">Стоимость</th>
              </tr></thead>
              <tbody>{visible?.days.map(d=><tr key={d.day} className="border-b border-white/10">
                <td className="py-2 pr-3">{d.day}</td>
                <td className="p-2">{dayStatus(visible,d.day)}</td>
                <td className="p-2">{d.pendingOrderIds.length}</td>
                <td className="p-2">{d.transfers.length}</td>
                <td className="p-2">{sum(d.inTransit)}</td>
                <td className="p-2">{money(d.transportRub+d.facilitiesRub+d.holdingRub+d.delayedOrderRub)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <label className="mt-5 block max-w-xs text-sm text-muted">Рабочий день
            <select className={inputCls} value={day} onChange={e=>setSelectedDay(e.target.value)}>
              {input.days.map(d=><option key={d} value={d}>{d}</option>)}
            </select>
          </label>
          {info&&<>
            <h3 className="mt-6 font-display text-xl">Фактические доставки магазинов</h3>
            <div className="mt-3 max-h-[420px] overflow-auto">
              <table className="w-full min-w-[780px] text-left text-sm">
                <thead><tr className="border-b border-white/15 text-muted">
                  <th className="py-2 pr-3">Заказ</th><th className="p-2">Склад</th>
                  <th className="p-2">Автомобиль</th><th className="p-2">Статус</th>
                  <th className="p-2">Прибытие</th><th className="p-2">SKU, шт.</th>
                </tr></thead>
                <tbody>{info.customerEvents.map((event,i)=><tr key={event.orderId+":"+i}
                  className="border-b border-white/10">
                  <td className="py-2 pr-3">{event.orderId}</td>
                  <td className="p-2">{event.warehouseId}</td>
                  <td className="p-2">{event.vehicleId??"Не назначен"}</td>
                  <td className="p-2">{event.status==="on-time"?"Принято вовремя":
                    event.status==="late"?"Принято с опозданием":
                    event.status==="refused"?"Отказ":
                    "Не вывезено: "+event.reason}</td>
                  <td className="p-2">{simpleTime(event.arrivalMinute)}</td>
                  <td className="p-2">{event.units}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <h3 className="mt-6 font-display text-xl">Межскладские перемещения</h3>
            {info.transfers.length?<div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[710px] text-left text-sm">
                <thead><tr className="border-b border-white/15 text-muted">
                  <th className="py-2 pr-3">Накладная</th><th className="p-2">Куда</th>
                  <th className="p-2">Автомобиль</th><th className="p-2">Статус</th>
                  <th className="p-2">Приёмка</th><th className="p-2">Товаров</th>
                </tr></thead>
                <tbody>{info.transfers.map(t=><tr key={t.id} className="border-b border-white/10">
                  <td className="py-2 pr-3">{t.id}</td><td className="p-2">{t.toId}</td>
                  <td className="p-2">{t.vehicleId??"Не назначен"}</td>
                  <td className="p-2">{t.status==="delivered"?"В пути / доставлено":
                    t.status==="refused"?"Отказ от приёмки":"Не отправлено"}</td>
                  <td className="p-2">{t.arrivalDay??"Нет"}</td>
                  <td className="p-2">{t.lines.map(l=>l.skuId+": "+l.units).join(", ")}</td>
                </tr>)}</tbody>
              </table>
            </div>:<p className="mt-3 text-sm text-muted">Межскладских рейсов в выбранный день нет.</p>}
          </>}
        </section>

        <section className={"mt-8 "+panel}>
          <h2 className="font-display text-2xl">Движение запасов по каждому складу</h2>
          <p className="mt-2 text-sm text-muted">
            Физический баланс: остаток + поставщик + межскладская приёмка + проверенные возвраты
            - товары магазинам - отправка между складами. В пути и на инспекции учитываются отдельно.
          </p>
          <label className="mt-4 block max-w-sm text-sm text-muted">Склад
            <select className={inputCls} value={node?.centerId??""}
              onChange={e=>setSelectedCenter(e.target.value)}>
              {info?.centers.map(c=><option key={c.centerId} value={c.centerId}>
                {input.centers.find(x=>x.id===c.centerId)?.name??c.centerId}
              </option>)}
            </select>
          </label>
          {node&&<div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead><tr className="border-b border-white/15 text-muted">
                <th className="py-2 pr-3">Товар</th><th className="p-2">Утро</th>
                <th className="p-2">Поступило</th><th className="p-2">Возвраты</th>
                <th className="p-2">Магазины</th><th className="p-2">Перемещения</th>
                <th className="p-2">Вечер</th>
              </tr></thead>
              <tbody>{input.skus.map(s=><tr key={s.skuId} className="border-b border-white/10">
                <td className="py-2 pr-3">{s.skuId} ({s.name})</td>
                <td className="p-2">{node.opening[s.skuId]??0}</td>
                <td className="p-2">{(node.supplierReceipts[s.skuId]??0)+(node.transfersIn[s.skuId]??0)}</td>
                <td className="p-2">{node.inspectedReturns[s.skuId]??0}</td>
                <td className="p-2">{node.customerIssued[s.skuId]??0}</td>
                <td className="p-2">{node.transferIssued[s.skuId]??0}</td>
                <td className="p-2">{node.closing[s.skuId]??0}</td>
              </tr>)}</tbody>
            </table>
          </div>}
          {node&&<p className="mt-3 text-sm text-muted">
            {sourceNode?.name??node.centerId}: перевозки {money(node.routeCostRub)},
            {" "}эксплуатация {money(node.fixedCostRub)},
            {" "}хранение {money(node.holdingCostRub)}.
            {" "}Остаток {qty(sum(node.closing))} шт.
          </p>}
          {info&&<p className="mt-3 text-sm text-muted">
            На всех машинах между складами: {qty(sum(info.inTransit))} шт.
            {" "}На проверке после отказов: {qty(sum(info.returnInspection))} шт.
          </p>}
        </section>
        <div className="mt-6 flex flex-wrap items-center gap-3">
          {result?<D11ProposalExport payload={result}
            buttonClass="rounded border border-[#3B82F6] bg-[#3B82F6]/10 px-5 py-3 text-sm hover:bg-[#3B82F6]/20"/>
            :<p role="alert" className="text-sm text-muted">
              Передача в Workspace недоступна: превышен лимит предметного результата или не прошла проверка.
              Исходный проект остаётся доступен для JSON-экспорта.
            </p>}
          <Link to="/tools/delivery-network-planner"
            className="rounded border border-white/20 px-5 py-3 text-sm hover:border-[#3B82F6]">
            Транспортная сеть CASE-001
          </Link>
          <Link to="/tools/depot-maintenance-supply"
            className="rounded border border-white/20 px-5 py-3 text-sm hover:border-[#3B82F6]">
            Снабжение ремонтных депо CASE-002
          </Link>
        </div>
      </>}
      <p className="mt-5 text-xs text-muted">
        План и факт вычисляются существующими механизмами D11.
        Передача в T2 Workspace создаёт предварительное предложение; запись в Kernel
        подтверждается отдельно. JSON проекта не является архивом .iwxa.
      </p>
    </main>
  </SiteLayout>;
}
