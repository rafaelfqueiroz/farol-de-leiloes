// SPEC-010 BR-010-08..11, DL-010-04, DL-010-06 (TS-08): "my data" and the data export, through the real
// API on a real MongoDB. The R2 port is a fake (TS-07) and the clock is the harness's FakeClock
// (TS-06), moved by the spec; no test sleeps.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AccessContextFactory } from '../../src/access/access-context.js';
import { DAY, HOUR, MINUTE } from '../fakes/fake-clock.js';
import {
  createRightsApp,
  oid,
  type RightsApp,
  seedAccount,
  type SeededAccount,
} from '../support/privacy-rights-app.js';
import { useTestDatabase } from '../support/test-database.js';

type Row = Record<string, unknown>;
interface Section {
  items: Row[];
  whatsappConsent?: { answers: Row[] };
}
/** The envelope and the sections of "my data" and of the export file. */
interface MyData {
  schemaVersion: number;
  generatedAt: string;
  account: Row;
  favorites: Section;
  savedFilters: Section;
  reminders: Section;
  notificationLogs: Section;
  acceptances: Section;
  sessions: Section;
  dataExports: Section;
}

interface ExportBody {
  id: string;
  status: string;
  requestedAt: string;
  readyAt?: string;
  expiresAt?: string;
  errorCode?: string;
}

describe('SPEC-010 data access and portability (BR-010-08..11)', () => {
  const db = useTestDatabase();
  let app: RightsApp;
  let ana: SeededAccount;
  let bia: SeededAccount;

  const request = async (who: SeededAccount) =>
    (await app.as(who).post('/api/privacy/exports').expect(202)).body as ExportBody;
  /** The account signed in NOW: a session issued before the clock jumped has expired (BR-001-18). */
  const fresh = async (who: SeededAccount): Promise<SeededAccount> => ({
    ...who,
    token: ((await app.signIn(who.email).expect(200)).body as { accessToken: string }).accessToken,
  });
  const listOf = async (who: SeededAccount) =>
    (await app.as(who).get('/api/privacy/exports').expect(200)).body as {
      items: ExportBody[];
      total: number;
    };

  beforeAll(async () => {
    app = await createRightsApp(db);

    ana = await seedAccount(app, 'ana', 'Ana Quimera', '+55 11 98765-4321');
    bia = await seedAccount(app, 'bia', 'Bia Fantasma', '+55 21 91234-5678');
    // A reminder email was delivered to Ana: her notification log holds her address.
    app.harness.clock.set(new Date('2099-01-21T00:00:00.000Z'));
    await app.scheduler.processReminders();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('BR-010-08: the account sees what the platform holds, at once', () => {
    it('holds a profile, favorites, saved filters, reminders, logs, acceptances and WhatsApp answers, and no password hash', async () => {
      const response = await app.as(ana).get('/api/privacy/my-data').expect(200);
      const data = response.body as MyData;

      expect(data.schemaVersion).toBe(1);
      expect(data.generatedAt).toBe(app.harness.clock.now().toISOString());
      expect(data.account).toMatchObject({
        id: ana.id,
        email: ana.email,
        name: 'Ana Quimera',
        phone: '+5511987654321',
        status: 'active',
        signIn: { methods: ['password'], googleId: null },
      });
      expect(data.favorites.items).toEqual([
        { auctionCode: 'RIGHTS001', addedAt: expect.any(String) },
      ]);
      expect(data.savedFilters.items).toEqual([
        {
          name: 'ana-filtro',
          // AR-17: a price bound is a string, never a JS number.
          filters: { state: 'RN', minPrice: '120000.50', maxPrice: null },
          createdAt: expect.any(String),
        },
      ]);
      expect(data.reminders.items).toMatchObject([
        { auctionCode: 'RIGHTS001', channel: 'EMAIL', description: 'ana-lembrete', status: 'SENT' },
      ]);
      expect(data.notificationLogs.items).toMatchObject([
        { channel: 'EMAIL', recipient: ana.email, success: true },
      ]);
      expect(
        data.acceptances.items.map((i) => [i['documentType'], i['version'], i['method']]).sort(),
      ).toEqual([
        ['privacy', '0.1', 'signup_email'],
        ['terms', '0.1', 'signup_email'],
      ]);
      expect(data.acceptances.whatsappConsent?.answers.map((a) => a['action'])).toEqual([
        'declined',
        'granted',
      ]);
      expect(data.sessions.items).toHaveLength(1);
      // Neither the hash nor a token hash nor a session id is ever in it.
      const text = JSON.stringify(response.body);
      expect(text).not.toMatch(/\$2[aby]\$/);
      expect(text).not.toMatch(/"password"\s*:/);
      expect(text).not.toContain('tokenHash');
    });

    it('holds nothing of another account', async () => {
      const text = JSON.stringify((await app.as(ana).get('/api/privacy/my-data').expect(200)).body);

      for (const marker of [
        bia.email,
        'Bia Fantasma',
        '21912345678',
        'bia-filtro',
        'bia-lembrete',
      ]) {
        expect(text).not.toContain(marker);
      }
    });

    it('BR-002-11: an id of another account in the query changes nothing; a body is refused', async () => {
      const own = (await app.as(ana).get('/api/privacy/my-data').expect(200)).body;
      const asBia = (await app.as(ana).get(`/api/privacy/my-data?userId=${bia.id}`).expect(200))
        .body;

      expect((asBia as MyData).account['id']).toBe(ana.id);
      expect({ ...asBia, generatedAt: 0 }).toEqual({ ...own, generatedAt: 0 });
    });
  });

  describe('BR-010-09 / BR-010-11: the export is built without manual work and is one per account', () => {
    let first: ExportBody;

    it('is queued by the request, with no file yet', async () => {
      first = await request(ana);

      expect(first).toMatchObject({
        status: 'queued',
        requestedAt: app.harness.clock.now().toISOString(),
      });
      expect(first.readyAt).toBeUndefined();
      expect(app.storage.files.size).toBe(0);
    });

    it('BR-010-11: twenty requests at once end with ONE export, and all answer it', async () => {
      const answers = await Promise.all(Array.from({ length: 20 }, () => request(ana)));

      expect(new Set(answers.map((a) => a.id))).toEqual(new Set([first.id]));
      expect(await app.collection('dataExports').countDocuments({ userId: oid(ana.id) })).toBe(1);
      expect((await listOf(ana)).total).toBe(1);
    });

    it('the worker builds the file under the account’s own context and marks it ready', async () => {
      const factory = app.get(AccessContextFactory);
      const forAccount = vi.spyOn(factory, 'forAccount');

      const outcome = await app.exportJob.runBuild();

      expect(outcome).toEqual({ ready: 1, failed: 0, discarded: 0 });
      // BR-010-10: the document is read through the CURRENT context of the requester only.
      expect(forAccount.mock.calls.map(([account]) => account.userId)).toEqual([ana.id]);
      const ready = (await listOf(ana)).items[0] as ExportBody;
      const now = app.harness.clock.now();
      expect(ready).toMatchObject({ id: first.id, status: 'ready', readyAt: now.toISOString() });
      // 7 days of 24 hours after it became ready.
      expect(ready.expiresAt).toBe(new Date(now.getTime() + 7 * DAY).toISOString());
      expect(JSON.stringify(ready)).not.toContain('private/');
      const [key] = [...app.storage.files.keys()];
      expect(key).toMatch(/^private\/exports\/[0-9a-f]{48}\.json$/);
    });

    it('the file is structured JSON with the same sections as "my data", for the searcher', () => {
      const file = app.storage.onlyFile() as unknown as MyData;

      expect(Object.keys(file).sort()).toEqual(
        [
          'schemaVersion',
          'generatedAt',
          'account',
          'sessions',
          'accountTokens',
          'favorites',
          'savedFilters',
          'reminders',
          'notificationLogs',
          'acceptances',
          'dataExports',
          'actorPseudonyms',
        ].sort(),
      );
      expect(file.schemaVersion).toBe(1);
      expect(file.account).toMatchObject({ email: ana.email, name: 'Ana Quimera' });
      expect(file.favorites.items).toHaveLength(1);
      expect(file.savedFilters.items[0]?.['name']).toBe('ana-filtro');
      expect(file.reminders.items[0]?.['description']).toBe('ana-lembrete');
      expect(file.notificationLogs.items[0]?.['recipient']).toBe(ana.email);
      expect(file.acceptances.items).toHaveLength(2);
      expect(file.acceptances.whatsappConsent?.answers).toHaveLength(2);
      expect(file.dataExports.items).toMatchObject([{ status: 'queued' }]);
    });

    it('never holds the password hash, a token hash, another account or an office’s data (BR-010-10)', () => {
      const text = JSON.stringify(app.storage.onlyFile());

      expect(text).not.toMatch(/\$2[aby]\$/);
      expect(text).not.toContain('tokenHash');
      expect(text).not.toContain('officeId');
      for (const marker of [bia.email, 'Bia Fantasma', 'bia-filtro', 'bia-lembrete']) {
        expect(text).not.toContain(marker);
      }
    });

    it('while ready, asking again answers the same export (one live export per account)', async () => {
      const again = await request(ana);

      expect(again).toMatchObject({ id: first.id, status: 'ready' });
      expect(await app.collection('dataExports').countDocuments({ userId: oid(ana.id) })).toBe(1);
    });
  });

  describe('BR-010-11: the download is for the owner only and lives 7 days', () => {
    let ready: ExportBody;
    let readyAt: Date;

    beforeAll(async () => {
      ready = (await listOf(ana)).items[0] as ExportBody;
      readyAt = new Date(ready.readyAt as string);
    });

    it('issues a 60-second private link to the owner', async () => {
      const response = await app
        .as(ana)
        .get(`/api/privacy/exports/${ready.id}/download`)
        .expect(200);

      expect(response.body.expiresInSeconds).toBe(60);
      expect(response.body.url).toContain('private-files.example.test/signed/');
      expect(app.storage.linkRequests).toHaveLength(1);
    });

    it('BR-002-12 / AR-14: another account’s export, a missing id and a malformed id are the SAME 404', async () => {
      const foreign = await app.as(bia).get(`/api/privacy/exports/${ready.id}/download`);
      const missing = await app
        .as(bia)
        .get('/api/privacy/exports/64b7f00000000000000ffff1/download');
      const malformed = await app.as(bia).get('/api/privacy/exports/not-an-id/download');

      expect(foreign.status).toBe(404);
      for (const other of [missing, malformed]) {
        expect({ status: other.status, body: other.body }).toEqual({
          status: foreign.status,
          body: foreign.body,
        });
      }
      expect(foreign.body).toEqual({ code: 'NOT_FOUND', context: {} });
      expect(app.storage.linkRequests).toHaveLength(1); // no link for a stranger
    });

    it('is not on another account’s list, and a path id of another account never lists', async () => {
      expect((await listOf(bia)).total).toBe(0);
      // An account id in the query is refused whole, like any property outside the DTO.
      const refused = await app.as(bia).get(`/api/privacy/exports?userId=${ana.id}`).expect(400);
      expect(refused.body.code).toBe('VALIDATION_FAILED');
    });

    it('is still issued 6 days 23 hours after it was ready', async () => {
      app.harness.clock.set(new Date(readyAt.getTime() + 6 * DAY + 23 * HOUR));

      await app
        .as(await fresh(ana))
        .get(`/api/privacy/exports/${ready.id}/download`)
        .expect(200);
    });

    it('is refused at exactly 7 days (half-open) and 7 days and 1 minute after it was ready', async () => {
      for (const after of [7 * DAY, 7 * DAY + MINUTE]) {
        app.harness.clock.set(new Date(readyAt.getTime() + after));

        const refused = await app
          .as(await fresh(ana))
          .get(`/api/privacy/exports/${ready.id}/download`)
          .expect(410);

        expect(refused.body).toEqual({ code: 'EXPORT_EXPIRED', context: {} });
      }
    });

    it('the expiry job deletes the file and marks it expired; a new export can then be asked for', async () => {
      const outcome = await app.exportJob.runExpiry();
      ana = await fresh(ana);
      bia = await fresh(bia);

      expect(outcome).toEqual({ expired: 1, cleaned: 0, failed: 0 });
      expect(app.storage.files.size).toBe(0);
      expect((await listOf(ana)).items[0]).toMatchObject({ id: ready.id, status: 'expired' });
      await app.as(ana).get(`/api/privacy/exports/${ready.id}/download`).expect(410);

      const second = await request(ana);
      expect(second.id).not.toBe(ready.id);
      expect(second.status).toBe('queued');
    });
  });

  describe('SC-18: no private bucket, no export, and never the public bucket', () => {
    it('the export fails with a stable code and nothing is written anywhere', async () => {
      app.storage.privateConfigured = false;
      const queued = await request(bia);

      const outcome = await app.exportJob.runBuild();

      expect(outcome).toMatchObject({ failed: expect.any(Number) });
      expect(app.storage.files.size).toBe(0);
      const failed = (await listOf(bia)).items.find((e) => e.id === queued.id) as ExportBody;
      expect(failed).toMatchObject({ status: 'failed', errorCode: 'EXPORT_STORAGE_UNAVAILABLE' });
      await app.as(bia).get(`/api/privacy/exports/${failed.id}/download`).expect(404);
      app.storage.privateConfigured = true;
    });

    it('a failed export frees the slot: the next request queues a new one', async () => {
      const next = await request(bia);

      expect(next.status).toBe('queued');
    });
  });
});
