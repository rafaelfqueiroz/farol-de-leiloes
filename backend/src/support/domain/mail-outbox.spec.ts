// SPEC-009 BR-009-07, BR-009-10, BR-009-15: the outbox rules. Hand-computed expectations (TS-04).
import { describe, expect, it } from 'vitest';
import {
  isLeaseOver,
  MAIL_CLAIM_LEASE_MS,
  MAIL_INLINE_BUDGET_MS,
  MAIL_RETRY_DELAYS_MINUTES,
  MAIL_SEND_TIMEOUT_MS,
  MAX_MAIL_ATTEMPTS,
  mailDecision,
  nextMailAttempt,
  pendingMails,
} from './mail-outbox.js';

const AT = new Date('2026-03-01T12:00:00.000Z');
const NOW = new Date('2026-03-01T12:00:00.000Z');
const MINUTE = 60_000;

describe('pendingMails', () => {
  it('owes both emails to a new request, the team notice first', () => {
    expect(pendingMails({})).toEqual(['team_notice', 'confirmation']);
  });

  it('stops owing an email once it was sent or skipped', () => {
    expect(pendingMails({ teamNoticeSentAt: AT })).toEqual(['confirmation']);
    expect(pendingMails({ teamNoticeSkippedAt: AT })).toEqual(['confirmation']);
    expect(pendingMails({ confirmationSentAt: AT })).toEqual(['team_notice']);
    expect(pendingMails({ confirmationSkippedAt: AT })).toEqual(['team_notice']);
    expect(pendingMails({ confirmationSentAt: AT, teamNoticeSkippedAt: AT })).toEqual([]);
  });

  it('owes nothing once the retries gave up', () => {
    expect(pendingMails({ mailGaveUpAt: AT })).toEqual([]);
  });
});

describe('mailDecision', () => {
  it('BR-009-15: the confirmation goes to an active account only', () => {
    expect(mailDecision('confirmation', 'active')).toBe('send');
    for (const status of ['deactivated', 'closed', 'pending', null]) {
      expect(mailDecision('confirmation', status)).toBe('skip');
    }
  });

  it('BR-009-10: the team notice goes for an active or a deactivated account, never a closed or vanished one', () => {
    expect(mailDecision('team_notice', 'active')).toBe('send');
    expect(mailDecision('team_notice', 'deactivated')).toBe('send');
    for (const status of ['closed', 'pending', null]) {
      expect(mailDecision('team_notice', status)).toBe('skip');
    }
  });
});

describe('nextMailAttempt', () => {
  it('waits 1, 2, 5, 15, 60 and 180 minutes after the first six failures', () => {
    const minutes = [1, 2, 3, 4, 5, 6].map((failed) => {
      const next = nextMailAttempt(failed, NOW);
      return next.giveUp ? null : (next.at.getTime() - NOW.getTime()) / MINUTE;
    });
    expect(minutes).toEqual([1, 2, 5, 15, 60, 180]);
  });

  it('keeps the last wait (180 minutes) for the seventh failure, and gives up at the eighth', () => {
    const seventh = nextMailAttempt(7, NOW);
    expect(seventh).toEqual({ giveUp: false, at: new Date('2026-03-01T15:00:00.000Z') });
    expect(nextMailAttempt(8, NOW)).toEqual({ giveUp: true });
    expect(nextMailAttempt(9, NOW)).toEqual({ giveUp: true });
  });

  it('is built on the documented numbers', () => {
    expect(MAX_MAIL_ATTEMPTS).toBe(8);
    expect(MAIL_RETRY_DELAYS_MINUTES).toEqual([1, 2, 5, 15, 60, 180]);
  });

  it.each([0, -1, 1.5, Number.NaN])('refuses %s failed rounds', (failed) => {
    expect(() => nextMailAttempt(failed, NOW)).toThrow(RangeError);
  });
});

describe('the time limits of a delivery (review of #186, finding 1)', () => {
  it('are 20 s per send, 6 s inline, 2 minutes of lease', () => {
    expect(MAIL_SEND_TIMEOUT_MS).toBe(20_000);
    expect(MAIL_INLINE_BUDGET_MS).toBe(6_000);
    expect(MAIL_CLAIM_LEASE_MS).toBe(120_000);
  });

  it('leave the two sends of a round (40 s) well inside the lease, and the inline wait inside one send', () => {
    expect(2 * MAIL_SEND_TIMEOUT_MS).toBeLessThan(MAIL_CLAIM_LEASE_MS);
    expect(MAIL_INLINE_BUDGET_MS).toBeLessThan(MAIL_SEND_TIMEOUT_MS);
  });
});

describe('isLeaseOver', () => {
  const until = new Date('2026-03-01T12:02:00.000Z');

  it('is half-open: still held the instant before, over at the end instant and after', () => {
    expect(isLeaseOver(until, new Date('2026-03-01T12:01:59.999Z'))).toBe(false);
    expect(isLeaseOver(until, new Date('2026-03-01T12:02:00.000Z'))).toBe(true);
    expect(isLeaseOver(until, new Date('2026-03-01T12:03:00.000Z'))).toBe(true);
  });

  it('is never over for a request with no lease recorded', () => {
    expect(isLeaseOver(undefined, new Date('2026-03-01T12:03:00.000Z'))).toBe(false);
  });
});
