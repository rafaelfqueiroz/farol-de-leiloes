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

    const first = await service.create(USER);
    const second = await service.create(USER);

    expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(second).not.toBe(first);
    await expect(service.isActive(first, USER)).resolves.toBe(true);
    await expect(service.isActive(first, OTHER)).resolves.toBe(false);
  });

  it('BR-001-18: a session lives 7 days: active at 6 days 23 hours, refused 7 days and 1 minute after sign-in', async () => {
    const { service, clock } = build();
    const jti = await service.create(USER);
    expect(SESSION_TTL_MS).toBe(7 * DAY);

    clock.advance(7 * DAY - MINUTE);
    await expect(service.isActive(jti, USER)).resolves.toBe(true);

    clock.advance(2 * MINUTE); // 7 days and 1 minute after sign-in
    await expect(service.isActive(jti, USER)).resolves.toBe(false);
  });

  it('BR-001-18: revoke ends only that session, at once', async () => {
    const { service } = build();
    const mine = await service.create(USER);
    const other = await service.create(USER);

    await service.revoke(mine);

    await expect(service.isActive(mine, USER)).resolves.toBe(false);
    await expect(service.isActive(other, USER)).resolves.toBe(true);
  });

  it('BR-001-19: revokeAllForUser ends every session of that user and no one else', async () => {
    const { service } = build();
    const a = await service.create(USER);
    const b = await service.create(USER);
    const stranger = await service.create(OTHER);

    await service.revokeAllForUser(USER);

    await expect(service.isActive(a, USER)).resolves.toBe(false);
    await expect(service.isActive(b, USER)).resolves.toBe(false);
    await expect(service.isActive(stranger, OTHER)).resolves.toBe(true);
  });

  it('BR-001-19: revokeAllForUser keeps the session named as the exception', async () => {
    const { service } = build();
    const current = await service.create(USER);
    const other = await service.create(USER);

    await service.revokeAllForUser(USER, current);

    await expect(service.isActive(current, USER)).resolves.toBe(true);
    await expect(service.isActive(other, USER)).resolves.toBe(false);
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
});
