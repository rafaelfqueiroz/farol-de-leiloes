import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JwtStrategy } from './jwt.strategy';
import { DomainError } from '../../common/errors/domain-error';
import { CurrentUserResponseDto } from '../dto/auth-response.dto';
import { spyOnLogger } from '../../../test/support/logger-spy';

afterEach(() => vi.restoreAllMocks());

// Issue #75: the frontend derives hasSubscription from subscriptionStatus on /auth/me.
describe('JwtStrategy.validate', () => {
  function build(user: unknown) {
    const usersService = { findById: vi.fn().mockResolvedValue(user) };
    // Built without the passport constructor, which needs a real secret and Nest wiring.
    const strategy: JwtStrategy = Object.assign(Object.create(JwtStrategy.prototype), {
      usersService,
      logger: { warn: vi.fn() },
    });
    return strategy;
  }
  const payload = { sub: 'u1', email: 'ana.teste@example.test', name: 'Ana Teste' };
  const base = { emailVerified: true, providers: ['local'], role: 'standard' };

  it('carries the stored subscriptionStatus onto the authenticated user', async () => {
    const strategy = build({ ...base, subscriptionStatus: 'active' });
    await expect(strategy.validate(payload)).resolves.toMatchObject({
      subscriptionStatus: 'active',
    });
  });

  it.each([
    ['absent', undefined],
    ['null', null],
  ])('yields a null subscriptionStatus when it is %s', async (_label, stored) => {
    const strategy = build({ ...base, subscriptionStatus: stored });
    await expect(strategy.validate(payload)).resolves.toMatchObject({ subscriptionStatus: null });
  });

  it('refuses a token for an account that no longer exists', async () => {
    await expect(build(null).validate(payload)).rejects.toEqual(new DomainError('UNAUTHENTICATED'));
  });

  it('SC-15: warns about an unknown account without the raw user id', async () => {
    const logger = spyOnLogger();
    const strategy = build(null);
    (strategy as unknown as { logger: unknown }).logger = new Logger('JwtStrategy');
    await strategy.validate({ ...payload, sub: 'user-id-ficticio' }).catch(() => undefined);
    expect(logger.loggedText()).not.toBe('');
    expect(logger.loggedText()).not.toContain('user-id-ficticio');
  });

  it('exposes subscriptionStatus in the /auth/me response', async () => {
    const user = await build({ ...base, subscriptionStatus: 'past_due' }).validate(payload);
    expect(new CurrentUserResponseDto(user).subscriptionStatus).toBe('past_due');
  });
});
