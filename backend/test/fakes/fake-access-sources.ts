// SPEC-002: hand-written fakes of the four access sources (TS-03), so a spec states the
// relationships an account has: memberships (with their office plans), client links, journeys as
// investor and self-advised status. With no argument, the account has none, like the defaults
// AccessModule binds until SPEC-011/012/016 plug theirs in.
import { AccessContextFactory } from '../../src/access/access-context.js';
import type { ClientLink, ClientLinkSource } from '../../src/access/sources/client-link.source.js';
import type {
  MembershipSource,
  OfficeMembership,
} from '../../src/access/sources/membership.source.js';
import type {
  OfficePlanSource,
  OfficePlanState,
} from '../../src/access/sources/office-plan.source.js';
import type { SelfAdvisedSource } from '../../src/access/sources/self-advised.source.js';

export interface AccessSources {
  memberships: MembershipSource;
  clientLinks: ClientLinkSource;
  selfAdvised: SelfAdvisedSource;
  plans: OfficePlanSource;
}

export interface FakeRelationships {
  memberships?: readonly OfficeMembership[];
  clientLinks?: readonly ClientLink[];
  hasJourneyAsInvestor?: boolean;
  selfAdvised?: boolean;
  officePlans?: Readonly<Record<string, OfficePlanState>>;
  selfAdvisedEntitlements?: readonly string[];
}

/** Counts every read, so a spec can prove the sources are read on each request (BR-002-15). */
export class FakeAccessSources
  implements MembershipSource, ClientLinkSource, SelfAdvisedSource, OfficePlanSource
{
  reads = 0;

  constructor(public relationships: FakeRelationships = {}) {}

  activeMemberships(): Promise<readonly OfficeMembership[]> {
    this.reads += 1;
    return Promise.resolve(this.relationships.memberships ?? []);
  }

  clientLinks(): Promise<readonly ClientLink[]> {
    return Promise.resolve(this.relationships.clientLinks ?? []);
  }

  hasJourneyAsInvestor(): Promise<boolean> {
    return Promise.resolve(this.relationships.hasJourneyAsInvestor ?? false);
  }

  isSelfAdvised(): Promise<boolean> {
    return Promise.resolve(this.relationships.selfAdvised ?? false);
  }

  officePlans(officeIds: readonly string[]): Promise<ReadonlyMap<string, OfficePlanState>> {
    const plans = this.relationships.officePlans ?? {};
    return Promise.resolve(
      new Map(
        officeIds.flatMap((id) => {
          const plan = plans[id];
          return plan ? [[id, plan] as const] : [];
        }),
      ),
    );
  }

  selfAdvisedEntitlements(): Promise<readonly string[]> {
    return Promise.resolve(this.relationships.selfAdvisedEntitlements ?? []);
  }
}

/** The four sources, all served by one FakeAccessSources. */
export function fakeAccessSources(relationships: FakeRelationships = {}): AccessSources & {
  fake: FakeAccessSources;
} {
  const fake = new FakeAccessSources(relationships);
  return { memberships: fake, clientLinks: fake, selfAdvised: fake, plans: fake, fake };
}

/** The real AccessContextFactory over these sources (or over none). */
export function accessContextFactory(
  sources: AccessSources = fakeAccessSources(),
): AccessContextFactory {
  return new AccessContextFactory(
    sources.memberships,
    sources.clientLinks,
    sources.selfAdvised,
    sources.plans,
  );
}
