import type { SubscriptionStatus } from '../../users/subscription-status.js';
import type { UserAddress } from '../../users/user-account.js';

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
  address?: UserAddress;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * The claims AuthService signs into the access token: the account and the session, nothing else
 * (BR-001-17). Role, plan and status are read from the database on every request.
 */
export interface JwtPayload {
  sub: string;
  /** The session id (sessions collection `_id`). A token without it is refused. */
  jti: string;
}

/** What JwtStrategy.validate puts on `request.user`, read through @CurrentUser(). */
export interface AuthenticatedUser {
  userId: string;
  /** The session this request belongs to (the token's `jti`), for sign-out and BR-001-19. */
  sessionId: string;
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

/** The answer of the Google code exchange: a session, or the terms still to accept (BR-001-09). */
export type GoogleExchangeResult =
  | ({ status: 'signed_in' } & AuthResult)
  | { status: 'terms_required'; email: string; name: string };
