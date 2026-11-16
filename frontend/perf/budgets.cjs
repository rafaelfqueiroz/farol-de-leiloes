// SPEC-003 BR-003-06..BR-003-10: the performance budgets and the reference measurement profile,
// recorded once and read by lighthouserc.cjs (the Lighthouse CI run), perf/run.mjs (the wrapper)
// and perf/api-latency.mjs. Plain CommonJS because Lighthouse CI `require`s its config and its
// puppeteer script; frontend/perf/budgets.test.ts pins the values below to the spec.
'use strict';

/**
 * BR-003-07: the fixed reference profile. Lighthouse's `simulate` throttling models this network
 * and CPU on a fast, unthrottled load (Lantern), which is why its numbers are far steadier from
 * run to run than DevTools-style packet-level throttling on a shared CI runner.
 *
 * - 4G: 9 Mbps down, 1.5 Mbps up, 170 ms round trip. Lighthouse takes kbps and a round trip in
 *   ms; its own mobile default is 1.6 Mbps / 150 ms, a slow 4G, not the profile the spec names.
 * - Mid-range phone processor: CPU slowdown 4. Lighthouse calibrates 1x to a fast desktop and
 *   documents 4x as a mid-tier phone (Moto G Power class) and 6x as a low-end one. A budget
 *   met at 4x is met on a mid-range phone; a faster phone only does better. The multiplier is
 *   the one number here with judgement in it, so it is a single constant: raising it tightens
 *   every budget at once.
 */
const REFERENCE_PROFILE = Object.freeze({
  formFactor: 'mobile',
  throttlingMethod: 'simulate',
  throttling: Object.freeze({
    rttMs: 170,
    throughputKbps: 9000,
    uploadThroughputKbps: 1500,
    cpuSlowdownMultiplier: 4,
  }),
});

/** BR-003-06 / acceptance: "at least 20 runs per page". Reduced only in report-only runs. */
const RUNS_PER_URL = 20;

/**
 * The route groups, each with its budget (BR-003-06). A route is a path on the web app; the
 * wrapper prefixes the stack's origin. `as` says who is signed in when it is opened.
 *
 * BR-003-09: an action that loads data belongs to the page's budget. The search results are
 * measured with a filter applied (`?state=SP`), so the data load of a filter action is inside
 * the measured navigation; perf/api-latency.mjs measures the same request on its own.
 */
const ROUTE_GROUPS = [
  {
    name: 'search and property',
    budgetMs: 2000,
    enabled: true,
    routes: [
      // `/search` requires sign-in today; SPEC-005 (#5) opens it to the public.
      { name: 'search results', path: '/search?state=SP&pageSize=10', as: 'investor' },
      // The fixed auction every seeded catalog carries (reference-workload/catalog.ts).
      { name: 'property page', path: '/auction/9000000000001', as: 'public' },
    ],
  },
  {
    // Ready to enable: these pages do not exist yet (SPEC-011 #11, SPEC-016 #16, SPEC-021 #21).
    // When one lands, add its route here with the account that opens it (`as`, plus the seed
    // account in perf/login.cjs), set `enabled: true` and extend the seed's journey part
    // (reference-workload/seed.ts) so the page is measured at the workload of BR-003-08.
    // Nothing below is a real URL, which is why the group is off.
    name: 'dashboards and journeys',
    budgetMs: 3000,
    enabled: false,
    routes: [
      // { name: 'advisor journey dashboard', path: '/<route>', as: 'admin' },
      // { name: 'investor portal',           path: '/<route>', as: 'investor' },
      // { name: 'carteira',                  path: '/<route>', as: 'investor' },
      // { name: 'journey page',              path: '/<route>', as: 'investor' },
    ],
  },
];

/**
 * BR-003-07: "main content is visible and usable". Two metrics stand for the two words, both
 * asserted against the group's budget:
 *
 * - `largest-contentful-paint` (visible): when the largest element, here the results list or the
 *   property's content, is painted. The navigation start is the clock's zero.
 * - `interactive` (usable): Lighthouse's time to interactive, when the main thread is quiet
 *   enough to answer input within 50 ms. Looser than TBT alone because it is a time on the same
 *   scale as the budget, so one number per budget reads straight against it.
 *
 * Both are Lighthouse "numeric" audits in milliseconds.
 */
const BUDGET_METRICS = ['largest-contentful-paint', 'interactive'];

/**
 * BR-003-09: the search endpoint with a filter, measured on its own as a request, not a page.
 * The budget is the same 2 s; what it adds over the page run is the repetition on many filters.
 */
const API_BUDGET_MS = 2000;

/** The groups that are measured. */
function enabledGroups() {
  return ROUTE_GROUPS.filter((group) => group.enabled);
}

module.exports = {
  API_BUDGET_MS,
  BUDGET_METRICS,
  REFERENCE_PROFILE,
  ROUTE_GROUPS,
  RUNS_PER_URL,
  enabledGroups,
};
