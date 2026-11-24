// SPEC-004 BR-004-13, BR-004-14: the current round and the discount, every expectation worked out
// by hand. The acceptance case of an SFI auction across the zone matrix is sfi-rounds.spec.ts.
import { describe, expect, it } from 'vitest';
import { Decimal } from '../../common/money/money.js';
import { PhaseModality } from './modality.js';
import {
  currentMinimumPrice,
  currentRound,
  discountPercent,
  type Round,
  roundsFromPhaseDates,
} from './rounds.js';

const d = (value: string) => new Decimal(value);
const round = (label: string, date: string | null, price: string | null = null): Round => ({
  label,
  date: date === null ? null : new Date(date),
  minimumPrice: price === null ? null : d(price),
});
const NOW = new Date('2026-03-10T13:00:00.000Z');

describe('currentRound (BR-004-13)', () => {
  it('is null with no rounds (not collected yet) and when every date has passed', () => {
    expect(currentRound([], NOW)).toBeNull();
    expect(currentRound([round('1º Leilão', '2026-03-10T13:00:00Z')], NOW)).toBeNull();
  });

  it('is the earliest round whose date has not passed, whatever the order stored', () => {
    const first = round('1º Leilão', '2026-03-10T13:00:01Z');
    const second = round('2º Leilão', '2026-03-16T13:00:00Z');
    expect(currentRound([second, first], NOW)).toBe(first);
    expect(currentRound([first, second], NOW)).toBe(first);
  });

  it('moves to the next round at the instant the previous date is reached', () => {
    const first = round('1º Leilão', '2026-03-10T13:00:00Z');
    const second = round('2º Leilão', '2026-03-16T13:00:00Z');
    expect(currentRound([first, second], new Date('2026-03-10T12:59:59.999Z'))).toBe(first);
    expect(currentRound([first, second], NOW)).toBe(second);
  });

  it('has an open-ended round (no date) as the last one', () => {
    const open = round('Venda Direta', null);
    const dated = round('Licitação', '2026-03-11T13:00:00Z');
    expect(currentRound([open], NOW)).toBe(open);
    expect(currentRound([open, dated], NOW)).toBe(dated);
    expect(currentRound([dated, open], NOW)).toBe(dated);
    expect(currentRound([open, round('old', '2020-01-01T00:00:00Z')], NOW)).toBe(open);
  });
});

describe('currentMinimumPrice (BR-004-13)', () => {
  const rounds = [
    round('1º Leilão', '2026-03-10T13:00:00Z', '150000.00'),
    round('2º Leilão', '2026-03-16T13:00:00Z', '120000.00'),
  ];

  it('is the current round price, switching with the clock and no import', () => {
    expect(currentMinimumPrice(rounds, d('150000'), new Date('2026-03-10T12:59:00Z'))).toEqual(
      d('150000'),
    );
    expect(currentMinimumPrice(rounds, d('150000'), NOW)).toEqual(d('120000'));
  });

  it('falls back to the list price when the round gave none or no round is known', () => {
    expect(currentMinimumPrice([round('x', '2026-03-11T00:00:00Z')], d('99.5'), NOW)).toEqual(
      d('99.5'),
    );
    expect(currentMinimumPrice([], d('99.5'), NOW)).toEqual(d('99.5'));
    expect(currentMinimumPrice([], null, NOW)).toBeNull();
  });
});

describe('discountPercent (BR-004-14)', () => {
  it('is (appraisal - price) / appraisal as a percentage', () => {
    expect(discountPercent(d('200000'), d('150000'))).toEqual(d('25'));
    expect(discountPercent(d('250000'), d('91589.89'))).toEqual(d('63.364044'));
  });

  it('is zero at the appraisal and keeps a negative value above it, never clamped', () => {
    expect(discountPercent(d('100000'), d('100000'))).toEqual(d('0'));
    expect(discountPercent(d('100000'), d('120000'))).toEqual(d('-20'));
  });

  it('is unknown when a figure is missing or the appraisal is zero', () => {
    expect(discountPercent(null, d('1'))).toBeNull();
    expect(discountPercent(d('1'), null)).toBeNull();
    expect(discountPercent(d('0'), d('1'))).toBeNull();
  });
});

describe('roundsFromPhaseDates', () => {
  const first = new Date('2026-03-10T13:00:00Z');
  const second = new Date('2026-03-16T13:00:00Z');

  it('makes a 1st and 2nd round of an SFI auction, and none when no date was found', () => {
    expect(roundsFromPhaseDates(PhaseModality.SFI_AUCTION, [first, second])).toEqual([
      { label: '1º Leilão', minimumPrice: null, date: first },
      { label: '2º Leilão', minimumPrice: null, date: second },
    ]);
    expect(roundsFromPhaseDates(PhaseModality.SFI_AUCTION, [])).toEqual([]);
  });

  it('makes one dated round of open bidding and of an online sale, none without a date', () => {
    expect(roundsFromPhaseDates(PhaseModality.OPEN_BIDDING, [first, second])).toEqual([
      { label: 'Licitação', minimumPrice: null, date: first },
    ]);
    expect(roundsFromPhaseDates(PhaseModality.ONLINE_SALES, [first])).toEqual([
      { label: 'Venda Online', minimumPrice: null, date: first },
    ]);
    expect(roundsFromPhaseDates(PhaseModality.OPEN_BIDDING, [])).toEqual([]);
    expect(roundsFromPhaseDates(PhaseModality.ONLINE_SALES, [])).toEqual([]);
  });

  it('makes one open-ended round of a direct online sale: it has no end date', () => {
    expect(roundsFromPhaseDates(PhaseModality.DIRECT_ONLINE_SALES, [])).toEqual([
      { label: 'Venda Direta', minimumPrice: null, date: null },
    ]);
  });
});

describe('roundsFromPhaseDates with the prices a page states (BR-004-11, BR-004-13)', () => {
  const first = new Date('2026-03-10T13:00:00Z');
  const second = new Date('2026-03-16T13:00:00Z');
  const third = new Date('2026-03-20T13:00:00Z');
  const prices = { first: d('192622.00'), second: d('170201.84'), single: null };

  it('gives each SFI round its own price, and never more than two rounds', () => {
    expect(roundsFromPhaseDates(PhaseModality.SFI_AUCTION, [first, second, third], prices)).toEqual(
      [
        { label: '1º Leilão', minimumPrice: d('192622.00'), date: first },
        { label: '2º Leilão', minimumPrice: d('170201.84'), date: second },
      ],
    );
  });

  it('takes the 1st round price from the single price when the page has no 1st-round price', () => {
    const singleOnly = { first: null, second: null, single: d('100.00') };

    expect(roundsFromPhaseDates(PhaseModality.SFI_AUCTION, [first, second], singleOnly)).toEqual([
      { label: '1º Leilão', minimumPrice: d('100.00'), date: first },
      { label: '2º Leilão', minimumPrice: null, date: second },
    ]);
  });

  it('gives the single price to the one round of the other modalities, the 1st as a fallback', () => {
    const single = { first: null, second: null, single: d('89575.84') };
    const firstOnly = { first: d('50.00'), second: null, single: null };

    expect(
      roundsFromPhaseDates(PhaseModality.OPEN_BIDDING, [first], single)[0]?.minimumPrice,
    ).toEqual(d('89575.84'));
    expect(
      roundsFromPhaseDates(PhaseModality.ONLINE_SALES, [first], firstOnly)[0]?.minimumPrice,
    ).toEqual(d('50.00'));
    expect(roundsFromPhaseDates(PhaseModality.DIRECT_ONLINE_SALES, [], single)).toEqual([
      { label: 'Venda Direta', minimumPrice: d('89575.84'), date: null },
    ]);
    expect(
      roundsFromPhaseDates(PhaseModality.DIRECT_ONLINE_SALES, [], firstOnly)[0]?.minimumPrice,
    ).toEqual(d('50.00'));
  });
});
