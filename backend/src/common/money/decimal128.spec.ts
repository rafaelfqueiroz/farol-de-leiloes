// AR-17: Decimal ⇄ Decimal128 without a float in between. The real-database half of the round
// trip is test/integration/money-round-trip.spec.ts (TESTING §1).
import { describe, expect, it } from 'vitest';
import { Types } from 'mongoose';
import { fromDecimal128, isDecimal128, toDecimal128, toDecimal128OrNull } from './decimal128';
import { Decimal } from './money';

describe('toDecimal128 / fromDecimal128', () => {
  it.each([
    '0',
    '0.1',
    '1234.56',
    '91589.89',
    '999999999999999.99',
    // 34 significant digits: all a Decimal128 holds, kept digit for digit.
    '0.1234567890123456789012345678901234',
    '1234567890123456789012345678.901234',
  ])('round-trips %s exactly', (value) => {
    const stored = toDecimal128(new Decimal(value));

    expect(stored.toString()).toBe(new Decimal(value).toFixed());
    expect(fromDecimal128(stored).equals(new Decimal(value))).toBe(true);
  });

  it('stores what a float cannot: 0.1 + 0.2 is 0.3, not 0.30000000000000004', () => {
    const sum = new Decimal('0.1').plus('0.2');

    expect(toDecimal128(sum).toString()).toBe('0.3');
    expect(0.1 + 0.2).not.toBe(0.3);
  });

  it('reads a Decimal128 written in exponent form', () => {
    expect(fromDecimal128(Types.Decimal128.fromString('1.5E+3')).toFixed()).toBe('1500');
  });

  it('keeps an absent amount absent', () => {
    expect(toDecimal128OrNull(null)).toBeNull();
    expect(toDecimal128OrNull(undefined)).toBeNull();
    expect(toDecimal128OrNull(new Decimal('5'))?.toString()).toBe('5');
  });
});

describe('isDecimal128', () => {
  it('recognises a BSON Decimal128 and nothing else', () => {
    expect(isDecimal128(Types.Decimal128.fromString('1'))).toBe(true);
    expect(isDecimal128(1)).toBe(false);
    expect(isDecimal128('1')).toBe(false);
    expect(isDecimal128(null)).toBe(false);
    expect(isDecimal128(new Decimal('1'))).toBe(false);
    expect(isDecimal128({ $numberDecimal: '1' })).toBe(false);
  });
});
