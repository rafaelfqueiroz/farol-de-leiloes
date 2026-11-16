import { normalizeEmail } from '../../src/common/normalize-email.js';
import { DomainError } from '../../src/common/errors/domain-error.js';
import {
  credentialVersionAfterLink,
  decideGoogleLink,
} from '../../src/users/domain/google-link.js';
import type { UserAccount } from '../../src/users/user-account.js';
import type { UsersService } from '../../src/users/users.service.js';

/** An account as the fake stores it: the public contract plus the secrets the real document holds. */
export type FakeAccount = UserAccount & { password?: string; googleId?: string };

type FakeLinkOutcome =
  | { result: 'linked_confirmed' | 'linked_unconfirmed'; account: FakeAccount }
  | { result: 'inactive' | 'google_conflict' | 'not_found' };

type Args<K extends keyof UsersService> = Parameters<UsersService[K]>;

/** The slice of `UsersService` that `AuthService` calls, with the real parameter types (TS-03). */
interface UsersPort {
  findByGoogleId(...args: Args<'findByGoogleId'>): Promise<FakeAccount | null>;
  createGoogleAccount(...args: Args<'createGoogleAccount'>): Promise<FakeAccount>;
  linkGoogleIdentity(...args: Args<'linkGoogleIdentity'>): Promise<FakeLinkOutcome>;
  findById(...args: Args<'findById'>): Promise<FakeAccount | null>;
  findByIdFull(...args: Args<'findByIdFull'>): Promise<FakeAccount | null>;
  findByEmail(...args: Args<'findByEmail'>): Promise<FakeAccount | null>;
  validatePassword(...args: Args<'validatePassword'>): Promise<FakeAccount | null>;
  update(...args: Args<'update'>): Promise<FakeAccount>;
  updateProfile(...args: Args<'updateProfile'>): Promise<FakeAccount>;
  updateContactDetails(...args: Args<'updateContactDetails'>): Promise<FakeAccount>;
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
    return this.add({ ...input, providers: ['local'], emailVerified: false });
  }

  async createGoogleAccount(input: Args<'createGoogleAccount'>[0]): Promise<FakeAccount> {
    return this.add({
      email: input.email,
      name: input.name,
      googleId: input.googleId,
      providers: ['google'],
      emailVerified: true,
    });
  }

  private async add(
    input: { email: string; name: string; password?: string } & Pick<
      FakeAccount,
      'providers' | 'emailVerified' | 'googleId'
    >,
  ): Promise<FakeAccount> {
    if (await this.findByEmail(input.email)) throw new DomainError('EMAIL_ALREADY_REGISTERED');
    const now = new Date('2026-01-15T12:00:00.000Z');
    return this.seed({
      ...input,
      _id: `64b0000000000000000000${String(this.nextId++).padStart(2, '0')}`,
      email: normalizeEmail(input.email),
      providers: [...input.providers],
      createdAt: now,
      updatedAt: now,
    });
  }

  async findByGoogleId(googleId: string): Promise<FakeAccount | null> {
    return [...this.accounts.values()].find((a) => a.googleId === googleId) ?? null;
  }

  /** The same table as `UsersService.linkGoogleIdentity`, read through `decideGoogleLink`. */
  async linkGoogleIdentity(userId: string, googleId: string): Promise<FakeLinkOutcome> {
    const account = this.accounts.get(userId);
    if (!account) return { result: 'not_found' };
    const decision = decideGoogleLink(account, googleId);
    if (decision === 'inactive' || decision === 'google_conflict') return { result: decision };
    account.credentialVersion = credentialVersionAfterLink(account.credentialVersion, decision);
    account.googleId = googleId;
    account.emailVerified = true;
    if (decision === 'linked_unconfirmed') {
      delete account.password;
      account.providers = account.providers.filter((p) => p !== 'local');
    }
    if (!account.providers.includes('google')) account.providers.push('google');
    return { result: decision, account };
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

  async validatePassword(email: string, password: string): Promise<FakeAccount | null> {
    const account = await this.findByEmail(email);
    const active = (account?.status ?? 'active') === 'active';
    return active && account?.password !== undefined && account.password === password
      ? account
      : null;
  }

  async update(id: string, dto: Args<'update'>[1]): Promise<FakeAccount> {
    const account = this.accounts.get(id);
    if (!account) throw new DomainError('USER_NOT_FOUND');
    Object.assign(account, dto);
    return account;
  }

  async updateProfile(id: string, profile: Args<'updateProfile'>[1]): Promise<FakeAccount> {
    const account = this.accounts.get(id);
    if (!account) throw new DomainError('USER_NOT_FOUND');
    if (profile.name !== undefined) account.name = profile.name;
    if (profile.phone === null) delete account.phone;
    else if (profile.phone !== undefined) account.phone = profile.phone;
    return account;
  }

  async updateContactDetails(
    id: string,
    details: Args<'updateContactDetails'>[1],
  ): Promise<FakeAccount> {
    const account = this.accounts.get(id);
    if (!account) throw new DomainError('USER_NOT_FOUND');
    if (details.phone === null) delete account.phone;
    else if (details.phone !== undefined) account.phone = details.phone;
    return account;
  }

  async setPassword(userId: string, newPassword: string): Promise<FakeAccount> {
    const account = this.accounts.get(userId);
    if (!account) throw new DomainError('USER_NOT_FOUND');
    account.password = newPassword;
    if (!account.providers.includes('local')) account.providers.push('local');
    return account;
  }

  async changePassword(userId: string, newPassword: string): Promise<FakeAccount> {
    const account = this.accounts.get(userId);
    if (!account) throw new DomainError('USER_NOT_FOUND');
    account.password = newPassword;
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
