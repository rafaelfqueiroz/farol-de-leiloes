// SPEC-012 (ADR-005): which subscriptions the daily reconcile job re-reads, and which abandoned
// checkouts it removes. Pure (AR-05): the time is an argument.
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A record synced more recently than this is fresh enough: the webhook keeps it so. */
export const RECONCILE_STALE_HOURS = 12;
/** A subscription that lapsed within this many days is still re-read (a late reactivation). */
export const RECONCILE_RECENT_LAPSE_DAYS = 14;
/** A checkout with no session id this old is dead: its creation never finished. */
export const PENDING_PURGE_DAYS = 3;
/**
 * A checkout with a session and no provider subscription this old is asked about: the buyer may
 * have paid it and the events never reached us (Stripe gives up after about 3 days).
 */
export const SESSION_RECOVERY_MINUTES = 10;
/** A session still `open` this long after its record was made (it expires in 1 h) is closed. */
export const OPEN_SESSION_FORCE_HOURS = 24;

export interface ReconcileCutoffs {
  /** Re-read the records last synced before this instant. */
  readonly staleBefore: Date;
  /** Of the lapsed ones, only those that lapsed at or after this instant. */
  readonly lapsedSince: Date;
  /** Remove pending checkouts that never got a session id, created before this instant. */
  readonly pendingBefore: Date;
  /** Ask the provider about checkouts with a session and no subscription created before this. */
  readonly sessionBefore: Date;
  /** Close a session still open and created before this instant, then remove its record. */
  readonly openSessionBefore: Date;
}

export function reconcileCutoffs(now: Date): ReconcileCutoffs {
  const at = now.getTime();
  return {
    staleBefore: new Date(at - RECONCILE_STALE_HOURS * HOUR_MS),
    lapsedSince: new Date(at - RECONCILE_RECENT_LAPSE_DAYS * DAY_MS),
    pendingBefore: new Date(at - PENDING_PURGE_DAYS * DAY_MS),
    sessionBefore: new Date(at - SESSION_RECOVERY_MINUTES * 60 * 1000),
    openSessionBefore: new Date(at - OPEN_SESSION_FORCE_HOURS * HOUR_MS),
  };
}
