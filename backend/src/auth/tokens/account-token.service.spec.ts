// BR-001-05, BR-001-22, BR-001-23, SC-06: one-time tokens, against an in-memory repository and a
// fake clock (TS-03, TS-06). The atomicity of `consume` under concurrency is proven against MongoDB
// in test/integration/auth-sessions-tokens.spec.ts (TS-02).
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { FakeClock, HOUR, MINUTE, SECOND } from '../../../test/fakes/fake-clock.js';
import { FakeAccountTokenRepository } from '../../../test/fakes/fake-auth-repositories.js';
import { ACCOUNT_TOKEN_TTL_MS } from './account-token-purposes.js';
import type { AccountTokenRepository } from './account-token.repository.js';
import { AccountTokenService, hashAccountToken } from './account-token.service.js';

const USER = '64b000000000000000000001';
const OTHER_USER = '64b000000000000000000002';

function build() {
  const repo = new FakeAccountTokenRepository();
  const clock = new FakeClock();
  const service = new AccountTokenService(repo as unknown as AccountTokenRepository, clock);
  return { service, repo, clock };
}

describe('AccountTokenService', () => {
  it('BR-001-23: a token is 32 random bytes in hex, never the same twice', async () => {
    const { service } = build();

    const first = await service.issue(USER, 'email_confirmation');
    const second = await service.issue(USER, 'account_recovery');

    // 32 bytes = 256 bits = 64 hex characters, at least the 128 bits the spec asks for.
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toBe(second);
  });

  it('SC-06: stores the SHA-256 of the token and never the token', async () => {
    const { service, repo } = build();

    const plain = await service.issue(USER, 'account_recovery');

    const stored = repo.stored[0];
    expect(stored?.tokenHash).toBe(createHash('sha256').update(plain).digest('hex'));
    expect(stored?.tokenHash).toBe(hashAccountToken(plain));
    expect(JSON.stringify(repo.stored)).not.toContain(plain);
  });

  it.each([
    ['email_confirmation', 24 * HOUR],
    ['account_recovery', HOUR],
    ['google_exchange', 60 * SECOND],
  ] as const)('%s expires %d ms after it is issued', async (purpose, lifetime) => {
    const { service, repo, clock } = build();
    await service.issue(USER, purpose);

    expect(repo.stored[0]?.expiresAt).toEqual(new Date(clock.now().getTime() + lifetime));
    expect(ACCOUNT_TOKEN_TTL_MS[purpose]).toBe(lifetime);
  });

  it('BR-001-05: a confirmation link works once', async () => {
    const { service } = build();
    const plain = await service.issue(USER, 'email_confirmation');

    await expect(service.consume(plain, 'email_confirmation')).resolves.toEqual({
      userId: USER,
      purpose: 'email_confirmation',
    });
    await expect(service.consume(plain, 'email_confirmation')).resolves.toBeNull();
  });

  it('BR-001-05: a confirmation link works at 24 hours and fails 24 hours and 1 minute after issue', async () => {
    const inside = build();
    const early = await inside.service.issue(USER, 'email_confirmation');
    inside.clock.advance(24 * HOUR - MINUTE);
    await expect(inside.service.consume(early, 'email_confirmation')).resolves.not.toBeNull();

    const outside = build();
    const late = await outside.service.issue(USER, 'email_confirmation');
    outside.clock.advance(24 * HOUR + MINUTE);
    await expect(outside.service.consume(late, 'email_confirmation')).resolves.toBeNull();
  });

  it('BR-001-22: a recovery link works at 59 minutes and fails at 61 minutes', async () => {
    const inside = build();
    const early = await inside.service.issue(USER, 'account_recovery');
    inside.clock.advance(59 * MINUTE);
    await expect(inside.service.consume(early, 'account_recovery')).resolves.not.toBeNull();

    const outside = build();
    const late = await outside.service.issue(USER, 'account_recovery');
    outside.clock.advance(61 * MINUTE);
    await expect(outside.service.consume(late, 'account_recovery')).resolves.toBeNull();
  });

  it('a token is refused for a purpose other than the one it was issued for', async () => {
    const { service } = build();
    const plain = await service.issue(USER, 'email_confirmation');

    await expect(service.consume(plain, 'account_recovery')).resolves.toBeNull();
    // ...and the wrong-purpose attempt did not spend it.
    await expect(service.consume(plain, 'email_confirmation')).resolves.not.toBeNull();
  });

  it('BR-001-05/22: a new token of the same user and purpose kills the earlier unused one', async () => {
    const { service } = build();
    const first = await service.issue(USER, 'account_recovery');
    const second = await service.issue(USER, 'account_recovery');

    await expect(service.consume(first, 'account_recovery')).resolves.toBeNull();
    await expect(service.consume(second, 'account_recovery')).resolves.not.toBeNull();
  });

  it('issuing for one user or purpose leaves the others alone', async () => {
    const { service } = build();
    const mine = await service.issue(USER, 'account_recovery');
    const theirs = await service.issue(OTHER_USER, 'account_recovery');
    const confirmation = await service.issue(USER, 'email_confirmation');

    await expect(service.consume(mine, 'account_recovery')).resolves.not.toBeNull();
    await expect(service.consume(theirs, 'account_recovery')).resolves.not.toBeNull();
    await expect(service.consume(confirmation, 'email_confirmation')).resolves.not.toBeNull();
  });

  it('BR-001-22: revokeUnused makes every outstanding link of the purpose stop working', async () => {
    const { service } = build();
    const plain = await service.issue(USER, 'account_recovery');

    await service.revokeUnused(USER, 'account_recovery');

    await expect(service.consume(plain, 'account_recovery')).resolves.toBeNull();
  });

  it.each(['', 'not-a-token', 'z'.repeat(64)])('refuses %j as unknown', async (junk) => {
    const { service } = build();
    await service.issue(USER, 'account_recovery');

    await expect(service.consume(junk, 'account_recovery')).resolves.toBeNull();
  });

  it('refuses a non-string token without touching the repository', async () => {
    const { service } = build();

    await expect(
      service.consume({ $ne: null } as unknown as string, 'account_recovery'),
    ).resolves.toBeNull();
  });
});

describe('AccountTokenService google_signup (BR-001-09, SPEC-010 BR-010-01)', () => {
  const PROFILE = { googleId: 'g-1', email: 'ana@example.test', name: 'Ana' };

  it('BR-001-09: the code lives 15 minutes', () => {
    expect(ACCOUNT_TOKEN_TTL_MS.google_signup).toBe(15 * MINUTE);
  });

  it('BR-001-09: a code is 32 random bytes in hex and stores the profile under its hash only', async () => {
    const { service, repo } = build();

    const code = await service.issueGoogleSignup(PROFILE);

    expect(code).toMatch(/^[0-9a-f]{64}$/);
    expect(repo.stored[0]).toMatchObject({
      purpose: 'google_signup',
      tokenHash: hashAccountToken(code),
      profile: PROFILE,
    });
    expect(repo.stored[0]?.userId).toBeUndefined();
    expect(JSON.stringify(repo.stored)).not.toContain(code);
  });

  it('BR-001-09: peeking returns the profile without spending the code', async () => {
    const { service } = build();
    const code = await service.issueGoogleSignup(PROFILE);

    await expect(service.peekGoogleSignup(code)).resolves.toEqual(PROFILE);
    await expect(service.peekGoogleSignup(code)).resolves.toEqual(PROFILE);
    await expect(service.consumeGoogleSignup(code)).resolves.toEqual(PROFILE);
  });

  it('BR-001-09: consuming works once and leaves no personal data behind', async () => {
    const { service, repo } = build();
    const code = await service.issueGoogleSignup(PROFILE);

    await expect(service.consumeGoogleSignup(code)).resolves.toEqual(PROFILE);
    await expect(service.consumeGoogleSignup(code)).resolves.toBeNull();
    await expect(service.peekGoogleSignup(code)).resolves.toBeNull();
    expect(repo.stored).toEqual([]);
  });

  it('BR-001-09: works at 14 minutes and fails at 16 minutes', async () => {
    const inside = build();
    const early = await inside.service.issueGoogleSignup(PROFILE);
    inside.clock.advance(14 * MINUTE);
    await expect(inside.service.peekGoogleSignup(early)).resolves.toEqual(PROFILE);

    const outside = build();
    const late = await outside.service.issueGoogleSignup(PROFILE);
    outside.clock.advance(16 * MINUTE);
    await expect(outside.service.peekGoogleSignup(late)).resolves.toBeNull();
    await expect(outside.service.consumeGoogleSignup(late)).resolves.toBeNull();
  });

  it('BR-010-01: discarding deletes the unused code and the profile, and an unknown code is a no-op', async () => {
    const { service, repo } = build();
    const code = await service.issueGoogleSignup(PROFILE);

    await service.discardGoogleSignup('not-a-code');
    expect(repo.stored).toHaveLength(1);
    await service.discardGoogleSignup(code);

    expect(repo.stored).toEqual([]);
    await expect(service.consumeGoogleSignup(code)).resolves.toBeNull();
  });

  it('a signup code is not a token of any other purpose, and the reverse', async () => {
    const { service } = build();
    const signup = await service.issueGoogleSignup(PROFILE);
    const exchange = await service.issue(USER, 'google_exchange');

    await expect(service.consume(signup, 'google_exchange')).resolves.toBeNull();
    await expect(service.consumeGoogleSignup(exchange)).resolves.toBeNull();
    await expect(service.peekGoogleSignup(exchange)).resolves.toBeNull();
  });

  it.each(['', undefined, { $ne: null }])(
    'refuses %j without touching the repository',
    async (junk) => {
      const { service } = build();
      await service.issueGoogleSignup(PROFILE);
      const code = junk as unknown as string;

      await expect(service.peekGoogleSignup(code)).resolves.toBeNull();
      await expect(service.consumeGoogleSignup(code)).resolves.toBeNull();
      await expect(service.discardGoogleSignup(code)).resolves.toBeUndefined();
    },
  );

  it('BR-001-10: revokeAllUnused kills every outstanding link of the account, and only its own', async () => {
    const { service } = build();
    const confirmation = await service.issue(USER, 'email_confirmation');
    const recovery = await service.issue(USER, 'account_recovery');
    const exchange = await service.issue(USER, 'google_exchange');
    const other = await service.issue(OTHER_USER, 'account_recovery');

    await service.revokeAllUnused(USER);

    await expect(service.consume(confirmation, 'email_confirmation')).resolves.toBeNull();
    await expect(service.consume(recovery, 'account_recovery')).resolves.toBeNull();
    await expect(service.consume(exchange, 'google_exchange')).resolves.toBeNull();
    await expect(service.consume(other, 'account_recovery')).resolves.not.toBeNull();
  });
});
