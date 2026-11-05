import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env';
import { UsersService } from '../../users/users.service';
import { AuthenticatedUser, JwtPayload } from '../interfaces/auth.interface';
import { DomainError } from '../../common/errors/domain-error';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    private usersService: UsersService,
    configService: ConfigService<Env, true>,
  ) {
    // AR-41: required at boot, no fallback secret.
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: configService.get('JWT_SECRET', { infer: true }),
    });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      // SC-15 / AR-46: no raw user id in a log line.
      this.logger.warn('JWT validation - user not found');
      // A token for an account that no longer exists authenticates nobody.
      throw new DomainError('UNAUTHENTICATED');
    }
    return {
      userId: payload.sub,
      email: payload.email,
      name: payload.name,
      emailVerified: user.emailVerified ?? false,
      providers: user.providers,
      role: user.role ?? 'free',
      subscriptionStatus: user.subscriptionStatus ?? null,
    };
  }
}
