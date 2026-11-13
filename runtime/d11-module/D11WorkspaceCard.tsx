/** Manual local D11 browser proposal -> selected T2 Workspace. Never uploads data. */
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { useWorkspaceModuleRuntime } from "@/workspace-host/rendering/ModuleRenderContext";
import { hostRouteRefs } from "@/workspace-host/router";
import type { WorkspaceRecord, EventRecord } from "@/kernel-client/contracts/runtime-1.3.0";
import { D11_MAX_BYTES, validateD11BrowserProposal, type D11BrowserProposal } from "./d11-transfer";
import { D11_COMMANDS } from "./commands";
import { d11CaseEditorPath, d11CaseLineage } from "./editor-source-path";
import type { D11StoredProposal } from "./queries";
import { createD11WriteIntent } from "./proposal-write";
import { saveD11ProposalWithReadback } from "./proposal-save";
import { D11_HANDOFF_PROTOCOL, D11_SAME_TAB_PREVIEW_KEY, isTrustedD11HandoffPeer, readD11HandoffPreview, readD11SameTabPreview } from "./d11-handoff";

const MAX_FILE_BYTES = D11_MAX_BYTES + 32768;
const TOOL_TITLES: Record<string, string> = {
  "as-is-to-be-process": "Процесс AS-IS / TO-BE",
  "process-data-system-role-matrix": "Матрица процессов, данных, систем и ролей",
  "automation-readiness": "Готовность к автоматизации",
  "functional-requirements-logistics-it": "Функциональные требования",
  "logistics-automation-terms-of-reference": "Техническое задание",
  "project-brief-generator": "Проектный бриф",
  "delivery-network-planner": "Инженерная модель региональной доставки",
};
const RESUME_PROTOCOL = "ru.iwxa.advice-logistics.resume/1";
const EDITOR_PATHS: Record<string, string> = {
  "as-is-to-be-process": "/tools/as-is-to-be-process",
  "process-data-system-role-matrix": "/tools/process-data-system-role-matrix",
  "automation-readiness": "/tools/automation-readiness",
  "functional-requirements-logistics-it": "/tools/functional-requirements-logistics-it",
  "logistics-automation-terms-of-reference": "/tools/logistics-automation-terms-of-reference",
  "project-brief-generator": "/tools/project-brief-generator",
  "delivery-network-planner": "/tools/delivery-network-planner",
};
function editableSource(record: D11StoredProposal): Record<string, unknown> | null {
  const data = record.proposal.result.data;
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const value = data as Record<string, unknown>;
  // Older stored proposals can only be reopened when their original form fields are complete.
  const state = value._editorState ?? value.state;
  if (!state || typeof state !== "object" || Array.isArray(state)) return null;
  return state as Record<string, unknown>;
}
type Candidate = { proposal: D11BrowserProposal; json: string };

export function D11WorkspaceCard() {
  const { context } = useWorkspaceModuleRuntime();
  const [workspaces, setWorkspaces] = useState<WorkspaceRecord[]>([]);
  const [workspaceId, setWorkspaceId] = useState(() => {
    const focused = context.currentWorkspace.get();
    return focused?.profile === "organization" && !focused.deleted_at ? focused.workspace_id : "";
  });
  const [focusSelecting, setFocusSelecting] = useState(false);
  // Synchronous guard prevents two focus commands before React rerenders.
  const focusRequest = useRef(false);
  // One cryptographically generated ID per pending creation. On an uncertain
  // Kernel receipt reuse it; never create a second Workspace on retry.
  const pendingWorkspaceId = useRef<string | null>(null);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const workspaceSelection = useRef(workspaceId);
  const pendingCreate = useRef<{ workspaceId: string; json: string; id: string; baseRevision: number } | null>(null);
  const recordsGeneration = useRef(0);
  const [candidate, setCandidate] = useState<Candidate | null>(null);
  const transferSource = useRef<Window | null>(null);
  const transferId = useRef<string | null>(null);
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  // Message handlers must see pending user work even between React renders.
  const pendingReview = useRef<{ candidate: Candidate | null; busy: boolean }>({ candidate: null, busy: false });
  pendingReview.current = { candidate, busy };
  const [message, setMessage] = useState("");
  const [records, setRecords] = useState<D11StoredProposal[]>([]);
  const [opened, setOpened] = useState<D11StoredProposal | null>(null);
  const [history, setHistory] = useState<EventRecord[]>([]);
  const [historyState, setHistoryState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [historyRefresh, setHistoryRefresh] = useState(0);
  const [resumeMessage, setResumeMessage] = useState("");
  const resumedEditor = useRef<{ window: Window; source: D11StoredProposal; workspaceId: string } | null>(null);
  const [correctionOf, setCorrectionOf] = useState<D11StoredProposal | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const spec = candidate && D11_COMMANDS.find((s) => s.toolId === candidate.proposal.producer.toolId);
  // T2 WorkspaceRecord has no display-name field. Do not introduce a second
  // persistent label store: use stable creation order and Kernel dates.
  const orderedWorkspaces = [...workspaces].sort((a, b) =>
    a.created_at.localeCompare(b.created_at) || a.workspace_id.localeCompare(b.workspace_id));
  const workspaceLabel = (w: WorkspaceRecord, index: number) =>
    `Проектная область №${index + 1} · создана ${new Date(w.created_at).toLocaleDateString("ru-RU")}`;
  const selectedWorkspace = orderedWorkspaces.find((w) => w.workspace_id === workspaceId && w.profile === "organization" && !w.deleted_at);
  // An unsaved correction or uncertain write always belongs to its source Workspace.
  const sourceWorkspaceId = pendingCreate.current?.workspaceId ?? correctionOf?.workspace_id ?? null;
  const sourceWorkspace = orderedWorkspaces.find(w => w.workspace_id === sourceWorkspaceId);
  const sourceWorkspaceIndex = sourceWorkspace ? orderedWorkspaces.indexOf(sourceWorkspace) : -1;
  const returnToSourceRequired = !!candidate && !!sourceWorkspaceId && sourceWorkspaceId !== workspaceId;
  const selected = !!selectedWorkspace && context.currentWorkspace.get()?.workspace_id === workspaceId;
  const writable = selected && !selectedWorkspace?.read_only;
  const sameFamily = !correctionOf || (!!spec && correctionOf.workspace_id === workspaceId && correctionOf.schema_id === spec.schema);
  const pendingSameWorkspace = !pendingCreate.current || pendingCreate.current.workspaceId === workspaceId;
  const correctionChanged = !correctionOf || !!candidate && (
    candidate.proposal.result.title !== correctionOf.proposal.result.title ||
    candidate.proposal.result.markdown !== correctionOf.proposal.result.markdown ||
    JSON.stringify(candidate.proposal.result.data) !== JSON.stringify(correctionOf.proposal.result.data)
  );
  const canSave = writable && !focusSelecting && pendingSameWorkspace && !!spec && sameFamily && correctionChanged && context.commands.has(spec.id) &&
    context.commands.has(spec.id.replace(".save-proposal", ".load-proposal"));
  const canList = selected && !focusSelecting && D11_COMMANDS.some((s) =>
    context.commands.has(s.id.replace(".save-proposal", ".list-proposals")));
  const canBrowse = context.kernel.hasOperation("t1.listWorkspaces");
  const canCreateWorkspace = canBrowse && context.kernel.hasOperation("t1.createWorkspace");
  const canFocusWorkspace = context.commands.has("workspace.focus.select");
  
  // The Host (not D11) owns Workspace focus. Always derive the effective
  // selection from that single source, including changes in the Host UI.
  useEffect(() => {
    const applyFocus = (focused: WorkspaceRecord | null) => {
      const next = focused?.profile === "organization" && !focused.deleted_at
        ? focused.workspace_id : "";
      if (workspaceSelection.current === next) return;
      workspaceSelection.current = next;
      recordsGeneration.current++;
      setWorkspaceId(next);
      setRecords([]);
      setOpened(null);
      resumedEditor.current = null;
      setResumeMessage("");
      setApproved(false);
      // Keep an unsaved Proposal. An in-flight correction remains scoped to
      // its original Workspace and cannot be written into a different one.
      setMessage(next
        ? "Текущая рабочая область изменена через Host. Проверьте выбранную область перед сохранением."
        : "Рабочая область снята с фокуса Host. Несохранённый проект сохранён в форме.");
    };
    applyFocus(context.currentWorkspace.get());
    return context.currentWorkspace.subscribe(applyFocus);
  }, [context.currentWorkspace]);


  // Selecting a Workspace should reopen its Kernel-backed results without
  // requiring a manual refresh. Never display rows after the selection changes.
  useEffect(() => {
    if (!workspaceId || !selected || !canList) return;
    let alive = true;
    const targetWorkspaceId = workspaceId;
    const generation = ++recordsGeneration.current;
    const available = D11_COMMANDS.filter((item) =>
      context.commands.has(item.id.replace(".save-proposal", ".list-proposals")));
    void Promise.all(available.map((item) =>
      context.commands.invoke<readonly D11StoredProposal[]>(
        item.id.replace(".save-proposal", ".list-proposals"), { workspace_id: targetWorkspaceId },
      ),
    )).then((pages) => {
      if (!alive || generation !== recordsGeneration.current || workspaceSelection.current !== targetWorkspaceId) return;
      setRecords(pages.flat().filter((row) => row.workspace_id === targetWorkspaceId)
        .sort((left, right) => right.updated_at.localeCompare(left.updated_at)));
    }).catch((error: unknown) => {
      if (alive && generation === recordsGeneration.current && workspaceSelection.current === targetWorkspaceId)
        setMessage(error instanceof Error && error.message.includes("D11_RESULT_FAMILY_LIST_LIMIT_REACHED")
          ? "Каталог содержит не менее 500 объектов одного типа. Неполный список не показан; откройте результаты через штатную Workspace."
          : "Сохранённые предложения пока не удалось загрузить. Повторите чтение.");
    });
    return () => { alive = false; };
  }, [workspaceId, selected, canList, context]);

  useEffect(() => {
    let alive = true;
    if (!canBrowse) { setWorkspaces([]); return; }
    void context.kernel.listWorkspaces().then((all) => {
      if (alive) setWorkspaces(all.filter((w) => !w.deleted_at && w.profile === "organization"));
    }).catch(() => { if (alive) { setWorkspaces([]); setMessage("Список рабочих областей недоступен."); } });
    return () => { alive = false; };
  }, [context, canBrowse, refreshToken]);

  // Query the Kernel event history for this specific Result in the selected Workspace.
  useEffect(() => {
    setHistory([]);
    if (!opened || opened.workspace_id !== workspaceId) { setHistoryState("idle"); return; }
    if (!context.kernel.hasOperation("t1.listEventsSince")) { setHistoryState("error"); return; }
    let active = true;
    const sourceWorkspace = opened.workspace_id;
    const objectId = opened.object_id;
    setHistoryState("loading");
    void context.kernel.listEventsSince(sourceWorkspace).then(events => {
      if (!active || workspaceSelection.current !== sourceWorkspace) return;
      setHistory(events.filter(event => event.workspace_id === sourceWorkspace &&
        event.event_type === "d11.proposal.saved" &&
        (event.object_id === objectId ||
         (event.payload !== null && typeof event.payload === "object" &&
          !Array.isArray(event.payload) &&
          (event.payload as Record<string, unknown>).object_id === objectId)))
        .sort((a,b) => a.occurred_at.localeCompare(b.occurred_at)));
      setHistoryState("ready");
    }).catch(() => { if (active) setHistoryState("error"); });
    return () => { active = false; };
  }, [opened?.object_id, opened?.revision, opened?.workspace_id, workspaceId, context.kernel, historyRefresh]);

  // The opener holds the transient data until this Host signals READY.
  // Receive from that exact same-origin opener once; never write on receipt.
  useEffect(() => {
    const opener = window.opener;
    if (!opener || opener === window) return;
    transferSource.current = opener;
    let active = true;
    const receive = (event: MessageEvent<unknown>) => {
      if (!active || !isTrustedD11HandoffPeer(event, window.location.origin, opener)) return;
      let message: ReturnType<typeof readD11HandoffPreview>;
      try {
        message = readD11HandoffPreview(event.data);
      } catch { return; }
      if (transferId.current !== null) {
        if (transferId.current === message.transferId) {
          // Repeated delivery after save or dismissal must not acknowledge
          // a proposal that the Host no longer holds for review.
          opener.postMessage({
            protocol: D11_HANDOFF_PROTOCOL,
            kind: pendingReview.current.candidate ? "ACCEPTED" : "REJECTED",
            transferId: message.transferId,
          }, window.location.origin);
          return;
        }
        // Once the previous proposal has been saved or dismissed, the next
        // user-triggered transfer must be accepted in the same Host window.
        if (pendingReview.current.candidate || pendingReview.current.busy) {
          opener.postMessage({ protocol: D11_HANDOFF_PROTOCOL, kind: "REJECTED", transferId: message.transferId }, window.location.origin);
          return;
        }
        transferId.current = null;
      }
      if (pendingReview.current.candidate || pendingReview.current.busy || pendingCreate.current) {
        // An unresolved Kernel write owns its original Object ID. Replacing
        // its preview could orphan a committed Result after a lost receipt.
        opener.postMessage({ protocol: D11_HANDOFF_PROTOCOL, kind: "REJECTED", transferId: message.transferId }, window.location.origin);
        if (pendingCreate.current) setMessage("Сначала проверьте прежнюю неопределённую запись через Kernel. Другая передача не заменит её Object ID.");
        return;
      }
      transferId.current = message.transferId;
      try {
        const proposal = validateD11BrowserProposal(message.proposal);
        const json = JSON.stringify(proposal, null, 2);
        if (new TextEncoder().encode(json).byteLength > MAX_FILE_BYTES) throw new Error("D11_HANDOFF_TOO_LARGE");
        pendingCreate.current = null;
        pendingReview.current.candidate = { proposal, json };
        setCandidate({ proposal, json });
        setOpened(null); setCorrectionOf(null); setApproved(false);
        setMessage("Предварительный результат получен. Выберите Workspace, проверьте данные и отдельно разрешите запись в Kernel.");
        opener.postMessage({ protocol: D11_HANDOFF_PROTOCOL, kind: "ACCEPTED", transferId: message.transferId }, window.location.origin);
      } catch {
        transferId.current = null;
        opener.postMessage({ protocol: D11_HANDOFF_PROTOCOL, kind: "REJECTED", transferId: message.transferId }, window.location.origin);
      }
    };
    window.addEventListener("message", receive);
    // Referrer may be legitimately removed by browser policy. READY carries
    // no client data. The opener still checks exact event.source and origin,
    // and PREVIEW is accepted only from this opener at this exact origin.
    opener.postMessage({ protocol: D11_HANDOFF_PROTOCOL, kind: "READY" }, window.location.origin);
    return () => { active = false; window.removeEventListener("message", receive); };
  }, []);

  // Optional, visible, popup-free D11 user journey. The Host accepts a
  // short-lived tab-local preview, never a previously approved Result.
  // The existing scoped commands and consent gate remain authoritative.
  useEffect(() => {
    let serialized: string | null;
    try {
      serialized = window.sessionStorage.getItem(D11_SAME_TAB_PREVIEW_KEY);
      // Consume before checking pending activity, so a second unconfirmed
      // proposal cannot reappear after a later navigation.
      if (serialized) window.sessionStorage.removeItem(D11_SAME_TAB_PREVIEW_KEY);
    } catch { return; }
    if (!serialized) return;
    try {
      const packet = readD11SameTabPreview(JSON.parse(serialized) as unknown, Date.now());
      const proposal = validateD11BrowserProposal(packet.proposal);
      const json = JSON.stringify(proposal, null, 2);
      if (new TextEncoder().encode(json).byteLength > MAX_FILE_BYTES) throw new Error("D11_SAME_TAB_TOO_LARGE");
      if (pendingReview.current.candidate || pendingReview.current.busy || pendingCreate.current) {
        setMessage("Завершите проверку прежнего проекта перед получением следующего результата. Новая временная передача отклонена и удалена.");
        return;
      }
      pendingReview.current.candidate = { proposal, json };
      setCandidate({ proposal, json });
      setOpened(null); setCorrectionOf(null); setApproved(false);
      setMessage("Предварительный результат получен в текущей вкладке. Выберите Workspace, проверьте данные и отдельно разрешите запись в Kernel.");
    } catch {
      try { window.sessionStorage.removeItem(D11_SAME_TAB_PREVIEW_KEY); } catch { /* storage unavailable */ }
      setMessage("Временная передача повреждена или истекла. Исходные данные и сохранённые Result не изменены.");
    }
  }, []);

  async function createWorkspace() {
    if (!canCreateWorkspace || !canFocusWorkspace || creatingWorkspace || focusSelecting || busy) return;
    setCreatingWorkspace(true);
    setMessage("");
    try {
      // T2's Workspace ID is an opaque ws-UUID, not a project name.
      // The user never needs to enter a technical ID or reveal project data.
      // A second click after an uncertain receipt MUST reuse the same ID.
      const id = pendingWorkspaceId.current ?? `ws-${crypto.randomUUID()}`;
      pendingWorkspaceId.current = id;
      const prior = await context.kernel.getWorkspace(id);
      let existed = false;
      if (prior) {
        if (prior.workspace_id !== id || prior.deleted_at || prior.profile !== "organization") {
          setMessage("Созданная ранее область недоступна или имеет другой профиль. Данные проекта сохранены в форме.");
          return;
        }
        existed = true;
      } else {
        try {
          await context.kernel.createWorkspace({ workspace_id: id, profile: "organization" });
        } catch {
          // The write may have committed. Read the SAME ID back through
          // Kernel, without fabricating success or generating another ID.
          const recovered = await context.kernel.getWorkspace(id);
          if (!recovered || recovered.workspace_id !== id || recovered.deleted_at ||
              recovered.profile !== "organization") {
            throw new Error("D11_WORKSPACE_CREATE_UNCONFIRMED");
          }
        }
      }
      const latest = await context.kernel.listWorkspaces();
      if (!latest.some(w => w.workspace_id === id && w.profile === "organization" && !w.deleted_at)) {
        throw new Error("D11_WORKSPACE_CREATE_READBACK_MISMATCH");
      }
      setWorkspaces(latest.filter(w => w.profile === "organization" && !w.deleted_at));
      if (context.commands.has("workspace.catalog.refresh")) {
        try {
          await context.commands.invoke("workspace.catalog.refresh", { reason: "d11-workspace-confirmed" });
        } catch { /* Not authority: the Kernel readback above is decisive. */ }
      }
      if (await selectWorkspace(id)) {
        pendingWorkspaceId.current = null;
        setMessage(existed
          ? "Ранее созданная область восстановлена и выбрана через T2 Host."
          : "Новая область создана и выбрана через T2 Host. Можно сохранить проект.");
      } else {
        setMessage("Область существует в Kernel, но фокус Host пока не подтверждён. Проверьте её в списке или повторите выбор.");
      }
    } catch {
      setMessage("Kernel не подтвердил создание. Исходные данные не очищены; повторная попытка проверит тот же идентификатор.");
    } finally {
      setCreatingWorkspace(false);
    }
  }

  async function selectWorkspace(id: string): Promise<boolean> {
    if (!id || focusRequest.current || busy || !canFocusWorkspace) {
      setMessage("Выберите доступную рабочую область в Host.");
      return false;
    }
    // A cached ID is not proof that the Host still focuses that Workspace.
    if (id === workspaceSelection.current) {
      const focused = context.currentWorkspace.get();
      if (focused?.workspace_id === id && focused.profile === "organization" && !focused.deleted_at) return true;
    }
    focusRequest.current = true;
    setFocusSelecting(true);
    try {
      // Base Workspace is the sole owner of currentWorkspace.claim().
      // Its registered command validates the requested Workspace in Kernel,
      // verifies the organization profile and publishes the new Host focus.
      const selected = await context.commands.invoke<{ workspace_id: string; profile: string }>(
        "workspace.focus.select", { workspace_id: id },
      );
      const focused = context.currentWorkspace.get();
      if (selected.workspace_id !== id || selected.profile !== "organization" ||
          focused?.workspace_id !== id || focused.profile !== "organization") {
        throw new Error("D11_FOCUS_NOT_CONFIRMED");
      }
      return true;
    } catch {
      setMessage("Не удалось выбрать рабочую область через Host. Проверьте доступ к ней и повторите выбор.");
      return false;
    } finally {
      focusRequest.current = false;
      setFocusSelecting(false);
    }
  }

  async function selectFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (!selected) { setMessage("Сначала выберите рабочую область."); return; }
    if (pendingCreate.current) { setMessage("Сначала проверьте прежнюю неопределённую запись. Новый файл не должен заменить её Object ID."); return; }
    if (file.size > MAX_FILE_BYTES) { setMessage("Файл превышает лимит D11. Текущий результат сохранён."); return; }
    const targetWorkspaceId = workspaceId;
    try {
      const contents = await file.text();
      if (new TextEncoder().encode(contents).byteLength > MAX_FILE_BYTES) throw new Error("size");
      const proposal = validateD11BrowserProposal(JSON.parse(contents) as unknown);
      if (targetWorkspaceId !== workspaceSelection.current) return;
      const json = JSON.stringify(proposal, null, 2);
      if (candidate && !window.confirm("Заменить неподтверждённый результат содержимым выбранного файла?")) return;
      // Even after editing or replacing the preview, keep the last Object ID
      // when an attempted write has an unknown receipt. Kernel readback/CAS
      // prevents creating a second Result for one ambiguous operation.
      if (pendingCreate.current?.workspaceId !== targetWorkspaceId) {
        pendingCreate.current = null;
      }
      setCandidate({ proposal, json });
      resumedEditor.current = null;
      setApproved(false);
      setOpened(null);
      setCorrectionOf(null);
      setMessage("Файл загружен на просмотр. Разрешение на запись требуется отдельно.");
    } catch { setMessage("Файл D11 повреждён или не соответствует контракту. Текущий результат сохранён."); }
  }

  function editCandidate(field: "title" | "markdown", value: string) {
    if (!candidate || busy) return;
    const proposal = { ...candidate.proposal, result: { ...candidate.proposal.result, [field]: value } };
    setCandidate({ proposal, json: JSON.stringify(proposal, null, 2) });
    // Editing invalidates the previous consent. Explicit new review is required.
    setApproved(false);
    setMessage("");
  }

  function resumeInTool() {
    if (!opened || busy || candidate) return;
    const url = d11CaseEditorPath(opened.proposal) ??
      EDITOR_PATHS[opened.proposal.producer.toolId];
    const state = editableSource(opened);
    if (!url || !state) {
      setResumeMessage("В этой редакции нет полных исходных данных инструмента. Текст результата доступен в Workspace.");
      return;
    }
    if (!window.confirm("Открыть сохранённые исходные данные в инструменте? Его текущий локальный черновик будет заменён. Запись в Kernel не выполняется.")) return;
    const editor = window.open(url, "_blank");
    if (!editor) {
      setResumeMessage("Браузер запретил открытие инструмента. Разрешите всплывающее окно и повторите действие.");
      return;
    }
    const origin = window.location.origin;
    const transferId = crypto.randomUUID();
    let finished = false;
    let readyReplies = 0;
    let closePoll: number | undefined;
    let timeoutId: number | undefined;
    const sourceRecord = opened;
    const sourceWorkspaceId = workspaceId;
    const packet = { protocol: RESUME_PROTOCOL, kind: "RESTORE", toolId: opened.proposal.producer.toolId, transferId, state };
    const cleanup = () => {
      window.removeEventListener("message", handle);
      window.clearInterval(closePoll);
      window.clearTimeout(timeoutId);
    };
    const handle = (event: MessageEvent<unknown>) => {
      if (finished || event.origin !== origin || event.source !== editor ||
        !event.data || typeof event.data !== "object") return;
      const response = event.data as Record<string, unknown>;
      if (response.protocol !== RESUME_PROTOCOL) return;
      if (response.kind === "READY" && response.toolId === packet.toolId) {
        // A stale editor must not trigger unlimited repeated transfers.
        if (++readyReplies > 3 || workspaceSelection.current !== sourceWorkspaceId) {
          finished = true;
          cleanup();
          setResumeMessage("Подтверждение редактора не получено. Объект Kernel не изменён; откройте инструмент заново.");
          return;
        }
        editor.postMessage(packet, origin);
      } else if (response.transferId === transferId &&
        (response.kind === "ACCEPTED" || response.kind === "REJECTED")) {
        finished = true;
        cleanup();
        if (response.kind === "ACCEPTED" &&
            workspaceSelection.current === sourceWorkspaceId) {
          resumedEditor.current = { window: editor, source: sourceRecord, workspaceId: sourceWorkspaceId };
          setResumeMessage("Исходные данные открыты в инструменте. Изменения останутся локальным черновиком до отдельного сохранения.");
        } else {
          setResumeMessage("Редактор не подтвердил восстановление в исходной рабочей области. Сохранённый результат не изменён.");
        }
      }
    };
    window.addEventListener("message", handle);
    closePoll = window.setInterval(() => {
      if (!finished && editor.closed) {
        finished = true;
        cleanup();
        setResumeMessage("Окно инструмента закрыто без подтверждения восстановления.");
      }
    }, 1500);
    timeoutId = window.setTimeout(() => {
      if (finished) return;
      finished = true;
      cleanup();
      setResumeMessage("Инструмент не подтвердил восстановление. Исходная редакция Kernel не изменена; откройте её снова.");
    }, 30000);
    setResumeMessage("Открываем исходные данные в инструменте…");
  }

  useEffect(() => {
    const receive = (event: MessageEvent<unknown>) => {
      const binding = resumedEditor.current;
      if (!binding || event.source !== binding.window || event.origin !== window.location.origin) return;
      let packet: ReturnType<typeof readD11HandoffPreview>;
      try { packet = readD11HandoffPreview(event.data); } catch { return; }
      const reply = (kind: "ACCEPTED" | "REJECTED") => binding.window.postMessage({
        protocol: D11_HANDOFF_PROTOCOL, kind, transferId: packet.transferId,
      }, window.location.origin);
      if (workspaceSelection.current !== binding.workspaceId || candidate || busy || !writable ||
        !opened || opened.object_id !== binding.source.object_id ||
        opened.revision !== binding.source.revision) { reply("REJECTED"); return; }
      try {
        const proposal = validateD11BrowserProposal(packet.proposal);
        if (proposal.producer.toolId !== binding.source.proposal.producer.toolId ||
            d11CaseLineage(proposal) !== d11CaseLineage(binding.source.proposal)) {
          reply("REJECTED"); return;
        }
        // Browsers can suppress synchronous dialogs in background windows.
        // Receiving a preview does not write to Kernel: stage it for the
        // existing visible review and explicit save-consent UI instead.
        // Keep the editor binding until Kernel confirms the new revision.
        // A preview ACK is not a save receipt. If the user cancels review,
        // this same editor can send a corrected preview to the same Result.
        pendingCreate.current = null;
        setCorrectionOf(binding.source);
        setCandidate({ proposal, json: JSON.stringify(proposal, null, 2) });
        setApproved(false);
        setMessage("Пересчитанный документ получен из инструмента. Проверьте изменения и отдельно разрешите сохранение новой редакции в Kernel.");
        reply("ACCEPTED");
      } catch { reply("REJECTED"); }
    };
    window.addEventListener("message", receive);
    return () => window.removeEventListener("message", receive);
  }, [candidate, busy, writable, opened]);

  function showInHost() {
    if (!opened || opened.workspace_id !== workspaceSelection.current || candidate || busy) return;
    // T2 owns its object route and ViewerRegistry; the URL contains only
    // opaque IDs, never proposal content or authority claims.
    context.router.navigate(hostRouteRefs.base.object, {
      workspaceId: opened.workspace_id, objectId: opened.object_id,
    });
  }

  function editOpened() {
    if (!opened || busy || !writable || opened.workspace_id !== workspaceId) return;
    // Editing the text in Workspace does not invalidate an already opened
    // source editor; it may send a replacement preview after the user cancels.
    pendingCreate.current = null;
    setCorrectionOf(opened);
    setCandidate({ proposal: opened.proposal, json: JSON.stringify(opened.proposal, null, 2) });
    setApproved(false);
    setMessage("Измените название или текст, проверьте новую редакцию и отдельно разрешите сохранение.");
  }

  async function save() {
    if (!canSave || !workspaceId || !spec || !candidate || !approved || busy) return;
    const targetWorkspaceId = workspaceId;
    recordsGeneration.current++; // Supersede a pending stale background list.
    setBusy(true); setMessage("");
    try {
      // Preserve one Object ID across every attempt and every uncertain
      // revision. The pending snapshot records the LAST attempted payload
      // and CAS base, not just the first revision.
      const pending = pendingCreate.current;
      if (!correctionOf && pending && pending.workspaceId !== targetWorkspaceId) {
        throw new Error("D11_PENDING_OTHER_WORKSPACE");
      }
      const newId = correctionOf ? undefined
        : pending?.workspaceId === targetWorkspaceId ? pending.id : "d11:" + crypto.randomUUID();
      let recoveredBase: D11StoredProposal | null = null;
      let recoveredExact: D11StoredProposal | null = null;
      if (!correctionOf && pending && pending.workspaceId === targetWorkspaceId) {
        const attemptedProposal = validateD11BrowserProposal(JSON.parse(pending.json) as unknown);
        const attemptedSpec = D11_COMMANDS.find((item) => item.toolId === attemptedProposal.producer.toolId);
        if (!attemptedSpec || attemptedSpec.schema !== spec.schema ||
            !context.commands.has(attemptedSpec.id.replace(".save-proposal", ".load-proposal"))) {
          throw new Error("D11_PENDING_WRITE_SCOPE_INVALID");
        }
        const stored = await context.commands.invoke<D11StoredProposal | null>(
          attemptedSpec.id.replace(".save-proposal", ".load-proposal"),
          { workspace_id: targetWorkspaceId, object_id: pending.id },
        );
        if (stored) {
          if (stored.workspace_id !== targetWorkspaceId || stored.object_id !== pending.id ||
              stored.schema_id !== attemptedSpec.schema ||
              (stored.revision !== pending.baseRevision &&
               stored.revision !== pending.baseRevision + 1)) {
            throw new Error("D11_PENDING_WRITE_CONFLICT");
          }
          if (stored.revision === pending.baseRevision + 1 &&
              JSON.stringify(stored.proposal) !== JSON.stringify(attemptedProposal)) {
            throw new Error("D11_PENDING_WRITE_CONFLICT");
          }
          if (JSON.stringify(stored.proposal) === JSON.stringify(candidate.proposal)) {
            // The exact desired document already exists. Never append an
            // identical revision just because its acknowledgement was lost.
            recoveredExact = stored;
          } else {
            // Either the previous write committed or its CAS base survived.
            // Both are safe bases for an explicit next edit, not blind writes.
            recoveredBase = stored;
          }
        } else if (pending.baseRevision !== 0) {
          throw new Error("D11_PENDING_WRITE_CONFLICT");
        }
      }
      const request = recoveredExact ? null : createD11WriteIntent({
        workspace_id: targetWorkspaceId, proposal: candidate.proposal,
        correction_of: correctionOf ?? recoveredBase, new_object_id: newId,
      });
      if (request && !correctionOf && newId) {
        // Update the journal BEFORE mutation so that a second lost receipt
        // can recover revision 2, 3, etc. with the same object ID.
        pendingCreate.current = {
          workspaceId: targetWorkspaceId, id: newId,
          json: candidate.json, baseRevision: request.base_revision,
        };
      }
      const { record: loaded, disposition } = recoveredExact
        ? { record: recoveredExact, disposition: "RECOVERED" as const }
        : await saveD11ProposalWithReadback(context.commands, request!);
      if (workspaceSelection.current !== targetWorkspaceId) return;
      pendingCreate.current = null;
      // Preserve the original editor/window binding and advance its
      // compare-and-swap base only after Kernel readback confirms the write.
      const linkedEditor = resumedEditor.current;
      if (linkedEditor && linkedEditor.workspaceId === targetWorkspaceId &&
          linkedEditor.source.object_id === loaded.object_id) {
        resumedEditor.current = { ...linkedEditor, source: loaded };
      }
      setOpened(loaded); setCandidate(null); setApproved(false); setCorrectionOf(null);
      setRecords((old) => [loaded, ...old.filter((record) => record.object_id !== loaded.object_id || record.workspace_id !== targetWorkspaceId)].sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
      setMessage(recoveredBase && disposition !== "RECOVERED"
        ? "Предыдущая запись проверена через Kernel. Новые правки сохранены следующей редакцией того же объекта."
        : disposition === "RECOVERED"
          ? "Ранее записанная редакция найдена и проверена. Повторная запись не выполнялась."
          : "Редакция сохранена и повторно прочитана из Kernel. Результат остаётся предварительным.");
    } catch (error) {
      if (workspaceSelection.current === targetWorkspaceId) {
        const reason = error instanceof Error ? error.message : "";
        if (reason.startsWith("D11_TRANSFER_")) {
          setMessage("Некорректное название, размер текста или данные предложения. Исправьте поля перед сохранением.");
        } else if (/PENDING_OTHER_WORKSPACE/.test(reason)) {
          setMessage("Есть неподтверждённая запись в другой Workspace. Вернитесь к ней и проверьте Object ID перед новым сохранением.");
        } else if (/PENDING_WRITE_SCOPE_INVALID|PENDING_WRITE_CONFLICT/.test(reason)) {
          setMessage("Предыдущая запись обнаружена, но её содержимое или редакция изменились. Новая запись не выполнялась. Откройте актуальный Result через Workspace.");
        } else if (/PENDING_WRITE_READ_UNAVAILABLE|SAVE_UNCERTAIN_READBACK_FAILED/.test(reason)) {
          setMessage("Проверить прежнюю запись через Kernel не удалось. Не создавайте другой объект; обновите Workspace и повторите чтение.");
        } else if (/REVISION_CONFLICT|PRIOR_REVISION_MISSING/.test(reason)) {
          setMessage("Объект был изменён или удалён после открытия. Сохранение остановлено; обновите список и откройте актуальную редакцию.");
        } else {
          setMessage("Сохранение не подтверждено. Повторная попытка использует прежний Object ID; можно также обновить список и проверить запись.");
        }
      }
    } finally { setBusy(false); }
  }

  async function checkPendingWrite() {
    const pending = pendingCreate.current;
    if (!pending || busy || !selected || pending.workspaceId !== workspaceId) {
      setMessage("Для проверки выберите исходную рабочую область незавершённой записи.");
      return;
    }
    const targetWorkspaceId = pending.workspaceId;
    setBusy(true);
    setMessage("");
    try {
      const attempted = validateD11BrowserProposal(JSON.parse(pending.json) as unknown);
      const attemptedSpec = D11_COMMANDS.find(item => item.toolId === attempted.producer.toolId);
      const loadId = attemptedSpec?.id.replace(".save-proposal", ".load-proposal");
      if (!attemptedSpec || !loadId || !context.commands.has(loadId))
        throw new Error("D11_PENDING_SCOPE_UNAVAILABLE");
      // This is a read-only inquiry through the existing scoped command.
      // Never repeat the write to learn whether it previously succeeded.
      const stored = await context.commands.invoke<D11StoredProposal | null>(loadId, {
        workspace_id: targetWorkspaceId, object_id: pending.id,
      });
      if (workspaceSelection.current !== targetWorkspaceId) return;
      if (stored && (stored.workspace_id !== targetWorkspaceId ||
          stored.object_id !== pending.id || stored.schema_id !== attemptedSpec.schema ||
          (stored.revision !== pending.baseRevision &&
           stored.revision !== pending.baseRevision + 1))) {
        throw new Error("D11_PENDING_CONFLICT");
      }
      if (!stored || stored.revision === pending.baseRevision) {
        // Kernel still contains the prior revision (or no object). Preserve
        // the original ID and intent so an explicitly consented retry is safe.
        setMessage("Предыдущая запись не найдена в новой редакции. Ничего не записывалось; можно повторить сохранение того же проекта.");
        return;
      }
      if (JSON.stringify(stored.proposal) !== JSON.stringify(attempted))
        throw new Error("D11_PENDING_CONFLICT");
      // Receipt was lost, but Kernel confirms the exact attempted revision.
      // A subsequently edited preview is retained as an explicit next edit.
      const hasNewEdits = !!candidate &&
        JSON.stringify(candidate.proposal) !== JSON.stringify(stored.proposal);
      pendingCreate.current = null;
      setOpened(stored);
      setRecords(old => [stored, ...old.filter(row =>
        row.workspace_id !== stored.workspace_id || row.object_id !== stored.object_id)]
        .sort((a,b) => b.updated_at.localeCompare(a.updated_at)));
      if (hasNewEdits) {
        setCorrectionOf(stored);
        setApproved(false);
        setMessage("Редакция подтверждена в Kernel. Ваши новые правки сохранены в форме; проверьте их и разрешите следующую редакцию.");
      } else {
        setCandidate(null);
        setCorrectionOf(null);
        setApproved(false);
        setMessage("Результат найден в Kernel: запись уже выполнена. Повторная запись не потребовалась.");
      }
    } catch {
      if (workspaceSelection.current === targetWorkspaceId)
        setMessage("Проверка записи не удалась либо обнаружен конфликт. Object ID и изменения сохранены; проверьте исходную Workspace.");
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!canList || busy) return;
    const generation = ++recordsGeneration.current;
    const targetWorkspaceId = workspaceId;
    setBusy(true); setMessage("");
    try {
      const available = D11_COMMANDS.filter((s) =>
        context.commands.has(s.id.replace(".save-proposal", ".list-proposals")));
      const pages = await Promise.all(available.map((s) => context.commands.invoke<readonly D11StoredProposal[]>(
        s.id.replace(".save-proposal", ".list-proposals"), { workspace_id: targetWorkspaceId },
      )));
      if (generation !== recordsGeneration.current || workspaceSelection.current !== targetWorkspaceId) return;
      const rows = pages.flat().filter((r) => r.workspace_id === targetWorkspaceId)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      setRecords(rows);
      setMessage("Показаны сохранённые предложения выбранной рабочей области.");
    } catch (error) {
      if (generation === recordsGeneration.current && workspaceSelection.current === targetWorkspaceId)
        setMessage(error instanceof Error && error.message.includes("D11_RESULT_FAMILY_LIST_LIMIT_REACHED")
          ? "Достигнут предел чтения 500 записей одного типа. Неполный список не показан; используйте штатную Workspace."
          : "Не удалось обновить список из Kernel. Последние полученные записи сохранены на экране.");
    }
    finally { setBusy(false); }
  }

  async function open(record: D11StoredProposal) {
    if (!selected || busy || record.workspace_id !== workspaceId) return;
    if (pendingCreate.current) {
      setMessage("Сначала проверьте результат незавершённой записи. Открытие другого проекта сейчас может потерять его Object ID.");
      return;
    }
    if (candidate && !window.confirm("Текущий неподтверждённый результат будет закрыт. Открыть другую запись?")) return;
    const targetWorkspaceId = workspaceId;
    const s = D11_COMMANDS.find((entry) => entry.schema === record.schema_id);
    if (!s || !context.commands.has(s.id.replace(".save-proposal", ".load-proposal"))) return;
    setBusy(true); setMessage("");
    try {
      const loaded = await context.commands.invoke<D11StoredProposal | null>(
        s.id.replace(".save-proposal", ".load-proposal"),
        { workspace_id: targetWorkspaceId, object_id: record.object_id },
      );
      if (!loaded || loaded.workspace_id !== targetWorkspaceId || loaded.object_id !== record.object_id ||
        loaded.schema_id !== record.schema_id) throw new Error("D11_READ_SCOPE_MISMATCH");
      if (workspaceSelection.current !== targetWorkspaceId) return;
      pendingCreate.current = null;
      setCandidate(null); setApproved(false); setCorrectionOf(null);
      setOpened(loaded);
      resumedEditor.current = null;
    } catch { setMessage("Объект не удалось повторно прочитать через Kernel. Текущий результат сохранён."); }
    finally { setBusy(false); }
  }

  return (
    <article data-d11-content data-testid="d11-workspace-proposals" className="space-y-3 rounded border border-slate-700 bg-slate-900/50 p-4 text-slate-100">
      <h3 className="text-lg font-semibold">Проектные материалы Advice Logistics</h3>
      <nav aria-label="Инструменты проектной лаборатории" className="flex flex-wrap gap-2 text-xs">
        <a href="/tools/" className="rounded border border-slate-600 px-3 py-2">Инструменты Лаборатории</a>
        <a href="/" className="rounded border border-slate-600 px-3 py-2">Корпоративный сайт</a>
      </nav>
      <p className="text-xs text-slate-300">Здесь можно сохранить, открыть и уточнить проектные материалы из инструментов Лаборатории. Данные остаются в вашем браузере; предварительный документ не считается утверждённым.</p>
      {workspaces.length === 0 && canBrowse && (
        <p role="status" className="text-sm text-amber-200">
          Нет доступных организационных областей. Создайте область ниже или обновите список.
        </p>
      )}
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Рабочая область</legend>
        <p className="text-xs text-slate-300">Выберите область кнопкой: переключение подтвердит штатный Host.</p>
        <div data-testid="d11-workspace-choices" className="grid gap-2 sm:grid-cols-2">
          {orderedWorkspaces.map((w, index) => {
            const active = workspaceId === w.workspace_id &&
              context.currentWorkspace.get()?.workspace_id === w.workspace_id;
            return <button key={w.workspace_id} type="button"
              data-testid="d11-workspace-choice"
              aria-pressed={active}
              disabled={busy || creatingWorkspace || focusSelecting || !canBrowse || !canFocusWorkspace}
              onClick={() => { void selectWorkspace(w.workspace_id); }}
              className={"min-h-11 rounded border p-3 text-left text-xs disabled:opacity-50 " +
                (active ? "border-blue-400 bg-slate-800 text-white" : "border-slate-600 bg-slate-950 text-slate-100")}>
              <span className="block font-medium">{workspaceLabel(w, index)}</span>
              <span className="block text-slate-300">{w.read_only ? "Только чтение" :
                active ? "Выбрана и подтверждена Host" : "Выбрать для работы"}</span>
            </button>;
          })}
        </div>
      </fieldset>
      {selectedWorkspace && <details className="text-xs text-slate-300">
        <summary className="cursor-pointer underline">Сведения о выбранной области</summary>
        <p>{workspaceLabel(selectedWorkspace, orderedWorkspaces.findIndex(w => w.workspace_id === selectedWorkspace.workspace_id))}</p>
        <p className="mt-1">Технический идентификатор: <code className="break-all">{selectedWorkspace.workspace_id}</code></p>
        <p>Профиль: организация{selectedWorkspace.read_only ? " · только чтение" : ""}</p>
      </details>}
      <button type="button" disabled={busy || !canBrowse} onClick={() => setRefreshToken((x) => x + 1)}
        className="rounded border border-slate-500 px-3 py-2 text-xs disabled:opacity-50">Обновить список областей</button>
      {canCreateWorkspace && <div className="space-y-2 rounded border border-slate-700 p-3">
        <p className="text-xs text-slate-300">
          Создайте отдельную локальную область для логистических проектов. Дата поможет отличать области; технический идентификатор останется в дополнительных сведениях.
        </p>
        <button type="button" data-testid="d11-create-workspace" onClick={() => void createWorkspace()}
          disabled={busy || creatingWorkspace || focusSelecting || !canFocusWorkspace}
          className="rounded bg-blue-700 px-3 py-2 text-sm disabled:opacity-50">
          {creatingWorkspace ? "Создаём…" : "Создать рабочую область"}
        </button>
      </div>}
      {!canBrowse && <p className="text-xs">Доступ к списку рабочих областей Kernel не предоставлен.</p>}
      {canBrowse && !canFocusWorkspace && <p role="status" className="text-xs text-amber-200">Команда выбора Workspace не предоставлена Host. Запись не выполняется до выбора области.</p>}
      {selectedWorkspace?.read_only && <p role="status" className="text-xs text-amber-200">Эта рабочая область доступна только для чтения. Создание и исправление предложений здесь недоступны.</p>}
      <p className="text-xs text-slate-300">Вы можете передать предварительный результат из инструмента на этом же сайте без файла; он появится ниже только для просмотра. Запись требует отдельного согласия.</p>
      <label className="block space-y-1 text-xs">Импорт предварительного результата (JSON)
        <input type="file" accept=".json,application/json" disabled={busy || !selected || !!pendingCreate.current}
          onChange={(e) => void selectFile(e)} className="block w-full text-xs" />
      </label>
      {returnToSourceRequired && <section aria-label="Исходная рабочая область результата"
        className="space-y-2 rounded border border-amber-500/60 p-3 text-xs">
        <p role="status">
          Этот результат связан с другой рабочей областью. Несохранённые изменения
          остались в форме, но запись в текущую область заблокирована.
        </p>
        {sourceWorkspace ? <button type="button" disabled={busy || focusSelecting}
          onClick={() => { void selectWorkspace(sourceWorkspace.workspace_id); }}
          className="rounded border border-amber-400 px-3 py-2 disabled:opacity-50">
          Вернуться в {workspaceLabel(sourceWorkspace, sourceWorkspaceIndex)}
        </button>
        : <p>Исходная область недоступна. Проверьте её через общую Workspace T2.</p>}
      </section>}
      {pendingCreate.current && <section aria-label="Проверка незавершённой записи"
        className="space-y-2 rounded border border-amber-500/60 p-3 text-xs">
        <p role="status">Ответ Kernel о предыдущем сохранении не подтверждён. Исходный Object ID сохранён. Сначала проверьте запись без повторной отправки.</p>
        <button type="button" disabled={busy || !selected || !pendingSameWorkspace}
          onClick={() => { void checkPendingWrite(); }}
          className="rounded border border-amber-400 px-3 py-2 disabled:opacity-50">
          Проверить сохранение в Kernel
        </button>
      </section>}
      {candidate && <section aria-label="Просмотр перед записью" className="space-y-2 rounded border border-amber-600/60 p-3 text-xs">
        <p><strong>Документ:</strong> {candidate.proposal.result.title}</p>
        <p className="text-slate-300">Проверьте текст документа и полные исходные данные до подтверждения сохранения.</p>
        <p><strong>Источник:</strong> {candidate.proposal.producer.toolId}</p>
        <p><strong>Операция:</strong> {correctionOf ? `Исправление объекта ${correctionOf.object_id}, редакция ${correctionOf.revision + 1}` : "Создание нового предложения"}</p>
        {correctionOf && <details><summary className="cursor-pointer underline">Посмотреть прежний текст</summary>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words bg-slate-950 p-2">{correctionOf.proposal.result.markdown}</pre>
        </details>}
        {correctionOf && !sameFamily && <p role="alert" className="text-amber-200">Нельзя исправить объект файлом другого инструмента. Выберите исходный сервис или отмените исправление.</p>}
        <label className="block space-y-1">Название предложения
          <input type="text" value={candidate.proposal.result.title} maxLength={240} disabled={busy}
            onChange={(e) => editCandidate("title", e.target.value)}
            className="w-full rounded border border-slate-600 bg-slate-950 p-2 text-sm text-slate-100" />
        </label>
        <label className="block space-y-1">Текст результата
          <textarea value={candidate.proposal.result.markdown} maxLength={D11_MAX_BYTES} disabled={busy}
            onChange={(e) => editCandidate("markdown", e.target.value)} rows={9}
            className="w-full resize-y rounded border border-slate-600 bg-slate-950 p-2 text-sm text-slate-100" />
        </label>
        <p className="text-slate-300">Текст и название можно уточнить здесь. Исходные данные расчёта не изменяются; для пересчёта используйте соответствующий инструмент сайта.</p>
        {correctionOf && !correctionChanged && <p role="status" className="text-amber-200">Измените текст или название, чтобы создать новую редакцию.</p>}
        <p>Предложение может содержать персональные и коммерческие сведения. Проверьте состав перед сохранением.</p>
        <details><summary className="cursor-pointer underline">Посмотреть все данные</summary>
          <pre className="max-h-52 overflow-auto whitespace-pre-wrap break-all bg-slate-950 p-2">{candidate.json}</pre>
        </details>
        <label className="flex gap-2"><input type="checkbox" checked={approved} onChange={(e) => setApproved(e.target.checked)} />
          Я просмотрел(а) данные и разрешаю их сохранить в выбранной рабочей области.
        </label>
        <button type="button" disabled={busy || !!pendingCreate.current} onClick={() => {
            if (!window.confirm("Закрыть неподтверждённый предпросмотр? Изменения этой формы не будут сохранены в Kernel.")) return;
            setCandidate(null);
            setCorrectionOf(null);
            setApproved(false);
            setMessage("Предпросмотр закрыт. Уже сохранённые редакции Kernel не изменены.");
          }}
          className="rounded border border-slate-500 px-3 py-2 text-white">
          {correctionOf ? "Отменить исправление" : "Отменить предпросмотр"}
        </button>
        <button type="button" data-testid="d11-save-proposal" disabled={!approved || !canSave || busy} onClick={() => void save()}
          className="rounded bg-blue-700 px-3 py-2 text-white disabled:opacity-50">{correctionOf ? "Сохранить исправленную редакцию" : "Создать предложение"}</button>
        {!canSave && <p>Сохранение недоступно: требуются разрешённые команды записи и чтения D11.</p>}
      </section>}
      <div className="flex flex-wrap gap-2">
        <a href="/workspace/exchange/" className="rounded border border-slate-500 px-3 py-2 text-xs">Экспорт и восстановление .iwxa</a>
        <a href="/workspace/#/workspaces" className="rounded border border-slate-500 px-3 py-2 text-xs">Рабочие области T2</a>
      </div>
      <button type="button" disabled={!canList || busy} onClick={() => void refresh()}
        className="rounded border border-slate-500 px-3 py-2 text-xs disabled:opacity-50">Показать сохранённые предложения</button>
      {message && <p role="status" className="text-xs">{message}</p>}
      {records.length > 0 && <ul className="max-h-52 space-y-1 overflow-auto">
        {records.map((r) => <li key={r.workspace_id + r.object_id}>
          <button type="button" disabled={busy || !!pendingCreate.current} onClick={() => void open(r)}
            className="w-full rounded border border-slate-700 p-2 text-left text-xs">
            <span className="block font-semibold">{r.proposal.result.title}</span>
             <span className="block text-slate-300">{TOOL_TITLES[r.proposal.producer.toolId] ?? "Проектное предложение"} · Редакция {r.revision} · {new Date(r.updated_at).toLocaleString("ru-RU")}</span>
          </button>
        </li>)}
      </ul>}
      {opened && <section aria-label="Прочитанный объект" data-testid="d11-opened-result"
        data-t2-workspace-id={opened.workspace_id} data-t2-object-id={opened.object_id}
        className="space-y-1 rounded border border-slate-700 p-3 text-xs">
        <p className="font-semibold">{opened.proposal.result.title}</p>
        <p>{TOOL_TITLES[opened.proposal.producer.toolId] ?? "Проектное предложение"} · Редакция {opened.revision} · Предварительный результат</p>
         <details><summary className="cursor-pointer underline">Технические сведения</summary><code className="break-all">{opened.object_id}</code></details>
        <button type="button" disabled={busy || !editableSource(opened) || !!candidate} onClick={resumeInTool}
          className="rounded border border-slate-500 px-3 py-2 text-xs disabled:opacity-50">Продолжить расчёт в инструменте</button>
        {resumeMessage && <p role="status">{resumeMessage}</p>}
        <button type="button" disabled={busy || !!candidate} onClick={showInHost}
          className="rounded border border-blue-500 px-3 py-2 text-xs disabled:opacity-50">Открыть в общей Workspace</button>
        <button type="button" disabled={busy || !writable} onClick={editOpened}
          className="rounded border border-slate-500 px-3 py-2 text-xs disabled:opacity-50">Редактировать результат</button>
        <section aria-label="История редакций" className="space-y-2 rounded border border-slate-700 p-3">
          <div className="flex items-center justify-between gap-2">
            <h4 className="font-semibold">История Result</h4>
            <button type="button" disabled={historyState === "loading"} onClick={() => setHistoryRefresh(x => x + 1)}
              className="rounded border border-slate-500 px-2 py-1 disabled:opacity-50">Обновить историю</button>
          </div>
          {historyState === "loading" && <p role="status">Читаем историю Kernel…</p>}
          {historyState === "error" && <p role="status">История сейчас недоступна. Объект не изменён.</p>}
          {historyState === "ready" && history.length === 0 && <p>События сохранения пока не найдены.</p>}
          {history.length > 0 && <ol className="max-h-44 space-y-1 overflow-auto">
            {history.map(event => <li key={event.event_id}>
              Редакция {event.revision ?? "?"} - {new Date(event.occurred_at).toLocaleString("ru-RU")}
            </li>)}
          </ol>}
        </section>
        <details open><summary className="cursor-pointer underline">Просмотреть результат</summary>
          <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words bg-slate-950 p-2">{opened.proposal.result.markdown}</pre>
        </details>
      </section>}
    </article>
  );
}
export default D11WorkspaceCard;
