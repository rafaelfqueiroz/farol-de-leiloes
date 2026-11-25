import type { SubscriptionStatus } from './subscription-status.js';

/**
 * `pending` (SPEC-010 BR-010-01): an account created by a sign-up that has not finished writing its
 * consent records. It is created `pending`, becomes `active` in ONE conditional update after the
 * records exist, and is deleted (only while still `pending`) when they cannot be written. A pending
 * account can authenticate nothing, so nothing is ever issued for it. Documents written before the
 * field have no status and are active: no migration is needed (AR-28).
 */
export const ACCOUNT_STATUSES = ['active', 'deactivated', 'closed', 'pending'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

/**
 * BR-001-16, SPEC-010 BR-010-01: the one rule for "this account may authenticate and be acted on".
 * A missing status predates the field and counts as active (AR-28); `pending`, `deactivated` and
 * `closed` do not. Every JS-side check of the status uses this; the database-side filters of
 * UsersService are its twin (`activeStatusFilter`).
 */
export function isAccountActive(account: { status?: string | null }): boolean {
  return (account.status ?? 'active') === 'active';
}

/**
 * SPEC-010 BR-010-01: how long a `pending` account may live before a sign-up that collides with it
 * (same email or Google identity) may delete it as abandoned (a crash between creating it and
 * activating it). Far longer than a sign-up request takes, short enough that nobody is locked out.
 */
export const PENDING_SIGNUP_TTL_MS = 15 * 60 * 1000;

/** The instant before which a `pending` account counts as abandoned, given the injected "now". */
export function abandonedPendingCutoff(now: Date): Date {
  return new Date(now.getTime() - PENDING_SIGNUP_TTL_MS);
}

/** AR-09: account fields consumed through UsersService, without a Mongoose dependency. */
export interface UserAccount {
  _id: string | { toHexString(): string };
  email: string;
  name: string;
  providers: string[];
  emailVerified?: boolean;
  /** BR-001-16; a missing status counts as active. */
  status?: AccountStatus;
  /**
   * DL-001-02: bumped when the credentials are taken over (Google link of an unconfirmed account).
   * A session carries the version it was issued for and is refused when it no longer matches; a
   * missing version counts as 0. Server-written only, never from a request (BR-001-30).
   */
  credentialVersion?: number;
  role?: string;
  /**
   * SPEC-002 DL-002-05 / BR-002-21: operator capability. Set only by the grant-admin script, never
   * by a request; a missing flag is false (AR-28).
   */
  isAdmin?: boolean;
  subscriptionStatus?: SubscriptionStatus | null;
  /**
   * SPEC-010 BR-010-27: when the account first answered the one-time WhatsApp consent request;
   * absent means it has not been asked yet. Server-written only (BR-001-30).
   */
  whatsappPromptAnsweredAt?: Date;
  /**
   * SPEC-010 DL-001-02: set when an unconfirmed account is taken over at Google link; consent rows
   * written under another value (or none) do not count. Server-written only (BR-001-30).
   */
  consentResetAt?: Date;
  phone?: string;
  /** SPEC-010 BR-010-14: when the account was closed; absent while it is not. Server-written. */
  closedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

/** SPEC-009 BR-009-13: the account fields an admin's record shows, as plain values (AR-09). */
export interface AccountRecordFacts {
  readonly id: string;
  /** Null for a purged account: its personal data is gone (SPEC-010 BR-010-15). */
  readonly name: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly createdAt: Date;
  readonly providers: readonly string[];
  readonly emailVerified: boolean;
  /** Never `pending`: a sign-up in flight is not an account an admin can see. */
  readonly status: Exclude<AccountStatus, 'pending'>;
  readonly isAdmin: boolean;
}

/** One row of an admin's account search (BR-009-13): enough to pick the record to open. */
export interface AccountSummaryFacts {
  readonly id: string;
  readonly name: string | null;
  readonly email: string | null;
  readonly status: Exclude<AccountStatus, 'pending'>;
  readonly createdAt: Date;
}
