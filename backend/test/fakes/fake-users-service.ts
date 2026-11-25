import { normalizeEmail } from '../../src/common/normalize-email.js';
import { DomainError } from '../../src/common/errors/domain-error.js';
import {
  consentResetAfterLink,
  credentialVersionAfterLink,
  decideGoogleLink,
} from '../../src/users/domain/google-link.js';
import { credentialVersionOf } from '../../src/users/domain/credential-version.js';
import {
  abandonedPendingCutoff,
  isAccountActive,
  type UserAccount,
} from '../../src/users/user-account.js';
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
  verifyPassword(...args: Args<'verifyPassword'>): Promise<FakeAccount | null>;
  update(...args: Args<'update'>): Promise<FakeAccount>;
  updateProfile(...args: Args<'updateProfile'>): Promise<FakeAccount>;
  setPassword(...args: Args<'setPassword'>): Promise<FakeAccount>;
  createLocalAccount(...args: Args<'createLocalAccount'>): Promise<FakeAccount>;
  changePassword(...args: Args<'changePassword'>): Promise<FakeAccount>;
  confirmEmail(...args: Args<'confirmEmail'>): Promise<boolean>;
  markWhatsappPromptAnswered(...args: Args<'markWhatsappPromptAnswered'>): Promise<void>;
  discardUnfinishedSignup(...args: Args<'discardUnfinishedSignup'>): Promise<boolean>;
  activateAccount(...args: Args<'activateAccount'>): Promise<boolean>;
  discardAbandonedPending(...args: Args<'discardAbandonedPending'>): Promise<number>;
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

  /** Like the real one: the account is created `pending` and an abandoned pending one is replaced. */
  async createLocalAccount(
    input: Args<'createLocalAccount'>[0],
    now: Args<'createLocalAccount'>[1],
  ): Promise<FakeAccount> {
    await this.discardAbandonedPending({ email: input.email }, now);
    return this.add({ ...input, providers: ['local'], emailVerified: false }, now);
  }

  async createGoogleAccount(
    input: Args<'createGoogleAccount'>[0],
    now: Args<'createGoogleAccount'>[1],
  ): Promise<FakeAccount> {
    await this.discardAbandonedPending({ email: input.email, googleId: input.googleId }, now);
    return this.add(
      {
        email: input.email,
        name: input.name,
        googleId: input.googleId,
        providers: ['google'],
        emailVerified: true,
      },
      now,
    );
  }

  private async add(
    input: { email: string; name: string; password?: string } & Pick<
      FakeAccount,
      'providers' | 'emailVerified' | 'googleId'
    >,
    now: Date,
  ): Promise<FakeAccount> {
    if (await this.findByEmail(input.email)) throw new DomainError('EMAIL_ALREADY_REGISTERED');
    return this.seed({
      ...input,
      _id: `64b0000000000000000000${String(this.nextId++).padStart(2, '0')}`,
      email: normalizeEmail(input.email),
      providers: [...input.providers],
      status: 'pending', // SPEC-010 BR-010-01: usable only after `activateAccount`
      createdAt: now,
      updatedAt: now,
    });
  }

  async findByGoogleId(googleId: string): Promise<FakeAccount | null> {
    return [...this.accounts.values()].find((a) => a.googleId === googleId) ?? null;
  }

  /** The same table as `UsersService.linkGoogleIdentity`, read through `decideGoogleLink`. */
  async linkGoogleIdentity(userId: string, googleId: string, now: Date): Promise<FakeLinkOutcome> {
    const account = this.accounts.get(userId);
    if (!account) return { result: 'not_found' };
    const decision = decideGoogleLink(account, googleId);
    if (decision === 'inactive' || decision === 'google_conflict') return { result: decision };
    account.credentialVersion = credentialVersionAfterLink(account.credentialVersion, decision);
    // SPEC-010: the takeover of an unconfirmed account moves the consent generation and clears the
    // one-time WhatsApp answer, as the real pipeline update does.
    const reset = consentResetAfterLink(account.consentResetAt, decision, now);
    if (reset) account.consentResetAt = reset;
    if (decision === 'linked_unconfirmed') delete account.whatsappPromptAnsweredAt;
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

  /**
   * Like the real one: only an account with the `local` provider and a stored password qualifies.
   * It answers a snapshot of the account, as a database read would, so a caller that keeps it
   * holds the credential version it proved even if the account moves on afterwards.
   */
  async validatePassword(email: string, password: string): Promise<FakeAccount | null> {
    const account = await this.verifyPassword(email, password);
    return account !== null && isAccountActive(account) ? account : null;
  }

  /** The account whose password this is whatever its status (SPEC-009 BR-009-20); a snapshot, like `validatePassword`. */
  async verifyPassword(email: string, password: string): Promise<FakeAccount | null> {
    const account = await this.findByEmail(email);
    const signsInByPassword =
      account?.providers.includes('local') === true && account.password !== undefined;
    return account !== null && signsInByPassword && account.password === password
      ? { ...account, providers: [...account.providers] }
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
    if (account?.email !== normalizeEmail(email) || !isAccountActive(account)) return false;
    account.emailVerified = true;
    return true;
  }

  /** Set once, like the real conditional update, and only under the generation it was given under. */
  async markWhatsappPromptAnswered(
    userId: string,
    at: Date,
    consentResetAt: Date | null,
  ): Promise<void> {
    const account = this.accounts.get(userId);
    const sameGeneration =
      (account?.consentResetAt?.getTime() ?? null) === (consentResetAt?.getTime() ?? null);
    if (account && sameGeneration && account.whatsappPromptAnsweredAt === undefined) {
      account.whatsappPromptAnsweredAt = at;
    }
  }

  /** Like the real one: only a `pending` account is deleted. */
  async discardUnfinishedSignup(userId: string): Promise<boolean> {
    const account = this.accounts.get(userId);
    if (account?.status !== 'pending') return false;
    return this.accounts.delete(userId);
  }

  /** Like the real one: the one transition `pending` → `active`. */
  async activateAccount(userId: string): Promise<boolean> {
    const account = this.accounts.get(userId);
    if (account?.status !== 'pending') return false;
    account.status = 'active';
    return true;
  }

  /** Like the real one: deletes `pending` accounts older than the abandonment window. */
  async discardAbandonedPending(
    keys: { email?: string; googleId?: string },
    now: Date,
  ): Promise<number> {
    const cutoff = abandonedPendingCutoff(now).getTime();
    let deleted = 0;
    for (const [id, account] of this.accounts) {
      const holds =
        (keys.email !== undefined && account.email === normalizeEmail(keys.email)) ||
        (keys.googleId !== undefined && account.googleId === keys.googleId);
      if (holds && account.status === 'pending' && account.createdAt.getTime() < cutoff) {
        this.accounts.delete(id);
        deleted += 1;
      }
    }
    return deleted;
  }
}

function accountId(account: FakeAccount): string {
  return typeof account._id === 'string' ? account._id : account._id.toHexString();
}
