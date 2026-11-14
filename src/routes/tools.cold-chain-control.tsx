import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { SiteLayout } from "@/components/SiteLayout";
import { D11ProposalExport } from "@/components/tools/D11ProposalExport";
import { useToolDraft } from "@/components/tools/useToolDraft";
import { buildD11BrowserProposal } from "@/components/tools/d11-transfer";
import { createCase004, type Case004Options } from "@/lib/logistics/case004-data";
import { compareCold, validateColdInput, auditCold, coldFingerprint,
  type ColdInput, type ColdQuality, type ColdQualityReview } from "@/lib/logistics/case004-coldchain";
import { canonicalFor } from "@/site-routes";

const CANONICAL=canonicalFor("/tools/cold-chain-control/");
const panel="rounded border border-white/10 bg-white/[0.025] p-5 sm:p-6";
const field="mt-2 w-full rounded border border-white/20 bg-background px-3 py-3 text-foreground";
const money=(n:number)=>new Intl.NumberFormat("ru-RU",{maximumFractionDigits:0}).format(n)+" ₽";
const num=(n:number)=>new Intl.NumberFormat("ru-RU").format(n);
const status:Record<ColdQuality,string>={
  accepted:"Принято", "customer-refused":"Отказ клиента",
  "quality-rejected":"Списано по температуре",
  "quality-hold":"Карантин: недостаточно данных",
  "not-scheduled":"Не назначен рейс",
};
interface ColdDraft {
  demand:75|100|125|150; traffic:100|120|150;
  faults:"none"|"frozen"|"both";
  gap:"none"|"frozen-day3"|"chilled-day5";
  fleet:2|4|6; storage:75|100|125;
  refusedOrderIds:string[];
  reviews:ColdQualityReview[];
  imported:ColdInput|null;
}
const INITIAL:ColdDraft={demand:100,traffic:120,faults:"both",gap:"none",
  fleet:4,storage:100,refusedOrderIds:[],reviews:[],imported:null};
export const Route=createFileRoute("/tools/cold-chain-control")({
  head:()=>({
    meta:[
      {title:"CASE-004: контроль холодовой цепи | Advice Logistics"},
      {name:"description",content:"Маршруты рефрижераторов, температура по логгерам, фактическая приёмка, карантин, списания и перепланирование поставок."},
      {property:"og:url",content:CANONICAL},
    ],
    links:[{rel:"canonical",href:CANONICAL}],
  }),
  component:ColdChainControl,
});
function Metric({label,value,detail}:{label:string;value:string;detail:string}){
  return <div className={panel}>
    <p className="text-xs uppercase tracking-wide text-muted">{label}</p>
    <p className="mt-2 font-display text-2xl">{value}</p>
    <p className="mt-2 text-sm text-muted">{detail}</p>
  </div>;
}
function parseIds(input:string):string[]{
  if(input.length>12000)throw Error("Слишком длинный список отказов.");
  const ids=input.split(/[,;\n]+/).map(s=>s.trim()).filter(Boolean);
  if(new Set(ids).size!==ids.length)
    throw Error("Повторяется ID отказа. Укажите его один раз.");
  return ids.sort();
}
function downloadJson(name:string,value:unknown){
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],
    {type:"application/json;charset=utf-8"}));
  const link=document.createElement("a");
  link.href=url;link.download=name;document.body.appendChild(link);
  link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function ColdChainControl(){
  const {state:draft,setState:setDraft,clearDraft}=useToolDraft("cold-chain-control",INITIAL);
  const {demand,traffic,faults,gap,fleet,storage,refusedOrderIds,reviews,imported}=draft;
  const [refusalText,setRefusalText]=useState("");
  const [importError,setImportError]=useState("");
  const [applyError,setApplyError]=useState("");
  const [qaError,setQaError]=useState("");
  const [qaOrderId,setQaOrderId]=useState("");
  const [qaDay,setQaDay]=useState("");
  const [qaDecision,setQaDecision]=useState<"release"|"destroy">("release");
  const [qaReviewer,setQaReviewer]=useState("");
  const [qaDocument,setQaDocument]=useState("");
  const [selectedDay,setSelectedDay]=useState("");
  const [selectedRegime,setSelectedRegime]=useState<"frozen"|"chilled">("frozen");
  useEffect(()=>{
    setRefusalText((imported?.customerRefusals??refusedOrderIds).join(", "));
  },[imported,refusedOrderIds]);
  async function importProject(file?:File){
    if(!file)return;
    try{
      if(file.size>2*1024*1024)throw Error("Файл больше 2 МБ.");
      const input=JSON.parse(await file.text()) as ColdInput;
      validateColdInput(input);
      setDraft(prev=>({...prev,imported:input}));
      setSelectedDay("");setImportError("");setApplyError("");
    }catch(e){
      setImportError(e instanceof Error?e.message:"Не удалось загрузить модель.");
    }
  }
  const calculated=useMemo(()=>{
    try{
      const input=imported??createCase004({
        demandPercent:demand,trafficPercent:traffic,faults,
        loggerGap:gap,coolingFleetSize:fleet,coldStoragePercent:storage,
        rejectedOrderIds:refusedOrderIds,qualityReviews:reviews,
      } satisfies Case004Options);
      validateColdInput(input);
      const comparison=compareCold(input);
      const checks=[
        ...auditCold(input,comparison.uncontrolled),
        ...auditCold(input,comparison.protected),
      ];
      if(checks.length)throw Error("Независимый аудит не подтвердил расчёт: "+checks[0]);
      return {input,comparison,error:""};
    }catch(error){
      return {input:null,comparison:null,
        error:error instanceof Error?error.message:"Не удалось рассчитать проект"};
    }
  },[demand,traffic,faults,gap,fleet,storage,refusedOrderIds,reviews,imported]);
  const input=calculated.input,comparison=calculated.comparison;
  const before=comparison?.uncontrolled,after=comparison?.protected;
  const day=input?.days.includes(selectedDay)?selectedDay:input?.days[0]??"";
  const afterDay=after?.days.find(d=>d.day===day);
  const dayEvents=afterDay?.events.filter(e=>e.regime===selectedRegime)??[];
  const daySkus=input?.skus.filter(s=>s.regime===selectedRegime)??[];
  const stockOfDay=afterDay?.stock.filter(s=>daySkus.some(p=>p.skuId===s.skuId))??[];
  const savedRefusals=imported?.customerRefusals??refusedOrderIds;
  const changed=refusalText.trim()!==savedRefusals.join(", ");
  function applyRefusals(){
    try{
      const ids=parseIds(refusalText);
      const sample=imported??createCase004({
        demandPercent:demand,trafficPercent:traffic,faults,loggerGap:gap,
        coolingFleetSize:fleet,coldStoragePercent:storage,
      });
      const known=new Set(sample.orders.map(o=>o.id));
      if(ids.some(id=>!known.has(id)))throw Error("В списке есть ID несуществующего заказа.");
      setDraft(prev=>prev.imported?{...prev,imported:{
        ...prev.imported,customerRefusals:ids,
      }}:{...prev,refusedOrderIds:ids});
      setApplyError("");
    }catch(e){setApplyError(e instanceof Error?e.message:"Ошибка применения отказов.");}
  }
  const heldCandidates=[...new Map([...before?.days??[],...after?.days??[]]
    .flatMap(d=>d.events.filter(e=>e.quality==="quality-hold"))
    .map(event=>[event.orderId,event] as const)).values()];
  const appliedReviews=imported?.qualityReviews??reviews;
  function applyQualityReview(){
    try{
      if(!input)throw Error("Нет подтверждённой входной модели.");
      const orderId=qaOrderId||heldCandidates[0]?.orderId;
      if(!orderId)throw Error("Нет поставок в карантине. Выберите проект с пропуском данных.");
      const candidate:ColdQualityReview={
        orderId,reviewDay:qaDay||input.days[3],decision:qaDecision,
        documentRef:qaDocument.trim(),reviewer:qaReviewer.trim(),
      };
      if(appliedReviews.some(review=>review.orderId===orderId&&review.reviewDay===candidate.reviewDay))
        throw Error("Решение по этому заказу и дню уже записано. Сначала удалите прежнее.");
      const proposed={...input,qualityReviews:[...appliedReviews,candidate]};
      validateColdInput(proposed);
      // No release on an invalid inspection date or before the physical return.
      compareCold(proposed);
      setDraft(prev=>prev.imported?
        {...prev,imported:{...prev.imported,qualityReviews:proposed.qualityReviews}}:
        {...prev,reviews:[...prev.reviews,candidate]});
      setQaError("");setQaDocument("");
    }catch(error){setQaError(error instanceof Error?error.message:"Решение о качестве не применено.");}
  }
  function removeQualityReview(orderId:string,reviewDay:string){
    const keep=(x:ColdQualityReview)=>x.orderId!==orderId||x.reviewDay!==reviewDay;
    setDraft(prev=>prev.imported?
      {...prev,imported:{...prev.imported,
        qualityReviews:(prev.imported.qualityReviews??[]).filter(keep)}}:
      {...prev,reviews:prev.reviews.filter(keep)});
    setQaError("");
  }
  const result=useMemo(()=>{
    if(!input||!comparison||!before||!after)return null;
    const payload={
      toolId:"delivery-network-planner",
      toolTitle:"CASE-004: контроль холодовой цепи",
      filenameBase:"d11-cold-chain-case004",
      stage:"Маршруты, термограммы, качественная приёмка и SKU-баланс рассчитаны",
      markdown:[
        "# CASE-004. Температурно-контролируемая доставка",
        "Набор данных: "+input.id,
        "Отпечаток входа: "+coldFingerprint(input),
        "Заказов: "+input.orders.length+", дней: "+input.days.length+
          ", рефрижераторов: "+input.fleet.length+
          ", товарных позиций: "+input.skus.length,
        "Исходная эксплуатация: принято "+before.acceptedOrders+
          ", списано партий по температуре "+before.temperatureRejected+
          ", полные расчётные затраты "+money(before.totalRub),
        "Защищённая диспетчеризация: принято "+after.acceptedOrders+
          ", списано партий "+after.temperatureRejected+
          ", полные расчётные затраты "+money(after.totalRub),
        "Предотвращены потери стоимости продукции: "+money(comparison.preventedDestructionRub)+
          "; дополнительные принятые заказы: "+comparison.additionalAccepted,
        "Экономическая разница по заданным ставкам: "+money(comparison.costDifferenceRub),
        "Отпущено из карантина по документированным решениям: "+after.qualityReleasedUnits+
          " ед. Зарегистрировано решений службы качества: "+
          (input.qualityReviews?.length??0),
        "Термограммы, временные интервалы контроля, физические возвраты, " +
          "партии списания и исполнение по каждому заказу сохранены в исходном результате.",
      ].join("\n\n"),
      data:{caseId:"D11-CASE-004",input,inputFingerprint:coldFingerprint(input),
        _editorState:draft,comparison},
    };
    try{
      buildD11BrowserProposal(payload,"2026-11-14T00:00:00.000Z");
      return payload;
    }catch{return null;}
  },[input,comparison,before,after,draft]);
  return <SiteLayout>
    <main className="mx-auto max-w-6xl px-6 pb-24 pt-24 md:pt-32">
      <nav className="mb-6 text-xs uppercase tracking-widest text-muted">
        <Link to="/tools/" className="hover:text-foreground">Проектная лаборатория</Link>
        {" / "}Контроль холодовой цепи
      </nav>
      <p className="text-xs uppercase tracking-[0.25em] text-[#3B82F6]">
        Действующий расчёт / CASE-004
      </p>
      <h1 className="mt-3 max-w-4xl font-display text-3xl sm:text-5xl">
        Температура, качество и распределительная доставка
      </h1>
      <p className="mt-5 max-w-4xl text-muted">
        Сопоставьте обычное расписание и диспетчеризацию с учётом неисправных холодильных установок.
        Сервис рассчитывает фактические рейсы, проверяет записи термологгеров на протяжении
        каждой поставки и отражает приёмку, возврат, карантин, списание и повторную доставку.
      </p>
      <section className={"mt-8 "+panel}>
        <h2 className="font-display text-2xl">Входной проект и журнал температуры</h2>
        <p className="mt-3 text-sm text-muted">
          Исходный проект: восемь рабочих дней, 96 заказов, замороженные и охлаждённые SKU,
          два независимых температурных контура, термограммы каждые 10 минут.
          Пределы температуры и допустимой экспозиции заданы отдельно для каждого товара.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block text-sm text-muted">Загрузить проект с термограммами JSON
            <input className={field} type="file" accept=".json,application/json"
              onChange={e=>{void importProject(e.currentTarget.files?.[0]);e.currentTarget.value="";}} />
          </label>
          <button type="button" className="rounded border border-white/20 px-4 py-3 text-sm hover:border-[#3B82F6] disabled:opacity-50"
            disabled={!input} onClick={()=>input&&downloadJson("d11-case004-cold-chain.json",input)}>
            Скачать полный проект JSON
          </button>
          <button type="button" className="rounded border border-white/20 px-4 py-3 text-sm hover:border-[#3B82F6]"
            onClick={()=>{clearDraft();setSelectedDay("");setImportError("");setApplyError("");}}>
            Сбросить черновик
          </button>
          {imported&&<button type="button" className="rounded border border-white/20 px-4 py-3 text-sm hover:border-[#3B82F6]"
            onClick={()=>setDraft(prev=>({...prev,imported:null}))}>
            Вернуться к CASE-004
          </button>}
        </div>
        {importError&&<p role="alert" className="mt-3 text-sm text-red-400">{importError}</p>}
        <fieldset disabled={Boolean(imported)}
          className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <label className="block text-sm text-muted">Объём заказов
            <select className={field} value={demand}
              onChange={e=>setDraft(v=>({...v,demand:Number(e.target.value) as ColdDraft["demand"]}))}>
              {[75,100,125,150].map(v=><option key={v} value={v}>{v}%</option>)}
            </select>
          </label>
          <label className="block text-sm text-muted">Доступный парк рефрижераторов
            <select className={field} value={fleet}
              onChange={e=>setDraft(v=>({...v,fleet:Number(e.target.value) as ColdDraft["fleet"]}))}>
              {[2,4,6].map(v=><option key={v} value={v}>{v} машин</option>)}
            </select>
          </label>
          <label className="block text-sm text-muted">Время движения относительно нормы
            <select className={field} value={traffic}
              onChange={e=>setDraft(v=>({...v,traffic:Number(e.target.value) as ColdDraft["traffic"]}))}>
              {[100,120,150].map(v=><option key={v} value={v}>{v}%</option>)}
            </select>
          </label>
          <label className="block text-sm text-muted">Неисправности холодильных установок
            <select className={field} value={faults}
              onChange={e=>setDraft(v=>({...v,faults:e.target.value as ColdDraft["faults"]}))}>
              <option value="none">Нет неисправностей</option>
              <option value="frozen">Отказ морозильной машины в день 3</option>
              <option value="both">Отказы в морозильном и охлаждённом контуре</option>
            </select>
          </label>
          <label className="block text-sm text-muted">Пропуски показаний датчиков
            <select className={field} value={gap}
              onChange={e=>setDraft(v=>({...v,gap:e.target.value as ColdDraft["gap"]}))}>
              <option value="none">Непрерывный контроль</option>
              <option value="frozen-day3">Пропуск морозильного регистратора</option>
              <option value="chilled-day5">Пропуск регистратора охлаждения</option>
            </select>
          </label>
          <label className="block text-sm text-muted">Ёмкость холодного склада
            <select className={field} value={storage}
              onChange={e=>setDraft(v=>({...v,storage:Number(e.target.value) as ColdDraft["storage"]}))}>
              {[75,100,125].map(v=><option key={v} value={v}>{v}%</option>)}
            </select>
          </label>
        </fieldset>
        <div className="mt-6 max-w-3xl">
          <label className="block text-sm text-muted">
            Фактические отказы клиентов (ID заказов через запятую)
            <textarea className={field} rows={2} value={refusalText}
              onChange={e=>setRefusalText(e.target.value)}
              placeholder="COLD:2026-11-16:F-CUSTOMER-01" />
          </label>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button type="button" disabled={!changed}
              onClick={applyRefusals}
              className="rounded border border-[#3B82F6] px-4 py-2 text-sm hover:bg-[#3B82F6]/10 disabled:opacity-50">
              Применить отказы и пересчитать
            </button>
            {changed&&<span role="status" className="text-sm text-muted">
              Изменения ещё не применены к расчёту
            </span>}
          </div>
          {applyError&&<p role="alert" className="mt-2 text-sm text-red-400">{applyError}</p>}
        </div>
        <section className="mt-6 rounded border border-white/10 p-4">
          <h3 className="font-display text-xl">Решение службы качества по карантину</h3>
          <p className="mt-2 text-sm text-muted">Вводится отдельно от температурных показаний.
            Партия может быть допущена повторно только после фактического возвращения
            и документированной проверки в следующий рабочий день. До этого товар
            не доступен для комплектования.</p>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-muted">Поставка в карантине
              <select className={field} value={qaOrderId||heldCandidates[0]?.orderId||""}
                onChange={e=>setQaOrderId(e.target.value)}>
                {heldCandidates.length===0&&<option value="">Нет карантинных партий</option>}
                {heldCandidates.map(event=><option key={event.orderId} value={event.orderId}>
                  {event.orderId} ({event.day})
                </option>)}
              </select>
            </label>
            <label className="block text-sm text-muted">Дата проверки качества
              <select className={field} value={qaDay||input?.days[3]||""}
                onChange={e=>setQaDay(e.target.value)}>
                {input?.days.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="block text-sm text-muted">Решение
              <select className={field} value={qaDecision}
                onChange={e=>setQaDecision(e.target.value as "release"|"destroy")}>
                <option value="release">Вернуть в пригодный складской запас</option>
                <option value="destroy">Списать и учесть стоимость потери</option>
              </select>
            </label>
            <label className="block text-sm text-muted">Ответственный за контроль
              <input className={field} value={qaReviewer}
                onChange={e=>setQaReviewer(e.target.value)} placeholder="ID или должность контролёра" />
            </label>
            <label className="block text-sm text-muted sm:col-span-2">Документ проверки / акт списания
              <input className={field} value={qaDocument}
                onChange={e=>setQaDocument(e.target.value)} placeholder="QA-2026-004 / акт лабораторного заключения" />
            </label>
          </div>
          <button type="button" onClick={applyQualityReview}
            disabled={!input||heldCandidates.length===0}
            className="mt-3 rounded border border-[#3B82F6] px-4 py-2 text-sm hover:bg-[#3B82F6]/10 disabled:opacity-50">
            Применить документированное решение и пересчитать
          </button>
          {qaError&&<p role="alert" className="mt-3 text-sm text-red-400">{qaError}</p>}
          {appliedReviews.length>0&&<div className="mt-4 space-y-2">
            {appliedReviews.map(review=><div key={review.orderId+":"+review.reviewDay}
              className="flex flex-wrap items-center justify-between gap-3 rounded border border-white/10 px-3 py-2 text-sm">
              <span>{review.orderId} · {review.reviewDay} ·
                {review.decision==="release"?"Допуск":"Списание"} · {review.documentRef}</span>
              <button type="button" onClick={()=>removeQualityReview(review.orderId,review.reviewDay)}
                className="rounded border border-white/20 px-3 py-1 hover:border-[#3B82F6]">
                Удалить решение
              </button>
            </div>)}
          </div>}
        </section>
        {input&&<p className="mt-4 text-xs text-muted">
          ID проекта: {input.id}. Отпечаток неизменённых входных данных: {coldFingerprint(input)}.
          При импорте показания регистратора не подменяются расчётными значениями.
        </p>}
      </section>
      {calculated.error&&<section role="alert" className={"mt-8 "+panel}>
        Расчёт не подтверждён: {calculated.error}
      </section>}
      {input&&comparison&&before&&after&&<>
        <section className="mt-8">
          <h2 className="mb-4 font-display text-2xl">Реальные последствия для партии и заказа</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric label="Заказы приняты" value={num(after.acceptedOrders)+"/"+num(after.ordered)}
              detail={"Исходная эксплуатация: "+before.acceptedOrders}/>
            <Metric label="Списания по температуре" value={num(after.destroyedUnits)+" ед."}
              detail={"Стоимость: "+money(after.destroyedRub)}/>
            <Metric label="Карантин по датчикам" value={num(after.temperatureHolds)}
              detail={"Исходная эксплуатация: "+before.temperatureHolds+" партий"}/>
            <Metric label="Полные расходы" value={money(after.totalRub)}
              detail={"Исходная эксплуатация: "+money(before.totalRub)}/>
          </div>
          <section className={"mt-4 "+panel}>
            <h3 className="font-display text-xl">Влияние управления неисправностями</h3>
            <p className="mt-3">
              Дополнительно принято заказов: <strong>{comparison.additionalAccepted}</strong>.
              {" "}Разница стоимости списанной продукции: <strong>{money(comparison.preventedDestructionRub)}</strong>.
              {" "}Разница всех расчётных расходов: <strong>{money(comparison.costDifferenceRub)}</strong>.
            </p>
            <p className="mt-3 text-sm text-muted">
              В расчёт входят фактический транспорт, работа холодильного оборудования,
              стоимость уничтоженных партий, постоянные расходы склада и
              стоимость каждого дня невыполненного заказа. Меньший пробег при недоставке
              не считается экономией без сопоставления уровня сервиса.
              Рекомендация модели: {comparison.recommendation==="protected"?"управляемая диспетчеризация":
                comparison.recommendation==="uncontrolled"?"исходный вариант":"нет однозначно доминирующего варианта"}.
            </p>
          </section>
        </section>
        <section className={"mt-8 "+panel}>
          <h2 className="font-display text-2xl">По рабочим дням: рейсы, приёмка и качество</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[780px] text-left text-sm">
              <thead><tr className="border-b border-white/15 text-muted">
                <th className="py-2 pr-3">День</th>
                <th className="p-2">Принято заказов</th><th className="p-2">Списано партий</th>
                <th className="p-2">Карантин</th><th className="p-2">Ожидают поставку</th>
                <th className="p-2">Расходы</th>
              </tr></thead>
              <tbody>{after.days.map(row=><tr key={row.day} className="border-b border-white/10">
                <td className="py-2 pr-3">{row.day}</td>
                <td className="p-2">{row.completedOrderIds.length}</td>
                <td className="p-2">{row.events.filter(x=>x.quality==="quality-rejected").length}</td>
                <td className="p-2">{row.events.filter(x=>x.quality==="quality-hold").length}</td>
                <td className="p-2">{row.pendingOrderIds.length}</td>
                <td className="p-2">{money(row.totalRub)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-muted">Рабочий день
              <select className={field} value={day} onChange={e=>setSelectedDay(e.target.value)}>
                {input.days.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="block text-sm text-muted">Температурный режим
              <select className={field} value={selectedRegime}
                onChange={e=>setSelectedRegime(e.target.value as "frozen"|"chilled")}>
                <option value="frozen">Замороженные продукты</option>
                <option value="chilled">Охлаждённые продукты</option>
              </select>
            </label>
          </div>
          <h3 className="mt-6 font-display text-xl">Контроль поставок {day}</h3>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[970px] text-left text-sm">
              <thead><tr className="border-b border-white/15 text-muted">
                <th className="py-2 pr-3">Заказ</th><th className="p-2">Рефрижератор</th>
                <th className="p-2">Статус партии</th><th className="p-2">Время приёмки</th>
                <th className="p-2">Мин/макс, °C</th><th className="p-2">Нарушение, мин</th>
                <th className="p-2">Доказательство</th>
              </tr></thead>
              <tbody>{dayEvents.map((event,index)=><tr key={event.orderId+"-"+index}
                className="border-b border-white/10">
                <td className="py-2 pr-3">{event.orderId}</td>
                <td className="p-2">{event.vehicleId??"Нет"}</td>
                <td className="p-2">{status[event.quality]}</td>
                <td className="p-2">{event.completionMinute===null?"Нет":
                  Math.floor(event.completionMinute/60)+":"+
                  String(event.completionMinute%60).padStart(2,"0")}</td>
                <td className="p-2">{event.minObservedC===null?"Нет данных":
                  event.minObservedC+" / "+event.maxObservedC}</td>
                <td className="p-2">{event.excursionMinutes??"Нет данных"}</td>
                <td className="p-2">{event.loggerCoverage==="complete"?"Термограмма полная":
                  event.loggerCoverage==="gap"?"Разрыв показаний":
                  event.loggerCoverage==="missing"?"Нет измерений":"Рейс не назначен"}</td>
              </tr>)}</tbody>
            </table>
            {dayEvents.length===0&&<p className="mt-3 text-sm text-muted">
              В этот день заявок для выбранного температурного контура нет.
            </p>}
          </div>
        </section>
        <section className={"mt-8 "+panel}>
          <h2 className="font-display text-2xl">Остатки и карантин по SKU</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[790px] text-left text-sm">
              <thead><tr className="border-b border-white/15 text-muted">
                <th className="py-2 pr-3">Номенклатура</th><th className="p-2">Утром</th>
                <th className="p-2">Поступило</th><th className="p-2">Выдано</th>
                <th className="p-2">Карантин/возвраты</th><th className="p-2">Списано</th>
                <th className="p-2">Закрытие</th>
              </tr></thead>
              <tbody>{stockOfDay.map(row=><tr key={row.skuId} className="border-b border-white/10">
                <td className="py-2 pr-3">{input.skus.find(s=>s.skuId===row.skuId)?.name??row.skuId}</td>
                <td className="p-2">{row.opening}</td>
                <td className="p-2">{row.receipts+row.inspectedReturns+row.qualityReleased}</td>
                <td className="p-2">{row.issued}</td>
                <td className="p-2">{row.pendingInspection+" / "+row.pendingQuality}</td>
                <td className="p-2">{row.destroyed}</td>
                <td className="p-2">{row.closing}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {afterDay&&afterDay.qualityReviews.length>0&&
            <div className="mt-5 space-y-2">
              <h3 className="font-semibold">Решения контроля качества за день</h3>
              {afterDay.qualityReviews.map(review=><p key={review.orderId} className="text-sm text-muted">
                {review.orderId}: {review.decision==="release"?"допущено":"списано"},
                {" "}единиц {review.units}, акт {review.documentRef},
                {" "}{review.status==="applied"?"исполнено":"не применимо к этому варианту рейсов"}
              </p>)}
            </div>}
          <p className="mt-3 text-sm text-muted">
            Возвращённый товар освобождается для новых заказов только после фактического
            возвращения рефрижератора и приёмки на следующем рабочем цикле.
            Списанное и не подтверждённое датчиком не становится складским запасом.
          </p>
        </section>
        <section className="mt-6 flex flex-wrap items-center gap-3">
          {result?<D11ProposalExport payload={result}
            buttonClass="rounded border border-[#3B82F6] bg-[#3B82F6]/10 px-5 py-3 text-sm hover:bg-[#3B82F6]/20"/>:
            <p role="alert" className="text-sm text-muted">
              Результат не укладывается в штатный контракт Workspace. Доступен полный JSON исходного проекта.
            </p>}
          <Link to="/tools/distribution-network-expansion"
            className="rounded border border-white/20 px-5 py-3 text-sm hover:border-[#3B82F6]">
            CASE-003: распределительная сеть
          </Link>
        </section>
      </>}
      <p className="mt-6 text-xs text-muted">
        Сохранение через общую команду D11 возможно после подтверждения пользователем в T2 Workspace.
        Самостоятельного Kernel, второй базы данных и нового формата архива здесь нет.
      </p>
    </main>
  </SiteLayout>;
}
