// BR-001-17/18/19: server-side sessions over an in-memory repository and a fake clock (TS-03,
// TS-06). The TTL index and the real queries are exercised in
// test/integration/auth-sessions-tokens.spec.ts.
import { describe, expect, it } from 'vitest';
import { DAY, FakeClock, MINUTE } from '../../../test/fakes/fake-clock.js';
import { FakeSessionsRepository } from '../../../test/fakes/fake-auth-repositories.js';
import type { SessionsRepository } from './sessions.repository.js';
import { SESSION_TTL_MS, SessionsService } from './sessions.service.js';

const USER = '64b000000000000000000001';
const OTHER = '64b000000000000000000002';

function build() {
  const repo = new FakeSessionsRepository();
  const clock = new FakeClock();
  const service = new SessionsService(repo as unknown as SessionsRepository, clock);
  return { service, repo, clock };
}

describe('SessionsService', () => {
  it('opens a session with a random UUID id that is active for its owner only', async () => {
    const { service } = build();

    const first = await service.create(USER, 0);
    const second = await service.create(USER, 0);

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
    await expect(service.isActive(first, USER)).resolves.toBe(true);
    await expect(service.isActive(first, OTHER)).resolves.toBe(false);
  });

  it('BR-001-18: a session lives 7 days: active at 6 days 23 hours, refused 7 days and 1 minute after sign-in', async () => {
    const { service, clock } = build();
    const jti = await service.create(USER, 0);
    expect(SESSION_TTL_MS).toBe(7 * DAY);

    clock.advance(7 * DAY - MINUTE);
    await expect(service.isActive(jti, USER)).resolves.toBe(true);

    clock.advance(2 * MINUTE); // 7 days and 1 minute after sign-in
    await expect(service.isActive(jti, USER)).resolves.toBe(false);
  });

  it('BR-001-18: revoke ends only that session, at once', async () => {
    const { service } = build();
    const mine = await service.create(USER, 0);
    const other = await service.create(USER, 0);

    await service.revoke(mine);

    await expect(service.isActive(mine, USER)).resolves.toBe(false);
    await expect(service.isActive(other, USER)).resolves.toBe(true);
  });

  it('BR-001-19: revokeAllForUser ends every session of that user and no one else', async () => {
    const { service } = build();
    const a = await service.create(USER, 0);
    const b = await service.create(USER, 0);
    const stranger = await service.create(OTHER, 0);

    await service.revokeAllForUser(USER);

    await expect(service.isActive(a, USER)).resolves.toBe(false);
    await expect(service.isActive(b, USER)).resolves.toBe(false);
    await expect(service.isActive(stranger, OTHER)).resolves.toBe(true);
  });

  it('BR-001-19: revokeAllForUser keeps the session named as the exception', async () => {
    const { service } = build();
    const current = await service.create(USER, 0);
    const other = await service.create(USER, 0);

    await service.revokeAllForUser(USER, current);

    await expect(service.isActive(current, USER)).resolves.toBe(true);
    await expect(service.isActive(other, USER)).resolves.toBe(false);
  });

  it('rebind binds a live session to a new version, and the others keep theirs', async () => {
    const { service } = build();
    const mine = await service.create(USER, 1);
    const other = await service.create(USER, 1);

    await expect(service.rebind(mine, USER, 2)).resolves.toBe(true);

    await expect(service.activeCredentialVersion(mine, USER)).resolves.toBe(2);
    await expect(service.activeCredentialVersion(other, USER)).resolves.toBe(1);
  });

  it('rebind leaves a revoked, expired, foreign or malformed session alone', async () => {
    const { service, clock } = build();
    const revoked = await service.create(USER, 1);
    await service.revoke(revoked);
    const expired = await service.create(USER, 1);
    clock.advance(7 * DAY + MINUTE);
    const foreign = await service.create(OTHER, 1);

    await expect(service.rebind(revoked, USER, 2)).resolves.toBe(false);
    await expect(service.rebind(expired, USER, 2)).resolves.toBe(false);
    await expect(service.rebind(foreign, USER, 2)).resolves.toBe(false);
    await expect(service.rebind('', USER, 2)).resolves.toBe(false);
    await expect(service.rebind(foreign, 'not-an-object-id', 2)).resolves.toBe(false);
    await expect(service.rebind(7 as unknown as string, USER, 2)).resolves.toBe(false);
  });

  it.each([
    ['an empty jti', '', USER],
    ['a non-string jti', 7 as unknown as string, USER],
    ['a user id that is not an ObjectId', 'jti', 'not-an-object-id'],
    ['a non-string user id', 'jti', { $ne: 1 } as unknown as string],
  ])('refuses %s without throwing', async (_label, jti, user) => {
    const { service } = build();

    await expect(service.isActive(jti, user)).resolves.toBe(false);
  });

  describe('DL-001-02: sessions are bound to the credential version', () => {
    it('stores the version the session was issued for and reports it while active', async () => {
      const { service, repo } = build();

      const old = await service.create(USER, 0);
      const bumped = await service.create(USER, 3);

      expect(repo.stored.find((s) => s.id === bumped)?.credentialVersion).toBe(3);
      await expect(service.activeCredentialVersion(old, USER)).resolves.toBe(0);
      await expect(service.activeCredentialVersion(bumped, USER)).resolves.toBe(3);
    });

    it('reports no version for a revoked, expired, foreign or unknown session', async () => {
      const { service, clock } = build();
      const revoked = await service.create(USER, 1);
      const expired = await service.create(USER, 1);
      await service.revoke(revoked);
      clock.advance(7 * DAY + MINUTE);
      const fresh = await service.create(USER, 1);

      await expect(service.activeCredentialVersion(revoked, USER)).resolves.toBeNull();
      await expect(service.activeCredentialVersion(expired, USER)).resolves.toBeNull();
      await expect(service.activeCredentialVersion(fresh, OTHER)).resolves.toBeNull();
      await expect(service.activeCredentialVersion('unknown', USER)).resolves.toBeNull();
      await expect(service.activeCredentialVersion(fresh, USER)).resolves.toBe(1);
    });
  });
});
