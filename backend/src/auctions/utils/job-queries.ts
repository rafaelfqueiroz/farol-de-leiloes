import { serverOperators } from '../../common/mongo/query-safety.js';

/**
 * The filters the scheduled Caixa jobs run. SC-10: they are written by the server, so every
 * operator is wrapped in `serverOperators` where it sits (under its field), including inside
 * `$or`. With `sanitizeFilter` on (the production setting) a wrapper around the whole `$or` array
 * does not reach the operators nested in its branches, and Mongoose casts them as values (#100).
 * `test/integration/job-queries.spec.ts` runs them against MongoDB under that setting.
 */

/** Fulfilled, available auctions outside today's list not checked since `cutoff` (BR-004-12). */
export function missingFromListFilter(csvCodes: readonly string[], cutoff: Date) {
  return {
    fulfilled: true,
    available: true,
    detailsUrl: serverOperators({ $exists: true, $ne: null }),
    code: serverOperators({ $nin: [...csvCodes] }),
    $or: [
      { availabilityCheckedAt: serverOperators({ $exists: false }) },
      { availabilityCheckedAt: serverOperators({ $lt: cutoff }) },
    ],
  };
}

/** Auctions with a details page that has not been scraped yet. */
export function unfulfilledWithDetailsFilter() {
  return {
    detailsUrl: serverOperators({ $exists: true, $ne: null }),
    $or: [{ fulfilled: serverOperators({ $exists: false }) }, { fulfilled: false }],
  };
}
