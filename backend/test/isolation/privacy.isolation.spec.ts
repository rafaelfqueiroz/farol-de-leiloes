// SPEC-010 BR-010-03, BR-010-27, BR-002-11 (TS-15..TS-17): the acceptance and WhatsApp consent
// records are the account's own, through the real API with two accounts. `consents` and
// `whatsappConsents` are `internal` collections (read by the caller's own id, never listed), so the
// gate needs no spec for them; this proves the owner surface they sit behind: A never reads B's
// acceptances, and a request of A carrying B's id acts on A and leaves B untouched.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getConnectionToken, getModelToken } from '@nestjs/mongoose';
import { type Connection, type Model, Types } from 'mongoose';
import { ConsentEntity } from '../../src/privacy/schemas/consent.schema.js';
import { WhatsappConsentEntity } from '../../src/privacy/schemas/whatsapp-consent.schema.js';
import { useTestDatabase } from '../support/test-database.js';
import {
  createIsolationApp,
  type IsolationApp,
  type TestAccount,
} from './support/isolation-app.js';

describe('BR-002-11 / TS-17: acceptances and WhatsApp consent belong to the signed-in account', () => {
  const db = useTestDatabase();
  let app: IsolationApp;
  let a: TestAccount;
  let b: TestAccount;

  const acceptancesOf = async (account: TestAccount, query = '') =>
    (await app.as(account).get(`/api/privacy/acceptances${query}`).expect(200)).body as {
      items: { documentType: string; version: string; method: string }[];
    };
  const whatsappOf = async (account: TestAccount, query = '') =>
    (await app.as(account).get(`/api/privacy/whatsapp-consent${query}`).expect(200)).body as {
      state: string;
    };

  beforeAll(async () => {
    app = await createIsolationApp(db, [], { TERMS_ENFORCEMENT_ENABLED: 'true' });
    // The unique acceptance index (migration 0008 in production) must exist before the first write:
    // autoIndex builds it in the background, so a slow start could otherwise race the accepts.
    await app.harness.moduleRef.get<Connection>(getConnectionToken()).syncIndexes();
    [a, b] = await app.signUpAll('a', 'b');
    // B grants the WhatsApp consent; A has only the sign-up refusal.
    await app
      .as(b)
      .post('/api/privacy/whatsapp-consent')
      .send({ action: 'granted', method: 'privacy_page' })
      .expect(200);
  });

  afterAll(async () => {
    await app.close();
  });

  it('TS-16: each account lists only its own two acceptances', async () => {
    for (const account of [a, b]) {
      const { items } = await acceptancesOf(account);
      expect(items.map((i) => [i.documentType, i.version, i.method]).sort()).toEqual([
        ['privacy', '0.1', 'signup_email'],
        ['terms', '0.1', 'signup_email'],
      ]);
    }
    const models = app.harness.moduleRef.get<Model<unknown>>(getModelToken(ConsentEntity.name));
    expect(await models.collection.countDocuments()).toBe(4); // two accounts, two documents each
  });

  it("TS-17: a request of A carrying B's id in the query reads A's own data", async () => {
    const asB = `?userId=${b.id}`;

    expect(await acceptancesOf(a, asB)).toEqual(await acceptancesOf(a));
    expect((await whatsappOf(a, asB)).state).toBe('declined'); // A's own, not B's `granted`
    expect((await whatsappOf(b)).state).toBe('granted');
  });

  it('TS-17: a body naming B is refused whole and changes nothing of B or of A', async () => {
    const response = await app
      .as(a)
      .post('/api/privacy/whatsapp-consent')
      .send({ action: 'withdrawn', method: 'privacy_page', userId: b.id })
      .expect(400);

    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect((await whatsappOf(b)).state).toBe('granted');
    expect((await whatsappOf(a)).state).toBe('declined');
  });

  it("TS-17: A answering with B's id in the query acts on A only; B's consent is untouched", async () => {
    await app
      .as(a)
      .post(`/api/privacy/whatsapp-consent?userId=${b.id}`)
      .send({ action: 'granted', method: 'privacy_page' })
      .expect(200);

    expect((await whatsappOf(a)).state).toBe('granted');
    const rows = app.harness.moduleRef.get<Model<unknown>>(
      getModelToken(WhatsappConsentEntity.name),
    );
    // B still has exactly its own two rows: the sign-up refusal and its grant.
    expect(await rows.collection.countDocuments({ userId: new Types.ObjectId(b.id) })).toBe(2);
    expect((await whatsappOf(b)).state).toBe('granted');
  });

  it("TS-17: A accepting for B (a body naming B, or B's id in the query) records for A only", async () => {
    await app
      .as(a)
      .post('/api/privacy/accept')
      .send({ termsVersion: '0.1', privacyVersion: '0.1', userId: b.id })
      .expect(400);
    await app
      .as(a)
      .post(`/api/privacy/accept?userId=${b.id}`)
      .send({ termsVersion: '0.1', privacyVersion: '0.1' })
      .expect(200);

    expect((await acceptancesOf(b)).items).toHaveLength(2);
    expect((await acceptancesOf(a)).items).toHaveLength(2);
  });
});
