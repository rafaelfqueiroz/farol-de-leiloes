import { Public } from './decorators/public.decorator.js';
import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  UseGuards,
  Ip,
  Req,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ThrottlerGuard } from '@nestjs/throttler';
import {
  ApiCreatedResponse,
  ApiFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiTooManyRequestsResponse,
} from '@nestjs/swagger';
import { AuthService } from './auth.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { RequestResetPasswordDto, ResetPasswordDto } from './dto/reset-password.dto.js';
import { SetPasswordDto } from './dto/set-password.dto.js';
import { VerifyEmailDto } from './dto/verify-email.dto.js';
import { CompleteProfileDto } from './dto/complete-profile.dto.js';
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import {
  AuthResponseDto,
  CurrentUserResponseDto,
  UserProfileResponseDto,
  VerificationStatusResponseDto,
} from './dto/auth-response.dto.js';
import { ApiJwtAuth } from './decorators/api-jwt-auth.decorator.js';
import { MessageResponseDto } from '../common/dto/message-response.dto.js';
import { ApiErrorResponses } from '../common/errors/api-error-responses.decorator.js';
import { ErrorResponseDto } from '../common/errors/error-response.dto.js';
import { GoogleAuthGuard } from './guards/google-auth.guard.js';
import { CurrentUser } from './decorators/current-user.decorator.js';
import { AuthenticatedUser } from './interfaces/auth.interface.js';
import { Request, Response } from 'express';
import type { Env } from '../config/env.js';

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
  @UseGuards(ThrottlerGuard) // SC-04
  @ApiOperation({
    summary: 'Create a local account and send the verification email',
    description:
      'acceptTerms, when sent, must be true (BR-001-02; required once the form carries it). Any property beyond email, name, password and ' +
      'acceptTerms is refused as VALIDATION_FAILED and creates nothing (BR-001-31). ' +
      'EMAIL_ALREADY_REGISTERED (409) when the address exists in any letter case (BR-001-01).',
  })
  @ApiCreatedResponse({ type: AuthResponseDto })
  @ApiTooManyRequestsResponse({ description: 'TOO_MANY_REQUESTS', type: ErrorResponseDto })
  async register(@Body() registerDto: RegisterDto): Promise<AuthResponseDto> {
    const result = await this.authService.register(registerDto);
    return new AuthResponseDto(result);
  }

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Sign in with email and password',
    description:
      'INVALID_CREDENTIALS (401) for an unknown email, a wrong password and an inactive account ' +
      'alike (BR-001-14, BR-001-16). TOO_MANY_ATTEMPTS (429) after 10 failures in 15 minutes ' +
      'for the email or the origin, even with the right password (BR-001-15).',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiTooManyRequestsResponse({ description: 'TOO_MANY_ATTEMPTS', type: ErrorResponseDto })
  async login(@Body() loginDto: LoginDto, @Ip() ip: string): Promise<AuthResponseDto> {
    const result = await this.authService.login(loginDto, ip ?? 'unknown');
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
  @UseGuards(ThrottlerGuard) // SC-04
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Email a password reset link (same answer whether or not it exists)' })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiTooManyRequestsResponse({ description: 'TOO_MANY_REQUESTS', type: ErrorResponseDto })
  async requestPasswordReset(@Body() dto: RequestResetPasswordDto): Promise<MessageResponseDto> {
    await this.authService.requestPasswordReset(dto.email);
    return new MessageResponseDto('Password reset email sent');
  }

  @Public()
  @Post('reset-password')
  @UseGuards(ThrottlerGuard) // SC-04
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Set a new password with a reset token',
    description:
      'Single use; ends every session of the account and does not sign anyone in (BR-001-19, ' +
      'BR-001-22). INVALID_RESET_TOKEN (400) for an unknown, used or expired token.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiTooManyRequestsResponse({ description: 'TOO_MANY_REQUESTS', type: ErrorResponseDto })
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
  @ApiOperation({
    summary: 'Sign out',
    description: 'Ends the current session on the server; a copy of the token stops working.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  async logout(@CurrentUser() user: AuthenticatedUser): Promise<MessageResponseDto> {
    await this.authService.logout(user.sessionId); // BR-001-18
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
  @UseGuards(ThrottlerGuard) // SC-04
  @HttpCode(HttpStatus.OK)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Change the password of a local account',
    description:
      'Ends every other session of the account (BR-001-19). The current-password check counts ' +
      'like a sign-in attempt: TOO_MANY_ATTEMPTS (429) past 10 in 15 minutes (BR-001-15, SC-04).',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiTooManyRequestsResponse({
    description: 'TOO_MANY_ATTEMPTS or TOO_MANY_REQUESTS',
    type: ErrorResponseDto,
  })
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() passwordData: ChangePasswordDto,
    @Ip() ip: string,
  ): Promise<MessageResponseDto> {
    await this.authService.changePassword(
      user.userId,
      user.sessionId,
      passwordData.currentPassword,
      passwordData.newPassword,
      ip ?? 'unknown',
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
    await this.authService.setPassword(user.userId, user.sessionId, dto.newPassword);
    return new MessageResponseDto('Password set successfully');
  }

  @Public()
  @Post('verify-email')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Confirm an email address with its verification token',
    description:
      'Single use, valid 24 hours (BR-001-05). INVALID_VERIFICATION_TOKEN (400) otherwise.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<MessageResponseDto> {
    await this.authService.verifyEmail(dto.token);
    return new MessageResponseDto('Email verified successfully');
  }

  @Post('resend-verification')
  @UseGuards(ThrottlerGuard) // SC-04
  @HttpCode(HttpStatus.OK)
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'Send the verification email again',
    description: 'The new link replaces any earlier unused one (BR-001-05, BR-001-06).',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiTooManyRequestsResponse({ description: 'TOO_MANY_REQUESTS', type: ErrorResponseDto })
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
