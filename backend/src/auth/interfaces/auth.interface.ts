import type { SubscriptionStatus } from '../../users/subscription-status';

export interface UserProfile {
  _id: string;
  email: string;
  name: string;
  providers: string[];
  emailVerified: boolean;
  role: string;
  subscriptionStatus: SubscriptionStatus | null;
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

/** The claims AuthService signs into the access token. */
export interface JwtPayload {
  sub: string;
  email: string;
  name: string;
}

/** What JwtStrategy.validate puts on `request.user`, read through @CurrentUser(). */
export interface AuthenticatedUser {
  userId: string;
  email: string;
  name: string;
  emailVerified: boolean;
  providers: string[];
  role: string;
  subscriptionStatus: SubscriptionStatus | null;
}

export interface AuthResult {
  accessToken: string;
  user: UserProfile;
}
