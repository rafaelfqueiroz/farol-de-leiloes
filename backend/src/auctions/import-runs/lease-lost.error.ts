/**
 * SPEC-004 part 3: the worker lost the lease of its run (it stalled past the expiry): it stops
 * quietly, the new holder carries on. Thrown by every fenced write and by the lease check before a
 * request to Caixa (`EnrichmentPassInput.assertHeld`); nothing may catch it except the orchestrator.
 */
export class LeaseLostError extends Error {
  override name = 'LeaseLostError';
}
