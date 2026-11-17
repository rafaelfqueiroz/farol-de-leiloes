// SPEC-002 BR-002-05 / BR-002-07 / D-45: which owned records (journeys, SPEC-016) an account reads
// as their INVESTOR, across every office that conducts one for them. Pure (AR-05): it describes the
// scope as plain data; `investorScopeFilter` (access/owner-filter.ts) makes it a MongoDB filter; SPEC-021
// decides what the investor sees inside each record.
//
// Every clause also requires the account to be the record's investor (`investorUserId`): an
// investor never reads another client's journey of the same office (BR-002-05).
import type { ClientLinkStatus } from './personas.js';

/** A link of the account as investor, as the AccessContext keeps it (end in epoch ms). */
export interface InvestorLink {
  readonly officeId: string;
  readonly status: ClientLinkStatus;
  /** When the link ended (BR-002-07), epoch ms; absent while active. */
  readonly endedAtMs?: number;
}

export interface InvestorScopeFacts {
  /** The account asking, which must be the record's investor. */
  readonly accountId: string;
  /** DL-002-05 / BR-002-21: an admin is nobody's investor, whatever a source says. */
  readonly isAdmin: boolean;
  /** The account's links as investor, read on this request (BR-002-15). */
  readonly clientLinks: readonly InvestorLink[];
}

/** One way a record can be visible to its investor. */
export type InvestorScopeClause =
  /** BR-002-05: an ACTIVE link with the office: every record of that office, any status. */
  | { readonly kind: 'office'; readonly officeId: string }
  /**
   * BR-002-07: the link ENDED: only that office's records already closed when it ended
   * (`closedAt` at or before `closedBy`), never the ones still in progress.
   */
  | { readonly kind: 'office_closed_by'; readonly officeId: string; readonly closedBy: Date }
  /** BR-002-05: the account's own self-advised records, of which it is also the investor. */
  | { readonly kind: 'self_advised'; readonly ownerId: string };

export interface InvestorScope {
  /** Every clause applies only to records whose investor is this account. */
  readonly investorUserId: string;
  /** The record matches when any clause does; none means the account reads nothing. */
  readonly clauses: readonly InvestorScopeClause[];
}

/**
 * The records an account reads as investor (BR-002-05, BR-002-07). Fails closed:
 * - an admin gets no clause at all (BR-002-21, BR-002-23);
 * - a pending link (D-45), or any status other than active or ended, grants nothing;
 * - an ended link with no end date grants nothing: without the date, "closed before the end"
 *   cannot be told apart from "in progress";
 * - an office with an active link and an older ended one is read through the active link;
 * - several ended links with the same office count from the latest end.
 */
export function investorScope(facts: InvestorScopeFacts): InvestorScope {
  if (facts.isAdmin) return { investorUserId: facts.accountId, clauses: [] };

  const active = new Set<string>();
  const endedBy = new Map<string, number>();
  for (const link of facts.clientLinks) {
    if (link.status === 'active') {
      active.add(link.officeId);
    } else if (link.status === 'ended' && link.endedAtMs !== undefined) {
      const previous = endedBy.get(link.officeId);
      if (previous === undefined || link.endedAtMs > previous) {
        endedBy.set(link.officeId, link.endedAtMs);
      }
    }
  }

  const clauses: InvestorScopeClause[] = [...active]
    .sort()
    .map((officeId) => ({ kind: 'office', officeId }));
  for (const [officeId, closedBy] of [...endedBy].sort(([a], [b]) => (a < b ? -1 : 1))) {
    if (!active.has(officeId)) {
      clauses.push({ kind: 'office_closed_by', officeId, closedBy: new Date(closedBy) });
    }
  }
  clauses.push({ kind: 'self_advised', ownerId: facts.accountId });
  return { investorUserId: facts.accountId, clauses };
}
