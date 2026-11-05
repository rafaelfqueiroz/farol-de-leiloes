// TESTING §2: one Vitest project per test type, so each script selects what it runs.
//   unit        — domain and service specs next to their source (src/**/*.spec.ts), plus the
//                 test helpers' own specs; no database, no network (TS-01)
//   structural  — checks on the repository itself (test/structural/)
//   integration — real MongoDB from Testcontainers (test/integration/); needs Docker (DV-17)
//   isolation   — the owner-isolation gate (test/isolation/, TESTING §4); needs Docker
// Specs import `describe`, `it`, `expect` and `vi` from 'vitest' explicitly; there are no globals.
import { defineConfig } from 'vitest/config';

// Every project runs test/support/silence-logger.ts first: the Nest Logger is silent in tests, so
// the expected ERROR/WARN lines of error-path specs do not bury real failures (TESTING §2). A spec
// that asserts on logging spies on the logger explicitly. It applies to all four projects,
// including the Nest apps booted by integration and isolation specs, which log just as much.
const shared = {
  environment: 'node' as const,
  clearMocks: true,
  setupFiles: ['./test/support/silence-logger.ts'],
  // tr46 (a transitive dependency of the MongoDB driver's connection-string parser) still requires
  // Node's deprecated `punycode`, and Node printed that DEP0040 warning once per worker. Not our
  // code, and nothing to act on: silence this one warning, every other still shows.
  execArgv: ['--disable-warning=DEP0040'],
};

// One mongo:7 container per run, shared by both projects; each spec file uses its own database
// on it (TS-05, test/support/test-database.ts). A real database round trip (plus Nest
// bootstrapping in beforeAll) needs more than the 5 s default; container start-up happens in
// global setup and is not counted here.
const withMongo = {
  ...shared,
  globalSetup: ['./test/support/mongo-global-setup.ts'],
  testTimeout: 30_000,
  hookTimeout: 30_000,
};

export default defineConfig({
  test: {
    // TESTING §7. Coverage is measured on the unit and structural run (`npm run test:cov`).
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      // The process entry points: they only wire a Nest context and exit (main.ts, run.ts), or
      // initialise Sentry before it (instrument.ts, whose options are unit-tested).
      exclude: ['src/**/*.spec.ts', 'src/main.ts', 'src/instrument.ts', 'src/migrations/run.ts'],
      reporter: ['text-summary', 'text', 'lcov'],
      thresholds: {
        // A floor at the coverage measured when the gate was introduced (rounded down), not the
        // target: TESTING §7 sets 80% lines and branches. The floor is ratcheted up toward 80%
        // and tracked in #57; it never goes down. Re-baselined in #62: V8 coverage measures the
        // source, where Jest/ts-jest also counted the helpers tsc emits for decorators, so the
        // numbers moved without any code losing a test.
        // Raised in #35 by the HTTP and OpenAPI contract specs (measured 40.0% / 30.2%), then by
        // the unit specs of the SC-10 query guards (measured 44.0% / 36.2%), then in #34 by the
        // money, Clock and payment-port specs (measured 53.7% / 50.0%), then in #36 by the
        // observability, health and job-outcome specs (measured 60.2% / 57.0%).
        // Raised in #51 by the module-boundary regressions (measured 65.39% / 61.73%).
        lines: 65,
        branches: 61,
        // TS-24 / AR-06: `domain/` holds the critical modules, gated at 100% branch coverage.
        // The glob is static: Vitest ignores a threshold glob that matches no file, so the gate
        // is inert until the first src/<module>/domain/ file lands and applies the moment it
        // does, with no config change. The files matching a glob are aggregated, so 100% for the
        // glob means every domain file is at 100%.
        'src/*/domain/**/*.ts': { branches: 100 },
      },
    },
    projects: [
      {
        extends: true,
        test: {
          ...shared,
          name: 'unit',
          include: ['src/**/*.spec.ts', 'test/support/**/*.spec.ts'],
        },
      },
      {
        extends: true,
        test: { ...shared, name: 'structural', include: ['test/structural/**/*.spec.ts'] },
      },
      {
        extends: true,
        test: { ...withMongo, name: 'integration', include: ['test/integration/**/*.spec.ts'] },
      },
      {
        extends: true,
        test: { ...withMongo, name: 'isolation', include: ['test/isolation/**/*.spec.ts'] },
      },
    ],
  },
});
