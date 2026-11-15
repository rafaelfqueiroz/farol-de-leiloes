// HTTP contract of the signed-in payment endpoints (TESTING §2): the owner handed to the service
// is the signed-in user, bodies are validated, and the responses carry only the DTO fields, with
// PaymentsService stubbed. The webhook has its own spec (payments.controller.spec.ts).
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { DomainError } from '../common/errors/domain-error.js';
import { createHttpApp, TEST_USER } from '../../test/support/http-app.js';

describe('PaymentsController over HTTP', () => {
  const payments = {
    createCheckoutSession: vi.fn(),
    getSubscriptionStatus: vi.fn(),
    cancelSubscription: vi.fn(),
  };
  let app: INestApplication;

  beforeAll(async () => {
    app = await createHttpApp({
      controllers: [PaymentsController],
      providers: [{ provide: PaymentsService, useValue: payments }],
    });
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    payments.createCheckoutSession.mockResolvedValue({
      url: 'https://checkout.example.test/s/1',
      sessionId: 'cs_internal',
    });
    payments.getSubscriptionStatus.mockResolvedValue({
      role: 'standard',
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_1',
      internal: 'x',
    });
    payments.cancelSubscription.mockResolvedValue(undefined);
  });

  it('POST create-checkout-session opens a session for the signed-in user and answers its URL only', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/payments/create-checkout-session')
      .send({ planId: 'standard', couponCode: 'BEMVINDO' })
      .expect(201);

    expect(payments.createCheckoutSession).toHaveBeenCalledWith(
      TEST_USER.userId,
      TEST_USER.email,
      'standard',
      'BEMVINDO',
    );
    expect(res.body).toEqual({ url: 'https://checkout.example.test/s/1' });
  });

  it('POST create-checkout-session passes no coupon when none is sent', async () => {
    await request(app.getHttpServer())
      .post('/api/payments/create-checkout-session')
      .send({ planId: 'standard' })
      .expect(201);

    expect(payments.createCheckoutSession).toHaveBeenCalledWith(
      TEST_USER.userId,
      TEST_USER.email,
      'standard',
      undefined,
    );
  });

  it('POST create-checkout-session refuses an empty plan id', async () => {
    await request(app.getHttpServer())
      .post('/api/payments/create-checkout-session')
      .send({ planId: '' })
      .expect(400);

    expect(payments.createCheckoutSession).not.toHaveBeenCalled();
  });

  it('POST create-checkout-session answers 400 INVALID_PLAN for a plan the service refuses', async () => {
    payments.createCheckoutSession.mockRejectedValue(new DomainError('INVALID_PLAN'));

    const res = await request(app.getHttpServer())
      .post('/api/payments/create-checkout-session')
      .send({ planId: 'platinum' })
      .expect(400);

    expect(res.body).toEqual({ code: 'INVALID_PLAN', context: {} });
  });

  it('GET subscription-status answers the plan fields of the signed-in user and nothing else', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/payments/subscription-status')
      .expect(200);

    expect(payments.getSubscriptionStatus).toHaveBeenCalledWith(TEST_USER.userId);
    expect(res.body).toEqual({
      role: 'standard',
      subscriptionStatus: 'active',
      stripeSubscriptionId: 'sub_1',
    });
  });

  it('POST cancel-subscription cancels for the signed-in user and answers 200 with a message', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/payments/cancel-subscription')
      .expect(200);

    expect(payments.cancelSubscription).toHaveBeenCalledWith(TEST_USER.userId);
    expect(res.body).toEqual({ message: 'Assinatura cancelada com sucesso' });
  });
});
