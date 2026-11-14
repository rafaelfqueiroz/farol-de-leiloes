import { DomainError } from '../../src/common/errors/domain-error';
import type { UserAccount } from '../../src/users/user-account';
import type { UsersService } from '../../src/users/users.service';

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
  setEmailVerificationToken(...args: Args<'setEmailVerificationToken'>): Promise<string>;
  setResetPasswordToken(...args: Args<'setResetPasswordToken'>): Promise<string>;
  resetPassword(...args: Args<'resetPassword'>): Promise<void>;
  verifyEmail(...args: Args<'verifyEmail'>): Promise<unknown>;
}

/**
 * TS-03: an in-memory fake of what `AuthService` needs from `UsersService`. Passwords are kept
 * and compared as plain text — the hashing is `UsersService`'s concern and tested there. Inject
 * it with `fake as unknown as UsersService`; `implements UsersPort` keeps its signatures tied to
 * the real service, so a signature change breaks this file at compile time.
 */
export class FakeUsersService implements UsersPort {
  readonly accounts = new Map<string, FakeAccount>();
  /** Every `verifyEmail` / `resetPassword` token received, in order. */
  readonly verifiedTokens: string[] = [];
  readonly resetCalls: Array<{ token: string; newPassword: string }> = [];
  private nextId = 1;

  /** Seeds an account directly, bypassing `create`. */
  seed(account: FakeAccount): FakeAccount {
    this.accounts.set(accountId(account), account);
    return account;
  }

  async create(dto: Args<'create'>[0]): Promise<FakeAccount> {
    if (await this.findByEmail(dto.email)) throw new DomainError('EMAIL_ALREADY_REGISTERED');
    const now = new Date('2026-01-15T12:00:00.000Z');
    const account: FakeAccount = {
      _id: `64b0000000000000000000${String(this.nextId++).padStart(2, '0')}`,
      email: dto.email,
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
    return [...this.accounts.values()].find((a) => a.email === email) ?? null;
  }

  async validatePassword(email: string, password: string): Promise<FakeAccount | null> {
    const account = await this.findByEmail(email);
    return account?.password !== undefined && account.password === password ? account : null;
  }

  async update(id: string, dto: Args<'update'>[1]): Promise<FakeAccount> {
    const account = this.accounts.get(id);
    if (!account) throw new DomainError('USER_NOT_FOUND');
    Object.assign(account, dto);
    return account;
  }

  async setPassword(userId: string, newPassword: string): Promise<FakeAccount> {
    const account = this.accounts.get(userId);
    if (!account) throw new DomainError('USER_NOT_FOUND');
    account.password = newPassword;
    if (!account.providers.includes('local')) account.providers.push('local');
    return account;
  }

  async setEmailVerificationToken(userId: string): Promise<string> {
    return `verification-token-for-${userId}`;
  }

  async setResetPasswordToken(email: string): Promise<string> {
    return `reset-token-for-${email}`;
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    this.resetCalls.push({ token, newPassword });
  }

  async verifyEmail(token: string): Promise<FakeAccount | undefined> {
    this.verifiedTokens.push(token);
    return undefined;
  }
}

function accountId(account: FakeAccount): string {
  return typeof account._id === 'string' ? account._id : account._id.toHexString();
}
