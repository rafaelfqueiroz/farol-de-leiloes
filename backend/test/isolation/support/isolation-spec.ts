// SPEC-002 TS-13 / TS-14: how an isolation spec says which model it proves. Two layers check it:
//   1. static: the gate (../model-coverage.isolation.spec.ts) finds these calls by parsing every
//      test/isolation/**/*.isolation.spec.ts file (support/isolation-coverage.ts), so the covered
//      models are never a hand-kept list. Only a real call with a literal name counts, its body must
//      contain a test, and a file that skips or focuses tests covers nothing;
//   2. dynamic: every test that RUNS inside the call stamps its meta with the model (below), and
//      after the run IsolationRunReporter fails the model that has no passed test
//      (support/executed-isolation.ts). Syntax alone is never enough: a loop over no scenarios, a
//      condition or an uncalled helper contains a test and runs none.
// The name is the Mongoose model name, as `connection.modelNames()` lists it (e.g. 'FavoriteEntity').
import { afterEach, describe } from 'vitest';
import { ISOLATED_MODEL } from './executed-isolation.js';

export function isolationSpecFor(modelName: string, body: () => void): void {
  describe(`isolation of ${modelName} through the API (TS-13)`, () => {
    afterEach(({ task }) => {
      // Appended: calls nest (reminders names NotificationLog inside ReminderEntity).
      task.meta[ISOLATED_MODEL] = [...(task.meta[ISOLATED_MODEL] ?? []), modelName];
    });
    body();
  });
}
