// SPEC-009 BR-009-09 / SPEC-002 BR-002-02, BR-002-12, BR-002-23 / TS-13..TS-18: support requests are
// the account's own data. Two accounts through the real API: B's requests never reach A's list, count
// or detail; A reading or withdrawing the permission of B's request answers exactly like a random id
// and leaves B's untouched; an account id planted in the request is refused (BR-002-11). An advisor of
// an office B is a client of sees none (DL-002-08), and an admin with no grant sees none through the
// requester routes (BR-002-23): the admin's way to a request is the grant, never these routes.
import { afterAll, beforeAll, expect, it } from 'vitest';
import { SupportModule } from '../../src/support/support.module.js';
import { useTestDatabase } from '../support/test-database.js';
import {
  answerOf,
  createIsolationApp,
  type IsolationApp,
  RANDOM_ID,
  type TestAccount,
} from './support/isolation-app.js';
import { isolationSpecFor } from './support/isolation-spec.js';

const OFFICE_A = '64b7f00000000000000a0a0a';

interface Created {
  id: string;
  protocol: string;
}

interface Page {
  items: Array<{ id: string; subject: string }>;
  total: number;
}

isolationSpecFor('SupportRequestEntity', () => {
  const db = useTestDatabase();
  let app: IsolationApp;
  let a: TestAccount;
  let b: TestAccount;
  let advisorOfB: TestAccount;
  let admin: TestAccount;
  let aRequest = '';
  let bRequest = '';

  const open = async (account: TestAccount, subject: string, allowDataAccess = false) =>
    (
      await app
        .as(account)
        .post('/api/support')
        .send({ subject, message: 'Mensagem ficticia de teste', allowDataAccess })
        .expect(201)
    ).body as Created;
  const pageOf = async (account: TestAccount, query = '') =>
    (await app.as(account).get(`/api/support/mine${query}`).expect(200)).body as Page;

  beforeAll(async () => {
    app = await createIsolationApp(db, [SupportModule]);
    [a, b, advisorOfB, admin] = await app.signUpAll('a', 'b', 'advisor', 'admin');
    await app.makeAdmin(admin);
    // B is a client of office A, whose member is advisorOfB.
    app.sources
      .forAccount(b.id, { clientLinks: [{ officeId: OFFICE_A, status: 'active' }] })
      .forAccount(advisorOfB.id, { memberships: [{ officeId: OFFICE_A }] });
    app.sources.plans = {
      [OFFICE_A]: { advisorPlanActive: true, readOnly: false, entitlements: [] },
    };
    aRequest = (await open(a, 'Assunto de A', true)).id;
    await open(a, 'Segundo assunto de A');
    bRequest = (await open(b, 'Assunto de B', true)).id;
  });

  afterAll(async () => {
    await app.close();
  });

  it('BR-009-09 / TS-16: B’s requests never appear in A’s list, count or page', async () => {
    const mine = await pageOf(a);
    expect(mine.total).toBe(2);
    expect(mine.items.map((item) => item.subject).sort()).toEqual([
      'Assunto de A',
      'Segundo assunto de A',
    ]);
    expect((await pageOf(a, '?page=1&pageSize=1')).total).toBe(2);
    expect((await pageOf(b)).items.map((item) => item.subject)).toEqual(['Assunto de B']);
    expect((await pageOf(a, '?page=2&pageSize=2')).items).toEqual([]);
  });

  it('BR-002-12 / TS-17: A reading B’s request answers like a random id, and a malformed one alike', async () => {
    const as = app.as(a);
    const random = await answerOf(as.get(`/api/support/mine/${RANDOM_ID}`));

    expect(await answerOf(as.get(`/api/support/mine/${bRequest}`))).toEqual(random);
    expect(await answerOf(as.get('/api/support/mine/nao-e-um-id'))).toEqual(random);
    expect(random).toEqual({ status: 404, body: { code: 'NOT_FOUND', context: {} } });
  });

  it('BR-002-12 / TS-17: A withdrawing B’s permission answers like a random id and leaves B’s as it was', async () => {
    const as = app.as(a);
    const random = await answerOf(as.post(`/api/support/mine/${RANDOM_ID}/withdraw-data-access`));

    expect(await answerOf(as.post(`/api/support/mine/${bRequest}/withdraw-data-access`))).toEqual(
      random,
    );

    const detail = (await app.as(b).get(`/api/support/mine/${bRequest}`).expect(200)).body as {
      dataAccess: string;
    };
    expect(detail.dataAccess).toBe('allowed');
  });

  it('BR-002-02: A withdrawing its own permission changes A’s request only', async () => {
    await app.as(a).post(`/api/support/mine/${aRequest}/withdraw-data-access`).expect(200);

    const own = (await app.as(a).get(`/api/support/mine/${aRequest}`).expect(200)).body as {
      dataAccess: string;
    };
    const theirs = (await app.as(b).get(`/api/support/mine/${bRequest}`).expect(200)).body as {
      dataAccess: string;
    };
    expect([own.dataAccess, theirs.dataAccess]).toEqual(['withdrawn', 'allowed']);
  });

  it('DL-002-08: an advisor of the office B is a client of sees none of B’s requests', async () => {
    expect((await pageOf(advisorOfB)).total).toBe(0);
    expect(await answerOf(app.as(advisorOfB).get(`/api/support/mine/${bRequest}`))).toEqual(
      await answerOf(app.as(advisorOfB).get(`/api/support/mine/${RANDOM_ID}`)),
    );
  });

  it('BR-002-23: an admin with no grant sees none through the requester routes, and cannot act on one', async () => {
    expect((await pageOf(admin)).total).toBe(0);
    const as = app.as(admin);
    const random = await answerOf(as.get(`/api/support/mine/${RANDOM_ID}`));

    expect(await answerOf(as.get(`/api/support/mine/${aRequest}`))).toEqual(random);
    expect(await answerOf(as.post(`/api/support/mine/${aRequest}/withdraw-data-access`))).toEqual(
      await answerOf(as.post(`/api/support/mine/${RANDOM_ID}/withdraw-data-access`)),
    );
  });

  it('BR-002-11: an account id in the body, query or a header is refused or ignored', async () => {
    const as = app.as(a);
    for (const planted of [{ userId: b.id }, { ownerId: b.id }, { requesterUserId: b.id }]) {
      const refused = await as
        .post('/api/support')
        .send({ subject: 'Assunto valido', message: 'Mensagem valida de teste', ...planted })
        .expect(400);
      expect(refused.body).toMatchObject({ code: 'VALIDATION_FAILED' });
    }
    await as.get(`/api/support/mine?userId=${b.id}`).expect(400);
    const viaHeader = await as.get('/api/support/mine').set('X-User-Id', b.id).expect(200);
    expect((viaHeader.body as Page).items.map((item) => item.subject).sort()).toEqual([
      'Assunto de A',
      'Segundo assunto de A',
    ]);
    expect((await pageOf(b)).total).toBe(1);
  });
});
