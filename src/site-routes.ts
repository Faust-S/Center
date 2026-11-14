/**
 * Единый источник публичных HTML-маршрутов сайта.
 * Используется одновременно для:
 *   1. sitemap.xml
 *   2. prerender (static export)
 *   3. links check
 *   4. hydration check
 *   5. runtime check
 *   6. canonical / og:url
 *
 * Все URL - со слешем на конце, потому что static export
 * сохраняет каждую страницу как `<route>/index.html`.
 */
export const SITE_URL = (
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_SITE_URL ??
  "https://advice-logistics.ru"
).replace(/\/+$/, "");

export const siteRoutes = [
  "/",
  "/napravleniya/",
  "/logisticheskij-konsalting/",
  "/strategicheskoe-i-operacionnoe-konsultirovanie/",
  "/optimizaciya-sistemy-upravleniya-biznesom/",
  "/nauchno-issledovatelskie-raboty/",
  "/niokr-v-oblasti-transporta-logistiki/",
  "/proektnye-formaty/",
  "/metodika/",
  "/primery-realizovannyh-proektov/",
  "/o-nas/",
  "/kontakty/",
  "/politika-personalnyh-dannyh/",
  "/glossariy/",
  "/insights/",
  "/tools/",
  "/tools/functional-requirements-logistics-it/",
  "/tools/as-is-to-be-process/",
  "/tools/process-data-system-role-matrix/",
  "/tools/logistics-automation-terms-of-reference/",
  "/tools/automation-readiness/",
  "/tools/project-brief-generator/",
  "/tools/delivery-network-planner/",
  "/tools/depot-maintenance-supply/",
  "/tools/distribution-network-expansion/",
  "/tools/cold-chain-control/",
  "/tools/inbound-yard-crossdock/",
] as const;

export type SiteRoute = (typeof siteRoutes)[number];

/** Маршрут с trailing slash. `/` остаётся `/`. */
export function withTrailingSlash(p: string): string {
  if (!p) return "/";
  if (p === "/") return "/";
  return p.endsWith("/") ? p : `${p}/`;
}

/** Canonical URL для страницы. */
export function canonicalFor(route: string): string {
  return `${SITE_URL}${withTrailingSlash(route)}`;
}
