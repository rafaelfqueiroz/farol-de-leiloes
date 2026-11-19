// SPEC-012 BR-012-20 seam, implemented by the billing PR (PR2): the email to every member of the
// office when a renewal payment fails, with a link to update the payment method. The webhook
// decides WHEN (a claim on the event, so a replay sends it once); the notifier decides HOW.
//
// Until it is bound (in SubscriptionsModule) the default does nothing.

export interface PaymentFailedNotifier {
  /** Tells every current member of the office that a renewal payment failed. May throw. */
  notifyPaymentFailed(officeId: string): Promise<void>;
}

export const PAYMENT_FAILED_NOTIFIER = Symbol('PAYMENT_FAILED_NOTIFIER');

/** Before the billing PR: nobody is told. */
export class NoPaymentFailedNotifier implements PaymentFailedNotifier {
  notifyPaymentFailed(): Promise<void> {
    return Promise.resolve();
  }
}
