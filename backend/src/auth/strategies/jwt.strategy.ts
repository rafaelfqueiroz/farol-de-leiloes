import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { UsersService } from '../../users/users.service.js';
import { AuthenticatedUser, JwtPayload } from '../interfaces/auth.interface.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { setLogUserHash } from '../../common/observability/log-context.js';
import { hashUserId } from '../../common/observability/user-hash.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private readonly logHashSecret: string | undefined;

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
    this.logHashSecret = configService.get('LOG_HASH_SECRET', { infer: true });
  }

  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    // AR-46: the hashed user joins the request's log context here, where every JWT-protected
    // request first proves who it is: before the guard returns, so the lines of later guards, the
    // handler and the error filter all carry it. An interceptor would only see the user after
    // every guard ran. Without LOG_HASH_SECRET no user id is logged at all (AR-41, SC-15).
    setLogUserHash(hashUserId(this.logHashSecret, payload.sub));
    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      // SC-15: the line carries the user hash from the context, never the raw id.
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
