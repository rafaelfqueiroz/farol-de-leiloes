import { describe, expect, it } from 'vitest';
import { formatArea, formatCount } from './numbers';

describe('formatArea', () => {
  it('groups thousands in pt-BR and appends m² after a non-breaking space', () => {
    expect(formatArea('1250')).toBe('1.250 m²');
  });

  it('uses a decimal comma when places are asked for', () => {
    expect(formatArea('62.5', 2)).toBe('62,50 m²');
  });

  it('rounds half to even', () => {
    expect(formatArea('0.5')).toBe('0 m²');
    expect(formatArea('1.5')).toBe('2 m²');
  });

  it('never prints a negative zero', () => {
    expect(formatArea('-0.2')).toBe('0 m²');
  });

  it('keeps the sign of a negative area', () => {
    expect(formatArea('-1250')).toBe('-1.250 m²');
  });

  it('rejects a value that is not finite', () => {
    expect(() => formatArea('Infinity')).toThrow(RangeError);
  });
});

describe('formatCount', () => {
  it('groups thousands in pt-BR', () => {
    expect(formatCount(1234567)).toBe('1.234.567');
    expect(formatCount(12)).toBe('12');
    expect(formatCount(0)).toBe('0');
  });

  it('keeps the sign of a negative count', () => {
    expect(formatCount(-1500)).toBe('-1.500');
  });

  it('rejects a fraction', () => {
    expect(() => formatCount(1.5)).toThrow(RangeError);
  });
});
