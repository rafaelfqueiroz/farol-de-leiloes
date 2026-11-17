// SPEC-002 BR-002-02 / TS-13..TS-17: saved filters are the account's own data. Two accounts through
// the real API: B's filters never reach A's list or count, nor A's duplicate-name check or limit;
// A deleting B's filter answers exactly like a random id and leaves it; an account id planted in
// the request is refused or ignored (BR-002-11).
import { afterAll, beforeAll, expect, it } from 'vitest';
import { SavedFiltersModule } from '../../src/saved-filters/saved-filters.module.js';
import { useTestDatabase } from '../support/test-database.js';
import {
  answerOf,
  createIsolationApp,
  type IsolationApp,
  RANDOM_ID,
  type TestAccount,
} from './support/isolation-app.js';
import { isolationSpecFor } from './support/isolation-spec.js';

isolationSpecFor('SavedFilterEntity', () => {
  const db = useTestDatabase();
  let app: IsolationApp;
  let a: TestAccount;
  let b: TestAccount;
  let bFilterId = '';

  const listOf = async (account: TestAccount) => {
    const body = (await app.as(account).get('/api/saved-filters').expect(200)).body as {
      items: { _id: string; name: string }[];
      total: number;
    };
    return { names: body.items.map((item) => item.name).sort(), total: body.total };
  };

  beforeAll(async () => {
    // A limit of 2: B's filters must not count towards A's.
    app = await createIsolationApp(db, [SavedFiltersModule], { SAVED_FILTERS_MAX_PER_USER: '2' });
    [a, b] = await app.signUpAll('a', 'b');
    await app
      .as(b)
      .post('/api/saved-filters')
      .send({ name: 'Natal', filters: { state: 'RN' } })
      .expect(201);
    const created = await app
      .as(b)
      .post('/api/saved-filters')
      .send({ name: 'Recife', filters: { state: 'PE' } })
      .expect(201);
    bFilterId = (created.body as { _id: string })._id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('BR-002-02: B’s filters count neither for A’s duplicate names nor for A’s limit', async () => {
    for (const name of ['Natal', 'Recife']) {
      await app
        .as(a)
        .post('/api/saved-filters')
        .send({ name, filters: { state: 'SP' } })
        .expect(201);
    }
    const third = await app
      .as(a)
      .post('/api/saved-filters')
      .send({ name: 'Third', filters: {} })
      .expect(409);
    expect(third.body).toEqual({ code: 'SAVED_FILTER_LIMIT_REACHED', context: { limit: 2 } });
  });

  it('BR-002-02 / TS-16: B’s filters never appear in A’s list or total', async () => {
    expect(await listOf(a)).toEqual({ names: ['Natal', 'Recife'], total: 2 });
    expect(await listOf(b)).toEqual({ names: ['Natal', 'Recife'], total: 2 });
    const aIds = (
      (await app.as(a).get('/api/saved-filters').expect(200)).body as { items: { _id: string }[] }
    ).items.map((item) => item._id);
    expect(aIds).not.toContain(bFilterId);
  });

  it('BR-002-12 / TS-17: A deleting B’s filter answers exactly like a random or malformed id', async () => {
    const foreign = await answerOf(app.as(a).delete(`/api/saved-filters/${bFilterId}`));

    expect(foreign).toEqual(await answerOf(app.as(a).delete(`/api/saved-filters/${RANDOM_ID}`)));
    expect(foreign).toEqual({
      status: 404,
      body: { code: 'SAVED_FILTER_NOT_FOUND', context: {} },
    });
    expect(await answerOf(app.as(a).delete('/api/saved-filters/not-an-id'))).toEqual(foreign);
    expect((await listOf(b)).total).toBe(2);
  });

  it('BR-002-11: an account id in the body, query or a header is refused or ignored', async () => {
    const as = app.as(a);
    for (const planted of [{ userId: b.id }, { ownerId: b.id }]) {
      const refused = await as
        .post('/api/saved-filters')
        .send({ name: 'Planted', filters: {}, ...planted })
        .expect(400);
      expect(refused.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    await as.get(`/api/saved-filters?userId=${b.id}`).expect(400);
    const viaHeader = await as.get('/api/saved-filters').set('X-User-Id', b.id).expect(200);
    expect((viaHeader.body as { total: number }).total).toBe(2);
    expect((await listOf(b)).names).toEqual(['Natal', 'Recife']);
  });
});
