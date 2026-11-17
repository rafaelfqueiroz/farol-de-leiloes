// SPEC-002 AR-13: the request's AccessContext, built once by the global AccessContextGuard and kept
// on the request under a symbol, so no header, body or query parameter can stand in for it.
import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import { DomainError } from '../../common/errors/domain-error.js';
import type { AccessContext } from '../access-context.js';

export const ACCESS_CONTEXT = Symbol('accessContext');

export interface RequestWithAccess {
  [ACCESS_CONTEXT]?: AccessContext;
}

/**
 * The context of an authenticated request. A handler that asks for it on a request that has none
 * (a @Public route, or a test app without the guard) is refused, never handed an empty context.
 */
export function accessContextOf(request: RequestWithAccess): AccessContext {
  const context = request[ACCESS_CONTEXT];
  if (!context) throw new DomainError('UNAUTHENTICATED');
  return context;
}

/** `@Access() access: AccessContext`: the caller's access, derived on the server (BR-002-11). */
export const Access = createParamDecorator((_data: unknown, context: ExecutionContext) =>
  accessContextOf(context.switchToHttp().getRequest<RequestWithAccess>()),
);
