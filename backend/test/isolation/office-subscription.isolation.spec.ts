// SPEC-012 BR-012-11 / SPEC-002 TS-15..TS-18: the office billing API is an owner surface, so it is
// proven through the real API like every other one: offices A and B, each with its subscription,
// its journey count and its invoices, and the standard questions. The `subscriptions` collection
// itself is marked `internal` (keyed by office and provider ids, never listed per owner), so the
// gate needs no `isolationSpecFor` for it; this spec proves the surface in front of it:
//
//   - a member of A reads and changes ONLY A's plan, and nothing of B's appears in any answer (TS-16);
//   - B's id in the query or body is the same 404 as an id that does not exist, and B's
//     subscription is not touched (TS-17, BR-002-11); a header or path naming B changes nothing;
//   - a removed member is refused on the very next request (TS-18, BR-002-15);
//   - the success page's checkout ref belongs to its buyer only;
//   - a READ-ONLY office still manages its plan (BR-012-28), and an anonymous caller manages nothing.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getModelToken } from '@nestjs/mongoose';
import { type Model, Types } from 'mongoose';
import request from 'supertest';
import { OwnerCounterEntity } from '../../src/access/schemas/owner-counter.schema.js';
import type { OfficePlanState } from '../../src/access/sources/office-plan.source.js';
import { Decimal } from '../../src/common/money/money.js';
import { PaymentGateway } from '../../src/payments/payment-gateway.js';
import { PlansService } from '../../src/plans/plans.service.js';
import { ACTIVE_JOURNEYS_KEY } from '../../src/subscriptions/journey-slots.service.js';
import { OFFICE_PROVISIONER } from '../../src/subscriptions/ports/office-provisioner.js';
import { SubscriptionsBillingModule } from '../../src/subscriptions/subscriptions-billing.module.js';
import { SubscriptionsRepository } from '../../src/subscriptions/subscriptions.repository.js';
import { SubscriptionsService } from '../../src/subscriptions/subscriptions.service.js';
import { aProviderSubscription } from '../builders/provider-subscription.builder.js';
import { FakeOfficeProvisioner } from '../fakes/fake-office-provisioner.js';
import { FakePaymentGateway } from '../fakes/fake-payment-gateway.js';
import { useTestDatabase } from '../support/test-database.js';
import {
  answerOf,
  createIsolationApp,
  type IsolationApp,
  RANDOM_ID,
  type TestAccount,
} from './support/isolation-app.js';

const OFFICE_A = '64b7f0000000000000010101';
const OFFICE_B = '64b7f0000000000000020202';
const WRITABLE: OfficePlanState = {
  advisorPlanActive: true,
  readOnly: false,
  entitlements: ['advisor'],
};
const READ_ONLY: OfficePlanState = { ...WRITABLE, readOnly: true };

describe('office subscription isolation through the API (SPEC-012 BR-012-11, TS-15..TS-18)', () => {
  const db = useTestDatabase();
  const gateway = new FakePaymentGateway();
  let app: IsolationApp;
  let memberA: TestAccount;
  let colleagueA: TestAccount;
  let memberB: TestAccount;
  let outsider: TestAccount;
  let removed: TestAccount;
  let admin: TestAccount;
  let refB: string;
  let subscriptions: SubscriptionsRepository;
  let counters: Model<OwnerCounterEntity>;

  /** What B's data looks like in a body: none of it may appear in an answer to A. */
  const B_MARKERS = [OFFICE_B, 'escritorio-2', 'Escritório 2', 'in_B', 'cus_B', 'sub_B'];
  const leaksB = (body: unknown) =>
    B_MARKERS.filter((marker) => JSON.stringify(body).includes(marker));
  const stateOfB = async () => {
    const record = await subscriptions.findById(refB);
    return JSON.stringify(record);
  };

  beforeAll(async () => {
    app = await createIsolationApp(db, [SubscriptionsBillingModule], {}, undefined, (builder) =>
      builder
        .overrideProvider(PaymentGateway)
        .useValue(gateway)
        .overrideProvider(OFFICE_PROVISIONER)
        .useValue(new FakeOfficeProvisioner()),
    );
    [memberA, colleagueA, memberB, outsider, removed, admin] = await app.signUpAll(
      'member-a',
      'colleague-a',
      'member-b',
      'outsider',
      'removed',
      'admin',
    );
    await app.makeAdmin(admin);
    app.sources.plans = { [OFFICE_A]: WRITABLE, [OFFICE_B]: WRITABLE };
    app.sources
      .forAccount(memberA.id, { memberships: [{ officeId: OFFICE_A }] })
      .forAccount(colleagueA.id, { memberships: [{ officeId: OFFICE_A }] })
      .forAccount(memberB.id, { memberships: [{ officeId: OFFICE_B }] })
      .forAccount(removed.id, { memberships: [{ officeId: OFFICE_A }] });

    // The catalog and the two subscriptions, confirmed the way the webhook confirms them.
    const moduleRef = app.harness.moduleRef;
    const plans = moduleRef.get(PlansService);
    const catalog = [
      { code: 'escritorio-5', name: 'Escritório 5', limit: 5, price: '199.90', priceId: 'price_5' },
      { code: 'escritorio-2', name: 'Escritório 2', limit: 2, price: '99.90', priceId: 'price_2' },
      {
        code: 'escritorio-10',
        name: 'Escritório 10',
        limit: 10,
        price: '349.90',
        priceId: 'price_10',
      },
    ].map((plan) => ({
      code: plan.code,
      name: plan.name,
      price: new Decimal(plan.price),
      interval: 'month' as const,
      activeJourneyLimit: plan.limit,
      stripePriceId: plan.priceId,
      status: 'OFFERED' as const,
      sortOrder: plan.limit,
    }));
    catalog.forEach((plan) =>
      gateway.prices.set(plan.stripePriceId, {
        id: plan.stripePriceId,
        active: true,
        amount: plan.price,
        interval: 'month',
        currency: 'brl',
      }),
    );
    await plans.upsertCatalog(catalog);
    subscriptions = moduleRef.get(SubscriptionsRepository);
    const sync = moduleRef.get(SubscriptionsService);
    const seed = async (
      officeId: string,
      planCode: string,
      providerId: string,
      customer: string,
    ) => {
      const plan = await plans.findByCode(planCode);
      if (!plan) throw new Error('no plan');
      const pending = await subscriptions.createPending({
        buyerUserId: officeId === OFFICE_A ? memberA.id : memberB.id,
        planId: plan.id,
        planCode: plan.code,
        activeJourneyLimit: plan.activeJourneyLimit,
        officeId,
        checkoutSessionId: `cs_${providerId}`,
      });
      gateway.setSubscription(
        aProviderSubscription({
          id: providerId,
          customerId: customer,
          subscriptionRef: pending.id,
          priceId: plan.stripePriceId,
          // The real clock: the access fakes and the plan source do not read it here, but the
          // refund window and the period are computed against `Clock` (the harness's fake, 2099).
          currentPeriodStart: new Date('2099-01-10T12:00:00.000Z'),
          currentPeriodEnd: new Date('2099-02-10T12:00:00.000Z'),
          latestInvoicePaidAt: new Date('2099-01-10T12:00:05.000Z'),
        }),
      );
      await sync.handleProviderEvent({
        id: `evt_${providerId}`,
        type: 'checkout.completed',
        subscriptionId: providerId,
        subscriptionRef: pending.id,
      });
      return pending.id;
    };
    await seed(OFFICE_A, 'escritorio-5', 'sub_A', 'cus_A');
    refB = await seed(OFFICE_B, 'escritorio-2', 'sub_B', 'cus_B');
    gateway.invoicesByCustomer.set('cus_A', [
      { id: 'in_A', paidAt: null, amount: new Decimal('199.9'), status: 'open', hostedUrl: null },
    ]);
    gateway.invoicesByCustomer.set('cus_B', [
      { id: 'in_B', paidAt: null, amount: new Decimal('99.9'), status: 'open', hostedUrl: null },
    ]);

    counters = moduleRef.get<Model<OwnerCounterEntity>>(getModelToken(OwnerCounterEntity.name));
    for (const [officeId, value] of [
      [OFFICE_A, 4],
      [OFFICE_B, 1],
    ] as const) {
      await counters.collection.insertOne({
        ownerType: 'office',
        ownerId: new Types.ObjectId(officeId),
        key: ACTIVE_JOURNEYS_KEY,
        value,
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('TS-16, BR-012-11: a member of A sees A plan, limit, count and invoices, and nothing of B', async () => {
    const response = await app.as(memberA).get('/api/office/subscription').expect(200);

    expect(response.body).toMatchObject({
      officeId: OFFICE_A,
      plan: { code: 'escritorio-5' },
      status: 'ACTIVE',
      activeJourneyLimit: 5,
      inProgress: 4,
      invoices: [{ id: 'in_A' }],
    });
    expect(leaksB(response.body)).toEqual([]);
  });

  it('TS-16: B sees B, with its own count and invoices', async () => {
    const response = await app.as(memberB).get('/api/office/subscription').expect(200);

    expect(response.body).toMatchObject({
      officeId: OFFICE_B,
      plan: { code: 'escritorio-2' },
      activeJourneyLimit: 2,
      inProgress: 1,
      invoices: [{ id: 'in_B' }],
    });
    expect(JSON.stringify(response.body)).not.toContain('in_A');
  });

  it('BR-012-11: any member of A, not only the one who paid, sees the same plan', async () => {
    const buyer = await app.as(memberA).get('/api/office/subscription').expect(200);
    const colleague = await app.as(colleagueA).get('/api/office/subscription').expect(200);

    expect(colleague.body).toEqual(buyer.body);
  });

  it('TS-17: A member asking for B by id gets exactly the answer for an id that does not exist', async () => {
    const missing = await answerOf(
      app.as(memberA).get(`/api/office/subscription?officeId=${RANDOM_ID}`),
    );
    const foreign = await answerOf(
      app.as(memberA).get(`/api/office/subscription?officeId=${OFFICE_B}`),
    );

    expect(foreign).toEqual(missing);
    expect(foreign).toEqual({ status: 404, body: { code: 'NOT_FOUND', context: {} } });
  });

  it('TS-17: change, cancel, undo-cancel, portal and checkout naming B are the same 404, and B is untouched', async () => {
    const before = await stateOfB();
    const calls = () => [
      gateway.priceChanges.length,
      gateway.scheduledChanges.length,
      gateway.cancelAtPeriodEndChanges.length,
      gateway.refundRequests.length,
      gateway.portalSessions.length,
      gateway.checkouts.length,
    ];
    const providerBefore = calls();
    const attempt = (path: string, body: object, officeId: string) =>
      answerOf(
        app
          .as(memberA)
          .post(`/api/office/subscription/${path}`)
          .send({ ...body, officeId }),
      );

    for (const [path, body] of [
      ['change', { planCode: 'escritorio-10' }],
      ['cancel', {}],
      ['undo-cancel', {}],
      ['billing-portal', {}],
      ['checkout', { planCode: 'escritorio-5' }],
    ] as const) {
      const missing = await attempt(path, body, RANDOM_ID);
      const foreign = await attempt(path, body, OFFICE_B);

      expect(foreign).toEqual(missing);
      expect(foreign).toEqual({ status: 404, body: { code: 'NOT_FOUND', context: {} } });
    }

    expect(await stateOfB()).toBe(before);
    expect(calls()).toEqual(providerBefore);
  });

  it('TS-17, BR-002-11: B owner id in a query key, a header or a body key is never an office to act on', async () => {
    // An unknown query or body key is refused (AR-34), not obeyed.
    await app.as(memberA).get(`/api/office/subscription?ownerId=${OFFICE_B}`).expect(400);
    await app
      .as(memberA)
      .post('/api/office/subscription/cancel')
      .send({ ownerId: OFFICE_B, ownerType: 'office' })
      .expect(400);
    // A header is just a header: the answer is A's.
    const withHeader = await app
      .as(memberA)
      .get('/api/office/subscription')
      .set('X-Office-Id', OFFICE_B)
      .expect(200);

    expect(withHeader.body).toMatchObject({ officeId: OFFICE_A });
    expect(leaksB(withHeader.body)).toEqual([]);
  });

  it('TS-17: the success page answers a ref only to its buyer; another account gets the 404 of a missing ref', async () => {
    const own = await answerOf(app.as(memberB).get(`/api/subscriptions/checkout/${refB}/status`));
    const foreign = await answerOf(
      app.as(memberA).get(`/api/subscriptions/checkout/${refB}/status`),
    );
    const missing = await answerOf(
      app.as(memberA).get(`/api/subscriptions/checkout/${RANDOM_ID}/status`),
    );

    expect(own).toEqual({ status: 200, body: { state: 'CONFIRMED' } });
    expect(foreign).toEqual(missing);
    expect(foreign).toEqual({ status: 404, body: { code: 'NOT_FOUND', context: {} } });
  });

  it('TS-18, BR-002-15: a removed member is refused on the very next request, and names no office', async () => {
    expect((await app.as(removed).get('/api/office/subscription').expect(200)).body).toMatchObject({
      officeId: OFFICE_A,
    });

    app.sources.forAccount(removed.id, {}); // SPEC-011 removed the membership

    const withoutOffice = await answerOf(app.as(removed).get('/api/office/subscription'));
    const namingA = await answerOf(
      app.as(removed).get(`/api/office/subscription?officeId=${OFFICE_A}`),
    );
    const missing = await answerOf(
      app.as(removed).get(`/api/office/subscription?officeId=${RANDOM_ID}`),
    );
    expect(withoutOffice).toEqual({ status: 403, body: { code: 'FORBIDDEN', context: {} } });
    expect(namingA).toEqual(missing);
    expect(namingA.status).toBe(404);
    for (const [path, body] of [
      ['change', { planCode: 'escritorio-2' }],
      ['cancel', {}],
      ['undo-cancel', {}],
      ['billing-portal', {}],
    ] as const) {
      const refused = await answerOf(
        app.as(removed).post(`/api/office/subscription/${path}`).send(body),
      );
      expect(refused).toEqual({ status: 403, body: { code: 'FORBIDDEN', context: {} } });
    }
    expect(gateway.cancelAtPeriodEndChanges).toEqual([]);
  });

  it('TS-17: an account that never belonged to an office is refused the same way', async () => {
    expect(
      await answerOf(app.as(outsider).get(`/api/office/subscription?officeId=${OFFICE_A}`)),
    ).toEqual(
      await answerOf(app.as(outsider).get(`/api/office/subscription?officeId=${RANDOM_ID}`)),
    );
  });

  it('BR-002-21: an admin has no office: refused, and cannot buy one', async () => {
    expect((await answerOf(app.as(admin).get('/api/office/subscription'))).status).toBe(403);
    expect(
      (
        await answerOf(
          app
            .as(admin)
            .post('/api/office/subscription/checkout')
            .send({ planCode: 'escritorio-5' }),
        )
      ).status,
    ).toBe(403);
  });

  it('SC-07: an anonymous caller manages nothing', async () => {
    const server = app.harness.app.getHttpServer() as Parameters<typeof request>[0];

    await request(server).get('/api/office/subscription').expect(401);
    await request(server).post('/api/office/subscription/cancel').send({}).expect(401);
    await request(server).post('/api/office/subscription/checkout').send({}).expect(401);
    await request(server).get(`/api/subscriptions/checkout/${refB}/status`).expect(401);
  });

  it('BR-012-28, BR-012-11: a READ-ONLY office still shows and changes its plan and opens the billing portal', async () => {
    app.sources.plans = { [OFFICE_A]: READ_ONLY, [OFFICE_B]: WRITABLE };
    try {
      await app.as(colleagueA).get('/api/office/subscription').expect(200);
      const changed = await app
        .as(colleagueA)
        .post('/api/office/subscription/change')
        .send({ planCode: 'escritorio-2' })
        .expect(200);
      expect(changed.body).toMatchObject({
        officeId: OFFICE_A,
        scheduledChange: { planCode: 'escritorio-2' },
      });
      await app.as(colleagueA).post('/api/office/subscription/billing-portal').send({}).expect(200);
      const cancelled = await app
        .as(colleagueA)
        .post('/api/office/subscription/cancel')
        .send({})
        .expect(200);
      expect(cancelled.body).toMatchObject({ officeId: OFFICE_A });
    } finally {
      app.sources.plans = { [OFFICE_A]: WRITABLE, [OFFICE_B]: WRITABLE };
    }
  });

  it('TS-16: after all of that, B plan, count and provider subscription are exactly what they were', async () => {
    const response = await app.as(memberB).get('/api/office/subscription').expect(200);

    expect(response.body).toMatchObject({
      status: 'ACTIVE',
      cancelAtPeriodEnd: false,
      scheduledChange: null,
      activeJourneyLimit: 2,
      inProgress: 1,
    });
    expect(gateway.current('sub_B')).toMatchObject({
      cancelAtPeriodEnd: false,
      scheduledPriceId: null,
    });
  });
});
