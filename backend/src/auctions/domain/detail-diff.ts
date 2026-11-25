// SPEC-004 BR-004-25, BR-004-26: the change entries a detail collection records for a property,
// from what was stored before and what the page says now. Pure (AR-05): "now" is an argument.
//
// The rule that shapes everything here (BR-004-15): a change is a KNOWN value becoming another
// KNOWN value. A field that was unknown (never collected, or dropped when the property came back)
// and is now known is the first collection, not a change: a property seen for the first time
// emits no STARTED_FINANCING, no NEW_DATE and no price drop. And a field the page does not state
// never counts as a change either (unknown does not replace known).
import { toMoneyString } from '../../common/money/money.js';
import { type ChangeDraft, type ChangeType, isRelevantChange } from './change-types.js';
import { PaymentMethod } from './detail-data.js';
import { currentRound, type Round } from './rounds.js';

/** What the diff reads of the stored property. */
export interface StoredDetails {
  /** Empty = never collected, or dropped: unknown. */
  rounds: readonly Round[];
  /** Null = unknown. */
  paymentMethods: readonly PaymentMethod[] | null;
}

/** What the page says now; an empty `rounds` or a null `paymentMethods` is "the page says nothing". */
export interface CollectedDetails {
  rounds: readonly Round[];
  paymentMethods: readonly PaymentMethod[] | null;
}

function entry(
  code: string,
  type: ChangeType,
  field: string,
  oldValue: ChangeDraft['oldValue'],
  newValue: ChangeDraft['newValue'],
): ChangeDraft {
  return {
    propertyCode: code,
    source: 'DETAILS',
    type,
    relevant: isRelevantChange(type),
    field,
    oldValue,
    newValue,
  };
}

const methodsText = (methods: readonly PaymentMethod[]): string => [...methods].sort().join(',');
const labelsText = (rounds: readonly Round[]): string =>
  rounds.map((round) => round.label).join('|');
const datesText = (rounds: readonly Round[]): string =>
  rounds.map((round) => round.date?.toISOString() ?? 'open').join('|');

function paymentEntries(
  code: string,
  before: readonly PaymentMethod[],
  after: readonly PaymentMethod[],
): ChangeDraft[] {
  const entries: ChangeDraft[] = [];
  const oldText = methodsText(before);
  const newText = methodsText(after);
  const flip = (method: PaymentMethod, started: ChangeType, stopped: ChangeType | null) => {
    const had = before.includes(method);
    const has = after.includes(method);
    if (!had && has) entries.push(entry(code, started, 'paymentMethods', oldText, newText));
    if (had && !has) {
      entries.push(entry(code, stopped ?? 'OTHER_FIELD', 'paymentMethods', oldText, newText));
    }
  };
  flip(PaymentMethod.FINANCING, 'STARTED_FINANCING', 'STOPPED_FINANCING');
  flip(PaymentMethod.FGTS, 'STARTED_FGTS', 'STOPPED_FGTS');
  // Own resources are tracked (BR-004-25) but have no type of their own: history only.
  flip(PaymentMethod.OWN_RESOURCES, 'OTHER_FIELD', null);
  return entries;
}

function roundEntries(
  code: string,
  before: readonly Round[],
  after: readonly Round[],
  now: Date,
): ChangeDraft[] {
  const entries: ChangeDraft[] = [];
  if (labelsText(before) !== labelsText(after)) {
    // Another structure of rounds: a 1st/2nd auction became a direct sale, a round was added.
    entries.push(
      entry(code, 'MODALITY_OR_ROUND_CHANGED', 'rounds', labelsText(before), labelsText(after)),
    );
  } else if (datesText(before) !== datesText(after)) {
    // The same rounds on other dates: a date appeared or moved.
    entries.push(entry(code, 'NEW_DATE', 'roundDates', datesText(before), datesText(after)));
  }
  const was = currentRound(before, now)?.minimumPrice ?? null;
  const is = currentRound(after, now)?.minimumPrice ?? null;
  if (was !== null && is !== null && !was.eq(is)) {
    const type: ChangeType = is.lt(was) ? 'PRICE_DROPPED' : 'PRICE_RAISED';
    entries.push(entry(code, type, 'currentMinimumPrice', toMoneyString(was), toMoneyString(is)));
  }
  return entries;
}

/**
 * The entries of one collection, BR-004-25 / BR-004-26:
 *  - payment methods: STARTED_/STOPPED_FINANCING and _FGTS, OTHER_FIELD for own resources;
 *  - rounds: MODALITY_OR_ROUND_CHANGED when their labels changed, NEW_DATE when a date appeared or
 *    moved, PRICE_DROPPED / PRICE_RAISED when the CURRENT round's minimum price changed;
 * each only when the stored value was known and the page states a new one.
 */
export function diffDetails(
  code: string,
  before: StoredDetails,
  after: CollectedDetails,
  now: Date,
): ChangeDraft[] {
  const entries: ChangeDraft[] = [];
  if (before.paymentMethods !== null && after.paymentMethods !== null) {
    entries.push(...paymentEntries(code, before.paymentMethods, after.paymentMethods));
  }
  if (before.rounds.length > 0 && after.rounds.length > 0) {
    entries.push(...roundEntries(code, before.rounds, after.rounds, now));
  }
  return entries;
}
