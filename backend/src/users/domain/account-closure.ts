// SPEC-010 BR-010-14, BR-010-15: what closing an account and purging a closed one mean for the
// account document. Pure (AR-05): no clock, no database; `UsersService` applies it.
/**
 * The statuses an account may be closed from (BR-010-14). `closed` is final: a second closure is
 * not a transition and changes nothing. A document without a status is active (AR-28), so the
 * update that closes an account also matches a missing status.
 */
export const CLOSABLE_STATUSES = ['active', 'deactivated'] as const;

/**
 * The fields the purge removes from the document of a closed account (BR-010-15): everything that
 * names or identifies the person or signs them in, and the legacy billing ids and values nothing
 * reads any more (SC-25). `_id`, `status`, `closedAt`, `purgedAt`, the timestamps, the credential
 * version, the legacy plan tier and the two consent-generation instants stay: they identify no one
 * and the retained consent records refer to them (BR-010-22/23, SECURITY §9).
 *
 * The email is not here: it is REPLACED (`purgedEmail`), never unset, because it is required and
 * unique.
 */
export const PURGE_REMOVED_FIELDS = [
  'name',
  'phone',
  'googleId',
  'password',
  'providers',
  'emailVerified',
  'isAdmin',
  'cpf',
  'dateOfBirth',
  'sex',
  'address',
  'stripeCustomerId',
  'stripeSubscriptionId',
  'subscriptionStatus',
] as const;

/**
 * The fields the purge writes while it works and removes when it finishes: the claim (a token and its
 * lease) and the fairness stamp of the attempts (`lastPurgeAttemptAt`, `purgeAttempts`, BR-010-15:
 * an account that keeps failing goes to the back of the queue, so it never starves a healthy one).
 * None names a person.
 */
export const PURGE_CLAIM_FIELDS = [
  'purgeClaimToken',
  'purgeClaimUntil',
  'lastPurgeAttemptAt',
  'purgeAttempts',
] as const;

/**
 * BR-010-15: how long after the tombstone the RESIDUE SWEEP re-runs the providers' `purge` for the
 * account, once. A request that passed authentication before the closure can still write a record
 * of the account (a favourite, a reminder, a session) after the purge deleted them; the sweep
 * deletes it at most a day later. Every provider's purge is idempotent, so the repeat is safe.
 */
export const RESIDUE_SWEEP_DELAY_MS = 24 * 60 * 60 * 1000;

/** The instant from which the residue sweep may run for an account purged at `purgedAt`. */
export function residueSweepDueAt(purgedAt: Date): Date {
  return new Date(purgedAt.getTime() + RESIDUE_SWEEP_DELAY_MS);
}

/**
 * The address a purged account keeps (BR-010-15): unique per account (it carries the `_id`), on the
 * reserved `.invalid` domain (RFC 6761) so it can never be a real mailbox, and carrying nothing of
 * the person. The real address becomes free to register again.
 */
export function purgedEmail(userId: string): string {
  return `purged-${userId}@removed.invalid`;
}

/**
 * The same tombstone address with a random suffix, for the (not expected) case that the plain one is
 * taken: sign-ups refuse the `.invalid` domain, but the purge must never fail for that reason.
 */
export function purgedEmailWithSuffix(userId: string, suffix: string): string {
  return `purged-${userId}-${suffix}@removed.invalid`;
}
