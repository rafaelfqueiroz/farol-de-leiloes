import { describe, expect, it, vi } from 'vitest';
import { notifyBillingChanged, onBillingChanged } from './billing-events';

describe('billing events', () => {
  it('tells every listener, until it unsubscribes', () => {
    const first = vi.fn();
    const second = vi.fn();
    const offFirst = onBillingChanged(first);
    onBillingChanged(second)();

    notifyBillingChanged();
    offFirst();
    notifyBillingChanged();

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
  });
});
