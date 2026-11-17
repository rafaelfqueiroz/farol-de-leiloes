// SPEC-002 TS-14: Vitest reporter that applies the post-run half of the isolation gate
// (executed-isolation.ts) once ALL test files have finished, and fails the run if any required
// model has no isolation test that ran and passed. Registered in vitest.config.mts; on a run
// without the enumeration spec (a single file by filter, any other project) it does nothing.
import type { Reporter, TestModule } from 'vitest/node';
import { uncoveredMessage, uncoveredModels } from './executed-isolation.js';

export default class IsolationRunReporter implements Reporter {
  onTestRunEnd(testModules: ReadonlyArray<TestModule>): void {
    const tests = testModules.flatMap((module) =>
      [...module.children.allTests()].map((test) => ({
        meta: test.meta() as Record<string, unknown>,
        state: test.result().state,
      })),
    );
    const uncovered = uncoveredModels(tests);
    if (uncovered && uncovered.length > 0) {
      process.stderr.write(uncoveredMessage(uncovered));
      process.exitCode = 1;
    }
  }
}
