// SC-04, BR-001-15, #151: the sign-in origin counter behind the Next.js BFF, through the HTTP API on
// a real MongoDB (TESTING §2). In production the BFF is the socket peer of every browser request
// and forwards Caddy's X-Forwarded-For chain unchanged; the backend, with configureApp's real
// trust-proxy setting, takes the client from the chain by hop count alone. Here every request comes
// from one loopback socket (the "BFF") and only the forwarded chain tells the clients apart.
//
// Each attempt uses a fresh, unknown email, so the per-email counter never trips: only the origin
// key can collide. The fake clock starts in 2099 so MongoDB's TTL monitor never reaps a row.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConfigModule } from '@nestjs/config';
import { getConnectionToken, MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import type { Connection } from 'mongoose';
import request from 'supertest';
import { configureApp } from '../../src/app.setup.js';
import { AuthModule } from '../../src/auth/auth.module.js';
import { LOGIN_ATTEMPT_RULE } from '../../src/auth/login-attempts/login-attempts.service.js';
import { Clock } from '../../src/common/clock/clock.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { EmailService } from '../../src/email/email.service.js';
import { FakeClock } from '../fakes/fake-clock.js';
import { FakeEmailSender } from '../fakes/fake-email-sender.js';
import { useTestDatabase } from '../support/test-database.js';
import { testEnv } from '../support/test-env.js';

describe('SC-04: sign-in origin behind the BFF (integration)', () => {
  const db = useTestDatabase();
  const clock = new FakeClock(new Date('2099-01-15T12:00:00.000Z'));
  const apps: INestApplication[] = [];
  let counter = 0;
  let connection: Connection;

  /** One app per proxy-hop setting, all on the same database and so on disjoint addresses. */
  async function bootApp(trustProxyHops: string): Promise<(chain: string) => request.Test> {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: () => testEnv({ TRUST_PROXY_HOPS: trustProxyHops }),
        }),
        MongooseModule.forRoot(db.uri),
        AuthModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .overrideProvider(EmailService)
      .useValue(new FakeEmailSender())
      .compile();
    const app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    apps.push(app);
    connection = moduleRef.get(getConnectionToken());
    await connection.syncIndexes();
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    return (chain) => {
      counter += 1;
      const attempt = request(server)
        .post('/api/auth/login')
        .send({ email: `guess-${counter}@example.test`, password: 'wrong password' });
      return chain === '' ? attempt : attempt.set('X-Forwarded-For', chain);
    };
  }

  const origin = (key: string) => connection.db?.collection('loginAttempts').findOne({ key });

  /** `limit` wrong guesses, each from `chain(i)`; all are compared and answered 401. */
  async function guess(
    signIn: (chain: string) => request.Test,
    chain: (i: number) => string,
    times = LOGIN_ATTEMPT_RULE.limit,
  ) {
    for (let i = 0; i < times; i += 1) {
      await signIn(chain(i)).expect(401);
    }
  }

  beforeAll(() => {
    applyMongooseDefaults();
  });

  afterAll(async () => {
    await Promise.all(apps.map((app) => app.close()));
  });

  describe('one trusted hop (Caddy in front of the BFF)', () => {
    let behindBff: (chain: string) => request.Test;

    beforeAll(async () => {
      behindBff = await bootApp('1');
    });

    it('counts two clients behind the same BFF socket separately', async () => {
      const first = '203.0.113.10';
      const second = '203.0.113.11';
      await guess(behindBff, () => first);

      const refused = await behindBff(first).expect(429);
      expect(refused.body).toEqual({ code: 'TOO_MANY_ATTEMPTS', context: {} });
      // The other client, same socket, another email: untouched by the first one's ban.
      await behindBff(second).expect(401);
      expect(await origin(`ip:${first}`)).toMatchObject({ count: LOGIN_ATTEMPT_RULE.limit + 1 });
      expect(await origin(`ip:${second}`)).toMatchObject({ count: 1 });
    });

    it('takes the right-most entry: a prepended address does not shed the client counter', async () => {
      const real = '203.0.113.20';
      // The client rotates a made-up leading entry on every request; Caddy's entry stays last.
      await guess(behindBff, (i) => `198.51.100.${i + 1}, ${real}`);

      await behindBff(`198.51.100.250, ${real}`).expect(429);
      await behindBff(real).expect(429); // the same client, without the prefix
      expect(await origin(`ip:${real}`)).toMatchObject({ count: LOGIN_ATTEMPT_RULE.limit + 1 });
      for (let i = 1; i <= 10; i += 1) {
        expect(await origin(`ip:198.51.100.${i}`)).toBeNull();
      }
      expect(await origin('ip:198.51.100.250')).toBeNull();
    });

    it('keeps two IPv6 clients of one /64 in one bucket, and another /64 apart', async () => {
      const addresses = ['2001:db8:a:b::1', '2001:db8:a:b:ffff:ffff:ffff:ffff'];
      await guess(behindBff, (i) => addresses[i % 2] ?? '');

      await behindBff(addresses[0] ?? '').expect(429);
      await behindBff(addresses[1] ?? '').expect(429);
      await behindBff('2001:db8:a:c::1').expect(401);
    });
  });

  describe('no trusted hop (API reachable directly)', () => {
    it('ignores X-Forwarded-For: every request counts as the socket address', async () => {
      const direct = await bootApp('0');
      await guess(direct, (i) => `203.0.113.${100 + i}`);

      await direct('203.0.113.200').expect(429);
      await direct('').expect(429);
      expect(await origin('ip:127.0.0.1')).toMatchObject({ count: LOGIN_ATTEMPT_RULE.limit + 1 });
      expect(await origin('ip:203.0.113.100')).toBeNull();
    });
  });
});
