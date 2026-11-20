// SPEC-010 BR-010-15: the schedule of the purge of closed accounts. Pure (AR-05): the time comes in
// as an argument. `AccountPurgeJob` applies it.
import { DAY_MS } from './data-export.js';

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
