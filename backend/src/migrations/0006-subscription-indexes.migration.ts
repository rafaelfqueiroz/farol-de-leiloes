// SPEC-012 (#12) BR-012-02, BR-012-08, BR-012-13, SC-11, AR-27 / AR-29: the indexes of the plan
// catalog, the office subscriptions and the provider event ledger, built by the deploy's
// migration step (DV-34) instead of relying on Mongoose's autoIndex at boot:
//
//   plans            { code: 1 } unique, { stripePriceId: 1 } unique — the catalog script upserts by
//                    code, and a provider price belongs to one plan
//                    { status: 1, sortOrder: 1 } — the public plans page
//   subscriptions    { stripeSubscriptionId: 1 } unique sparse, { checkoutSessionId: 1 } unique
//                    sparse — a provider object is stored once
//                    { officeId: 1 } unique, partial on an existing officeId and a status in effect
//                    (ACTIVE, PAST_DUE, CANCELING), named one_in_effect_subscription_per_office —
//                    BR-012-08: never two in effect for one office, whatever races
//                    { officeId: 1, createdAt: -1 } — an office's history
//   paymentEvents    { stripeEventId: 1 } unique — SC-11: idempotency by event id
//
// The specs are the ones the schemas declare (subscriptions/schemas/subscription-indexes.spec.ts
// fails on any drift), so autoIndex, where it still runs, finds them in place and changes nothing.
//
// Idempotent (AR-29): createIndexes with an index that already exists with the same keys and
// options is a no-op, so a second run changes nothing. It creates the collections when missing.
// The collections are named here, not reached through the schemas (migration.ts).
import { Logger } from '@nestjs/common';
import type { mongo } from 'mongoose';
import type { Migration } from './migration.js';

export const SUBSCRIPTION_INDEXES: Readonly<Record<string, readonly mongo.IndexDescription[]>> = {
  plans: [
    { key: { code: 1 }, unique: true },
    { key: { stripePriceId: 1 }, unique: true },
    { key: { status: 1, sortOrder: 1 } },
  ],
  subscriptions: [
    { key: { stripeSubscriptionId: 1 }, unique: true, sparse: true },
    { key: { checkoutSessionId: 1 }, unique: true, sparse: true },
    {
      key: { officeId: 1 },
      name: 'one_in_effect_subscription_per_office',
      unique: true,
      partialFilterExpression: {
        officeId: { $exists: true },
        status: { $in: ['ACTIVE', 'PAST_DUE', 'CANCELING'] },
      },
    },
    { key: { officeId: 1, createdAt: -1 } },
  ],
  paymentEvents: [{ key: { stripeEventId: 1 }, unique: true }],
};

/** Creates every index above; answers the index names per collection. */
export async function createSubscriptionIndexes(db: mongo.Db): Promise<Record<string, string[]>> {
  const created: Record<string, string[]> = {};
  for (const [collection, indexes] of Object.entries(SUBSCRIPTION_INDEXES)) {
    created[collection] = await db.collection(collection).createIndexes([...indexes]);
  }
  return created;
}

export const subscriptionIndexes: Migration = {
  id: '0006-subscription-indexes',
  description:
    'plans, subscriptions and paymentEvents: unique and partial indexes (one in effect per office, one event per id) (SPEC-012)',
  async up(db) {
    const created = await createSubscriptionIndexes(db);
    // Index names only: no document content reaches the log (SC-15).
    new Logger('Migrations').log(`0006-subscription-indexes ${JSON.stringify(created)}`);
  },
};
