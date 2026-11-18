// SPEC-012 BR-012-07 seam, plugged by SPEC-011 (offices): when the provider confirms the first
// payment of an account that is not an office member, an office is created with that account as
// its only member. SPEC-011 owns offices, so this spec only calls the port.
//
// Until SPEC-011 binds a real implementation to OFFICE_PROVISIONER (in SubscriptionsModule), the
// default is unavailable and fails closed: the checkout of an account with no office is refused
// (PR2, OFFICE_CREATION_UNAVAILABLE), so nobody pays for an office that cannot be created.

export interface FirstPaymentOffice {
  /** Our subscription ref: the key the implementation deduplicates on. */
  readonly subscriptionRef: string;
  /** The account that paid: the new office's only member (BR-012-07). */
  readonly accountId: string;
}

export interface OfficeProvisioner {
  /** False while no implementation is bound (SPEC-011): checkout must not start (PR2). */
  readonly available: boolean;
  /**
   * Creates the office of a first payment. MUST be idempotent by `subscriptionRef` (SPEC-011 puts
   * a unique index on it): two webhook deliveries can race, and the second must get the first's
   * office back, never a second office (acceptance: "delivering the activation event twice yields
   * exactly one office").
   */
  createForFirstPayment(input: FirstPaymentOffice): Promise<{ officeId: string }>;
}

export const OFFICE_PROVISIONER = Symbol('OFFICE_PROVISIONER');

/** Before SPEC-011: no office can be created. */
export class UnavailableOfficeProvisioner implements OfficeProvisioner {
  readonly available = false;

  createForFirstPayment(): Promise<{ officeId: string }> {
    // A fault, not an outcome: the webhook answers 5xx and the provider retries until SPEC-011
    // is bound, so a confirmed payment is never silently left without its office.
    return Promise.reject(new Error('OFFICE_PROVISIONER is not bound (SPEC-011)'));
  }
}
