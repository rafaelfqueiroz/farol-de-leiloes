import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { EmailService } from '../email/email.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { UserDocument } from '../users/schemas/user.schema';
import { UserProfile, AuthResult } from './interfaces/auth.interface';

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
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = this.generateToken(user);
    return {
      accessToken,
      user: this.toUserProfile(user),
    };
  }

  async googleLogin(user: UserDocument): Promise<AuthResult> {
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

  async updateProfile(
    userId: string,
    updateData: { name?: string; email?: string },
  ): Promise<UserProfile> {
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
      throw new NotFoundException('User not found');
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
      throw new UnauthorizedException('User not found');
    }

    if (!user.providers?.includes('local')) {
      throw new UnauthorizedException(
        'Cannot change password for OAuth-only accounts. Use "Set Password" instead.',
      );
    }

    const validPassword = await this.usersService.validatePassword(user.email, currentPassword);
    if (!validPassword) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    await this.usersService.update(userId, { password: newPassword });
  }

  async setPassword(userId: string, newPassword: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.providers?.includes('local')) {
      throw new BadRequestException(
        'You already have a password set. Use "Change Password" instead.',
      );
    }

    await this.usersService.setPassword(userId, newPassword);
  }

  private generateToken(user: UserDocument): string {
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
      throw new NotFoundException('User not found');
    }

    if (!user.providers?.includes('local')) {
      throw new BadRequestException('OAuth users do not require email verification');
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email already verified');
    }

    const token = await this.usersService.setEmailVerificationToken(userId);
    await this.emailService.sendVerificationEmail(user.email, token, user.name);
  }

  async getVerificationStatus(
    userId: string,
  ): Promise<{ emailVerified: boolean; providers: string[] }> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      emailVerified: user.emailVerified ?? false,
      providers: user.providers,
    };
  }

  private toUserProfile(user: UserDocument): UserProfile {
    const obj = typeof user.toObject === 'function' ? user.toObject() : user;
    return {
      _id: obj._id.toString(),
      email: obj.email,
      name: obj.name,
      providers: obj.providers,
      emailVerified: obj.emailVerified ?? false,
      role: obj.role ?? 'free',
      phone: obj.phone,
      cpf: obj.cpf,
      dateOfBirth: obj.dateOfBirth,
      sex: obj.sex,
      address: obj.address,
      createdAt: obj.createdAt,
      updatedAt: obj.updatedAt,
    };
  }
}
