// SPEC-001 BR-001-04 / AC3: an account whose email is not confirmed can sign in but is refused by
// the account features on the server, and the same action succeeds once the link is used. The
// real AuthModule, JwtStrategy and the real favorites, saved-filters, reminders and support
// modules over MongoDB (TESTING §2). Nothing reaches the network (TS-07).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import { AuthService } from '../../src/auth/auth.service.js';
import { AuctionEntity } from '../../src/auctions/schemas/auction.schema.js';
import { AuctionsModule } from '../../src/auctions/auctions.module.js';
import { FavoritesModule } from '../../src/favorites/favorites.module.js';
import { RemindersModule } from '../../src/reminders/reminders.module.js';
import { SavedFiltersModule } from '../../src/saved-filters/saved-filters.module.js';
import { SupportModule } from '../../src/support/support.module.js';
import { UserEntity, type UserDocument } from '../../src/users/schemas/user.schema.js';
import { createAuthTestApp, type AuthTestApp } from '../support/auth-test-app.js';
import { useTestDatabase } from '../support/test-database.js';

const PASSWORD = 'correct horse';
const AUCTION_CODE = 'TESTE0001';

describe('BR-001-04: the confirmed-email guard (integration)', () => {
  const db = useTestDatabase();
  let harness: AuthTestApp;
  let users: Model<UserDocument>;
  let counter = 0;

  const server = () => harness.app.getHttpServer() as Parameters<typeof request>[0];

  async function signUp(label: string) {
    counter += 1;
    const email = `${label}-${counter}@example.test`;
    const response = await request(server())
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, name: 'Ana Teste', acceptTerms: true })
      .expect(201);
    const confirmation = harness.mailbox.verificationEmails.slice(-1)[0]?.token ?? '';
    return { email, token: response.body.accessToken as string, confirmation };
  }

  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    harness = await createAuthTestApp(
      db,
      [AuctionsModule, FavoritesModule, SavedFiltersModule, RemindersModule, SupportModule],
      { IMPORT_ENABLED: 'false', SCRAPER_ENABLED: 'false', REMINDERS_ENABLED: 'false' },
    );
    users = harness.moduleRef.get(getModelToken(UserEntity.name));
    // An active auction to favorite; far-future dates keep it active whatever day this runs.
    const auctions = harness.moduleRef.get<Model<unknown>>(getModelToken(AuctionEntity.name));
    const phase = { modality: 'ONLINE_SALES', minimumPrice: null };
    await auctions.collection.insertOne({
      code: AUCTION_CODE,
      available: true,
      phases: [phase],
      currentPhase: phase,
      updatedAt: new Date('2999-01-01T00:00:00.000Z'),
    });
  });

  afterAll(async () => {
    await harness.app.close();
  });

  it('AC3: an unconfirmed account can sign in, is refused on adding a favorite, and succeeds after confirming', async () => {
    const { email, token, confirmation } = await signUp('unconfirmed');
    await request(server()).get('/api/auth/me').set(as(token)).expect(200);

    const refused = await request(server())
      .post('/api/favorites')
      .set(as(token))
      .send({ code: AUCTION_CODE })
      .expect(403);
    expect(refused.body).toEqual({ code: 'EMAIL_VERIFICATION_REQUIRED', context: {} });
    expect(
      await harness.moduleRef.get<Model<unknown>>(getModelToken('FavoriteEntity')).countDocuments(),
    ).toBe(0);

    await request(server())
      .post('/api/auth/verify-email')
      .send({ token: confirmation })
      .expect(200);

    // The session was opened before the confirmation: the flag is read per request (BR-001-17).
    await request(server())
      .post('/api/favorites')
      .set(as(token))
      .send({ code: AUCTION_CODE })
      .expect(201);
    expect(await users.findOne({ email }).lean()).toMatchObject({ emailVerified: true });
  });

  it.each([
    ['favorites', 'get', '/api/favorites'],
    ['favorites codes', 'get', '/api/favorites/codes'],
    ['saved filters', 'get', '/api/saved-filters'],
    ['reminders', 'get', '/api/reminders'],
    ['support', 'post', '/api/support'],
  ] as const)(
    '%s: refused with EMAIL_VERIFICATION_REQUIRED while unconfirmed',
    async (_label, method, path) => {
      const { token } = await signUp('guarded');

      const response = await request(server())[method](path).set(as(token)).send({}).expect(403);

      expect(response.body.code).toBe('EMAIL_VERIFICATION_REQUIRED');
    },
  );

  it('a confirmed account passes on every guarded controller', async () => {
    const { token, confirmation } = await signUp('confirmed');
    await request(server())
      .post('/api/auth/verify-email')
      .send({ token: confirmation })
      .expect(200);

    for (const path of [
      '/api/favorites',
      '/api/favorites/codes',
      '/api/saved-filters',
      '/api/reminders',
    ]) {
      await request(server()).get(path).set(as(token)).expect(200);
    }
  });

  it('a Google-style account, created confirmed, passes', async () => {
    counter += 1;
    const email = `google-${counter}@example.test`;
    await users.create({
      email,
      name: 'Ana Google',
      googleId: `g-${counter}`,
      providers: ['google'],
      emailVerified: true,
    });
    await request(server()).post('/api/auth/reset-password-request').send({ email }).expect(200);
    await harness.moduleRef.get(AuthService).flushDeliveries();
    const resetToken = harness.mailbox.passwordResetEmails.slice(-1)[0]?.token ?? '';
    await request(server())
      .post('/api/auth/reset-password')
      .send({ token: resetToken, newPassword: PASSWORD })
      .expect(200);
    const signedIn = await request(server())
      .post('/api/auth/login')
      .send({ email, password: PASSWORD })
      .expect(200);

    await request(server())
      .get('/api/favorites')
      .set(as(signedIn.body.accessToken as string))
      .expect(200);
  });

  it('the routes that must stay open stay open for an unconfirmed account', async () => {
    const { token } = await signUp('open');

    await request(server()).get('/api/auctions').expect(200); // public search
    await request(server()).get('/api/auth/verification-status').set(as(token)).expect(200);
    await request(server())
      .patch('/api/auth/profile')
      .set(as(token))
      .send({ name: 'Ana Renomeada' })
      .expect(200);
    await request(server()).post('/api/auth/resend-verification').set(as(token)).expect(200);
  });

  it('BR-001-07: confirmation and recovery mail are sent whatever the confirmation state', async () => {
    const { email } = await signUp('notice');
    const before = harness.mailbox.passwordResetEmails.length;

    await request(server()).post('/api/auth/reset-password-request').send({ email }).expect(200);
    await harness.moduleRef.get(AuthService).flushDeliveries();

    expect(harness.mailbox.verificationEmails.slice(-1)[0]?.email).toBe(email);
    expect(harness.mailbox.passwordResetEmails).toHaveLength(before + 1);
  });
});
