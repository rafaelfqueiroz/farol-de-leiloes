import { describe, expect, it } from 'vitest';
import { neutralizeSpreadsheetCell } from './spreadsheet-cell';

describe('neutralizeSpreadsheetCell (SC-12)', () => {
  it.each(['=1+1', '+SUM(A1:A2)', '-1+1', '@SUM(A1:A2)', '\t=1+1', '\r=1+1'])(
    'forces a dangerous leading character to text: %j',
    (cell) => expect(neutralizeSpreadsheetCell(cell)).toBe(`'${cell}`),
  );

  it.each(['', 'plain text', '1234.56', 'text=1+1', 'a,b', '"quoted"', 'line\nbreak', "'=1+1"])(
    'preserves ordinary text exactly: %j',
    (cell) => expect(neutralizeSpreadsheetCell(cell)).toBe(cell),
  );

  it('does not add a second apostrophe when a serializer retries', () => {
    expect(neutralizeSpreadsheetCell(neutralizeSpreadsheetCell('=1+1'))).toBe("'=1+1");
  });
});
