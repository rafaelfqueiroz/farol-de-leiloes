// SPEC-012 SC-10, AR-08: the parts of SubscriptionsRepository that need no database: how a stored
// row becomes a subscription, which filters it builds (every id compared with `$eq` or an
// ObjectId, every operator server-built), what a malformed id does (no query at all) and how the
// two unique-index violations are told apart. The model is a hand-written stand-in of the query
// API that records what it is asked (TS-03, TS-07: nothing leaves the process). The conditional
// updates themselves, under concurrency and on the real indexes, are proven against MongoDB in
// test/integration/subscriptions-repositories.spec.ts and subscriptions-billing.spec.ts (TS-02).
import { describe, expect, it } from 'vitest';
import type { Model } from 'mongoose';
import { Types } from 'mongoose';
import type { SyncPatch } from './domain/provider-state.js';
import type { SubscriptionDocument } from './schemas/subscription.schema.js';
import { OpenCheckoutExistsError, SubscriptionsRepository } from './subscriptions.repository.js';

const ID = '64b7f0000000000000000e01';
const OFFICE = '64b7f0000000000000000c01';
const BUYER = '64b7f0000000000000000b01';
const PLAN = '64b7f0000000000000000a05';
const NOW = new Date('2026-03-01T12:00:00.000Z');
const LATER = new Date('2026-03-01T12:00:30.000Z');

type Call = { method: string; args: unknown[] };

const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value ?? null));

/** A query that records its modifiers and answers `result` when executed. */
function query(result: unknown, calls: Call[], method: string, args: unknown[]) {
  const record: Call = { method, args };
  calls.push(record);
  const chain: Record<string, unknown> = {};
  for (const modifier of ['lean', 'select', 'sort', 'limit']) {
    chain[modifier] = (...modifierArgs: unknown[]) => {
      calls.push({ method: `${method}.${modifier}`, args: modifierArgs });
      return chain;
    };
  }
  chain.exec = () => Promise.resolve(result);
  return chain;
}

/** The model API the repository uses, each method answering the next queued result. */
function build() {
  const calls: Call[] = [];
  const results = new Map<string, unknown[]>();
  const next = (method: string): unknown => {
    const queue = results.get(method) ?? [];
    return queue.length > 1 ? queue.shift() : queue[0];
  };
  const model: Record<string, unknown> = {};
  for (const method of [
    'findOne',
    'find',
    'findOneAndUpdate',
    'updateOne',
    'deleteOne',
    'deleteMany',
    'exists',
  ]) {
    model[method] = (...args: unknown[]) => query(next(method), calls, method, args);
  }
  model.create = async (...args: unknown[]) => {
    calls.push({ method: 'create', args });
    const outcome = next('create');
    if (outcome instanceof Error) throw outcome;
    return outcome;
  };
  return {
    calls,
    repository: new SubscriptionsRepository(model as unknown as Model<SubscriptionDocument>),
    answer: (method: string, ...queued: unknown[]) => results.set(method, queued),
    // Plain JSON: ObjectIds become hex strings, Dates ISO strings, and the symbol Mongoose marks a
    // server-built operator with (`trusted`) drops out, so a filter reads as the database sees it.
    filterOf: (method: string) => plain(calls.find((call) => call.method === method)?.args[0]),
    updateOf: (method: string) => plain(calls.find((call) => call.method === method)?.args[1]),
  };
}

const MINIMAL_ROW = {
  _id: new Types.ObjectId(ID),
  buyerUserId: new Types.ObjectId(BUYER),
  planId: new Types.ObjectId(PLAN),
  planCode: 'escritorio-5',
  activeJourneyLimit: 5,
  status: 'PENDING',
  cancelAtPeriodEnd: false,
  createdAt: NOW,
};

function patch(overrides: Partial<SyncPatch> = {}): SyncPatch {
  return {
    status: 'ACTIVE',
    stripeSubscriptionId: 'sub_1',
    stripeCustomerId: 'cus_1',
    cancelAtPeriodEnd: false,
    currentPeriodStart: NOW,
    currentPeriodEnd: LATER,
    plan: null,
    scheduledPlanId: null,
    scheduledChangeAt: null,
    firstPaidAt: NOW,
    firstPaymentFree: false,
    lapsedAt: null,
    readOnlyAt: null,
    lastSyncedAt: NOW,
    ...overrides,
  };
}

describe('SubscriptionsRepository (no database)', () => {
  describe('how a stored row becomes a subscription', () => {
    it('BR-012-09: a bare pending row has every absent value as null', async () => {
      const t = build();
      t.answer('findOne', MINIMAL_ROW);

      const stored = await t.repository.findById(ID);

      expect(stored).toEqual({
        id: ID,
        officeId: null,
        buyerUserId: BUYER,
        planId: PLAN,
        planCode: 'escritorio-5',
        activeJourneyLimit: 5,
        checkoutSessionId: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        status: 'PENDING',
        currentPeriodStart: null,
        currentPeriodEnd: null,
        cancelAtPeriodEnd: false,
        scheduledPlanId: null,
        scheduledChangeAt: null,
        firstPaidAt: null,
        firstPaymentFree: false,
        lapsedAt: null,
        readOnlyAt: null,
        provisionedAt: null,
        refundClaimedAt: null,
        refundRequestedAt: null,
        refundedAt: null,
        syncLeaseToken: null,
        syncLeaseUntil: null,
        lastSyncedAt: null,
        createdAt: NOW,
      });
      expect(Object.isFrozen(stored)).toBe(true);
    });

    it('a full row keeps every value, ids as hex strings', async () => {
      const t = build();
      t.answer('findOne', {
        ...MINIMAL_ROW,
        officeId: new Types.ObjectId(OFFICE),
        checkoutSessionId: 'cs_1',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        status: 'CANCELING',
        currentPeriodStart: NOW,
        currentPeriodEnd: LATER,
        cancelAtPeriodEnd: true,
        scheduledPlanId: new Types.ObjectId(PLAN),
        scheduledChangeAt: LATER,
        firstPaidAt: NOW,
        lapsedAt: NOW,
        readOnlyAt: LATER,
        provisionedAt: NOW,
        refundClaimedAt: NOW,
        refundRequestedAt: NOW,
        firstPaymentFree: true,
        refundedAt: LATER,
        syncLeaseToken: 'token',
        syncLeaseUntil: LATER,
        lastSyncedAt: NOW,
      });

      expect(await t.repository.findByStripeSubscriptionId('sub_1')).toMatchObject({
        officeId: OFFICE,
        checkoutSessionId: 'cs_1',
        stripeCustomerId: 'cus_1',
        stripeSubscriptionId: 'sub_1',
        scheduledPlanId: PLAN,
        scheduledChangeAt: LATER,
        refundClaimedAt: NOW,
        refundRequestedAt: NOW,
        refundedAt: LATER,
        firstPaymentFree: true,
        syncLeaseToken: 'token',
        syncLeaseUntil: LATER,
      });
    });

    it('answers null when nothing matches', async () => {
      const t = build();
      t.answer('findOne', null);

      expect(await t.repository.findById(ID)).toBeNull();
      expect(await t.repository.findByStripeSubscriptionId('sub_none')).toBeNull();
      expect(await t.repository.findInEffectByOffice(OFFICE)).toBeNull();
      expect(await t.repository.findInEffectForOffice(OFFICE, ID)).toBeNull();
      expect(await t.repository.findOpenCheckout('buyer:1')).toBeNull();
      expect(await t.repository.findCustomerIdOfOffice(OFFICE)).toBeNull();
      expect(await t.repository.acquireSyncLease(ID, 't', NOW, LATER)).toBeNull();
    });
  });

  describe('SC-10: filters are built from server state only', () => {
    it('compares every id and key with $eq or an ObjectId, never a bare value', async () => {
      const t = build();
      t.answer('findOne', null);

      await t.repository.findById(ID);
      await t.repository.findByStripeSubscriptionId('sub_1');
      await t.repository.findOpenCheckout('buyer:1');

      expect(
        t.calls.filter((call) => call.method === 'findOne').map((call) => call.args[0]),
      ).toEqual([
        { _id: { $eq: ID } },
        { stripeSubscriptionId: { $eq: 'sub_1' } },
        { openCheckoutKey: { $eq: 'buyer:1' } },
      ]);
    });

    it('a malformed id never reaches the database: every method answers its empty value', async () => {
      const t = build();
      const bad = 'not-an-id';

      expect(await t.repository.findById(bad)).toBeNull();
      expect(await t.repository.acquireSyncLease(bad, 't', NOW, LATER)).toBeNull();
      expect(await t.repository.markSyncRequested(bad, NOW)).toBe(false);
      await expect(t.repository.releaseSyncLease(bad, 't')).resolves.toBeUndefined();
      expect(await t.repository.findInEffectForOffice(bad, ID)).toBeNull();
      expect(await t.repository.findInEffectForOffice(OFFICE, bad)).toBeNull();
      expect(await t.repository.findInEffectByOffice(bad)).toBeNull();
      expect(await t.repository.findRecentForOffice(bad, 5)).toEqual([]);
      expect(await t.repository.findCustomerIdOfOffice(bad)).toBeNull();
      expect(await t.repository.existsEarlierPaid(bad, ID, NOW)).toBe(false);
      expect(await t.repository.existsEarlierPaid(OFFICE, bad, NOW)).toBe(false);
      expect(await t.repository.setCheckoutSession(bad, 'cs', 'cus')).toBe(false);
      expect(await t.repository.deletePendingById(bad)).toBe(false);
      expect(await t.repository.claimRefund(bad, NOW, LATER)).toBe(false);
      expect(await t.repository.markRefunded(bad, NOW)).toBe(false);
      expect(await t.repository.findDecidingForOffices([bad])).toEqual([]);
      expect(await t.repository.deleteAbandonedPending('')).toBe(false);
      expect(t.calls).toEqual([]);
    });

    it('a non-string key is no key', async () => {
      const t = build();

      expect(await t.repository.findOpenCheckout(5 as unknown as string)).toBeNull();
      expect(await t.repository.findByStripeSubscriptionId(5 as unknown as string)).toBeNull();
      expect(await t.repository.deleteAbandonedPending(5 as unknown as string)).toBe(false);
      expect(t.calls).toEqual([]);
    });

    it('BR-012-08: the in-effect lookups filter on the in-effect statuses as a server-built $in', async () => {
      const t = build();
      t.answer('findOne', null);

      await t.repository.findInEffectByOffice(OFFICE);

      expect(t.filterOf('findOne')).toEqual({
        officeId: { $eq: OFFICE },
        status: { $in: ['ACTIVE', 'PAST_DUE', 'CANCELING'] },
      });
    });

    it('BR-012-29: the refund claim is one filter on in-effect, not refunded, and no live claim', async () => {
      const t = build();
      t.answer('updateOne', { modifiedCount: 1 });

      expect(await t.repository.claimRefund(ID, NOW, LATER)).toBe(true);

      expect(t.filterOf('updateOne')).toEqual({
        _id: { $eq: ID },
        status: { $in: ['ACTIVE', 'PAST_DUE', 'CANCELING'] },
        refundedAt: null,
        $or: [{ refundClaimedAt: null }, { refundClaimedAt: { $lte: LATER.toISOString() } }],
      });
      expect(t.updateOf('updateOne')).toEqual({
        $set: { refundClaimedAt: NOW.toISOString() },
        $min: { refundRequestedAt: NOW.toISOString() },
      });
    });

    it('answers false when a conditional update matched nothing', async () => {
      const t = build();
      t.answer('updateOne', { modifiedCount: 0, matchedCount: 0 });

      expect(await t.repository.claimRefund(ID, NOW, LATER)).toBe(false);
      expect(await t.repository.markRefunded(ID, NOW)).toBe(false);
      expect(await t.repository.setCheckoutSession(ID, 'cs', 'cus')).toBe(false);
      expect(await t.repository.markSyncRequested(ID, NOW)).toBe(false);
      expect(await t.repository.attachOffice(ID, OFFICE, NOW)).toBe('already_attached');
    });
  });

  describe('BR-012-07, BR-012-08: the two unique indexes are told apart', () => {
    const duplicate = (keyPattern: Record<string, number>) =>
      Object.assign(new Error('E11000'), { code: 11000, keyPattern });

    it('an open-checkout key already taken is OpenCheckoutExistsError', async () => {
      const t = build();
      t.answer('create', duplicate({ openCheckoutKey: 1 }));

      await expect(
        t.repository.createPending({
          buyerUserId: BUYER,
          planId: PLAN,
          planCode: 'p',
          activeJourneyLimit: 5,
          openCheckoutKey: 'buyer:1',
        }),
      ).rejects.toBeInstanceOf(OpenCheckoutExistsError);
    });

    it('any other failure of the insert surfaces as it is', async () => {
      const t = build();
      t.answer('create', duplicate({ stripeSubscriptionId: 1 }));
      const input = { buyerUserId: BUYER, planId: PLAN, planCode: 'p', activeJourneyLimit: 5 };
      await expect(t.repository.createPending(input)).rejects.toThrow('E11000');

      t.answer('create', new Error('connection lost'));
      await expect(t.repository.createPending(input)).rejects.toThrow('connection lost');

      t.answer('create', [undefined]);
      await expect(t.repository.createPending(input)).rejects.toThrow('created no subscription');
    });

    it('creates the pending record with the office, the session and the key when given', async () => {
      const t = build();
      t.answer('create', [{ toObject: () => MINIMAL_ROW }]);

      await t.repository.createPending({
        buyerUserId: BUYER,
        planId: PLAN,
        planCode: 'escritorio-5',
        activeJourneyLimit: 5,
        officeId: OFFICE,
        checkoutSessionId: 'cs_1',
        openCheckoutKey: `office:${OFFICE}`,
      });

      expect(t.calls[0]?.args[0]).toEqual([
        {
          buyerUserId: new Types.ObjectId(BUYER),
          planId: new Types.ObjectId(PLAN),
          planCode: 'escritorio-5',
          activeJourneyLimit: 5,
          status: 'PENDING',
          cancelAtPeriodEnd: false,
          officeId: new Types.ObjectId(OFFICE),
          checkoutSessionId: 'cs_1',
          openCheckoutKey: `office:${OFFICE}`,
        },
      ]);
    });

    it('an office that already has another in effect refuses the attach and the sync write', async () => {
      const t = build();
      const refusal = duplicate({ officeId: 1 });
      t.answer('updateOne', refusal);
      // The stand-in throws what the model would reject with.
      (t.repository as unknown as { model: Record<string, unknown> }).model.updateOne = () => ({
        exec: () => Promise.reject(refusal),
      });
      (t.repository as unknown as { model: Record<string, unknown> }).model.findOneAndUpdate =
        () => ({
          select: () => ({ lean: () => ({ exec: () => Promise.reject(refusal) }) }),
        });

      expect(await t.repository.attachOffice(ID, OFFICE, NOW)).toBe('duplicate_in_effect');
      expect(await t.repository.writeSync(ID, 'token', patch())).toEqual({
        outcome: 'duplicate_in_effect',
        dirty: false,
      });
    });

    it('any other failure of the sync write or the attach surfaces', async () => {
      const t = build();
      const failure = new Error('connection lost');
      const model = (t.repository as unknown as { model: Record<string, unknown> }).model;
      model.updateOne = () => ({ exec: () => Promise.reject(failure) });
      model.findOneAndUpdate = () => ({
        select: () => ({ lean: () => ({ exec: () => Promise.reject(failure) }) }),
      });

      await expect(t.repository.attachOffice(ID, OFFICE, NOW)).rejects.toThrow('connection lost');
      await expect(t.repository.writeSync(ID, 'token', patch())).rejects.toThrow('connection lost');
    });
  });

  describe('BR-012-13: the sync write', () => {
    it('stores the snapshot, releases the lease, and clears what the provider no longer has', async () => {
      const t = build();
      t.answer('findOneAndUpdate', { _id: new Types.ObjectId(ID), syncRequestedAt: undefined });

      const result = await t.repository.writeSync(ID, 'token', patch());

      expect(result).toEqual({ outcome: 'written', dirty: false });
      expect(t.filterOf('findOneAndUpdate')).toEqual({
        _id: { $eq: ID },
        syncLeaseToken: { $eq: 'token' },
      });
      expect(t.updateOf('findOneAndUpdate')).toEqual({
        $set: {
          status: 'ACTIVE',
          stripeSubscriptionId: 'sub_1',
          stripeCustomerId: 'cus_1',
          cancelAtPeriodEnd: false,
          lastSyncedAt: NOW.toISOString(),
          currentPeriodStart: NOW.toISOString(),
          currentPeriodEnd: LATER.toISOString(),
          firstPaidAt: NOW.toISOString(),
          firstPaymentFree: false,
        },
        $unset: {
          syncLeaseToken: '',
          syncLeaseUntil: '',
          syncRequestedAt: '',
          lastReconcileFailedAt: '',
          scheduledPlanId: '',
          scheduledChangeAt: '',
          lapsedAt: '',
          readOnlyAt: '',
        },
      });
    });

    it('BR-012-16: a changed plan moves the plan, its code and the limit it copies together', async () => {
      const t = build();
      t.answer('findOneAndUpdate', { _id: new Types.ObjectId(ID) });

      await t.repository.writeSync(
        ID,
        'token',
        patch({
          plan: { id: PLAN, code: 'escritorio-10', activeJourneyLimit: 10 },
          scheduledPlanId: PLAN,
          scheduledChangeAt: LATER,
          lapsedAt: NOW,
          readOnlyAt: LATER,
        }),
      );

      expect(t.updateOf('findOneAndUpdate')).toMatchObject({
        $set: {
          planId: PLAN,
          planCode: 'escritorio-10',
          activeJourneyLimit: 10,
          scheduledPlanId: PLAN,
          scheduledChangeAt: LATER.toISOString(),
          lapsedAt: NOW.toISOString(),
          readOnlyAt: LATER.toISOString(),
        },
      });
    });

    it.each(['PENDING', 'ACTIVE', 'PAST_DUE', 'CANCELING'] as const)(
      'BR-012-07, BR-012-08: a %s record keeps its open-checkout key (the buyer holds it until the office is attached)',
      async (status) => {
        const t = build();
        t.answer('findOneAndUpdate', { _id: new Types.ObjectId(ID) });

        await t.repository.writeSync(ID, 'token', patch({ status }));

        expect(
          (t.updateOf('findOneAndUpdate') as { $unset: Record<string, string> }).$unset,
        ).not.toHaveProperty('openCheckoutKey');
      },
    );

    it('BR-012-08: a LAPSED record gives its open-checkout key back, so the office can subscribe again', async () => {
      const t = build();
      t.answer('findOneAndUpdate', { _id: new Types.ObjectId(ID) });

      await t.repository.writeSync(ID, 'token', patch({ status: 'LAPSED', lapsedAt: NOW }));

      expect(t.updateOf('findOneAndUpdate')).toMatchObject({ $unset: { openCheckoutKey: '' } });
    });

    it('BR-012-29: the first payment instant and whether it was free are stored together, and only with it', async () => {
      const t = build();
      t.answer('findOneAndUpdate', { _id: new Types.ObjectId(ID) });

      await t.repository.writeSync(ID, 'token', patch({ firstPaymentFree: true }));
      await t.repository.writeSync(
        ID,
        'token',
        patch({ firstPaidAt: null, firstPaymentFree: true }),
      );

      const updates = t.calls
        .filter((call) => call.method === 'findOneAndUpdate')
        .map((call) => plain(call.args[1]) as { $set: Record<string, unknown> });
      expect(updates[0]?.$set).toMatchObject({ firstPaymentFree: true });
      expect(updates[1]?.$set).not.toHaveProperty('firstPaymentFree');
    });

    it('answers dirty when a delivery asked for a re-read while the lease was held', async () => {
      const t = build();
      t.answer('findOneAndUpdate', { _id: new Types.ObjectId(ID), syncRequestedAt: NOW });

      expect(await t.repository.writeSync(ID, 'token', patch())).toEqual({
        outcome: 'written',
        dirty: true,
      });
    });

    it('answers lease_lost when the lease is no longer ours', async () => {
      const t = build();
      t.answer('findOneAndUpdate', null);

      expect(await t.repository.writeSync(ID, 'token', patch())).toEqual({
        outcome: 'lease_lost',
        dirty: false,
      });
    });
  });

  describe('reads for the office plan source and the billing view', () => {
    it('BR-012-21: the deciding subscriptions of the valid offices only, without a pending or never-paid one', async () => {
      const t = build();
      t.answer('find', [
        {
          _id: new Types.ObjectId(ID),
          officeId: new Types.ObjectId(OFFICE),
          status: 'LAPSED',
          lapsedAt: NOW,
        },
        { _id: new Types.ObjectId(ID), status: 'ACTIVE' },
      ]);

      const rows = await t.repository.findDecidingForOffices([OFFICE, 'bad']);

      expect(rows).toEqual([
        { officeId: OFFICE, status: 'LAPSED', lapsedAt: NOW, firstPaidAt: null },
      ]);
      expect((t.filterOf('find') as { officeId: unknown }).officeId).toEqual({
        $in: [OFFICE],
      });
    });

    it('BR-012-11: the latest subscriptions of an office, newest first and bounded', async () => {
      const t = build();
      t.answer('find', [MINIMAL_ROW]);

      const found = await t.repository.findRecentForOffice(OFFICE, 7);

      expect(found).toHaveLength(1);
      expect(t.calls.find((call) => call.method === 'find.sort')?.args[0]).toEqual({
        createdAt: -1,
        _id: -1,
      });
      expect(t.calls.find((call) => call.method === 'find.limit')?.args[0]).toBe(7);
    });

    it('BR-012-29: asks whether an earlier subscription of the office was paid before this payment', async () => {
      const t = build();
      t.answer('exists', { _id: 'x' });
      expect(await t.repository.existsEarlierPaid(OFFICE, ID, NOW)).toBe(true);

      t.answer('exists', null);
      expect(await t.repository.existsEarlierPaid(OFFICE, ID, NOW)).toBe(false);
      expect(t.filterOf('exists')).toEqual({
        officeId: { $eq: OFFICE },
        _id: { $ne: ID },
        firstPaidAt: { $lt: NOW.toISOString() },
        firstPaymentFree: { $ne: true },
      });
    });

    it('the customer of an office is the latest one stored, or none', async () => {
      const t = build();
      t.answer(
        'findOne',
        { _id: new Types.ObjectId(ID), stripeCustomerId: 'cus_1' },
        { _id: new Types.ObjectId(ID) },
      );

      expect(await t.repository.findCustomerIdOfOffice(OFFICE)).toBe('cus_1');
      expect(await t.repository.findCustomerIdOfOffice(OFFICE)).toBeNull();
    });
  });

  describe('ADR-005: the reconcile and the purge', () => {
    it('reads the ids and statuses of the records due, oldest sync first', async () => {
      const t = build();
      t.answer('find', [{ _id: new Types.ObjectId(ID), status: 'ACTIVE' }]);

      const due = await t.repository.findIdsToReconcile({
        staleBefore: NOW,
        lapsedSince: LATER,
        limit: 50,
      });

      expect(due).toEqual([{ id: ID, status: 'ACTIVE' }]);
      expect(t.calls.find((call) => call.method === 'find.sort')?.args[0]).toEqual({
        lastReconcileFailedAt: 1,
        lastSyncedAt: 1,
        _id: 1,
      });
      expect(t.calls.find((call) => call.method === 'find.limit')?.args[0]).toBe(50);
    });

    it('purges the unpaid pending records created before the cutoff and counts them', async () => {
      const t = build();
      t.answer('deleteMany', { deletedCount: 3 });

      expect(await t.repository.purgeOrphanedPending(NOW)).toBe(3);
      expect(t.filterOf('deleteMany')).toEqual({
        status: { $eq: 'PENDING' },
        stripeSubscriptionId: null,
        checkoutSessionId: null,
        createdAt: { $lt: NOW.toISOString() },
      });
    });

    it('removes an unpaid pending record by id or by its session, and says whether it did', async () => {
      const t = build();
      t.answer('deleteOne', { deletedCount: 1 }, { deletedCount: 0 });

      expect(await t.repository.deletePendingById(ID)).toBe(true);
      expect(await t.repository.deleteAbandonedPending('cs_1')).toBe(false);
    });
  });

  describe('F2, F3, F4, F9, F10: recovery and guards', () => {
    it('BR-012-07: attaching the office also gives the buyer open-checkout key back', async () => {
      const t = build();
      t.answer('updateOne', { modifiedCount: 1 });

      expect(await t.repository.attachOffice(ID, OFFICE, NOW)).toBe('attached');

      expect(t.updateOf('updateOne')).toMatchObject({ $unset: { openCheckoutKey: '' } });
    });

    it('BR-012-29: the refund claim goes back only to its holder (the instant it took), and the request stays', async () => {
      const t = build();
      t.answer('updateOne', { modifiedCount: 1 });

      await t.repository.releaseRefundClaim(ID, NOW);
      await t.repository.releaseRefundClaim('not-an-id', NOW);

      expect(t.filterOf('updateOne')).toEqual({
        _id: { $eq: ID },
        refundClaimedAt: { $eq: NOW.toISOString() },
      });
      expect(t.updateOf('updateOne')).toEqual({ $unset: { refundClaimedAt: '' } });
      expect(t.calls.filter((call) => call.method === 'updateOne')).toHaveLength(1);
    });

    it('BR-012-29: finds the subscriptions in effect whose refund was requested or made, bounded', async () => {
      const t = build();
      t.answer('find', [MINIMAL_ROW]);

      const found = await t.repository.findRefundsToFinish(25);

      expect(found).toHaveLength(1);
      expect(t.filterOf('find')).toEqual({
        status: { $in: ['ACTIVE', 'PAST_DUE', 'CANCELING'] },
        $or: [{ refundedAt: { $exists: true } }, { refundRequestedAt: { $exists: true } }],
      });
      expect(t.calls.find((call) => call.method === 'find.limit')?.args[0]).toBe(25);
    });

    it('ADR-005: finds the unconfirmed checkouts that have a session, older than the cutoff', async () => {
      const t = build();
      t.answer('find', [MINIMAL_ROW]);

      const found = await t.repository.findPendingWithSession(NOW, 10);

      expect(found).toHaveLength(1);
      expect(t.filterOf('find')).toEqual({
        status: { $eq: 'PENDING' },
        stripeSubscriptionId: null,
        checkoutSessionId: { $exists: true },
        createdAt: { $lt: NOW.toISOString() },
      });
    });

    it('ADR-005: marks a record the job could not read, ignoring a malformed id', async () => {
      const t = build();
      t.answer('updateOne', { modifiedCount: 1 });

      await t.repository.markReconcileFailed(ID, NOW);
      await t.repository.markReconcileFailed('not-an-id', NOW);

      expect(t.updateOf('updateOne')).toEqual({
        $set: { lastReconcileFailedAt: NOW.toISOString() },
      });
      expect(t.calls.filter((call) => call.method === 'updateOne')).toHaveLength(1);
    });

    it('BR-012-07: a first subscription of the buyer that is in effect and has no office is found by the buyer', async () => {
      const t = build();
      t.answer('findOne', MINIMAL_ROW, null);

      expect((await t.repository.findInEffectByBuyerWithoutOffice(BUYER))?.id).toBe(ID);
      expect(await t.repository.findInEffectByBuyerWithoutOffice(BUYER)).toBeNull();
      expect(await t.repository.findInEffectByBuyerWithoutOffice('not-an-id')).toBeNull();
      expect(t.filterOf('findOne')).toEqual({
        buyerUserId: { $eq: BUYER },
        officeId: null,
        status: { $in: ['ACTIVE', 'PAST_DUE', 'CANCELING'] },
      });
    });

    it('one customer per buyer: the latest stored customer of the buyer, or none', async () => {
      const t = build();
      t.answer(
        'findOne',
        { _id: new Types.ObjectId(ID), stripeCustomerId: 'cus_1' },
        { _id: new Types.ObjectId(ID) },
      );

      expect(await t.repository.findCustomerIdOfBuyer(BUYER)).toBe('cus_1');
      expect(await t.repository.findCustomerIdOfBuyer(BUYER)).toBeNull();
      expect(await t.repository.findCustomerIdOfBuyer('not-an-id')).toBeNull();
    });
  });
});
