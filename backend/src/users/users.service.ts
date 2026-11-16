import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, type QueryFilter } from 'mongoose';
import { UserEntity, UserDocument } from './schemas/user.schema.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import * as bcrypt from 'bcrypt';
import { DomainError } from '../common/errors/domain-error.js';
import { normalizeEmail } from '../common/normalize-email.js';
import { serverOperators } from '../common/mongo/query-safety.js';

// SC-10: the only text fields UsersService.update writes (UpdateUserDto, AR-34).
const TEXT_FIELDS = [
  'name',
  'googleId',
  'role',
  'stripeCustomerId',
  'stripeSubscriptionId',
  'phone',
  'cpf',
  'dateOfBirth',
  'sex',
] as const;
const ADDRESS_FIELDS = ['street', 'city', 'state', 'zipCode'] as const;

// SC-01: bcrypt, cost >= 10. The one place a password is hashed.
const BCRYPT_COST = 10;
// 11000: MongoDB's duplicate-key error code.
const DUPLICATE_KEY = 11000;

/** The legacy contact details `updateContactDetails` writes; the shape of CompleteProfileDto. */
export interface ContactDetails {
  phone?: string | null;
  cpf?: string;
  dateOfBirth?: string;
  sex?: string;
  address?: { street?: string; city?: string; state?: string; zipCode?: string };
}

@Injectable()
export class UsersService {
  // BR-001-14 / SC-05: compared against when no account (or no password) exists, so an unknown
  // email costs the same one bcrypt comparison as a wrong password.
  private dummyHash: Promise<string> | undefined;

  constructor(@InjectModel(UserEntity.name) private readonly userRepository: Model<UserDocument>) {}

  /**
   * Creates an account from a provider flow (Google, PR3). Email/password sign-up uses
   * `createLocalAccount`, which accepts no provider or identifier from the caller (BR-001-31).
   */
  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
    const email = normalizeEmail(createUserDto.email);
    if (await this.findByEmail(email)) {
      throw new DomainError('EMAIL_ALREADY_REGISTERED');
    }

    let hashedPassword: string | undefined;
    if (createUserDto.password) {
      hashedPassword = await this.hashPassword(createUserDto.password);
    }

    return this.save(
      new this.userRepository({
        ...createUserDto,
        email,
        password: hashedPassword,
        emailVerified: createUserDto.providers?.includes('google') ?? false,
      }),
    );
  }

  /**
   * BR-001-03 / BR-001-31: sign-up with email and password. Only these three values come from the
   * request; the provider, role, status and confirmation flag are fixed here, so nothing else a
   * caller sends can reach the account.
   */
  async createLocalAccount(input: {
    email: string;
    name: string;
    password: string;
  }): Promise<UserDocument> {
    const email = normalizeEmail(input.email);
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
      }),
    );
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

  async findByStripeCustomerId(stripeCustomerId: string): Promise<UserDocument | null> {
    if (typeof stripeCustomerId !== 'string') return null;
    return this.userRepository.findOne({ stripeCustomerId: { $eq: stripeCustomerId } }).exec();
  }

  async findByIdFull(id: string): Promise<UserDocument | null> {
    return this.userRepository.findById(id).select('-password').exec();
  }

  async linkGoogleAccount(userId: string, googleId: string): Promise<UserDocument> {
    const updatedUser = await this.userRepository
      .findByIdAndUpdate(
        userId,
        {
          googleId,
          emailVerified: true,
          $addToSet: { providers: 'google' },
        },
        { returnDocument: 'after' },
      )
      .exec();

    if (!updatedUser) {
      throw new DomainError('USER_NOT_FOUND');
    }

    return updatedUser;
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
   * Internal writes by named server flows (payments: Stripe ids and subscription status). It is
   * never reached from a request body: the profile goes through `updateProfile`, the legacy
   * contact details through `updateContactDetails` (BR-001-29, BR-001-31). The email is not here
   * at all: it cannot be changed (BR-001-26, D-63).
   */
  async update(id: string, updateUserDto: UpdateUserDto): Promise<UserDocument> {
    // SC-10: the update is built field by field from a whitelist, never the DTO object itself, so
    // a body can neither carry an operator ({ $set, $unset, $inc ... }) nor reach a field the
    // DTO does not name. Each value is checked for its type before it is copied.
    const fields = this.updatableFields(updateUserDto);

    const user = await this.userRepository
      .findOneAndUpdate({ _id: { $eq: id } }, { $set: fields }, { returnDocument: 'after' })
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

  /**
   * The legacy "complete profile" details (phone, CPF, date of birth, sex, address), which
   * RF-CON-04 does not list and the frontend profile work removes. A named method with its own
   * allowlist so `update` is not reachable from the request (BR-001-31).
   */
  async updateContactDetails(userId: string, details: ContactDetails): Promise<UserDocument> {
    const set = this.updatableFields({
      cpf: details.cpf,
      dateOfBirth: details.dateOfBirth,
      sex: details.sex,
      address: details.address,
    });
    const unset: Record<string, ''> = {};
    const phone: unknown = details.phone;
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
        ? this.userRepository.findOneAndUpdate({ _id: { $eq: id } }, update, {
            returnDocument: 'after',
          })
        : this.userRepository.findOne({ _id: { $eq: id } });
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

    // Stripe's status is cleared with an explicit null, which is a value here, not "absent".
    const status: unknown = dto.subscriptionStatus;
    if (typeof status === 'string' || status === null) fields.subscriptionStatus = status;

    const providers: unknown = dto.providers;
    if (Array.isArray(providers) && providers.every((p) => typeof p === 'string')) {
      fields.providers = providers;
    }

    const address: unknown = dto.address;
    if (typeof address === 'object' && address !== null) {
      const copy: Record<string, string> = {};
      for (const key of ADDRESS_FIELDS) {
        const value: unknown = (address as Record<string, unknown>)[key];
        if (typeof value === 'string') copy[key] = value;
      }
      fields.address = copy;
    }

    return fields;
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
    return (user.status ?? 'active') === 'active' ? user : null;
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
        { _id: { $eq: userId }, email: { $eq: normalizeEmail(email) } },
        { $set: { emailVerified: true } },
      )
      .exec();
    return result.matchedCount > 0;
  }

  async isEmailVerified(userId: string): Promise<boolean> {
    const user = await this.userRepository.findById(userId).exec();
    return user?.emailVerified ?? false;
  }
}
