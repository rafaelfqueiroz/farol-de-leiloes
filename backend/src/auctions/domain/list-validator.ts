// SPEC-004 BR-004-02, BR-004-04: whether a downloaded list may be applied. Pure (AR-05): it gets
// the facts the parser read and the last applied list's, and answers with a verdict and a reason
// CODE. It never carries a row, a cell or a value (SC-15), so the verdict can be logged and
// recorded on the Import Run as it is.
import { addCalendarDays } from '../../common/domain/business-day.js';
import { Decimal } from '../../common/money/money.js';

/**
 * BR-004-04: the share of a list's rows that may lack a property number before the list is
 * refused. A renamed or emptied number column makes every row unusable; a few stray lines do not.
 */
export const MAX_ROWS_WITHOUT_CODE_SHARE = '0.01';
/**
 * BR-004-15, AR-17: the share of rows whose price or appraisal cell is filled but unreadable
 * (a changed money format) before the list is refused. An EMPTY cell is not counted: Caixa leaves
 * the price of a direct sale empty.
 */
export const MAX_UNREADABLE_MONEY_SHARE = '0.1';

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
  /** DISTINCT property numbers among the rows: what the list actually lists (BR-004-05). */
  usableCodeCount: number;
  /** Rows with no property number: unusable. */
  rowsWithoutCode: number;
  /** Rows whose price or appraisal cell is filled but not a pt-BR amount. */
  unreadableMoneyRows: number;
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
  | 'GENERATION_DATE_IN_FUTURE'
  | 'TOO_MANY_ROWS_WITHOUT_CODE'
  | 'UNREADABLE_PRICES'
  | 'TRUNCATED_LIST';

export type ListVerdict =
  | { kind: 'valid' }
  /** Not later than the last applied list: no new list yet (BR-004-02), not a bad one. */
  | { kind: 'not_new'; generatedOn: string }
  /** BR-004-04: nothing from it is applied. */
  | { kind: 'rejected'; reason: ListRejectionReason };

/**
 * The checks, in order: layout, generation date (present, and not later than tomorrow in
 * Brasília: a mis-set date would make every real list "not new" afterwards), newer than the last
 * applied list, not empty, few rows without a property number, few unreadable prices, and at least
 * `minRowRatio` of the last applied list's rows. The ratio counts DISTINCT usable property numbers,
 * not raw lines, so a list of one repeated number or of rows with the number column renamed cannot
 * pass as a full one. A list that is not new is not judged on its content: it is simply not new.
 *
 *   last applied: 5000 rows; minRowRatio 0.8 -> 4000 numbers is valid, 3999 is TRUNCATED_LIST
 *
 * `today` is the Brasília calendar day of the run (AR-22, AR-24).
 */
export function validateList(
  facts: ListFacts,
  last: LastAppliedList | null,
  minRowRatio: number,
  today: string,
): ListVerdict {
  if (!facts.headerFound) return { kind: 'rejected', reason: 'UNRECOGNISED_LAYOUT' };
  if (facts.missingColumns.length > 0) return { kind: 'rejected', reason: 'MISSING_COLUMNS' };
  if (facts.generatedOn === null) return { kind: 'rejected', reason: 'NO_GENERATION_DATE' };
  // `YYYY-MM-DD` strings order as the days do.
  if (facts.generatedOn > addCalendarDays(today, 1)) {
    return { kind: 'rejected', reason: 'GENERATION_DATE_IN_FUTURE' };
  }
  if (last !== null && facts.generatedOn <= last.generatedOn) {
    return { kind: 'not_new', generatedOn: facts.generatedOn };
  }
  if (facts.rowCount === 0) return { kind: 'rejected', reason: 'EMPTY_LIST' };
  // AR-18: shares and ratios are Decimals. 0.7 x 10 is 7.000000000000001 in a float.
  if (new Decimal(MAX_ROWS_WITHOUT_CODE_SHARE).times(facts.rowCount).lt(facts.rowsWithoutCode)) {
    return { kind: 'rejected', reason: 'TOO_MANY_ROWS_WITHOUT_CODE' };
  }
  if (new Decimal(MAX_UNREADABLE_MONEY_SHARE).times(facts.rowCount).lt(facts.unreadableMoneyRows)) {
    return { kind: 'rejected', reason: 'UNREADABLE_PRICES' };
  }
  if (last !== null && new Decimal(minRowRatio).times(last.rowCount).gt(facts.usableCodeCount)) {
    return { kind: 'rejected', reason: 'TRUNCATED_LIST' };
  }
  return { kind: 'valid' };
}

/**
 * BR-004-08, DL-004-03: whether marking `unseen` available properties unavailable stays within
 * what a market can plausibly do in a day, `1 - minRowRatio` of the `available` ones. The list
 * checks above cannot see a list that is fine against its predecessor but not against the
 * catalogue (the very first list, or a repeated-number list over a legacy catalogue), so the
 * apply asks this before it hides anything. Exact (Decimal); at the limit it is allowed.
 *
 *   available 100, minRowRatio 0.8 -> 20 unseen is allowed, 21 is not
 */
export function sweepWithinLimit(unseen: number, available: number, minRowRatio: number): boolean {
  return new Decimal(1).minus(minRowRatio).times(available).gte(unseen);
}
