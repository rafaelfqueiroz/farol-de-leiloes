import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { addHours } from 'date-fns';
import { UserEntity, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';
import { DomainError } from '../common/errors/domain-error';
import { serverOperators } from '../common/mongo/query-safety';
import { Clock } from '../common/clock/clock';

// SC-10: the only text fields UsersService.update writes (UpdateUserDto, AR-34).
const TEXT_FIELDS = [
  'email',
  'name',
  'password',
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

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(UserEntity.name) private readonly userRepository: Model<UserDocument>,
    private readonly clock: Clock, // AR-24: token expiry is measured from the injected clock
  ) {}

  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
    // Check if user already exists
    const existingUser = await this.findByEmail(createUserDto.email);
    if (existingUser) {
      throw new DomainError('EMAIL_ALREADY_REGISTERED');
    }

    // Hash password if provided
    let hashedPassword: string | undefined;
    if (createUserDto.password) {
      hashedPassword = await bcrypt.hash(createUserDto.password, 10);
    }

    const user = new this.userRepository({
      ...createUserDto,
      password: hashedPassword,
      emailVerified: createUserDto.providers?.includes('google') ?? false,
    });

    return user.save();
  }

  async findAll(): Promise<UserDocument[]> {
    return this.userRepository.find().select('-password').exec();
  }

  async findById(id: string): Promise<UserDocument | null> {
    return this.userRepository.findById(id).select('-password').exec();
  }

  async findByEmail(email: string): Promise<UserDocument | null> {
    return this.userRepository.findOne({ email: { $eq: email.toLowerCase() } }).exec();
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
    return this.userRepository
      .findById(id)
      .select(
        '-password -resetPasswordToken -resetPasswordExpires -emailVerificationToken -emailVerificationExpires',
      )
      .exec();
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

  async setPassword(userId: string, newPassword: string): Promise<UserDocument> {
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const updatedUser = await this.userRepository
      .findByIdAndUpdate(
        userId,
        {
          password: hashedPassword,
          $addToSet: { providers: 'local' },
        },
        { returnDocument: 'after' },
      )
      .select('-password')
      .exec();

    if (!updatedUser) {
      throw new DomainError('USER_NOT_FOUND');
    }

    return updatedUser;
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<UserDocument> {
    // If email is being updated, check for conflicts
    if (updateUserDto.email) {
      const existingUser = await this.findByEmail(updateUserDto.email);
      if (existingUser && existingUser._id.toString() !== id) {
        throw new DomainError('EMAIL_ALREADY_REGISTERED');
      }
    }

    // SC-10: the update is built field by field from a whitelist, never the DTO object itself, so
    // a body can neither carry an operator ({ $set, $unset, $inc ... }) nor reach a field the
    // DTO does not name. Each value is checked for its type before it is copied.
    const fields = this.updatableFields(updateUserDto);
    if (typeof fields.password === 'string') {
      fields.password = await bcrypt.hash(fields.password, 10);
    }

    const user = await this.userRepository
      .findOneAndUpdate({ _id: { $eq: id } }, { $set: fields }, { returnDocument: 'after' })
      .select('-password')
      .exec();

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
      // An empty string is "not provided", as before (the old `if (dto.password)` check).
      if (typeof value === 'string' && (value || key !== 'password')) fields[key] = value;
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

  async validatePassword(email: string, password: string): Promise<UserDocument | null> {
    const user = await this.findByEmail(email);
    if (!user || !user.password) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    return isPasswordValid ? user : null;
  }

  async setResetPasswordToken(email: string): Promise<string> {
    const user = await this.findByEmail(email);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }

    // Generate random token
    const token =
      Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const hashedToken = await bcrypt.hash(token, 10);

    // Set expiration to 1 hour from now
    const expires = addHours(this.clock.now(), 1);

    await this.userRepository.findByIdAndUpdate(user._id, {
      resetPasswordToken: hashedToken,
      resetPasswordExpires: expires,
    });

    return token; // Return unhashed token to send via email
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const users = await this.userRepository
      .find({
        resetPasswordExpires: serverOperators({ $gt: this.clock.now() }),
      })
      .exec();

    // Find user with matching token
    let matchedUser: UserDocument | null = null;
    for (const user of users) {
      if (user.resetPasswordToken) {
        const isTokenValid = await bcrypt.compare(token, user.resetPasswordToken);
        if (isTokenValid) {
          matchedUser = user;
          break;
        }
      }
    }

    if (!matchedUser) {
      throw new DomainError('INVALID_RESET_TOKEN');
    }

    // Update password, clear reset token, and ensure 'local' provider is present
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    await this.userRepository.findByIdAndUpdate(matchedUser._id, {
      password: hashedPassword,
      resetPasswordToken: undefined,
      resetPasswordExpires: undefined,
      $addToSet: { providers: 'local' },
    });
  }

  async setEmailVerificationToken(userId: string): Promise<string> {
    const user = await this.userRepository.findById(userId).exec();
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }

    // Generate cryptographically secure random token
    const token = crypto.randomBytes(32).toString('hex');
    const hashedToken = await bcrypt.hash(token, 10);

    // Set expiration to 24 hours from now
    const expires = addHours(this.clock.now(), 24);

    await this.userRepository.findByIdAndUpdate(userId, {
      emailVerificationToken: hashedToken,
      emailVerificationExpires: expires,
    });

    return token;
  }

  async verifyEmail(token: string): Promise<UserDocument> {
    const users = await this.userRepository
      .find({
        emailVerificationExpires: serverOperators({ $gt: this.clock.now() }),
        emailVerified: false,
      })
      .exec();

    let matchedUser: UserDocument | null = null;
    for (const user of users) {
      if (user.emailVerificationToken) {
        const isTokenValid = await bcrypt.compare(token, user.emailVerificationToken);
        if (isTokenValid) {
          matchedUser = user;
          break;
        }
      }
    }

    if (!matchedUser) {
      throw new DomainError('INVALID_VERIFICATION_TOKEN');
    }

    await this.userRepository.findByIdAndUpdate(matchedUser._id, {
      emailVerified: true,
      emailVerificationToken: undefined,
      emailVerificationExpires: undefined,
    });

    return matchedUser;
  }

  async isEmailVerified(userId: string): Promise<boolean> {
    const user = await this.userRepository.findById(userId).exec();
    return user?.emailVerified ?? false;
  }
}
