import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { DomainError } from '../../common/errors/domain-error.js';
import { accessContextOf, type RequestWithAccess } from '../decorators/access.decorator.js';

export const REQUIRED_ENTITLEMENT = 'access:required-entitlement';

export interface EntitlementRequirement {
  readonly entitlement: string;
  /** The route writes: a read-only office's entitlement does not count (BR-002-30). */
  readonly write: boolean;
}

/**
 * SPEC-002 BR-002-10 / BR-002-13 / BR-002-30: the route needs a plan entitlement, read from the
 * current plan state on every request, never from what the interface shows.
 *
 * - no owner the account conducts has it: PLAN_NOT_ALLOWED (403);
 * - a write, and only read-only offices have it: OFFICE_READ_ONLY (403), so the interface can say
 *   why (D-47).
 *
 * Plan LIMITS are not checked here: they are counted atomically with the write they guard
 * (AR-15, BR-002-13).
 */
@Injectable()
export class EntitlementGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    // SC-07: never skipped for @Public(). An access requirement overrides it (isPublicRoute), so the
    // global guards authenticated this request and built its context; without one, accessContextOf
    // refuses with UNAUTHENTICATED (fail closed).
    const access = accessContextOf(context.switchToHttp().getRequest<RequestWithAccess>());
    const requirement = this.reflector.getAllAndOverride<EntitlementRequirement | undefined>(
      REQUIRED_ENTITLEMENT,
      [context.getHandler(), context.getClass()],
    );
    // Deny by default (SC-07): the guard used without its decorator lets nobody through.
    if (!requirement) throw new DomainError('FORBIDDEN');
    const { entitlement, write } = requirement;
    if (!access.hasEntitlement(entitlement)) {
      throw new DomainError('PLAN_NOT_ALLOWED', { entitlement });
    }
    if (write && !access.canWriteWith(entitlement)) {
      throw new DomainError('OFFICE_READ_ONLY', { entitlement });
    }
    return true;
  }
}
