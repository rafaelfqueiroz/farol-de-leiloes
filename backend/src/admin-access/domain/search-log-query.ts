// SPEC-009 BR-009-14, DL-009-06, decision 3 of #9: what the admin access log keeps of an account
// search. Never the terms: the person's name or address is personal data, and the log is kept until
// the lawyer sets a period (SECURITY §9). The entry holds the KIND of the search, how many characters
// it had and a KEYED hash of the normalised terms, so "did two searches look for the same thing" and
// "what kind of lookup is this admin making" can be answered and the terms cannot be read back or
// guessed from the log without the key. Pure (AR-05): the key comes in as an argument.
import { createHmac } from 'node:crypto';

export const SEARCH_KINDS = ['email', 'name'] as const;
export type SearchKind = (typeof SEARCH_KINDS)[number];

/** Hex characters kept of the HMAC: 128 bits, ample to tell searches apart. */
export const SEARCH_HASH_LENGTH = 32;

/** Domain separation: a hash of search terms never equals the hash of a user id made with the same key (AR-46). */
const HASH_CONTEXT = 'account_search:';

/** Stands for the hash when no key is configured (LOG_HASH_SECRET is optional outside production, AR-41). */
export const NO_SEARCH_HASH = '-';

/**
 * `<kind>:<length>:<hmac>`, e.g. `name:5:3f9a...`. `terms` are the NORMALISED terms (the search
 * route's own normalisation: NFKC, lower-case, trimmed, inner spaces collapsed), so the same search
 * typed two ways gives the same value. Without a key the hash part is `-`: an unkeyed hash of a name
 * or an address can be guessed by anyone who has the log, so none is written.
 */
export function searchLogQuery(
  secret: string | undefined,
  kind: SearchKind,
  terms: string,
): string {
  const hash = secret
    ? createHmac('sha256', secret)
        .update(`${HASH_CONTEXT}${terms}`)
        .digest('hex')
        .slice(0, SEARCH_HASH_LENGTH)
    : NO_SEARCH_HASH;
  return `${kind}:${terms.length}:${hash}`;
}
