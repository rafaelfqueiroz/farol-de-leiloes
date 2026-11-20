import { publish, type PublishedLegalDocument } from '../../src/privacy/legal/legal-document.js';
import type { LegalDocumentSource } from '../../src/privacy/legal/legal-document.js';

/** TS-29: a published legal text (placeholder content), overridden per test. */
export function aLegalDocument(
  overrides: Partial<LegalDocumentSource> = {},
): PublishedLegalDocument {
  const type = overrides.type ?? 'terms';
  const version = overrides.version ?? '0.1';
  return publish({
    type,
    version,
    effectiveAt: new Date('2000-01-01T00:00:00.000Z'),
    draft: true,
    title: type === 'terms' ? 'Termos de teste' : 'Privacidade de teste',
    banner: null,
    content: `Texto de teste de ${type} ${version}`,
    ...overrides,
  });
}

/** Version `version` of both documents, effective at `effectiveAt` (default: long ago). */
export function aLegalRegistry(
  version = '0.1',
  effectiveAt = new Date('2000-01-01T00:00:00.000Z'),
): PublishedLegalDocument[] {
  return [
    aLegalDocument({ type: 'terms', version, effectiveAt }),
    aLegalDocument({ type: 'privacy', version, effectiveAt }),
  ];
}
