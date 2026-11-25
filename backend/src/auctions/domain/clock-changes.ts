// SPEC-004 BR-004-13, BR-004-25, BR-004-26: the changes the CLOCK makes. An SFI auction moves from
// its 1st to its 2nd round when the 1st round's date passes: no list and no page says so, yet the
// current minimum price and the discount change (BR-004-14) and the Radar and the digest must see
// it. The daily run compares the round that is current NOW with the round last recorded on the
// property. Pure (AR-05): "now" is an argument (AR-24).
import { toMoneyString } from '../../common/money/money.js';
import { type ChangeDraft, type ChangeType, isRelevantChange } from './change-types.js';
import { currentRound, type Round } from './rounds.js';

/** The label recorded on a property for "no round is current" (every date passed). */
export const NO_CURRENT_ROUND = null;

export interface ClockCheck {
  /**
   * The round label recorded on the property when it was last looked at: a label, null (none was
   * current), or undefined (never recorded, e.g. a property collected before this existed).
   */
  recordedLabel: string | null | undefined;
  rounds: readonly Round[];
}

export interface ClockOutcome {
  entries: ChangeDraft[];
  /** The label to record on the property now; undefined = leave it as it is. */
  label: string | null | undefined;
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
    source: 'CLOCK',
    type,
    relevant: isRelevantChange(type),
    field,
    oldValue,
    newValue,
  };
}

/**
 * The round that is current at `now` against the one recorded:
 *  - no rounds collected: unknown, nothing to say and nothing to record;
 *  - never recorded, or none was current before: record the label silently (a first look is not a
 *    change, BR-004-15);
 *  - the same round: nothing;
 *  - another round: MODALITY_OR_ROUND_CHANGED (`currentRound`), plus PRICE_DROPPED when both rounds
 *    state a price and the new one is lower (a rise is history only: PRICE_RAISED);
 *  - no round is current any more (the property is past its dates, i.e. inactive): the label is
 *    recorded as null, with no entry: BR-004-26 has no type for it.
 */
export function clockChanges(code: string, check: ClockCheck, now: Date): ClockOutcome {
  const { recordedLabel, rounds } = check;
  if (rounds.length === 0) return { entries: [], label: undefined };

  const current = currentRound(rounds, now);
  const label = current === null ? NO_CURRENT_ROUND : current.label;
  if (label === recordedLabel) return { entries: [], label: undefined };
  if (current === null || recordedLabel === undefined || recordedLabel === null) {
    return { entries: [], label };
  }

  const entries = [entry(code, 'MODALITY_OR_ROUND_CHANGED', 'currentRound', recordedLabel, label)];
  const previous = rounds.find((round) => round.label === recordedLabel)?.minimumPrice ?? null;
  const next = current.minimumPrice;
  if (previous !== null && next !== null && !previous.eq(next)) {
    const type: ChangeType = next.lt(previous) ? 'PRICE_DROPPED' : 'PRICE_RAISED';
    entries.push(
      entry(code, type, 'currentMinimumPrice', toMoneyString(previous), toMoneyString(next)),
    );
  }
  return { entries, label };
}
