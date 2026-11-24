// SPEC-004 BR-004-13, BR-004-26: the changes the clock makes. The SFI case of the acceptance
// criteria: the 1st round on D at 10h00 Brasília, the 2nd on D+6 at 10h00.
import { describe, expect, it } from 'vitest';
import { Decimal } from '../../common/money/money.js';
import { clockChanges } from './clock-changes.js';
import type { Round } from './rounds.js';

const FIRST_END = new Date('2026-03-03T13:00:00.000Z'); // 03/03/2026 10h00 Brasília
const SECOND_END = new Date('2026-03-09T13:00:00.000Z');
const d = (value: string) => new Decimal(value);
const SFI: Round[] = [
  { label: '1º Leilão', date: FIRST_END, minimumPrice: d('192622.00') },
  { label: '2º Leilão', date: SECOND_END, minimumPrice: d('170201.84') },
];
const BEFORE_FIRST_END = new Date('2026-03-03T12:59:59.999Z');
const AT_FIRST_END = FIRST_END;
const AFTER_SECOND_END = SECOND_END;

describe('clockChanges', () => {
  it('records the round change at the instant the 1st round ends, with the price drop', () => {
    const outcome = clockChanges(
      '8787708003668',
      { recordedLabel: '1º Leilão', rounds: SFI },
      AT_FIRST_END,
    );

    expect(outcome).toEqual({
      label: '2º Leilão',
      entries: [
        {
          propertyCode: '8787708003668',
          source: 'CLOCK',
          type: 'MODALITY_OR_ROUND_CHANGED',
          relevant: true,
          field: 'currentRound',
          oldValue: '1º Leilão',
          newValue: '2º Leilão',
        },
        {
          propertyCode: '8787708003668',
          source: 'CLOCK',
          type: 'PRICE_DROPPED',
          relevant: true,
          field: 'currentMinimumPrice',
          oldValue: '192622.00',
          newValue: '170201.84',
        },
      ],
    });
  });

  it('records nothing one millisecond before the 1st round ends, and nothing again afterwards', () => {
    expect(
      clockChanges('1', { recordedLabel: '1º Leilão', rounds: SFI }, BEFORE_FIRST_END),
    ).toEqual({
      entries: [],
      label: undefined,
    });
    expect(clockChanges('1', { recordedLabel: '2º Leilão', rounds: SFI }, AT_FIRST_END)).toEqual({
      entries: [],
      label: undefined,
    });
  });

  it('records a price rise as history only', () => {
    const dearer: Round[] = [
      { label: '1º Leilão', date: FIRST_END, minimumPrice: d('100.00') },
      { label: '2º Leilão', date: SECOND_END, minimumPrice: d('120.00') },
    ];

    const { entries } = clockChanges(
      '1',
      { recordedLabel: '1º Leilão', rounds: dearer },
      AT_FIRST_END,
    );

    expect(entries.map((entry) => [entry.type, entry.relevant])).toEqual([
      ['MODALITY_OR_ROUND_CHANGED', true],
      ['PRICE_RAISED', false],
    ]);
  });

  it('records no price entry when either round states no price, or the prices are equal', () => {
    const withoutPrice: Round[] = [
      { label: '1º Leilão', date: FIRST_END, minimumPrice: null },
      { label: '2º Leilão', date: SECOND_END, minimumPrice: d('1.00') },
    ];
    const noSecondPrice: Round[] = [
      { label: '1º Leilão', date: FIRST_END, minimumPrice: d('1.00') },
      { label: '2º Leilão', date: SECOND_END, minimumPrice: null },
    ];
    const equal: Round[] = [
      { label: '1º Leilão', date: FIRST_END, minimumPrice: d('1.00') },
      { label: '2º Leilão', date: SECOND_END, minimumPrice: d('1.0') },
    ];

    for (const rounds of [withoutPrice, noSecondPrice, equal]) {
      const { entries } = clockChanges('1', { recordedLabel: '1º Leilão', rounds }, AT_FIRST_END);
      expect(entries.map((entry) => entry.type)).toEqual(['MODALITY_OR_ROUND_CHANGED']);
    }
  });

  it('has no price to compare when the recorded round is no longer among the rounds', () => {
    const { entries } = clockChanges(
      '1',
      { recordedLabel: 'Licitação', rounds: SFI },
      AT_FIRST_END,
    );

    expect(entries.map((entry) => entry.type)).toEqual(['MODALITY_OR_ROUND_CHANGED']);
  });

  it('records the label silently when none was recorded yet: a first look is not a change', () => {
    expect(clockChanges('1', { recordedLabel: undefined, rounds: SFI }, AT_FIRST_END)).toEqual({
      entries: [],
      label: '2º Leilão',
    });
  });

  it('records a round that becomes current after none was, silently', () => {
    expect(clockChanges('1', { recordedLabel: null, rounds: SFI }, BEFORE_FIRST_END)).toEqual({
      entries: [],
      label: '1º Leilão',
    });
  });

  it('records null, with no entry, when the last round has passed (the property is inactive)', () => {
    expect(
      clockChanges('1', { recordedLabel: '2º Leilão', rounds: SFI }, AFTER_SECOND_END),
    ).toEqual({
      entries: [],
      label: null,
    });
    // ... and says nothing more on the next look.
    expect(clockChanges('1', { recordedLabel: null, rounds: SFI }, AFTER_SECOND_END)).toEqual({
      entries: [],
      label: undefined,
    });
  });

  it('says nothing about a property whose rounds were not collected: unknown', () => {
    expect(clockChanges('1', { recordedLabel: undefined, rounds: [] }, AT_FIRST_END)).toEqual({
      entries: [],
      label: undefined,
    });
    expect(clockChanges('1', { recordedLabel: '1º Leilão', rounds: [] }, AT_FIRST_END)).toEqual({
      entries: [],
      label: undefined,
    });
  });

  it('never changes an open-ended round (a direct sale has no clock)', () => {
    const direct: Round[] = [{ label: 'Venda Direta', date: null, minimumPrice: d('1.00') }];

    expect(
      clockChanges('1', { recordedLabel: 'Venda Direta', rounds: direct }, AFTER_SECOND_END),
    ).toEqual({
      entries: [],
      label: undefined,
    });
  });
});
