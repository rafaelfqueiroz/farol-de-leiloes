// SPEC-012 BR-012-07..BR-012-14, SC-11, ADR-005: the webhook algorithm, against hand-written fakes
// of every port (TS-03, TS-07): the payment provider, the event ledger, the subscription store, the
// plan catalog, the SPEC-011 office provisioner and the payment-failed notifier. The real
// conditional updates and the unique indexes these fakes imitate are proven against MongoDB in
// test/integration/subscriptions-repositories.spec.ts (TS-02).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { Decimal } from '../common/money/money.js';
import { DomainError } from '../common/errors/domain-error.js';
import type { PaymentEvent } from '../payments/payment-gateway.js';
import type { PlansService } from '../plans/plans.service.js';
import { aPlan } from '../../test/builders/plan.builder.js';
import { aProviderSubscription } from '../../test/builders/provider-subscription.builder.js';
import { FakeClock, DAY } from '../../test/fakes/fake-clock.js';
import { FakeOfficeProvisioner } from '../../test/fakes/fake-office-provisioner.js';
import { FakePaymentEventsRepository } from '../../test/fakes/fake-payment-events-repository.js';
import { FakePaymentFailedNotifier } from '../../test/fakes/fake-payment-failed-notifier.js';
import { FakePaymentGateway } from '../../test/fakes/fake-payment-gateway.js';
import { FakeSubscriptionsRepository } from '../../test/fakes/fake-subscriptions-repository.js';
import { InMemoryPlans } from '../../test/fakes/in-memory-plans.js';
import { testBusinessConfig } from '../../test/support/test-env.js';
import { effectiveJourneyLimit } from './domain/subscription-status.js';
import type { PaymentEventsRepository } from './payment-events.repository.js';
import { SYNC_LEASE_MS, SubscriptionsService } from './subscriptions.service.js';
import type { SubscriptionsRepository } from './subscriptions.repository.js';

const NOW = new Date('2026-03-01T12:00:00.000Z');
const BUYER = '64b7f0000000000000000b01';
const OFFICE = '64b7f0000000000000000c01';

const PLAN_5 = aPlan({
  id: '64b7f0000000000000000a05',
  code: 'escritorio-5',
  activeJourneyLimit: 5,
  stripePriceId: 'price_5',
});
const PLAN_2 = aPlan({
  id: '64b7f0000000000000000a02',
  code: 'escritorio-2',
  price: new Decimal('99.90'),
  activeJourneyLimit: 2,
  stripePriceId: 'price_2',
});
const PLAN_OLD = aPlan({
  id: '64b7f0000000000000000a09',
  code: 'escritorio-antigo',
  activeJourneyLimit: 3,
  stripePriceId: 'price_old',
  status: 'WITHDRAWN',
});

const completed = (id: string, ref: string, subscriptionId = 'sub_1'): PaymentEvent => ({
  id,
  type: 'checkout.completed',
  subscriptionId,
  subscriptionRef: ref,
});
const changed = (id: string, subscriptionId = 'sub_1'): PaymentEvent => ({
  id,
  type: 'subscription.changed',
  subscriptionId,
});

function build() {
  const clock = new FakeClock(NOW);
  const gateway = new FakePaymentGateway();
  const subscriptions = new FakeSubscriptionsRepository();
  const ledger = new FakePaymentEventsRepository();
  const plans = new InMemoryPlans([PLAN_5, PLAN_2, PLAN_OLD]);
  const provisioner = new FakeOfficeProvisioner();
  const notifier = new FakePaymentFailedNotifier();
  const service = new SubscriptionsService(
    subscriptions as unknown as SubscriptionsRepository,
    ledger as unknown as PaymentEventsRepository,
    plans as unknown as PlansService,
    gateway,
    clock,
    provisioner,
    notifier,
    testBusinessConfig(),
  );

  /** A checkout started: the PENDING subscription (BR-012-09) on the 5-journey plan. */
  const startCheckout = (officeId?: string) =>
    subscriptions.createPending({
      buyerUserId: BUYER,
      planId: PLAN_5.id,
      planCode: PLAN_5.code,
      activeJourneyLimit: PLAN_5.activeJourneyLimit,
      checkoutSessionId: 'cs_1',
      ...(officeId === undefined ? {} : { officeId }),
    });
  /** The provider holds the subscription of this ref as it currently is. */
  const providerHas = (ref: string, overrides: Parameters<typeof aProviderSubscription>[0] = {}) =>
    gateway.setSubscription(
      aProviderSubscription({
        id: 'sub_1',
        subscriptionRef: ref,
        priceId: 'price_5',
        ...overrides,
      }),
    );
  return {
    clock,
    gateway,
    subscriptions,
    ledger,
    plans,
    provisioner,
    notifier,
    service,
    startCheckout,
    providerHas,
  };
}

type Harness = ReturnType<typeof build>;

describe('SubscriptionsService (SPEC-012 webhook)', () => {
  let t: Harness;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    t = build();
    warn = vi.spyOn(Logger.prototype, 'warn');
    warn.mockClear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('BR-012-09, BR-012-07: payment confirmed by the provider', () => {
    it('BR-012-09: nothing is granted until the provider confirms: a pending checkout limits to 0', async () => {
      const pending = await t.startCheckout();

      expect(effectiveJourneyLimit(t.subscriptions.get(pending.id))).toBe(0);
      expect(t.subscriptions.get(pending.id).status).toBe('PENDING');
    });

    it('BR-012-07: the confirmation activates the subscription, creates the office and attaches it', async () => {
      const pending = await t.startCheckout();
      t.providerHas(pending.id);

      await t.service.handleProviderEvent(completed('evt_1', pending.id));

      const stored = t.subscriptions.get(pending.id);
      expect(stored).toMatchObject({
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_1',
        stripeCustomerId: 'cus_test_1',
        activeJourneyLimit: 5,
        firstPaidAt: new Date('2026-01-10T12:00:05.000Z'),
        syncLeaseToken: null,
      });
      expect(stored.officeId).toBe(t.provisioner.offices.get(pending.id));
      expect(stored.provisionedAt).toEqual(NOW);
      expect(t.provisioner.calls).toEqual([{ subscriptionRef: pending.id, accountId: BUYER }]);
      expect(effectiveJourneyLimit(stored)).toBe(5);
    });

    it('BR-012-13: what is stored is read from the provider, never taken from the event', async () => {
      const pending = await t.startCheckout();
      t.providerHas(pending.id);

      await t.service.handleProviderEvent(completed('evt_1', pending.id));

      expect(t.gateway.retrievals).toEqual(
        ['sub_1', 'sub_1'.replace('sub_1', 'sub_1')].slice(0, 1),
      );
    });

    it('does not create an office for a renewal of an office that has one', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id);

      await t.service.handleProviderEvent(completed('evt_1', pending.id));

      expect(t.provisioner.calls).toEqual([]);
      expect(t.subscriptions.get(pending.id)).toMatchObject({ officeId: OFFICE, status: 'ACTIVE' });
    });

    it('does not create an office for a subscription that is not in effect (paid, then ended)', async () => {
      const pending = await t.startCheckout();
      t.providerHas(pending.id, {
        status: 'canceled',
        endedAt: new Date('2026-02-20T00:00:00.000Z'),
      });

      await t.service.handleProviderEvent(completed('evt_1', pending.id));

      expect(t.provisioner.calls).toEqual([]);
      expect(t.subscriptions.get(pending.id)).toMatchObject({ status: 'LAPSED', officeId: null });
    });

    it('fails when the office cannot be created, leaving the event unprocessed for the provider to retry', async () => {
      const pending = await t.startCheckout();
      t.providerHas(pending.id);
      t.provisioner.failNext = true;

      await expect(t.service.handleProviderEvent(completed('evt_1', pending.id))).rejects.toThrow(
        'office store unreachable',
      );

      // The subscription is confirmed and active; the office is what is missing.
      expect(t.subscriptions.get(pending.id)).toMatchObject({ status: 'ACTIVE', officeId: null });
      expect(t.ledger.ledger.get('evt_1')?.processedAt).toBeUndefined();

      // The retry finishes the job: the office exists and the event is processed.
      await t.service.handleProviderEvent(completed('evt_1', pending.id));
      expect(t.subscriptions.get(pending.id).officeId).toBe(t.provisioner.offices.get(pending.id));
      expect(t.ledger.ledger.get('evt_1')?.processedAt).toEqual(NOW);
    });
  });

  describe('BR-012-13, SC-11: idempotency by event id', () => {
    it('AC: the same activation event delivered twice yields one office and one subscription', async () => {
      const pending = await t.startCheckout();
      t.providerHas(pending.id);

      await t.service.handleProviderEvent(completed('evt_1', pending.id));
      await t.service.handleProviderEvent(completed('evt_1', pending.id));

      expect(t.subscriptions.rows.size).toBe(1);
      expect(t.provisioner.offices.size).toBe(1);
      expect(t.provisioner.calls).toHaveLength(1);
      // The second delivery stopped at the ledger: the provider was read once.
      expect(t.gateway.retrievals).toEqual(['sub_1']);
      expect(t.ledger.ledger.get('evt_1')?.processedAt).toEqual(NOW);
    });

    it('BR-012-13: a delivery already processed is acknowledged and changes nothing', async () => {
      const pending = await t.startCheckout();
      t.providerHas(pending.id);
      await t.service.handleProviderEvent(completed('evt_1', pending.id));
      const before = t.subscriptions.get(pending.id);
      t.gateway.retrievals.length = 0;
      // The provider moved on; a replay of the old event must not be what moves our record.
      t.providerHas(pending.id, { status: 'past_due' });

      await t.service.handleProviderEvent(completed('evt_1', pending.id));

      expect(t.gateway.retrievals).toEqual([]);
      expect(t.subscriptions.get(pending.id)).toEqual(before);
    });

    it('BR-012-13: an event whose delivery crashed before processedAt is handled again', async () => {
      const pending = await t.startCheckout();
      t.providerHas(pending.id);
      // The crashed delivery recorded the event and died: no processedAt.
      await t.ledger.record('evt_1', 'checkout.completed', NOW);

      await t.service.handleProviderEvent(completed('evt_1', pending.id));

      expect(t.subscriptions.get(pending.id).status).toBe('ACTIVE');
      expect(t.provisioner.offices.size).toBe(1);
      expect(t.ledger.ledger.get('evt_1')?.processedAt).toEqual(NOW);
    });

    it('records processedAt only after the event was handled in full', async () => {
      const pending = await t.startCheckout();
      t.providerHas(pending.id);
      t.gateway.onRetrieve = () => {
        throw new Error('provider unreachable');
      };

      await expect(t.service.handleProviderEvent(completed('evt_1', pending.id))).rejects.toThrow(
        'provider unreachable',
      );

      expect(t.ledger.ledger.get('evt_1')?.processedAt).toBeUndefined();
      expect(t.subscriptions.get(pending.id).syncLeaseToken).toBeNull(); // the lease is given back
    });

    it('acknowledges an event it does not act on without recording it', async () => {
      await t.service.handleProviderEvent({
        id: 'evt_9',
        type: 'unhandled',
        providerType: 'charge.refunded',
      });

      expect(t.ledger.ledger.size).toBe(0);
      expect(t.gateway.retrievals).toEqual([]);
    });
  });

  describe('BR-012-13: order independence', () => {
    it('AC: "deleted" processed before an earlier "updated" ends in the provider current state', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id);
      await t.service.handleProviderEvent(completed('evt_1', pending.id));
      // The provider's truth now: the subscription ended. Its events arrive in the wrong order:
      // "deleted" (the later one) first, then the stale "updated".
      const endedAt = new Date('2026-02-28T09:00:00.000Z');
      t.providerHas(pending.id, { status: 'canceled', endedAt });

      await t.service.handleProviderEvent(changed('evt_deleted'));
      await t.service.handleProviderEvent(changed('evt_updated_earlier'));

      const stored = t.subscriptions.get(pending.id);
      expect(stored.status).toBe('LAPSED');
      // The grace clock started at the first sight of the end and was not restarted by the replay.
      expect(stored.lapsedAt).toEqual(endedAt);
      expect(effectiveJourneyLimit(stored)).toBe(0);
    });

    it('a stale "updated" processed after a newer one cannot bring the old state back', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id);
      await t.service.handleProviderEvent(completed('evt_1', pending.id));

      t.providerHas(pending.id, { cancelAtPeriodEnd: true });
      await t.service.handleProviderEvent(changed('evt_newer'));
      // The stale event's payload said "active, renewing"; the provider is read again instead.
      await t.service.handleProviderEvent(changed('evt_stale'));

      expect(t.subscriptions.get(pending.id)).toMatchObject({
        status: 'CANCELING',
        cancelAtPeriodEnd: true,
      });
    });

    it('an event that arrives before checkout.session.completed finds the record by the ref the provider holds', async () => {
      const pending = await t.startCheckout();
      t.providerHas(pending.id);

      // `customer.subscription.created` first: our record has no provider id yet.
      await t.service.handleProviderEvent(changed('evt_created'));
      expect(t.subscriptions.get(pending.id)).toMatchObject({
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_1',
      });

      // The checkout event then finds it by the provider id, and nothing is duplicated.
      await t.service.handleProviderEvent(completed('evt_completed', pending.id));
      expect(t.subscriptions.rows.size).toBe(1);
      expect(t.provisioner.offices.size).toBe(1);
    });

    it('finds the record by the ref of the checkout event when the provider holds none', async () => {
      const pending = await t.startCheckout();
      t.providerHas(pending.id, { subscriptionRef: null });

      await t.service.handleProviderEvent(completed('evt_1', pending.id));

      expect(t.subscriptions.get(pending.id).status).toBe('ACTIVE');
    });

    it('BR-012-20: a recovered payment returns a past_due subscription to active', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id, { status: 'past_due' });
      await t.service.handleProviderEvent(changed('evt_1'));
      expect(t.subscriptions.get(pending.id).status).toBe('PAST_DUE');
      expect(effectiveJourneyLimit(t.subscriptions.get(pending.id))).toBe(5);

      t.providerHas(pending.id, { status: 'active' });
      await t.service.handleProviderEvent({
        id: 'evt_2',
        type: 'invoice.paid',
        subscriptionId: 'sub_1',
      });

      expect(t.subscriptions.get(pending.id).status).toBe('ACTIVE');
    });
  });

  describe('BR-012-13: the per-subscription sync lease', () => {
    it('AC: concurrent syncs are serialised: the second gets WEBHOOK_BUSY while the first reads the provider', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id);
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      t.gateway.onRetrieve = () => held;

      const first = t.service.handleProviderEvent(completed('evt_1', pending.id));
      await vi.waitFor(() => expect(t.gateway.retrievals).toContain('sub_1'));

      // The first holds the lease and is inside its retrieve; the second cannot sync.
      t.gateway.onRetrieve = undefined;
      await expect(t.service.handleProviderEvent(changed('evt_2'))).rejects.toEqual(
        new DomainError('WEBHOOK_BUSY'),
      );
      // It is left unprocessed, so the provider delivers it again.
      expect(t.ledger.ledger.get('evt_2')?.processedAt).toBeUndefined();

      release();
      await first;
      expect(t.subscriptions.get(pending.id).status).toBe('ACTIVE');

      // The lease is free again: the redelivery succeeds.
      await t.service.handleProviderEvent(changed('evt_2'));
      expect(t.ledger.ledger.get('evt_2')?.processedAt).toEqual(NOW);
    });

    it('takes a lease that expired (a crashed holder cannot block a subscription forever)', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id);
      await t.subscriptions.acquireSyncLease(
        pending.id,
        'crashed',
        NOW,
        new Date(NOW.getTime() + SYNC_LEASE_MS),
      );

      await expect(t.service.handleProviderEvent(changed('evt_1'))).rejects.toEqual(
        new DomainError('WEBHOOK_BUSY'),
      );

      t.clock.advance(SYNC_LEASE_MS); // the lease ends at its `until`
      await t.service.handleProviderEvent(changed('evt_1'));
      expect(t.subscriptions.get(pending.id).status).toBe('ACTIVE');
    });

    it('a sync whose lease was lost while it read the provider writes nothing (WEBHOOK_BUSY)', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id);
      t.gateway.onRetrieve = () => {
        // The lease expired during a slow read and another sync took it.
        const row = t.subscriptions.rows.get(pending.id);
        if (row) row.syncLeaseToken = 'someone-else';
      };

      await expect(t.service.handleProviderEvent(changed('evt_1'))).rejects.toEqual(
        new DomainError('WEBHOOK_BUSY'),
      );

      expect(t.subscriptions.get(pending.id)).toMatchObject({
        status: 'PENDING',
        syncLeaseToken: 'someone-else', // not released by the loser
      });
    });

    it('reads the provider inside the lease: the lease is held while the retrieve runs', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id);
      let tokenDuringRetrieve: string | null = null;
      t.gateway.onRetrieve = () => {
        tokenDuringRetrieve = t.subscriptions.get(pending.id).syncLeaseToken;
      };

      await t.service.handleProviderEvent(changed('evt_1'));

      expect(tokenDuringRetrieve).not.toBeNull();
      expect(t.subscriptions.get(pending.id).syncLeaseToken).toBeNull();
    });
  });

  describe('BR-012-08: never two subscriptions in effect for one office', () => {
    it('AC: a second paid checkout for an office is cancelled at the provider and lapsed; the first stays', async () => {
      const first = await t.startCheckout(OFFICE);
      t.providerHas(first.id);
      await t.service.handleProviderEvent(completed('evt_1', first.id));

      const second = await t.startCheckout(OFFICE);
      t.gateway.setSubscription(
        aProviderSubscription({
          id: 'sub_2',
          subscriptionRef: second.id,
          priceId: 'price_5',
          customerId: 'cus_2',
        }),
      );
      await t.service.handleProviderEvent(completed('evt_2', second.id, 'sub_2'));

      expect(t.gateway.cancelledSubscriptions).toEqual(['sub_2']);
      expect(t.subscriptions.get(second.id)).toMatchObject({
        status: 'LAPSED',
        stripeSubscriptionId: 'sub_2',
      });
      expect(t.subscriptions.get(first.id).status).toBe('ACTIVE');
      expect(t.ledger.ledger.get('evt_2')?.processedAt).toEqual(NOW);
      // SC-15: the warning names ids only, so the operator can refund it by hand.
      const message = warn.mock.calls.map((call: unknown[]) => String(call[0])).join('\n');
      expect(message).toContain(second.id);
      expect(message).not.toMatch(/@|cus_2/);
    });

    it('a replay of the duplicate event finds it already lapsed and changes nothing more', async () => {
      const first = await t.startCheckout(OFFICE);
      t.providerHas(first.id);
      await t.service.handleProviderEvent(completed('evt_1', first.id));
      const second = await t.startCheckout(OFFICE);
      t.gateway.setSubscription(
        aProviderSubscription({ id: 'sub_2', subscriptionRef: second.id, priceId: 'price_5' }),
      );
      await t.service.handleProviderEvent(completed('evt_2', second.id, 'sub_2'));
      const lapsed = t.subscriptions.get(second.id);

      await t.service.handleProviderEvent(changed('evt_3', 'sub_2'));

      expect(t.subscriptions.get(second.id)).toEqual({ ...lapsed, lastSyncedAt: NOW });
      expect(t.gateway.cancelledSubscriptions).toEqual(['sub_2']);
    });

    it('stops (a fault, retried and reported) when the provider does not end the duplicate', async () => {
      const first = await t.startCheckout(OFFICE);
      t.providerHas(first.id);
      await t.service.handleProviderEvent(completed('evt_1', first.id));
      const second = await t.startCheckout(OFFICE);
      t.gateway.setSubscription(
        aProviderSubscription({ id: 'sub_2', subscriptionRef: second.id, priceId: 'price_5' }),
      );
      // The provider keeps answering "active" after the cancel call.
      t.gateway.cancelSubscription = () => Promise.resolve();

      await expect(
        t.service.handleProviderEvent(completed('evt_2', second.id, 'sub_2')),
      ).rejects.toThrow('could not be cancelled');
      expect(t.subscriptions.get(first.id).status).toBe('ACTIVE');
      expect(t.subscriptions.get(second.id).syncLeaseToken).toBeNull();
    });

    it('cancels the duplicate when the office the provisioner returned already has one in effect', async () => {
      const first = await t.startCheckout(OFFICE);
      t.providerHas(first.id);
      await t.service.handleProviderEvent(completed('evt_1', first.id));
      // A misbehaving provisioner hands back the office that already has a subscription in effect.
      const second = await t.startCheckout();
      t.gateway.setSubscription(
        aProviderSubscription({ id: 'sub_2', subscriptionRef: second.id, priceId: 'price_5' }),
      );
      t.provisioner.offices.set(second.id, OFFICE);

      await t.service.handleProviderEvent(completed('evt_2', second.id, 'sub_2'));

      expect(t.gateway.cancelledSubscriptions).toEqual(['sub_2']);
      expect(t.subscriptions.get(second.id)).toMatchObject({ status: 'LAPSED', officeId: null });
      expect(t.subscriptions.get(first.id).status).toBe('ACTIVE');
    });

    it('two deliveries racing to provision keep the first office', async () => {
      const pending = await t.startCheckout();
      t.providerHas(pending.id);
      // Another delivery attached the office between the first one's sync and its attach.
      const originalAttach = t.subscriptions.attachOffice.bind(t.subscriptions);
      t.subscriptions.attachOffice = async (id, officeId, now) => {
        await originalAttach(id, OFFICE, now);
        return originalAttach(id, officeId, now);
      };

      await t.service.handleProviderEvent(completed('evt_1', pending.id));

      expect(t.subscriptions.get(pending.id).officeId).toBe(OFFICE);
    });
  });

  describe('AC: an abandoned checkout leaves nothing', () => {
    it('checkout.expired removes the pending subscription that never got a provider subscription', async () => {
      const pending = await t.startCheckout();

      await t.service.handleProviderEvent({
        id: 'evt_1',
        type: 'checkout.expired',
        subscriptionRef: pending.id,
      });

      expect(t.subscriptions.rows.size).toBe(0);
      expect(t.provisioner.calls).toEqual([]);
      expect(t.ledger.ledger.get('evt_1')?.processedAt).toEqual(NOW);
    });

    it('is safe to repeat and to receive for a record that is gone', async () => {
      const pending = await t.startCheckout();
      const expired: PaymentEvent = {
        id: 'evt_1',
        type: 'checkout.expired',
        subscriptionRef: pending.id,
      };

      await t.service.handleProviderEvent(expired);
      await t.service.handleProviderEvent({ ...expired, id: 'evt_2' });

      expect(t.subscriptions.rows.size).toBe(0);
    });

    it('never removes a subscription the provider confirmed', async () => {
      const pending = await t.startCheckout();
      t.providerHas(pending.id);
      await t.service.handleProviderEvent(completed('evt_1', pending.id));

      await t.service.handleProviderEvent({
        id: 'evt_2',
        type: 'checkout.expired',
        subscriptionRef: pending.id,
      });

      expect(t.subscriptions.get(pending.id).status).toBe('ACTIVE');
    });
  });

  describe('legacy user-level events (production has no real subscribers)', () => {
    it('AC: a checkout event without our ref is acknowledged and ignored with a warning', async () => {
      await t.service.handleProviderEvent({
        id: 'evt_1',
        type: 'checkout.completed',
        subscriptionId: 'sub_legacy',
        subscriptionRef: null,
      });

      expect(t.gateway.retrievals).toEqual([]);
      expect(t.subscriptions.rows.size).toBe(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Legacy user-level'));
      expect(t.ledger.ledger.get('evt_1')?.processedAt).toEqual(NOW);
    });

    it('a checkout completed without a provider subscription is ignored too', async () => {
      await t.service.handleProviderEvent({
        id: 'evt_1',
        type: 'checkout.completed',
        subscriptionId: null,
        subscriptionRef: 'whatever',
      });

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Legacy user-level'));
    });

    it('an expired checkout without our ref is ignored', async () => {
      await t.service.handleProviderEvent({
        id: 'evt_1',
        type: 'checkout.expired',
        subscriptionRef: null,
      });

      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Legacy user-level'));
    });

    it('a subscription event for a provider subscription none of our records owns is ignored', async () => {
      t.gateway.setSubscription(aProviderSubscription({ id: 'sub_legacy', subscriptionRef: null }));

      await t.service.handleProviderEvent(changed('evt_1', 'sub_legacy'));

      expect(t.subscriptions.rows.size).toBe(0);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('Legacy user-level'));
      expect(t.ledger.ledger.get('evt_1')?.processedAt).toEqual(NOW);
    });

    it('a provider ref that names no record of ours is ignored the same way', async () => {
      t.gateway.setSubscription(
        aProviderSubscription({ id: 'sub_x', subscriptionRef: '64b7f00000000000000000ff' }),
      );

      await t.service.handleProviderEvent(changed('evt_1', 'sub_x'));

      expect(t.subscriptions.rows.size).toBe(0);
    });

    it('an invoice that belongs to no subscription says nothing', async () => {
      await t.service.handleProviderEvent({
        id: 'evt_1',
        type: 'invoice.paid',
        subscriptionId: null,
      });
      await t.service.handleProviderEvent({
        id: 'evt_2',
        type: 'invoice.payment_failed',
        subscriptionId: null,
      });

      expect(t.gateway.retrievals).toEqual([]);
      expect(t.ledger.ledger.get('evt_2')?.processedAt).toEqual(NOW);
    });
  });

  describe('a record only syncs with its own provider subscription', () => {
    it('ignores a provider subscription whose ref names another record', async () => {
      const pending = await t.startCheckout();
      const other = await t.startCheckout();
      t.providerHas(other.id);

      // The event hints at `pending`, but the provider subscription belongs to `other`.
      await t.service.handleProviderEvent(completed('evt_1', pending.id));

      expect(t.subscriptions.get(pending.id)).toMatchObject({
        status: 'PENDING',
        stripeSubscriptionId: null,
      });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('does not belong'));
      expect(t.subscriptions.get(pending.id).syncLeaseToken).toBeNull();
    });

    it('ignores a provider subscription other than the one the record already owns', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id);
      await t.service.handleProviderEvent(completed('evt_1', pending.id));
      t.gateway.setSubscription(
        aProviderSubscription({ id: 'sub_other', subscriptionRef: pending.id, status: 'canceled' }),
      );

      await t.service.handleProviderEvent(completed('evt_2', pending.id, 'sub_other'));

      expect(t.subscriptions.get(pending.id)).toMatchObject({
        status: 'ACTIVE',
        stripeSubscriptionId: 'sub_1',
      });
    });
  });

  describe('BR-012-16, BR-012-17, BR-012-04: the plan follows the price the provider bills', () => {
    it('BR-012-16: an upgrade reaches the limit only when the provider bills the new price', async () => {
      const pending = await t.startCheckout(OFFICE);
      // On the 2-journey plan.
      await t.subscriptions.writeSync(
        pending.id,
        (
          await t.subscriptions.acquireSyncLease(
            pending.id,
            'seed',
            NOW,
            new Date(NOW.getTime() + 1000),
          )
        )?.syncLeaseToken ?? '',
        {
          status: 'ACTIVE',
          stripeSubscriptionId: 'sub_1',
          stripeCustomerId: 'cus_test_1',
          cancelAtPeriodEnd: false,
          currentPeriodStart: null,
          currentPeriodEnd: null,
          plan: { id: PLAN_2.id, code: PLAN_2.code, activeJourneyLimit: 2 },
          scheduledPlanId: null,
          scheduledChangeAt: null,
          firstPaidAt: NOW,
          lapsedAt: null,
          readOnlyAt: null,
          lastSyncedAt: NOW,
        },
      );

      // Proration unpaid: the provider still bills price_2 (pending_if_incomplete).
      t.providerHas(pending.id, { priceId: 'price_2' });
      await t.service.handleProviderEvent(changed('evt_1'));
      expect(t.subscriptions.get(pending.id)).toMatchObject({
        planCode: 'escritorio-2',
        activeJourneyLimit: 2,
      });

      // Proration paid: the provider now bills price_5.
      t.providerHas(pending.id, { priceId: 'price_5' });
      await t.service.handleProviderEvent(changed('evt_2'));
      expect(t.subscriptions.get(pending.id)).toMatchObject({
        planId: PLAN_5.id,
        planCode: 'escritorio-5',
        activeJourneyLimit: 5,
      });
    });

    it('BR-012-17: a downgrade is scheduled and the limit stays until the period ends', async () => {
      const pending = await t.startCheckout(OFFICE);
      const periodEnd = new Date('2026-04-01T09:00:00.000Z');
      t.providerHas(pending.id, {
        scheduledPriceId: 'price_2',
        scheduledChangeAt: periodEnd,
      });

      await t.service.handleProviderEvent(changed('evt_1'));

      expect(t.subscriptions.get(pending.id)).toMatchObject({
        planCode: 'escritorio-5',
        activeJourneyLimit: 5,
        scheduledPlanId: PLAN_2.id,
        scheduledChangeAt: periodEnd,
      });

      // The period turns over: the provider bills price_2 now and the schedule is gone.
      t.providerHas(pending.id, { priceId: 'price_2' });
      await t.service.handleProviderEvent(changed('evt_2'));
      expect(t.subscriptions.get(pending.id)).toMatchObject({
        planCode: 'escritorio-2',
        activeJourneyLimit: 2,
        scheduledPlanId: null,
        scheduledChangeAt: null,
      });
    });

    it('BR-012-04: a subscription on a withdrawn plan keeps it (the withdrawn plan resolves)', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id, { priceId: 'price_old' });

      await t.service.handleProviderEvent(changed('evt_1'));

      expect(t.subscriptions.get(pending.id)).toMatchObject({
        planId: PLAN_OLD.id,
        planCode: 'escritorio-antigo',
        activeJourneyLimit: 3,
      });
    });

    it('a price no plan maps to changes neither the plan nor the limit, and says so by id', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id, {
        priceId: 'price_unknown',
        scheduledPriceId: 'price_next',
        scheduledChangeAt: NOW,
      });

      await t.service.handleProviderEvent(changed('evt_1'));

      expect(t.subscriptions.get(pending.id)).toMatchObject({
        planCode: 'escritorio-5',
        activeJourneyLimit: 5,
        scheduledPlanId: null,
        status: 'ACTIVE',
      });
      const messages = warn.mock.calls.map((call: unknown[]) => String(call[0]));
      expect(messages.some((m: string) => m.includes('price_unknown'))).toBe(true);
      expect(messages.some((m: string) => m.includes('price_next'))).toBe(true);
    });

    it('a record whose plan no longer exists takes the plan the provider bills', async () => {
      const pending = await t.subscriptions.createPending({
        buyerUserId: BUYER,
        planId: '64b7f0000000000000000aff',
        planCode: 'gone',
        activeJourneyLimit: 9,
        officeId: OFFICE,
      });
      t.providerHas(pending.id, { priceId: 'price_5' });

      await t.service.handleProviderEvent(changed('evt_1'));

      expect(t.subscriptions.get(pending.id)).toMatchObject({
        planId: PLAN_5.id,
        activeJourneyLimit: 5,
      });
    });
  });

  describe('BR-012-19, BR-012-21: cancel, undo and lapse', () => {
    it('BR-012-19: cancelling at the period end is CANCELING, still in effect; undoing returns to ACTIVE', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id, { cancelAtPeriodEnd: true });
      await t.service.handleProviderEvent(changed('evt_1'));
      expect(t.subscriptions.get(pending.id).status).toBe('CANCELING');
      expect(effectiveJourneyLimit(t.subscriptions.get(pending.id))).toBe(5);

      t.providerHas(pending.id, { cancelAtPeriodEnd: false });
      await t.service.handleProviderEvent(changed('evt_2'));

      expect(t.subscriptions.get(pending.id)).toMatchObject({
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
      });
    });

    it('BR-012-21: when the provider ends it the limit is 0 at once and the grace period starts', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id, { cancelAtPeriodEnd: true });
      await t.service.handleProviderEvent(changed('evt_1'));
      const endedAt = new Date('2026-02-27T09:00:00.000Z');
      t.providerHas(pending.id, { status: 'canceled', cancelAtPeriodEnd: true, endedAt });

      await t.service.handleProviderEvent(changed('evt_2'));

      const stored = t.subscriptions.get(pending.id);
      expect(stored.status).toBe('LAPSED');
      expect(effectiveJourneyLimit(stored)).toBe(0);
      expect(stored.lapsedAt).toEqual(endedAt);
      // 10 days of grace (SUBSCRIPTION_GRACE_DAYS): 2026-02-27T09:00Z + 10 d.
      expect(stored.readOnlyAt).toEqual(new Date('2026-03-09T09:00:00.000Z'));
    });

    it('BR-012-28: subscribing again clears the lapse and the read-only date at once', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id, { status: 'unpaid' });
      await t.service.handleProviderEvent(changed('evt_1'));
      expect(t.subscriptions.get(pending.id)).toMatchObject({ status: 'LAPSED', lapsedAt: NOW });

      t.providerHas(pending.id, { status: 'active' });
      await t.service.handleProviderEvent(changed('evt_2'));

      expect(t.subscriptions.get(pending.id)).toMatchObject({
        status: 'ACTIVE',
        lapsedAt: null,
        readOnlyAt: null,
      });
    });

    it('the grace period is the setting: 3 days', async () => {
      const custom = new SubscriptionsService(
        t.subscriptions as unknown as SubscriptionsRepository,
        t.ledger as unknown as PaymentEventsRepository,
        t.plans as unknown as PlansService,
        t.gateway,
        t.clock,
        t.provisioner,
        t.notifier,
        testBusinessConfig({ SUBSCRIPTION_GRACE_DAYS: '3' }),
      );
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id, { status: 'unpaid' });

      await custom.handleProviderEvent(changed('evt_1'));

      expect(t.subscriptions.get(pending.id).readOnlyAt).toEqual(new Date(NOW.getTime() + 3 * DAY));
    });
  });

  describe('BR-012-20: a failed renewal tells the office once', () => {
    const failed = (id: string): PaymentEvent => ({
      id,
      type: 'invoice.payment_failed',
      subscriptionId: 'sub_1',
    });

    it('moves to PAST_DUE (still in effect) and notifies the office', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id, { status: 'past_due' });

      await t.service.handleProviderEvent(failed('evt_1'));

      expect(t.subscriptions.get(pending.id).status).toBe('PAST_DUE');
      expect(effectiveJourneyLimit(t.subscriptions.get(pending.id))).toBe(5);
      expect(t.notifier.notified).toEqual([OFFICE]);
    });

    it('a replay of the same event sends nothing more', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id, { status: 'past_due' });

      await t.service.handleProviderEvent(failed('evt_1'));
      await t.service.handleProviderEvent(failed('evt_1'));

      expect(t.notifier.notified).toEqual([OFFICE]);
    });

    it('a crashed delivery (never processed) that already claimed the email does not send it twice', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id, { status: 'past_due' });
      await t.ledger.record('evt_1', 'invoice.payment_failed', NOW);
      await t.ledger.claimEmail('evt_1', NOW); // it claimed, then died

      await t.service.handleProviderEvent(failed('evt_1'));

      expect(t.notifier.notified).toEqual([]);
      expect(t.ledger.ledger.get('evt_1')?.processedAt).toEqual(NOW);
    });

    it('a send that fails gives the claim back, so the provider retry sends it', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id, { status: 'past_due' });
      t.notifier.failNext = true;

      await expect(t.service.handleProviderEvent(failed('evt_1'))).rejects.toThrow('mail server');
      expect(t.ledger.ledger.get('evt_1')?.emailClaimedAt).toBeUndefined();
      expect(t.ledger.ledger.get('evt_1')?.processedAt).toBeUndefined();

      await t.service.handleProviderEvent(failed('evt_1'));
      expect(t.notifier.notified).toEqual([OFFICE]);
    });

    it('each failed attempt is its own event and is told', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id, { status: 'past_due' });

      await t.service.handleProviderEvent(failed('evt_1'));
      await t.service.handleProviderEvent(failed('evt_2'));

      expect(t.notifier.notified).toEqual([OFFICE, OFFICE]);
    });

    it('does not notify when the provider is not retrying a failed renewal (state is read, not trusted)', async () => {
      const pending = await t.startCheckout(OFFICE);
      t.providerHas(pending.id, { status: 'active' });

      await t.service.handleProviderEvent(failed('evt_1'));

      expect(t.notifier.notified).toEqual([]);
    });

    it('a subscription that reaches PAST_DUE with no office yet gets its office first, then the office is told', async () => {
      const pending = await t.startCheckout();
      t.providerHas(pending.id, { status: 'past_due' });

      await t.service.handleProviderEvent(failed('evt_1'));

      const officeId = t.provisioner.offices.get(pending.id);
      expect(t.notifier.notified).toEqual([officeId]);
    });
  });

  describe('SC-11: the webhook entry point', () => {
    it('refuses a body whose signature does not verify, logging the cause by code only', async () => {
      const error = vi.spyOn(Logger.prototype, 'error');
      t.gateway.nextWebhookEvent = Object.assign(
        new Error('No signatures found matching 4111-secret'),
        {
          code: 'signature_failed',
        },
      );

      await expect(t.service.handleWebhook(Buffer.from('{}'), 'sig')).rejects.toEqual(
        new DomainError('INVALID_WEBHOOK_SIGNATURE'),
      );

      expect(t.ledger.ledger.size).toBe(0);
      expect(String(error.mock.calls[error.mock.calls.length - 1]?.[0])).toContain(
        'signature_failed',
      );
      expect(String(error.mock.calls[error.mock.calls.length - 1]?.[0])).not.toContain(
        '4111-secret',
      );
    });

    it('handles the verified event', async () => {
      const pending = await t.startCheckout();
      t.providerHas(pending.id);
      t.gateway.nextWebhookEvent = completed('evt_1', pending.id);

      await t.service.handleWebhook(Buffer.from('{}'), 'sig');

      expect(t.subscriptions.get(pending.id).status).toBe('ACTIVE');
    });
  });
});
