import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { Clock } from '../../common/clock/clock.js';
import {
  ACCOUNT_TOKEN_BYTES,
  ACCOUNT_TOKEN_TTL_MS,
  type AccountTokenPurpose,
} from './account-token-purposes.js';
import { AccountTokenRepository, type AccountTokenRecord } from './account-token.repository.js';

/** SC-06: the hash is what is stored and looked up; the plain token exists only in the email. */
export function hashAccountToken(plain: string): string {
  return createHash('sha256').update(plain).digest('hex');
}

/**
 * One-time tokens behind the confirmation, recovery, email-change and Google-exchange links
 * (BR-001-05, BR-001-22, BR-001-23, BR-001-26). Replaces the per-user token fields, whose
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
   * `newEmail` binds the token to an address: the address a confirmation was sent to
   * (`email_confirmation`), or the one an `email_change` moves to.
   */
  async issue(
    userId: string,
    purpose: AccountTokenPurpose,
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
   * already used or expired. Callers answer all four the same way (no oracle).
   */
  async consume(plain: string, purpose: AccountTokenPurpose): Promise<AccountTokenRecord | null> {
    if (typeof plain !== 'string' || plain.length === 0) return null;
    return this.tokens.consume(hashAccountToken(plain), purpose, this.clock.now());
  }

  /** BR-001-22: after a reset, every outstanding link of that purpose is dead. */
  async revokeUnused(userId: string, purpose: AccountTokenPurpose): Promise<void> {
    await this.tokens.deleteUnused(userId, purpose);
  }
}
