import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '../../common/errors/domain-error.js';
import { isPublicRoute } from '../../auth/decorators/public.decorator.js';
import { type AccessAccount, AccessContextFactory } from '../access-context.js';
import { ACCESS_CONTEXT, type RequestWithAccess } from '../decorators/access.decorator.js';

/**
 * SPEC-002 AR-13 / BR-002-15: builds the request's AccessContext from the account's CURRENT
 * relationships, once per request, and keeps it on the request for @Access() and the persona,
 * entitlement and admin guards.
 *
 * Registered globally in AuthModule's providers immediately after JwtAuthGuard: global guards of
 * one module run in the order they are listed, so `request.user` is the account JwtStrategy has
 * just read from the database (with `isAdmin`, BR-002-15). A public route is skipped: the JWT guard
 * does not authenticate it, so there is nobody to build a context for. Public means isPublicRoute
 * (SC-07): @Public() with no access requirement on the handler or its controller, the same rule the
 * JWT guard applies, so a route with @AdminOnly/@RequiresPersona/@RequiresEntitlement always gets a
 * context even inside a @Public() controller.
 */
@Injectable()
export class AccessContextGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly factory: AccessContextFactory,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (isPublicRoute(this.reflector, context)) return true;
    const request = context
      .switchToHttp()
      .getRequest<RequestWithAccess & { user?: AccessAccount }>();
    // A protected route with no user means the JWT guard did not run: refuse (SC-07).
    if (!request.user) throw new DomainError('UNAUTHENTICATED');
    request[ACCESS_CONTEXT] = await this.factory.forAccount(request.user);
    return true;
  }
}
