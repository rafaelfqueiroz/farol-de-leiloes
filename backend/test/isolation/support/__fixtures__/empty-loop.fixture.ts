// Fixture of the isolation gate's self-test (see vitest.fixture.config.mts); not a real spec.
import { expect, it } from 'vitest';
import { isolationSpecFor } from '../isolation-spec.js';

// Case (a): a loop over no scenarios contains an it(...) and registers none.
const scenarios: string[] = [];
isolationSpecFor('EmptyLoopEntity', () => {
  for (const scenario of scenarios) it(scenario, () => expect(scenario).toBeTruthy());
});
