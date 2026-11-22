/** Read-only display of evidence already verified by the existing Graph Core.
 * A manually selected model is not a K02 recommendation; neither label grants
 * authority or changes the active model/provider.
 */
type Row = Record<string, unknown>;
type Translate = (ru: string, en: string) => string;
const row = (value: unknown): Row =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
const str = (value: unknown): string => typeof value === 'string' ? value : '';
const digest = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

export type GraphModelProvenance = {
  selection: string;
  actualModel: string;
  tokenUsage: string;
  observedLatency: string;
  planRef: string;
};

export function graphModelProvenance(value: unknown, tr: Translate): GraphModelProvenance | null {
  const output = row(value);
  if (output.node_type !== 'MODEL_INVOCATION') return null;
  const mode = str(output.selection_mode);
  const k02 = output.k02_plan_digest, k04 = output.k04_plan_digest;
  const attested = digest(k02) && digest(k04);
  let selection: string;
  if (attested && mode === 'K02_RECOMMENDED') {
    selection = tr('Модель рекомендована K02/K04 и проверена Core', 'K02/K04 recommended model, verified by Core');
  } else if (attested && mode === 'MANUAL_PIN') {
    selection = tr('Выбор модели изменён человеком; привязка проверена Core',
      'Model overridden by the user; binding verified by Core');
  } else {
    selection = tr('Обычный выбор модели Graph (без подтверждённой рекомендации K02)',
      'Graph model selection (no verified K02 recommendation)');
  }
  const model = str(output.model).slice(0, 180);
  const provider = str(output.provider_id).slice(0, 120);
  const actualModel = model && provider ? `${model} · ${provider}` : model || provider;
  const usage = row(output.observed_usage);
  const input = count(usage.input_tokens), outputTokens = count(usage.output_tokens);
  const tokenUsage = input === null && outputTokens === null ? '' :
    tr('Фактические токены', 'Observed tokens') + ': ' +
    [input === null ? '' : tr('вход', 'input') + ' ' + input,
     outputTokens === null ? '' : tr('выход', 'output') + ' ' + outputTokens]
      .filter(Boolean).join(' · ');
  const latency = count(output.observed_latency_ms);
  const observedLatency = latency === null ? '' :
    tr('Измеренная задержка вызова модели', 'Observed model invocation latency') + ': ' + latency + ' ms';
  return { selection, actualModel, tokenUsage, observedLatency,
    planRef: attested && (mode === 'K02_RECOMMENDED' || mode === 'MANUAL_PIN')
      ? `K02 ${k02.slice(0, 12)} · K04 ${k04.slice(0, 12)}` : '' };
}
