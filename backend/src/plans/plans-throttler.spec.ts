// SPEC-012 BR-012-05 / SC-04: a coarse per-origin flood guard on the public plans listing, with the
// service stubbed. 300 requests a minute from one origin are served; the 301st is TOO_MANY_REQUESTS.
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHttpApp } from '../../test/support/http-app.js';
import { testEnv } from '../../test/support/test-env.js';
import { PlansController } from './plans.controller.js';
import { PLANS_RATE_LIMIT, PlansThrottlerModule } from './plans-throttler.module.js';
import { PlansService } from './plans.service.js';

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
        PlansThrottlerModule,
      ],
      controllers: [PlansController],
      providers: [{ provide: PlansService, useValue: { listOffered: () => Promise.resolve([]) } }],
    },
    { env: { NODE_ENV: nodeEnv } },
  );
  return app.getHttpServer() as Parameters<typeof request>[0];
}

describe('plans listing throttling (SC-04)', () => {
  it('is a coarse 300 per minute', () => {
    expect(PLANS_RATE_LIMIT).toEqual({ limit: 300, ttl: 60_000 });
  });

  it('answers 429 TOO_MANY_REQUESTS to the 301st request from one origin', async () => {
    const server = await boot('development');
    for (let i = 0; i < PLANS_RATE_LIMIT.limit; i += 1) {
      await request(server).get('/api/plans').expect(200);
    }

    const refused = await request(server).get('/api/plans').expect(429);

    expect(refused.body).toMatchObject({ code: 'TOO_MANY_REQUESTS' });
  });

  it('does not throttle under test, where specs share one loopback address', async () => {
    const server = await boot('test');
    for (let i = 0; i < PLANS_RATE_LIMIT.limit + 5; i += 1) {
      await request(server).get('/api/plans').expect(200);
    }
  });
});
