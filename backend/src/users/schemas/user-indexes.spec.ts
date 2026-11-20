// SPEC-010 (#10) BR-010-15, AR-27 / AR-29: the purge job's scan index that migration 0009 builds in
// production is the one the user schema declares, so autoIndex (where it runs) and the migration never
// disagree.
import { describe, expect, it } from 'vitest';
import { PRIVACY_RIGHTS_INDEXES } from '../../migrations/0009-privacy-rights-indexes.migration.js';
import { UserSchema } from './user.schema.js';

describe('the users index of migration 0009 mirrors the schema (no drift)', () => {
  it('declares { status, closedAt } next to the fields, and the older indexes stay as they were', () => {
    const declared = UserSchema.indexes().map(([key]) => JSON.stringify(key));

    expect(declared).toContain(JSON.stringify({ status: 1, closedAt: 1 }));
    expect(PRIVACY_RIGHTS_INDEXES['users']).toEqual([{ key: { status: 1, closedAt: 1 } }]);
    expect(declared).toContain(JSON.stringify({ role: 1 }));
  });
});
