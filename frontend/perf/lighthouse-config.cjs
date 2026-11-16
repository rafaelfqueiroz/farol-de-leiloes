// SPEC-003 BR-003-06..BR-003-07: builds the Lighthouse CI configuration from budgets.cjs and the
// environment of the run. Kept apart from lighthouserc.cjs so the unit test can drive it with a
// fabricated environment. Plain CommonJS: Lighthouse CI `require`s it.
'use strict';

const { BUDGET_METRICS, REFERENCE_PROFILE, RUNS_PER_URL, enabledGroups } = require('./budgets.cjs');

const DEFAULT_WEB_PORT = '38101';

/** The origin of the web app under test: the E2E Compose stack, on the host's loopback. */
function webOrigin(env) {
  return env.PERF_WEB_ORIGIN || `http://localhost:${env.E2E_WEB_PORT || DEFAULT_WEB_PORT}`;
}

function runsPerUrl(env) {
  if (env.PERF_RUNS === undefined || env.PERF_RUNS === '') return RUNS_PER_URL;
  const runs = Number(env.PERF_RUNS);
  if (!Number.isInteger(runs) || runs < 1) {
    throw new Error('PERF_RUNS must be a positive integer');
  }
  return runs;
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Every measured route, with the budget of its group. */
function measuredRoutes() {
  return enabledGroups().flatMap((group) =>
    group.routes.map((route) => ({ ...route, group: group.name, budgetMs: group.budgetMs })),
  );
}

/**
 * The assertions: per group, every budget metric of the group's routes at most the group's
 * budget. `aggregationMethod: 'pessimistic'` takes the worst of the runs of each URL. LHCI has
 * no percentile aggregation (only optimistic, median, median-run and pessimistic), and over the
 * 20 runs BR-003-06 asks for, the 95th percentile (nearest rank) is the 19th of 20 sorted
 * values, so the worst run, the 20th, is never below it: a URL that passes pessimistic passes at
 * p95. The two differ only when the single worst run alone is over the budget, so the gate is
 * never looser than the spec and errs on the strict side by one run in twenty.
 * perf/stats.mjs reports the exact p95 next to it for the record.
 */
function assertMatrix() {
  return enabledGroups()
    .filter((group) => group.routes.length > 0)
    .map((group) => ({
      matchingUrlPattern: group.routes.map((route) => `${escapeRegExp(route.path)}$`).join('|'),
      aggregationMethod: 'pessimistic',
      assertions: Object.fromEntries(
        BUDGET_METRICS.map((metric) => [metric, ['error', { maxNumericValue: group.budgetMs }]]),
      ),
    }));
}

function buildConfig(env) {
  const origin = webOrigin(env);
  return {
    ci: {
      collect: {
        url: measuredRoutes().map((route) => `${origin}${route.path}`),
        numberOfRuns: runsPerUrl(env),
        // `/search` needs a signed-in account: perf/login.cjs signs the seeded investor in and
        // leaves its token in the page's localStorage, which Lighthouse's storage reset keeps
        // (it clears the HTTP cache and the cache/service-worker stores, not local storage), so
        // every run still starts with a cold cache.
        puppeteerScript: './perf/login.cjs',
        puppeteerLaunchOptions: {
          // CI's runner needs --no-sandbox (user namespaces are restricted on ubuntu-24.04).
          args: ['--no-sandbox', '--disable-dev-shm-usage'],
        },
        ...(env.CHROME_PATH ? { chromePath: env.CHROME_PATH } : {}),
        settings: {
          // The BR-003-07 reference profile, recorded here and nowhere else.
          formFactor: REFERENCE_PROFILE.formFactor,
          screenEmulation: {
            mobile: true,
            width: 412,
            height: 823,
            deviceScaleFactor: 1.75,
            disabled: false,
          },
          throttlingMethod: REFERENCE_PROFILE.throttlingMethod,
          throttling: { ...REFERENCE_PROFILE.throttling },
          onlyCategories: ['performance'],
        },
      },
      assert: {
        assertMatrix: assertMatrix(),
        includePassedAssertions: true,
      },
      // No `upload`: the reports stay in .lighthouseci/ (JSON and HTML per run), which the
      // workflow uploads as an artifact.
    },
  };
}

module.exports = { buildConfig, measuredRoutes, webOrigin };
