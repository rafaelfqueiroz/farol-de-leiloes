import type { PaymentFailedNotifier } from '../../src/subscriptions/ports/payment-failed.notifier.js';

/** TS-03: records who was told that a renewal payment failed. */
export class FakePaymentFailedNotifier implements PaymentFailedNotifier {
  readonly notified: string[] = [];
  /** Makes the next call fail, as an unreachable mail server would. */
  failNext = false;

  /** How many members the next call reaches (0: nobody to tell). */
  told = 1;

  async notifyPaymentFailed(officeId: string): Promise<number> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('mail server unreachable');
    }
    this.notified.push(officeId);
    return this.told;
  }
}
