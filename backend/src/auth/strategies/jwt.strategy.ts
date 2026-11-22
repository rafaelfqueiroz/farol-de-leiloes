import { Injectable, Logger } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import type { Env } from '../../config/env.js';
import { UsersService } from '../../users/users.service.js';
import { SessionsService } from '../sessions/sessions.service.js';
import { AuthenticatedUser, JwtPayload } from '../interfaces/auth.interface.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { setLogUserHash } from '../../common/observability/log-context.js';
import { credentialVersionOf } from '../../users/domain/credential-version.js';
import { isAccountActive } from '../../users/user-account.js';
import { hashUserId } from '../../common/observability/user-hash.js';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);
  private readonly logHashSecret: string | undefined;

  constructor(
    private usersService: UsersService,
    private sessions: SessionsService,
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
    // BR-001-17: a token without a session id (issued before sessions existed) or a malformed one
    // authenticates nobody; that is why everyone signs in once after the deploy.
    if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string' || !payload.jti) {
      throw new DomainError('UNAUTHENTICATED');
    }
    // AR-46: the hashed user joins the request's log context here, where every JWT-protected
    // request first proves who it is: before the guard returns, so the lines of later guards, the
    // handler and the error filter all carry it. An interceptor would only see the user after
    // every guard ran. Without LOG_HASH_SECRET no user id is logged at all (AR-41, SC-15).
    setLogUserHash(hashUserId(this.logHashSecret, payload.sub));

    // SC-03 / BR-001-18: a valid signature is not enough. The session must exist, belong to this
    // account, be unrevoked and unexpired, so sign-out, password change and reset bite at once.
    const sessionVersion = await this.sessions.activeCredentialVersion(payload.jti, payload.sub);
    if (sessionVersion === null) {
      this.logger.warn('JWT validation - session not active');
      throw new DomainError('UNAUTHENTICATED');
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      // SC-15: the line carries the user hash from the context, never the raw id.
      this.logger.warn('JWT validation - user not found');
      // A token for an account that no longer exists authenticates nobody.
      throw new DomainError('UNAUTHENTICATED');
    }
    // DL-001-02: the session belongs to the credential it was issued for. If the credentials were
    // taken over since (Google link of an unconfirmed account), it is refused even when nothing
    // revoked it: a revocation write that failed or a sign-in that raced the link cannot leave a
    // live session on the account. A missing version is 0 on both sides.
    if (sessionVersion !== credentialVersionOf(user)) {
      this.logger.warn('JWT validation - session predates a credential change');
      throw new DomainError('UNAUTHENTICATED');
    }
    // BR-001-16: a deactivated or closed account is refused on its next request. An account
    // without a status predates the field and is active (AR-28).
    if (!isAccountActive(user)) {
      this.logger.warn('JWT validation - account not active');
      throw new DomainError('UNAUTHENTICATED');
    }
    // BR-001-17 / DL-001-01: the session proves who, nothing else. Role and plan are read from
    // the database on each request, never from the token; SPEC-002 / SPEC-012 replace them.
    return {
      userId: payload.sub,
      sessionId: payload.jti,
      email: user.email,
      name: user.name,
      emailVerified: user.emailVerified ?? false,
      providers: user.providers,
      role: user.role ?? 'free',
      subscriptionStatus: user.subscriptionStatus ?? null,
      // SPEC-002 BR-002-15 / BR-002-23: the admin capability is the stored flag, read now; a
      // missing one is false (AR-28). `role === 'admin'` grants nothing any more.
      isAdmin: user.isAdmin === true,
      // SPEC-010 BR-010-27: absent means the account was never asked (it predates the channel).
      whatsappPromptPending: !user.whatsappPromptAnsweredAt,
      consentResetAt: user.consentResetAt ?? null,
    };
  }
}
