// SPEC-002 DL-002-05 / BR-002-21: the admin capability is given and taken only by an operator, with
// `npm run grant-admin` (run.ts), never through the API. Giving it is refused to an account that
// is an office member, an investor or self-advised: a person who is both uses two accounts, so that
// every crossing into client data is a logged support grant (DL-002-05). It is also refused to an
// account whose email is not confirmed or that is not active (SC-09).
//
// TOCTOU (BR-002-21): the relationship check and the grant are separate steps over two collections.
// The grant write is conditional on the state the decision read (UsersService.setAdminCapability),
// and the relationships are read again AFTER the write: one that appeared in between undoes the
// grant. SPEC-011's membership and client-link writes MUST be the mirror image: conditional on the
// account's `isAdmin != true`, checked after their write (or in one transaction), so an account can
// never end up both an admin and a client whichever of the two operations lands first.
//
// The rules live here, framework-free, behind small ports, so they are unit-tested (TS-03); run.ts
// only wires them to UsersService and the access sources and prints the outcome.

export type AdminCapabilityChange = 'grant' | 'revoke';

export type GrantAdminOutcome =
  /** The capability was given. */
  | 'granted'
  /** The capability was taken away (and a legacy `role: 'admin'` reset to 'free'). */
  | 'revoked'
  /** The account already was (or was not) an admin; nothing was written. */
  | 'unchanged'
  /** No account has that email. */
  | 'account_not_found'
  /** The account changed between the lookup and the write (deleted, or no longer as read). */
  | 'account_changed'
  /** BR-002-21: the account is a member, an investor or self-advised; nothing was written. */
  | 'refused_client_relationships'
  /**
   * SC-09: the account's email is not confirmed; nothing was written. Anyone can register a
   * colleague's address before they do (pre-registration takeover): only a confirmed address
   * proves the operator is the one who will sign in.
   */
  | 'refused_unconfirmed_email'
  /** SC-09 / BR-001-16: the account is deactivated or closed; nothing was written. */
  | 'refused_inactive';

export interface AdminAccount {
  readonly id: string;
  readonly isAdmin: boolean;
  /**
   * The legacy plan value `role: 'admin'` (SPEC-002 BR-002-23). It grants nothing, but migration
   * 0004 copies it to `isAdmin`, so a revoke resets it: a re-run of 0004 cannot re-grant.
   */
  readonly legacyAdminRole: boolean;
  readonly emailVerified: boolean;
  /** BR-001-16: a missing status counts as active (AR-28). */
  readonly active: boolean;
}

/** The ports the decision needs. */
export interface GrantAdminPorts {
  findAccountByEmail(email: string): Promise<AdminAccount | null>;
  /**
   * Writes the change, atomically conditional on the state the decision was made on: a grant only
   * matches an account that is not an admin yet, has a confirmed email and is active; a revoke
   * clears the flag and resets a legacy `role: 'admin'`. Returns whether the write matched.
   */
  setAdminCapability(accountId: string, isAdmin: boolean): Promise<boolean>;
  /** BR-002-21, from the SPEC-002 sources: memberships, any client link, journeys, self-advised. */
  hasClientRelationships(accountId: string): Promise<boolean>;
}

export async function changeAdminCapability(
  ports: GrantAdminPorts,
  request: { email: string; change: AdminCapabilityChange },
): Promise<GrantAdminOutcome> {
  const account = await ports.findAccountByEmail(request.email);
  if (!account) return 'account_not_found';

  const wanted = request.change === 'grant';
  if (wanted) {
    // SC-09: checked before "unchanged", so an admin that should not be one is reported, not
    // confirmed (AdminGuard refuses an unconfirmed admin anyway, BR-002-23).
    if (!account.active) return 'refused_inactive';
    if (!account.emailVerified) return 'refused_unconfirmed_email';
    if (account.isAdmin) return 'unchanged';
    // BR-002-21: checked before granting only. Taking the capability away is always allowed.
    if (await ports.hasClientRelationships(account.id)) return 'refused_client_relationships';
  } else if (!account.isAdmin && !account.legacyAdminRole) {
    return 'unchanged';
  }

  if (!(await ports.setAdminCapability(account.id, wanted))) return 'account_changed';
  if (wanted && (await ports.hasClientRelationships(account.id))) {
    // BR-002-21 TOCTOU: a relationship was created between the check and the write: undo.
    await ports.setAdminCapability(account.id, false);
    return 'refused_client_relationships';
  }
  return wanted ? 'granted' : 'revoked';
}

export type GrantAdminArgs =
  { ok: true; email: string; change: AdminCapabilityChange } | { ok: false; error: string };

export const GRANT_ADMIN_USAGE = 'usage: npm run grant-admin -- --email <address> [--revoke]';

/** `--email <address>` (or `--email=<address>`), and `--revoke` to take the capability away. */
export function parseGrantAdminArgs(argv: readonly string[]): GrantAdminArgs {
  let email: string | undefined;
  let change: AdminCapabilityChange = 'grant';
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (arg === '--revoke') {
      change = 'revoke';
    } else if (arg === '--email') {
      email = argv[index + 1];
      index += 1;
    } else if (arg.startsWith('--email=')) {
      email = arg.slice('--email='.length);
    } else {
      // SC-15: the unknown argument is not echoed; it may be an address typed in the wrong place.
      return { ok: false, error: `unknown argument; ${GRANT_ADMIN_USAGE}` };
    }
  }
  if (!email || !email.includes('@')) {
    return { ok: false, error: `an --email is required; ${GRANT_ADMIN_USAGE}` };
  }
  return { ok: true, email, change };
}

/** Exit code of the script: 0 when the account ends up as asked, 1 otherwise. */
export function exitCodeOf(outcome: GrantAdminOutcome): 0 | 1 {
  return outcome === 'granted' || outcome === 'revoked' || outcome === 'unchanged' ? 0 : 1;
}
