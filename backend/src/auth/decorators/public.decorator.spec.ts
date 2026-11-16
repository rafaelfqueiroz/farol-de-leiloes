// SC-07: the one rule that decides whether a route is anonymous (isPublicRoute / isPublicTarget),
// shared by JwtAuthGuard, AccessContextGuard and ConfirmedEmailGuard. An access requirement
// (REQUIRES_ACCESS, set by the SPEC-002 access decorators) always wins over @Public().
import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { isPublicRoute, isPublicTarget, Public, RequiresAccess } from './public.decorator.js';

class Plain {
  route() {}
}
class PublicHandler {
  @Public()
  route() {}
}
@Public()
class PublicClass {
  route() {}
}
@Public()
class PublicClassRequirementOnHandler {
  @RequiresAccess()
  route() {}
}
@RequiresAccess()
class RequirementClassPublicHandler {
  @Public()
  route() {}
}
class PublicAndRequirementOnHandler {
  @Public()
  @RequiresAccess()
  route() {}
}

const reflector = new Reflector();
type Probe = (new () => { route(): void }) & { prototype: { route(): void } };
const verdict = (target: Probe) => isPublicTarget(reflector, target.prototype.route, target);

describe('isPublicTarget (SC-07)', () => {
  it('is false for a route nobody opted out of authentication', () => {
    expect(verdict(Plain)).toBe(false);
  });

  it.each([
    ['a @Public() handler', PublicHandler],
    ['a handler of a @Public() controller', PublicClass],
  ])('is true for %s with no access requirement', (_label, target) => {
    expect(verdict(target)).toBe(true);
  });

  it.each([
    ['on the handler of a @Public() controller', PublicClassRequirementOnHandler],
    ['on the controller of a @Public() handler', RequirementClassPublicHandler],
    ['on the same handler as @Public()', PublicAndRequirementOnHandler],
  ])('is false when an access requirement sits %s', (_label, target) => {
    expect(verdict(target)).toBe(false);
  });

  it('isPublicRoute reads the handler and controller of the execution context', () => {
    const context = (target: Probe) =>
      ({
        getHandler: () => target.prototype.route,
        getClass: () => target,
      }) as unknown as ExecutionContext;

    expect(isPublicRoute(reflector, context(PublicClass))).toBe(true);
    expect(isPublicRoute(reflector, context(PublicClassRequirementOnHandler))).toBe(false);
  });
});
