// SPEC-010 BR-010-15, BR-010-28, AR-31 (TS-08): the purge of closed accounts, through the real API and
// the real job on a real MongoDB. What it proves, in the owner's order of concern: after the purge a
// scan of EVERY collection for the account's name, email and phone finds nothing; the retained
// collections are untouched; the address is free again; and the races and crashes converge:
// (d) two purge workers (the run-level lock and the per-account claim), (e) a crash or fault at each
// step, (f) a sign-in of the same account during the purge, (h) a sign-up with its address before and
// after. Time is the harness's FakeClock (TS-06), the R2 port a fake (TS-07).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PersonalDataRegistry } from '../../src/privacy/registry/personal-data-registry.js';
import { ACCOUNT_PURGE_LOCK } from '../../src/privacy/rights/account-purge.job.js';
import { ActorPseudonymService } from '../../src/privacy/rights/actor-pseudonym.service.js';
import { JobLockService } from '../../src/privacy/rights/job-lock.service.js';
import { JobExecutionService } from '../../src/common/services/job-execution.service.js';
import { UsersService } from '../../src/users/users.service.js';
import { DAY, MINUTE } from '../fakes/fake-clock.js';
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

/** The collections the purge keeps on purpose (RETAINED_MODELS), by collection name. */
const RETAINED = [
  'subscriptions',
  'adminAccessLogs',
  'supportAccessGrants',
  'consents',
  'whatsappConsents',
  'maintenancewindows',
];

interface StoredUser {
  _id?: unknown;
  email?: string;
  status?: string;
  closedAt?: Date;
  purgedAt?: Date;
  purgeClaimToken?: string;
  purgeClaimUntil?: Date;
  name?: unknown;
  phone?: unknown;
  password?: unknown;
  googleId?: unknown;
  providers?: unknown;
}

describe('SPEC-010 purging closed accounts (BR-010-15)', () => {
  const db = useTestDatabase();
  let app: RightsApp;
  let counter = 0;

  const label = () => `pg${(counter += 1)}`;
  const origins = new Map<string, string>();
  const closeAccount = async (who: SeededAccount) => {
    const origin = origins.get(who.id) ?? nextOrigin();
    origins.set(who.id, origin);
    await app
      .as(who)
      .post('/api/privacy/delete-account')
      .set('X-Forwarded-For', origin)
      .send({ password: PASSWORD, confirm: true })
      .expect(200);
  };
  /** A seeded account (every kind of data) that is already closed, and not purged yet. */
  const closed = async (name: string) => {
    const who = await seedAccount(app, label(), name, '+55 11 98765-4321');
    await closeAccount(who);
    return who;
  };
  const stored = async (who: { id: string }) =>
    ((await app.collection('users').findOne({ _id: oid(who.id) })) ?? {}) as StoredUser;
  const markersOf = (who: SeededAccount) => [who.name, who.email, who.phone, '11987654321'];

  beforeAll(async () => {
    app = await createRightsApp(db);
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Purges whatever is still closed and unpurged, so a test starts with no other candidate. */
  const drain = async () => {
    app.harness.clock.advance(11 * MINUTE); // any claim a dead worker left is over
    await app.purgeJob.run();
    app.harness.clock.advance(MINUTE); // a later run is a later instant (the job log orders by it)
  };

  describe('AC: thirty days after closure a database search finds nothing', () => {
    let ana: SeededAccount;
    let bia: SeededAccount;
    let biaBefore: StoredUser;
    let before: Record<string, number>;
    const journeyId = '64b7f000000000000000aa01';

    beforeAll(async () => {
      ana = await seedAccount(app, 'ana', 'Ana Quimera Unica', '+55 11 98765-4321');
      bia = await seedAccount(app, 'bia', 'Bia Fantasma Unica', '+55 21 91234-5678');
      // A failed sign-in leaves a counter keyed by the address; a ready export leaves a file.
      await app.as(ana).post('/api/privacy/exports').expect(202);
      await app.exportJob.runBuild();
      // A pseudonym of ana in a journey, as SPEC-011/016 will create.
      await app.get(ActorPseudonymService).forPerson(journeyId, ana.id);
      // Records the purge must keep: a billing record naming her id, an admin access log row.
      await app.collection('subscriptions').insertOne({ buyerUserId: oid(ana.id), planCode: 'p' });
      await app.collection('adminAccessLogs').insertOne({ adminUserId: oid(ana.id), action: 'x' });
      // A reminder email went to her: her notification log holds her address (and bia's, hers).
      const start = app.harness.clock.now();
      app.harness.clock.advance(2 * DAY);
      await app.scheduler.processReminders();
      app.harness.clock.set(start);
      biaBefore = await stored(bia);
      app.hook.calls.length = 0;
      await closeAccount(ana);
      // A sign-in attempt of the closed account leaves a counter keyed by its address.
      await app.signIn(ana.email, 'wrong password').expect(401);
      before = {
        consents: await app.collection('consents').countDocuments({ userId: oid(ana.id) }),
        whatsapp: await app.collection('whatsappConsents').countDocuments({ userId: oid(ana.id) }),
      };
    });

    it('sanity: before the purge the scan DOES find her name, email and phone (the scan is not vacuous)', async () => {
      const hits = await app.scan(markersOf(ana));

      const where = new Set(hits.map((hit) => hit.collection));
      for (const expected of ['users', 'notificationlogs', 'accountTokens', 'loginAttempts']) {
        expect(where, expected).toContain(expected);
      }
      expect(app.storage.files.size).toBe(1);
    });

    it('BR-010-17: until the purge the address cannot be used by a new sign-up (EMAIL_ALREADY_REGISTERED)', async () => {
      const refused = await app.authService
        .register({ email: ana.email, name: 'Impostor', password: PASSWORD, acceptTerms: true })
        .catch((error: unknown) => error);

      expect(refused).toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
    });

    it('purges her once: the job answers the counts and records a successful run', async () => {
      app.harness.clock.advance(30 * DAY);

      const outcome = await app.purgeJob.run();

      expect(outcome).toEqual({ purged: 1, skipped: 0, failed: 0, overdue: 0 });
      const last = await app.get(JobExecutionService).getLastOutcome('account-purge');
      expect(last).toMatchObject({ status: 'SUCCESS', runMode: 'AUTO' });
    });

    it('a scan of EVERY collection for her name, email and phone finds nothing', async () => {
      expect(await app.scan(markersOf(ana))).toEqual([]);
    });

    it('her id is gone from every collection but the retained ones and the tombstone itself', async () => {
      const hits = await app.scan([ana.id], { skip: [...RETAINED, 'users', 'jobexecutions'] });

      expect(hits).toEqual([]);
    });

    it('the tombstone keeps _id, status, closedAt and purgedAt and nothing that names her', async () => {
      const tomb = await stored(ana);

      expect(Object.keys(tomb).sort()).toEqual(
        [
          '_id',
          '__v',
          'email',
          'status',
          'closedAt',
          'purgedAt',
          'createdAt',
          'updatedAt',
          'credentialVersion',
          'role',
          'whatsappPromptAnsweredAt',
        ].sort(),
      );
      expect(tomb).toMatchObject({
        email: `purged-${ana.id}@removed.invalid`,
        status: 'closed',
        purgedAt: app.harness.clock.now(),
      });
      for (const field of [
        'name',
        'phone',
        'googleId',
        'password',
        'providers',
        'purgeClaimToken',
      ]) {
        expect(tomb, field).not.toHaveProperty(field);
      }
    });

    it('the retained collections are untouched: acceptances, WhatsApp answers, billing, the admin log', async () => {
      expect(await app.collection('consents').countDocuments({ userId: oid(ana.id) })).toBe(
        before['consents'],
      );
      expect(await app.collection('whatsappConsents').countDocuments({ userId: oid(ana.id) })).toBe(
        before['whatsapp'],
      );
      expect(
        await app.collection('subscriptions').countDocuments({ buyerUserId: oid(ana.id) }),
      ).toBe(1);
      expect(
        await app.collection('adminAccessLogs').countDocuments({ adminUserId: oid(ana.id) }),
      ).toBe(1);
    });

    it('her exports and their files are gone, and her pseudonym stays in the journey with no link to her', async () => {
      expect(app.storage.files.size).toBe(0);
      expect(await app.collection('dataExports').countDocuments({ userId: oid(ana.id) })).toBe(0);
      const labels = await app
        .collection('actorPseudonyms')
        .find({ journeyId: oid(journeyId) })
        .toArray();
      expect(labels).toHaveLength(1);
      expect(labels[0]).toMatchObject({
        userId: null,
        pseudonym: expect.stringMatching(/^p-[0-9a-f]{32}$/),
      });
    });

    it('another account is untouched', async () => {
      // (Her session expired with the 30 days that passed: a new sign-in proves she still can.)
      expect(await stored(bia)).toEqual(biaBefore);
      expect(await app.collection('favorites').countDocuments({ userId: oid(bia.id) })).toBe(1);
      expect(await app.collection('savedfilters').countDocuments({ userId: oid(bia.id) })).toBe(1);
      expect(await app.collection('reminders').countDocuments({ userId: oid(bia.id) })).toBe(1);
      expect((await app.signIn(bia.email)).status).toBe(200);
    });

    it('AC: a new account can then be created with the same email', async () => {
      const created = await app.authService.register({
        email: ana.email,
        name: 'Nova Pessoa',
        password: PASSWORD,
        acceptTerms: true,
      });

      expect(created.user._id).not.toBe(ana.id);
      expect(created.user.email).toBe(ana.email);
      expect((await stored(ana)).email).toBe(`purged-${ana.id}@removed.invalid`);
    });

    it('is idempotent: running it again purges nothing', async () => {
      expect(await app.purgeJob.run()).toEqual({ purged: 0, skipped: 0, failed: 0, overdue: 0 });
    });
  });

  describe('(d) two purge workers', () => {
    beforeEach(drain);

    it('the run-level lock: a second run while one holds it does not run, and purges nothing', async () => {
      const who = await closed('Lock Teste');
      const locks = app.get(JobLockService);

      const inside = await locks.runLocked(ACCOUNT_PURGE_LOCK, 60_000, () => app.purgeJob.run());

      expect(inside).toEqual({ ran: true, result: null });
      expect((await stored(who)).purgedAt).toBeUndefined();
      // The lock is released afterwards: the next run purges.
      expect(await app.purgeJob.run()).toMatchObject({ purged: 1 });
    });

    it('the per-account claim: two workers on the same accounts purge each account once', async () => {
      const [x, y] = [await closed('Claim X'), await closed('Claim Y')];
      const favorites = app
        .get(PersonalDataRegistry)
        .providers()
        .find((p) => p.name === 'favorites');
      const purge = vi.spyOn(favorites as NonNullable<typeof favorites>, 'purge');

      const results = await Promise.all([
        app.purgeJob.purgeAccount(x.id),
        app.purgeJob.purgeAccount(x.id),
        app.purgeJob.purgeAccount(y.id),
        app.purgeJob.purgeAccount(y.id),
      ]);

      expect(results.filter((r) => r === 'purged')).toHaveLength(2);
      expect(results.filter((r) => r === 'skipped')).toHaveLength(2);
      // The providers ran once per account, not twice.
      expect(purge.mock.calls.map(([id]) => id).sort()).toEqual([x.id, y.id].sort());
      expect((await stored(x)).purgedAt).toBeDefined();
      expect((await stored(y)).purgedAt).toBeDefined();
      purge.mockRestore();
    });

    it('two whole runs at once purge every account exactly once between them', async () => {
      const accounts = [await closed('Run A'), await closed('Run B'), await closed('Run C')];

      const outcomes = await Promise.all([app.purgeJob.run(), app.purgeJob.run()]);

      const purged = outcomes.reduce((sum, outcome) => sum + (outcome?.purged ?? 0), 0);
      expect(purged).toBe(3);
      for (const who of accounts) {
        expect((await stored(who)).purgedAt).toBeDefined();
        expect(await app.scan(markersOf(who))).toEqual([]);
      }
    });
  });

  describe('(e) a crash or a fault at any step is repaired by the next run', () => {
    /** The registry's providers, in the order the purge runs them. */
    const providers = () => app.get(PersonalDataRegistry).providers();
    beforeEach(drain);

    it('knows the steps it injects a fault into (the providers of this app)', () => {
      expect(
        providers()
          .map((p) => p.name)
          .sort(),
      ).toEqual(
        [
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
    });

    it('a provider failing at each step leaves the account closed and unpurged with its claim released, then converges', async () => {
      for (const name of providers().map((p) => p.name)) {
        const who = await closed(`Falha em ${name}`);
        const provider = providers().find((p) => p.name === name) as NonNullable<
          ReturnType<typeof providers>[number]
        >;
        const fault = vi
          .spyOn(provider, 'purge')
          .mockRejectedValueOnce(new Error(`${name} is down`));

        app.harness.clock.advance(MINUTE); // the job log orders runs by their instant
        const failedRun = await app.purgeJob.run();

        expect(failedRun, name).toMatchObject({ purged: 0, failed: 1 });
        const midway = await stored(who);
        expect(midway.purgedAt, name).toBeUndefined();
        expect(midway.email, name).toBe(who.email); // not tombstoned: nothing half erased is marked purged
        expect(midway.purgeClaimToken, name).toBeUndefined(); // the claim was given back
        expect(
          await app.get(JobExecutionService).getLastOutcome('account-purge'),
          name,
        ).toMatchObject({ status: 'FAILED', errorCode: 'PARTIAL_FAILURE' });
        fault.mockRestore();

        app.harness.clock.advance(MINUTE);
        const repairingRun = await app.purgeJob.run();

        expect(repairingRun, name).toMatchObject({ purged: 1, failed: 0 });
        expect((await stored(who)).purgedAt, name).toBeDefined();
        expect(await app.scan(markersOf(who)), name).toEqual([]);
      }
    });

    it('a failure of the tombstone write (every provider already ran) is repaired the same way', async () => {
      const who = await closed('Falha no tombstone');
      const users = app.get(UsersService);
      const fault = vi.spyOn(users, 'completePurge').mockRejectedValueOnce(new Error('db hiccup'));

      expect(await app.purgeJob.run()).toMatchObject({ purged: 0, failed: 1 });
      expect((await stored(who)).purgedAt).toBeUndefined();
      fault.mockRestore();

      expect(await app.purgeJob.run()).toMatchObject({ purged: 1, failed: 0 });
      expect(await app.scan(markersOf(who))).toEqual([]);
    });

    it('a worker that dies holding the claim: its lease blocks others for 10 minutes, then the account is purged', async () => {
      const who = await closed('Worker morto');
      const users = app.get(UsersService);
      const registry = app.get(PersonalDataRegistry);
      // The crash: a provider fails and the claim is NOT given back (the process died).
      const release = vi.spyOn(users, 'releasePurgeClaim').mockResolvedValue(undefined);
      const fault = vi.spyOn(registry, 'purge').mockRejectedValueOnce(new Error('killed'));
      await app.purgeJob.run();
      release.mockRestore();
      fault.mockRestore();
      expect((await stored(who)).purgeClaimToken).toBeDefined();

      app.harness.clock.advance(9 * MINUTE);
      expect(await app.purgeJob.run()).toMatchObject({ purged: 0, skipped: 0 }); // not even a candidate
      expect((await stored(who)).purgedAt).toBeUndefined();

      app.harness.clock.advance(2 * MINUTE); // the lease (10 minutes) is over
      expect(await app.purgeJob.run()).toMatchObject({ purged: 1 });
      expect(await app.scan(markersOf(who))).toEqual([]);
    });

    it('a storage that cannot delete the export file fails the purge, keeps the row, and the next run finishes', async () => {
      const who = await seedAccount(app, label(), 'Arquivo preso', '+55 11 98765-4321');
      await app.as(who).post('/api/privacy/exports').expect(202);
      await app.exportJob.runBuild();
      await closeAccount(who);
      app.storage.failDeletes = true;

      expect(await app.purgeJob.run()).toMatchObject({ purged: 0, failed: 1 });
      expect(app.storage.files.size).toBe(1);
      expect(await app.collection('dataExports').countDocuments({ userId: oid(who.id) })).toBe(1);
      app.storage.failDeletes = false;

      expect(await app.purgeJob.run()).toMatchObject({ purged: 1, failed: 0 });
      expect(app.storage.files.size).toBe(0);
    });

    it('repeats the closure effects the closure itself missed (a hook that failed then is run at purge)', async () => {
      app.hook.failWith = new Error('hook down');
      const who = await closed('Hook falhou');
      app.hook.failWith = undefined;
      app.hook.calls.length = 0;

      await app.purgeJob.run();

      expect(app.hook.calls).toEqual([who.id]);
    });
  });

  describe('(f) a sign-in of the same account while it is purged', () => {
    it('is refused by every attempt, and no session survives the purge', async () => {
      const who = await closed('Sessao fantasma');

      const [purged, ...logins] = await Promise.all([
        app.purgeJob.purgeAccount(who.id),
        ...Array.from({ length: 5 }, () => app.signIn(who.email)),
      ]);

      expect(purged).toBe('purged');
      for (const login of logins) expect(login.status).toBe(401);
      expect(await app.collection('sessions').countDocuments({ userId: oid(who.id) })).toBe(0);
      // After the tombstone the old address is nobody's: still refused.
      expect((await app.signIn(who.email)).status).toBe(401);
      expect((await stored(who)).status).toBe('closed');
    });
  });

  describe('(h) a sign-up with the address of a closed account', () => {
    it('is refused while the account is closed and succeeds right after the purge', async () => {
      const who = await closed('Endereco preso');
      const register = () =>
        app.authService
          .register({
            email: who.email,
            name: 'Outra Pessoa',
            password: PASSWORD,
            acceptTerms: true,
          })
          .catch((error: unknown) => error);

      expect(await register()).toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
      await app.purgeJob.run();

      const created = await register();
      expect(created).toMatchObject({ user: { email: who.email } });
    });
  });

  describe('BR-010-15: the alert and the legal ceiling', () => {
    beforeEach(drain);

    it('raises an error log with a count at 25 days after closure and not a minute before, never with who', async () => {
      const who = await closed('Alerta Silencioso');
      const registry = app.get(PersonalDataRegistry);
      const stuck = vi.spyOn(registry, 'purge').mockRejectedValue(new Error('provider down'));
      const errors = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
      const closedAt = (await stored(who)).closedAt as Date;

      app.harness.clock.set(new Date(closedAt.getTime() + 25 * DAY - MINUTE));
      const early = await app.purgeJob.run();
      const earlyLines = errors.mock.calls.map(([line]) => String(line));

      app.harness.clock.set(new Date(closedAt.getTime() + 25 * DAY));
      const due = await app.purgeJob.run();
      const dueLines = errors.mock.calls.map(([line]) => String(line));

      expect(early?.overdue).toBe(0);
      expect(earlyLines.filter((line) => line.includes('not purged'))).toEqual([]);
      expect(due?.overdue).toBe(1);
      const alert = dueLines.find((line) => line.includes('not purged'));
      expect(alert).toBe(
        '1 closed account(s) not purged 25 days after closure; the legal limit is 30 days (BR-010-15)',
      );
      expect(dueLines.join('\n')).not.toContain(who.email);
      expect(dueLines.join('\n')).not.toContain(who.id);
      stuck.mockRestore();
      errors.mockRestore();
      await app.purgeJob.run(); // converges once the provider is back
      expect((await stored(who)).purgedAt).toBeDefined();
    });
  });
});
