import { describe, expect, it } from 'vitest';
import { AccessContext, ActingOwner } from './access-context.js';
import { DomainError } from '../common/errors/domain-error.js';
import {
  accessContextFactory,
  fakeAccessSources,
  type FakeRelationships,
} from '../../test/fakes/fake-access-sources.js';
import { spyOnLogger } from '../../test/support/logger-spy.js';

const ACCOUNT = { userId: 'account-1', isAdmin: false };
const ENDED_AT = new Date('2026-05-01T12:00:00.000Z');

const ACTIVE_PLAN = { advisorPlanActive: true, readOnly: false, entitlements: ['journeys'] };
const LAPSED_PLAN = {
  advisorPlanActive: true,
  readOnly: true,
  entitlements: ['journeys', 'radar'],
};

function contextFor(relationships: FakeRelationships, account = ACCOUNT) {
  const sources = fakeAccessSources(relationships);
  return { sources, built: accessContextFactory(sources).forAccount(account) };
}

describe('AccessContextFactory.forAccount (SPEC-002)', () => {
  it('BR-002-14: an account with no relationship is a searcher with nothing to conduct', async () => {
    const access = await contextFor({}).built;

    expect(access).toMatchObject({
      accountId: 'account-1',
      isAdmin: false,
      personas: ['searcher'],
      memberships: [],
      clientLinks: [],
      selfAdvised: false,
      readOnly: false,
    });
    expect([...access.entitlements]).toEqual([]);
    expect(access.conductedOwners()).toEqual([]);
    expect(access.writableOwners()).toEqual([]);
  });

  it('AR-13 / BR-002-15: reads the sources on every call, so a removal shows on the next request', async () => {
    const sources = fakeAccessSources({
      memberships: [{ officeId: 'office-a' }],
      officePlans: { 'office-a': ACTIVE_PLAN },
    });
    const factory = accessContextFactory(sources);

    const before = await factory.forAccount(ACCOUNT);
    sources.fake.relationships = {};
    const after = await factory.forAccount(ACCOUNT);

    expect(before.hasPersona('advisor')).toBe(true);
    expect(before.conductedOwners()).toEqual([{ ownerType: 'office', ownerId: 'office-a' }]);
    expect(after.hasPersona('advisor')).toBe(false);
    expect(after.conductedOwners()).toEqual([]);
    expect(sources.fake.reads).toBe(2);
  });

  it('BR-002-14 / BR-002-13: builds personas, memberships and entitlements from the plan source', async () => {
    const access = await contextFor({
      memberships: [{ officeId: 'office-a' }],
      officePlans: { 'office-a': ACTIVE_PLAN },
      clientLinks: [
        { officeId: 'office-b', status: 'active' },
        { officeId: 'office-c', status: 'ended', endedAt: ENDED_AT },
      ],
      selfAdvised: true,
      selfAdvisedEntitlements: ['self-journeys'],
    }).built;

    expect(access.personas).toEqual(['searcher', 'advisor', 'investor', 'self_advised']);
    expect(access.memberships).toEqual([
      { officeId: 'office-a', readOnly: false, advisorPlanActive: true },
    ]);
    expect(access.clientLinks).toEqual([
      { officeId: 'office-b', status: 'active' },
      { officeId: 'office-c', status: 'ended', endedAtMs: ENDED_AT.getTime() },
    ]);
    expect([...access.entitlements]).toEqual(['journeys', 'self-journeys']);
    expect(access.conductedOwners()).toEqual([
      { ownerType: 'office', ownerId: 'office-a' },
      { ownerType: 'self_advised', ownerId: 'account-1' },
    ]);
  });

  it('BR-002-14: the investor persona can come from a journey as investor (SPEC-016)', async () => {
    const access = await contextFor({ hasJourneyAsInvestor: true }).built;

    expect(access.personas).toEqual(['searcher', 'investor']);
  });

  it('BR-002-10: an office the plan source does not know has no plan, no entitlement and is read-only', async () => {
    const access = await contextFor({ memberships: [{ officeId: 'office-x' }] }).built;

    expect(access.memberships).toEqual([
      { officeId: 'office-x', readOnly: true, advisorPlanActive: false },
    ]);
    expect(access.personas).toEqual(['searcher']);
    expect(access.conductedOwners()).toEqual([{ ownerType: 'office', ownerId: 'office-x' }]);
    expect(access.writableOwners()).toEqual([]);
  });

  it('BR-002-30: a read-only office is read but not written, with or without its entitlements', async () => {
    const access = await contextFor({
      memberships: [{ officeId: 'office-a' }, { officeId: 'office-b' }],
      officePlans: { 'office-a': LAPSED_PLAN, 'office-b': ACTIVE_PLAN },
    }).built;

    expect(access.conductedOwners()).toEqual([
      { ownerType: 'office', ownerId: 'office-a' },
      { ownerType: 'office', ownerId: 'office-b' },
    ]);
    expect(access.writableOwners()).toEqual([{ ownerType: 'office', ownerId: 'office-b' }]);
    expect(access.hasEntitlement('radar')).toBe(true);
    expect(access.canWriteWith('radar')).toBe(false);
    expect(access.canWriteWith('journeys')).toBe(true);
    expect(access.hasEntitlement('calculator')).toBe(false);
  });

  it('a self-advised account writes as itself (no read-only office in the way)', async () => {
    const access = await contextFor({
      memberships: [{ officeId: 'office-a' }],
      officePlans: { 'office-a': LAPSED_PLAN },
      selfAdvised: true,
    }).built;

    expect(access.writableOwners()).toEqual([{ ownerType: 'self_advised', ownerId: 'account-1' }]);
  });

  it('BR-002-21 / BR-002-23: an admin context has no relationship, persona beyond searcher or entitlement', async () => {
    const logger = spyOnLogger();
    const access = await contextFor(
      {
        memberships: [{ officeId: 'office-a' }],
        officePlans: { 'office-a': ACTIVE_PLAN },
        clientLinks: [{ officeId: 'office-b', status: 'active' }],
        selfAdvised: true,
        selfAdvisedEntitlements: ['self-journeys'],
      },
      { userId: 'admin-1', isAdmin: true },
    ).built;

    expect(access).toMatchObject({
      isAdmin: true,
      personas: ['searcher'],
      memberships: [],
      clientLinks: [],
      selfAdvised: false,
    });
    expect([...access.entitlements]).toEqual([]);
    expect(access.conductedOwners()).toEqual([]);
    // SC-15: the operator is told, with no id or data.
    expect(logger.loggedText()).toContain('BR-002-21');
    expect(logger.loggedText()).not.toContain('admin-1');
    expect(logger.loggedText()).not.toContain('office-a');
  });

  it.each([
    ['memberships', { memberships: [{ officeId: 'office-a' }] }],
    ['links', { clientLinks: [{ officeId: 'office-a', status: 'ended' as const }] }],
    ['journeys as investor', { hasJourneyAsInvestor: true }],
    ['self-advised', { selfAdvised: true }],
  ])('BR-002-21: warns about an admin with %s', async (_label, relationships) => {
    const logger = spyOnLogger();
    await contextFor(relationships, { userId: 'admin-1', isAdmin: true }).built;

    expect(logger.loggedText()).toContain('BR-002-21');
  });

  it('does not warn about an admin with no relationship', async () => {
    const logger = spyOnLogger();
    await contextFor({}, { userId: 'admin-1', isAdmin: true }).built;

    expect(logger.loggedText()).toBe('');
  });
});

describe('AccessContext (SPEC-002 AR-13)', () => {
  it('BR-002-11: cannot be built outside AccessContextFactory', () => {
    const Constructor = AccessContext as unknown as new (token: symbol, fields: object) => unknown;

    expect(() => new Constructor(Symbol('AccessContext.mint'), {})).toThrow(
      'AccessContext is built by AccessContextFactory only (AR-13)',
    );
  });

  it('is frozen, and so are its arrays, their items and the entitlement set', async () => {
    const access = await contextFor({
      memberships: [{ officeId: 'office-a' }],
      officePlans: { 'office-a': ACTIVE_PLAN },
      clientLinks: [{ officeId: 'office-b', status: 'ended', endedAt: ENDED_AT }],
    }).built;

    expect(Object.isFrozen(access)).toBe(true);
    expect(Object.isFrozen(access.personas)).toBe(true);
    expect(Object.isFrozen(access.memberships)).toBe(true);
    expect(Object.isFrozen(access.memberships[0])).toBe(true);
    expect(Object.isFrozen(access.clientLinks[0])).toBe(true);
    expect(Object.isFrozen(access.conductedOwners())).toBe(true);
    expect(Object.isFrozen(access.conductedOwners()[0])).toBe(true);
    expect(() => {
      (access as { isAdmin: boolean }).isAdmin = true;
    }).toThrow(TypeError);
    expect(() => {
      (access.personas as string[]).push('advisor');
    }).toThrow(TypeError);
    expect('add' in access.entitlements).toBe(false);
  });

  it('keeps an end date as epoch ms: neither the source Date nor the context can change it', async () => {
    const endedAt = new Date(ENDED_AT.getTime());
    const access = await contextFor({
      clientLinks: [{ officeId: 'office-b', status: 'ended', endedAt }],
    }).built;

    endedAt.setTime(0);
    const link = access.clientLinks[0];

    expect(link?.endedAtMs).toBe(ENDED_AT.getTime());
    expect(Object.values(link ?? {}).some((value) => value instanceof Date)).toBe(false);
    expect(() => {
      (link as { endedAtMs: number }).endedAtMs = 0;
    }).toThrow(TypeError);
  });

  it('exposes the entitlements as a read-only set', async () => {
    const access = await contextFor({
      memberships: [{ officeId: 'office-a' }],
      officePlans: { 'office-a': { ...ACTIVE_PLAN, entitlements: ['journeys', 'radar'] } },
    }).built;
    const seen: string[] = [];

    access.entitlements.forEach((value, same, set) => {
      expect(same).toBe(value);
      expect(set).toBe(access.entitlements);
      seen.push(value);
    });

    expect(access.entitlements.size).toBe(2);
    expect(seen).toEqual(['journeys', 'radar']);
    expect([...access.entitlements.keys()]).toEqual(['journeys', 'radar']);
    expect([...access.entitlements.values()]).toEqual(['journeys', 'radar']);
    expect([...access.entitlements.entries()]).toEqual([
      ['journeys', 'journeys'],
      ['radar', 'radar'],
    ]);
  });
});

describe('AccessContext.resolveActingOwner (SPEC-002 BR-002-11)', () => {
  const WRITABLE = { advisorPlanActive: true, readOnly: false, entitlements: [] };

  async function contextOf(relationships: FakeRelationships) {
    return contextFor(relationships).built;
  }

  it('acts for the only owner the account conducts', async () => {
    const access = await contextOf({
      memberships: [{ officeId: 'office-a' }],
      officePlans: { 'office-a': WRITABLE },
    });

    const acting = access.resolveActingOwner();

    expect(acting.owner).toEqual({ ownerType: 'office', ownerId: 'office-a' });
    expect(acting.context).toBe(access);
    expect(Object.isFrozen(acting)).toBe(true);
    expect(Object.isFrozen(acting.owner)).toBe(true);
  });

  it('acts for itself when self-advised only', async () => {
    const access = await contextOf({ selfAdvised: true });

    expect(access.resolveActingOwner().owner).toEqual({
      ownerType: 'self_advised',
      ownerId: 'account-1',
    });
  });

  it('refuses an account that conducts nothing (FORBIDDEN: no record is involved)', async () => {
    const access = await contextOf({});

    expect(() => access.resolveActingOwner()).toThrow(new DomainError('FORBIDDEN'));
  });

  it('asks an account of several owners to choose, and accepts only its own offices', async () => {
    const access = await contextOf({
      memberships: [{ officeId: 'office-a' }, { officeId: 'office-b' }],
      officePlans: { 'office-a': WRITABLE, 'office-b': WRITABLE },
    });

    expect(() => access.resolveActingOwner()).toThrow(
      new DomainError('VALIDATION_FAILED', { fields: ['officeId'] }),
    );
    expect(access.resolveActingOwner('office-b').owner).toEqual({
      ownerType: 'office',
      ownerId: 'office-b',
    });
    // BR-002-12: an office the account is not in answers like one that does not exist.
    expect(() => access.resolveActingOwner('office-c')).toThrow(new DomainError('NOT_FOUND'));
    expect(() => access.resolveActingOwner('office-c', 'REMINDER_NOT_FOUND')).toThrow(
      new DomainError('REMINDER_NOT_FOUND'),
    );
    expect(() => access.resolveActingOwner({ $ne: null })).toThrow(new DomainError('NOT_FOUND'));
  });

  it('BR-002-30: tells a readable owner from a writable one', async () => {
    const access = await contextOf({
      memberships: [{ officeId: 'office-a' }, { officeId: 'office-r' }],
      officePlans: { 'office-a': WRITABLE, 'office-r': { ...WRITABLE, readOnly: true } },
    });
    const a = { ownerType: 'office' as const, ownerId: 'office-a' };
    const r = { ownerType: 'office' as const, ownerId: 'office-r' };
    const other = { ownerType: 'office' as const, ownerId: 'office-b' };
    const selfAdvisedTwin = { ownerType: 'self_advised' as const, ownerId: 'office-a' };

    expect([a, r, other, selfAdvisedTwin].map((owner) => access.canReadOwner(owner))).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect([a, r, other].map((owner) => access.canWriteOwner(owner))).toEqual([true, false, false]);
  });

  it('an ActingOwner cannot be built outside the context', () => {
    const Constructor = ActingOwner as unknown as new (...args: unknown[]) => ActingOwner;

    expect(() => new Constructor(Symbol('forged'), { ownerType: 'office', ownerId: 'x' })).toThrow(
      /resolveActingOwner only/,
    );
  });
});
