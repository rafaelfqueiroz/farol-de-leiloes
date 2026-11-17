// SPEC-002 TS-14 / AR-16: the second layer of the isolation gate, over what Vitest ACTUALLY RAN.
// The parser (isolation-coverage.ts) only sees syntax: a loop over an empty array, an environment
// conditional or a helper nobody calls all look like tests and never run. So the run itself is the
// evidence:
//   - isolationSpecFor('<Model>', ...) (isolation-spec.ts) stamps every test that runs inside it
//     with the model in the test's `meta`, from an afterEach;
//   - the enumeration spec (model-coverage.isolation.spec.ts) stamps its own test with the
//     models that REQUIRE an isolation test (owned + account kinds);
//   - after all files finish, IsolationRunReporter (isolation-reporter.ts, set in
//     vitest.config.mts) compares the two over the tests that PASSED and fails the run, naming
//     every model left uncovered.
// Meta travels from the worker to the main process with the task results: no files, no globals.
// This module is imported by the reporter on every Vitest run: keep it free of heavy imports.

declare module 'vitest' {
  interface TaskMeta {
    isolatedModels?: string[];
    requiredIsolationModels?: string[];
  }
}

/** `task.meta` key: the models whose isolation specs this test belongs to (specs may nest). */
export const ISOLATED_MODEL = 'isolatedModels' as const;
/** `task.meta` key: the models that must be covered (set by the enumeration spec's test). */
export const REQUIRED_MODELS = 'requiredIsolationModels' as const;

/** What the check needs of a finished test (a subset of Vitest's TestCase). */
export interface RanTest {
  readonly meta: Record<string, unknown>;
  readonly state: string;
}

/**
 * The models that are required but have no passed isolation test in this run, sorted. `undefined`
 * when the check does not apply: no passed test declared the required models, i.e. the enumeration
 * spec did not run (a filtered partial run of one file) or did not pass (it reports its own failure).
 */
export function uncoveredModels(tests: readonly RanTest[]): string[] | undefined {
  const required = new Set<string>();
  let enumerated = false;
  const covered = new Set<string>();
  for (const test of tests) {
    if (test.state !== 'passed') continue;
    const declared = test.meta[REQUIRED_MODELS];
    if (Array.isArray(declared)) {
      enumerated = true;
      for (const name of declared) required.add(String(name));
    }
    const models = test.meta[ISOLATED_MODEL];
    if (Array.isArray(models)) for (const name of models) covered.add(String(name));
  }
  if (!enumerated) return undefined;
  return [...required].filter((name) => !covered.has(name)).sort();
}

/** The message that fails the run (TS-14). */
export function uncoveredMessage(models: readonly string[]): string {
  return [
    '',
    'TS-14 isolation gate: these models have no isolation test that RAN and PASSED in this run:',
    ...models.map((name) => `  - ${name}`),
    "An isolationSpecFor('<Model>', ...) whose tests never run (an empty loop, a condition, a helper",
    'nobody calls) covers nothing. See test/isolation/README.md.',
    '',
  ].join('\n');
}
