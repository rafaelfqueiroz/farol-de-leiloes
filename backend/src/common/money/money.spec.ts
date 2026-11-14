// AR-17..AR-19, TS-04, TS-09, TS-10: the money primitives, with hand-computed expectations.
import { describe, expect, it } from 'vitest';
import { Decimal, isMoneyString, parseMoney, toMoneyString } from './money.js';

describe('TS-10: no drift in a money path', () => {
  it('sums 10,000 × "0.1" to exactly "1000.00" (a float sum drifts)', () => {
    // Hand total: 10,000 × 0.1 = 1,000. A JS number cannot hold 0.1 exactly, so its running sum
    // drifts away from 1000 — the bug AR-17 exists to prevent.
    let float = 0;
    let total = new Decimal(0);
    for (let i = 0; i < 10_000; i++) {
      float += 0.1;
      total = total.plus(parseMoney('0.1'));
    }

    expect(float).not.toBe(1000);
    expect(toMoneyString(total)).toBe('1000.00');
  });

  it('keeps full precision until the edge: R$ 100,00 split in three and summed back', () => {
    // 100 / 3 = 33.333… (34 digits kept); × 3 = 99.999…9 (34 nines), which rounds to 100.00 once,
    // at the edge (AR-19). Rounding each third first would give 3 × 33.33 = 99.99.
    const third = new Decimal('100').dividedBy(3);

    expect(toMoneyString(third.times(3))).toBe('100.00');
    expect(toMoneyString(new Decimal(toMoneyString(third)).times(3))).toBe('99.99');
  });

  it('sums a long sequence of repeating-decimal costs to the hand total', () => {
    // 3,000 costs of R$ 0,07 + 3,000 of R$ 0,13 + 3,000 of R$ 0,19 = 3,000 × 0.39 = 1,170.00.
    const costs = Array.from({ length: 3_000 }, () => ['0.07', '0.13', '0.19']).flat();
    const total = costs.reduce((sum, cost) => sum.plus(parseMoney(cost)), new Decimal(0));

    expect(toMoneyString(total)).toBe('1170.00');
  });
});

describe('toMoneyString (AR-19: two places, half-even, once)', () => {
  it.each([
    ['2.345', '2.34'], // tie, 4 is even: down
    ['2.355', '2.36'], // tie, 6 is even: up
    ['0.125', '0.12'],
    ['0.135', '0.14'],
    ['2.3450000001', '2.35'], // above the tie: up
    ['-2.345', '-2.34'],
    ['1000', '1000.00'],
    ['0', '0.00'],
    ['999999999999999.995', '1000000000000000.00'],
  ])('%s → %s', (value, expected) => {
    expect(toMoneyString(new Decimal(value))).toBe(expected);
  });

  it('writes plain notation, never an exponent, for tiny and huge amounts', () => {
    expect(new Decimal('0.0000001').toString()).toBe('0.0000001');
    expect(new Decimal('123456789012345678901234567890').toString()).toBe(
      '123456789012345678901234567890',
    );
  });
});

describe('isMoneyString / parseMoney (MONEY_PATTERN)', () => {
  it.each(['0', '0.1', '0.10', '1234.56', '300000', '999999999999999.99'])(
    'accepts %s',
    (value) => {
      expect(isMoneyString(value)).toBe(true);
      expect(parseMoney(value).equals(new Decimal(value))).toBe(true);
    },
  );

  it.each([
    '',
    ' 1',
    '-1',
    '+1',
    '1.',
    '.5',
    '1.234',
    '1,50',
    '1.234,56',
    '1e3',
    'R$ 10',
    'NaN',
    'Infinity',
    '0x10',
    '1000000000000000',
  ])('refuses %j', (value) => {
    expect(isMoneyString(value)).toBe(false);
    expect(() => parseMoney(value)).toThrow(TypeError);
  });

  it('refuses what is not a string at all', () => {
    expect(isMoneyString(10)).toBe(false);
    expect(isMoneyString(null)).toBe(false);
    expect(isMoneyString({ $gt: '' })).toBe(false);
  });
});
