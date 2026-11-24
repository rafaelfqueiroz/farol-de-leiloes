// SPEC-009 BR-009-13 seam, plugged by SPEC-011 (offices and members): the NAMES of the offices an
// account is a member of, for the admin's account record. Read now, on every call (AR-13).
//
// It is not an access source: it grants nothing and only names. It is therefore bound in
// AdminAccountsModule, not in AccessModule (test/structural/access-source-bindings.spec.ts lists the
// access sources only). SPEC-011 replaces the default below with its own implementation.
//
// BR-009-16: while an account is deactivated its memberships give no access, but they still EXIST and
// the record shows them, so an implementation lists the account's memberships whatever the account's
// status. The names of the offices are not personal data of the member (an office's name is the
// office's); nothing but `id` and `name` leaves this seam.

/** An office the account is a member of. */
export interface AccountOffice {
  readonly id: string;
  readonly name: string;
}

export interface AccountOfficesSource {
  /** The offices the account is a member of, whatever the account's status; none if it has none. */
  officesOf(accountId: string): Promise<readonly AccountOffice[]>;
}

export const ACCOUNT_OFFICES_SOURCE = Symbol('ACCOUNT_OFFICES_SOURCE');

/** Before SPEC-011: no account is a member of any office. */
export class NoAccountOfficesSource implements AccountOfficesSource {
  officesOf(): Promise<readonly AccountOffice[]> {
    return Promise.resolve([]);
  }
}
