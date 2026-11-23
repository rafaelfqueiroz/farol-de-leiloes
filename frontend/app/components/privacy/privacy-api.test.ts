import { describe, expect, it } from 'vitest';
import { settleExpiry } from './privacy-api';
import { EXPIRED, FAILED, QUEUED, READY } from './privacy-test-support';

// BR-010-11: the SERVER's clock decides whether a listed `ready` export is past its time.
describe('settleExpiry', () => {
  it.each([
    ['at expiresAt', 'Thu, 26 Nov 2026 17:45:00 GMT'],
    ['after expiresAt', 'Fri, 27 Nov 2026 00:00:00 GMT'],
  ])('turns a ready export into an expired one %s, keeping its dates', (_label, date) => {
    expect(settleExpiry(READY, date)).toEqual({ ...READY, status: 'expired' });
  });

  it.each([
    ['before expiresAt', 'Thu, 26 Nov 2026 17:44:59 GMT'],
    ['no server time', null],
    ['a server time that is not a date', 'not a date'],
  ])('leaves it ready with %s', (_label, date) => {
    expect(settleExpiry(READY, date)).toBe(READY);
  });

  it('leaves every other state and nothing as they are', () => {
    const late = 'Fri, 27 Nov 2026 00:00:00 GMT';
    for (const item of [QUEUED, FAILED, EXPIRED, null]) expect(settleExpiry(item, late)).toBe(item);
  });

  it('leaves a ready export with no expiresAt as it is: nothing to judge by', () => {
    const odd = { ...READY, expiresAt: undefined };
    expect(settleExpiry(odd, 'Fri, 27 Nov 2026 00:00:00 GMT')).toBe(odd);
  });
});
