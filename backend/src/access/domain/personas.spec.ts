import { describe, expect, it } from 'vitest';
import {
  type AccessFacts,
  type ClientLinkFacts,
  derivePersonas,
  type MembershipFacts,
  resolveAccess,
} from './personas.js';

const NONE: AccessFacts = {
  isAdmin: false,
  memberships: [],
  clientLinks: [],
  hasJourneyAsInvestor: false,
  selfAdvised: false,
  selfAdvisedEntitlements: [],
};

const office = (officeId: string, overrides: Partial<MembershipFacts> = {}): MembershipFacts => ({
  officeId,
  advisorPlanActive: true,
  readOnly: false,
  entitlements: [],
  ...overrides,
});

const ENDED_AT = new Date('2026-05-01T12:00:00.000Z');
const activeLink: ClientLinkFacts = { officeId: 'office-a', status: 'active' };
const endedLink: ClientLinkFacts = { officeId: 'office-b', status: 'ended', endedAt: ENDED_AT };

describe('derivePersonas (SPEC-002 BR-002-14)', () => {
  it('BR-002-14: every active account is a searcher, and only that with no relationship', () => {
    expect(derivePersonas(NONE)).toEqual(['searcher']);
  });

  it('BR-002-14: a member of an office whose advisor plan is active is an advisor', () => {
    expect(derivePersonas({ ...NONE, memberships: [office('office-a')] })).toEqual([
      'searcher',
      'advisor',
    ]);
  });

  it('BR-002-14: membership of an office without an active advisor plan makes no advisor', () => {
    expect(
      derivePersonas({
        ...NONE,
        memberships: [office('office-a', { advisorPlanActive: false })],
      }),
    ).toEqual(['searcher']);
  });

  it('BR-002-14: one active client link makes an investor', () => {
    expect(derivePersonas({ ...NONE, clientLinks: [activeLink] })).toEqual([
      'searcher',
      'investor',
    ]);
  });

  it('D-45: an ended link alone makes no investor', () => {
    expect(derivePersonas({ ...NONE, clientLinks: [endedLink] })).toEqual(['searcher']);
  });

  it('BR-002-14: being the investor of a journey makes an investor even with no active link', () => {
    expect(
      derivePersonas({ ...NONE, clientLinks: [endedLink], hasJourneyAsInvestor: true }),
    ).toEqual(['searcher', 'investor']);
  });

  it('BR-002-14: a self-advised account holds the self_advised persona', () => {
    expect(derivePersonas({ ...NONE, selfAdvised: true })).toEqual(['searcher', 'self_advised']);
  });

  it('BR-002-14 / D-10: one account may hold several personas at once', () => {
    expect(
      derivePersonas({
        ...NONE,
        memberships: [office('office-a')],
        clientLinks: [{ officeId: 'office-b', status: 'active' }],
        selfAdvised: true,
      }),
    ).toEqual(['searcher', 'advisor', 'investor', 'self_advised']);
  });

  it('BR-002-21: an admin is a searcher only, whatever the sources say', () => {
    expect(
      derivePersonas({
        ...NONE,
        isAdmin: true,
        memberships: [office('office-a')],
        clientLinks: [activeLink],
        hasJourneyAsInvestor: true,
        selfAdvised: true,
      }),
    ).toEqual(['searcher']);
  });
});

describe('resolveAccess (SPEC-002)', () => {
  it('copies memberships without their entitlements and keeps links as read', () => {
    const resolved = resolveAccess({
      ...NONE,
      memberships: [office('office-a', { readOnly: true, entitlements: ['journeys'] })],
      clientLinks: [activeLink, endedLink],
    });

    expect(resolved.memberships).toEqual([
      { officeId: 'office-a', readOnly: true, advisorPlanActive: true },
    ]);
    expect(resolved.clientLinks).toEqual([activeLink, endedLink]);
    expect(resolved.selfAdvised).toBe(false);
  });

  it('BR-002-13: entitlements are the union of every conducted owner, unique and sorted', () => {
    const resolved = resolveAccess({
      ...NONE,
      memberships: [
        office('office-a', { entitlements: ['radar', 'journeys'] }),
        office('office-b', { entitlements: ['journeys', 'calculator'] }),
      ],
      selfAdvised: true,
      selfAdvisedEntitlements: ['self-journeys'],
    });

    expect(resolved.entitlements).toEqual(['calculator', 'journeys', 'radar', 'self-journeys']);
    expect(resolved.writableEntitlements).toEqual(resolved.entitlements);
  });

  it('BR-002-30: a read-only office reads with its entitlements but writes with none of them', () => {
    const resolved = resolveAccess({
      ...NONE,
      memberships: [
        office('office-a', { readOnly: true, entitlements: ['journeys', 'radar'] }),
        office('office-b', { entitlements: ['radar'] }),
      ],
    });

    expect(resolved.entitlements).toEqual(['journeys', 'radar']);
    expect(resolved.writableEntitlements).toEqual(['radar']);
  });

  it('self-advised entitlements count only while the account is self-advised', () => {
    const resolved = resolveAccess({ ...NONE, selfAdvisedEntitlements: ['self-journeys'] });

    expect(resolved.entitlements).toEqual([]);
    expect(resolved.writableEntitlements).toEqual([]);
  });

  it('D-45: a link in any other status (a pending invitation) is dropped and grants nothing', () => {
    const pending = { officeId: 'office-c', status: 'pending' } as unknown as ClientLinkFacts;

    const resolved = resolveAccess({ ...NONE, clientLinks: [pending, endedLink] });

    expect(resolved.clientLinks).toEqual([endedLink]);
    expect(resolved.personas).toEqual(['searcher']);
  });

  it('BR-002-21 / BR-002-23: an admin gets no membership, link, self-advised status or entitlement', () => {
    const resolved = resolveAccess({
      isAdmin: true,
      memberships: [office('office-a', { entitlements: ['journeys'] })],
      clientLinks: [activeLink],
      hasJourneyAsInvestor: true,
      selfAdvised: true,
      selfAdvisedEntitlements: ['self-journeys'],
    });

    expect(resolved).toEqual({
      personas: ['searcher'],
      memberships: [],
      clientLinks: [],
      selfAdvised: false,
      entitlements: [],
      writableEntitlements: [],
    });
  });
});
