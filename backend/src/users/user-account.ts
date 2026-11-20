import type { SubscriptionStatus } from './subscription-status.js';

export const ACCOUNT_STATUSES = ['active', 'deactivated', 'closed'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

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
  phone?: string;
  createdAt: Date;
  updatedAt: Date;
}
