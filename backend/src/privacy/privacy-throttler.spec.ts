// SPEC-010 (SC-04): the consent write routes are limited per ACCOUNT, not per address.
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHttpApp, TEST_USER } from '../../test/support/http-app.js';
import { testEnv } from '../../test/support/test-env.js';
import { ConsentsService } from './consents.service.js';
import { PrivacyController } from './privacy.controller.js';
import {
  PRIVACY_RATE_LIMIT,
  PrivacyAccountThrottlerGuard,
  PrivacyThrottlerModule,
} from './privacy-throttler.module.js';
import { WhatsappConsentService } from './whatsapp-consent.service.js';

let app: INestApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

async function boot(nodeEnv: string, user = TEST_USER) {
  app = await createHttpApp(
    {
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: () => testEnv({ NODE_ENV: nodeEnv }),
        }),
        PrivacyThrottlerModule,
      ],
      controllers: [PrivacyController],
      providers: [
        PrivacyAccountThrottlerGuard,
        { provide: ConsentsService, useValue: { accept: () => Promise.resolve([]) } },
        {
          provide: WhatsappConsentService,
          useValue: {
            current: () => Promise.resolve({ state: 'none', at: null, textVersion: null }),
            record: () => Promise.resolve({ state: 'granted', at: null, textVersion: '0.1' }),
          },
        },
      ],
    },
    { env: { NODE_ENV: nodeEnv }, user },
  );
  return app.getHttpServer() as Parameters<typeof request>[0];
}

const answer = (server: Parameters<typeof request>[0]) =>
  request(server)
    .post('/api/privacy/whatsapp-consent')
    .send({ action: 'granted', method: 'privacy_page' });

describe('consent write routes throttling (SC-04)', () => {
  it('is 30 a minute per account', () => {
    expect(PRIVACY_RATE_LIMIT).toEqual({ limit: 30, ttl: 60_000 });
  });

  it('answers 429 TOO_MANY_REQUESTS to the 31st write of one account, across both routes', async () => {
    const server = await boot('development');
    for (let i = 0; i < PRIVACY_RATE_LIMIT.limit - 1; i += 1) await answer(server).expect(200);
    await request(server)
      .post('/api/privacy/accept')
      .send({ termsVersion: '0.1', privacyVersion: '0.1' })
      .expect(200); // the 30th, on the other route: one counter per account

    const response = await answer(server).expect(429);

    expect(response.body).toEqual({ code: 'TOO_MANY_REQUESTS', context: {} });
  });

  it('counts accounts apart: another account behind the same address is not limited', async () => {
    const server = await boot('development');
    for (let i = 0; i < PRIVACY_RATE_LIMIT.limit; i += 1) await answer(server).expect(200);
    await answer(server).expect(429);
    await app?.close();

    const other = await boot('development', { ...TEST_USER, userId: '64b7f0000000000000000002' });
    await answer(other).expect(200);
  });

  it('does not limit the reads', async () => {
    const server = await boot('development');
    for (let i = 0; i < PRIVACY_RATE_LIMIT.limit + 5; i += 1) {
      await request(server).get('/api/privacy/whatsapp-consent').expect(200);
    }
  });

  it('stands down under NODE_ENV=test so unrelated specs share one account', async () => {
    const server = await boot('test');
    for (let i = 0; i < PRIVACY_RATE_LIMIT.limit + 2; i += 1) await answer(server).expect(200);
  });
});
