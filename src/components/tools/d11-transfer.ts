/** D11 public-browser proposal exchange. Not a portable .iwxa package or a T2 Result. */
export const D11_TRANSFER_SCHEMA = "ru.iwxa.advice-logistics.browser-proposal/1" as const;
export const D11_MAX_BYTES = 1024 * 1024;

export const D11_TOOLS = [
  { id: "as-is-to-be-process", publicId: "as-is-to-be", resultKind: "process-as-is-to-be" },
  { id: "process-data-system-role-matrix", publicId: "proc-data-sys-role", resultKind: "process-data-system-role-matrix" },
  { id: "automation-readiness", publicId: "automation-readiness", resultKind: "automation-readiness-assessment" },
  { id: "functional-requirements-logistics-it", publicId: "functional-requirements-logistics-it", resultKind: "functional-requirements-draft" },
  { id: "logistics-automation-terms-of-reference", publicId: "tor-logistics-automation", resultKind: "terms-of-reference-draft" },
  { id: "project-brief-generator", publicId: "project-brief-generator", resultKind: "project-brief-draft" },
  { id: "delivery-network-planner", publicId: "delivery-network-planner", resultKind: "delivery-network-scenario" },
] as const;

export type D11ToolId = (typeof D11_TOOLS)[number]["id"];
export type D11PublicId = (typeof D11_TOOLS)[number]["publicId"];

export interface BrowserProposalInput {
  toolId: string;
  toolTitle: string;
  markdown: string;
  data: unknown;
  completeness?: number;
  stage?: string;
}

export interface D11BrowserProposal {
  schema: typeof D11_TRANSFER_SCHEMA;
  domainId: "D11";
  producer: { toolId: D11ToolId; publicToolId: D11PublicId; resultKind: string; source: "advice-logistics.ru" };
  provenance: {
    createdAt: string;
    inputEvidence: "USER_ENTERED_NOT_INDEPENDENTLY_VERIFIED";
    execution: "BROWSER_LOCAL";
    resultMethod: "SITE_CURRENT_CALCULATION";
  };
  result: {
    state: "PROPOSAL_ONLY";
    title: string;
    markdown: string;
    data: unknown;
    completeness: number | null;
    stage: string | null;
  };
  authority: { accepted: false; decision: "NOT_REQUESTED"; approver: null };
  disclosure: { transfer: "EXPLICIT_LOCAL_FILE_EXPORT"; publicProjection: false; automaticUpload: false };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(code: string): never { throw new Error("D11_TRANSFER_" + code); }

/** Reject JSON coercions that would silently alter a user's calculation or omit fields. */
function safeData(value: unknown): unknown {
  if (!record(value)) fail("DATA_OBJECT_REQUIRED");
  const active = new WeakSet<object>();
  const inspect = (v: unknown, depth: number): void => {
    if (depth > 64) fail("DATA_TOO_DEEP");
    if (v === null || typeof v === "string" || typeof v === "boolean") return;
    if (typeof v === "number") {
      if (!Number.isFinite(v) || Object.is(v, -0)) fail("DATA_NUMBER_LOSS");
      return;
    }
    if (typeof v !== "object") fail("DATA_UNSERIALIZABLE");
    if (active.has(v)) fail("DATA_CYCLE");
    active.add(v);
    if (Array.isArray(v)) {
      for (let i = 0; i < v.length; i++) {
        if (!Object.prototype.hasOwnProperty.call(v, i)) fail("DATA_SPARSE_ARRAY");
        inspect(v[i], depth + 1);
      }
      for (const key of Reflect.ownKeys(v)) {
        if (key === "length") continue;
        if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || Number(key) >= v.length) fail("DATA_EXTRA_PROPERTY");
      }
    } else {
      const prototype = Object.getPrototypeOf(v);
      if (prototype !== Object.prototype && prototype !== null) fail("DATA_NON_PLAIN_OBJECT");
      for (const key of Reflect.ownKeys(v)) {
        if (typeof key !== "string") fail("DATA_EXTRA_PROPERTY");
        const descriptor = Object.getOwnPropertyDescriptor(v, key);
        if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) fail("DATA_ACCESSOR_OR_HIDDEN_FIELD");
        inspect(descriptor.value, depth + 1);
      }
    }
    active.delete(v);
  };
  inspect(value, 0);
  let encoded: string;
  try { encoded = JSON.stringify(value); } catch { return fail("DATA_NOT_JSON"); }
  if (!encoded || new TextEncoder().encode(encoded).byteLength > D11_MAX_BYTES) fail("DATA_TOO_LARGE");
  return JSON.parse(encoded) as unknown;
}

export function resolveD11Tool(id: string): (typeof D11_TOOLS)[number] {
  const found = D11_TOOLS.find((tool) => tool.publicId === id || tool.id === id);
  if (!found) fail("UNKNOWN_TOOL");
  return found!;
}

export function buildD11BrowserProposal(
  input: BrowserProposalInput,
  createdAt: string,
): D11BrowserProposal {
  if (!record(input)) fail("INPUT_REQUIRED");
  const tool = resolveD11Tool(input.toolId);
  if (typeof input.toolTitle !== "string" || input.toolTitle.trim().length < 2 || input.toolTitle.length > 240) fail("TITLE_INVALID");
  if (typeof input.markdown !== "string" || input.markdown.length > D11_MAX_BYTES) fail("MARKDOWN_INVALID");
  if (typeof createdAt !== "string" || !Number.isFinite(Date.parse(createdAt)) || new Date(createdAt).toISOString() !== createdAt) fail("TIME_INVALID");
  if (input.completeness !== undefined && (!Number.isFinite(input.completeness) || input.completeness < 0 || input.completeness > 100)) fail("COMPLETENESS_INVALID");
  if (input.stage !== undefined && (typeof input.stage !== "string" || input.stage.length > 120)) fail("STAGE_INVALID");
  const proposal: D11BrowserProposal = {
    schema: D11_TRANSFER_SCHEMA,
    domainId: "D11",
    producer: { toolId: tool.id, publicToolId: tool.publicId, resultKind: tool.resultKind, source: "advice-logistics.ru" },
    provenance: { createdAt, inputEvidence: "USER_ENTERED_NOT_INDEPENDENTLY_VERIFIED", execution: "BROWSER_LOCAL", resultMethod: "SITE_CURRENT_CALCULATION" },
    result: {
      state: "PROPOSAL_ONLY",
      title: input.toolTitle.trim(),
      markdown: input.markdown,
      data: safeData(input.data),
      completeness: input.completeness ?? null,
      stage: input.stage ?? null,
    },
    authority: { accepted: false, decision: "NOT_REQUESTED", approver: null },
    disclosure: { transfer: "EXPLICIT_LOCAL_FILE_EXPORT", publicProjection: false, automaticUpload: false },
  };
  if (new TextEncoder().encode(JSON.stringify(proposal)).byteLength > D11_MAX_BYTES) fail("PACKAGE_TOO_LARGE");
  return proposal;
}

/** Reject noncanonical exchange files rather than silently stripping user data. */
function exactJsonShape(actual: unknown, canonical: unknown, depth = 0): boolean {
  if (depth > 80) return false;
  if (Object.is(actual, canonical)) return true;
  if (actual === null || canonical === null ||
    typeof actual !== "object" || typeof canonical !== "object" ||
    Array.isArray(actual) !== Array.isArray(canonical)) return false;
  const actualPrototype = Object.getPrototypeOf(actual);
  if (actualPrototype !== Object.prototype && actualPrototype !== null &&
    !(Array.isArray(actual) && actualPrototype === Array.prototype)) return false;
  const actualKeys = Reflect.ownKeys(actual);
  const canonicalKeys = Reflect.ownKeys(canonical);
  if (actualKeys.length !== canonicalKeys.length) return false;
  for (const key of actualKeys) {
    if (typeof key !== "string" || !Object.prototype.hasOwnProperty.call(canonical, key)) return false;
    const descriptor = Object.getOwnPropertyDescriptor(actual, key);
    if (!descriptor || !("value" in descriptor) || (!descriptor.enumerable && key !== "length")) return false;
    if (!exactJsonShape(descriptor.value, (canonical as Record<string, unknown>)[key], depth + 1)) return false;
  }
  return true;
}

/** Strict intake: never trust external JSON as an approved Result or authority grant. */
export function validateD11BrowserProposal(candidate: unknown): D11BrowserProposal {
  if (!record(candidate) || candidate.schema !== D11_TRANSFER_SCHEMA || candidate.domainId !== "D11") fail("SCHEMA_MISMATCH");
  if (!record(candidate.producer) || typeof candidate.producer.toolId !== "string") fail("PRODUCER_INVALID");
  const tool = resolveD11Tool(candidate.producer.toolId);
  if (candidate.producer.publicToolId !== tool.publicId || candidate.producer.resultKind !== tool.resultKind || candidate.producer.source !== "advice-logistics.ru") fail("PRODUCER_MISMATCH");
  if (!record(candidate.provenance) || candidate.provenance.inputEvidence !== "USER_ENTERED_NOT_INDEPENDENTLY_VERIFIED" || candidate.provenance.execution !== "BROWSER_LOCAL" || candidate.provenance.resultMethod !== "SITE_CURRENT_CALCULATION") fail("PROVENANCE_INVALID");
  if (typeof candidate.provenance.createdAt !== "string" || !Number.isFinite(Date.parse(candidate.provenance.createdAt))) fail("PROVENANCE_TIME_INVALID");
  if (!record(candidate.result) || candidate.result.state !== "PROPOSAL_ONLY" || typeof candidate.result.title !== "string" || typeof candidate.result.markdown !== "string") fail("RESULT_INVALID");
  if (!record(candidate.authority) || candidate.authority.accepted !== false || candidate.authority.decision !== "NOT_REQUESTED" || candidate.authority.approver !== null) fail("ACCEPTANCE_FORBIDDEN");
  if (!record(candidate.disclosure) || candidate.disclosure.transfer !== "EXPLICIT_LOCAL_FILE_EXPORT" || candidate.disclosure.publicProjection !== false || candidate.disclosure.automaticUpload !== false) fail("DISCLOSURE_INVALID");
  // Rebuild canonical data and reject any structural or value loss on import.
  const checked = buildD11BrowserProposal({
    toolId: tool.id, toolTitle: candidate.result.title, markdown: candidate.result.markdown,
    data: candidate.result.data,
    ...(candidate.result.completeness === null ? {} : { completeness: candidate.result.completeness as number }),
    ...(candidate.result.stage === null ? {} : { stage: candidate.result.stage as string }),
  }, candidate.provenance.createdAt);
  if (!exactJsonShape(candidate, checked)) fail("NONCANONICAL_PAYLOAD");
  return checked;
}

export function serializeD11BrowserProposal(proposal: D11BrowserProposal): string {
  const verified = validateD11BrowserProposal(proposal);
  const readable = JSON.stringify(verified, null, 2);
  // Large verified engineering data may exceed the one-megabyte handoff
  // if indentation is included. Keep the complete JSON without dropping fields.
  if (new TextEncoder().encode(readable).byteLength <= D11_MAX_BYTES) return readable;
  return JSON.stringify(verified);
}
