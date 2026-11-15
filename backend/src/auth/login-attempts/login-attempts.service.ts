import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock/clock.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { normalizeEmail } from '../../common/normalize-email.js';
import { LoginAttemptsRepository } from './login-attempts.repository.js';

/** BR-001-15: 10 failures within 15 minutes, then 15 minutes of refusal. */
export const LOGIN_ATTEMPT_RULE = {
  limit: 10,
  windowMs: 15 * 60 * 1000,
  banMs: 15 * 60 * 1000,
} as const;

const emailKey = (email: string) => `email:${normalizeEmail(email)}`;
const ipKey = (ip: string) => `ip:${ip}`;

/**
 * Failed-sign-in throttle (BR-001-15, SC-04, DL-001-08): per email and per origin, expiring on its
 * own, never locking the account.
 */
@Injectable()
export class LoginAttemptsService {
  constructor(
    private readonly attempts: LoginAttemptsRepository,
    private readonly clock: Clock, // AR-24
  ) {}

  /** Refuses with TOO_MANY_ATTEMPTS while the email or the origin is banned, password aside. */
  async assertAllowed(email: string, ip: string): Promise<void> {
    if (await this.attempts.isBlocked([emailKey(email), ipKey(ip)], this.clock.now())) {
      throw new DomainError('TOO_MANY_ATTEMPTS');
    }
  }

  async recordFailure(email: string, ip: string): Promise<void> {
    const now = this.clock.now();
    await Promise.all([
      this.attempts.recordFailure(emailKey(email), now, LOGIN_ATTEMPT_RULE),
      this.attempts.recordFailure(ipKey(ip), now, LOGIN_ATTEMPT_RULE),
    ]);
  }

  /** Success clears the email's counter only: the origin's failures stay (BR-001-15). */
  async recordSuccess(email: string): Promise<void> {
    await this.attempts.clear(emailKey(email));
  }
}
