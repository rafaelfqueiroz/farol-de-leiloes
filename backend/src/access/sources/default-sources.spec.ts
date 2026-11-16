// SPEC-002 BR-002-10: until SPEC-011, SPEC-012 and SPEC-016 plug their sources in, the defaults
// AccessModule binds grant nothing: the safe direction to fail.
import { describe, expect, it } from 'vitest';
import { NoClientLinkSource } from './client-link.source.js';
import { NoMembershipSource } from './membership.source.js';
import { NoOfficePlanSource } from './office-plan.source.js';
import { NoSelfAdvisedSource } from './self-advised.source.js';

describe('default access sources', () => {
  it('know no membership, link, journey, self-advised status, plan or entitlement', async () => {
    await expect(new NoMembershipSource().activeMemberships()).resolves.toEqual([]);
    await expect(new NoClientLinkSource().clientLinks()).resolves.toEqual([]);
    await expect(new NoClientLinkSource().hasJourneyAsInvestor()).resolves.toBe(false);
    await expect(new NoSelfAdvisedSource().isSelfAdvised()).resolves.toBe(false);
    await expect(new NoOfficePlanSource().officePlans()).resolves.toEqual(new Map());
    await expect(new NoOfficePlanSource().selfAdvisedEntitlements()).resolves.toEqual([]);
  });
});
