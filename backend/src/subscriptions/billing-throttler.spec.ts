// SPEC-012 (SC-04): the office billing routes are limited per ACCOUNT. Every call can reach the
// payment provider, so one signed-in caller in a loop must not use up the provider's rate limit.
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHttpApp } from '../../test/support/http-app.js';
import { testEnv } from '../../test/support/test-env.js';
import {
  AccountThrottlerGuard,
  BILLING_RATE_LIMIT,
  BillingThrottlerModule,
} from './billing-throttler.module.js';
import { CheckoutStatusController } from './checkout-status.controller.js';
import { OfficeSubscriptionController } from './office-subscription.controller.js';
import { SubscriptionsBillingService } from './subscriptions-billing.service.js';

let app: INestApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function boot(nodeEnv: string) {
  app = await createHttpApp(
    {
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: () => testEnv({ NODE_ENV: nodeEnv }),
        }),
        BillingThrottlerModule,
      ],
      controllers: [OfficeSubscriptionController, CheckoutStatusController],
      providers: [
        {
          provide: SubscriptionsBillingService,
          useValue: { checkoutState: () => Promise.resolve('PENDING') },
        },
      ],
    },
    { env: { NODE_ENV: nodeEnv } },
  );
  return app.getHttpServer() as Parameters<typeof request>[0];
}

/** Exposes the tracker the guard keys the limit by. */
class Probe extends AccountThrottlerGuard {
  key(req: Record<string, unknown>): Promise<string> {
    return this.getTracker(req);
  }
}

describe('billing route throttling (SC-04)', () => {
  it('is 60 a minute per account', () => {
    expect(BILLING_RATE_LIMIT).toEqual({ limit: 60, ttl: 60_000 });
  });

  it('answers 429 TOO_MANY_REQUESTS to the 61st request of one account, on any billing route', async () => {
    const server = await boot('development');
    for (let i = 0; i < BILLING_RATE_LIMIT.limit; i += 1) {
      await request(server).get('/api/subscriptions/checkout/abc/status').expect(200);
    }

    const refused = await request(server)
      .post('/api/office/subscription/cancel')
      .send({})
      .expect(429);

    expect(refused.body).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('does not throttle under test, where specs share one account', async () => {
    const server = await boot('test');
    for (let i = 0; i < BILLING_RATE_LIMIT.limit + 5; i += 1) {
      await request(server).get('/api/subscriptions/checkout/abc/status').expect(200);
    }
  });

  it('keys the limit by the authenticated account, not the address; an anonymous request falls back to the address', async () => {
    const probe = Object.create(Probe.prototype) as Probe;

    expect(await probe.key({ user: { userId: 'u1' }, ip: '10.0.0.1' })).toBe('account:u1');
    expect(await probe.key({ user: { userId: 'u2' }, ip: '10.0.0.1' })).toBe('account:u2');
    expect(await probe.key({ ip: '10.0.0.1' })).toBe('10.0.0.1');
    expect(await probe.key({ user: {} })).toBe('unknown');
  });
});
