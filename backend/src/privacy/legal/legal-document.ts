// SPEC-010 BR-010-02, BR-010-04: the legal documents are published from the repository, not from a
// collection (DV-21: the issue planned `legal_documents`). A text is a typed constant, so a change
// to a published version is a code change that shows in review, and its hash is pinned by a test
// (legal-registry.spec.ts): a published text is never edited, a change is a new version.
import { createHash } from 'node:crypto';
import type { LegalDocumentType } from '../domain/legal-versions.js';

/** The banner of every placeholder text, until the lawyer's review is recorded (Q-21, BR-010-26). */
export const DRAFT_BANNER = 'RASCUNHO — pendente de revisão jurídica';

/** A text as written in the repository. */
export interface LegalDocumentSource {
  readonly type: LegalDocumentType;
  /** Dotted numeric version (VERSION_PATTERN). Unique per type. */
  readonly version: string;
  /** The first instant the version is in force (BR-010-05). */
  readonly effectiveAt: Date;
  /** True while the text is a placeholder not yet reviewed by a lawyer (BR-010-26). */
  readonly draft: boolean;
  readonly title: string;
  /** Shown above the text; the draft marker for a placeholder, null for a reviewed text. */
  readonly banner: string | null;
  /** The text, in Markdown. */
  readonly content: string;
}

/** A source plus the hash an acceptance records as proof of exactly which text was accepted. */
export interface PublishedLegalDocument extends LegalDocumentSource {
  readonly contentHash: string;
}

/**
 * sha256 (hex) of everything the reader sees of the text: type, version, title, banner and
 * content. The effective instant is not text and is pinned separately by the registry spec.
 */
export function contentHashOf(source: LegalDocumentSource): string {
  const text = JSON.stringify([
    source.type,
    source.version,
    source.title,
    source.banner,
    source.content,
  ]);
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

export function publish(source: LegalDocumentSource): PublishedLegalDocument {
  return Object.freeze({ ...source, contentHash: contentHashOf(source) });
}
