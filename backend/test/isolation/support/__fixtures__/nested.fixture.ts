// Fixture of the isolation gate's self-test: calls nest, and both models are covered.
import { expect, it } from 'vitest';
import { isolationSpecFor } from '../isolation-spec.js';

isolationSpecFor('OuterEntity', () => {
  isolationSpecFor('InnerEntity', () => {
    it('runs and passes', () => expect(1).toBe(1));
  });
});
