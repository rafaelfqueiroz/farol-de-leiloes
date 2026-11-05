import type { SubscriptionStatus } from './subscription-status';

/** AR-09: account fields consumed through UsersService, without a Mongoose dependency. */
export interface UserAccount {
  _id: { toString(): string };
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
  address?: {
    street?: string;
    city?: string;
    state?: string;
    zipCode?: string;
  };
  createdAt: Date;
  updatedAt: Date;
}
