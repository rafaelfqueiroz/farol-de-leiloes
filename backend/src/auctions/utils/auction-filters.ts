import { serverOperators } from '../../common/mongo/query-safety.js';

/**
 * SPEC-004 BR-004-16, DL-004-06: the MongoDB twin of the pure `isActive` (domain/active.ts), the
 * ONE definition of "active" that search, the sitemap, the neighborhoods list and favorites use.
 * `test/integration/active-predicate.spec.ts` holds the two equal over a table of cases.
 *
 *   available AND ( no round collected yet            -> rounds absent or empty
 *                   OR a round date still ahead       -> rounds.date > now
 *                   OR an open-ended round )          -> a round with no date
 *
 * "Now" is an argument (AR-24). Every operator is server-written, so each is wrapped where it
 * sits (SC-10), including inside `$or`, where a wrapper around the whole array does not reach
 * the branches under `sanitizeFilter` (#100).
 */
export function activeAuctionFilter(now: Date): Record<string, unknown> {
  return {
    available: true,
    $or: [
      { 'rounds.0': serverOperators({ $exists: false }) },
      { 'rounds.date': serverOperators({ $gt: now }) },
      { rounds: serverOperators({ $elemMatch: { date: null } }) },
    ],
  };
}
