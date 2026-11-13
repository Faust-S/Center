import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { SiteLayout } from "@/components/SiteLayout";
import { createCase001 } from "@/lib/logistics/case001";
import { importDeliveryProject, MAX_D11_REPORT_JSON_BYTES } from "@/lib/logistics/project-import";
import type { InventoryReport } from "@/lib/logistics/inventory";
import { runScenario, compareScenarios, type Scenario, type Project } from "@/lib/logistics/engine";
import { simulateOperations, compareOperations, calculateVerifiedInventory, replanAfterReturns, parseCustomerRefusalIds, type ReplanningResult, type OperationReport } from "@/lib/logistics/execution";
import { buildCase001ProposalData, CASE001_ALGORITHM_VERSION, type DeliveryEditorState } from "@/lib/logistics/proposal";
import { canonicalFor } from "@/site-routes";
import { useToolDraft } from "@/components/tools/useToolDraft";
import { D11ProposalExport } from "@/components/tools/D11ProposalExport";
import { buildD11BrowserProposal } from "@/components/tools/d11-transfer";

const INITIAL: DeliveryEditorState = {
  days: 5, orders: 380, demand: 100, fuel: 100, breakdown: 0,
  trafficPercent: 100, dockDelayMinutes: 0, extraServiceMinutes: 0,
  pickingWorkers: 20, maxRunsPerVehicle: 2, peakTravelPercent: 120, maxStopsPerTrip: 12,
  stockCoveragePercent: 100,
  customerRefusalOrderIds: "",
  importedModel: null,
};
const CANONICAL = canonicalFor("/tools/delivery-network-planner/");
export const Route = createFileRoute("/tools/delivery-network-planner")({
  head: () => ({ meta: [
    { title: "Модель доставки: маршруты, автопарк, затраты | Advice Logistics" },
    { name: "description", content: "Интерактивный инженерный расчёт распределительной сети: одинаковые заказы, временные окна, автопарк, ограничения и проверяемая экономика AS-IS / TO-BE." },
    { property: "og:url", content: CANONICAL },
  ], links: [{ rel: "canonical", href: CANONICAL }] }),
  component: DeliveryNetworkPlanner
});
const money = (n: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n) + " ₽";
const qty = (n: number) => new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 1 }).format(n);
const panel = "rounded border border-white/10 bg-white/[0.025] p-5 sm:p-6";
const labelCls = "block text-sm text-muted";
const fieldCls = "mt-2 w-full rounded border border-white/20 bg-background px-3 py-3 text-foreground";
function Result({ title, value, subtitle }: { title: string; value: string; subtitle: string }) {
  return <div className={panel}><p className="text-xs uppercase tracking-widest text-muted">{title}</p>
    <p className="mt-3 font-display text-2xl sm:text-3xl">{value}</p>
    <p className="mt-2 text-sm text-muted">{subtitle}</p></div>;
}
function Summary({ before, after }: { before: Scenario; after: Scenario }) {
  const comparison = compareScenarios(before, after);
  return <>
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Result title="Заказы" value={String(after.orderCount)} subtitle="Одинаковые для обоих сценариев"/>
      <Result title="Доставлено" value={String(after.delivered)} subtitle={"Не выполнено: " + after.unserved}/>
      <Result title="Пробег TO-BE" value={qty(after.totalKm) + " км"} subtitle={"AS-IS: " + qty(before.totalKm) + " км"}/>
      <Result title="Расходы TO-BE" value={money(after.totalCostRub)} subtitle={"AS-IS: " + money(before.totalCostRub)}/>
    </div>
    <section className={panel} aria-live="polite">
      <h2 className="font-display text-2xl">Экономическая оценка плана</h2>
      {comparison.comparable
        ? <p className="mt-3 text-lg">Разница затрат: <strong>{money(comparison.savedRub!)}</strong>
            {" (" + comparison.savedPercent + "%)."} {comparison.savedRub! < 0 ? "Целевой сценарий дороже исходного." : "Целевой сценарий дешевле исходного."}</p>
        : <p className="mt-3 text-lg">Экономию нельзя подтвердить: не все заказы доставлены или обнаружены несоответствия.</p>}
      <p className="mt-3 text-sm text-muted">
        AS-IS: постоянные географические зоны. TO-BE: перераспределение между доступными машинами и последовательное уменьшение добавочного пробега.
        Метод эвристический, глобальная оптимальность не гарантирована. Финансовые значения рассчитываются на заданных условиях модели.
      </p>
      <p className="mt-3 text-sm">Проверка маршрутов и затрат: {before.audit.length + after.audit.length === 0 ? "без обнаруженных расхождений" : "обнаружены ошибки"}</p>
    </section>
    <section className={panel}>
      <h2 className="mb-4 font-display text-2xl">План по рабочим дням</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[620px] text-left text-sm">
          <thead><tr className="border-b border-white/15 text-muted">
            <th className="py-3 pr-4">День</th><th className="p-3">Заявки</th>
            <th className="p-3">Доставлено</th><th className="p-3">Осталось</th>
            <th className="p-3">Рейсы</th><th className="p-3">Затраты TO-BE</th>
          </tr></thead>
          <tbody>{after.days.map(d => <tr key={d.day} className="border-b border-white/10">
            <td className="py-3 pr-4">{d.day}</td><td className="p-3">{d.ordered}</td>
            <td className="p-3">{d.delivered}</td><td className="p-3">{d.unserved.length}</td>
            <td className="p-3">{d.runs.length}</td><td className="p-3">{money(d.totalCostRub)}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </section>
    <section className={panel}>
      <h2 className="font-display text-2xl">Отклонения и ограничения</h2>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <p>Невыполнено AS-IS: <strong>{before.unserved}</strong></p>
        <p>Невыполнено TO-BE: <strong>{after.unserved}</strong></p>
        <p>Привлечённых рейсов AS-IS: <strong>{before.hiredRuns}</strong></p>
        <p>Привлечённых рейсов TO-BE: <strong>{after.hiredRuns}</strong></p>
      </div>
      {after.unserved > 0 && <p className="mt-4 text-sm text-muted">Причины недоставки:
        {" " + [...new Set(after.days.flatMap(d => d.unserved.map(x => x.reason)))].join(", ")}</p>}
    </section>
  </>;
}
function OperationResults({ before, after }: { before: OperationReport; after: OperationReport }) {
  const comparison = compareOperations(before, after);
  return <section className={panel} aria-live="polite">
    <h2 className="font-display text-2xl">План / факт доставки</h2>
    <p className="mt-2 text-sm text-muted">Перепроверка исполнения тех же рейсов при изменении дорожной обстановки,
      продолжительности погрузки и обслуживания клиентов. Поздние заявки могут быть отклонены получателем.</p>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Result title="Фактически выполнено" value={String(after.executed)}
        subtitle={"AS-IS: " + before.executed}/>
      <Result title="Отказы клиентов" value={String(after.refused)}
        subtitle={"AS-IS: " + before.refused}/>
      <Result title="Расходы факта TO-BE" value={money(after.totalCostRub)}
        subtitle={"AS-IS: " + money(before.totalCostRub)}/>
      <Result title="Переработка водителей" value={String(after.overtimeMinutes) + " мин"}
        subtitle={"AS-IS: " + before.overtimeMinutes + " мин"}/>
    </div>
    <p className="mt-4 text-base">Разница выполненных доставок: <strong>{comparison.serviceDelta}</strong>.
      {" "}Разница опозданий: <strong>{comparison.lateDelta}</strong>.</p>
    {comparison.comparable
      ? <p className="mt-3 text-sm">Операционная разница затрат: {money(comparison.costDifferenceRub!)}.</p>
      : <p className="mt-3 text-sm">Финансовую экономию факта не подтверждаем, поскольку в одном из сценариев есть
          недоставленные заявки. Сравнение качества доставки остаётся доступным.</p>}
    <p className="mt-3 text-xs text-muted">Аудит исполнения: {before.audit.length + after.audit.length === 0
      ? "все события и затраты согласованы" : "есть несоответствия"}. События воспроизводятся по сохранённым исходным условиям.</p>
  </section>;
}
function clock(minute: number): string {
  const dayOffset = Math.floor(minute / 1440);
  const hh = Math.floor(minute % 1440 / 60).toString().padStart(2, "0");
  const mm = Math.floor(minute % 60).toString().padStart(2, "0");
  return hh + ":" + mm + (dayOffset ? " (+" + dayOffset + " сут.)" : "");
}
/** Drill down from project economics into the real per-order plan/fact ledger. */
function RouteExplorer({ model, plan, actual }: { model: Project; plan: Scenario; actual: OperationReport }) {
  const [chosenDay, setChosenDay] = useState(model.days[0]);
  const [chosenTrip, setChosenTrip] = useState("");
  const day = plan.days.find(d => d.day === chosenDay) ?? plan.days[0];
  if (!day) return null;
  const tripIndex = day.runs.findIndex((r) => r.vehicleId + "#" + r.tripNumber === chosenTrip);
  const index = tripIndex < 0 ? 0 : tripIndex;
  const run = day.runs[index];
  const fact = actual.days.find(d => d.day === day.day)?.trips[index];
  const ordersById = new Map(model.orders.map(o => [o.id, o]));
  return <section className={panel}>
    <h2 className="font-display text-2xl">Рейсы и фактические доставки</h2>
    <p className="mt-2 text-sm text-muted">Откройте конкретный рейс: погрузочный пост, смену водителя,
      последовательность клиентов, плановые и фактические времена, стоимость и результат каждого заказа.</p>
    <div className="mt-4 grid gap-4 sm:grid-cols-2">
      <label className={labelCls}>Рабочий день
        <select className={fieldCls} value={day.day}
          onChange={e => { setChosenDay(e.target.value); setChosenTrip(""); }}>
          {plan.days.map(d => <option key={d.day} value={d.day}>{d.day}</option>)}
        </select>
      </label>
      <label className={labelCls}>Автомобиль и рейс
        <select className={fieldCls} value={run ? run.vehicleId + "#" + run.tripNumber : ""}
          onChange={e => setChosenTrip(e.target.value)} disabled={!run}>
          {day.runs.map(r => <option key={r.vehicleId + "-" + r.tripNumber} value={r.vehicleId + "#" + r.tripNumber}>
            {r.vehicleId} · рейс {r.tripNumber} · {r.stops.length} адресов
          </option>)}
        </select>
      </label>
    </div>
    {run && fact ? <>
      <div className="mt-5 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
        <div><p className="text-muted">Погрузка</p><p>Пост {run.loadingBay + 1}, {clock(run.loadStartMinute)}</p></div>
        <div><p className="text-muted">Отправление</p><p>План {clock(run.departMinute)}</p><p>Факт {clock(fact.departMinute)}</p></div>
        <div><p className="text-muted">Возвращение</p><p>План {clock(run.returnMinute)}</p><p>Факт {clock(fact.returnMinute)}</p></div>
        <div><p className="text-muted">Затраты</p><p>План {money(run.costRub)}</p><p>Факт {money(fact.actualCostRub)}</p></div>
      </div>
      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[780px] text-left text-sm">
          <thead><tr className="border-b border-white/15 text-muted">
            <th className="py-2 pr-3">Заказ / клиент</th><th className="p-2">Окно</th>
            <th className="p-2">Прибытие, план</th><th className="p-2">Прибытие, факт</th>
            <th className="p-2">Завершение</th><th className="p-2">Исполнение</th>
          </tr></thead>
          <tbody>{run.stops.map((stop, idx) => {
            const order = ordersById.get(stop.orderId), event = fact.deliveries[idx];
            return <tr key={stop.orderId} className="border-b border-white/10">
              <td className="py-2 pr-3">{stop.orderId}<div className="text-xs text-muted">{order?.customerId}</div></td>
              <td className="p-2">{order ? clock(order.windowStart) + "–" + clock(order.windowEnd) : "—"}</td>
              <td className="p-2">{clock(stop.arrivalMinute)}</td>
              <td className="p-2">{event ? clock(event.arrivalMinute) : "—"}</td>
              <td className="p-2">{event ? clock(event.completionMinute) : "—"}</td>
              <td className="p-2">{event?.status === "on-time" ? "Вовремя" :
                event?.status === "late" ? "Опоздание" : event?.status === "refused" ? "Отказ" : "—"}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>
    </> : <p className="mt-4 text-sm text-muted">На выбранный день рассчитанных рейсов нет.</p>}
  </section>;
}
function InventoryResults({ report }: { report: InventoryReport }) {
  const [day, setDay] = useState("");
  const dayReport = report.days.find(x => x.day === day) ?? report.days[0];
  if (!dayReport) return null;
  return <section className={panel}>
    <h2 className="font-display text-2xl">Остатки, отгрузки и возвраты</h2>
    <p className="mt-2 text-sm text-muted">Товар учитывается в штуках по SKU: приход, выдача в рейс,
      продажа клиенту, отказ и возврат после приёмки в первый рабочий день после фактического возвращения транспорта.
      Недоставленные и не загруженные заказы остаются в запасе.</p>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Result title="Поставлено на склад" value={String(report.totalReceipts) + " шт."}
        subtitle="Приходы за период"/>
      <Result title="Выдано в рейсы" value={String(report.totalIssued) + " шт."}
        subtitle="Все погруженные партии"/>
      <Result title="Принято после возврата" value={String(report.totalReturned) + " шт."}
        subtitle="Повторная доступность только после приёмки"/>
      <Result title="Ожидает приёмки" value={String(report.pendingReturnUnits) + " шт."}
        subtitle="Отказы последнего рабочего дня"/>
    </div>
    <label className={labelCls + " mt-5 max-w-xs"}>Проверить складской день
      <select className={fieldCls} value={dayReport.day} onChange={e => setDay(e.target.value)}>
        {report.days.map(d => <option key={d.day} value={d.day}>{d.day}</option>)}
      </select>
    </label>
    <p className="mt-4 text-sm">
      Отгружено заказов: {dayReport.issuedOrders};
      {" "}доставлено: {dayReport.deliveredOrders};
      {" "}отказов: {dayReport.returnedOrders};
      {" "}без товара на складе: {dayReport.excludedShortages}.
    </p>
    <div className="mt-4 overflow-x-auto">
      <table className="w-full min-w-[710px] text-left text-sm">
        <thead><tr className="border-b border-white/15 text-muted">
          <th className="py-2 pr-3">SKU</th><th className="p-2">На начало</th>
          <th className="p-2">Приход</th><th className="p-2">Возврат принят</th>
          <th className="p-2">Отгрузка</th><th className="p-2">На конец</th>
          <th className="p-2">Ожидает приёмки</th>
        </tr></thead>
        <tbody>{dayReport.movements.map(m => <tr key={m.skuId} className="border-b border-white/10">
          <td className="py-2 pr-3">{m.skuId}</td><td className="p-2">{m.openingUnits}</td>
          <td className="p-2">{m.receipts}</td><td className="p-2">{m.returned}</td>
          <td className="p-2">{m.issued}</td><td className="p-2">{m.closingUnits}</td>
          <td className="p-2">{m.awaitingInspection}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="mt-3 text-xs text-muted">Балансовая проверка: {report.audit.length
      ? "выявлены расхождения" : "приход, выдача и возвраты согласованы"}.</p>
  </section>;
}
function ReplanningResults({ result }: { result: ReplanningResult }) {
  return <section className={panel} aria-live="polite">
    <h2 className="font-display text-2xl">Повторный план после отказов и возвратов</h2>
    <p className="mt-2 text-sm text-muted">Исходный план сохранён отдельно. После каждого выполненного дня фактические отказы формируют партии для приёмки только после возвращения машины на склад. Планировщик заново распределяет доступные SKU, машины и погрузочные посты, а результат повторно проверяется.</p>
    <div className="mt-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <Result title="Исходный план" value={String(result.original.delivered)} subtitle="Запланировано доставок"/>
      <Result title="Повторный план" value={String(result.revised.delivered)} subtitle="Попыток доставить по обновлённому плану"/>
      <Result title="Доставлено по факту" value={String(result.actual.executed)} subtitle={"Отказы: " + result.actual.refused}/>
      <Result title="Затраты обновлённого факта" value={money(result.actual.totalCostRub)} subtitle={"План: " + money(result.revised.totalCostRub)}/>
    </div>
    <div className="mt-5 overflow-x-auto">
      <table className="w-full min-w-[700px] text-left text-sm">
        <thead><tr className="border-b border-white/15 text-muted">
          <th className="py-2 pr-3">День</th><th className="p-2">Принятые возвраты</th>
          <th className="p-2">Исходный план</th><th className="p-2">Повторный план</th>
          <th className="p-2">Новые заявки в рейсах</th>
        </tr></thead>
        <tbody>{result.changes.map(change => <tr key={change.day} className="border-b border-white/10">
          <td className="py-2 pr-3">{change.day}</td>
          <td className="p-2">{change.acceptedReturns.length
            ? change.acceptedReturns.map(x => x.skuId + ": " + x.units).join(", ") : "Нет"}</td>
          <td className="p-2">{change.originalScheduled}</td>
          <td className="p-2">{change.revisedScheduled}</td>
          <td className="p-2">{change.newlyScheduledOrders.length
            ? change.newlyScheduledOrders.join(", ") : "Нет"}</td>
        </tr>)}</tbody>
      </table>
    </div>
    <p className="mt-3 text-xs text-muted">Аудит перепланирования: {result.audit.length
      ? "обнаружены расхождения" : "маршруты, фактические события и движения SKU согласованы"}.</p>
  </section>;
}
function DeliveryNetworkPlanner() {
  const { state, setState, clearDraft } = useToolDraft("delivery-network-planner", INITIAL);
  const [importError, setImportError] = useState("");
  const importedModel = state.importedModel ?? null;
  function downloadTemplate() {
    const template = createCase001({ days: 1, dailyOrders: 40 });
    const url = URL.createObjectURL(new Blob([JSON.stringify(template, null, 2)], {
      type: "application/json;charset=utf-8",
    }));
    const link = document.createElement("a");
    link.href = url; link.download = "advice-logistics-project-template.json";
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function importFile(file?: File) {
    if (!file) return;
    try {
      if (file.size > MAX_D11_REPORT_JSON_BYTES) throw Error("Файл превышает допустимый размер отчёта.");
      const project = importDeliveryProject(JSON.parse(await file.text()) as unknown);
      setState(previous => ({ ...previous, importedModel: project, breakdown: 0 }));
      setImportError("");
    } catch (error) {
      setImportError(error instanceof Error ? error.message : "Проект не удалось загрузить.");
    }
  }
  const { days, orders, demand, fuel, breakdown, trafficPercent, dockDelayMinutes, extraServiceMinutes,
    pickingWorkers, maxRunsPerVehicle, peakTravelPercent, maxStopsPerTrip, stockCoveragePercent } = state;
  const refusalText = state.customerRefusalOrderIds ?? "";
  const data = useMemo(() => {
    try {
      const model = importedModel
        ? importDeliveryProject(importedModel)
        : createCase001({ days, dailyOrders: orders,
          demandMultiplier: demand / 100, fuelMultiplier: fuel / 100,
          pickingWorkers, maxRunsPerVehicle, peakTravelPercent, maxStopsPerTrip, stockCoveragePercent });
      const unavailable = model.fleet.filter(v => v.kind === "owned").slice(0, breakdown).map(v => v.id);
      return { error: "", model, before: runScenario(model, "as-is", unavailable), after: runScenario(model, "to-be", unavailable) };
    } catch (e) {
      return { error: e instanceof Error ? e.message : "Ошибка входных параметров", model: null, before: null, after: null };
    }
  }, [days, orders, demand, fuel, breakdown, pickingWorkers, maxRunsPerVehicle, peakTravelPercent, maxStopsPerTrip, stockCoveragePercent, importedModel]);
  const operation = useMemo(() => {
    if (!data.model || !data.before || !data.after) return null;
    try {
      const settings = { trafficPercent, dockDelayMinutes, extraServiceMinutes,
        latePenaltyRub: 2500, rejectOutOfWindow: true,
        customerRefusalOrderIds: parseCustomerRefusalIds(refusalText) };
      return { before: simulateOperations(data.model, data.before, settings),
        after: simulateOperations(data.model, data.after, settings) };
    } catch { return null; }
  }, [data, trafficPercent, dockDelayMinutes, extraServiceMinutes, refusalText]);
  const inventory = useMemo(() => {
    if (!data.model?.inventory || !data.after || !operation) return null;
    try {
      const before = calculateVerifiedInventory(data.model, data.before!, operation.before);
      const after = calculateVerifiedInventory(data.model, data.after, operation.after);
      return before.audit.length || after.audit.length ? null : { before, after };
    } catch { return null; }
  }, [data, operation]);
  const replanning = useMemo(() => {
    if (!data.model?.inventory || !data.after || !operation) return null;
    try {
      return replanAfterReturns(data.model, data.after, operation.after.settings);
    } catch { return null; }
  }, [data, operation]);
  const workspaceResult = useMemo(() => {
    if (!data.before || !data.after || !data.model || !operation ||
        (data.model.inventory && !replanning) ||
        data.before.audit.length || data.after.audit.length ||
        operation.before.audit.length || operation.after.audit.length) return null;
    try {
      const { before, after } = data;
      const resultData = buildCase001ProposalData({
        state, model: data.model, before, after,
        operationBefore: operation.before, operationAfter: operation.after,
      });

      const comparison = resultData.comparison;
      const op = resultData.operation.comparison;
      const markdown = [
        "# Инженерный расчёт региональной доставки",
        "Модель: " + resultData.modelId,
        "Версия алгоритма: " + CASE001_ALGORITHM_VERSION,
        "Отпечаток исходных данных: " + resultData.modelFingerprint,
        "Заказы: " + before.orderCount,
        "AS-IS: доставлено " + before.delivered + ", не доставлено " + before.unserved +
          ", пробег " + before.totalKm + " км, затраты " + money(before.totalCostRub),
        "TO-BE: доставлено " + after.delivered + ", не доставлено " + after.unserved +
          ", пробег " + after.totalKm + " км, затраты " + money(after.totalCostRub),
        comparison.comparable
          ? "Разница затрат по плану: " + money(comparison.savedRub!) + " (" + comparison.savedPercent + "%)"
          : "Экономия плана не подтверждена из-за недоставленных заявок.",
        "Операционный факт AS-IS: доставлено " + operation.before.executed +
          ", отказы " + operation.before.refused + ", затраты " + money(operation.before.totalCostRub),
        "Операционный факт TO-BE: доставлено " + operation.after.executed +
          ", отказы " + operation.after.refused + ", затраты " + money(operation.after.totalCostRub),
        op.comparable ? "Разница затрат факта: " + money(op.costDifferenceRub!)
          : "Финансовая экономия факта не подтверждена: есть недоставленные заявки.",
        "Товарный баланс: " + (resultData.inventory
          ? "отгрузка " + resultData.inventory.after.totalIssued + " ед., возвраты после приёмки " +
            resultData.inventory.after.totalReturned + " ед., ожидают приёмки " +
            resultData.inventory.after.pendingReturnUnits + " ед."
          : "SKU-остатки в исходной модели не заданы."),
        "История рейсов, невыполненные заявки и отклонения сохранены в предметном результате.",
        "Повторное планирование: " + (resultData.replanning
          ? "по возвратам запланировано " + resultData.replanning.revisedScheduled +
            ", фактически доставлено " + resultData.replanning.actualDelivered +
            ", принятых возвратов " + resultData.replanning.inventory.totalReturned + " ед."
          : "SKU-склад не настроен."),
        "Полный журнал исполнения доступен для экспорта в JSON."
      ].join("\n\n");
      const candidate = { toolId: "delivery-network-planner", toolTitle: "Региональная доставка: AS-IS / TO-BE",
        filenameBase: "delivery-network-case001", markdown,
        stage: op.comparable ? "Операционная проверка завершена" : "Операционные отклонения",
        data: resultData };
      // Use the real 1 MiB transfer contract (including markdown and envelope),
      // not an arbitrary 900 kB estimate that silently hides valid large projects.
      buildD11BrowserProposal(candidate, "2026-11-13T00:00:00.000Z");
      return candidate;
    } catch { return null; }
  }, [data, state, operation, replanning]);
  function exportResults() {
    if (!data.model || !data.before || !data.after || data.before.audit.length || data.after.audit.length) return;
    const file = new Blob([JSON.stringify({ kind: "D11_CASE001_BROWSER_REPORT", parameters: { days, orders, demand, fuel, breakdown,
        customerRefusalOrderIds: refusalText }, model: data.model,
      before: data.before, after: data.after, comparison: compareScenarios(data.before, data.after), operation, inventory }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(file);
    const link = document.createElement("a"); link.href = url; link.download = "advice-logistics-case001-scenarios.json";
    document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return <SiteLayout>
    <main className="mx-auto max-w-6xl px-6 pb-24 pt-24 md:pt-32">
      <nav className="mb-6 text-xs uppercase tracking-widest text-muted">
        <Link to="/tools/" className="hover:text-foreground">Проектная лаборатория</Link> / Транспортная модель
      </nav>
      <p className="text-xs uppercase tracking-[0.25em] text-[#3B82F6]">Инженерный расчёт / CASE-001</p>
      <h1 className="mt-3 max-w-4xl font-display text-3xl sm:text-5xl">Планирование региональной доставки</h1>
      <p className="mt-5 max-w-4xl text-muted">
        Полная проверяемая последовательность заказов, рейсов и расходов. Измените спрос, стоимость топлива и доступность автопарка;
        сервис пересчитает оба способа планирования на одинаковых заявках.
      </p>
      <section className={"mt-8 " + panel}>
        <h2 className="font-display text-2xl">Исходный проект</h2>
        <p className="mt-2 text-sm text-muted">Загрузите собственную модель организации доставки с заказами,
          автомобилями, складом, окнами клиентов и при необходимости направленными дорожными матрицами.
          Расчёт выполняется в браузере, без автоматической отправки на сервер.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label className={labelCls}>Файл проекта JSON
            <input type="file" accept=".json,application/json" className={fieldCls}
              onChange={e => { void importFile(e.currentTarget.files?.[0]); e.currentTarget.value = ""; }} />
          </label>
          <button type="button" onClick={downloadTemplate}
            className="rounded border border-white/20 px-4 py-3 text-sm hover:border-[#3B82F6]">
            Скачать пример проекта JSON
          </button>
          {importedModel && <button type="button"
            onClick={() => { setState(prev => ({ ...prev, importedModel: null })); setImportError(""); }}
            className="rounded border border-white/20 px-4 py-3 text-sm hover:border-[#3B82F6]">
            Вернуться к исходной модели CASE-001
          </button>}
        </div>
        {importError && <p role="alert" className="mt-3 text-sm text-red-400">{importError}</p>}
        {importedModel && <p className="mt-4 text-sm">
          Открыт проект: <strong>{importedModel.id}</strong>. Заказов: {importedModel.orders.length},
          рабочих дней: {importedModel.days.length}, автомобилей: {importedModel.fleet.length}.
        </p>}
      </section>
      <section className={"mt-8 " + panel}>
        <h2 className="font-display text-2xl">Условия расчёта</h2>
        <p className="mt-2 text-sm text-muted">{importedModel
          ? "Исходные заказы, автопарк, склад и дорожная сеть взяты из загруженного проекта. Настройки генератора для этого проекта не применяются."
          : "В исходной структуре 200 торговых точек, 30 собственных и 15 контрактных машин, шесть постов погрузки, смены, временные окна клиентов и связанные заявки по дням."}</p>
        <fieldset disabled={Boolean(importedModel)} className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
          <label className={labelCls}>Рабочих дней
            <select className={fieldCls} value={days} onChange={e => setState(prev => ({...prev, days: Number(e.target.value)}))}>
              {[1, 3, 5, 10].map(v => <option key={v} value={v}>{v}</option>)}
            </select></label>
          <label className={labelCls}>Средний поток, заявок в день
            <select className={fieldCls} value={orders} onChange={e => setState(prev => ({...prev, orders: Number(e.target.value)}))}>
              {[120, 250, 380, 500, 650].map(v => <option key={v} value={v}>{v}</option>)}
            </select></label>
          <label className={labelCls}>Множитель спроса
            <select className={fieldCls} value={demand} onChange={e => setState(prev => ({...prev, demand: Number(e.target.value)}))}>
              {[80, 100, 120, 150].map(v => <option key={v} value={v}>{v}%</option>)}
            </select></label>
          <label className={labelCls}>Цена топлива
            <select className={fieldCls} value={fuel} onChange={e => setState(prev => ({...prev, fuel: Number(e.target.value)}))}>
              {[100, 125, 150, 200].map(v => <option key={v} value={v}>{v}%</option>)}
            </select></label>
          <label className={labelCls}>Недоступно собственных машин
            <select className={fieldCls} value={breakdown} onChange={e => setState(prev => ({...prev, breakdown: Number(e.target.value)}))}>
              {[0, 2, 5, 10, 18].map(v => <option key={v} value={v}>{v}</option>)}
            </select></label>
        </fieldset>
      </section>
      <section className={"mt-8 " + panel}>
        <h2 className="font-display text-2xl">Склад и маршрутизация</h2>
        <p className="mt-2 text-sm text-muted">{importedModel
          ? "Для расчёта используются параметры погрузочных постов, численности работников и дорожные условия загруженной модели."
          : "Посты погрузки резервируются по времени, заказы комплектуются работниками склада, а машины могут возвращаться для повторного рейса. В дорожном профиле учтены часы пик."}</p>
        <fieldset disabled={Boolean(importedModel)} className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <label className={labelCls}>Комплектовщики
            <select className={fieldCls} value={pickingWorkers}
              onChange={e => setState(prev => ({ ...prev, pickingWorkers: Number(e.target.value) }))}>
              {[6, 12, 20, 30].map(v => <option key={v} value={v}>{v} сотрудников</option>)}
            </select></label>
          <label className={labelCls}>Рейсов на машину за смену
            <select className={fieldCls} value={maxRunsPerVehicle}
              onChange={e => setState(prev => ({ ...prev, maxRunsPerVehicle: Number(e.target.value) }))}>
              {[1, 2, 3].map(v => <option key={v} value={v}>До {v}</option>)}
            </select></label>
          <label className={labelCls}>Максимум адресов в рейсе
            <select className={fieldCls} value={maxStopsPerTrip}
              onChange={e => setState(prev => ({ ...prev, maxStopsPerTrip: Number(e.target.value) }))}>
              {[8, 12, 16, 24].map(v => <option key={v} value={v}>{v} адресов</option>)}
            </select></label>
          {!importedModel && <label className={labelCls}>Начальные остатки SKU
            <select className={fieldCls} value={stockCoveragePercent}
              onChange={e => setState(prev => ({ ...prev, stockCoveragePercent: Number(e.target.value) }))}>
              {[10, 25, 50, 100].map(v => <option key={v} value={v}>{v}% базового остатка</option>)}
            </select></label>}
          <label className={labelCls}>Длительность дороги в час пик
            <select className={fieldCls} value={peakTravelPercent}
              onChange={e => setState(prev => ({ ...prev, peakTravelPercent: Number(e.target.value) }))}>
              {[100, 120, 150, 180].map(v => <option key={v} value={v}>{v}% обычного времени</option>)}
            </select></label>
        </fieldset>
        {data.after && <p className="mt-4 text-sm text-muted">
          Рейсов в целевой модели: {data.after.days.reduce((sum, d) => sum + d.runs.length, 0)}.
          {" "}Повторных рейсов: {data.after.days.reduce((sum, d) =>
            sum + d.runs.filter(run => run.tripNumber > 1).length, 0)}.
          {" "}Дефицит товара: {data.after.days.reduce((sum, d) =>
            sum + d.unserved.filter(o => o.reason === "stock-shortage").length, 0)} заказов.
          {" "}Не подготовлено складом: {data.after.days.reduce((sum, d) =>
            sum + d.unserved.filter(o => o.reason === "warehouse-throughput").length, 0)} заказов.
        </p>}
      </section>
      <section className={"mt-8 " + panel}>
        <h2 className="font-display text-2xl">Условия исполнения рейсов</h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <label className={labelCls}>Дорожные задержки
            <select className={fieldCls} value={trafficPercent}
              onChange={e => setState(prev => ({ ...prev, trafficPercent: Number(e.target.value) }))}>
              {[100, 115, 135, 160].map(v => <option key={v} value={v}>{v}% времени движения</option>)}
            </select></label>
          <label className={labelCls}>Дополнительная задержка погрузки
            <select className={fieldCls} value={dockDelayMinutes}
              onChange={e => setState(prev => ({ ...prev, dockDelayMinutes: Number(e.target.value) }))}>
              {[0, 10, 20, 40].map(v => <option key={v} value={v}>{v} мин</option>)}
            </select></label>
          <label className={labelCls}>Дополнительное обслуживание клиента
            <select className={fieldCls} value={extraServiceMinutes}
              onChange={e => setState(prev => ({ ...prev, extraServiceMinutes: Number(e.target.value) }))}>
              {[0, 3, 6, 10].map(v => <option key={v} value={v}>{v} мин на остановку</option>)}
            </select></label>
        </div>
        <label className={labelCls + " mt-5"}>Фактические отказы клиентов по ID заказов
          <textarea className={fieldCls + " min-h-20"} rows={2}
            value={refusalText} onChange={e => setState(prev => ({
              ...prev, customerRefusalOrderIds: e.target.value,
            }))}
            placeholder="Например: D01-0001, D01-0002"
            aria-label="ID заказов, от которых клиенты отказались, включая своевременные доставки" />
        </label>
        <p className="mt-2 text-xs text-muted">Введите ID через запятую или с новой строки.
          Такой отказ учитывается даже при доставке вовремя. Товар возвращается на склад,
          проходит приёмку и участвует в перепланировании следующих рабочих дней.</p>
      </section>
      <div className="mt-8 grid gap-4">
        {data.before && data.after ? <Summary before={data.before} after={data.after}/> :
          <p role="alert" className={panel}>{data.error}</p>}
        {operation && <OperationResults before={operation.before} after={operation.after}/>}
        {data.model && data.after && operation && <RouteExplorer model={data.model} plan={data.after} actual={operation.after}/>}
        {inventory && <InventoryResults report={inventory.after}/>}
        {replanning && <ReplanningResults result={replanning}/>}
        {data.model?.inventory && data.after && operation && !replanning &&
          <p role="alert" className={panel}>Повторный план не удалось подтвердить. Передача непроверенных изменений в Workspace запрещена.</p>}
        {data.before && !operation && <p role="alert" className={panel}>Не удалось воспроизвести фактическое исполнение. Проверьте ID отказов (они должны совпадать с заявками проекта) и параметры рейсов.</p>}
      </div>
      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" onClick={exportResults} disabled={!data.after || !!data.after.audit.length}
          className="rounded border border-[#3B82F6] px-5 py-3 text-sm transition-colors hover:bg-[#3B82F6]/10 disabled:opacity-50">
          Экспортировать расчёт и маршруты JSON
        </button>
        {importedModel && !workspaceResult && <p className="text-sm text-muted">Полный расчёт доступен для экспорта JSON. Передача этой модели в Workspace недоступна при текущем размере или неполной проверке результата.</p>}
        {workspaceResult && <D11ProposalExport
          payload={workspaceResult}
          buttonClass="rounded border border-[#3B82F6] bg-[#3B82F6]/10 px-5 py-3 text-sm text-foreground hover:bg-[#3B82F6]/20"
        />}
        <button type="button" onClick={clearDraft}
          className="rounded border border-white/20 px-5 py-3 text-sm hover:border-[#3B82F6]">
          Сбросить сценарий
        </button>
        <Link to="/tools/as-is-to-be-process/" className="rounded border border-white/20 px-5 py-3 text-sm hover:border-[#3B82F6]">
          Проектировать AS-IS / TO-BE
        </Link>
      </div>
      <p className="mt-5 max-w-4xl text-sm text-muted">JSON здесь является отчётом инженерного расчёта, а не архивом .iwxa.
        Проверенный сценарий можно передать в T2 Workspace с явным подтверждением пользователя. Переносимый архив .iwxa создаётся только штатным T2 Exchange, не экспортом JSON.</p>
    </main>
  </SiteLayout>;
}
