import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { UserDocument } from '../users/schemas/user.schema';

@Injectable()
export class AuthService {
  constructor(
    private usersService: UsersService,
    private jwtService: JwtService,
  ) {}

  async register(registerDto: RegisterDto): Promise<{ accessToken: string; user: any }> {
    const user = await this.usersService.create({
      ...registerDto,
      provider: 'local',
    });

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
    const token = await this.usersService.setResetPasswordToken(email);
    // TODO: Send email with reset token
    // For now, just log the token (in production, send via email service)
    console.log(`Password reset token for ${email}: ${token}`);
    console.log(`Reset URL: ${process.env.FRONTEND_URL}/reset-password/${token}`);
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

  private sanitizeUser(user: UserDocument): any {
    const { password, resetPasswordToken, resetPasswordExpires, ...sanitized } = user.toObject();
    return sanitized;
  }
}
