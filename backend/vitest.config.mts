// TESTING §2: one Vitest project per test type, so each script selects what it runs.
//   unit        — domain and service specs next to their source (src/**/*.spec.ts), plus the
//                 test helpers' own specs; no database, no network (TS-01)
//   tz-<zone>   — the specs whose answer must not depend on the host's zone, repeated once per
//                 zone (UTC, Tokyo, Brasília) in forked workers that get TZ before Node starts
//                 (TS-11, AR-23); they are excluded from `unit` so each runs once per zone
//   structural  — checks on the repository itself (test/structural/)
//   integration — real MongoDB from Testcontainers (test/integration/); needs Docker (DV-17)
//   isolation   — the owner-isolation gate (test/isolation/, TESTING §4); needs Docker
//   smoke       — loads the compiled dist/ import graph in plain Node (test/smoke/, #63); needs
//                 `npm run build` first, which `npm run test:smoke` does
// Specs import `describe`, `it`, `expect` and `vi` from 'vitest' explicitly; there are no globals.
import { configDefaults, defineConfig } from 'vitest/config';

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

// TS-11, AR-23, BR-003-23: Brasília time must come out the same on any server. These specs run in
// each zone below; a spec that reads the host's zone by accident fails in at least two of them.
const timeZoneSpecs = [
  'src/common/clock/brasilia-time.spec.ts',
  'src/reminders/templates/reminder.template.spec.ts',
];
const timeZones = ['UTC', 'Asia/Tokyo', 'America/Sao_Paulo'];

// One mongo:8.2 container per run, shared by both projects; each spec file uses its own database
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
      // The process entry points: they only wire a Nest context and exit (main.ts, the run.ts of
      // the migrations and of grant-admin), or initialise Sentry before it (instrument.ts, whose
      // options are unit-tested).
      exclude: [
        'src/**/*.spec.ts',
        'src/main.ts',
        'src/instrument.ts',
        'src/migrations/run.ts',
        'src/access/grant-admin/run.ts',
      ],
      reporter: ['text-summary', 'text', 'lcov'],
      thresholds: {
        // TESTING §7: the target, 80% lines and branches, now the floor itself. It started at the
        // coverage measured when the gate was introduced and was ratcheted up by #35, #34, #36,
        // #51 and #98; #57 raised it to the target (measured 91.86% / 87.01%). It never goes
        // down. Re-baselined in #62: V8 coverage measures the source, where Jest/ts-jest also
        // counted the helpers tsc emits for decorators, so the numbers moved without any code
        // losing a test.
        lines: 80,
        branches: 80,
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
          // scripts/: the reference-workload generator (SPEC-003 BR-003-08) is pure, so unit.
          include: ['src/**/*.spec.ts', 'test/support/**/*.spec.ts', 'scripts/**/*.spec.ts'],
          exclude: [...configDefaults.exclude, ...timeZoneSpecs],
        },
      },
      ...timeZones.map((timeZone) => ({
        extends: true as const,
        test: {
          ...shared,
          name: `tz-${timeZone}`,
          pool: 'forks' as const,
          include: timeZoneSpecs,
          env: { TZ: timeZone },
          provide: { timeZone }, // the specs assert the host zone really is this one
        },
      })),
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
      {
        extends: true,
        test: { ...shared, name: 'smoke', include: ['test/smoke/**/*.spec.ts'] },
      },
    ],
  },
});
