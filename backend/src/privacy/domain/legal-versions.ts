// SPEC-010 BR-010-03, BR-010-04, BR-010-05: which version of each legal document is in force at an
// instant, and what an account still has to accept. Pure (AR-05): the time comes in as an argument
// (AR-24) and nothing here touches a database, a framework or the environment. It is a critical
// module, so it is held at 100% branch coverage (TS-24).

export const LEGAL_DOCUMENT_TYPES = ['terms', 'privacy'] as const;
export type LegalDocumentType = (typeof LEGAL_DOCUMENT_TYPES)[number];

/** BR-010-03: the way an acceptance happened. `invitation` is SPEC-011's. */
export const ACCEPTANCE_METHODS = [
  'signup_email',
  'signup_google',
  'invitation',
  'reacceptance',
] as const;
export type AcceptanceMethod = (typeof ACCEPTANCE_METHODS)[number];

/** Dotted numeric versions: `0.1`, `1`, `2.0.3` (at most four parts of at most four digits). */
export const VERSION_PATTERN = /^\d{1,4}(\.\d{1,4}){0,3}$/;

/** The identity of one published text: what an acceptance and an error context name. */
export interface LegalDocumentRef {
  readonly type: LegalDocumentType;
  readonly version: string;
}

/** A published text and the instant it takes effect (BR-010-04). */
export interface PublishedVersion extends LegalDocumentRef {
  readonly effectiveAt: Date;
}

/** Negative when `a` is the older version, positive when newer, 0 when equal (`1` equals `1.0`). */
export function compareVersions(a: string, b: string): number {
  const left = a.split('.').map(Number);
  const right = b.split('.').map(Number);
  const length = Math.max(left.length, right.length);
  for (let i = 0; i < length; i += 1) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
}

/** A version is in effect from its `effectiveAt` on, that instant included (half-open interval). */
export function isInEffect(version: PublishedVersion, now: Date): boolean {
  return version.effectiveAt.getTime() <= now.getTime();
}

/**
 * The version of `type` in force at `now`: the one with the latest `effectiveAt` that is not in
 * the future (BR-010-05). A future-dated version is not current yet. Equal instants are decided by
 * the higher version number, so the answer never depends on the order of the list. Null when no
 * version of the type is in effect.
 */
export function currentVersion<T extends PublishedVersion>(
  type: LegalDocumentType,
  versions: readonly T[],
  now: Date,
): T | null {
  let best: T | null = null;
  for (const candidate of versions) {
    if (candidate.type !== type || !isInEffect(candidate, now)) continue;
    if (best === null) {
      best = candidate;
      continue;
    }
    const byInstant = candidate.effectiveAt.getTime() - best.effectiveAt.getTime();
    if (
      byInstant > 0 ||
      (byInstant === 0 && compareVersions(candidate.version, best.version) > 0)
    ) {
      best = candidate;
    }
  }
  return best;
}

/**
 * The types, in catalogue order, for which `requested` names a version other than the current one.
 * A type the request leaves out (undefined) means "the current one" and is never outdated.
 */
export function outdatedTypes(
  current: Readonly<Record<LegalDocumentType, string>>,
  requested: Readonly<Partial<Record<LegalDocumentType, string | undefined>>>,
): LegalDocumentType[] {
  return LEGAL_DOCUMENT_TYPES.filter(
    (type) => requested[type] !== undefined && requested[type] !== current[type],
  );
}

/** What of `current` the account has not accepted yet (BR-010-05), in the order of `current`. */
export function pendingAcceptances(
  current: readonly LegalDocumentRef[],
  accepted: readonly LegalDocumentRef[],
): LegalDocumentRef[] {
  return current.filter(
    (document) =>
      !accepted.some((done) => done.type === document.type && done.version === document.version),
  );
}
