import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { SiteLayout, PageHero } from "@/components/SiteLayout";
import { DisclaimerBox } from "@/components/tools/DisclaimerBox";
import { D11WorkspaceEntry } from "@/components/tools/D11WorkspaceEntry";
import { PrivacyLocalBox } from "@/components/tools/PrivacyLocalBox";
import { SeoTextBlock } from "@/components/tools/SeoTextBlock";
import { TOOLS, TOOLS_BY_ID, type ToolId } from "@/components/tools/ToolsCatalog";
import { canonicalFor } from "@/site-routes";
import { jsonLdScripts, breadcrumbSchema, faqSchema, itemListSchema } from "@/lib/seo-schema";

const CANONICAL = canonicalFor("/tools/");

const HERO_BADGES = [
  "логистика, транспорт, склад, МТО, цепи поставок",
  "ERP / WMS / TMS / BI / ЭДО",
  "бизнес-процессы и ИТ-внедрения",
  "экспорт в Markdown / JSON / HTML",
  "данные не отправляются на сервер",
  "исходные материалы для проектной работы",
];

const JOURNEY: { toolId: ToolId; name: string; hint: string }[] = [
  {
    toolId: "delivery-network-planner",
    name: "Рассчитать транспортную модель",
    hint: "Количественно проверить план доставки, грузоподъёмность, доступность транспорта, окна клиентов и затраты.",
  },
  {
    toolId: "as-is-to-be-process",
    name: "Карта процесса",
    hint: "Фиксирует границы процесса, участников, этапы, входы, выходы и контрольные точки.",
  },
  {
    toolId: "process-data-system-role-matrix",
    name: "Матрица данных и систем",
    hint: "Связывает процессы, данные, источники, системы и ответственных участников.",
  },
  {
    toolId: "automation-readiness",
    name: "Готовность к автоматизации",
    hint: "Оценивает формализацию процесса, качество данных, роли, контроль и условия цифровизации.",
  },
  {
    toolId: "functional-requirements-logistics-it",
    name: "Функциональные требования",
    hint: "Формирует структуру функций, ролей, данных, статусов, интеграций и критериев приёмки.",
  },
  {
    toolId: "logistics-automation-terms-of-reference",
    name: "Техническое задание",
    hint: "Собирает исходные требования к проектированию или развитию цифровой системы.",
  },
  {
    toolId: "project-brief-generator",
    name: "Проектный бриф",
    hint: "Структурирует контур задачи, масштаб, исходные данные и необходимый проектный результат.",
  },
];

const SITUATIONS: { label: string; recs: ToolId[] }[] = [
  {
    label: "Нужно проверить расходы на доставку и загрузку автопарка",
    recs: ["delivery-network-planner", "as-is-to-be-process", "project-brief-generator"],
  },
  {
    label: "Требуется описать и структурировать процесс",
    recs: [
      "as-is-to-be-process",
      "automation-readiness",
      "logistics-automation-terms-of-reference",
    ],
  },
  {
    label: "Требуется сформировать функциональные требования",
    recs: [
      "functional-requirements-logistics-it",
      "process-data-system-role-matrix",
      "logistics-automation-terms-of-reference",
    ],
  },
  {
    label: "Требуется навести порядок в источниках данных, ролях и статусах",
    recs: [
      "process-data-system-role-matrix",
      "automation-readiness",
      "as-is-to-be-process",
    ],
  },
  {
    label: "Требуется зафиксировать бизнес-логику для проектирования цифрового решения",
    recs: [
      "logistics-automation-terms-of-reference",
      "functional-requirements-logistics-it",
      "process-data-system-role-matrix",
    ],
  },
  {
    label: "Требуется оценить готовность процесса к автоматизации",
    recs: [
      "automation-readiness",
      "as-is-to-be-process",
      "process-data-system-role-matrix",
    ],
  },
  {
    label: "Требуется определить условия и ограничения автоматизации",
    recs: [
      "automation-readiness",
      "process-data-system-role-matrix",
      "functional-requirements-logistics-it",
    ],
  },
  {
    label: "Требуется подготовить обращение в Advice Logistics",
    recs: [
      "project-brief-generator",
      "automation-readiness",
      "functional-requirements-logistics-it",
    ],
  },
  {
    label: "Требуется подготовить НИР, обследование или проектное заключение",
    recs: [
      "project-brief-generator",
      "process-data-system-role-matrix",
      "as-is-to-be-process",
    ],
  },
];


const FAQ = [
  {
    q: "Что это за инструменты?",
    a: "Инструменты помогают рассчитывать транспортные сценарии, описывать процессы и данные, оценивать готовность к автоматизации и готовить требования, ТЗ или проектный бриф. Полученные материалы требуют проверки и уточнения.",
  },
  {
    q: "Как обрабатываются введённые данные?",
    a: "Все расчёты выполняются локально в браузере. Пользователь сам решает, скачивать, копировать или передавать сформированный документ.",
  },
  {
    q: "Можно ли использовать документы как готовое ТЗ?",
    a: "Нет. Документы служат предварительной заготовкой. Перед передачей исполнителю необходимо проверить данные, согласовать требования, интеграции и критерии приёмки.",
  },
  {
    q: "Для кого предназначены инструменты?",
    a: "Для руководителей логистики, операционных директоров, проектных офисов, ИТ-департаментов, интеграторов, аналитиков бизнес-процессов, транспортных операторов, складских и снабженческих подразделений, команд МТО и организаций, которые готовят логистические, транспортные или ИТ-проекты.",
  },
  {
    q: "С какими системами связаны инструменты?",
    a: "Инструменты подходят для подготовки к ERP, WMS, TMS, BI, ЭДО, внутренним системам учёта, системам управления перевозками, складом, МТО, заявками, статусами, документами и отчётностью.",
  },
  {
    q: "Можно ли использовать инструменты для НИР или НИОКР?",
    a: "Да. Генератор проектного брифа, матрица данных и инструменты описания процессов могут использоваться для подготовки исследовательской задачи, структуры данных, ограничений, гипотез и ожидаемых результатов НИР или НИОКР.",
  },
];

export const Route = createFileRoute("/tools/")({
  head: () => ({
    meta: [
      { title: "Проектная лаборатория - Advice Logistics" },
      {
        name: "description",
        content:
          "Инженерные браузерные инструменты Advice Logistics для подготовки логистических, транспортных, процессных и ИТ-проектов: AS-IS/TO-BE, матрица данных, готовность к автоматизации, функциональные требования, структура ТЗ, проектный бриф.",
      },
      { property: "og:title", content: "Проектная лаборатория - Advice Logistics" },
      {
        property: "og:description",
        content:
          "Проектная лаборатория для расчёта транспортных сценариев, анализа процессов и подготовки логистических проектов. Всё считается локально, данные не отправляются на сервер.",
      },
      { property: "og:type", content: "website" },
      { property: "og:url", content: CANONICAL },
      { property: "og:image", content: "https://advice-logistics.ru/og-default.jpg" },
      { name: "twitter:image", content: "https://advice-logistics.ru/og-default.jpg" },
    ],
    links: [{ rel: "canonical", href: CANONICAL }],
    scripts: jsonLdScripts(
      breadcrumbSchema([["Проектная лаборатория", "/tools/"]]),
      itemListSchema({
        name: "Инструменты Проектной лаборатории",
        path: "/tools/",
        items: TOOLS.map((t) => ({
          name: t.title,
          path: `${t.url}/`,
          description: t.purpose,
        })),
      }),
      faqSchema(FAQ),
    ),
  }),
  component: ToolsIndex,
});

function ToolsIndex() {
  return (
    <SiteLayout>
      <PageHero
        eyebrow="/ проектная лаборатория /"
        title={
          <>
            Проектная лаборатория <br />
            Advice Logistics
          </>
        }
        intro="Рассчитайте транспортную модель, оцените варианты доставки, опишите процессы и подготовьте обоснованные проектные требования."
      />

      <section className="mx-auto max-w-7xl px-6 pb-16">
        <div className="mb-8 flex flex-wrap gap-2">
          {HERO_BADGES.map((b) => (
            <span
              key={b}
              className="rounded border border-white/10 bg-white/[0.02] px-3 py-1 font-mono text-[11px] uppercase tracking-widest text-muted"
            >
              {b}
            </span>
          ))}
        </div>
        <div className="flex flex-wrap gap-3">
          <D11WorkspaceEntry className="rounded border border-[#3B82F6] bg-[#3B82F6]/10 px-4 py-2 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:bg-[#3B82F6]/20" />
          <Link
            to="/tools/depot-maintenance-supply"
            className="rounded border border-[#3B82F6] px-4 py-2 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:bg-[#3B82F6]/10"
          >
            Ремонтные парки и запасные части (CASE-002)
          </Link>
          <Link
            to="/tools/distribution-network-expansion"
            className="rounded border border-[#3B82F6] px-4 py-2 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:bg-[#3B82F6]/10"
          >
            Распределительная сеть (CASE-003)
          </Link>
          <Link
            to="/tools/cold-chain-control"
            className="rounded border border-[#3B82F6] px-4 py-2 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:bg-[#3B82F6]/10"
          >
            Холодовая цепь (CASE-004)
          </Link>
          <a
            href="#catalog"
            className="rounded border border-white/15 bg-white/[0.03] px-4 py-2 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:border-[#3B82F6] hover:text-[#3B82F6]"
          >
            Выбрать инструмент
          </a>
          <Link
            to="/tools/project-brief-generator"
            className="rounded border border-white/15 bg-white/[0.03] px-4 py-2 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:border-[#3B82F6] hover:text-[#3B82F6]"
          >
            Собрать проектный бриф
          </Link>
          <Link
            to="/tools/automation-readiness"
            className="rounded border border-white/15 bg-white/[0.03] px-4 py-2 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:border-[#3B82F6] hover:text-[#3B82F6]"
          >
            Проверить готовность к автоматизации
          </Link>
        </div>
      </section>

      {/* Journey */}
      <section className="mx-auto max-w-7xl px-6 pb-20">
        <div className="mb-6">
          <div className="mb-2 font-mono text-xs uppercase tracking-widest text-[#3B82F6]">
            Маршрут
          </div>
          <h2 className="font-display text-3xl md:text-4xl">От исходных данных и расчётов к проектному решению</h2>
        </div>
        <ol className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {JOURNEY.map((step, i) => {
            const t = TOOLS_BY_ID[step.toolId];
            return (
              <li
                key={step.toolId}
                className="flex flex-col rounded border border-white/10 bg-white/[0.02] p-5"
              >
                <div className="mb-3 font-mono text-[11px] uppercase tracking-widest text-[#3B82F6]">
                  Шаг {String(i + 1).padStart(2, "0")}
                </div>
                <div className="mb-2 font-display text-lg leading-snug">{step.name}</div>
                <p className="mb-4 text-sm leading-relaxed text-muted">{step.hint}</p>
                <Link
                  to={t.url}
                  className="mt-auto font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:text-[#3B82F6]"
                >
                  → Открыть инструмент
                </Link>
              </li>

            );
          })}
        </ol>
      </section>

      <section className="mx-auto max-w-7xl px-6 pb-16">
        <div className="rounded border border-[#3B82F6]/40 bg-[#3B82F6]/[0.05] p-6 md:p-8">
          <p className="font-mono text-xs uppercase tracking-widest text-[#3B82F6]">Инженерная модель / CASE-001</p>
          <h2 className="mt-3 font-display text-2xl md:text-3xl">Рассчитать региональную доставку</h2>
          <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
            Заказы, автомобили, временные окна, загрузка склада, маршруты и транспортные затраты.
            Сравните AS-IS и TO-BE на одинаковом потоке заказов, проверьте перегрузку и отказ техники.
          </p>
          <Link to="/tools/delivery-network-planner/" className="mt-5 inline-block rounded border border-[#3B82F6] px-5 py-3 text-sm text-foreground hover:bg-[#3B82F6]/10">
            Открыть расчётную модель
          </Link>
        </div>
      </section>

      <ToolPicker />

      {/* Catalog */}
      <section id="catalog" className="mx-auto max-w-7xl px-6 pb-20 pt-4">
        <div className="mb-6">
          <div className="mb-2 font-mono text-xs uppercase tracking-widest text-[#3B82F6]">
            Каталог
          </div>
          <h2 className="font-display text-3xl md:text-4xl">Инструменты проектной лаборатории</h2>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {TOOLS.map((t) => (
            <Link
              key={t.id}
              to={t.url}
              className="group flex flex-col rounded border border-white/10 bg-white/[0.02] p-6 transition-colors hover:border-[#3B82F6]/60"
            >
              <div className="mb-4 flex items-baseline justify-between font-mono text-[11px] uppercase tracking-widest text-muted">
                <span className="text-[#3B82F6]">{t.n}</span>
                <span>{t.category}</span>
              </div>
              <h3 className="mb-3 font-display text-xl leading-tight md:text-2xl">{t.title}</h3>
              <p className="mb-4 text-sm leading-relaxed text-muted">{t.purpose}</p>
              <dl className="mb-4 space-y-2 text-xs text-muted">
                <div>
                  <dt className="font-mono uppercase tracking-widest text-[#3B82F6]">Кому полезно</dt>
                  <dd className="mt-1 leading-relaxed">{t.who}</dd>
                </div>
                <div>
                  <dt className="font-mono uppercase tracking-widest text-[#3B82F6]">Когда использовать</dt>
                  <dd className="mt-1 leading-relaxed">{t.when}</dd>
                </div>
                <div>
                  <dt className="font-mono uppercase tracking-widest text-[#3B82F6]">На выходе</dt>
                  <dd className="mt-1 leading-relaxed">{t.output}</dd>
                </div>
              </dl>
              <div className="mt-auto font-mono text-xs uppercase tracking-widest text-foreground transition-colors group-hover:text-[#3B82F6]">
                → {t.cta}
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* SEO block */}
      <section className="mx-auto max-w-6xl space-y-6 px-6 pb-16">
        <SeoTextBlock title="Предпроектные инструменты для логистики, транспорта, бизнес-процессов и ИТ-внедрений">
          <p>
            Начать можно с описания текущего процесса AS-IS. Затем определить возможные изменения
            TO-BE, источники данных и ответственных. Другие инструменты помогут оценить
            готовность к автоматизации и подготовить предварительные требования,
            структуру ТЗ или проектный бриф.
          </p>
          <p>
            Полученные материалы могут использоваться при подготовке аудита, исследования
            или проекта цифровизации. Они не заменяют проверку исходных данных,
            интервью с участниками процессов и согласование решения.
          </p>

          <h3 className="pt-2 font-display text-lg text-foreground">
            Инструменты для подготовки функциональных требований
          </h3>
          <p>
            Перед передачей задачи разработчику нужно согласовать, какие действия выполняет
            система, кто отвечает за данные и как проверить результат. Инструмент помогает
            структурировать функции, роли, статусы, интеграции, отчёты и критерии приёмки.
          </p>


          <h3 className="pt-2 font-display text-lg text-foreground">
            Инструменты для описания бизнес-процессов AS-IS и TO-BE
          </h3>
          <p>
            AS-IS показывает, как процесс работает сейчас: кто участвует, какие действия
            выполняются, где возникают данные, документы, статусы, задержки, ручные операции и
            исключения. TO-BE описывает целевую модель процесса после изменения регламента,
            данных, ролей или ИТ-системы. Такое описание нужно перед автоматизацией, подготовкой
            регламента, обследованием, аудитом или техническим заданием.
          </p>

          <h3 className="pt-2 font-display text-lg text-foreground">
            Инструменты для подготовки ТЗ на автоматизацию
          </h3>
          <p>
            Техническое задание описывает функции, роли, данные, статусы, события, интеграции,
            ограничения, контрольные сценарии и критерии приёмки. Конструктор ТЗ помогает
            предварительно собрать структуру такого документа до передачи задачи разработчикам
            или интегратору.
          </p>

          <h3 className="pt-2 font-display text-lg text-foreground">
            Инструменты для проверки готовности к автоматизации
          </h3>
          <p>
            До разработки ТЗ стоит проверить, описаны ли процессы, назначены ли ответственные
            и достаточно ли надёжны данные. Предварительная оценка помогает определить,
            какие материалы требуют доработки.
          </p>


          <h3 className="pt-2 font-display text-lg text-foreground">
            Инструменты для ERP, WMS, TMS, BI и ЭДО
          </h3>
          <p>
            При интеграции ERP, WMS, TMS и других систем важно установить, где создаются данные,
            кто их изменяет и какие события передаются между системами. Матрица
            «процесс → данные → система → роль» помогает зафиксировать эти связи.
          </p>

          <h3 className="pt-2 font-display text-lg text-foreground">
            Инструменты для логистического аудита, НИР и проектного брифа
          </h3>
          <p>
            Проектный бриф фиксирует цель, границы исследования, участников, доступные данные,
            ограничения и ожидаемый результат. Его можно использовать при подготовке
            первой встречи или внутреннего согласования проекта.
          </p>
        </SeoTextBlock>

        <section className="rounded border border-white/10 bg-white/[0.02] p-6">
          <h2 className="mb-4 font-display text-2xl">Частые вопросы</h2>
          <div className="divide-y divide-white/10">
            {FAQ.map((f) => (
              <details key={f.q} className="group py-4">
                <summary className="cursor-pointer list-none font-mono text-sm uppercase tracking-widest text-foreground transition-colors group-open:text-[#3B82F6]">
                  {f.q}
                </summary>
                <p className="mt-3 text-sm leading-relaxed text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="rounded border border-white/10 bg-white/[0.03] p-6 md:p-8">
          <div className="mb-2 font-mono text-xs uppercase tracking-widest text-[#3B82F6]">
            Следующий этап
          </div>
          <h2 className="mb-3 font-display text-2xl md:text-3xl">
            Перейти от предварительной оценки к проектной работе
          </h2>
          <p className="mb-5 max-w-3xl text-sm leading-relaxed text-muted md:text-base">
            Сформированный документ можно использовать для первого обсуждения.
            На следующем этапе определяются границы системы, состав данных, формат анализа и
            необходимый проектный результат.
          </p>
          <div className="flex flex-wrap gap-3">
            <a
              href="/kontakty/?source=tools"
              className="rounded border border-[#3B82F6] bg-[#3B82F6]/15 px-4 py-2 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:bg-[#3B82F6]/25"
            >
              Обсудить проектную задачу
            </a>

            <Link
              to="/primery-realizovannyh-proektov"
              className="rounded border border-white/15 bg-white/[0.03] px-4 py-2 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:border-[#3B82F6] hover:text-[#3B82F6]"
            >
              Смотреть реализованные проекты
            </Link>
            <a
              href="mailto:hi@advice-logistics.ru"
              className="rounded border border-white/15 bg-white/[0.03] px-4 py-2 font-mono text-xs uppercase tracking-widest text-foreground transition-colors hover:border-[#3B82F6] hover:text-[#3B82F6]"
            >
              hi@advice-logistics.ru
            </a>
          </div>
        </section>


        <DisclaimerBox />
        <PrivacyLocalBox />
      </section>
    </SiteLayout>
  );
}

function ToolPicker() {
  const [i, setI] = useState(0);
  const active = SITUATIONS[i];
  return (
    <section className="mx-auto max-w-7xl px-6 pb-20">
      <div className="mb-6">
        <div className="mb-2 font-mono text-xs uppercase tracking-widest text-[#3B82F6]">
          Подборщик
        </div>
        <h2 className="font-display text-3xl md:text-4xl">Какой инструмент выбрать</h2>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted md:text-base">
          Выберите ситуацию слева. Справа появится набор рекомендуемых инструментов с описанием, что
          вы получите на выходе.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <ul className="flex flex-col divide-y divide-white/10 overflow-hidden rounded border border-white/10 bg-white/[0.02]">
          {SITUATIONS.map((s, idx) => {
            const isActive = idx === i;
            return (
              <li key={s.label}>
                <button
                  type="button"
                  onClick={() => setI(idx)}
                  className={`w-full px-4 py-3 text-left text-sm leading-snug transition-colors ${
                    isActive
                      ? "bg-[#3B82F6]/10 text-foreground"
                      : "text-muted hover:bg-white/[0.03] hover:text-foreground"
                  }`}
                >
                  <span className="mr-2 font-mono text-[10px] uppercase tracking-widest text-[#3B82F6]">
                    {String(idx + 1).padStart(2, "0")}
                  </span>
                  {s.label}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="grid gap-3">
          {active.recs.map((id) => {
            const t = TOOLS_BY_ID[id];
            return (
              <Link
                key={id}
                to={t.url}
                className="group flex flex-col rounded border border-white/10 bg-white/[0.02] p-5 transition-colors hover:border-[#3B82F6]/60"
              >
                <div className="mb-2 flex items-baseline justify-between font-mono text-[11px] uppercase tracking-widest text-muted">
                  <span className="text-[#3B82F6]">Инструмент {t.n}</span>
                  <span>{t.category}</span>
                </div>
                <div className="mb-2 font-display text-lg leading-snug">{t.title}</div>
                <p className="mb-3 text-sm leading-relaxed text-muted">
                  <span className="font-mono text-[11px] uppercase tracking-widest text-[#3B82F6]">
                    На выходе:
                  </span>{" "}
                  {t.output}
                </p>
                <div className="mt-auto font-mono text-xs uppercase tracking-widest text-foreground transition-colors group-hover:text-[#3B82F6]">
                  → Открыть
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    </section>
  );
}
