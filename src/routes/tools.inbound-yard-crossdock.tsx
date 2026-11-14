import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { SiteLayout } from "@/components/SiteLayout";
import { D11ProposalExport } from "@/components/tools/D11ProposalExport";
import { useToolDraft } from "@/components/tools/useToolDraft";
import { buildD11BrowserProposal } from "@/components/tools/d11-transfer";
import { createCase005, type Case005Options } from "@/lib/logistics/case005-data";
import { validateYardInput, compareYard, auditYard, yardFingerprint,
  type YardConfig, type YardMode, type YardResult } from "@/lib/logistics/case005-yard";
import { canonicalFor } from "@/site-routes";

const panel = "rounded border border-white/10 bg-white/[0.025] p-5 sm:p-6";
const field = "mt-2 w-full rounded border border-white/20 bg-background px-3 py-3 text-foreground";
const money = (n:number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits:0 }).format(n) + " ₽";
const qty = (n:number) => new Intl.NumberFormat("ru-RU").format(n);
const CANONICAL = canonicalFor("/tools/inbound-yard-crossdock/");
const hhmm = (minute:number|null) => minute===null?"Нет":
  String(Math.floor(minute/60)).padStart(2,"0")+":"+
  String(minute%60).padStart(2,"0");
const deliveryStatus:Record<string,string> = {
  delivered:"Доставлено",refused:"Отказ",
  unserved:"Не вывезено",
};
const truckStatus:Record<string,string> = {
  "unloaded-crossdock":"Кросс-докинг: доступен сегодня",
  "unloaded-staged":"Складская приёмка: доступен завтра",
  "queue-next-day":"Не разгружен: перенос",
  "document-hold":"Документы: поставка заблокирована",
};
interface YardDraft {
  docks:2|3|4|6;
  staging:80|120|200|300;
  supplierDelay:0|45|120|240;
  demand:75|100|125|150;
  traffic:100|120|150;
  inspection:10|20|40;
  refusedCustomerIds:string[];
  imported:YardConfig|null;
}
const INITIAL:YardDraft = {
  docks:4,staging:120,supplierDelay:0,demand:100,traffic:120,inspection:10,
  refusedCustomerIds:[],imported:null,
};
export const Route = createFileRoute("/tools/inbound-yard-crossdock")({
  head: () => ({
    meta: [
      {title:"CASE-005: кросс-докинг, доки и входящие поставки | Advice Logistics"},
      {name:"description",content:"Диспетчеризация грузовиков поставщиков: очереди, разгрузка, доки, товарные остатки, кросс-докинг и доставка магазинам."},
      {property:"og:url",content:CANONICAL},
    ],
    links:[{rel:"canonical",href:CANONICAL}],
  }),
  component: InboundYardCrossdock,
});
function Metric({title,value,detail}:{title:string;value:string;detail:string}) {
  return <div className={panel}>
    <p className="text-xs uppercase tracking-widest text-muted">{title}</p>
    <p className="mt-2 font-display text-2xl">{value}</p>
    <p className="mt-2 text-sm text-muted">{detail}</p>
  </div>;
}
function parseCustomerIds(input:string):string[] {
  if(input.length>12000)throw Error("Список отказов превышает допустимый размер.");
  const ids=input.split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean);
  if(new Set(ids).size!==ids.length)throw Error("Повторяется ID заказа.");
  return ids.sort();
}
function downloadInput(input:YardConfig) {
  const blob=new Blob([JSON.stringify(input,null,2)],{type:"application/json;charset=utf-8"});
  const url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download="d11-case005-inbound-yard.json";
  document.body.appendChild(link);link.click();link.remove();
  window.setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function resultDay(result:YardResult|undefined,day:string) {
  return result?.days.find(x=>x.day===day);
}
function InboundYardCrossdock() {
  const {state:draft,setState:setDraft,clearDraft}=useToolDraft("inbound-yard-crossdock",INITIAL);
  const {docks,staging,supplierDelay,demand,traffic,inspection,refusedCustomerIds,imported}=draft;
  const [refusalText,setRefusalText]=useState("");
  const [formError,setFormError]=useState("");
  const [importError,setImportError]=useState("");
  const [selectedDay,setSelectedDay]=useState("");
  const [selectedMode,setSelectedMode]=useState<YardMode>("crossdock");
  const [selectedSku,setSelectedSku]=useState("DRY-01");
  const [selectedDock,setSelectedDock]=useState(0);
  useEffect(()=>setRefusalText((imported?.refusedCustomerIds??refusedCustomerIds).join(", ")),
    [imported,refusedCustomerIds]);
  async function readProject(file?:File) {
    if(!file)return;
    try {
      if(file.size>2*1024*1024)throw Error("Файл проекта больше 2 МБ.");
      const input=JSON.parse(await file.text()) as YardConfig;
      validateYardInput(input);
      setDraft(prev=>({...prev,imported:input}));
      setSelectedDay("");setSelectedSku(input.skus[0].skuId);setSelectedDock(0);
      setImportError("");setFormError("");
    } catch(error) {
      setImportError(error instanceof Error?error.message:"Ошибка загрузки исходных данных.");
    }
  }
  const evaluated=useMemo(()=>{
    try{
      const input=imported??createCase005({
        docks,stagingCapacity:staging,supplierDelayMinutes:supplierDelay,
        customerDemandPercent:demand,trafficPercent:traffic,
        inspectionMinutes:inspection,refuseCustomerIds:refusedCustomerIds,
      } satisfies Case005Options);
      validateYardInput(input);
      const comparison=compareYard(input);
      const audit=[...auditYard(input,comparison.traditional),
        ...auditYard(input,comparison.crossdock)];
      if(audit.length)throw Error("Невозможно подтвердить склад и рейсы: "+audit[0]);
      return {input,comparison,error:""};
    }catch(error){
      return {input:null,comparison:null,
        error:error instanceof Error?error.message:"Ошибка расчёта"};
    }
  },[docks,staging,supplierDelay,demand,traffic,inspection,refusedCustomerIds,imported]);
  const input=evaluated.input,comparison=evaluated.comparison;
  const mode=selectedMode==="traditional"?"traditional":"crossdock";
  const active=mode==="traditional"?comparison?.traditional:comparison?.crossdock;
  const day=input?.days.includes(selectedDay)?selectedDay:input?.days[0]??"";
  const dayResult=resultDay(active,day);
  const beforeDay=resultDay(comparison?.traditional,day);
  const afterDay=resultDay(comparison?.crossdock,day);
  const sku=input?.skus.some(x=>x.skuId===selectedSku)?selectedSku:input?.skus[0].skuId??"";
  const savedRefusals=imported?.refusedCustomerIds??refusedCustomerIds;
  const dirtyRefusals=refusalText.trim()!==savedRefusals.join(", ");
  function applyRefusals(){
    try{
      const ids=parseCustomerIds(refusalText);
      const eligible=new Set(input?.orders.map(o=>o.id)??[]);
      if(ids.some(id=>!eligible.has(id)))throw Error("Указан неизвестный ID заказа магазина.");
      setDraft(prev=>prev.imported?
        {...prev,imported:{...prev.imported,refusedCustomerIds:ids}}:
        {...prev,refusedCustomerIds:ids});
      setFormError("");
    }catch(e){setFormError(e instanceof Error?e.message:"Не удалось применить изменения.");}
  }
  const result=useMemo(()=>{
    if(!input||!comparison)return null;
    const payload={
      toolId:"delivery-network-planner",
      toolTitle:"CASE-005: входящие поставки и кросс-докинг",
      filenameBase:"d11-inbound-yard-case005",
      stage:"Очереди доков, входящая разгрузка, SKU и исходящие рейсы рассчитаны",
      markdown:[
        "# CASE-005. Кросс-докинг распределительного центра",
        "Проект: "+input.id+"; входной отпечаток: "+yardFingerprint(input),
        "Поставок поставщиков: "+input.incoming.length+", заказов магазинов: "+input.orders.length+
          ", товарных позиций: "+input.skus.length+", складских постов: "+input.dockCount,
        "Традиционный режим: разгружено "+comparison.traditional.unloadedTrucks+
          ", доставлено заказов "+comparison.traditional.deliveredOrders+
          ", дни ожидания "+comparison.traditional.orderDelayDays+
          ", совокупные затраты "+money(comparison.traditional.totalRub),
        "Кросс-докинг: разгружено "+comparison.crossdock.unloadedTrucks+
          ", с доступом сегодня "+comparison.crossdock.directCrossdockTrucks+
          ", доставлено "+comparison.crossdock.deliveredOrders+
          ", дни ожидания "+comparison.crossdock.orderDelayDays+
          ", совокупные затраты "+money(comparison.crossdock.totalRub),
        "Разница полных затрат: "+money(comparison.savedTotalRub)+
          "; дополнительные принятые заказы: "+comparison.additionalDelivered,
        "Каждый факт разгрузки, док, входные документы, остаток SKU и исходящий рейс доступны для повторного воспроизведения.",
      ].join("\n\n"),
      data:{caseId:"D11-CASE-005",input,
        inputFingerprint:yardFingerprint(input),_editorState:draft,comparison},
    };
    try {
      buildD11BrowserProposal(payload,"2026-11-14T00:00:00.000Z");
      return payload;
    }catch{return null;}
  },[input,comparison,draft]);
  return <SiteLayout>
    <main className="mx-auto max-w-6xl px-6 pb-24 pt-24 md:pt-32">
      <nav className="mb-6 text-xs uppercase tracking-widest text-muted">
        <Link to="/tools/" className="hover:text-foreground">Проектная лаборатория</Link>
        {" / "}Входящие поставки и кросс-докинг
      </nav>
      <p className="text-xs uppercase tracking-[0.25em] text-[#3B82F6]">Логистическая инженерия / CASE-005</p>
      <h1 className="mt-3 font-display text-3xl sm:text-5xl">
        Входящие фуры, загрузочные посты и снабжение магазинов
      </h1>
      <p className="mt-5 max-w-4xl text-muted">
        Сравните традиционную приёмку с кросс-докингом на одном потоке поставщиков.
        Поставки поступают в склад только после действительной разгрузки, документальной
        проверки и доступного дока. Те же посты и работники ограничивают последующую
        комплектацию и исходящие маршруты магазинов.
      </p>
      <div className={"mt-8 "+panel}>
        <h2 className="font-display text-2xl">Управление складской сменой</h2>
        <p className="mt-3 text-sm text-muted">
          Исходный проект: 10 рабочих дней, 160 входящих машин, 240 заказов
          24 торговых точек, 10 SKU, собственные и привлечённые автомобили.
        </p>
        <div className="mt-5 flex flex-wrap items-end gap-3">
          <label className="block text-sm text-muted">Импорт собственного проекта
            <input type="file" accept=".json,application/json" className={field}
              onChange={e=>{void readProject(e.currentTarget.files?.[0]);e.currentTarget.value="";}} />
          </label>
          <button type="button" disabled={!input} onClick={()=>input&&downloadInput(input)}
            className="rounded border border-white/20 px-4 py-3 text-sm hover:border-[#3B82F6] disabled:opacity-50">
            Скачать полный проект JSON
          </button>
          {imported&&<button type="button" onClick={()=>{setDraft(p=>({...p,imported:null}));setImportError("");}}
            className="rounded border border-white/20 px-4 py-3 text-sm hover:border-[#3B82F6]">
            Вернуться к базовой модели
          </button>}
          <button type="button" onClick={()=>{clearDraft();setSelectedDay("");setFormError("");}}
            className="rounded border border-white/20 px-4 py-3 text-sm hover:border-[#3B82F6]">
            Сбросить черновик
          </button>
        </div>
        {importError&&<p role="alert" className="mt-3 text-sm text-red-400">{importError}</p>}
        <fieldset disabled={Boolean(imported)}
          className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <label className="text-sm text-muted">Физически доступные доки
            <select className={field} value={docks}
              onChange={e=>setDraft(p=>({...p,docks:Number(e.target.value) as YardDraft["docks"]}))}>
              {[2,3,4,6].map(x=><option key={x} value={x}>{x} дока</option>)}
            </select>
          </label>
          <label className="text-sm text-muted">Зона ожидания разгруженных грузов
            <select className={field} value={staging}
              onChange={e=>setDraft(p=>({...p,staging:Number(e.target.value) as YardDraft["staging"]}))}>
              {[80,120,200,300].map(x=><option key={x} value={x}>{x} единиц</option>)}
            </select>
          </label>
          <label className="text-sm text-muted">Опоздание машин поставщиков
            <select className={field} value={supplierDelay}
              onChange={e=>setDraft(p=>({...p,supplierDelay:Number(e.target.value) as YardDraft["supplierDelay"]}))}>
              {[0,45,120,240].map(x=><option key={x} value={x}>+{x} минут</option>)}
            </select>
          </label>
          <label className="text-sm text-muted">Спрос торговых точек
            <select className={field} value={demand}
              onChange={e=>setDraft(p=>({...p,demand:Number(e.target.value) as YardDraft["demand"]}))}>
              {[75,100,125,150].map(x=><option key={x} value={x}>{x}%</option>)}
            </select>
          </label>
          <label className="text-sm text-muted">Фактическое время в пути
            <select className={field} value={traffic}
              onChange={e=>setDraft(p=>({...p,traffic:Number(e.target.value) as YardDraft["traffic"]}))}>
              {[100,120,150].map(x=><option key={x} value={x}>{x}% нормы</option>)}
            </select>
          </label>
          <label className="text-sm text-muted">Время входной проверки партии
            <select className={field} value={inspection}
              onChange={e=>setDraft(p=>({...p,inspection:Number(e.target.value) as YardDraft["inspection"]}))}>
              {[10,20,40].map(x=><option key={x} value={x}>{x} минут</option>)}
            </select>
          </label>
        </fieldset>
        <div className="mt-5 max-w-3xl">
          <label className="block text-sm text-muted">Фактические отказы магазинов (ID заказа)
            <textarea className={field} rows={2} value={refusalText}
              onChange={e=>setRefusalText(e.target.value)}
              placeholder="ORD:2026-11-16:SHOP-01" />
          </label>
          <button type="button" disabled={!dirtyRefusals} onClick={applyRefusals}
            className="mt-3 rounded border border-[#3B82F6] px-4 py-2 text-sm hover:bg-[#3B82F6]/10 disabled:opacity-50">
            Применить фактические отказы и пересчитать
          </button>
          {dirtyRefusals&&<p role="status" className="mt-2 text-sm text-muted">
            Изменения не применены к факту и складу
          </p>}
          {formError&&<p role="alert" className="mt-2 text-sm text-red-400">{formError}</p>}
        </div>
        {input&&<p className="mt-4 text-xs text-muted">
          ID модели: {input.id}. Отпечаток данных: {yardFingerprint(input)}.
          Исходный спрос и номенклатура одинаковы для обоих режимов.
        </p>}
      </div>
      {evaluated.error&&<section role="alert" className={"mt-8 "+panel}>
        Физические ограничения не позволяют подтвердить расчёт: {evaluated.error}
      </section>}
      {input&&comparison&&active&&<>
        <section className="mt-8">
          <h2 className="mb-4 font-display text-2xl">Фактически рассчитанный результат</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Metric title="Доставлено магазинам"
              value={qty(comparison.crossdock.deliveredOrders)+"/"+qty(input.orders.length)}
              detail={"Традиционный склад: "+comparison.traditional.deliveredOrders}/>
            <Metric title="Разгружено в день прихода и отгружено"
              value={qty(comparison.crossdock.directCrossdockTrucks)}
              detail={"Традиционная схема: "+comparison.traditional.directCrossdockTrucks}/>
            <Metric title="Дней неудовлетворённого спроса"
              value={qty(comparison.crossdock.orderDelayDays)}
              detail={"Традиционная схема: "+comparison.traditional.orderDelayDays}/>
            <Metric title="Совокупные расходы" value={money(comparison.crossdock.totalRub)}
              detail={"Традиционная схема: "+money(comparison.traditional.totalRub)}/>
          </div>
          <div className={"mt-4 "+panel}>
            <h3 className="font-display text-xl">Решение о кросс-докинге</h3>
            <p className="mt-3">
              Дополнительно доставлено заказов: <strong>{comparison.additionalDelivered}</strong>.
              {" "}Сокращение дней ожидания: <strong>{comparison.avoidedOrderDelayDays}</strong>.
              {" "}Разница затрат: <strong>{money(comparison.savedTotalRub)}</strong>.
            </p>
            <p className="mt-3 text-sm text-muted">
              Полные затраты складываются из обработки поставщиков, ожидания машин,
              хранения, исходящей доставки и потерь от незакрытых заказов. Если
              выбранный вариант обслужил меньше магазинов, уменьшение транспортных
              расходов не считается достигнутой экономией.
            </p>
            <p className="mt-3 text-sm">
              Вывод расчёта: {comparison.recommendation==="crossdock"?
                "кросс-докинг предпочтителен при заданном уровне сервиса и затратах":
                comparison.recommendation==="traditional"?
                  "традиционный склад предпочтителен при заданных параметрах":
                  "одного доминирующего решения нет; требуется выбрать приоритет сервиса или затрат"}.
            </p>
          </div>
        </section>
        <section className={"mt-8 "+panel}>
          <h2 className="font-display text-2xl">Десять операционных смен</h2>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[800px] text-left text-sm">
              <thead><tr className="border-b border-white/15 text-muted">
                <th className="py-2 pr-3">Рабочий день</th>
                <th className="p-2">Поставщиков разгружено</th>
                <th className="p-2">Прямых кросс-доков</th>
                <th className="p-2">Очередь</th>
                <th className="p-2">Доставлено магазинам</th>
                <th className="p-2">Ожидают поставку</th>
                <th className="p-2">Затраты</th>
              </tr></thead>
              <tbody>{comparison.crossdock.days.map(d=><tr key={d.day}
                className="border-b border-white/10">
                <td className="py-2 pr-3">{d.day}</td>
                <td className="p-2">{d.incoming.filter(e=>e.status.startsWith("unloaded")).length}</td>
                <td className="p-2">{d.incoming.filter(e=>e.status==="unloaded-crossdock").length}</td>
                <td className="p-2">{d.queueNextDay.length}</td>
                <td className="p-2">{d.completedOrders.length}</td>
                <td className="p-2">{d.waitingOrders.length}</td>
                <td className="p-2">{money(d.totalRub)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-muted">Смена
              <select className={field} value={day} onChange={e=>setSelectedDay(e.target.value)}>
                {input.days.map(d=><option key={d} value={d}>{d}</option>)}
              </select>
            </label>
            <label className="block text-sm text-muted">Вариант складских операций
              <select className={field} value={mode}
                onChange={e=>setSelectedMode(e.target.value as YardMode)}>
                <option value="traditional">Обычная приёмка, выпуск завтра</option>
                <option value="crossdock">Кросс-докинг, выпуск после входной проверки</option>
              </select>
            </label>
          </div>
          {dayResult&&<>
            <h3 className="mt-6 font-display text-xl">Грузовики поставщиков {day}</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead><tr className="border-b border-white/15 text-muted">
                  <th className="py-2 pr-3">Накладная</th><th className="p-2">Поставщик</th>
                  <th className="p-2">Прибытие</th><th className="p-2">Док</th>
                  <th className="p-2">Разгрузка</th><th className="p-2">В очереди</th>
                  <th className="p-2">Доступность продукции</th>
                </tr></thead>
                <tbody>{dayResult.incoming.map(t=><tr key={t.id} className="border-b border-white/10">
                  <td className="py-2 pr-3">{t.id}</td>
                  <td className="p-2">{t.supplierId}</td>
                  <td className="p-2">{hhmm(t.arrivalMinute)}</td>
                  <td className="p-2">{t.dock===null?"Не назначен":t.dock+1}</td>
                  <td className="p-2">{hhmm(t.unloadStartMinute)}–{hhmm(t.unloadFinishMinute)}</td>
                  <td className="p-2">{t.queueMinutes} мин</td>
                  <td className="p-2">{truckStatus[t.status]}{t.availableDay?" · "+t.availableDay:""}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <h3 className="mt-6 font-display text-xl">Фактические рейсы к магазинам</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[830px] text-left text-sm">
                <thead><tr className="border-b border-white/15 text-muted">
                  <th className="py-2 pr-3">Заказ</th><th className="p-2">Плановая дата</th>
                  <th className="p-2">Магазин</th><th className="p-2">Автомобиль</th>
                  <th className="p-2">Док/время погрузки</th><th className="p-2">Факт</th>
                </tr></thead>
                <tbody>{dayResult.outbound.map(o=><tr key={o.orderId} className="border-b border-white/10">
                  <td className="py-2 pr-3">{o.orderId}</td>
                  <td className="p-2">{o.dueDay}</td><td className="p-2">{o.storeId}</td>
                  <td className="p-2">{o.vehicleId??"Не назначен"}</td>
                  <td className="p-2">{o.loadingBay===null?"Нет":(o.loadingBay+1)+", "+hhmm(o.loadStartMinute)}</td>
                  <td className="p-2">{deliveryStatus[o.status]}</td>
                </tr>)}</tbody>
              </table>
            </div>
          </>}
        </section>
        <section className={"mt-8 "+panel}>
          <h2 className="font-display text-2xl">Один физический календарь доков</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-muted">Док
              <select className={field} value={Math.min(selectedDock,input.dockCount-1)}
                onChange={e=>setSelectedDock(Number(e.target.value))}>
                {Array.from({length:input.dockCount},(_,i)=>
                  <option key={i} value={i}>Пост {i+1}</option>)}
              </select>
            </label>
          </div>
          {dayResult&&<div className="mt-4 space-y-2">
            {dayResult.dockBlocks.filter(r=>r.bay===Math.min(selectedDock,input.dockCount-1))
              .map(block=><p className="rounded border border-white/10 p-3 text-sm" key={block.reference}>
                <strong>Входящий автомобиль:</strong> {block.reference},
                {" "}{hhmm(block.startMinute)}–{hhmm(block.endMinute)}
              </p>)}
            {[...new Map(dayResult.outbound.filter(x=>x.loadingBay===selectedDock)
              .map(o=>[o.vehicleId+":"+o.loadStartMinute,o])).values()]
              .map(o=><p className="rounded border border-white/10 p-3 text-sm"
                key={o.vehicleId+":"+o.loadStartMinute}>
                <strong>Исходящий автомобиль:</strong> {o.vehicleId},
                {" "}{hhmm(o.loadStartMinute)}–{hhmm((o.loadStartMinute??0)+input.warehouse.loadMinutes)}
              </p>)}
          </div>}
          <p className="mt-3 text-sm text-muted">
            Один пост не может быть занят разгрузкой и погрузкой одновременно.
            Времена исходящих рейсов рассчитаны исходным D11-планировщиком и
            независимо проверены с учётом всех входящих резервирований.
          </p>
        </section>
        <section className={"mt-8 "+panel}>
          <h2 className="font-display text-2xl">Партии SKU: доступность и перенос</h2>
          <label className="mt-4 block max-w-sm text-sm text-muted">Номенклатурная позиция
            <select className={field} value={sku} onChange={e=>setSelectedSku(e.target.value)}>
              {input.skus.map(s=><option value={s.skuId} key={s.skuId}>{s.skuId} · {s.name}</option>)}
            </select>
          </label>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[700px] text-left text-sm">
              <thead><tr className="border-b border-white/15 text-muted">
                <th className="py-2 pr-3">Смена</th><th className="p-2">Открытие</th>
                <th className="p-2">Сейчас, кросс-док</th><th className="p-2">Со склада завтра</th>
                <th className="p-2">Выдано в рейсы</th><th className="p-2">На складе</th>
                <th className="p-2">В зоне ожидания</th><th className="p-2">В возврате</th>
              </tr></thead>
              <tbody>{active.days.map(d=>{
                const row=d.sku.find(x=>x.skuId===sku);
                return row?<tr key={d.day} className="border-b border-white/10">
                  <td className="py-2 pr-3">{d.day}</td><td className="p-2">{row.opening}</td>
                  <td className="p-2">{row.receivedSameDay}</td>
                  <td className="p-2">{row.receivedFromStaging}</td>
                  <td className="p-2">{row.dispatched}</td><td className="p-2">{row.closing}</td>
                  <td className="p-2">{row.staged}</td><td className="p-2">{row.awaitingReturn}</td>
                </tr>:null;
              })}</tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-muted">
            В журнале раздельно учитываются товар поставщика, доступный остаток,
            партия после поздней разгрузки, выданный груз, отказ клиента и
            возвращённый после контрольной приёмки SKU.
          </p>
        </section>
        <section className="mt-8 flex flex-wrap items-center gap-3">
          {result?<D11ProposalExport payload={result}
            buttonClass="rounded border border-[#3B82F6] bg-[#3B82F6]/10 px-5 py-3 text-sm hover:bg-[#3B82F6]/20"/>:
            <p role="alert" className="text-sm text-muted">
              Полный результат не помещается в штатное предложение T2; исходный JSON-проект остаётся доступен.
            </p>}
          <Link to="/tools/cold-chain-control"
            className="rounded border border-white/20 px-5 py-3 text-sm hover:border-[#3B82F6]">
            CASE-004: контроль холодовой цепи
          </Link>
        </section>
      </>}
      <p className="mt-5 text-xs text-muted">
        Передача в T2 Workspace осуществляется только по явному действию пользователя
        и использует существующую команду D11. Нового Host, Kernel или архива здесь нет.
      </p>
    </main>
  </SiteLayout>;
}
