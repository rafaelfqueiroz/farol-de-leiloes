// SPEC-009 BR-009-13: the admin's search of accounts by name or email. Pure (AR-05, 100% branch):
// how the typed terms are normalised, which kind of search they are and whether they are long enough.
// The route's DTO applies it (so the validated value IS the normalised one), the service searches with
// it and the access log hashes it (admin-access/domain/search-log-query.ts): one normalisation, so
// "the same search typed two ways" is one search everywhere.

/** BR-009-13: no search of fewer than 3 characters (a broad scan), none of more than 100. */
export const SEARCH_LENGTH = { min: 3, max: 100 } as const;

export type AccountSearchKind = 'email' | 'name';

/** NFKC, lower-case, trimmed, inner runs of whitespace collapsed to one space. */
export function normaliseSearchTerms(typed: string): string {
  return typed.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/** A search with an `@` looks for an address; anything else for a name (or part of an address). */
export function searchKindOf(normalisedTerms: string): AccountSearchKind {
  return normalisedTerms.includes('@') ? 'email' : 'name';
}
