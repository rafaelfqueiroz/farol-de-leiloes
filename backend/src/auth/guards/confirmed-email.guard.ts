import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '../../common/errors/domain-error.js';
import { isPublicRoute } from '../decorators/public.decorator.js';
import type { AuthenticatedUser } from '../interfaces/auth.interface.js';

/**
 * BR-001-04: an account whose email is not confirmed can sign in, edit its profile and ask for a
 * new link, but cannot use the features that need an account (favorites, saved filters, reminders,
 * the support form, and the calculator and journey features as they arrive). Enforced here, on the
 * server: the frontend banner is only UX (AR-51).
 *
 * Opt-in per controller with `@UseGuards(ConfirmedEmailGuard)`, so it never depends on a global
 * registration. It runs after the global JwtAuthGuard, which has put the user on the request with
 * `emailVerified` read from the database for this very request (BR-001-17). A public route stays
 * public (isPublicRoute, SC-07: @Public() without an access requirement). Account notifications (confirmation and recovery mail) are unaffected (BR-001-07).
 */
@Injectable()
export class ConfirmedEmailGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (isPublicRoute(this.reflector, context)) return true;
    const { user } = context.switchToHttp().getRequest<{ user?: AuthenticatedUser }>();
    // A guarded route with no authenticated user means the JWT guard did not run: refuse, never
    // let it through.
    if (!user) {
      throw new DomainError('UNAUTHENTICATED');
    }
    if (!user.emailVerified) {
      throw new DomainError('EMAIL_VERIFICATION_REQUIRED');
    }
    return true;
  }
}
