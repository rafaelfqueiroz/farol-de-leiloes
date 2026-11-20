// SPEC-010 BR-010-08..14, BR-002-11, BR-002-12 (TS-15..TS-17): the data-subject rights belong to the
// signed-in account. `dataExports`, `actorPseudonyms` and `jobLocks` are `internal` collections (read
// by the caller's own id, never listed per owner or account), so the isolation gate needs no
// `isolationSpecFor` for them; this proves the owner surface they sit behind with two accounts through
// the real API: A never reads, downloads or deletes B's exports, a request of A naming B acts on A (or
// is refused whole), and A can neither close B's account nor use B's Google proof.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { answerOf, RANDOM_ID } from './support/isolation-app.js';
import {
  createRightsApp,
  nextOrigin,
  oid,
  PASSWORD,
  type RightsApp,
  seedAccount,
  type SeededAccount,
} from '../support/privacy-rights-app.js';
import { useTestDatabase } from '../support/test-database.js';

describe('BR-002-11 / TS-17: the data rights belong to the signed-in account', () => {
  const db = useTestDatabase();
  let app: RightsApp;
  let a: SeededAccount;
  let b: SeededAccount;
  let bExportId = '';

  const status = async (who: SeededAccount) =>
    (await app.collection('users').findOne({ _id: oid(who.id) }))?.['status'];
  const close = (who: SeededAccount, body: Record<string, unknown>, query = '') =>
    app
      .as(who)
      .post(`/api/privacy/delete-account${query}`)
      .set('X-Forwarded-For', nextOrigin())
      .send(body);

  beforeAll(async () => {
    app = await createRightsApp(db);
    a = await seedAccount(app, 'a', 'Conta Aa', '+55 11 98765-4321');
    b = await seedAccount(app, 'b', 'Conta Bb', '+55 21 91234-5678');
    // B has a ready export; A has none.
    const queued = await app.as(b).post('/api/privacy/exports').expect(202);
    bExportId = (queued.body as { id: string }).id;
    await app.exportJob.runBuild();
  });

  afterAll(async () => {
    await app.close();
  });

  it('TS-16: B’s export never appears in A’s list, and A’s own request does not return it', async () => {
    const list = (await app.as(a).get('/api/privacy/exports').expect(200)).body as {
      items: { id: string }[];
      total: number;
    };
    expect(list).toMatchObject({ total: 0, items: [] });

    const mine = (await app.as(a).post('/api/privacy/exports').expect(202)).body as { id: string };
    expect(mine.id).not.toBe(bExportId);
    expect(
      ((await app.as(b).get('/api/privacy/exports').expect(200)).body as { total: number }).total,
    ).toBe(1);
  });

  it('BR-002-12 / TS-17: A downloading B’s export answers exactly like a random id, and no link is issued', async () => {
    const as = app.as(a);

    const foreign = await answerOf(as.get(`/api/privacy/exports/${bExportId}/download`));
    const missing = await answerOf(as.get(`/api/privacy/exports/${RANDOM_ID}/download`));

    expect(foreign).toEqual(missing);
    expect(foreign).toEqual({ status: 404, body: { code: 'NOT_FOUND', context: {} } });
    expect(app.storage.linkRequests).toEqual([]);
    // B can: it is B's.
    await app.as(b).get(`/api/privacy/exports/${bExportId}/download`).expect(200);
  });

  it('TS-17: A cannot delete B’s export: there is no such route, the same 404 as for a random id', async () => {
    const as = app.as(a);

    const foreign = await answerOf(as.delete(`/api/privacy/exports/${bExportId}`));
    const missing = await answerOf(as.delete(`/api/privacy/exports/${RANDOM_ID}`));

    expect(foreign).toEqual(missing);
    expect(foreign.status).toBe(404);
    expect(app.storage.files.size).toBe(1); // B's file is still there
    expect(await app.collection('dataExports').countDocuments({ userId: oid(b.id) })).toBe(1);
  });

  it('BR-002-11: an account id in the body of the closure is refused whole, and closes nothing', async () => {
    const refused = await close(a, { password: PASSWORD, confirm: true, userId: b.id }).expect(400);

    expect(refused.body.code).toBe('VALIDATION_FAILED');
    expect(await status(a)).toBe('active');
    expect(await status(b)).toBe('active');
  });

  it('BR-002-11: A’s Google proof of B’s account is refused and leaves B’s code unspent', async () => {
    const codeOfB = await app.googleCodeFor(b.email, 'google-b-isolation');

    const refused = await close(a, { googleCode: codeOfB, confirm: true }).expect(400);

    expect(refused.body).toEqual({ code: 'INVALID_GOOGLE_CODE', context: {} });
    expect(await status(a)).toBe('active');
    expect(await status(b)).toBe('active');
    // The code is still B's: it spends once, for B's own closure, later in this file.
    expect(await app.authService.exchangeGoogleCode(codeOfB)).toMatchObject({
      status: 'signed_in',
    });
  });

  it('TS-17: a request of A carrying B’s id in the query reads A’s own data', async () => {
    const own = (await app.as(a).get('/api/privacy/my-data').expect(200)).body as {
      account: { id: string };
      generatedAt: string;
    };
    const asB = (await app.as(a).get(`/api/privacy/my-data?userId=${b.id}`).expect(200))
      .body as typeof own;

    expect(asB.account.id).toBe(a.id);
    expect({ ...asB, generatedAt: 0 }).toEqual({ ...own, generatedAt: 0 });
    expect(JSON.stringify(asB)).not.toContain(b.email);
  });

  it('BR-002-11: A closing with B’s id in the query closes A only; B is untouched and still signed in', async () => {
    await close(a, { password: PASSWORD, confirm: true }, `?userId=${b.id}&id=${b.id}`).expect(200);

    expect(await status(a)).toBe('closed');
    expect(await status(b)).toBe('active');
    await app.as(b).get('/api/auth/me').expect(200);
    // B's export is intact; A's closure cancelled only A's own.
    expect(
      await app.collection('dataExports').countDocuments({ userId: oid(b.id), status: 'ready' }),
    ).toBe(1);
    expect(app.hook.calls).toEqual([a.id]);
  });
});
