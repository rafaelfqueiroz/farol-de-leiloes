import { describe, expect, it } from 'vitest';
import { investorScope } from './investor-scope.js';
import type { InvestorLink } from './investor-scope.js';

const ME = 'investor-x';
const EARLY_END = new Date('2026-03-01T12:00:00.000Z');
const LATE_END = new Date('2026-05-01T12:00:00.000Z');

function scope(clientLinks: readonly InvestorLink[], isAdmin = false) {
  return investorScope({ accountId: ME, isAdmin, clientLinks });
}

describe('investorScope (SPEC-002 BR-002-05, BR-002-07)', () => {
  it('BR-002-05: with no link the account still reads its own self-advised records', () => {
    expect(scope([])).toEqual({
      investorUserId: ME,
      clauses: [{ kind: 'self_advised', ownerId: ME }],
    });
  });

  it('BR-002-05: an active link opens every record of that office where the account is the investor', () => {
    expect(
      scope([
        { officeId: 'office-b', status: 'active' },
        { officeId: 'office-a', status: 'active' },
      ]),
    ).toEqual({
      investorUserId: ME,
      clauses: [
        { kind: 'office', officeId: 'office-a' },
        { kind: 'office', officeId: 'office-b' },
        { kind: 'self_advised', ownerId: ME },
      ],
    });
  });

  it('BR-002-07: an ended link keeps only the records closed at or before its end', () => {
    expect(
      scope([{ officeId: 'office-a', status: 'ended', endedAtMs: LATE_END.getTime() }]).clauses,
    ).toEqual([
      { kind: 'office_closed_by', officeId: 'office-a', closedBy: LATE_END },
      { kind: 'self_advised', ownerId: ME },
    ]);
  });

  it('BR-002-07: several ended links with one office count from the latest end, whatever their order', () => {
    const latestFirst = scope([
      { officeId: 'office-a', status: 'ended', endedAtMs: LATE_END.getTime() },
      { officeId: 'office-a', status: 'ended', endedAtMs: EARLY_END.getTime() },
    ]);
    const latestLast = scope([
      { officeId: 'office-a', status: 'ended', endedAtMs: EARLY_END.getTime() },
      { officeId: 'office-a', status: 'ended', endedAtMs: LATE_END.getTime() },
    ]);

    for (const result of [latestFirst, latestLast]) {
      expect(result.clauses[0]).toEqual({
        kind: 'office_closed_by',
        officeId: 'office-a',
        closedBy: LATE_END,
      });
    }
  });

  it('BR-002-07: ended links of several offices come out in office order', () => {
    const clauses = scope([
      { officeId: 'office-c', status: 'ended', endedAtMs: EARLY_END.getTime() },
      { officeId: 'office-a', status: 'ended', endedAtMs: LATE_END.getTime() },
      { officeId: 'office-b', status: 'ended', endedAtMs: EARLY_END.getTime() },
    ]).clauses.map((clause) => ('officeId' in clause ? clause.officeId : clause.kind));

    expect(clauses).toEqual(['office-a', 'office-b', 'office-c', 'self_advised']);
  });

  it('an active link wins over an older ended one with the same office', () => {
    expect(
      scope([
        { officeId: 'office-a', status: 'ended', endedAtMs: EARLY_END.getTime() },
        { officeId: 'office-a', status: 'active' },
      ]).clauses,
    ).toEqual([
      { kind: 'office', officeId: 'office-a' },
      { kind: 'self_advised', ownerId: ME },
    ]);
  });

  it('fails closed on an ended link without an end date', () => {
    expect(scope([{ officeId: 'office-a', status: 'ended' }]).clauses).toEqual([
      { kind: 'self_advised', ownerId: ME },
    ]);
  });

  it('D-45: a pending invitation grants nothing', () => {
    const pending = { officeId: 'office-a', status: 'pending' } as unknown as InvestorLink;

    expect(scope([pending]).clauses).toEqual([{ kind: 'self_advised', ownerId: ME }]);
  });

  it('BR-002-21 / BR-002-23: an admin reads nothing as investor, whatever its links say', () => {
    expect(scope([{ officeId: 'office-a', status: 'active' }], true)).toEqual({
      investorUserId: ME,
      clauses: [],
    });
  });

  it('gives each scope its own end Date, built from the link’s epoch milliseconds', () => {
    const link: InvestorLink = {
      officeId: 'office-a',
      status: 'ended',
      endedAtMs: LATE_END.getTime(),
    };
    const first = scope([link]).clauses[0];
    const second = scope([link]).clauses[0];

    expect(first).toEqual({ kind: 'office_closed_by', officeId: 'office-a', closedBy: LATE_END });
    expect(first).not.toBe(second);
    expect((first as { closedBy: Date }).closedBy).not.toBe(
      (second as { closedBy: Date }).closedBy,
    );
  });
});
