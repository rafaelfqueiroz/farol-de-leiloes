import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JwtStrategy } from './jwt.strategy.js';
import { logContextFields, runWithLogContext } from '../../common/observability/log-context.js';
import { hashUserId } from '../../common/observability/user-hash.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { CurrentUserResponseDto } from '../dto/auth-response.dto.js';
import { spyOnLogger } from '../../../test/support/logger-spy.js';

afterEach(() => vi.restoreAllMocks());

// Issue #75: the frontend derives hasSubscription from subscriptionStatus on /auth/me.
describe('JwtStrategy.validate', () => {
  function build(user: unknown, logHashSecret?: string, sessionActive = true) {
    const usersService = { findById: vi.fn().mockResolvedValue(user) };
    const sessions = { isActive: vi.fn().mockResolvedValue(sessionActive) };
    // Built without the passport constructor, which needs a real secret and Nest wiring.
    const strategy: JwtStrategy = Object.assign(Object.create(JwtStrategy.prototype), {
      usersService,
      sessions,
      logger: { warn: vi.fn() },
      logHashSecret,
    });
    return strategy;
  }
  const payload = { sub: 'u1', jti: 'session-1' };
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

  it('BR-001-17: role and plan come from the database, the token carries neither', async () => {
    const user = await build({
      ...base,
      email: 'ana.teste@example.test',
      name: 'Ana Teste',
      subscriptionStatus: 'active',
    }).validate(payload);
    expect(user).toMatchObject({
      userId: 'u1',
      sessionId: 'session-1',
      email: 'ana.teste@example.test',
      name: 'Ana Teste',
      role: 'standard',
    });
  });

  it("BR-001-18: refuses a token whose session is revoked, expired or not this account's", async () => {
    const strategy = build({ ...base }, undefined, false);
    await expect(strategy.validate(payload)).rejects.toEqual(new DomainError('UNAUTHENTICATED'));
  });

  it.each([
    ['without a jti', { sub: 'u1' }],
    ['with an empty jti', { sub: 'u1', jti: '' }],
    ['with a non-string jti', { sub: 'u1', jti: 7 }],
  ])('BR-001-17: refuses a token %s (issued before sessions)', async (_label, claims) => {
    await expect(build({ ...base }).validate(claims as never)).rejects.toEqual(
      new DomainError('UNAUTHENTICATED'),
    );
  });

  it.each(['deactivated', 'closed'])(
    'BR-001-16: refuses a session of a %s account on its next request',
    async (status) => {
      await expect(build({ ...base, status }).validate(payload)).rejects.toEqual(
        new DomainError('UNAUTHENTICATED'),
      );
    },
  );

  it('treats an account with no status as active (AR-28)', async () => {
    await expect(build({ ...base, status: undefined }).validate(payload)).resolves.toMatchObject({
      userId: 'u1',
    });
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

  describe('AR-46: the hashed user joins the request log context', () => {
    const SECRET = 'test-log-hash-secret-not-a-real-one-000';

    it('sets the HMAC of the user id, never the id', async () => {
      const strategy = build({ ...base, subscriptionStatus: null }, SECRET);
      const fields = await runWithLogContext({ correlationId: 'req-12345678' }, async () => {
        await strategy.validate(payload);
        return logContextFields();
      });
      expect(fields).toEqual({
        correlationId: 'req-12345678',
        userHash: hashUserId(SECRET, 'u1'),
      });
    });

    it('logs no user at all without LOG_HASH_SECRET', async () => {
      const strategy = build({ ...base, subscriptionStatus: null });
      const fields = await runWithLogContext({ correlationId: 'req-12345678' }, async () => {
        await strategy.validate(payload);
        return logContextFields();
      });
      expect(fields).toEqual({ correlationId: 'req-12345678' });
    });

    it('warns about a vanished account without its raw id (SC-15)', async () => {
      const strategy = build(null, SECRET);
      await expect(strategy.validate(payload)).rejects.toBeInstanceOf(DomainError);
      const warn = (strategy as unknown as { logger: { warn: ReturnType<typeof vi.fn> } }).logger
        .warn;
      expect(JSON.stringify(warn.mock.calls)).not.toContain('u1');
    });
  });
});
