// SPEC-010 BR-010-15, BR-010-22, BR-010-23: the collections that hold an account's id and that the
// purge keeps ON PURPOSE, each with the rule that requires it. A model with a user path
// (`userId`, `requesterUserId`, `authorUserId`, `buyerUserId`, `adminUserId`, `createdBy`) is covered
// by a provider's `models` or is declared here, never silently: the registry meta-test
// (test/isolation/personal-data-registry.isolation.spec.ts) fails naming the model otherwise, and
// fails for an entry that names no existing model or that a provider also claims.
//
// Every record below holds ids and instants only, no name, email or phone (SC-15, SC-25), with ONE
// declared exception: the `reason` of an account status event is a line an admin typed (SPEC-009,
// below). That is what makes keeping the rest compatible with "a database search for the account's
// name, email and phone finds nothing" (SPEC-010 acceptance criteria). The periods are lawyer-set
// (Q-21); until set, nothing here is deleted (SECURITY §9).
export interface RetainedModel {
  /** The registered Mongoose model name. */
  readonly model: string;
  /** The MongoDB collection, for the reader. */
  readonly collection: string;
  /** The rule (or inventory row) that requires keeping it. */
  readonly rule: string;
  readonly reason: string;
}

export const RETAINED_MODELS: readonly RetainedModel[] = [
  {
    model: 'SubscriptionEntity',
    collection: 'subscriptions',
    rule: 'BR-010-22',
    reason:
      'Billing records are kept for as long as tax law requires (Q-21); buyerUserId is an id only, no personal data',
  },
  {
    model: 'AdminAccessLogEntity',
    collection: 'adminAccessLogs',
    rule: 'BR-010-23',
    reason:
      'The admin access log is kept for the period the lawyer sets (Q-21); ids and instants only, and insert-only (AR-30)',
  },
  {
    model: 'SupportAccessGrantEntity',
    collection: 'supportAccessGrants',
    rule: 'BR-010-23',
    reason:
      'Support grants explain the admin access log and are kept with it (Q-21); ids and instants only',
  },
  {
    model: 'ConsentEntity',
    collection: 'consents',
    rule: 'SECURITY §9: art. 7º II, art. 8º §2º',
    reason:
      'Proof that the account accepted the terms and the policy in force, kept until the lawyer sets a period (Q-21); ids, versions, hashes and instants only. Still exported (BR-010-09)',
  },
  {
    model: 'WhatsappConsentEntity',
    collection: 'whatsappConsents',
    rule: 'SECURITY §9: art. 7º I, art. 8º §5º',
    reason:
      'Proof of a consent that is specific, optional and revocable, kept until the lawyer sets a period (Q-21); ids, answers and instants only. Still exported (BR-010-09)',
  },
  {
    model: 'AccountStatusEventEntity',
    collection: 'accountStatusEvents',
    rule: 'BR-009-16, BR-010-23',
    reason:
      'The history of an account’s deactivations and reactivations stays (SPEC-009 BR-009-16, BR-009-17: admin, instant and reason) until the lawyer sets a period (Q-21); ids and instants plus the reason line an admin typed, which is free text and the one exception to "ids only" here (SECURITY §9). Insert-only (AR-30)',
  },
  {
    model: 'MaintenanceWindowEntity',
    collection: 'maintenancewindows',
    rule: 'BR-003-03',
    reason:
      'An announced maintenance window is part of the availability record and stays; createdBy is the operator account id, no personal data',
  },
];
