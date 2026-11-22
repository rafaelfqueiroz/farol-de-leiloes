import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtAuthGuard } from './guards/jwt-auth.guard.js';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import type { AppConfigService } from '../config/env.js';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { UsersModule } from '../users/users.module.js';
import { JwtStrategy } from './strategies/jwt.strategy.js';
import { GoogleStrategy } from './strategies/google.strategy.js';
import { GoogleCallbackRedirectFilter } from './google/google-callback-redirect.filter.js';
import { GoogleOAuthStateStore } from './google/google-oauth-state.store.js';
import { EmailModule } from '../email/email.module.js';
import { CommonModule } from '../common/common.module.js';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthThrottlerModule } from './auth-throttler.module.js';
import { AccountTokenEntity, AccountTokenSchema } from './tokens/account-token.schema.js';
import { AccountTokenRepository } from './tokens/account-token.repository.js';
import { AccountTokenService } from './tokens/account-token.service.js';
import { SessionEntity, SessionSchema } from './sessions/session.schema.js';
import { SessionsRepository } from './sessions/sessions.repository.js';
import { SessionsService } from './sessions/sessions.service.js';
import { LoginAttemptEntity, LoginAttemptSchema } from './login-attempts/login-attempt.schema.js';
import { LoginAttemptsRepository } from './login-attempts/login-attempts.repository.js';
import { LoginAttemptsService } from './login-attempts/login-attempts.service.js';
import { AccessModule } from '../access/access.module.js';
import { AccessContextGuard } from '../access/guards/access-context.guard.js';
import { PrivacyModule } from '../privacy/privacy.module.js';
import { CurrentTermsGuard } from '../privacy/guards/current-terms.guard.js';

@Module({
  imports: [
    UsersModule,
    PassportModule,
    EmailModule,
    CommonModule, // AR-24: the Clock
    AuthThrottlerModule, // SC-04
    AccessModule, // SPEC-002: the AccessContextFactory behind the second global guard
    PrivacyModule, // SPEC-010: sign-up records the acceptance; the third global guard reads it
    MongooseModule.forFeature([
      { name: AccountTokenEntity.name, schema: AccountTokenSchema },
      { name: SessionEntity.name, schema: SessionSchema },
      { name: LoginAttemptEntity.name, schema: LoginAttemptSchema },
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      // AR-41/SC-16: the secret is required at boot; no fallback, and nothing about it is logged.
      useFactory: (config: AppConfigService) => {
        return {
          secret: config.get('JWT_SECRET', { infer: true }),
          signOptions: {
            expiresIn: '7d',
          },
        };
      },
      inject: [ConfigService],
    }),
  ],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccountTokenRepository,
    AccountTokenService,
    SessionsRepository,
    SessionsService,
    LoginAttemptsRepository,
    LoginAttemptsService,
    JwtStrategy,
    GoogleOAuthStateStore,
    GoogleStrategy,
    GoogleCallbackRedirectFilter,
    // SC-07: global registration protects every module, including future controllers.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    // SPEC-002 AR-13 / BR-002-15: builds the request's AccessContext from the user JwtStrategy has
    // just read. It MUST stay immediately after JwtAuthGuard in this same array: Nest runs the
    // global guards of one module in the order they are listed, which is what puts `request.user`
    // in place before it (jwt-auth.guard.spec.ts holds this order).
    { provide: APP_GUARD, useClass: AccessContextGuard },
    // SPEC-010 BR-010-05: refuses the account features until the current terms and privacy policy
    // are accepted (behind TERMS_ENFORCEMENT_ENABLED). It reads the user JwtAuthGuard set, so it
    // stays AFTER JwtAuthGuard and, for a deterministic order, after AccessContextGuard
    // (jwt-auth.guard.spec.ts holds this order).
    { provide: APP_GUARD, useClass: CurrentTermsGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
