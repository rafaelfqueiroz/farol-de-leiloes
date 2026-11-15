import type { SubscriptionStatus } from './subscription-status.js';

export const ACCOUNT_STATUSES = ['active', 'deactivated', 'closed'] as const;
export type AccountStatus = (typeof ACCOUNT_STATUSES)[number];

export interface UserAddress {
  street?: string;
  city?: string;
  state?: string;
  zipCode?: string;
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
  role?: string;
  subscriptionStatus?: SubscriptionStatus | null;
  phone?: string;
  cpf?: string;
  dateOfBirth?: Date;
  sex?: string;
  address?: UserAddress;
  createdAt: Date;
  updatedAt: Date;
}
