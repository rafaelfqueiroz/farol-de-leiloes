// SPEC-002 BR-002-13 / AR-15 / AR-29: the index migration 0007 builds in production for the
// active-journey counter is exactly the one the schema declares (no drift).
import { describe, expect, it } from 'vitest';
import { BILLING_INDEXES } from '../../migrations/0007-billing-indexes.migration.js';
import { OwnerCounterSchema } from './owner-counter.schema.js';

describe('the owner counter index mirrors the schema (no drift)', () => {
  it('ownerCounters', () => {
    const declared = OwnerCounterSchema.indexes().map(([key, options]) => ({
      key,
      ...(options['unique'] ? { unique: true } : {}),
    }));

    expect(declared).toEqual(BILLING_INDEXES['ownerCounters']);
  });
});
