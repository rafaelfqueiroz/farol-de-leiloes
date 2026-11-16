import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain-error.js';
import { accessContextOf, type RequestWithAccess } from '../decorators/access.decorator.js';

/**
 * SPEC-002 BR-002-23 / DL-002-05: platform-operation endpoints (import monitoring, maintenance,
 * coupons, account administration) need the admin capability, `users.isAdmin`, read fresh on this
 * request (BR-002-15). Nothing else counts: not the plan tier in `role`, not a header. Admin
 * capability opens no client data (SC-09); those routes never use this guard as a key.
 *
 * SC-07: never skipped for @Public(); an access requirement overrides it (isPublicRoute), so a
 * request with no context is refused with UNAUTHENTICATED by accessContextOf.
 *
 * SC-09 (defence in depth): an admin also needs a confirmed email, with ConfirmedEmailGuard's
 * semantics and code (BR-001-04, EMAIL_VERIFICATION_REQUIRED). grant-admin already refuses an
 * unconfirmed account; this keeps an address registered before its owner (a pre-registration
 * takeover) from operating even if the flag got there another way. The capability is checked first,
 * so a non-admin always sees FORBIDDEN and learns nothing about the email rule.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RequestWithAccess & { user?: { emailVerified?: boolean } }>();
    const access = accessContextOf(request);
    if (!access.isAdmin) throw new DomainError('FORBIDDEN');
    if (request.user?.emailVerified !== true) {
      throw new DomainError('EMAIL_VERIFICATION_REQUIRED');
    }
    return true;
  }
}
