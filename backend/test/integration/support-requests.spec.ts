// SPEC-009 part 1 (#9) BR-009-03..BR-009-12: support requests through the API on MongoDB (TESTING §2).
// The real AuthModule, SupportModule (routes, outbox, job), AdminAccessModule, the real
// SUPPORT_REQUEST_SOURCE bound in AccessModule, and the indexes built from the schemas; only the clock
// and the mailer are fakes (TS-06, TS-07). Each test opens its own accounts and leaves nothing owed in
// the outbox, so one test's retries never reach another. Fake names and texts only (TS-27).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { type Connection, type Model, Types } from 'mongoose';
import request from 'supertest';
import { AccessContextFactory } from '../../src/access/access-context.js';
import {
  SUPPORT_REQUEST_SOURCE,
  type SupportRequestSource,
} from '../../src/access/sources/support-request.source.js';
import { AdminAccessModule } from '../../src/admin-access/admin-access.module.js';
import {
  type SupportAccessGrantDocument,
  SupportAccessGrantEntity,
} from '../../src/admin-access/schemas/support-access-grant.schema.js';
import { SupportGrantService } from '../../src/admin-access/support-grant.service.js';
import { DomainError } from '../../src/common/errors/domain-error.js';
import { serverOperators } from '../../src/common/mongo/query-safety.js';
import { PersonalDataRegistry } from '../../src/privacy/registry/personal-data-registry.js';
import { SupportRequestEntity } from '../../src/support/schemas/support-request.schema.js';
import { SupportCounterEntity } from '../../src/support/schemas/support-counter.schema.js';
import { SupportMailJob } from '../../src/support/support-mail.job.js';
import { SupportModule } from '../../src/support/support.module.js';
import { UserEntity, type UserDocument } from '../../src/users/schemas/user.schema.js';
import { DAY, HOUR, MINUTE } from '../fakes/fake-clock.js';
import { createAuthTestApp, type AuthTestApp } from '../support/auth-test-app.js';
import { spyOnLogger } from '../support/logger-spy.js';
import { useTestDatabase } from '../support/test-database.js';

const PASSWORD = 'correct horse battery';
const SUPPORT_MAILBOX = 'suporte-ficticio@example.test';
const SUBJECT = 'Nao consigo entrar na minha conta';
const MESSAGE = 'A tela de entrada falha para mim desde ontem.';
const PROTOCOL = /^FL-2099-\d{6}$/;

interface Account {
  readonly id: string;
  readonly email: string;
  readonly token: string;
}

interface Created {
  id: string;
  protocol: string;
  createdAt: string;
  status: string;
  confirmationSent: boolean;
}

describe('support requests through the API (SPEC-009 BR-009-03..BR-009-12)', () => {
  const db = useTestDatabase();
  let harness: AuthTestApp;
  let users: Model<UserDocument>;
  let requests: Model<SupportRequestEntity>;
  let grantsModel: Model<SupportAccessGrantDocument>;
  let grants: SupportGrantService;
  let source: SupportRequestSource;
  let job: SupportMailJob;
  let contexts: AccessContextFactory;
  let counter = 0;

  const server = () => harness.app.getHttpServer() as Parameters<typeof request>[0];
  const mailbox = () => harness.mailbox;

  async function register(label: string, { confirm = true } = {}): Promise<Account> {
    counter += 1;
    const email = `${label}-${counter}@example.test`;
    const registered = await request(server())
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, name: `Pessoa ${label}`, acceptTerms: true })
      .expect(201);
    if (confirm) {
      const token = mailbox().verificationEmails.find((sent) => sent.email === email)?.token ?? '';
      await request(server()).post('/api/auth/verify-email').send({ token }).expect(200);
    }
    return {
      id: registered.body.user._id as string,
      email,
      token: registered.body.accessToken as string,
    };
  }

  const as = (account: Account) => ({ Authorization: `Bearer ${account.token}` });

  async function open(
    account: Account,
    body: Record<string, unknown> = {},
  ): Promise<Created & { statusCode: number }> {
    const res = await request(server())
      .post('/api/support')
      .set(as(account))
      .send({ subject: SUBJECT, message: MESSAGE, ...body })
      .expect(201);
    return { ...(res.body as Created), statusCode: res.status };
  }

  const last = <T>(items: readonly T[]): T | undefined => items[items.length - 1];
  const stored = (id: string) => requests.findOne({ _id: id }).lean().exec();
  const admin = () =>
    contexts.forAccount({ userId: new Types.ObjectId().toHexString(), isAdmin: true });
  const refusal = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => error,
    );

  beforeAll(async () => {
    harness = await createAuthTestApp(db, [SupportModule, AdminAccessModule], {
      SUPPORT_MAIL_JOB_ENABLED: 'false',
    });
    const { moduleRef } = harness;
    // Indexes as a deploy builds them (migration 0012 / 0005): the unique protocol, one open grant per request.
    await moduleRef.get<Connection>(getConnectionToken()).syncIndexes();
    users = moduleRef.get(getModelToken(UserEntity.name));
    requests = moduleRef.get(getModelToken(SupportRequestEntity.name));
    grantsModel = moduleRef.get(getModelToken(SupportAccessGrantEntity.name));
    grants = moduleRef.get(SupportGrantService);
    source = moduleRef.get<SupportRequestSource>(SUPPORT_REQUEST_SOURCE, { strict: false });
    job = moduleRef.get(SupportMailJob);
    contexts = moduleRef.get(AccessContextFactory);
  });

  afterAll(async () => {
    await harness.app.close();
  });

  describe('BR-009-04: who may open a request', () => {
    it('an account with an unconfirmed email is refused 403 EMAIL_VERIFICATION_REQUIRED, and nothing is stored or sent', async () => {
      const account = await register('naoconfirmada', { confirm: false });
      const before = mailbox().supportNotices.length;

      const res = await request(server())
        .post('/api/support')
        .set(as(account))
        .send({ subject: SUBJECT, message: MESSAGE })
        .expect(403);

      expect(res.body).toEqual({ code: 'EMAIL_VERIFICATION_REQUIRED', context: {} });
      expect(await requests.countDocuments({ userId: account.id })).toBe(0);
      expect(mailbox().supportNotices).toHaveLength(before);
    });

    it('a visitor with no session is refused 401', async () => {
      await request(server())
        .post('/api/support')
        .send({ subject: SUBJECT, message: MESSAGE })
        .expect(401);
      await request(server()).get('/api/support/mine').expect(401);
    });

    it('BR-009-03: the support address is public and is the configured one', async () => {
      const res = await request(server()).get('/api/support/contact').expect(200);

      expect(res.body).toEqual({ email: SUPPORT_MAILBOX });
    });
  });

  describe('BR-009-05, BR-009-06, BR-009-08: what is stored', () => {
    it('stores the request with a protocol, status open, the permission off by default, and answers 201', async () => {
      const account = await register('ana');

      const created = await open(account);

      expect(created).toMatchObject({
        statusCode: 201,
        status: 'open',
        createdAt: '2099-01-15T12:00:00.000Z',
        confirmationSent: true,
      });
      expect(created.protocol).toMatch(PROTOCOL);
      const row = await stored(created.id);
      expect(row).toMatchObject({
        userId: new Types.ObjectId(account.id),
        protocol: created.protocol,
        subject: SUBJECT,
        message: MESSAGE,
        status: 'open',
        allowDataAccess: false, // BR-009-08: unticked by default
      });
      expect(row?.dataAccessWithdrawnAt).toBeUndefined();
    });

    it('stores the ticked permission, and the text trimmed', async () => {
      const account = await register('beto');

      const created = await open(account, {
        subject: `  ${SUBJECT}  `,
        message: `\n${MESSAGE}\n`,
        allowDataAccess: true,
      });

      expect(await stored(created.id)).toMatchObject({
        subject: SUBJECT,
        message: MESSAGE,
        allowDataAccess: true,
      });
    });

    it.each([
      ['a subject of 2 characters', { subject: 'ab' }],
      ['a message of 9 characters', { message: 'x'.repeat(9) }],
      ['a message of 5,001 characters', { message: 'x'.repeat(5001) }],
      ['a subject of only spaces', { subject: '        ' }],
    ])('BR-009-05: refuses %s with 400 and stores nothing', async (_name, body) => {
      const account = await register('invalida');

      const res = await request(server())
        .post('/api/support')
        .set(as(account))
        .send({ subject: SUBJECT, message: MESSAGE, ...body })
        .expect(400);

      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect(await requests.countDocuments({ userId: account.id })).toBe(0);
    });

    it('BR-009-05: accepts a message of exactly 5,000 characters', async () => {
      const account = await register('limite');

      await open(account, { message: 'x'.repeat(5000) });

      expect(await requests.countDocuments({ userId: account.id })).toBe(1);
    });
  });

  describe('BR-009-06: the protocol', () => {
    it('50 requests at once get 50 distinct protocols, each FL-2099-NNNNNN, with no gap in the run', async () => {
      const account = await register('rajada');

      const created = await Promise.all(Array.from({ length: 50 }, () => open(account)));

      const protocols = created.map((entry) => entry.protocol);
      expect(new Set(protocols).size).toBe(50);
      for (const protocol of protocols) expect(protocol).toMatch(PROTOCOL);
      const numbers = protocols.map((protocol) => Number(protocol.slice(-6))).sort((a, b) => a - b);
      expect((numbers[numbers.length - 1] ?? 0) - (numbers[0] ?? 0)).toBe(49);
      expect(await requests.countDocuments({ protocol: serverOperators({ $in: protocols }) })).toBe(
        50,
      );
    });

    it('the protocol is unique in the collection whatever happens (the unique index)', async () => {
      const account = await register('duplicada');
      const created = await open(account);

      await expect(
        requests.create({
          userId: new Types.ObjectId(account.id),
          protocol: created.protocol,
          subject: SUBJECT,
          message: MESSAGE,
        }),
      ).rejects.toMatchObject({ code: 11000 });
    });

    it('numbers by the year in Brasília time: the new year restarts the sequence at 1', async () => {
      const before = harness.clock.now();
      try {
        // 2099-12-31 22:00 in Brasília (UTC-3) is already 2100-01-01 01:00 UTC. The account signs up
        // under that clock, so its session is valid at it.
        harness.clock.set(new Date('2100-01-01T01:00:00.000Z'));
        const account = await register('viradadeano');
        const lastOfYear = await open(account);
        harness.clock.set(new Date('2100-01-01T03:00:00.000Z')); // 00:00 on 1 January in Brasília
        const firstOfYear = await open(account);
        const second = await open(account);

        expect(lastOfYear.protocol).toMatch(/^FL-2099-\d{6}$/);
        expect(firstOfYear.protocol).toBe('FL-2100-000001');
        expect(second.protocol).toBe('FL-2100-000002');
        const counters = harness.moduleRef.get<Model<SupportCounterEntity>>(
          getModelToken(SupportCounterEntity.name),
        );
        expect((await counters.findById('support_protocol:2100').lean().exec())?.seq).toBe(2);
      } finally {
        harness.clock.set(before);
      }
    });
  });

  describe('BR-009-07, BR-009-10: the two emails', () => {
    it('sends the notice to the support mailbox and the confirmation to the account, with protocol, subject and message', async () => {
      const account = await register('carla');

      const created = await open(account);

      expect(last(mailbox().supportNotices)).toEqual({
        to: SUPPORT_MAILBOX,
        protocol: created.protocol,
        requesterName: 'Pessoa carla',
        requesterEmail: account.email,
        subject: SUBJECT,
        message: MESSAGE,
      });
      expect(last(mailbox().supportConfirmations)).toEqual({
        to: account.email,
        requestId: created.id,
        protocol: created.protocol,
        subject: SUBJECT,
        message: MESSAGE,
      });
      const row = await stored(created.id);
      expect(row?.confirmationSentAt).toEqual(new Date('2099-01-15T12:00:00.000Z'));
      expect(row?.teamNoticeSentAt).toEqual(new Date('2099-01-15T12:00:00.000Z'));
      expect(row?.mailNextAttemptAt).toBeUndefined(); // nothing owed any more
    });

    it('with SMTP down the request is stored, the protocol shown and confirmationSent false; then ONE delivery of each mail once it recovers', async () => {
      const account = await register('dora');
      mailbox().supportMailDown = true;

      const created = await open(account);

      expect(created.confirmationSent).toBe(false);
      expect(created.protocol).toMatch(PROTOCOL);
      expect(await stored(created.id)).toMatchObject({ status: 'open', mailAttempts: 1 });
      const confirmations = () =>
        mailbox().supportConfirmations.filter((sent) => sent.protocol === created.protocol);
      const notices = () =>
        mailbox().supportNotices.filter((sent) => sent.protocol === created.protocol);
      expect(confirmations()).toHaveLength(0);

      mailbox().supportMailDown = false;
      await job.run(); // too early: the retry is due in 1 minute
      expect(confirmations()).toHaveLength(0);
      harness.clock.advance(MINUTE);
      await job.run();
      await job.run(); // a second run finds nothing owed

      expect(confirmations()).toHaveLength(1);
      expect(notices()).toHaveLength(1);
      expect(await stored(created.id)).toMatchObject({ mailAttempts: 1 });
      expect((await stored(created.id))?.confirmationSentAt).toEqual(harness.clock.now());
    });

    it('two job runs at once send each owed mail once: the claim gives the request to one of them', async () => {
      const account = await register('eva');
      mailbox().supportMailDown = true;
      const created = await open(account);
      mailbox().supportMailDown = false;
      harness.clock.advance(MINUTE);

      await Promise.all([job.run(), job.run(), job.run()]);

      expect(
        mailbox().supportConfirmations.filter((sent) => sent.protocol === created.protocol),
      ).toHaveLength(1);
      expect(
        mailbox().supportNotices.filter((sent) => sent.protocol === created.protocol),
      ).toHaveLength(1);
    });

    it('a claim another worker holds is not taken, and is taken once its lease ran out', async () => {
      const account = await register('fabio');
      mailbox().supportMailDown = true;
      const created = await open(account);
      mailbox().supportMailDown = false;
      harness.clock.advance(MINUTE);
      await requests.updateOne(
        { _id: created.id },
        {
          $set: {
            mailClaimToken: 'worker-que-caiu',
            mailClaimUntil: new Date(harness.clock.now().getTime() + 2 * MINUTE),
          },
        },
      );

      await job.run();
      expect(
        mailbox().supportNotices.filter((sent) => sent.protocol === created.protocol),
      ).toHaveLength(0);

      harness.clock.advance(2 * MINUTE); // the lease ends: a crashed worker's claim expires
      await job.run();
      expect(
        mailbox().supportNotices.filter((sent) => sent.protocol === created.protocol),
      ).toHaveLength(1);
      expect((await stored(created.id))?.mailClaimToken).toBeUndefined();
    });

    it('BR-009-07: the confirmation goes to the CURRENT address of the account, not the one at the time of the request', async () => {
      const account = await register('gabi');
      mailbox().supportMailDown = true;
      const created = await open(account);
      await users.updateOne({ _id: account.id }, { $set: { email: 'gabi.nova@example.test' } });
      mailbox().supportMailDown = false;
      harness.clock.advance(MINUTE);

      await job.run();

      expect(
        mailbox().supportConfirmations.find((sent) => sent.protocol === created.protocol)?.to,
      ).toBe('gabi.nova@example.test');
      expect(
        mailbox().supportNotices.find((sent) => sent.protocol === created.protocol)?.requesterEmail,
      ).toBe('gabi.nova@example.test');
    });

    it('BR-009-15: a deactivated account gets no confirmation, the team still gets the notice, and nothing is retried', async () => {
      const account = await register('heitor');
      mailbox().supportMailDown = true;
      const created = await open(account);
      await users.updateOne({ _id: account.id }, { $set: { status: 'deactivated' } });
      mailbox().supportMailDown = false;
      harness.clock.advance(MINUTE);

      await job.run();

      const row = await stored(created.id);
      expect(row?.confirmationSkippedAt).toBeDefined();
      expect(row?.confirmationSentAt).toBeUndefined();
      expect(row?.teamNoticeSentAt).toBeDefined();
      expect(row?.mailNextAttemptAt).toBeUndefined();
      expect(
        mailbox().supportConfirmations.filter((sent) => sent.protocol === created.protocol),
      ).toHaveLength(0);
    });

    it('gives up after 8 failed rounds, once, logging the request id only, and never tries again', async () => {
      const logger = spyOnLogger();
      const account = await register('iris');
      mailbox().supportMailDown = true;
      const created = await open(account); // the 1st failed round
      for (let round = 2; round <= 8; round += 1) {
        harness.clock.advance(3 * HOUR + MINUTE); // past the longest wait (180 minutes)
        await job.run();
      }

      const row = await stored(created.id);
      expect(row).toMatchObject({ mailAttempts: 8 });
      expect(row?.mailGaveUpAt).toEqual(harness.clock.now());
      expect(row?.mailNextAttemptAt).toBeUndefined();
      expect(logger.loggedText()).toContain(
        `Support mail for request ${created.id} gave up after 8 failed rounds`,
      );
      expect(logger.loggedText()).not.toContain(account.email);
      expect(logger.loggedText()).not.toContain(MESSAGE);

      mailbox().supportMailDown = false;
      harness.clock.advance(DAY);
      await job.run();
      expect(
        mailbox().supportNotices.filter((sent) => sent.protocol === created.protocol),
      ).toHaveLength(0);
    });
  });

  describe('BR-009-09: the requester’s own requests', () => {
    it('lists the account’s requests only, newest first, in the paginated envelope', async () => {
      const [a, b] = [await register('lista-a'), await register('lista-b')];
      const first = await open(a, { subject: 'Primeiro assunto' });
      harness.clock.advance(MINUTE);
      const second = await open(a, { subject: 'Segundo assunto', allowDataAccess: true });
      await open(b, { subject: 'Assunto da outra conta' });

      const res = await request(server()).get('/api/support/mine').set(as(a)).expect(200);

      expect(res.body).toEqual({
        items: [
          {
            id: second.id,
            protocol: second.protocol,
            subject: 'Segundo assunto',
            createdAt: second.createdAt,
            status: 'open',
            dataAccess: 'allowed',
          },
          {
            id: first.id,
            protocol: first.protocol,
            subject: 'Primeiro assunto',
            createdAt: first.createdAt,
            status: 'open',
            dataAccess: 'not_given',
          },
        ],
        total: 2,
        page: 1,
        pageSize: 20,
      });
      const page2 = await request(server())
        .get('/api/support/mine?page=2&pageSize=1')
        .set(as(a))
        .expect(200);
      expect(page2.body).toMatchObject({ total: 2, page: 2, pageSize: 1 });
      expect((page2.body as { items: unknown[] }).items).toHaveLength(1);
    });

    it('answers another account’s protocol exactly like a missing or malformed one: the same 404 body', async () => {
      const [a, b] = [await register('detalhe-a'), await register('detalhe-b')];
      const mine = await open(a);

      const own = await request(server())
        .get(`/api/support/mine/${mine.id}`)
        .set(as(a))
        .expect(200);
      const foreign = await request(server()).get(`/api/support/mine/${mine.id}`).set(as(b));
      const missing = await request(server())
        .get('/api/support/mine/64b7f00000000000000ffff1')
        .set(as(b));
      const malformed = await request(server()).get('/api/support/mine/nao-e-um-id').set(as(b));

      expect(own.body).toMatchObject({ protocol: mine.protocol, message: MESSAGE });
      for (const answer of [foreign, missing, malformed]) {
        expect(answer.status).toBe(404);
        expect(answer.body).toEqual({ code: 'NOT_FOUND', context: {} });
      }
    });
  });

  describe('BR-009-08, BR-009-12 / SPEC-002 BR-002-24, BR-002-26: the permission and the grant (the real source)', () => {
    const notFound = { code: 'NOT_FOUND' };

    it('the source answers the request as it is now: open and permission in force; closed; withdrawn; unknown; malformed', async () => {
      const account = await register('fonte');
      const allowed = await open(account, { allowDataAccess: true });
      const notAllowed = await open(account);

      expect(await source.findForGrant(allowed.id)).toEqual({
        id: allowed.id,
        requesterUserId: account.id,
        open: true,
        dataAccessAllowed: true,
      });
      expect(await source.findForGrant(notAllowed.id)).toMatchObject({
        open: true,
        dataAccessAllowed: false,
      });
      await requests.updateOne(
        { _id: allowed.id },
        { $set: { status: 'closed', closedAt: new Date() } },
      );
      expect(await source.findForGrant(allowed.id)).toMatchObject({
        open: false,
        dataAccessAllowed: true,
      });
      expect(await source.findForGrant(new Types.ObjectId().toHexString())).toBeNull();
      expect(await source.findForGrant('nao-e-um-id')).toBeNull();
      expect(await source.findForGrant('')).toBeNull();
    });

    it('an admin cannot open a grant on a request without the permission, nor on an unknown one, with the same answer', async () => {
      const account = await register('semopcao');
      const created = await open(account);
      const adminCtx = await admin();

      const withoutPermission = await refusal(grants.open(adminCtx, created.id));
      const unknown = await refusal(grants.open(adminCtx, new Types.ObjectId().toHexString()));

      expect(withoutPermission).toBeInstanceOf(DomainError);
      expect(withoutPermission).toMatchObject(notFound);
      expect(unknown).toMatchObject(notFound);
    });

    it('with the permission a grant opens and reads; once the requester withdraws, the admin’s next read is refused', async () => {
      const account = await register('comopcao');
      const created = await open(account, { allowDataAccess: true });
      const adminCtx = await admin();
      const grant = await grants.open(adminCtx, created.id);
      await expect(grants.contextForRead(adminCtx, grant.id)).resolves.toBeDefined();

      const res = await request(server())
        .post(`/api/support/mine/${created.id}/withdraw-data-access`)
        .set(as(account))
        .expect(200);

      expect(res.body).toMatchObject({ id: created.id, dataAccess: 'withdrawn' });
      expect(await refusal(grants.contextForRead(adminCtx, grant.id))).toMatchObject(notFound);
      const ended = await grantsModel.findById(grant.id).lean().exec();
      expect(ended).toMatchObject({ status: 'ended', endReason: 'withdrawn' });
      expect(await refusal(grants.open(adminCtx, created.id))).toMatchObject(notFound); // and no new grant
      expect((await stored(created.id))?.dataAccessWithdrawnAt).toEqual(harness.clock.now());
    });

    it('withdrawing is idempotent: the first date is kept, and a request with no permission answers unchanged', async () => {
      const account = await register('idempotente');
      const withPermission = await open(account, { allowDataAccess: true });
      const without = await open(account);
      const withdraw = (id: string) =>
        request(server()).post(`/api/support/mine/${id}/withdraw-data-access`).set(as(account));

      const first = await withdraw(withPermission.id).expect(200);
      harness.clock.advance(HOUR);
      const second = await withdraw(withPermission.id).expect(200);
      const unchanged = await withdraw(without.id).expect(200);

      expect((second.body as { dataAccessWithdrawnAt: string }).dataAccessWithdrawnAt).toBe(
        (first.body as { dataAccessWithdrawnAt: string }).dataAccessWithdrawnAt,
      );
      expect(unchanged.body).toMatchObject({ id: without.id, dataAccess: 'not_given' });
    });

    it('withdrawing a closed request answers 409 SUPPORT_REQUEST_CLOSED and changes nothing', async () => {
      const account = await register('encerrada');
      const created = await open(account, { allowDataAccess: true });
      await requests.updateOne(
        { _id: created.id },
        { $set: { status: 'closed', closedAt: new Date() } },
      );

      const res = await request(server())
        .post(`/api/support/mine/${created.id}/withdraw-data-access`)
        .set(as(account))
        .expect(409);

      expect(res.body).toEqual({ code: 'SUPPORT_REQUEST_CLOSED', context: {} });
      expect((await stored(created.id))?.dataAccessWithdrawnAt).toBeUndefined();
    });

    it('another account cannot withdraw this one’s permission: the same 404 as an unknown id', async () => {
      const [owner, other] = [await register('dono'), await register('outra')];
      const created = await open(owner, { allowDataAccess: true });
      const withdraw = (id: string) =>
        request(server()).post(`/api/support/mine/${id}/withdraw-data-access`).set(as(other));

      const foreign = await withdraw(created.id);
      const unknown = await withdraw('64b7f00000000000000ffff1');

      expect(foreign.status).toBe(404);
      expect(foreign.body).toEqual(unknown.body);
      expect((await stored(created.id))?.dataAccessWithdrawnAt).toBeUndefined();
    });

    it('after the request is closed an open grant is refused on the next read, and no new one opens', async () => {
      const account = await register('fechada');
      const created = await open(account, { allowDataAccess: true });
      const adminCtx = await admin();
      const grant = await grants.open(adminCtx, created.id);

      await requests.updateOne(
        { _id: created.id },
        { $set: { status: 'closed', closedAt: new Date() } },
      );

      expect(await refusal(grants.contextForRead(adminCtx, grant.id))).toMatchObject(notFound);
      expect(await refusal(grants.open(adminCtx, created.id))).toMatchObject(notFound);
    });

    it('BR-002-21: a deactivated requester ends the grant at the next read (the source and the account both count)', async () => {
      const account = await register('inativa');
      const created = await open(account, { allowDataAccess: true });
      const adminCtx = await admin();
      const grant = await grants.open(adminCtx, created.id);

      await users.updateOne({ _id: account.id }, { $set: { status: 'deactivated' } });

      expect(await refusal(grants.contextForRead(adminCtx, grant.id))).toMatchObject(notFound);
      expect(await refusal(grants.open(adminCtx, created.id))).toMatchObject(notFound);
    });

    it('races: a grant opened while the requester withdraws never reads once both have finished (10 interleavings)', async () => {
      const account = await register('corrida');
      const adminCtx = await admin();

      for (let round = 0; round < 10; round += 1) {
        const created = await open(account, { allowDataAccess: true });
        const [opened] = await Promise.allSettled([
          grants.open(adminCtx, created.id),
          request(server())
            .post(`/api/support/mine/${created.id}/withdraw-data-access`)
            .set(as(account))
            .expect(200),
        ]);

        if (opened.status === 'fulfilled') {
          expect(await refusal(grants.contextForRead(adminCtx, opened.value.id))).toMatchObject(
            notFound,
          );
        }
        expect(await refusal(grants.open(adminCtx, created.id))).toMatchObject(notFound);
        expect(
          await grantsModel.countDocuments({ supportRequestId: created.id, status: 'open' }),
        ).toBe(0);
      }
    });
  });

  describe('SPEC-010 BR-010-08, BR-010-15: the export and the purge', () => {
    it('the provider is registered, exports the account’s requests only, and the purge deletes them only', async () => {
      const [a, b] = [await register('exporta-a'), await register('exporta-b')];
      const mine = await open(a, { allowDataAccess: true });
      await open(a);
      await open(b);
      const registry = harness.moduleRef.get(PersonalDataRegistry, { strict: false });
      const provider = registry.providers().find((entry) => entry.name === 'supportRequests');
      expect(provider?.models).toEqual([SupportRequestEntity.name]);

      const ctx = await contexts.forAccount({ userId: a.id, isAdmin: false });
      const collected = await provider?.collect(ctx);
      const items = (collected as { items: Array<Record<string, unknown>> }).items;

      expect(items).toHaveLength(2);
      expect(items.find((item) => item['protocol'] === mine.protocol)).toEqual({
        protocol: mine.protocol,
        subject: SUBJECT,
        message: MESSAGE,
        status: 'open',
        dataAccess: 'allowed',
        dataAccessWithdrawnAt: null,
        openedAt: new Date(mine.createdAt),
        closedAt: null,
      });
      expect(JSON.stringify(collected)).not.toContain('mailClaimToken');

      expect(await provider?.purge(a.id)).toEqual({ deleted: 2 });
      expect(await requests.countDocuments({ userId: a.id })).toBe(0);
      expect(await requests.countDocuments({ userId: b.id })).toBe(1);
      expect(await provider?.purge(a.id)).toEqual({ deleted: 0 }); // idempotent
    });
  });
});
