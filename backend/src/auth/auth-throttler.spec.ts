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

async function boot(nodeEnv: string, trustProxyHops = '0') {
  app = await createHttpApp(
    {
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: () => testEnv({ NODE_ENV: nodeEnv, TRUST_PROXY_HOPS: trustProxyHops }),
        }),
        AuthThrottlerModule,
      ],
      controllers: [AuthController],
      providers: [{ provide: AuthService, useValue: {} }],
    },
    { env: { NODE_ENV: nodeEnv, TRUST_PROXY_HOPS: trustProxyHops } },
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

// SC-04, #151: the BFF forwards Caddy's X-Forwarded-For and the app, with configureApp's real
// trust-proxy setting, takes the client from it by hop count alone. Every request below comes from
// one socket (the "BFF"); only the forwarded chain tells the clients apart.
describe('auth route throttling behind the BFF (SC-04, TRUST_PROXY_HOPS)', () => {
  const path = '/api/auth/register';
  const exhaust = async (
    server: ReturnType<typeof request> extends never ? never : Parameters<typeof request>[0],
    chain: (i: number) => string,
  ) => {
    for (let i = 0; i < AUTH_RATE_LIMIT.limit; i += 1) {
      await request(server).post(path).set('X-Forwarded-For', chain(i)).send({}).expect(400);
    }
  };

  it('counts two clients behind one BFF socket separately with one trusted hop', async () => {
    const server = await boot('development', '1');
    await exhaust(server, () => '203.0.113.10');

    const refused = await request(server)
      .post(path)
      .set('X-Forwarded-For', '203.0.113.10')
      .send({})
      .expect(429);
    expect(refused.body).toEqual({ code: 'TOO_MANY_REQUESTS', context: {} });
    await request(server).post(path).set('X-Forwarded-For', '203.0.113.11').send({}).expect(400);
  });

  it('takes the right-most entry: a prepended address does not dodge the counter', async () => {
    const server = await boot('development', '1');
    // The client rotates a fake leading entry on every request; Caddy's real entry stays last.
    await exhaust(server, (i) => `198.51.100.${i + 1}, 203.0.113.10`);

    await request(server)
      .post(path)
      .set('X-Forwarded-For', '198.51.100.250, 203.0.113.10')
      .send({})
      .expect(429);
    await request(server)
      .post(path)
      .set('X-Forwarded-For', '198.51.100.250, 203.0.113.11')
      .send({})
      .expect(400);
  });

  it('ignores X-Forwarded-For with 0 hops: every request counts as the socket address', async () => {
    const server = await boot('development', '0');
    await exhaust(server, (i) => `203.0.113.${i + 1}`);

    await request(server).post(path).set('X-Forwarded-For', '203.0.113.200').send({}).expect(429);
  });
});
