// SPEC-009 BR-009-15, BR-009-17 / SC-03, DL-001-02: a session opened before an account was deactivated
// never works again, not even after the account is reactivated. The status write and the credential
// version move in ONE conditional update (`UsersService.deactivateAccount`), so no revocation write
// that fails or races can leave a live session behind. Real MongoDB through the HTTP API (TESTING §2);
// races are forced by pausing a real call between two real steps, never by sleeping (TS-06).
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getModelToken } from '@nestjs/mongoose';
import { type Model } from 'mongoose';
import request from 'supertest';
import { AuthService } from '../../src/auth/auth.service.js';
import { UserEntity, type UserDocument } from '../../src/users/schemas/user.schema.js';
import { UsersService } from '../../src/users/users.service.js';
import { createAuthTestApp, type AuthTestApp } from '../support/auth-test-app.js';
import { useTestDatabase } from '../support/test-database.js';

const PASSWORD = 'correct horse battery';

describe('SPEC-009 a deactivated account’s sessions never come back (integration)', () => {
  const db = useTestDatabase();
  let harness: AuthTestApp;
  let users: Model<UserDocument>;
  let usersService: UsersService;
  let authService: AuthService;
  let counter = 0;

  const server = () => harness.app.getHttpServer() as Parameters<typeof request>[0];
  const me = (token: string) =>
    request(server()).get('/api/auth/me').set('Authorization', `Bearer ${token}`);
  const signIn = (email: string, password = PASSWORD) =>
    request(server()).post('/api/auth/login').send({ email, password });

  async function signUp(label: string) {
    counter += 1;
    const email = `${label}-${counter}@example.test`;
    const registered = await request(server())
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, name: 'Ana Teste', acceptTerms: true })
      .expect(201);
    return {
      email,
      id: (registered.body as { user: { _id: string } }).user._id,
      token: (registered.body as { accessToken: string }).accessToken,
    };
  }

  const stored = (id: string) => users.findById(id).lean().exec();

  beforeAll(async () => {
    harness = await createAuthTestApp(db);
    users = harness.moduleRef.get(getModelToken(UserEntity.name));
    usersService = harness.moduleRef.get(UsersService);
    authService = harness.moduleRef.get(AuthService);
  });

  afterAll(async () => {
    await harness.app.close();
  });

  it('control: a flip of the status ALONE revives the old session, which is why the credential version moves with the status', async () => {
    const account = await signUp('controle');
    await me(account.token).expect(200);

    await users.updateOne({ _id: account.id }, { $set: { status: 'deactivated' } });
    await me(account.token).expect(401);
    await users.updateOne({ _id: account.id }, { $set: { status: 'active' } });

    // The hazard: nothing revoked the session and its credential version still matches.
    await me(account.token).expect(200);
  });

  it('BR-009-15, BR-009-17: a session opened before the deactivation stays refused after the reactivation', async () => {
    const account = await signUp('revive');
    await me(account.token).expect(200);
    const before = (await stored(account.id))?.credentialVersion ?? 0;

    expect(await usersService.deactivateAccount(account.id)).toEqual({ result: 'changed' });
    await me(account.token).expect(401);
    expect(await usersService.reactivateAccount(account.id)).toEqual({ result: 'changed' });

    await me(account.token).expect(401); // the old session is dead for good
    expect((await stored(account.id))?.credentialVersion).toBeGreaterThan(before);
    const fresh = await signIn(account.email).expect(200); // a new sign-in works
    await me((fresh.body as { accessToken: string }).accessToken).expect(200);
  });

  it('the status and the credential version move in ONE write: after it the version is higher and the status deactivated, never one without the other', async () => {
    const account = await signUp('umaescrita');
    const before = (await stored(account.id))?.credentialVersion ?? 0;

    await usersService.deactivateAccount(account.id);

    const row = await stored(account.id);
    expect(row?.status).toBe('deactivated');
    expect(row?.credentialVersion).toBe(before + 1);
  });

  it('forced interleaving: a sign-in that passed the password check before the deactivation gets a session that stays refused, also after the reactivation', async () => {
    const account = await signUp('login-em-voo');
    const original = authService.startSession.bind(authService);
    let started!: () => void;
    const reachedStart = new Promise<void>((resolve) => (started = resolve));
    let letItGo!: () => void;
    const hold = new Promise<void>((resolve) => (letItGo = resolve));
    // The sign-in has verified the password (the document it read is at the OLD version) and is about
    // to open its session; the deactivation and the reactivation both complete in that gap.
    const spy = vi.spyOn(authService, 'startSession').mockImplementationOnce(async (user) => {
      started();
      await hold;
      return original(user);
    });

    const signingIn = signIn(account.email).then((response) => response);
    await reachedStart;
    expect(await usersService.deactivateAccount(account.id)).toEqual({ result: 'changed' });
    expect(await usersService.reactivateAccount(account.id)).toEqual({ result: 'changed' });
    letItGo();
    const response = await signingIn;
    spy.mockRestore();

    expect(response.status).toBe(200); // the sign-in itself had passed its checks
    await me((response.body as { accessToken: string }).accessToken).expect(401); // its session is dead
    const fresh = await signIn(account.email).expect(200);
    await me((fresh.body as { accessToken: string }).accessToken).expect(200);
  });

  it('a second deactivation, a reactivation of an active account and an unknown id change nothing and say why', async () => {
    const account = await signUp('conflitos');
    await usersService.deactivateAccount(account.id);
    const afterFirst = await stored(account.id);

    expect(await usersService.deactivateAccount(account.id)).toEqual({
      result: 'conflict',
      status: 'deactivated',
    });
    expect(await stored(account.id)).toEqual(afterFirst); // not even the credential version moved again
    await usersService.reactivateAccount(account.id);
    expect(await usersService.reactivateAccount(account.id)).toEqual({
      result: 'conflict',
      status: 'active',
    });
    expect(await usersService.deactivateAccount('64b7f00000000000000ffff1')).toEqual({
      result: 'not_found',
    });
  });

  it.each(['closed', 'pending'] as const)(
    'a %s account is never deactivated: the conflict names its status and nothing is written',
    async (status) => {
      const account = await signUp(`estado-${status}`);
      await users.updateOne({ _id: account.id }, { $set: { status } });
      const before = await stored(account.id);

      expect(await usersService.deactivateAccount(account.id)).toEqual({
        result: 'conflict',
        status,
      });
      expect(await usersService.reactivateAccount(account.id)).toEqual({
        result: 'conflict',
        status,
      });
      expect(await stored(account.id)).toEqual(before);
    },
  );
});
