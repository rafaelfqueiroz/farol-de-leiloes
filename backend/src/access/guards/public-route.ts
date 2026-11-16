import type { ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { IS_PUBLIC } from '../../auth/decorators/public.decorator.js';

/** SC-07: a @Public() handler under a class-level access decorator stays public. */
export function isPublicRoute(reflector: Reflector, context: ExecutionContext): boolean {
  return (
    reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()]) ===
    true
  );
}
