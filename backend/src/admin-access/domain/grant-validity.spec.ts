// SPEC-002 BR-002-26 / TS-24: the grant validity rule, every branch (critical module, 100%).
import { describe, expect, it } from 'vitest';
import { GRANT_LIFETIME_MS, grantExpiresAt, grantValidity } from './grant-validity.js';

const OPENED = new Date('2026-05-04T10:00:00.000Z');
const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const OPEN_ALLOWED = { open: true, dataAccessAllowed: true };
const at = (ms: number) => new Date(OPENED.getTime() + ms);

describe('grantExpiresAt (BR-002-26)', () => {
  it('is 7 days after the grant was opened', () => {
    expect(GRANT_LIFETIME_MS).toBe(7 * DAY);
    expect(grantExpiresAt(OPENED)).toEqual(new Date('2026-05-11T10:00:00.000Z'));
  });
});

describe('grantValidity (BR-002-26)', () => {
  it('is valid while the request is open, data access allowed and 7 days have not passed', () => {
    expect(grantValidity({ openedAt: OPENED }, OPEN_ALLOWED, at(0))).toEqual({
      valid: true,
      expiresAt: at(7 * DAY),
    });
    expect(grantValidity({ openedAt: OPENED }, OPEN_ALLOWED, at(7 * DAY - 1))).toMatchObject({
      valid: true,
    });
  });

  it('ends at exactly 7 days (half-open interval), recorded at the expiry instant', () => {
    expect(grantValidity({ openedAt: OPENED }, OPEN_ALLOWED, at(7 * DAY))).toEqual({
      valid: false,
      reason: 'expired',
      endedAt: at(7 * DAY),
      alreadyEnded: false,
    });
  });

  it('refuses a grant opened 7 days and 1 minute ago even though the request is open', () => {
    expect(grantValidity({ openedAt: OPENED }, OPEN_ALLOWED, at(7 * DAY + MINUTE))).toEqual({
      valid: false,
      reason: 'expired',
      endedAt: at(7 * DAY),
      alreadyEnded: false,
    });
  });

  it('ends when the request is closed, recorded now', () => {
    const now = at(DAY);
    expect(
      grantValidity({ openedAt: OPENED }, { open: false, dataAccessAllowed: true }, now),
    ).toEqual({ valid: false, reason: 'closed', endedAt: now, alreadyEnded: false });
  });

  it('ends when the request no longer exists (fail closed)', () => {
    expect(grantValidity({ openedAt: OPENED }, null, at(DAY))).toMatchObject({
      valid: false,
      reason: 'closed',
    });
  });

  it('ends when the requester withdraws the permission', () => {
    const now = at(DAY);
    expect(
      grantValidity({ openedAt: OPENED }, { open: true, dataAccessAllowed: false }, now),
    ).toEqual({ valid: false, reason: 'withdrawn', endedAt: now, alreadyEnded: false });
  });

  it('prefers the request state over the expiry when both apply', () => {
    expect(
      grantValidity({ openedAt: OPENED }, { open: false, dataAccessAllowed: false }, at(8 * DAY)),
    ).toMatchObject({ reason: 'closed' });
  });

  it('never reopens an ended grant, even with an open request inside the 7 days', () => {
    const endedAt = at(MINUTE);
    expect(
      grantValidity({ openedAt: OPENED, endedAt, endReason: 'withdrawn' }, OPEN_ALLOWED, at(DAY)),
    ).toEqual({ valid: false, reason: 'withdrawn', endedAt, alreadyEnded: true });
  });

  it('treats a stored end without its reason as ended (fail closed)', () => {
    expect(
      grantValidity({ openedAt: OPENED, endedAt: at(MINUTE) }, OPEN_ALLOWED, at(DAY)),
    ).toMatchObject({ valid: false, reason: 'expired', alreadyEnded: true });
  });
});
