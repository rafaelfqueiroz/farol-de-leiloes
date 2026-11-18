import type { PaymentFailedNotifier } from '../../src/subscriptions/ports/payment-failed.notifier.js';

/** TS-03: records who was told that a renewal payment failed. */
export class FakePaymentFailedNotifier implements PaymentFailedNotifier {
  readonly notified: string[] = [];
  /** Makes the next call fail, as an unreachable mail server would. */
  failNext = false;

  async notifyPaymentFailed(officeId: string): Promise<void> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('mail server unreachable');
    }
    this.notified.push(officeId);
  }
}
