// SPEC-009 (decision 6 of #9, SC-04): opening a support request is limited per ACCOUNT, 5 an hour.
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import request from 'supertest';
import { createHttpApp, TEST_USER } from '../../test/support/http-app.js';
import { testEnv } from '../../test/support/test-env.js';
import type { SupportRequestRecord } from './support-requests.repository.js';
import { SupportContactController } from './support-contact.controller.js';
import { SupportController } from './support.controller.js';
import { SupportService } from './support.service.js';
import {
  SUPPORT_RATE_LIMIT,
  SupportAccountThrottlerGuard,
  SupportThrottlerModule,
} from './support-throttler.module.js';

let app: INestApplication | undefined;

afterEach(async () => {
  await app?.close();
  app = undefined;
});

const stored = (): SupportRequestRecord => ({
  _id: new Types.ObjectId('64b7f00000000000000a0001'),
  userId: new Types.ObjectId(TEST_USER.userId),
  protocol: 'FL-2099-000001',
  subject: 'Assunto ficticio',
  message: 'Mensagem ficticia de teste',
  allowDataAccess: false,
  status: 'open',
  mailAttempts: 0,
  createdAt: new Date('2099-01-15T12:00:00.000Z'),
  updatedAt: new Date('2099-01-15T12:00:00.000Z'),
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
        SupportThrottlerModule,
      ],
      controllers: [SupportController, SupportContactController],
      providers: [
        SupportAccountThrottlerGuard,
        {
          provide: SupportService,
          useValue: {
            create: () => Promise.resolve({ request: stored(), confirmationSent: true }),
            listMine: () => Promise.resolve({ items: [], total: 0, page: 1, pageSize: 20 }),
            contactEmail: vi.fn().mockReturnValue('suporte-ficticio@example.test'),
          },
        },
      ],
    },
    { env: { NODE_ENV: nodeEnv }, user },
  );
  return app.getHttpServer() as Parameters<typeof request>[0];
}

const open = (server: Parameters<typeof request>[0]) =>
  request(server)
    .post('/api/support')
    .send({ subject: 'Assunto valido', message: 'Mensagem valida de teste.' });

describe('support request throttling (SC-04)', () => {
  it('is 5 an hour per account', () => {
    expect(SUPPORT_RATE_LIMIT).toEqual({ limit: 5, ttl: 3_600_000 });
  });

  it('answers 429 TOO_MANY_REQUESTS to the 6th request of one account in the hour', async () => {
    const server = await boot('development');
    for (let i = 0; i < SUPPORT_RATE_LIMIT.limit; i += 1) await open(server).expect(201);

    const response = await open(server).expect(429);

    expect(response.body).toEqual({ code: 'TOO_MANY_REQUESTS', context: {} });
  });

  it('counts accounts apart: another account behind the same address is not limited', async () => {
    const server = await boot('development');
    for (let i = 0; i < SUPPORT_RATE_LIMIT.limit; i += 1) await open(server).expect(201);
    await open(server).expect(429);
    await app?.close();

    const other = await boot('development', { ...TEST_USER, userId: '64b7f0000000000000000002' });
    await open(other).expect(201);
  });

  it('does not limit the reads or the public address', async () => {
    const server = await boot('development');
    for (let i = 0; i < SUPPORT_RATE_LIMIT.limit + 3; i += 1) {
      await request(server).get('/api/support/mine').expect(200);
      await request(server).get('/api/support/contact').expect(200);
    }
  });

  it('stands down under NODE_ENV=test so unrelated specs share one account', async () => {
    const server = await boot('test');
    for (let i = 0; i < SUPPORT_RATE_LIMIT.limit + 2; i += 1) await open(server).expect(201);
  });
});
