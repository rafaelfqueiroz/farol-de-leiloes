// #81, AR-28/AR-29: the saved-filter price bounds were stored as `filters.minMargin` and
// `filters.maxMargin`, names that suggested a percentage margin. They are BRL bounds on an
// auction's current-phase minimum price, so they become `filters.minPrice` and `filters.maxPrice`.
// Only the field names change: values (Decimal128 after 0001, or null) move untouched.
//
//   savedfilters   filters.minMargin → filters.minPrice,  filters.maxMargin → filters.maxPrice
//
// Idempotent (AR-29): a field is renamed only on documents that still hold the old name, so a
// re-run, a run that died halfway or an already-renamed document changes nothing. A document
// holding both the old and the new name has two competing values; the migration stops with an
// error before writing anything, rather than let `$rename` overwrite one of them.
//
// The collection is named here, not reached through the schema: a migration keeps doing what it
// did when it was written (migration.ts).
import { Logger } from '@nestjs/common';
import type { mongo } from 'mongoose';
import type { Migration } from './migration.js';

const COLLECTION = 'savedfilters';

/** The old → new field names, dotted paths in the saved filter document. */
export const PRICE_BOUND_RENAMES = [
  { from: 'filters.minMargin', to: 'filters.minPrice' },
  { from: 'filters.maxMargin', to: 'filters.maxPrice' },
] as const;

/** Documents renamed per new field, e.g. `{ 'filters.minPrice': 40, 'filters.maxPrice': 12 }`. */
export type PriceBoundCounts = Record<string, number>;

/** Thrown when a document has both names of a bound; carries a count, never document content. */
export class PriceBoundConflictError extends Error {
  constructor(readonly conflicts: number) {
    super(
      `${conflicts} saved filter(s) hold both an old and a new price-bound name; resolve them before renaming`,
    );
    this.name = 'PriceBoundConflictError';
  }
}

export async function renameSavedFilterPriceBounds(db: mongo.Db): Promise<PriceBoundCounts> {
  const collection = db.collection(COLLECTION);

  // Check every bound before writing any, so a conflict leaves the collection untouched.
  const conflicts = await collection.countDocuments({
    $or: PRICE_BOUND_RENAMES.map(({ from, to }) => ({
      [from]: { $exists: true },
      [to]: { $exists: true },
    })),
  });
  if (conflicts > 0) throw new PriceBoundConflictError(conflicts);

  const counts: PriceBoundCounts = {};
  for (const { from, to } of PRICE_BOUND_RENAMES) {
    const result = await collection.updateMany(
      // The `to` guard keeps `$rename` from ever overwriting a value, even on a concurrent write.
      { [from]: { $exists: true }, [to]: { $exists: false } },
      { $rename: { [from]: to } },
    );
    counts[to] = result.modifiedCount;
  }
  return counts;
}

export const savedFilterPriceBounds: Migration = {
  id: '0002-saved-filter-price-bounds',
  description: 'saved filters: filters.minMargin/maxMargin renamed to minPrice/maxPrice (#81)',
  async up(db) {
    const counts = await renameSavedFilterPriceBounds(db);
    // Counts only: no document content reaches the log (SC-15).
    new Logger('Migrations').log(
      `0002-saved-filter-price-bounds renamed ${JSON.stringify(counts)}`,
    );
  },
};
