import { Injectable } from '@nestjs/common';
import { Clock } from '../../common/clock/clock.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { normalizeEmail } from '../../common/normalize-email.js';
import { LoginAttemptsRepository, type ReservedAttempt } from './login-attempts.repository.js';
import { normalizeOrigin } from './origin-key.js';

/** BR-001-15: 10 attempts within 15 minutes, then 15 minutes of refusal. */
export const LOGIN_ATTEMPT_RULE = {
  limit: 10,
  windowMs: 15 * 60 * 1000,
  banMs: 15 * 60 * 1000,
} as const;

const emailKey = (email: string) => `email:${normalizeEmail(email)}`;
const ipKey = (ip: string) => `ip:${normalizeOrigin(ip)}`;

/**
 * What `reserve` counted: the instant of the attempt, which `recordSuccess` gives back (the clock
 * may have moved on while the password was compared).
 */
export interface AttemptReservation {
  readonly at: Date;
}

/**
 * Sign-in throttle (BR-001-15, SC-04, DL-001-08): per email and per origin, expiring on its own,
 * never locking the account. The window is rolling: an attempt counts for exactly 15 minutes
 * (the interval `(now - 15 min, now]`), so failures leave the count one by one instead of all at
 * once.
 *
 * Every attempt is counted when it starts (`reserve`), before the password is compared, in one
 * atomic step per key. That is what stops parallel guesses: they are numbered 1..N by the
 * database, and only the first ten are allowed on to the (slow) comparison. A failed password
 * simply keeps the count it reserved. The 10th attempt may still succeed; the 11th within the
 * window is refused even with the right password, and the ban then runs 15 minutes from that
 * refusal.
 */
@Injectable()
export class LoginAttemptsService {
  constructor(
    private readonly attempts: LoginAttemptsRepository,
    private readonly clock: Clock, // AR-24
  ) {}

  /**
   * Counts the attempt; throws TOO_MANY_ATTEMPTS when the email or the origin is over the limit.
   * Returns the reservation to hand back to `recordSuccess`.
   */
  async reserve(email: string, ip: string): Promise<AttemptReservation> {
    const now = this.clock.now();
    // The email first: an attempt refused for the email is not charged to the origin, so locking
    // a victim's email cannot also run up the victim's own origin.
    if (isRefused(await this.attempts.reserve(emailKey(email), now, LOGIN_ATTEMPT_RULE), now)) {
      throw new DomainError('TOO_MANY_ATTEMPTS');
    }
    if (isRefused(await this.attempts.reserve(ipKey(ip), now, LOGIN_ATTEMPT_RULE), now)) {
      throw new DomainError('TOO_MANY_ATTEMPTS');
    }
    return { at: now };
  }

  /**
   * A successful sign-in clears the email's counter and removes its own reservation from the
   * origin's attempts, so successes never build towards a ban (BR-001-15).
   */
  async recordSuccess(email: string, ip: string, reservation: AttemptReservation): Promise<void> {
    await Promise.all([
      this.attempts.clear(emailKey(email)),
      this.attempts.release(ipKey(ip), reservation.at),
    ]);
  }
}

function isRefused(reserved: ReservedAttempt, now: Date): boolean {
  return reserved.blockedUntil !== undefined && reserved.blockedUntil > now;
}
