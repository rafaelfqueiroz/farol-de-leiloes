// SPEC-010 BR-010-09: the export's envelope (hand-written expectations, TS-04).
import { describe, expect, it } from 'vitest';
import {
  EXPORT_RESERVED_KEYS,
  EXPORT_SCHEMA_VERSION,
  MY_DATA_LIST_LIMIT,
  buildExportDocument,
  capSections,
  listSection,
} from './export-document.js';

describe('BR-010-09: the export envelope', () => {
  it('is the version, the instant and one key per provider', () => {
    const document = buildExportDocument(new Date('2026-03-10T15:00:00.000Z'), {
      account: { email: 'a@example.test' },
      favorites: { items: [] },
    });

    expect(document).toEqual({
      schemaVersion: 1,
      generatedAt: '2026-03-10T15:00:00.000Z',
      account: { email: 'a@example.test' },
      favorites: { items: [] },
    });
    expect(EXPORT_SCHEMA_VERSION).toBe(1);
  });

  it('keeps the envelope even if a section tried to carry its keys', () => {
    const document = buildExportDocument(new Date('2026-03-10T15:00:00.000Z'), {
      schemaVersion: 99,
      generatedAt: 'never',
    });

    expect(document.schemaVersion).toBe(1);
    expect(document.generatedAt).toBe('2026-03-10T15:00:00.000Z');
    expect([...EXPORT_RESERVED_KEYS]).toEqual(['schemaVersion', 'generatedAt']);
  });
});

describe('BR-010-08: the bounded "my data" view', () => {
  it('shows 200 records of a list', () => {
    expect(MY_DATA_LIST_LIMIT).toBe(200);
  });

  it('listSection: a complete list is just its items; a cut one says how many there are', () => {
    expect(listSection(['a', 'b'], 2)).toEqual({ items: ['a', 'b'] });
    expect(listSection([], 0)).toEqual({ items: [] });
    expect(listSection(['a', 'b'], 5)).toEqual({
      items: ['a', 'b'],
      truncated: true,
      totals: { items: 5 },
    });
  });

  it('capSections: leaves a list of exactly the limit and shorter ones as they are', () => {
    const sections = { favorites: { items: [1, 2, 3] }, sessions: { items: [] } };

    expect(capSections(sections, 3)).toEqual(sections);
  });

  it('capSections: cuts a longer list to its first entries and says so, per list', () => {
    const capped = capSections(
      {
        favorites: { items: [1, 2, 3, 4, 5], other: 'x' },
        acceptances: { items: [1], more: [1, 2, 3, 4] },
      },
      3,
    );

    expect(capped).toEqual({
      favorites: { items: [1, 2, 3], other: 'x', truncated: true, totals: { items: 5 } },
      acceptances: { items: [1], more: [1, 2, 3], truncated: true, totals: { more: 4 } },
    });
  });

  it('capSections: keeps what the provider already reported and merges its own cut', () => {
    const capped = capSections(
      { reminders: { items: [1, 2], truncated: true, totals: { items: 900 }, extra: [1, 2, 3] } },
      2,
    );

    expect(capped['reminders']).toEqual({
      items: [1, 2],
      truncated: true,
      totals: { items: 900, extra: 3 },
      extra: [1, 2],
    });
  });

  it('capSections: passes through what is not a plain section', () => {
    expect(capSections({ n: 5, none: null, list: [1, 2, 3, 4] }, 2)).toEqual({
      n: 5,
      none: null,
      list: [1, 2, 3, 4],
    });
  });
});
