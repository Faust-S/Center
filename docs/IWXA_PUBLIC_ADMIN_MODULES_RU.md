# IWXA Admin Center — открытые организационные модули

**Статус:** предложения для развития после сверки существующих исходников, 04.11.2026. Это спецификация **будущих публичных компонентов**, а не утверждение их готовности, расширение release scope версии 0.1 или изменение нормативного Standard. Самостоятельные runnable components добавлять только при реальной потребности; общий T3 runtime не переписывать.

**Владелец публичного продукта:** `Faust-S/Center@work/2026-11-04-admin-center-0.1`. Приватные product plan и evidence: `Faust-S/IWXA-Admin-Center`; существующая технологическая реализация T3: `Faust-S/T3`. У пользователя Admin — только руководитель/администратор; сотрудники работают в Personal Agent; Atlas — единственный владелец проектов, Publisher — владелец выпуска продуктовых лицензий. Запрещено запускать второй T3 Reconciliation/AccessRegistry/Store, второй Personal Agent или собственный Graph.

**Уже в публичном Center:** `src/organization.mjs` — org/assignment draft; `runtime/t3-admin-port.mjs` — thin port к предоставленному T3 runtime; `runtime/t3-draft-repository.mjs` — адаптер **к existing T3 SubjectScopedStore**; `src/atlas-integration.mjs` и `src/atlas-native.mjs` — работа с каноническим Atlas. Тест `tests/ports.test.mjs` проверяет double, не T3 runtime readiness; `tests/t3-store.integration.test.mjs` пропускает фактический T3 без отдельно предоставленного owner module. В `package.json` текущий продукт имеет `private: true` и `UNLICENSED` даже при публичном репозитории — перед обещанием внешнего повторного использования требуется явная лицензия на конкретные модули.

## CEN01 — IWXA Organization & Workspace Operations

**Задача:** полноценное управление организацией или группой: люди, рабочие области, назначения, результативность и история. Не превращать Admin Center в приложение сотрудника или общее хранилище персональных файлов.

**База:** `src/organization.mjs`, `src/App.tsx`; текущие объекты `Organization`, `Workspace`, `Participant`, `Assignment` существуют как **draft**, не полномочия.

**Контракт (кандидат):** `OrganizationRef {id, revision}`; `WorkspaceRef {orgId, workspaceId, revision}`; `AssignmentDraft {id, title, criteria, assigneeRef?, reviewerRef?, atlasWorkRef?, editNumber}`; `OrganizationOperationsPort` (list/create/update/assign, а фактические решения и запись — через owning T3). Host передаёт runtime и текущий организационный контекст.

**Функции:** создание 0/1/N групп, рабочего пространства, участника, подготовка поручения, связь с Atlas WorkItem; переход от draft к реальному поручению только после действительного T3 binding. Разные роли сотрудников не доказывают сами по себе membership/grants.

**Первый рабочий срез:** 2 организации, разные workspaces, один сотрудник с 2 поручениями, обе строки с source Atlas work IDs; сохранить/закрыть/восстановить, проверить изоляцию и отсутствие фальшивого выдаваемого Task.

**Готовность:** успешная UI работа/перезапуск *и отдельно* подтверждённая T3 issuance. `DRAFT_ONLY` в интерфейсе до исполнения `createTask`.

## CEN02 — IWXA Organizational Task & Result Exchange

**Задача:** передать организационное поручение конкретному человеку и принять выбранный Result через **собственный .iwxa**, включая обратную доставку, без нового формата и без второго обменного engine.

**База:** `runtime/t3-admin-port.mjs`, T3 `interop`, `access-control/iwxa-package.mjs`, настоящий `Agent Result` и соответствующий T3 `interop.result.v2` — не тождественны; T3 runtime owner не копировать сюда.

**Контракт (кандидат):** `IssueRequest {orgRef, assignmentRef, taskRevisionId, recipientRef}`; `PackageObservation {packageSha256, contentType, sourceRevision, deliveryState}`; `ResultSelection {taskRef, selectedResultRefs}`; `ExchangePort.issue/inspect/prepareResponse` — реализован тонким public adapter к existing runtime. Signed org Task создаёт T3 owner; preview не подменяет issuance или delivery.

**Функции:** issue (с подтверждённой редакцией); ручная передача файла; получение ответа; readback/повтор; отображение исходной организации и версий; explicit unsupported для несовместимого профиля; никаких private signing keys в frontend.

**Первый рабочий срез:** две реальные роли в изолированных пользовательских средах → issued signed Task → Agent делает Result → selected export .iwxa → Admin импортирует → preview, without apply.

**Готовность:** точная signed revision, receipt, reproducible import/readback и повторный запуск. Публичный contract double недостаточен.

## CEN03 — IWXA Reconciliation & Decision Workbench

**Задача:** организационная приёмка, возврат на доработку и отдельное применение с просмотром конфликтов, версий и происхождения; интерфейс руководителя поверх действующего T3 Reconciliation.

**База:** T3 Reconciliation, SubjectScopedStore, Journal, `runtime/t3-admin-port.mjs` (`inspect`, `decide`, `previewApplication`). Фактически `CHANGES_REQUESTED` текущим портом отклоняется как `T3_RETURN_OPERATION_NOT_AVAILABLE` — не маскировать под REJECT.

**Контракт (кандидат):** `ReviewProjection {packageSha256, taskRevisionId, candidates, conflicts, previewDigest}`; `Decision {ACCEPT|REJECT|RETURN_FOR_CHANGES, reason, expectedRevision}`; `ApplyRequest {acceptanceRef, expectedRevision, selectedRevisionIds}`; readback от existing runtime.

**Функции:** просмотр полученного, дедупликация и отображение конфликтов через owning T3; решение руководителя; создание возврата на доработку только если T3 поддерживает реальную операцию; **принятие ≠ применение**; отдельный preview/apply/readback.

**Первый рабочий срез:** принять один результат, отклонить второй, повторно импортировать принятый без нового действия; вернуть на доработку — только после реализации T3 business operation либо явно показать unavailable; применить выбранный результат в организации.

**Готовность:** receipt от T3 и установленного Center, сохранение после закрытия, отсутствие мутаций при preview, duplicate/conflict cases.

## CEN04 — IWXA Participant & License Consumer

**Задача:** менеджерская работа с участниками/организационными полномочиями и распределением уже выпущенных лицензий Personal Agent. Admin не выпускает Publisher license и не заменяет AccessRegistry.

**База:** текущие `credentialState: NOT_ENROLLED`, `personalAgentPlan: NONE/PLANNED` в `src/organization.mjs`; T3 AccessRegistry/product grants, Publisher owner.

**Контракт (кандидат):** `ParticipantRef {orgId, participantId}`; `SeatPlan`, `LicenseObservation {issuerRef, licenseRef, revision, verifiedState}`, `MembershipObservation`; `LicensingConsumerPort.inspect/assign/revoke` вызывает существующий owner, не выпускает подписи и не хранит credentials в каталожных JSON.

**Функции:** onboarding действительной роли, отображение верифицированного состояния, назначение разрешённого seat, отдельное прекращение полномочий и readback. В draft показывать PLANNED, а не ENABLED.

**Первый рабочий срез:** реальный действительный issued entitlement; один администратор распределяет место двум учётным субъектам по допустимой политике, видит проверенные состояния, лишний grant не появляется. При отсутствии лицензии — понятное состояние без выдуманной активации.

**Готовность:** реальные существующие Product/Access checks, правильное разделение Issuer/Admin, restart-readback. Новая система безопасности не разрабатывается.

## CEN05 — IWXA Atlas Organizational Project Bridge

**Задача:** проекты, ресурсы, сроки, зависимости и исполнение согласованы с **одним** каноническим Atlas; Admin ведёт организационное поручение, а не собственный планировщик.

**База:** `src/atlas-integration.mjs` / `src/atlas-native.mjs`, канонический `Faust-S/Atlas`, organization drafts and source revision bindings.

**Контракт (кандидат):** `AtlasProjectRef {projectId, revision}`, `AtlasWorkRef {projectId, workId, revision}`; `AtlasHostPort.list/read/projectWork/observeRevision` — host-specific, data semantics native Atlas.

**Функции:** просмотр корпоративного портфеля, связывание поручения с Atlas WorkItem, сигнал о смене ревизии; проекция в рабочем месте сотрудника Agent; запись управляется Atlas/T3 host rules, не копией portfolio в Center.

**Первый рабочий срез:** один Atlas проект с зависимостями, 2 поручения в Center, один Result в Agent; руководитель получает корректный progress signal после принятия без перезаписи канонического Atlas.

**Готовность:** два разных host adapters (Center и Agent), нативное чтение, точные revision IDs, close/reopen, отсутствие дрейфа и дублированной project DB.

## Что делать в первую очередь

**Текущий release 0.1 не расширять вне его утверждённых CP0–CP5.** Приоритет: закончить реально предусмотренный signed .iwxa → review → apply → save/restart на существующем T3; затем квалифицировать Atlas и Agent bridge. CEN03, CEN04 и отдельные advanced capabilities развивать как дальнейшие инкременты *после* того, как подтвердятся их зависимости. Эти спецификации не санкционируют дополнительные IAM, отдельный Reconciliation или издательский центр.

**Разработка:** строго публичный `Center` для нового продукта и открытых модулей; приватный `IWXA-Admin-Center` — закрытый план, handoff и ссылки на T3. Не копировать закрытые исходники в GitHub public или CI; public T3 doubles не доказывают действительный runtime. Добавление лицензии на открытые повторно используемые пакеты требует отдельного решения владельца.
