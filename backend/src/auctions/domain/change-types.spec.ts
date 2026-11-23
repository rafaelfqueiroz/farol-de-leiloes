import { describe, expect, it } from 'vitest';
import { CHANGE_TYPES, type ChangeType, isRelevantChange } from './change-types.js';

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
