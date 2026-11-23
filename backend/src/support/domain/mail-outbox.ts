// SPEC-009 BR-009-07, BR-009-10: the outbox of a support request. A request owes two emails, the
// confirmation to the requester and the notice to the support team; each is delivered once, retried
// with a growing delay when SMTP fails, and given up on after MAX_MAIL_ATTEMPTS failed rounds.
// Pure (AR-05): the time comes in as an argument.

export const MAIL_KINDS = ['confirmation', 'team_notice'] as const;
export type MailKind = (typeof MAIL_KINDS)[number];

/** Which of the two a delivery has settled: sent, or skipped on purpose (see `mailDecision`). */
export interface MailOutboxState {
  readonly confirmationSentAt?: Date | undefined;
  readonly confirmationSkippedAt?: Date | undefined;
  readonly teamNoticeSentAt?: Date | undefined;
  readonly teamNoticeSkippedAt?: Date | undefined;
  /** Set when the retries ran out: nothing more is tried. */
  readonly mailGaveUpAt?: Date | undefined;
}

/** The emails still owed, in the order they are tried: the team's notice first (BR-009-10 matters most). */
export function pendingMails(state: MailOutboxState): MailKind[] {
  if (state.mailGaveUpAt) return [];
  const pending: MailKind[] = [];
  if (!state.teamNoticeSentAt && !state.teamNoticeSkippedAt) pending.push('team_notice');
  if (!state.confirmationSentAt && !state.confirmationSkippedAt) pending.push('confirmation');
  return pending;
}

/**
 * What the requester's account allows at delivery time. `null`: no such account any more (the purge
 * took it). The status is the account's own (`active`, `deactivated`, `closed`, `pending`).
 */
export type MailAccountStatus = string | null;

/**
 * BR-009-07 / BR-009-15: the confirmation goes to an ACTIVE account only (a deactivated one receives
 * no notification, a closed one is leaving). The team's notice goes for an active or a deactivated
 * account (the support team still has to read a request the person made before the account was
 * switched off) and never for a closed or vanished one. Whatever is not sent is skipped, once, not
 * retried: waiting does not change the account.
 */
export function mailDecision(kind: MailKind, accountStatus: MailAccountStatus): 'send' | 'skip' {
  if (kind === 'confirmation') return accountStatus === 'active' ? 'send' : 'skip';
  return accountStatus === 'active' || accountStatus === 'deactivated' ? 'send' : 'skip';
}

/** BR-009-07: after this many failed rounds nothing more is tried (an error is logged, ids only). */
export const MAX_MAIL_ATTEMPTS = 8;

/** The waits after the 1st, 2nd, ... failed round, in minutes; the last one repeats. */
export const MAIL_RETRY_DELAYS_MINUTES = [1, 2, 5, 15, 60, 180] as const;

/** How long a delivery may hold a request before another may take it over (a crashed worker's lease). */
export const MAIL_CLAIM_LEASE_MS = 2 * 60 * 1000;

/**
 * The longest one send may take before the worker counts it as failed and goes on. Two sends of one
 * round (40 s) end well inside the lease (2 minutes), so a worker that is working normally never has
 * its claim taken over; the transport's own timeouts (EmailService.SMTP_TIMEOUTS, 35 s at the very
 * most for one send) bound the send underneath.
 */
export const MAIL_SEND_TIMEOUT_MS = 20 * 1000;

/**
 * How long the request that creates a support request waits for its own first delivery before it
 * answers `confirmationSent: false` and leaves the rest to the background (and then the job): the
 * requester is never held on SMTP.
 */
export const MAIL_INLINE_BUDGET_MS = 6 * 1000;

/**
 * The lease is over at its end instant, half-open like the claim's own query (a claim whose
 * `mailClaimUntil` is <= now is free to take): a worker past it may not start another mail.
 */
export function isLeaseOver(claimUntil: Date | undefined, now: Date): boolean {
  return claimUntil !== undefined && now.getTime() >= claimUntil.getTime();
}

const MINUTE_MS = 60 * 1000;

export type NextMailAttempt =
  { readonly giveUp: true } | { readonly giveUp: false; readonly at: Date };

/**
 * What follows a failed round: `failedRounds` counts the rounds that failed including the one that
 * just did (1 after the first). With 1 the wait is 1 minute, with 2 it is 2, then 5, 15, 60, 180
 * and 180 again, until the eighth failure gives up.
 */
export function nextMailAttempt(failedRounds: number, now: Date): NextMailAttempt {
  if (!Number.isInteger(failedRounds) || failedRounds < 1) {
    throw new RangeError('A failed round count is a positive integer');
  }
  if (failedRounds >= MAX_MAIL_ATTEMPTS) return { giveUp: true };
  // In range: 1 <= failedRounds < MAX_MAIL_ATTEMPTS, and the index is capped at the last delay.
  const minutes = MAIL_RETRY_DELAYS_MINUTES[
    Math.min(failedRounds, MAIL_RETRY_DELAYS_MINUTES.length) - 1
  ] as number;
  return { giveUp: false, at: new Date(now.getTime() + minutes * MINUTE_MS) };
}
