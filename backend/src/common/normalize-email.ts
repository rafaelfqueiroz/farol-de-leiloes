/**
 * BR-001-01: an email is the same account whatever its letter case, and surrounding spaces are
 * ignored. Every lookup and every write of an email goes through this one function.
 */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * RFC 6761: `.invalid` is reserved and never resolves, so no real mailbox lives under it. The purge
 * of a closed account (SPEC-010 BR-010-15) leaves `purged-<id>@removed.invalid` in `users.email`, and
 * that namespace must not be claimable by a sign-up: an address squatted there would make the
 * tombstone's unique email collide. Every place an address is accepted refuses it.
 */
export function isReservedEmailDomain(email: string): boolean {
  let domain = normalizeEmail(email).split('@').pop() ?? '';
  // A trailing dot names the same DNS root; strip them in a loop (a `/\.+$/` regex is polynomial on
  // a long run of dots, CodeQL js/polynomial-redos).
  while (domain.endsWith('.')) domain = domain.slice(0, -1);
  return domain.endsWith('.invalid') || domain === 'invalid';
}
