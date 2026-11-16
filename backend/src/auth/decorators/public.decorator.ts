import type { ExecutionContext } from '@nestjs/common';
import { SetMetadata } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';

export const IS_PUBLIC = 'auth:is-public';

/**
 * SC-07: set by every access-requirement decorator (SPEC-002 @AdminOnly, @RequiresPersona,
 * @RequiresEntitlement). Its presence on a handler OR its controller makes the route authenticated,
 * whatever @Public() says.
 */
export const REQUIRES_ACCESS = 'auth:requires-access';

/** SC-07: anonymous access is an explicit decision; new routes require a JWT by default. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/** SC-07: records that the route has an access requirement (see REQUIRES_ACCESS). */
export const RequiresAccess = () => SetMetadata(REQUIRES_ACCESS, true);

type MetadataTarget = Parameters<Reflector['get']>[1];

/**
 * SC-07, the one rule every guard applies: a route is anonymous only when @Public() applies to it
 * (on the handler or its controller) AND no access requirement applies to it (on the handler or its
 * controller). An access requirement always wins over @Public, at any level: a handler-level
 * @AdminOnly() inside a @Public() controller authenticates (401 without a session) and then checks
 * the capability (403), and a @Public() handler inside a controller with an access requirement is
 * not public. Failing closed this way means a misplaced @Public() can never open a guarded route;
 * test/structural/public-access-decorators.spec.ts rejects the contradictory combinations outright.
 */
export function isPublicTarget(
  reflector: Reflector,
  handler: MetadataTarget,
  controller: MetadataTarget,
): boolean {
  const targets = [handler, controller];
  if (reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets) !== true) return false;
  return !targets.some((target) => reflector.get<boolean>(REQUIRES_ACCESS, target) === true);
}

/** isPublicTarget for the route an ExecutionContext is running. */
export function isPublicRoute(reflector: Reflector, context: ExecutionContext): boolean {
  return isPublicTarget(reflector, context.getHandler(), context.getClass());
}
