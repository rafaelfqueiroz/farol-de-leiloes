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
import { UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
    private emailService: EmailService,
  ) {}

  async register(registerDto: RegisterDto): Promise<{ accessToken: string; user: any }> {
    const user = await this.usersService.create({
      ...registerDto,
      provider: 'local',
    });

    // Generate and send verification email
    const verificationToken = await this.usersService.setEmailVerificationToken(
      user._id.toString(),
    );
    await this.emailService.sendVerificationEmail(
      user.email,
      verificationToken,
      user.name,
    );

    const accessToken = this.generateToken(user);
    return {
      accessToken,
      user: this.sanitizeUser(user),
    };
  }

  async login(loginDto: LoginDto): Promise<{ accessToken: string; user: any }> {
    const user = await this.usersService.validatePassword(
      loginDto.email,
      loginDto.password,
    );

    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = this.generateToken(user);
    return {
      accessToken,
      user: this.sanitizeUser(user),
    };
  }

  async googleLogin(user: UserDocument): Promise<{ accessToken: string; user: any }> {
    const accessToken = this.generateToken(user);
    return {
      accessToken,
      user: this.sanitizeUser(user),
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

  async updateProfile(userId: string, updateData: { name?: string; email?: string }): Promise<any> {
    const user = await this.usersService.update(userId, updateData);
    return this.sanitizeUser(user);
  }

  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<void> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    if (user.provider !== 'local') {
      throw new UnauthorizedException('Cannot change password for OAuth accounts');
    }

    const validPassword = await this.usersService.validatePassword(user.email, currentPassword);
    if (!validPassword) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    await this.usersService.update(userId, { password: newPassword });
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

    if (user.provider !== 'local') {
      throw new BadRequestException(
        'OAuth users do not require email verification',
      );
    }

    if (user.emailVerified) {
      throw new BadRequestException('Email already verified');
    }

    const token = await this.usersService.setEmailVerificationToken(userId);
    await this.emailService.sendVerificationEmail(user.email, token, user.name);
  }

  async getVerificationStatus(
    userId: string,
  ): Promise<{ emailVerified: boolean; provider: string }> {
    const user = await this.usersService.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }
    return {
      emailVerified: user.emailVerified ?? false,
      provider: user.provider,
    };
  }

  private sanitizeUser(user: UserDocument): any {
    const {
      password,
      resetPasswordToken,
      resetPasswordExpires,
      emailVerificationToken,
      emailVerificationExpires,
      ...sanitized
    } = user.toObject();
    return sanitized;
  }
}
