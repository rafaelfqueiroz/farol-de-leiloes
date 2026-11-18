// SPEC-012 BR-012-21, BR-012-28 / SPEC-002 BR-002-30: the OFFICE_PLAN_SOURCE implementation over a
// fake repository and the fake clock (TS-03, TS-06). The query itself runs against MongoDB in
// test/integration/subscriptions-office-plan.spec.ts. Grace is 10 days; the office lapsed at
// 2026-03-01T12:00Z, so it is read-only from 2026-03-11T12:00Z.
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../test/fakes/fake-clock.js';
import { FakeSubscriptionsRepository } from '../../test/fakes/fake-subscriptions-repository.js';
import { testBusinessConfig } from '../../test/support/test-env.js';
import { SubscriptionOfficePlanSource } from './subscription-office-plan.source.js';
import type { SubscriptionsRepository } from './subscriptions.repository.js';

const OFFICE = '64b7f0000000000000000c01';
const OTHER = '64b7f0000000000000000c02';
const PAID_AT = new Date('2026-01-01T12:00:00.000Z');
const LAPSED_AT = new Date('2026-03-01T12:00:00.000Z');

async function seeded(
  clock: FakeClock,
  rows: {
    officeId: string;
    status: 'ACTIVE' | 'PAST_DUE' | 'CANCELING' | 'LAPSED' | 'PENDING';
    lapsedAt?: Date;
    paid?: boolean;
  }[],
) {
  const subscriptions = new FakeSubscriptionsRepository();
  for (const row of rows) {
    const created = await subscriptions.createPending({
      buyerUserId: '64b7f0000000000000000b01',
      planId: '64b7f0000000000000000a05',
      planCode: 'escritorio-5',
      activeJourneyLimit: 5,
      officeId: row.officeId,
    });
    const stored = subscriptions.rows.get(created.id);
    if (stored) {
      stored.status = row.status;
      stored.lapsedAt = row.lapsedAt ?? null;
      stored.firstPaidAt = row.paid === false ? null : PAID_AT;
    }
  }
  return new SubscriptionOfficePlanSource(
    subscriptions as unknown as SubscriptionsRepository,
    clock,
    testBusinessConfig(),
  );
}

describe('SubscriptionOfficePlanSource', () => {
  const clock = new FakeClock(new Date('2026-03-05T12:00:00.000Z'));

  it('BR-012-21: an office with a subscription in effect is an advisor office and writable', async () => {
    const source = await seeded(clock, [{ officeId: OFFICE, status: 'PAST_DUE' }]);

    const plans = await source.officePlans([OFFICE]);

    expect(plans.get(OFFICE)).toEqual({
      advisorPlanActive: true,
      readOnly: false,
      entitlements: ['advisor'],
    });
  });

  it('BR-012-28: lapsed within the grace period (day 4) it is still writable', async () => {
    const source = await seeded(clock, [
      { officeId: OFFICE, status: 'LAPSED', lapsedAt: LAPSED_AT },
    ]);

    expect((await source.officePlans([OFFICE])).get(OFFICE)).toMatchObject({
      advisorPlanActive: true,
      readOnly: false,
    });
  });

  it('BR-012-28: after the grace period it is read-only, computed from the clock on each read', async () => {
    const later = new FakeClock(new Date('2026-03-10T12:00:00.000Z')); // day 9
    const source = await seeded(later, [
      { officeId: OFFICE, status: 'LAPSED', lapsedAt: LAPSED_AT },
    ]);

    expect((await source.officePlans([OFFICE])).get(OFFICE)?.readOnly).toBe(false);
    later.set(new Date('2026-03-11T12:00:00.000Z')); // exactly lapse + 10 days
    expect((await source.officePlans([OFFICE])).get(OFFICE)?.readOnly).toBe(true);
    later.set(new Date('2026-03-12T12:00:00.000Z')); // day 11
    expect((await source.officePlans([OFFICE])).get(OFFICE)?.readOnly).toBe(true);
  });

  it('the grace period is the setting (AR-43)', async () => {
    const subscriptions = new FakeSubscriptionsRepository();
    const created = await subscriptions.createPending({
      buyerUserId: '64b7f0000000000000000b01',
      planId: '64b7f0000000000000000a05',
      planCode: 'escritorio-5',
      activeJourneyLimit: 5,
      officeId: OFFICE,
    });
    const stored = subscriptions.rows.get(created.id);
    if (stored)
      Object.assign(stored, { status: 'LAPSED', lapsedAt: LAPSED_AT, firstPaidAt: PAID_AT });
    // 3 days of grace: lapse 2026-03-01T12:00Z → read-only from 2026-03-04T12:00Z, before "now".
    const source = new SubscriptionOfficePlanSource(
      subscriptions as unknown as SubscriptionsRepository,
      clock,
      testBusinessConfig({ SUBSCRIPTION_GRACE_DAYS: '3' }),
    );

    expect((await source.officePlans([OFFICE])).get(OFFICE)?.readOnly).toBe(true);
  });

  it('BR-012-28: a new subscription in effect beats the lapsed one and lifts read-only at once', async () => {
    const source = await seeded(clock, [
      { officeId: OFFICE, status: 'LAPSED', lapsedAt: new Date('2026-01-10T00:00:00.000Z') },
      { officeId: OFFICE, status: 'ACTIVE' },
    ]);

    expect((await source.officePlans([OFFICE])).get(OFFICE)).toMatchObject({
      advisorPlanActive: true,
      readOnly: false,
    });
  });

  it('SPEC-002 fails closed: an office with no confirmed subscription is absent from the answer', async () => {
    const source = await seeded(clock, [
      { officeId: OFFICE, status: 'PENDING' },
      { officeId: OTHER, status: 'LAPSED', lapsedAt: LAPSED_AT, paid: false },
    ]);

    const plans = await source.officePlans([OFFICE, OTHER, '64b7f0000000000000000c99']);

    expect(plans.size).toBe(0);
  });

  it('answers each office of the list from its own subscriptions', async () => {
    const source = await seeded(clock, [
      { officeId: OFFICE, status: 'ACTIVE' },
      { officeId: OTHER, status: 'LAPSED', lapsedAt: new Date('2026-02-01T00:00:00.000Z') },
    ]);

    const plans = await source.officePlans([OFFICE, OTHER]);

    expect(plans.get(OFFICE)?.readOnly).toBe(false);
    expect(plans.get(OTHER)?.readOnly).toBe(true); // lapsed 32 days ago
  });

  it('BR-012-27: a subscription gives a self-advised investor no entitlement (the limit of 3 is not a plan)', async () => {
    const source = await seeded(clock, []);

    await expect(source.selfAdvisedEntitlements()).resolves.toEqual([]);
  });
});
