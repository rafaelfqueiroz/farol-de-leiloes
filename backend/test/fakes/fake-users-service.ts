import { normalizeEmail } from '../../src/common/normalize-email.js';
import { DomainError } from '../../src/common/errors/domain-error.js';
import { credentialVersionOf } from '../../src/users/domain/credential-version.js';
import type { UserAccount } from '../../src/users/user-account.js';
import type { UsersService } from '../../src/users/users.service.js';

/** An account as the fake stores it: the public contract plus the secrets the real document holds. */
export type FakeAccount = UserAccount & { password?: string };

type Args<K extends keyof UsersService> = Parameters<UsersService[K]>;

/** The slice of `UsersService` that `AuthService` calls, with the real parameter types (TS-03). */
interface UsersPort {
  create(...args: Args<'create'>): Promise<FakeAccount>;
  findById(...args: Args<'findById'>): Promise<FakeAccount | null>;
  findByIdFull(...args: Args<'findByIdFull'>): Promise<FakeAccount | null>;
  findByEmail(...args: Args<'findByEmail'>): Promise<FakeAccount | null>;
  validatePassword(...args: Args<'validatePassword'>): Promise<FakeAccount | null>;
  update(...args: Args<'update'>): Promise<FakeAccount>;
  setPassword(...args: Args<'setPassword'>): Promise<FakeAccount>;
  createLocalAccount(...args: Args<'createLocalAccount'>): Promise<FakeAccount>;
  changePassword(...args: Args<'changePassword'>): Promise<FakeAccount>;
  confirmEmail(...args: Args<'confirmEmail'>): Promise<boolean>;
}

/**
 * TS-03: an in-memory fake of what `AuthService` needs from `UsersService`. Passwords are kept
 * and compared as plain text — the hashing is `UsersService`'s concern and tested there. Inject
 * it with `fake as unknown as UsersService`; `implements UsersPort` keeps its signatures tied to
 * the real service, so a signature change breaks this file at compile time.
 */
export class FakeUsersService implements UsersPort {
  readonly accounts = new Map<string, FakeAccount>();
  private nextId = 1;

  /** Seeds an account directly, bypassing `create`. */
  seed(account: FakeAccount): FakeAccount {
    this.accounts.set(accountId(account), account);
    return account;
  }

  async createLocalAccount(input: Args<'createLocalAccount'>[0]): Promise<FakeAccount> {
    return this.create({ ...input, providers: ['local'] });
  }

  async create(dto: Args<'create'>[0]): Promise<FakeAccount> {
    if (await this.findByEmail(dto.email)) throw new DomainError('EMAIL_ALREADY_REGISTERED');
    const now = new Date('2026-01-15T12:00:00.000Z');
    const account: FakeAccount = {
      _id: `64b0000000000000000000${String(this.nextId++).padStart(2, '0')}`,
      email: normalizeEmail(dto.email),
      name: dto.name,
      password: dto.password,
      providers: [...(dto.providers ?? [])],
      emailVerified: dto.providers?.includes('google') ?? false,
      createdAt: now,
      updatedAt: now,
    };
    return this.seed(account);
  }

  async findById(id: string): Promise<FakeAccount | null> {
    return this.accounts.get(id) ?? null;
  }

  async findByIdFull(id: string): Promise<FakeAccount | null> {
    return this.findById(id);
  }

  async findByEmail(email: string): Promise<FakeAccount | null> {
    return [...this.accounts.values()].find((a) => a.email === normalizeEmail(email)) ?? null;
  }

  /**
   * Like the real one: only an account with the `local` provider and a stored password qualifies.
   * It answers a snapshot of the account, as a database read would, so a caller that keeps it
   * holds the credential version it proved even if the account moves on afterwards.
   */
  async validatePassword(email: string, password: string): Promise<FakeAccount | null> {
    const account = await this.findByEmail(email);
    const active = (account?.status ?? 'active') === 'active';
    const signsInByPassword =
      account?.providers.includes('local') === true && account.password !== undefined;
    return active && signsInByPassword && account.password === password
      ? { ...account, providers: [...account.providers] }
      : null;
  }

  async update(id: string, dto: Args<'update'>[1]): Promise<FakeAccount> {
    const account = this.accounts.get(id);
    if (!account) throw new DomainError('USER_NOT_FOUND');
    Object.assign(account, dto);
    return account;
  }

  /** DL-001-02: bumps the credential version; fenced on `expected` when it is given. */
  async setPassword(userId: string, newPassword: string, expected?: number): Promise<FakeAccount> {
    const account = this.accounts.get(userId);
    if (expected !== undefined && (!account || credentialVersionOf(account) !== expected)) {
      throw new DomainError('UNAUTHENTICATED');
    }
    if (!account) throw new DomainError('USER_NOT_FOUND');
    account.password = newPassword;
    account.credentialVersion = credentialVersionOf(account) + 1;
    if (!account.providers.includes('local')) account.providers.push('local');
    return account;
  }

  /** DL-001-02: fenced on the version and on the `local` provider, and bumps the version. */
  async changePassword(
    userId: string,
    newPassword: string,
    expected: number,
  ): Promise<FakeAccount> {
    const account = this.accounts.get(userId);
    if (
      !account ||
      credentialVersionOf(account) !== expected ||
      !account.providers.includes('local')
    ) {
      throw new DomainError('UNAUTHENTICATED');
    }
    account.password = newPassword;
    account.credentialVersion = credentialVersionOf(account) + 1;
    return account;
  }

  async confirmEmail(userId: string, email: string): Promise<boolean> {
    const account = this.accounts.get(userId);
    if (account?.email !== normalizeEmail(email)) return false;
    account.emailVerified = true;
    return true;
  }
}

function accountId(account: FakeAccount): string {
  return typeof account._id === 'string' ? account._id : account._id.toHexString();
}
