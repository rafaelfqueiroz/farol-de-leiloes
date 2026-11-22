import { Public } from './decorators/public.decorator.js';
import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  UseFilters,
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
import { UpdateProfileDto } from './dto/update-profile.dto.js';
import { ChangePasswordDto } from './dto/change-password.dto.js';
import {
  AuthResponseDto,
  CurrentUserResponseDto,
  GoogleExchangeResponseDto,
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
import { Response } from 'express';
import type { Env } from '../config/env.js';
import { GoogleCallbackRedirectFilter } from './google/google-callback-redirect.filter.js';
import type { GoogleIdentity } from './google/google-identity.js';
import type { GoogleFlowRequest } from './google/google-oauth-state.store.js';
import { GoogleCodeDto, GoogleCompleteDto } from './dto/google-code.dto.js';
import { Access } from '../access/decorators/access.decorator.js';
import type { AccessContext } from '../access/access-context.js';
import { ConsentsService } from '../privacy/consents.service.js';
import { AllowWithoutTerms } from '../privacy/decorators/allow-without-terms.decorator.js';

// GoogleStrategy.validate hands the verified Google identity to passport, which sets it on the
// request.
type GoogleCallbackRequest = GoogleFlowRequest & { user: GoogleIdentity };

@ApiTags('auth')
@ApiErrorResponses()
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private readonly config: ConfigService<Env, true>,
    private readonly consents: ConsentsService,
  ) {}

  @Public()
  @Post('register')
  @UseGuards(ThrottlerGuard) // SC-04
  @ApiOperation({
    summary: 'Create a local account and send the verification email',
    description:
      'acceptTerms must be true (BR-001-02); without it, or false, the request is refused as VALIDATION_FAILED and creates nothing. Any property beyond email, name, password, ' +
      'acceptTerms, termsVersion, privacyVersion and whatsappConsent is refused as VALIDATION_FAILED and creates nothing (BR-001-31). ' +
      'The acceptance is recorded with the account (versions, time, method signup_email, BR-010-03); ' +
      'termsVersion and privacyVersion default to the current ones and, when sent, must be the ' +
      'current ones or the request is TERMS_VERSION_OUTDATED (409) and creates nothing (BR-010-01). ' +
      'whatsappConsent is its own optional choice, recorded either way, and never stops the ' +
      'account from being created (BR-010-27). ' +
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
  @ApiOperation({
    summary: 'Start Google sign-in (browser redirect to Google)',
    description:
      'Sends OAuth `state` and a PKCE (S256) challenge to Google and keeps the state and the code ' +
      'verifier in a signed, HttpOnly, SameSite=Lax cookie (10 minutes, Path /api/auth/google), ' +
      'so the callback only goes on in the browser that started the flow (issue #152). ' +
      '`?intent=reauth` starts a re-authentication, sealed into the same cookie (SPEC-010 ' +
      'BR-010-13); any other `intent` is refused.',
  })
  @ApiFoundResponse({ description: 'Redirect to Google consent' })
  async googleAuth() {
    // Initiates Google OAuth flow
  }

  @Public()
  @Get('google/callback')
  @UseGuards(GoogleAuthGuard)
  @UseFilters(GoogleCallbackRedirectFilter)
  @ApiOperation({
    summary: 'Google sign-in callback (browser redirect to the frontend)',
    description:
      'Never answers JSON and never puts a session in the URL (BR-001-20). Success redirects to ' +
      '{FRONTEND_URL}/auth/callback?code=<one-time code>, which POST /auth/google/exchange trades ' +
      'for a session. A flow started with `?intent=reauth` is a re-authentication (SPEC-010 ' +
      'BR-010-13): it starts no session and redirects to ' +
      '{FRONTEND_URL}/profile/privacidade?reauth=<one-time code>, or ?reauthError=<CODE>, for ' +
      'POST /privacy/delete-account. A refusal (GOOGLE_EMAIL_NOT_VERIFIED, GOOGLE_SIGN_IN_FAILED...) ' +
      'redirects to {FRONTEND_URL}/login?error=<CODE>. A callback whose state is missing, different, ' +
      'expired or without the cookie of the start is refused as GOOGLE_SIGN_IN_FAILED.',
  })
  @ApiFoundResponse({
    description: 'Redirect to the frontend with a one-time code or an error code',
  })
  async googleAuthRedirect(@Req() req: GoogleCallbackRequest, @Res() res: Response) {
    const frontendUrl = this.config.get('FRONTEND_URL', { infer: true }); // AR-42
    // The intent comes from the sealed state cookie of the start, never from the URL.
    if (req.googleFlowIntent === 'reauth') {
      // SPEC-010 BR-010-13: a re-authentication starts no session and no sign-up: the code goes
      // back to the privacy page, which hands it to POST /privacy/delete-account.
      const code = await this.authService.beginGoogleReauthentication(req.user);
      res.redirect(`${frontendUrl}/profile/privacidade?reauth=${code}`);
      return;
    }
    const code = await this.authService.beginGoogleSignIn(req.user);
    res.redirect(`${frontendUrl}/auth/callback?code=${code}`);
  }

  @Public()
  @Post('google/exchange')
  @UseGuards(ThrottlerGuard) // SC-04
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trade the one-time code of the Google redirect for a session',
    description:
      'status `signed_in` answers like a login (accessToken and user); the code is single use and ' +
      'lasts 60 seconds (BR-001-20). status `terms_required` means the person has no account yet ' +
      'and must accept the terms through POST /auth/google/complete (BR-001-09); it spends ' +
      'nothing. INVALID_GOOGLE_CODE (400) for an unknown, used or expired code; ' +
      'GOOGLE_SIGN_IN_FAILED (401) when the account is no longer active (BR-001-16).',
  })
  @ApiOkResponse({ type: GoogleExchangeResponseDto })
  @ApiTooManyRequestsResponse({ description: 'TOO_MANY_REQUESTS', type: ErrorResponseDto })
  async googleExchange(@Body() dto: GoogleCodeDto): Promise<GoogleExchangeResponseDto> {
    const result = await this.authService.exchangeGoogleCode(dto.code);
    return new GoogleExchangeResponseDto(result);
  }

  @Public()
  @Post('google/complete')
  @UseGuards(ThrottlerGuard) // SC-04
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Accept the terms and create the account of a first Google sign-in',
    description:
      'acceptTerms must be true (VALIDATION_FAILED otherwise, and nothing is created or spent). ' +
      'The code is spent, the account is created with only the searcher persona, its email ' +
      'confirmed and no password, and a session opens (BR-001-03, BR-001-09, SPEC-010 BR-010-01). ' +
      'The acceptance is recorded with the account (method signup_google, BR-010-03) and the ' +
      'optional termsVersion, privacyVersion and whatsappConsent work as in POST /auth/register; ' +
      'a stale version is TERMS_VERSION_OUTDATED (409) and the code is NOT spent. ' +
      'INVALID_GOOGLE_CODE (400) for an unknown, used or expired code.',
  })
  @ApiOkResponse({ type: AuthResponseDto })
  @ApiTooManyRequestsResponse({ description: 'TOO_MANY_REQUESTS', type: ErrorResponseDto })
  async googleComplete(@Body() dto: GoogleCompleteDto): Promise<AuthResponseDto> {
    const result = await this.authService.completeGoogleSignup(dto.code, dto);
    return new AuthResponseDto(result);
  }

  @Public()
  @Post('google/cancel')
  @UseGuards(ThrottlerGuard) // SC-04
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Decline the terms of a first Google sign-in',
    description:
      'Deletes the unused code and the Google profile it holds, so declining leaves no account ' +
      'and no stored personal data (SPEC-010 BR-010-01). Always 200, whether or not the code ' +
      'existed.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  @ApiTooManyRequestsResponse({ description: 'TOO_MANY_REQUESTS', type: ErrorResponseDto })
  async googleCancel(@Body() dto: GoogleCodeDto): Promise<MessageResponseDto> {
    await this.authService.cancelGoogleSignup(dto.code);
    return new MessageResponseDto('Google sign-up cancelled');
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
  @AllowWithoutTerms() // BR-010-05: the interface learns here that a new version must be accepted
  @ApiJwtAuth()
  @ApiOperation({
    summary: 'The signed-in user',
    description:
      'isAdmin and personas are read and derived on this request (SPEC-002 BR-002-14, ' +
      'BR-002-15); they tell the interface what to show and authorize nothing by themselves. ' +
      'termsAcceptanceRequired is true, with the `documents` still to accept, when the account has ' +
      'not accepted the current terms and privacy policy (SPEC-010 BR-010-05); whatsappPromptPending ' +
      'is true until the account answers the one-time WhatsApp consent request (BR-010-27). ' +
      'Answered without accepting anything first.',
  })
  @ApiOkResponse({ type: CurrentUserResponseDto })
  async getProfile(
    @CurrentUser() user: AuthenticatedUser,
    @Access() access: AccessContext,
  ): Promise<CurrentUserResponseDto> {
    return new CurrentUserResponseDto(
      user,
      access,
      await this.consents.pendingFor(user.userId, user.consentResetAt),
    );
  }

  @Post('logout')
  @AllowWithoutTerms() // BR-010-05: signing out never waits for an acceptance
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
  @AllowWithoutTerms() // BR-010-08, BR-010-12, DL-010-03: reading and correcting one's data never waits
  @ApiJwtAuth()
  @ApiOperation({ summary: 'Change the signed-in user name or phone (the e-mail is read-only)' })
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
  @ApiOperation({
    summary: 'Add a password to a Google-only account',
    description: 'Ends every other session of the account (BR-001-19).',
  })
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

  @Get('profile/full')
  @AllowWithoutTerms() // BR-010-08, BR-010-12, DL-010-03: reading and correcting one's data never waits
  @ApiJwtAuth()
  @ApiOperation({ summary: 'The signed-in user full profile' })
  @ApiOkResponse({ type: UserProfileResponseDto })
  async getFullProfile(@CurrentUser() user: AuthenticatedUser): Promise<UserProfileResponseDto> {
    const profile = await this.authService.getFullProfile(user.userId);
    return new UserProfileResponseDto(profile);
  }
}
