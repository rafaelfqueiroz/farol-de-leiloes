// SPEC-012 (#12) BR-012-07, BR-012-08, BR-012-24, AR-15 / AR-27 / AR-29: the indexes the billing PR
// adds, built by the deploy's migration step (DV-34) instead of relying on Mongoose's autoIndex:
//
//   subscriptions   { openCheckoutKey: 1 } unique, partial on the key existing, named
//                   one_open_checkout_per_key — never two open checkouts for one office, or for
//                   one buyer without an office, whatever races
//                   { status: 1, lastSyncedAt: 1 } — the reconcile job's read, oldest sync first
//                   { status: 1, createdAt: 1 } — the purge of abandoned checkouts
//   ownerCounters   { ownerType: 1, ownerId: 1, key: 1 } unique — the active-journey counter is
//                   created by an upsert, and the unique key is what keeps two racing first
//                   acquires from making two counters (AR-15). The journey slots are the first
//                   production caller of this collection.
//
// The specs are the ones the schemas declare (subscriptions/schemas/subscription-indexes.spec.ts and
// access/schemas/owner-counter-indexes.spec.ts fail on any drift), so autoIndex, where it still
// runs, finds them in place and changes nothing.
//
// Idempotent (AR-29): createIndexes with an index that already exists with the same keys and
// options is a no-op. It creates the collections when missing. The collections are named here, not
// reached through the schemas (migration.ts).
import { Logger } from '@nestjs/common';
import type { mongo } from 'mongoose';
import type { Migration } from './migration.js';

export const BILLING_INDEXES: Readonly<Record<string, readonly mongo.IndexDescription[]>> = {
  subscriptions: [
    {
      key: { openCheckoutKey: 1 },
      name: 'one_open_checkout_per_key',
      unique: true,
      partialFilterExpression: { openCheckoutKey: { $exists: true } },
    },
    { key: { status: 1, lastSyncedAt: 1 } },
    { key: { status: 1, createdAt: 1 } },
  ],
  ownerCounters: [{ key: { ownerType: 1, ownerId: 1, key: 1 }, unique: true }],
};

/** Creates every index above; answers the index names per collection. */
export async function createBillingIndexes(db: mongo.Db): Promise<Record<string, string[]>> {
  const created: Record<string, string[]> = {};
  for (const [collection, indexes] of Object.entries(BILLING_INDEXES)) {
    created[collection] = await db.collection(collection).createIndexes([...indexes]);
  }
  return created;
}

export const billingIndexes: Migration = {
  id: '0007-billing-indexes',
  description:
    'subscriptions: one open checkout per key, reconcile and purge indexes; ownerCounters: unique owner counter (SPEC-012)',
  async up(db) {
    const created = await createBillingIndexes(db);
    // Index names only: no document content reaches the log (SC-15).
    new Logger('Migrations').log(`0007-billing-indexes ${JSON.stringify(created)}`);
  },
};
