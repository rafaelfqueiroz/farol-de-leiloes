import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '../../common/errors/domain-error.js';
import { accessContextOf, type RequestWithAccess } from '../decorators/access.decorator.js';
import { isPublicRoute } from './public-route.js';

/**
 * SPEC-002 BR-002-23 / DL-002-05: platform-operation endpoints (import monitoring, maintenance,
 * coupons, account administration) need the admin capability, `users.isAdmin`, read fresh on this
 * request (BR-002-15). Nothing else counts: not the plan tier in `role`, not a header. Admin
 * capability opens no client data (SC-09); those routes never use this guard as a key.
 */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    if (isPublicRoute(this.reflector, context)) return true;
    const access = accessContextOf(context.switchToHttp().getRequest<RequestWithAccess>());
    if (!access.isAdmin) throw new DomainError('FORBIDDEN');
    return true;
  }
}
