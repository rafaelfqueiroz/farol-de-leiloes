// TS-03: hand-written in-memory fakes of the auth repositories. They implement the real public
// surface (a mapped type drops the private model), so a signature change breaks them at compile
// time. The MongoDB behaviour itself (atomic consume, the throttle pipeline, TTL indexes) is proven
// against a real database in test/integration/auth-sessions-tokens.spec.ts (TS-02).
import type { AccountTokenPurpose } from '../../src/auth/tokens/account-token-purposes.js';
import type { AccountTokenRepository } from '../../src/auth/tokens/account-token.repository.js';
import type { LoginAttemptsRepository } from '../../src/auth/login-attempts/login-attempts.repository.js';
import type { SessionsRepository } from '../../src/auth/sessions/sessions.repository.js';

type Port<T> = { [K in keyof T]: T[K] };

interface StoredToken {
  userId: string;
  purpose: AccountTokenPurpose;
  tokenHash: string;
  expiresAt: Date;
  newEmail?: string;
  usedAt?: Date;
}

export class FakeAccountTokenRepository implements Port<AccountTokenRepository> {
  readonly stored: StoredToken[] = [];

  async deleteUnused(userId: string, purpose: AccountTokenPurpose): Promise<void> {
    const keep = this.stored.filter(
      (t) => !(t.userId === userId && t.purpose === purpose && !t.usedAt),
    );
    this.stored.splice(0, this.stored.length, ...keep);
  }

  async insert(token: Parameters<AccountTokenRepository['insert']>[0]): Promise<void> {
    this.stored.push({ ...token });
  }

  async consume(tokenHash: string, purpose: AccountTokenPurpose, now: Date) {
    const token = this.stored.find(
      (t) => t.tokenHash === tokenHash && t.purpose === purpose && !t.usedAt && t.expiresAt > now,
    );
    if (!token) return null;
    token.usedAt = now;
    return {
      userId: token.userId,
      purpose: token.purpose,
      ...(token.newEmail === undefined ? {} : { newEmail: token.newEmail }),
    };
  }
}

interface StoredSession {
  id: string;
  userId: string;
  expiresAt: Date;
  revokedAt?: Date;
}

export class FakeSessionsRepository implements Port<SessionsRepository> {
  readonly stored: StoredSession[] = [];

  async insert(session: { id: string; userId: string; expiresAt: Date }): Promise<void> {
    this.stored.push({ ...session });
  }

  async isActive(id: string, userId: string, now: Date): Promise<boolean> {
    return this.stored.some(
      (s) => s.id === id && s.userId === userId && !s.revokedAt && s.expiresAt > now,
    );
  }

  async revoke(id: string, now: Date): Promise<void> {
    for (const s of this.stored) if (s.id === id && !s.revokedAt) s.revokedAt = now;
  }

  async revokeAllForUser(userId: string, now: Date, exceptId?: string): Promise<void> {
    for (const s of this.stored) {
      if (s.userId === userId && !s.revokedAt && s.id !== exceptId) s.revokedAt = now;
    }
  }
}

/**
 * Counts failures per key and answers `isBlocked` for keys a test blocked by hand: the window and
 * ban arithmetic is the repository's pipeline, covered against MongoDB, not re-implemented here.
 */
export class FakeLoginAttemptsRepository implements Port<LoginAttemptsRepository> {
  readonly failures = new Map<string, number>();
  readonly cleared: string[] = [];
  private readonly blocked = new Set<string>();

  block(key: string): void {
    this.blocked.add(key);
  }

  async isBlocked(keys: string[]): Promise<boolean> {
    return keys.some((key) => this.blocked.has(key));
  }

  async recordFailure(key: string): Promise<void> {
    this.failures.set(key, (this.failures.get(key) ?? 0) + 1);
  }

  async clear(key: string): Promise<void> {
    this.cleared.push(key);
    this.failures.delete(key);
  }
}
