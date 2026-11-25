import { describe, expect, it } from 'vitest';
import { CHANGE_TYPES, type ChangeType, isRelevantChange, isRepeat } from './change-types.js';

describe('isRelevantChange (BR-004-26)', () => {
  it.each<ChangeType>([
    'NEW',
    'RETURNED',
    'BECAME_UNAVAILABLE',
    'PRICE_DROPPED',
    'STARTED_FINANCING',
    'STARTED_FGTS',
    'MODALITY_OR_ROUND_CHANGED',
    'NEW_DATE',
  ])('%s is relevant to the Radar and the digest', (type) => {
    expect(isRelevantChange(type)).toBe(true);
  });

  it.each<ChangeType>(['PRICE_RAISED', 'STOPPED_FINANCING', 'STOPPED_FGTS', 'OTHER_FIELD'])(
    '%s is history only',
    (type) => {
      expect(isRelevantChange(type)).toBe(false);
    },
  );

  it('decides every type there is', () => {
    expect(CHANGE_TYPES).toHaveLength(12);
  });
});

describe('isRepeat (BR-004-07)', () => {
  const entry = (type: ChangeType, oldValue: string, newValue: string) => ({
    type,
    oldValue,
    newValue,
  });

  it('is a repeat when the newest entry of that type has the same values', () => {
    expect(
      isRepeat(entry('PRICE_DROPPED', '100', '90'), [entry('PRICE_DROPPED', '100', '90')]),
    ).toBe(true);
  });

  it('is not a repeat with nothing recorded, with no entry of that type, or other values', () => {
    expect(isRepeat(entry('PRICE_DROPPED', '100', '90'), [])).toBe(false);
    expect(
      isRepeat(entry('PRICE_DROPPED', '100', '90'), [entry('PRICE_RAISED', '100', '90')]),
    ).toBe(false);
    expect(
      isRepeat(entry('PRICE_DROPPED', '100', '90'), [entry('PRICE_DROPPED', '100', '80')]),
    ).toBe(false);
    expect(
      isRepeat(entry('PRICE_DROPPED', '100', '90'), [entry('PRICE_DROPPED', '110', '90')]),
    ).toBe(false);
  });

  it('is a new change when the same one happens again after it was undone', () => {
    const history = [entry('PRICE_RAISED', '90', '100'), entry('PRICE_DROPPED', '100', '90')];

    expect(isRepeat(entry('PRICE_DROPPED', '100', '90'), history)).toBe(false);
  });

  it('is a repeat when what is newer is another type of the same change', () => {
    const history = [entry('STARTED_FGTS', 'A', 'B'), entry('STARTED_FINANCING', 'A', 'B')];

    expect(isRepeat(entry('STARTED_FINANCING', 'A', 'B'), history)).toBe(true);
  });
});
