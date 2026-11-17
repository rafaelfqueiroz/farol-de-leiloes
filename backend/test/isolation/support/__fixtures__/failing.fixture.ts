// Fixture of the isolation gate's self-test (see vitest.fixture.config.mts); not a real spec.
import { expect, it } from 'vitest';
import { isolationSpecFor } from '../isolation-spec.js';

isolationSpecFor('FailingEntity', () => {
  it('runs and fails', () => expect(1).toBe(2));
});
