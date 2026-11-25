// SPEC-004 BR-004-16, DL-004-06: whether a property is active, decided at read time against "now".
// The Mongo twin of this predicate is `activeAuctionFilter` (utils/auction-filters.ts); a test
// holds the two equal over a table of cases (test/integration/active-predicate.spec.ts).
import type { Round } from './rounds.js';

/** What the predicate reads of a property. */
export interface ActivityFacts {
  /** Marked available by the last applied list (BR-004-08). */
  available: boolean;
  rounds: readonly Pick<Round, 'date'>[];
}

/**
 * Active = available AND (no round collected yet, OR a round date still ahead, OR an open-ended
 * round). A date equal to `now` has passed (BR-004-13).
 *
 * Interpretation to confirm with the owner: BR-004-16 literally asks for a future date or an
 * open-ended round, but a property fresh from the list has no rounds until its detail page is
 * collected (BR-004-15: unknown). Requiring a date would hide every new property from search until
 * enrichment reaches it, so "no round collected yet" counts as active. A property whose dates are
 * known and all past is inactive.
 */
export function isActive(property: ActivityFacts, now: Date): boolean {
  if (!property.available) return false;
  if (property.rounds.length === 0) return true;
  return property.rounds.some(
    (round) => round.date === null || round.date.getTime() > now.getTime(),
  );
}
