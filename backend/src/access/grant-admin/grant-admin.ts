// SPEC-002 DL-002-05 / BR-002-21: the admin capability is given and taken only by an operator, with
// `npm run grant-admin` (run.ts), never through the API. Giving it is refused to an account that
// is an office member, an investor or self-advised: a person who is both uses two accounts, so that
// every crossing into client data is a logged support grant (DL-002-05).
//
// The rules live here, framework-free, behind small ports, so they are unit-tested (TS-03); run.ts
// only wires them to UsersService and the access sources and prints the outcome.

export type AdminCapabilityChange = 'grant' | 'revoke';

export type GrantAdminOutcome =
  /** The capability was given. */
  | 'granted'
  /** The capability was taken away. */
  | 'revoked'
  /** The account already was (or was not) an admin; nothing was written. */
  | 'unchanged'
  /** No account has that email. */
  | 'account_not_found'
  /** BR-002-21: the account is a member, an investor or self-advised; nothing was written. */
  | 'refused_client_relationships';

export interface AdminAccount {
  readonly id: string;
  readonly isAdmin: boolean;
}

/** The ports the decision needs. */
export interface GrantAdminPorts {
  findAccountByEmail(email: string): Promise<AdminAccount | null>;
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
  if (account.isAdmin === wanted) return 'unchanged';

  // BR-002-21: checked before granting only. Taking the capability away is always allowed.
  if (wanted && (await ports.hasClientRelationships(account.id))) {
    return 'refused_client_relationships';
  }

  if (!(await ports.setAdminCapability(account.id, wanted))) return 'account_not_found';
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
