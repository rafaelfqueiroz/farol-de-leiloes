// SPEC-010 (#10) consent part, through the HTTP API on a real MongoDB (TESTING §2, TS-02): the legal
// documents (BR-010-02, BR-010-04), the acceptance at sign-up by e-mail and by Google (BR-010-01,
// BR-010-03), the current-terms guard (BR-010-05) with a new version published later, re-acceptance
// and the WhatsApp consent (BR-010-27). The real AuthModule, PrivacyModule, UsersModule and models;
// only the clock, the mailer, Google and the legal registry (to publish a v0.2) are replaced
// (TS-03, TS-06, TS-07). Enforcement is ON here (TERMS_ENFORCEMENT_ENABLED); a second app proves
// it off by default.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ExecutionContext } from '@nestjs/common';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import type { Connection, Model } from 'mongoose';
import request from 'supertest';
import { AuthService } from '../../src/auth/auth.service.js';
import { UsersService } from '../../src/users/users.service.js';
import { AuctionsModule } from '../../src/auctions/auctions.module.js';
import { AuctionEntity } from '../../src/auctions/schemas/auction.schema.js';
import type { GoogleIdentity } from '../../src/auth/google/google-identity.js';
import { GoogleAuthGuard } from '../../src/auth/guards/google-auth.guard.js';
import { CouponsModule } from '../../src/coupons/coupons.module.js';
import { FavoritesModule } from '../../src/favorites/favorites.module.js';
import { PaymentGateway } from '../../src/payments/payment-gateway.js';
import { PaymentsModule } from '../../src/payments/payments.module.js';
import { PlansModule } from '../../src/plans/plans.module.js';
import { ConsentEntity } from '../../src/privacy/schemas/consent.schema.js';
import { ConsentsService } from '../../src/privacy/consents.service.js';
import { LEGAL_DOCUMENTS } from '../../src/privacy/legal/registry.js';
import { WhatsappConsentEntity } from '../../src/privacy/schemas/whatsapp-consent.schema.js';
import { WhatsappConsentService } from '../../src/privacy/whatsapp-consent.service.js';
import { UserEntity } from '../../src/users/schemas/user.schema.js';
import { aLegalDocument, aLegalRegistry } from '../builders/legal-document.builder.js';
import { DAY } from '../fakes/fake-clock.js';
import { FakePaymentGateway } from '../fakes/fake-payment-gateway.js';
import { AUTH_TEST_START, createAuthTestApp, type AuthTestApp } from '../support/auth-test-app.js';
import { useTestDatabase } from '../support/test-database.js';

const PASSWORD = 'correct horse battery';
const IDENTITY_HEADER = 'x-test-google-identity';
// Within the 7-day session lifetime (BR-001-18): accounts signed up at the start stay signed in.
const V2_AT = new Date(AUTH_TEST_START.getTime() + 3 * DAY);
const AFTER_V2 = new Date(V2_AT.getTime() + DAY);
const REGISTRY = [
  ...aLegalRegistry('0.1'),
  aLegalDocument({ type: 'terms', version: '0.2', effectiveAt: V2_AT }),
  aLegalDocument({ type: 'privacy', version: '0.2', effectiveAt: V2_AT }),
];
const HASH = (type: 'terms' | 'privacy', version: string) =>
  REGISTRY.find((d) => d.type === type && d.version === version)?.contentHash;

describe('SPEC-010 privacy and consent (integration)', () => {
  const db = useTestDatabase();
  let harness: AuthTestApp;
  let lenient: AuthTestApp;
  let connection: Connection;
  let users: Model<unknown>;
  let consents: Model<unknown>;
  let whatsappConsents: Model<unknown>;
  let counter = 0;

  const server = (app: AuthTestApp = harness) =>
    app.app.getHttpServer() as Parameters<typeof request>[0];
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });
  const registerBody = (email: string, extra: Record<string, unknown> = {}) => ({
    email,
    password: PASSWORD,
    name: 'Ana Privacidade',
    acceptTerms: true,
    ...extra,
  });
  const register = (email: string, extra: Record<string, unknown> = {}, app = harness) =>
    request(server(app)).post('/api/auth/register').send(registerBody(email, extra));
  const consentRows = (userId: string) =>
    consents.collection
      .find({ userId: new connection.base.Types.ObjectId(userId) })
      .sort({ documentType: -1 })
      .toArray();
  const whatsappRows = (userId: string) =>
    whatsappConsents.collection
      .find({ userId: new connection.base.Types.ObjectId(userId) })
      .sort({ _id: 1 })
      .toArray();

  /** A signed-up account with a confirmed e-mail, as every account feature needs (BR-001-04). */
  async function account(label: string, extra: Record<string, unknown> = {}, app = harness) {
    counter += 1;
    const email = `${label}-${counter}@example.test`;
    const response = await register(email, extra, app).expect(201);
    const sent = app.mailbox.verificationEmails.find((mail) => mail.email === email);
    await request(server(app))
      .post('/api/auth/verify-email')
      .send({ token: sent?.token ?? '' })
      .expect(200);
    return {
      email,
      id: response.body.user._id as string,
      token: response.body.accessToken as string,
    };
  }

  const googleIdentity = (): GoogleIdentity => {
    counter += 1;
    return {
      googleId: `google-sub-privacy-${counter}`,
      email: `google-${counter}@example.test`,
      emailVerified: true,
      name: 'Ana Google',
    };
  };
  async function googleCode(who: GoogleIdentity): Promise<string> {
    const response = await request(server())
      .get('/api/auth/google/callback')
      .set(IDENTITY_HEADER, JSON.stringify(who))
      .expect(302);
    return new URL(response.headers['location'] as string).searchParams.get('code') ?? '';
  }

  const stubbedGoogle = (
    builder: Parameters<NonNullable<Parameters<typeof createAuthTestApp>[3]>>[0],
  ) =>
    builder
      .overrideProvider(LEGAL_DOCUMENTS)
      .useValue(REGISTRY)
      .overrideProvider(PaymentGateway)
      .useValue(new FakePaymentGateway())
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
      });

  beforeAll(async () => {
    harness = await createAuthTestApp(
      db,
      [AuctionsModule, FavoritesModule, PaymentsModule, PlansModule, CouponsModule],
      { TERMS_ENFORCEMENT_ENABLED: 'true' },
      stubbedGoogle,
    );
    // The default configuration: acceptances are recorded, nothing is refused (flag off).
    lenient = await createAuthTestApp(db, [AuctionsModule, FavoritesModule], {}, (builder) =>
      builder.overrideProvider(LEGAL_DOCUMENTS).useValue(REGISTRY),
    );
    users = harness.moduleRef.get(getModelToken(UserEntity.name));
    consents = harness.moduleRef.get(getModelToken(ConsentEntity.name));
    whatsappConsents = harness.moduleRef.get(getModelToken(WhatsappConsentEntity.name));
    connection = harness.moduleRef.get(getConnectionToken());
    await connection.syncIndexes();
    const auctions = harness.moduleRef.get<Model<unknown>>(getModelToken(AuctionEntity.name));
    const phase = { modality: 'ONLINE_SALES', minimumPrice: null };
    await auctions.collection.insertOne({
      code: 'PRIV0001',
      available: true,
      phases: [phase],
      currentPhase: phase,
      updatedAt: new Date('2999-01-01T00:00:00.000Z'),
    });
  });

  beforeEach(() => {
    harness.clock.set(AUTH_TEST_START);
    lenient.clock.set(AUTH_TEST_START);
  });

  afterAll(async () => {
    await harness.app.close();
    await lenient.app.close();
  });

  describe('the legal documents (BR-010-02, BR-010-04)', () => {
    it('BR-010-02: the current terms and privacy policy are readable with no account, and cacheable', async () => {
      const response = await request(server()).get('/api/legal/current').expect(200);

      expect(response.headers['cache-control']).toBe('public, max-age=60');
      expect(response.body.terms).toMatchObject({
        type: 'terms',
        version: '0.1',
        contentHash: HASH('terms', '0.1'),
        content: expect.stringContaining('terms 0.1') as string,
      });
      expect(response.body.privacy).toMatchObject({ type: 'privacy', version: '0.1' });
    });

    it('BR-010-04: lists every version in force or past with its date, not the future one', async () => {
      const response = await request(server()).get('/api/legal').expect(200);

      expect(response.body.items).toEqual([
        expect.objectContaining({ type: 'terms', version: '0.1', current: true }),
        expect.objectContaining({ type: 'privacy', version: '0.1', current: true }),
      ]);
      expect(response.body.items[0]).not.toHaveProperty('content');
      expect(response.body.items[0].effectiveAt).toBe('2000-01-01T00:00:00.000Z');
    });

    it('BR-010-05: a version becomes current and listed at exactly its effective instant', async () => {
      harness.clock.set(new Date(V2_AT.getTime() - 1));
      await request(server()).get('/api/legal/terms/0.2').expect(404);
      expect(
        (await request(server()).get('/api/legal/current').expect(200)).body.terms.version,
      ).toBe('0.1');

      harness.clock.set(V2_AT);
      const current = await request(server()).get('/api/legal/current').expect(200);
      expect(current.body.terms.version).toBe('0.2');
      expect(current.body.privacy.version).toBe('0.2');
      const list = await request(server()).get('/api/legal').expect(200);
      expect(
        list.body.items.map((i: { type: string; version: string; current: boolean }) => [
          i.type,
          i.version,
          i.current,
        ]),
      ).toEqual([
        ['terms', '0.2', true],
        ['terms', '0.1', false],
        ['privacy', '0.2', true],
        ['privacy', '0.1', false],
      ]);
    });

    it('BR-010-04: an older version stays available after a new one is published', async () => {
      harness.clock.set(AFTER_V2);

      const old = await request(server()).get('/api/legal/privacy/0.1').expect(200);

      expect(old.body).toMatchObject({ version: '0.1', contentHash: HASH('privacy', '0.1') });
      expect(old.headers['cache-control']).toBe('public, max-age=300');
    });

    it.each(['/api/legal/terms/9.9', '/api/legal/privacy/0.10'])(
      'answers 404 NOT_FOUND for the version that does not exist (%s)',
      async (path) => {
        const response = await request(server()).get(path).expect(404);
        expect(response.body).toEqual({ code: 'NOT_FOUND', context: {} });
      },
    );

    it.each(['/api/legal/cookies/0.1', '/api/legal/terms/latest', '/api/legal/terms/1.2.3.4.5'])(
      'refuses a type or a version that is not valid as VALIDATION_FAILED (%s)',
      async (path) => {
        const response = await request(server()).get(path).expect(400);
        expect(response.body.code).toBe('VALIDATION_FAILED');
      },
    );

    it.each([
      ['a 404 for a version that does not exist', '/api/legal/terms/9.9', 404],
      ['a 404 for a version not in force yet', '/api/legal/privacy/0.2', 404],
      ['a 400 for an invalid type', '/api/legal/cookies/0.1', 400],
      ['a 400 for an invalid version', '/api/legal/terms/latest', 400],
    ])(
      'answers %s with no cache header: a shared cache must not store the error',
      async (_what, path, status) => {
        const response = await request(server()).get(path).expect(status);

        expect(response.headers['cache-control'] ?? '').not.toMatch(/public|max-age/);
      },
    );

    it('marks only the successful answers cacheable', async () => {
      for (const [path, maxAge] of [
        ['/api/legal/current', 60],
        ['/api/legal', 60],
        ['/api/legal/terms/0.1', 300],
      ] as const) {
        const response = await request(server()).get(path).expect(200);
        expect(response.headers['cache-control']).toBe(`public, max-age=${maxAge}`);
      }
    });
  });

  describe('e-mail sign-up (BR-010-01, BR-010-03, BR-010-27)', () => {
    it('BR-010-01: without acceptTerms the request is refused and no account exists', async () => {
      const email = `no-accept-${(counter += 1)}@example.test`;
      const without: Record<string, unknown> = registerBody(email);
      delete without['acceptTerms'];

      await request(server()).post('/api/auth/register').send(without).expect(400);
      await request(server())
        .post('/api/auth/register')
        .send(registerBody(email, { acceptTerms: false }))
        .expect(400);

      expect(await users.collection.countDocuments({ email })).toBe(0);
    });

    it('BR-010-01: a stale version is TERMS_VERSION_OUTDATED (409) and NO account is created', async () => {
      harness.clock.set(AFTER_V2);
      const email = `stale-${(counter += 1)}@example.test`;
      const before = await consents.collection.countDocuments();

      const response = await register(email, { termsVersion: '0.1', privacyVersion: '0.2' }).expect(
        409,
      );

      expect(response.body).toEqual({
        code: 'TERMS_VERSION_OUTDATED',
        context: {
          documents: [
            { type: 'terms', version: '0.2' },
            { type: 'privacy', version: '0.2' },
          ],
        },
      });
      expect(await users.collection.countDocuments({ email })).toBe(0);
      expect(await consents.collection.countDocuments()).toBe(before);
      expect(harness.mailbox.verificationEmails.some((mail) => mail.email === email)).toBe(false);
    });

    it('BR-010-03: records both acceptances with versions, hash, time and method, and a declined WhatsApp row, yet creates the account', async () => {
      const email = `ok-${(counter += 1)}@example.test`;

      const response = await register(email).expect(201);

      const id = response.body.user._id as string;
      expect(await users.collection.countDocuments({ email })).toBe(1);
      expect(await consentRows(id)).toEqual([
        expect.objectContaining({
          documentType: 'terms',
          version: '0.1',
          contentHash: HASH('terms', '0.1'),
          acceptedAt: AUTH_TEST_START,
          method: 'signup_email',
        }),
        expect.objectContaining({
          documentType: 'privacy',
          version: '0.1',
          contentHash: HASH('privacy', '0.1'),
          acceptedAt: AUTH_TEST_START,
          method: 'signup_email',
        }),
      ]);
      // BR-010-27: unticked is a recorded refusal; the account exists regardless.
      expect(await whatsappRows(id)).toEqual([
        expect.objectContaining({
          action: 'declined',
          method: 'signup',
          textVersion: '0.1',
          at: AUTH_TEST_START,
        }),
      ]);
      const stored = await users.collection.findOne({ email });
      expect(stored?.whatsappPromptAnsweredAt).toEqual(AUTH_TEST_START);
    });

    it('BR-010-03: accepts the versions named when they are the current ones', async () => {
      const response = await register(`named-${(counter += 1)}@example.test`, {
        termsVersion: '0.1',
        privacyVersion: '0.1',
      }).expect(201);

      expect(await consentRows(response.body.user._id as string)).toHaveLength(2);
    });

    it('BR-010-27: a ticked WhatsApp checkbox is granted, with the text version; hasConsent says yes', async () => {
      const response = await register(`wa-${(counter += 1)}@example.test`, {
        whatsappConsent: true,
      }).expect(201);

      const id = response.body.user._id as string;
      expect(await whatsappRows(id)).toEqual([
        expect.objectContaining({ action: 'granted', method: 'signup', textVersion: '0.1' }),
      ]);
      expect(await harness.moduleRef.get(WhatsappConsentService).hasConsent(id)).toBe(true);
    });

    it('BR-001-01: a sign-up refused for a taken address records no second acceptance', async () => {
      const first = await account('dup');
      const before = await consents.collection.countDocuments();

      await register(first.email).expect(409);

      expect(await consents.collection.countDocuments()).toBe(before);
    });
  });

  describe('Google sign-up (BR-010-01, BR-010-03, BR-010-27)', () => {
    it('BR-010-01: declining leaves no account, no acceptance and no WhatsApp answer', async () => {
      const who = googleIdentity();
      const code = await googleCode(who);
      const before = {
        users: await users.collection.countDocuments(),
        consents: await consents.collection.countDocuments(),
        whatsapp: await whatsappConsents.collection.countDocuments(),
      };

      await request(server()).post('/api/auth/google/cancel').send({ code }).expect(200);

      expect(await users.collection.countDocuments({ email: who.email })).toBe(0);
      expect(await users.collection.countDocuments()).toBe(before.users);
      expect(await consents.collection.countDocuments()).toBe(before.consents);
      expect(await whatsappConsents.collection.countDocuments()).toBe(before.whatsapp);
      // Nothing of the Google profile is left behind either, and the code is dead.
      await request(server())
        .post('/api/auth/google/complete')
        .send({ code, acceptTerms: true })
        .expect(400);
    });

    it('BR-010-03: accepting records signup_google with the account', async () => {
      const code = await googleCode(googleIdentity());

      const response = await request(server())
        .post('/api/auth/google/complete')
        .send({ code, acceptTerms: true, whatsappConsent: true })
        .expect(200);

      const id = response.body.user._id as string;
      expect((await consentRows(id)).map((r) => [r.documentType, r.version, r.method])).toEqual([
        ['terms', '0.1', 'signup_google'],
        ['privacy', '0.1', 'signup_google'],
      ]);
      expect(await whatsappRows(id)).toEqual([
        expect.objectContaining({ action: 'granted', method: 'signup' }),
      ]);
    });

    it('BR-010-27: leaving the WhatsApp box off still creates the account, recording the refusal', async () => {
      const code = await googleCode(googleIdentity());

      const response = await request(server())
        .post('/api/auth/google/complete')
        .send({ code, acceptTerms: true })
        .expect(200);

      expect(await whatsappRows(response.body.user._id as string)).toEqual([
        expect.objectContaining({ action: 'declined', method: 'signup' }),
      ]);
    });

    it('BR-010-01: a stale version is a 409, stores nothing and keeps the pending sign-up usable', async () => {
      harness.clock.set(AFTER_V2);
      const who = googleIdentity();
      const code = await googleCode(who);

      const stale = await request(server())
        .post('/api/auth/google/complete')
        .send({ code, acceptTerms: true, termsVersion: '0.1', privacyVersion: '0.1' })
        .expect(409);
      expect(stale.body.code).toBe('TERMS_VERSION_OUTDATED');
      expect(await users.collection.countDocuments({ email: who.email })).toBe(0);

      const done = await request(server())
        .post('/api/auth/google/complete')
        .send({ code, acceptTerms: true, termsVersion: '0.2', privacyVersion: '0.2' })
        .expect(200);
      expect((await consentRows(done.body.user._id as string)).map((r) => r.version)).toEqual([
        '0.2',
        '0.2',
      ]);
    });
  });

  // BR-010-01: the account is created `pending`, its consent records are written, and only then is it
  // activated by one conditional update. These specs hold a sign-up INSIDE its consent write and run
  // the other requests meanwhile, on the real database: the interleaving is the test, not a timing.
  describe('a sign-up in flight is invisible to other requests (BR-010-01)', () => {
    afterEach(() => vi.restoreAllMocks());

    const sessions = () => connection.collection('sessions');
    const stored = (email: string) => users.collection.findOne({ email });

    /**
     * Makes the consent write of the next sign-up wait; `finish` then lets it fail (the rollback
     * case) or succeed. Mongoose stamps `createdAt` with the real time, so the fake clock is
     * brought to it: a pending account is "abandoned" only 15 minutes of THIS clock after.
     */
    function holdConsentWrite() {
      harness.clock.set(new Date());
      const service = harness.moduleRef.get(ConsentsService);
      const real = service.recordAcceptance.bind(service);
      let reached!: () => void;
      const reachedFirst = new Promise<void>((resolve) => (reached = resolve));
      let go!: (outcome: 'fail' | 'succeed') => void;
      const decision = new Promise<'fail' | 'succeed'>((resolve) => (go = resolve));
      vi.spyOn(service, 'recordAcceptance').mockImplementation(async (...args) => {
        reached();
        if ((await decision) === 'fail') throw new Error('consent store down');
        return real(...args);
      });
      return { reachedFirst, finish: go };
    }

    const login = (email: string) =>
      request(server()).post('/api/auth/login').send({ email, password: PASSWORD });

    it('e-mail sign-up: the right password, a Google sign-in and a reset are refused meanwhile, and a failed consent write leaves no account, session or acceptance', async () => {
      const email = `inflight-${(counter += 1)}@example.test`;
      const sessionsBefore = await sessions().countDocuments();
      const consentsBefore = await consents.collection.countDocuments();
      const gate = holdConsentWrite();

      const original = register(email).then((response) => response);
      await gate.reachedFirst;
      expect(await stored(email)).toMatchObject({ status: 'pending' });

      const refused = await login(email).expect(401);
      expect(refused.body).toEqual({ code: 'INVALID_CREDENTIALS', context: {} });
      const google = await request(server())
        .get('/api/auth/google/callback')
        .set(
          IDENTITY_HEADER,
          JSON.stringify({ googleId: `g-${counter}`, email, emailVerified: true, name: 'Ana' }),
        )
        .expect(302);
      expect(google.headers['location']).toContain('error=GOOGLE_SIGN_IN_FAILED');
      await request(server()).post('/api/auth/reset-password-request').send({ email }).expect(200);
      await harness.moduleRef.get(AuthService).flushDeliveries();
      expect(harness.mailbox.passwordResetEmails.map((mail) => mail.email)).not.toContain(email);
      expect(await sessions().countDocuments()).toBe(sessionsBefore);

      gate.finish('fail');
      expect((await original).status).toBe(500);

      expect(await stored(email)).toBeNull();
      expect(await sessions().countDocuments()).toBe(sessionsBefore);
      expect(await consents.collection.countDocuments()).toBe(consentsBefore);
      expect(harness.mailbox.verificationEmails.map((mail) => mail.email)).not.toContain(email);
      // The address is free: the same sign-up succeeds once the store is back.
      vi.restoreAllMocks();
      await register(email).expect(201);
    });

    it('Google sign-up: a second sign-in and a second code are refused meanwhile, and a failed consent write leaves no account or session', async () => {
      const who = googleIdentity();
      const first = await googleCode(who);
      const second = await googleCode(who);
      const sessionsBefore = await sessions().countDocuments();
      const gate = holdConsentWrite();

      const original = request(server())
        .post('/api/auth/google/complete')
        .send({ code: first, acceptTerms: true })
        .then((response) => response);
      await gate.reachedFirst;
      expect(await stored(who.email)).toMatchObject({ status: 'pending', googleId: who.googleId });

      // The second sign-in finds the pending account by Google id and by email: refused, no code.
      const again = await request(server())
        .get('/api/auth/google/callback')
        .set(IDENTITY_HEADER, JSON.stringify(who))
        .expect(302);
      expect(again.headers['location']).toContain('error=GOOGLE_SIGN_IN_FAILED');
      // The other tab's code is finished against the same pending account: refused too.
      const finished = await request(server())
        .post('/api/auth/google/complete')
        .send({ code: second, acceptTerms: true })
        .expect(401);
      expect(finished.body).toEqual({ code: 'GOOGLE_SIGN_IN_FAILED', context: {} });
      expect(await sessions().countDocuments()).toBe(sessionsBefore);
      expect(
        await connection
          .collection('accountTokens')
          .countDocuments({ purpose: 'google_exchange', userId: (await stored(who.email))?._id }),
      ).toBe(0);

      gate.finish('fail');
      expect((await original).status).toBe(500);

      expect(await stored(who.email)).toBeNull();
      expect(await sessions().countDocuments()).toBe(sessionsBefore);
      expect(
        await consents.collection.countDocuments({ method: 'signup_google', userId: null }),
      ).toBe(0);
    });

    it('a sign-up whose consent write succeeds is activated, and only then can anyone sign in', async () => {
      const email = `activated-${(counter += 1)}@example.test`;
      const gate = holdConsentWrite();

      const original = register(email).then((response) => response);
      await gate.reachedFirst;
      await login(email).expect(401);
      gate.finish('succeed');
      const done = await original;

      expect(done.status).toBe(201);
      expect(await stored(email)).toMatchObject({ status: 'active' });
      await login(email).expect(200);
    });

    it('activation failing leaves a pending account that cannot sign in, and the failure surfaces', async () => {
      const email = `noactivate-${(counter += 1)}@example.test`;
      const usersService = harness.moduleRef.get(UsersService);
      vi.spyOn(usersService, 'activateAccount').mockRejectedValue(new Error('write failed'));
      vi.spyOn(usersService, 'discardUnfinishedSignup').mockRejectedValue(
        new Error('write failed'),
      );
      const sessionsBefore = await sessions().countDocuments();

      await register(email).expect(500);

      expect(await stored(email)).toMatchObject({ status: 'pending' });
      await login(email).expect(401);
      expect(await sessions().countDocuments()).toBe(sessionsBefore);
    });

    it('activation is one conditional update: it matches a pending account once, and never an active or missing one', async () => {
      const email = `once-${(counter += 1)}@example.test`;
      const usersService = harness.moduleRef.get(UsersService);
      const created = await usersService.createLocalAccount(
        { email, name: 'Ana', password: PASSWORD },
        harness.clock.now(),
      );
      const id = created._id.toString();

      expect(await usersService.activateAccount(id)).toBe(true);
      expect(await usersService.activateAccount(id)).toBe(false);
      expect(await usersService.discardUnfinishedSignup(id)).toBe(false); // active: never deleted
      expect(await stored(email)).toMatchObject({ status: 'active' });
      expect(await usersService.activateAccount('64b0000000000000000000ff')).toBe(false);
    });

    it('a pending account older than 15 minutes is replaced by a new sign-up; a younger one is a taken e-mail', async () => {
      harness.clock.set(new Date());
      const usersService = harness.moduleRef.get(UsersService);
      const email = `stale-pending-${(counter += 1)}@example.test`;
      const old = await usersService.createLocalAccount(
        { email, name: 'Crashed', password: PASSWORD },
        harness.clock.now(),
      );

      // 14 minutes later: still in flight as far as anyone can tell.
      harness.clock.advance(14 * 60 * 1000);
      const taken = await register(email).expect(409);
      expect(taken.body.code).toBe('EMAIL_ALREADY_REGISTERED');
      expect(await stored(email)).toMatchObject({ _id: old._id, status: 'pending' });

      // 16 minutes after creation: abandoned. The new sign-up replaces it.
      harness.clock.advance(2 * 60 * 1000);
      const replaced = await register(email).expect(201);
      const now = await stored(email);
      expect(now).toMatchObject({ status: 'active' });
      expect(String(now?._id)).toBe(replaced.body.user._id);
      expect(String(now?._id)).not.toBe(old._id.toString());
    });

    it('an ACTIVE account is never deleted as abandoned, however old', async () => {
      const ana = await account('old-active');
      harness.clock.advance(365 * 24 * 60 * 60 * 1000);

      const taken = await register(ana.email).expect(409);

      expect(taken.body.code).toBe('EMAIL_ALREADY_REGISTERED');
      expect(await stored(ana.email)).toMatchObject({ status: 'active' });
    });

    it('a Google sign-in replaces an abandoned pending account of its identity and completes', async () => {
      harness.clock.set(new Date());
      const usersService = harness.moduleRef.get(UsersService);
      const who = googleIdentity();
      await usersService.createGoogleAccount(
        { googleId: who.googleId, email: who.email, name: 'Crashed' },
        harness.clock.now(),
      );
      harness.clock.advance(16 * 60 * 1000);

      const code = await googleCode(who);
      const done = await request(server())
        .post('/api/auth/google/complete')
        .send({ code, acceptTerms: true })
        .expect(200);

      expect(await users.collection.countDocuments({ email: who.email })).toBe(1);
      expect(await stored(who.email)).toMatchObject({ status: 'active' });
      expect(String((await stored(who.email))?._id)).toBe(done.body.user._id);
    });
  });

  describe('a new version is published (BR-010-05, DL-010-03)', () => {
    it('BR-010-05: until its effective instant nothing changes for an account', async () => {
      const ana = await account('before');
      harness.clock.set(new Date(V2_AT.getTime() - 1));

      await request(server())
        .post('/api/favorites')
        .set(as(ana.token))
        .send({ code: 'PRIV0001' })
        .expect(201);
      const me = await request(server()).get('/api/auth/me').set(as(ana.token)).expect(200);
      expect(me.body).toMatchObject({ termsAcceptanceRequired: false, documents: [] });
    });

    it('BR-010-05: a signed-in user adding a favorite is refused until it accepts; rights and acceptance still work', async () => {
      const ana = await account('behind');
      const bob = await account('other');
      harness.clock.set(AFTER_V2);

      // The account feature is refused, with the documents to accept (ids and versions only).
      const refused = await request(server())
        .post('/api/favorites')
        .set(as(ana.token))
        .send({ code: 'PRIV0001' })
        .expect(403);
      expect(refused.body).toEqual({
        code: 'TERMS_ACCEPTANCE_REQUIRED',
        context: {
          documents: [
            { type: 'terms', version: '0.2' },
            { type: 'privacy', version: '0.2' },
          ],
        },
      });
      await request(server()).get('/api/favorites/codes').set(as(ana.token)).expect(403);

      // /auth/me, the account's acceptances, the WhatsApp consent and the legal texts still answer.
      const me = await request(server()).get('/api/auth/me').set(as(ana.token)).expect(200);
      expect(me.body).toMatchObject({
        termsAcceptanceRequired: true,
        documents: [
          { type: 'terms', version: '0.2' },
          { type: 'privacy', version: '0.2' },
        ],
      });
      const acceptances = await request(server())
        .get('/api/privacy/acceptances')
        .set(as(ana.token))
        .expect(200);
      expect(acceptances.body.items.map((i: { version: string }) => i.version)).toEqual([
        '0.1',
        '0.1',
      ]);
      await request(server()).get('/api/privacy/whatsapp-consent').set(as(ana.token)).expect(200);
      await request(server()).get('/api/legal/current').expect(200);

      // A stale accept is refused and records nothing.
      await request(server())
        .post('/api/privacy/accept')
        .set(as(ana.token))
        .send({ termsVersion: '0.1', privacyVersion: '0.1' })
        .expect(409);

      // Accepting the current versions unlocks the account, for that account only.
      const accepted = await request(server())
        .post('/api/privacy/accept')
        .set(as(ana.token))
        .send({ termsVersion: '0.2', privacyVersion: '0.2' })
        .expect(200);
      expect(
        accepted.body.items.map((i: { version: string; method: string }) => [i.version, i.method]),
      ).toEqual(
        expect.arrayContaining([
          ['0.2', 'reacceptance'],
          ['0.1', 'signup_email'],
        ]),
      );
      await request(server())
        .post('/api/favorites')
        .set(as(ana.token))
        .send({ code: 'PRIV0001' })
        .expect(201);
      expect(
        (await request(server()).get('/api/auth/me').set(as(ana.token)).expect(200)).body,
      ).toMatchObject({ termsAcceptanceRequired: false, documents: [] });
      // Bob has not accepted: Ana's acceptance does not count for him.
      await request(server())
        .post('/api/favorites')
        .set(as(bob.token))
        .send({ code: 'PRIV0001' })
        .expect(403);
    });

    it('DL-010-03: signing out never waits for the acceptance', async () => {
      const ana = await account('logout');
      harness.clock.set(AFTER_V2);

      await request(server()).post('/api/auth/logout').set(as(ana.token)).expect(200);
      // The session is gone: a second use is a 401, not a terms refusal.
      await request(server()).get('/api/auth/me').set(as(ana.token)).expect(401);
    });

    it('SC-07: an anonymous request is a 401 from the JWT guard, never a terms refusal', async () => {
      harness.clock.set(AFTER_V2);
      const response = await request(server())
        .post('/api/favorites')
        .send({ code: 'PRIV0001' })
        .expect(401);
      expect(response.body.code).toBe('UNAUTHENTICATED');
    });

    it('BR-010-03, BR-010-05: 20 parallel re-acceptances end with exactly one row per document', async () => {
      const ana = await account('parallel');
      harness.clock.set(AFTER_V2);

      const answers = await Promise.all(
        Array.from({ length: 20 }, () =>
          request(server())
            .post('/api/privacy/accept')
            .set(as(ana.token))
            .send({ termsVersion: '0.2', privacyVersion: '0.2' }),
        ),
      );

      expect(answers.map((a) => a.status)).toEqual(Array(20).fill(200));
      const rows = await consentRows(ana.id);
      expect(
        rows
          .filter((r) => r.version === '0.2')
          .map((r) => r.documentType)
          .sort(),
      ).toEqual(['privacy', 'terms']);
      expect(rows).toHaveLength(4);
    });

    it('BR-010-03: accepting again what was accepted changes nothing, and keeps the first time and method', async () => {
      const ana = await account('again');
      harness.clock.set(AFTER_V2);
      const body = { termsVersion: '0.2', privacyVersion: '0.2' };
      await request(server()).post('/api/privacy/accept').set(as(ana.token)).send(body).expect(200);
      harness.clock.advance(DAY);

      await request(server()).post('/api/privacy/accept').set(as(ana.token)).send(body).expect(200);

      const second = (await consentRows(ana.id)).filter((r) => r.version === '0.2');
      expect(second).toHaveLength(2);
      expect(second.every((r) => r.acceptedAt.getTime() === AFTER_V2.getTime())).toBe(true);
    });

    it('refuses a body that names more than the two versions, or a version that is not a number', async () => {
      const ana = await account('body');
      const accept = (body: object) =>
        request(server()).post('/api/privacy/accept').set(as(ana.token)).send(body);

      await accept({ termsVersion: '0.1' }).expect(400);
      await accept({ termsVersion: '0.1', privacyVersion: 'abc' }).expect(400);
      await accept({ termsVersion: '0.1', privacyVersion: '0.1', userId: ana.id }).expect(400);
      await request(server()).post('/api/privacy/accept').send({}).expect(401);
    });
  });

  describe('TERMS_ENFORCEMENT_ENABLED off, the default', () => {
    it('records acceptances and reports the pending state, but refuses nothing', async () => {
      const ana = await account('lenient', {}, lenient);
      expect((await consentRows(ana.id)).map((r) => r.method)).toEqual([
        'signup_email',
        'signup_email',
      ]);
      lenient.clock.set(AFTER_V2);

      await request(server(lenient))
        .post('/api/favorites')
        .set(as(ana.token))
        .send({ code: 'PRIV0001' })
        .expect(201);
      const me = await request(server(lenient)).get('/api/auth/me').set(as(ana.token)).expect(200);
      expect(me.body.termsAcceptanceRequired).toBe(true);
    });
  });

  describe('the WhatsApp consent (BR-010-27)', () => {
    it('BR-010-27: an account created at sign-up is never asked again', async () => {
      const ana = await account('signed');

      const me = await request(server()).get('/api/auth/me').set(as(ana.token)).expect(200);

      expect(me.body.whatsappPromptPending).toBe(false);
    });

    it('BR-010-27: an account that predates the channel is asked once: pending until any answer, then never', async () => {
      const ana = await account('legacy');
      // An account of before the channel: no answer on record, never asked.
      await whatsappConsents.collection.deleteMany({
        userId: new connection.base.Types.ObjectId(ana.id),
      });
      await users.collection.updateOne(
        { email: ana.email },
        { $unset: { whatsappPromptAnsweredAt: '' } },
      );
      const pending = async () =>
        (await request(server()).get('/api/auth/me').set(as(ana.token)).expect(200)).body
          .whatsappPromptPending as boolean;

      expect(await pending()).toBe(true);
      expect(await pending()).toBe(true); // reading it does not answer it

      const answered = await request(server())
        .post('/api/privacy/whatsapp-consent')
        .set(as(ana.token))
        .send({ action: 'declined', method: 'existing_account_prompt' })
        .expect(200);
      expect(answered.body).toMatchObject({ state: 'declined', textVersion: '0.1' });

      expect(await pending()).toBe(false);
      // A new session (sign-in) is not asked again.
      const login = await request(server())
        .post('/api/auth/login')
        .send({ email: ana.email, password: PASSWORD })
        .expect(200);
      const again = await request(server())
        .get('/api/auth/me')
        .set(as(login.body.accessToken as string))
        .expect(200);
      expect(again.body.whatsappPromptPending).toBe(false);
      expect(await whatsappRows(ana.id)).toEqual([
        expect.objectContaining({ action: 'declined', method: 'existing_account_prompt' }),
      ]);
    });

    it.each(['granted', 'withdrawn', 'declined'] as const)(
      'BR-010-27: answering %s, or dismissing it that way, ends the prompt',
      async (action) => {
        const ana = await account(`prompt-${action}`);
        await users.collection.updateOne(
          { email: ana.email },
          { $unset: { whatsappPromptAnsweredAt: '' } },
        );

        await request(server())
          .post('/api/privacy/whatsapp-consent')
          .set(as(ana.token))
          .send({ action, method: 'existing_account_prompt' })
          .expect(200);

        const me = await request(server()).get('/api/auth/me').set(as(ana.token)).expect(200);
        expect(me.body.whatsappPromptPending).toBe(false);
      },
    );

    it('BR-010-27: a withdrawal is recorded with its time, and from then on there is no consent', async () => {
      const ana = await account('withdraw', { whatsappConsent: true });
      const service = harness.moduleRef.get(WhatsappConsentService);
      expect(await service.hasConsent(ana.id)).toBe(true);
      harness.clock.advance(DAY);

      const withdrawn = await request(server())
        .post('/api/privacy/whatsapp-consent')
        .set(as(ana.token))
        .send({ action: 'withdrawn', method: 'privacy_page' })
        .expect(200);

      expect(withdrawn.body).toEqual({
        state: 'withdrawn',
        at: new Date(AUTH_TEST_START.getTime() + DAY).toISOString(),
        textVersion: '0.1',
      });
      expect(await service.hasConsent(ana.id)).toBe(false);
      // The history stays: the grant, then the withdrawal.
      expect((await whatsappRows(ana.id)).map((r) => [r.action, r.method])).toEqual([
        ['granted', 'signup'],
        ['withdrawn', 'privacy_page'],
      ]);
      const state = await request(server())
        .get('/api/privacy/whatsapp-consent')
        .set(as(ana.token))
        .expect(200);
      expect(state.body.state).toBe('withdrawn');
    });

    it('BR-010-27: granting again later makes it a consent again', async () => {
      const ana = await account('regrant');
      const service = harness.moduleRef.get(WhatsappConsentService);
      expect(await service.hasConsent(ana.id)).toBe(false);

      await request(server())
        .post('/api/privacy/whatsapp-consent')
        .set(as(ana.token))
        .send({ action: 'granted', method: 'privacy_page' })
        .expect(200);

      expect(await service.hasConsent(ana.id)).toBe(true);
    });

    it('answers `none` before any answer of an account that never answered', async () => {
      const ana = await account('none');
      await whatsappConsents.collection.deleteMany({
        userId: new connection.base.Types.ObjectId(ana.id),
      });

      const state = await request(server())
        .get('/api/privacy/whatsapp-consent')
        .set(as(ana.token))
        .expect(200);

      expect(state.body).toEqual({ state: 'none', at: null, textVersion: null });
    });

    it('refuses an answer the API does not define: another action, the sign-up method, no body', async () => {
      const ana = await account('invalid');
      const post = (body: object) =>
        request(server()).post('/api/privacy/whatsapp-consent').set(as(ana.token)).send(body);

      await post({ action: 'maybe', method: 'privacy_page' }).expect(400);
      await post({ action: 'granted', method: 'signup' }).expect(400);
      await post({}).expect(400);
      await request(server()).post('/api/privacy/whatsapp-consent').send({}).expect(401);
      await request(server()).get('/api/privacy/whatsapp-consent').expect(401);
      await request(server()).get('/api/privacy/acceptances').expect(401);
    });
  });

  describe('the records are insert-only (AR-30)', () => {
    it('refuses to change or delete an acceptance or a WhatsApp answer through the models', async () => {
      const ana = await account('immutable', { whatsappConsent: true });
      const consent = harness.moduleRef.get<Model<unknown>>(getModelToken(ConsentEntity.name));
      const whatsapp = harness.moduleRef.get<Model<unknown>>(
        getModelToken(WhatsappConsentEntity.name),
      );

      await expect(
        consent.updateOne({ version: '0.1' }, { $set: { version: '9' } }),
      ).rejects.toThrow('insert-only');
      await expect(consent.deleteMany({})).rejects.toThrow('insert-only');
      await expect(whatsapp.updateOne({}, { $set: { action: 'granted' } })).rejects.toThrow(
        'insert-only',
      );
      await expect(whatsapp.deleteOne({})).rejects.toThrow('insert-only');
      expect(await consentRows(ana.id)).toHaveLength(2);
    });

    it('holds one acceptance per account, document and version in the database itself', async () => {
      const ana = await account('unique');
      const [row] = await consentRows(ana.id);

      await expect(
        consents.collection.insertOne({ ...row, _id: undefined } as never),
      ).rejects.toMatchObject({
        code: 11000,
      });
    });
  });

  describe('DL-010-03: what stays reachable while a new version is pending (enforcement on)', () => {
    /** An account that signed up under 0.1, with 0.2 now in force. */
    async function pendingAccount(label: string) {
      const ana = await account(label);
      harness.clock.set(AFTER_V2);
      return ana;
    }
    const refusedBody = {
      code: 'TERMS_ACCEPTANCE_REQUIRED',
      context: {
        documents: [
          { type: 'terms', version: '0.2' },
          { type: 'privacy', version: '0.2' },
        ],
      },
    };

    it("BR-010-08, BR-010-12: reading and correcting one's own data works, while a favorite is refused", async () => {
      const ana = await pendingAccount('rights');

      const full = await request(server())
        .get('/api/auth/profile/full')
        .set(as(ana.token))
        .expect(200);
      expect(full.body.email).toBe(ana.email);
      const patched = await request(server())
        .patch('/api/auth/profile')
        .set(as(ana.token))
        .send({ name: 'Nome Corrigido' })
        .expect(200);
      expect(patched.body.name).toBe('Nome Corrigido');
      const refused = await request(server())
        .post('/api/favorites')
        .set(as(ana.token))
        .send({ code: 'PRIV0001' })
        .expect(403);
      expect(refused.body).toEqual(refusedBody);
    });

    it('SC-07: the payment webhook, the plans and the public auction routes still answer', async () => {
      harness.clock.set(AFTER_V2);

      // Anonymous routes never meet the guard: the webhook reaches its own signature check (400,
      // not 401 or 403), the catalogue and the search answer.
      const webhook = await request(server())
        .post('/api/payments/webhook')
        .set('stripe-signature', 'bad')
        .send({})
        .expect(400);
      expect(webhook.body.code).toBe('INVALID_WEBHOOK_SIGNATURE');
      await request(server()).get('/api/plans').expect(200);
      await request(server()).get('/api/auctions').expect(200);
      await request(server()).get('/api/auctions/PRIV0001').expect(200);
    });

    it('BR-002-23: an admin route is refused to a pending account, then answers once it accepts', async () => {
      const boss = await pendingAccount('admin');
      await users.collection.updateOne({ email: boss.email }, { $set: { isAdmin: true } });

      const refused = await request(server()).get('/api/coupons').set(as(boss.token)).expect(403);
      expect(refused.body).toEqual(refusedBody);

      await request(server())
        .post('/api/privacy/accept')
        .set(as(boss.token))
        .send({ termsVersion: '0.2', privacyVersion: '0.2' })
        .expect(200);
      await request(server()).get('/api/coupons').set(as(boss.token)).expect(200);
    });
  });

  describe("DL-001-02: a Google takeover of an unconfirmed account does not inherit the registrant's consent", () => {
    /** The registrant signs up by e-mail (never confirming) ticking WhatsApp, then the owner signs in with Google. */
    async function takeover() {
      counter += 1;
      const email = `takeover-${counter}@example.test`;
      const registrant = await register(email, { whatsappConsent: true }).expect(201);
      const id = registrant.body.user._id as string;
      const who: GoogleIdentity = {
        googleId: `google-sub-owner-${counter}`,
        email,
        emailVerified: true,
        name: 'Dona Real',
      };
      const exchange = await request(server())
        .post('/api/auth/google/exchange')
        .send({ code: await googleCode(who) })
        .expect(200);
      expect(exchange.body.status).toBe('signed_in');
      return {
        id,
        email,
        registrantToken: registrant.body.accessToken as string,
        token: exchange.body.accessToken as string,
      };
    }
    const service = () => harness.moduleRef.get(WhatsappConsentService);

    it("the registrant's acceptance and WhatsApp consent count for nobody; the owner is asked again, to accept and to answer", async () => {
      const t = await takeover();
      expect(await service().hasConsent(t.id)).toBe(false); // the registrant ticked it: not the owner's
      expect(await whatsappRows(t.id)).toHaveLength(1); // the registrant's row is kept as history

      // Enforcement on: the owner is refused like any account that has not accepted.
      const refused = await request(server())
        .post('/api/favorites')
        .set(as(t.token))
        .send({ code: 'PRIV0001' })
        .expect(403);
      expect(refused.body.code).toBe('TERMS_ACCEPTANCE_REQUIRED');
      const me = await request(server()).get('/api/auth/me').set(as(t.token)).expect(200);
      expect(me.body).toMatchObject({
        termsAcceptanceRequired: true,
        documents: [
          { type: 'terms', version: '0.1' },
          { type: 'privacy', version: '0.1' },
        ],
        whatsappPromptPending: true,
      });
      const mine = await request(server())
        .get('/api/privacy/acceptances')
        .set(as(t.token))
        .expect(200);
      expect(mine.body.items).toEqual([]); // the registrant's rows are not the owner's
      expect(
        (await request(server()).get('/api/privacy/whatsapp-consent').set(as(t.token)).expect(200))
          .body,
      ).toEqual({ state: 'none', at: null, textVersion: null });

      // The owner accepts the very versions the registrant had accepted: allowed, then unlocked.
      await request(server())
        .post('/api/privacy/accept')
        .set(as(t.token))
        .send({ termsVersion: '0.1', privacyVersion: '0.1' })
        .expect(200);
      await request(server())
        .post('/api/favorites')
        .set(as(t.token))
        .send({ code: 'PRIV0001' })
        .expect(201);
      // And answers the WhatsApp request for themselves.
      await request(server())
        .post('/api/privacy/whatsapp-consent')
        .set(as(t.token))
        .send({ action: 'declined', method: 'existing_account_prompt' })
        .expect(200);
      expect(
        (await request(server()).get('/api/auth/me').set(as(t.token)).expect(200)).body,
      ).toMatchObject({ termsAcceptanceRequired: false, whatsappPromptPending: false });
      expect(await service().hasConsent(t.id)).toBe(false);

      // The proof is never rewritten: both generations are in the collection, apart.
      const rows = await consentRows(t.id);
      expect(rows).toHaveLength(4);
      expect(rows.filter((r) => r.consentResetAt === null)).toHaveLength(2);
      expect(
        rows.filter((r) => r.consentResetAt?.getTime() === AUTH_TEST_START.getTime()),
      ).toHaveLength(2);
      const stored = await users.collection.findOne({ email: t.email });
      expect(stored?.consentResetAt).toEqual(AUTH_TEST_START);
    });

    it("the registrant's old session is refused (SPEC-001 takeover atomicity is intact)", async () => {
      const t = await takeover();

      await request(server()).get('/api/auth/me').set(as(t.registrantToken)).expect(401);
      const stored = await users.collection.findOne({ email: t.email });
      expect(stored).not.toHaveProperty('password');
      expect(stored?.credentialVersion).toBe(1);
    });

    it("a registrant's write that lands after the takeover counts for nobody", async () => {
      const t = await takeover();
      const consentsService = harness.moduleRef.get(ConsentsService);

      // The registrant's request finishing late: generation null, as it was created.
      await consentsService.recordAcceptance(
        t.id,
        { terms: '0.1', privacy: '0.1' },
        'signup_email',
      );
      await service().recordAtSignup(t.id, true);

      expect(await service().hasConsent(t.id)).toBe(false);
      const me = await request(server()).get('/api/auth/me').set(as(t.token)).expect(200);
      expect(me.body).toMatchObject({ termsAcceptanceRequired: true, whatsappPromptPending: true });
    });

    it("linking a CONFIRMED account changes nothing: its acceptance and consent stay the owner's", async () => {
      const ana = await account('confirmed', { whatsappConsent: true });
      const who: GoogleIdentity = {
        googleId: `google-sub-confirmed-${(counter += 1)}`,
        email: ana.email,
        emailVerified: true,
        name: 'Ana',
      };
      const exchange = await request(server())
        .post('/api/auth/google/exchange')
        .send({ code: await googleCode(who) })
        .expect(200);

      const token = exchange.body.accessToken as string;
      await request(server())
        .post('/api/favorites')
        .set(as(token))
        .send({ code: 'PRIV0001' })
        .expect(201);
      expect(await service().hasConsent(ana.id)).toBe(true);
      expect(
        (await users.collection.findOne({ email: ana.email }))?.consentResetAt,
      ).toBeUndefined();
      expect(
        (await request(server()).get('/api/auth/me').set(as(token)).expect(200)).body,
      ).toMatchObject({ termsAcceptanceRequired: false, whatsappPromptPending: false });
    });
  });

  describe('BR-010-27: answering what the latest answer already says', () => {
    it('records nothing new: an identical answer is idempotent and still answers the state', async () => {
      const ana = await account('idempotent');
      const post = (action: string) =>
        request(server())
          .post('/api/privacy/whatsapp-consent')
          .set(as(ana.token))
          .send({ action, method: 'privacy_page' });

      const first = await post('granted').expect(200);
      const again = await post('granted').expect(200);
      await post('granted').expect(200);

      expect(again.body).toEqual(first.body);
      // The sign-up refusal, then ONE grant however often it was repeated.
      expect((await whatsappRows(ana.id)).map((r) => r.action)).toEqual(['declined', 'granted']);
      await post('withdrawn').expect(200);
      await post('granted').expect(200); // differs from the latest (withdrawn): recorded
      expect((await whatsappRows(ana.id)).map((r) => r.action)).toEqual([
        'declined',
        'granted',
        'withdrawn',
        'granted',
      ]);
    });
  });

  describe('BR-010-05: up to date means the distinct documents were accepted, not a number of rows', () => {
    it('duplicate rows of one document (no unique index) cannot make an account look up to date', async () => {
      const ana = await account('duplicates');
      const ObjectId = connection.base.Types.ObjectId;
      const userId = new ObjectId(ana.id);
      await consents.collection.deleteMany({ userId });
      await consents.collection.dropIndex('one_acceptance_per_version');
      try {
        const row = {
          userId,
          documentType: 'terms',
          version: '0.1',
          contentHash: 'a'.repeat(64),
          acceptedAt: AUTH_TEST_START,
          method: 'signup_email',
          consentResetAt: null,
        };
        await consents.collection.insertMany([{ ...row }, { ...row }]); // two rows, one document

        const me = await request(server()).get('/api/auth/me').set(as(ana.token)).expect(200);

        expect(me.body).toMatchObject({
          termsAcceptanceRequired: true,
          documents: [{ type: 'privacy', version: '0.1' }],
        });
        // The guard reads the same state: the missing document is what it demands.
        const refused = await request(server())
          .post('/api/favorites')
          .set(as(ana.token))
          .send({ code: 'PRIV0001' })
          .expect(403);
        expect(refused.body.context).toEqual({ documents: [{ type: 'privacy', version: '0.1' }] });
      } finally {
        await consents.collection.deleteMany({ userId });
        await connection.syncIndexes();
      }
    });
  });
});
