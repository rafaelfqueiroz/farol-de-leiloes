// SPEC-002 TS-13 / TS-14: how an isolation spec says which model it proves. The gate
// (../model-coverage.isolation.spec.ts) finds these calls by parsing every
// test/isolation/**/*.isolation.spec.ts file (support/isolation-coverage.ts), so the covered models
// are never a hand-kept list. Only a real call with a literal name counts, its body must run a test,
// and a file that skips or focuses tests covers nothing.
// The name is the Mongoose model name, as `connection.modelNames()` lists it (e.g. 'FavoriteEntity').
import { describe } from 'vitest';

export function isolationSpecFor(modelName: string, body: () => void): void {
  describe(`isolation of ${modelName} through the API (TS-13)`, body);
}
