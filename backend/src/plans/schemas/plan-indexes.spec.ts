// SPEC-012 (#12) AR-27 / AR-29: the plan catalog's indexes migration 0006 builds in production are
// exactly the ones the schema declares, so autoIndex (where it runs) and the migration never
// disagree, and an index changed in one place and not the other fails here.
import { describe, expect, it } from 'vitest';
import { SUBSCRIPTION_INDEXES } from '../../migrations/0006-subscription-indexes.migration.js';
import { PlanSchema } from './plan.schema.js';

describe('the plan indexes mirror the schema (no drift)', () => {
  it('plans', () => {
    const declared = PlanSchema.indexes().map(([key, options]) => ({
      key,
      ...(options['name'] ? { name: options['name'] as string } : {}),
      ...(options['unique'] ? { unique: true } : {}),
    }));

    expect(declared).toEqual(SUBSCRIPTION_INDEXES['plans']);
  });
});
