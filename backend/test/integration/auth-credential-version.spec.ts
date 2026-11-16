// SPEC-001 DL-001-02, BR-001-19, BR-001-28, SC-03: a session is bound to the credential version it
// was issued for, so a sign-in that passed the password check before a credential change cannot
// keep a session opened after it. Real MongoDB through the HTTP API (TESTING §2, TS-02); the race
// is made deterministic by pausing the real service call between the check and the write (a spy
// that completes the competing change first), never by sleeping (TS-06).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcrypt';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { getConnectionToken, getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, type TestingModule } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Types, type Connection, type Model } from 'mongoose';
import request from 'supertest';
import { configureApp } from '../../src/app.setup.js';
import { AuthModule } from '../../src/auth/auth.module.js';
import { AuthService } from '../../src/auth/auth.service.js';
import { Clock } from '../../src/common/clock/clock.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { EmailService } from '../../src/email/email.service.js';
import { UserEntity, type UserDocument } from '../../src/users/schemas/user.schema.js';
import { UsersService } from '../../src/users/users.service.js';
import { FakeClock } from '../fakes/fake-clock.js';
import { FakeEmailSender } from '../fakes/fake-email-sender.js';
import { useTestDatabase } from '../support/test-database.js';
import { testEnv } from '../support/test-env.js';

// 2099, so MongoDB's TTL monitor (which uses the real clock) never deletes a session of this file.
const START = new Date('2099-01-15T12:00:00.000Z');
const PASSWORD = 'correct horse';
const OTHER_PASSWORD = 'another phrase';
const THIRD_PASSWORD = 'a third phrase';

describe('SPEC-001 credential version (integration)', () => {
  const db = useTestDatabase();
  const clock = new FakeClock(START);
  const mailbox = new FakeEmailSender();
  let moduleRef: TestingModule;
  let app: INestApplication;
  let users: Model<UserDocument>;
  let connection: Connection;
  let authService: AuthService;
  let usersService: UsersService;
  let counter = 0;

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];
  const jwt = new JwtService({ secret: testEnv().JWT_SECRET });
  const collection = (name: string) => {
    if (!connection.db) throw new Error('no connection');
    return connection.db.collection(name);
  };

  function freshEmail(label: string): string {
    counter += 1;
    return `${label}-${counter}@example.test`;
  }

  async function signUp(email: string) {
    const response = await request(server())
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, name: 'Ana Teste', acceptTerms: true })
      .expect(201);
    return response.body as { accessToken: string; user: { _id: string } };
  }

  const signIn = (email: string, password = PASSWORD, ip = '198.51.100.10') =>
    request(server()).post('/api/auth/login').set('X-Forwarded-For', ip).send({ email, password });

  const me = (token: string) =>
    request(server()).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

  const changePassword = (token: string, currentPassword: string, newPassword: string) =>
    request(server())
      .post('/api/auth/change-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ currentPassword, newPassword });

  const setPassword = (token: string, newPassword: string) =>
    request(server())
      .post('/api/auth/set-password')
      .set('Authorization', `Bearer ${token}`)
      .send({ newPassword });

  const jtiOf = (token: string) => (jwt.decode(token) as { jti: string }).jti;

  /** Requests a recovery link and spends it: the whole reset, through the public API. */
  async function completeReset(email: string, newPassword: string) {
    await request(server()).post('/api/auth/reset-password-request').send({ email }).expect(200);
    await authService.flushDeliveries();
    const token = mailbox.passwordResetEmails.slice(-1)[0]?.token ?? '';
    await request(server())
      .post('/api/auth/reset-password')
      .send({ token, newPassword })
      .expect(200);
  }

  /** An account that signs in with Google only (no local provider, no password). */
  const googleOnly = (label: string) => {
    const email = freshEmail(label);
    return users.create({
      email,
      name: 'Ana Google',
      googleId: `g-${email}`,
      providers: ['google'],
      emailVerified: true,
    });
  };

  const storedVersion = async (email: string) =>
    (await users.findOne({ email }).lean())?.credentialVersion;

  beforeAll(async () => {
    applyMongooseDefaults();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          validate: () => testEnv({ TRUST_PROXY_HOPS: '1' }),
        }),
        MongooseModule.forRoot(db.uri),
        AuthModule,
      ],
    })
      .overrideProvider(Clock)
      .useValue(clock)
      .overrideProvider(EmailService)
      .useValue(mailbox)
      .compile();
    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.listen(0, '127.0.0.1');
    users = moduleRef.get(getModelToken(UserEntity.name));
    connection = moduleRef.get(getConnectionToken());
    authService = moduleRef.get(AuthService);
    usersService = moduleRef.get(UsersService, { strict: false });
    await connection.syncIndexes();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('a reset racing a sign-in (BR-001-19, DL-001-02, SC-03)', () => {
    it('DL-001-02: a sign-in that verified the old password before a completed reset opens a session that is refused, and none stays active', async () => {
      const email = freshEmail('race');
      await signUp(email);
      // Pause the real sign-in between its password check and its session creation, and finish
      // a whole reset (token consumed, new password, all sessions revoked) in that gap.
      const original = usersService.validatePassword.bind(usersService);
      vi.spyOn(usersService, 'validatePassword').mockImplementation(async (mail, password) => {
        const verified = await original(mail, password); // the OLD password, still valid here
        await completeReset(email, OTHER_PASSWORD);
        return verified;
      });

      const stale = await authService.login({ email, password: PASSWORD }, '198.51.100.30');

      await me(stale.accessToken).expect(401);
      const account = await users.findOne({ email }).lean();
      // One reset moves the version from 0 to 1 (hand count: signed up at 0, reset once).
      expect(account?.credentialVersion).toBe(1);
      const live = await collection('sessions')
        .find({ userId: account?._id, revokedAt: null })
        .toArray();
      expect(live.filter((s) => ((s.credentialVersion as number | undefined) ?? 0) === 1)).toEqual(
        [],
      );
    });

    it('DL-001-02: the same stale account document stamps the version it proved, so startSession alone cannot outlive the reset', async () => {
      const email = freshEmail('stale');
      await signUp(email);
      const verified = await usersService.validatePassword(email, PASSWORD);
      await completeReset(email, OTHER_PASSWORD);

      const stale = await authService.startSession(verified as UserDocument);

      await me(stale.accessToken).expect(401);
      const row = await collection('sessions').findOne({ _id: jtiOf(stale.accessToken) as never });
      expect(row?.credentialVersion).toBe(0);
    });

    it('a sign-in after the reset is stamped with the new version and works', async () => {
      const email = freshEmail('after');
      await signUp(email);
      await completeReset(email, OTHER_PASSWORD);

      const response = await signIn(email, OTHER_PASSWORD).expect(200);

      await me(response.body.accessToken).expect(200);
      const row = await collection('sessions').findOne({
        _id: jtiOf(response.body.accessToken) as never,
      });
      expect(row?.credentialVersion).toBe(1);
    });

    it('each reset moves the version up by exactly one, in the write that stores the new hash', async () => {
      const email = freshEmail('twice');
      await signUp(email);
      const before = (await users.findOne({ email }).lean())?.password;

      await completeReset(email, OTHER_PASSWORD);
      const afterFirst = await users.findOne({ email }).lean();
      await completeReset(email, THIRD_PASSWORD);

      expect(afterFirst?.credentialVersion).toBe(1);
      expect(afterFirst?.password).not.toBe(before);
      expect(await storedVersion(email)).toBe(2);
    });
  });

  describe('change-password (BR-001-19, BR-001-28)', () => {
    it('BR-001-28: a credential change between the current-password check and the write refuses the change with 401 and leaves the password alone', async () => {
      const email = freshEmail('cpfence');
      const { accessToken } = await signUp(email);
      const hashBefore = (await users.findOne({ email }).lean())?.password;
      const original = usersService.validatePassword.bind(usersService);
      const spy = vi
        .spyOn(usersService, 'validatePassword')
        .mockImplementation(async (mail, password) => {
          const verified = await original(mail, password);
          // A competing credential change (a reset, a link) lands after the check.
          await users.updateOne({ email }, { $inc: { credentialVersion: 1 } });
          return verified;
        });

      const response = await changePassword(accessToken, PASSWORD, OTHER_PASSWORD).expect(401);

      expect(response.body.code).toBe('UNAUTHENTICATED');
      spy.mockRestore();
      expect((await users.findOne({ email }).lean())?.password).toBe(hashBefore);
      await signIn(email, PASSWORD).expect(200);
      await signIn(email, OTHER_PASSWORD).expect(401);
    });

    it('BR-001-19: a successful change bumps the version once, keeps the caller signed in and ends every other session', async () => {
      const email = freshEmail('cpok');
      const { accessToken } = await signUp(email);
      const other = (await signIn(email).expect(200)).body.accessToken as string;

      await changePassword(accessToken, PASSWORD, OTHER_PASSWORD).expect(200);

      await me(accessToken).expect(200);
      await me(other).expect(401);
      expect(await storedVersion(email)).toBe(1);
      const current = await collection('sessions').findOne({ _id: jtiOf(accessToken) as never });
      expect(current).toMatchObject({ credentialVersion: 1 });
      expect(current?.revokedAt).toBeUndefined();
      // The other session is revoked and is also stamped with the old version.
      const ended = await collection('sessions').findOne({ _id: jtiOf(other) as never });
      expect(ended?.revokedAt).toBeInstanceOf(Date);
      expect(ended?.credentialVersion).toBe(0);
      // And the caller keeps working after a second change from the same session.
      await changePassword(accessToken, OTHER_PASSWORD, THIRD_PASSWORD).expect(200);
      await me(accessToken).expect(200);
      expect(await storedVersion(email)).toBe(2);
    });

    it('two changes made at the same time with the right current password: exactly one is applied', async () => {
      const email = freshEmail('cprace');
      const { accessToken } = await signUp(email);

      const statuses = await Promise.all([
        changePassword(accessToken, PASSWORD, OTHER_PASSWORD).then((r) => r.status),
        changePassword(accessToken, PASSWORD, THIRD_PASSWORD).then((r) => r.status),
      ]);

      // Whatever the interleaving, the second one either failed its fence (401) or found the
      // current password already replaced (400): never two successes.
      expect(statuses.filter((status) => status === 200)).toHaveLength(1);
      expect(await storedVersion(email)).toBe(1);
    });
  });

  describe('set-password (BR-001-24, DL-001-02)', () => {
    it('a credential change between the "no local provider" check and the write refuses it with 401 and stores no password', async () => {
      const account = await googleOnly('spfence');
      const { accessToken } = await authService.startSession(account);
      const original = usersService.findById.bind(usersService);
      let calls = 0;
      vi.spyOn(usersService, 'findById').mockImplementation(async (id) => {
        calls += 1;
        const found = await original(id);
        // Call 1 is the session check of this request (JwtStrategy); call 2 is the "no local
        // provider" check of set-password. The competing change lands right after it.
        if (calls === 2)
          await users.updateOne({ _id: account._id }, { $inc: { credentialVersion: 1 } });
        return found;
      });

      const response = await setPassword(accessToken, OTHER_PASSWORD).expect(401);

      expect(response.body.code).toBe('UNAUTHENTICATED');
      const stored = await users.findOne({ _id: account._id }).lean();
      expect(stored?.password).toBeUndefined();
      expect(stored?.providers).toEqual(['google']);
    });

    it('a successful set-password adds the local provider, bumps the version, keeps the caller and ends other sessions', async () => {
      const account = await googleOnly('spok');
      const mine = await authService.startSession(account);
      const other = await authService.startSession(account);

      await setPassword(mine.accessToken, OTHER_PASSWORD).expect(200);

      await me(mine.accessToken).expect(200);
      await me(other.accessToken).expect(401);
      const stored = await users.findOne({ _id: account._id }).lean();
      expect(stored?.credentialVersion).toBe(1);
      expect(stored?.providers).toEqual(['google', 'local']);
      await signIn(account.email, OTHER_PASSWORD).expect(200);
    });
  });

  describe('password sign-in needs a local credential (BR-001-24, BR-001-14)', () => {
    it('an account that lost the local provider cannot sign in by password even if a hash remains in the document', async () => {
      const email = freshEmail('nolocal');
      await users.create({
        email,
        name: 'Ana Google',
        googleId: `g-${email}`,
        providers: ['google'],
        emailVerified: true,
        password: await bcrypt.hash(PASSWORD, 4),
      });
      const control = freshEmail('withlocal');
      await users.create({
        email: control,
        name: 'Ana Local',
        providers: ['local'],
        emailVerified: true,
        password: await bcrypt.hash(PASSWORD, 4),
      });

      const refused = await signIn(email).expect(401);

      expect(refused.body.code).toBe('INVALID_CREDENTIALS');
      await signIn(control).expect(200); // the same hash on an account with `local` does sign in
    });
  });

  describe('sessions stored before the field existed (DL-001-02)', () => {
    /** A user and a session written without any credential version, as before this change. */
    async function legacyAccount(label: string, accountVersion?: number) {
      const email = freshEmail(label);
      const _id = new Types.ObjectId();
      const now = clock.now();
      await users.collection.insertOne({
        _id,
        email,
        name: 'Ana Antiga',
        password: await bcrypt.hash(PASSWORD, 4),
        providers: ['local'],
        emailVerified: true,
        status: 'active',
        role: 'free',
        createdAt: now,
        updatedAt: now,
        ...(accountVersion === undefined ? {} : { credentialVersion: accountVersion }),
      });
      const jti = `legacy-${email}`;
      await collection('sessions').insertOne({
        _id: jti as never,
        userId: _id,
        expiresAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        createdAt: now,
        updatedAt: now,
      });
      return { email, _id, token: jwt.sign({ sub: _id.toHexString(), jti }) };
    }

    it('counts as version 0: it works on an account without a version or at 0', async () => {
      const withoutVersion = await legacyAccount('legacy-none');
      const atZero = await legacyAccount('legacy-zero', 0);

      await me(withoutVersion.token).expect(200);
      await me(atZero.token).expect(200);
    });

    it('counts as version 0: it is refused once the account has moved to version 1', async () => {
      const legacy = await legacyAccount('legacy-bumped');
      await me(legacy.token).expect(200);

      await users.collection.updateOne({ _id: legacy._id }, { $set: { credentialVersion: 1 } });

      await me(legacy.token).expect(401);
    });
  });
});
