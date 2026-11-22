// SPEC-010 BR-010-04: every published version of the terms and the privacy policy, with its
// effective date. Appending a version is the only way to change a published text (the previous
// entries stay, byte for byte); the registry spec pins each hash and fails on an edit.
import { publish, type PublishedLegalDocument } from './legal-document.js';
import { PRIVACY_0_1 } from './privacy-0.1.js';
import { TERMS_0_1 } from './terms-0.1.js';

export const LEGAL_REGISTRY: readonly PublishedLegalDocument[] = Object.freeze([
  publish(TERMS_0_1),
  publish(PRIVACY_0_1),
]);

/** DI token of the registry the service reads; specs bind another one to publish a new version. */
export const LEGAL_DOCUMENTS = Symbol('LEGAL_DOCUMENTS');
