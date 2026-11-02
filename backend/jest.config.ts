// TESTING §2: one Jest project per test type, so each script selects what it runs.
//   unit        — domain and service specs next to their source (src/**/*.spec.ts), plus the
//                 test helpers' own specs; no database, no network (TS-01)
//   structural  — checks on the repository itself (test/structural/)
//   integration — real MongoDB from Testcontainers (test/integration/); needs Docker (DV-17)
//   isolation   — the owner-isolation gate (test/isolation/, TESTING §4); needs Docker
import { readdirSync } from 'fs';
import { join } from 'path';
import type { Config } from 'jest';

type ProjectConfig = Exclude<NonNullable<Config['projects']>[number], string>;

const shared: ProjectConfig = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
};

// One mongo:7 container per run, shared by both projects; each spec file uses its own database
// on it (TS-05, test/support/test-database.ts).
const withMongo: ProjectConfig = {
  ...shared,
  testMatch: ['**/*.spec.ts'],
  globalSetup: '<rootDir>/test/support/mongo-global-setup.ts',
  globalTeardown: '<rootDir>/test/support/mongo-global-teardown.ts',
  setupFilesAfterEnv: ['<rootDir>/test/support/mongo-test-timeout.ts'],
};

const SRC = join(__dirname, 'src');

/** True when `dir` holds at least one non-spec .ts file, at any depth. */
function hasSource(dir: string): boolean {
  return readdirSync(dir, { withFileTypes: true }).some((entry) =>
    entry.isDirectory()
      ? hasSource(join(dir, entry.name))
      : entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts'),
  );
}

// TS-24 / AR-06: `domain/` holds the critical modules, gated at 100% branch coverage. The keys
// are computed from the `src/<module>/domain/` folders that exist, because Jest fails a run whose
// threshold glob matches no file. None exists yet; a module gains the gate the moment its
// domain/ folder lands, with no config change.
const domainThresholds: Record<string, { branches: number }> = Object.fromEntries(
  readdirSync(SRC, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(SRC, entry.name, 'domain'))
    .filter((dir) => {
      try {
        return hasSource(dir);
      } catch {
        return false; // no domain/ folder in this module
      }
    })
    .map((dir) => [`./src/${dir.slice(SRC.length + 1)}/**/*.ts`, { branches: 100 }]),
);

const config: Config = {
  // TESTING §7. Coverage is measured on the unit and structural run (`npm run test:cov`).
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.spec.ts', '!src/main.ts'],
  coverageReporters: ['text-summary', 'text', 'lcov'],
  coverageThreshold: {
    // A floor at the coverage measured when the gate was introduced (rounded down), not the
    // target: TESTING §7 sets 80% lines and branches. The floor is ratcheted up toward 80% and
    // tracked in #57; it never goes down.
    global: { lines: 23, branches: 14 },
    ...domainThresholds,
  },
  projects: [
    {
      ...shared,
      displayName: 'unit',
      roots: ['<rootDir>/src', '<rootDir>/test/support'],
      testMatch: ['**/*.spec.ts'],
    },
    {
      ...shared,
      displayName: 'structural',
      roots: ['<rootDir>/test/structural'],
      testMatch: ['**/*.spec.ts'],
    },
    { ...withMongo, displayName: 'integration', roots: ['<rootDir>/test/integration'] },
    { ...withMongo, displayName: 'isolation', roots: ['<rootDir>/test/isolation'] },
  ],
};

export default config;
