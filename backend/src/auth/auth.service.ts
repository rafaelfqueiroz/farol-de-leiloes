import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import type { UserAccount } from '../users/user-account';
import { UserProfile, AuthResult } from './interfaces/auth.interface';
import { DomainError } from '../common/errors/domain-error';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private emailService: EmailService,
  ) {}

  async register(registerDto: RegisterDto): Promise<AuthResult> {
    const user = await this.usersService.create({
      ...registerDto,
      providers: ['local'],
    });

    // Generate and send verification email
    const verificationToken = await this.usersService.setEmailVerificationToken(
      user._id.toString(),
    );
    await this.emailService.sendVerificationEmail(user.email, verificationToken, user.name);

    const accessToken = this.generateToken(user);
    return {
      accessToken,
      user: this.toUserProfile(user),
    };
  }

  async login(loginDto: LoginDto): Promise<AuthResult> {
    const user = await this.usersService.validatePassword(loginDto.email, loginDto.password);

    if (!user) {
      throw new DomainError('INVALID_CREDENTIALS');
    }

    const accessToken = this.generateToken(user);
    return {
      accessToken,
      user: this.toUserProfile(user),
    };
  }

  async googleLogin(user: UserAccount): Promise<AuthResult> {
    const accessToken = this.generateToken(user);
    return {
      accessToken,
      user: this.toUserProfile(user),
    };
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.usersService.findByEmail(email);
    if (!user) {
      // Don't reveal if email exists
      return;
    }

    const token = await this.usersService.setResetPasswordToken(email);
    await this.emailService.sendPasswordResetEmail(email, token, user.name);
  }

  async resetPassword(token: string, newPassword: string): Promise<void> {
    await this.usersService.resetPassword(token, newPassword);
  }

  async updateProfile(userId: string, updateData: UpdateProfileDto): Promise<UserProfile> {
    const user = await this.usersService.update(userId, updateData);
    return this.toUserProfile(user);
  }

  async completeProfile(userId: string, dto: CompleteProfileDto): Promise<UserProfile> {
    const user = await this.usersService.update(userId, dto);
    return this.toUserProfile(user);
  }

  async getFullProfile(userId: string): Promise<UserProfile> {
    const user = await this.usersService.findByIdFull(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }
    return this.toUserProfile(user);
  }

  async changePassword(
    userId: string,
    currentPassword: string,
    newPassword: string,
  ): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }

    if (!user.providers?.includes('local')) {
      throw new DomainError('OAUTH_ACCOUNT_HAS_NO_PASSWORD');
    }

    const validPassword = await this.usersService.validatePassword(user.email, currentPassword);
    if (!validPassword) {
      throw new DomainError('CURRENT_PASSWORD_INCORRECT');
    }

    await this.usersService.update(userId, { password: newPassword });
  }

  async setPassword(userId: string, newPassword: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }

    if (user.providers?.includes('local')) {
      throw new DomainError('PASSWORD_ALREADY_SET');
    }

    await this.usersService.setPassword(userId, newPassword);
  }

  private generateToken(user: UserAccount): string {
    const payload = {
      email: user.email,
      sub: user._id.toString(),
      name: user.name,
    };
    return this.jwtService.sign(payload);
  }

  async verifyEmail(token: string): Promise<void> {
    await this.usersService.verifyEmail(token);
  }

  async resendVerification(userId: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }

    if (!user.providers?.includes('local')) {
      throw new DomainError('OAUTH_ACCOUNT_NEEDS_NO_VERIFICATION');
    }

    if (user.emailVerified) {
      throw new DomainError('EMAIL_ALREADY_VERIFIED');
    }

    const token = await this.usersService.setEmailVerificationToken(userId);
    await this.emailService.sendVerificationEmail(user.email, token, user.name);
  }

  async getVerificationStatus(
    userId: string,
  ): Promise<{ emailVerified: boolean; providers: string[] }> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new DomainError('USER_NOT_FOUND');
    }
    return {
      emailVerified: user.emailVerified ?? false,
      providers: user.providers,
    };
  }

  private toUserProfile(user: UserAccount): UserProfile {
    return {
      _id: user._id.toString(),
      email: user.email,
      name: user.name,
      providers: user.providers,
      emailVerified: user.emailVerified ?? false,
      role: user.role ?? 'free',
      subscriptionStatus: user.subscriptionStatus ?? null,
      phone: user.phone,
      cpf: user.cpf,
      dateOfBirth: user.dateOfBirth,
      sex: user.sex,
      address: user.address,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
    };
  }
}
