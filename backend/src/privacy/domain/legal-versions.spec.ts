// SPEC-010 BR-010-04, BR-010-05 (TS-08): the selection of the version in force, with hand-built
// instants (TS-04). The domain takes "now" as an argument (AR-05, TS-06).
import { describe, expect, it } from 'vitest';
import {
  compareVersions,
  currentVersion,
  isInEffect,
  LEGAL_DOCUMENT_TYPES,
  outdatedTypes,
  pendingAcceptances,
  type PublishedVersion,
  VERSION_PATTERN,
} from './legal-versions.js';

const at = (iso: string) => new Date(iso);
const v = (type: 'terms' | 'privacy', version: string, effectiveAt: string): PublishedVersion => ({
  type,
  version,
  effectiveAt: at(effectiveAt),
});

describe('BR-010-04: version numbers', () => {
  it.each(['0.1', '1', '2.0.3', '10.20', '0.0.0.1'])('%s is a version', (version) => {
    expect(VERSION_PATTERN.test(version)).toBe(true);
  });

  it.each(['', 'v1', '1.', '.1', '1..2', '1.2.3.4.5', '1.a', '12345.1', '1.2 ', '-1'])(
    '%j is not a version',
    (version) => {
      expect(VERSION_PATTERN.test(version)).toBe(false);
    },
  );

  it('compares numerically per part, not as text', () => {
    expect(compareVersions('0.10', '0.9')).toBeGreaterThan(0); // 10 > 9, text order says less
    expect(compareVersions('0.1', '0.2')).toBeLessThan(0);
    expect(compareVersions('2', '10')).toBeLessThan(0);
  });

  it('treats a missing part as zero', () => {
    expect(compareVersions('1', '1.0')).toBe(0);
    expect(compareVersions('1.0.1', '1')).toBeGreaterThan(0);
    expect(compareVersions('1', '1.0.1')).toBeLessThan(0);
    expect(compareVersions('0.1', '0.1')).toBe(0);
  });
});

describe('BR-010-05: a version is in effect from its effectiveAt on', () => {
  const published = v('terms', '0.1', '2026-11-19T03:00:00.000Z');

  it('is not in effect one millisecond before', () => {
    expect(isInEffect(published, at('2026-11-19T02:59:59.999Z'))).toBe(false);
  });

  it('is in effect at exactly effectiveAt (half-open interval)', () => {
    expect(isInEffect(published, at('2026-11-19T03:00:00.000Z'))).toBe(true);
  });

  it('is in effect after', () => {
    expect(isInEffect(published, at('2026-11-19T03:00:00.001Z'))).toBe(true);
  });
});

describe('BR-010-05: the current version of a document', () => {
  const versions = [
    v('terms', '0.1', '2026-01-01T00:00:00.000Z'),
    v('terms', '0.2', '2026-06-01T00:00:00.000Z'),
    v('privacy', '0.1', '2026-01-01T00:00:00.000Z'),
    v('privacy', '1.0', '2027-01-01T00:00:00.000Z'),
  ];

  it('is the latest effective date not in the future', () => {
    expect(currentVersion('terms', versions, at('2026-07-01T00:00:00.000Z'))?.version).toBe('0.2');
  });

  it('does not count a future-dated version as current', () => {
    expect(currentVersion('privacy', versions, at('2026-07-01T00:00:00.000Z'))?.version).toBe(
      '0.1',
    );
    expect(currentVersion('privacy', versions, at('2026-12-31T23:59:59.999Z'))?.version).toBe(
      '0.1',
    );
  });

  it('switches at exactly the new effectiveAt', () => {
    expect(currentVersion('privacy', versions, at('2027-01-01T00:00:00.000Z'))?.version).toBe(
      '1.0',
    );
    expect(currentVersion('terms', versions, at('2026-05-31T23:59:59.999Z'))?.version).toBe('0.1');
    expect(currentVersion('terms', versions, at('2026-06-01T00:00:00.000Z'))?.version).toBe('0.2');
  });

  it('is null when nothing of the type is in effect yet, or the type has no version', () => {
    expect(currentVersion('terms', versions, at('2025-12-31T23:59:59.999Z'))).toBeNull();
    expect(
      currentVersion('privacy', [versions[0] as PublishedVersion], at('2030-01-01')),
    ).toBeNull();
    expect(currentVersion('terms', [], at('2030-01-01'))).toBeNull();
  });

  it('ignores the other document type even when it is newer', () => {
    const mixed = [
      v('terms', '0.1', '2026-01-01T00:00:00.000Z'),
      v('privacy', '9', '2026-02-01T00:00:00.000Z'),
    ];
    expect(currentVersion('terms', mixed, at('2026-03-01T00:00:00.000Z'))?.version).toBe('0.1');
  });

  it('decides equal instants by the higher version, whatever the order of the list', () => {
    const tie = [
      v('terms', '0.2', '2026-01-01T00:00:00.000Z'),
      v('terms', '0.10', '2026-01-01T00:00:00.000Z'),
    ];
    const now = at('2026-02-01T00:00:00.000Z');
    expect(currentVersion('terms', tie, now)?.version).toBe('0.10');
    expect(currentVersion('terms', [...tie].reverse(), now)?.version).toBe('0.10');
  });

  it('keeps the earlier candidate when a later-listed one is older or lower', () => {
    const list = [
      v('terms', '0.5', '2026-03-01T00:00:00.000Z'),
      v('terms', '0.4', '2026-02-01T00:00:00.000Z'), // older instant
      v('terms', '0.3', '2026-03-01T00:00:00.000Z'), // same instant, lower version
    ];
    expect(currentVersion('terms', list, at('2026-04-01T00:00:00.000Z'))?.version).toBe('0.5');
  });
});

describe('BR-010-01: a request for versions that are not the current ones', () => {
  const current = { terms: '0.2', privacy: '0.1' } as const;

  it('is outdated for the types whose requested version differs, in catalogue order', () => {
    expect(outdatedTypes(current, { terms: '0.1', privacy: '0.0' })).toEqual(['terms', 'privacy']);
    expect(outdatedTypes(current, { terms: '0.2', privacy: '0.0' })).toEqual(['privacy']);
  });

  it('is not outdated when it names the current versions, or names none', () => {
    expect(outdatedTypes(current, { terms: '0.2', privacy: '0.1' })).toEqual([]);
    expect(outdatedTypes(current, {})).toEqual([]);
    expect(outdatedTypes(current, { terms: undefined, privacy: undefined })).toEqual([]);
  });

  it('compares the version as written: 0.10 is not 0.1', () => {
    expect(outdatedTypes(current, { privacy: '0.10' })).toEqual(['privacy']);
  });
});

describe('BR-010-05: what an account still has to accept', () => {
  const current = [
    { type: 'terms', version: '0.2' },
    { type: 'privacy', version: '0.1' },
  ] as const;

  it('is both documents for an account that accepted nothing', () => {
    expect(pendingAcceptances(current, [])).toEqual(current);
  });

  it('is only the document whose current version was not accepted', () => {
    expect(
      pendingAcceptances(current, [
        { type: 'terms', version: '0.1' }, // an older version does not count
        { type: 'privacy', version: '0.1' },
      ]),
    ).toEqual([{ type: 'terms', version: '0.2' }]);
  });

  it("does not take another type's acceptance of the same version number", () => {
    expect(pendingAcceptances(current, [{ type: 'terms', version: '0.1' }])).toEqual(current);
  });

  it('is empty when everything current was accepted', () => {
    expect(
      pendingAcceptances(current, [
        { type: 'privacy', version: '0.1' },
        { type: 'terms', version: '0.2' },
      ]),
    ).toEqual([]);
  });

  it('knows the two document types', () => {
    expect(LEGAL_DOCUMENT_TYPES).toEqual(['terms', 'privacy']);
  });
});
