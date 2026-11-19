import { describe, expect, it } from 'vitest';
import { PLANS_API, isCheckoutRef } from './plans-api';

describe('checkout refs', () => {
  it('accepts the 24 hex characters of a record id', () => {
    expect(isCheckoutRef('64b7f0000000000000000a01')).toBe(true);
    expect(PLANS_API.checkoutStatus('64b7f0000000000000000a01')).toBe(
      '/api/subscriptions/checkout/64b7f0000000000000000a01/status',
    );
  });

  it.each(['..', '.', '%2e%2e', '', 'a'.repeat(65), 'a/b', '64b7f0000000000000000a0', 'ABCDEF'])(
    'refuses %j, and never builds a path from it',
    (ref) => {
      expect(isCheckoutRef(ref)).toBe(false);
      expect(() => PLANS_API.checkoutStatus(ref)).toThrow(RangeError);
    },
  );
});
