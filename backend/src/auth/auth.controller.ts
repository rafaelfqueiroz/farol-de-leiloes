import { Public } from './decorators/public.decorator';
import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  UseGuards,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ApiCreatedResponse,
  ApiFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RequestResetPasswordDto, ResetPasswordDto } from './dto/reset-password.dto';
import { SetPasswordDto } from './dto/set-password.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { CompleteProfileDto } from './dto/complete-profile.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import {
  AuthResponseDto,
  CurrentUserResponseDto,
  UserProfileResponseDto,
  VerificationStatusResponseDto,
} from './dto/auth-response.dto';
import { ApiJwtAuth } from './decorators/api-jwt-auth.decorator';
import { MessageResponseDto } from '../common/dto/message-response.dto';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator';
import { GoogleAuthGuard } from './guards/google-auth.guard';
import { CurrentUser } from './decorators/current-user.decorator';
import { AuthenticatedUser } from './interfaces/auth.interface';
import { Request, Response } from 'express';
import type { Env } from '../config/env';

// GoogleStrategy.validate hands the signed-in user to passport, which sets it on the request.
type GoogleCallbackRequest = Request & { user: Parameters<AuthService['googleLogin']>[0] };

@ApiTags('auth')
@ApiErrorResponses()
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private readonly config: ConfigService<Env, true>,
  ) {}

  @Public()
  @Post('register')
  @ApiOperation({ summary: 'Create a local account and send the verification email' })
  @ApiCreatedResponse({ type: AuthResponseDto })
  async register(@Body() registerDto: RegisterDto): Promise<AuthResponseDto> {
    const result = await this.authService.register(registerDto);
    return new AuthResponseDto(result);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiOkResponse({ type: AuthResponseDto })
  async login(@Body() loginDto: LoginDto): Promise<AuthResponseDto> {
    const result = await this.authService.login(loginDto);
    return new AuthResponseDto(result);
  }

  @Public()
  @Get('google')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Start Google sign-in (browser redirect to Google)' })
  @ApiFoundResponse({ description: 'Redirect to Google consent' })
  async googleAuth() {
    // Initiates Google OAuth flow
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @ApiOperation({ summary: 'Google sign-in callback (browser redirect to the frontend)' })
  @ApiFoundResponse({ description: 'Redirect to {FRONTEND_URL}/auth/callback with the token' })
  async googleAuthRedirect(@Req() req: GoogleCallbackRequest, @Res() res: Response) {
    const result = await this.authService.googleLogin(req.user);

    // Redirect to frontend with token
    const frontendUrl = this.config.get('FRONTEND_URL', { infer: true }); // AR-42
    res.redirect(`${frontendUrl}/auth/callback?token=${result.accessToken}`);
  }

  @Public()
  @Post('reset-password-request')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Email a password reset link (same answer whether or not it exists)' })
  @ApiOkResponse({ type: MessageResponseDto })
  async requestPasswordReset(@Body() dto: RequestResetPasswordDto): Promise<MessageResponseDto> {
    await this.authService.requestPasswordReset(dto.email);
    return new MessageResponseDto('Password reset email sent');
  }

  @Public()
  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Set a new password with a reset token' })
  @ApiOkResponse({ type: MessageResponseDto })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<MessageResponseDto> {
    await this.authService.resetPassword(dto.token, dto.newPassword);
    return new MessageResponseDto('Password reset successful');
  }

  @Get('me')
  @ApiJwtAuth()
  @ApiOperation({ summary: 'The signed-in user' })
  @ApiOkResponse({ type: CurrentUserResponseDto })
  async getProfile(@CurrentUser() user: AuthenticatedUser): Promise<CurrentUserResponseDto> {
    return new CurrentUserResponseDto(user);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiJwtAuth()
  @ApiOperation({ summary: 'Sign out (the client discards its token)' })
  @ApiOkResponse({ type: MessageResponseDto })
  async logout(): Promise<MessageResponseDto> {
    // With JWT, logout is handled client-side by removing the token
    return new MessageResponseDto('Logged out successfully');
  }

  @Patch('profile')
  @ApiJwtAuth()
  @ApiOperation({ summary: 'Change the signed-in user name or email' })
  @ApiOkResponse({ type: UserProfileResponseDto })
  async updateProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() updateData: UpdateProfileDto,
  ): Promise<UserProfileResponseDto> {
    const profile = await this.authService.updateProfile(user.userId, updateData);
    return new UserProfileResponseDto(profile);
  }

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiJwtAuth()
  @ApiOperation({ summary: 'Change the password of a local account' })
  @ApiOkResponse({ type: MessageResponseDto })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() passwordData: ChangePasswordDto,
  ): Promise<MessageResponseDto> {
    await this.authService.changePassword(
      user.userId,
      passwordData.currentPassword,
      passwordData.newPassword,
    );
    return new MessageResponseDto('Password changed successfully');
  }

  @Post('set-password')
  @HttpCode(HttpStatus.OK)
  @ApiJwtAuth()
  @ApiOperation({ summary: 'Add a password to a Google-only account' })
  @ApiOkResponse({ type: MessageResponseDto })
  async setPassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: SetPasswordDto,
  ): Promise<MessageResponseDto> {
    await this.authService.setPassword(user.userId, dto.newPassword);
    return new MessageResponseDto('Password set successfully');
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm an email address with its verification token' })
  @ApiOkResponse({ type: MessageResponseDto })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<MessageResponseDto> {
    await this.authService.verifyEmail(dto.token);
    return new MessageResponseDto('Email verified successfully');
  }

  @Post('resend-verification')
  @HttpCode(HttpStatus.OK)
  @ApiJwtAuth()
  @ApiOperation({ summary: 'Send the verification email again' })
  @ApiOkResponse({ type: MessageResponseDto })
  async resendVerification(@CurrentUser() user: AuthenticatedUser): Promise<MessageResponseDto> {
    await this.authService.resendVerification(user.userId);
    return new MessageResponseDto('Verification email sent');
  }

  @Get('verification-status')
  @ApiJwtAuth()
  @ApiOperation({ summary: 'Whether the signed-in user email is verified' })
  @ApiOkResponse({ type: VerificationStatusResponseDto })
  async getVerificationStatus(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<VerificationStatusResponseDto> {
    const status = await this.authService.getVerificationStatus(user.userId);
    return new VerificationStatusResponseDto(status);
  }

  @Patch('profile/complete')
  @ApiJwtAuth()
  @ApiOperation({ summary: 'Fill in the profile details (phone, CPF, address...)' })
  @ApiOkResponse({ type: UserProfileResponseDto })
  async completeProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CompleteProfileDto,
  ): Promise<UserProfileResponseDto> {
    const profile = await this.authService.completeProfile(user.userId, dto);
    return new UserProfileResponseDto(profile);
  }

  @Get('profile/full')
  @ApiJwtAuth()
  @ApiOperation({ summary: 'The signed-in user full profile' })
  @ApiOkResponse({ type: UserProfileResponseDto })
  async getFullProfile(@CurrentUser() user: AuthenticatedUser): Promise<UserProfileResponseDto> {
    const profile = await this.authService.getFullProfile(user.userId);
    return new UserProfileResponseDto(profile);
  }
}
