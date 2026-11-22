import { describe, expect, it } from 'vitest';
import { abandonedPendingCutoff, isAccountActive, PENDING_SIGNUP_TTL_MS } from './user-account.js';

describe('isAccountActive (BR-001-16, SPEC-010 BR-010-01)', () => {
  it.each([
    ['active', true],
    ['a missing status (an account that predates the field, AR-28)', true],
    ['a null status', true],
    ['pending', false],
    ['deactivated', false],
    ['closed', false],
  ] as const)('%s', (label, expected) => {
    const status = label.startsWith('a missing')
      ? undefined
      : label.startsWith('a null')
        ? null
        : label;
    expect(isAccountActive({ status })).toBe(expected);
  });
});

describe('abandonedPendingCutoff (SPEC-010 BR-010-01)', () => {
  it('is the injected now minus 15 minutes', () => {
    const now = new Date('2026-06-01T12:00:00.000Z');
    expect(PENDING_SIGNUP_TTL_MS).toBe(15 * 60 * 1000);
    expect(abandonedPendingCutoff(now)).toEqual(new Date('2026-06-01T11:45:00.000Z'));
  });
});
