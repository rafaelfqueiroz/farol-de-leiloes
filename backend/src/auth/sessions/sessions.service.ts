import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Clock } from '../../common/clock/clock.js';
import { SessionsRepository } from './sessions.repository.js';

/** BR-001-18: a session expires 7 days after sign-in. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const OBJECT_ID = /^[0-9a-f]{24}$/i;

/**
 * Server-side sessions (BR-001-17, BR-001-18, BR-001-19, DL-001-09). The JWT is only a pointer to
 * one of these, so signing out, changing the password or deactivating the account takes effect on
 * the next request instead of when the token expires.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly sessions: SessionsRepository,
    private readonly clock: Clock, // AR-24
  ) {}

  /** Opens a session for the user and returns its id, the token's `jti`. */
  async create(userId: string): Promise<string> {
    const id = randomUUID();
    await this.sessions.insert({
      id,
      userId,
      expiresAt: new Date(this.clock.now().getTime() + SESSION_TTL_MS),
    });
    return id;
  }

  async isActive(jti: string, userId: string): Promise<boolean> {
    // Both come out of a signed token we issued, but a malformed value must refuse, not throw.
    if (typeof jti !== 'string' || jti === '' || typeof userId !== 'string') return false;
    if (!OBJECT_ID.test(userId)) return false;
    return this.sessions.isActive(jti, userId, this.clock.now());
  }

  /** BR-001-18: sign-out ends this session at once on the server. */
  async revoke(jti: string): Promise<void> {
    await this.sessions.revoke(jti, this.clock.now());
  }

  /** BR-001-19: password change keeps the current session (`exceptJti`); reset ends all. */
  async revokeAllForUser(userId: string, exceptJti?: string): Promise<void> {
    await this.sessions.revokeAllForUser(userId, this.clock.now(), exceptJti);
  }
}
