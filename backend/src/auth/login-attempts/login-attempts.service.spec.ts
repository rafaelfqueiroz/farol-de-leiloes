// BR-001-15, SC-04: the keys and the decisions the throttle makes from what its repository returns.
// The window, count and ban arithmetic runs inside MongoDB (an aggregation-pipeline upsert), so it
// is proven against a real database with a fake clock in
// test/integration/auth-sessions-tokens.spec.ts (TS-02).
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../common/errors/domain-error.js';
import { FakeClock, MINUTE } from '../../../test/fakes/fake-clock.js';
import { FakeLoginAttemptsRepository } from '../../../test/fakes/fake-auth-repositories.js';
import type { LoginAttemptsRepository } from './login-attempts.repository.js';
import { LOGIN_ATTEMPT_RULE, LoginAttemptsService } from './login-attempts.service.js';

function build() {
  const repo = new FakeLoginAttemptsRepository();
  const service = new LoginAttemptsService(
    repo as unknown as LoginAttemptsRepository,
    new FakeClock(),
  );
  return { service, repo };
}

describe('LoginAttemptsService', () => {
  it('BR-001-15: the rule is 10 attempts in 15 minutes, then 15 minutes of refusal', () => {
    expect(LOGIN_ATTEMPT_RULE).toEqual({ limit: 10, windowMs: 15 * MINUTE, banMs: 15 * MINUTE });
  });

  it('reserves an attempt against the normalised email and the origin', async () => {
    const { service, repo } = build();

    await service.reserve('  Ana@Example.TEST ', '203.0.113.7');

    expect([...repo.reserved.keys()].sort()).toEqual(['email:ana@example.test', 'ip:203.0.113.7']);
  });

  it('SC-04: keys the origin by its normalised form (mapped IPv4, IPv6 /64)', async () => {
    const { service, repo } = build();

    await service.reserve('a@example.test', '::ffff:203.0.113.7');
    await service.reserve('b@example.test', '2001:db8:1:2:aaaa:bbbb:cccc:dddd');

    expect([...repo.reserved.keys()]).toContain('ip:203.0.113.7');
    expect([...repo.reserved.keys()]).toContain('ip:2001:db8:1:2::/64');
  });

  it.each([
    ['the same email', 'email:ana@example.test'],
    ['the same origin', 'ip:203.0.113.7'],
  ])('refuses with TOO_MANY_ATTEMPTS while %s is banned', async (_label, key) => {
    const { service, repo } = build();
    repo.block(key);

    await expect(service.reserve('Ana@example.test', '203.0.113.7')).rejects.toEqual(
      new DomainError('TOO_MANY_ATTEMPTS'),
    );
  });

  it('does not charge the origin for an attempt refused on the email', async () => {
    const { service, repo } = build();
    repo.block('email:ana@example.test');

    await expect(service.reserve('ana@example.test', '203.0.113.7')).rejects.toBeInstanceOf(
      DomainError,
    );

    expect(repo.reserved.has('ip:203.0.113.7')).toBe(false);
  });

  it('allows when neither the email nor the origin is banned', async () => {
    const { service, repo } = build();
    repo.block('email:someone-else@example.test');

    await expect(service.reserve('ana@example.test', '203.0.113.7')).resolves.toBeUndefined();
  });

  it('BR-001-15: success clears the email counter and gives back one origin reservation', async () => {
    const { service, repo } = build();
    await service.reserve('ana@example.test', '203.0.113.7');
    await service.reserve('ana@example.test', '203.0.113.7');

    await service.recordSuccess('Ana@Example.test', '203.0.113.7');

    expect(repo.reserved.has('email:ana@example.test')).toBe(false);
    expect(repo.reserved.get('ip:203.0.113.7')).toBe(1);
  });
});
