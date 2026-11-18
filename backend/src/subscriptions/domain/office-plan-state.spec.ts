// SPEC-012 BR-012-21, BR-012-28, BR-012-08: what an office's subscriptions say about its plan, on
// hand-computed instants (TS-04). Grace is 10 days; the lapse below is 2026-03-01T12:00Z, so the
// office is read-only from 2026-03-11T12:00Z.
import { describe, expect, it } from 'vitest';
import {
  ADVISOR_ENTITLEMENT,
  deriveOfficePlanState,
  type SubscriptionFacts,
} from './office-plan-state.js';

const PAID_AT = new Date('2026-01-01T12:00:00.000Z');
const LAPSED_AT = new Date('2026-03-01T12:00:00.000Z');

const WRITABLE = { advisorPlanActive: true, readOnly: false, entitlements: [ADVISOR_ENTITLEMENT] };
const READ_ONLY = { advisorPlanActive: true, readOnly: true, entitlements: [ADVISOR_ENTITLEMENT] };

const inEffect = (status: 'ACTIVE' | 'PAST_DUE' | 'CANCELING'): SubscriptionFacts => ({
  status,
  lapsedAt: null,
  firstPaidAt: PAID_AT,
});
const lapsed = (lapsedAt: Date | null, firstPaidAt: Date | null = PAID_AT): SubscriptionFacts => ({
  status: 'LAPSED',
  lapsedAt,
  firstPaidAt,
});

describe('BR-012-21: an office with a subscription in effect', () => {
  it.each(['ACTIVE', 'PAST_DUE', 'CANCELING'] as const)(
    '%s: advisor plan active, writable',
    (status) => {
      expect(deriveOfficePlanState([inEffect(status)], LAPSED_AT, 10)).toEqual(WRITABLE);
    },
  );

  it('BR-012-28: one in effect beats a lapsed one, so a new payment lifts read-only at once', () => {
    const longAgo = new Date('2026-01-01T00:00:00.000Z');

    expect(deriveOfficePlanState([lapsed(longAgo), inEffect('ACTIVE')], LAPSED_AT, 10)).toEqual(
      WRITABLE,
    );
  });
});

describe('BR-012-21, BR-012-28: an office whose paid subscription lapsed', () => {
  it('within the grace period (day 9) everything works', () => {
    expect(
      deriveOfficePlanState([lapsed(LAPSED_AT)], new Date('2026-03-10T12:00:00.000Z'), 10),
    ).toEqual(WRITABLE);
  });

  it('keeps the advisor persona through the lapse: nothing is hidden, investors keep reading', () => {
    const state = deriveOfficePlanState([lapsed(LAPSED_AT)], LAPSED_AT, 10);

    expect(state?.advisorPlanActive).toBe(true);
  });

  it('at exactly lapse + 10 days it is read-only', () => {
    expect(
      deriveOfficePlanState([lapsed(LAPSED_AT)], new Date('2026-03-11T12:00:00.000Z'), 10),
    ).toEqual(READ_ONLY);
  });

  it('after the grace period (day 11) it is read-only', () => {
    expect(
      deriveOfficePlanState([lapsed(LAPSED_AT)], new Date('2026-03-12T12:00:00.000Z'), 10),
    ).toEqual(READ_ONLY);
  });

  it('uses the latest of several lapsed subscriptions (the earlier one does not end the grace early)', () => {
    const earlier = lapsed(new Date('2026-01-10T00:00:00.000Z'));
    const latest = lapsed(LAPSED_AT);

    // Day 9 after the latest lapse; far past the earlier one's grace.
    const now = new Date('2026-03-10T12:00:00.000Z');
    expect(deriveOfficePlanState([earlier, latest], now, 10)).toEqual(WRITABLE);
    expect(deriveOfficePlanState([latest, earlier], now, 10)).toEqual(WRITABLE);
  });

  it('fails closed: a lapse with no instant is read-only', () => {
    expect(deriveOfficePlanState([lapsed(null)], LAPSED_AT, 10)).toEqual(READ_ONLY);
  });

  it('sorts a lapse with no instant as the oldest', () => {
    const now = new Date('2026-03-10T12:00:00.000Z');

    expect(deriveOfficePlanState([lapsed(null), lapsed(LAPSED_AT)], now, 10)).toEqual(WRITABLE);
  });
});

describe('BR-012-09: what says nothing about an office', () => {
  it('no subscription at all: the office is unknown (SPEC-002 fails closed)', () => {
    expect(deriveOfficePlanState([], LAPSED_AT, 10)).toBeNull();
  });

  it('a pending subscription grants nothing', () => {
    expect(
      deriveOfficePlanState(
        [{ status: 'PENDING', lapsedAt: null, firstPaidAt: null }],
        LAPSED_AT,
        10,
      ),
    ).toBeNull();
  });

  it('a lapse that was never paid is no history', () => {
    expect(deriveOfficePlanState([lapsed(LAPSED_AT, null)], LAPSED_AT, 10)).toBeNull();
  });
});
