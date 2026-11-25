import { describe, expect, it } from 'vitest';
import {
  DOCUMENT_RECHECK_DAYS,
  documentReplacedEntry,
  isNewVersion,
  shouldFetchDocument,
  type VersionFacts,
} from './document-versions.js';
import { brasiliaInstant } from './import-schedule.js';

const NOW = brasiliaInstant('2026-11-24', 600);
const stored = (overrides: Partial<VersionFacts> = {}): VersionFacts => ({
  sourceUrl: 'https://venda-imoveis.caixa.gov.br/editais/EL1.PDF',
  contentHash: 'a'.repeat(64),
  checkedAt: brasiliaInstant('2026-11-20', 600),
  publishedAt: new Date('2026-11-01T12:00:00Z'),
  ...overrides,
});
const page = (overrides: Partial<{ url: string | null; publishedAt: Date | null }> = {}) => ({
  url: 'https://venda-imoveis.caixa.gov.br/editais/EL1.PDF',
  publishedAt: new Date('2026-11-01T12:00:00Z'),
  ...overrides,
});

describe('shouldFetchDocument (BR-004-30)', () => {
  it('has nothing to ask for when the page names no document, whatever is stored', () => {
    expect(shouldFetchDocument(null, page({ url: null }), NOW)).toBe(false);
    expect(shouldFetchDocument(stored(), page({ url: null }), NOW)).toBe(false);
  });

  it('fetches a document no version holds yet', () => {
    expect(shouldFetchDocument(null, page(), NOW)).toBe(true);
  });

  it('fetches again when the address changed', () => {
    expect(
      shouldFetchDocument(
        stored(),
        page({ url: 'https://venda-imoveis.caixa.gov.br/editais/EL2.PDF' }),
        NOW,
      ),
    ).toBe(true);
  });

  it('fetches again when Caixa shows another publication date, or one where none was stored', () => {
    expect(
      shouldFetchDocument(stored(), page({ publishedAt: new Date('2026-11-10T12:00:00Z') }), NOW),
    ).toBe(true);
    expect(shouldFetchDocument(stored({ publishedAt: null }), page(), NOW)).toBe(true);
  });

  it('does not fetch what is unchanged and recent, even when the page shows no date', () => {
    expect(shouldFetchDocument(stored(), page(), NOW)).toBe(false);
    expect(shouldFetchDocument(stored(), page({ publishedAt: null }), NOW)).toBe(false);
  });

  it('fetches again, to compare content, once it was last compared 30 calendar days ago', () => {
    expect(DOCUMENT_RECHECK_DAYS).toBe(30);
    const retrieved = (day: string) => stored({ checkedAt: brasiliaInstant(day, 1380) });
    // Retrieved on 2026-10-25 at 23:00: due on 2026-11-24 (30 days on), not a day earlier.
    expect(shouldFetchDocument(retrieved('2026-10-25'), page(), NOW)).toBe(true);
    expect(shouldFetchDocument(retrieved('2026-10-26'), page(), NOW)).toBe(false);
  });
});

describe('isNewVersion (BR-004-30)', () => {
  const current = { sourceUrl: 'u1', contentHash: 'h1' };

  it('is new when there is none, or the address or the content differs', () => {
    expect(isNewVersion(null, current)).toBe(true);
    expect(isNewVersion(current, { sourceUrl: 'u2', contentHash: 'h1' })).toBe(true);
    expect(isNewVersion(current, { sourceUrl: 'u1', contentHash: 'h2' })).toBe(true);
  });

  it('is not new when the address and the content are the same', () => {
    expect(isNewVersion(current, { sourceUrl: 'u1', contentHash: 'h1' })).toBe(false);
  });
});

describe('documentReplacedEntry (BR-004-30)', () => {
  const previous = { contentHash: 'a'.repeat(64) };
  const next = { contentHash: 'b'.repeat(64) };

  it('records the replacement as an irrelevant OTHER_FIELD entry of the document, by hash prefix', () => {
    expect(documentReplacedEntry('123', 'EDITAL', previous, next)).toEqual({
      propertyCode: '123',
      source: 'DETAILS',
      type: 'OTHER_FIELD',
      relevant: false,
      field: 'edital',
      oldValue: 'aaaaaaaaaaaaaaaa',
      newValue: 'bbbbbbbbbbbbbbbb',
    });
    expect(documentReplacedEntry('123', 'MATRICULA', previous, next)?.field).toBe('matricula');
  });

  it('records nothing for a first copy, nor for the same content under a new address', () => {
    expect(documentReplacedEntry('123', 'EDITAL', null, next)).toBeNull();
    expect(documentReplacedEntry('123', 'EDITAL', previous, previous)).toBeNull();
  });
});
