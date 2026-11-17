// Fixture of the isolation gate's self-test (see vitest.fixture.config.mts); not a real spec.
import { expect, it } from 'vitest';
import { isolationSpecFor } from '../isolation-spec.js';

// Case (c): a helper that registers tests and is never called.
isolationSpecFor('UncalledHelperEntity', () => {
  const registerScenarios = () => it('never registered', () => expect(1).toBe(1));
  void registerScenarios;
});
