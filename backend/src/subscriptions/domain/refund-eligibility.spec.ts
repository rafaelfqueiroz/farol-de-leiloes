// SPEC-012 BR-012-29 (D-48): the 7-day full refund of the first subscription, on its boundaries.
import { describe, expect, it } from 'vitest';
import { refundEligibleUntil, refundWindowEnd } from './refund-eligibility.js';

const PAID = new Date('2026-03-01T12:00:00.000Z');
const FIRST = { firstPaidAt: PAID, refundedAt: null, earlierPaidSubscription: false };
// Day n after the payment, n * 24 h: 03-07T12:00Z is day 6.
const day = (n: number) => new Date(PAID.getTime() + n * 24 * 60 * 60 * 1000);

describe('refundWindowEnd', () => {
  it('BR-012-29: the window is the configured days of 24 hours after the first payment', () => {
    // 2026-03-01T12:00Z + 7 * 24 h = 2026-03-08T12:00Z
    expect(refundWindowEnd(PAID, 7).toISOString()).toBe('2026-03-08T12:00:00.000Z');
    expect(refundWindowEnd(PAID, 14).toISOString()).toBe('2026-03-15T12:00:00.000Z');
  });
});

describe('refundEligibleUntil', () => {
  it('BR-012-29: day 6 is eligible, until the end of day 7', () => {
    expect(refundEligibleUntil(FIRST, day(6), 7)?.toISOString()).toBe('2026-03-08T12:00:00.000Z');
  });

  it('BR-012-29: the moment of the payment is eligible; one millisecond before the end still is', () => {
    expect(refundEligibleUntil(FIRST, PAID, 7)).not.toBeNull();
    expect(refundEligibleUntil(FIRST, new Date(day(7).getTime() - 1), 7)).not.toBeNull();
  });

  it('BR-012-29: exactly 7 days after the payment is NOT eligible (half-open window)', () => {
    expect(refundEligibleUntil(FIRST, day(7), 7)).toBeNull();
  });

  it('BR-012-29: day 8 is not eligible', () => {
    expect(refundEligibleUntil(FIRST, day(8), 7)).toBeNull();
  });

  it('BR-012-29: the window length is the setting, not a constant', () => {
    expect(refundEligibleUntil(FIRST, day(8), 14)).not.toBeNull();
    expect(refundEligibleUntil(FIRST, day(3), 2)).toBeNull();
  });

  it('BR-012-29: an earlier paid subscription of the office makes it ineligible', () => {
    expect(refundEligibleUntil({ ...FIRST, earlierPaidSubscription: true }, day(1), 7)).toBeNull();
  });

  it('BR-012-29: a subscription is refunded once', () => {
    expect(refundEligibleUntil({ ...FIRST, refundedAt: day(1) }, day(2), 7)).toBeNull();
  });

  it('BR-012-29: nothing paid, nothing to refund', () => {
    expect(refundEligibleUntil({ ...FIRST, firstPaidAt: null }, day(1), 7)).toBeNull();
  });
});
