import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { SiteLayout } from "@/components/SiteLayout";
import { createCase002 } from "@/lib/logistics/case002-data";
import { compareDepotSupply, auditDepotSupply, supplyFingerprint, validateSupplyInput,
  type SupplyInput, type SupplyResult } from "@/lib/logistics/case002-supply";
import { D11ProposalExport } from "@/components/tools/D11ProposalExport";
import { buildD11BrowserProposal } from "@/components/tools/d11-transfer";
import { canonicalFor } from "@/site-routes";

const panel = "rounded border border-white/10 bg-white/[0.025] p-5 sm:p-6";
const field = "mt-2 w-full rounded border border-white/20 bg-background px-3 py-3 text-foreground";
const money = (n: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n) + " ₽";
const quantity = (n: number) => new Intl.NumberFormat("ru-RU").format(n);
const CANONICAL = canonicalFor("/tools/depot-maintenance-supply/");
export const Route = createFileRoute("/tools/depot-maintenance-supply")({
  head: () => ({
    meta: [
      { title: "CASE-002: снабжение ремонтных депо | Advice Logistics" },
      { name: "description", content: "Расчёт потребности ремонтных парков в запчастях: фактические склады, ремонты, заказы, рейсы, дефицит и потеря выпуска автобусов." },
      { property: "og:url", content: CANONICAL },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
  }),
  component: DepotMaintenanceSupply,
});
function Stat({ title, value, note }: { title: string; value: string; note: string }) {
  return <div className={panel}>
    <p className="text-xs uppercase tracking-wider text-muted">{title}</p>
    <p className="mt-2 font-display text-2xl">{value}</p>
    <p className="mt-2 text-sm text-muted">{note}</p>
  </div>;
}
function dayArrived(report: SupplyResult, day: string) {
  const d = report.days.find(value => value.day === day);
  return d ? Object.values(d.receivedAtDepots).reduce((n,units)=>n+units,0) : 0;
}

function DepotMaintenanceSupply() {
  const [coverage, setCoverage] = useState(100);
  const [fleet, setFleet] = useState(3);
  const [traffic, setTraffic] = useState(115);
  const [supplierDelay, setSupplierDelay] = useState(0);
  const [refusalsDraft, setRefusalsDraft] = useState("");
  const [refusals, setRefusals] = useState<string[]>([]);
  const [imported, setImported] = useState<SupplyInput | null>(null);
  const [importError, setImportError] = useState("");
  const [selectedDay, setSelectedDay] = useState("");
  const [selectedDepot, setSelectedDepot] = useState("AP-01");

  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > 2 * 1024 * 1024) throw Error("Файл проекта больше 2 МБ.");
      const project = JSON.parse(await file.text()) as SupplyInput;
      validateSupplyInput(project);
      setImported(project); setImportError("");
      setSelectedDay(""); setSelectedDepot(project.depots[0].id);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Не удалось загрузить проект.");
    }
  }
  const computation = useMemo(() => {
    try {
      const input = imported ?? createCase002({
        openingCoveragePercent: coverage, fleetVehicles: fleet,
        trafficPercent: traffic, supplierDelayDays: supplierDelay,
        refusalIds: refusals,
      });
      validateSupplyInput(input);
      const comparison = compareDepotSupply(input);
      const checks = [...auditDepotSupply(input, comparison.reactive),
        ...auditDepotSupply(input, comparison.advance)];
      if (checks.length) throw Error("Не удалось подтвердить повторное воспроизведение: " + checks[0]);
      return { input, comparison, error: "" };
    } catch (error) {
      return { input: null, comparison: null,
        error: error instanceof Error ? error.message : "Ошибка предметного расчёта" };
    }
  }, [coverage, fleet, traffic, supplierDelay, refusals, imported]);

  const project = computation.input;
  const comparison = computation.comparison;
  const before = comparison?.reactive, after = comparison?.advance;
  const date = selectedDay && project?.days.includes(selectedDay)
    ? selectedDay : project?.days[0] ?? "";
  const depot = project?.depots.find(d => d.id === selectedDepot) ?? project?.depots[0];
  const beforeDay = before?.days.find(d => d.day === date);
  const afterDay = after?.days.find(d => d.day === date);

  const result = useMemo(() => {
    if (!project || !comparison || !after || !before) return null;
    const payload = {
      toolId: "delivery-network-planner",
      toolTitle: "CASE-002: снабжение ремонтных парков",
      filenameBase: "d11-depot-supply-case002",
      stage: "План, фактическая поставка и ремонтные задания рассчитаны",
      markdown: [
        "# CASE-002. Запасные части для ремонтных депо",
        "Рабочая модель: " + project.id,
        "Отпечаток входных данных: " + supplyFingerprint(project),
        "Ремонтных заданий: " + project.jobs.length + ", парков: " + project.depots.length +
          ", товарных позиций: " + project.parts.length,
        "Реактивное снабжение: завершено ремонтов " + before.completedJobs +
          ", дней ожидания деталей " + before.delayJobDays + ", совокупные затраты " + money(before.totalRub),
        "Заблаговременное снабжение: завершено ремонтов " + after.completedJobs +
          ", дней ожидания деталей " + after.delayJobDays + ", совокупные затраты " + money(after.totalRub),
        "Разница дней простоя: " + comparison.avoidedJobDays +
          ". Разница полных затрат: " + money(comparison.totalDifferenceRub) + ".",
        "Все складские приходы, ремонты по ID, фактические рейсы, отказные поставки и балансы включены в Result.",
      ].join("\n\n"),
      data: { caseId: "D11-CASE-002", input: project,
        inputFingerprint: supplyFingerprint(project), comparison },
    };
    try {
      buildD11BrowserProposal(payload, "2026-11-13T00:00:00.000Z");
      return payload;
    } catch { return null; }
  }, [project, comparison, before, after]);

  const downloadInput = () => {
    if (!project) return;
    const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)],
      { type: "application/json;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url; link.download = "d11-case002-maintenance-project.json";
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const applyRefusals = () => {
    const ids = refusalsDraft.split(/[,;\n]+/).map(x => x.trim()).filter(Boolean);
    setRefusals([...new Set(ids)].sort());
  };
  const departures = after?.days.flatMap(d=>d.shipments) ?? [];

  return <SiteLayout>
    <main className="mx-auto max-w-6xl px-6 pb-24 pt-24 md:pt-32">
      <nav className="mb-6 text-xs uppercase tracking-widest text-muted">
        <Link to="/tools/" className="hover:text-foreground">Проектная лаборатория</Link>
        {" / "}Снабжение ремонтных депо
      </nav>
      <p className="text-xs uppercase tracking-[0.25em] text-[#3B82F6]">Инженерный проект / CASE-002</p>
      <h1 className="mt-3 max-w-4xl font-display text-3xl sm:text-5xl">Запасные части, ремонтные парки и транспорт</h1>
      <p className="mt-5 max-w-4xl text-muted">
        Свяжите заявки на ремонт автобусов с реальными складскими остатками, поставками, рейсами и выпуском техники.
        Сравните снабжение по текущим заявкам с заблаговременной доставкой деталей на следующий рабочий день.
      </p>
      <div className="mt-4 text-sm">
        <Link to="/primery-realizovannyh-proektov/" className="underline underline-offset-4 hover:text-[#3B82F6]">
          Контекст: проект управления материальными ресурсами транспортного оператора
        </Link>
      </div>
      <section className={"mt-8 " + panel}>
        <h2 className="font-display text-2xl">Исходная система снабжения</h2>
        <p className="mt-2 text-sm text-muted">
          По умолчанию: четыре ремонтных парка, восемь номенклатурных позиций, десять рабочих дней, 120 ремонтных заданий,
          центральный склад, внешние приходы и собственные развозные машины. Можно загрузить собственный проект.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="block text-sm text-muted">Импорт проекта JSON
            <input type="file" accept=".json,application/json" className={field}
              onChange={e => { void importFile(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
          </label>
          <button type="button" onClick={downloadInput} disabled={!project}
            className="rounded border border-white/20 px-4 py-3 text-sm hover:border-[#3B82F6] disabled:opacity-50">
            Скачать исходный проект
          </button>
          {imported && <button type="button" onClick={() => {
            setImported(null); setImportError(""); setSelectedDay(""); setSelectedDepot("AP-01");
          }} className="rounded border border-white/20 px-4 py-3 text-sm">
            Вернуться к проекту CASE-002
          </button>}
        </div>
        {importError && <p role="alert" className="mt-3 text-sm text-red-400">{importError}</p>}
        <fieldset disabled={Boolean(imported)} className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <label className="block text-sm text-muted">Запасы центрального склада
            <select className={field} value={coverage} onChange={e => setCoverage(Number(e.target.value))}>
              {[40,70,100,140].map(v=><option key={v} value={v}>{v}% исходного остатка</option>)}
            </select>
          </label>
          <label className="block text-sm text-muted">Доступные машины
            <select className={field} value={fleet} onChange={e => setFleet(Number(e.target.value))}>
              {[1,2,3].map(v=><option key={v} value={v}>{v}</option>)}
            </select>
          </label>
          <label className="block text-sm text-muted">Время в пути
            <select className={field} value={traffic} onChange={e => setTraffic(Number(e.target.value))}>
              {[100,115,135,160,200].map(v=><option key={v} value={v}>{v}%</option>)}
            </select>
          </label>
          <label className="block text-sm text-muted">Задержка прихода поставщика
            <select className={field} value={supplierDelay} onChange={e => setSupplierDelay(Number(e.target.value))}>
              {[0,1,2].map(v=><option key={v} value={v}>{v} рабочих дня</option>)}
            </select>
          </label>
        </fieldset>
        {!imported && <div className="mt-5">
          <label className="block max-w-xl text-sm text-muted">Фактические отказы парков от поставок (ID накладных)
            <textarea className={field} rows={2} value={refusalsDraft}
              onChange={e => setRefusalsDraft(e.target.value)}
              placeholder="2026-11-16:AP-01, 2026-11-17:AP-02" />
          </label>
          <button type="button" onClick={applyRefusals}
            className="mt-3 rounded border border-[#3B82F6] px-4 py-2 text-sm hover:bg-[#3B82F6]/10">
            Применить отказы и пересчитать
          </button>
        </div>}
        {project && <p className="mt-4 text-xs text-muted">Идентификатор модели: {project.id}.
          {" "}Отпечаток входных данных: {supplyFingerprint(project)}.
          {" "}Каждый вариант пересчитывается из одинаковых входных ремонтных заданий.</p>}
      </section>

      {computation.error && <section role="alert" className={"mt-8 " + panel}>{computation.error}</section>}
      {before && after && comparison && project && <>
        <section className="mt-8">
          <h2 className="mb-4 font-display text-2xl">Проверенный результат двух режимов снабжения</h2>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <Stat title="Ремонтов завершено" value={quantity(after.completedJobs)}
              note={"Реактивно: " + before.completedJobs + " из " + after.totalJobs}/>
            <Stat title="Дней ожидания деталей" value={quantity(after.delayJobDays)}
              note={"Реактивно: " + before.delayJobDays}/>
            <Stat title="Поставлено по факту" value={quantity(after.acceptedUnits) + " шт."}
              note={"Выдано со склада: " + after.shippedUnits + " шт."}/>
            <Stat title="Полные затраты" value={money(after.totalRub)}
              note={"Реактивно: " + money(before.totalRub)}/>
          </div>
          <section className={"mt-4 " + panel}>
            <h3 className="font-display text-xl">Разница между режимами</h3>
            <p className="mt-3">Изменение завершённых ремонтов: <strong>{comparison.additionalCompleted}</strong>.
              {" "}Сокращение дней ожидания деталей: <strong>{comparison.avoidedJobDays}</strong>.
              {" "}Разница совокупных затрат: <strong>{money(comparison.totalDifferenceRub)}</strong>.</p>
            <p className="mt-3 text-sm text-muted">
              Совокупные затраты = фактический транспорт + стоимость простоя работ по заданным параметрам.
              Если заказы не выполнены, экономию нельзя трактовать как подтверждённый производственный эффект.
              Независимый повторный расчёт по исходным данным: без расхождений.
            </p>
          </section>
        </section>
        <section className={"mt-8 " + panel}>
          <h2 className="font-display text-2xl">Десять рабочих дней: план, перевозки, ремонты</h2>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[740px] text-left text-sm">
              <thead><tr className="border-b border-white/15 text-muted">
                <th className="py-2 pr-3">День</th><th className="p-2">Ремонтов завершено</th>
                <th className="p-2">Ожидали детали</th><th className="p-2">Поставок/отказов</th>
                <th className="p-2">Принято парками</th><th className="p-2">Затраты</th>
              </tr></thead>
              <tbody>{after.days.map(day => <tr key={day.day} className="border-b border-white/10">
                <td className="py-2 pr-3">{day.day}</td>
                <td className="p-2">{day.completedJobs.length}</td>
                <td className="p-2">{day.waitingJobs.length}</td>
                <td className="p-2">{day.shipments.length} / {day.shipments.filter(s=>s.routeStatus==="refused").length}</td>
                <td className="p-2">{dayArrived(after,day.day)} шт.</td>
                <td className="p-2">{money(day.costDowntimeRub + day.costTransportRub)}</td>
              </tr>)}</tbody>
            </table>
          </div>
          <label className="mt-5 block max-w-xs text-sm text-muted">Рабочий день
            <select className={field} value={date} onChange={e=>setSelectedDay(e.target.value)}>
              {project.days.map(x=><option key={x} value={x}>{x}</option>)}
            </select>
          </label>
          {afterDay && <>
            <h3 className="mt-6 font-display text-xl">Фактические отгрузки {afterDay.day}</h3>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[680px] text-left text-sm">
                <thead><tr className="border-b border-white/15 text-muted">
                  <th className="py-2 pr-3">Накладная</th><th className="p-2">Парк</th>
                  <th className="p-2">Машина</th><th className="p-2">Исполнение</th>
                  <th className="p-2">Детали</th><th className="p-2">Доступно для ремонта</th>
                </tr></thead>
                <tbody>{afterDay.shipments.map(ship => <tr key={ship.id} className="border-b border-white/10">
                  <td className="py-2 pr-3">{ship.id}</td><td className="p-2">{ship.depotId}</td>
                  <td className="p-2">{ship.vehicleId ?? "Не назначена"}</td>
                  <td className="p-2">{ship.routeStatus === "delivered" ? "Принято"
                    : ship.routeStatus === "refused" ? "Отказ" : "Не вывезено"}</td>
                  <td className="p-2">{ship.parts.map(p => p.skuId + ": " + p.units).join("; ")}</td>
                  <td className="p-2">{ship.availableDay ?? "Нет"}</td>
                </tr>)}</tbody>
              </table>
            </div>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <div className="rounded border border-white/10 p-4">
                <h4 className="font-semibold">Ремонты выполнены</h4>
                <p className="mt-2 text-sm">{afterDay.completedJobs.length
                  ? afterDay.completedJobs.join(", ") : "Нет"}</p>
              </div>
              <div className="rounded border border-white/10 p-4">
                <h4 className="font-semibold">Ремонты ждут детали</h4>
                <p className="mt-2 text-sm">{afterDay.waitingJobs.length
                  ? afterDay.waitingJobs.join(", ") : "Нет"}</p>
              </div>
            </div>
          </>}
        </section>
        <section className={"mt-8 " + panel}>
          <h2 className="font-display text-2xl">Остатки по паркам и номенклатуре</h2>
          <label className="mt-4 block max-w-xs text-sm text-muted">Ремонтный парк
            <select className={field} value={depot?.id ?? ""} onChange={e=>setSelectedDepot(e.target.value)}>
              {project.depots.map(x=><option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
          </label>
          {depot && afterDay && <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead><tr className="border-b border-white/15 text-muted">
                <th className="py-2 pr-3">SKU</th><th className="p-2">Деталь</th>
                <th className="p-2">В парке</th><th className="p-2">Центральный склад</th>
              </tr></thead>
              <tbody>{project.parts.map(part=><tr key={part.skuId} className="border-b border-white/10">
                <td className="py-2 pr-3">{part.skuId}</td><td className="p-2">{part.name}</td>
                <td className="p-2">{afterDay.depotStock[depot.id]?.[part.skuId] ?? 0}</td>
                <td className="p-2">{afterDay.closingHub[part.skuId] ?? 0}</td>
              </tr>)}</tbody>
            </table>
          </div>}
          <p className="mt-3 text-sm text-muted">Склад проверяется по формуле: остаток утром + приход поставщика +
            принятые возвраты - фактически выданные в рейсы. Запрещены отрицательные остатки и
            повторное использование одних и тех же деталей.</p>
        </section>
        <section className="mt-6 flex flex-wrap items-center gap-3">
          {result ? <D11ProposalExport payload={result}
            buttonClass="rounded border border-[#3B82F6] bg-[#3B82F6]/10 px-5 py-3 text-sm hover:bg-[#3B82F6]/20" />
            : <p role="status" className="text-sm text-muted">Нельзя передать предметный результат в Workspace:
              проверьте лимит данных и входной проект.</p>}
          <Link to="/tools/delivery-network-planner"
            className="rounded border border-white/20 px-5 py-3 text-sm hover:border-[#3B82F6]">
            Планировать региональную доставку (CASE-001)
          </Link>
        </section>
      </>}
      <p className="mt-5 text-xs text-muted">Транспортные рейсы вычисляются существующим D11 engine.
        Сохранение через общую команду предложения D11 выполняется только после вашего подтверждения в T2 Workspace.
        JSON-экспорт проекта не является архивом .iwxa.</p>
    </main>
  </SiteLayout>;
}
