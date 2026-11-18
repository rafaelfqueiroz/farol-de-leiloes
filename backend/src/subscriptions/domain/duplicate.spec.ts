// SPEC-012 BR-012-08: the later of two subscriptions in effect is the one cancelled.
import { describe, expect, it } from 'vitest';
import { isLaterSubscription } from './duplicate.js';

const EARLY_ID = '64b7f0000000000000000001';
const LATE_ID = '64b7f0000000000000000002';

describe('isLaterSubscription', () => {
  it('BR-012-08: by first payment when both have one (2026-02-01 is later than 2026-01-10)', () => {
    const jan = { id: LATE_ID, firstPaidAt: new Date('2026-01-10T00:00:00.000Z') };
    const feb = { id: EARLY_ID, firstPaidAt: new Date('2026-02-01T00:00:00.000Z') };

    // The ids point the other way: the payment time wins.
    expect(isLaterSubscription(feb, jan)).toBe(true);
    expect(isLaterSubscription(jan, feb)).toBe(false);
  });

  it('falls back to creation (the id) on the same first payment instant', () => {
    const paid = new Date('2026-01-10T00:00:00.000Z');

    expect(
      isLaterSubscription({ id: LATE_ID, firstPaidAt: paid }, { id: EARLY_ID, firstPaidAt: paid }),
    ).toBe(true);
    expect(
      isLaterSubscription({ id: EARLY_ID, firstPaidAt: paid }, { id: LATE_ID, firstPaidAt: paid }),
    ).toBe(false);
  });

  it('falls back to creation when either has no confirmed payment', () => {
    const paid = new Date('2026-01-10T00:00:00.000Z');

    expect(
      isLaterSubscription({ id: LATE_ID, firstPaidAt: null }, { id: EARLY_ID, firstPaidAt: paid }),
    ).toBe(true);
    expect(
      isLaterSubscription({ id: EARLY_ID, firstPaidAt: paid }, { id: LATE_ID, firstPaidAt: null }),
    ).toBe(false);
    expect(
      isLaterSubscription({ id: LATE_ID, firstPaidAt: null }, { id: EARLY_ID, firstPaidAt: null }),
    ).toBe(true);
  });
});
