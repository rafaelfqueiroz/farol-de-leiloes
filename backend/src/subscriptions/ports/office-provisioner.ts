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
   * Creates the office of a first payment. The contract SPEC-011 MUST honour:
   *
   *  - idempotent by `subscriptionRef` (a unique index on it): two webhook deliveries can race,
   *    and the second gets the first's office back, never a second one (acceptance: "delivering
   *    the activation event twice yields exactly one office");
   *  - per buyer: if `accountId` already created or has an office for ANOTHER pending or paid
   *    subscription ref of the same buyer, it returns THAT office. Two checkouts of one account
   *    must not become two offices; the billing PR also allows one pending checkout per buyer, but
   *    this contract is what holds when the guard is bypassed or raced.
   *
   * The service keeps the first office attached to a subscription; when the port answers a
   * different one it logs a warning with ids (a broken contract, never silently two offices).
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
