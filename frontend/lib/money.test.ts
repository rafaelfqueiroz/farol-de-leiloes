import Decimal from 'decimal.js';
import { describe, expect, it } from 'vitest';
import {
  discountPercent,
  formatMoney,
  formatMoneyCompact,
  formatPercent,
  isMoneyString,
  moneyFromSlider,
  moneyToSlider,
  parseMoneyInput,
} from './money';

const NBSP = '\u00a0';

describe('formatMoney', () => {
  it.each([
    ['1234.56', `R$${NBSP}1.234,56`],
    ['0', `R$${NBSP}0,00`],
    ['7', `R$${NBSP}7,00`],
    ['0.5', `R$${NBSP}0,50`],
    ['999.99', `R$${NBSP}999,99`],
    ['1000', `R$${NBSP}1.000,00`],
    ['1234567.8', `R$${NBSP}1.234.567,80`],
    ['123456789012.34', `R$${NBSP}123.456.789.012,34`],
  ])('formats %s', (input, expected) => {
    expect(formatMoney(input)).toBe(expected);
  });

  it('uses a non-breaking space after the symbol', () => {
    expect(formatMoney('1')).toContain(`R$${NBSP}`);
    expect(formatMoney('1')).not.toContain('R$ ');
  });

  it('rounds half to even at two decimals (AR-19)', () => {
    // exact ties: the even neighbour wins
    expect(formatMoney('0.125')).toBe(`R$${NBSP}0,12`);
    expect(formatMoney('0.135')).toBe(`R$${NBSP}0,14`);
    expect(formatMoney('2.675')).toBe(`R$${NBSP}2,68`);
    expect(formatMoney('2.665')).toBe(`R$${NBSP}2,66`);
    // not a tie: rounds normally
    expect(formatMoney('0.1251')).toBe(`R$${NBSP}0,13`);
  });

  it('keeps precision a JS number would lose', () => {
    expect(formatMoney('9007199254740993.01')).toBe(`R$${NBSP}9.007.199.254.740.993,01`);
  });

  it('formats negatives with a leading minus', () => {
    expect(formatMoney('-1234.5')).toBe(`-R$${NBSP}1.234,50`);
  });

  it('never shows a negative zero', () => {
    expect(formatMoney('-0.001')).toBe(`R$${NBSP}0,00`);
    expect(formatMoney('-0')).toBe(`R$${NBSP}0,00`);
  });

  it('accepts a Decimal', () => {
    expect(formatMoney(new Decimal('10.005'))).toBe(`R$${NBSP}10,00`);
  });

  it('rejects values that are not finite decimals', () => {
    expect(() => formatMoney('abc')).toThrow();
    expect(() => formatMoney('Infinity')).toThrow(RangeError);
    expect(() => formatMoney('NaN')).toThrow(RangeError);
  });
});

describe('formatMoneyCompact', () => {
  it.each([
    ['2400000', `R$${NBSP}2,4${NBSP}mi`],
    ['2449999', `R$${NBSP}2,4${NBSP}mi`],
    ['2450000', `R$${NBSP}2,4${NBSP}mi`], // tie -> even
    ['2350000', `R$${NBSP}2,4${NBSP}mi`], // tie -> even
    ['2000000', `R$${NBSP}2${NBSP}mi`],
    ['380000', `R$${NBSP}380${NBSP}mil`],
    ['1500', `R$${NBSP}1,5${NBSP}mil`],
    ['1000', `R$${NBSP}1${NBSP}mil`],
    ['125000000', `R$${NBSP}125${NBSP}mi`],
    ['3200000000', `R$${NBSP}3,2${NBSP}bi`],
    ['12345678900000', `R$${NBSP}12.346${NBSP}bi`],
  ])('abbreviates %s', (input, expected) => {
    expect(formatMoneyCompact(input)).toBe(expected);
  });

  it('promotes to the next unit when rounding reaches 1.000', () => {
    expect(formatMoneyCompact('999960')).toBe(`R$${NBSP}1${NBSP}mi`);
    expect(formatMoneyCompact('999999999')).toBe(`R$${NBSP}1${NBSP}bi`);
  });

  it('falls back to the full format below R$ 1.000', () => {
    expect(formatMoneyCompact('999.99')).toBe(`R$${NBSP}999,99`);
    expect(formatMoneyCompact('0')).toBe(`R$${NBSP}0,00`);
  });

  it('keeps the sign of negatives', () => {
    expect(formatMoneyCompact('-2400000')).toBe(`-R$${NBSP}2,4${NBSP}mi`);
  });

  it('accepts a Decimal', () => {
    expect(formatMoneyCompact(new Decimal('380000'))).toBe(`R$${NBSP}380${NBSP}mil`);
  });
});

describe('money strings at the form boundary', () => {
  it('recognises the API format', () => {
    expect(['0', '10', '1234.56', '0.1'].every(isMoneyString)).toBe(true);
    expect(['', '-1', '1,5', '1.234,56', '1e3', '1.234', ' 1', 'abc'].some(isMoneyString)).toBe(
      false,
    );
  });

  it('reads a typed amount into two places, accepting a comma', () => {
    expect(parseMoneyInput('10')).toBe('10.00');
    expect(parseMoneyInput('10,5')).toBe('10.50');
    expect(parseMoneyInput(' 1234.56 ')).toBe('1234.56');
    // 0.1 + 0.2 style input stays exact: no binary float on the way
    expect(parseMoneyInput('0.30')).toBe('0.30');
  });

  it('refuses what is not a non-negative amount with at most two decimals', () => {
    expect(parseMoneyInput('')).toBeNull();
    expect(parseMoneyInput('-5')).toBeNull();
    expect(parseMoneyInput('10,555')).toBeNull();
    expect(parseMoneyInput('1.234,56')).toBeNull();
    expect(parseMoneyInput('dez')).toBeNull();
  });

  it('moves between slider positions and money strings', () => {
    expect(moneyFromSlider(0)).toBe('0.00');
    expect(moneyFromSlider(1_250_000)).toBe('1250000.00');
    expect(moneyToSlider('1250000.00')).toBe(1_250_000);
    expect(moneyToSlider('50000.5')).toBe(50_000);
  });
});

describe('discountPercent', () => {
  it('is exact where binary floats are not', () => {
    // (300000.10 - 200000.07) / 300000.10 * 100, with no float in between
    expect(discountPercent('300000.10', '200000.07')?.toFixed(4)).toBe('33.3333');
    expect(discountPercent('0.30', '0.10')?.toFixed(10)).toBe('66.6666666667');
  });

  it('is negative when the minimum is above the appraisal', () => {
    expect(discountPercent('100.00', '125.00')?.toString()).toBe('-25');
  });

  it('is null when a figure is missing or the appraisal is not positive', () => {
    expect(discountPercent(null, '100')).toBeNull();
    expect(discountPercent('100', null)).toBeNull();
    expect(discountPercent('0', '100')).toBeNull();
  });
});

describe('formatPercent', () => {
  it('uses the pt-BR decimal comma and one place', () => {
    expect(formatPercent('12.5')).toBe('12,5%');
    expect(formatPercent('33.3333')).toBe('33,3%');
    expect(formatPercent('50')).toBe('50,0%');
  });

  it('rounds half to even, groups and keeps the sign', () => {
    expect(formatPercent('0.25')).toBe('0,2%');
    expect(formatPercent('0.35')).toBe('0,4%');
    expect(formatPercent('1234.5', 0)).toBe('1.234%');
    expect(formatPercent('-25')).toBe('-25,0%');
    expect(formatPercent('-0.01')).toBe('0,0%');
  });
});
