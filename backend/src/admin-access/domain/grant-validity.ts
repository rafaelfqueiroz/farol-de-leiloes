// SPEC-002 BR-002-26 / DL-002-04: whether a support access grant still lets its admin read. Pure
// (AR-05): the grant, the support request as read NOW and the current time all come in as
// arguments, so the service re-checks it on every read with the injected Clock (AR-24).
//
// A grant ends at the first of:
//   - the support request is closed (or no longer exists)          → 'closed'
//   - the requester withdraws the permission to view their data    → 'withdrawn'
//   - 7 days pass since the grant was opened                       → 'expired'
//
// The 7 days are a half-open interval [openedAt, openedAt + 7 d): the grant is valid strictly
// before its expiry instant and ended AT it. "7 days pass" is complete at exactly 7 days, so a read
// at openedAt + 7 d is refused, and so is one at 7 days and 1 minute (the acceptance criterion).
//
// Checked lazily, on each read: SPEC-009 ends a grant eagerly when the request is closed or the
// permission withdrawn (SupportGrantService.endForSupportRequest), and expiry needs no job because
// no read can pass this check after it. When a read finds the request already closed or withdrawn,
// that reason wins over expiry: SPEC-009's eager end would have recorded it first, and the exact
// moment of the closure is not known here, so the end is recorded at `now`. An expiry found lazily
// is recorded at its true instant, `expiresAt`.

export const GRANT_LIFETIME_DAYS = 7;
export const GRANT_LIFETIME_MS = GRANT_LIFETIME_DAYS * 24 * 60 * 60 * 1000;

// A fourth reason is recorded by the service rather than found here: `holder_inactive`, the admin who
// holds the grant is no longer an active admin (their account was deactivated, SPEC-009).
export const GRANT_END_REASONS = ['closed', 'withdrawn', 'expired', 'holder_inactive'] as const;
export type GrantEndReason = (typeof GRANT_END_REASONS)[number];

/** The grant, as stored. */
export interface GrantFacts {
  readonly openedAt: Date;
  /** Set once the grant has ended; it never reopens. */
  readonly endedAt?: Date;
  readonly endReason?: GrantEndReason;
}

/** The support request, as SPEC-009 says it is now; null when it does not exist. */
export interface SupportRequestState {
  readonly open: boolean;
  readonly dataAccessAllowed: boolean;
}

export type GrantValidity =
  | { readonly valid: true; readonly expiresAt: Date }
  | {
      readonly valid: false;
      readonly reason: GrantEndReason;
      /** When it ended: the stored end, the expiry instant, or now for a closure found now. */
      readonly endedAt: Date;
      /** True when the grant was already recorded as ended: nothing to persist. */
      readonly alreadyEnded: boolean;
    };

/** BR-002-26: openedAt + 7 days, the first instant the grant no longer covers. */
export function grantExpiresAt(openedAt: Date): Date {
  return new Date(openedAt.getTime() + GRANT_LIFETIME_MS);
}

/** BR-002-26: whether the grant is still valid at `now`, and if not, why and since when. */
export function grantValidity(
  grant: GrantFacts,
  request: SupportRequestState | null,
  now: Date,
): GrantValidity {
  if (grant.endedAt) {
    return {
      valid: false,
      // A stored end without its reason (a hand-edited row) still ends the grant: fail closed.
      reason: grant.endReason ?? 'expired',
      endedAt: grant.endedAt,
      alreadyEnded: true,
    };
  }
  const ended = (reason: GrantEndReason, endedAt: Date): GrantValidity => ({
    valid: false,
    reason,
    endedAt,
    alreadyEnded: false,
  });
  // A request that no longer exists is as closed as one closed (fail closed).
  if (!request || !request.open) return ended('closed', now);
  if (!request.dataAccessAllowed) return ended('withdrawn', now);
  const expiresAt = grantExpiresAt(grant.openedAt);
  if (now.getTime() >= expiresAt.getTime()) return ended('expired', expiresAt);
  return { valid: true, expiresAt };
}
