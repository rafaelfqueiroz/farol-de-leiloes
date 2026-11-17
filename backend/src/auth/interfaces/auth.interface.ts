import type { SubscriptionStatus } from '../../users/subscription-status.js';

export interface UserProfile {
  _id: string;
  email: string;
  name: string;
  providers: string[];
  emailVerified: boolean;
  role: string;
  subscriptionStatus: SubscriptionStatus | null;
  /** SPEC-002 DL-002-05: operator capability, so the interface knows at sign-in (AR-51). */
  isAdmin: boolean;
  phone?: string;
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
  /** The plan tier until SPEC-012; `'admin'` here is no plan at all (BR-002-23). */
  role: string;
  subscriptionStatus: SubscriptionStatus | null;
  /** SPEC-002 DL-002-05: operator capability, `users.isAdmin`, read on every request (BR-002-15). */
  isAdmin: boolean;
}

export interface AuthResult {
  accessToken: string;
  user: UserProfile;
}

/** The answer of the Google code exchange: a session, or the terms still to accept (BR-001-09). */
export type GoogleExchangeResult =
  | ({ status: 'signed_in' } & AuthResult)
  | { status: 'terms_required'; email: string; name: string };
