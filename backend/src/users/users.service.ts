import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { type ClientSession, Model, type QueryFilter, Types } from 'mongoose';
import { UserEntity, UserDocument } from './schemas/user.schema.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import * as bcrypt from 'bcrypt';
import { DomainError } from '../common/errors/domain-error.js';
import { isReservedEmailDomain, normalizeEmail } from '../common/normalize-email.js';
import { isObjectIdString } from '../access/owner-filter.js';
import { escapeRegex } from '../common/mongo/escape-regex.js';
import { serverOperators } from '../common/mongo/query-safety.js';
import { skipOf, type PageRequest } from '../common/pagination/paginated.js';
import { decideGoogleLink } from './domain/google-link.js';
import {
  CLOSABLE_STATUSES,
  PURGE_CLAIM_FIELDS,
  PURGE_REMOVED_FIELDS,
  purgedEmail,
  purgedEmailWithSuffix,
  residueSweepDueAt,
} from './domain/account-closure.js';
import {
  type AccountRecordFacts,
  type AccountStatus,
  type AccountSummaryFacts,
  abandonedPendingCutoff,
  isAccountActive,
} from './user-account.js';

// SC-10: the only text fields UsersService.update writes (UpdateUserDto, AR-34). Nothing that
// decides how the account signs in is here (`password`, `providers`, `googleId`): those change only
// through the fenced, version-bumping methods (setPassword, changePassword, linkGoogleIdentity),
// so no write of a credential can skip the credential version (DL-001-02, BR-001-31).
// SPEC-002 BR-002-21: `isAdmin` is never here either; only setAdminCapability writes it.
// SPEC-012 BR-012-14: `role`, `subscriptionStatus` and the Stripe ids are not here: the plan is the
// office's and changes only through the provider-confirmed sync.
const TEXT_FIELDS = ['name', 'phone'] as const;

// SC-01: bcrypt, cost >= 10. The one place a password is hashed.
const BCRYPT_COST = 10;
// 11000: MongoDB's duplicate-key error code.
const DUPLICATE_KEY = 11000;
// A tombstone address that collides is retried with a random suffix this many times in all.
const TOMBSTONE_EMAIL_ATTEMPTS = 3;

/**
 * SC-10, BR-001-16: the database-side twin of `isAccountActive` (a missing status is active,
 * AR-28), for every conditional write that must not touch a `pending`, deactivated or closed
 * account. Server-written operators, nothing here comes from a request.
 */
function activeStatusFilter() {
  return serverOperators({ $in: ['active' as const, null] });
}

/**
 * SPEC-010 BR-010-01, BR-010-15: the filter of a write that belongs to the SIGN-UP as well as to a
 * living account: `pending` (its consent records are still being written) or active. Never closed or
 * deactivated: once an account is closed no request that was already in flight may write to it.
 */
function liveStatusFilter() {
  return serverOperators({ $in: ['active' as const, 'pending' as const, null] });
}

/**
 * What `linkGoogleIdentity` did (BR-001-10). `linked_*` carry the account after the write;
 * `linked_unconfirmed` tells the caller the account was taken over from a possible pre-hijacker, so
 * it must end the sessions and outstanding links the password could have produced.
 */
export type GoogleLinkOutcome =
  | { result: 'linked_confirmed' | 'linked_unconfirmed'; account: UserDocument }
  | { result: 'inactive' | 'google_conflict' | 'not_found' };

/**
 * What `deactivateAccount` / `reactivateAccount` did (SPEC-009 BR-009-15, BR-009-17): `changed`; or
 * `conflict`, the account is not in the state the change needs (nothing was written; `status` is the
 * one it has); or `not_found`.
 */
export type AccountStatusChange =
  | { readonly result: 'changed' }
  | { readonly result: 'conflict'; readonly status: AccountStatus }
  | { readonly result: 'not_found' };

/** Options of a status change: the transaction it joins, when it is one step of several (SPEC-009). */
export interface AccountStatusChangeOptions {
  readonly session?: ClientSession;
}

/** SPEC-009 BR-009-13: the statuses an admin's account search and record show; never `pending`. */
const ADMIN_VISIBLE_STATUSES = ['active', 'deactivated', 'closed'] as const;

@Injectable()
export class UsersService {
  // BR-001-14 / SC-05: compared against when no account (or no password) exists, so an unknown
  // email costs the same one bcrypt comparison as a wrong password.
  private dummyHash: Promise<string> | undefined;

  constructor(@InjectModel(UserEntity.name) private readonly userRepository: Model<UserDocument>) {}

  /**
   * BR-001-03 / BR-001-31: sign-up with email and password. Only these three values come from the
   * request; the provider, role, status and confirmation flag are fixed here, so nothing else a
   * caller sends can reach the account.
   */
  async createLocalAccount(
    input: { email: string; name: string; password: string },
    now: Date,
  ): Promise<UserDocument> {
    const email = normalizeEmail(input.email);
    this.assertAcceptableEmail(email);
    // SPEC-010 BR-010-01: an abandoned `pending` sign-up does not hold the address forever.
    await this.discardAbandonedPending({ email }, now);
    // BR-001-01: unique without regard to case or surrounding spaces.
    if (await this.findByEmail(email)) {
      throw new DomainError('EMAIL_ALREADY_REGISTERED');
    }
    return this.save(
      new this.userRepository({
        email,
        name: input.name.trim(),
        password: await this.hashPassword(input.password),
        providers: ['local'],
        emailVerified: false,
        // SPEC-010 BR-010-01: not usable until its consent records exist (`activateAccount`).
        status: 'pending',
      }),
    );
  }

  /**
   * SPEC-010 BR-010-15: no account is created under the reserved `.invalid` domain, where the purge
   * keeps its tombstone addresses (a squatted placeholder would collide with the unique email).
   */
  private assertAcceptableEmail(email: string): void {
    if (isReservedEmailDomain(email)) {
      throw new DomainError('VALIDATION_FAILED', { fields: ['email'] });
    }
  }

  /** The unique index decides a race between two sign-ups with the same email (BR-001-01). */
  private async save(user: UserDocument): Promise<UserDocument> {
    try {
      return await user.save();
    } catch (error) {
      if ((error as { code?: number }).code === DUPLICATE_KEY) {
        throw new DomainError('EMAIL_ALREADY_REGISTERED');
      }
      throw error;
    }
  }

  private hashPassword(plain: string): Promise<string> {
    return bcrypt.hash(plain, BCRYPT_COST);
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userRepository.find().select('-password').exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userRepository.findById(id).select('-password').exec();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userRepository.findOne({ email: { $eq: normalizeEmail(email) } }).exec();
  }

  async findByGoogleId(googleId: string): Promise<UserDocument | null> {
    // SC-10: an id is text; an operator object is nobody's.
    if (typeof googleId !== 'string') return null;
    return this.userRepository.findOne({ googleId: { $eq: googleId } }).exec();
  }

  async findByIdFull(id: string): Promise<UserDocument | null> {
    return this.userRepository.findById(id).select('-password').exec();
  }

  /**
   * BR-001-09 / BR-001-31: the account of a person who signed in with Google and accepted the
   * terms. Only these three values come from the caller; the provider, the confirmed email, the
   * role (searcher only, BR-001-03) and the status are fixed here, and no password is stored.
   */
  async createGoogleAccount(
    input: { googleId: string; email: string; name: string },
    now: Date,
  ): Promise<UserDocument> {
    const email = normalizeEmail(input.email);
    this.assertAcceptableEmail(email);
    await this.discardAbandonedPending({ email, googleId: input.googleId }, now);
    // BR-001-01: unique without regard to case or surrounding spaces.
    if (await this.findByEmail(email)) {
      throw new DomainError('EMAIL_ALREADY_REGISTERED');
    }
    return this.save(
      new this.userRepository({
        email,
        name: input.name.trim(),
        googleId: input.googleId,
        providers: ['google'],
        emailVerified: true, // Google vouched for the address (BR-001-08, BR-001-09)
        // SPEC-010 BR-010-01: `pending` even though the address is confirmed, so that a concurrent
        // Google sign-in cannot find a usable account before the consent records exist.
        status: 'pending',
      }),
    );
  }

  /**
   * SPEC-010 BR-010-01: the one transition out of `pending`, a single conditional update
   * `{ _id, status: 'pending' } → { status: 'active' }`. The caller writes the consent records
   * first; until this write matches, the account can authenticate nothing and nothing has been
   * issued for it. Returns whether it activated (false: the account is gone or not pending).
   */
  async activateAccount(userId: string): Promise<boolean> {
    const result = await this.userRepository
      .updateOne(
        { _id: { $eq: userId }, status: { $eq: 'pending' } },
        { $set: { status: 'active' } },
      )
      .exec();
    return result.matchedCount > 0;
  }

  /**
   * SPEC-010 BR-010-01: deletes `pending` accounts older than `PENDING_SIGNUP_TTL_MS` (injected
   * "now", AR-24) that hold this email or Google identity, so a sign-up that crashed between
   * creating the account and activating it cannot lock the address. Conditional on `pending` AND
   * the age in the same delete: an account that was activated meanwhile, or is still being
   * signed up, is never touched. Returns how many it deleted.
   */
  async discardAbandonedPending(
    keys: { email?: string; googleId?: string },
    now: Date,
  ): Promise<number> {
    const holders: QueryFilter<UserDocument>[] = [];
    if (keys.email !== undefined) holders.push({ email: { $eq: normalizeEmail(keys.email) } });
    if (keys.googleId !== undefined && typeof keys.googleId === 'string') {
      holders.push({ googleId: { $eq: keys.googleId } });
    }
    if (holders.length === 0) return 0;
    const result = await this.userRepository
      .deleteMany({
        status: { $eq: 'pending' },
        createdAt: serverOperators({ $lt: abandonedPendingCutoff(now) }),
        $or: holders,
      })
      .exec();
    return result.deletedCount;
  }

  /**
   * BR-001-10 / DL-001-02: links a Google identity to an existing account. The decision is part of
   * the update, never read-then-write, so a confirmation or a sign-in racing with it cannot slip
   * between the check and the write:
   *
   * - not active (BR-001-16), or already linked to another Google identity (BR-001-11): no write;
   * - email confirmed: `googleId` is set and `google` joins the providers; the password and the
   *   local provider stay;
   * - email not confirmed: the same, and the email becomes confirmed, the password is deleted,
   *   `local` leaves the providers (whoever set that password never proved they own the address)
   *   and the credential version goes up by one, which ends every session issued for the old
   *   credential, even one a sign-in that already checked the password opens afterwards. The same
   *   update moves `consentResetAt` to `now` and clears `whatsappPromptAnsweredAt`: what the
   *   registrant accepted or consented to is not the owner's (SPEC-010).
   *
   * The unique index on `googleId` makes a second account unable to take the same identity even
   * under a race (DUPLICATE_KEY is a conflict). Ending the sessions and links of a taken-over
   * account is the caller's job (`linked_unconfirmed`).
   */
  async linkGoogleIdentity(
    userId: string,
    googleId: string,
    now: Date,
  ): Promise<GoogleLinkOutcome> {
    // Two attempts: the first can miss only because a concurrent write changed the account between
    // the filter and the explanation below (e.g. an unlinked-then-linked race); more is not needed.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      let before;
      try {
        before = await this.applyGoogleLink(userId, googleId, now);
      } catch (error) {
        if ((error as { code?: number }).code === DUPLICATE_KEY) {
          return { result: 'google_conflict' };
        }
        throw error;
      }

      if (before) {
        const account = await this.findById(userId);
        if (!account) return { result: 'not_found' };
        return {
          result: before.emailVerified === true ? 'linked_confirmed' : 'linked_unconfirmed',
          account,
        };
      }

      // The filter matched nothing and nothing was written: say why.
      const current = await this.userRepository
        .findOne({ _id: { $eq: userId } })
        .select('status googleId')
        .lean()
        .exec();
      if (!current) return { result: 'not_found' };
      const decision = decideGoogleLink(current, googleId);
      if (decision === 'inactive' || decision === 'google_conflict') return { result: decision };
    }
    return { result: 'google_conflict' };
  }

  /** The conditional pipeline update of `linkGoogleIdentity`; the document as it was, or null. */
  private applyGoogleLink(userId: string, googleId: string, now: Date) {
    const confirmed = { $eq: ['$emailVerified', true] };
    const providersWithGoogle = (without: string[]) => ({
      $concatArrays: [
        {
          $filter: {
            input: { $ifNull: ['$providers', []] },
            cond: { $not: [{ $in: ['$$this', without] }] },
          },
        },
        [{ $literal: 'google' }],
      ],
    });
    const filter: QueryFilter<UserDocument> = {
      _id: { $eq: userId },
      // A missing status counts as active (BR-001-16, AR-28); a `pending` account is not.
      status: activeStatusFilter(),
      $or: [{ googleId: null }, { googleId: { $eq: googleId } }],
    };
    return this.userRepository
      .findOneAndUpdate(
        filter,
        [
          {
            $set: {
              googleId: { $literal: googleId },
              emailVerified: true,
              providers: {
                $cond: [
                  confirmed,
                  providersWithGoogle(['google']),
                  providersWithGoogle(['local', 'google']),
                ],
              },
              // Confirmed: keep the password. Unconfirmed: delete it.
              password: { $cond: [confirmed, '$password', '$$REMOVE'] },
              // DL-001-02: unconfirmed takes over the credentials, so the version moves in this
              // same update; a session opened for the old one never matches again, whatever
              // revocation write fails or races afterwards (see credentialVersionAfterLink).
              credentialVersion: {
                $cond: [
                  confirmed,
                  '$credentialVersion',
                  { $add: [{ $ifNull: ['$credentialVersion', 0] }, 1] },
                ],
              },
              // SPEC-010: the same takeover makes the consent records of whoever registered the
              // address count for nothing (consentResetAt moves to `now`, from the injected Clock)
              // and asks the owner the one-time WhatsApp request again (the answer flag goes). A
              // confirmed account keeps both. In this one update, so no write can fall in between.
              consentResetAt: {
                $cond: [confirmed, '$consentResetAt', { $literal: now }],
              },
              whatsappPromptAnsweredAt: {
                $cond: [confirmed, '$whatsappPromptAnsweredAt', '$$REMOVE'],
              },
            },
          },
        ],
        { returnDocument: 'before', updatePipeline: true },
      )
      .lean()
      .exec();
  }

  /**
   * Sets the password and makes sure email/password sign-in exists on the account (BR-001-24: a
   * Google-only account gains it through recovery or set-password).
   *
   * DL-001-02: the credential version goes up by one in the same atomic write as the hash, so a
   * session opened for the old credential is refused from this instant. Without
   * `expectedCredentialVersion` (recovery, which holds a spent one-time token) the write is
   * unconditional. With it (set-password) the write applies only while the account still has that
   * version, the one read when the caller checked that no password existed; otherwise nothing is
   * written and the answer is UNAUTHENTICATED.
   */
  async setPassword(
    userId: string,
    newPassword: string,
    expectedCredentialVersion?: number,
  ): Promise<UserDocument> {
    return this.writePassword(userId, newPassword, {
      addLocalProvider: true,
      expectedCredentialVersion,
    });
  }

  /**
   * BR-001-28 is checked by the caller; this stores the new hash on an existing password, and only
   * while the account still has the credential version that authorised the change and still signs
   * in by password (DL-001-02). When a competing credential change got there first nothing is
   * written and the answer is UNAUTHENTICATED. The version goes up by one in the same write.
   */
  async changePassword(
    userId: string,
    newPassword: string,
    expectedCredentialVersion: number,
  ): Promise<UserDocument> {
    return this.writePassword(userId, newPassword, {
      addLocalProvider: false,
      expectedCredentialVersion,
    });
  }

  // BR-001-31: passwords reach the account only through these named methods, never `update`.
  private async writePassword(
    userId: string,
    newPassword: string,
    {
      addLocalProvider,
      expectedCredentialVersion,
    }: { addLocalProvider: boolean; expectedCredentialVersion: number | undefined },
  ): Promise<UserDocument> {
    const hashedPassword = await this.hashPassword(newPassword);

    const fence = expectedCredentialVersion !== undefined;
    const filter: QueryFilter<UserDocument> = {
      _id: { $eq: userId },
      // SPEC-010 BR-010-14, BR-010-01: a closed (or deactivated) or still pending account's
      // credentials are never rewritten, by a recovery link spent after the closure or by any other
      // flow; a missing status is active.
      status: activeStatusFilter(),
      // DL-001-02: the version the caller's decision was based on. An account without the field
      // is at 0 (the same rule as `credentialVersionOf`).
      ...(fence
        ? {
            credentialVersion: serverOperators({
              $in: expectedCredentialVersion === 0 ? [0, null] : [expectedCredentialVersion],
            }),
          }
        : {}),
      // A change needs a password to change.
      ...(addLocalProvider ? {} : { providers: { $eq: 'local' } }),
    };

    const updatedUser = await this.userRepository
      .findOneAndUpdate(
        filter,
        {
          $set: { password: hashedPassword },
          // DL-001-02: in the same atomic write as the hash.
          $inc: { credentialVersion: 1 },
          ...(addLocalProvider ? { $addToSet: { providers: 'local' } } : {}),
        },
        { returnDocument: 'after' },
      )
      .select('-password')
      .exec();

    if (!updatedUser) {
      // Fenced: the account changed (or went) since the caller looked, so the decision it made is
      // stale. Unfenced: the account does not exist.
      throw new DomainError(fence ? 'UNAUTHENTICATED' : 'USER_NOT_FOUND');
    }

    return updatedUser;
  }

  /**
   * Internal writes by named server flows. It is never reached from a request body: the profile
   * goes through `updateProfile` (BR-001-29, BR-001-31). The email is not here at all: it cannot
   * be changed (BR-001-26, D-63). A CPF, date of birth, sex or address is not stored at all (erased
   * by migration 0011, BR-010-06, SC-26). And no plan or subscription field: those are an office's and follow the provider (SPEC-012 BR-012-14).
   */
  async update(id: string, updateUserDto: UpdateUserDto): Promise<UserDocument> {
    // SC-10: the update is built field by field from a whitelist, never the DTO object itself, so
    // a body can neither carry an operator ({ $set, $unset, $inc ... }) nor reach a field the
    // DTO does not name. Each value is checked for its type before it is copied.
    const fields = this.updatableFields(updateUserDto);

    const user = await this.userRepository
      .findOneAndUpdate(
        { _id: { $eq: id }, status: activeStatusFilter() },
        { $set: fields },
        { returnDocument: 'after' },
      )
      .select('-password')
      .exec();

    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }

    return user;
  }

  /**
   * BR-001-25 / BR-001-29 / BR-001-31: the profile an account holder edits is exactly `name` and
   * `phone`. Each is read from the input by name and written under an explicit `$set` / `$unset`;
   * the input object is never spread, so any other property it carries (role, status, providers,
   * emailVerified...) goes nowhere. `phone: null` removes the phone. The email is read-only
   * (BR-001-26, D-63).
   */
  async updateProfile(
    userId: string,
    profile: { name?: string; phone?: string | null },
  ): Promise<UserDocument> {
    const set: Record<string, string> = {};
    const unset: Record<string, ''> = {};
    const name: unknown = profile.name;
    if (typeof name === 'string') set.name = name.trim();
    const phone: unknown = profile.phone;
    if (typeof phone === 'string') set.phone = phone;
    else if (phone === null) unset.phone = '';
    return this.applyChanges(userId, { $set: set, $unset: unset });
  }

  /** Writes the non-empty parts of an update; with nothing to write it just reads the account. */
  private async applyChanges(
    id: string,
    changes: { $set: Record<string, unknown>; $unset?: Record<string, ''> },
  ): Promise<UserDocument> {
    const update: Record<string, Record<string, unknown>> = {};
    if (Object.keys(changes.$set).length > 0) update.$set = changes.$set;
    if (changes.$unset && Object.keys(changes.$unset).length > 0) update.$unset = changes.$unset;

    const query =
      Object.keys(update).length > 0
        ? this.userRepository.findOneAndUpdate(
            { _id: { $eq: id }, status: activeStatusFilter() },
            update,
            { returnDocument: 'after' },
          )
        : this.userRepository.findOne({ _id: { $eq: id }, status: activeStatusFilter() });
    const user = await query.select('-password').exec();

    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }

    return user;
  }

  /** SC-10: the fields of `dto` an update may write, each copied only if it has the right type. */
  private updatableFields(dto: UpdateUserDto): Record<string, unknown> {
    const fields: Record<string, unknown> = {};

    for (const key of TEXT_FIELDS) {
      const value: unknown = dto[key];
      if (typeof value === 'string') fields[key] = value;
    }

    return fields;
  }

  /**
   * Rolls back a sign-up that could not be finished (SPEC-010 BR-010-01: an account must not exist
   * without its acceptance). It deletes the account CREATED BY THIS SAME REQUEST, and only while it
   * is still `pending`: a pending account can authenticate nothing, so nothing was issued for it (no
   * session, no email, no other data) and no concurrent request could have used it. It is the undo
   * of a failed creation, not the deletion of a person's data (AR-31 does not apply: closure and
   * purge are for accounts that lived). An account that became active in the meantime is never
   * deleted. Returns whether it was deleted.
   */
  async discardUnfinishedSignup(userId: string): Promise<boolean> {
    const result = await this.userRepository
      .deleteOne({ _id: { $eq: userId }, status: { $eq: 'pending' } })
      .exec();
    return result.deletedCount > 0;
  }

  async remove(id: string): Promise<void> {
    const result = await this.userRepository.deleteOne({ _id: id }).exec();
    if (result.deletedCount === 0) {
      throw new DomainError('USER_NOT_FOUND');
    }
  }

  /**
   * The account whose password this is, or null. Always runs exactly one bcrypt comparison, against
   * a throwaway hash when there is no account or no password, so an unknown email and a wrong
   * password answer alike and in similar time (BR-001-14, SC-05). A deactivated or closed account
   * is refused after the comparison, with the same null (BR-001-16).
   *
   * Only an account that signs in by password qualifies: `local` among its providers AND a stored
   * hash, both part of the lookup. An account that lost `local` (Google took it over, DL-001-02)
   * is as unknown as a missing email even if a hash is still in the document.
   */
  async validatePassword(email: string, password: string): Promise<UserDocument | null> {
    const account = await this.verifyPassword(email, password);
    return account && isAccountActive(account) ? account : null;
  }

  /**
   * SPEC-009 BR-009-20: the account whose password this is WHATEVER its status, or null. The same
   * single bcrypt comparison as `validatePassword` (which is this plus the status check), so the
   * time does not tell a deactivated account from an active one. Only the sign-in uses it, to tell a
   * deactivated account whose credentials were right from every other refusal; every other caller
   * goes through `validatePassword` and keeps "not active means null".
   */
  async verifyPassword(email: string, password: string): Promise<UserDocument | null> {
    const user = await this.userRepository
      .findOne({
        email: { $eq: normalizeEmail(email) },
        providers: { $eq: 'local' },
        password: serverOperators({ $type: 'string' as const }),
      })
      .exec();
    const hash = user?.password ?? (await this.getDummyHash());
    const matches = await bcrypt.compare(password, hash);
    if (!user?.password || !matches) return null;
    return user;
  }

  private getDummyHash(): Promise<string> {
    this.dummyHash ??= this.hashPassword('not-a-real-password');
    return this.dummyHash;
  }

  /**
   * BR-001-05: a spent confirmation link confirms the address it was sent to, and only while that
   * is still the account's address. The comparison is part of the update, so an email changed
   * between the check and the write cannot be confirmed by a link mailed to the old one.
   * Returns whether the account was confirmed.
   */
  async confirmEmail(userId: string, email: string): Promise<boolean> {
    const result = await this.userRepository
      .updateOne(
        {
          _id: { $eq: userId },
          email: { $eq: normalizeEmail(email) },
          // BR-001-16, SPEC-010 BR-010-01: a pending, deactivated or closed account confirms nothing.
          status: activeStatusFilter(),
        },
        { $set: { emailVerified: true } },
      )
      .exec();
    return result.matchedCount > 0;
  }

  /**
   * SPEC-002 DL-002-05: sets or clears the admin capability. Its only caller is the grant-admin ops
   * script (`access/grant-admin`), which first refuses an account with client relationships
   * (BR-002-21), an unconfirmed email or an inactive account (SC-09); no request reaches it, and
   * `isAdmin` is in no DTO or whitelist (BR-001-30). Returns whether the write matched.
   *
   * - grant: atomic and conditional on the state grant-admin decided on (TOCTOU): the account is not
   *   an admin yet, its email is confirmed and it is active (a missing status is active, AR-28).
   * - revoke: clears the flag and resets a legacy `role: 'admin'` to 'free', so a re-run of
   *   migration 0004 (which copies role 'admin' to the flag) cannot re-grant it. Each of the two
   *   writes is atomic; the first matches only a legacy admin, the second any account.
   */
  async setAdminCapability(userId: string, isAdmin: boolean): Promise<boolean> {
    if (isAdmin) {
      const granted = await this.userRepository
        .updateOne(
          {
            _id: { $eq: userId },
            // SC-10: server-written operators, nothing here comes from a request.
            isAdmin: serverOperators({ $ne: true }),
            emailVerified: { $eq: true },
            status: activeStatusFilter(),
          },
          { $set: { isAdmin: true } },
        )
        .exec();
      return granted.matchedCount > 0;
    }
    const legacy = await this.userRepository
      .updateOne(
        { _id: { $eq: userId }, role: { $eq: 'admin' } },
        { $set: { isAdmin: false, role: 'free' } },
      )
      .exec();
    if (legacy.matchedCount > 0) return true;
    const revoked = await this.userRepository
      .updateOne({ _id: { $eq: userId } }, { $set: { isAdmin: false } })
      .exec();
    return revoked.matchedCount > 0;
  }

  /**
   * SPEC-010 BR-010-27: the one-time WhatsApp consent request is answered, whatever the answer. Set
   * once: the first answer's instant stays, and only under the `consentResetAt` the answer was given
   * under (null: never reset). Written only by the privacy module's
   * WhatsappConsentService, never from a request (BR-001-30).
   */
  async markWhatsappPromptAnswered(
    userId: string,
    at: Date,
    consentResetAt: Date | null,
  ): Promise<void> {
    await this.userRepository
      .updateOne(
        {
          _id: { $eq: userId },
          // BR-010-15: a late answer of a closed (or purged) account marks nothing.
          status: liveStatusFilter(),
          whatsappPromptAnsweredAt: serverOperators({ $exists: false }),
          // The answer is for the consent generation it was given under: if the account was taken
          // over meanwhile (DL-001-02) it is not the owner's answer and marks nothing.
          consentResetAt: { $eq: consentResetAt },
        },
        { $set: { whatsappPromptAnsweredAt: at } },
      )
      .exec();
  }

  /**
   * SPEC-010 BR-010-14: closes the account, at once and for good, in ONE conditional update: the
   * status goes from `active` or `deactivated` (a missing status is active, AR-28) to `closed`,
   * `closedAt` is set to `now` (the injected Clock) and the credential version goes up by one, the
   * same atomic write (SC-03, DL-001-02): a sign-in that already passed its checks just before this
   * instant opened a session stamped with the old version, which `JwtStrategy` now refuses, so no
   * session survives the closure however it races. Revoking the sessions and the rest of the
   * clean-up is the caller's job.
   *
   * The write is FENCED on the credential version the re-authentication verified
   * (`expectedCredentialVersion`, a missing version is 0): a password reset or a Google takeover that
   * changed the credentials while the proof was being checked (the bcrypt comparison takes time)
   * makes the proof stale, and the closure matches nothing (`stale_credentials`, DL-001-02).
   *
   * `closed`: this call closed it. `already_closed`: it was closed before (by a concurrent request
   * or an earlier one): nothing was written, so the caller does nothing more. `stale_credentials`:
   * the account exists and is not closed but its credentials are no longer the ones that were
   * proven: nothing was written. `not_found`: no such account. The conditional update decides a race
   * between two closures: exactly one gets `closed`.
   */
  async closeAccount(
    userId: string,
    now: Date,
    expectedCredentialVersion: number,
  ): Promise<'closed' | 'already_closed' | 'stale_credentials' | 'not_found'> {
    const closed = await this.userRepository
      .findOneAndUpdate(
        {
          _id: { $eq: userId },
          // SC-10: server-written operators; a missing or null status is active (AR-28).
          status: serverOperators({ $in: [...CLOSABLE_STATUSES, null] }),
          // DL-001-02: the version the proof was given for; an account without the field is at 0.
          credentialVersion: serverOperators({
            $in: expectedCredentialVersion === 0 ? [0, null] : [expectedCredentialVersion],
          }),
        },
        { $set: { status: 'closed', closedAt: now }, $inc: { credentialVersion: 1 } },
        { returnDocument: 'after' },
      )
      .select('_id')
      .lean()
      .exec();
    if (closed) return 'closed';
    // Nothing matched: it does not exist, it is already closed, or its credentials moved on.
    const current = await this.userRepository
      .findOne({ _id: { $eq: userId } })
      .select('status')
      .lean()
      .exec();
    if (!current) return 'not_found';
    return current.status === 'closed' ? 'already_closed' : 'stale_credentials';
  }

  /**
   * SPEC-010 BR-010-15 / AR-12: the closed accounts whose personal data is still to be purged, with
   * no live claim at `now`, leaving out `excludeIds`. FAIR order: the accounts never attempted first,
   * then the least recently attempted (`lastPurgeAttemptAt`, stamped by every claim), then, among the
   * accounts of one instant (a whole run stamps one `now`), the fewest attempts, then the oldest
   * closure (a missing `closedAt` first of all). The attempt count is what keeps the rotation even
   * when many accounts share an instant: with the closure alone as the tie-break, the oldest
   * closures of the last run would be the first of the next one, run after run. An account whose purge keeps failing therefore goes
   * to the back of the queue after every attempt, whatever the run's attempt budget, and can never
   * starve a healthy account that closed later. A job method: it reads across accounts and answers
   * ids only.
   */
  async findPurgeCandidates(
    now: Date,
    limit: number,
    excludeIds: readonly string[] = [],
  ): Promise<string[]> {
    const rows = await this.userRepository
      .find({
        status: { $eq: 'closed' },
        purgedAt: serverOperators({ $exists: false }),
        $or: [
          { purgeClaimUntil: serverOperators({ $exists: false }) },
          { purgeClaimUntil: serverOperators({ $lte: now }) },
        ],
        // The accounts that already failed (or were skipped) in this run: a permanently failing
        // head of the queue must not keep the others from being purged.
        ...(excludeIds.length > 0 ? { _id: serverOperators({ $nin: [...excludeIds] }) } : {}),
      })
      .sort({ lastPurgeAttemptAt: 1, purgeAttempts: 1, closedAt: 1, _id: 1 })
      .limit(limit)
      .select('_id')
      .lean()
      .exec();
    return rows.map((row) => row._id.toHexString());
  }

  /**
   * The atomic claim of one closed, unpurged account for a purge worker: a random token and its
   * expiry, set only while the account is closed, not purged and has no live claim (one conditional
   * update, so of two workers exactly one wins). True when this worker holds it. The same write
   * stamps the attempt (`lastPurgeAttemptAt` = `now`, `purgeAttempts` + 1), so it is conditional on
   * the claim and cannot be lost or doubled: the fair order of `findPurgeCandidates` rests on it.
   */
  async claimForPurge(userId: string, token: string, now: Date, until: Date): Promise<boolean> {
    const result = await this.userRepository
      .updateOne(
        {
          _id: { $eq: userId },
          status: { $eq: 'closed' },
          purgedAt: serverOperators({ $exists: false }),
          $or: [
            { purgeClaimUntil: serverOperators({ $exists: false }) },
            { purgeClaimUntil: serverOperators({ $lte: now }) },
          ],
        },
        {
          $set: { purgeClaimToken: token, purgeClaimUntil: until, lastPurgeAttemptAt: now },
          $inc: { purgeAttempts: 1 },
        },
      )
      .exec();
    return result.matchedCount > 0;
  }

  /** Gives the claim back (a failed purge, so the next run need not wait for the lease to end). */
  async releasePurgeClaim(userId: string, token: string): Promise<void> {
    await this.userRepository
      .updateOne(
        { _id: { $eq: userId }, purgeClaimToken: { $eq: token } },
        { $unset: { purgeClaimToken: '', purgeClaimUntil: '' } },
      )
      .exec();
  }

  /**
   * SPEC-010 BR-010-15: the tombstone, the LAST step of a purge, conditional on the claim the worker
   * holds (`token`) and on the account still being closed and unpurged. It removes every field in
   * `PURGE_REMOVED_FIELDS`, replaces the email with `purged-<id>@removed.invalid` (which frees the
   * real address for a new sign-up) and sets `purgedAt`; `_id`, `status`, `closedAt` and the rest
   * stay. In one update, so a crash leaves either the whole personal document or the whole
   * tombstone. False when the claim was lost (nothing was written).
   */
  async completePurge(userId: string, token: string, now: Date): Promise<boolean> {
    const removed = Object.fromEntries(
      [...PURGE_REMOVED_FIELDS, ...PURGE_CLAIM_FIELDS].map((field) => [field, '']),
    );
    // The plain tombstone address first; if somebody holds it (a placeholder squatted before sign-ups
    // refused `.invalid`, or planted by hand) the purge never fails for that: it takes the same
    // address with a random suffix. The unique index on `email` is what says "taken".
    for (let attempt = 0; attempt < TOMBSTONE_EMAIL_ATTEMPTS; attempt += 1) {
      const email =
        attempt === 0
          ? purgedEmail(userId)
          : purgedEmailWithSuffix(userId, randomBytes(8).toString('hex'));
      try {
        const result = await this.userRepository
          .updateOne(
            {
              _id: { $eq: userId },
              status: { $eq: 'closed' },
              purgeClaimToken: { $eq: token },
              purgedAt: serverOperators({ $exists: false }),
            },
            // BR-010-15: the residue sweep is due a day later (see `sweepResidueOf`).
            {
              $set: { email, purgedAt: now, residueSweepDueAt: residueSweepDueAt(now) },
              $unset: removed,
            },
            // The tombstone is a controlled write of fields the schema requires (name) to be removed.
            { runValidators: false },
          )
          .exec();
        return result.matchedCount > 0;
      } catch (error) {
        if ((error as { code?: number }).code !== DUPLICATE_KEY) throw error;
      }
    }
    throw new Error('A tombstone address could not be found');
  }

  /**
   * SPEC-010 BR-010-15, the RESIDUE SWEEP: the purged accounts whose sweep is due at `now`, the
   * longest-waiting first, leaving out `excludeIds`. A request that passed authentication before the
   * closure can write a record of the account after the purge deleted them; the job re-runs the
   * providers' (idempotent) purge once for these. A job method: it answers ids only.
   */
  async findResidueSweepCandidates(
    now: Date,
    limit: number,
    excludeIds: readonly string[] = [],
  ): Promise<string[]> {
    const rows = await this.userRepository
      .find({
        status: { $eq: 'closed' },
        purgedAt: serverOperators({ $exists: true }),
        residueSweepDueAt: serverOperators({ $lte: now }),
        ...(excludeIds.length > 0 ? { _id: serverOperators({ $nin: [...excludeIds] }) } : {}),
      })
      .sort({ residueSweepDueAt: 1, _id: 1 })
      .limit(limit)
      .select('_id')
      .lean()
      .exec();
    return rows.map((row) => row._id.toHexString());
  }

  /**
   * The sweep of one account is done: `residueSweptAt` = `now` replaces the due instant, in one
   * update conditional on the account still waiting for it (so it is set once, and never on an
   * account that is not purged). True when this call marked it.
   */
  async markResidueSwept(userId: string, now: Date): Promise<boolean> {
    const result = await this.userRepository
      .updateOne(
        {
          _id: { $eq: userId },
          status: { $eq: 'closed' },
          residueSweepDueAt: serverOperators({ $exists: true }),
        },
        { $set: { residueSweptAt: now }, $unset: { residueSweepDueAt: '' } },
      )
      .exec();
    return result.matchedCount > 0;
  }

  /**
   * A sweep that failed is tried again later, not at the head of the queue every run: the due instant
   * moves to `until` (conditional on the account still waiting), so a sweep that keeps failing never
   * starves the others (the same fairness as the purge).
   */
  async deferResidueSweep(userId: string, until: Date): Promise<void> {
    await this.userRepository
      .updateOne(
        {
          _id: { $eq: userId },
          status: { $eq: 'closed' },
          residueSweepDueAt: serverOperators({ $exists: true }),
        },
        { $set: { residueSweepDueAt: until } },
      )
      .exec();
  }

  /**
   * SPEC-010 BR-010-15: how many closed accounts are still unpurged although they were closed at or
   * before `closedAtOrBefore` (the alert's count). Counts only, never who.
   */
  async countOverduePurges(closedAtOrBefore: Date): Promise<number> {
    return this.userRepository
      .countDocuments({
        status: { $eq: 'closed' },
        purgedAt: serverOperators({ $exists: false }),
        closedAt: serverOperators({ $lte: closedAtOrBefore }),
      })
      .exec();
  }

  /** SPEC-010 BR-010-11: whether the account is active (a missing status counts, AR-28). */
  async isActive(userId: string): Promise<boolean> {
    const user = await this.userRepository
      .findOne({ _id: { $eq: userId } })
      .select('status')
      .lean()
      .exec();
    return !!user && isAccountActive(user);
  }

  async isEmailVerified(userId: string): Promise<boolean> {
    const user = await this.userRepository.findById(userId).exec();
    return user?.emailVerified ?? false;
  }

  /**
   * SPEC-009 BR-009-15, SC-03: `active` -> `deactivated` in ONE conditional update that also moves the
   * credential version. A session is stamped with the version it was issued for and `JwtStrategy`
   * refuses it once the account's differs, so every session the account has, and one a sign-in that
   * already passed its checks opens a moment later, is dead for good: even a failed or racing
   * revocation write cannot leave one, and reactivating the account does not bring any back. The same
   * write decides a race between two deactivations: exactly one matches. A missing status is active
   * (AR-28); `pending`, `closed` and an account already deactivated are a `conflict`, nothing written.
   *
   * With `options.session` it is one step of a transaction (the admin's change and its history entry
   * commit together or not at all); a conflict is then the caller's to turn into an abort.
   */
  deactivateAccount(
    userId: string,
    options: AccountStatusChangeOptions = {},
  ): Promise<AccountStatusChange> {
    return this.transitionStatus(userId, activeStatusFilter(), 'deactivated', options);
  }

  /**
   * SPEC-009 BR-009-17: `deactivated` -> `active`, one conditional update. The credential version
   * moves again, so no session survives from before either change (the deactivation already ended
   * them; this keeps that true whatever a racing sign-in did in between). Memberships, the
   * subscription and the account's data are not touched here, or anywhere in the deactivation.
   */
  reactivateAccount(
    userId: string,
    options: AccountStatusChangeOptions = {},
  ): Promise<AccountStatusChange> {
    return this.transitionStatus(userId, { $eq: 'deactivated' }, 'active', options);
  }

  private async transitionStatus(
    userId: string,
    from: QueryFilter<UserDocument>['status'],
    to: 'active' | 'deactivated',
    { session }: AccountStatusChangeOptions,
  ): Promise<AccountStatusChange> {
    if (!isObjectIdString(userId)) return { result: 'not_found' };
    const inSession = session ? { session } : {};
    const changed = await this.userRepository
      .findOneAndUpdate(
        { _id: { $eq: userId }, status: from },
        // SC-03, DL-001-02: the version moves in the same atomic write as the status.
        { $set: { status: to }, $inc: { credentialVersion: 1 } },
        { returnDocument: 'after', ...inSession },
      )
      .select('_id')
      .lean()
      .exec();
    if (changed) return { result: 'changed' };
    // Nothing matched: it does not exist, or it is not in the state the change needs.
    const current = await this.userRepository
      .findOne({ _id: { $eq: userId } }, null, inSession)
      .select('status')
      .lean()
      .exec();
    if (!current) return { result: 'not_found' };
    return { result: 'conflict', status: current.status ?? 'active' };
  }

  /**
   * SPEC-009 BR-009-13: the admin's search of accounts by name or email, case-insensitively and by
   * CONTAINS: the text is escaped, so it is literal (SC-10). `kind` `email` (the text has an `@`)
   * looks at the address only; `name` looks at the name and the address. Never a `pending` sign-up
   * and never a purged tombstone; sorted by name then id; one page and the number of matches. The
   * rows carry the fields of a list row and nothing else (`select`), no password and no hash.
   *
   * It scans: a contains-search cannot use an index, so the cost grows with the number of accounts;
   * the route's per-account limit, the 3-character minimum and the page size bound what one admin can
   * ask. Revisit with a search index when the collection outgrows that (ARCHITECTURE §4).
   */
  async searchAccounts(
    search: { readonly kind: 'email' | 'name'; readonly text: string },
    page: PageRequest,
  ): Promise<{ items: AccountSummaryFacts[]; total: number }> {
    const matching = serverOperators({ $regex: escapeRegex(search.text), $options: 'i' });
    const filter: QueryFilter<UserDocument> = {
      $and: [
        { status: serverOperators({ $in: [...ADMIN_VISIBLE_STATUSES, null] }) },
        { purgedAt: serverOperators({ $exists: false }) },
        search.kind === 'email'
          ? { email: matching }
          : { $or: [{ name: matching }, { email: matching }] },
      ],
    };
    const [rows, total] = await Promise.all([
      this.userRepository
        .find(filter)
        .select('name email status createdAt')
        .sort({ name: 1, _id: 1 })
        .skip(skipOf(page))
        .limit(page.pageSize)
        .lean()
        .exec(),
      this.userRepository.countDocuments(filter).exec(),
    ]);
    return {
      items: rows.map((row) => ({
        id: row._id.toHexString(),
        name: row.name ?? null,
        email: row.email,
        status: (row.status ?? 'active') as AccountSummaryFacts['status'],
        createdAt: row.createdAt,
      })),
      total,
    };
  }

  /**
   * SPEC-009 BR-009-13: the account fields an admin's record shows, and no others: the projection
   * names them, so nothing added to the schema later reaches the record. Null for an unknown or
   * malformed id and for a `pending` sign-up. A purged tombstone answers with no name, address or
   * phone (SPEC-010 BR-010-15).
   */
  async findAccountRecord(userId: string): Promise<AccountRecordFacts | null> {
    if (!isObjectIdString(userId)) return null;
    const row = await this.userRepository
      .findOne({
        _id: { $eq: userId },
        status: serverOperators({ $in: [...ADMIN_VISIBLE_STATUSES, null] }),
      })
      .select('name email phone createdAt providers emailVerified status isAdmin purgedAt')
      .lean()
      .exec();
    if (!row) return null;
    const purged = row.purgedAt !== undefined;
    return {
      id: row._id.toHexString(),
      name: purged ? null : (row.name ?? null),
      email: purged ? null : row.email,
      phone: purged ? null : (row.phone ?? null),
      createdAt: row.createdAt,
      providers: [...(row.providers ?? [])],
      emailVerified: row.emailVerified === true,
      status: (row.status ?? 'active') as AccountRecordFacts['status'],
      isAdmin: row.isAdmin === true,
    };
  }

  /**
   * SPEC-009 BR-009-17: the current names of the accounts with these ids (an admin's name next to a
   * history entry), by id. An id with no account, or a purged one, is simply absent.
   */
  async namesOf(userIds: readonly string[]): Promise<Map<string, string>> {
    const ids = [...new Set(userIds)].filter(isObjectIdString).map((id) => new Types.ObjectId(id));
    if (ids.length === 0) return new Map();
    const rows = await this.userRepository
      .find({ _id: serverOperators({ $in: ids }), purgedAt: serverOperators({ $exists: false }) })
      .select('name')
      .lean()
      .exec();
    return new Map(rows.flatMap((row) => (row.name ? [[row._id.toHexString(), row.name]] : [])));
  }
}
