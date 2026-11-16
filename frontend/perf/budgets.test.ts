// SPEC-003 BR-003-06, BR-003-07, BR-003-09: the budgets and the reference profile are recorded in
// configuration, and this pins that record to the spec's numbers, so a change to one is a change
// the review sees. The Lighthouse run itself is `npm run test:perf` (TESTING §10).
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { ACCOUNTS as E2E_ACCOUNTS, BRASILIA_TEN_AM_AUCTION } from '../e2e/support/accounts';

interface Route {
  name: string;
  path: string;
  as: string;
  budgetMs?: number;
}
interface Group {
  name: string;
  budgetMs: number;
  enabled: boolean;
  routes: Route[];
}

const require = createRequire(import.meta.url);
const budgets = require('./budgets.cjs') as {
  API_BUDGET_MS: number;
  BUDGET_METRICS: string[];
  REFERENCE_PROFILE: {
    formFactor: string;
    throttlingMethod: string;
    throttling: Record<string, number>;
  };
  ROUTE_GROUPS: Group[];
  RUNS_PER_URL: number;
  enabledGroups: () => Group[];
};
const { buildConfig, measuredRoutes } = require('./lighthouse-config.cjs') as {
  buildConfig: (env: Record<string, string | undefined>) => {
    ci: {
      collect: {
        url: string[];
        numberOfRuns: number;
        puppeteerScript: string;
        chromePath?: string;
        settings: {
          formFactor: string;
          throttlingMethod: string;
          throttling: Record<string, number>;
        };
      };
      assert: {
        assertMatrix: Array<{
          matchingUrlPattern: string;
          aggregationMethod: string;
          assertions: Record<string, [string, { maxNumericValue: number }]>;
        }>;
      };
    };
  };
  measuredRoutes: () => Route[];
};
const { ACCOUNTS: PERF_ACCOUNTS } = require('./accounts.cjs') as {
  ACCOUNTS: Record<string, { email: string; password: string }>;
};

describe('BR-003-07: the reference profile, recorded in the configuration', () => {
  const { settings } = buildConfig({}).ci.collect;

  it('is a 4G network: 9 Mbps down, 1.5 Mbps up, 170 ms round trip', () => {
    expect(settings.throttling).toMatchObject({
      throughputKbps: 9000,
      uploadThroughputKbps: 1500,
      rttMs: 170,
    });
  });

  it('is a phone with a mid-range processor (4x slowdown), simulated', () => {
    expect(settings.formFactor).toBe('mobile');
    expect(settings.throttlingMethod).toBe('simulate');
    expect(settings.throttling.cpuSlowdownMultiplier).toBe(4);
  });
});

describe('BR-003-06: the budgets', () => {
  const [pages, dashboards] = budgets.ROUTE_GROUPS;

  it('holds search results and the property page to 2 s, and asks for 20 runs each', () => {
    expect(pages?.enabled).toBe(true);
    expect(pages?.budgetMs).toBe(2000);
    expect(pages?.routes.map((route) => route.name)).toEqual(['search results', 'property page']);
    expect(budgets.RUNS_PER_URL).toBe(20);
    expect(buildConfig({}).ci.collect.numberOfRuns).toBe(20);
  });

  it('keeps the 3 s dashboards and journeys group ready, off, with no made-up URL', () => {
    expect(dashboards?.budgetMs).toBe(3000);
    expect(dashboards?.enabled).toBe(false);
    expect(dashboards?.routes).toEqual([]);
  });

  it('asserts the "visible" and "usable" metrics against the group budget, worst run', () => {
    const matrix = buildConfig({}).ci.assert.assertMatrix;
    expect(matrix).toHaveLength(1);
    expect(matrix[0]?.aggregationMethod).toBe('pessimistic');
    expect(budgets.BUDGET_METRICS).toEqual(['largest-contentful-paint', 'interactive']);
    for (const metric of budgets.BUDGET_METRICS) {
      expect(matrix[0]?.assertions[metric]).toEqual(['error', { maxNumericValue: 2000 }]);
    }
  });

  it('holds the filtered API search to 2 s (BR-003-09)', () => {
    expect(budgets.API_BUDGET_MS).toBe(2000);
  });

  it('matches each measured URL to its own group and no other', () => {
    const config = buildConfig({});
    const pattern = new RegExp(config.ci.assert.assertMatrix[0]?.matchingUrlPattern ?? '');
    expect(config.ci.collect.url.length).toBeGreaterThan(0);
    for (const url of config.ci.collect.url) expect(url).toMatch(pattern);
    expect('http://localhost:38101/plans').not.toMatch(pattern);
  });
});

describe('what is measured', () => {
  it('measures only enabled groups, against the stack on the E2E port by default', () => {
    expect(buildConfig({}).ci.collect.url).toEqual([
      'http://localhost:38101/search?state=SP&pageSize=10',
      `http://localhost:38101/auction/${BRASILIA_TEN_AM_AUCTION}`,
    ]);
    expect(measuredRoutes().map((route) => route.budgetMs)).toEqual([2000, 2000]);
  });

  it('follows E2E_WEB_PORT and PERF_WEB_ORIGIN', () => {
    expect(buildConfig({ E2E_WEB_PORT: '4000' }).ci.collect.url[0]).toMatch(
      /^http:\/\/localhost:4000\//,
    );
    expect(buildConfig({ PERF_WEB_ORIGIN: 'http://web:3001' }).ci.collect.url[0]).toMatch(
      /^http:\/\/web:3001\//,
    );
  });

  it('signs the account in with a script, and opens the property page as a visitor', () => {
    expect(buildConfig({}).ci.collect.puppeteerScript).toBe('./perf/login.cjs');
    const [search, property] = measuredRoutes();
    expect(search?.as).toBe('investor');
    expect(property?.as).toBe('public');
    expect(property?.path).toBe(`/auction/${BRASILIA_TEN_AM_AUCTION}`);
  });

  it('drives the Chrome named by CHROME_PATH', () => {
    expect(buildConfig({}).ci.collect.chromePath).toBeUndefined();
    expect(buildConfig({ CHROME_PATH: '/opt/chrome' }).ci.collect.chromePath).toBe('/opt/chrome');
  });

  it('takes the run count from PERF_RUNS, only as a positive integer', () => {
    expect(buildConfig({ PERF_RUNS: '3' }).ci.collect.numberOfRuns).toBe(3);
    expect(() => buildConfig({ PERF_RUNS: '0' })).toThrow('PERF_RUNS');
    expect(() => buildConfig({ PERF_RUNS: 'many' })).toThrow('PERF_RUNS');
  });
});

describe('the seeded accounts', () => {
  it('are the E2E suite’s, so the sign-in the run uses exists in the seed', () => {
    expect(PERF_ACCOUNTS).toEqual(E2E_ACCOUNTS);
  });
});
