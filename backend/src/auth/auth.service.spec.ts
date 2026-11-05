import { describe, expect, it, vi } from 'vitest';
import { AuthService } from './auth.service';
import type { UserAccount } from '../users/user-account';

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
      _id: { toString: () => ID },
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
