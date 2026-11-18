// SPEC-012 (ADR-005): the windows of the reconcile job.
import { describe, expect, it } from 'vitest';
import { reconcileCutoffs } from './reconcile-window.js';

describe('reconcileCutoffs', () => {
  it('re-reads what was synced more than 12 hours ago, and lapses of the last 14 days', () => {
    const cutoffs = reconcileCutoffs(new Date('2026-03-20T12:00:00.000Z'));

    // 2026-03-20T12:00Z - 12 h = 2026-03-20T00:00Z; - 14 d = 2026-03-06T12:00Z; - 3 d = 03-17T12:00Z
    expect(cutoffs.staleBefore.toISOString()).toBe('2026-03-20T00:00:00.000Z');
    expect(cutoffs.lapsedSince.toISOString()).toBe('2026-03-06T12:00:00.000Z');
    expect(cutoffs.pendingBefore.toISOString()).toBe('2026-03-17T12:00:00.000Z');
  });
});
