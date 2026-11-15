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

@Module({
  imports: [
    UsersModule,
    PassportModule,
    EmailModule,
    CommonModule, // AR-24: the Clock
    AuthThrottlerModule, // SC-04
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
  // SC-07: global registration protects every module, including future controllers.
  providers: [
    AuthService,
    AccountTokenRepository,
    AccountTokenService,
    SessionsRepository,
    SessionsService,
    LoginAttemptsRepository,
    LoginAttemptsService,
    JwtStrategy,
    GoogleStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
