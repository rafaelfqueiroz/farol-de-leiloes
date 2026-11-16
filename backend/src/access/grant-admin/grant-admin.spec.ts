import { describe, expect, it } from 'vitest';
import {
  type AdminAccount,
  changeAdminCapability,
  exitCodeOf,
  GRANT_ADMIN_USAGE,
  type GrantAdminPorts,
  parseGrantAdminArgs,
} from './grant-admin.js';

const EMAIL = 'operadora.teste@example.test';

/** A hand-written fake of the ports (TS-03), recording every write. */
class FakePorts implements GrantAdminPorts {
  readonly writes: { accountId: string; isAdmin: boolean }[] = [];
  relationshipChecks = 0;

  constructor(
    private account: AdminAccount | null,
    private readonly relationships = false,
    private readonly writeMatches = true,
  ) {}

  findAccountByEmail(email: string): Promise<AdminAccount | null> {
    return Promise.resolve(email === EMAIL ? this.account : null);
  }

  setAdminCapability(accountId: string, isAdmin: boolean): Promise<boolean> {
    this.writes.push({ accountId, isAdmin });
    if (this.writeMatches && this.account) this.account = { ...this.account, isAdmin };
    return Promise.resolve(this.writeMatches);
  }

  hasClientRelationships(): Promise<boolean> {
    this.relationshipChecks += 1;
    return Promise.resolve(this.relationships);
  }
}

const plain: AdminAccount = { id: 'u1', isAdmin: false };
const admin: AdminAccount = { id: 'u1', isAdmin: true };

describe('changeAdminCapability (SPEC-002 DL-002-05)', () => {
  it('grants the capability to an account with no client relationship', async () => {
    const ports = new FakePorts(plain);

    await expect(changeAdminCapability(ports, { email: EMAIL, change: 'grant' })).resolves.toBe(
      'granted',
    );
    expect(ports.writes).toEqual([{ accountId: 'u1', isAdmin: true }]);
  });

  it('BR-002-21: refuses an office member, investor or self-advised account and writes nothing', async () => {
    const ports = new FakePorts(plain, true);

    await expect(changeAdminCapability(ports, { email: EMAIL, change: 'grant' })).resolves.toBe(
      'refused_client_relationships',
    );
    expect(ports.writes).toEqual([]);
  });

  it('revokes without asking about relationships (taking it away is always allowed)', async () => {
    const ports = new FakePorts(admin, true);

    await expect(changeAdminCapability(ports, { email: EMAIL, change: 'revoke' })).resolves.toBe(
      'revoked',
    );
    expect(ports.writes).toEqual([{ accountId: 'u1', isAdmin: false }]);
    expect(ports.relationshipChecks).toBe(0);
  });

  it.each([
    ['grant', admin],
    ['revoke', plain],
  ] as const)('%s on an account already so writes nothing', async (change, account) => {
    const ports = new FakePorts(account);

    await expect(changeAdminCapability(ports, { email: EMAIL, change })).resolves.toBe('unchanged');
    expect(ports.writes).toEqual([]);
  });

  it('reports an unknown email', async () => {
    const ports = new FakePorts(plain);

    await expect(
      changeAdminCapability(ports, { email: 'outra@example.test', change: 'grant' }),
    ).resolves.toBe('account_not_found');
    expect(ports.writes).toEqual([]);
  });

  it('reports an account deleted between the lookup and the write', async () => {
    const ports = new FakePorts(plain, false, false);

    await expect(changeAdminCapability(ports, { email: EMAIL, change: 'grant' })).resolves.toBe(
      'account_not_found',
    );
  });
});

describe('parseGrantAdminArgs', () => {
  it('reads --email <address> and grants by default', () => {
    expect(parseGrantAdminArgs(['--email', EMAIL])).toEqual({
      ok: true,
      email: EMAIL,
      change: 'grant',
    });
  });

  it('reads --email=<address> and --revoke in any order', () => {
    expect(parseGrantAdminArgs(['--revoke', `--email=${EMAIL}`])).toEqual({
      ok: true,
      email: EMAIL,
      change: 'revoke',
    });
  });

  it.each([[[]], [['--email']], [['--email', 'not-an-address']], [['--email=']]])(
    'requires an email: %j',
    (argv) => {
      expect(parseGrantAdminArgs(argv)).toEqual({
        ok: false,
        error: `an --email is required; ${GRANT_ADMIN_USAGE}`,
      });
    },
  );

  it('SC-15: refuses an unknown argument without echoing it', () => {
    const result = parseGrantAdminArgs(['--email', EMAIL, 'segredo@example.test']);

    expect(result).toEqual({ ok: false, error: `unknown argument; ${GRANT_ADMIN_USAGE}` });
  });
});

describe('exitCodeOf', () => {
  it.each([
    ['granted', 0],
    ['revoked', 0],
    ['unchanged', 0],
    ['account_not_found', 1],
    ['refused_client_relationships', 1],
  ] as const)('%s exits with %i', (outcome, code) => {
    expect(exitCodeOf(outcome)).toBe(code);
  });
});
