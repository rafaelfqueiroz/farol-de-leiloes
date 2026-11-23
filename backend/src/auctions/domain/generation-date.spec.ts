import { describe, expect, it } from 'vitest';
import { parseGenerationDate } from './generation-date.js';

describe('parseGenerationDate (BR-004-02)', () => {
  it('reads dd/mm/yyyy as a Brasília calendar day', () => {
    expect(parseGenerationDate('10/11/2025')).toBe('2025-11-10');
    expect(parseGenerationDate(' 01/01/2026 ')).toBe('2026-01-01');
  });

  it('ignores a time after the day', () => {
    expect(parseGenerationDate('10/11/2025 07:30')).toBe('2025-11-10');
    expect(parseGenerationDate('10/11/2025 - 07h30')).toBe('2025-11-10');
  });

  it('accepts 29 February only in a leap year', () => {
    expect(parseGenerationDate('29/02/2028')).toBe('2028-02-29');
    expect(parseGenerationDate('29/02/2027')).toBeNull();
  });

  it.each([
    '',
    'Data de geração:',
    '31/02/2025',
    '10-11-2025',
    '2025-11-10',
    '1/2/2025',
    '10/13/2025',
  ])('is null for %j', (cell) => {
    expect(parseGenerationDate(cell)).toBeNull();
  });
});
