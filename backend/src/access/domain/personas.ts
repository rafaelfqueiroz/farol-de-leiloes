// SPEC-002 BR-002-14 / DL-002-03: personas are derived from relationships on every request, never
// stored as a role an account can hold or claim. Pure (AR-05): the facts come in as arguments, read
// fresh by AccessContextFactory from the sources SPEC-011, SPEC-012 and SPEC-016 plug in.

export const PERSONAS = ['searcher', 'advisor', 'investor', 'self_advised'] as const;
export type Persona = (typeof PERSONAS)[number];

/** D-45: a pending invitation is never loaded; only these two statuses grant anything. */
export const CLIENT_LINK_STATUSES = ['active', 'ended'] as const;
export type ClientLinkStatus = (typeof CLIENT_LINK_STATUSES)[number];

/** An office the account is a current member of, with what its plan says (SPEC-011, SPEC-012). */
export interface MembershipFacts {
  readonly officeId: string;
  /** SPEC-012: the office's advisor plan is active (BR-002-14). */
  readonly advisorPlanActive: boolean;
  /** SPEC-012 BR-012-28: lapsed beyond the grace period, writes refused (BR-002-30, D-47). */
  readonly readOnly: boolean;
  /** SPEC-012: the plan entitlements of the office. */
  readonly entitlements: readonly string[];
}

/** A link of the account, as investor, with an office (SPEC-011). */
export interface ClientLinkFacts {
  readonly officeId: string;
  readonly status: ClientLinkStatus;
  /** When the link ended (BR-002-07); absent while active. */
  readonly endedAt?: Date;
}

export interface AccessFacts {
  /** DL-002-05: the operator capability, set only by the grant-admin script (BR-002-21). */
  readonly isAdmin: boolean;
  readonly memberships: readonly MembershipFacts[];
  readonly clientLinks: readonly ClientLinkFacts[];
  /** SPEC-016: the account is the investor of at least one journey (BR-002-14). */
  readonly hasJourneyAsInvestor: boolean;
  /** SPEC-011: the account conducts its own journeys. */
  readonly selfAdvised: boolean;
  /** SPEC-011/SPEC-012: the self-advised limits and features, when `selfAdvised`. */
  readonly selfAdvisedEntitlements: readonly string[];
}

export interface ResolvedMembership {
  readonly officeId: string;
  readonly readOnly: boolean;
  readonly advisorPlanActive: boolean;
}

export interface ResolvedAccess {
  readonly personas: readonly Persona[];
  readonly memberships: readonly ResolvedMembership[];
  readonly clientLinks: readonly ClientLinkFacts[];
  readonly selfAdvised: boolean;
  /** Every entitlement of an owner the account conducts, sorted. */
  readonly entitlements: readonly string[];
  /** The entitlements held by an owner that is not read-only (BR-002-30), sorted. */
  readonly writableEntitlements: readonly string[];
}

/** BR-002-14: the personas the facts give, in PERSONAS order; one account may hold several. */
export function derivePersonas(facts: AccessFacts): Persona[] {
  // BR-002-21: an admin account is none of advisor, investor or self-advised, whatever the
  // sources say. It still searches the public catalogue like every active account.
  if (facts.isAdmin) return ['searcher'];

  const personas: Persona[] = ['searcher'];
  if (facts.memberships.some((membership) => membership.advisorPlanActive)) {
    personas.push('advisor');
  }
  // D-45: only an ACTIVE link makes an investor; an ended link alone does not, unless the account
  // is the investor of a journey (SPEC-016).
  if (facts.hasJourneyAsInvestor || facts.clientLinks.some((link) => link.status === 'active')) {
    personas.push('investor');
  }
  if (facts.selfAdvised) personas.push('self_advised');
  return personas;
}

/**
 * The access an account has, from the facts read for this request (BR-002-14, BR-002-15).
 *
 * Fails closed:
 * - an admin gets no membership, link, self-advised status or entitlement even when a source
 *   returns some (BR-002-21, BR-002-23): admin capability grants no client data and no paid
 *   feature;
 * - a link whose status is neither `active` nor `ended` (a pending invitation a source should
 *   never have returned) is dropped (D-45).
 */
export function resolveAccess(facts: AccessFacts): ResolvedAccess {
  if (facts.isAdmin) {
    return {
      personas: derivePersonas(facts),
      memberships: [],
      clientLinks: [],
      selfAdvised: false,
      entitlements: [],
      writableEntitlements: [],
    };
  }

  const clientLinks = facts.clientLinks.filter((link) =>
    (CLIENT_LINK_STATUSES as readonly string[]).includes(link.status),
  );
  const selfAdvisedEntitlements = facts.selfAdvised ? facts.selfAdvisedEntitlements : [];
  const entitlements = [
    ...facts.memberships.flatMap((membership) => membership.entitlements),
    ...selfAdvisedEntitlements,
  ];
  // BR-002-30: a read-only office still reads with its entitlements, but writes with none of them.
  const writableEntitlements = [
    ...facts.memberships
      .filter((membership) => !membership.readOnly)
      .flatMap((membership) => membership.entitlements),
    ...selfAdvisedEntitlements,
  ];

  return {
    personas: derivePersonas({ ...facts, clientLinks }),
    memberships: facts.memberships.map(({ officeId, readOnly, advisorPlanActive }) => ({
      officeId,
      readOnly,
      advisorPlanActive,
    })),
    clientLinks: clientLinks.map((link) => ({ ...link })),
    selfAdvised: facts.selfAdvised,
    entitlements: uniqueSorted(entitlements),
    writableEntitlements: uniqueSorted(writableEntitlements),
  };
}

function uniqueSorted(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}
