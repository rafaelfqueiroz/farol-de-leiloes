// SPEC-012 BR-012-19, BR-012-29: cancel and undo decisions.
import { describe, expect, it } from 'vitest';
import { decideCancel, decideUndoCancel } from './cancellation.js';

const END = new Date('2026-04-01T12:00:00.000Z');

describe('decideCancel', () => {
  it('BR-012-29: inside the window, a cancel refunds and ends at once', () => {
    expect(
      decideCancel({
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        refundEligible: true,
        refunded: false,
      }),
    ).toBe('refund_and_cancel');
  });

  it('BR-012-19: outside the window, a cancel stops renewal and keeps the plan to the period end', () => {
    expect(
      decideCancel({
        status: 'ACTIVE',
        cancelAtPeriodEnd: false,
        refundEligible: false,
        refunded: false,
      }),
    ).toBe('cancel_at_period_end');
    expect(
      decideCancel({
        status: 'PAST_DUE',
        cancelAtPeriodEnd: false,
        refundEligible: false,
        refunded: false,
      }),
    ).toBe('cancel_at_period_end');
  });

  it('BR-012-19: cancelling what is already cancelling is a success that does nothing', () => {
    expect(
      decideCancel({
        status: 'CANCELING',
        cancelAtPeriodEnd: true,
        refundEligible: false,
        refunded: false,
      }),
    ).toBe('noop');
    // Even inside the window: the member chose the period end first.
    expect(
      decideCancel({
        status: 'PAST_DUE',
        cancelAtPeriodEnd: true,
        refundEligible: true,
        refunded: false,
      }),
    ).toBe('noop');
  });

  it('BR-012-29: a refund already made but not yet followed by the end is finished, whatever the window says', () => {
    for (const cancelAtPeriodEnd of [false, true]) {
      expect(
        decideCancel({
          status: 'ACTIVE',
          cancelAtPeriodEnd,
          refundEligible: false,
          refunded: true,
        }),
      ).toBe('refund_and_cancel');
    }
  });

  it('BR-012-19: a lapsed or pending subscription cannot be cancelled', () => {
    for (const status of ['LAPSED', 'PENDING'] as const) {
      expect(
        decideCancel({ status, cancelAtPeriodEnd: false, refundEligible: false, refunded: false }),
      ).toBe('not_cancelable');
    }
  });
});

describe('decideUndoCancel', () => {
  const canceling = {
    status: 'CANCELING',
    cancelAtPeriodEnd: true,
    currentPeriodEnd: END,
  } as const;

  it('BR-012-19: before the period ends, the cancellation can be undone', () => {
    expect(decideUndoCancel(canceling, new Date('2026-03-31T12:00:00.000Z'))).toBe('undo');
  });

  it('BR-012-19: at the end of the paid period (the boundary) and after it, it cannot', () => {
    expect(decideUndoCancel(canceling, END)).toBe('not_changeable');
    expect(decideUndoCancel(canceling, new Date('2026-04-02T12:00:00.000Z'))).toBe(
      'not_changeable',
    );
  });

  it('BR-012-19: with no known period end the provider decides', () => {
    expect(decideUndoCancel({ ...canceling, currentPeriodEnd: null }, END)).toBe('undo');
  });

  it('BR-012-19: undoing what was never cancelled is a success that does nothing', () => {
    expect(
      decideUndoCancel(
        { status: 'ACTIVE', cancelAtPeriodEnd: false, currentPeriodEnd: END },
        new Date('2026-03-01T00:00:00.000Z'),
      ),
    ).toBe('noop');
  });

  it('BR-012-29: a lapsed subscription (a refunded one included) cannot be revived', () => {
    expect(
      decideUndoCancel({ status: 'LAPSED', cancelAtPeriodEnd: true, currentPeriodEnd: END }, END),
    ).toBe('not_changeable');
  });
});
