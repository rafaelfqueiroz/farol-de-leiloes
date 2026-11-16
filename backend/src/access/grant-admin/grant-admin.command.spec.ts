// SPEC-002 BR-002-21: GrantAdminCommand wires the grant-admin rules to UsersService and the access
// sources. Fakes of both (TS-03); the rules themselves are grant-admin.spec.ts.
import { describe, expect, it, vi } from 'vitest';
import { Types } from 'mongoose';
import type { UsersService } from '../../users/users.service.js';
import {
  fakeAccessSources,
  type FakeRelationships,
} from '../../../test/fakes/fake-access-sources.js';
import { GrantAdminCommand } from './grant-admin.command.js';

const ID = new Types.ObjectId('64b7f0000000000000000077');
const EMAIL = 'operadora.teste@example.test';

interface Stored {
  isAdmin?: boolean;
  role?: string;
  emailVerified?: boolean;
  status?: string;
}

const CONFIRMED: Stored = { emailVerified: true, role: 'free' };

function commandFor(stored: Stored | null, relationships: FakeRelationships = {}) {
  const users = {
    findByEmail: vi.fn().mockResolvedValue(stored && { _id: ID, ...stored }),
    setAdminCapability: vi.fn().mockResolvedValue(true),
  };
  const sources = fakeAccessSources(relationships);
  const command = new GrantAdminCommand(
    users as unknown as UsersService,
    sources.memberships,
    sources.clientLinks,
    sources.selfAdvised,
  );
  return { command, users };
}

describe('GrantAdminCommand (SPEC-002 DL-002-05)', () => {
  it('grants an account found by email, by its id', async () => {
    const { command, users } = commandFor(CONFIRMED);

    await expect(command.run(EMAIL, 'grant')).resolves.toBe('granted');

    expect(users.findByEmail).toHaveBeenCalledWith(EMAIL);
    expect(users.setAdminCapability).toHaveBeenCalledWith(ID.toHexString(), true);
  });

  it('reads a stored flag (a missing one is false)', async () => {
    await expect(
      commandFor({ ...CONFIRMED, isAdmin: true }).command.run(EMAIL, 'grant'),
    ).resolves.toBe('unchanged');
    await expect(commandFor(CONFIRMED).command.run(EMAIL, 'revoke')).resolves.toBe('unchanged');
  });

  it.each([
    ['refused_unconfirmed_email', {}],
    ['refused_unconfirmed_email', { emailVerified: false }],
    ['refused_inactive', { emailVerified: true, status: 'deactivated' }],
    ['refused_inactive', { emailVerified: true, status: 'closed' }],
  ])('SC-09: answers %s for %j and writes nothing', async (outcome, stored) => {
    const { command, users } = commandFor(stored);

    await expect(command.run(EMAIL, 'grant')).resolves.toBe(outcome);
    expect(users.setAdminCapability).not.toHaveBeenCalled();
  });

  it('reads a missing status as active (AR-28)', async () => {
    await expect(commandFor({ emailVerified: true }).command.run(EMAIL, 'grant')).resolves.toBe(
      'granted',
    );
  });

  it("revokes an account holding only the legacy role 'admin'", async () => {
    const { command, users } = commandFor({ ...CONFIRMED, role: 'admin' });

    await expect(command.run(EMAIL, 'revoke')).resolves.toBe('revoked');
    expect(users.setAdminCapability).toHaveBeenCalledWith(ID.toHexString(), false);
  });

  it('reports an unknown email', async () => {
    await expect(commandFor(null).command.run(EMAIL, 'grant')).resolves.toBe('account_not_found');
  });

  it.each([
    ['an office member', { memberships: [{ officeId: 'office-a' }] }],
    [
      'a client, even of an ended link',
      { clientLinks: [{ officeId: 'o', status: 'ended' as const }] },
    ],
    ['the investor of a journey', { hasJourneyAsInvestor: true }],
    ['self-advised', { selfAdvised: true }],
  ])('BR-002-21: refuses %s and writes nothing', async (_label, relationships) => {
    const { command, users } = commandFor(CONFIRMED, relationships);

    await expect(command.run(EMAIL, 'grant')).resolves.toBe('refused_client_relationships');
    expect(users.setAdminCapability).not.toHaveBeenCalled();
  });
});
