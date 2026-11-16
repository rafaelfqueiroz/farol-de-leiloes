// SPEC-001 BR-001-10, BR-001-19, BR-001-24, DL-001-02: every write that changes how an account
// signs in is fenced on the credential version that authorised it, so an in-flight request that
// decided on an old credential cannot write after a Google takeover (or another credential change)
// has moved the account on. Real MongoDB through the HTTP API (TESTING §2, TS-02). Each race is
// made deterministic by pausing the REAL service call between its check and its write, and running
// the competing change to completion in that gap (a spy that wraps the real method), never by
// sleeping (TS-06). Google itself is stubbed at the boundary only (TS-07).
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as bcrypt from 'bcrypt';
import type { ExecutionContext } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import request from 'supertest';
import { AuthService } from '../../src/auth/auth.service.js';
import type { GoogleIdentity } from '../../src/auth/google/google-identity.js';
import { GoogleAuthGuard } from '../../src/auth/guards/google-auth.guard.js';
import { UserEntity, type UserDocument } from '../../src/users/schemas/user.schema.js';
import { UsersService } from '../../src/users/users.service.js';
import { createAuthTestApp, type AuthTestApp } from '../support/auth-test-app.js';
import { useTestDatabase } from '../support/test-database.js';

const PASSWORD = 'attacker password';
const ATTACKER_NEW = 'attacker new password';
const RECOVERED = 'recovered by the owner';
const SET_BY_SESSION = 'set by a stale session';
const IDENTITY_HEADER = 'x-test-google-identity';
const FRONTEND = 'http://localhost:3001';

describe('SPEC-001 credential writes are fenced (integration)', () => {
  const db = useTestDatabase();
  let harness: AuthTestApp;
  let users: Model<UserDocument>;
  let usersService: UsersService;
  let authService: AuthService;
  let connection: Connection;
  let counter = 0;

  const server = () => harness.app.getHttpServer() as Parameters<typeof request>[0];
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const collection = (name: string) => {
    if (!connection.db) throw new Error('no connection');
    return connection.db.collection(name);
  };

  function identity(): GoogleIdentity {
    counter += 1;
    return {
      googleId: `fence-sub-${counter}`,
      email: `victim-${counter}@example.test`,
      emailVerified: true,
      name: 'Victim Google',
    };
  }

  /** A different origin per request, so the sign-in counters of one test never reach another. */
  const nextOrigin = () => {
    counter += 1;
    return `198.51.100.${(counter % 250) + 1}`;
  };

  const callback = (who: GoogleIdentity) =>
    request(server()).get('/api/auth/google/callback').set(IDENTITY_HEADER, JSON.stringify(who));

  async function codeFor(who: GoogleIdentity): Promise<string> {
    const response = await callback(who).expect(302);
    const location = new URL(response.headers['location'] as string);
    expect(location.origin + location.pathname).toBe(`${FRONTEND}/auth/callback`);
    return location.searchParams.get('code') ?? '';
  }

  /** What the victim does: signs in with Google (the takeover happens inside the callback). */
  async function googleSignIn(who: GoogleIdentity) {
    const response = await request(server())
      .post('/api/auth/google/exchange')
      .send({ code: await codeFor(who) })
      .expect(200);
    return response.body as { status: string; accessToken: string; user: { _id: string } };
  }

  /** A first Google sign-in of an address with no account: terms screen, then the account. */
  async function googleNewAccount(who: GoogleIdentity) {
    const code = await codeFor(who);
    const waiting = await request(server()).post('/api/auth/google/exchange').send({ code });
    expect(waiting.body).toMatchObject({ status: 'terms_required' });
    const created = await request(server())
      .post('/api/auth/google/complete')
      .send({ code, acceptTerms: true })
      .expect(200);
    return created.body as { accessToken: string; user: { _id: string } };
  }

  /** The pre-hijacker: registers the victim's address with a password of their own. */
  async function attackerRegisters(email: string) {
    const response = await request(server())
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, name: 'Not The Victim', acceptTerms: true })
      .expect(201);
    return response.body as { accessToken: string; user: { _id: string } };
  }

  const login = (email: string, password: string) =>
    request(server())
      .post('/api/auth/login')
      .set('X-Forwarded-For', nextOrigin())
      .send({ email, password });

  const me = (token: string) => request(server()).get('/api/auth/me').set(as(token));

  const changePassword = (token: string, currentPassword: string, newPassword: string) =>
    request(server())
      .post('/api/auth/change-password')
      .set(as(token))
      .set('X-Forwarded-For', nextOrigin())
      .send({ currentPassword, newPassword });

  const setPassword = (token: string, newPassword: string) =>
    request(server()).post('/api/auth/set-password').set(as(token)).send({ newPassword });

  async function requestRecoveryToken(email: string): Promise<string> {
    await request(server()).post('/api/auth/reset-password-request').send({ email }).expect(200);
    await authService.flushDeliveries();
    return harness.mailbox.passwordResetEmails.slice(-1)[0]?.token ?? '';
  }

  const resetWith = (token: string, newPassword: string) =>
    request(server()).post('/api/auth/reset-password').send({ token, newPassword });

  /** The account exactly as stored: the raw document, hash included. */
  const stored = (email: string) => collection('users').findOne({ email });

  beforeAll(async () => {
    harness = await createAuthTestApp(db, [], {}, (builder) =>
      builder.overrideGuard(GoogleAuthGuard).useValue({
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
    users = harness.moduleRef.get(getModelToken(UserEntity.name));
    usersService = harness.moduleRef.get(UsersService);
    authService = harness.moduleRef.get(AuthService);
    connection = harness.moduleRef.get(getConnectionToken());
    await connection.syncIndexes();
  });

  afterAll(async () => {
    await harness.app.close();
  });

  afterEach(() => vi.restoreAllMocks());

  describe('POST /auth/change-password racing a Google takeover (BR-001-10, DL-001-02)', () => {
    it('BR-001-10, DL-001-02: a change-password that verified the old password before the takeover is refused with 401 and stores nothing', async () => {
      const who = identity();
      const attacker = await attackerRegisters(who.email);
      const original = usersService.validatePassword.bind(usersService);
      let takeoverDone = false;
      const spy = vi
        .spyOn(usersService, 'validatePassword')
        .mockImplementation(async (mail, password) => {
          const verified = await original(mail, password); // the OLD password, still valid here
          expect(verified).not.toBeNull();
          await googleSignIn(who); // link: password deleted, `local` removed, version bumped
          takeoverDone = true;
          return verified;
        });

      const response = await changePassword(attacker.accessToken, PASSWORD, ATTACKER_NEW);
      spy.mockRestore();

      expect(takeoverDone).toBe(true);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHENTICATED');
      const account = await stored(who.email);
      expect(account).not.toHaveProperty('password');
      expect(account?.['providers']).toEqual(['google']);
      expect(account?.['googleId']).toBe(who.googleId);
      expect(account?.['emailVerified']).toBe(true);
      expect(account?.['credentialVersion']).toBe(1);
      for (const password of [ATTACKER_NEW, PASSWORD]) {
        const refused = await login(who.email, password).expect(401);
        expect(refused.body.code).toBe('INVALID_CREDENTIALS');
      }
      await me(attacker.accessToken).expect(401);
    });

    it('DL-001-02: control: the same paused change-password with no competing change succeeds', async () => {
      const who = identity();
      const attacker = await attackerRegisters(who.email);
      const original = usersService.validatePassword.bind(usersService);
      const spy = vi
        .spyOn(usersService, 'validatePassword')
        .mockImplementation((mail, password) => original(mail, password));

      await changePassword(attacker.accessToken, PASSWORD, ATTACKER_NEW).expect(200);

      expect(spy).toHaveBeenCalledTimes(1);
      await login(who.email, ATTACKER_NEW).expect(200);
      expect((await stored(who.email))?.['credentialVersion']).toBe(1);
    });
  });

  describe('POST /auth/set-password racing a competing credential change (BR-001-24, DL-001-02)', () => {
    it('DL-001-02: a set-password that saw "no local provider" is refused with 401 once a recovery added a password, and overwrites nothing', async () => {
      const who = identity();
      const owner = await googleNewAccount(who);
      const original = usersService.findById.bind(usersService);
      let calls = 0;
      vi.spyOn(usersService, 'findById').mockImplementation(async (id) => {
        calls += 1;
        const found = await original(id);
        // Call 1 is the session check (JwtStrategy), call 2 the "no local provider" check.
        if (calls === 2) {
          const token = await requestRecoveryToken(who.email);
          await resetWith(token, RECOVERED).expect(200);
        }
        return found;
      });

      const response = await setPassword(owner.accessToken, SET_BY_SESSION);
      vi.restoreAllMocks();

      expect(calls).toBe(2);
      expect(response.status).toBe(401);
      expect(response.body.code).toBe('UNAUTHENTICATED');
      const account = await stored(who.email);
      expect(account?.['providers']).toEqual(['google', 'local']);
      expect(account?.['credentialVersion']).toBe(1);
      expect(await bcrypt.compare(RECOVERED, account?.['password'] as string)).toBe(true);
      expect(await bcrypt.compare(SET_BY_SESSION, account?.['password'] as string)).toBe(false);
      await login(who.email, RECOVERED).expect(200);
      await login(who.email, SET_BY_SESSION).expect(401);
    });
  });

  describe('password sign-in needs a local credential (BR-001-14, BR-001-24, DL-001-02)', () => {
    it('BR-001-14: after a takeover, a hash that is (again) in the document does not sign in, and the answer is the generic one', async () => {
      const who = identity();
      const attacker = await attackerRegisters(who.email);
      await googleSignIn(who);
      await users.collection.updateOne(
        { email: who.email },
        { $set: { password: await bcrypt.hash(ATTACKER_NEW, 4) } },
      );
      expect((await stored(who.email))?.['providers']).toEqual(['google']);

      const refused = await login(who.email, ATTACKER_NEW).expect(401);
      const unknown = await login(`nobody-${who.email}`, ATTACKER_NEW).expect(401);

      expect(refused.body).toEqual({ code: 'INVALID_CREDENTIALS', context: {} });
      expect(refused.body).toEqual(unknown.body);
      await expect(usersService.validatePassword(who.email, ATTACKER_NEW)).resolves.toBeNull();
      await me(attacker.accessToken).expect(401);
    });

    it('DL-001-02: change-password on such an account is refused before any password is compared', async () => {
      const who = identity();
      await attackerRegisters(who.email);
      const owner = await googleSignIn(who);
      await users.collection.updateOne(
        { email: who.email },
        { $set: { password: await bcrypt.hash(ATTACKER_NEW, 4) } },
      );
      const hashBefore = (await stored(who.email))?.['password'];

      const refused = await changePassword(owner.accessToken, ATTACKER_NEW, SET_BY_SESSION);

      expect(refused.status).toBe(409);
      expect(refused.body.code).toBe('OAUTH_ACCOUNT_HAS_NO_PASSWORD');
      expect((await stored(who.email))?.['password']).toBe(hashBefore);
    });
  });

  describe('recovery links across a takeover (BR-001-22, BR-001-24, DL-001-02)', () => {
    it('DL-001-02: a recovery link issued before the takeover is dead after it, and nothing is stored', async () => {
      const who = identity();
      await attackerRegisters(who.email);
      const before = await requestRecoveryToken(who.email);

      await googleSignIn(who);

      const refused = await resetWith(before, ATTACKER_NEW).expect(400);
      expect(refused.body).toEqual({ code: 'INVALID_RESET_TOKEN', context: {} });
      const account = await stored(who.email);
      expect(account).not.toHaveProperty('password');
      expect(account?.['providers']).toEqual(['google']);
      expect(account?.['credentialVersion']).toBe(1);
      await login(who.email, ATTACKER_NEW).expect(401);
    });

    it('BR-001-24: a link issued after the takeover is legitimate: it adds email-and-password sign-in to the Google account', async () => {
      const who = identity();
      await attackerRegisters(who.email);
      const stale = await requestRecoveryToken(who.email);
      await googleSignIn(who);
      const fresh = await requestRecoveryToken(who.email);

      await resetWith(stale, ATTACKER_NEW).expect(400);
      await resetWith(fresh, RECOVERED).expect(200);

      const account = await stored(who.email);
      expect(account?.['providers']).toEqual(['google', 'local']);
      expect(account?.['credentialVersion']).toBe(2);
      await login(who.email, RECOVERED).expect(200);
      await login(who.email, ATTACKER_NEW).expect(401);
      await login(who.email, PASSWORD).expect(401);
    });
  });

  describe('no other write reaches the credential fields (BR-001-31, DL-001-02)', () => {
    it('UsersService.update cannot change the providers or the Google id, whatever it is handed', async () => {
      const who = identity();
      const owner = await googleNewAccount(who);
      const before = await stored(who.email);

      const updated = await usersService.update(owner.user._id, {
        name: 'Renamed',
        providers: ['local', 'google'],
        googleId: 'google-hostile',
      } as unknown as Parameters<UsersService['update']>[1]);

      expect(updated.name).toBe('Renamed');
      const after = await stored(who.email);
      expect(after?.['providers']).toEqual(['google']);
      expect(after?.['googleId']).toBe(who.googleId);
      expect(after?.['credentialVersion']).toBe(before?.['credentialVersion']);
      expect(after).not.toHaveProperty('password');
    });
  });
});
