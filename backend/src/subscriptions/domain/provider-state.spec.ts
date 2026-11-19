// SPEC-012 BR-012-12, BR-012-13, BR-012-16, BR-012-17, BR-012-19..21, BR-012-29: the provider's
// state → ours, and what is stored, on hand-computed instants (TS-04). The result depends on the
// snapshot and the stored facts, never on which event woke the sync (BR-012-13).
import { describe, expect, it } from 'vitest';
import {
  type PlanFacts,
  type ProviderSnapshot,
  type ProviderStatus,
  reconcile,
  type ReconcileInput,
  statusFromProvider,
  type StoredFacts,
} from './provider-state.js';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const PAID_AT = new Date('2026-02-01T09:00:05.000Z');
const PERIOD_START = new Date('2026-02-01T09:00:00.000Z');
const PERIOD_END = new Date('2026-03-01T09:00:00.000Z');

const PLAN_5: PlanFacts = { id: 'plan-5', code: 'escritorio-5', activeJourneyLimit: 5 };
const PLAN_2: PlanFacts = { id: 'plan-2', code: 'escritorio-2', activeJourneyLimit: 2 };

const FRESH: StoredFacts = {
  status: 'PENDING',
  lapsedAt: null,
  firstPaidAt: null,
  firstPaymentFree: false,
};

function snapshot(overrides: Partial<ProviderSnapshot> = {}): ProviderSnapshot {
  return {
    id: 'sub_1',
    status: 'active',
    customerId: 'cus_1',
    cancelAtPeriodEnd: false,
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    scheduledChangeAt: null,
    firstInvoicePaidAt: PAID_AT,
    firstInvoiceFree: false,
    endedAt: null,
    ...overrides,
  };
}

function input(overrides: Partial<ReconcileInput> = {}): ReconcileInput {
  return {
    current: FRESH,
    provider: snapshot(),
    paidPlan: null,
    scheduledPlan: null,
    now: NOW,
    graceDays: 10,
    ...overrides,
  };
}

describe('BR-012-12: statusFromProvider', () => {
  it.each([
    ['active', false, 'ACTIVE'],
    ['trialing', false, 'ACTIVE'],
    ['active', true, 'CANCELING'], // BR-012-19: renewal stopped, still in effect
    ['trialing', true, 'CANCELING'],
    ['past_due', false, 'PAST_DUE'], // BR-012-20
    ['past_due', true, 'PAST_DUE'], // the failed charge is what the office must see
    ['unpaid', false, 'LAPSED'],
    ['canceled', false, 'LAPSED'],
    ['canceled', true, 'LAPSED'],
    ['incomplete_expired', false, 'LAPSED'],
    ['paused', false, 'LAPSED'],
    ['incomplete', false, 'PENDING'], // BR-012-09: payment not confirmed
  ] as const)(
    'provider %s (cancel at period end: %s) → %s',
    (status, cancelAtPeriodEnd, expected) => {
      expect(statusFromProvider(status, cancelAtPeriodEnd)).toBe(expected);
    },
  );

  it('refuses a status it does not know: a fault, never a guess about whether an office paid', () => {
    expect(() => statusFromProvider('invented' as ProviderStatus, false)).toThrow(
      'Unknown provider subscription status',
    );
  });
});

describe('reconcile: what the provider says is what is stored (BR-012-13)', () => {
  it('copies the provider ids, the renewal flag and the paid period', () => {
    const patch = reconcile(input());

    expect(patch).toMatchObject({
      status: 'ACTIVE',
      stripeSubscriptionId: 'sub_1',
      stripeCustomerId: 'cus_1',
      cancelAtPeriodEnd: false,
      currentPeriodStart: PERIOD_START,
      currentPeriodEnd: PERIOD_END,
      lastSyncedAt: NOW,
    });
  });

  it('is the same for the same snapshot whatever the stored state was (order independence)', () => {
    const fromPending = reconcile(input({ current: FRESH }));
    const fromActive = reconcile(
      input({
        current: {
          status: 'ACTIVE',
          lapsedAt: null,
          firstPaidAt: PAID_AT,
          firstPaymentFree: false,
        },
      }),
    );

    expect(fromPending.status).toBe(fromActive.status);
    expect(fromPending.lapsedAt).toBe(fromActive.lapsedAt);
    expect(fromPending.cancelAtPeriodEnd).toBe(fromActive.cancelAtPeriodEnd);
  });

  it('BR-012-09: an incomplete payment stays PENDING and records no payment', () => {
    const patch = reconcile(
      input({ provider: snapshot({ status: 'incomplete', firstInvoicePaidAt: null }) }),
    );

    expect(patch).toMatchObject({ status: 'PENDING', firstPaidAt: null, lapsedAt: null });
  });
});

describe('BR-012-29: a free first payment is remembered, once', () => {
  it('stores that the first payment charged nothing (a 100% coupon) with the first payment instant', () => {
    const patch = reconcile(input({ provider: snapshot({ firstInvoiceFree: true }) }));

    expect(patch).toMatchObject({ firstPaidAt: PAID_AT, firstPaymentFree: true });
  });

  it('keeps what was stored: a later snapshot never changes whether the first payment was free', () => {
    const free = reconcile(
      input({
        current: { status: 'ACTIVE', lapsedAt: null, firstPaidAt: PAID_AT, firstPaymentFree: true },
        provider: snapshot({ firstInvoiceFree: false }),
      }),
    );
    const paid = reconcile(
      input({
        current: {
          status: 'ACTIVE',
          lapsedAt: null,
          firstPaidAt: PAID_AT,
          firstPaymentFree: false,
        },
        provider: snapshot({ firstInvoiceFree: true }),
      }),
    );

    expect(free.firstPaymentFree).toBe(true);
    expect(paid.firstPaymentFree).toBe(false);
  });
});

describe('BR-012-29: firstPaidAt is the provider-confirmed first payment, stored once', () => {
  it('takes the paid time of the invoice when the subscription becomes active', () => {
    expect(reconcile(input()).firstPaidAt).toEqual(PAID_AT);
  });

  it('takes now when the provider gave no paid time but the subscription is in effect', () => {
    expect(
      reconcile(input({ provider: snapshot({ firstInvoicePaidAt: null }) })).firstPaidAt,
    ).toEqual(NOW);
  });

  it('never moves once set, even if a later invoice was paid later', () => {
    const first = new Date('2026-01-01T00:00:00.000Z');
    const patch = reconcile(
      input({
        current: { status: 'ACTIVE', lapsedAt: null, firstPaidAt: first, firstPaymentFree: false },
      }),
    );

    expect(patch.firstPaidAt).toEqual(first);
  });

  it('is recorded for a subscription seen ended after it was paid (pending → canceled)', () => {
    const patch = reconcile(
      input({
        provider: snapshot({ status: 'canceled', endedAt: new Date('2026-02-02T00:00:00.000Z') }),
      }),
    );

    expect(patch.firstPaidAt).toEqual(PAID_AT);
  });

  it('is not recorded for one that ended without ever being paid (incomplete_expired)', () => {
    const patch = reconcile(
      input({ provider: snapshot({ status: 'incomplete_expired', firstInvoicePaidAt: null }) }),
    );

    expect(patch.firstPaidAt).toBeNull();
  });
});

describe('BR-012-21: lapsedAt is set on entering LAPSED, kept while lapsed, cleared on leaving', () => {
  const lapsedProvider = snapshot({ status: 'canceled' });

  it('uses the instant the provider ended the subscription when it says so', () => {
    const endedAt = new Date('2026-02-27T09:00:00.000Z');
    const patch = reconcile(
      input({
        current: {
          status: 'CANCELING',
          lapsedAt: null,
          firstPaidAt: PAID_AT,
          firstPaymentFree: false,
        },
        provider: snapshot({ status: 'canceled', endedAt }),
      }),
    );

    expect(patch.lapsedAt).toEqual(endedAt);
    // 10 days after 2026-02-27T09:00Z is 2026-03-09T09:00Z.
    expect(patch.readOnlyAt).toEqual(new Date('2026-03-09T09:00:00.000Z'));
  });

  it('uses now when the provider gave no end (unpaid)', () => {
    const patch = reconcile(
      input({
        current: {
          status: 'PAST_DUE',
          lapsedAt: null,
          firstPaidAt: PAID_AT,
          firstPaymentFree: false,
        },
        provider: snapshot({ status: 'unpaid' }),
      }),
    );

    expect(patch.lapsedAt).toEqual(NOW);
    // 10 days after 2026-03-01T12:00Z is 2026-03-11T12:00Z.
    expect(patch.readOnlyAt).toEqual(new Date('2026-03-11T12:00:00.000Z'));
  });

  it('never trusts an end instant in the future: now counts', () => {
    const patch = reconcile(
      input({
        provider: snapshot({ status: 'canceled', endedAt: new Date('2026-03-02T00:00:00.000Z') }),
      }),
    );

    expect(patch.lapsedAt).toEqual(NOW);
  });

  it('keeps the stored lapse while it stays lapsed (a replay must not restart the grace period)', () => {
    const lapsedAt = new Date('2026-02-20T00:00:00.000Z');
    const patch = reconcile(
      input({
        current: { status: 'LAPSED', lapsedAt, firstPaidAt: PAID_AT, firstPaymentFree: false },
        provider: lapsedProvider,
      }),
    );

    expect(patch.lapsedAt).toEqual(lapsedAt);
    // 10 days after 2026-02-20T00:00Z is 2026-03-02T00:00Z.
    expect(patch.readOnlyAt).toEqual(new Date('2026-03-02T00:00:00.000Z'));
  });

  it('stamps it when a stored LAPSED has no instant (data from before the field)', () => {
    const patch = reconcile(
      input({
        current: {
          status: 'LAPSED',
          lapsedAt: null,
          firstPaidAt: PAID_AT,
          firstPaymentFree: false,
        },
        provider: lapsedProvider,
      }),
    );

    expect(patch.lapsedAt).toEqual(NOW);
  });

  it('clears it, and the read-only date, when the subscription is in effect again (BR-012-28)', () => {
    const patch = reconcile(
      input({
        current: {
          status: 'LAPSED',
          lapsedAt: new Date('2026-02-20T00:00:00.000Z'),
          firstPaidAt: PAID_AT,
          firstPaymentFree: false,
        },
        provider: snapshot({ status: 'active' }),
      }),
    );

    expect(patch).toMatchObject({ status: 'ACTIVE', lapsedAt: null, readOnlyAt: null });
  });

  it('the grace days are the setting (AR-43): 3 days → 2026-03-04T12:00Z', () => {
    const patch = reconcile(input({ provider: snapshot({ status: 'unpaid' }), graceDays: 3 }));

    expect(patch.readOnlyAt).toEqual(new Date('2026-03-04T12:00:00.000Z'));
  });
});

describe('BR-012-16: the plan follows the price the provider bills', () => {
  it('leaves the plan alone when the price did not change', () => {
    expect(reconcile(input()).plan).toBeNull();
  });

  it('changes plan and limit together when the provider bills another plan (upgrade paid)', () => {
    expect(reconcile(input({ paidPlan: PLAN_5 })).plan).toEqual(PLAN_5);
  });
});

describe('BR-012-17: a downgrade scheduled for the next period', () => {
  it('stores the scheduled plan and when it starts', () => {
    const scheduledChangeAt = PERIOD_END;
    const patch = reconcile(
      input({ provider: snapshot({ scheduledChangeAt }), scheduledPlan: PLAN_2 }),
    );

    expect(patch).toMatchObject({ scheduledPlanId: 'plan-2', scheduledChangeAt: PERIOD_END });
  });

  it('stores none when there is no schedule', () => {
    expect(reconcile(input())).toMatchObject({ scheduledPlanId: null, scheduledChangeAt: null });
  });

  it('stores none when the scheduled price maps to no plan', () => {
    const patch = reconcile(input({ provider: snapshot({ scheduledChangeAt: PERIOD_END }) }));

    expect(patch).toMatchObject({ scheduledPlanId: null, scheduledChangeAt: null });
  });

  it('stores none when the provider gave a plan but no date', () => {
    const patch = reconcile(input({ scheduledPlan: PLAN_2 }));

    expect(patch).toMatchObject({ scheduledPlanId: null, scheduledChangeAt: null });
  });
});
