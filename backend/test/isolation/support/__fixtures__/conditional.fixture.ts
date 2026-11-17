// Fixture of the isolation gate's self-test (see vitest.fixture.config.mts); not a real spec.
import { expect, it } from 'vitest';
import { isolationSpecFor } from '../isolation-spec.js';

// Case (b): an environment-conditional registration that is off in this run.
isolationSpecFor('ConditionalEntity', () => {
  if (process.env.FIXTURE_NEVER_SET === '1') it('runs only on demand', () => expect(1).toBe(1));
});
