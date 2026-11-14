import { useCallback, useEffect, useRef, useState } from "react";
import { markD11ResumedEditor, clearD11ResumedEditor } from "./workspace-discovery";

const RESUME_PROTOCOL = "ru.iwxa.advice-logistics.resume/1";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCERS: Record<string, string> = {
  "as-is-to-be": "as-is-to-be-process",
  "proc-data-sys-role": "process-data-system-role-matrix",
  "automation-readiness": "automation-readiness",
  "func-requirements-logistics-it-v3": "functional-requirements-logistics-it",
  "tor-logistics-automation-v2": "logistics-automation-terms-of-reference",
  "project-brief-generator": "project-brief-generator",
  "delivery-network-planner": "delivery-network-planner",
  "distribution-network-expansion": "delivery-network-planner",
  "cold-chain-control": "delivery-network-planner",
  "inbound-yard-crossdock": "delivery-network-planner",
};
const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Reject damaged nested editor fields rather than crashing calculators after restore. */
function compatible(value: unknown, shape: unknown, depth = 0): boolean {
  if (depth > 48) return false;
  if (Array.isArray(shape)) {
    if (!Array.isArray(value) || value.length > 2000) return false;
    // Empty rows are legitimately populated by users; inspect JSON safety below.
    return value.every((entry) => jsonSafe(entry, depth + 1));
  }
  if (shape !== null && typeof shape === "object") {
    if (!isRecord(value)) return false;
    const fields = shape as Record<string, unknown>;
    return Object.keys(value).length === Object.keys(fields).length &&
      Object.keys(fields).every((key) =>
        Object.prototype.hasOwnProperty.call(value, key) &&
        compatible(value[key], fields[key], depth + 1));
  }
  return typeof value === typeof shape && (typeof value !== "number" || Number.isFinite(value));
}
function jsonSafe(value: unknown, depth: number): boolean {
  if (depth > 48) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.length <= 2000 && value.every((x) => jsonSafe(x, depth + 1));
  return isRecord(value) && Object.keys(value).length <= 300 &&
    Object.keys(value).every((key) => key !== "__proto__" && key !== "constructor" &&
      key !== "prototype" && jsonSafe(value[key], depth + 1));
}
/** Restore only editable form fields, excluding calculated metadata and privileges. */
function editableState<T extends object>(value: unknown, initial: T, maxBytes = 1024 * 1024): T | null {
  if (!isRecord(value) || !compatible(value, initial)) return null;
  try {
    const encoded = JSON.stringify(value);
    if (new TextEncoder().encode(encoded).byteLength > maxBytes) return null;
    return JSON.parse(encoded) as T;
  } catch { return null; }
}

/** User-entered drafts live here; their authoritative saved source remains in the T2 Kernel. */
export function useToolDraft<T extends object>(toolId: string, initial: T) {
  const key = `advlog:tool:${toolId}`;
  const maxBytes = ["delivery-network-planner","distribution-network-expansion","cold-chain-control","inbound-yard-crossdock"].includes(toolId)
    ? 3 * 1024 * 1024 : 1024 * 1024;
  const [state, setState] = useState<T>(initial);
  const [draftReady, setDraftReady] = useState(false);
  const restoredTransfer = useRef<string | null>(null);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw) as unknown;
        const restored = editableState(parsed, initial, maxBytes);
        if (restored) setState(restored);
      }
    } catch {
      // The user can continue without a local browser draft.
    }
    setDraftReady(true);
  }, [initial, key, maxBytes]);

  useEffect(() => {
    if (!draftReady) return;
    try {
      window.localStorage.setItem(key, JSON.stringify(state));
    } catch {
      // The tool remains usable even if the browser rejects local draft storage.
    }
  }, [state, key, draftReady]);

  useEffect(() => {
    if (!draftReady) return;
    const producer = PRODUCERS[toolId];
    const opener = window.opener;
    if (!producer || !opener || opener === window) return;
    const origin = window.location.origin;
    const receive = (event: MessageEvent<unknown>) => {
      if (event.origin !== origin || event.source !== opener || !isRecord(event.data)) return;
      const packet = event.data;
      if (packet.protocol !== RESUME_PROTOCOL || packet.kind !== "RESTORE" ||
          packet.toolId !== producer || typeof packet.transferId !== "string" ||
          !UUID.test(packet.transferId) || Object.keys(packet).length !== 5) return;
      if (restoredTransfer.current === packet.transferId) {
        opener.postMessage({ protocol: RESUME_PROTOCOL, kind: "ACCEPTED", transferId: packet.transferId }, origin);
        return;
      }
      if (restoredTransfer.current !== null) return;
      const restored = editableState(packet.state, initial, maxBytes);
      if (!restored) {
        opener.postMessage({ protocol: RESUME_PROTOCOL, kind: "REJECTED", transferId: packet.transferId }, origin);
        return;
      }
      try {
        // The opening Workspace asked for explicit confirmation before opening this editor.
        // Replace the local draft, never write anything back to Kernel automatically.
        window.localStorage.setItem(key, JSON.stringify(restored));
        restoredTransfer.current = packet.transferId;
        markD11ResumedEditor(producer);
        setState(restored);
        opener.postMessage({ protocol: RESUME_PROTOCOL, kind: "ACCEPTED", transferId: packet.transferId }, origin);
      } catch {
        opener.postMessage({ protocol: RESUME_PROTOCOL, kind: "REJECTED", transferId: packet.transferId }, origin);
      }
    };
    window.addEventListener("message", receive);
    opener.postMessage({ protocol: RESUME_PROTOCOL, kind: "READY", toolId: producer }, origin);
    return () => window.removeEventListener("message", receive);
  }, [draftReady, initial, key, toolId, maxBytes]);

  const clearDraft = useCallback(() => {
    clearD11ResumedEditor();
    try {
      window.localStorage.removeItem(key);
    } catch {
      // Ignore unavailable browser storage.
    }
    setState(initial);
  }, [key, initial]);

  return { state, setState, clearDraft };
}
