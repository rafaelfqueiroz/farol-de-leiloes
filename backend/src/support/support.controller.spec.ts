// HTTP contract of the support routes (TESTING §2): body validation (BR-009-05, BR-009-08), the
// requester being the signed-in account (BR-002-11), the answers mapped field by field (AR-36) and the
// public contact address (BR-009-03), with SupportService stubbed.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Types } from 'mongoose';
import request from 'supertest';
import { createHttpApp, TEST_USER } from '../../test/support/http-app.js';
import { testEnv } from '../../test/support/test-env.js';
import type { SupportRequestRecord } from './support-requests.repository.js';
import { SupportContactController } from './support-contact.controller.js';
import { SupportController } from './support.controller.js';
import { SupportService } from './support.service.js';
import {
  SupportAccountThrottlerGuard,
  SupportThrottlerModule,
} from './support-throttler.module.js';

const OPENED_AT = new Date('2099-01-15T12:00:00.000Z');
const REQUEST_ID = new Types.ObjectId('64b7f00000000000000a0001');

function stored(rest: Partial<SupportRequestRecord> = {}): SupportRequestRecord {
  return {
    _id: REQUEST_ID,
    userId: new Types.ObjectId(TEST_USER.userId),
    protocol: 'FL-2099-000007',
    subject: 'Assunto ficticio',
    message: 'Mensagem ficticia de teste',
    allowDataAccess: false,
    status: 'open',
    // Platform state that must never leave the API (AR-36).
    mailAttempts: 3,
    mailClaimToken: 'claim-token-secreto',
    mailNextAttemptAt: OPENED_AT,
    createdAt: OPENED_AT,
    updatedAt: OPENED_AT,
    ...rest,
  };
}

describe('support routes over HTTP', () => {
  const support = {
    create: vi.fn(),
    listMine: vi.fn(),
    getMine: vi.fn(),
    withdrawDataAccess: vi.fn(),
    contactEmail: vi.fn(),
  };
  let app: INestApplication;
  let server: Parameters<typeof request>[0];

  beforeAll(async () => {
    app = await createHttpApp({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true, validate: () => testEnv() }),
        SupportThrottlerModule,
      ],
      controllers: [SupportController, SupportContactController],
      providers: [SupportAccountThrottlerGuard, { provide: SupportService, useValue: support }],
    });
    server = app.getHttpServer() as Parameters<typeof request>[0];
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    support.create.mockResolvedValue({ request: stored(), confirmationSent: true });
    support.listMine.mockResolvedValue({ items: [stored()], total: 1, page: 1, pageSize: 20 });
    support.getMine.mockResolvedValue(stored());
    support.withdrawDataAccess.mockResolvedValue(stored());
    support.contactEmail.mockReturnValue('suporte-ficticio@example.test');
  });

  describe('POST /api/support (BR-009-04..BR-009-08)', () => {
    const valid = { subject: 'Nao consigo entrar', message: 'A tela de entrada falha para mim.' };

    it('opens the request of the signed-in account with the permission off by default, and answers 201', async () => {
      const res = await request(server).post('/api/support').send(valid).expect(201);

      expect(support.create).toHaveBeenCalledTimes(1);
      const [ctx, dto] = support.create.mock.calls[0] as [{ accountId: string }, unknown];
      expect(ctx.accountId).toBe(TEST_USER.userId); // from the session, never the body (BR-002-11)
      expect(dto).toEqual({ ...valid, allowDataAccess: false }); // BR-009-08
      expect(res.body).toEqual({
        id: '64b7f00000000000000a0001',
        protocol: 'FL-2099-000007',
        createdAt: '2099-01-15T12:00:00.000Z',
        status: 'open',
        confirmationSent: true,
      });
    });

    it('passes a ticked permission through, and says when the confirmation is not out yet', async () => {
      support.create.mockResolvedValue({ request: stored(), confirmationSent: false });

      const res = await request(server)
        .post('/api/support')
        .send({ ...valid, allowDataAccess: true })
        .expect(201);

      expect(
        (support.create.mock.calls[0] as [unknown, { allowDataAccess: boolean }])[1],
      ).toMatchObject({
        allowDataAccess: true,
      });
      expect((res.body as { confirmationSent: boolean }).confirmationSent).toBe(false);
    });

    it('BR-009-05: trims the text before measuring it, so the limits are on what is kept', async () => {
      await request(server)
        .post('/api/support')
        .send({ subject: '  abc  ', message: `  ${'x'.repeat(10)}\n` })
        .expect(201);

      expect(
        (support.create.mock.calls[0] as [unknown, { subject: string; message: string }])[1],
      ).toMatchObject({
        subject: 'abc',
        message: 'xxxxxxxxxx',
      });
    });

    it.each([
      ['a subject of 2 characters', { ...valid, subject: 'ab' }],
      ['a subject of only spaces', { ...valid, subject: '     ' }],
      ['a subject over 200 characters', { ...valid, subject: 'x'.repeat(201) }],
      ['a message of 9 characters', { ...valid, message: 'x'.repeat(9) }],
      ['a message of only spaces and line breaks', { ...valid, message: ' \n \n \t        ' }],
      ['a message of 5,001 characters', { ...valid, message: 'x'.repeat(5001) }],
      ['a missing message', { subject: valid.subject }],
      ['a missing subject', { message: valid.message }],
      ['a permission that is not a boolean', { ...valid, allowDataAccess: 'yes' }],
      ['a permission of the text "true"', { ...valid, allowDataAccess: 'true' }],
      ['a permission of 1', { ...valid, allowDataAccess: 1 }],
      ['a permission of null', { ...valid, allowDataAccess: null }],
      [
        'the former title and description',
        { title: 'Titulo valido', description: 'Descricao valida' },
      ],
      ['an account id in the body (BR-002-11)', { ...valid, userId: '64b7f0000000000000000002' }],
    ])('refuses %s with 400 VALIDATION_FAILED', async (_name, body) => {
      const res = await request(server).post('/api/support').send(body).expect(400);

      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(support.create).not.toHaveBeenCalled();
    });

    it('BR-009-05: a subject is one line: line breaks, control and bidi characters become single spaces', async () => {
      await request(server)
        .post('/api/support')
        .send({
          subject: 'x\nSolicitante: forjado\r\n\u202Eabc\u2066d\u0000e\u2028f',
          message: valid.message,
        })
        .expect(201);

      expect((support.create.mock.calls[0] as [unknown, { subject: string }])[1].subject).toBe(
        'x Solicitante: forjado abc d e f',
      );
    });

    it('refuses a subject of only line breaks and control characters', async () => {
      await request(server)
        .post('/api/support')
        .send({ subject: '\n\u202E\u0007\n', message: valid.message })
        .expect(400);
    });

    it('accepts the limits themselves: 3 and 200 characters, 10 and 5,000', async () => {
      await request(server)
        .post('/api/support')
        .send({ subject: 'x'.repeat(3), message: 'y'.repeat(10) })
        .expect(201);
      await request(server)
        .post('/api/support')
        .send({ subject: 'x'.repeat(200), message: 'y'.repeat(5000) })
        .expect(201);
    });
  });

  describe('GET /api/support/mine and /mine/:id (BR-009-09)', () => {
    it('answers the page with protocol, subject, date, status and permission, and nothing of the outbox', async () => {
      const res = await request(server).get('/api/support/mine?page=2&pageSize=5').expect(200);

      expect(support.listMine).toHaveBeenCalledWith(expect.anything(), { page: 2, pageSize: 5 });
      expect(res.body).toEqual({
        items: [
          {
            id: '64b7f00000000000000a0001',
            protocol: 'FL-2099-000007',
            subject: 'Assunto ficticio',
            createdAt: '2099-01-15T12:00:00.000Z',
            status: 'open',
            dataAccess: 'not_given',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
      });
    });

    it.each(['page=0', 'pageSize=101', 'pageSize=0', 'userId=64b7f0000000000000000002'])(
      'refuses the query %s with 400',
      async (query) => {
        await request(server).get(`/api/support/mine?${query}`).expect(400);
      },
    );

    it('answers one request in full, with the message and the permission as the requester sees it', async () => {
      support.getMine.mockResolvedValue(
        stored({
          allowDataAccess: true,
          dataAccessWithdrawnAt: new Date('2099-01-16T09:00:00.000Z'),
          status: 'closed',
          closedAt: new Date('2099-01-17T09:00:00.000Z'),
        }),
      );

      const res = await request(server)
        .get(`/api/support/mine/${REQUEST_ID.toHexString()}`)
        .expect(200);

      expect(res.body).toEqual({
        id: '64b7f00000000000000a0001',
        protocol: 'FL-2099-000007',
        subject: 'Assunto ficticio',
        message: 'Mensagem ficticia de teste',
        createdAt: '2099-01-15T12:00:00.000Z',
        status: 'closed',
        dataAccess: 'withdrawn',
        dataAccessWithdrawnAt: '2099-01-16T09:00:00.000Z',
        closedAt: '2099-01-17T09:00:00.000Z',
      });
      expect(JSON.stringify(res.body)).not.toContain('claim-token-secreto');
      expect(JSON.stringify(res.body)).not.toContain(TEST_USER.userId);
    });

    it('withdraws the permission of the account’s own request and answers 200 with it', async () => {
      const res = await request(server)
        .post(`/api/support/mine/${REQUEST_ID.toHexString()}/withdraw-data-access`)
        .send({})
        .expect(200);

      expect(support.withdrawDataAccess).toHaveBeenCalledWith(
        expect.objectContaining({ accountId: TEST_USER.userId }),
        REQUEST_ID.toHexString(),
      );
      expect(res.body).toMatchObject({ protocol: 'FL-2099-000007' });
    });
  });

  describe('GET /api/support/contact (BR-009-03)', () => {
    it('answers the configured address', async () => {
      const res = await request(server).get('/api/support/contact').expect(200);

      expect(res.body).toEqual({ email: 'suporte-ficticio@example.test' });
    });
  });
});
