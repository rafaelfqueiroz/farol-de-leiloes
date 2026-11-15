// SC-04: the coarse per-origin limit on sign-up, recovery request, reset and confirmation resend.
// The limit counts before validation (guards run first), so malformed bodies are enough to reach it.
import { ConfigModule } from '@nestjs/config';
import type { INestApplication } from '@nestjs/common';
import { afterEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHttpApp } from '../../test/support/http-app.js';
import { testEnv } from '../../test/support/test-env.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AUTH_RATE_LIMIT, AuthThrottlerModule } from './auth-throttler.module.js';

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
        AuthThrottlerModule,
      ],
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: {} }],
    },
    { env: { NODE_ENV: nodeEnv } },
  );
  return app.getHttpServer() as Parameters<typeof request>[0];
}

describe('auth route throttling (SC-04)', () => {
  it('is a coarse 20 per 15 minutes', () => {
    expect(AUTH_RATE_LIMIT).toEqual({ limit: 20, ttl: 15 * 60 * 1000 });
  });

  it.each(['/api/auth/register', '/api/auth/reset-password-request', '/api/auth/reset-password'])(
    'answers 429 TOO_MANY_REQUESTS to the 21st request from one origin on %s',
    async (path) => {
      const server = await boot('development');
      for (let i = 0; i < AUTH_RATE_LIMIT.limit; i += 1) {
        await request(server).post(path).send({}).expect(400);
      }

      const response = await request(server).post(path).send({}).expect(429);

      expect(response.body).toEqual({ code: 'TOO_MANY_REQUESTS', context: {} });
    },
  );

  it('counts each route on its own', async () => {
    const server = await boot('development');
    for (let i = 0; i < AUTH_RATE_LIMIT.limit; i += 1) {
      await request(server).post('/api/auth/register').send({}).expect(400);
    }

    await request(server).post('/api/auth/reset-password-request').send({}).expect(400);
  });

  it('does not throttle sign-in here: BR-001-15 owns it', async () => {
    const server = await boot('development');
    for (let i = 0; i < AUTH_RATE_LIMIT.limit + 5; i += 1) {
      await request(server).post('/api/auth/login').send({}).expect(400);
    }
  });

  it('stands down under NODE_ENV=test so unrelated specs share one loopback address', async () => {
    const server = await boot('test');
    for (let i = 0; i < AUTH_RATE_LIMIT.limit + 5; i += 1) {
      await request(server).post('/api/auth/register').send({}).expect(400);
    }
  });
});
