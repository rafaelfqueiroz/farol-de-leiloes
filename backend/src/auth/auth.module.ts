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

@Module({
  imports: [
    UsersModule,
    PassportModule,
    EmailModule,
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
    JwtStrategy,
    GoogleStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
