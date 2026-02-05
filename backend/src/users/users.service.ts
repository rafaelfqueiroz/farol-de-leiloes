import { Injectable, ConflictException, NotFoundException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UserEntity, UserDocument } from './schemas/user.schema';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

@Injectable()
export class UsersService {
  constructor(
    @InjectModel(UserEntity.name) private readonly userRepository: Model<UserDocument>,
  ) {}

  async create(createUserDto: CreateUserDto): Promise<UserDocument> {
    // Check if user already exists
    const existingUser = await this.findByEmail(createUserDto.email);
    if (existingUser) {
      throw new ConflictException('User with this email already exists');
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
    return this.userRepository.findOne({ email: email.toLowerCase() }).exec();
  }

  async findByGoogleId(googleId: string): Promise<UserDocument | null> {
    return this.userRepository.findOne({ googleId }).exec();
  }

  async findByStripeCustomerId(stripeCustomerId: string): Promise<UserDocument | null> {
    return this.userRepository.findOne({ stripeCustomerId }).exec();
  }

  async findByIdFull(id: string): Promise<UserDocument | null> {
    return this.userRepository.findById(id)
      .select('-password -resetPasswordToken -resetPasswordExpires -emailVerificationToken -emailVerificationExpires')
      .exec();
  }

  async linkGoogleAccount(userId: string, googleId: string): Promise<UserDocument> {
    const updatedUser = await this.userRepository.findByIdAndUpdate(
      userId,
      {
        googleId,
        emailVerified: true,
        $addToSet: { providers: 'google' },
      },
      { new: true },
    ).exec();

    if (!updatedUser) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return updatedUser;
  }

  async setPassword(userId: string, newPassword: string): Promise<UserDocument> {
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    const updatedUser = await this.userRepository.findByIdAndUpdate(
      userId,
      {
        password: hashedPassword,
        $addToSet: { providers: 'local' },
      },
      { new: true },
    ).select('-password').exec();

    if (!updatedUser) {
      throw new NotFoundException(`User with ID ${userId} not found`);
    }

    return updatedUser;
  }

  async update(id: string, updateUserDto: UpdateUserDto): Promise<UserDocument> {
    // If email is being updated, check for conflicts
    if (updateUserDto.email) {
      const existingUser = await this.findByEmail(updateUserDto.email);
      if (existingUser && existingUser._id.toString() !== id) {
        throw new ConflictException('User with this email already exists');
      }
    }

    // Hash password if being updated
    if (updateUserDto.password) {
      updateUserDto.password = await bcrypt.hash(updateUserDto.password, 10);
    }

    const user = await this.userRepository
      .findByIdAndUpdate(id, updateUserDto, { new: true })
      .select('-password')
      .exec();

    if (!user) {
      throw new NotFoundException(`User with ID ${id} not found`);
    }

    return user;
  }

  async remove(id: string): Promise<void> {
    const result = await this.userRepository.deleteOne({ _id: id }).exec();
    if (result.deletedCount === 0) {
      throw new NotFoundException(`User with ID ${id} not found`);
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
      throw new NotFoundException('User not found');
    }

    // Generate random token
    const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const hashedToken = await bcrypt.hash(token, 10);

    // Set expiration to 1 hour from now
    const expires = new Date();
    expires.setHours(expires.getHours() + 1);

    await this.userRepository.findByIdAndUpdate(user._id, {
      resetPasswordToken: hashedToken,
      resetPasswordExpires: expires,
    });

    return token; // Return unhashed token to send via email
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    const users = await this.userRepository.find({
      resetPasswordExpires: { $gt: new Date() },
    }).exec();

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
      throw new NotFoundException('Invalid or expired reset token');
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
      throw new NotFoundException('User not found');
    }

    // Generate cryptographically secure random token
    const token = crypto.randomBytes(32).toString('hex');
    const hashedToken = await bcrypt.hash(token, 10);

    // Set expiration to 24 hours from now
    const expires = new Date();
    expires.setHours(expires.getHours() + 24);

    await this.userRepository.findByIdAndUpdate(userId, {
      emailVerificationToken: hashedToken,
      emailVerificationExpires: expires,
    });

    return token;
  }

  async verifyEmail(token: string): Promise<UserDocument> {
    const users = await this.userRepository
      .find({
        emailVerificationExpires: { $gt: new Date() },
        emailVerified: false,
      })
      .exec();

    let matchedUser: UserDocument | null = null;
    for (const user of users) {
      if (user.emailVerificationToken) {
        const isTokenValid = await bcrypt.compare(
          token,
          user.emailVerificationToken,
        );
        if (isTokenValid) {
          matchedUser = user;
          break;
        }
      }
    }

    if (!matchedUser) {
      throw new NotFoundException('Invalid or expired verification token');
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
