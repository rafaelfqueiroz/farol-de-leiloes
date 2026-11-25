// SPEC-004 BR-004-02, BR-004-04: the list validator. Every branch (TS-24, critical module).
import { describe, expect, it } from 'vitest';
import {
  type LastAppliedList,
  type ListFacts,
  sweepWithinLimit,
  validateList,
} from './list-validator.js';

const GOOD: ListFacts = {
  headerFound: true,
  missingColumns: [],
  generatedOn: '2025-11-10',
  rowCount: 4000,
  usableCodeCount: 4000,
  rowsWithoutCode: 0,
  unreadableMoneyRows: 0,
  syntaxErrors: 0,
  irregularRows: 0,
};
const LAST: LastAppliedList = { generatedOn: '2025-11-09', rowCount: 5000 };
const RATIO = 0.8;
const TODAY = '2025-11-10';
const check = (f: ListFacts, last: LastAppliedList | null, ratio: number, today = TODAY) =>
  validateList(f, last, ratio, today);

// A list's usable numbers equal its rows unless a spec says otherwise.
const facts = (overrides: Partial<ListFacts>): ListFacts => ({
  ...GOOD,
  usableCodeCount: overrides.rowCount ?? GOOD.rowCount,
  ...overrides,
});

describe('validateList', () => {
  it('accepts a list that is newer and holds at least the ratio of the last one', () => {
    expect(check(GOOD, LAST, RATIO)).toEqual({ kind: 'valid' });
  });

  it('accepts the first list ever, with nothing to compare to', () => {
    expect(check(facts({ rowCount: 1, usableCodeCount: 1 }), null, RATIO)).toEqual({
      kind: 'valid',
    });
  });

  describe('layout', () => {
    it('rejects a list with no header row as an unrecognised layout', () => {
      expect(check(facts({ headerFound: false, rowCount: 0 }), LAST, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'UNRECOGNISED_LAYOUT',
      });
    });

    it('rejects a list that lacks a required column', () => {
      expect(check(facts({ missingColumns: ['appraisalPrice'] }), LAST, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'MISSING_COLUMNS',
      });
    });
  });

  describe('generation date (BR-004-02)', () => {
    it('rejects a list with no readable generation date', () => {
      expect(check(facts({ generatedOn: null }), LAST, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'NO_GENERATION_DATE',
      });
    });

    it('says "not new" for the same day as the last applied list', () => {
      expect(check(facts({ generatedOn: '2025-11-09' }), LAST, RATIO)).toEqual({
        kind: 'not_new',
        generatedOn: '2025-11-09',
      });
    });

    it('says "not new" for an earlier day, even across a month and a year boundary', () => {
      expect(check(facts({ generatedOn: '2025-11-08' }), LAST, RATIO).kind).toBe('not_new');
      expect(
        check(
          facts({ generatedOn: '2025-12-31' }),
          { generatedOn: '2026-01-01', rowCount: 10 },
          RATIO,
          '2026-01-02',
        ).kind,
      ).toBe('not_new');
    });

    it('accepts the very next day, across a month and a year boundary', () => {
      expect(
        check(
          facts({ generatedOn: '2026-01-01', rowCount: 10, usableCodeCount: 10 }),
          { generatedOn: '2025-12-31', rowCount: 10 },
          RATIO,
          '2026-01-01',
        ).kind,
      ).toBe('valid');
    });

    it('does not judge the content of a list that is not new', () => {
      expect(check(facts({ generatedOn: '2025-11-09', rowCount: 0 }), LAST, RATIO).kind).toBe(
        'not_new',
      );
    });
  });

  describe('malformed CSV (BR-004-04, DL-004-03)', () => {
    it('rejects a list the parser reported a syntax error on, even above the row ratio', () => {
      expect(check(facts({ syntaxErrors: 1 }), LAST, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'MALFORMED_CSV',
      });
    });

    it("rejects a list with a row whose cells are not the header's, even above the row ratio", () => {
      expect(check(facts({ irregularRows: 1 }), LAST, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'MALFORMED_CSV',
      });
    });

    it('rejects a malformed first list too, with nothing to compare to', () => {
      expect(check(facts({ syntaxErrors: 2 }), null, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'MALFORMED_CSV',
      });
    });

    it('is judged before the row count: a malformed empty list is malformed', () => {
      expect(check(facts({ syntaxErrors: 1, rowCount: 0 }), LAST, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'MALFORMED_CSV',
      });
    });

    it('is judged after the layout and the date, and a list that is not new is only not new', () => {
      expect(check(facts({ syntaxErrors: 1, headerFound: false }), LAST, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'UNRECOGNISED_LAYOUT',
      });
      expect(check(facts({ syntaxErrors: 1, generatedOn: null }), LAST, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'NO_GENERATION_DATE',
      });
      expect(check(facts({ syntaxErrors: 1, generatedOn: '2025-11-09' }), LAST, RATIO).kind).toBe(
        'not_new',
      );
    });
  });

  describe('row count (BR-004-04)', () => {
    it('rejects an empty list', () => {
      expect(check(facts({ rowCount: 0 }), LAST, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'EMPTY_LIST',
      });
      expect(check(facts({ rowCount: 0 }), null, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'EMPTY_LIST',
      });
    });

    it('rejects a truncated list: 30% of the last list’s rows', () => {
      expect(check(facts({ rowCount: 1500, usableCodeCount: 1500 }), LAST, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'TRUNCATED_LIST',
      });
    });

    it('is exact at the edge: 80% of 5000 is 4000, and 3999 is short', () => {
      expect(check(facts({ rowCount: 4000, usableCodeCount: 4000 }), LAST, RATIO).kind).toBe(
        'valid',
      );
      expect(check(facts({ rowCount: 3999, usableCodeCount: 3999 }), LAST, RATIO).kind).toBe(
        'rejected',
      );
    });

    it('computes the ratio exactly, not in a float: 70% of 10 is 7', () => {
      const last = { generatedOn: '2025-11-09', rowCount: 10 };
      expect(check(facts({ rowCount: 7, usableCodeCount: 7 }), last, 0.7).kind).toBe('valid');
      expect(check(facts({ rowCount: 6 }), last, 0.7).kind).toBe('rejected');
    });

    it('accepts a list larger than the last one, and any list after a last one of zero rows', () => {
      expect(check(facts({ rowCount: 9000 }), LAST, RATIO).kind).toBe('valid');
      expect(
        check(facts({ rowCount: 1, usableCodeCount: 1 }), { ...LAST, rowCount: 0 }, RATIO).kind,
      ).toBe('valid');
    });

    it('with a ratio of 1 needs at least as many rows as before', () => {
      expect(check(facts({ rowCount: 5000 }), LAST, 1).kind).toBe('valid');
      expect(check(facts({ rowCount: 4999 }), LAST, 1).kind).toBe('rejected');
    });
  });

  describe('generation date upper bound', () => {
    it('accepts a list generated today or tomorrow in Brasília, never later', () => {
      expect(check(facts({ generatedOn: '2025-11-10' }), LAST, RATIO).kind).toBe('valid');
      expect(check(facts({ generatedOn: '2025-11-11' }), LAST, RATIO).kind).toBe('valid');
      expect(check(facts({ generatedOn: '2025-11-12' }), LAST, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'GENERATION_DATE_IN_FUTURE',
      });
    });

    it('rolls over month and year ends: the day after 31 December is 1 January', () => {
      const facts1 = (generatedOn: string) => facts({ generatedOn, rowCount: 10 });
      expect(validateList(facts1('2026-01-01'), null, RATIO, '2025-12-31').kind).toBe('valid');
      expect(validateList(facts1('2026-01-02'), null, RATIO, '2025-12-31').kind).toBe('rejected');
    });

    it('judges the date before it compares with the last list (a bogus future date is never "not new")', () => {
      expect(
        validateList(
          facts({ generatedOn: '2099-01-01' }),
          { generatedOn: '2099-02-01', rowCount: 1 },
          RATIO,
          TODAY,
        ),
      ).toEqual({ kind: 'rejected', reason: 'GENERATION_DATE_IN_FUTURE' });
    });
  });

  describe('usable property numbers (BR-004-05)', () => {
    it('rejects a list whose rows mostly have no property number (the column renamed or absent)', () => {
      expect(
        check(facts({ rowCount: 4000, rowsWithoutCode: 4000, usableCodeCount: 0 }), LAST, RATIO),
      ).toEqual({
        kind: 'rejected',
        reason: 'TOO_MANY_ROWS_WITHOUT_CODE',
      });
      // Even a first list, with nothing to compare with.
      expect(
        check(facts({ rowCount: 50, rowsWithoutCode: 50, usableCodeCount: 0 }), null, RATIO).kind,
      ).toBe('rejected');
    });

    it('allows 1% of the rows without a number, and no more: exact at 40 of 4000', () => {
      expect(
        check(
          facts({ rowCount: 4000, rowsWithoutCode: 40, usableCodeCount: 3960 }),
          { ...LAST, rowCount: 3000 },
          RATIO,
        ).kind,
      ).toBe('valid');
      expect(
        check(facts({ rowCount: 4000, rowsWithoutCode: 41, usableCodeCount: 3959 }), LAST, RATIO),
      ).toEqual({
        kind: 'rejected',
        reason: 'TOO_MANY_ROWS_WITHOUT_CODE',
      });
    });

    it('counts distinct numbers against the ratio: one number repeated on every row is truncated', () => {
      expect(check(facts({ rowCount: 4000, usableCodeCount: 1 }), LAST, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'TRUNCATED_LIST',
      });
    });
  });

  describe('readable prices (BR-004-15, AR-17)', () => {
    it('allows 10% of unreadable prices and no more: exact at 400 of 4000', () => {
      expect(check(facts({ unreadableMoneyRows: 400 }), LAST, RATIO).kind).toBe('valid');
      expect(check(facts({ unreadableMoneyRows: 401 }), LAST, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'UNREADABLE_PRICES',
      });
    });
  });

  it('answers with a code and never with row content (SC-15)', () => {
    const verdict = check(facts({ rowCount: 10 }), LAST, RATIO);
    expect(Object.keys(verdict).sort()).toEqual(['kind', 'reason']);
  });
});

describe('sweepWithinLimit (BR-004-08, DL-004-03)', () => {
  it('allows hiding up to 1 - ratio of the available properties, exactly', () => {
    expect(sweepWithinLimit(20, 100, 0.8)).toBe(true);
    expect(sweepWithinLimit(21, 100, 0.8)).toBe(false);
  });

  it('computes in decimals, not floats: 30% of 10 is 3', () => {
    expect(sweepWithinLimit(3, 10, 0.7)).toBe(true);
    expect(sweepWithinLimit(4, 10, 0.7)).toBe(false);
  });

  it('allows nothing to be hidden from an empty catalogue, and nothing to hide', () => {
    expect(sweepWithinLimit(0, 0, 0.8)).toBe(true);
    expect(sweepWithinLimit(1, 0, 0.8)).toBe(false);
  });
});
