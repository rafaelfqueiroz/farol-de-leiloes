// SPEC-010 BR-010-15: the purge schedule, with hand-computed instants (TS-04).
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ACCOUNT_PURGE_LIMITS,
  PURGE_CLAIM_LEASE_MS,
  claimExpiry,
  isClaimLive,
  overdueClosedBefore,
  purgeDeadline,
} from './account-purge.js';

describe('the limits of one purge run', () => {
  it('default to a batch of 100 and 500 attempts a run (production never overrides them)', () => {
    expect(DEFAULT_ACCOUNT_PURGE_LIMITS).toEqual({ batchSize: 100, maxAttemptsPerRun: 500 });
    expect(Object.isFrozen(DEFAULT_ACCOUNT_PURGE_LIMITS)).toBe(true);
  });
});

const NOW = new Date('2026-04-30T12:00:00.000Z');

describe('the claim a purge worker holds on one account', () => {
  it('is a 10-minute lease', () => {
    expect(PURGE_CLAIM_LEASE_MS).toBe(600_000);
    expect(claimExpiry(NOW)).toEqual(new Date('2026-04-30T12:10:00.000Z'));
  });

  it.each<[string, Date | null | undefined, boolean]>([
    ['one minute before its expiry', new Date('2026-04-30T12:01:00.000Z'), true],
    ['at its expiry instant it is free', NOW, false],
    ['after its expiry', new Date('2026-04-30T11:59:00.000Z'), false],
    ['no claim', undefined, false],
    ['a null claim', null, false],
  ])('%s', (_label, until, live) => {
    expect(isClaimLive(until, NOW)).toBe(live);
  });
});

describe('BR-010-15: when a closed account is overdue', () => {
  it('is overdue once closed 25 days ago or earlier (30 April 12:00 - 25 d = 5 April 12:00)', () => {
    expect(overdueClosedBefore(NOW, 25)).toEqual(new Date('2026-04-05T12:00:00.000Z'));
  });

  it('the legal deadline is 30 days after closure (closed 5 April 12:00 -> 5 May 12:00)', () => {
    expect(purgeDeadline(new Date('2026-04-05T12:00:00.000Z'), 30)).toEqual(
      new Date('2026-05-05T12:00:00.000Z'),
    );
  });
});
