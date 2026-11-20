// SPEC-010 BR-010-09: the export's envelope (hand-written expectations, TS-04).
import { describe, expect, it } from 'vitest';
import {
  EXPORT_RESERVED_KEYS,
  EXPORT_SCHEMA_VERSION,
  buildExportDocument,
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
