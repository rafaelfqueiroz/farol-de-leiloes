// SPEC-010 BR-010-15: the schedule of the purge of closed accounts. Pure (AR-05): the time comes in
// as an argument. `AccountPurgeJob` applies it.
import { DAY_MS } from './data-export.js';

/**
 * The two limits of one purge run. Fixed defaults, not configuration (AR-43 is for settings an
 * operator changes; these two are part of the fairness guarantee): the job reads them through the
 * `ACCOUNT_PURGE_LIMITS` token, which only a test overrides, so the liveness specs can prove the same
 * logic with a handful of accounts instead of hundreds.
 */
export interface AccountPurgeLimits {
  /** How many candidates one query reads. */
  readonly batchSize: number;
  /**
   * Bounds one run: at most this many accounts are attempted (purged or failed), the least recently
   * attempted first; the rest waits for the next run and the overdue alert watches it. An account that
   * fails or is skipped is left out of the rest of the run, so a permanently failing head of the queue
   * (a hundred of them, say) never keeps the later accounts from being purged.
   */
  readonly maxAttemptsPerRun: number;
}

export const DEFAULT_ACCOUNT_PURGE_LIMITS: AccountPurgeLimits = Object.freeze({
  batchSize: 100,
  maxAttemptsPerRun: 500,
});

/** The DI token the job reads its limits from (provided by `PrivacyRightsModule`). */
export const ACCOUNT_PURGE_LIMITS = Symbol('ACCOUNT_PURGE_LIMITS');

/**
 * How long a worker holds the claim on one account (a lease: a crashed worker's claim expires and
 * the next run takes the account over). One account's purge is a handful of deletes; ten minutes is
 * far above it, far below the daily run.
 */
export const PURGE_CLAIM_LEASE_MS = 10 * 60 * 1000;

/** The instant a claim taken at `now` expires. */
export function claimExpiry(now: Date): Date {
  return new Date(now.getTime() + PURGE_CLAIM_LEASE_MS);
}

/** A claim is held while its expiry is in the future; at the expiry instant it is free. */
export function isClaimLive(claimUntil: Date | null | undefined, now: Date): boolean {
  return !!claimUntil && claimUntil.getTime() > now.getTime();
}

/**
 * The latest closure instant that is overdue at `now`: an account closed at or before it has been
 * waiting `alertDays` days or more without being purged (the alert is raised AT `alertDays`).
 */
export function overdueClosedBefore(now: Date, alertDays: number): Date {
  return new Date(now.getTime() - alertDays * DAY_MS);
}

/** The instant by which the account's personal data must be gone: `maxDays` after closure. */
export function purgeDeadline(closedAt: Date, maxDays: number): Date {
  return new Date(closedAt.getTime() + maxDays * DAY_MS);
}
