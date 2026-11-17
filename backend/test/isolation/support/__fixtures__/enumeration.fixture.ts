// Fixture of the isolation gate's self-test (see vitest.fixture.config.mts); not a real spec.
import { expect, it } from 'vitest';
import { REQUIRED_MODELS } from '../executed-isolation.js';
it('declares the required models', ({ task }) => {
  task.meta[REQUIRED_MODELS] = (process.env.FIXTURE_REQUIRED ?? '').split(',').filter(Boolean);
  expect(true).toBe(true);
});
