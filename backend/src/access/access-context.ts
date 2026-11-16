// SPEC-002: who the caller is and what they may do, built on the server from current state on every
// request (AR-13, BR-002-11, BR-002-15). AccessContextGuard builds one per request with
// AccessContextFactory and puts it on the request; handlers read it with @Access().
//
// An AccessContext can only be built by AccessContextFactory: its constructor demands a token that
// never leaves this file, so no controller, service or test can hand-craft one with an owner taken
// from a request (BR-002-11). It is frozen, and so is everything in it.
import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  type ClientLinkFacts,
  type MembershipFacts,
  type Persona,
  type ResolvedMembership,
  resolveAccess,
} from './domain/personas.js';
import { CLIENT_LINK_SOURCE, type ClientLinkSource } from './sources/client-link.source.js';
import { MEMBERSHIP_SOURCE, type MembershipSource } from './sources/membership.source.js';
import {
  OFFICE_PLAN_SOURCE,
  type OfficePlanSource,
  type OfficePlanState,
} from './sources/office-plan.source.js';
import { SELF_ADVISED_SOURCE, type SelfAdvisedSource } from './sources/self-advised.source.js';

/** The conducting party a record belongs to (SPEC-002 BR-002-01, AR-11). */
export interface Owner {
  readonly ownerType: 'office' | 'self_advised';
  readonly ownerId: string;
}

export type AccessMembership = ResolvedMembership;
export type AccessClientLink = ClientLinkFacts;

/** The account the context is for, as JwtStrategy read it from the database for this request. */
export interface AccessAccount {
  readonly userId: string;
  /** DL-002-05: read fresh on every request (BR-002-15). */
  readonly isAdmin: boolean;
}

// Never exported: holding it is what "being AccessContextFactory" means.
const MINT: unique symbol = Symbol('AccessContext.mint');

interface AccessContextFields {
  accountId: string;
  isAdmin: boolean;
  personas: readonly Persona[];
  memberships: readonly AccessMembership[];
  clientLinks: readonly AccessClientLink[];
  selfAdvised: boolean;
  entitlements: readonly string[];
  writableEntitlements: readonly string[];
  readOnly: boolean;
}

/** A read-only view of a Set: there is no add, delete or clear to call, even by a cast. */
class FrozenSet<T> implements ReadonlySet<T> {
  readonly #values: Set<T>;

  constructor(values: Iterable<T>) {
    this.#values = new Set(values);
    Object.freeze(this);
  }

  get size(): number {
    return this.#values.size;
  }

  has(value: T): boolean {
    return this.#values.has(value);
  }

  forEach(callback: (value: T, value2: T, set: ReadonlySet<T>) => void, thisArg?: unknown): void {
    this.#values.forEach((value) => callback.call(thisArg, value, value, this));
  }

  entries(): SetIterator<[T, T]> {
    return this.#values.entries();
  }

  keys(): SetIterator<T> {
    return this.#values.keys();
  }

  values(): SetIterator<T> {
    return this.#values.values();
  }

  [Symbol.iterator](): SetIterator<T> {
    return this.#values[Symbol.iterator]();
  }
}

export class AccessContext {
  readonly accountId: string;
  /** DL-002-05: operator capability (BR-002-23); grants no client data and no paid feature. */
  readonly isAdmin: boolean;
  /** BR-002-14: derived from relationships, never stored. */
  readonly personas: readonly Persona[];
  /** The offices the account is a current member of (BR-002-03). Empty for an admin. */
  readonly memberships: readonly AccessMembership[];
  /** Active and ended links as investor (BR-002-05, BR-002-07); never pending (D-45). */
  readonly clientLinks: readonly AccessClientLink[];
  readonly selfAdvised: boolean;
  /** BR-002-13: the plan entitlements of every owner the account conducts. */
  readonly entitlements: ReadonlySet<string>;
  /**
   * True for a context that may only read, whatever its owners allow: a support access grant
   * (BR-002-25, SPEC-002 part 3). False for an account's own requests.
   */
  readonly readOnly: boolean;
  private readonly writableEntitlements: ReadonlySet<string>;

  constructor(token: typeof MINT, fields: AccessContextFields) {
    if (token !== MINT) {
      throw new Error('AccessContext is built by AccessContextFactory only (AR-13)');
    }
    this.accountId = fields.accountId;
    this.isAdmin = fields.isAdmin;
    this.personas = Object.freeze([...fields.personas]);
    this.memberships = Object.freeze(fields.memberships.map((m) => Object.freeze({ ...m })));
    this.clientLinks = Object.freeze(
      fields.clientLinks.map((link) =>
        Object.freeze({
          ...link,
          // A Date is mutable; the context keeps its own copy.
          ...(link.endedAt ? { endedAt: new Date(link.endedAt.getTime()) } : {}),
        }),
      ),
    );
    this.selfAdvised = fields.selfAdvised;
    this.entitlements = new FrozenSet(fields.entitlements);
    this.writableEntitlements = new FrozenSet(fields.writableEntitlements);
    this.readOnly = fields.readOnly;
    Object.freeze(this);
  }

  hasPersona(persona: Persona): boolean {
    return this.personas.includes(persona);
  }

  /** BR-002-10 / BR-002-13: some owner the account conducts has the entitlement. */
  hasEntitlement(entitlement: string): boolean {
    return this.entitlements.has(entitlement);
  }

  /**
   * BR-002-30: the entitlement is held by an owner that may write: not a read-only office, and
   * never in a read-only context.
   */
  canWriteWith(entitlement: string): boolean {
    return !this.readOnly && this.writableEntitlements.has(entitlement);
  }

  /**
   * The owners whose data the account reads as its conducting party (BR-002-03): every office it is
   * a member of, read-only ones included (D-47: reads stay allowed), and itself when self-advised.
   * Never derived from the request (BR-002-11).
   */
  conductedOwners(): readonly Owner[] {
    const owners: Owner[] = this.memberships.map((membership) => ({
      ownerType: 'office',
      ownerId: membership.officeId,
    }));
    if (this.selfAdvised) owners.push({ ownerType: 'self_advised', ownerId: this.accountId });
    return Object.freeze(owners.map((owner) => Object.freeze(owner)));
  }

  /** The owners the account may write to: read-only offices removed (BR-002-30); none if readOnly. */
  writableOwners(): readonly Owner[] {
    if (this.readOnly) return Object.freeze([]);
    const readOnlyOffices = new Set(
      this.memberships.filter((m) => m.readOnly).map((m) => m.officeId),
    );
    return Object.freeze(
      this.conductedOwners().filter(
        (owner) => owner.ownerType !== 'office' || !readOnlyOffices.has(owner.ownerId),
      ),
    );
  }
}

/** BR-002-30 fails closed: an office the plan source does not know has no plan at all. */
const UNKNOWN_PLAN: OfficePlanState = {
  advisorPlanActive: false,
  readOnly: true,
  entitlements: [],
};

/**
 * Builds the AccessContext of an account from its CURRENT relationships, read from the sources on
 * every call, never cached (AR-13, BR-002-15). The sources are the SPEC-011/012/016 seams; until
 * they exist, their defaults grant nothing.
 */
@Injectable()
export class AccessContextFactory {
  private readonly logger = new Logger(AccessContextFactory.name);

  constructor(
    @Inject(MEMBERSHIP_SOURCE) private readonly memberships: MembershipSource,
    @Inject(CLIENT_LINK_SOURCE) private readonly clientLinks: ClientLinkSource,
    @Inject(SELF_ADVISED_SOURCE) private readonly selfAdvised: SelfAdvisedSource,
    @Inject(OFFICE_PLAN_SOURCE) private readonly plans: OfficePlanSource,
  ) {}

  async forAccount(account: AccessAccount): Promise<AccessContext> {
    const accountId = account.userId;
    const [memberships, links, journeyAsInvestor, selfAdvised] = await Promise.all([
      this.memberships.activeMemberships(accountId),
      this.clientLinks.clientLinks(accountId),
      this.clientLinks.hasJourneyAsInvestor(accountId),
      this.selfAdvised.isSelfAdvised(accountId),
    ]);

    if (
      account.isAdmin &&
      (memberships.length > 0 || links.length > 0 || journeyAsInvestor || selfAdvised)
    ) {
      // BR-002-21: should never happen (grant-admin and SPEC-011 refuse it). The relationships are
      // ignored below; this line only tells the operator. SC-15: no id, no data.
      this.logger.warn('BR-002-21: an admin account has client relationships; they are ignored');
    }

    const plans = await this.plans.officePlans(memberships.map((m) => m.officeId));
    const selfAdvisedEntitlements = selfAdvised
      ? await this.plans.selfAdvisedEntitlements(accountId)
      : [];
    const membershipFacts: MembershipFacts[] = memberships.map(({ officeId }) => {
      const plan = plans.get(officeId) ?? UNKNOWN_PLAN;
      return {
        officeId,
        advisorPlanActive: plan.advisorPlanActive,
        readOnly: plan.readOnly,
        entitlements: plan.entitlements,
      };
    });

    const resolved = resolveAccess({
      isAdmin: account.isAdmin,
      memberships: membershipFacts,
      clientLinks: links,
      hasJourneyAsInvestor: journeyAsInvestor,
      selfAdvised,
      selfAdvisedEntitlements,
    });

    return new AccessContext(MINT, {
      accountId,
      isAdmin: account.isAdmin,
      ...resolved,
      readOnly: false,
    });
  }
}
