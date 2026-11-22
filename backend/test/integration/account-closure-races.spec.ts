// SPEC-010 BR-010-14, BR-010-15 / DL-001-02 (TS-08), the owner's review of #178: three races that
// reached the account document or its providers' collections after the fact, held DETERMINISTICALLY on
// a real MongoDB: each request is paused at the exact step the interleaving needs (a gate in a spy
// around the real method), the other request runs to completion, then the first resumes.
//
//  (1) a closure whose proof was checked against credentials that changed meanwhile closes nothing;
//  (2) a profile write that passed authentication before the closure, resumed after the purge, restores
//      nothing; a favourite or a saved filter written that late is removed by the residue sweep;
//  (3) more permanently failing accounts than a run's attempt budget cannot starve a healthy one
//      across daily runs (the job's limits are injected small here: 12 attempts a run, not 500).
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { FavoritesService } from '../../src/favorites/favorites.service.js';
import { PersonalDataRegistry } from '../../src/privacy/registry/personal-data-registry.js';
import { AccountClosureService } from '../../src/privacy/rights/account-closure.service.js';
import { SavedFiltersService } from '../../src/saved-filters/saved-filters.service.js';
import { UsersService } from '../../src/users/users.service.js';
import { DAY, MINUTE } from '../fakes/fake-clock.js';
import {
  createRightsApp,
  nextOrigin,
  oid,
  PASSWORD,
  type RightsApp,
  seedAccount,
  SMALL_PURGE_LIMITS,
  type SeededAccount,
} from '../support/privacy-rights-app.js';
import { useTestDatabase } from '../support/test-database.js';

/** A one-shot rendezvous: the paused step says it arrived, the test lets it go on. */
function gate() {
  let arrive!: () => void;
  let open!: () => void;
  const arrived = new Promise<void>((resolve) => (arrive = resolve));
  const opened = new Promise<void>((resolve) => (open = resolve));
  return {
    arrived,
    open,
    /** Called by the paused step. */
    async hold() {
      arrive();
      await opened;
    },
  };
}

describe('SPEC-010 races the owner found in review (#178)', () => {
  const db = useTestDatabase();
  let app: RightsApp;
  let counter = 0;

  const label = () => `race${(counter += 1)}`;
  const account = (name = 'Fulana Corrida') => seedAccount(app, label(), name, '+55 11 98765-4321');
  const rawUser = async (who: { id: string }) =>
    (await app.collection('users').findOne({ _id: oid(who.id) })) as Record<string, unknown>;
  const origins = new Map<string, string>();
  const close = (who: SeededAccount, body: Record<string, unknown>) => {
    const origin = origins.get(who.id) ?? nextOrigin();
    origins.set(who.id, origin);
    return app
      .as(who)
      .post('/api/privacy/delete-account')
      .set('X-Forwarded-For', origin)
      .send(body);
  };

  beforeAll(async () => {
    app = await createRightsApp(db, {}, undefined, SMALL_PURGE_LIMITS); // 5 per batch, 12 per run
    await app.collection('auctions').insertOne({
      code: 'RIGHTS002',
      available: true,
      phases: [{ modality: 'ONLINE_SALES', minimumPrice: null }],
      currentPhase: { modality: 'ONLINE_SALES', minimumPrice: null },
      updatedAt: new Date('2999-01-01T00:00:00.000Z'),
    });
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Purges every closed account now (a claim a dead worker left is over), then moves one minute on. */
  const purgeAll = async () => {
    app.harness.clock.advance(11 * MINUTE);
    const outcome = await app.purgeJob.run();
    app.harness.clock.advance(MINUTE);
    return outcome;
  };

  describe('(1) the closure is fenced on the credentials the proof was given for (DL-001-02)', () => {
    it('password: a reset that lands while the old password is being compared closes nothing, and the stale request is refused', async () => {
      const ana = await account();
      const users = app.get(UsersService);
      const real = users.validatePassword.bind(users);
      const compare = gate();
      // The comparison is done (it matched the old hash, at the old credential version); the request
      // waits there, as a slow bcrypt would, while the credentials change under it.
      vi.spyOn(users, 'validatePassword').mockImplementation(async (...args) => {
        const verified = await real(...args);
        await compare.hold();
        return verified;
      });

      const stale = close(ana, { password: PASSWORD, confirm: true }).then((response) => response);
      await compare.arrived;
      await users.setPassword(ana.id, 'A replaced password 1'); // what a reset does: hash + version
      const afterReset = await rawUser(ana);
      expect(afterReset['credentialVersion']).toBe(1);
      compare.open();
      const response = await stale;

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ code: 'UNAUTHENTICATED', context: {} });
      // Nothing was written by the stale request: the document is exactly what the reset left.
      expect(await rawUser(ana)).toEqual(afterReset);
      expect(afterReset['status']).toBe('active');
      expect(afterReset).not.toHaveProperty('closedAt');
      expect(app.hook.calls).not.toContain(ana.id);
      // The holder of the NEW credentials can still prove it and close the account.
      vi.restoreAllMocks();
      const fresh = await app.signIn(ana.email, 'A replaced password 1').expect(200);
      await close(
        { ...ana, token: fresh.body.accessToken as string },
        {
          password: 'A replaced password 1',
          confirm: true,
        },
      ).expect(200);
      expect((await rawUser(ana))['status']).toBe('closed');
    });

    it('Google: a credential change between the proof and the closure closes nothing', async () => {
      const ana = await account();
      const users = app.get(UsersService);
      const real = app.authService.reauthenticate.bind(app.authService);
      const proven = gate();
      vi.spyOn(app.authService, 'reauthenticate').mockImplementation(async (...args) => {
        const result = await real(...args);
        await proven.hold();
        return result;
      });
      const code = await app.googleCodeFor(ana.email, `google-fence-${counter}`);

      const stale = close(ana, { googleCode: code, confirm: true }).then((response) => response);
      await proven.arrived;
      await users.setPassword(ana.id, 'A replaced password 2');
      const afterChange = await rawUser(ana);
      proven.open();
      const response = await stale;

      expect(response.status).toBe(401);
      expect(response.body).toEqual({ code: 'UNAUTHENTICATED', context: {} });
      expect(await rawUser(ana)).toEqual(afterChange);
      expect(app.hook.calls).not.toContain(ana.id);
    });

    it('an unchanged account closes as before, with the same proof (the fence is not a new refusal)', async () => {
      const ana = await account();

      await close(ana, { password: PASSWORD, confirm: true }).expect(200);

      const after = await rawUser(ana);
      expect(after['status']).toBe('closed');
      expect(after['credentialVersion']).toBe(1); // 0 + the closing bump
    });
  });

  describe('(2) a write that passed authentication before the closure restores nothing', () => {
    it('a profile write resumed after the closure AND the purge is refused, and the tombstone stays bare', async () => {
      const ana = await account('Nome Verdadeiro Quimera');
      const profile = gate();
      const real = app.authService.updateProfile.bind(app.authService);
      // The request is past JwtStrategy (the session was valid) and waits before it writes.
      vi.spyOn(app.authService, 'updateProfile').mockImplementation(async (...args) => {
        await profile.hold();
        return real(...args);
      });

      const late = app
        .as(ana)
        .patch('/api/auth/profile')
        .send({ name: 'Nome Tardio Fantasma', phone: '+55 11 90000-0000' })
        .then((response) => response);
      await profile.arrived;
      await close(ana, { password: PASSWORD, confirm: true }).expect(200);
      app.harness.clock.advance(MINUTE);
      await app.purgeJob.run();
      const tombstone = await rawUser(ana);
      expect(tombstone['purgedAt']).toBeInstanceOf(Date);
      profile.open();
      const response = await late;

      expect(response.status).toBe(404);
      expect(response.body).toEqual({ code: 'USER_NOT_FOUND', context: {} });
      // Nothing came back: no name, no phone, `purgedAt` still set (so the scan never loses it).
      const after = await rawUser(ana);
      expect(after).toEqual(tombstone);
      expect(after).not.toHaveProperty('name');
      expect(after).not.toHaveProperty('phone');
      expect(await app.scan(['Nome Tardio Fantasma', '90000-0000'])).toEqual([]);
    });

    it('every writer of the users collection refuses a closed account and writes nothing', async () => {
      const ana = await account();
      await close(ana, { password: PASSWORD, confirm: true }).expect(200);
      await purgeAll();
      const users = app.get(UsersService);
      const before = await rawUser(ana);
      const tombstoneEmail = before['email'] as string;

      await expect(users.update(ana.id, { name: 'Outro' })).rejects.toMatchObject({
        code: 'USER_NOT_FOUND',
      });
      await expect(
        users.updateProfile(ana.id, { name: 'Outro', phone: '+55 11 91111-1111' }),
      ).rejects.toMatchObject({ code: 'USER_NOT_FOUND' });
      await expect(users.updateProfile(ana.id, {})).rejects.toMatchObject({
        code: 'USER_NOT_FOUND',
      });
      await expect(users.setPassword(ana.id, 'Another password 1')).rejects.toMatchObject({
        code: 'USER_NOT_FOUND',
      });
      await expect(users.changePassword(ana.id, 'Another password 1', 0)).rejects.toMatchObject({
        code: 'UNAUTHENTICATED',
      });
      expect(await users.confirmEmail(ana.id, tombstoneEmail)).toBe(false);
      expect((await users.linkGoogleIdentity(ana.id, 'google-late', new Date())).result).toBe(
        'inactive',
      );
      expect(await users.setAdminCapability(ana.id, true)).toBe(false);

      expect(await rawUser(ana)).toEqual(before);
    });

    it('a late WhatsApp answer marks nothing on a closed account', async () => {
      const ana = await account();
      await close(ana, { password: PASSWORD, confirm: true }).expect(200);
      await app
        .collection('users')
        .updateOne({ _id: oid(ana.id) }, { $unset: { whatsappPromptAnsweredAt: '' } });

      await app.get(UsersService).markWhatsappPromptAnswered(ana.id, new Date(), null);

      expect(await rawUser(ana)).not.toHaveProperty('whatsappPromptAnsweredAt');
    });
  });

  describe('(2b) the residue sweep deletes what an in-flight request wrote after the purge', () => {
    // Every test starts with nothing closed and unpurged and no sweep due, so its counts are its own.
    beforeEach(async () => {
      await purgeAll();
      app.harness.clock.advance(2 * DAY);
      await app.purgeJob.run();
    });

    async function lateWrites(ana: SeededAccount) {
      const favorites = app.get(FavoritesService);
      const filters = app.get(SavedFiltersService);
      const realFavorite = favorites.create.bind(favorites);
      const realFilter = filters.create.bind(filters);
      const favoriteGate = gate();
      const filterGate = gate();
      vi.spyOn(favorites, 'create').mockImplementation(async (...args) => {
        await favoriteGate.hold();
        return realFavorite(...args);
      });
      vi.spyOn(filters, 'create').mockImplementation(async (...args) => {
        await filterGate.hold();
        return realFilter(...args);
      });
      const requests = [
        app
          .as(ana)
          .post('/api/favorites')
          .send({ code: 'RIGHTS002' })
          .then((response) => response),
        app
          .as(ana)
          .post('/api/saved-filters')
          .send({ name: 'filtro-tardio', filters: { state: 'SP' } })
          .then((response) => response),
      ];
      await Promise.all([favoriteGate.arrived, filterGate.arrived]);
      return {
        release: async () => {
          favoriteGate.open();
          filterGate.open();
          return Promise.all(requests);
        },
      };
    }

    it('a favourite and a saved filter created after the purge live at most a day, and the sweep is idempotent', async () => {
      const ana = await account();
      const bia = await account('Bia Viva');
      const inFlight = await lateWrites(ana);
      await close(ana, { password: PASSWORD, confirm: true }).expect(200);
      const purged = await purgeAll();
      expect(purged).toMatchObject({ purged: 1, swept: 0 });
      const mine = { userId: oid(ana.id) };
      expect(await app.collection('favorites').countDocuments(mine)).toBe(0);

      // The requests were past authentication: they write after the purge deleted everything.
      const answers = await inFlight.release();
      expect(answers.map((answer) => answer.status)).toEqual([201, 201]);
      expect(await app.collection('favorites').countDocuments(mine)).toBe(1);
      expect(await app.collection('savedfilters').countDocuments(mine)).toBe(1);
      expect(await app.scan(['filtro-tardio'])).not.toEqual([]); // the residue is real

      // Before the day is over: not due, nothing swept.
      app.harness.clock.advance(DAY - 20 * MINUTE);
      expect(await app.purgeJob.run()).toMatchObject({ swept: 0, residueDeleted: 0 });
      expect(await app.collection('favorites').countDocuments(mine)).toBe(1);

      // A day after the tombstone: swept once, counts recorded, marker set.
      app.harness.clock.advance(21 * MINUTE);
      const swept = await app.purgeJob.run();
      expect(swept).toMatchObject({ swept: 1, sweepFailed: 0 });
      expect(swept?.residueDeleted).toBe(2);
      expect(await app.collection('favorites').countDocuments(mine)).toBe(0);
      expect(await app.collection('savedfilters').countDocuments(mine)).toBe(0);
      expect(await app.scan(['filtro-tardio'])).toEqual([]);
      const tomb = await rawUser(ana);
      expect(tomb['residueSweptAt']).toBeInstanceOf(Date);
      expect(tomb).not.toHaveProperty('residueSweepDueAt');

      // Idempotent: nothing is due, nothing is deleted again; another account is never touched.
      app.harness.clock.advance(DAY);
      expect(await app.purgeJob.run()).toMatchObject({ swept: 0, residueDeleted: 0 });
      expect(await app.collection('favorites').countDocuments({ userId: oid(bia.id) })).toBe(1);
      expect(await app.collection('savedfilters').countDocuments({ userId: oid(bia.id) })).toBe(1);
    });

    it('only purged accounts are swept: a live one, a closed one not yet purged and one swept already are not candidates', async () => {
      const live = await account();
      const closedOnly = await account();
      await close(closedOnly, { password: PASSWORD, confirm: true }).expect(200);
      const users = app.get(UsersService);
      const everything = new Date(app.harness.clock.now().getTime() + 1000 * DAY);

      const candidates = await users.findResidueSweepCandidates(everything, 100);

      expect(candidates).not.toContain(live.id);
      expect(candidates).not.toContain(closedOnly.id);
      // And the marker is conditional: it never lands on an account that is not purged.
      expect(await users.markResidueSwept(live.id, new Date())).toBe(false);
      expect(await users.markResidueSwept(closedOnly.id, new Date())).toBe(false);
      expect(await rawUser(live)).not.toHaveProperty('residueSweptAt');
      await purgeAll(); // leave no closed account behind for the next test
    });

    it('a sweep that fails is moved a day on, counted, and does not stop the others', async () => {
      const bad = await account();
      const good = await account();
      await close(bad, { password: PASSWORD, confirm: true }).expect(200);
      await close(good, { password: PASSWORD, confirm: true }).expect(200);
      await purgeAll();
      const registry = app.get(PersonalDataRegistry);
      const real = registry.purge.bind(registry);
      vi.spyOn(registry, 'purge').mockImplementation(async (userId) => {
        if (userId === bad.id) throw new Error('providers down');
        return real(userId);
      });
      app.harness.clock.advance(DAY);
      const dueBefore = (await rawUser(bad))['residueSweepDueAt'] as Date;

      const outcome = await app.purgeJob.run();

      expect(outcome).toMatchObject({ swept: 1, sweepFailed: 1 });
      const afterFailure = await rawUser(bad);
      expect((afterFailure['residueSweepDueAt'] as Date).getTime()).toBeGreaterThan(
        dueBefore.getTime(),
      );
      expect(afterFailure).not.toHaveProperty('residueSweptAt');
      expect(await rawUser(good)).toHaveProperty('residueSweptAt');
      // Fixed, a day later: swept.
      vi.restoreAllMocks();
      app.harness.clock.advance(DAY + MINUTE);
      expect(await app.purgeJob.run()).toMatchObject({ swept: 1, sweepFailed: 0 });
      expect(await rawUser(bad)).toHaveProperty('residueSweptAt');
    });
  });

  describe('(3) durable fairness: failing accounts never starve a healthy one (BR-010-15)', () => {
    const { maxAttemptsPerRun } = SMALL_PURGE_LIMITS;
    const FAILING = maxAttemptsPerRun + 2; // more than one run can even try
    const RUNS = 8;

    it(`${FAILING} accounts (more than a run's budget) that always fail, then one healthy one: it is purged in the first runs, the failing ones keep being retried`, async () => {
      await purgeAll();
      const base = app.harness.clock.now();
      const closedAt = (index: number) => new Date(base.getTime() - 26 * DAY + index * 1000);
      const documents = Array.from({ length: FAILING + 1 }, (_, index) => ({
        _id: oid(`64c${String(index).padStart(21, '0')}`),
        email: `fairness-${index}@example.test`,
        name: `Conta ${index}`,
        providers: ['local'],
        status: 'closed',
        closedAt: closedAt(index),
        credentialVersion: 1,
        role: 'free',
      }));
      await app.collection('users').insertMany(documents);
      const failingIds = new Set(documents.slice(0, FAILING).map((doc) => doc._id.toHexString()));
      const healthy = documents[FAILING]?._id.toHexString() as string;
      // The oldest closures all fail for good; the healthy account closed after every one of them.
      vi.spyOn(app.get(AccountClosureService), 'applyClosureEffects').mockResolvedValue({
        failedSteps: [],
        failedHooks: [],
      });
      const registry = app.get(PersonalDataRegistry);
      const realPurge = registry.purge.bind(registry);
      vi.spyOn(registry, 'purge').mockImplementation(async (userId) => {
        if (failingIds.has(userId)) throw new Error('permanent failure');
        return realPurge(userId);
      });
      expect(FAILING).toBeGreaterThan(maxAttemptsPerRun); // one run cannot even try them all

      const purgedAtRun: Array<number | null> = [];
      for (let run = 1; run <= RUNS; run += 1) {
        app.harness.clock.advance(DAY);
        const outcome = await app.purgeJob.run();
        expect(outcome?.purged, `run ${run}`).toBeLessThanOrEqual(1);
        purgedAtRun.push(outcome?.purged ?? null);
        if (run === 1) {
          // Run 1 spends its whole budget on the oldest ones: the healthy one is not reached yet.
          expect(outcome).toMatchObject({ purged: 0, failed: maxAttemptsPerRun });
        }
      }

      // Run 2 takes the never-attempted failing accounts left, then the healthy one (never attempted).
      expect(purgedAtRun.indexOf(1)).toBeLessThanOrEqual(2);
      expect(
        (await app.collection('users').findOne({ _id: oid(healthy) }))?.['purgedAt'],
      ).toBeInstanceOf(Date);
      // The failing ones were all retried, over and over, and none was ever marked purged.
      const failing = await app
        .collection('users')
        .find({ _id: { $in: [...failingIds].map(oid) } })
        .toArray();
      expect(failing).toHaveLength(FAILING);
      expect(failing.every((doc) => doc['purgedAt'] === undefined)).toBe(true);
      const attempts = failing.map((doc) => doc['purgeAttempts'] as number);
      expect(Math.min(...attempts)).toBeGreaterThanOrEqual(5); // 8 runs x 12 attempts / 14 accounts, about 6.8 each
      expect(Math.max(...attempts) - Math.min(...attempts)).toBeLessThanOrEqual(2); // evenly, in turn
      // The alert still counts them by closure, not by attempt.
      expect(await app.purgeJob.checkOverdue()).toBe(FAILING);
    }, 60_000);
  });
});
