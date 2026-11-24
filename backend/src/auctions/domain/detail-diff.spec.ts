// SPEC-004 BR-004-25, BR-004-26: the entries of a detail collection, every expectation worked out
// by hand. The rule under test everywhere: a change is a KNOWN value becoming another known value;
// unknown to known is the first collection (BR-004-15).
import { describe, expect, it } from 'vitest';
import { Decimal } from '../../common/money/money.js';
import { PaymentMethod } from './detail-data.js';
import { diffDetails, type CollectedDetails, type StoredDetails } from './detail-diff.js';
import type { Round } from './rounds.js';

const NOW = new Date('2026-03-05T12:00:00.000Z'); // between the two rounds below
const D1 = new Date('2026-03-03T13:00:00.000Z');
const D2 = new Date('2026-03-09T13:00:00.000Z');
const d = (value: string) => new Decimal(value);
const round = (label: string, date: Date | null, price: string | null): Round => ({
  label,
  date,
  minimumPrice: price === null ? null : d(price),
});
const SFI = [round('1º Leilão', D1, '192622.00'), round('2º Leilão', D2, '170201.84')];
const { OWN_RESOURCES, FGTS, FINANCING } = PaymentMethod;

const stored = (overrides: Partial<StoredDetails> = {}): StoredDetails => ({
  rounds: SFI,
  paymentMethods: [OWN_RESOURCES],
  ...overrides,
});
const collected = (overrides: Partial<CollectedDetails> = {}): CollectedDetails => ({
  rounds: SFI,
  paymentMethods: [OWN_RESOURCES],
  ...overrides,
});
const diff = (before: StoredDetails, after: CollectedDetails) =>
  diffDetails('8787708003668', before, after, NOW);
const types = (entries: { type: string }[]) => entries.map((entry) => entry.type);

describe('payment methods (BR-004-25, BR-004-26)', () => {
  it('records STARTED_FINANCING when a known set gains financing (the acceptance case)', () => {
    const entries = diff(stored(), collected({ paymentMethods: [OWN_RESOURCES, FINANCING] }));

    expect(entries).toEqual([
      {
        propertyCode: '8787708003668',
        source: 'DETAILS',
        type: 'STARTED_FINANCING',
        relevant: true,
        field: 'paymentMethods',
        oldValue: 'OWN_RESOURCES',
        newValue: 'FINANCING,OWN_RESOURCES',
      },
    ]);
  });

  it('records STARTED_FGTS and STARTED_FINANCING together, each its own entry', () => {
    const entries = diff(stored(), collected({ paymentMethods: [OWN_RESOURCES, FGTS, FINANCING] }));

    expect(types(entries)).toEqual(['STARTED_FINANCING', 'STARTED_FGTS']);
    expect(entries.every((entry) => entry.relevant)).toBe(true);
  });

  it('records STOPPED_FINANCING and STOPPED_FGTS as history only', () => {
    const entries = diff(
      stored({ paymentMethods: [OWN_RESOURCES, FGTS, FINANCING] }),
      collected({ paymentMethods: [OWN_RESOURCES] }),
    );

    expect(types(entries)).toEqual(['STOPPED_FINANCING', 'STOPPED_FGTS']);
    expect(entries.some((entry) => entry.relevant)).toBe(false);
  });

  it('records own resources starting or stopping as an irrelevant OTHER_FIELD', () => {
    const started = diff(
      stored({ paymentMethods: [FGTS] }),
      collected({ paymentMethods: [FGTS, OWN_RESOURCES] }),
    );
    const stopped = diff(
      stored({ paymentMethods: [FGTS, OWN_RESOURCES] }),
      collected({ paymentMethods: [FGTS] }),
    );

    expect(started).toMatchObject([
      { type: 'OTHER_FIELD', relevant: false, field: 'paymentMethods' },
    ]);
    expect(stopped).toMatchObject([
      { type: 'OTHER_FIELD', relevant: false, field: 'paymentMethods' },
    ]);
  });

  it('records nothing when the set is the same, in any order', () => {
    expect(
      diff(
        stored({ paymentMethods: [FGTS, OWN_RESOURCES] }),
        collected({ paymentMethods: [OWN_RESOURCES, FGTS] }),
      ),
    ).toEqual([]);
  });

  it('records nothing the first time the methods are known: unknown to known is not a change', () => {
    const entries = diff(
      stored({ paymentMethods: null, rounds: [] }),
      collected({ paymentMethods: [OWN_RESOURCES, FGTS, FINANCING], rounds: SFI }),
    );

    expect(entries).toEqual([]);
  });

  it('records nothing when the page states no methods: unknown never replaces known', () => {
    expect(
      diff(stored({ paymentMethods: [FINANCING] }), collected({ paymentMethods: null })),
    ).toEqual([]);
  });
});

describe('rounds (BR-004-25, BR-004-26)', () => {
  it('records NEW_DATE when a round moves to another date', () => {
    const moved = [
      round('1º Leilão', D1, '192622.00'),
      round('2º Leilão', new Date('2026-03-12T13:00:00Z'), '170201.84'),
    ];

    expect(diff(stored(), collected({ rounds: moved }))).toEqual([
      {
        propertyCode: '8787708003668',
        source: 'DETAILS',
        type: 'NEW_DATE',
        relevant: true,
        field: 'roundDates',
        oldValue: '2026-03-03T13:00:00.000Z|2026-03-09T13:00:00.000Z',
        newValue: '2026-03-03T13:00:00.000Z|2026-03-12T13:00:00.000Z',
      },
    ]);
  });

  it('records NEW_DATE when an open-ended round gets a date', () => {
    const open = [round('Venda Online', null, '100.00')];
    const dated = [round('Venda Online', D2, '100.00')];

    expect(diff(stored({ rounds: open }), collected({ rounds: dated }))).toMatchObject([
      { type: 'NEW_DATE', oldValue: 'open', newValue: '2026-03-09T13:00:00.000Z' },
    ]);
  });

  it('records MODALITY_OR_ROUND_CHANGED, and not NEW_DATE, when the rounds themselves changed', () => {
    const direct = [round('Venda Direta', null, '170201.84')];

    expect(diff(stored(), collected({ rounds: direct }))).toEqual([
      expect.objectContaining({
        type: 'MODALITY_OR_ROUND_CHANGED',
        relevant: true,
        field: 'rounds',
        oldValue: '1º Leilão|2º Leilão',
        newValue: 'Venda Direta',
      }),
    ]);
  });

  it('records PRICE_DROPPED when the CURRENT round’s price falls (the 2nd round is current)', () => {
    const cheaper = [round('1º Leilão', D1, '192622.00'), round('2º Leilão', D2, '150000.00')];

    expect(diff(stored(), collected({ rounds: cheaper }))).toEqual([
      expect.objectContaining({
        type: 'PRICE_DROPPED',
        relevant: true,
        field: 'currentMinimumPrice',
        oldValue: '170201.84',
        newValue: '150000.00',
      }),
    ]);
  });

  it('records a price rise as history only, and ignores a change of a round that is not current', () => {
    const dearer = [round('1º Leilão', D1, '192622.00'), round('2º Leilão', D2, '180000.00')];
    const otherFirst = [round('1º Leilão', D1, '100000.00'), round('2º Leilão', D2, '170201.84')];

    expect(diff(stored(), collected({ rounds: dearer }))).toMatchObject([
      { type: 'PRICE_RAISED', relevant: false },
    ]);
    expect(diff(stored(), collected({ rounds: otherFirst }))).toEqual([]);
  });

  it('records a price drop together with a moved date when both happened', () => {
    const both = [
      round('1º Leilão', D1, '192622.00'),
      round('2º Leilão', new Date('2026-03-12T13:00:00Z'), '150000.00'),
    ];

    expect(types(diff(stored(), collected({ rounds: both })))).toEqual([
      'NEW_DATE',
      'PRICE_DROPPED',
    ]);
  });

  it('records nothing when the rounds are the same', () => {
    expect(diff(stored(), collected())).toEqual([]);
  });

  it('records nothing for a price that appears or vanishes: only known to known is a change', () => {
    const noPrice = [round('1º Leilão', D1, null), round('2º Leilão', D2, null)];

    expect(diff(stored({ rounds: noPrice }), collected())).toEqual([]);
    expect(diff(stored(), collected({ rounds: noPrice }))).toEqual([]);
  });

  it('records nothing the first time the rounds are known (the first collection of a new property)', () => {
    expect(diff(stored({ rounds: [] }), collected())).toEqual([]);
  });

  it('records nothing when the page states no rounds: unknown never replaces known', () => {
    expect(diff(stored(), collected({ rounds: [] }))).toEqual([]);
  });

  it('records nothing for either field of a property seen for the first time', () => {
    expect(
      diff({ rounds: [], paymentMethods: null }, collected({ paymentMethods: [FGTS, FINANCING] })),
    ).toEqual([]);
  });
});
