// SPEC-010 BR-010-25, BR-010-26 (DL-010-07): when a lawyer's validation counts. The F1 launch and the
// legal-analysis features wait on it (RNF-23, RNF-24, Q-21). Pure (AR-05): the records, the document
// versions in force and the retention setting come in as arguments; nothing here reads a database or
// the time. A critical module, held at 100% branch coverage (TS-24).
//
// A validation is a record naming a scope and, where it applies, what was reviewed. It counts only
// while what was reviewed is still what is in force, so publishing a new version of the terms or the
// privacy policy, or changing the retention setting, REOPENS the gate until it is validated again.
import {
  LEGAL_DOCUMENT_TYPES,
  type LegalDocumentRef,
  type LegalDocumentType,
  VERSION_PATTERN,
} from './legal-versions.js';

export const LEGAL_VALIDATION_SCOPES = [
  'third-party-processing',
  'retention-periods',
  'privacy-policy',
  'terms',
] as const;
export type LegalValidationScope = (typeof LEGAL_VALIDATION_SCOPES)[number];

/** One recorded validation, as the decision reads it. */
export interface ValidationRecord {
  readonly scope: LegalValidationScope;
  readonly validatedAt: Date;
  /** `terms:1.0`, `privacy:1.0` (documentVersionKey): the texts the lawyer reviewed. */
  readonly documentVersions: readonly string[];
  /** The DOCUMENT_RETENTION_YEARS the lawyer reviewed (scope retention-periods); null: not recorded. */
  readonly retentionYears?: number | null;
}

/** What is in force now: the inputs that decide whether a record still counts. */
export interface ValidationState {
  readonly currentVersions: Readonly<Record<LegalDocumentType, string>>;
  readonly retentionYears: number;
}

export interface GateDecision {
  readonly validated: boolean;
  /** The record that made the gate pass; null when it is not validated. */
  readonly record: ValidationRecord | null;
}

/** `terms:1.0`: how a validation names a document version. */
export function documentVersionKey(ref: LegalDocumentRef): string {
  return `${ref.type}:${ref.version}`;
}

/** The reverse of documentVersionKey; null for anything that is not `<type>:<version>`. */
export function parseDocumentVersionKey(key: string): LegalDocumentRef | null {
  const separator = key.indexOf(':');
  if (separator === -1) return null;
  const type = key.slice(0, separator);
  const version = key.slice(separator + 1);
  if (
    !(LEGAL_DOCUMENT_TYPES as readonly string[]).includes(type) ||
    !VERSION_PATTERN.test(version)
  ) {
    return null;
  }
  return { type: type as LegalDocumentType, version };
}

/** Which document a version-bound scope is about. */
const DOCUMENT_OF_SCOPE: Readonly<Partial<Record<LegalValidationScope, LegalDocumentType>>> = {
  terms: 'terms',
  'privacy-policy': 'privacy',
};

/** The document type a scope reviews, or null for a scope that is not about one text. */
export function documentTypeOfScope(scope: LegalValidationScope): LegalDocumentType | null {
  return DOCUMENT_OF_SCOPE[scope] ?? null;
}

/**
 * Whether the gate of `scope` is open (validated) and by which record. `records` are the validations
 * of that scope, NEWEST FIRST (on equal `validatedAt` the first listed wins); records of another scope
 * are ignored.
 *
 * - `terms` / `privacy-policy`: the newest record that names the document version IN FORCE now
 *   (`terms:1.0`); a record of an older version does not count, so a new version reopens the gate.
 * - `retention-periods`: the NEWEST record decides, and counts when it recorded no period or the one
 *   now set (BR-010-24): a later review supersedes an earlier one, and changing the setting after
 *   the review reopens the gate.
 * - `third-party-processing`: counts once any record exists; the newest is the one shown.
 */
export function evaluateGate(
  scope: LegalValidationScope,
  records: readonly ValidationRecord[],
  state: ValidationState,
): GateDecision {
  // Newest first; the sort is stable, so on equal instants the order given is kept.
  const mine = records
    .filter((record) => record.scope === scope)
    .sort((a, b) => b.validatedAt.getTime() - a.validatedAt.getTime());

  const type = documentTypeOfScope(scope);
  if (type !== null) {
    const key = documentVersionKey({ type, version: state.currentVersions[type] });
    const found = mine.find((record) => record.documentVersions.includes(key)) ?? null;
    return { validated: found !== null, record: found };
  }
  const newest = mine[0] ?? null;
  if (newest === null) return { validated: false, record: null };
  if (scope === 'retention-periods') {
    const reviewed = newest.retentionYears ?? null;
    const counts = reviewed === null || reviewed === state.retentionYears;
    return { validated: counts, record: counts ? newest : null };
  }
  return { validated: true, record: newest };
}
