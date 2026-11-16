// SPEC-001 BR-001-15, SC-04: "10 failures within 15 minutes" is a ROLLING window. The throttle is
// proven against a real MongoDB (TS-02) with the clock under test control (TS-06), for the
// `email:` key and the `ip:` key alike. Time is written as an offset in minutes from START and
// every expectation is worked out by hand in a comment (TS-04).
//
// The window is the half-open interval (now - 15 min, now]: an attempt that is exactly 15:00 old
// no longer counts, one that is 14:59.999 old still does. An attempt is counted when it starts, so
// "the Nth attempt in the window" is the one that makes N attempts inside it, itself included; the
// 11th is the first to be refused.
//
// The fake clock starts in 2099 on purpose: MongoDB's TTL monitor deletes documents whose
// `expiresAt` is in the past of the *real* clock.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Connection } from 'mongoose';
import { Clock } from '../../src/common/clock/clock.js';
import { DomainError } from '../../src/common/errors/domain-error.js';
import {
  LoginAttemptEntity,
  LoginAttemptSchema,
} from '../../src/auth/login-attempts/login-attempt.schema.js';
import { LoginAttemptsRepository } from '../../src/auth/login-attempts/login-attempts.repository.js';
import {
  LOGIN_ATTEMPT_RULE,
  LoginAttemptsService,
} from '../../src/auth/login-attempts/login-attempts.service.js';
import { FakeClock, MINUTE } from '../fakes/fake-clock.js';
import { useTestDatabase } from '../support/test-database.js';

const START = new Date('2099-03-01T12:00:00.000Z');

type Outcome = 'allowed' | 'refused';

describe('BR-001-15 rolling attempt window (integration)', () => {
  const db = useTestDatabase();
  const clock = new FakeClock(START);
  let moduleRef: TestingModule;
  let service: LoginAttemptsService;
  let connection: Connection;
  let counter = 0;

  const row = (key: string) => {
    if (!connection.db) throw new Error('no connection');
    return connection.db.collection('loginAttempts').findOne({ key });
  };

  /** Moves the clock to START + `minutes` + `extraMs`. */
  const at = (minutes: number, extraMs = 0) =>
    clock.set(new Date(START.getTime() + minutes * MINUTE + extraMs));

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(db.uri),
        MongooseModule.forFeature([{ name: LoginAttemptEntity.name, schema: LoginAttemptSchema }]),
      ],
      providers: [
        LoginAttemptsRepository,
        LoginAttemptsService,
        { provide: Clock, useValue: clock },
      ],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(LoginAttemptsService);
    connection = moduleRef.get(getConnectionToken());
    await connection.syncIndexes();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  /**
   * One subject of the throttle and how to attempt against it. For the email key every attempt
   * comes from a different origin, so the origin never reaches its own limit; for the origin key
   * every attempt is for a different email, for the same reason.
   */
  function subject(kind: 'email' | 'ip') {
    counter += 1;
    const n = counter;
    const email = `rolling-${n}@example.test`;
    const ip = `172.16.${(n >> 8) & 255}.${n & 255}`;
    const key = kind === 'email' ? `email:${email}` : `ip:${ip}`;
    let sequence = 0;
    /** Counts one attempt at the clock's current time and says whether it was let through. */
    async function attempt() {
      sequence += 1;
      const args: [string, string] =
        kind === 'email'
          ? [email, `10.${(n >> 8) & 255}.${n & 255}.${sequence}`]
          : [`other-${sequence}-${email}`, ip];
      try {
        return { outcome: 'allowed' as Outcome, reservation: await service.reserve(...args) };
      } catch (error) {
        if (error instanceof DomainError && error.code === 'TOO_MANY_ATTEMPTS') {
          return { outcome: 'refused' as Outcome };
        }
        throw error;
      }
    }
    return { key, email, ip, attempt };
  }

  /** `count` attempts at `minutes`, returning the outcomes in order. */
  async function attemptsAt(
    attempt: () => Promise<{ outcome: Outcome }>,
    minutes: number,
    count: number,
    extraMs = 0,
  ): Promise<Outcome[]> {
    at(minutes, extraMs);
    const outcomes: Outcome[] = [];
    for (let i = 0; i < count; i += 1) outcomes.push((await attempt()).outcome);
    return outcomes;
  }

  const allowed = (n: number): Outcome[] => Array<Outcome>(n).fill('allowed');

  it('BR-001-15: the rule is 10 attempts in 15 minutes, then 15 minutes of refusal', () => {
    expect(LOGIN_ATTEMPT_RULE).toEqual({ limit: 10, windowMs: 15 * MINUTE, banMs: 15 * MINUTE });
  });

  describe.each(['email', 'ip'] as const)('the %s key', (kind) => {
    it('BR-001-15: 1 failure at minute 0, 9 at minute 14, 1 at minute 16: the next attempt at minute 16 is refused', async () => {
      const { attempt, key } = subject(kind);

      // Minute 0: 1 attempt. Minute 14: 9 more. Window at minute 14 is (-1, 14]: 1 + 9 = 10, so
      // attempts number 1..10 are all let through.
      expect(await attemptsAt(attempt, 0, 1)).toEqual(allowed(1));
      expect(await attemptsAt(attempt, 14, 9)).toEqual(allowed(9));
      // Minute 16: the window is (1, 16]. The minute-0 failure is the only one outside it, so it
      // holds the 9 failures of minute 14, and this attempt is the 10th: let through.
      expect(await attemptsAt(attempt, 16, 1)).toEqual(allowed(1));
      // The next attempt would be the 11th inside the window: 9 + 1 + 1 = 11 > 10.
      expect(await attemptsAt(attempt, 16, 1)).toEqual(['refused']);

      // The ban runs 15 minutes from this refusal: until minute 31.
      const stored = await row(key);
      expect((stored?.blockedUntil as Date).getTime()).toBe(START.getTime() + 31 * MINUTE);
      expect(stored?.count).toBe(11);
    });

    it('BR-001-15: 10 failures spread inside the window: the 11th is refused', async () => {
      const { attempt } = subject(kind);

      // One per minute from minute 0 to minute 9: 10 failures.
      for (let minute = 0; minute < 10; minute += 1) {
        expect(await attemptsAt(attempt, minute, 1)).toEqual(allowed(1));
      }

      // Minute 14: the window is (-1, 14], the oldest failure (minute 0) is 14 minutes old and
      // counts: 10 + this attempt = 11 > 10.
      expect(await attemptsAt(attempt, 14, 1)).toEqual(['refused']);
    });

    it('BR-001-15: an attempt exactly 15:00 old no longer counts', async () => {
      const { attempt } = subject(kind);
      // 10 failures: minute 0, then minutes 1..9.
      for (let minute = 0; minute < 10; minute += 1) await attemptsAt(attempt, minute, 1);

      // Minute 15:00.000: the window is (0, 15]. Minute 0 is excluded (exactly 15:00 old); the
      // minute 1..9 failures are 9 and count: 9 + this attempt = 10, not over the limit.
      expect(await attemptsAt(attempt, 15, 1)).toEqual(allowed(1));
      // The 11th inside (0, 15] would now be refused: 9 + 1 + 1 = 11.
      expect(await attemptsAt(attempt, 15, 1)).toEqual(['refused']);
    });

    it('BR-001-15: an attempt 14:59.999 old still counts', async () => {
      const { attempt } = subject(kind);
      for (let minute = 0; minute < 10; minute += 1) await attemptsAt(attempt, minute, 1);

      // 15 minutes minus 1 ms after minute 0: the window is (-1 ms, 14:59.999], so minute 0 is
      // inside: 10 + this attempt = 11 > 10.
      expect(await attemptsAt(attempt, 15, 1, -1)).toEqual(['refused']);
    });

    it('BR-001-15: failures leave the window one by one, not all together', async () => {
      const { attempt } = subject(kind);
      await attemptsAt(attempt, 0, 5); // 5 failures at minute 0
      await attemptsAt(attempt, 10, 5); // 5 failures at minute 10: 10 inside the window

      // Minute 16: the window is (1, 16]. Only the 5 failures of minute 10 remain. The attempts
      // numbered 6 to 10 are let through (5 + 5 = 10), the 11th is refused.
      expect(await attemptsAt(attempt, 16, 5)).toEqual(allowed(5));
      expect(await attemptsAt(attempt, 16, 1)).toEqual(['refused']);
    });

    it('BR-001-15: the ban lasts 15 minutes from the refusal and hammering does not extend it', async () => {
      const { attempt, key } = subject(kind);
      await attemptsAt(attempt, 0, 10);
      expect(await attemptsAt(attempt, 5, 1)).toEqual(['refused']); // refusal at minute 5
      const banned = await row(key);
      expect((banned?.blockedUntil as Date).getTime()).toBe(START.getTime() + 20 * MINUTE);

      // Hammered at minutes 6, 12 and 19:59.999, all refused and none counted or extending.
      expect(await attemptsAt(attempt, 6, 3)).toEqual(['refused', 'refused', 'refused']);
      expect(await attemptsAt(attempt, 12, 1)).toEqual(['refused']);
      expect(await attemptsAt(attempt, 20, 1, -1)).toEqual(['refused']);
      const after = await row(key);
      expect(after?.blockedUntil).toEqual(banned?.blockedUntil);
      expect(after?.count).toBe(11);

      // Minute 20:00.000 the ban is over (blockedUntil is not after now). The window is (5, 20]:
      // the 10 failures of minute 0 and the refused attempt of minute 5 are all outside it.
      expect(await attemptsAt(attempt, 20, 1)).toEqual(allowed(1));
    });

    it('BR-001-15: of 25 parallel attempts exactly 10 are let through and 15 are refused', async () => {
      const { attempt, key } = subject(kind);
      at(0);

      const results = await Promise.all(Array.from({ length: 25 }, () => attempt()));

      // Numbered 1..25 by the database, atomically: 1..10 pass, 11 triggers the ban and is
      // refused, 12..25 are refused against the running ban without being counted.
      expect(results.filter((r) => r.outcome === 'allowed')).toHaveLength(10);
      expect(results.filter((r) => r.outcome === 'refused')).toHaveLength(15);
      const stored = await row(key);
      expect(stored?.count).toBe(11);
      expect(stored?.attempts).toHaveLength(11); // capped at limit + 1
    });

    it('the row expires with the latest counted attempt plus the window, or with the ban', async () => {
      const { attempt, key } = subject(kind);
      await attemptsAt(attempt, 3, 1);
      // One attempt at minute 3: the row is needed until it leaves the window, minute 18.
      expect(((await row(key))?.expiresAt as Date).getTime()).toBe(START.getTime() + 18 * MINUTE);

      await attemptsAt(attempt, 4, 9); // 10 attempts in all
      await attemptsAt(attempt, 7, 1); // the refusal at minute 7: ban until minute 22
      // Latest counted attempt is the refused one (minute 7) + 15 = 22 = the ban's end.
      expect(((await row(key))?.expiresAt as Date).getTime()).toBe(START.getTime() + 22 * MINUTE);
    });
  });

  describe('a successful sign-in (BR-001-15)', () => {
    it('clears the email key and gives back only the reservation it made on the origin', async () => {
      const email = `success-${(counter += 1)}@example.test`;
      const ip = `203.1.${counter % 250}.7`;
      at(0);
      const first = await service.reserve(email, ip); // minute 0
      at(1);
      await service.reserve(email, ip); // minute 1
      at(2);
      await service.reserve(email, ip); // minute 2

      at(3);
      // The success belongs to the FIRST attempt (minute 0): that one is given back.
      await service.recordSuccess(email, ip, first);

      expect(await row(`email:${email}`)).toBeNull();
      const origin = await row(`ip:${ip}`);
      expect((origin?.attempts as Date[]).map((d) => d.getTime())).toEqual([
        START.getTime() + 1 * MINUTE,
        START.getTime() + 2 * MINUTE,
      ]);
      expect(origin?.count).toBe(2);
    });

    it('gives back exactly one of two reservations made in the same millisecond', async () => {
      const email = `same-ms-${(counter += 1)}@example.test`;
      const ip = `203.2.${counter % 250}.7`;
      at(0);
      const first = await service.reserve(email, ip);
      await service.reserve(`other-${email}`, ip); // the same instant, the same origin

      await service.recordSuccess(email, ip, first);

      expect((await row(`ip:${ip}`))?.count).toBe(1);
    });

    it('never gives back below zero when the reservation already left the window', async () => {
      const email = `late-${(counter += 1)}@example.test`;
      const ip = `203.4.${counter % 250}.7`;
      at(0);
      const old = await service.reserve(email, ip);
      at(20); // 20 minutes later: the reservation is outside the window
      await service.reserve(`next-${email}`, ip); // minute 20: prunes minute 0, adds minute 20

      await service.recordSuccess(email, ip, old);

      expect((await row(`ip:${ip}`))?.count).toBe(1);
    });
  });
});
