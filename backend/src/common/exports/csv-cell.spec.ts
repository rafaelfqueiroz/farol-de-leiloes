import { describe, expect, it } from 'vitest';
import { neutralizeCsvCell } from './csv-cell.js';

describe('neutralizeCsvCell (SC-12)', () => {
  it.each([
    '=1+1',
    '+SUM(A1:A2)',
    '-1+1',
    '@SUM(A1:A2)',
    '\t=1+1',
    '\r=1+1',
    ' =1+1',
    '\n=cmd|calc',
    ' \n\t@SUM(A1:A2)',
    '\u00a0+SUM(A1:A2)',
    '\ufeff-1+1',
    '\ttext',
    '\rtext',
    '\ntext',
  ])('forces a dangerous leading character to text: %j', (cell) =>
    expect(neutralizeCsvCell(cell)).toBe(`'${cell}`),
  );

  it.each([
    '',
    'plain text',
    '1234.56',
    'text=1+1',
    '  plain text',
    '   ',
    'a,b',
    '"quoted"',
    'line\nbreak',
    "'=1+1",
  ])('preserves ordinary text exactly: %j', (cell) => expect(neutralizeCsvCell(cell)).toBe(cell));

  it('does not add a second apostrophe when a serializer retries', () => {
    expect(neutralizeCsvCell(neutralizeCsvCell('=1+1'))).toBe("'=1+1");
  });
});
