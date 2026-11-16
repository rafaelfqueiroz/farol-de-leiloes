// DL-001-02: the credential version binds a session to the credential it was issued for. Pure
// (AR-05); `UsersService` bumps it, `SessionsService` stores it, `JwtStrategy` compares it.

/** The version of an account's credentials; a document written before the field counts as 0. */
export function credentialVersionOf(account: { credentialVersion?: number | null }): number {
  return account.credentialVersion ?? 0;
}
