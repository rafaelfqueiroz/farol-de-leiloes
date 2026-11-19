// SPEC-012 BR-012-21..BR-012-25, BR-012-27: the office's active-journey slots, against fakes of the
// subscription store and the counters (TS-03). The conditional update under real concurrency (20
// reserves with one free slot) is test/integration/journey-slots.spec.ts (TS-02).
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessContext, ActingOwner } from '../access/access-context.js';
import type { OwnerCounterRepository } from '../access/owner-counter.repository.js';
import type { OfficePlanState } from '../access/sources/office-plan.source.js';
import { anAccessContext } from '../../test/fakes/fake-access-sources.js';
import { FakeOwnerCounters } from '../../test/fakes/fake-owner-counters.js';
import { spyOnLogger } from '../../test/support/logger-spy.js';
import { FakeSubscriptionsRepository } from '../../test/fakes/fake-subscriptions-repository.js';
import type { SubscriptionStatus } from './domain/subscription-status.js';
import { ACTIVE_JOURNEYS_KEY, JourneySlotsService } from './journey-slots.service.js';
import type { SubscriptionsRepository } from './subscriptions.repository.js';

const OFFICE = '64b7f0000000000000000c01';
const MEMBER = '64b7f0000000000000000b01';
const PLAN = '64b7f0000000000000000a05';
const WRITABLE: OfficePlanState = { advisorPlanActive: true, readOnly: false, entitlements: [] };
const READ_ONLY: OfficePlanState = { ...WRITABLE, readOnly: true };

function build() {
  const subscriptions = new FakeSubscriptionsRepository();
  const counters = new FakeOwnerCounters();
  const slots = new JourneySlotsService(
    subscriptions as unknown as SubscriptionsRepository,
    counters as unknown as OwnerCounterRepository,
  );

  /** A subscription of the office in this status, with this limit copy. */
  async function subscriptionOf(status: SubscriptionStatus, limit: number): Promise<string> {
    const created = await subscriptions.createPending({
      buyerUserId: MEMBER,
      planId: PLAN,
      planCode: 'escritorio',
      activeJourneyLimit: limit,
      officeId: OFFICE,
    });
    const row = subscriptions.rows.get(created.id);
    if (row) row.status = status;
    return created.id;
  }

  const member = (plan: OfficePlanState = WRITABLE): Promise<AccessContext> =>
    anAccessContext(MEMBER, {
      memberships: [{ officeId: OFFICE }],
      officePlans: { [OFFICE]: plan },
    });
  const actingOf = (ctx: AccessContext): ActingOwner => ctx.resolveActingOwner();

  return { subscriptions, counters, slots, subscriptionOf, member, actingOf };
}

describe('JourneySlotsService (SPEC-012 BR-012-22..BR-012-25)', () => {
  let t: ReturnType<typeof build>;

  beforeEach(() => {
    t = build();
  });

  it('BR-012-23: a start below the limit takes a slot', async () => {
    await t.subscriptionOf('ACTIVE', 2);
    const ctx = await t.member();

    await t.slots.reserve(ctx, { actingOwner: t.actingOf(ctx) });
    await t.slots.reserve(ctx, { actingOwner: t.actingOf(ctx) });

    expect(t.counters.get(OFFICE, ACTIVE_JOURNEYS_KEY)).toBe(2);
  });

  it('BR-012-25: at the limit the start is refused with the counts only: "2 of 2"', async () => {
    await t.subscriptionOf('ACTIVE', 2);
    t.counters.set(OFFICE, ACTIVE_JOURNEYS_KEY, 2);
    const ctx = await t.member();

    await expect(t.slots.reserve(ctx, { actingOwner: t.actingOf(ctx) })).rejects.toMatchObject({
      code: 'JOURNEY_LIMIT_REACHED',
      context: { inProgress: 2, limit: 2 },
    });
    expect(t.counters.get(OFFICE, ACTIVE_JOURNEYS_KEY)).toBe(2);
  });

  it('BR-012-22: after one journey ends the next start succeeds', async () => {
    await t.subscriptionOf('ACTIVE', 2);
    t.counters.set(OFFICE, ACTIVE_JOURNEYS_KEY, 2);
    const ctx = await t.member();

    expect(await t.slots.release(ctx, { ownerType: 'office', ownerId: OFFICE })).toBe(true);
    await t.slots.reserve(ctx, { actingOwner: t.actingOf(ctx) });

    expect(t.counters.get(OFFICE, ACTIVE_JOURNEYS_KEY)).toBe(2);
  });

  it('BR-012-21: the limit is the subscription copy, read fresh: an upgrade is seen by the next start', async () => {
    const id = await t.subscriptionOf('ACTIVE', 2);
    t.counters.set(OFFICE, ACTIVE_JOURNEYS_KEY, 2);
    const ctx = await t.member();
    await expect(t.slots.reserve(ctx, { actingOwner: t.actingOf(ctx) })).rejects.toMatchObject({
      code: 'JOURNEY_LIMIT_REACHED',
    });

    const row = t.subscriptions.rows.get(id);
    if (row) row.activeJourneyLimit = 5; // the sync stored the paid upgrade
    await t.slots.reserve(ctx, { actingOwner: t.actingOf(ctx) });

    expect(t.counters.get(OFFICE, ACTIVE_JOURNEYS_KEY)).toBe(3);
  });

  it.each(['PAST_DUE', 'CANCELING'] as const)(
    'BR-012-19, BR-012-20: a %s subscription is in effect: starts continue within the limit',
    async (status) => {
      await t.subscriptionOf(status, 3);
      const ctx = await t.member();

      await t.slots.reserve(ctx, { actingOwner: t.actingOf(ctx) });

      expect(t.counters.get(OFFICE, ACTIVE_JOURNEYS_KEY)).toBe(1);
    },
  );

  it.each(['LAPSED', 'PENDING'] as const)(
    'BR-012-21: a %s subscription gives limit 0: no new journey, the count of those in progress untouched',
    async (status) => {
      await t.subscriptionOf(status, 5);
      t.counters.set(OFFICE, ACTIVE_JOURNEYS_KEY, 3);
      const ctx = await t.member();

      await expect(t.slots.reserve(ctx, { actingOwner: t.actingOf(ctx) })).rejects.toMatchObject({
        code: 'JOURNEY_LIMIT_REACHED',
        context: { inProgress: 3, limit: 0 },
      });
      expect(t.counters.get(OFFICE, ACTIVE_JOURNEYS_KEY)).toBe(3);
    },
  );

  it('BR-012-21: an office that never subscribed has limit 0', async () => {
    const ctx = await t.member();

    await expect(t.slots.reserve(ctx, { actingOwner: t.actingOf(ctx) })).rejects.toMatchObject({
      code: 'JOURNEY_LIMIT_REACHED',
      context: { inProgress: 0, limit: 0 },
    });
  });

  it('BR-012-18: a downgrade below the count blocks starts until the count drops below the new limit', async () => {
    await t.subscriptionOf('ACTIVE', 2); // the downgraded limit
    t.counters.set(OFFICE, ACTIVE_JOURNEYS_KEY, 4); // four journeys continue
    const ctx = await t.member();
    const attempt = () => t.slots.reserve(ctx, { actingOwner: t.actingOf(ctx) });
    const owner = { ownerType: 'office', ownerId: OFFICE } as const;

    await expect(attempt()).rejects.toMatchObject({ context: { inProgress: 4, limit: 2 } });
    await t.slots.release(ctx, owner); // 3
    await t.slots.release(ctx, owner); // 2
    await expect(attempt()).rejects.toMatchObject({ context: { inProgress: 2, limit: 2 } });
    await t.slots.release(ctx, owner); // 1: below the limit now
    await attempt();

    expect(t.counters.get(OFFICE, ACTIVE_JOURNEYS_KEY)).toBe(2);
  });

  it('D-41: a journey the conductor cancels frees its slot even after the office lapsed (inside the grace period)', async () => {
    await t.subscriptionOf('LAPSED', 5);
    t.counters.set(OFFICE, ACTIVE_JOURNEYS_KEY, 1);
    const ctx = await t.member(WRITABLE); // BR-012-21: grace period, still writable

    expect(await t.slots.release(ctx, { ownerType: 'office', ownerId: OFFICE })).toBe(true);

    expect(t.counters.get(OFFICE, ACTIVE_JOURNEYS_KEY)).toBe(0);
  });

  it('BR-012-28: a read-only office starts and releases nothing: OFFICE_READ_ONLY, not the limit message', async () => {
    await t.subscriptionOf('LAPSED', 5);
    const ctx = await t.member(READ_ONLY);

    await expect(t.slots.reserve(ctx, { actingOwner: t.actingOf(ctx) })).rejects.toMatchObject({
      code: 'OFFICE_READ_ONLY',
    });
    await expect(t.slots.release(ctx, { ownerType: 'office', ownerId: OFFICE })).rejects.toThrow(
      'A slot is released only for an owner the request may write to',
    );
  });

  it('BR-012-26: the in-progress count of a read-only office can still be read', async () => {
    await t.subscriptionOf('LAPSED', 5);
    t.counters.set(OFFICE, ACTIVE_JOURNEYS_KEY, 4);
    const ctx = await t.member(READ_ONLY);

    expect(await t.slots.inProgress(ctx, { actingOwner: t.actingOf(ctx) })).toBe(4);
  });

  it('creates the counter before a transaction starts (SPEC-016)', async () => {
    await t.subscriptionOf('ACTIVE', 2);
    const ctx = await t.member();

    await t.slots.ensureCounter(ctx, { actingOwner: t.actingOf(ctx) });

    expect(t.counters.get(OFFICE, ACTIVE_JOURNEYS_KEY)).toBe(0);
  });

  describe('F6: the system path, for endings no member of the office drives', () => {
    const owner = { ownerType: 'office', ownerId: OFFICE } as const;

    it('BR-012-22, D-13: a lost bid frees its slot with no AccessContext at all', async () => {
      await t.subscriptionOf('ACTIVE', 2);
      t.counters.set(OFFICE, ACTIVE_JOURNEYS_KEY, 2);

      expect(await t.slots.releaseForSystem(owner)).toBe(true);

      expect(t.counters.get(OFFICE, ACTIVE_JOURNEYS_KEY)).toBe(1);
    });

    it('BR-012-28: it frees the slot of a READ-ONLY, lapsed office too, where a member’s release is refused', async () => {
      await t.subscriptionOf('LAPSED', 5);
      t.counters.set(OFFICE, ACTIVE_JOURNEYS_KEY, 1);
      const ctx = await t.member(READ_ONLY);
      await expect(t.slots.release(ctx, owner)).rejects.toThrow('A slot is released only');

      expect(await t.slots.releaseForSystem(owner)).toBe(true);

      expect(t.counters.get(OFFICE, ACTIVE_JOURNEYS_KEY)).toBe(0);
    });

    it('never goes below zero, and takes the owner as the ended journey stores it (an ObjectId too)', async () => {
      t.counters.set(OFFICE, ACTIVE_JOURNEYS_KEY, 1);

      expect(await t.slots.releaseForSystem({ ownerType: 'office', ownerId: OFFICE })).toBe(true);
      expect(await t.slots.releaseForSystem(owner)).toBe(false);
      expect(t.counters.get(OFFICE, ACTIVE_JOURNEYS_KEY)).toBe(0);
    });

    it('BR-012-27: a self-advised owner is still a programming error on this path', async () => {
      await expect(
        t.slots.releaseForSystem({ ownerType: 'self_advised', ownerId: MEMBER }),
      ).rejects.toThrow(/BR-012-27/);
      await expect(
        t.slots.reconcileCount({ ownerType: 'self_advised', ownerId: MEMBER }, 1),
      ).rejects.toThrow(/BR-012-27/);
    });

    it('SPEC-016’s drift job: a counter that disagrees with the journeys really in progress is set to the truth, logging counts only', async () => {
      const logger = spyOnLogger();
      t.counters.set(OFFICE, ACTIVE_JOURNEYS_KEY, 7);

      expect(await t.slots.reconcileCount(owner, 4)).toBe(true);

      expect(t.counters.get(OFFICE, ACTIVE_JOURNEYS_KEY)).toBe(4);
      expect(logger.loggedText()).toContain(
        `Journey count of office ${OFFICE} repaired: 7 stored, 4 in progress`,
      );
      vi.restoreAllMocks();
    });

    it('a counter that already tells the truth is left alone and says so', async () => {
      t.counters.set(OFFICE, ACTIVE_JOURNEYS_KEY, 4);

      expect(await t.slots.reconcileCount(owner, 4)).toBe(false);
    });
  });

  describe('BR-012-27: the self-advised limit of 3 is not a plan', () => {
    it('asking the plan slots for a self-advised owner is a programming error, never an answer', async () => {
      const ctx = await anAccessContext(MEMBER, { selfAdvised: true });
      const acting = ctx.resolveActingOwner();
      const message = /BR-012-27/;

      await expect(t.slots.reserve(ctx, { actingOwner: acting })).rejects.toThrow(message);
      await expect(t.slots.ensureCounter(ctx, { actingOwner: acting })).rejects.toThrow(message);
      await expect(t.slots.inProgress(ctx, { actingOwner: acting })).rejects.toThrow(message);
      await expect(
        t.slots.release(ctx, { ownerType: 'self_advised', ownerId: MEMBER }),
      ).rejects.toThrow(message);
    });
  });
});
