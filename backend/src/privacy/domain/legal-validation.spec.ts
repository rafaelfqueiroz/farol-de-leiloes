// SPEC-010 BR-010-24..26 (DL-010-07): when a recorded validation counts, with the cases that reopen
// a gate: a new document version, a changed retention setting, a later review.
import { describe, expect, it } from 'vitest';
import {
  documentTypeOfScope,
  documentVersionKey,
  evaluateGate,
  LEGAL_VALIDATION_SCOPES,
  parseDocumentVersionKey,
  type ValidationRecord,
  type ValidationState,
} from './legal-validation.js';

const STATE: ValidationState = {
  currentVersions: { terms: '1.0', privacy: '1.0' },
  retentionYears: 5,
};
const at = (iso: string) => new Date(iso);

function record(
  scope: ValidationRecord['scope'],
  validatedAt: string,
  extra: Partial<ValidationRecord> = {},
): ValidationRecord {
  return { scope, validatedAt: at(validatedAt), documentVersions: [], ...extra };
}

describe('document version keys', () => {
  it('names a version as <type>:<version> and reads it back', () => {
    expect(documentVersionKey({ type: 'terms', version: '1.0' })).toBe('terms:1.0');
    expect(parseDocumentVersionKey('privacy:2.1.3')).toEqual({ type: 'privacy', version: '2.1.3' });
  });

  it.each([
    '',
    'terms',
    'terms:',
    ':1.0',
    'cookies:1.0',
    'terms:1.x',
    'terms:1.0.0.0.0',
    'terms : 1.0',
  ])('refuses %j', (key) => {
    expect(parseDocumentVersionKey(key)).toBeNull();
  });

  it('knows which document a scope reviews', () => {
    expect(documentTypeOfScope('terms')).toBe('terms');
    expect(documentTypeOfScope('privacy-policy')).toBe('privacy');
    expect(documentTypeOfScope('retention-periods')).toBeNull();
    expect(documentTypeOfScope('third-party-processing')).toBeNull();
  });

  it('lists the four scopes of BR-010-26', () => {
    expect([...LEGAL_VALIDATION_SCOPES]).toEqual([
      'third-party-processing',
      'retention-periods',
      'privacy-policy',
      'terms',
    ]);
  });
});

describe('every gate is closed without a record', () => {
  it.each(LEGAL_VALIDATION_SCOPES)('%s', (scope) => {
    expect(evaluateGate(scope, [], STATE)).toEqual({ validated: false, record: null });
  });

  it('a record of another scope does not open it', () => {
    const other = record('third-party-processing', '2026-03-01T00:00:00Z');
    expect(evaluateGate('retention-periods', [other], STATE).validated).toBe(false);
  });
});

describe('third-party-processing counts once any record exists (BR-010-25)', () => {
  it('opens on a record and shows the newest', () => {
    const older = record('third-party-processing', '2026-03-01T00:00:00Z');
    const newer = record('third-party-processing', '2026-05-01T00:00:00Z');
    expect(evaluateGate('third-party-processing', [older, newer], STATE)).toEqual({
      validated: true,
      record: newer,
    });
  });
});

describe('terms and privacy-policy count only for the version in force (BR-010-05, BR-010-26)', () => {
  it('terms: a record naming terms:1.0 opens it while 1.0 is in force', () => {
    const r = record('terms', '2026-03-01T00:00:00Z', { documentVersions: ['terms:1.0'] });
    expect(evaluateGate('terms', [r], STATE)).toEqual({ validated: true, record: r });
  });

  it('terms: a new version in force reopens the gate; validating it again closes the loop', () => {
    const r = record('terms', '2026-03-01T00:00:00Z', { documentVersions: ['terms:1.0'] });
    const next: ValidationState = { ...STATE, currentVersions: { terms: '1.1', privacy: '1.0' } };
    expect(evaluateGate('terms', [r], next).validated).toBe(false);
    const again = record('terms', '2026-06-01T00:00:00Z', { documentVersions: ['terms:1.1'] });
    expect(evaluateGate('terms', [again, r], next)).toEqual({ validated: true, record: again });
  });

  it('privacy-policy looks at the privacy version, not the terms one', () => {
    const r = record('privacy-policy', '2026-03-01T00:00:00Z', {
      documentVersions: ['terms:1.0', 'privacy:1.0'],
    });
    expect(evaluateGate('privacy-policy', [r], STATE).validated).toBe(true);
    const termsOnly = record('privacy-policy', '2026-03-01T00:00:00Z', {
      documentVersions: ['terms:1.0'],
    });
    expect(evaluateGate('privacy-policy', [termsOnly], STATE).validated).toBe(false);
  });

  it('a version that only looks alike does not count (1.0 is not 1.0.0, 1.01 is not 1.0)', () => {
    for (const version of ['terms:1.0.0', 'terms:1.01', 'terms:1', 'privacy:1.0']) {
      const r = record('terms', '2026-03-01T00:00:00Z', { documentVersions: [version] });
      expect(evaluateGate('terms', [r], STATE).validated).toBe(false);
    }
  });

  it('the newest record naming the version in force is the one shown', () => {
    const first = record('terms', '2026-03-01T00:00:00Z', { documentVersions: ['terms:1.0'] });
    const second = record('terms', '2026-04-01T00:00:00Z', { documentVersions: ['terms:1.0'] });
    const oldVersion = record('terms', '2026-05-01T00:00:00Z', { documentVersions: ['terms:0.9'] });
    expect(evaluateGate('terms', [first, second, oldVersion], STATE).record).toBe(second);
  });
});

describe('retention-periods counts for the period reviewed (BR-010-24)', () => {
  it('opens when the reviewed period is the one set', () => {
    const r = record('retention-periods', '2026-03-01T00:00:00Z', { retentionYears: 5 });
    expect(evaluateGate('retention-periods', [r], STATE)).toEqual({ validated: true, record: r });
  });

  it('is reopened when the setting changes after the review (5 -> 6)', () => {
    const r = record('retention-periods', '2026-03-01T00:00:00Z', { retentionYears: 5 });
    const six: ValidationState = { ...STATE, retentionYears: 6 };
    expect(evaluateGate('retention-periods', [r], six)).toEqual({ validated: false, record: null });
    const review = record('retention-periods', '2026-07-01T00:00:00Z', { retentionYears: 6 });
    expect(evaluateGate('retention-periods', [review, r], six).record).toBe(review);
  });

  it('a validation naming 6 does not count when the setting is back to 5', () => {
    const r = record('retention-periods', '2026-03-01T00:00:00Z', { retentionYears: 6 });
    expect(evaluateGate('retention-periods', [r], { ...STATE, retentionYears: 5 })).toEqual({
      validated: false,
      record: null,
    });
    expect(evaluateGate('retention-periods', [r], { ...STATE, retentionYears: 6 }).validated).toBe(
      true,
    );
  });

  it('a record with no period noted counts for whatever is set, null or absent', () => {
    expect(
      evaluateGate(
        'retention-periods',
        [record('retention-periods', '2026-03-01T00:00:00Z')],
        STATE,
      ).validated,
    ).toBe(true);
    const nullYears = record('retention-periods', '2026-03-01T00:00:00Z', { retentionYears: null });
    expect(
      evaluateGate('retention-periods', [nullYears], { ...STATE, retentionYears: 9 }).validated,
    ).toBe(true);
  });

  it('the NEWEST record decides: a later review of another period supersedes an earlier match', () => {
    const matching = record('retention-periods', '2026-03-01T00:00:00Z', { retentionYears: 5 });
    const later = record('retention-periods', '2026-07-01T00:00:00Z', { retentionYears: 6 });
    expect(evaluateGate('retention-periods', [matching, later], STATE).validated).toBe(false);
  });
});

describe('the newest record wins', () => {
  it('whatever the order the records come in', () => {
    const a = record('third-party-processing', '2026-03-01T00:00:00Z');
    const b = record('third-party-processing', '2026-09-01T00:00:00Z');
    expect(evaluateGate('third-party-processing', [a, b], STATE).record).toBe(b);
    expect(evaluateGate('third-party-processing', [b, a], STATE).record).toBe(b);
  });

  it('on the same instant the first listed wins', () => {
    const a = record('third-party-processing', '2026-03-01T00:00:00Z');
    const b = record('third-party-processing', '2026-03-01T00:00:00Z');
    expect(evaluateGate('third-party-processing', [a, b], STATE).record).toBe(a);
  });
});
