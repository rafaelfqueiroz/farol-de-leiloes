// SPEC-003 BR-003-06..BR-003-10 (TESTING §10, DV-18): `npm run test:perf`. Brings up the E2E
// Compose stack on the FULL catalog (e2e/compose.e2e.yml; the apps never run on the host), runs
// Lighthouse CI on the reference profile (lighthouserc.cjs), the API latency check, writes
// perf-results/{summary.md,verdict.json} and tears the stack down.
//
//   --report-only   exit 0 when budgets are missed (the verdict file still says so); faults exit 1
//   --runs N        runs per URL; 20 by default (BR-003-06). Fewer is for report-only checks
//   --requests N    requests per target of the API check; 200 by default
//
// Environment (the same knobs as `npm run test:e2e`, e2e/global-setup.ts):
//   E2E_KEEP_STACK=1    leave the stack up afterwards     E2E_REUSE_STACK=1  use a stack that is up
//   E2E_SEED_AUCTIONS   catalog size; `full` here unless set (use a small number for a smoke run)
//   CHROME_PATH         the Chrome/Chromium to drive; found among the usual places if unset
//   E2E_WEB_PORT, E2E_API_PORT
//
// Exit codes: 0 budgets met (or --report-only), 3 a budget missed, 1 a fault (stack, Chrome, ...).
import { execFileSync, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { summarizeReports, summaryTable } from './stats.mjs';

const require = createRequire(import.meta.url);
const { API_BUDGET_MS, REFERENCE_PROFILE, RUNS_PER_URL } = require('./budgets.cjs');
const { measuredRoutes, webOrigin } = require('./lighthouse-config.cjs');

const ROOT = join(import.meta.dirname, '..');
const COMPOSE_FILE = join(ROOT, 'e2e', 'compose.e2e.yml');
const REPORTS = join(ROOT, '.lighthouseci');
const RESULTS = join(ROOT, 'perf-results');

// The seed's full catalog is 35 000 auctions (backend FULL_CATALOG_SIZE); below this it is not.
const FULL_CATALOG_FLOOR = 30_000;

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
];

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
}

const log = (message) => process.stdout.write(`[perf] ${message}\n`);

function compose(...args) {
  execFileSync('docker', ['compose', '-f', COMPOSE_FILE, ...args], { cwd: ROOT, stdio: 'inherit' });
}

async function findChrome(env) {
  if (env.CHROME_PATH) return env.CHROME_PATH;
  const installed = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (installed) return installed;
  // Playwright's Chromium (`npx playwright install chromium`), as the E2E suite uses.
  const { chromium } = await import('@playwright/test');
  const bundled = chromium.executablePath();
  if (existsSync(bundled)) return bundled;
  throw new Error('No Chrome found: set CHROME_PATH, or run `npx playwright install chromium`');
}

/** The number of active auctions the run measured against, for the record. */
async function catalogSize(env) {
  const api = env.PERF_API_URL || `http://localhost:${env.E2E_API_PORT || '38100'}`;
  const response = await fetch(`${api}/api/auctions?pageSize=1`);
  const body = await response.json();
  return body.total;
}

function lighthouse(command, env) {
  return spawnSync('npx', ['lhci', command], {
    cwd: ROOT,
    env,
    encoding: 'utf8',
    maxBuffer: 1 << 26,
  });
}

const echo = (result) => {
  process.stdout.write(result.stdout ?? '');
  process.stderr.write(result.stderr ?? '');
};

function budgetOf(url) {
  const { pathname, search } = new URL(url);
  return measuredRoutes().find((route) => route.path === `${pathname}${search}`)?.budgetMs;
}

async function measure(env, runs, requests) {
  env.CHROME_PATH = await findChrome(env);
  log(`Chrome: ${env.CHROME_PATH}`);
  rmSync(REPORTS, { recursive: true, force: true });
  rmSync(RESULTS, { recursive: true, force: true });
  mkdirSync(RESULTS, { recursive: true });

  log(`Lighthouse CI: ${runs} runs per URL on ${webOrigin(env)}`);
  const collect = lighthouse('collect', { ...env, PERF_RUNS: String(runs) });
  echo(collect);
  const reports = existsSync(REPORTS)
    ? readdirSync(REPORTS).filter((name) => /^lhr-.*\.json$/.test(name))
    : [];
  if (collect.status !== 0 || reports.length === 0)
    throw new Error('lhci collect produced no reports');

  const assertion = lighthouse('assert', { ...env, PERF_RUNS: String(runs) });
  echo(assertion);
  const lighthousePassed = assertion.status === 0;

  log(`API latency: ${requests} requests per target`);
  const api = spawnSync(
    process.execPath,
    [
      join(ROOT, 'perf', 'api-latency.mjs'),
      '--requests',
      String(requests),
      '--out',
      join(RESULTS, 'api-latency.json'),
    ],
    { cwd: ROOT, env, encoding: 'utf8' },
  );
  echo(api);
  if (api.status !== 0 && api.status !== 3) throw new Error('the API latency check failed to run');
  const apiResult = JSON.parse(readFileSync(join(RESULTS, 'api-latency.json'), 'utf8'));

  const pages = summarizeReports(
    reports.map((name) => JSON.parse(readFileSync(join(REPORTS, name), 'utf8'))),
  );
  const auctions = await catalogSize(env);
  const failures = [
    ...(lighthousePassed
      ? []
      : ['Lighthouse CI: a page missed its budget (see the assertion output)']),
    ...apiResult.failures,
  ];
  const verdict = { passed: failures.length === 0, runs, auctions, failures };
  writeFileSync(join(RESULTS, 'verdict.json'), `${JSON.stringify(verdict, null, 2)}\n`);

  const { throttling, formFactor } = REFERENCE_PROFILE;
  const assertionOutput = `${assertion.stdout ?? ''}${assertion.stderr ?? ''}`.trim();
  writeFileSync(
    join(RESULTS, 'summary.md'),
    [
      `## Performance budgets: ${verdict.passed ? 'met' : 'MISSED'}`,
      '',
      `Reference workload: ${auctions.toLocaleString('en-US')} active auctions (BR-003-08). Profile ` +
        `(BR-003-07): ${formFactor}, ${throttling.throughputKbps / 1000} Mbps down, ` +
        `${throttling.uploadThroughputKbps / 1000} Mbps up, ${throttling.rttMs} ms round trip, ` +
        `CPU slowdown ${throttling.cpuSlowdownMultiplier}x. ${auctions < FULL_CATALOG_FLOOR ? 'NOT the full catalog: this is a harness check, not a measurement. ' : ''}${runs} runs per page` +
        `${runs < RUNS_PER_URL ? ` (fewer than the ${RUNS_PER_URL} the spec asks for: a check of the harness, not a measurement)` : ''}.`,
      '',
      summaryTable(pages, budgetOf),
      '',
      `Gate: Lighthouse CI asserts the worst run of each page against its budget (\`pessimistic\`, never below p95).`,
      '',
      '### API latency (BR-003-09)',
      '',
      '| Target | Requests | p50 | p95 | Worst | Budget |',
      '| --- | --- | --- | --- | --- | --- |',
      ...apiResult.results.map(
        (r) =>
          `| ${r.target} | ${r.requests} | ${r.p50.toFixed(1)} ms | ${r.p95.toFixed(1)} ms | ${r.max.toFixed(1)} ms | ${API_BUDGET_MS} ms |`,
      ),
      '',
      ...(lighthousePassed
        ? []
        : [
            '### Lighthouse CI assertion output',
            '',
            '```',
            assertionOutput.slice(-6000),
            '```',
            '',
          ]),
    ].join('\n'),
  );
  process.stdout.write(`\n${readFileSync(join(RESULTS, 'summary.md'), 'utf8')}\n`);
  return verdict;
}

async function main() {
  const env = { ...process.env, E2E_SEED_AUCTIONS: process.env.E2E_SEED_AUCTIONS || 'full' };
  const runs = Number(option('--runs', RUNS_PER_URL));
  const requests = Number(option('--requests', 200));
  if (!Number.isInteger(runs) || runs < 1) throw new Error('--runs must be a positive integer');
  const reuse = env.E2E_REUSE_STACK === '1';
  const keep = env.E2E_KEEP_STACK === '1';

  if (!reuse) {
    log(`Bringing up the E2E stack (E2E_SEED_AUCTIONS=${env.E2E_SEED_AUCTIONS})`);
    Object.assign(process.env, env);
    try {
      compose('up', '--build', '--detach', '--wait', '--wait-timeout', '900');
    } catch (error) {
      compose('logs', '--no-color', '--tail', '200', 'seed', 'backend', 'frontend');
      if (!keep) compose('down', '--volumes', '--remove-orphans');
      throw error;
    }
  }
  try {
    const verdict = await measure(env, runs, requests);
    process.exitCode = verdict.passed || process.argv.includes('--report-only') ? 0 : 3;
  } finally {
    if (!reuse && !keep) compose('down', '--volumes', '--remove-orphans');
  }
}

main().catch((error) => {
  process.stderr.write(`perf/run: ${error instanceof Error ? error.message : error}\n`);
  process.exitCode = 1;
});
