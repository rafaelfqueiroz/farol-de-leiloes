import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import { DomainError } from '../common/errors/domain-error';
import type { EmailService } from '../email/email.service';
import { SUBSCRIPTION_STATUSES } from '../users/subscription-status';
import type { UserAccount } from '../users/user-account';
import type { UsersService } from '../users/users.service';
import { FakeEmailSender } from '../../test/fakes/fake-email-sender';
import { FakeUsersService, type FakeAccount } from '../../test/fakes/fake-users-service';

type ServiceDeps = ConstructorParameters<typeof AuthService>;
const ID = '64b000000000000000000001';
const CREATED = new Date('2026-01-01T12:00:00.000Z');
const UPDATED = new Date('2026-01-02T12:00:00.000Z');

// AR-09 / SC-01: auth consumes the account contract and maps only the public profile fields.
describe('AuthService account contract (AR-09)', () => {
  function build() {
    const sign = vi.fn().mockReturnValue('signed-token');
    return {
      service: new AuthService(
        {} as ServiceDeps[0],
        { sign } as unknown as ServiceDeps[1],
        {} as ServiceDeps[2],
      ),
      sign,
    };
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

    const result = await service.googleLogin(account());

    expect(sign).toHaveBeenCalledWith({
      email: 'account@example.test',
      sub: ID,
      name: 'Test Account',
    });
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
        phone: undefined,
        cpf: undefined,
        dateOfBirth: undefined,
        sex: undefined,
        address: undefined,
        createdAt: CREATED,
        updatedAt: UPDATED,
      },
    });
  });

  it('normalizes ObjectId-like account ids through their explicit hex conversion', async () => {
    const { service, sign } = build();

    const result = await service.googleLogin(account({ _id: { toHexString: () => ID } }));

    expect(result.user._id).toBe(ID);
    expect(sign).toHaveBeenCalledWith({
      email: 'account@example.test',
      sub: ID,
      name: 'Test Account',
    });
  });

  it('preserves populated profile fields and omits credential fields', async () => {
    const { service } = build();
    const profile = {
      emailVerified: true,
      role: 'premium',
      subscriptionStatus: 'active' as const,
      providers: ['local', 'google'],
      phone: '00000000000',
      cpf: '00000000000',
      dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
      sex: 'other',
      address: { street: 'Test Street', city: 'Test City', state: 'SP', zipCode: '00000000' },
    };
    const user = { ...account(profile), password: 'fake-hash', resetPasswordToken: 'fake-token' };

    const result = await service.googleLogin(user);

    expect(result.user).toEqual({
      _id: ID,
      email: 'account@example.test',
      name: 'Test Account',
      createdAt: CREATED,
      updatedAt: UPDATED,
      ...profile,
    });
    expect(result.user).not.toHaveProperty('password');
    expect(result.user).not.toHaveProperty('resetPasswordToken');
  });
});

// toUserProfile is private; every public method that returns a profile goes through it.
describe('AuthService.toUserProfile mapping (AR-09, SC-15)', () => {
  const service = new AuthService(
    {} as ServiceDeps[0],
    { sign: vi.fn() } as unknown as ServiceDeps[1],
    {} as ServiceDeps[2],
  );

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
    return (await service.googleLogin(user)).user;
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
      emailVerificationToken: 'fake-token',
      resetPasswordToken: 'fake-token',
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
        'phone',
        'cpf',
        'dateOfBirth',
        'sex',
        'address',
        'createdAt',
        'updatedAt',
      ].sort(),
    );
  });

  it('copies the address fields and drops anything else on the address', async () => {
    const address = { street: 'Rua A', city: 'Santos', state: 'SP', zipCode: '11000000' };
    const user = account({ address: { ...address, _id: 'internal' } as UserAccount['address'] });

    expect((await profileOf(user)).address).toEqual(address);
  });

  it('returns detached values: new array, dates and address objects', async () => {
    const providers = ['local'];
    const address = { street: 'Rua A', city: 'Santos', state: 'SP', zipCode: '11000000' };
    const dateOfBirth = new Date('1990-05-06T00:00:00.000Z');
    const user = account({ providers, address, dateOfBirth });

    const profile = await profileOf(user);

    expect(profile.providers).not.toBe(providers);
    expect(profile.address).not.toBe(address);
    expect(profile.createdAt).not.toBe(CREATED);
    expect(profile.updatedAt).not.toBe(UPDATED);
    expect(profile.dateOfBirth).not.toBe(dateOfBirth);
    expect(profile.dateOfBirth?.toISOString()).toBe('1990-05-06T00:00:00.000Z');
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
  function build() {
    const users = new FakeUsersService();
    const email = new FakeEmailSender();
    const sign = vi.fn((payload: { sub: string }) => `token-for-${payload.sub}`);
    const service = new AuthService(
      users as unknown as UsersService,
      { sign } as unknown as ServiceDeps[1],
      email as unknown as EmailService,
    );
    return { service, users, email, sign };
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

  describe('register', () => {
    it('creates a local account, sends the verification email and returns token and profile', async () => {
      const { service, users, email } = build();

      const result = await service.register({
        email: 'new@example.test',
        password: 'a-password',
        name: 'New User',
      });

      // The fake assigns ids sequentially; the first account gets ID.
      expect(users.accounts.get(ID)?.providers).toEqual(['local']);
      expect(email.verificationEmails).toEqual([
        {
          email: 'new@example.test',
          token: `verification-token-for-${ID}`,
          name: 'New User',
        },
      ]);
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

    it('propagates EMAIL_ALREADY_REGISTERED without sending an email', async () => {
      const { service, users, email } = build();
      users.seed(localAccount());

      await expectDomainError(
        service.register({ email: 'local@example.test', password: 'x', name: 'Dup' }),
        'EMAIL_ALREADY_REGISTERED',
      );
      expect(email.verificationEmails).toEqual([]);
    });
  });

  describe('login', () => {
    it('signs a token with email, sub and name and returns the profile', async () => {
      const { service, users, sign } = build();
      users.seed(localAccount({ subscriptionStatus: 'active' }));

      const result = await service.login({
        email: 'local@example.test',
        password: 'correct-password',
      });

      expect(sign).toHaveBeenCalledWith({
        email: 'local@example.test',
        sub: ID,
        name: 'Local User',
      });
      expect(result.accessToken).toBe(`token-for-${ID}`);
      expect(result.user.subscriptionStatus).toBe('active');
      expect(result.user).not.toHaveProperty('password');
    });

    it.each([
      ['wrong password', 'local@example.test', 'wrong-password'],
      ['unknown email', 'nobody@example.test', 'correct-password'],
    ])('rejects %s with INVALID_CREDENTIALS and signs nothing', async (_label, mail, password) => {
      const { service, users, sign } = build();
      users.seed(localAccount());

      await expectDomainError(service.login({ email: mail, password }), 'INVALID_CREDENTIALS');
      expect(sign).not.toHaveBeenCalled();
    });
  });

  describe('verifyEmail and resendVerification', () => {
    it('verifyEmail hands the token to the users service', async () => {
      const { service, users } = build();

      await service.verifyEmail('some-token');

      expect(users.verifiedTokens).toEqual(['some-token']);
    });

    it('resendVerification sends a new verification email to an unverified local account', async () => {
      const { service, users, email } = build();
      users.seed(localAccount());

      await service.resendVerification(ID);

      expect(email.verificationEmails).toEqual([
        { email: 'local@example.test', token: `verification-token-for-${ID}`, name: 'Local User' },
      ]);
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
    it('sends the reset email for a known address', async () => {
      const { service, users, email } = build();
      users.seed(localAccount());

      await service.requestPasswordReset('local@example.test');

      expect(email.passwordResetEmails).toEqual([
        {
          email: 'local@example.test',
          token: 'reset-token-for-local@example.test',
          name: 'Local User',
        },
      ]);
    });

    it('resolves silently and sends nothing for an unknown address (no account enumeration)', async () => {
      const { service, email } = build();

      await expect(service.requestPasswordReset('nobody@example.test')).resolves.toBeUndefined();
      expect(email.passwordResetEmails).toEqual([]);
    });

    it('resetPassword hands token and new password to the users service', async () => {
      const { service, users } = build();

      await service.resetPassword('reset-token', 'new-password');

      expect(users.resetCalls).toEqual([{ token: 'reset-token', newPassword: 'new-password' }]);
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

    it('updateProfile and completeProfile return the updated, mapped profile', async () => {
      const { service, users } = build();
      users.seed(localAccount());

      const updated = await service.updateProfile(ID, { name: 'Renamed' });
      const completed = await service.completeProfile(ID, { phone: '11999990000' } as never);

      expect(updated.name).toBe('Renamed');
      expect(completed.phone).toBe('11999990000');
      expect(completed).not.toHaveProperty('password');
    });
  });

  describe('changePassword', () => {
    it('updates the password after checking the current one', async () => {
      const { service, users } = build();
      users.seed(localAccount());

      await service.changePassword(ID, 'correct-password', 'new-password');

      expect(users.accounts.get(ID)?.password).toBe('new-password');
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

      await expectDomainError(service.changePassword(ID, 'x', 'new-password'), code);
    });

    it('refuses a wrong current password and leaves the password unchanged', async () => {
      const { service, users } = build();
      users.seed(localAccount());

      await expectDomainError(
        service.changePassword(ID, 'wrong-password', 'new-password'),
        'CURRENT_PASSWORD_INCORRECT',
      );
      expect(users.accounts.get(ID)?.password).toBe('correct-password');
    });
  });

  describe('setPassword', () => {
    it('sets a password on an OAuth-only account and adds the local provider', async () => {
      const { service, users } = build();
      users.seed(localAccount({ providers: ['google'], password: undefined }));

      await service.setPassword(ID, 'new-password');

      expect(users.accounts.get(ID)).toMatchObject({
        password: 'new-password',
        providers: ['google', 'local'],
      });
    });

    it.each([
      ['an unknown user', undefined, 'USER_NOT_FOUND'],
      ['an account that already has a password', localAccount(), 'PASSWORD_ALREADY_SET'],
    ])('refuses %s', async (_label, seeded, code) => {
      const { service, users } = build();
      if (seeded) users.seed(seeded);

      await expectDomainError(service.setPassword(ID, 'new-password'), code);
    });
  });
});
