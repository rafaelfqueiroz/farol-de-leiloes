// SPEC-004 BR-004-02, BR-004-04: whether a downloaded list may be applied. Pure (AR-05): it gets
// the facts the parser read and the last applied list's, and answers with a verdict and a reason
// CODE. It never carries a row, a cell or a value (SC-15), so the verdict can be logged and
// recorded on the Import Run as it is.
import { Decimal } from '../../common/money/money.js';

/** What the parser found in a list. Counts and a day, never content. */
export interface ListFacts {
  /** A header row with the labels of the list was found. */
  headerFound: boolean;
  /** Required columns the header lacks (ListColumn names). */
  missingColumns: readonly string[];
  /** Brasília calendar day the list was generated, `YYYY-MM-DD`; null when absent or unreadable. */
  generatedOn: string | null;
  /** Property rows after the header, blank lines excluded. */
  rowCount: number;
}

/** The list applied last: BR-004-02's reference. Null for the very first list. */
export interface LastAppliedList {
  generatedOn: string;
  rowCount: number;
}

export type ListRejectionReason =
  | 'UNRECOGNISED_LAYOUT'
  | 'MISSING_COLUMNS'
  | 'NO_GENERATION_DATE'
  | 'EMPTY_LIST'
  | 'TRUNCATED_LIST';

export type ListVerdict =
  | { kind: 'valid' }
  /** Not later than the last applied list: no new list yet (BR-004-02), not a bad one. */
  | { kind: 'not_new'; generatedOn: string }
  /** BR-004-04: nothing from it is applied. */
  | { kind: 'rejected'; reason: ListRejectionReason };

/**
 * The checks, in order: layout, generation date, newer than the last applied list, not empty, and
 * at least `minRowRatio` of the last applied list's rows. A list that is not new is not judged on
 * its content: it is simply not new.
 *
 *   last applied: 5000 rows; minRowRatio 0.8 -> 4000 rows is valid, 3999 is TRUNCATED_LIST
 */
export function validateList(
  facts: ListFacts,
  last: LastAppliedList | null,
  minRowRatio: number,
): ListVerdict {
  if (!facts.headerFound) return { kind: 'rejected', reason: 'UNRECOGNISED_LAYOUT' };
  if (facts.missingColumns.length > 0) return { kind: 'rejected', reason: 'MISSING_COLUMNS' };
  if (facts.generatedOn === null) return { kind: 'rejected', reason: 'NO_GENERATION_DATE' };
  // `YYYY-MM-DD` strings order as the days do.
  if (last !== null && facts.generatedOn <= last.generatedOn) {
    return { kind: 'not_new', generatedOn: facts.generatedOn };
  }
  if (facts.rowCount === 0) return { kind: 'rejected', reason: 'EMPTY_LIST' };
  // AR-18: a ratio is a Decimal. 0.7 x 10 is 7.000000000000001 in a float, which would refuse 7.
  if (last !== null && new Decimal(minRowRatio).times(last.rowCount).gt(facts.rowCount)) {
    return { kind: 'rejected', reason: 'TRUNCATED_LIST' };
  }
  return { kind: 'valid' };
}
