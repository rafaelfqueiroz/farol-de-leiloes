// SPEC-002 (#2), part 1: the access context through the real AuthModule over MongoDB (TESTING §2).
// Sign-up, sign-in and every request go through the production JwtAuthGuard, JwtStrategy and
// AccessContextGuard; only the clock, the mailer and the SPEC-011/012 sources are fakes (TS-03,
// TS-06, TS-07). Proves: /auth/me's capabilities, the admin capability read on every request of an
// open session (BR-002-15), the admin gate on operations endpoints, admin getting no paid feature
// (BR-002-23), and that a persona guard sees the context the global guards built, in order.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Controller, Get, Module } from '@nestjs/common';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import request from 'supertest';
import type { AccessContext } from '../../src/access/access-context.js';
import { Access } from '../../src/access/decorators/access.decorator.js';
import { RequiresPersona } from '../../src/access/decorators/access-guards.decorator.js';
import { MEMBERSHIP_SOURCE } from '../../src/access/sources/membership.source.js';
import { OFFICE_PLAN_SOURCE } from '../../src/access/sources/office-plan.source.js';
import { AuctionEntity } from '../../src/auctions/schemas/auction.schema.js';
import { AuctionsModule } from '../../src/auctions/auctions.module.js';
import { CouponsModule } from '../../src/coupons/coupons.module.js';
import { RemindersModule } from '../../src/reminders/reminders.module.js';
import { UserEntity, type UserDocument } from '../../src/users/schemas/user.schema.js';
import { FakeAccessSources } from '../fakes/fake-access-sources.js';
import { createAuthTestApp, type AuthTestApp } from '../support/auth-test-app.js';
import { useTestDatabase } from '../support/test-database.js';

const PASSWORD = 'correct horse';
const AUCTION_CODE = 'TESTE0002';

/** A route that only an advisor reaches, and one any signed-in account reaches. */
@Controller('access-probe')
class AccessProbeController {
  @Get('searcher')
  @RequiresPersona('searcher')
  searcher(@Access() access: AccessContext) {
    return { personas: access.personas, owners: access.conductedOwners() };
  }

  @Get('advisor')
  @RequiresPersona('advisor')
  advisor(@Access() access: AccessContext) {
    return { owners: access.conductedOwners() };
  }
}

@Module({ controllers: [AccessProbeController] })
class AccessProbeModule {}

describe('SPEC-002 access context (integration)', () => {
  const db = useTestDatabase();
  const sources = new FakeAccessSources();
  let harness: AuthTestApp;
  let users: Model<UserDocument>;
  let counter = 0;

  const server = () => harness.app.getHttpServer() as Parameters<typeof request>[0];
  const as = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function signUp(label: string) {
    counter += 1;
    const email = `${label}-${counter}@example.test`;
    const response = await request(server())
      .post('/api/auth/register')
      .send({ email, password: PASSWORD, name: 'Ana Teste', acceptTerms: true })
      .expect(201);
    return { email, token: response.body.accessToken as string };
  }

  beforeAll(async () => {
    harness = await createAuthTestApp(
      db,
      [AuctionsModule, CouponsModule, RemindersModule, AccessProbeModule],
      { IMPORT_ENABLED: 'false', SCRAPER_ENABLED: 'false', REMINDERS_ENABLED: 'false' },
      // SPEC-011/012 do not exist yet: the seams are fed by a fake the spec controls (TS-03).
      (builder) =>
        builder
          .overrideProvider(MEMBERSHIP_SOURCE)
          .useValue(sources)
          .overrideProvider(OFFICE_PLAN_SOURCE)
          .useValue(sources),
    );
    users = harness.moduleRef.get(getModelToken(UserEntity.name));
    // An auction to remind about; far-future dates keep it in the future whatever day this runs.
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

  it('BR-002-14: /auth/me answers isAdmin false and the searcher persona for a new account', async () => {
    const { token } = await signUp('searcher');

    const me = await request(server()).get('/api/auth/me').set(as(token)).expect(200);

    expect(me.body).toMatchObject({ role: 'free', isAdmin: false, personas: ['searcher'] });
  });

  it('BR-002-23: a non-admin is refused on the coupon administration routes', async () => {
    const { token } = await signUp('not-admin');

    for (const call of [
      request(server()).get('/api/coupons'),
      request(server()).post('/api/coupons').send({}),
      request(server()).patch('/api/coupons/64b7f00000000000000000dd/invalidate'),
    ]) {
      const response = await call.set(as(token)).expect(403);
      expect(response.body).toEqual({ code: 'FORBIDDEN', context: {} });
    }
  });

  it('BR-002-15: the admin capability is read on every request of an already open session', async () => {
    const { email, token } = await signUp('operator');
    await request(server()).get('/api/coupons').set(as(token)).expect(403);

    await users.updateOne({ email }, { $set: { isAdmin: true } });
    await request(server()).get('/api/coupons').set(as(token)).expect(200);
    const me = await request(server()).get('/api/auth/me').set(as(token)).expect(200);
    expect(me.body).toMatchObject({ isAdmin: true, personas: ['searcher'] });

    await users.updateOne({ email }, { $set: { isAdmin: false } });
    await request(server()).get('/api/coupons').set(as(token)).expect(403);
  });

  it("BR-002-23: the legacy role 'admin' alone opens no admin route", async () => {
    const { email, token } = await signUp('legacy-admin');
    await users.updateOne({ email }, { $set: { role: 'admin' } });

    await request(server()).get('/api/coupons').set(as(token)).expect(403);
    const me = await request(server()).get('/api/auth/me').set(as(token)).expect(200);
    expect(me.body).toMatchObject({ role: 'admin', isAdmin: false });
  });

  it('BR-002-23: an admin gets no paid feature (an SMS reminder is outside every plan it has)', async () => {
    const { email, token } = await signUp('admin-no-plan');
    await users.updateOne(
      { email },
      { $set: { role: 'admin', isAdmin: true, emailVerified: true, phone: '+5584999991234' } },
    );

    const response = await request(server())
      .post('/api/reminders')
      .set(as(token))
      .send({ auctionId: AUCTION_CODE, channel: 'SMS', scheduledAt: '2998-12-01T12:00:00.000Z' })
      .expect(403);

    expect(response.body).toEqual({
      code: 'REMINDER_CHANNEL_NOT_IN_PLAN',
      context: { channel: 'SMS' },
    });
  });

  it('AR-13: a persona guard sees the context the global guards built from the signed-in user', async () => {
    const { token } = await signUp('probe');

    const response = await request(server())
      .get('/api/access-probe/searcher')
      .set(as(token))
      .expect(200);

    expect(response.body).toEqual({ personas: ['searcher'], owners: [] });
    await request(server()).get('/api/access-probe/searcher').expect(401);
  });

  it('BR-002-15: a membership granted or removed between two requests counts on the next one', async () => {
    const { token } = await signUp('member');
    const refused = await request(server())
      .get('/api/access-probe/advisor')
      .set(as(token))
      .expect(403);
    expect(refused.body).toEqual({ code: 'PERSONA_REQUIRED', context: { personas: ['advisor'] } });

    sources.relationships = {
      memberships: [{ officeId: 'office-a' }],
      officePlans: { 'office-a': { advisorPlanActive: true, readOnly: false, entitlements: [] } },
    };
    try {
      const allowed = await request(server())
        .get('/api/access-probe/advisor')
        .set(as(token))
        .expect(200);
      expect(allowed.body).toEqual({ owners: [{ ownerType: 'office', ownerId: 'office-a' }] });
    } finally {
      sources.relationships = {};
    }

    await request(server()).get('/api/access-probe/advisor').set(as(token)).expect(403);
  });

  it('BR-002-21: an admin is no advisor even when a source says it is a member', async () => {
    const { email, token } = await signUp('admin-member');
    await users.updateOne({ email }, { $set: { isAdmin: true } });
    sources.relationships = {
      memberships: [{ officeId: 'office-a' }],
      officePlans: { 'office-a': { advisorPlanActive: true, readOnly: false, entitlements: [] } },
    };
    try {
      await request(server()).get('/api/access-probe/advisor').set(as(token)).expect(403);
      const me = await request(server()).get('/api/auth/me').set(as(token)).expect(200);
      expect(me.body).toMatchObject({ isAdmin: true, personas: ['searcher'] });
    } finally {
      sources.relationships = {};
    }
  });
});
