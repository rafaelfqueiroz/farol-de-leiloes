// SPEC-001 (#1), sessions and one-time tokens, through the HTTP API on a real MongoDB (TESTING §2,
// TS-02): the real AuthModule, UsersModule and Mongoose models, with only the clock and the mailer
// replaced by fakes (TS-06, TS-07). Time moves by advancing the fake clock; nothing sleeps.
//
// The fake clock starts in 2099 on purpose: MongoDB's TTL monitor deletes documents whose
// `expiresAt` is in the past of the *real* clock, which would race a clock set in the past.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { AccountTokenService } from '../../src/auth/tokens/account-token.service.js';
import { Clock } from '../../src/common/clock/clock.js';
import { applyMongooseDefaults } from '../../src/common/mongo/query-safety.js';
import { EmailService } from '../../src/email/email.service.js';
import { UserEntity, type UserDocument } from '../../src/users/schemas/user.schema.js';
import { DAY, FakeClock, HOUR, MINUTE } from '../fakes/fake-clock.js';
import { FakeEmailSender } from '../fakes/fake-email-sender.js';
import { spyOnLogger } from '../support/logger-spy.js';
import { useTestDatabase } from '../support/test-database.js';
import { testEnv } from '../support/test-env.js';

const START = new Date('2099-01-15T12:00:00.000Z');
const PASSWORD = 'correct horse'; // 13 characters, no digit and no symbol: allowed (BR-001-13)
const OTHER_PASSWORD = 'another phrase';

describe('SPEC-001 sessions, tokens and sign-in (integration)', () => {
  const db = useTestDatabase();
  const clock = new FakeClock(START);
  const mailbox = new FakeEmailSender();
  let moduleRef: TestingModule;
  let app: INestApplication;
  let users: Model<UserDocument>;
  let connection: Connection;
  let tokens: AccountTokenService;
  let authService: AuthService;
  let counter = 0;

  const server = () => app.getHttpServer() as Parameters<typeof request>[0];
  const jwt = new JwtService({ secret: testEnv().JWT_SECRET });
  const collection = (name: string) => {
    if (!connection.db) throw new Error('no connection');
    return connection.db.collection(name);
  };

  /** A fresh obviously fake address per call, so tests never share an account or a throttle key. */
  function freshEmail(label: string): string {
    counter += 1;
    return `${label}-${counter}@example.test`;
  }

  async function signUp(email: string, password = PASSWORD) {
    const response = await request(server())
      .post('/api/auth/register')
      .send({ email, password, name: 'Ana Teste', acceptTerms: true })
      .expect(201);
    return response.body as { accessToken: string; user: { _id: string; email: string } };
  }

  function signIn(email: string, password = PASSWORD, ip = '198.51.100.10') {
    return request(server())
      .post('/api/auth/login')
      .set('X-Forwarded-For', ip)
      .send({ email, password });
  }

  const me = (token: string) =>
    request(server()).get('/api/auth/me').set('Authorization', `Bearer ${token}`);

  const lastConfirmation = () => mailbox.verificationEmails.slice(-1)[0]?.token ?? '';
  const lastRecovery = () => mailbox.passwordResetEmails.slice(-1)[0]?.token ?? '';

  /** The mail work of a recovery request is detached from the response (SC-05): wait for it. */
  async function requestRecovery(email: string) {
    const response = await request(server())
      .post('/api/auth/reset-password-request')
      .send({ email })
      .expect(200);
    await authService.flushDeliveries();
    return response;
  }

  beforeAll(async () => {
    applyMongooseDefaults();
    moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          ignoreEnvFile: true,
          // One proxy hop: a test chooses its origin with X-Forwarded-For (SC-04).
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
    // Listening once (loopback, ephemeral port) keeps supertest from adding listeners to the server
    // on every one of the parallel requests below.
    await app.listen(0, '127.0.0.1');
    users = moduleRef.get(getModelToken(UserEntity.name));
    connection = moduleRef.get(getConnectionToken());
    tokens = moduleRef.get(AccountTokenService);
    authService = moduleRef.get(AuthService);
    await connection.syncIndexes();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('sign-up (BR-001-01, BR-001-02, BR-001-03, BR-001-13, BR-001-31)', () => {
    it('BR-001-01: Ana@Example.com then ana@example.com gives one account; either spelling signs in', async () => {
      counter += 1;
      const suffix = String(counter);
      const first = `Ana-${suffix}@Example.test `;
      const second = `ana-${suffix}@example.test`;

      await signUp(first);
      const duplicate = await request(server())
        .post('/api/auth/register')
        .send({ email: second, password: PASSWORD, name: 'Ana Dois', acceptTerms: true })
        .expect(409);

      expect(duplicate.body).toEqual({ code: 'EMAIL_ALREADY_REGISTERED', context: {} });
      expect(await users.countDocuments({ email: second })).toBe(1);
      await signIn(second).expect(200);
      await signIn(first.toUpperCase()).expect(200);
    });

    it.each([{ role: 'admin' }, { plan: 'premium' }, { subscriptionStatus: 'active' }])(
      'BR-001-31: a sign-up body with %j is refused and creates no account',
      async (extra) => {
        const email = freshEmail('extra');

        const response = await request(server())
          .post('/api/auth/register')
          .send({ email, password: PASSWORD, name: 'Ana', acceptTerms: true, ...extra })
          .expect(400);

        expect(response.body.code).toBe('VALIDATION_FAILED');
        expect(await users.countDocuments({ email })).toBe(0);
      },
    );

    it('BR-001-02: refuses a sign-up that declines the terms, and creates no account', async () => {
      const email = freshEmail('terms');

      await request(server())
        .post('/api/auth/register')
        .send({ email, password: PASSWORD, name: 'Ana', acceptTerms: false })
        .expect(400);

      expect(await users.countDocuments({ email })).toBe(0);
    });

    it('BR-001-13: 7 characters are rejected; 8 with no digits or symbols are accepted', async () => {
      const short = freshEmail('short');
      await request(server())
        .post('/api/auth/register')
        .send({ email: short, password: 'abcdefg', name: 'Ana', acceptTerms: true })
        .expect(400);
      expect(await users.countDocuments({ email: short })).toBe(0);

      await request(server())
        .post('/api/auth/register')
        .send({ email: freshEmail('eight'), password: 'abcdefgh', name: 'Ana', acceptTerms: true })
        .expect(201);
    });

    it('BR-001-03: a new account is an unconfirmed searcher with no plan, and the token holds sub and jti only', async () => {
      const email = freshEmail('searcher');
      const { accessToken, user } = await signUp(email);

      const stored = await users.findOne({ email }).lean();
      expect(stored).toMatchObject({
        providers: ['local'],
        role: 'free',
        subscriptionStatus: null,
        emailVerified: false,
        status: 'active',
      });
      expect(user).toMatchObject({ providers: ['local'], role: 'free', emailVerified: false });
      expect(Object.keys(jwt.decode(accessToken) as object).sort()).toEqual([
        'exp',
        'iat',
        'jti',
        'sub',
      ]);
    });

    it('sends one confirmation email whose token is 64 hex characters', async () => {
      const before = mailbox.verificationEmails.length;
      const email = freshEmail('mail');
      await signUp(email);

      expect(mailbox.verificationEmails).toHaveLength(before + 1);
      expect(lastConfirmation()).toMatch(/^[0-9a-f]{64}$/);
      expect(mailbox.verificationEmails.slice(-1)[0]?.email).toBe(email);
    });
  });

  describe('email confirmation (BR-001-05, BR-001-06)', () => {
    const confirm = (token: string) =>
      request(server()).post('/api/auth/verify-email').send({ token });

    it('BR-001-05: a confirmation link works once; the second use fails', async () => {
      const email = freshEmail('confirm');
      await signUp(email);
      const token = lastConfirmation();

      await confirm(token).expect(200);
      const again = await confirm(token).expect(400);

      expect(again.body.code).toBe('INVALID_VERIFICATION_TOKEN');
      expect(await users.findOne({ email }).lean()).toMatchObject({ emailVerified: true });
    });

    it('BR-001-05: a link opened 24 hours and 1 minute after it was issued fails; just inside it works', async () => {
      const late = freshEmail('late');
      await signUp(late);
      const lateToken = lastConfirmation();
      clock.advance(24 * HOUR + MINUTE);
      await confirm(lateToken).expect(400);
      expect(await users.findOne({ email: late }).lean()).toMatchObject({ emailVerified: false });

      const inside = freshEmail('inside');
      await signUp(inside);
      const insideToken = lastConfirmation();
      clock.advance(24 * HOUR - MINUTE);
      await confirm(insideToken).expect(200);
    });

    it('BR-001-05: after a new link is requested, the earlier one fails', async () => {
      const email = freshEmail('resend');
      const { accessToken } = await signUp(email);
      const earlier = lastConfirmation();

      await request(server())
        .post('/api/auth/resend-verification')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      const newer = lastConfirmation();

      expect(newer).not.toBe(earlier);
      await confirm(earlier).expect(400);
      await confirm(newer).expect(200);
    });

    it('a link only confirms the address it was mailed to: after the email changed it is refused', async () => {
      const original = freshEmail('first');
      const changed = freshEmail('second');
      const { accessToken } = await signUp(original);
      const oldLink = lastConfirmation();
      // The profile no longer changes an email (BR-001-26, D-63), so the account's address is
      // changed in the database, as a data fix or a future flow would.
      await users.updateOne({ email: original }, { $set: { email: changed } });

      const refused = await confirm(oldLink).expect(400);

      expect(refused.body.code).toBe('INVALID_VERIFICATION_TOKEN');
      expect(await users.findOne({ email: changed }).lean()).toMatchObject({
        emailVerified: false,
      });

      // A link requested for the new address confirms it.
      await request(server())
        .post('/api/auth/resend-verification')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);
      expect(mailbox.verificationEmails.slice(-1)[0]?.email).toBe(changed);
      await confirm(lastConfirmation()).expect(200);
      expect(await users.findOne({ email: changed }).lean()).toMatchObject({ emailVerified: true });
    });

    it('a recovery token is not a confirmation link', async () => {
      const email = freshEmail('purpose');
      await signUp(email);
      await requestRecovery(email);

      await confirm(lastRecovery()).expect(400);
    });

    it('an already confirmed account keeps its resend error', async () => {
      const confirmed = freshEmail('done');
      const { accessToken } = await signUp(confirmed);
      await confirm(lastConfirmation()).expect(200);

      const response = await request(server())
        .post('/api/auth/resend-verification')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(409);
      expect(response.body.code).toBe('EMAIL_ALREADY_VERIFIED');
    });
  });

  describe('password recovery (BR-001-21, BR-001-22, BR-001-24)', () => {
    const reset = (token: string, newPassword: string) =>
      request(server()).post('/api/auth/reset-password').send({ token, newPassword });

    it('BR-001-21: an unknown email gets the same response as a known one, and no email is sent', async () => {
      const known = freshEmail('known');
      await signUp(known);
      const before = mailbox.passwordResetEmails.length;

      const forKnown = await requestRecovery(known);
      expect(mailbox.passwordResetEmails).toHaveLength(before + 1);
      const forUnknown = await requestRecovery(freshEmail('nobody'));

      expect(forUnknown.body).toEqual(forKnown.body);
      expect(forUnknown.status).toBe(forKnown.status);
      expect(mailbox.passwordResetEmails).toHaveLength(before + 1);
    });

    it('BR-001-22: a recovery link works once; the second use fails and the password stays', async () => {
      const email = freshEmail('once');
      await signUp(email);
      await requestRecovery(email);
      const token = lastRecovery();

      await reset(token, OTHER_PASSWORD).expect(200);
      const again = await reset(token, 'a third phrase').expect(400);

      expect(again.body.code).toBe('INVALID_RESET_TOKEN');
      await signIn(email, OTHER_PASSWORD).expect(200);
      await signIn(email, PASSWORD).expect(401);
    });

    it('BR-001-22: a link 61 minutes after issue fails, while 59 minutes works', async () => {
      const stale = freshEmail('stale');
      await signUp(stale);
      await requestRecovery(stale);
      const staleToken = lastRecovery();
      clock.advance(61 * MINUTE);
      await reset(staleToken, OTHER_PASSWORD).expect(400);

      await requestRecovery(stale);
      const freshToken = lastRecovery();
      clock.advance(59 * MINUTE);
      await reset(freshToken, OTHER_PASSWORD).expect(200);
    });

    it('BR-001-22: of two requested links only the newest works', async () => {
      const email = freshEmail('two');
      await signUp(email);
      await requestRecovery(email);
      const first = lastRecovery();
      await requestRecovery(email);
      const second = lastRecovery();

      await reset(first, OTHER_PASSWORD).expect(400);
      await reset(second, OTHER_PASSWORD).expect(200);
    });

    it('BR-001-19: after a reset a session open on another device is refused on its next request, and the reset signs nobody in', async () => {
      const email = freshEmail('device');
      const { accessToken } = await signUp(email);
      const otherDevice = (await signIn(email).expect(200)).body.accessToken as string;
      await me(accessToken).expect(200);
      await me(otherDevice).expect(200);
      await requestRecovery(email);

      const response = await reset(lastRecovery(), OTHER_PASSWORD).expect(200);

      expect(response.body).not.toHaveProperty('accessToken');
      await me(accessToken).expect(401);
      await me(otherDevice).expect(401);
    });

    it('BR-001-24: recovery works for a Google-only account and adds email-and-password sign-in', async () => {
      const email = freshEmail('google');
      await users.create({
        email,
        name: 'Ana Google',
        googleId: `g-${email}`,
        providers: ['google'],
        emailVerified: true,
      });
      await requestRecovery(email);

      await reset(lastRecovery(), OTHER_PASSWORD).expect(200);

      expect((await users.findOne({ email }).lean())?.providers).toEqual(['google', 'local']);
      await signIn(email, OTHER_PASSWORD).expect(200);
    });

    it('BR-001-22: a new password under 8 characters is refused and the link is not spent', async () => {
      const email = freshEmail('weak');
      await signUp(email);
      await requestRecovery(email);
      const token = lastRecovery();

      await reset(token, '1234567').expect(400);
      await reset(token, OTHER_PASSWORD).expect(200);
    });

    it('BR-001-16: a deactivated account gets no recovery email, with the same response', async () => {
      const email = freshEmail('off');
      await signUp(email);
      await users.updateOne({ email }, { $set: { status: 'deactivated' } });
      const before = mailbox.passwordResetEmails.length;

      await requestRecovery(email);

      expect(mailbox.passwordResetEmails).toHaveLength(before);
    });
  });

  describe('sessions (BR-001-17, BR-001-18, BR-001-19)', () => {
    it('BR-001-18: after sign-out, replaying a copy of the old token is refused', async () => {
      const email = freshEmail('logout');
      const { accessToken } = await signUp(email);
      await me(accessToken).expect(200);

      await request(server())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      const replay = await me(accessToken).expect(401);
      expect(replay.body.code).toBe('UNAUTHENTICATED');
    });

    it('BR-001-18: signing out ends that session only', async () => {
      const email = freshEmail('onedevice');
      const { accessToken } = await signUp(email);
      const other = (await signIn(email).expect(200)).body.accessToken as string;

      await request(server())
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${accessToken}`)
        .expect(200);

      await me(other).expect(200);
    });

    it('BR-001-18: a session used 7 days and 1 minute after sign-in is refused; 6 days 23 hours is accepted', async () => {
      const email = freshEmail('expiry');
      const { accessToken } = await signUp(email);
      const { accessToken: later } = (await signIn(email).expect(200)).body as {
        accessToken: string;
      };

      clock.advance(7 * DAY - HOUR);
      await me(accessToken).expect(200);
      clock.advance(HOUR + MINUTE);
      await me(accessToken).expect(401);
      await me(later).expect(401);
    });

    it('BR-001-17: a validly signed token with no session id is refused', async () => {
      const { user } = await signUp(freshEmail('legacy'));
      const legacy = jwt.sign({ sub: user._id, email: user.email, name: 'Ana Teste' });

      await me(legacy).expect(401);
    });

    it('BR-001-17: a signed token naming a session that does not exist is refused', async () => {
      const { user } = await signUp(freshEmail('ghost'));
      const ghost = jwt.sign({ sub: user._id, jti: 'a-session-nobody-opened' });

      await me(ghost).expect(401);
    });

    it("BR-001-17: a session of one account cannot be used under another account's id", async () => {
      const mine = await signUp(freshEmail('mine'));
      const theirs = await signUp(freshEmail('theirs'));
      const jti = (jwt.decode(mine.accessToken) as { jti: string }).jti;

      await me(jwt.sign({ sub: theirs.user._id, jti })).expect(401);
    });

    it('BR-001-17: role and plan are read from the database on every request, not from the token', async () => {
      const email = freshEmail('role');
      const { accessToken } = await signUp(email);
      expect((await me(accessToken).expect(200)).body).toMatchObject({ role: 'free' });

      await users.updateOne({ email }, { $set: { role: 'premium', subscriptionStatus: 'active' } });

      expect((await me(accessToken).expect(200)).body).toMatchObject({
        role: 'premium',
        subscriptionStatus: 'active',
      });
    });

    it('BR-001-19: changing the password ends every other session and keeps the current one', async () => {
      const email = freshEmail('change');
      const { accessToken } = await signUp(email);
      const other = (await signIn(email).expect(200)).body.accessToken as string;

      await request(server())
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: PASSWORD, newPassword: OTHER_PASSWORD })
        .expect(200);

      await me(accessToken).expect(200);
      await me(other).expect(401);
      await signIn(email, OTHER_PASSWORD).expect(200);
    });

    it('BR-001-28: a wrong current password changes nothing and keeps every session', async () => {
      const email = freshEmail('wrongcurrent');
      const { accessToken } = await signUp(email);
      const other = (await signIn(email).expect(200)).body.accessToken as string;

      const response = await request(server())
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: 'not the password', newPassword: OTHER_PASSWORD })
        .expect(400);

      expect(response.body.code).toBe('CURRENT_PASSWORD_INCORRECT');
      await me(other).expect(200);
      await signIn(email, PASSWORD).expect(200);
    });

    it('BR-001-13: change-password and set-password refuse a 7-character password', async () => {
      const { accessToken } = await signUp(freshEmail('seven'));

      await request(server())
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ currentPassword: PASSWORD, newPassword: '1234567' })
        .expect(400);
      await request(server())
        .post('/api/auth/set-password')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ newPassword: '1234567' })
        .expect(400);
    });
  });

  describe('sign-in (BR-001-14, BR-001-15, BR-001-16)', () => {
    it('BR-001-14: an unknown email and a wrong password get the identical response', async () => {
      const email = freshEmail('same');
      await signUp(email);

      const wrong = await signIn(email, 'wrong password').expect(401);
      const unknown = await signIn(freshEmail('ghost'), 'wrong password').expect(401);

      expect(unknown.body).toEqual(wrong.body);
      expect(wrong.body).toEqual({ code: 'INVALID_CREDENTIALS', context: {} });
    });

    it('BR-001-16: a deactivated account cannot sign in, with no hint, and a session opened before is refused', async () => {
      const email = freshEmail('deactivated');
      const { accessToken } = await signUp(email);
      await me(accessToken).expect(200);

      await users.updateOne({ email }, { $set: { status: 'deactivated' } });

      const attempt = await signIn(email).expect(401);
      expect(attempt.body).toEqual({ code: 'INVALID_CREDENTIALS', context: {} });
      await me(accessToken).expect(401);
    });

    it('BR-001-16: a closed account is refused the same way, and an account with no status is active', async () => {
      const closed = freshEmail('closed');
      await signUp(closed);
      await users.updateOne({ email: closed }, { $set: { status: 'closed' } });
      await signIn(closed).expect(401);

      const legacy = freshEmail('nostatus');
      const { accessToken } = await signUp(legacy);
      await users.collection.updateOne({ email: legacy }, { $unset: { status: '' } });
      await me(accessToken).expect(200);
      await signIn(legacy).expect(200);
    });

    it('BR-001-15: the 11th failed sign-in is refused even with the right password, and works again after the window', async () => {
      const email = freshEmail('brute');
      await signUp(email);
      for (let i = 0; i < 10; i += 1) {
        await signIn(email, `wrong password ${i}`, `192.0.2.${i + 1}`).expect(401);
      }

      const blocked = await signIn(email, PASSWORD, '192.0.2.200').expect(429);
      expect(blocked.body).toEqual({ code: 'TOO_MANY_ATTEMPTS', context: {} });

      clock.advance(14 * MINUTE);
      await signIn(email, PASSWORD, '192.0.2.200').expect(429);

      clock.advance(2 * MINUTE); // 16 minutes after the 10th failure
      await signIn(email, PASSWORD, '192.0.2.200').expect(200);
    });

    it('BR-001-15: nine failures do not block; the account is not locked for its owner at another origin once the window passes', async () => {
      const email = freshEmail('nine');
      await signUp(email);
      for (let i = 0; i < 9; i += 1) {
        await signIn(email, 'wrong password', `192.0.2.${i + 1}`).expect(401);
      }

      await signIn(email, PASSWORD, '192.0.2.201').expect(200);
    });

    it('BR-001-15: failures older than 15 minutes do not count', async () => {
      const email = freshEmail('window');
      await signUp(email);
      for (let i = 0; i < 6; i += 1) {
        await signIn(email, 'wrong password', `192.0.2.${i + 1}`).expect(401);
      }
      clock.advance(16 * MINUTE);
      for (let i = 0; i < 6; i += 1) {
        await signIn(email, 'wrong password', `192.0.2.${i + 1}`).expect(401);
      }

      // 12 failures in total but only 6 in the current window: still allowed.
      await signIn(email, PASSWORD, '192.0.2.202').expect(200);
    });

    it('BR-001-15: 10 failures from one origin block that origin for any email, not other origins', async () => {
      const victim = freshEmail('victim');
      await signUp(victim);
      const origin = '203.0.113.50';
      for (let i = 0; i < 10; i += 1) {
        await signIn(freshEmail('guess'), 'wrong password', origin).expect(401);
      }

      await signIn(victim, PASSWORD, origin).expect(429);
      await signIn(victim, PASSWORD, '203.0.113.51').expect(200);
    });

    it('BR-001-15: success clears the email counter and keeps the origin counter', async () => {
      const email = freshEmail('clear');
      await signUp(email);
      const origin = '203.0.113.60';
      for (let i = 0; i < 3; i += 1) await signIn(email, 'wrong password', origin).expect(401);
      expect(await collection('loginAttempts').countDocuments({ key: `email:${email}` })).toBe(1);

      await signIn(email, PASSWORD, origin).expect(200);

      expect(await collection('loginAttempts').countDocuments({ key: `email:${email}` })).toBe(0);
      expect(await collection('loginAttempts').findOne({ key: `ip:${origin}` })).toMatchObject({
        count: 3,
      });
    });

    it('BR-001-15: of 25 parallel wrong guesses exactly 10 reach the password check, the rest are refused', async () => {
      const email = freshEmail('parallel');
      await signUp(email);
      const origin = '203.0.113.70';

      const statuses = await Promise.all(
        Array.from({ length: 25 }, () =>
          signIn(email, 'wrong password', origin).then((response) => response.status),
        ),
      );

      // The attempt is counted atomically before bcrypt: numbers 1..10 are compared (401), the
      // 11th to 25th are refused without a comparison (429).
      expect(statuses.filter((status) => status === 401)).toHaveLength(10);
      expect(statuses.filter((status) => status === 429)).toHaveLength(15);
      expect(await collection('loginAttempts').findOne({ key: `email:${email}` })).toMatchObject({
        count: 11,
      });
    });

    it('BR-001-15: the 10th attempt with the right password succeeds; the 11th is refused', async () => {
      const email = freshEmail('tenth');
      await signUp(email);
      for (let i = 0; i < 9; i += 1) {
        await signIn(email, 'wrong password', `192.0.2.${i + 1}`).expect(401);
      }

      await signIn(email, PASSWORD, '192.0.2.150').expect(200); // the 10th

      // Success cleared the email counter, so this is a fresh count for the email...
      await signIn(email, PASSWORD, '192.0.2.151').expect(200);
      // ...while the ban of an origin that made 10 wrong guesses starts at its 11th attempt.
      const origin = '203.0.113.80';
      for (let i = 0; i < 10; i += 1) {
        await signIn(freshEmail('guess'), 'wrong password', origin).expect(401);
      }
      await signIn(email, PASSWORD, origin).expect(429);
    });

    it('BR-001-15: the ban runs 15 minutes from the refusal that triggered it, and hammering does not extend it', async () => {
      const email = freshEmail('exact');
      await signUp(email);
      for (let i = 0; i < 10; i += 1) {
        await signIn(email, 'wrong password', `192.0.2.${i + 1}`).expect(401);
      }
      const before = await collection('loginAttempts').findOne({ key: `email:${email}` });
      expect(before).toMatchObject({ count: 10 });
      expect(before).not.toHaveProperty('blockedUntil');

      clock.advance(5 * MINUTE);
      const refusedAt = clock.now().getTime();
      await signIn(email, PASSWORD, '192.0.2.160').expect(429);
      const row = await collection('loginAttempts').findOne({ key: `email:${email}` });
      expect((row?.blockedUntil as Date).getTime()).toBe(refusedAt + 15 * MINUTE);

      clock.advance(10 * MINUTE);
      await signIn(email, PASSWORD, '192.0.2.161').expect(429); // still inside the ban
      const after = await collection('loginAttempts').findOne({ key: `email:${email}` });
      expect(after?.blockedUntil).toEqual(row?.blockedUntil);
      expect(after?.count).toBe(11); // refused attempts are not counted

      clock.advance(5 * MINUTE + MINUTE);
      await signIn(email, PASSWORD, '192.0.2.162').expect(200);
    });

    it.each([
      ['an IPv4 address and its IPv4-mapped form', '203.0.113.90', '::ffff:203.0.113.90'],
      ['two addresses of one IPv6 /64', '2001:db8:1:2::1', '2001:db8:1:2:ffff:ffff:ffff:ffff'],
    ])('SC-04: %s are one origin', async (_label, first, second) => {
      const victim = freshEmail('bucket');
      await signUp(victim);
      for (let i = 0; i < 10; i += 1) {
        await signIn(freshEmail('guess'), 'wrong password', i % 2 === 0 ? first : second).expect(
          401,
        );
      }

      await signIn(victim, PASSWORD, second).expect(429);
      await signIn(victim, PASSWORD, first).expect(429);
    });

    it('SC-04: an address in another IPv6 /64 is a different origin', async () => {
      const victim = freshEmail('other64');
      await signUp(victim);
      for (let i = 0; i < 10; i += 1) {
        await signIn(freshEmail('guess'), 'wrong password', '2001:db8:7:8::1').expect(401);
      }

      await signIn(victim, PASSWORD, '2001:db8:7:9::1').expect(200);
    });
  });

  describe('change-password throttle (SC-04, BR-001-15)', () => {
    const changePassword = (token: string, currentPassword: string, ip: string) =>
      request(server())
        .post('/api/auth/change-password')
        .set('Authorization', `Bearer ${token}`)
        .set('X-Forwarded-For', ip)
        .send({ currentPassword, newPassword: OTHER_PASSWORD });

    it('guessing the current password is counted like sign-in: 10 wrong, then even the right one is refused', async () => {
      const email = freshEmail('cpguess');
      const { accessToken } = await signUp(email);
      for (let i = 0; i < 10; i += 1) {
        const wrong = await changePassword(accessToken, 'wrong password', '198.51.100.201').expect(
          400,
        );
        expect(wrong.body.code).toBe('CURRENT_PASSWORD_INCORRECT');
      }

      const refused = await changePassword(accessToken, PASSWORD, '198.51.100.201').expect(429);

      expect(refused.body).toEqual({ code: 'TOO_MANY_ATTEMPTS', context: {} });
      await signIn(email, PASSWORD, '198.51.100.202').expect(429); // the same email counter
    });

    it('a successful change clears the email counter and gives back the origin reservation', async () => {
      const email = freshEmail('cpok');
      const { accessToken } = await signUp(email);
      const origin = '198.51.100.203';
      await changePassword(accessToken, 'wrong password', origin).expect(400);

      await changePassword(accessToken, PASSWORD, origin).expect(200);

      expect(await collection('loginAttempts').countDocuments({ key: `email:${email}` })).toBe(0);
      expect(await collection('loginAttempts').findOne({ key: `ip:${origin}` })).toMatchObject({
        count: 1,
      });
    });
  });

  describe('AccountTokenService against MongoDB (BR-001-05, BR-001-22, SC-06)', () => {
    const USER = '64b000000000000000000009';

    it('consume is atomic: of ten concurrent uses of one link exactly one wins', async () => {
      const plain = await tokens.issue(USER, 'account_recovery');

      const results = await Promise.all(
        Array.from({ length: 10 }, () => tokens.consume(plain, 'account_recovery')),
      );

      expect(results.filter((result) => result !== null)).toHaveLength(1);
    });

    it('consume is refused one millisecond after the lifetime, accepted on its last millisecond', async () => {
      const edge = await tokens.issue(USER, 'google_exchange');
      clock.advance(60_000 - 1);
      await expect(tokens.consume(edge, 'google_exchange')).resolves.not.toBeNull();

      const late = await tokens.issue(USER, 'google_exchange');
      clock.advance(60_000);
      await expect(tokens.consume(late, 'google_exchange')).resolves.toBeNull();
    });

    it('concurrent issuers leave exactly one valid link', async () => {
      const user = '64b00000000000000000000a';

      const issued = await Promise.all(
        Array.from({ length: 5 }, () =>
          tokens.issue(user, 'email_confirmation', { newEmail: 'a@example.test' }),
        ),
      );

      expect(
        await collection('accountTokens').countDocuments({
          userId: new Types.ObjectId(user),
          purpose: 'email_confirmation',
          usedAt: null,
        }),
      ).toBe(1);
      const results = await Promise.all(
        issued.map((plain) => tokens.consume(plain, 'email_confirmation')),
      );
      expect(results.filter((result) => result !== null)).toHaveLength(1);
    });

    it('declares TTL indexes on sessions, accountTokens and loginAttempts, and a unique token hash', async () => {
      for (const name of ['sessions', 'accountTokens', 'loginAttempts']) {
        const indexes = await collection(name).indexes();
        expect(
          indexes.some((index) => index.key['expiresAt'] === 1 && index.expireAfterSeconds === 0),
          `${name} TTL index`,
        ).toBe(true);
      }
      const tokenIndexes = await collection('accountTokens').indexes();
      expect(tokenIndexes.some((i) => i.key['tokenHash'] === 1 && i.unique === true)).toBe(true);
      const sessionIndexes = await collection('sessions').indexes();
      expect(sessionIndexes.some((i) => i.key['userId'] === 1)).toBe(true);
    });
  });

  describe('what is stored and logged (BR-001-12, BR-001-23, SC-15, SC-25)', () => {
    it('BR-001-12/23: no plain password and no plain link token is stored anywhere', async () => {
      const email = freshEmail('inspect');
      const password = 'a distinctive passphrase';
      await signUp(email, password);
      const confirmation = lastConfirmation();
      await requestRecovery(email);
      const recovery = lastRecovery();

      const dump = JSON.stringify(
        await Promise.all(
          ['users', 'accountTokens', 'sessions', 'loginAttempts'].map((name) =>
            collection(name).find({}).toArray(),
          ),
        ),
      );

      expect(dump).not.toContain(password);
      expect(dump).not.toContain(confirmation);
      expect(dump).not.toContain(recovery);
      const stored = await users.findOne({ email }).lean();
      expect(stored?.password).toMatch(/^\$2[aby]\$10\$/); // bcrypt, cost 10 (SC-01)
      expect(
        await collection('accountTokens').countDocuments({
          tokenHash: { $in: [confirmation, recovery] },
        }),
      ).toBe(0);
    });

    it('SC-15: a full sign-up, sign-in, recovery and sign-out cycle logs no password, link token or email', async () => {
      const logged = spyOnLogger();
      const email = freshEmail('logs');
      const password = 'a secret passphrase';
      const { accessToken } = await signUp(email, password);
      const confirmation = lastConfirmation();
      await signIn(email, 'a wrong passphrase').expect(401);
      await signIn(email, password).expect(200);
      await request(server()).post('/api/auth/verify-email').send({ token: confirmation });
      await requestRecovery(email);
      const recovery = lastRecovery();
      await request(server())
        .post('/api/auth/reset-password')
        .send({ token: recovery, newPassword: 'a brand new passphrase' })
        .expect(200);
      await me(accessToken).expect(401);

      const text = logged.loggedText();
      expect(text).not.toBe(''); // the spy is wired: the refused replay was logged
      for (const secret of [
        email,
        password,
        'a wrong passphrase',
        'a brand new passphrase',
        confirmation,
        recovery,
        accessToken,
      ]) {
        expect(text).not.toContain(secret);
      }
    });
  });
});
