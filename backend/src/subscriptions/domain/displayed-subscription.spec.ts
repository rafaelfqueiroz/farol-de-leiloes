// SPEC-012 BR-012-11, BR-012-28: which subscription the plan page shows.
import { describe, expect, it } from 'vitest';
import { pickDisplayedSubscription, type DisplayCandidate } from './displayed-subscription.js';

const PAID = new Date('2026-01-01T00:00:00.000Z');
const at = (iso: string) => new Date(iso);
const sub = (
  id: string,
  status: DisplayCandidate['status'],
  createdAt: string,
  firstPaidAt: Date | null = PAID,
) => ({ id, status, createdAt: at(createdAt), firstPaidAt });

describe('pickDisplayedSubscription', () => {
  it('BR-012-08: the subscription in effect wins over any lapsed one', () => {
    const picked = pickDisplayedSubscription([
      sub('old', 'LAPSED', '2026-01-01T00:00:00Z'),
      sub('now', 'CANCELING', '2026-02-01T00:00:00Z'),
    ]);
    expect(picked?.id).toBe('now');
  });

  it('BR-012-28: with none in effect, the latest paid lapse is shown', () => {
    const picked = pickDisplayedSubscription([
      sub('first', 'LAPSED', '2026-01-01T00:00:00Z'),
      sub('second', 'LAPSED', '2026-02-01T00:00:00Z'),
    ]);
    expect(picked?.id).toBe('second');
  });

  it('BR-012-09: a checkout never paid, pending or lapsed, is no plan', () => {
    expect(
      pickDisplayedSubscription([
        sub('p', 'PENDING', '2026-02-01T00:00:00Z', null),
        sub('l', 'LAPSED', '2026-02-02T00:00:00Z', null),
      ]),
    ).toBeNull();
  });

  it('an office with no subscription shows none', () => {
    expect(pickDisplayedSubscription([])).toBeNull();
  });
});
