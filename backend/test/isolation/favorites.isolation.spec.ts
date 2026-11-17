// SPEC-002 BR-002-02 / TS-13..TS-17: favorites are the account's own data. Two accounts through the
// real API: B's favorites never reach A's list, count or codes; A acting on B's favorite changes
// nothing of B's and answers like an unknown code; an account id planted in the request is refused
// or ignored (BR-002-11). An office A of which B is a client sees nothing either (DL-002-08).
import { afterAll, beforeAll, expect, it } from 'vitest';
import { getModelToken } from '@nestjs/mongoose';
import type { Model } from 'mongoose';
import { AuctionEntity } from '../../src/auctions/schemas/auction.schema.js';
import { AuctionsModule } from '../../src/auctions/auctions.module.js';
import { FavoritesModule } from '../../src/favorites/favorites.module.js';
import { useTestDatabase } from '../support/test-database.js';
import {
  answerOf,
  createIsolationApp,
  type IsolationApp,
  type TestAccount,
} from './support/isolation-app.js';
import { isolationSpecFor } from './support/isolation-spec.js';

const OFFICE_A = '64b7f00000000000000a0a0a';

isolationSpecFor('FavoriteEntity', () => {
  const db = useTestDatabase();
  let app: IsolationApp;
  let a: TestAccount;
  let b: TestAccount;
  let advisorOfB: TestAccount;

  const codesOf = async (account: TestAccount) =>
    ((await app.as(account).get('/api/favorites/codes').expect(200)).body as { codes: string[] })
      .codes;
  const pageOf = async (account: TestAccount, query = '') =>
    (await app.as(account).get(`/api/favorites${query}`).expect(200)).body as {
      items: { code: string }[];
      total: number;
    };

  beforeAll(async () => {
    app = await createIsolationApp(db, [AuctionsModule, FavoritesModule]);
    const auctions = app.harness.moduleRef.get<Model<unknown>>(getModelToken(AuctionEntity.name));
    const phase = { modality: 'ONLINE_SALES', minimumPrice: null };
    // Far-future dates keep them active whatever day this runs.
    await auctions.collection.insertMany(
      ['SHARED01', 'ONLYB001', 'ONLYA001'].map((code) => ({
        code,
        available: true,
        phases: [phase],
        currentPhase: phase,
        updatedAt: new Date('2999-01-01T00:00:00.000Z'),
      })),
    );
    [a, b, advisorOfB] = await app.signUpAll('a', 'b', 'advisor');
    // B is a client of office A, whose member is advisorOfB.
    app.sources
      .forAccount(b.id, { clientLinks: [{ officeId: OFFICE_A, status: 'active' }] })
      .forAccount(advisorOfB.id, { memberships: [{ officeId: OFFICE_A }] });
    app.sources.plans = {
      [OFFICE_A]: { advisorPlanActive: true, readOnly: false, entitlements: [] },
    };
    for (const [account, code] of [
      [a, 'SHARED01'],
      [a, 'ONLYA001'],
      [b, 'SHARED01'],
      [b, 'ONLYB001'],
    ] as const) {
      await app.as(account).post('/api/favorites').send({ code }).expect(201);
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('BR-002-02 / TS-16: B’s favorites never appear in A’s list, count or codes', async () => {
    expect((await codesOf(a)).sort()).toEqual(['ONLYA001', 'SHARED01']);
    expect((await codesOf(b)).sort()).toEqual(['ONLYB001', 'SHARED01']);
    const page = await pageOf(a);
    expect(page.total).toBe(2);
    expect(page.items.map((item) => item.code).sort()).toEqual(['ONLYA001', 'SHARED01']);
  });

  it('DL-002-08: an advisor of B’s office sees none of B’s favorites', async () => {
    expect(await codesOf(advisorOfB)).toEqual([]);
    expect((await pageOf(advisorOfB)).total).toBe(0);
  });

  it('BR-002-12 / TS-17: A removing B’s favorite answers like an unknown code and leaves B’s', async () => {
    const as = app.as(a);
    expect(await answerOf(as.delete('/api/favorites/ONLYB001'))).toEqual(
      await answerOf(as.delete('/api/favorites/NOSUCH01')),
    );
    expect((await codesOf(b)).sort()).toEqual(['ONLYB001', 'SHARED01']);
  });

  it('BR-002-02: A removing a code both favorited removes A’s only', async () => {
    await app.as(a).delete('/api/favorites/SHARED01').expect(204);

    expect(await codesOf(a)).toEqual(['ONLYA001']);
    expect((await codesOf(b)).sort()).toEqual(['ONLYB001', 'SHARED01']);
    await app.as(a).post('/api/favorites').send({ code: 'SHARED01' }).expect(201);
  });

  it('BR-002-11: an account id in the body, query or a header is refused or ignored', async () => {
    const as = app.as(a);
    for (const planted of [{ userId: b.id }, { ownerId: b.id }, { officeId: OFFICE_A }]) {
      const refused = await as
        .post('/api/favorites')
        .send({ code: 'ONLYB001', ...planted })
        .expect(400);
      expect(refused.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    await as.get(`/api/favorites?userId=${b.id}`).expect(400);
    const viaHeader = await as.get('/api/favorites/codes').set('X-User-Id', b.id).expect(200);
    expect((viaHeader.body as { codes: string[] }).codes.sort()).toEqual(['ONLYA001', 'SHARED01']);
    expect((await codesOf(b)).sort()).toEqual(['ONLYB001', 'SHARED01']);
  });
});
