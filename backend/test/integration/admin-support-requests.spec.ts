// SPEC-009 BR-009-10..BR-009-12 / SPEC-002 BR-002-24, BR-002-26 (#9): the admin's side of support
// requests through the API on MongoDB (TESTING §2): the queue, one request, close, and opening a grant.
// The real AuthModule, SupportModule, AdminAccessModule and the REAL SUPPORT_REQUEST_SOURCE bound in
// AccessModule; only the clock and the mailer are fakes (TS-06, TS-07). Races are forced by pausing a
// real call between two real steps, never by sleeping. Every name and text is fake (TS-27).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
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
import { SupportRequestEntity } from '../../src/support/schemas/support-request.schema.js';
import { SupportRequestsRepository } from '../../src/support/support-requests.repository.js';
import { SupportModule } from '../../src/support/support.module.js';
import { UserEntity, type UserDocument } from '../../src/users/schemas/user.schema.js';
import { DAY, HOUR } from '../fakes/fake-clock.js';
import { createAuthTestApp, type AuthTestApp } from '../support/auth-test-app.js';
import { useTestDatabase } from '../support/test-database.js';

const PASSWORD = 'correct horse battery';
const UNKNOWN_ID = '64b7f00000000000000ffff1';
const MARKUP = '<b>teste</b><script>alert(1)</script> & <a href="http://x.test">link</a>';
const notFound = { code: 'NOT_FOUND', context: {} };

interface Account {
  readonly id: string;
  readonly email: string;
  readonly token: string;
}

interface Created {
  id: string;
  protocol: string;
}

interface Detail {
  id: string;
  protocol: string;
  subject: string;
  message: string;
  status: string;
  dataAccess: string;
  createdAt: string;
  closedAt?: string;
  dataAccessWithdrawnAt?: string;
  requester: { name: string | null; email: string | null };
  grant: { id: string; supportRequestId: string; openedAt: string; expiresAt: string } | null;
}

describe('SPEC-009 the admin’s side of support requests through the API (BR-009-10..BR-009-12)', () => {
  const db = useTestDatabase();
  let harness: AuthTestApp;
  let users: Model<UserDocument>;
  let requests: Model<SupportRequestEntity>;
  let grantsModel: Model<SupportAccessGrantDocument>;
  let grants: SupportGrantService;
  let source: SupportRequestSource;
  let contexts: AccessContextFactory;
  let counter = 0;

  const server = () => harness.app.getHttpServer() as Parameters<typeof request>[0];
  const as = (account: Account) => ({ Authorization: `Bearer ${account.token}` });
  const get = (account: Account, path: string) => request(server()).get(path).set(as(account));
  const post = (account: Account, path: string, body: object = {}) =>
    request(server()).post(path).set(as(account)).send(body);
  const stored = (id: string) => requests.findById(id).lean().exec();
  const refusal = (promise: Promise<unknown>) =>
    promise.then(
      () => null,
      (error: unknown) => error,
    );

  async function register(label: string, name = `Pessoa ${label}`): Promise<Account> {
    counter += 1;
    const email = `${label}-${counter}@example.test`.toLowerCase();
    const registered = await request(server())
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, name, acceptTerms: true })
      .expect(201);
    const token = harness.mailbox.verificationEmails.find((sent) => sent.email === email)?.token;
    await request(server()).post('/api/auth/verify-email').send({ token }).expect(200);
    return {
      id: (registered.body as { user: { _id: string } }).user._id,
      email,
      token: (registered.body as { accessToken: string }).accessToken,
    };
  }

  async function admin(label = 'admin'): Promise<Account> {
    const account = await register(label);
    await users.updateOne({ _id: account.id }, { $set: { isAdmin: true } });
    return account;
  }

  async function open(account: Account, body: Record<string, unknown> = {}): Promise<Created> {
    const res = await post(account, '/api/support', {
      subject: 'Nao consigo entrar na conta',
      message: 'A tela de entrada falha para mim desde ontem.',
      ...body,
    }).expect(201);
    return res.body as Created;
  }

  /** The grant context of an admin, as the service builds it for a read (NOT_FOUND when refused). */
  const adminContext = (account: Account) =>
    contexts.forAccount({ userId: account.id, isAdmin: true });
  const detail = (by: Account, id: string) => get(by, `/api/admin/support-requests/${id}`);
  const close = (by: Account, id: string) => post(by, `/api/admin/support-requests/${id}/close`);
  const grantOn = (by: Account, id: string) => post(by, `/api/admin/support-requests/${id}/grant`);

  beforeAll(async () => {
    harness = await createAuthTestApp(db, [SupportModule, AdminAccessModule], {
      SUPPORT_MAIL_JOB_ENABLED: 'false',
    });
    const { moduleRef } = harness;
    await moduleRef.get<Connection>(getConnectionToken()).syncIndexes();
    users = moduleRef.get(getModelToken(UserEntity.name));
    requests = moduleRef.get(getModelToken(SupportRequestEntity.name));
    grantsModel = moduleRef.get(getModelToken(SupportAccessGrantEntity.name));
    grants = moduleRef.get(SupportGrantService);
    source = moduleRef.get<SupportRequestSource>(SUPPORT_REQUEST_SOURCE, { strict: false });
    contexts = moduleRef.get(AccessContextFactory);
  });

  afterAll(async () => {
    await harness.app.close();
  });

  afterEach(() => vi.restoreAllMocks());

  describe('BR-009-12: the queue and one request', () => {
    it('lists every account’s requests newest first, in the paginated envelope, each row as the requester’s own list row', async () => {
      const boss = await admin();
      const [ana, beto] = [await register('fila-a'), await register('fila-b')];
      const first = await open(ana, { subject: 'Primeiro assunto da fila' });
      harness.clock.advance(HOUR);
      const second = await open(beto, { subject: 'Segundo assunto da fila' });
      harness.clock.advance(HOUR);
      const third = await open(ana, { subject: 'Terceiro assunto da fila' });

      const res = await get(boss, '/api/admin/support-requests?pageSize=3').expect(200);

      const body = res.body as {
        items: Array<Record<string, unknown>>;
        total: number;
        page: number;
        pageSize: number;
      };
      expect(body.items.map((item) => item['id'])).toEqual([third.id, second.id, first.id]);
      expect(body).toMatchObject({ page: 1, pageSize: 3 });
      expect(body.total).toBeGreaterThanOrEqual(3);
      expect(Object.keys(body.items[0] ?? {}).sort()).toEqual([
        'createdAt',
        'dataAccess',
        'id',
        'protocol',
        'status',
        'subject',
      ]);
    });

    it('filters by status: only the open ones, only the closed ones, and all when absent; any other value is refused', async () => {
      const boss = await admin();
      const account = await register('fila-status');
      const stays = await open(account, { subject: 'Segue aberta na fila' });
      const goes = await open(account, { subject: 'Vai encerrar na fila' });
      await close(boss, goes.id).expect(200);
      const ids = async (query: string) =>
        (
          (await get(boss, `/api/admin/support-requests?pageSize=100${query}`).expect(200))
            .body as { items: Array<{ id: string }> }
        ).items.map((item) => item.id);

      expect(await ids('&status=open')).toContain(stays.id);
      expect(await ids('&status=open')).not.toContain(goes.id);
      expect(await ids('&status=closed')).toContain(goes.id);
      expect(await ids('&status=closed')).not.toContain(stays.id);
      expect(await ids('')).toEqual(expect.arrayContaining([stays.id, goes.id]));
      const refused = await get(boss, '/api/admin/support-requests?status=pending').expect(400);
      expect(refused.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('BR-009-10, BR-009-11: a request shows its message and its requester’s name and email, and markup in the text is plain text in the JSON', async () => {
      const boss = await admin();
      const account = await register('detalhe', 'Maria <b>Detalhe</b>');
      const created = await open(account, {
        subject: 'Assunto com <i>marcacao</i>',
        message: MARKUP,
      });

      const res = await detail(boss, created.id).expect(200);

      const body = res.body as Detail;
      expect(body).toMatchObject({
        id: created.id,
        protocol: created.protocol,
        subject: 'Assunto com <i>marcacao</i>',
        message: MARKUP, // literal: never wrapped, escaped by the API or marked up
        status: 'open',
        dataAccess: 'not_given',
        requester: { name: 'Maria <b>Detalhe</b>', email: account.email },
        grant: null,
      });
      expect(Object.keys(body).sort()).toEqual([
        'createdAt',
        'dataAccess',
        'grant',
        'id',
        'message',
        'protocol',
        'requester',
        'status',
        'subject',
      ]);
    });

    it('never answers the requester’s id, the outbox state or anything else of the stored request', async () => {
      const boss = await admin();
      const account = await register('sem-extra');
      const created = await open(account);

      const text = JSON.stringify((await detail(boss, created.id).expect(200)).body);

      for (const leaked of [
        'mailClaimToken',
        'mailAttempts',
        'mailNextAttemptAt',
        'userId',
        'confirmationSentAt',
        account.id,
      ]) {
        expect(text).not.toContain(leaked);
      }
    });

    it.each([
      ['an unknown id', UNKNOWN_ID],
      ['a malformed id', 'nao-e-um-id'],
    ])('%s is 404 NOT_FOUND on every route', async (_label, id) => {
      const boss = await admin();

      for (const call of [detail(boss, id), close(boss, id), grantOn(boss, id)]) {
        const res = await call;
        expect(res.status).toBe(404);
        expect(res.body).toEqual(notFound);
      }
    });
  });

  describe('BR-009-12: closing a request', () => {
    it('marks it closed with the time and the admin, answers it, and the requester sees it closed; the next withdrawal is SUPPORT_REQUEST_CLOSED', async () => {
      const boss = await admin();
      const account = await register('fecha');
      const created = await open(account, { allowDataAccess: true });
      harness.clock.advance(HOUR);

      const res = await close(boss, created.id).expect(200);

      expect(res.body).toMatchObject({
        id: created.id,
        status: 'closed',
        closedAt: harness.clock.now().toISOString(),
      });
      expect(await stored(created.id)).toMatchObject({
        status: 'closed',
        closedAt: harness.clock.now(),
        closedBy: new Types.ObjectId(boss.id),
      });
      const own = await get(account, `/api/support/mine/${created.id}`).expect(200);
      expect(own.body).toMatchObject({
        status: 'closed',
        closedAt: harness.clock.now().toISOString(),
      });
      const withdraw = await post(
        account,
        `/api/support/mine/${created.id}/withdraw-data-access`,
      ).expect(409);
      expect(withdraw.body).toEqual({ code: 'SUPPORT_REQUEST_CLOSED', context: {} });
    });

    it('acceptance: the admin’s next read under a grant is refused after the request is closed, and no new grant opens', async () => {
      const boss = await admin();
      const account = await register('fecha-grant');
      const created = await open(account, { allowDataAccess: true });
      const adminCtx = await adminContext(boss);
      const grant = (await grantOn(boss, created.id).expect(200)).body as { id: string };
      await expect(grants.contextForRead(adminCtx, grant.id)).resolves.toBeDefined();

      await close(boss, created.id).expect(200);

      expect(await refusal(grants.contextForRead(adminCtx, grant.id))).toMatchObject(notFound);
      expect(await grantsModel.findById(grant.id).lean().exec()).toMatchObject({
        status: 'ended',
        endReason: 'closed',
      });
      const again = await grantOn(boss, created.id).expect(404);
      expect(again.body).toEqual(notFound);
    });

    it('is idempotent: closing a closed request answers it unchanged and keeps the first time and the first admin', async () => {
      const [first, second] = [await admin('fecha-a'), await admin('fecha-b')];
      const account = await register('fecha-duas');
      const created = await open(account);
      await close(first, created.id).expect(200);
      const closedAt = (await stored(created.id))?.closedAt;
      harness.clock.advance(DAY);

      const again = await close(second, created.id).expect(200);

      expect((again.body as Detail).status).toBe('closed');
      expect(await stored(created.id)).toMatchObject({
        closedAt,
        closedBy: new Types.ObjectId(first.id),
      });
    });

    it('a grant left open by a race is ended by the second close', async () => {
      const boss = await admin();
      const account = await register('fecha-resto');
      const created = await open(account, { allowDataAccess: true });
      const grant = (await grantOn(boss, created.id).expect(200)).body as { id: string };
      // The first close wrote the status and was cut before ending the grants.
      await requests.updateOne(
        { _id: created.id },
        { $set: { status: 'closed', closedAt: new Date(), closedBy: boss.id } },
      );
      expect((await grantsModel.findById(grant.id).lean().exec())?.status).toBe('open');

      await close(boss, created.id).expect(200);

      expect(await grantsModel.findById(grant.id).lean().exec()).toMatchObject({
        status: 'ended',
        endReason: 'closed',
      });
    });

    it('BR-009-12: the requester’s own routes never show who closed it, the grant or the admin’s view', async () => {
      const boss = await admin();
      const account = await register('fecha-chaves');
      const created = await open(account, { allowDataAccess: true });
      await grantOn(boss, created.id).expect(200);
      await close(boss, created.id).expect(200);

      const mine = (await get(account, `/api/support/mine/${created.id}`).expect(200))
        .body as Record<string, unknown>;
      const list = (await get(account, '/api/support/mine').expect(200)).body as {
        items: Array<Record<string, unknown>>;
      };

      expect(Object.keys(mine).sort()).toEqual([
        'closedAt',
        'createdAt',
        'dataAccess',
        'id',
        'message',
        'protocol',
        'status',
        'subject',
      ]);
      expect(Object.keys(list.items[0] ?? {}).sort()).toEqual([
        'createdAt',
        'dataAccess',
        'id',
        'protocol',
        'status',
        'subject',
      ]);
      expect(JSON.stringify([mine, list])).not.toContain(boss.id);
    });
  });

  describe('BR-002-24: opening a grant from a request', () => {
    it('refuses a request without the permission, a closed one, a withdrawn one and an unknown one with the SAME answer', async () => {
      const boss = await admin();
      const account = await register('grant-recusa');
      const without = await open(account);
      const closed = await open(account, { allowDataAccess: true });
      await close(boss, closed.id).expect(200);
      const withdrawn = await open(account, { allowDataAccess: true });
      await post(account, `/api/support/mine/${withdrawn.id}/withdraw-data-access`).expect(200);

      const answers = await Promise.all(
        [without.id, closed.id, withdrawn.id, UNKNOWN_ID].map((id) => grantOn(boss, id)),
      );

      for (const answer of answers) {
        expect(answer.status).toBe(404);
        expect(answer.body).toEqual(notFound);
      }
    });

    it('opens a grant on a permitted open request, answers it, and is idempotent for the same admin', async () => {
      const boss = await admin();
      const account = await register('grant-abre');
      const created = await open(account, { allowDataAccess: true });

      const first = await grantOn(boss, created.id).expect(200);
      const second = await grantOn(boss, created.id).expect(200);

      const body = first.body as {
        id: string;
        supportRequestId: string;
        openedAt: string;
        expiresAt: string;
      };
      expect(Object.keys(body).sort()).toEqual(['expiresAt', 'id', 'openedAt', 'supportRequestId']);
      expect(body).toMatchObject({
        supportRequestId: created.id,
        openedAt: harness.clock.now().toISOString(),
        expiresAt: new Date(harness.clock.now().getTime() + 7 * DAY).toISOString(),
      });
      expect(second.body).toEqual(first.body);
      expect(await grantsModel.countDocuments({ supportRequestId: created.id })).toBe(1);
    });

    it('TS-13: admin A cannot see or use admin B’s grant: the request shows A’s grant to A only, B’s opening is 404, and B’s read through A’s grant is refused', async () => {
      const [first, second] = [await admin('dono-grant'), await admin('outro-grant')];
      const account = await register('grant-alheio');
      const created = await open(account, { allowDataAccess: true });
      const mine = (await grantOn(first, created.id).expect(200)).body as { id: string };

      const seenByOwner = (await detail(first, created.id).expect(200)).body as Detail;
      const seenByOther = (await detail(second, created.id).expect(200)).body as Detail;
      const opening = await grantOn(second, created.id).expect(404);

      expect(seenByOwner.grant).toMatchObject({ id: mine.id });
      expect(seenByOther.grant).toBeNull(); // never another admin's grant, not even that one exists
      expect(opening.body).toEqual(notFound);
      expect(JSON.stringify(seenByOther)).not.toContain(mine.id);
      expect(
        await refusal(grants.contextForRead(await adminContext(second), mine.id)),
      ).toMatchObject(notFound);
      await expect(
        grants.contextForRead(await adminContext(first), mine.id),
      ).resolves.toBeDefined();
    });

    it('a grant that expired shows as none on the request (7 days)', async () => {
      const boss = await admin();
      const account = await register('grant-vence');
      const created = await open(account, { allowDataAccess: true });
      await grantOn(boss, created.id).expect(200);
      harness.clock.advance(7 * DAY);
      // The admin's own session lasts 7 days too: they sign in again, as a person would.
      const signedAgain = await request(server())
        .post('/api/auth/login')
        .send({ email: boss.email, password: PASSWORD })
        .expect(200);
      const back = { ...boss, token: (signedAgain.body as { accessToken: string }).accessToken };

      const seen = (await detail(back, created.id).expect(200)).body as Detail;

      expect(seen.grant).toBeNull();
    });

    it('BR-002-21: a deactivated requester ends the grant at the next read, and none opens for them', async () => {
      const boss = await admin();
      const account = await register('grant-inativa');
      const created = await open(account, { allowDataAccess: true });
      const grant = (await grantOn(boss, created.id).expect(200)).body as { id: string };

      await users.updateOne({ _id: account.id }, { $set: { status: 'deactivated' } });

      expect(
        await refusal(grants.contextForRead(await adminContext(boss), grant.id)),
      ).toMatchObject(notFound);
      expect((await grantOn(boss, created.id).expect(404)).body).toEqual(notFound);
    });

    it('the route gives the admin no client data: it answers the grant and nothing of the requester’s account', async () => {
      const boss = await admin();
      const account = await register('grant-sem-dados', 'Pessoa Reservada');
      const created = await open(account, { allowDataAccess: true });

      const text = JSON.stringify((await grantOn(boss, created.id).expect(200)).body);

      expect(text).not.toContain('Pessoa Reservada');
      expect(text).not.toContain(account.email);
      expect(text).not.toContain(account.id);
    });
  });

  describe('races (forced interleavings, TS-06): close, withdraw and open-grant', () => {
    it('order 1: the open read the request as open and permitted, the admin then CLOSES it, the open then inserts its grant: the grant never reads', async () => {
      const boss = await admin();
      const account = await register('corrida-fecha-1');
      const created = await open(account, { allowDataAccess: true });
      const adminCtx = await adminContext(boss);
      const original = source.findForGrant.bind(source);
      let openReadTheRequest!: () => void;
      const readIt = new Promise<void>((resolve) => (openReadTheRequest = resolve));
      let letTheOpenGoOn!: () => void;
      const hold = new Promise<void>((resolve) => (letTheOpenGoOn = resolve));
      vi.spyOn(source, 'findForGrant').mockImplementationOnce(async (id) => {
        const found = await original(id); // open, permission in force
        openReadTheRequest();
        await hold; // the close runs now, between the open's read and its insert
        return found;
      });

      const opening = grants.open(adminCtx, created.id);
      await readIt;
      await close(boss, created.id).expect(200);
      letTheOpenGoOn();
      const opened = await opening; // it inserted a grant on what it had read
      vi.restoreAllMocks();

      expect(opened.supportRequestId).toBe(created.id);
      expect(await refusal(grants.contextForRead(adminCtx, opened.id))).toMatchObject(notFound);
      expect(await refusal(grants.open(adminCtx, created.id))).toMatchObject(notFound);
      expect(
        await grantsModel.countDocuments({ supportRequestId: created.id, status: 'open' }),
      ).toBe(0);
    });

    it('order 2: a grant is read or opened between the close’s write and its end of the grants: refused both ways', async () => {
      const boss = await admin();
      const account = await register('corrida-fecha-2');
      const created = await open(account, { allowDataAccess: true });
      const adminCtx = await adminContext(boss);
      const earlier = await grants.open(adminCtx, created.id);
      const original = grants.endForSupportRequest.bind(grants);
      const during: unknown[] = [];
      vi.spyOn(grants, 'endForSupportRequest').mockImplementationOnce(async (id, reason) => {
        // The status is written, the grants are not ended yet.
        expect((await stored(created.id))?.status).toBe('closed');
        during.push(await refusal(grants.contextForRead(adminCtx, earlier.id)));
        during.push(await refusal(grants.open(adminCtx, created.id)));
        return original(id, reason);
      });

      await close(boss, created.id).expect(200);
      vi.restoreAllMocks();

      expect(during).toHaveLength(2);
      for (const answer of during) expect(answer).toMatchObject(notFound);
      expect(
        await grantsModel.countDocuments({ supportRequestId: created.id, status: 'open' }),
      ).toBe(0);
    });

    it('a withdrawal against a close: the requester read the request as open, the admin closes it, the withdrawal then writes nothing and answers SUPPORT_REQUEST_CLOSED; the grant is ended', async () => {
      const boss = await admin();
      const account = await register('corrida-retira-fecha');
      const created = await open(account, { allowDataAccess: true });
      const grant = (await grantOn(boss, created.id).expect(200)).body as { id: string };
      const repository = harness.moduleRef.get(SupportRequestsRepository);
      const original = repository.markDataAccessWithdrawn.bind(repository);
      vi.spyOn(repository, 'markDataAccessWithdrawn').mockImplementationOnce(
        async (ctx, id, at) => {
          await close(boss, id).expect(200); // the close lands between the withdrawal's read and its write
          return original(ctx, id, at);
        },
      );

      const withdrawal = await post(
        account,
        `/api/support/mine/${created.id}/withdraw-data-access`,
      );

      expect(withdrawal.status).toBe(409);
      expect(withdrawal.body).toEqual({ code: 'SUPPORT_REQUEST_CLOSED', context: {} });
      expect(await stored(created.id)).toMatchObject({ status: 'closed' });
      expect((await stored(created.id))?.dataAccessWithdrawnAt).toBeUndefined();
      expect(await grantsModel.findById(grant.id).lean().exec()).toMatchObject({ status: 'ended' });
      expect(
        await refusal(grants.contextForRead(await adminContext(boss), grant.id)),
      ).toMatchObject(notFound);
    });

    it('a close against a withdrawal: the withdrawal is recorded, the close then lands: closed, withdrawn, no grant reads', async () => {
      const boss = await admin();
      const account = await register('corrida-fecha-retira');
      const created = await open(account, { allowDataAccess: true });
      const grant = (await grantOn(boss, created.id).expect(200)).body as { id: string };

      await post(account, `/api/support/mine/${created.id}/withdraw-data-access`).expect(200);
      const closed = await close(boss, created.id).expect(200);

      expect((closed.body as Detail).dataAccess).toBe('withdrawn');
      expect((closed.body as Detail).status).toBe('closed');
      expect(
        await refusal(grants.contextForRead(await adminContext(boss), grant.id)),
      ).toMatchObject(notFound);
    });

    it('open-grant, close and withdraw all at once, ten times: whatever the order, the request ends closed or withdrawn and NO grant can read', async () => {
      const boss = await admin();
      const account = await register('corrida-tres');
      for (let round = 0; round < 10; round += 1) {
        const created = await open(account, { allowDataAccess: true });

        const results = await Promise.all([
          grantOn(boss, created.id),
          close(boss, created.id),
          post(account, `/api/support/mine/${created.id}/withdraw-data-access`),
        ]);

        // The close always lands; the other two answer 200 or their own refusal (404 / 409), never a 500.
        expect(results[1].status).toBe(200);
        expect([200, 404]).toContain(results[0].status);
        expect([200, 409]).toContain(results[2].status);
        const opened = await grantsModel.find({ supportRequestId: created.id }).lean().exec();
        for (const grant of opened) {
          expect(
            await refusal(grants.contextForRead(await adminContext(boss), grant._id.toHexString())),
          ).toMatchObject(notFound);
        }
        expect(await refusal(grants.open(await adminContext(boss), created.id))).toMatchObject(
          notFound,
        );
      }
    });

    it('two closes at once: both answer 200, the request is closed once, by one admin', async () => {
      const [first, second] = [await admin('dois-fecham-a'), await admin('dois-fecham-b')];
      const account = await register('corrida-fecha-fecha');
      const created = await open(account);

      const [a, b] = await Promise.all([close(first, created.id), close(second, created.id)]);

      expect([a.status, b.status]).toEqual([200, 200]);
      const row = await stored(created.id);
      expect(row?.status).toBe('closed');
      expect([first.id, second.id]).toContain(row?.closedBy?.toHexString());
    });
  });

  describe('the guards', () => {
    it('a deactivated admin is refused on the next request, and a requester account is refused on every route (403)', async () => {
      const boss = await admin('desativado');
      const ordinary = await register('comum-fila');
      await users.updateOne({ _id: boss.id }, { $set: { status: 'deactivated' } });

      await get(boss, '/api/admin/support-requests').expect(401);
      await get(ordinary, '/api/admin/support-requests').expect(403);
    });
  });
});
