// SPEC-012 (#12) AR-27 / AR-29: the indexes migration 0006 builds in production are exactly the ones
// these schemas declare, so autoIndex (where it runs) and the migration never disagree, and an
// index changed in one place and not the other fails here. (The plan catalog's are in
// plans/schemas/plan-indexes.spec.ts: AR-09 keeps each schema inside its module.)
import { describe, expect, it } from 'vitest';
import type { Schema } from 'mongoose';
import { SUBSCRIPTION_INDEXES } from '../../migrations/0006-subscription-indexes.migration.js';
import { PaymentEventSchema } from './payment-event.schema.js';
import { SubscriptionSchema } from './subscription.schema.js';

describe('the indexes mirror the schemas (no drift)', () => {
  const declared = (schema: Schema) =>
    schema.indexes().map(([key, options]) => ({
      key,
      ...(options['name'] ? { name: options['name'] as string } : {}),
      ...(options['unique'] ? { unique: true } : {}),
      ...(options['sparse'] ? { sparse: true } : {}),
      ...(options['partialFilterExpression']
        ? { partialFilterExpression: options['partialFilterExpression'] as object }
        : {}),
    }));

  it('subscriptions', () => {
    expect(declared(SubscriptionSchema)).toEqual(SUBSCRIPTION_INDEXES['subscriptions']);
  });

  it('paymentEvents', () => {
    expect(declared(PaymentEventSchema)).toEqual(SUBSCRIPTION_INDEXES['paymentEvents']);
  });
});
