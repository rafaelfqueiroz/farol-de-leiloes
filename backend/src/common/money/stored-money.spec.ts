// EXPAND (AR-28): remove in contract step, #34 PR 2 — with stored-money.ts.
// The tolerant readers accept both stored shapes of the expand step, and nothing else.
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { fromStoredCouponDiscount, fromStoredMoney } from './stored-money';

const d128 = (value: string) => Types.Decimal128.fromString(value);

describe('fromStoredMoney', () => {
  it('reads the new shape, Decimal128 reais', () => {
    expect(fromStoredMoney(d128('91589.89'))?.toFixed()).toBe('91589.89');
  });

  it('reads the legacy shape, a number of reais, through its shortest decimal text', () => {
    // 91589.89 has no exact binary form; String() gives back the decimal the importer parsed.
    expect(fromStoredMoney(91589.89)?.toFixed()).toBe('91589.89');
    expect(fromStoredMoney(250000)?.toFixed()).toBe('250000');
    expect(fromStoredMoney(0)?.toFixed()).toBe('0');
  });

  it('answers null for an absent amount', () => {
    expect(fromStoredMoney(null)).toBeNull();
    expect(fromStoredMoney(undefined)).toBeNull();
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, '1000', { $numberDecimal: '1' }, true])(
    'refuses a shape no writer produced: %j',
    (value) => {
      expect(() => fromStoredMoney(value)).toThrow(TypeError);
    },
  );
});

describe('fromStoredCouponDiscount (converted in place: centavos → reais)', () => {
  it('reads a legacy integer of centavos as reais', () => {
    // 1000 centavos = R$ 10,00; 1999 = R$ 19,99; 1 = R$ 0,01.
    expect(fromStoredCouponDiscount(1000).toFixed()).toBe('10');
    expect(fromStoredCouponDiscount(1999).toFixed()).toBe('19.99');
    expect(fromStoredCouponDiscount(1).toFixed()).toBe('0.01');
  });

  it('reads the new shape, Decimal128 reais, unchanged', () => {
    expect(fromStoredCouponDiscount(d128('10')).toFixed()).toBe('10');
    expect(fromStoredCouponDiscount(d128('19.99')).toFixed()).toBe('19.99');
  });

  it.each([10.5, Number.NaN, null, undefined, '1000'])(
    'refuses a value that is neither: %j',
    (value) => {
      expect(() => fromStoredCouponDiscount(value)).toThrow(TypeError);
    },
  );
});
