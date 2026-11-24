// SPEC-004 BR-004-29: who is alerted about what, and the text chosen by reason code (SC-15).
import { describe, expect, it } from 'vitest';
import {
  alertContent,
  alertOutcomeOf,
  formatBrasiliaDay,
  primaryReason,
  REASON_TEXTS,
  UNKNOWN_REASON_TEXT,
} from './import-alert-text.js';
import type { ListRejectionReason } from './list-validator.js';

const run = (outcome: string, extra: { alertedAt?: Date; blocked?: boolean } = {}) => ({
  outcome,
  alertedAt: extra.alertedAt ?? null,
  collection: { blocked: extra.blocked ?? false },
});

describe('which runs owe an alert (BR-004-29)', () => {
  it.each(['FAILED', 'REJECTED_LIST', 'NO_NEW_LIST'])('%s does', (outcome) => {
    expect(alertOutcomeOf(run(outcome))).toBe(outcome);
  });

  it.each(['NO_UPDATE', 'RUNNING'])('%s never does', (outcome) => {
    expect(alertOutcomeOf(run(outcome, { blocked: true }))).toBeNull();
  });

  it('an applied run does only when its collection was blocked', () => {
    expect(alertOutcomeOf(run('SUCCESS'))).toBeNull();
    expect(alertOutcomeOf(run('SUCCESS', { blocked: true }))).toBe('COLLECTION_BLOCKED');
  });

  it('a run already alerted does not again', () => {
    expect(
      alertOutcomeOf(run('FAILED', { alertedAt: new Date('2026-11-23T10:00:00Z') })),
    ).toBeNull();
  });
});

describe('the reason of an alert, by code', () => {
  it('FAILED: the most telling code the run holds, whatever order they were seen in', () => {
    expect(primaryReason('FAILED', ['TIMEOUT', 'LIST_UNREACHABLE', 'APPLY_FAILED'])).toBe(
      'APPLY_FAILED',
    );
    expect(primaryReason('FAILED', ['HTTP_403', 'LIST_BLOCKED'])).toBe('LIST_BLOCKED');
    expect(primaryReason('FAILED', ['SomeError'])).toBeNull();
  });

  it('REJECTED_LIST: the validator code', () => {
    expect(primaryReason('REJECTED_LIST', ['TRUNCATED_LIST'])).toBe('TRUNCATED_LIST');
    expect(primaryReason('REJECTED_LIST', [])).toBeNull();
    expect(primaryReason('REJECTED_LIST', ['MALFORMED_CSV'])).toBe('MALFORMED_CSV');
  });

  it('has a sentence and an alert reason for every code the list validator can give', () => {
    const rejections: Record<ListRejectionReason, true> = {
      UNRECOGNISED_LAYOUT: true,
      MISSING_COLUMNS: true,
      NO_GENERATION_DATE: true,
      MALFORMED_CSV: true,
      EMPTY_LIST: true,
      GENERATION_DATE_IN_FUTURE: true,
      TOO_MANY_ROWS_WITHOUT_CODE: true,
      UNREADABLE_PRICES: true,
      TRUNCATED_LIST: true,
    };
    for (const code of Object.keys(rejections)) {
      expect(primaryReason('REJECTED_LIST', [code])).toBe(code);
      expect(REASON_TEXTS[code as keyof typeof REASON_TEXTS]).toBeDefined();
    }
  });

  it('NO_NEW_LIST and a blocked collection have one reason each', () => {
    expect(primaryReason('NO_NEW_LIST', [])).toBe('NO_NEW_LIST');
    expect(primaryReason('COLLECTION_BLOCKED', [])).toBe('COLLECTION_BLOCKED');
  });

  it('every catalogue code has a pt-BR sentence that quotes nothing from a run', () => {
    for (const text of Object.values(REASON_TEXTS)) {
      expect(text.length).toBeGreaterThan(20);
      expect(text).not.toMatch(/\{|\$\{|undefined/);
    }
  });
});

describe('the content of an alert', () => {
  it('has the Brasília day, the outcome label, the catalogue text and the codes', () => {
    expect(alertContent('REJECTED_LIST', '2026-11-23', ['TRUNCATED_LIST'])).toEqual({
      date: '23/11/2026',
      outcomeLabel: 'Lista rejeitada',
      reasonText: REASON_TEXTS.TRUNCATED_LIST,
      codes: ['TRUNCATED_LIST'],
    });
  });

  it('says so when no code is in the catalogue, and never echoes an unknown one as text', () => {
    const content = alertContent('FAILED', '2026-01-05', ['SomeError']);
    expect(content.reasonText).toBe(UNKNOWN_REASON_TEXT);
    expect(content.codes).toEqual(['SomeError']);
  });

  it('formats the day as dd/mm/yyyy', () => {
    expect(formatBrasiliaDay('2026-03-09')).toBe('09/03/2026');
  });
});
