// SPEC-009 (#9) AR-27 / AR-29: the index migration 0013 builds in production is exactly the one the
// schema declares, so autoIndex (where it runs) and the migration never disagree.
import { describe, expect, it } from 'vitest';
import type { Schema } from 'mongoose';
import { ACCOUNT_STATUS_EVENTS_INDEXES } from '../../migrations/0013-account-status-events-indexes.migration.js';
import { AccountStatusEventSchema } from './account-status-event.schema.js';

describe('the indexes mirror the schema (no drift)', () => {
  const declared = (schema: Schema) =>
    schema.indexes().map(([key, options]) => ({
      key,
      ...(options['name'] ? { name: options['name'] as string } : {}),
      ...(options['unique'] ? { unique: true } : {}),
    }));

  it('accountStatusEvents', () => {
    expect(declared(AccountStatusEventSchema)).toEqual(ACCOUNT_STATUS_EVENTS_INDEXES);
  });
});
