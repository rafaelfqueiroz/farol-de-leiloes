// SPEC-002 AR-12: the MongoDB filters of owner scoping, built only from server state (the request's
// AccessContext or the pure investor scope), never from a request value (BR-002-11, SC-10). The
// repositories merge them with `$and`, so no filter a subclass adds can widen them.
import { Types } from 'mongoose';
import { serverOperators } from '../common/mongo/query-safety.js';
import type { Owner } from './access-context.js';
import type { InvestorScope } from './domain/investor-scope.js';

/** A filter no document matches: an empty owner list reads NOTHING, never "no filter". */
export function matchNothing(): Record<string, unknown> {
  return { _id: serverOperators({ $in: [] }) };
}

/**
 * Records owned by any of `owners` (AR-11: `ownerType` and `ownerId` together). An office id and a
 * self-advised account id never collide in meaning because the type is matched too.
 */
export function ownersFilter(owners: readonly Owner[]): Record<string, unknown> {
  if (owners.length === 0) return matchNothing();
  return {
    $or: owners.map((owner) => ({
      ownerType: { $eq: owner.ownerType },
      ownerId: { $eq: owner.ownerId },
    })),
  };
}

/** Where an owned collection keeps what the investor scope looks at (SPEC-016 journeys). */
export interface InvestorScopeFields {
  /** The account the record is conducted for. */
  readonly investorUserId: string;
  /** The record's lifecycle state. */
  readonly status: string;
  /** The value of `status` once the record is closed. */
  readonly closedStatus: string;
  /** When the record was closed. */
  readonly closedAt: string;
}

export const JOURNEY_INVESTOR_FIELDS: InvestorScopeFields = {
  investorUserId: 'investorUserId',
  status: 'status',
  closedStatus: 'closed',
  closedAt: 'closedAt',
};

/**
 * BR-002-05 / BR-002-07: the pure investor scope as a MongoDB filter. Every clause requires the
 * account to be the record's investor; no clause matches nothing.
 */
export function investorScopeFilter(
  scope: InvestorScope,
  fields: InvestorScopeFields = JOURNEY_INVESTOR_FIELDS,
): Record<string, unknown> {
  if (scope.clauses.length === 0) return matchNothing();
  const clauses = scope.clauses.map((clause): Record<string, unknown> => {
    switch (clause.kind) {
      case 'office':
        return { ownerType: { $eq: 'office' }, ownerId: { $eq: clause.officeId } };
      case 'office_closed_by':
        return {
          ownerType: { $eq: 'office' },
          ownerId: { $eq: clause.officeId },
          [fields.status]: { $eq: fields.closedStatus },
          // SC-10: a bound the server computed from the link's end, never a request value.
          [fields.closedAt]: serverOperators({ $lte: clause.closedBy }),
        };
      case 'self_advised':
        return { ownerType: { $eq: 'self_advised' }, ownerId: { $eq: clause.ownerId } };
    }
  });
  return { [fields.investorUserId]: { $eq: scope.investorUserId }, $or: clauses };
}

/**
 * SC-10 / BR-002-12: an id from a path is a 24-hex ObjectId string or no record at all. A malformed
 * id is answered like a missing one, never as a cast error that would answer differently.
 */
export function isObjectIdString(id: unknown): id is string {
  return typeof id === 'string' && /^[0-9a-fA-F]{24}$/.test(id) && Types.ObjectId.isValid(id);
}
