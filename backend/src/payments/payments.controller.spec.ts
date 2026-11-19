// SC-11 / BR-012-14: the webhook is the only route of the payments controller, and it hands the
// raw body to SubscriptionsService, which verifies the signature and handles the event.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { type INestApplication, RawBodyRequest } from '@nestjs/common';
import { PATH_METADATA } from '@nestjs/common/constants';
import { Test } from '@nestjs/testing';
import { Request } from 'express';
import Stripe from 'stripe';
import request from 'supertest';
import { PaymentsController } from './payments.controller.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { PaymentGateway } from './payment-gateway.js';
import { StripePaymentGateway } from './adapters/stripe-payment-gateway.js';
import { DomainError } from '../common/errors/domain-error.js';
import { configureApp } from '../app.setup.js';
import { testConfigService, TEST_ENV } from '../../test/support/test-env.js';
import { ConfigService } from '@nestjs/config';

describe('Stripe webhook', () => {
  it('rejects a request without a raw body as an invalid signature (DV-03)', async () => {
    const subscriptions = { handleWebhook: vi.fn() };
    const controller = new PaymentsController(subscriptions as unknown as SubscriptionsService);
    const req = { rawBody: undefined } as RawBodyRequest<Request>;

    await expect(controller.handleWebhook(req, 'signature')).rejects.toEqual(
      new DomainError('INVALID_WEBHOOK_SIGNATURE'),
    );
    expect(subscriptions.handleWebhook).not.toHaveBeenCalled();
  });

  it('BR-012-14: the controller has no route but the webhook (no user endpoint sets a plan)', () => {
    const handlers = Object.getOwnPropertyNames(PaymentsController.prototype).filter(
      (name) => name !== 'constructor',
    );
    expect(handlers).toEqual(['handleWebhook']);
    expect(Reflect.getMetadata(PATH_METADATA, PaymentsController.prototype.handleWebhook)).toBe(
      'webhook',
    );
  });
});

// The webhook over HTTP, through the real Nest + Express 5 stack (#61) and the real Stripe
// signature check (the StripePaymentGateway adapter behind the PaymentGateway port, AR-10): the
// signature covers the exact bytes Stripe sent, so this proves `rawBody` (main.ts) still hands the
// service the unparsed body, and that a request with no body — where Express 5 leaves `req.body`
// undefined — is refused, never processed. supertest binds an ephemeral loopback port in this
// process; no request leaves the machine and Stripe is never called: `constructEvent` and the test
// header are computed locally (TS-07). SubscriptionsService is the real one in its own spec; here
// it is a stub that applies the port's own signature check, as it does.
describe('Stripe webhook over HTTP (raw body, Express 5)', () => {
  // Test values only (test/support/test-env.ts): a fake key Stripe never sees, and a local
  // signing secret.
  const stripe = new Stripe(TEST_ENV.STRIPE_SECRET_KEY);
  const handled = vi.fn();
  let app: INestApplication;

  // Deliberately not canonical JSON (spacing, newline): re-serialising it would break the
  // signature, so only the raw bytes verify.
  const payload =
    '{ "id": "evt_1", "object": "event", "type": "checkout.session.completed", "livemode": false,\n' +
    '  "data": { "object": { "object": "checkout.session", "subscription": "sub_1",' +
    ' "metadata": { "subscriptionRef": "64b7f0000000000000000099" } } } }';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [PaymentsController],
      providers: [
        { provide: PaymentGateway, useClass: StripePaymentGateway },
        { provide: ConfigService, useValue: testConfigService() },
        {
          provide: SubscriptionsService,
          inject: [PaymentGateway],
          useFactory: (gateway: PaymentGateway) => ({
            handleWebhook: (rawBody: Buffer, signature: string) => {
              try {
                handled(gateway.parseWebhookEvent(rawBody, signature));
              } catch {
                throw new DomainError('INVALID_WEBHOOK_SIGNATURE');
              }
              return Promise.resolve();
            },
          }),
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication({ rawBody: true }); // as in main.ts
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('verifies the signature over the raw body and hands the mapped event to the service', async () => {
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

    expect(handled).toHaveBeenCalledWith({
      id: 'evt_1',
      type: 'checkout.completed',
      subscriptionId: 'sub_1',
      subscriptionRef: '64b7f0000000000000000099',
    });
  });

  it('refuses a body that differs from the signed one', async () => {
    handled.mockClear();
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

    expect(handled).not.toHaveBeenCalled();
  });

  it('refuses a request with no body (Express 5 leaves req.body undefined)', async () => {
    handled.mockClear();
    await request(app.getHttpServer())
      .post('/api/payments/webhook')
      .set('Stripe-Signature', 't=1,v1=00')
      .expect(400, { code: 'INVALID_WEBHOOK_SIGNATURE', context: {} });

    expect(handled).not.toHaveBeenCalled();
  });
});
