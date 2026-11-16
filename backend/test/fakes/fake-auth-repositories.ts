// TS-03: hand-written in-memory fakes of the auth repositories. They implement the real public
// surface (a mapped type drops the private model), so a signature change breaks them at compile
// time. The MongoDB behaviour itself (atomic consume, the throttle pipeline, TTL indexes) is proven
// against a real database in test/integration/auth-sessions-tokens.spec.ts (TS-02).
import type {
  AccountTokenPurpose,
  UserTokenPurpose,
} from '../../src/auth/tokens/account-token-purposes.js';
import type { AccountTokenRepository } from '../../src/auth/tokens/account-token.repository.js';
import type { LoginAttemptsRepository } from '../../src/auth/login-attempts/login-attempts.repository.js';
import type { SessionsRepository } from '../../src/auth/sessions/sessions.repository.js';

type Port<T> = { [K in keyof T]: T[K] };

interface StoredToken {
  seq: number;
  userId?: string;
  purpose: AccountTokenPurpose;
  tokenHash: string;
  expiresAt: Date;
  newEmail?: string;
  profile?: { googleId: string; email: string; name: string };
  usedAt?: Date;
}

export class FakeAccountTokenRepository implements Port<AccountTokenRepository> {
  readonly stored: StoredToken[] = [];
  private nextSeq = 1;

  async deleteUnused(userId: string, purpose: UserTokenPurpose): Promise<void> {
    const keep = this.stored.filter(
      (t) => !(t.userId === userId && t.purpose === purpose && !t.usedAt),
    );
    this.stored.splice(0, this.stored.length, ...keep);
  }

  async insert(token: Parameters<AccountTokenRepository['insert']>[0]): Promise<void> {
    this.stored.push({ ...token, seq: this.nextSeq++ });
  }

  async deleteAllButNewestUnused(userId: string, purpose: UserTokenPurpose): Promise<void> {
    const unused = this.stored.filter(
      (t) => t.userId === userId && t.purpose === purpose && !t.usedAt,
    );
    const newest = Math.max(...unused.map((t) => t.seq));
    const keep = this.stored.filter((t) => !unused.includes(t) || t.seq === newest);
    this.stored.splice(0, this.stored.length, ...keep);
  }

  async consume(tokenHash: string, purpose: UserTokenPurpose, now: Date) {
    const token = this.stored.find(
      (t) => t.tokenHash === tokenHash && t.purpose === purpose && !t.usedAt && t.expiresAt > now,
    );
    if (!token?.userId) return null;
    token.usedAt = now;
    return {
      userId: token.userId,
      purpose,
      ...(token.newEmail === undefined ? {} : { newEmail: token.newEmail }),
    };
  }

  async deleteAllUnusedForUser(userId: string): Promise<void> {
    const keep = this.stored.filter((t) => !(t.userId === userId && !t.usedAt));
    this.stored.splice(0, this.stored.length, ...keep);
  }

  async insertGoogleSignup(token: Parameters<AccountTokenRepository['insertGoogleSignup']>[0]) {
    this.stored.push({ ...token, purpose: 'google_signup', seq: this.nextSeq++ });
  }

  async findGoogleSignup(tokenHash: string, now: Date) {
    const token = this.stored.find(
      (t) =>
        t.tokenHash === tokenHash &&
        t.purpose === 'google_signup' &&
        !t.usedAt &&
        t.expiresAt > now,
    );
    return token?.profile ? { ...token.profile } : null;
  }

  async consumeGoogleSignup(tokenHash: string, now: Date) {
    const index = this.stored.findIndex(
      (t) =>
        t.tokenHash === tokenHash &&
        t.purpose === 'google_signup' &&
        !t.usedAt &&
        t.expiresAt > now,
    );
    const [token] = index === -1 ? [] : this.stored.splice(index, 1);
    return token?.profile ? { ...token.profile } : null;
  }

  async deleteGoogleSignup(tokenHash: string): Promise<void> {
    const keep = this.stored.filter(
      (t) => !(t.tokenHash === tokenHash && t.purpose === 'google_signup' && !t.usedAt),
    );
    this.stored.splice(0, this.stored.length, ...keep);
  }
}

interface StoredSession {
  id: string;
  userId: string;
  credentialVersion: number;
  expiresAt: Date;
  revokedAt?: Date;
}

export class FakeSessionsRepository implements Port<SessionsRepository> {
  readonly stored: StoredSession[] = [];

  async insert(session: {
    id: string;
    userId: string;
    credentialVersion: number;
    expiresAt: Date;
  }): Promise<void> {
    this.stored.push({ ...session });
  }

  async activeCredentialVersion(id: string, userId: string, now: Date): Promise<number | null> {
    const found = this.stored.find(
      (s) => s.id === id && s.userId === userId && !s.revokedAt && s.expiresAt > now,
    );
    return found ? found.credentialVersion : null;
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
 * Counts reservations per key and refuses the keys a test blocked by hand: the window, count and
 * ban arithmetic is the repository's pipeline, covered against MongoDB, not re-implemented here.
 */
export class FakeLoginAttemptsRepository implements Port<LoginAttemptsRepository> {
  readonly reserved = new Map<string, number>();
  readonly cleared: string[] = [];
  readonly released: string[] = [];
  private readonly blocked = new Set<string>();

  block(key: string): void {
    this.blocked.add(key);
  }

  async reserve(key: string, now: Date) {
    this.reserved.set(key, (this.reserved.get(key) ?? 0) + 1);
    const count = this.reserved.get(key) ?? 0;
    return this.blocked.has(key) ? { count, blockedUntil: new Date(now.getTime() + 1) } : { count };
  }

  async clear(key: string): Promise<void> {
    this.cleared.push(key);
    this.reserved.delete(key);
  }

  async release(key: string): Promise<void> {
    this.released.push(key);
    this.reserved.set(key, Math.max(0, (this.reserved.get(key) ?? 0) - 1));
  }
}
