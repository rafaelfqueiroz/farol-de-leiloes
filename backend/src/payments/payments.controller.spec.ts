import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type INestApplication, RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { Request } from 'express';
import Stripe from 'stripe';
import request from 'supertest';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';
import { UsersService } from '../users/users.service.js';
import { CouponsService } from '../coupons/coupons.service.js';
import { PaymentGateway } from './payment-gateway.js';
import { StripePaymentGateway } from './adapters/stripe-payment-gateway.js';
import { DomainError } from '../common/errors/domain-error.js';
import { configureApp } from '../app.setup.js';
import { testConfigService, TEST_ENV } from '../../test/support/test-env.js';

describe('Stripe webhook', () => {
  it('rejects a request without a raw body as an invalid signature (DV-03)', async () => {
    const paymentsService = { handleWebhook: vi.fn() };
    const controller = new PaymentsController(paymentsService as unknown as PaymentsService);
    const req = { rawBody: undefined } as RawBodyRequest<Request>;

    await expect(controller.handleWebhook(req, 'signature')).rejects.toEqual(
      new DomainError('INVALID_WEBHOOK_SIGNATURE'),
    );
    expect(paymentsService.handleWebhook).not.toHaveBeenCalled();
  });
});

// The webhook over HTTP, through the real Nest + Express 5 stack (#61) and the real Stripe
// signature check (the StripePaymentGateway adapter behind the PaymentGateway port, AR-10): the signature covers the exact bytes Stripe sent, so this proves `rawBody`
// (main.ts) still hands the service the unparsed body, and that a request with no body — where
// Express 5 leaves `req.body` undefined — is refused, never processed. supertest binds an
// ephemeral loopback port in this process; no request leaves the machine and Stripe is never
// called: `constructEvent` and the test header are computed locally (TS-07).
describe('Stripe webhook over HTTP (raw body, Express 5)', () => {
  // Test values only (test/support/test-env.ts): a fake key Stripe never sees, and a local
  // signing secret.
  const stripe = new Stripe(TEST_ENV.STRIPE_SECRET_KEY);
  const usersService = { update: vi.fn() };
  let app: INestApplication;

  // Deliberately not canonical JSON (spacing, newline): re-serialising it would break the
  // signature, so only the raw bytes verify.
  const payload =
    '{ "id": "evt_1", "object": "event", "type": "checkout.session.completed",\n' +
    '  "data": { "object": { "object": "checkout.session", "subscription": "sub_1",' +
    ' "metadata": { "userId": "user-1" } } } }';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        PaymentsService,
        { provide: PaymentGateway, useClass: StripePaymentGateway },
        { provide: ConfigService, useValue: testConfigService() },
        { provide: UsersService, useValue: usersService },
        { provide: CouponsService, useValue: {} },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true }); // as in main.ts
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('verifies the signature over the raw body and processes the event', async () => {
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: TEST_ENV.STRIPE_WEBHOOK_SECRET,
    });

    await request(app.getHttpServer())
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json; charset=utf-8')
      .set('Stripe-Signature', signature)
      .send(payload)
      .expect(200, { received: true });

    expect(usersService.update).toHaveBeenCalledWith('user-1', {
      stripeSubscriptionId: 'sub_1',
      subscriptionStatus: 'active',
      role: 'standard',
    });
  });

  it('refuses a body that differs from the signed one', async () => {
    const signature = stripe.webhooks.generateTestHeaderString({
      payload,
      secret: TEST_ENV.STRIPE_WEBHOOK_SECRET,
    });

    await request(app.getHttpServer())
      .post('/api/payments/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', signature)
      .send(JSON.stringify(JSON.parse(payload)))
      .expect(400, { code: 'INVALID_WEBHOOK_SIGNATURE', context: {} });

    expect(usersService.update).not.toHaveBeenCalled();
  });

  it('refuses a request with no body (Express 5 leaves req.body undefined)', async () => {
    await request(app.getHttpServer())
      .post('/api/payments/webhook')
      .set('Stripe-Signature', 't=1,v1=00')
      .expect(400, { code: 'INVALID_WEBHOOK_SIGNATURE', context: {} });

    expect(usersService.update).not.toHaveBeenCalled();
  });
});
