// SPEC-004 acceptance: an SFI property with its 1st round on day D at 10h00 and its 2nd on D+6 at
// 10h00 (Brasília) shows the 1st-round price and discount until D 09h59, the 2nd from D 10h00 with
// no import, and is no longer active from D+6 10h00. Run in every zone of the tz-* projects (UTC,
// Tokyo, New York, Brasília): a server zone must never move a stored date (BR-004-12).
import { describe, expect, inject, it } from 'vitest';
import { brasiliaWallClockToInstant } from '../../common/clock/brasilia-time.js';
import { Decimal } from '../../common/money/money.js';
import { isActive } from './active.js';
import { currentMinimumPrice, currentRound, discountPercent, type Round } from './rounds.js';

declare module 'vitest' {
  export interface ProvidedContext {
    timeZone: string;
  }
}

const brasilia = (day: number, hours: number, minutes: number) =>
  brasiliaWallClockToInstant({ year: 2026, month: 3, day, hours, minutes });

const rounds: Round[] = [
  { label: '1º Leilão', date: brasilia(10, 10, 0), minimumPrice: new Decimal('150000.00') },
  { label: '2º Leilão', date: brasilia(16, 10, 0), minimumPrice: new Decimal('120000.00') },
];
const appraisal = new Decimal('200000.00');
const listPrice = new Decimal('150000.00');

describe('the zone of this run', () => {
  it('is the one the tz-* project injected', () => {
    expect(Intl.DateTimeFormat().resolvedOptions().timeZone).toBe(inject('timeZone'));
  });
});

describe('an SFI auction across its two rounds (BR-004-13, BR-004-14, BR-004-16)', () => {
  const view = (now: Date) => {
    const price = currentMinimumPrice(rounds, listPrice, now);
    return {
      round: currentRound(rounds, now)?.label ?? null,
      price: price?.toString() ?? null,
      discount: discountPercent(appraisal, price)?.toString() ?? null,
      active: isActive({ available: true, rounds }, now),
    };
  };

  it('stores "10h00" Brasília as 13:00 UTC, whatever the host zone', () => {
    expect(rounds[0]?.date?.toISOString()).toBe('2026-03-10T13:00:00.000Z');
    expect(rounds[1]?.date?.toISOString()).toBe('2026-03-16T13:00:00.000Z');
  });

  it('shows the 1st round until D 09h59 (Brasília)', () => {
    expect(view(brasilia(10, 9, 59))).toEqual({
      round: '1º Leilão',
      price: '150000',
      discount: '25',
      active: true,
    });
  });

  it('switches to the 2nd round at D 10h00, with no import', () => {
    expect(view(brasilia(10, 10, 0))).toEqual({
      round: '2º Leilão',
      price: '120000',
      discount: '40',
      active: true,
    });
  });

  it('is still active at D+6 09h59 and inactive from D+6 10h00', () => {
    expect(view(brasilia(16, 9, 59)).active).toBe(true);
    expect(view(brasilia(16, 10, 0))).toEqual({
      round: null,
      price: '150000', // no round is left: the list price stands, the property is no longer active
      discount: '25',
      active: false,
    });
  });

  it('keeps a negative discount when the minimum price is above the appraisal', () => {
    expect(discountPercent(new Decimal('100000'), new Decimal('125000'))?.toString()).toBe('-25');
  });
});
