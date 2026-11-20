import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Clock } from '../../common/clock/clock.js';
import {
  ACCOUNT_TOKEN_BYTES,
  ACCOUNT_TOKEN_TTL_MS,
  type UserTokenPurpose,
} from './account-token-purposes.js';
import {
  AccountTokenRepository,
  type AccountTokenRecord,
  type GoogleSignupProfile,
} from './account-token.repository.js';

/** SC-06: the hash is what is stored and looked up; the plain token exists only in the email. */
export function hashAccountToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

/**
 * One-time tokens behind the confirmation, recovery and Google-exchange links
 * (BR-001-05, BR-001-22, BR-001-23). Replaces the per-user token fields, whose
 * lookup compared every user's bcrypt hash and whose reset token came from Math.random (#125).
 */
@Injectable()
export class AccountTokenService {
  constructor(
    private readonly tokens: AccountTokenRepository,
    private readonly clock: Clock, // AR-24: expiry is measured from the injected clock
  ) {}

  /**
   * Issues a token for the user and returns the plain value, once. Earlier unused tokens of the
   * same user and purpose stop working (BR-001-05, BR-001-22), also when two requests issue at the
   * same moment: exactly one link stays valid.
   *
   * `newEmail` binds a confirmation link to the address it was mailed to (`email_confirmation`).
   */
  async issue(
    userId: string,
    purpose: UserTokenPurpose,
    options: { newEmail?: string } = {},
  ): Promise<string> {
    // BR-001-23: 256 bits from a CSPRNG.
    const plain = randomBytes(ACCOUNT_TOKEN_BYTES).toString('hex');
    await this.tokens.insert({
      userId,
      purpose,
      tokenHash: hashAccountToken(plain),
      expiresAt: new Date(this.clock.now().getTime() + ACCOUNT_TOKEN_TTL_MS[purpose]),
      ...(options.newEmail === undefined ? {} : { newEmail: options.newEmail }),
    });
    await this.tokens.deleteAllButNewestUnused(userId, purpose);
    return plain;
  }

  /**
   * Spends a token: the record when it is valid, null when it is unknown, of another purpose,
   * already used or expired. Callers answer all four the same way (no oracle). With `forUserId`,
   * another account's token is a fifth way to get null, and it is left unspent.
   */
  async consume(
    plain: string,
    purpose: UserTokenPurpose,
    forUserId?: string,
  ): Promise<AccountTokenRecord | null> {
    if (typeof plain !== 'string' || plain.length === 0) return null;
    return this.tokens.consume(hashAccountToken(plain), purpose, this.clock.now(), forUserId);
  }

  /**
   * BR-001-10: when Google takes over an account whose email was never confirmed, every link that
   * account still has outstanding (confirmation, recovery, Google exchange) is dead.
   */
  async revokeAllUnused(userId: string): Promise<void> {
    await this.tokens.deleteAllUnusedForUser(userId);
  }

  /** SPEC-010 BR-010-08: the account's outstanding links as purpose and instants (no hash, no link). */
  pendingFor(userId: string) {
    return this.tokens.listUnusedForUser(userId, this.clock.now());
  }

  /** SPEC-010 BR-010-15 / AR-31: JOB ONLY. Deletes every token record of a closed account. */
  purgeAllForUser(userId: string): Promise<number> {
    return this.tokens.deleteAllForUser(userId);
  }

  /**
   * BR-001-09: keeps the verified Google profile of a person with no account until they accept the
   * terms (15 minutes). It belongs to no user, so a new code never replaces another's. Returns the
   * plain code, once.
   */
  async issueGoogleSignup(profile: GoogleSignupProfile): Promise<string> {
    const plain = randomBytes(ACCOUNT_TOKEN_BYTES).toString('hex');
    await this.tokens.insertGoogleSignup({
      tokenHash: hashAccountToken(plain),
      expiresAt: new Date(this.clock.now().getTime() + ACCOUNT_TOKEN_TTL_MS.google_signup),
      profile,
    });
    return plain;
  }

  /** The profile behind a live signup code, without spending it; null when unknown or expired. */
  async peekGoogleSignup(plain: string): Promise<GoogleSignupProfile | null> {
    if (typeof plain !== 'string' || plain.length === 0) return null;
    return this.tokens.findGoogleSignup(hashAccountToken(plain), this.clock.now());
  }

  /** Spends a signup code atomically and returns the profile it held (BR-001-09). */
  async consumeGoogleSignup(plain: string): Promise<GoogleSignupProfile | null> {
    if (typeof plain !== 'string' || plain.length === 0) return null;
    return this.tokens.consumeGoogleSignup(hashAccountToken(plain), this.clock.now());
  }

  /** BR-010-01: declining deletes the unused code and the personal data in it. */
  async discardGoogleSignup(plain: string): Promise<void> {
    if (typeof plain !== 'string' || plain.length === 0) return;
    await this.tokens.deleteGoogleSignup(hashAccountToken(plain));
  }

  /** BR-001-22: after a reset, every outstanding link of that purpose is dead. */
  async revokeUnused(userId: string, purpose: UserTokenPurpose): Promise<void> {
    await this.tokens.deleteUnused(userId, purpose);
  }
}
