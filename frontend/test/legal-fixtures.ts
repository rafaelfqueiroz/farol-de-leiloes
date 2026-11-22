// SPEC-010: the current legal documents as GET /api/legal/current answers them, for the tests of the
// screens that show or send their versions. Example texts, never the lawyer's.
import type { CurrentLegal, LegalDocumentData } from '@/lib/legal';

const EFFECTIVE_AT = '2026-11-19T03:00:00.000Z';

export const TERMS_DOCUMENT: LegalDocumentData = {
  type: 'terms',
  version: '0.2',
  effectiveAt: EFFECTIVE_AT,
  draft: true,
  title: 'Termos de Uso',
  banner: 'RASCUNHO — pendente de revisão jurídica',
  content: '# Termos de Uso\n\n## 1. O serviço\n\n- O que é o Farol dos Leilões.\n',
};

export const PRIVACY_DOCUMENT: LegalDocumentData = {
  type: 'privacy',
  version: '0.2',
  effectiveAt: EFFECTIVE_AT,
  draft: true,
  title: 'Política de Privacidade',
  banner: 'RASCUNHO — pendente de revisão jurídica',
  content: '# Política de Privacidade\n\n## 1. Quem trata seus dados\n\nTexto.\n',
};

export const CURRENT_LEGAL: CurrentLegal = { terms: TERMS_DOCUMENT, privacy: PRIVACY_DOCUMENT };

/** The `Response` the public API gives for the current documents. */
export function currentLegalResponse(legal: CurrentLegal = CURRENT_LEGAL): Response {
  return new Response(JSON.stringify(legal), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}
