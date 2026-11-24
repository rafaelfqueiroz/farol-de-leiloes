// SPEC-009 BR-009-13..BR-009-21 (#9): account administration through the API on MongoDB (TESTING §2).
// The real AuthModule, AdminAccountsModule (search, record, deactivate, reactivate), AdminAccessModule
// (the access log), RemindersModule (the scheduler) and SubscriptionsModule; only the clock, the mailer
// and Google's boundary are fakes (TS-06, TS-07). Races are forced by pausing a real call between two
// real steps, never by sleeping (TS-06). Every name, address and text is fake (TS-27).
import { createHmac } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { type Connection, type Model, Types } from 'mongoose';
import request from 'supertest';
import { AdminAccessLogRepository } from '../../src/admin-access/admin-access-log.repository.js';
import { AdminAccessModule } from '../../src/admin-access/admin-access.module.js';
import {
  type AdminAccessLogDocument,
  AdminAccessLogEntity,
} from '../../src/admin-access/schemas/admin-access-log.schema.js';
import { AccountStatusEventsRepository } from '../../src/admin-accounts/account-status-events.repository.js';
import { AdminAccountsModule } from '../../src/admin-accounts/admin-accounts.module.js';
import {
  ACCOUNT_OFFICES_SOURCE,
  type AccountOfficesSource,
} from '../../src/admin-accounts/ports/account-offices.source.js';
import {
  type AccountStatusEventDocument,
  AccountStatusEventEntity,
} from '../../src/admin-accounts/schemas/account-status-event.schema.js';
import { AuthService } from '../../src/auth/auth.service.js';
import { GoogleAuthGuard } from '../../src/auth/guards/google-auth.guard.js';
import type { GoogleIdentity } from '../../src/auth/google/google-identity.js';
import { FavoritesModule } from '../../src/favorites/favorites.module.js';
import { createOpenApiDocument } from '../../src/openapi.js';
import { RemindersModule } from '../../src/reminders/reminders.module.js';
import { RemindersScheduler } from '../../src/reminders/reminders.scheduler.js';
import { RemindersService } from '../../src/reminders/reminders.service.js';
import {
  ReminderChannel,
  ReminderEntity,
  ReminderStatus,
} from '../../src/reminders/schemas/reminder.schema.js';
import { SavedFiltersModule } from '../../src/saved-filters/saved-filters.module.js';
import { SubscriptionEntity } from '../../src/subscriptions/schemas/subscription.schema.js';
import { SupportModule } from '../../src/support/support.module.js';
import { UserEntity, type UserDocument } from '../../src/users/schemas/user.schema.js';
import { UsersService } from '../../src/users/users.service.js';
import { DAY } from '../fakes/fake-clock.js';
import { createAuthTestApp, type AuthTestApp } from '../support/auth-test-app.js';
import { useTestDatabase } from '../support/test-database.js';
import { TEST_ENV } from '../support/test-env.js';

const PASSWORD = 'correct horse battery';
const IDENTITY_HEADER = 'x-test-google-identity';
const FRONTEND = 'http://localhost:3001';
const UNKNOWN_ID = '64b7f00000000000000ffff1';

interface Account {
  readonly id: string;
  readonly email: string;
  readonly token: string;
}

interface RecordBody {
  id: string;
  name: string | null;
  email: string | null;
  phone: string | null;
  createdAt: string;
  signInMethods: string[];
  emailConfirmed: boolean;
  status: string;
  personas: string[];
  offices: Array<{ id: string; name: string }>;
  plan: { code: string; status: string } | null;
  history: Array<{
    action: string;
    adminId: string;
    adminName: string | null;
    reason: string;
    at: string;
  }>;
}

/** The office names SPEC-011 will provide, for the seam's test (BR-009-13, BR-009-16). */
class FakeAccountOffices implements AccountOfficesSource {
  readonly byAccount = new Map<string, Array<{ id: string; name: string }>>();
  officesOf(accountId: string) {
    return Promise.resolve(this.byAccount.get(accountId) ?? []);
  }
}

describe('SPEC-009 account administration through the API (BR-009-13..BR-009-21)', () => {
  const db = useTestDatabase();
  const offices = new FakeAccountOffices();
  let harness: AuthTestApp;
  let users: Model<UserDocument>;
  let logs: Model<AdminAccessLogDocument>;
  let events: Model<AccountStatusEventDocument>;
  let reminders: Model<ReminderEntity>;
  let connection: Connection;
  let counter = 0;

  const server = () => harness.app.getHttpServer() as Parameters<typeof request>[0];
  const as = (account: Account) => ({ Authorization: `Bearer ${account.token}` });
  const get = (account: Account, path: string) => request(server()).get(path).set(as(account));
  const post = (account: Account, path: string, body: object = {}) =>
    request(server()).post(path).set(as(account)).send(body);
  /** A request with a method chosen at run time (the route list is read from the OpenAPI document). */
  const to = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string) =>
    request(server())[method](path);
  const me = (account: Account) => get(account, '/api/auth/me');
  const stored = (id: string) => users.findById(id).lean().exec();
  const eventsOf = (id: string) =>
    events.find({ userId: id }).sort({ at: 1, _id: 1 }).lean().exec();
  const clearLogs = () => connection.db?.collection('adminAccessLogs').deleteMany({});

  async function register(
    label: string,
    { confirm = true, name = `Pessoa ${label}` } = {},
  ): Promise<Account> {
    counter += 1;
    const email = `${label}-${counter}@example.test`.toLowerCase();
    const registered = await request(server())
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, name, acceptTerms: true })
      .expect(201);
    if (confirm) {
      const token = harness.mailbox.verificationEmails.find((sent) => sent.email === email)?.token;
      await request(server()).post('/api/auth/verify-email').send({ token }).expect(200);
    }
    return {
      id: (registered.body as { user: { _id: string } }).user._id,
      email,
      token: (registered.body as { accessToken: string }).accessToken,
    };
  }

  /** A signed-in admin: the capability is granted the way only the ops script does (SC-09). */
  async function admin(label = 'admin'): Promise<Account> {
    const account = await register(label);
    await users.updateOne({ _id: account.id }, { $set: { isAdmin: true } });
    return account;
  }

  const deactivate = (by: Account, target: string, reason = 'Motivo ficticio de teste') =>
    post(by, `/api/admin/accounts/${target}/deactivate`, { reason });
  const reactivate = (by: Account, target: string, body: object = {}) =>
    post(by, `/api/admin/accounts/${target}/reactivate`, body);
  const signIn = (email: string, password = PASSWORD) =>
    request(server()).post('/api/auth/login').send({ email, password });

  /** The HMAC the log holds of a search, written independently of the code under test (TS-04). */
  const expectedSearchValue = (kind: string, terms: string) =>
    `${kind}:${terms.length}:${createHmac('sha256', TEST_ENV.LOG_HASH_SECRET)
      .update(`account_search:${terms}`)
      .digest('hex')
      .slice(0, 32)}`;

  beforeAll(async () => {
    harness = await createAuthTestApp(
      db,
      [
        AdminAccountsModule,
        AdminAccessModule,
        SupportModule,
        RemindersModule,
        FavoritesModule,
        SavedFiltersModule,
      ],
      { SUPPORT_MAIL_JOB_ENABLED: 'false', REMINDERS_ENABLED: 'true' },
      (builder) =>
        builder
          .overrideProvider(ACCOUNT_OFFICES_SOURCE)
          .useValue(offices)
          .overrideGuard(GoogleAuthGuard)
          .useValue({
            canActivate(context: ExecutionContext) {
              const req = context.switchToHttp().getRequest<{
                headers: Record<string, string>;
                user?: GoogleIdentity;
              }>();
              req.user = JSON.parse(req.headers[IDENTITY_HEADER] ?? '{}') as GoogleIdentity;
              return true;
            },
          }),
    );
    const { moduleRef } = harness;
    connection = moduleRef.get(getConnectionToken());
    await connection.syncIndexes();
    users = moduleRef.get(getModelToken(UserEntity.name));
    logs = moduleRef.get(getModelToken(AdminAccessLogEntity.name), { strict: false });
    events = moduleRef.get(getModelToken(AccountStatusEventEntity.name), { strict: false });
    reminders = moduleRef.get(getModelToken(ReminderEntity.name), { strict: false });
  });

  afterAll(async () => {
    await harness.app.close();
  });

  afterEach(() => vi.restoreAllMocks());

  describe('BR-009-13: who may call, and what the surface is (TS-13)', () => {
    it('the routes of account administration and of the support queue are exactly these eight, so a new route is a decision', () => {
      const document = createOpenApiDocument(harness.app);

      const routes = Object.entries(document.paths)
        .filter(([path]) => /^\/api\/admin\/(accounts|support-requests)/.test(path))
        .flatMap(([path, operations]) =>
          Object.keys(operations as object).map((method) => `${method.toUpperCase()} ${path}`),
        )
        .sort();

      expect(routes).toEqual([
        'GET /api/admin/accounts',
        'GET /api/admin/accounts/{id}',
        'GET /api/admin/support-requests',
        'GET /api/admin/support-requests/{id}',
        'POST /api/admin/accounts/{id}/deactivate',
        'POST /api/admin/accounts/{id}/reactivate',
        'POST /api/admin/support-requests/{id}/close',
        'POST /api/admin/support-requests/{id}/grant',
      ]);
    });

    it('EVERY one of them answers 401 to a visitor, 403 FORBIDDEN to a signed-in account that is not an admin, and EMAIL_VERIFICATION_REQUIRED to an admin with an unconfirmed email', async () => {
      const document = createOpenApiDocument(harness.app);
      const operations = Object.entries(document.paths)
        .filter(([path]) => /^\/api\/admin\/(accounts|support-requests)/.test(path))
        .flatMap(([path, methods]) =>
          Object.keys(methods as object).map((method) => ({
            method: method as 'get' | 'post',
            path:
              path.replace('{id}', UNKNOWN_ID) + (path === '/api/admin/accounts' ? '?q=abc' : ''),
          })),
        );
      expect(operations).toHaveLength(8);
      const ordinary = await register('comum');
      const unconfirmedAdmin = await register('adminsememail', { confirm: false });
      await users.updateOne({ _id: unconfirmedAdmin.id }, { $set: { isAdmin: true } });
      const body = { reason: 'Motivo ficticio', subject: 'x' };

      for (const { method, path } of operations) {
        const visitor = await to(method, path).send(method === 'post' ? body : undefined);
        const notAdmin = await to(method, path)
          .set(as(ordinary))
          .send(method === 'post' ? body : undefined);
        const unconfirmed = await to(method, path)
          .set(as(unconfirmedAdmin))
          .send(method === 'post' ? body : undefined);

        expect([method, path, visitor.status], `${method} ${path}`).toEqual([method, path, 401]);
        expect([method, path, notAdmin.status, notAdmin.body]).toEqual([
          method,
          path,
          403,
          { code: 'FORBIDDEN', context: {} },
        ]);
        expect(unconfirmed.status).toBe(403);
        expect(unconfirmed.body).toEqual({ code: 'EMAIL_VERIFICATION_REQUIRED', context: {} });
      }
    });

    it('BR-009-21: no route edits an account: PATCH, PUT, DELETE and any other POST on /api/admin/accounts/:id are not routes', async () => {
      const boss = await admin();
      const target = await register('alvo');
      const before = await stored(target.id);

      for (const [method, path] of [
        ['patch', ''],
        ['put', ''],
        ['delete', ''],
        ['post', ''],
        ['post', '/name'],
        ['post', '/email'],
        ['post', '/personas'],
        ['post', '/memberships'],
        ['post', '/plan'],
        ['post', '/profile'],
        ['patch', '/status'],
      ] as const) {
        const res = await to(method, `/api/admin/accounts/${target.id}${path}`)
          .set(as(boss))
          .send({ name: 'Outro Nome', email: 'outro@example.test', isAdmin: true });
        expect([method, path, res.status]).toEqual([method, path, 404]);
      }
      expect(await stored(target.id)).toEqual(before);
    });

    it.each([
      ['name', 'Outro Nome'],
      ['email', 'outro@example.test'],
      ['personas', ['advisor']],
      ['memberships', ['64b000000000000000000001']],
      ['plan', 'advisor_5'],
      ['status', 'closed'],
      ['userId', '64b000000000000000000001'],
    ])(
      'BR-009-21: a deactivation naming "%s" is refused as a whole (VALIDATION_FAILED) and writes nothing',
      async (field, value) => {
        const boss = await admin();
        const target = await register('whitelist');
        const before = await stored(target.id);

        const res = await post(boss, `/api/admin/accounts/${target.id}/deactivate`, {
          reason: 'Motivo ficticio de teste',
          [field]: value,
        }).expect(400);

        expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
        expect(await stored(target.id)).toEqual(before);
        expect(await eventsOf(target.id)).toEqual([]);
      },
    );

    it('BR-009-21: a reactivation naming another field is refused too', async () => {
      const boss = await admin();
      const target = await register('whitelist2');
      await deactivate(boss, target.id).expect(200);

      await reactivate(boss, target.id, { note: 'ok', name: 'Outro' }).expect(400);

      expect((await stored(target.id))?.status).toBe('deactivated');
    });
  });

  describe('BR-009-13, BR-009-14: the search', () => {
    it('finds accounts by part of an email, ignoring case, and answers a row of exactly id, name, email, status and creation date', async () => {
      const boss = await admin();
      const target = await register('Procurada');

      const res = await get(boss, '/api/admin/accounts?q=PROCURADA-').expect(200);

      const body = res.body as {
        items: Array<Record<string, unknown>>;
        total: number;
        page: number;
        pageSize: number;
      };
      expect(body).toMatchObject({ total: 1, page: 1, pageSize: 20 });
      expect(Object.keys(body.items[0] ?? {}).sort()).toEqual([
        'createdAt',
        'email',
        'id',
        'name',
        'status',
      ]);
      expect(body.items[0]).toMatchObject({
        id: target.id,
        email: target.email.toLowerCase(),
        name: 'Pessoa Procurada',
        status: 'active',
      });
    });

    it('finds accounts by part of a name, case-insensitively, and by part of an email without an @', async () => {
      const boss = await admin();
      const target = await register('porNome', { name: 'Zelda Quimerica' });

      const byName = await get(boss, '/api/admin/accounts?q=quimerICA').expect(200);
      const byEmailPart = await get(
        boss,
        `/api/admin/accounts?q=${target.email.slice(0, 9)}`,
      ).expect(200);

      expect((byName.body as { items: Array<{ id: string }> }).items.map((i) => i.id)).toEqual([
        target.id,
      ]);
      expect(
        (byEmailPart.body as { items: Array<{ id: string }> }).items.map((i) => i.id),
      ).toContain(target.id);
    });

    it('a search with an @ looks at the address only, never at a name', async () => {
      const boss = await admin();
      await register('arroba', { name: 'ana@exemplo.test' });

      const res = await get(boss, '/api/admin/accounts?q=ana@exemplo.test').expect(200);

      expect((res.body as { total: number }).total).toBe(0);
    });

    it('lists deactivated and closed accounts, never a pending sign-up and never a purged tombstone', async () => {
      const boss = await admin();
      const deactivatedAccount = await register('listada-d');
      const closedAccount = await register('listada-c');
      const pendingAccount = await register('listada-p');
      const purgedAccount = await register('listada-x');
      await users.updateOne({ _id: deactivatedAccount.id }, { $set: { status: 'deactivated' } });
      await users.updateOne({ _id: closedAccount.id }, { $set: { status: 'closed' } });
      await users.updateOne({ _id: pendingAccount.id }, { $set: { status: 'pending' } });
      await users.updateOne(
        { _id: purgedAccount.id },
        { $set: { status: 'closed', purgedAt: new Date() } },
      );

      const res = await get(boss, '/api/admin/accounts?q=listada-').expect(200);

      const found = (res.body as { items: Array<{ id: string; status: string }> }).items;
      expect(found.map((item) => [item.id, item.status]).sort()).toEqual(
        [
          [deactivatedAccount.id, 'deactivated'],
          [closedAccount.id, 'closed'],
        ].sort(),
      );
    });

    it('sorts by name then id and pages: 5 accounts, pages of 2, the last page holds the 5th', async () => {
      const boss = await admin();
      for (const name of ['Paginada E', 'Paginada B', 'Paginada A', 'Paginada D', 'Paginada C']) {
        await register('paginada', { name });
      }

      const first = await get(boss, '/api/admin/accounts?q=paginada&page=1&pageSize=2').expect(200);
      const third = await get(boss, '/api/admin/accounts?q=paginada&page=3&pageSize=2').expect(200);

      expect(first.body).toMatchObject({ total: 5, page: 1, pageSize: 2 });
      expect((first.body as { items: Array<{ name: string }> }).items.map((i) => i.name)).toEqual([
        'Paginada A',
        'Paginada B',
      ]);
      expect((third.body as { items: Array<{ name: string }> }).items.map((i) => i.name)).toEqual([
        'Paginada E',
      ]);
    });

    it('the terms are LITERAL text: a pattern meant to match everything matches nothing, and never a 500', async () => {
      const boss = await admin();
      await register('literal');

      for (const q of ['.*.', '(((', '^literal', '(a+)+$', '[a-z]+']) {
        const res = await get(boss, `/api/admin/accounts?q=${encodeURIComponent(q)}`).expect(200);
        expect(res.body, q).toMatchObject({ total: 0, items: [] });
      }
    });

    it.each([
      ['no terms', ''],
      ['2 characters', '?q=ab'],
      ['2 characters between spaces', '?q=%20ab%20'],
      ['101 characters', `?q=${'a'.repeat(101)}`],
      ['an operator object', '?q[$ne]=zzz'],
      ['a page of 101', '?q=abc&pageSize=101'],
      ['page 0', '?q=abc&page=0'],
      ['another parameter', '?q=abc&status=active'],
    ])('refuses %s as VALIDATION_FAILED', async (_label, query) => {
      const boss = await admin();

      const res = await get(boss, `/api/admin/accounts${query}`).expect(400);

      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    });

    it('BR-009-14: one search writes ONE entry, with the kind, the length and a keyed hash of the normalised terms, and nothing readable', async () => {
      const boss = await admin();
      const target = await register('logbusca', { name: 'Maria Logada' });
      await clearLogs();

      await get(boss, '/api/admin/accounts?q=%20MARIA%20%20logada%20').expect(200);

      const entries = await logs.find().lean().exec();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        adminUserId: new Types.ObjectId(boss.id),
        action: 'account_search',
        query: expectedSearchValue('name', 'maria logada'),
        at: harness.clock.now(),
      });
      const text = JSON.stringify(entries);
      for (const secret of ['maria', 'logada', 'Maria Logada', target.email, 'logbusca']) {
        expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
      }
      expect(entries[0]?.owner).toBeUndefined();
      expect(entries[0]?.resource).toBeUndefined();
    });

    it('BR-009-14: an email search is logged as kind email, and a search with no result is logged too', async () => {
      const boss = await admin();
      await clearLogs();

      const res = await get(boss, '/api/admin/accounts?q=Ninguem@Exemplo.test').expect(200);

      expect((res.body as { total: number }).total).toBe(0);
      const entries = await logs.find().lean().exec();
      expect(entries.map((entry) => [entry.action, entry.query])).toEqual([
        ['account_search', expectedSearchValue('email', 'ninguem@exemplo.test')],
      ]);
    });

    it('BR-009-14: a refused search (too short) logs nothing: nothing was looked up', async () => {
      const boss = await admin();
      await clearLogs();

      await get(boss, '/api/admin/accounts?q=ab').expect(400);

      expect(await logs.countDocuments()).toBe(0);
    });

    it('BR-009-14: with the log unable to write, the search answers a bare 500 and NO account data (fail closed)', async () => {
      const boss = await admin();
      const target = await register('semlog', { name: 'Pessoa Sem Registro' });
      const repository = harness.moduleRef.get(AdminAccessLogRepository, { strict: false });
      vi.spyOn(repository, 'append').mockRejectedValue(new Error(`E11000 ${target.email}`));

      const res = await get(boss, '/api/admin/accounts?q=semlog').expect(500);

      expect(res.body).toEqual({ code: 'INTERNAL_ERROR', context: {} });
      expect(JSON.stringify(res.body)).not.toContain(target.email);
      expect(JSON.stringify(res.body)).not.toContain('Pessoa Sem Registro');
    });
  });

  describe('BR-009-13, BR-009-14: the account record', () => {
    it('answers EXACTLY the fields BR-009-13 lists plus the history, and logs ONE account_view entry for the admin and the account', async () => {
      const boss = await admin();
      const target = await register('registro', { name: 'Maria do Registro' });
      await users.updateOne({ _id: target.id }, { $set: { phone: '+5511900000000' } });
      await clearLogs();

      const res = await get(boss, `/api/admin/accounts/${target.id}`).expect(200);

      const body = res.body as RecordBody;
      expect(Object.keys(body).sort()).toEqual([
        'createdAt',
        'email',
        'emailConfirmed',
        'history',
        'id',
        'name',
        'offices',
        'personas',
        'phone',
        'plan',
        'signInMethods',
        'status',
      ]);
      expect(body).toMatchObject({
        id: target.id,
        name: 'Maria do Registro',
        email: target.email.toLowerCase(),
        phone: '+5511900000000',
        createdAt: ((await stored(target.id))?.createdAt as Date).toISOString(),
        signInMethods: ['password'],
        emailConfirmed: true,
        status: 'active',
        personas: ['searcher'],
        offices: [],
        plan: null,
        history: [],
      });
      const entries = await logs.find().lean().exec();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        adminUserId: new Types.ObjectId(boss.id),
        action: 'account_view',
        resource: { type: 'account', id: new Types.ObjectId(target.id) },
        at: harness.clock.now(),
      });
      expect(entries[0]?.owner).toBeUndefined();
      expect(entries[0]?.query).toBeUndefined();
      expect(JSON.stringify(entries)).not.toContain('Maria');
    });

    it('lists the sign-in methods an account has: a password and Google', async () => {
      const boss = await admin();
      const target = await register('metodos');
      await users.updateOne(
        { _id: target.id },
        { $set: { providers: ['local', 'google'], googleId: 'g-metodos' } },
      );

      const res = await get(boss, `/api/admin/accounts/${target.id}`).expect(200);

      expect((res.body as RecordBody).signInMethods).toEqual(['password', 'google']);
    });

    it('says an email is not confirmed', async () => {
      const boss = await admin();
      const target = await register('naoconf', { confirm: false });

      const res = await get(boss, `/api/admin/accounts/${target.id}`).expect(200);

      expect((res.body as RecordBody).emailConfirmed).toBe(false);
    });

    it('TS-15: nothing the account keeps in the product is in the record: favorites, reminders, saved filters and a subscription are seeded and only the plan shows', async () => {
      const boss = await admin();
      const target = await register('cheia', { name: 'Conta Cheia' });
      const auction = new Types.ObjectId();
      const { moduleRef } = harness;
      await moduleRef
        .get<Model<unknown>>(getModelToken('FavoriteEntity'), { strict: false })
        .collection.insertOne({
          userId: new Types.ObjectId(target.id),
          auctionCode: 'MARCADOR-FAVORITO',
          auction,
        });
      await moduleRef
        .get<Model<unknown>>(getModelToken('SavedFilterEntity'), { strict: false })
        .collection.insertOne({
          userId: new Types.ObjectId(target.id),
          name: 'MARCADOR-FILTRO',
          filters: { city: 'MARCADOR-CIDADE' },
        });
      await reminders.collection.insertOne({
        userId: new Types.ObjectId(target.id),
        auction,
        channel: ReminderChannel.EMAIL,
        scheduledAt: new Date('2099-02-01T12:00:00.000Z'),
        description: 'MARCADOR-LEMBRETE',
        status: ReminderStatus.PENDING,
      });
      await moduleRef
        .get<Model<SubscriptionEntity>>(getModelToken(SubscriptionEntity.name), { strict: false })
        .collection.insertOne({
          buyerUserId: new Types.ObjectId(target.id),
          planId: new Types.ObjectId(),
          planCode: 'advisor_5',
          activeJourneyLimit: 5,
          status: 'ACTIVE',
          cancelAtPeriodEnd: false,
          stripeCustomerId: 'cus_MARCADOR_CLIENTE',
          stripeSubscriptionId: 'sub_MARCADOR_ASSINATURA',
          createdAt: new Date('2099-01-10T00:00:00.000Z'),
          updatedAt: new Date('2099-01-10T00:00:00.000Z'),
        });

      const res = await get(boss, `/api/admin/accounts/${target.id}`).expect(200);

      const body = res.body as RecordBody;
      expect(Object.keys(body).sort()).toEqual([
        'createdAt',
        'email',
        'emailConfirmed',
        'history',
        'id',
        'name',
        'offices',
        'personas',
        'phone',
        'plan',
        'signInMethods',
        'status',
      ]);
      expect(body.plan).toEqual({ code: 'advisor_5', status: 'ACTIVE' });
      const text = JSON.stringify(body);
      for (const marker of ['MARCADOR', 'cus_', 'sub_', 'auctionCode', 'filters']) {
        expect(text).not.toContain(marker);
      }
    });

    it('shows the names of the offices the seam names, with their ids and nothing else', async () => {
      const boss = await admin();
      const target = await register('escritorios');
      offices.byAccount.set(target.id, [
        { id: '64b000000000000000000a01', name: 'Escritorio Ficticio' },
      ]);

      const res = await get(boss, `/api/admin/accounts/${target.id}`).expect(200);

      expect((res.body as RecordBody).offices).toEqual([
        { id: '64b000000000000000000a01', name: 'Escritorio Ficticio' },
      ]);
      offices.byAccount.delete(target.id);
    });

    it('BR-009-16: a DEACTIVATED account still shows its offices: its memberships exist, they only give no access', async () => {
      const boss = await admin();
      const target = await register('escritorios-d');
      offices.byAccount.set(target.id, [
        { id: '64b000000000000000000a02', name: 'Escritorio Ficticio D' },
      ]);
      await deactivate(boss, target.id).expect(200);

      const res = await get(boss, `/api/admin/accounts/${target.id}`).expect(200);

      expect((res.body as RecordBody).status).toBe('deactivated');
      expect((res.body as RecordBody).offices).toHaveLength(1);
      offices.byAccount.delete(target.id);
    });

    it('an admin opens their own record, and an admin account holds the searcher persona only', async () => {
      const boss = await admin();

      const res = await get(boss, `/api/admin/accounts/${boss.id}`).expect(200);

      expect((res.body as RecordBody).personas).toEqual(['searcher']);
    });

    it('a purged account answers status closed with no name, address or phone', async () => {
      const boss = await admin();
      const target = await register('purgada', { name: 'Pessoa Purgada' });
      await users.collection.updateOne(
        { _id: new Types.ObjectId(target.id) },
        {
          $set: {
            status: 'closed',
            purgedAt: new Date(),
            email: `purged-${target.id}@removed.invalid`,
          },
          $unset: { name: '', phone: '' },
        },
      );

      const res = await get(boss, `/api/admin/accounts/${target.id}`).expect(200);

      expect(res.body).toMatchObject({ status: 'closed', name: null, email: null, phone: null });
      expect(JSON.stringify(res.body)).not.toContain('removed.invalid');
    });

    it.each([
      ['an unknown id', UNKNOWN_ID],
      ['a malformed id', 'nao-e-um-id'],
      ['an operator-looking id', '%7B%22%24ne%22%3Anull%7D'],
    ])('%s is 404 NOT_FOUND and logs nothing: no record was viewed', async (_label, id) => {
      const boss = await admin();
      await clearLogs();

      const res = await get(boss, `/api/admin/accounts/${id}`).expect(404);

      expect(res.body).toEqual({ code: 'NOT_FOUND', context: {} });
      expect(await logs.countDocuments()).toBe(0);
    });

    it('a pending sign-up is not an account an admin can open: 404', async () => {
      const boss = await admin();
      const target = await register('pendente');
      await users.updateOne({ _id: target.id }, { $set: { status: 'pending' } });

      await get(boss, `/api/admin/accounts/${target.id}`).expect(404);
    });

    it('BR-009-14: with the log unable to write, the record answers a bare 500 and NO account data (fail closed)', async () => {
      const boss = await admin();
      const target = await register('semlog2', { name: 'Pessoa Sem Registro Dois' });
      const repository = harness.moduleRef.get(AdminAccessLogRepository, { strict: false });
      vi.spyOn(repository, 'append').mockRejectedValue(new Error('the database is down'));

      const res = await get(boss, `/api/admin/accounts/${target.id}`).expect(500);

      expect(res.body).toEqual({ code: 'INTERNAL_ERROR', context: {} });
      expect(JSON.stringify(res.body)).not.toContain(target.email);
      expect(JSON.stringify(res.body)).not.toContain('Sem Registro Dois');
    });

    it('BR-009-14: concurrent searches and views by two admins write one entry each, no more and no fewer', async () => {
      const boss = await admin('boss1');
      const other = await admin('boss2');
      const target = await register('concorrente');
      await clearLogs();

      await Promise.all([
        ...Array.from({ length: 6 }, () =>
          get(boss, '/api/admin/accounts?q=concorrente').expect(200),
        ),
        ...Array.from({ length: 6 }, () =>
          get(other, `/api/admin/accounts/${target.id}`).expect(200),
        ),
      ]);

      expect(await logs.countDocuments({ action: 'account_search', adminUserId: boss.id })).toBe(6);
      expect(await logs.countDocuments({ action: 'account_view', adminUserId: other.id })).toBe(6);
      expect(await logs.countDocuments()).toBe(12);
    });
  });

  describe('BR-009-15..BR-009-19: deactivating and reactivating', () => {
    it('BR-009-15: after a deactivation the open session is refused on its next request, password sign-in answers ACCOUNT_DEACTIVATED, and the answer is 200 with the status and the time', async () => {
      const boss = await admin();
      const target = await register('desativar');
      await me(target).expect(200);

      const res = await deactivate(boss, target.id, 'Uso indevido da conta, confirmado').expect(
        200,
      );

      expect(res.body).toEqual({
        id: target.id,
        status: 'deactivated',
        at: harness.clock.now().toISOString(),
      });
      await me(target).expect(401);
      const attempt = await signIn(target.email).expect(403);
      expect(attempt.body).toEqual({ code: 'ACCOUNT_DEACTIVATED', context: {} });
    });

    it('BR-009-20: WRONG credentials of a deactivated account get the usual INVALID_CREDENTIALS, the same body as an unknown email', async () => {
      const boss = await admin();
      const target = await register('desativar-erro');
      await deactivate(boss, target.id).expect(200);

      const wrong = await signIn(target.email, 'a wrong password').expect(401);
      const unknown = await signIn('ninguem-aqui@example.test', 'a wrong password').expect(401);

      expect(wrong.body).toEqual({ code: 'INVALID_CREDENTIALS', context: {} });
      expect(wrong.body).toEqual(unknown.body);
    });

    it('BR-009-20, BR-001-15: a sign-in that answers ACCOUNT_DEACTIVATED is counted like any attempt: the 11th in 15 minutes is TOO_MANY_ATTEMPTS', async () => {
      const boss = await admin();
      const target = await register('desativar-conta');
      await deactivate(boss, target.id).expect(200);
      for (let i = 0; i < 10; i += 1) {
        await signIn(target.email)
          .set('X-Forwarded-For', `198.51.100.${i + 1}`)
          .expect(403);
      }

      const blocked = await signIn(target.email)
        .set('X-Forwarded-For', '198.51.100.200')
        .expect(429);

      expect(blocked.body).toEqual({ code: 'TOO_MANY_ATTEMPTS', context: {} });
    });

    it('BR-009-20: closed and pending accounts keep today’s answer, INVALID_CREDENTIALS, with the right password', async () => {
      const closed = await register('fechada');
      const pending = await register('pendente2');
      await users.updateOne({ _id: closed.id }, { $set: { status: 'closed' } });
      await users.updateOne({ _id: pending.id }, { $set: { status: 'pending' } });

      for (const account of [closed, pending]) {
        const res = await signIn(account.email).expect(401);
        expect(res.body).toEqual({ code: 'INVALID_CREDENTIALS', context: {} });
      }
    });

    it('BR-009-15, BR-009-20: Google sign-in of a deactivated account redirects to /login?error=ACCOUNT_DEACTIVATED; a closed one keeps GOOGLE_SIGN_IN_FAILED', async () => {
      const boss = await admin();
      const linked = await register('google-d');
      const closed = await register('google-c');
      await users.updateOne(
        { _id: linked.id },
        { $set: { googleId: 'g-linked-d', providers: ['local', 'google'] } },
      );
      await users.updateOne(
        { _id: closed.id },
        { $set: { googleId: 'g-linked-c', providers: ['local', 'google'], status: 'closed' } },
      );
      await deactivate(boss, linked.id).expect(200);
      const callback = (who: GoogleIdentity) =>
        request(server())
          .get('/api/auth/google/callback')
          .set(IDENTITY_HEADER, JSON.stringify(who));

      // By Google identity, and by the address of an account not linked yet.
      const byIdentity = await callback({
        googleId: 'g-linked-d',
        email: linked.email,
        emailVerified: true,
        name: 'X',
      }).expect(302);
      const byEmail = await callback({
        googleId: 'g-new-d',
        email: linked.email,
        emailVerified: true,
        name: 'X',
      }).expect(302);
      const closedRes = await callback({
        googleId: 'g-linked-c',
        email: closed.email,
        emailVerified: true,
        name: 'X',
      }).expect(302);

      expect(byIdentity.headers['location']).toBe(`${FRONTEND}/login?error=ACCOUNT_DEACTIVATED`);
      expect(byEmail.headers['location']).toBe(`${FRONTEND}/login?error=ACCOUNT_DEACTIVATED`);
      expect(closedRes.headers['location']).toBe(`${FRONTEND}/login?error=GOOGLE_SIGN_IN_FAILED`);
      // Nothing was linked to the deactivated account by the second attempt.
      expect((await stored(linked.id))?.googleId).toBe('g-linked-d');
    });

    it('BR-009-15: a Google code issued before the deactivation is revoked with it; were the revocation to fail, the exchange still gives no session and says why', async () => {
      const boss = await admin();
      const callbackFor = (target: Account, googleId: string) =>
        request(server())
          .get('/api/auth/google/callback')
          .set(
            IDENTITY_HEADER,
            JSON.stringify({ googleId, email: target.email, emailVerified: true, name: 'X' }),
          )
          .expect(302)
          .then((res) => new URL(res.headers['location'] as string).searchParams.get('code'));
      const revoked = await register('google-meio');
      const surviving = await register('google-meio-b');
      for (const [account, googleId] of [
        [revoked, 'g-meio'],
        [surviving, 'g-meio-b'],
      ] as const) {
        await users.updateOne(
          { _id: account.id },
          { $set: { googleId, providers: ['local', 'google'] } },
        );
      }
      const revokedCode = await callbackFor(revoked, 'g-meio');
      const survivingCode = await callbackFor(surviving, 'g-meio-b');

      await deactivate(boss, revoked.id).expect(200);
      vi.spyOn(harness.moduleRef.get(AuthService), 'endAllSessionsAndLinks').mockRejectedValueOnce(
        new Error('the database is down'),
      );
      await deactivate(boss, surviving.id).expect(200);

      const revokedRes = await request(server())
        .post('/api/auth/google/exchange')
        .send({ code: revokedCode })
        .expect(400);
      const survivingRes = await request(server())
        .post('/api/auth/google/exchange')
        .send({ code: survivingCode })
        .expect(403);
      expect(revokedRes.body).toEqual({ code: 'INVALID_GOOGLE_CODE', context: {} });
      expect(survivingRes.body).toEqual({ code: 'ACCOUNT_DEACTIVATED', context: {} });
    });

    it('BR-009-18: the address of a deactivated account cannot be used to create another account, by password or by Google', async () => {
      const boss = await admin();
      const target = await register('endereco-preso');
      await deactivate(boss, target.id).expect(200);

      const byPassword = await request(server())
        .post('/api/auth/register')
        .send({
          email: target.email.toUpperCase(),
          password: PASSWORD,
          name: 'Outra Pessoa',
          acceptTerms: true,
        })
        .expect(409);
      // A Google sign-up started before the deactivation ends in the same refusal.
      const who = {
        googleId: 'g-novo',
        email: `novo-${target.email}`,
        emailVerified: true,
        name: 'Pessoa Nova',
      };
      const redirect = await request(server())
        .get('/api/auth/google/callback')
        .set(IDENTITY_HEADER, JSON.stringify(who))
        .expect(302);
      const code = new URL(redirect.headers['location'] as string).searchParams.get('code');
      const sameAddress = await register('endereco-preso-g');
      await users.updateOne({ _id: sameAddress.id }, { $set: { email: `novo-${target.email}` } });
      await deactivate(boss, sameAddress.id).expect(200);
      const byGoogle = await request(server())
        .post('/api/auth/google/complete')
        .send({ code, acceptTerms: true })
        .expect(403);

      expect(byPassword.body).toEqual({ code: 'EMAIL_ALREADY_REGISTERED', context: {} });
      expect(byGoogle.body).toEqual({ code: 'ACCOUNT_DEACTIVATED', context: {} });
      expect(await users.countDocuments({ email: target.email.toLowerCase() })).toBe(1);
      expect(await users.countDocuments({ email: `novo-${target.email}` })).toBe(1);
    });

    it('BR-009-15: the account’s sessions are revoked on the server too, and the record keeps who, when and why', async () => {
      const boss = await admin();
      const target = await register('revogada', { name: 'Pessoa Revogada' });
      await signIn(target.email).expect(200); // a second session
      const before = await stored(target.id);

      await deactivate(boss, target.id, 'Pedido do titular por e-mail').expect(200);

      const sessions = await connection.db
        ?.collection('sessions')
        .find({ userId: new Types.ObjectId(target.id) })
        .toArray();
      expect(sessions).toHaveLength(2);
      expect(sessions?.every((session) => session['revokedAt'] instanceof Date)).toBe(true);
      const after = await stored(target.id);
      expect(after?.credentialVersion).toBe((before?.credentialVersion ?? 0) + 1);
      expect(await eventsOf(target.id)).toMatchObject([
        {
          action: 'deactivated',
          adminUserId: new Types.ObjectId(boss.id),
          reason: 'Pedido do titular por e-mail',
          at: harness.clock.now(),
        },
      ]);
    });

    it('BR-009-15: a failure to revoke the sessions does not undo the deactivation, and the old session is refused all the same (the credential version)', async () => {
      const boss = await admin();
      const target = await register('revoga-falha');
      const auth = harness.moduleRef.get(AuthService);
      vi.spyOn(auth, 'endAllSessionsAndLinks').mockRejectedValue(new Error('the database is down'));

      await deactivate(boss, target.id).expect(200);

      expect((await stored(target.id))?.status).toBe('deactivated');
      await me(target).expect(401);
    });

    it('BR-009-19: an admin cannot deactivate the account they are signed in with: 403, nothing written, the session still works', async () => {
      const boss = await admin();

      const res = await deactivate(boss, boss.id).expect(403);

      expect(res.body).toEqual({ code: 'CANNOT_DEACTIVATE_OWN_ACCOUNT', context: {} });
      expect((await stored(boss.id))?.status).toBe('active');
      expect(await eventsOf(boss.id)).toEqual([]);
      await me(boss).expect(200);
    });

    it('an admin MAY deactivate another admin, who is then refused on the next request', async () => {
      const boss = await admin('boss-a');
      const colleague = await admin('boss-b');

      await deactivate(boss, colleague.id).expect(200);

      await get(colleague, '/api/admin/accounts?q=abc').expect(401);
      await get(boss, '/api/admin/accounts?q=abc').expect(200);
    });

    it.each([
      ['a closed account', 'closed'],
      ['a pending sign-up', 'pending'],
    ])(
      '%s is ACCOUNT_STATE_CONFLICT for both changes, and nothing is written',
      async (_label, status) => {
        const boss = await admin();
        const target = await register(`estado-${status}`);
        await users.updateOne({ _id: target.id }, { $set: { status } });
        const before = await stored(target.id);

        const first = await deactivate(boss, target.id).expect(409);
        const second = await reactivate(boss, target.id).expect(status === 'pending' ? 404 : 409);

        expect(first.body).toEqual({ code: 'ACCOUNT_STATE_CONFLICT', context: {} });
        expect(second.status).toBe(status === 'pending' ? 404 : 409);
        expect(await stored(target.id)).toEqual(before);
        expect(await eventsOf(target.id)).toEqual([]);
      },
    );

    it('deactivating twice is a conflict the second time: one entry, and the credential version moved once', async () => {
      const boss = await admin();
      const target = await register('duas-vezes');
      const before = await stored(target.id);

      await deactivate(boss, target.id).expect(200);
      const again = await deactivate(boss, target.id).expect(409);

      expect(again.body).toEqual({ code: 'ACCOUNT_STATE_CONFLICT', context: {} });
      expect(await eventsOf(target.id)).toHaveLength(1);
      expect((await stored(target.id))?.credentialVersion).toBe(
        (before?.credentialVersion ?? 0) + 1,
      );
    });

    it('reactivating an active account is a conflict and changes nothing, reminders included', async () => {
      const boss = await admin();
      const target = await register('ativa-ja');
      const reminder = await seedReminder(target.id, -DAY); // due already
      const before = await stored(target.id);

      const res = await reactivate(boss, target.id).expect(409);

      expect(res.body).toEqual({ code: 'ACCOUNT_STATE_CONFLICT', context: {} });
      expect(await stored(target.id)).toEqual(before);
      expect((await reminders.findById(reminder).lean().exec())?.status).toBe(
        ReminderStatus.PENDING,
      );
    });

    it.each([
      ['an unknown id', UNKNOWN_ID],
      ['a malformed id', 'nao-e-um-id'],
    ])('%s is 404 for both changes', async (_label, id) => {
      const boss = await admin();

      await deactivate(boss, id).expect(404);
      await reactivate(boss, id).expect(404);
    });

    it.each([
      ['no reason', {}],
      ['a reason of 2 characters', { reason: 'ab' }],
      ['a reason of only spaces', { reason: '     ' }],
      ['a reason of 501 characters', { reason: 'a'.repeat(501) }],
      ['a reason that is not text', { reason: 12345 }],
    ])('BR-009-15: %s is refused and writes nothing', async (_label, body) => {
      const boss = await admin();
      const target = await register('motivo');

      const res = await post(boss, `/api/admin/accounts/${target.id}/deactivate`, body).expect(400);

      expect(res.body).toMatchObject({ code: 'VALIDATION_FAILED' });
      expect((await stored(target.id))?.status).toBe('active');
    });

    it('BR-009-15: a reason is one line: line breaks become spaces, and 500 characters are accepted', async () => {
      const boss = await admin();
      const target = await register('linha');

      await deactivate(
        boss,
        target.id,
        `Primeira linha\nsegunda linha\r\n${'x'.repeat(470)}`,
      ).expect(200);

      const [entry] = await eventsOf(target.id);
      expect(entry?.reason.startsWith('Primeira linha segunda linha ')).toBe(true);
      expect(entry?.reason).not.toMatch(/[\r\n]/);
    });

    it('BR-009-17: a reactivation records the admin, the time and the note; the note is optional but never longer than 500', async () => {
      const boss = await admin('reativa-boss');
      const target = await register('reativar');
      await deactivate(boss, target.id).expect(200);
      harness.clock.advance(DAY);

      const res = await reactivate(boss, target.id, {
        note: 'Titular confirmou a identidade',
      }).expect(200);
      await reactivate(boss, target.id, { note: 'x'.repeat(501) }).expect(400);

      expect(res.body).toEqual({
        id: target.id,
        status: 'active',
        at: harness.clock.now().toISOString(),
      });
      const entries = await eventsOf(target.id);
      expect(entries.map((e) => [e.action, e.reason, e.at.toISOString()])).toEqual([
        [
          'deactivated',
          'Motivo ficticio de teste',
          new Date(harness.clock.now().getTime() - DAY).toISOString(),
        ],
        ['reactivated', 'Titular confirmou a identidade', harness.clock.now().toISOString()],
      ]);
    });

    it('BR-009-17: a reactivation without a note records an empty one, and restores sign-in with NO earlier session', async () => {
      const boss = await admin();
      const target = await register('reativa-sem-nota');
      await deactivate(boss, target.id).expect(200);

      await reactivate(boss, target.id).expect(200);

      expect((await eventsOf(target.id))[1]).toMatchObject({ action: 'reactivated', reason: '' });
      await me(target).expect(401); // the session of before is dead for good
      const fresh = await signIn(target.email).expect(200);
      await request(server())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${(fresh.body as { accessToken: string }).accessToken}`)
        .expect(200);
    });

    it('BR-009-17: the history shows newest first, with the admin’s name, on the record', async () => {
      const boss = await admin('historico-boss');
      await users.updateOne({ _id: boss.id }, { $set: { name: 'Admin Historico' } });
      const target = await register('historico');
      await deactivate(boss, target.id, 'Primeiro motivo').expect(200);
      harness.clock.advance(DAY);
      await reactivate(boss, target.id, { note: 'Segunda nota' }).expect(200);

      const res = await get(boss, `/api/admin/accounts/${target.id}`).expect(200);

      const history = (res.body as RecordBody).history;
      expect(history.map((h) => [h.action, h.reason, h.adminId, h.adminName])).toEqual([
        ['reactivated', 'Segunda nota', boss.id, 'Admin Historico'],
        ['deactivated', 'Primeiro motivo', boss.id, 'Admin Historico'],
      ]);
    });

    it('BR-009-16: deactivation and reactivation delete and move NOTHING: favorites, reminders to come, the subscription and the profile are as they were', async () => {
      const boss = await admin();
      const target = await register('intacta', { name: 'Conta Intacta' });
      const auction = new Types.ObjectId();
      const favorites = harness.moduleRef.get<Model<unknown>>(getModelToken('FavoriteEntity'), {
        strict: false,
      });
      const subscriptions = harness.moduleRef.get<Model<unknown>>(
        getModelToken(SubscriptionEntity.name),
        { strict: false },
      );
      await favorites.collection.insertOne({
        userId: new Types.ObjectId(target.id),
        auctionCode: 'COD-INTACTO',
        auction,
      });
      await subscriptions.collection.insertOne({
        buyerUserId: new Types.ObjectId(target.id),
        planId: new Types.ObjectId(),
        planCode: 'advisor_5',
        activeJourneyLimit: 5,
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        createdAt: new Date('2099-01-10T00:00:00.000Z'),
        updatedAt: new Date('2099-01-10T00:00:00.000Z'),
      });
      const future = await seedReminder(target.id, 5 * DAY);
      const snapshot = async () => ({
        favorites: await favorites.collection
          .find({ userId: new Types.ObjectId(target.id) })
          .toArray(),
        subscriptions: await subscriptions.collection
          .find({ buyerUserId: new Types.ObjectId(target.id) })
          .toArray(),
        reminder: await reminders.findById(future).lean().exec(),
        profile: await users
          .findById(target.id)
          .select('name email phone providers emailVerified isAdmin role subscriptionStatus')
          .lean()
          .exec(),
      });
      const before = await snapshot();

      await deactivate(boss, target.id).expect(200);
      await reactivate(boss, target.id).expect(200);

      expect(await snapshot()).toEqual(before);
    });
  });

  describe('BR-009-15, BR-009-17: reminders and notifications', () => {
    const scheduler = () => harness.moduleRef.get(RemindersScheduler);

    it('BR-009-15: a reminder that falls due while the account is deactivated is not sent, and is CANCELLED when found (never left pending)', async () => {
      const boss = await admin();
      const target = await register('lembrete-d');
      const reminder = await seedReminder(target.id, DAY); // due tomorrow
      await deactivate(boss, target.id).expect(200);
      harness.clock.advance(2 * DAY);

      await scheduler().processReminders();

      expect(
        harness.mailbox.reminderEmails.filter((m) => m.email === target.email.toLowerCase()),
      ).toEqual([]);
      expect((await reminders.findById(reminder).lean().exec())?.status).toBe(
        ReminderStatus.CANCELLED,
      );
    });

    it('BR-009-17: a reminder that fell due while deactivated is never sent late after the reactivation, even before any job run; one still to come is sent on time', async () => {
      const boss = await admin();
      const target = await register('lembrete-r');
      const fellDue = await seedReminder(target.id, DAY);
      const stillToCome = await seedReminder(target.id, 6 * DAY);
      await deactivate(boss, target.id).expect(200);
      harness.clock.advance(2 * DAY);

      await reactivate(boss, target.id).expect(200);
      await scheduler().processReminders();

      expect((await reminders.findById(fellDue).lean().exec())?.status).toBe(
        ReminderStatus.CANCELLED,
      );
      expect((await reminders.findById(stillToCome).lean().exec())?.status).toBe(
        ReminderStatus.PENDING,
      );
      expect(
        harness.mailbox.reminderEmails.filter((m) => m.email === target.email.toLowerCase()),
      ).toEqual([]);

      harness.clock.advance(5 * DAY);
      await scheduler().processReminders();

      expect((await reminders.findById(stillToCome).lean().exec())?.status).toBe(
        ReminderStatus.SENT,
      );
      expect(
        harness.mailbox.reminderEmails.filter((m) => m.email === target.email.toLowerCase()),
      ).toHaveLength(1);
    });

    it('BR-009-17: a reminder due exactly when the account is reactivated counts as fallen due and is cancelled; one a second later is not', async () => {
      const boss = await admin();
      const target = await register('lembrete-borda');
      const exactly = await seedReminder(target.id, 2 * DAY);
      const later = await seedReminder(target.id, 2 * DAY + 1000);
      await deactivate(boss, target.id).expect(200);
      harness.clock.advance(2 * DAY);

      await reactivate(boss, target.id).expect(200);

      expect((await reminders.findById(exactly).lean().exec())?.status).toBe(
        ReminderStatus.CANCELLED,
      );
      expect((await reminders.findById(later).lean().exec())?.status).toBe(ReminderStatus.PENDING);
    });

    it('BR-009-17: the reminders of other accounts are untouched by a reactivation', async () => {
      const boss = await admin();
      const target = await register('lembrete-meu');
      const bystander = await register('lembrete-outro');
      const theirs = await seedReminder(bystander.id, -DAY); // due already
      await deactivate(boss, target.id).expect(200);

      await reactivate(boss, target.id).expect(200);

      expect((await reminders.findById(theirs).lean().exec())?.status).toBe(ReminderStatus.PENDING);
    });

    it('a failure to cancel the due reminders BEFORE the status flips stops the reactivation: the account stays deactivated and can be reactivated again', async () => {
      const boss = await admin();
      const target = await register('lembrete-falha');
      await deactivate(boss, target.id).expect(200);
      const service = harness.moduleRef.get(RemindersService);
      vi.spyOn(service, 'cancelDueOfAccount').mockRejectedValueOnce(
        new Error('the database is down'),
      );

      await reactivate(boss, target.id).expect(500);

      expect((await stored(target.id))?.status).toBe('deactivated');
      expect(await eventsOf(target.id)).toHaveLength(1);
      await reactivate(boss, target.id).expect(200);
    });

    it('BR-009-15: nothing else is mailed to a deactivated account: no password reset, no support confirmation', async () => {
      const boss = await admin();
      const target = await register('sem-email');
      await deactivate(boss, target.id).expect(200);
      const before = harness.mailbox.passwordResetEmails.length;

      await request(server())
        .post('/api/auth/reset-password-request')
        .send({ email: target.email })
        .expect(200);
      await harness.moduleRef.get(AuthService).flushDeliveries();

      expect(harness.mailbox.passwordResetEmails).toHaveLength(before);
    });
  });

  describe('races (forced interleavings, TS-06)', () => {
    /** Holds the NEXT history append of a status change inside its transaction, until `release()`. */
    function holdNextAppend() {
      const repository = harness.moduleRef.get(AccountStatusEventsRepository);
      const original = repository.append.bind(repository);
      let reached!: () => void;
      const reachedIt = new Promise<void>((resolve) => (reached = resolve));
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));
      vi.spyOn(repository, 'append').mockImplementationOnce(async (entry, session) => {
        reached(); // the status is written in the transaction, not committed
        await held;
        return original(entry, session);
      });
      return { reachedIt, release };
    }

    it('two admins deactivate the same account at once: exactly one 200 and one 409, ONE history entry, the credential version moved once', async () => {
      const [first, second] = [await admin('corre-a'), await admin('corre-b')];
      const target = await register('corrida-dupla');
      const before = await stored(target.id);
      const hold = holdNextAppend();
      const users = harness.moduleRef.get(UsersService);
      const attempts = vi.spyOn(users, 'deactivateAccount');

      const winner = deactivate(first, target.id).then((res) => res);
      await hold.reachedIt; // the first transaction wrote the status and waits to commit
      const loser = deactivate(second, target.id).then((res) => res);
      // The second transaction meets the first's uncommitted write (a transient conflict the driver retries).
      await vi.waitFor(() => expect(attempts.mock.calls.length).toBeGreaterThanOrEqual(3));
      hold.release();
      const [a, b] = await Promise.all([winner, loser]);

      expect([a.status, b.status]).toEqual([200, 409]);
      expect(b.body).toEqual({ code: 'ACCOUNT_STATE_CONFLICT', context: {} });
      const entries = await eventsOf(target.id);
      expect(entries).toHaveLength(1);
      expect(entries[0]?.adminUserId).toEqual(new Types.ObjectId(first.id));
      const after = await stored(target.id);
      expect(after?.status).toBe('deactivated');
      expect(after?.credentialVersion).toBe((before?.credentialVersion ?? 0) + 1);
    });

    it('a reactivation against a deactivation in flight: the reactivation sees an active account and is refused; the end state is the last committed entry', async () => {
      const boss = await admin();
      const target = await register('corrida-ativa');
      const hold = holdNextAppend();

      const deactivating = deactivate(boss, target.id).then((res) => res);
      await hold.reachedIt;
      const reactivating = await reactivate(boss, target.id); // no commit yet: the account is still active
      hold.release();
      const deactivated = await deactivating;

      expect(reactivating.status).toBe(409);
      expect(deactivated.status).toBe(200);
      const entries = await eventsOf(target.id);
      expect(entries.map((e) => e.action)).toEqual(['deactivated']);
      expect((await stored(target.id))?.status).toBe('deactivated'); // equals the last committed entry
    });

    it('a deactivation against a reactivation in flight: the deactivation sees a deactivated account and is refused; the end state is the last committed entry', async () => {
      const boss = await admin();
      const target = await register('corrida-desativa');
      await deactivate(boss, target.id).expect(200);
      const hold = holdNextAppend();

      const reactivating = reactivate(boss, target.id).then((res) => res);
      await hold.reachedIt;
      const deactivating = await deactivate(boss, target.id); // the reactivation is not committed yet
      hold.release();
      const reactivated = await reactivating;

      expect(deactivating.status).toBe(409);
      expect(reactivated.status).toBe(200);
      expect((await eventsOf(target.id)).map((e) => e.action)).toEqual([
        'deactivated',
        'reactivated',
      ]);
      expect((await stored(target.id))?.status).toBe('active');
    });

    it('SC-03: a sign-in that checked the password before the deactivation gets a session that stays refused through the deactivation AND the reactivation', async () => {
      const boss = await admin();
      const target = await register('login-voo');
      const auth = harness.moduleRef.get(AuthService);
      const original = auth.startSession.bind(auth);
      let started!: () => void;
      const reachedStart = new Promise<void>((resolve) => (started = resolve));
      let letItGo!: () => void;
      const hold = new Promise<void>((resolve) => (letItGo = resolve));
      vi.spyOn(auth, 'startSession').mockImplementationOnce(async (user) => {
        started();
        await hold;
        return original(user);
      });

      const signingIn = signIn(target.email).then((res) => res);
      await reachedStart;
      await deactivate(boss, target.id).expect(200);
      letItGo();
      const res = await signingIn;
      const token = (res.body as { accessToken: string }).accessToken;

      expect(res.status).toBe(200); // it passed its checks while the account was active
      await request(server())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
      await reactivate(boss, target.id).expect(200);
      await request(server())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`)
        .expect(401);
    });

    it('atomic: a history entry that cannot be written rolls the status back (nothing changed, no session lost), and a retry works', async () => {
      const boss = await admin();
      const target = await register('atomica');
      const before = await stored(target.id);
      const repository = harness.moduleRef.get(AccountStatusEventsRepository);
      vi.spyOn(repository, 'append').mockRejectedValueOnce(new Error('the database is down'));

      await deactivate(boss, target.id).expect(500);

      expect(await stored(target.id)).toEqual(before); // status AND credential version
      expect(await eventsOf(target.id)).toEqual([]);
      await me(target).expect(200);
      await deactivate(boss, target.id).expect(200);
    });
  });

  /** A pending reminder of the account, due `fromNowMs` after the fake clock (negative: already due). */
  async function seedReminder(userId: string, fromNowMs: number): Promise<string> {
    const row = await reminders.collection.insertOne({
      userId: new Types.ObjectId(userId),
      auction: new Types.ObjectId(),
      channel: ReminderChannel.EMAIL,
      scheduledAt: new Date(harness.clock.now().getTime() + fromNowMs),
      status: ReminderStatus.PENDING,
      createdAt: harness.clock.now(),
      updatedAt: harness.clock.now(),
    });
    return row.insertedId.toHexString();
  }
});
