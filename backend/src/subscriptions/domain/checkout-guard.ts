// SPEC-012 BR-012-07, BR-012-08 (ADR-005): one open checkout per office, or per buyer while the
// buyer has no office. Pure (AR-05).

/** A checkout session stops accepting payment this long after it is created. */
export const CHECKOUT_SESSION_MINUTES = 60;

/**
 * A checkout record without a session id this old is a creation that never finished (the process
 * died between storing the record and storing the session): it is removed, not waited for.
 */
export const CHECKOUT_CREATION_GRACE_MS = 2 * 60 * 1000;

/**
 * The key the database holds unique among open checkouts: the office's, or, for a first
 * subscription with no office yet, the buyer's.
 */
export function openCheckoutKey(input: { officeId?: string; buyerUserId: string }): string {
  return input.officeId === undefined ? `buyer:${input.buyerUserId}` : `office:${input.officeId}`;
}

export type OpenCheckoutState =
  /** Payment is under way or the record is too new to judge: the new checkout is refused. */
  | { readonly state: 'in_flight' }
  /** An abandoned creation: remove the record and go on. */
  | { readonly state: 'orphaned' }
  /** A session that may still be open: expire it (unless the buyer paid it) and go on. */
  | { readonly state: 'replaceable'; readonly checkoutSessionId: string };

export function classifyOpenCheckout(
  open: {
    stripeSubscriptionId: string | null;
    checkoutSessionId: string | null;
    createdAt: Date;
  },
  now: Date,
): OpenCheckoutState {
  // The provider already made a subscription of it (payment being confirmed): never replaced.
  if (open.stripeSubscriptionId !== null) return { state: 'in_flight' };
  if (open.checkoutSessionId === null) {
    return now.getTime() - open.createdAt.getTime() >= CHECKOUT_CREATION_GRACE_MS
      ? { state: 'orphaned' }
      : { state: 'in_flight' };
  }
  return { state: 'replaceable', checkoutSessionId: open.checkoutSessionId };
}
