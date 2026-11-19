// SPEC-012 BR-012-16 (owner review #173): the amount an upgrade charges is the provider's proration
// as of ONE instant, and the quote shown to the member is that instant pinned: the preview and the
// change both use the same `prorationDate`, so the charge equals the quote. A quote is only good
// for a short time and only inside the period it was made in. Pure (AR-05): the facts come in.

/** How long a quote can be confirmed after it was made. A constant, not a setting. */
export const QUOTE_TTL_MS = 2 * 60 * 1000;

/** The instant a quote stops being good: the proration date plus the time to live. */
export function quoteExpiresAt(prorationDate: Date): Date {
  return new Date(prorationDate.getTime() + QUOTE_TTL_MS);
}

export type QuoteVerdict =
  | 'ok'
  /** The time to live is over: ask the provider again and let the member confirm again. */
  | 'expired'
  /** A proration date after now cannot have been pinned by us. */
  | 'from_the_future'
  /** The subscription renewed (or the date is outside the period): the quote is of another period. */
  | 'outside_period';

/**
 * Whether a quote's proration date can still be used. The period is half-open on its right:
 * a date at exactly the period end already belongs to the next period. A subscription with no known
 * period bound is judged by the time alone (the provider refuses a date it cannot use).
 */
export function judgeQuoteDate(facts: {
  prorationDate: Date;
  now: Date;
  periodStart: Date | null;
  periodEnd: Date | null;
}): QuoteVerdict {
  const { prorationDate, now, periodStart, periodEnd } = facts;
  if (prorationDate.getTime() > now.getTime()) return 'from_the_future';
  if (now.getTime() >= quoteExpiresAt(prorationDate).getTime()) return 'expired';
  if (periodStart !== null && prorationDate.getTime() < periodStart.getTime()) {
    return 'outside_period';
  }
  if (periodEnd !== null && prorationDate.getTime() >= periodEnd.getTime()) {
    return 'outside_period';
  }
  return 'ok';
}
