// SPEC-009 (#9) AR-27 / AR-29: the indexes migration 0012 builds in production are exactly the ones
// the schema declares, so autoIndex (where it runs) and the migration never disagree, and an index
// changed in one place and not the other fails here.
import { describe, expect, it } from 'vitest';
import type { Schema } from 'mongoose';
import { SUPPORT_REQUESTS_INDEXES } from '../../migrations/0012-support-requests-indexes.migration.js';
import { SupportCounterSchema } from './support-counter.schema.js';
import { SupportRequestSchema } from './support-request.schema.js';

describe('the indexes mirror the schemas (no drift)', () => {
  const declared = (schema: Schema) =>
    schema.indexes().map(([key, options]) => ({
      key,
      ...(options['name'] ? { name: options['name'] as string } : {}),
      ...(options['unique'] ? { unique: true } : {}),
      ...(options['partialFilterExpression']
        ? { partialFilterExpression: options['partialFilterExpression'] as object }
        : {}),
    }));

  it('supportRequests', () => {
    expect(declared(SupportRequestSchema)).toEqual(SUPPORT_REQUESTS_INDEXES);
  });

  it('counters has none beyond its _id', () => {
    expect(declared(SupportCounterSchema)).toEqual([]);
  });
});
