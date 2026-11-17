// SPEC-002 AR-12 / SC-10: the owner filters are built from server state only and never match
// "everything" by omission. Their behaviour against MongoDB is in
// test/integration/owner-scoped-repository.spec.ts and test/isolation/probe.isolation.spec.ts.
import { describe, expect, it } from 'vitest';
import mongoose from 'mongoose';
import { serverOperators } from '../common/mongo/query-safety.js';
import {
  investorScopeFilter,
  isObjectIdString,
  JOURNEY_INVESTOR_FIELDS,
  matchNothing,
  ownersFilter,
} from './owner-filter.js';

const CLOSED_BY = new Date('2026-04-01T12:00:00.000Z');

describe('ownersFilter (AR-12)', () => {
  it('matches nothing for no owner, never "no filter"', () => {
    const filter = ownersFilter([]);

    // A server-written operator (SC-10): marked trusted, so sanitizeFilter keeps it.
    expect(filter).toEqual({ _id: serverOperators({ $in: [] }) });
    expect(filter).not.toEqual({ _id: { $in: [] } });
    expect(matchNothing()).toEqual(filter);
  });

  it('matches each owner by type and id together', () => {
    expect(
      ownersFilter([
        { ownerType: 'office', ownerId: 'o1' },
        { ownerType: 'self_advised', ownerId: 'u1' },
      ]),
    ).toEqual({
      $or: [
        { ownerType: { $eq: 'office' }, ownerId: { $eq: 'o1' } },
        { ownerType: { $eq: 'self_advised' }, ownerId: { $eq: 'u1' } },
      ],
    });
  });
});

describe('investorScopeFilter (BR-002-05, BR-002-07)', () => {
  it('matches nothing for a scope without clauses (an admin)', () => {
    expect(investorScopeFilter({ investorUserId: 'x', clauses: [] })).toEqual(matchNothing());
  });

  it('requires the account to be the investor, under any of the clauses', () => {
    const filter = investorScopeFilter({
      investorUserId: 'x',
      clauses: [
        { kind: 'office', officeId: 'a' },
        { kind: 'office_closed_by', officeId: 'b', closedBy: CLOSED_BY },
        { kind: 'self_advised', ownerId: 'x' },
      ],
    });

    expect(filter).toEqual({
      investorUserId: { $eq: 'x' },
      $or: [
        { ownerType: { $eq: 'office' }, ownerId: { $eq: 'a' } },
        {
          ownerType: { $eq: 'office' },
          ownerId: { $eq: 'b' },
          status: { $eq: 'closed' },
          closedAt: serverOperators({ $lte: CLOSED_BY }),
        },
        { ownerType: { $eq: 'self_advised' }, ownerId: { $eq: 'x' } },
      ],
    });
  });

  it('uses the field names a collection gives', () => {
    const filter = investorScopeFilter(
      {
        investorUserId: 'x',
        clauses: [{ kind: 'office_closed_by', officeId: 'b', closedBy: CLOSED_BY }],
      },
      { investorUserId: 'clientId', status: 'phase', closedStatus: 'done', closedAt: 'doneAt' },
    );

    expect(filter).toEqual({
      clientId: { $eq: 'x' },
      $or: [
        {
          ownerType: { $eq: 'office' },
          ownerId: { $eq: 'b' },
          phase: { $eq: 'done' },
          doneAt: serverOperators({ $lte: CLOSED_BY }),
        },
      ],
    });
    expect(JOURNEY_INVESTOR_FIELDS.closedStatus).toBe('closed');
  });
});

describe('isObjectIdString (BR-002-12, SC-10)', () => {
  it('accepts a 24-hex id only', () => {
    expect(isObjectIdString(new mongoose.Types.ObjectId().toHexString())).toBe(true);
    for (const id of ['not-an-id', '64b7f000000000000000000', 'abcdefghijkl', 12, { $ne: null }]) {
      expect(isObjectIdString(id)).toBe(false);
    }
  });
});
