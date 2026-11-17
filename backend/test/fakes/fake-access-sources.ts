// SPEC-002: hand-written fakes of the four access sources (TS-03), so a spec states the
// relationships an account has: memberships (with their office plans), client links, journeys as
// investor and self-advised status. With no argument, the account has none, like the defaults
// AccessModule binds until SPEC-011/012/016 plug theirs in.
//
// `relationships` applies to every account; `forAccount(id, ...)` gives one account its own, read
// on every request like the real sources (BR-002-15), so an isolation spec can seed offices A and B
// with members and investors and change them between two requests (TS-16, TS-18). Office plans are
// an office's: `plans` (shared) wins over the plans named in any account's relationships.
import { type AccessContext, AccessContextFactory } from '../../src/access/access-context.js';
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
  /** Plans every account sees, e.g. offices A and B of an isolation spec. */
  plans: Record<string, OfficePlanState> = {};
  private readonly byAccount = new Map<string, FakeRelationships>();

  constructor(public relationships: FakeRelationships = {}) {}

  /** Gives one account its own relationships (replacing what it had); `{}` removes them all. */
  forAccount(accountId: string, relationships: FakeRelationships): this {
    this.byAccount.set(accountId, relationships);
    return this;
  }

  /** Forgets every per-account relationship and shared plan. */
  reset(): void {
    this.byAccount.clear();
    this.plans = {};
    this.relationships = {};
  }

  private of(accountId: string | undefined): FakeRelationships {
    return (accountId !== undefined && this.byAccount.get(accountId)) || this.relationships;
  }

  activeMemberships(accountId?: string): Promise<readonly OfficeMembership[]> {
    this.reads += 1;
    return Promise.resolve(this.of(accountId).memberships ?? []);
  }

  clientLinks(accountId?: string): Promise<readonly ClientLink[]> {
    return Promise.resolve(this.of(accountId).clientLinks ?? []);
  }

  hasJourneyAsInvestor(accountId?: string): Promise<boolean> {
    return Promise.resolve(this.of(accountId).hasJourneyAsInvestor ?? false);
  }

  isSelfAdvised(accountId?: string): Promise<boolean> {
    return Promise.resolve(this.of(accountId).selfAdvised ?? false);
  }

  officePlans(officeIds: readonly string[]): Promise<ReadonlyMap<string, OfficePlanState>> {
    // A plan belongs to the office, not to whoever asks: every relationship's plans are one map.
    const plans: Record<string, OfficePlanState> = { ...this.relationships.officePlans };
    for (const relationships of this.byAccount.values()) {
      Object.assign(plans, relationships.officePlans);
    }
    Object.assign(plans, this.plans);
    return Promise.resolve(
      new Map(
        officeIds.flatMap((id) => {
          const plan = plans[id];
          return plan ? [[id, plan] as const] : [];
        }),
      ),
    );
  }

  selfAdvisedEntitlements(accountId?: string): Promise<readonly string[]> {
    return Promise.resolve(this.of(accountId).selfAdvisedEntitlements ?? []);
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

/**
 * The AccessContext the real factory builds for an account over these relationships (or none), for
 * service specs that need one: only AccessContextFactory can build a context (AR-13).
 */
export function anAccessContext(
  accountId: string,
  relationships: FakeRelationships = {},
  isAdmin = false,
): Promise<AccessContext> {
  return accessContextFactory(fakeAccessSources(relationships)).forAccount({
    userId: accountId,
    isAdmin,
  });
}
