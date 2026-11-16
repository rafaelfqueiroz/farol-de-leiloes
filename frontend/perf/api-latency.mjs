// SPEC-003 BR-003-09: applying a filter to the search must show results within the page's budget
// (2 s at p95) on the reference catalog. The Lighthouse run measures the page, whose search is
// filtered by its URL; this measures the data load behind a filter on its own, over many
// different filters, as a request: the backend's `GET /api/auctions` and the web app's
// `GET /api/search`, the BFF route the browser calls. The 4G profile cannot be applied to a
// Node client, so this is the server's share of the budget; the page run carries the network.
//
//   node perf/api-latency.mjs [--requests N] [--out perf-results/api-latency.json]
//   PERF_API_URL (default http://localhost:38100), PERF_WEB_ORIGIN (default http://localhost:38101)
//
// Exit 0 when every target's p95 is within the budget, 3 when one is over, 1 on a fault.
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { percentile } from './stats.mjs';

const { API_BUDGET_MS } = createRequire(import.meta.url)('./budgets.cjs');

const WARM_UP_REQUESTS = 20;
const DEFAULT_REQUESTS = 200;

/** Capital cities of the heaviest states (reference-workload/catalog.ts), for the prefix filter. */
const FILTERS = [
  { state: 'SP' },
  { state: 'RJ' },
  { state: 'GO' },
  { state: 'MG', modality: 'ONLINE_SALES' },
  { state: 'BA', city: 'Salvador' },
  { state: 'SP', city: 'São Paulo' },
  { state: 'RJ', city: 'Rio de Janeiro', modality: 'DIRECT_ONLINE_SALES' },
  { state: 'RS', minPrice: '100000.00', maxPrice: '300000.00' },
  { state: 'PE', modality: 'OPEN_BIDDING,SFI_AUCTION' },
  { state: 'SP', city: 'Campinas,Santos', page: '2' },
  { state: 'MG', city: 'Belo Horizonte', neighborhood: 'Bairro 1', pageSize: '50' },
  { minPrice: '50000.00', maxPrice: '150000.00' },
];

/** Target name → the URL of request number `index`. */
export function targets(env) {
  const api = env.PERF_API_URL || `http://localhost:${env.E2E_API_PORT || '38100'}`;
  const web = env.PERF_WEB_ORIGIN || `http://localhost:${env.E2E_WEB_PORT || '38101'}`;
  const query = (index) =>
    new URLSearchParams({ pageSize: '10', ...FILTERS[index % FILTERS.length] }).toString();
  return [
    { name: 'backend GET /api/auctions', url: (index) => `${api}/api/auctions?${query(index)}` },
    { name: 'web GET /api/search', url: (index) => `${web}/api/search?${query(index)}` },
  ];
}

async function timed(url) {
  const started = performance.now();
  const response = await fetch(url);
  const body = await response.json();
  const elapsed = performance.now() - started;
  if (!response.ok) throw new Error(`${url} answered ${response.status}`);
  if (!Array.isArray(body.items)) throw new Error(`${url} did not answer a page of items`);
  return { elapsed, total: body.total };
}

async function measure(target, requests) {
  for (let i = 0; i < WARM_UP_REQUESTS; i += 1) await timed(target.url(i));
  const samples = [];
  let emptyPages = 0;
  for (let i = 0; i < requests; i += 1) {
    const { elapsed, total } = await timed(target.url(i));
    samples.push(elapsed);
    if (total === 0) emptyPages += 1;
  }
  return {
    target: target.name,
    requests,
    p50: percentile(samples, 50),
    p95: percentile(samples, 95),
    max: Math.max(...samples),
    emptyPages,
  };
}

function argument(name, fallback) {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
}

async function main() {
  const requests = Number(argument('--requests', DEFAULT_REQUESTS));
  if (!Number.isInteger(requests) || requests < 20)
    throw new Error('--requests must be at least 20');
  const out = argument('--out', 'perf-results/api-latency.json');

  const results = [];
  for (const target of targets(process.env)) results.push(await measure(target, requests));
  const failures = results
    .filter((result) => result.p95 > API_BUDGET_MS)
    .map(
      (result) => `${result.target}: p95 ${Math.round(result.p95)} ms is over ${API_BUDGET_MS} ms`,
    );

  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(
    out,
    `${JSON.stringify({ budgetMs: API_BUDGET_MS, passed: failures.length === 0, results, failures }, null, 2)}\n`,
  );
  for (const r of results) {
    process.stdout.write(
      `${r.target}: ${r.requests} requests, p50 ${r.p50.toFixed(1)} ms, p95 ${r.p95.toFixed(1)} ms, ` +
        `worst ${r.max.toFixed(1)} ms (budget ${API_BUDGET_MS} ms; ${r.emptyPages} empty pages)\n`,
    );
  }
  for (const failure of failures) process.stderr.write(`BUDGET MISSED ${failure}\n`);
  process.exitCode = failures.length === 0 ? 0 : 3;
}

// Run only as a command, so the unit test can import `targets`.
if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`perf/api-latency: ${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  });
}
