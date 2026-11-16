// SPEC-003 BR-003-06: the p95 the budgets are stated in, and the per-page summary of a
// Lighthouse CI run. Pure, so perf/stats.test.ts drives it with fabricated reports.

/**
 * The nearest-rank percentile: the smallest value that at least `p` percent of the values are
 * at or below. Over 20 runs, p95 is the 19th sorted value.
 * @param {number[]} values
 * @param {number} p 0 < p <= 100
 * @returns {number}
 */
export function percentile(values, p) {
  if (values.length === 0) throw new Error('percentile of no values');
  if (!(p > 0 && p <= 100)) throw new Error('p must be in (0, 100]');
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(1, Math.ceil((p / 100) * sorted.length)) - 1];
}

/** The audits summarised per page, in report order. `main` ones carry the budget. */
export const SUMMARY_METRICS = [
  { id: 'largest-contentful-paint', label: 'LCP', main: true },
  { id: 'interactive', label: 'TTI', main: true },
  { id: 'total-blocking-time', label: 'TBT', main: false },
  { id: 'first-contentful-paint', label: 'FCP', main: false },
];

/**
 * Per URL and metric: the runs, p50, p95 and worst, in milliseconds.
 * @param {Array<{ requestedUrl?: string, finalUrl?: string, audits: Record<string, { numericValue?: number }> }>} reports
 * @returns {Array<{ url: string, runs: number, metrics: Record<string, { p50: number, p95: number, max: number }> }>}
 */
export function summarizeReports(reports) {
  const byUrl = new Map();
  for (const report of reports) {
    const url = report.requestedUrl ?? report.finalUrl;
    if (!url) throw new Error('a Lighthouse report names no URL');
    byUrl.set(url, [...(byUrl.get(url) ?? []), report]);
  }
  return [...byUrl].map(([url, runs]) => ({
    url,
    runs: runs.length,
    metrics: Object.fromEntries(
      SUMMARY_METRICS.map(({ id }) => {
        const values = runs.map((run) => run.audits[id]?.numericValue).filter(Number.isFinite);
        return [
          id,
          values.length === 0
            ? { p50: NaN, p95: NaN, max: NaN }
            : {
                p50: percentile(values, 50),
                p95: percentile(values, 95),
                max: Math.max(...values),
              },
        ];
      }),
    ),
  }));
}

const ms = (value) => (Number.isFinite(value) ? `${Math.round(value)} ms` : 'n/a');

/**
 * A Markdown table of `summarizeReports`, with the budget each page is held to.
 * @param {ReturnType<typeof summarizeReports>} pages
 * @param {(url: string) => number | undefined} budgetOf the page's budget in ms, when it has one
 */
export function summaryTable(pages, budgetOf) {
  const head = ['Page', 'Runs', 'Budget'];
  for (const { label, main } of SUMMARY_METRICS) {
    head.push(main ? `${label} p95 (worst)` : `${label} p95`);
  }
  const rows = pages.map((page) => {
    const budget = budgetOf(page.url);
    const cells = [new URL(page.url).pathname + new URL(page.url).search, String(page.runs)];
    cells.push(budget === undefined ? 'none' : `${budget} ms`);
    for (const { id, main } of SUMMARY_METRICS) {
      const { p95, max } = page.metrics[id];
      cells.push(main ? `${ms(p95)} (${ms(max)})` : ms(p95));
    }
    return cells;
  });
  return [head, head.map(() => '---'), ...rows]
    .map((cells) => `| ${cells.join(' | ')} |`)
    .join('\n');
}
