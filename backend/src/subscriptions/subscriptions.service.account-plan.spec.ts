// SPEC-009 BR-009-13 (AR-09): the plan and subscription status an admin's account record shows, asked of
// the subscriptions module through its service. A plan belongs to an OFFICE (BR-012-06): the displayed
// subscription of the first office with one (the one in effect, else the latest that lapsed after being
// paid, BR-012-11); an account with a first plan and no office yet shows that; otherwise none. Hand-written
// fakes (TS-03); the queries themselves run against MongoDB in test/integration/admin-accounts.spec.ts.
import { describe, expect, it } from 'vitest';
import { FakeClock } from '../../test/fakes/fake-clock.js';
import { FakeSubscriptionsRepository } from '../../test/fakes/fake-subscriptions-repository.js';
import { testBusinessConfig } from '../../test/support/test-env.js';
import type { SubscriptionStatus } from './domain/subscription-status.js';
import type { SubscriptionsRepository } from './subscriptions.repository.js';
import { SubscriptionsService } from './subscriptions.service.js';

const ACCOUNT = '64b7f0000000000000000b01';
const OFFICE_A = '64b7f0000000000000000c01';
const OFFICE_B = '64b7f0000000000000000c02';
const NOW = new Date('2099-01-15T12:00:00.000Z');

function build() {
  const clock = new FakeClock(NOW);
  let tick = 0;
  const subscriptions = new FakeSubscriptionsRepository(
    () => new Date(NOW.getTime() + tick++ * 1000),
  );
  const service = new SubscriptionsService(
    subscriptions as unknown as SubscriptionsRepository,
    {} as never,
    {} as never,
    {} as never,
    clock,
    {} as never,
    {} as never,
    testBusinessConfig(),
  );
  /** A subscription in `status` (`paid`: it was paid once, so a lapsed one is displayed). */
  const seed = async (
    planCode: string,
    status: SubscriptionStatus,
    officeId?: string,
    paid = true,
  ) => {
    const row = await subscriptions.createPending({
      buyerUserId: ACCOUNT,
      planId: '64b7f0000000000000000a05',
      planCode,
      activeJourneyLimit: 5,
      ...(officeId === undefined ? {} : { officeId }),
    });
    const stored = subscriptions.rows.get(row.id);
    if (stored) {
      stored.status = status;
      if (paid) stored.firstPaidAt = NOW;
    }
  };
  return { service, seed };
}

describe('SubscriptionsService.displayedPlanOfAccount (BR-009-13)', () => {
  it('is none for an account with no office and no plan', async () => {
    const { service } = build();

    expect(await service.displayedPlanOfAccount(ACCOUNT, [])).toBeNull();
    expect(await service.displayedPlanOfAccount(ACCOUNT, [OFFICE_A])).toBeNull();
  });

  it('is the subscription in effect of the office: its plan code and its status', async () => {
    const { service, seed } = build();
    await seed('escritorio-5', 'PAST_DUE', OFFICE_A);

    expect(await service.displayedPlanOfAccount(ACCOUNT, [OFFICE_A])).toEqual({
      code: 'escritorio-5',
      status: 'PAST_DUE',
    });
  });

  it('is the latest lapsed one after being paid when none is in effect, and never one that was never paid', async () => {
    const { service, seed } = build();
    await seed('escritorio-2', 'LAPSED', OFFICE_A);
    await seed('escritorio-5', 'PENDING', OFFICE_A, false);

    expect(await service.displayedPlanOfAccount(ACCOUNT, [OFFICE_A])).toEqual({
      code: 'escritorio-2',
      status: 'LAPSED',
    });
  });

  it('is the first office that has one, in the order the seam lists them', async () => {
    const { service, seed } = build();
    await seed('escritorio-2', 'ACTIVE', OFFICE_B);
    await seed('escritorio-5', 'ACTIVE', OFFICE_A);

    expect(await service.displayedPlanOfAccount(ACCOUNT, [OFFICE_B, OFFICE_A])).toMatchObject({
      code: 'escritorio-2',
    });
    expect(await service.displayedPlanOfAccount(ACCOUNT, [OFFICE_A, OFFICE_B])).toMatchObject({
      code: 'escritorio-5',
    });
  });

  it('is the first plan of a buyer with no office yet, and an office’s plan wins over it', async () => {
    const { service, seed } = build();
    await seed('escritorio-5', 'ACTIVE');

    expect(await service.displayedPlanOfAccount(ACCOUNT, [])).toEqual({
      code: 'escritorio-5',
      status: 'ACTIVE',
    });
    await seed('escritorio-2', 'CANCELING', OFFICE_A);
    expect(await service.displayedPlanOfAccount(ACCOUNT, [OFFICE_A])).toEqual({
      code: 'escritorio-2',
      status: 'CANCELING',
    });
  });
});
