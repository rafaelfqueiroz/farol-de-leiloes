import { type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { isPublicRoute } from '../decorators/public.decorator.js';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  override canActivate(context: ExecutionContext) {
    // SC-07: only explicit metadata can opt a handler or controller out of authentication, and an
    // access requirement (SPEC-002) always overrides it, at any level (isPublicRoute).
    if (isPublicRoute(this.reflector, context)) return true;
    return super.canActivate(context);
  }
}
