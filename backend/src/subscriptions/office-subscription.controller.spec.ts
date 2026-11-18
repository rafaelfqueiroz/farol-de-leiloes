// SPEC-012 BR-012-11, BR-012-14, AR-33..AR-36: the office billing API over HTTP with the service
// stubbed (TESTING §2): validated DTOs, explicit response mapping (money as a string, instants as
// ISO, nothing internal), the caller's own AccessContext handed to the service, and the refusals
// the service raises answered with the catalogue's status.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import request from 'supertest';
import { AccessContext } from '../access/access-context.js';
import { DomainError } from '../common/errors/domain-error.js';
import { Decimal } from '../common/money/money.js';
import { createHttpApp, TEST_USER } from '../../test/support/http-app.js';
import { testEnv } from '../../test/support/test-env.js';
import { BillingThrottlerModule } from './billing-throttler.module.js';
import { CheckoutStatusController } from './checkout-status.controller.js';
import { OfficeSubscriptionController } from './office-subscription.controller.js';
import {
  type OfficeSubscriptionView,
  SubscriptionsBillingService,
} from './subscriptions-billing.service.js';

const OFFICE = '64b7f0000000000000000c01';

const VIEW: OfficeSubscriptionView = {
  officeId: OFFICE,
  plan: {
    code: 'escritorio-5',
    name: 'Escritório 5',
    price: new Decimal('199.9'),
    interval: 'month',
  },
  status: 'CANCELING',
  activeJourneyLimit: 5,
  inProgress: 4,
  currentPeriodStart: new Date('2026-03-01T12:00:00.000Z'),
  currentPeriodEnd: new Date('2026-03-31T12:00:00.000Z'),
  cancelAtPeriodEnd: true,
  scheduledChange: {
    planCode: 'escritorio-2',
    planName: 'Escritório 2',
    activeJourneyLimit: 2,
    at: new Date('2026-03-31T12:00:00.000Z'),
  },
  lapsedAt: null,
  readOnlyAt: null,
  firstPaidAt: new Date('2026-03-01T12:00:00.000Z'),
  refundEligibleUntil: new Date('2026-03-08T12:00:00.000Z'),
  invoices: [
    {
      id: 'in_1',
      paidAt: new Date('2026-03-01T12:00:00.000Z'),
      amount: new Decimal('199.9'),
      status: 'paid',
      hostedUrl: 'https://invoice.example.test/in_1',
    },
  ],
};

describe('OfficeSubscriptionController over HTTP', () => {
  const billing = {
    view: vi.fn(),
    checkout: vi.fn(),
    changePlan: vi.fn(),
    cancel: vi.fn(),
    undoCancel: vi.fn(),
    billingPortal: vi.fn(),
    checkoutState: vi.fn(),
  };
  let app: INestApplication;
  let unverified: INestApplication;
  const server = () => app.getHttpServer() as Parameters<typeof request>[0];

  beforeAll(async () => {
    const metadata = {
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: () => testEnv() }),
        BillingThrottlerModule,
      ],
      controllers: [OfficeSubscriptionController, CheckoutStatusController],
      providers: [{ provide: SubscriptionsBillingService, useValue: billing }],
    };
    app = await createHttpApp(metadata);
    unverified = await createHttpApp(metadata, { user: { ...TEST_USER, emailVerified: false } });
  });

  afterAll(async () => {
    await app.close();
    await unverified.close();
  });

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('BR-012-11, AR-36: GET answers the plan page with money as a string, instants as ISO and nothing internal', async () => {
    billing.view.mockResolvedValue(VIEW);

    const response = await request(server()).get('/api/office/subscription').expect(200);

    expect(response.body).toEqual({
      officeId: OFFICE,
      plan: { code: 'escritorio-5', name: 'Escritório 5', price: '199.90', interval: 'month' },
      status: 'CANCELING',
      activeJourneyLimit: 5,
      inProgress: 4,
      currentPeriodStart: '2026-03-01T12:00:00.000Z',
      currentPeriodEnd: '2026-03-31T12:00:00.000Z',
      cancelAtPeriodEnd: true,
      scheduledChange: {
        planCode: 'escritorio-2',
        planName: 'Escritório 2',
        activeJourneyLimit: 2,
        at: '2026-03-31T12:00:00.000Z',
      },
      lapsedAt: null,
      readOnlyAt: null,
      firstPaidAt: '2026-03-01T12:00:00.000Z',
      refundEligibleUntil: '2026-03-08T12:00:00.000Z',
      invoices: [
        {
          id: 'in_1',
          paidAt: '2026-03-01T12:00:00.000Z',
          amount: '199.90',
          status: 'paid',
          hostedUrl: 'https://invoice.example.test/in_1',
        },
      ],
    });
  });

  it('BR-012-15: a billing history the provider could not give is null, not an empty list', async () => {
    billing.view.mockResolvedValue({ ...VIEW, invoices: null, scheduledChange: null });

    const response = await request(server()).get('/api/office/subscription').expect(200);

    expect(response.body).toMatchObject({ invoices: null, scheduledChange: null });
  });

  it('BR-002-11, AR-13: the service gets the caller own AccessContext; the office id is only a choice among its offices', async () => {
    billing.view.mockResolvedValue(VIEW);

    await request(server()).get(`/api/office/subscription?officeId=${OFFICE}`).expect(200);

    const [ctx, officeId] = billing.view.mock.calls[0] as [unknown, unknown];
    expect(ctx).toBeInstanceOf(AccessContext);
    expect((ctx as AccessContext).accountId).toBe(TEST_USER.userId);
    expect(officeId).toBe(OFFICE);
  });

  it('AR-34: an unknown query parameter is refused', async () => {
    await request(server())
      .get('/api/office/subscription?ownerId=64b7f0000000000000000c02')
      .expect(400)
      .expect({ code: 'VALIDATION_FAILED', context: { fields: ['ownerId'] } });
    expect(billing.view).not.toHaveBeenCalled();
  });

  it('AR-14: the service refusing a non-member is a 404 with the shared shape', async () => {
    billing.view.mockRejectedValue(new DomainError('NOT_FOUND'));

    await request(server())
      .get(`/api/office/subscription?officeId=${OFFICE}`)
      .expect(404, { code: 'NOT_FOUND', context: {} });
  });

  it('BR-012-10: checkout answers the hosted page URL and takes the buyer from the authenticated account', async () => {
    billing.checkout.mockResolvedValue({ url: 'https://checkout.example.test/cs_1' });

    const response = await request(server())
      .post('/api/office/subscription/checkout')
      .send({ planCode: 'escritorio-5', couponCode: 'BEMVINDO' })
      .expect(200);

    expect(response.body).toEqual({ url: 'https://checkout.example.test/cs_1' });
    expect(billing.checkout).toHaveBeenCalledWith(
      expect.any(AccessContext),
      { email: TEST_USER.email, name: TEST_USER.name },
      { planCode: 'escritorio-5', couponCode: 'BEMVINDO' },
    );
  });

  it.each([
    ['status', { status: 'ACTIVE' }],
    ['activeJourneyLimit', { activeJourneyLimit: 99 }],
    ['planId', { planId: '64b7f0000000000000000a05' }],
    ['ownerId', { ownerId: OFFICE }],
    ['stripeSubscriptionId', { stripeSubscriptionId: 'sub_1' }],
  ])(
    'BR-012-14: a request that tries to set %s is refused and reaches no service',
    async (field, extra) => {
      await request(server())
        .post('/api/office/subscription/checkout')
        .send({ planCode: 'escritorio-5', ...extra })
        .expect(400)
        .expect({ code: 'VALIDATION_FAILED', context: { fields: [field] } });
      await request(server())
        .post('/api/office/subscription/change')
        .send({ planCode: 'escritorio-5', ...extra })
        .expect(400);
      expect(billing.checkout).not.toHaveBeenCalled();
      expect(billing.changePlan).not.toHaveBeenCalled();
    },
  );

  it('AR-34: a checkout without a plan code, or with a non-string one, is refused', async () => {
    await request(server()).post('/api/office/subscription/checkout').send({}).expect(400);
    await request(server())
      .post('/api/office/subscription/checkout')
      .send({ planCode: { $ne: '' } })
      .expect(400);
    await request(server())
      .post('/api/office/subscription/change')
      .send({ planCode: 5 })
      .expect(400);
  });

  it('BR-012-16: change hands the plan code to the service and answers the plan page', async () => {
    billing.changePlan.mockResolvedValue(VIEW);

    await request(server())
      .post('/api/office/subscription/change')
      .send({ planCode: 'escritorio-10', officeId: OFFICE })
      .expect(200);

    expect(billing.changePlan).toHaveBeenCalledWith(expect.any(AccessContext), {
      planCode: 'escritorio-10',
      officeId: OFFICE,
    });
  });

  it.each([
    ['cancel', 'cancel'],
    ['undo-cancel', 'undoCancel'],
    ['billing-portal', 'billingPortal'],
  ] as const)('POST %s takes an empty body and the office choice only', async (path, method) => {
    billing[method].mockResolvedValue(
      method === 'billingPortal' ? { url: 'https://b.example.test/s' } : VIEW,
    );

    await request(server()).post(`/api/office/subscription/${path}`).send({}).expect(200);
    await request(server())
      .post(`/api/office/subscription/${path}`)
      .send({ officeId: OFFICE })
      .expect(200);
    await request(server())
      .post(`/api/office/subscription/${path}`)
      .send({ planCode: 'x' })
      .expect(400);

    expect(billing[method].mock.calls.map((call) => call[1])).toEqual([undefined, OFFICE]);
  });

  it('AR-34: an action with no body at all is the same as an empty one; an over-long office id is refused', async () => {
    billing.cancel.mockResolvedValue(VIEW);

    await request(server()).post('/api/office/subscription/cancel').expect(200);
    await request(server())
      .get(`/api/office/subscription?officeId=${'x'.repeat(65)}`)
      .expect(400);

    expect(billing.cancel).toHaveBeenCalledTimes(1);
    expect(billing.view).not.toHaveBeenCalled();
  });

  it('answers the portal URL', async () => {
    billing.billingPortal.mockResolvedValue({ url: 'https://billing.example.test/s' });

    await request(server())
      .post('/api/office/subscription/billing-portal')
      .send({})
      .expect(200, { url: 'https://billing.example.test/s' });
  });

  it.each([
    ['SUBSCRIPTION_ALREADY_ACTIVE', 409],
    ['SUBSCRIPTION_NOT_CANCELABLE', 409],
    ['SUBSCRIPTION_NOT_CHANGEABLE', 409],
    ['CHECKOUT_IN_PROGRESS', 409],
    ['OFFICE_CREATION_UNAVAILABLE', 503],
    ['BILLING_PORTAL_FAILED', 502],
    ['CHANGE_PLAN_FAILED', 502],
    ['CANCEL_IN_PROGRESS', 409],
    ['CHECKOUT_SESSION_FAILED', 502],
    ['INVALID_PLAN', 400],
    ['COUPON_INVALID', 400],
  ] as const)('answers %s with HTTP %i and its code', async (code, status) => {
    billing.checkout.mockRejectedValue(new DomainError(code));

    await request(server())
      .post('/api/office/subscription/checkout')
      .send({ planCode: 'escritorio-5' })
      .expect(status, { code, context: {} });
  });

  it('BR-001-04: an account with an unconfirmed email can use none of it', async () => {
    const guarded = unverified.getHttpServer() as Parameters<typeof request>[0];
    const expected = { code: 'EMAIL_VERIFICATION_REQUIRED', context: {} };

    await request(guarded).get('/api/office/subscription').expect(403, expected);
    await request(guarded).post('/api/office/subscription/cancel').send({}).expect(403, expected);
    await request(guarded).get('/api/subscriptions/checkout/abc/status').expect(403, expected);
  });

  it('BR-012-09: the checkout status answers only PENDING or CONFIRMED, for the caller', async () => {
    billing.checkoutState.mockResolvedValue('PENDING');

    await request(server())
      .get('/api/subscriptions/checkout/64b7f0000000000000000d01/status')
      .expect(200, { state: 'PENDING' });

    const [ctx, ref] = billing.checkoutState.mock.calls[0] as [AccessContext, string];
    expect(ctx.accountId).toBe(TEST_USER.userId);
    expect(ref).toBe('64b7f0000000000000000d01');
  });

  it('AR-14: another account ref is the shared 404', async () => {
    billing.checkoutState.mockRejectedValue(new DomainError('NOT_FOUND'));

    await request(server())
      .get('/api/subscriptions/checkout/64b7f0000000000000000d01/status')
      .expect(404, { code: 'NOT_FOUND', context: {} });
  });
});
