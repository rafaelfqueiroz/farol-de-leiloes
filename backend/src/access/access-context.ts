// SPEC-002: who the caller is and what they may do, built on the server from current state on every
// request (AR-13, BR-002-11, BR-002-15). AccessContextGuard builds one per request with
// AccessContextFactory and puts it on the request; handlers read it with @Access().
//
// An AccessContext can only be built by AccessContextFactory: its constructor demands a token that
// never leaves this file, so no controller, service or test can hand-craft one with an owner taken
// from a request (BR-002-11). It is frozen, and so is everything in it.
import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ErrorCode } from '../common/errors/codes.js';
import { DomainError } from '../common/errors/domain-error.js';
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
/**
 * A client link as the context keeps it. The end date is epoch milliseconds, a primitive, so the
 * frozen context holds nothing mutable (a Date can be changed through setTime, even when frozen).
 * `new Date(link.endedAtMs)` gives a Date to work with; it is the caller's own copy.
 */
export interface AccessClientLink {
  readonly officeId: string;
  readonly status: ClientLinkFacts['status'];
  /** When the link ended (BR-002-07), in epoch ms; absent while active. */
  readonly endedAtMs?: number;
}

/** The account the context is for, as JwtStrategy read it from the database for this request. */
export interface AccessAccount {
  readonly userId: string;
  /** DL-002-05: read fresh on every request (BR-002-15). */
  readonly isAdmin: boolean;
}

// Never exported: holding it is what "being AccessContextFactory" means.
const MINT: unique symbol = Symbol('AccessContext.mint');
// Never exported either: only AccessContext.resolveActingOwner chooses an acting owner.
const ACTING_MINT: unique symbol = Symbol('ActingOwner.mint');

function sameOwner(a: Owner, b: Owner): boolean {
  return a.ownerType === b.ownerType && a.ownerId === b.ownerId;
}

/**
 * The owner a write acts for, chosen on the server by `AccessContext.resolveActingOwner` among the
 * owners the account conducts (BR-002-11). Only that method can build one, and it carries the
 * context it came from, so a repository can refuse an ActingOwner of another request or an owner
 * spelled from a request value (AR-12).
 */
export class ActingOwner {
  readonly owner: Owner;
  readonly context: AccessContext;

  constructor(token: typeof ACTING_MINT, owner: Owner, context: AccessContext) {
    if (token !== ACTING_MINT) {
      throw new Error('ActingOwner is chosen by AccessContext.resolveActingOwner only (BR-002-11)');
    }
    this.owner = Object.freeze({ ownerType: owner.ownerType, ownerId: owner.ownerId });
    this.context = context;
    Object.freeze(this);
  }
}

interface AccessContextFields {
  accountId: string;
  isAdmin: boolean;
  personas: readonly Persona[];
  memberships: readonly AccessMembership[];
  clientLinks: readonly ClientLinkFacts[];
  selfAdvised: boolean;
  entitlements: readonly string[];
  writableEntitlements: readonly string[];
  readOnly: boolean;
  viaSupportGrant: boolean;
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
   * True for a context that may only read, whatever its owners allow: a support access grant's
   * view (BR-002-25, SPEC-002 part 3). False for an account's own requests.
   */
  readonly readOnly: boolean;
  /**
   * True only for the view a support access grant reads through (AccessContextFactory
   * .supportGrantView). It opens CLIENT data (owned records, BR-002-24/25, DL-002-04), never the
   * account's own data: AccountScopedRepository refuses it on every path (BR-002-02, BR-002-23).
   * Always read-only too.
   */
  readonly viaSupportGrant: boolean;
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
      fields.clientLinks.map(({ officeId, status, endedAt }) =>
        Object.freeze({
          officeId,
          status,
          // A Date is mutable even inside a frozen object: the context keeps epoch ms.
          ...(endedAt ? { endedAtMs: endedAt.getTime() } : {}),
        }),
      ),
    );
    this.selfAdvised = fields.selfAdvised;
    this.entitlements = new FrozenSet(fields.entitlements);
    this.writableEntitlements = new FrozenSet(fields.writableEntitlements);
    this.readOnly = fields.readOnly;
    this.viaSupportGrant = fields.viaSupportGrant;
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

  /** BR-002-03: the owner is one the account conducts (reads only). */
  canReadOwner(owner: Owner): boolean {
    return this.conductedOwners().some((conducted) => sameOwner(conducted, owner));
  }

  /** BR-002-30: the owner is one the account conducts and may write to now. */
  canWriteOwner(owner: Owner): boolean {
    return this.writableOwners().some((writable) => sameOwner(writable, owner));
  }

  /**
   * The owner a write acts for (BR-002-11). The account conducts the owners; the request may only
   * pick among them:
   *
   * - `requestedOfficeId` given (a member of several offices choosing one): it must be an office
   *   the account is a current member of, else `notFound` — the same answer as an office that does
   *   not exist, so nothing is learned about other offices (BR-002-12, AR-14);
   * - nothing requested: the one owner the account conducts; none at all is FORBIDDEN (no record
   *   is involved), and several is VALIDATION_FAILED on `officeId` (the caller must choose).
   *
   * Whether the owner may be written to now (BR-002-30) is the repository's check, with the write.
   */
  resolveActingOwner(requestedOfficeId?: unknown, notFound: ErrorCode = 'NOT_FOUND'): ActingOwner {
    if (requestedOfficeId !== undefined) {
      // SC-10: compared by value; a non-string is no office at all.
      const membership =
        typeof requestedOfficeId === 'string'
          ? this.memberships.find((m) => m.officeId === requestedOfficeId)
          : undefined;
      if (!membership) throw new DomainError(notFound);
      return new ActingOwner(
        ACTING_MINT,
        { ownerType: 'office', ownerId: membership.officeId },
        this,
      );
    }
    const owners = this.conductedOwners();
    const [only] = owners;
    if (!only) throw new DomainError('FORBIDDEN');
    if (owners.length > 1) throw new DomainError('VALIDATION_FAILED', { fields: ['officeId'] });
    return new ActingOwner(ACTING_MINT, only, this);
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
      viaSupportGrant: false,
    });
  }

  /**
   * BR-002-25 / DL-002-04: the view a support access grant reads through — the requester's context
   * made read-only and marked `viaSupportGrant`. Called by SupportGrantService only
   * (test/structural/admin-access-append-only.spec.ts holds it), which seals the view inside a
   * SupportGrantRead that only GrantReadLogger opens (BR-002-27).
   *
   * It reads the CLIENT data the requester reads (owned records, through OwnerScopedRepository) and
   * nothing else: `writableOwners()` is empty and `canWriteWith()` false, so every owned write is
   * refused (OFFICE_READ_ONLY on the requester's own records, the module's not-found otherwise),
   * and AccountScopedRepository refuses the view on every read and write of the account's OWN
   * data (BR-002-02, BR-002-23: favorites, saved filters, reminders are never opened by a grant).
   * It only narrows a context the factory built; an admin's context or a view of a view is a
   * programming error (BR-002-21).
   */
  supportGrantView(ctx: AccessContext): AccessContext {
    if (ctx.isAdmin || ctx.viaSupportGrant) {
      throw new Error('A support grant views a non-admin account context, once (BR-002-21)');
    }
    return new AccessContext(MINT, {
      accountId: ctx.accountId,
      isAdmin: false,
      personas: ctx.personas,
      memberships: ctx.memberships,
      clientLinks: ctx.clientLinks.map(({ officeId, status, endedAtMs }) => ({
        officeId,
        status,
        ...(endedAtMs !== undefined ? { endedAt: new Date(endedAtMs) } : {}),
      })),
      selfAdvised: ctx.selfAdvised,
      entitlements: [...ctx.entitlements],
      writableEntitlements: [],
      readOnly: true,
      viaSupportGrant: true,
    });
  }
}
