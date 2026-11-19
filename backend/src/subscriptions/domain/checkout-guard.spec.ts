// SPEC-012 BR-012-07, BR-012-08: one open checkout per office, or per buyer without an office.
import { describe, expect, it } from 'vitest';
import {
  CHECKOUT_CREATION_GRACE_MS,
  classifyOpenCheckout,
  openCheckoutKey,
} from './checkout-guard.js';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const created = (msAgo: number) => new Date(NOW.getTime() - msAgo);

describe('openCheckoutKey', () => {
  it('BR-012-08: an office subscription is keyed by the office', () => {
    expect(openCheckoutKey({ officeId: 'o1', buyerUserId: 'b1' })).toBe('office:o1');
  });

  it('BR-012-07: a first subscription is keyed by the buyer', () => {
    expect(openCheckoutKey({ buyerUserId: 'b1' })).toBe('buyer:b1');
  });

  it('two buyers never share a key', () => {
    expect(openCheckoutKey({ buyerUserId: 'b1' })).not.toBe(openCheckoutKey({ buyerUserId: 'b2' }));
  });
});

describe('classifyOpenCheckout', () => {
  it('BR-012-09: a checkout the provider already made a subscription of is in flight', () => {
    expect(
      classifyOpenCheckout(
        { stripeSubscriptionId: 'sub_1', checkoutSessionId: 'cs_1', createdAt: created(1) },
        NOW,
      ),
    ).toEqual({ state: 'in_flight' });
  });

  it('a checkout with a session and no subscription may be replaced (its session expired)', () => {
    expect(
      classifyOpenCheckout(
        { stripeSubscriptionId: null, checkoutSessionId: 'cs_1', createdAt: created(1) },
        NOW,
      ),
    ).toEqual({ state: 'replaceable', checkoutSessionId: 'cs_1' });
  });

  it('a record with no session yet is in flight while it is new', () => {
    expect(
      classifyOpenCheckout(
        { stripeSubscriptionId: null, checkoutSessionId: null, createdAt: created(1000) },
        NOW,
      ),
    ).toEqual({ state: 'in_flight' });
  });

  it('a record with no session after the grace period is an orphan (the creation never finished)', () => {
    const open = { stripeSubscriptionId: null, checkoutSessionId: null };
    expect(
      classifyOpenCheckout({ ...open, createdAt: created(CHECKOUT_CREATION_GRACE_MS - 1) }, NOW),
    ).toEqual({ state: 'in_flight' });
    expect(
      classifyOpenCheckout({ ...open, createdAt: created(CHECKOUT_CREATION_GRACE_MS) }, NOW),
    ).toEqual({ state: 'orphaned' });
  });
});
