/** Semantic, text-only D11 Proposal rendering in the normative Host ViewerRegistry.
 * React escapes every user-supplied value; arbitrary HTML is never executed.
 * The Host owns the separate raw-data view and its read permissions.
 */
import type { ReactNode } from "react";
import type { ViewerProps } from "@/workspace-contract";
import { validateD11BrowserProposal } from "./d11-transfer";
import { d11CaseEditorPath } from "./editor-source-path";

const TOOL_NAMES: Record<string, string> = {
  "as-is-to-be-process": "Процесс AS-IS / TO-BE",
  "process-data-system-role-matrix": "Матрица процессов, данных, систем и ролей",
  "automation-readiness": "Оценка готовности к автоматизации",
  "functional-requirements-logistics-it": "Функциональные требования",
  "logistics-automation-terms-of-reference": "Техническое задание",
  "project-brief-generator": "Проектный бриф",
  "delivery-network-planner": "Инженерная модель региональной доставки",
};

function inline(value: string): ReactNode[] {
  // Render the bold labels emitted by the public tools as semantic text,
  // without interpreting links, embedded HTML, attributes or scripts.
  return value.split(/(\*\*[^*\n]+\*\*)/g).map((part, index) =>
    part.startsWith("**") && part.endsWith("**") && part.length > 4
      ? <strong key={index} className="font-semibold text-slate-100">{part.slice(2, -2)}</strong>
      : part,
  );
}

function tableCells(line: string): string[] {
  const source = line.trim();
  return source.replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function separator(line: string): boolean {
  const parts = tableCells(line);
  return parts.length > 0 && parts.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function documentBlocks(source: string): ReactNode[] {
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;

  while (index < lines.length) {
    const row = lines[index] ?? "";
    const trimmed = row.trim();
    if (!trimmed) { index++; continue; }
    const key = index;

    if (/^```/.test(trimmed)) {
      index++;
      const chunk: string[] = [];
      while (index < lines.length && !/^```/.test((lines[index] ?? "").trim())) {
        chunk.push(lines[index] ?? "");
        index++;
      }
      if (index < lines.length) index++;
      blocks.push(<pre key={key} className="overflow-x-auto rounded border border-slate-700 p-3 text-xs whitespace-pre-wrap break-words">{chunk.join("\n")}</pre>);
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      const text = inline(heading[2]);
      const cls = heading[1].length <= 2
        ? "text-base font-semibold text-slate-100 pt-4"
        : "text-sm font-semibold text-slate-200 pt-2";
      blocks.push(<h4 key={key} className={cls}>{text}</h4>);
      index++;
      continue;
    }

    if (trimmed.startsWith("|") && index + 1 < lines.length &&
        (lines[index + 1] ?? "").trim().startsWith("|") &&
        separator(lines[index + 1] ?? "")) {
      const headers = tableCells(trimmed);
      index += 2;
      const rows: string[][] = [];
      while (index < lines.length && (lines[index] ?? "").trim().startsWith("|")) {
        rows.push(tableCells(lines[index] ?? ""));
        index++;
      }
      blocks.push(
        <div key={key} className="max-w-full overflow-x-auto rounded border border-slate-700">
          <table className="w-full min-w-max border-collapse text-left text-xs">
            <thead className="bg-slate-800/80"><tr>{headers.map((cell, col) =>
              <th key={col} scope="col" className="border-b border-slate-700 px-3 py-2 font-semibold">{inline(cell)}</th>,
            )}</tr></thead>
            <tbody>{rows.map((cells, rowIndex) =>
              <tr key={rowIndex} className="border-b border-slate-800 align-top">
                {headers.map((_, col) => <td key={col} className="max-w-96 px-3 py-2 whitespace-pre-wrap break-words">
                  {inline(cells[col] ?? "")}
                </td>)}
              </tr>,
            )}</tbody>
          </table>
        </div>,
      );
      continue;
    }

    if (/^[-*]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
      const ordered = /^\d+[.)]\s+/.test(trimmed);
      const values: string[] = [];
      const bullet = ordered ? /^\d+[.)]\s+/ : /^[-*]\s+/;
      while (index < lines.length && bullet.test((lines[index] ?? "").trim())) {
        values.push((lines[index] ?? "").trim().replace(bullet, ""));
        index++;
      }
      const list = values.map((value, n) =>
        <li key={n} className="mb-1 pl-1">{inline(value)}</li>,
      );
      blocks.push(ordered
        ? <ol key={key} className="ml-5 list-decimal space-y-1">{list}</ol>
        : <ul key={key} className="ml-5 list-disc space-y-1">{list}</ul>);
      continue;
    }

    const paragraph = [row];
    index++;
    while (index < lines.length && (lines[index] ?? "").trim() !== "" &&
           !/^(#{1,4}\s+|[-*]\s+|\d+[.)]\s+|\|)/.test((lines[index] ?? "").trim())) {
      paragraph.push(lines[index] ?? "");
      index++;
    }
    blocks.push(<p key={key} className="whitespace-pre-wrap break-words leading-relaxed">{inline(paragraph.join("\n"))}</p>);
  }
  return blocks;
}

export default function D11ProposalViewer({ data, mode = "detail" }: ViewerProps) {
  let proposal;
  try {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("D11_ENVELOPE_MISSING");
    const record = data as Record<string, unknown>;
    if (record.phase !== "PROPOSAL_ONLY" || record.acceptance !== "NOT_REQUESTED") {
      throw new Error("D11_AUTHORITY_MISMATCH");
    }
    proposal = validateD11BrowserProposal(record.payload);
  } catch {
    return <p role="status" className="text-sm">
      Предметное представление недоступно. Исходную структуру можно открыть в штатном просмотрщике T2.
    </p>;
  }

  const { producer, result } = proposal;
  const editorPath = d11CaseEditorPath(proposal) ?? "/tools/" + producer.toolId;
  const preview = mode === "preview";
  const markdown = result.markdown;
  const blocks = preview ? [] : documentBlocks(markdown);
  return <article data-d11-content data-testid="d11-proposal-viewer" className="space-y-4 text-sm text-slate-200">
    <header className="space-y-2">
      <p className="text-xs font-medium text-slate-400">{TOOL_NAMES[producer.toolId] ?? "Проектное предложение"}</p>
      <h3 className="text-lg font-semibold text-slate-100">{result.title}</h3>
      <p className="text-xs text-slate-400">Рабочее предложение — не утверждено организацией</p>
      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-slate-300">
        {result.completeness !== null && <><dt>Полнота</dt><dd>{result.completeness}%</dd></>}
        {result.stage && <><dt>Этап</dt><dd>{result.stage}</dd></>}
      </dl>
    </header>
    {preview
      ? <p className="line-clamp-6 whitespace-pre-wrap break-words leading-relaxed">
          {markdown.slice(0, 650)}{markdown.length > 650 ? "…" : ""}
        </p>
      : <section aria-label="Содержание проектного документа"
          className="max-h-[65vh] space-y-3 overflow-y-auto overflow-x-hidden rounded border border-slate-700 p-3 sm:p-4">
          {blocks.length ? blocks : <p>Текст документа не заполнен.</p>}
        </section>}
    {!preview && <nav aria-label="Дальнейшая работа с предложением" className="flex flex-wrap gap-3 text-xs">
      <a className="underline hover:text-white" href="/workspace/#/domain">Открыть управление проектами</a>
      <a className="underline hover:text-white" href={editorPath}>Перейти в инструмент (локальный черновик)</a>
    </nav>}
  </article>;
}
