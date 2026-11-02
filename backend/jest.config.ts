// TESTING §2: one Jest project per test type, so each script selects what it runs.
//   unit        — domain and service specs next to their source (src/**/*.spec.ts); no database,
//                 no network (TS-01)
//   structural  — checks on the repository itself (test/structural/)
import type { Config } from 'jest';

type ProjectConfig = Exclude<NonNullable<Config['projects']>[number], string>;

const shared: ProjectConfig = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  moduleFileExtensions: ['ts', 'js', 'json'],
  clearMocks: true,
};

const config: Config = {
  projects: [
    {
      ...shared,
      displayName: 'unit',
      roots: ['<rootDir>/src'],
      testMatch: ['**/*.spec.ts'],
    },
    {
      ...shared,
      displayName: 'structural',
      roots: ['<rootDir>/test/structural'],
      testMatch: ['**/*.spec.ts'],
    },
  ],
};

export default config;
