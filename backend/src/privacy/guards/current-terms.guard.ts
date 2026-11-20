import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { isPublicRoute } from '../../auth/decorators/public.decorator.js';
import type { AuthenticatedUser } from '../../auth/interfaces/auth.interface.js';
import type { Env } from '../../config/env.js';
import { DomainError } from '../../common/errors/domain-error.js';
import { isTermsExempt } from '../decorators/allow-without-terms.decorator.js';
import { ConsentsService } from '../consents.service.js';

/**
 * SPEC-010 BR-010-05, DL-010-03: an authenticated account that has not accepted the CURRENT terms
 * and privacy policy cannot use the account features until it does; the answer is 403
 * TERMS_ACCEPTANCE_REQUIRED with `{ documents: [{ type, version }] }` (ids and versions only, AR-40).
 * Account notifications are not requests and keep going; the rights of BR-010-08..13 are never
 * behind this guard (`@AllowWithoutTerms()` on `/privacy/*`; `/auth/me`, `/auth/logout` and
 * `/legal/*` are exempt too).
 *
 * Registered globally in AuthModule's providers AFTER AccessContextGuard, so it runs once
 * JwtAuthGuard has put the freshly read user on the request (jwt-auth.guard.spec.ts holds the
 * order). Public routes are skipped (isPublicRoute, SC-07). The state is one indexed query per
 * request, never cached across requests (AR-13): a version published or accepted a second ago
 * counts on the next request.
 *
 * Enforcement is behind `TERMS_ENFORCEMENT_ENABLED` (default false until the screen that asks for
 * the acceptance ships), so no existing account is locked out by a backend with no way to accept.
 * Acceptances are recorded either way; with the flag off this guard answers true at once.
 */
@Injectable()
export class CurrentTermsGuard implements CanActivate {
  private readonly enabled: boolean;

  constructor(
    private readonly reflector: Reflector,
    private readonly consents: ConsentsService,
    config: ConfigService<Env, true>,
  ) {
    this.enabled = config.get('TERMS_ENFORCEMENT_ENABLED', { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!this.enabled) return true;
    if (isPublicRoute(this.reflector, context) || isTermsExempt(this.reflector, context)) {
      return true;
    }
    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    // A protected route with no authenticated user means the JWT guard did not run: refuse (SC-07).
    if (!user) throw new DomainError('UNAUTHENTICATED');
    const pending = await this.consents.pendingFor(user.userId, user.consentResetAt);
    if (pending.length > 0) {
      throw new DomainError('TERMS_ACCEPTANCE_REQUIRED', {
        documents: pending.map((document) => ({ type: document.type, version: document.version })),
      });
    }
    return true;
  }
}
