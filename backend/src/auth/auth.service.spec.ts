import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service.js';
import { DomainError } from '../common/errors/domain-error.js';
import type { EmailService } from '../email/email.service.js';
import { SUBSCRIPTION_STATUSES } from '../users/subscription-status.js';
import type { UserAccount } from '../users/user-account.js';
import type { UsersService } from '../users/users.service.js';
import { FakeEmailSender } from '../../test/fakes/fake-email-sender.js';
import { FakeUsersService, type FakeAccount } from '../../test/fakes/fake-users-service.js';
import { FakeClock, HOUR, MINUTE } from '../../test/fakes/fake-clock.js';
import {
  FakeAccountTokenRepository,
  FakeLoginAttemptsRepository,
  FakeSessionsRepository,
} from '../../test/fakes/fake-auth-repositories.js';
import { spyOnLogger } from '../../test/support/logger-spy.js';
import type { AccountTokenRepository } from './tokens/account-token.repository.js';
import type { SessionsRepository } from './sessions/sessions.repository.js';
import type { LoginAttemptsRepository } from './login-attempts/login-attempts.repository.js';
import { AccountTokenService } from './tokens/account-token.service.js';
import { SessionsService } from './sessions/sessions.service.js';
import { LoginAttemptsService } from './login-attempts/login-attempts.service.js';
import { wirePrivacy } from '../../test/support/privacy-services.js';

type ServiceDeps = ConstructorParameters<typeof AuthService>;

/** The real auth services over in-memory repositories and a fake clock (TS-03, TS-06). */
function wire(users: UsersService, email: EmailService, sign: (payload: never) => string) {
  const clock = new FakeClock();
  const tokenRepo = new FakeAccountTokenRepository();
  const sessionRepo = new FakeSessionsRepository();
  const attemptRepo = new FakeLoginAttemptsRepository();
  const privacy = wirePrivacy(clock, users);
  const service = new AuthService(
    users,
    { sign } as unknown as ServiceDeps[1],
    email,
    new AccountTokenService(tokenRepo as unknown as AccountTokenRepository, clock),
    new SessionsService(sessionRepo as unknown as SessionsRepository, clock),
    new LoginAttemptsService(attemptRepo as unknown as LoginAttemptsRepository, clock),
    privacy.consents,
    privacy.whatsapp,
    clock,
  );
  return { service, clock, tokenRepo, sessionRepo, attemptRepo, privacy };
}
const ID = '64b000000000000000000001';
const CREATED = new Date('2026-01-01T12:00:00.000Z');
const UPDATED = new Date('2026-01-02T12:00:00.000Z');

// AR-09 / SC-01: auth consumes the account contract and maps only the public profile fields.
describe('AuthService account contract (AR-09)', () => {
  function build() {
    const sign = vi.fn().mockReturnValue('signed-token');
    const { service } = wire({} as UsersService, {} as EmailService, sign);
    return { service, sign };
  }

  function account(overrides: Partial<UserAccount> = {}): UserAccount {
    return {
      _id: ID,
      email: 'account@example.test',
      name: 'Test Account',
      providers: ['google'],
      createdAt: CREATED,
      updatedAt: UPDATED,
      ...overrides,
    };
  }

  it('preserves token claims and profile defaults without document methods', async () => {
    const { service, sign } = build();

    const result = await service.startSession(account());

    // BR-001-17: the token carries the account and the session, nothing else.
    expect(sign).toHaveBeenCalledWith({ sub: ID, jti: expect.any(String) as string });
    expect(Object.keys(sign.mock.calls[0]?.[0] as object).sort()).toEqual(['jti', 'sub']);
    expect(result).toEqual({
      accessToken: 'signed-token',
      user: {
        _id: ID,
        email: 'account@example.test',
        name: 'Test Account',
        providers: ['google'],
        emailVerified: false,
        role: 'free',
        subscriptionStatus: null,
        isAdmin: false, // SPEC-002: a missing flag is no admin (AR-28)
        phone: undefined,
        createdAt: CREATED,
        updatedAt: UPDATED,
      },
    });
  });

  it('normalizes ObjectId-like account ids through their explicit hex conversion', async () => {
    const { service, sign } = build();

    const result = await service.startSession(account({ _id: { toHexString: () => ID } }));

    expect(result.user._id).toBe(ID);
    expect(sign).toHaveBeenCalledWith({ sub: ID, jti: expect.any(String) as string });
  });

  it('preserves populated profile fields and omits credential fields', async () => {
    const { service } = build();
    const profile = {
      emailVerified: true,
      role: 'premium',
      subscriptionStatus: 'active' as const,
      providers: ['local', 'google'],
      phone: '00000000000',
      isAdmin: true, // SPEC-002 DL-002-05: the stored capability
    };
    const user = { ...account(profile), password: 'fake-hash' };

    const result = await service.startSession(user);

    expect(result.user).toEqual({
      _id: ID,
      email: 'account@example.test',
      name: 'Test Account',
      createdAt: CREATED,
      updatedAt: UPDATED,
      ...profile,
    });
    expect(result.user).not.toHaveProperty('password');
  });
});

// toUserProfile is private; every public method that returns a profile goes through it.
describe('AuthService.toUserProfile mapping (AR-09, SC-15)', () => {
  const { service } = wire({} as UsersService, {} as EmailService, vi.fn());

  function account(overrides: Partial<UserAccount> = {}): UserAccount {
    return {
      _id: ID,
      email: 'account@example.test',
      name: 'Test Account',
      providers: ['local'],
      createdAt: CREATED,
      updatedAt: UPDATED,
      ...overrides,
    };
  }

  async function profileOf(user: UserAccount) {
    return (await service.startSession(user)).user;
  }

  it.each([...SUBSCRIPTION_STATUSES])(
    'passes subscriptionStatus %s through unchanged',
    async (status) => {
      expect((await profileOf(account({ subscriptionStatus: status }))).subscriptionStatus).toBe(
        status,
      );
    },
  );

  it.each([
    ['null', null],
    ['absent', undefined],
  ])('maps a %s subscriptionStatus to null', async (_label, value) => {
    const user = account();
    if (value === null) user.subscriptionStatus = null;

    expect((await profileOf(user)).subscriptionStatus).toBeNull();
  });

  it('returns exactly the public profile keys, nothing from the document internals (SC-15)', async () => {
    const hydrated = {
      ...account({ role: 'premium', emailVerified: true }),
      password: 'fake-hash',
      googleId: 'fake-google-id',
      stripeCustomerId: 'cus_fake',
      stripeSubscriptionId: 'sub_fake',
      __v: 3,
    };

    const keys = Object.keys(await profileOf(hydrated)).sort();

    expect(keys).toEqual(
      [
        '_id',
        'email',
        'name',
        'providers',
        'emailVerified',
        'role',
        'subscriptionStatus',
        'isAdmin',
        'phone',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
  });

  it('SC-26: returns only the named fields, never an unlisted stored cpf, date of birth, sex or address', async () => {
    const stored = {
      cpf: '00000000000',
      dateOfBirth: new Date('1990-05-06T00:00:00.000Z'),
      sex: 'female',
      address: { street: 'Rua A', city: 'Santos', state: 'SP', zipCode: '11000000' },
    };

    const profile = await profileOf({ ...account(), ...stored });

    for (const key of Object.keys(stored)) expect(profile).not.toHaveProperty(key);
  });

  it('returns detached values: a new array and new dates', async () => {
    const providers = ['local'];
    const user = account({ providers });

    const profile = await profileOf(user);

    expect(profile.providers).not.toBe(providers);
    expect(profile.createdAt).not.toBe(CREATED);
    expect(profile.updatedAt).not.toBe(UPDATED);
  });

  it('defaults emailVerified to false and role to free, and keeps explicit values', async () => {
    const defaults = await profileOf(account());
    expect(defaults.emailVerified).toBe(false);
    expect(defaults.role).toBe('free');

    const explicit = await profileOf(account({ emailVerified: true, role: 'admin' }));
    expect(explicit.emailVerified).toBe(true);
    expect(explicit.role).toBe('admin');
  });
});

describe('AuthService with fake collaborators', () => {
  const IP = '203.0.113.7';

  function build() {
    const users = new FakeUsersService();
    const email = new FakeEmailSender();
    const sign = vi.fn((payload: { sub: string; jti: string }) => `token-for-${payload.sub}`);
    const wired = wire(users as unknown as UsersService, email as unknown as EmailService, sign);
    return { ...wired, users, email, sign };
  }

  function localAccount(overrides: Partial<FakeAccount> = {}): FakeAccount {
    return {
      _id: ID,
      email: 'local@example.test',
      name: 'Local User',
      password: 'correct-password',
      providers: ['local'],
      emailVerified: false,
      createdAt: CREATED,
      updatedAt: UPDATED,
      ...overrides,
    };
  }

  async function rejection(promise: Promise<unknown>): Promise<unknown> {
    return promise.then(
      () => undefined,
      (error: unknown) => error,
    );
  }

  async function expectDomainError(promise: Promise<unknown>, code: string) {
    const error = await rejection(promise);
    expect(error).toBeInstanceOf(DomainError);
    expect((error as DomainError).code).toBe(code);
  }

  const registration = {
    email: 'new@example.test',
    password: 'a-password',
    name: 'New User',
    acceptTerms: true,
  } as const;

  describe('register', () => {
    it('creates a local account, sends the confirmation email and opens a session', async () => {
      const { service, users, email, sessionRepo } = build();

      const result = await service.register(registration);

      // The fake assigns ids sequentially; the first account gets ID.
      expect(users.accounts.get(ID)?.providers).toEqual(['local']);
      expect(email.verificationEmails).toHaveLength(1);
      expect(email.verificationEmails[0]).toMatchObject({
        email: 'new@example.test',
        name: 'New User',
      });
      // BR-001-23: 32 random bytes, hex.
      expect(email.verificationEmails[0]?.token).toMatch(/^[0-9a-f]{64}$/);
      expect(sessionRepo.stored).toHaveLength(1);
      expect(result.accessToken).toBe(`token-for-${ID}`);
      expect(result.user).toMatchObject({
        email: 'new@example.test',
        name: 'New User',
        providers: ['local'],
        emailVerified: false,
        role: 'free',
        subscriptionStatus: null,
      });
      expect(result.user).not.toHaveProperty('password');
    });

    it('BR-010-03: records the acceptance of both documents, by e-mail sign-up, with the account', async () => {
      const { service, privacy } = build();

      await service.register(registration);

      expect(
        privacy.consentsRepo.rows.map((r) => [r.userId, r.documentType, r.version, r.method]),
      ).toEqual([
        [ID, 'terms', '0.1', 'signup_email'],
        [ID, 'privacy', '0.1', 'signup_email'],
      ]);
    });

    it('BR-010-27: the WhatsApp checkbox left unticked is recorded as declined and the account is created', async () => {
      const { service, users, privacy } = build();

      await service.register(registration);

      expect(users.accounts.size).toBe(1);
      expect(privacy.whatsappRepo.rows.map((r) => [r.action, r.method])).toEqual([
        ['declined', 'signup'],
      ]);
      expect(users.accounts.get(ID)?.whatsappPromptAnsweredAt).toBeInstanceOf(Date);
    });

    it('BR-010-27: a ticked WhatsApp checkbox is recorded as granted with the text version', async () => {
      const { service, privacy } = build();

      await service.register({ ...registration, whatsappConsent: true });

      expect(privacy.whatsappRepo.rows).toMatchObject([
        { action: 'granted', method: 'signup', textVersion: '0.1' },
      ]);
      expect(await privacy.whatsapp.hasConsent(ID)).toBe(true);
    });

    it('BR-010-01: versions that are the current ones are accepted as named', async () => {
      const { service, privacy } = build();

      await service.register({ ...registration, termsVersion: '0.1', privacyVersion: '0.1' });

      expect(privacy.consentsRepo.rows).toHaveLength(2);
    });

    it('BR-010-01: a stale version is TERMS_VERSION_OUTDATED and NO account is created', async () => {
      const { service, users, email, privacy } = build();

      await expectDomainError(
        service.register({ ...registration, termsVersion: '0.0' }),
        'TERMS_VERSION_OUTDATED',
      );

      expect(users.accounts.size).toBe(0);
      expect(email.verificationEmails).toEqual([]);
      expect(privacy.consentsRepo.rows).toEqual([]);
      expect(privacy.whatsappRepo.rows).toEqual([]);
    });

    it.each([
      [
        'the acceptance',
        (privacy: ReturnType<typeof build>['privacy']) =>
          (privacy.consentsRepo.failInsertsWith = new Error('db down')),
      ],
      [
        'the WhatsApp answer',
        (privacy: ReturnType<typeof build>['privacy']) =>
          (privacy.whatsappRepo.failInsertsWith = new Error('db down')),
      ],
    ])(
      'BR-010-01: when %s cannot be written the new account is rolled back, the failure surfaces and the address is free',
      async (_what, breakIt) => {
        const { service, users, email, sessionRepo, privacy } = build();
        const logged = spyOnLogger();
        breakIt(privacy);

        await expect(service.register(registration)).rejects.toThrow('db down');

        // No account, no confirmation e-mail, no session: nothing was issued for it.
        expect(users.accounts.size).toBe(0);
        expect(email.verificationEmails).toEqual([]);
        expect(sessionRepo.stored).toEqual([]);
        // SC-15: the log names the kind of failure and the outcome, never the address or the message.
        const text = logged.loggedText();
        expect(text).toContain(
          'Sign-up consent records could not be written (Error); account rolled back',
        );
        expect(text).not.toContain('new@example.test');
        expect(text).not.toContain('db down');
        // The same address can sign up again once the database is back.
        privacy.consentsRepo.failInsertsWith = undefined;
        privacy.whatsappRepo.failInsertsWith = undefined;
        await expect(service.register(registration)).resolves.toMatchObject({
          user: { email: 'new@example.test' },
        });
        expect(users.accounts.size).toBe(1);
      },
    );

    it('BR-010-01: a failure of the rollback itself is reported and the original error is what surfaces', async () => {
      const { service, users, privacy } = build();
      const logged = spyOnLogger();
      privacy.consentsRepo.failInsertsWith = new Error('db down');
      users.discardUnfinishedSignup = async () => {
        throw new Error('delete failed');
      };

      await expect(service.register(registration)).rejects.toThrow('db down');

      expect(logged.loggedText()).toContain('account NOT rolled back');
    });

    it('BR-010-01: an account that became active before the rollback is never deleted', async () => {
      const { service, users, privacy } = build();
      privacy.consentsRepo.failInsertsWith = new Error('db down');
      const original = users.discardUnfinishedSignup.bind(users);
      users.discardUnfinishedSignup = async (id: string) => {
        const account = users.accounts.get(id);
        if (account) account.status = 'active'; // something activated it first
        return original(id);
      };

      await expect(service.register(registration)).rejects.toThrow('db down');

      expect(users.accounts.size).toBe(1);
    });

    it('a sign-up refused for a taken address records no acceptance', async () => {
      const { service, users, privacy } = build();
      users.seed(localAccount());

      await expectDomainError(
        service.register({ ...registration, email: 'local@example.test' }),
        'EMAIL_ALREADY_REGISTERED',
      );

      expect(privacy.consentsRepo.rows).toEqual([]);
    });

    it('BR-001-01: a second sign-up with the same email in another case is refused', async () => {
      const { service, users, email } = build();
      users.seed(localAccount());

      await expectDomainError(
        service.register({ ...registration, email: '  Local@Example.test ' }),
        'EMAIL_ALREADY_REGISTERED',
      );
      expect(email.verificationEmails).toEqual([]);
    });

    it('BR-001-06: the account still opens when the mail provider fails, and the log names no address or link', async () => {
      const { service, email } = build();
      const logged = spyOnLogger();
      email.sendVerificationEmail = async (address: string, token: string) => {
        throw new Error(`SMTP refused ${address} for ${token}`);
      };

      const result = await service.register(registration);

      expect(result.accessToken).toBe(`token-for-${ID}`);
      const text = logged.loggedText();
      expect(text).toContain('Verification email could not be sent');
      expect(text).not.toContain('new@example.test');
      expect(text).not.toContain('SMTP refused');
    });
  });

  describe('login', () => {
    it('opens a session, signs sub and jti only and clears the email counter', async () => {
      const { service, users, sign, attemptRepo, sessionRepo } = build();
      users.seed(localAccount({ subscriptionStatus: 'active' }));

      const result = await service.login(
        { email: 'LOCAL@example.test', password: 'correct-password' },
        IP,
      );

      expect(sign).toHaveBeenCalledWith({ sub: ID, jti: sessionRepo.stored[0]?.id });
      expect(result.accessToken).toBe(`token-for-${ID}`);
      expect(result.user.subscriptionStatus).toBe('active');
      expect(result.user).not.toHaveProperty('password');
      // BR-001-15: the attempt was reserved first; success clears the email key and gives back
      // the origin's reserved count.
      expect(attemptRepo.cleared).toEqual(['email:local@example.test']);
      expect(attemptRepo.released).toEqual([`ip:${IP}`]);
    });

    it.each<[string, number | undefined, number]>([
      ['a version the account holds', 3, 3],
      ['an account without a version (counts as 0)', undefined, 0],
    ])(
      'DL-001-02: the session records the credential version of the validated account: %s',
      async (_label, stored, expected) => {
        const { service, users, sessionRepo } = build();
        users.seed(localAccount({ credentialVersion: stored }));

        await service.login({ email: 'local@example.test', password: 'correct-password' }, IP);

        expect(sessionRepo.stored.map((s) => s.credentialVersion)).toEqual([expected]);
      },
    );

    it.each([
      ['wrong password', 'local@example.test', 'wrong-password'],
      ['unknown email', 'nobody@example.test', 'correct-password'],
    ])(
      'BR-001-14: %s is INVALID_CREDENTIALS, signs nothing and keeps the count it reserved for email and IP',
      async (_label, mail, password) => {
        const { service, users, sign, attemptRepo } = build();
        users.seed(localAccount());

        await expectDomainError(
          service.login({ email: mail, password }, IP),
          'INVALID_CREDENTIALS',
        );

        expect(sign).not.toHaveBeenCalled();
        expect([...attemptRepo.reserved.keys()].sort()).toEqual([`email:${mail}`, `ip:${IP}`]);
        expect(attemptRepo.cleared).toEqual([]);
        expect(attemptRepo.released).toEqual([]);
      },
    );

    it('BR-001-16: a deactivated account gets the same INVALID_CREDENTIALS and keeps the reserved count', async () => {
      const { service, users, attemptRepo } = build();
      users.seed(localAccount({ status: 'deactivated' }));

      await expectDomainError(
        service.login({ email: 'local@example.test', password: 'correct-password' }, IP),
        'INVALID_CREDENTIALS',
      );
      expect(attemptRepo.reserved.get('email:local@example.test')).toBe(1);
    });

    it.each([
      ['email', 'email:local@example.test'],
      ['IP', `ip:${IP}`],
    ])(
      'BR-001-15: a banned %s is refused with TOO_MANY_ATTEMPTS even with the correct password',
      async (_label, key) => {
        const { service, users, attemptRepo, sessionRepo } = build();
        users.seed(localAccount());
        attemptRepo.block(key);

        await expectDomainError(
          service.login({ email: 'local@example.test', password: 'correct-password' }, IP),
          'TOO_MANY_ATTEMPTS',
        );
        expect(sessionRepo.stored).toEqual([]);
      },
    );

    it('BR-001-15: a refused attempt never reaches the password check', async () => {
      const { service, users, attemptRepo } = build();
      users.seed(localAccount());
      attemptRepo.block('email:local@example.test');
      const compared = vi.spyOn(users, 'validatePassword');

      await expectDomainError(
        service.login({ email: 'local@example.test', password: 'correct-password' }, IP),
        'TOO_MANY_ATTEMPTS',
      );

      expect(compared).not.toHaveBeenCalled();
      // The origin is not charged for an attempt refused on the email.
      expect(attemptRepo.reserved.has(`ip:${IP}`)).toBe(false);
    });
  });

  describe('logout', () => {
    it('BR-001-18: revokes the session on the server', async () => {
      const { service, users, sessionRepo } = build();
      users.seed(localAccount());
      await service.login({ email: 'local@example.test', password: 'correct-password' }, IP);
      const jti = sessionRepo.stored[0]?.id ?? '';

      await service.logout(jti);

      expect(sessionRepo.stored[0]?.revokedAt).toBeInstanceOf(Date);
    });
  });

  describe('verifyEmail and resendVerification', () => {
    function changeEmail(ctx: ReturnType<typeof build>, email: string) {
      const account = ctx.users.accounts.get(ID);
      if (account) account.email = email;
    }

    async function confirmationFor(ctx: ReturnType<typeof build>) {
      await ctx.service.resendVerification(ID);
      return ctx.email.verificationEmails.slice(-1)[0]?.token ?? '';
    }

    it('BR-001-05: a confirmation link confirms the address once', async () => {
      const ctx = build();
      ctx.users.seed(localAccount());
      const token = await confirmationFor(ctx);

      await ctx.service.verifyEmail(token);

      expect(ctx.users.accounts.get(ID)?.emailVerified).toBe(true);
      await expectDomainError(ctx.service.verifyEmail(token), 'INVALID_VERIFICATION_TOKEN');
    });

    it('BR-001-05: a link is refused 24 hours and 1 minute after it was issued, and works just inside', async () => {
      const ctx = build();
      ctx.users.seed(localAccount());
      const late = await confirmationFor(ctx);
      ctx.clock.advance(24 * HOUR + MINUTE);
      await expectDomainError(ctx.service.verifyEmail(late), 'INVALID_VERIFICATION_TOKEN');

      const inside = await confirmationFor(ctx);
      ctx.clock.advance(24 * HOUR - MINUTE);
      await expect(ctx.service.verifyEmail(inside)).resolves.toBeUndefined();
    });

    it('BR-001-05: a new link makes the earlier one stop working', async () => {
      const ctx = build();
      ctx.users.seed(localAccount());
      const first = await confirmationFor(ctx);
      const second = await confirmationFor(ctx);

      await expectDomainError(ctx.service.verifyEmail(first), 'INVALID_VERIFICATION_TOKEN');
      await expect(ctx.service.verifyEmail(second)).resolves.toBeUndefined();
    });

    it('a link only confirms the address it was mailed to: after the email changed it is refused', async () => {
      const ctx = build();
      ctx.users.seed(localAccount());
      const token = await confirmationFor(ctx);
      changeEmail(ctx, 'changed@example.test');

      await expectDomainError(ctx.service.verifyEmail(token), 'INVALID_VERIFICATION_TOKEN');

      expect(ctx.users.accounts.get(ID)?.emailVerified).toBe(false);
    });

    it('the link is bound to the address, so a link for the new address confirms it', async () => {
      const ctx = build();
      ctx.users.seed(localAccount());
      changeEmail(ctx, 'changed@example.test');
      const token = await confirmationFor(ctx);

      await expect(ctx.service.verifyEmail(token)).resolves.toBeUndefined();

      expect(ctx.users.accounts.get(ID)?.emailVerified).toBe(true);
    });

    it('a token of another purpose is not a confirmation link', async () => {
      const ctx = build();
      ctx.users.seed(localAccount());
      await ctx.service.requestPasswordReset('local@example.test');
      await ctx.service.flushDeliveries();
      const resetToken = ctx.email.passwordResetEmails[0]?.token ?? '';

      await expectDomainError(ctx.service.verifyEmail(resetToken), 'INVALID_VERIFICATION_TOKEN');
    });

    it.each([
      ['an unknown user', undefined, 'USER_NOT_FOUND'],
      [
        'an OAuth-only account',
        localAccount({ providers: ['google'] }),
        'OAUTH_ACCOUNT_NEEDS_NO_VERIFICATION',
      ],
      [
        'an already verified account',
        localAccount({ emailVerified: true }),
        'EMAIL_ALREADY_VERIFIED',
      ],
    ])('resendVerification refuses %s and sends nothing', async (_label, seeded, code) => {
      const { service, users, email } = build();
      if (seeded) users.seed(seeded);

      await expectDomainError(service.resendVerification(ID), code);
      expect(email.verificationEmails).toEqual([]);
    });

    it('getVerificationStatus reports emailVerified (default false) and providers', async () => {
      const { service, users } = build();
      users.seed(localAccount({ providers: ['local', 'google'], emailVerified: undefined }));

      expect(await service.getVerificationStatus(ID)).toEqual({
        emailVerified: false,
        providers: ['local', 'google'],
      });
    });

    it('getVerificationStatus rejects an unknown user', async () => {
      const { service } = build();

      await expectDomainError(service.getVerificationStatus(ID), 'USER_NOT_FOUND');
    });
  });

  describe('password reset', () => {
    async function requestToken(ctx: ReturnType<typeof build>, address = 'local@example.test') {
      await ctx.service.requestPasswordReset(address);
      await ctx.service.flushDeliveries(); // the work is detached from the request (SC-05)
      return ctx.email.passwordResetEmails.slice(-1)[0]?.token ?? '';
    }

    it('BR-001-21: sends the reset email for a known address', async () => {
      const ctx = build();
      ctx.users.seed(localAccount());

      const token = await requestToken(ctx);

      expect(ctx.email.passwordResetEmails).toHaveLength(1);
      expect(ctx.email.passwordResetEmails[0]).toMatchObject({
        email: 'local@example.test',
        name: 'Local User',
      });
      expect(token).toMatch(/^[0-9a-f]{64}$/);
    });

    it('BR-001-21: resolves silently and sends nothing for an unknown address', async () => {
      const { service, email } = build();

      await expect(service.requestPasswordReset('nobody@example.test')).resolves.toBeUndefined();
      expect(email.passwordResetEmails).toEqual([]);
    });

    it('BR-001-16: sends nothing for a deactivated account, answering the same', async () => {
      const ctx = build();
      ctx.users.seed(localAccount({ status: 'closed' }));

      await expect(ctx.service.requestPasswordReset('local@example.test')).resolves.toBeUndefined();
      expect(ctx.email.passwordResetEmails).toEqual([]);
    });

    it.each(['closed', 'deactivated'] as const)(
      'SPEC-010 BR-010-14: a link spent after the account became %s changes nothing and answers the generic invalid-token',
      async (status) => {
        const ctx = build();
        ctx.users.seed(localAccount());
        const token = await requestToken(ctx); // issued while the account was active
        ctx.users.accounts.set(ID, { ...localAccount(), status });

        await expectDomainError(
          ctx.service.resetPassword(token, 'brand-new-password'),
          'INVALID_RESET_TOKEN',
        );

        expect(ctx.users.accounts.get(ID)?.password).toBe('correct-password');
      },
    );

    it('BR-001-24: works for a Google-only account and adds email-and-password sign-in', async () => {
      const ctx = build();
      ctx.users.seed(localAccount({ providers: ['google'], password: undefined }));
      const token = await requestToken(ctx);

      await ctx.service.resetPassword(token, 'new-password');

      expect(ctx.users.accounts.get(ID)).toMatchObject({
        password: 'new-password',
        providers: ['google', 'local'],
      });
    });

    it('BR-001-22: a recovery link works once', async () => {
      const ctx = build();
      ctx.users.seed(localAccount());
      const token = await requestToken(ctx);

      await ctx.service.resetPassword(token, 'new-password');

      await expectDomainError(
        ctx.service.resetPassword(token, 'other-password'),
        'INVALID_RESET_TOKEN',
      );
      expect(ctx.users.accounts.get(ID)?.password).toBe('new-password');
    });

    it('BR-001-22: a recovery link is refused 61 minutes after issue and works at 59', async () => {
      const ctx = build();
      ctx.users.seed(localAccount());
      const stale = await requestToken(ctx);
      ctx.clock.advance(61 * MINUTE);
      await expectDomainError(
        ctx.service.resetPassword(stale, 'new-password'),
        'INVALID_RESET_TOKEN',
      );

      const fresh = await requestToken(ctx);
      ctx.clock.advance(59 * MINUTE);
      await expect(ctx.service.resetPassword(fresh, 'new-password')).resolves.toBeUndefined();
    });

    it('BR-001-22: of two requested links only the newest works', async () => {
      const ctx = build();
      ctx.users.seed(localAccount());
      const first = await requestToken(ctx);
      const second = await requestToken(ctx);

      await expectDomainError(
        ctx.service.resetPassword(first, 'new-password'),
        'INVALID_RESET_TOKEN',
      );
      await expect(ctx.service.resetPassword(second, 'new-password')).resolves.toBeUndefined();
    });

    it('BR-001-19: a reset ends every session of the account and signs nobody in', async () => {
      const ctx = build();
      ctx.users.seed(localAccount());
      await ctx.service.login({ email: 'local@example.test', password: 'correct-password' }, IP);
      await ctx.service.login({ email: 'local@example.test', password: 'correct-password' }, IP);
      const token = await requestToken(ctx);
      const before = ctx.sessionRepo.stored.length;

      const result: unknown = await ctx.service.resetPassword(token, 'new-password');

      expect(result).toBeUndefined();
      expect(ctx.sessionRepo.stored).toHaveLength(before);
      expect(ctx.sessionRepo.stored.every((s) => s.revokedAt)).toBe(true);
    });

    it('BR-001-22: a mail failure is swallowed and logged without the address', async () => {
      const ctx = build();
      ctx.users.seed(localAccount());
      const logged = spyOnLogger();
      ctx.email.sendPasswordResetEmail = async () => {
        throw new Error('SMTP refused local@example.test');
      };

      await expect(ctx.service.requestPasswordReset('local@example.test')).resolves.toBeUndefined();
      await ctx.service.flushDeliveries();

      expect(logged.loggedText()).toContain('Password reset email could not be sent');
      expect(logged.loggedText()).not.toContain('local@example.test');
    });
  });

  describe('profile reads and updates', () => {
    it('getFullProfile returns the mapped profile', async () => {
      const { service, users } = build();
      users.seed(localAccount({ role: 'premium', subscriptionStatus: 'past_due' }));

      const profile = await service.getFullProfile(ID);

      expect(profile).toMatchObject({
        _id: ID,
        email: 'local@example.test',
        role: 'premium',
        subscriptionStatus: 'past_due',
      });
      expect(profile).not.toHaveProperty('password');
    });

    it('getFullProfile rejects an unknown user', async () => {
      const { service } = build();

      await expectDomainError(service.getFullProfile(ID), 'USER_NOT_FOUND');
    });

    it('BR-001-26 / D-63: the email is accepted only when it repeats the current one', async () => {
      const { service, users } = build();
      users.seed(localAccount());

      const same = await service.updateProfile(ID, {
        name: 'Renamed',
        email: ' LOCAL@example.test ',
      });
      expect(same).toMatchObject({ name: 'Renamed', email: 'local@example.test' });

      await expectDomainError(
        service.updateProfile(ID, { name: 'Other', email: 'another@example.test' }),
        'EMAIL_CHANGE_UNAVAILABLE',
      );
      // Refused as a whole: the name in the same body was not applied either.
      expect(users.accounts.get(ID)).toMatchObject({
        name: 'Renamed',
        email: 'local@example.test',
      });
    });

    it('BR-001-27: passes the phone on, and null removes it', async () => {
      const { service, users } = build();
      users.seed(localAccount());

      expect((await service.updateProfile(ID, { phone: '+5584999991234' })).phone).toBe(
        '+5584999991234',
      );
      expect((await service.updateProfile(ID, { phone: null })).phone).toBeUndefined();
    });

    it('updateProfile for an unknown user with an email is USER_NOT_FOUND', async () => {
      const { service } = build();

      await expectDomainError(
        service.updateProfile(ID, { email: 'a@example.test' }),
        'USER_NOT_FOUND',
      );
    });

    it('updateProfile returns the updated, mapped profile', async () => {
      const { service, users } = build();
      users.seed(localAccount());

      const updated = await service.updateProfile(ID, { name: 'Renamed', phone: '11999990000' });

      expect(updated.name).toBe('Renamed');
      expect(updated.phone).toBe('11999990000');
      expect(updated).not.toHaveProperty('password');
    });
  });

  describe('changePassword', () => {
    it('updates the password after checking the current one', async () => {
      const { service, users } = build();
      users.seed(localAccount());

      await service.changePassword(ID, 'current-session', 'correct-password', 'new-password', IP);

      expect(users.accounts.get(ID)?.password).toBe('new-password');
    });

    it('BR-001-19: ends every other session and keeps the current one', async () => {
      const { service, users, sessionRepo } = build();
      users.seed(localAccount());
      const credentials = { email: 'local@example.test', password: 'correct-password' };
      await service.login(credentials, IP);
      await service.login(credentials, IP);
      const [current, other] = sessionRepo.stored;

      await service.changePassword(ID, current?.id ?? '', 'correct-password', 'new-password', IP);

      expect(current?.revokedAt).toBeUndefined();
      expect(other?.revokedAt).toBeInstanceOf(Date);
    });

    it.each([
      ['an unknown user', undefined, 'USER_NOT_FOUND'],
      [
        'an OAuth-only account',
        localAccount({ providers: ['google'], password: undefined }),
        'OAUTH_ACCOUNT_HAS_NO_PASSWORD',
      ],
    ])('refuses %s', async (_label, seeded, code) => {
      const { service, users } = build();
      if (seeded) users.seed(seeded);

      await expectDomainError(service.changePassword(ID, 's', 'x', 'new-password', IP), code);
    });

    it('BR-001-28: refuses a wrong current password and leaves everything unchanged', async () => {
      const { service, users, sessionRepo } = build();
      users.seed(localAccount());
      await service.login({ email: 'local@example.test', password: 'correct-password' }, IP);

      await expectDomainError(
        service.changePassword(ID, 's', 'wrong-password', 'new-password', IP),
        'CURRENT_PASSWORD_INCORRECT',
      );
      expect(users.accounts.get(ID)?.password).toBe('correct-password');
      expect(sessionRepo.stored.every((s) => !s.revokedAt)).toBe(true);
    });
  });

  describe('changePassword throttle (SC-04, BR-001-15)', () => {
    it('reserves an attempt first; a wrong current password keeps it, a right one gives it back', async () => {
      const { service, users, attemptRepo } = build();
      users.seed(localAccount());

      await expectDomainError(
        service.changePassword(ID, 's', 'wrong-password', 'new-password', IP),
        'CURRENT_PASSWORD_INCORRECT',
      );
      expect(attemptRepo.reserved.get('email:local@example.test')).toBe(1);

      await service.changePassword(ID, 's', 'correct-password', 'new-password', IP);
      expect(attemptRepo.cleared).toEqual(['email:local@example.test']);
      expect(attemptRepo.released).toEqual([`ip:${IP}`]);
    });

    it('is refused with TOO_MANY_ATTEMPTS before the password is compared, and changes nothing', async () => {
      const { service, users, attemptRepo } = build();
      users.seed(localAccount());
      attemptRepo.block(`ip:${IP}`);
      const compared = vi.spyOn(users, 'validatePassword');

      await expectDomainError(
        service.changePassword(ID, 's', 'correct-password', 'new-password', IP),
        'TOO_MANY_ATTEMPTS',
      );

      expect(compared).not.toHaveBeenCalled();
      expect(users.accounts.get(ID)?.password).toBe('correct-password');
    });
  });

  describe('reauthenticate (SPEC-010 BR-010-13)', () => {
    it('accepts the current password, counted like a sign-in: the attempt is reserved then given back', async () => {
      const { service, users, attemptRepo } = build();
      users.seed(localAccount());

      await service.reauthenticate(ID, { password: 'correct-password' }, IP);

      expect(attemptRepo.cleared).toEqual(['email:local@example.test']);
      expect(attemptRepo.released).toEqual([`ip:${IP}`]);
    });

    it.each([
      ['an account without the field is at 0', undefined, 0],
      ['an account at version 3', 3, 3],
    ])(
      'DL-001-02: answers the credential version the password was verified against (%s)',
      async (_label, stored, expected) => {
        const { service, users } = build();
        users.seed(localAccount({ credentialVersion: stored }));

        await expect(
          service.reauthenticate(ID, { password: 'correct-password' }, IP),
        ).resolves.toEqual({ credentialVersion: expected });
      },
    );

    it('DL-001-02: the version is the one of the document whose hash was compared, even if the account moves on while it waits', async () => {
      const { service, users } = build();
      users.seed(localAccount({ credentialVersion: 2 }));
      const compare = users.validatePassword.bind(users);
      vi.spyOn(users, 'validatePassword').mockImplementation(async (...args) => {
        const verified = await compare(...args); // a snapshot at version 2
        const account = users.accounts.get(ID);
        if (account) account.credentialVersion = 3; // a reset lands during the comparison
        return verified;
      });

      await expect(
        service.reauthenticate(ID, { password: 'correct-password' }, IP),
      ).resolves.toEqual({ credentialVersion: 2 });
    });

    it('DL-001-02: a Google code answers the version read right after it was spent for the account', async () => {
      const { service, users, tokenRepo, clock } = build();
      users.seed(localAccount({ providers: ['local', 'google'], credentialVersion: 5 }));
      const tokens = new AccountTokenService(tokenRepo as unknown as AccountTokenRepository, clock);
      const mine = await tokens.issue(ID, 'google_exchange');

      await expect(service.reauthenticate(ID, { googleCode: mine }, IP)).resolves.toEqual({
        credentialVersion: 5,
      });
    });

    it('refuses a wrong password with CURRENT_PASSWORD_INCORRECT and keeps the attempt counted', async () => {
      const { service, users, attemptRepo } = build();
      users.seed(localAccount());

      await expectDomainError(
        service.reauthenticate(ID, { password: 'wrong' }, IP),
        'CURRENT_PASSWORD_INCORRECT',
      );
      expect(attemptRepo.reserved.get('email:local@example.test')).toBe(1);
    });

    it('is TOO_MANY_ATTEMPTS before any comparison once the origin is over the limit', async () => {
      const { service, users, attemptRepo } = build();
      users.seed(localAccount());
      attemptRepo.block(`ip:${IP}`);
      const compared = vi.spyOn(users, 'validatePassword');

      await expectDomainError(
        service.reauthenticate(ID, { password: 'correct-password' }, IP),
        'TOO_MANY_ATTEMPTS',
      );
      expect(compared).not.toHaveBeenCalled();
    });

    it.each([
      ['an unknown account', undefined, { password: 'x' }, 'USER_NOT_FOUND'],
      [
        'a Google-only account asked for a password',
        localAccount({ providers: ['google'], password: undefined }),
        { password: 'x' },
        'OAUTH_ACCOUNT_HAS_NO_PASSWORD',
      ],
      [
        'an account with no way to prove it, by password',
        localAccount({ providers: [], password: undefined }),
        { password: 'x' },
        'REAUTHENTICATION_UNAVAILABLE',
      ],
      [
        'an account with no way to prove it, by Google',
        localAccount({ providers: [], password: undefined }),
        { googleCode: 'code' },
        'REAUTHENTICATION_UNAVAILABLE',
      ],
    ])('refuses %s', async (_label, seeded, proof, code) => {
      const { service, users } = build();
      if (seeded) users.seed(seeded);

      await expectDomainError(service.reauthenticate(ID, proof, IP), code);
    });

    it('accepts a fresh Google code of the same account, once; another account’s or a reused code is INVALID_GOOGLE_CODE', async () => {
      const { service, users, tokenRepo, clock } = build();
      users.seed(localAccount({ providers: ['local', 'google'] }));
      const tokens = new AccountTokenService(tokenRepo as unknown as AccountTokenRepository, clock);
      const mine = await tokens.issue(ID, 'google_exchange');
      const theirs = await tokens.issue('64b000000000000000000002', 'google_exchange');

      await expectDomainError(
        service.reauthenticate(ID, { googleCode: theirs }, IP),
        'INVALID_GOOGLE_CODE',
      );
      await service.reauthenticate(ID, { googleCode: mine }, IP);
      await expectDomainError(
        service.reauthenticate(ID, { googleCode: mine }, IP),
        'INVALID_GOOGLE_CODE',
      );
      // The other account's code was not burned by the refusal.
      expect(await tokens.consume(theirs, 'google_exchange')).toMatchObject({
        userId: '64b000000000000000000002',
      });
    });
  });

  describe('endAllSessionsAndLinks (SPEC-010 BR-010-14)', () => {
    it('revokes the sessions and removes the unused links', async () => {
      const { service, users, sessionRepo, tokenRepo, clock } = build();
      users.seed(localAccount());
      await service.login({ email: 'local@example.test', password: 'correct-password' }, IP);
      await new AccountTokenService(tokenRepo as unknown as AccountTokenRepository, clock).issue(
        ID,
        'account_recovery',
      );

      await service.endAllSessionsAndLinks(ID);

      expect(sessionRepo.stored.every((s) => s.revokedAt instanceof Date)).toBe(true);
      expect(tokenRepo.stored.filter((t) => t.userId === ID && !t.usedAt)).toEqual([]);
    });

    it('attempts both steps and rethrows the failure', async () => {
      const { service, sessionRepo, tokenRepo } = build();
      vi.spyOn(sessionRepo, 'revokeAllForUser').mockRejectedValueOnce(new Error('db down'));
      const links = vi.spyOn(tokenRepo, 'deleteAllUnusedForUser');

      await expect(service.endAllSessionsAndLinks(ID)).rejects.toThrow('db down');
      expect(links).toHaveBeenCalledWith(ID);
    });
  });

  describe('setPassword', () => {
    it('sets a password on an OAuth-only account and adds the local provider', async () => {
      const { service, users } = build();
      users.seed(localAccount({ providers: ['google'], password: undefined }));

      await service.setPassword(ID, 'current-session', 'new-password');

      expect(users.accounts.get(ID)).toMatchObject({
        password: 'new-password',
        providers: ['google', 'local'],
      });
    });

    it('BR-001-19: ends every other session and keeps the current one', async () => {
      const { service, users, sessionRepo } = build();
      users.seed(localAccount({ providers: ['google'], password: undefined }));
      const seeded = users.accounts.get(ID);
      if (!seeded) throw new Error('the account was just seeded');
      await service.startSession(seeded);
      await service.startSession(seeded);
      const [current, other] = sessionRepo.stored;

      await service.setPassword(ID, current?.id ?? '', 'new-password');

      expect(current?.revokedAt).toBeUndefined();
      expect(other?.revokedAt).toBeInstanceOf(Date);
    });

    it.each([
      ['an unknown user', undefined, 'USER_NOT_FOUND'],
      ['an account that already has a password', localAccount(), 'PASSWORD_ALREADY_SET'],
    ])('refuses %s', async (_label, seeded, code) => {
      const { service, users } = build();
      if (seeded) users.seed(seeded);

      await expectDomainError(service.setPassword(ID, 'current-session', 'new-password'), code);
    });
  });

  // DL-001-02: a session carries the credential version of the document that proved the
  // credential; every credential change moves the version in the write that stores the password.
  describe('credential version (DL-001-02)', () => {
    const credentials = { email: 'local@example.test', password: 'correct-password' };

    it('stamps the session with the version of the document the password check returned', async () => {
      const { service, users, sessionRepo } = build();
      users.seed(localAccount({ credentialVersion: 4 }));

      await service.login(credentials, IP);

      expect(sessionRepo.stored.map((s) => s.credentialVersion)).toEqual([4]);
    });

    it('stamps 0 for an account that predates the field', async () => {
      const { service, users, sessionRepo } = build();
      users.seed(localAccount());

      await service.login(credentials, IP);

      expect(sessionRepo.stored.map((s) => s.credentialVersion)).toEqual([0]);
    });

    it('a reset that completes between the password check and the session leaves a session of the OLD version', async () => {
      const { service, users, sessionRepo } = build();
      users.seed(localAccount({ credentialVersion: 1 }));
      const check = users.validatePassword.bind(users);
      vi.spyOn(users, 'validatePassword').mockImplementation(async (mail, password) => {
        const verified = await check(mail, password);
        await users.setPassword(ID, 'reset-password'); // the whole reset lands in the gap
        return verified;
      });

      await service.login(credentials, IP);

      // The account is at version 2 now; the session says 1, which JwtStrategy refuses.
      expect(users.accounts.get(ID)?.credentialVersion).toBe(2);
      expect(sessionRepo.stored.map((s) => s.credentialVersion)).toEqual([1]);
    });

    it('a reset bumps the version once and revokes every session', async () => {
      const ctx = build();
      ctx.users.seed(localAccount({ credentialVersion: 2 }));
      await ctx.service.login(credentials, IP);
      await ctx.service.requestPasswordReset('local@example.test');
      await ctx.service.flushDeliveries();
      const token = ctx.email.passwordResetEmails.slice(-1)[0]?.token ?? '';

      await ctx.service.resetPassword(token, 'new-password');

      expect(ctx.users.accounts.get(ID)?.credentialVersion).toBe(3);
      expect(ctx.sessionRepo.stored.every((s) => s.revokedAt)).toBe(true);
    });

    it('BR-001-19: change-password binds the current session to the new version and ends the others', async () => {
      const { service, users, sessionRepo } = build();
      users.seed(localAccount({ credentialVersion: 2 }));
      await service.login(credentials, IP);
      await service.login(credentials, IP);
      const [current, other] = sessionRepo.stored;

      await service.changePassword(ID, current?.id ?? '', 'correct-password', 'new-password', IP);

      expect(users.accounts.get(ID)?.credentialVersion).toBe(3);
      expect(current).toMatchObject({ credentialVersion: 3 });
      expect(current?.revokedAt).toBeUndefined();
      expect(other).toMatchObject({ credentialVersion: 2 });
      expect(other?.revokedAt).toBeInstanceOf(Date);
    });

    it('BR-001-28: change-password refuses with UNAUTHENTICATED and writes nothing when the credential changed after the check', async () => {
      const { service, users, sessionRepo } = build();
      users.seed(localAccount({ credentialVersion: 2 }));
      await service.login(credentials, IP);
      const check = users.validatePassword.bind(users);
      vi.spyOn(users, 'validatePassword').mockImplementation(async (mail, password) => {
        const verified = await check(mail, password);
        await users.setPassword(ID, 'reset-password'); // a competing change: version 3
        return verified;
      });

      await expectDomainError(
        service.changePassword(ID, sessionRepo.stored[0]?.id ?? '', 'correct-password', 'mine', IP),
        'UNAUTHENTICATED',
      );

      expect(users.accounts.get(ID)).toMatchObject({
        password: 'reset-password',
        credentialVersion: 3,
      });
    });

    it('set-password bumps the version, binds the current session and ends the others', async () => {
      const { service, users, sessionRepo } = build();
      users.seed(localAccount({ providers: ['google'], password: undefined }));
      const first = await service.startSession(users.accounts.get(ID) as UserAccount);
      await service.startSession(users.accounts.get(ID) as UserAccount);
      expect(first.accessToken).toBe(`token-for-${ID}`);
      const [current, other] = sessionRepo.stored;

      await service.setPassword(ID, current?.id ?? '', 'new-password');

      expect(users.accounts.get(ID)?.credentialVersion).toBe(1);
      expect(current).toMatchObject({ credentialVersion: 1 });
      expect(current?.revokedAt).toBeUndefined();
      expect(other?.revokedAt).toBeInstanceOf(Date);
    });

    it('set-password refuses with UNAUTHENTICATED and writes nothing when the credential changed after the check', async () => {
      const { service, users } = build();
      users.seed(localAccount({ providers: ['google'], password: undefined }));
      const find = users.findById.bind(users);
      vi.spyOn(users, 'findById').mockImplementation(async (id) => {
        const found = find(id);
        const current = (await found) as FakeAccount;
        const snapshot = { ...current, providers: [...current.providers] };
        await users.setPassword(ID, 'recovered-password'); // recovery got there first
        return snapshot;
      });

      await expectDomainError(service.setPassword(ID, 's', 'mine'), 'UNAUTHENTICATED');

      expect(users.accounts.get(ID)?.password).toBe('recovered-password');
    });

    it('a Google-style account without the local provider cannot sign in by password', async () => {
      const { service, users, sessionRepo } = build();
      users.seed(localAccount({ providers: ['google'] })); // a hash is still in the document

      await expectDomainError(service.login(credentials, IP), 'INVALID_CREDENTIALS');

      expect(sessionRepo.stored).toEqual([]);
    });
  });
});
