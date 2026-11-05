import type { SubscriptionStatus } from './subscription-status';

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
