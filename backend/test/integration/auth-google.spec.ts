// SPEC-001 Google sign-in (BR-001-03, -08, -09, -10, -11, -16, -20, DL-001-02) and SPEC-010
// BR-010-01, through the HTTP API on a real MongoDB (TESTING §2, TS-02): the real AuthModule,
// UsersModule and Mongoose models. Google itself is stubbed at the boundary (TS-07): the
// `GoogleAuthGuard`, which would redirect to Google and verify the profile, is replaced by a guard
// that takes the identity a verified Google profile would have produced from a request header; the
// callback, the service, the rules and the database are all real. Nothing reaches the network.
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { Types, type Connection, type Model } from 'mongoose';
import request from 'supertest';
import { AuthService } from '../../src/auth/auth.service.js';
import { GoogleAuthGuard } from '../../src/auth/guards/google-auth.guard.js';
import type { GoogleIdentity } from '../../src/auth/google/google-identity.js';
import { SessionsService } from '../../src/auth/sessions/sessions.service.js';
import { credentialVersionOf } from '../../src/users/domain/credential-version.js';
import {
  credentialVersionAfterLink,
  decideGoogleLink,
} from '../../src/users/domain/google-link.js';
import { UserEntity, type UserDocument } from '../../src/users/schemas/user.schema.js';
import { UsersService } from '../../src/users/users.service.js';
import { SECOND } from '../fakes/fake-clock.js';
import { createAuthTestApp, type AuthTestApp } from '../support/auth-test-app.js';
import { spyOnLogger } from '../support/logger-spy.js';
import { useTestDatabase } from '../support/test-database.js';

const PASSWORD = 'correct horse';
const IDENTITY_HEADER = 'x-test-google-identity';
const FRONTEND = 'http://localhost:3001';

describe('SPEC-001 Google sign-in (integration)', () => {
  const db = useTestDatabase();
  let harness: AuthTestApp;
  let users: Model<UserDocument>;
  let usersService: UsersService;
  let connection: Connection;
  let counter = 0;

  const server = () => harness.app.getHttpServer() as Parameters<typeof request>[0];
  const collection = (name: string) => {
    if (!connection.db) throw new Error('no connection');
    return connection.db.collection(name);
  };
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  /** A fresh obviously fake identity per call, so tests never share an account. */
  function identity(overrides: Partial<GoogleIdentity> = {}): GoogleIdentity {
    counter += 1;
    return {
      googleId: `google-sub-${counter}`,
      email: `ana-${counter}@example.test`,
      emailVerified: true,
      name: 'Ana Google',
      ...overrides,
    };
  }

  /** The return from Google: the GET callback, with the identity the stubbed boundary yields. */
  const callback = (who: GoogleIdentity) =>
    request(server()).get('/api/auth/google/callback').set(IDENTITY_HEADER, JSON.stringify(who));

  /** The code the callback redirected with; fails the test if it redirected anywhere else. */
  async function codeFor(who: GoogleIdentity): Promise<string> {
    const response = await callback(who).expect(302);
    const location = new URL(response.headers['location'] as string);
    expect(location.origin + location.pathname).toBe(`${FRONTEND}/auth/callback`);
    return location.searchParams.get('code') ?? '';
  }

  const exchange = (code: string) =>
    request(server()).post('/api/auth/google/exchange').send({ code });
  const complete = (code: string, body: Record<string, unknown> = { acceptTerms: true }) =>
    request(server())
      .post('/api/auth/google/complete')
      .send({ code, ...body });

  /** First sign-in with Google for an identity: callback, terms, complete. */
  async function signUpWithGoogle(who: GoogleIdentity) {
    const code = await codeFor(who);
    const response = await complete(code).expect(200);
    return response.body as { accessToken: string; user: { _id: string; email: string } };
  }

  async function registerLocal(email: string, confirm: boolean) {
    const response = await request(server())
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, name: 'Ana Local', acceptTerms: true })
      .expect(201);
    if (confirm) {
      const token = harness.mailbox.verificationEmails.slice(-1)[0]?.token ?? '';
      await request(server()).post('/api/auth/verify-email').send({ token }).expect(200);
    }
    return response.body as { accessToken: string; user: { _id: string } };
  }

  const loginLocal = (email: string, password = PASSWORD) =>
    request(server()).post('/api/auth/login').send({ email, password });

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
    connection = harness.moduleRef.get(getConnectionToken());
    await connection.syncIndexes();
  });

  afterAll(async () => {
    await harness.app.close();
  });

  afterEach(() => vi.restoreAllMocks());

  describe('a first sign-in with a verified email (BR-001-03, BR-001-09, SPEC-010 BR-010-01)', () => {
    it('AC: asks for the terms, then creates a confirmed searcher account with Google only', async () => {
      const who = identity();
      const code = await codeFor(who);

      // Nothing but the short-lived code exists before the terms are accepted.
      expect(await users.countDocuments({ email: who.email })).toBe(0);
      const terms = await exchange(code).expect(200);
      expect(terms.body).toEqual({
        status: 'terms_required',
        email: who.email,
        name: 'Ana Google',
      });
      expect(await users.countDocuments({ email: who.email })).toBe(0);

      const created = await complete(code).expect(200);
      expect(created.body.accessToken).toEqual(expect.any(String));
      expect(created.body.user).toMatchObject({
        email: who.email,
        name: 'Ana Google',
        providers: ['google'],
        emailVerified: true,
        role: 'free',
        subscriptionStatus: null,
      });
      expect(Object.keys(created.body).sort()).toEqual(['accessToken', 'user']);

      // The stored document: no password, no plan, no Stripe data, active, searcher defaults only.
      const stored = await collection('users').findOne({ email: who.email });
      expect(stored).toMatchObject({
        googleId: who.googleId,
        providers: ['google'],
        emailVerified: true,
        status: 'active',
        role: 'free',
        subscriptionStatus: null,
      });
      expect(stored).not.toHaveProperty('password');
      expect(stored).not.toHaveProperty('stripeCustomerId');
      expect(stored).not.toHaveProperty('stripeSubscriptionId');

      // The new session works, and the confirmed email unlocks the account features (BR-001-04).
      await request(server()).get('/api/auth/me').set(as(created.body.accessToken)).expect(200);
    });

    it('spends the code and deletes the stored Google profile when the account is created', async () => {
      const who = identity();
      const code = await codeFor(who);
      expect(await collection('accountTokens').countDocuments({ 'profile.email': who.email })).toBe(
        1,
      );

      await complete(code).expect(200);

      expect(await collection('accountTokens').countDocuments({ 'profile.email': who.email })).toBe(
        0,
      );
      const again = await complete(code).expect(400);
      expect(again.body).toEqual({ code: 'INVALID_GOOGLE_CODE', context: {} });
      expect(await users.countDocuments({ email: who.email })).toBe(1);
    });

    it.each([
      ['no acceptTerms', {}],
      ['acceptTerms false', { acceptTerms: false }],
      ['acceptTerms "true" as text', { acceptTerms: 'true' }],
    ])(
      'SPEC-010 BR-010-01: %s creates nothing, and the code is still there to be answered',
      async (_label, value) => {
        const who = identity();
        const code = await codeFor(who);

        const refused = await complete(code, value).expect(400);

        expect(refused.body).toMatchObject({ code: 'VALIDATION_FAILED' });
        expect(await users.countDocuments({ email: who.email })).toBe(0);
        await complete(code).expect(200);
      },
    );

    it('SPEC-010 BR-010-01: declining deletes the token and its personal data and leaves no account', async () => {
      const who = identity();
      const code = await codeFor(who);

      const declined = await request(server())
        .post('/api/auth/google/cancel')
        .send({ code })
        .expect(200);

      expect(declined.body).toEqual({ message: 'Google sign-up cancelled' });
      expect(await collection('accountTokens').countDocuments({ 'profile.email': who.email })).toBe(
        0,
      );
      expect(await users.countDocuments({ email: who.email })).toBe(0);
      await exchange(code).expect(400);
      await complete(code).expect(400);
    });

    it('cancel answers 200 alike for a code that never existed', async () => {
      const unknown = await request(server())
        .post('/api/auth/google/cancel')
        .send({ code: 'f'.repeat(64) })
        .expect(200);
      expect(unknown.body).toEqual({ message: 'Google sign-up cancelled' });
    });

    it('a signup code expires after 15 minutes', async () => {
      const code = await codeFor(identity());

      harness.clock.advance(16 * 60 * SECOND);

      await exchange(code).expect(400);
      await complete(code).expect(400);
    });

    it('two completions racing on one code create exactly one account', async () => {
      const who = identity();
      const code = await codeFor(who);

      const results = await Promise.all([complete(code), complete(code), complete(code)]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400]);
      expect(await users.countDocuments({ email: who.email })).toBe(1);
    });
  });

  describe('a Google email that is not verified (BR-001-08)', () => {
    it('redirects to the sign-in page with GOOGLE_EMAIL_NOT_VERIFIED and stores nothing', async () => {
      const who = identity({ emailVerified: false });
      const tokensBefore = await collection('accountTokens').countDocuments();

      const response = await callback(who).expect(302);

      expect(response.headers['location']).toBe(
        `${FRONTEND}/login?error=GOOGLE_EMAIL_NOT_VERIFIED`,
      );
      expect(await users.countDocuments({ email: who.email })).toBe(0);
      expect(await collection('accountTokens').countDocuments()).toBe(tokensBefore);
    });

    it('refuses it even for an email that already has an account, and changes nothing', async () => {
      const email = `local-${(counter += 1)}@example.test`;
      await registerLocal(email, false);

      const response = await callback(identity({ email, emailVerified: false })).expect(302);

      expect(response.headers['location']).toBe(
        `${FRONTEND}/login?error=GOOGLE_EMAIL_NOT_VERIFIED`,
      );
      const stored = await users.findOne({ email }).lean();
      expect(stored?.googleId).toBeUndefined();
      expect(stored?.providers).toEqual(['local']);
      expect(stored?.password).toEqual(expect.any(String));
    });
  });

  describe('an email that already has an account (BR-001-10, DL-001-02)', () => {
    it('AC: a confirmed account is linked and its password still works', async () => {
      const who = identity();
      await registerLocal(who.email, true);

      const code = await codeFor(who);
      const signedIn = await exchange(code).expect(200);

      expect(signedIn.body.status).toBe('signed_in');
      expect(signedIn.body.user.providers).toEqual(['local', 'google']);
      expect(await users.countDocuments({ email: who.email })).toBe(1);
      await loginLocal(who.email).expect(200);
      await request(server()).get('/api/auth/me').set(as(signedIn.body.accessToken)).expect(200);
    });

    it('AC: an unconfirmed account is linked and confirmed; its password and sessions die', async () => {
      const who = identity();
      const registration = await registerLocal(who.email, false);
      const login = await loginLocal(who.email).expect(200);
      const confirmation = harness.mailbox.verificationEmails.slice(-1)[0]?.token ?? '';
      await request(server()).get('/api/auth/me').set(as(registration.accessToken)).expect(200);
      await request(server()).get('/api/auth/me').set(as(login.body.accessToken)).expect(200);

      const signedIn = await exchange(await codeFor(who)).expect(200);

      expect(signedIn.body.user).toMatchObject({ emailVerified: true, providers: ['google'] });
      // The password set at sign-up no longer works...
      const refused = await loginLocal(who.email).expect(401);
      expect(refused.body).toEqual({ code: 'INVALID_CREDENTIALS', context: {} });
      const stored = await users.findOne({ email: who.email }).lean();
      expect(stored?.password).toBeUndefined();
      expect(stored?.emailVerified).toBe(true);
      // ...the sessions opened with it are refused on their next request...
      await request(server()).get('/api/auth/me').set(as(registration.accessToken)).expect(401);
      await request(server()).get('/api/auth/me').set(as(login.body.accessToken)).expect(401);
      // ...the confirmation link it had outstanding is dead, and the Google session works.
      await request(server())
        .post('/api/auth/verify-email')
        .send({ token: confirmation })
        .expect(400);
      await request(server()).get('/api/auth/me').set(as(signedIn.body.accessToken)).expect(200);
    });

    it('DL-001-02: a sign-in that checked the password before the link cannot keep a session after it', async () => {
      const who = identity();
      const registration = await registerLocal(who.email, false);
      // The race, in order: the password is validated (login is past bcrypt)...
      const validatedBeforeLink = await usersService.validatePassword(who.email, PASSWORD);
      expect(validatedBeforeLink).not.toBeNull();
      // ...Google takes the unconfirmed account over (password deleted, sessions revoked)...
      const signedIn = await exchange(await codeFor(who)).expect(200);
      // ...and only then does that login create its session, from the pre-link validation.
      const late = await harness.moduleRef
        .get(AuthService)
        .startSession(validatedBeforeLink as UserDocument);

      // The session exists and was never revoked, yet it carries the credential version it was
      // validated for, which the takeover has since moved past.
      const claims = JSON.parse(
        Buffer.from(late.accessToken.split('.')[1] ?? '', 'base64url').toString(),
      ) as { jti: string };
      const lateSession = await collection('sessions').findOne({ _id: claims.jti as never });
      expect(lateSession).toMatchObject({ credentialVersion: 0 });
      expect(lateSession?.['revokedAt']).toBeUndefined();
      expect((await users.findById(registration.user._id).lean())?.credentialVersion).toBe(1);
      const refused = await request(server()).get('/api/auth/me').set(as(late.accessToken));
      expect(refused.status).toBe(401);
      expect(refused.body).toEqual({ code: 'UNAUTHENTICATED', context: {} });
      // The legitimate Google session, issued for the new version, works.
      await request(server()).get('/api/auth/me').set(as(signedIn.body.accessToken)).expect(200);
    });

    it('DL-001-02: sessions opened before the link are refused through the credential version alone', async () => {
      const who = identity();
      const registration = await registerLocal(who.email, false);
      const login = await loginLocal(who.email).expect(200);
      // The revocation writes do nothing (as if they had failed or never ran).
      vi.spyOn(SessionsService.prototype, 'revokeAllForUser').mockResolvedValue(undefined);

      const signedIn = await exchange(await codeFor(who)).expect(200);

      // Nothing revoked them: the version alone refuses them.
      expect(
        await collection('sessions').countDocuments({
          userId: new Types.ObjectId(registration.user._id),
          revokedAt: { $exists: true },
        }),
      ).toBe(0);
      const stored = await users.findById(registration.user._id).lean();
      expect(stored?.credentialVersion).toBe(1);
      await request(server()).get('/api/auth/me').set(as(registration.accessToken)).expect(401);
      await request(server()).get('/api/auth/me').set(as(login.body.accessToken)).expect(401);
      await request(server()).get('/api/auth/me').set(as(signedIn.body.accessToken)).expect(200);
    });

    it('DL-001-02: a clean-up that fails after the link leaves nothing usable, and the retry signs in', async () => {
      const who = identity();
      const registration = await registerLocal(who.email, false);
      vi.spyOn(SessionsService.prototype, 'revokeAllForUser').mockRejectedValueOnce(
        new Error('write failed'),
      );

      // The callback reports the failure (a redirect to the sign-in page)...
      const failed = await callback(who).expect(302);
      expect(failed.headers['location']).toContain('/login?error=');
      // ...the link itself happened, in one update, together with the version...
      const stored = await users.findById(registration.user._id).lean();
      expect(stored).toMatchObject({ googleId: who.googleId, credentialVersion: 1 });
      // ...so the earlier session is refused although nothing revoked it...
      await request(server()).get('/api/auth/me').set(as(registration.accessToken)).expect(401);
      // ...and the next attempt goes through the linked-by-Google-id path and signs in.
      const signedIn = await exchange(await codeFor(who)).expect(200);
      await request(server()).get('/api/auth/me').set(as(signedIn.body.accessToken)).expect(200);
    });

    it('DL-001-02: linking a confirmed account does not move the version; its open sessions keep working', async () => {
      const who = identity();
      const registration = await registerLocal(who.email, true);
      const login = await loginLocal(who.email).expect(200);

      const signedIn = await exchange(await codeFor(who)).expect(200);

      const stored = await users.findById(registration.user._id).lean();
      expect(credentialVersionOf(stored ?? {})).toBe(0);
      await request(server()).get('/api/auth/me').set(as(registration.accessToken)).expect(200);
      await request(server()).get('/api/auth/me').set(as(login.body.accessToken)).expect(200);
      await request(server()).get('/api/auth/me').set(as(signedIn.body.accessToken)).expect(200);
    });

    it('DL-001-02: a session stored before the field existed counts as version 0 on both sides', async () => {
      const who = identity();
      const registration = await registerLocal(who.email, true);
      await collection('users').updateOne(
        { _id: new Types.ObjectId(registration.user._id) },
        { $unset: { credentialVersion: '' } },
      );
      await collection('sessions').updateMany({}, { $unset: { credentialVersion: '' } });

      await request(server()).get('/api/auth/me').set(as(registration.accessToken)).expect(200);
    });

    it('DL-001-02: an unconfirmed account loses its outstanding recovery link too', async () => {
      const who = identity();
      await registerLocal(who.email, false);
      await request(server())
        .post('/api/auth/reset-password-request')
        .send({ email: who.email })
        .expect(200);
      await harness.moduleRef.get(AuthService).flushDeliveries();
      const recovery = harness.mailbox.passwordResetEmails.slice(-1)[0]?.token ?? '';

      await exchange(await codeFor(who)).expect(200);

      const refused = await request(server())
        .post('/api/auth/reset-password')
        .send({ token: recovery, newPassword: 'another phrase' })
        .expect(400);
      expect(refused.body).toEqual({ code: 'INVALID_RESET_TOKEN', context: {} });
    });

    it('BR-001-11: the same Google identity reaches the same account after its email changed on the Google side', async () => {
      const who = identity();
      const first = await signUpWithGoogle(who);

      const second = await exchange(
        await codeFor({ ...who, email: `moved-${who.googleId}@example.test` }),
      ).expect(200);

      expect(second.body.status).toBe('signed_in');
      expect(second.body.user._id).toBe(first.user._id);
      expect(second.body.user.email).toBe(who.email);
      expect(await users.countDocuments({ googleId: who.googleId })).toBe(1);
      expect(await users.countDocuments({ email: `moved-${who.googleId}@example.test` })).toBe(0);
    });

    it('BR-001-11: an email whose account is linked to another Google identity is refused and stays as it was', async () => {
      const owner = identity();
      await signUpWithGoogle(owner);

      const response = await callback(identity({ email: owner.email })).expect(302);

      expect(response.headers['location']).toBe(`${FRONTEND}/login?error=GOOGLE_SIGN_IN_FAILED`);
      expect((await users.findOne({ email: owner.email }).lean())?.googleId).toBe(owner.googleId);
    });
  });

  describe('a deactivated or closed account (BR-001-16)', () => {
    it.each([
      ['deactivated', 'ACCOUNT_DEACTIVATED'], // SPEC-009 BR-009-20
      ['closed', 'GOOGLE_SIGN_IN_FAILED'],
    ])('%s: refused by email with %s, nothing linked, password intact', async (status, code) => {
      const who = identity();
      await registerLocal(who.email, true);
      await users.updateOne({ email: who.email }, { $set: { status } });

      const response = await callback(who).expect(302);

      expect(response.headers['location']).toBe(`${FRONTEND}/login?error=${code}`);
      const stored = await users.findOne({ email: who.email }).lean();
      expect(stored?.googleId).toBeUndefined();
      expect(stored?.providers).toEqual(['local']);
      expect(stored?.password).toEqual(expect.any(String));
    });

    it('refused by Google identity (a deactivated account is told so, SPEC-009 BR-009-20), and a session opened before is refused on its next request', async () => {
      const who = identity();
      const session = await signUpWithGoogle(who);
      await request(server()).get('/api/auth/me').set(as(session.accessToken)).expect(200);

      await users.updateOne({ email: who.email }, { $set: { status: 'deactivated' } });

      const response = await callback(who).expect(302);
      expect(response.headers['location']).toBe(`${FRONTEND}/login?error=ACCOUNT_DEACTIVATED`);
      await request(server()).get('/api/auth/me').set(as(session.accessToken)).expect(401);
    });

    it('an account deactivated between the redirect and the exchange gets no session', async () => {
      const who = identity();
      await signUpWithGoogle(who);
      const code = await codeFor(who);

      await users.updateOne({ email: who.email }, { $set: { status: 'closed' } });

      const refused = await exchange(code).expect(401);
      expect(refused.body).toEqual({ code: 'GOOGLE_SIGN_IN_FAILED', context: {} });
    });
  });

  describe('the return from Google carries no credential (BR-001-20)', () => {
    it('the redirect URL holds only a one-time code, never a JWT or a token parameter', async () => {
      const who = identity();
      await registerLocal(who.email, true);

      const response = await callback(who).expect(302);

      const location = new URL(response.headers['location'] as string);
      expect([...location.searchParams.keys()]).toEqual(['code']);
      expect(location.searchParams.get('code')).toMatch(/^[0-9a-f]{64}$/);
      expect(location.href).not.toMatch(/eyJ[A-Za-z0-9_-]{5,}\./); // no JWT-shaped value
      expect(location.href).not.toContain('token=');
      expect(location.hash).toBe('');
    });

    it('the code alone opens nothing: an API call with it as a bearer token is refused', async () => {
      const who = identity();
      await registerLocal(who.email, true);
      const code = await codeFor(who);

      await request(server()).get('/api/auth/me').set(as(code)).expect(401);
    });

    it('the code is single use', async () => {
      const who = identity();
      await registerLocal(who.email, true);
      const code = await codeFor(who);

      await exchange(code).expect(200);
      const second = await exchange(code).expect(400);

      expect(second.body).toEqual({ code: 'INVALID_GOOGLE_CODE', context: {} });
    });

    it('parallel exchanges of one code give exactly one session', async () => {
      const who = identity();
      await registerLocal(who.email, true);
      const code = await codeFor(who);

      const results = await Promise.all([exchange(code), exchange(code), exchange(code)]);

      expect(results.map((r) => r.status).sort()).toEqual([200, 400, 400]);
    });

    it('the code lasts 60 seconds: works at 59, fails at 61', async () => {
      const who = identity();
      await registerLocal(who.email, true);
      const early = await codeFor(who);
      harness.clock.advance(59 * SECOND);
      await exchange(early).expect(200);

      const late = await codeFor(who);
      harness.clock.advance(61 * SECOND);
      const expired = await exchange(late).expect(400);
      expect(expired.body).toEqual({ code: 'INVALID_GOOGLE_CODE', context: {} });
    });

    it.each([
      ['an unknown code', { code: 'f'.repeat(64) }, 'INVALID_GOOGLE_CODE'],
      ['an operator object', { code: { $ne: null } }, 'VALIDATION_FAILED'],
      ['an empty code', { code: '' }, 'VALIDATION_FAILED'],
      ['no code', {}, 'VALIDATION_FAILED'],
      ['a code over 256 characters', { code: 'a'.repeat(257) }, 'VALIDATION_FAILED'],
    ])('refuses %s with 400 %s', async (_label, body, code) => {
      const response = await request(server())
        .post('/api/auth/google/exchange')
        .send(body)
        .expect(400);

      expect(response.body).toMatchObject({ code });
    });

    it('SC-15: nothing logged along the whole flow contains the email, the name or a code', async () => {
      const log = spyOnLogger();
      const who = identity();
      const code = await codeFor(who);
      await exchange(code)
        .expect(200)
        .catch(() => undefined);
      const done = await complete(code).expect(200);
      const second = await codeFor(who);
      await exchange(second).expect(200);
      await callback(identity({ emailVerified: false })).expect(302);
      await exchange('f'.repeat(64)).expect(400);

      const logged = log.loggedText();
      for (const secret of [
        who.email,
        who.googleId,
        'Ana Google',
        code,
        second,
        done.body.accessToken,
      ]) {
        expect(logged).not.toContain(secret);
      }
    });
  });

  describe('UsersService.linkGoogleIdentity against MongoDB (BR-001-10, DL-001-02)', () => {
    type Seed = {
      status?: string;
      emailVerified?: boolean;
      googleId?: string;
    };
    const table: Seed[] = [];
    for (const status of [undefined, 'active', 'deactivated', 'closed']) {
      for (const emailVerified of [undefined, false, true]) {
        for (const googleId of [undefined, 'same', 'other']) {
          table.push({ status, emailVerified, googleId });
        }
      }
    }

    it.each(table)('the update matches decideGoogleLink for %j', async (seed) => {
      counter += 1;
      const mine = `table-sub-${counter}`;
      const googleId =
        seed.googleId === 'same' ? mine : seed.googleId === 'other' ? `other-${mine}` : undefined;
      const doc = {
        email: `table-${counter}@example.test`,
        name: 'Tabela',
        password: 'stored-hash',
        providers: ['local'],
        ...(seed.status === undefined ? {} : { status: seed.status }),
        ...(seed.emailVerified === undefined ? {} : { emailVerified: seed.emailVerified }),
        ...(googleId === undefined ? {} : { googleId }),
      };
      const { insertedId } = await collection('users').insertOne({
        ...doc,
        role: 'free',
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      const expected = decideGoogleLink(
        { status: seed.status, emailVerified: seed.emailVerified, googleId },
        mine,
      );

      const outcome = await usersService.linkGoogleIdentity(
        insertedId.toHexString(),
        mine,
        harness.clock.now(),
      );

      expect(outcome.result).toBe(expected);
      const after = await collection('users').findOne({ _id: insertedId });
      // DL-001-02: only a takeover moves the version (a missing one counts as 0).
      expect(
        credentialVersionOf({
          credentialVersion: after?.['credentialVersion'] as number | undefined,
        }),
      ).toBe(credentialVersionAfterLink(undefined, expected));
      if (expected === 'linked_confirmed') {
        expect(after).toMatchObject({
          googleId: mine,
          emailVerified: true,
          password: 'stored-hash',
        });
        expect(after?.['providers']).toEqual(['local', 'google']);
      } else if (expected === 'linked_unconfirmed') {
        expect(after).toMatchObject({ googleId: mine, emailVerified: true });
        expect(after).not.toHaveProperty('password');
        expect(after?.['providers']).toEqual(['google']);
      } else {
        // Refused: not a single field written.
        expect(after).toMatchObject({ ...doc, providers: ['local'] });
        expect(after?.['googleId']).toBe(googleId);
      }
    });

    it('is idempotent: linking the same identity twice keeps one google provider', async () => {
      const who = identity();
      const registration = await registerLocal(who.email, true);

      await usersService.linkGoogleIdentity(
        registration.user._id,
        who.googleId,
        harness.clock.now(),
      );
      const again = await usersService.linkGoogleIdentity(
        registration.user._id,
        who.googleId,
        harness.clock.now(),
      );

      expect(again.result).toBe('linked_confirmed');
      expect((await users.findById(registration.user._id).lean())?.providers).toEqual([
        'local',
        'google',
      ]);
    });

    it('BR-001-11: a Google identity already linked to another account is never re-linked (unique index)', async () => {
      const owner = identity();
      await signUpWithGoogle(owner);
      const other = await registerLocal(`other-${owner.googleId}@example.test`, true);

      const outcome = await usersService.linkGoogleIdentity(
        other.user._id,
        owner.googleId,
        harness.clock.now(),
      );

      expect(outcome).toEqual({ result: 'google_conflict' });
      expect((await users.findById(other.user._id).lean())?.googleId).toBeUndefined();
      expect(await users.countDocuments({ googleId: owner.googleId })).toBe(1);
    });

    it('answers not_found for an account that does not exist', async () => {
      await expect(
        usersService.linkGoogleIdentity('64b0000000000000000000ff', 'nobody', harness.clock.now()),
      ).resolves.toEqual({ result: 'not_found' });
    });

    it('two parallel links of one unconfirmed account end in one coherent state', async () => {
      const who = identity();
      const registration = await registerLocal(who.email, false);

      const outcomes = await Promise.all([
        usersService.linkGoogleIdentity(registration.user._id, who.googleId, harness.clock.now()),
        usersService.linkGoogleIdentity(registration.user._id, who.googleId, harness.clock.now()),
      ]);

      // Whichever ran first took the account over; the second finds it confirmed and linked.
      expect(outcomes.map((o) => o.result).sort()).toEqual([
        'linked_confirmed',
        'linked_unconfirmed',
      ]);
      const stored = await users.findById(registration.user._id).lean();
      expect(stored).toMatchObject({
        googleId: who.googleId,
        emailVerified: true,
        providers: ['google'],
      });
      expect(stored?.password).toBeUndefined();
    });
  });
});
