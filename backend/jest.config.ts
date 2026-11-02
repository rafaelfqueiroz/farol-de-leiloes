// TESTING §2: one Jest project per test type, so each script selects what it runs.
//   unit        — domain and service specs next to their source (src/**/*.spec.ts), plus the
//                 test helpers' own specs; no database, no network (TS-01)
//   structural  — checks on the repository itself (test/structural/)
//   integration — real MongoDB from Testcontainers (test/integration/); needs Docker (DV-17)
//   isolation   — the owner-isolation gate (test/isolation/, TESTING §4); needs Docker
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

const config: Config = {
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
