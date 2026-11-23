// SPEC-004 BR-004-02, BR-004-04: the list validator. Every branch (TS-24, critical module).
import { describe, expect, it } from 'vitest';
import { type LastAppliedList, type ListFacts, validateList } from './list-validator.js';

const GOOD: ListFacts = {
  headerFound: true,
  missingColumns: [],
  generatedOn: '2025-11-10',
  rowCount: 4000,
};
const LAST: LastAppliedList = { generatedOn: '2025-11-09', rowCount: 5000 };
const RATIO = 0.8;

const facts = (overrides: Partial<ListFacts>): ListFacts => ({ ...GOOD, ...overrides });

describe('validateList', () => {
  it('accepts a list that is newer and holds at least the ratio of the last one', () => {
    expect(validateList(GOOD, LAST, RATIO)).toEqual({ kind: 'valid' });
  });

  it('accepts the first list ever, with nothing to compare to', () => {
    expect(validateList(facts({ rowCount: 1 }), null, RATIO)).toEqual({ kind: 'valid' });
  });

  describe('layout', () => {
    it('rejects a list with no header row as an unrecognised layout', () => {
      expect(validateList(facts({ headerFound: false, rowCount: 0 }), LAST, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'UNRECOGNISED_LAYOUT',
      });
    });

    it('rejects a list that lacks a required column', () => {
      expect(validateList(facts({ missingColumns: ['appraisalPrice'] }), LAST, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'MISSING_COLUMNS',
      });
    });
  });

  describe('generation date (BR-004-02)', () => {
    it('rejects a list with no readable generation date', () => {
      expect(validateList(facts({ generatedOn: null }), LAST, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'NO_GENERATION_DATE',
      });
    });

    it('says "not new" for the same day as the last applied list', () => {
      expect(validateList(facts({ generatedOn: '2025-11-09' }), LAST, RATIO)).toEqual({
        kind: 'not_new',
        generatedOn: '2025-11-09',
      });
    });

    it('says "not new" for an earlier day, even across a month and a year boundary', () => {
      expect(validateList(facts({ generatedOn: '2025-11-08' }), LAST, RATIO).kind).toBe('not_new');
      expect(
        validateList(
          facts({ generatedOn: '2025-12-31' }),
          { generatedOn: '2026-01-01', rowCount: 10 },
          RATIO,
        ).kind,
      ).toBe('not_new');
    });

    it('accepts the very next day, across a month and a year boundary', () => {
      expect(
        validateList(
          facts({ generatedOn: '2026-01-01', rowCount: 10 }),
          { generatedOn: '2025-12-31', rowCount: 10 },
          RATIO,
        ).kind,
      ).toBe('valid');
    });

    it('does not judge the content of a list that is not new', () => {
      expect(
        validateList(facts({ generatedOn: '2025-11-09', rowCount: 0 }), LAST, RATIO).kind,
      ).toBe('not_new');
    });
  });

  describe('row count (BR-004-04)', () => {
    it('rejects an empty list', () => {
      expect(validateList(facts({ rowCount: 0 }), LAST, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'EMPTY_LIST',
      });
      expect(validateList(facts({ rowCount: 0 }), null, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'EMPTY_LIST',
      });
    });

    it('rejects a truncated list: 30% of the last list’s rows', () => {
      expect(validateList(facts({ rowCount: 1500 }), LAST, RATIO)).toEqual({
        kind: 'rejected',
        reason: 'TRUNCATED_LIST',
      });
    });

    it('is exact at the edge: 80% of 5000 is 4000, and 3999 is short', () => {
      expect(validateList(facts({ rowCount: 4000 }), LAST, RATIO).kind).toBe('valid');
      expect(validateList(facts({ rowCount: 3999 }), LAST, RATIO).kind).toBe('rejected');
    });

    it('computes the ratio exactly, not in a float: 70% of 10 is 7', () => {
      const last = { generatedOn: '2025-11-09', rowCount: 10 };
      expect(validateList(facts({ rowCount: 7 }), last, 0.7).kind).toBe('valid');
      expect(validateList(facts({ rowCount: 6 }), last, 0.7).kind).toBe('rejected');
    });

    it('accepts a list larger than the last one, and any list after a last one of zero rows', () => {
      expect(validateList(facts({ rowCount: 9000 }), LAST, RATIO).kind).toBe('valid');
      expect(validateList(facts({ rowCount: 1 }), { ...LAST, rowCount: 0 }, RATIO).kind).toBe(
        'valid',
      );
    });

    it('with a ratio of 1 needs at least as many rows as before', () => {
      expect(validateList(facts({ rowCount: 5000 }), LAST, 1).kind).toBe('valid');
      expect(validateList(facts({ rowCount: 4999 }), LAST, 1).kind).toBe('rejected');
    });
  });

  it('answers with a code and never with row content (SC-15)', () => {
    const verdict = validateList(facts({ rowCount: 10 }), LAST, RATIO);
    expect(Object.keys(verdict).sort()).toEqual(['kind', 'reason']);
  });
});
