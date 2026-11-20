// SPEC-010 BR-010-13, BR-010-14 (TS-08): closing the signed-in account, through the real API on a real
// MongoDB, and the races the owner reviews closely: (a) two closures at once, (b) a password sign-in
// racing the closure, (c) the export worker racing it. Time is the harness's FakeClock (TS-06), the
// R2 port a fake (TS-07).
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AuthService } from '../../src/auth/auth.service.js';
import { AccountClosureService } from '../../src/privacy/rights/account-closure.service.js';
import { DataExportsRepository } from '../../src/privacy/rights/data-exports.repository.js';
import { UsersService } from '../../src/users/users.service.js';
import { DAY } from '../fakes/fake-clock.js';
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

/** The fields of a user document these specs read, as stored. */
interface StoredUser {
  status?: string;
  closedAt?: Date;
  credentialVersion?: number;
  name?: string;
  email?: string;
  phone?: string;
}

describe('SPEC-010 closing the account (BR-010-13, BR-010-14)', () => {
  const db = useTestDatabase();
  let app: RightsApp;
  let counter = 0;

  const label = () => `acc${(counter += 1)}`;
  const account = (name = 'Fulana Teste') => seedAccount(app, label(), name, '+55 11 98765-4321');
  const stored = async (who: { id: string }): Promise<StoredUser> =>
    ((await app.collection('users').findOne({ _id: oid(who.id) })) ?? {}) as StoredUser;
  const me = (token: string) =>
    app.harness.app.getHttpServer() &&
    import('supertest').then(({ default: request }) =>
      request(app.harness.app.getHttpServer())
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${token}`),
    );
  // Each account closes from its own origin, so the per-origin sign-in throttle (SC-04) that the
  // closure's password check shares never reaches another test; the throttle's own test fixes one.
  const origins = new Map<string, string>();
  const originOf = (who: { id: string }) => {
    const origin = origins.get(who.id) ?? nextOrigin();
    origins.set(who.id, origin);
    return origin;
  };
  const close = (
    who: { id: string; email: string; token: string },
    body: Record<string, unknown>,
  ) =>
    app
      .as(who)
      .post('/api/privacy/delete-account')
      .set('X-Forwarded-For', originOf(who))
      .send(body);
  const closeWithPassword = (who: SeededAccount) =>
    close(who, { password: PASSWORD, confirm: true });

  beforeAll(async () => {
    app = await createRightsApp(db);
  });

  afterAll(async () => {
    await app.close();
  });

  describe('BR-010-13: deletion needs the identity proved again', () => {
    it('refuses a request with no proof, with both, or without the confirmation, and closes nothing', async () => {
      const ana = await account();

      for (const body of [
        { confirm: true },
        { password: PASSWORD, googleCode: 'some-code', confirm: true },
        { password: PASSWORD },
        { password: PASSWORD, confirm: false },
        { password: '', confirm: true },
        { password: PASSWORD, confirm: true, userId: ana.id }, // BR-002-11
      ]) {
        const refused = await close(ana, body).expect(400);
        expect(refused.body.code).toBe('VALIDATION_FAILED');
      }
      expect((await stored(ana)).status).toBe('active');
      await app.as(ana).get('/api/auth/me').expect(200);
    });

    it('AC: a wrong password is refused, counts like a sign-in attempt and closes nothing', async () => {
      const ana = await account();

      const refused = await close(ana, { password: 'not the password', confirm: true }).expect(400);

      expect(refused.body).toEqual({ code: 'CURRENT_PASSWORD_INCORRECT', context: {} });
      expect((await stored(ana)).status).toBe('active');
      expect(app.hook.calls).not.toContain(ana.id);
    });

    it('SC-04: the 11th wrong password in 15 minutes is TOO_MANY_ATTEMPTS, even with the right one', async () => {
      const ana = await account();
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await close(ana, { password: 'wrong', confirm: true }).expect(400);
      }

      const refused = await closeWithPassword(ana).expect(429);

      expect(refused.body.code).toBe('TOO_MANY_ATTEMPTS');
      expect((await stored(ana)).status).toBe('active');
    });

    it('AC: a Google code of ANOTHER account is refused, closes nothing and does not spend that code', async () => {
      const ana = await account();
      const bia = await account('Beltrana');
      const codeOfBia = await app.googleCodeFor(bia.email, 'google-bia-1');

      const refused = await close(ana, { googleCode: codeOfBia, confirm: true }).expect(400);

      expect(refused.body).toEqual({ code: 'INVALID_GOOGLE_CODE', context: {} });
      expect((await stored(ana)).status).toBe('active');
      // Bia's code is untouched: it still closes Bia's own account, once.
      await close(bia, { googleCode: codeOfBia, confirm: true }).expect(200);
      expect((await stored(bia)).status).toBe('closed');
    });

    it('AC: a Google code is single use, expires after 60 seconds, and an unknown one is the same refusal', async () => {
      const ana = await account();
      const used = await app.googleCodeFor(ana.email, 'google-ana-1');
      // Spend it on something else first (a sign-in exchange), as a replay would.
      await app.authService.exchangeGoogleCode(used);
      const expired = await app.googleCodeFor(ana.email, 'google-ana-1');
      app.harness.clock.advance(61 * 1000);
      const fresh = await app.googleCodeFor(ana.email, 'google-ana-1');

      for (const googleCode of [used, expired, 'a-code-nobody-issued']) {
        const refused = await close(ana, { googleCode, confirm: true }).expect(400);
        expect(refused.body).toEqual({ code: 'INVALID_GOOGLE_CODE', context: {} });
      }
      expect((await stored(ana)).status).toBe('active');
      await close(ana, { googleCode: fresh, confirm: true }).expect(200);
      expect((await stored(ana)).status).toBe('closed');
    });

    it('a Google-only account asked for a password is OAUTH_ACCOUNT_HAS_NO_PASSWORD; one with no way to prove it is REAUTHENTICATION_UNAVAILABLE', async () => {
      const signupCode = await app.googleCodeFor('google-only-1@example.test', 'google-only-1');
      const created = await app.authService.completeGoogleSignup(signupCode);
      const googleOnly = {
        id: created.user._id,
        email: created.user.email,
        token: created.accessToken,
      };

      const refused = await close(googleOnly, { password: PASSWORD, confirm: true }).expect(409);
      expect(refused.body.code).toBe('OAUTH_ACCOUNT_HAS_NO_PASSWORD');

      // The Google proof works for it.
      const code = await app.googleCodeFor(googleOnly.email, 'google-only-1');
      await close(googleOnly, { googleCode: code, confirm: true }).expect(200);

      const stranded = await account();
      await app.users.updateOne({ _id: stranded.id }, { $set: { providers: [] } });
      const unavailable = await closeWithPassword(stranded).expect(409);
      expect(unavailable.body.code).toBe('REAUTHENTICATION_UNAVAILABLE');
      expect((await stored(stranded)).status).toBe('active');
    });
  });

  describe('BR-010-14: once confirmed the account is closed at once and for good', () => {
    let ana: SeededAccount;
    let otherDevice: string;
    let before: Awaited<ReturnType<typeof stored>>;

    beforeAll(async () => {
      ana = await account('Ana Encerrada');
      otherDevice = (await app.signIn(ana.email).expect(200)).body.accessToken as string;
      // Something queued and something ready, so closure has exports to cancel.
      await app.as(ana).post('/api/privacy/exports').expect(202);
      before = await stored(ana);
      app.hook.calls.length = 0;
    });

    it('answers success, and closes it in one write: status, closedAt (Clock) and the credential version', async () => {
      const closedAt = app.harness.clock.now();

      const response = await closeWithPassword(ana).expect(200);

      expect(response.body).toEqual({ closed: true });
      const after = await stored(ana);
      expect(after.status).toBe('closed');
      expect(after.closedAt).toEqual(closedAt);
      expect(after.credentialVersion).toBe((before.credentialVersion ?? 0) + 1);
    });

    it('AC: the session that asked and a session open on another device are refused on the next request', async () => {
      for (const token of [ana.token, otherDevice]) {
        const refused = (await await me(token)) as { status: number; body: unknown };
        expect(refused.status).toBe(401);
        expect(refused.body).toEqual({ code: 'UNAUTHENTICATED', context: {} });
      }
      const sessions = app.collection('sessions');
      expect(await sessions.countDocuments({ userId: oid(ana.id), revokedAt: null })).toBe(0);
    });

    it('AC: sign-in is refused by every method: password, Google, and the password reset', async () => {
      const login = await app.signIn(ana.email).expect(401);
      expect(login.body).toEqual({ code: 'INVALID_CREDENTIALS', context: {} });
      // Google: by the identity (linked after the closure's account existed) and by the e-mail.
      await expect(app.googleCodeFor(ana.email, 'google-after-closure')).rejects.toMatchObject({
        code: 'GOOGLE_SIGN_IN_FAILED',
      });
      // Reset: no e-mail goes out, and a token that was outstanding does not work.
      const emails = app.harness.mailbox.passwordResetEmails.length;
      await app.authService.requestPasswordReset(ana.email);
      await app.authService.flushDeliveries();
      expect(app.harness.mailbox.passwordResetEmails).toHaveLength(emails);
      await expect(
        app.authService.resetPassword('a-token-from-before', 'New password 123'),
      ).rejects.toMatchObject({
        code: 'INVALID_RESET_TOKEN',
      });
    });

    it('AC: no notification is sent again: a due reminder of the closed account is not sent', async () => {
      const start = app.harness.clock.now();
      // Another, active account has a reminder due too: the job does run, and skips only ana.
      const bia = await account('Beltrana Ativa');
      app.harness.clock.advance(3 * DAY); // every seeded reminder is due 1 day after its seeding

      await app.scheduler.processReminders();
      app.harness.clock.set(start);

      const sentTo = app.harness.mailbox.reminderEmails.map((sent) => sent.email);
      expect(sentTo).toContain(bia.email);
      expect(sentTo).not.toContain(ana.email);
      const reminders = app.collection('reminders');
      expect(await reminders.countDocuments({ userId: oid(ana.id), status: 'PENDING' })).toBe(1);
    });

    it('the closure effects ran once: the hook, the queued export cancelled, the links revoked', async () => {
      expect(app.hook.calls).toEqual([ana.id]);
      const exportRows = app.collection('dataExports');
      const row = await exportRows.findOne({ userId: oid(ana.id) });
      expect(row).toMatchObject({ status: 'cancelled' });
      expect(row?.live).toBeUndefined();
      const tokens = app.collection('accountTokens');
      expect(await tokens.countDocuments({ userId: oid(ana.id), usedAt: null })).toBe(0);
    });

    it('AR-31: nothing is deleted inline: the personal data is still there until the purge', async () => {
      const after = await stored(ana);

      expect(after).toMatchObject({
        name: 'Ana Encerrada',
        email: ana.email,
        phone: '+5511987654321',
      });
      const favorites = app.collection('favorites');
      expect(await favorites.countDocuments({ userId: oid(ana.id) })).toBe(1);
    });

    it('BR-010-01 / BR-001-01: the address cannot be registered again while the account is closed', async () => {
      const again = await app.authService
        .register({ email: ana.email, name: 'Someone Else', password: PASSWORD, acceptTerms: true })
        .catch((error: { code?: string }) => error);

      expect(again).toMatchObject({ code: 'EMAIL_ALREADY_REGISTERED' });
    });

    it('is idempotent: closing it again answers the same success and does nothing more', async () => {
      const closure = app.get(AccountClosureService);
      const closedAt = (await stored(ana)).closedAt as Date;

      await expect(
        closure.closeOwnAccount(ana.id, { password: PASSWORD }, '203.0.113.9'),
      ).resolves.toBeUndefined();

      expect(app.hook.calls).toEqual([ana.id]);
      const after = await stored(ana);
      expect(after.closedAt).toEqual(closedAt);
      expect(after.credentialVersion).toBe((before.credentialVersion ?? 0) + 1);
    });
  });

  describe('(a) two closures at once', () => {
    it('both answer success, one closes the account, and the effects run once', async () => {
      const ana = await account();
      const before = await stored(ana);
      app.hook.calls.length = 0;

      const [first, second] = await Promise.all([closeWithPassword(ana), closeWithPassword(ana)]);

      expect([first.status, second.status]).toEqual([200, 200]);
      expect(first.body).toEqual({ closed: true });
      expect(second.body).toEqual({ closed: true });
      const after = await stored(ana);
      expect(after.status).toBe('closed');
      // ONE closing write: the version went up by exactly one.
      expect(after.credentialVersion).toBe((before.credentialVersion ?? 0) + 1);
      // ONE set of side effects.
      expect(app.hook.calls).toEqual([ana.id]);
    });

    it('holds for many pairs, and the loser never turns into a refusal', async () => {
      const accounts = await Promise.all([account(), account(), account(), account()]);
      app.hook.calls.length = 0;

      const answers = await Promise.all(
        accounts.flatMap((who) => [closeWithPassword(who), closeWithPassword(who)]),
      );

      expect(answers.map((a) => a.status)).toEqual(Array(8).fill(200));
      expect([...app.hook.calls].sort()).toEqual(accounts.map((a) => a.id).sort());
    });
  });

  describe('(b) a password sign-in racing the closure', () => {
    it('DL-001-02: a sign-in that passed its checks before the closure cannot keep a session after it', async () => {
      const ana = await account();
      const users = app.get(UsersService);
      // The race, in order: the password is validated (login is past bcrypt)...
      const validatedBeforeClosure = await users.validatePassword(ana.email, PASSWORD);
      expect(validatedBeforeClosure).not.toBeNull();
      // ...the account is closed (the effects included)...
      await closeWithPassword(ana).expect(200);
      // ...and only then does that login create its session from the pre-closure validation.
      const late = await app.get(AuthService).startSession(validatedBeforeClosure as never);

      const refused = (await me(late.accessToken)) as unknown as { status: number };
      expect(refused.status).toBe(401);
      // The session row exists and was never revoked: only the credential version (and the status)
      // refuse it, which is the whole point of bumping it in the closing write.
      const sessions = app.collection('sessions');
      const claims = JSON.parse(
        Buffer.from(late.accessToken.split('.')[1] ?? '', 'base64url').toString(),
      ) as {
        jti: string;
      };
      expect(await sessions.findOne({ _id: claims.jti as never })).toMatchObject({
        credentialVersion: 0,
      });
    });

    it('run for real: every login concurrent with a closure is refused, or its session is dead', async () => {
      const accounts = await Promise.all([
        account(),
        account(),
        account(),
        account(),
        account(),
        account(),
      ]);

      const results = await Promise.all(
        accounts.map(async (who) => {
          const [closure, login] = await Promise.all([
            closeWithPassword(who),
            app.signIn(who.email),
          ]);
          return { closure: closure.status, login };
        }),
      );

      for (const { closure, login } of results) {
        expect(closure).toBe(200);
        if (login.status === 200) {
          // The login won the race against the closure: its token must be dead now.
          const refused = (await me(login.body.accessToken as string)) as unknown as {
            status: number;
          };
          expect(refused.status).toBe(401);
        } else {
          expect(login.status).toBe(401);
        }
      }
    });
  });

  describe('(c) the export worker racing the closure', () => {
    it('a closure in the middle of the build leaves no ready export and no orphan file', async () => {
      const ana = await account();
      await app.as(ana).post('/api/privacy/exports').expect(202);
      // Between the file being written and the export being marked ready, the account is closed.
      app.storage.afterStore = async () => {
        app.storage.afterStore = undefined;
        await closeWithPassword(ana).expect(200);
      };

      const outcome = await app.exportJob.runBuild();

      expect(outcome).toEqual({ ready: 0, failed: 0, discarded: 1 });
      expect(app.storage.files.size).toBe(0); // the worker deleted the file it had just written
      const exportRows = app.collection('dataExports');
      const rows = await exportRows.find({ userId: oid(ana.id) }).toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ status: 'cancelled' });
      expect(rows[0]?.fileKey).toBeUndefined(); // the key was cleared with the file
    });

    it('a ready export of an account that is closed afterwards is cancelled and its file deleted', async () => {
      const ana = await account();
      await app.as(ana).post('/api/privacy/exports').expect(202);
      expect(await app.exportJob.runBuild()).toMatchObject({ ready: 1 });
      expect(app.storage.files.size).toBe(1);

      await closeWithPassword(ana).expect(200);
      await app.exportJob.runExpiry();

      const exportRows = app.collection('dataExports');
      expect(await exportRows.findOne({ userId: oid(ana.id) })).toMatchObject({
        status: 'cancelled',
      });
      expect(app.storage.files.size).toBe(0);
    });

    it('a request that slipped in after the closure is failed by the worker, with no file at all', async () => {
      const ana = await account();
      await closeWithPassword(ana).expect(200);
      // The request passed the session guard just before the closure and inserts after it.
      await app.get(DataExportsRepository).insertQueued(ana.id, app.harness.clock.now());

      const outcome = await app.exportJob.runBuild();

      expect(outcome).toMatchObject({ ready: 0, failed: 1 });
      expect(app.storage.files.size).toBe(0);
      const exportRows = app.collection('dataExports');
      expect(await exportRows.findOne({ userId: oid(ana.id), status: 'failed' })).toMatchObject({
        errorCode: 'EXPORT_ACCOUNT_NOT_ACTIVE',
      });
    });

    it('a worker that crashed after writing the file is repaired: the file is deleted by the cleanup', async () => {
      const ana = await account();
      await app.as(ana).post('/api/privacy/exports').expect(202);
      // The upload "succeeds", then storage keeps the file while the marking fails (cancelled), and
      // the inline delete of the file fails too (storage unavailable at that moment).
      app.storage.afterStore = async () => {
        app.storage.afterStore = undefined;
        app.storage.failDeletes = true;
        await closeWithPassword(ana).expect(200);
      };
      await app.exportJob.runBuild();
      expect(app.storage.files.size).toBe(1); // an orphan for now: the row still names it
      app.storage.failDeletes = false;

      const repair = await app.exportJob.runExpiry();

      expect(repair).toEqual({ expired: 0, cleaned: 1, failed: 0 });
      expect(app.storage.files.size).toBe(0);
    });
  });
});
