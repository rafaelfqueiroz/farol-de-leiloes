// SPEC-012 BR-012-20 seam: the email to every member of the office when a renewal payment fails,
// with a link to update the payment method. The webhook decides WHEN (a claim on the event, so a
// replay sends it once); the notifier decides HOW. SubscriptionsModule binds
// `EmailPaymentFailedNotifier` (payment-failed-email.notifier.ts).

export interface PaymentFailedNotifier {
  /** Tells every current member of the office that a renewal payment failed. May throw. */
  notifyPaymentFailed(officeId: string): Promise<void>;
}

export const PAYMENT_FAILED_NOTIFIER = Symbol('PAYMENT_FAILED_NOTIFIER');
