// SPEC-010 BR-010-02, BR-010-04: the shape of the legal documents on the wire (GET /api/legal/current)
// and the one place they are validated. Shared by the public pages (server), the sign-up forms and
// the re-acceptance dialog (browser): the versions a person is shown are the versions sent back.
import { z } from 'zod';

export const LEGAL_DOCUMENT_TYPES = ['terms', 'privacy'] as const;
export type LegalDocumentType = (typeof LEGAL_DOCUMENT_TYPES)[number];

export const legalDocumentSchema = z.object({
  type: z.enum(LEGAL_DOCUMENT_TYPES),
  version: z.string().min(1),
  /** First instant the version is in force (an ISO instant). */
  effectiveAt: z.string().min(1),
  /** True while the text is a placeholder not yet reviewed by a lawyer (BR-010-26). */
  draft: z.boolean(),
  title: z.string(),
  banner: z.string().nullable(),
  /** Markdown. */
  content: z.string(),
});
export type LegalDocumentData = z.infer<typeof legalDocumentSchema>;

export const currentLegalSchema = z.object({
  terms: legalDocumentSchema,
  privacy: legalDocumentSchema,
});
export type CurrentLegal = z.infer<typeof currentLegalSchema>;

/** The two versions a form or the dialog sends with an acceptance (BR-010-01, BR-010-05). */
export interface AcceptedVersions {
  termsVersion: string;
  privacyVersion: string;
}

export function versionsOf(legal: CurrentLegal): AcceptedVersions {
  return { termsVersion: legal.terms.version, privacyVersion: legal.privacy.version };
}

/** Where each document is read (public pages, BR-010-02). */
export const LEGAL_PATHS: Record<LegalDocumentType, string> = {
  terms: '/termos',
  privacy: '/privacidade',
};

/** Where the person exercises their rights (BR-010-05: reachable even with a version pending). */
export const PRIVACY_PAGE_PATH = '/profile/privacidade';
