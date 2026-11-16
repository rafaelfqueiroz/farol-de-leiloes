import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it } from 'vitest';
import { DomainError } from '../../common/errors/domain-error.js';
import { IS_PUBLIC } from '../../auth/decorators/public.decorator.js';
import {
  accessContextFactory,
  fakeAccessSources,
} from '../../../test/fakes/fake-access-sources.js';
import { ACCESS_CONTEXT, accessContextOf } from '../decorators/access.decorator.js';
import { AccessContextGuard } from './access-context.guard.js';

function contextFor(request: object, handler: () => void = () => undefined): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => class Probe {},
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

describe('AccessContextGuard (SPEC-002 AR-13)', () => {
  it('builds the context of the authenticated user and keeps it on the request', async () => {
    const sources = fakeAccessSources();
    const guard = new AccessContextGuard(new Reflector(), accessContextFactory(sources));
    const request: Record<symbol | string, unknown> = {
      user: { userId: 'account-1', isAdmin: false },
    };

    await expect(guard.canActivate(contextFor(request))).resolves.toBe(true);

    expect(accessContextOf(request)).toMatchObject({ accountId: 'account-1', isAdmin: false });
    expect(sources.fake.reads).toBe(1);
  });

  it('BR-002-15: builds a new context for each request', async () => {
    const sources = fakeAccessSources();
    const guard = new AccessContextGuard(new Reflector(), accessContextFactory(sources));
    const user = { userId: 'account-1', isAdmin: false };
    const first: Record<symbol | string, unknown> = { user };
    const second: Record<symbol | string, unknown> = { user };

    await guard.canActivate(contextFor(first));
    await guard.canActivate(contextFor(second));

    expect(first[ACCESS_CONTEXT]).not.toBe(second[ACCESS_CONTEXT]);
    expect(sources.fake.reads).toBe(2);
  });

  it('skips a @Public() route: no user, no context, no source read', async () => {
    const sources = fakeAccessSources();
    const guard = new AccessContextGuard(new Reflector(), accessContextFactory(sources));
    const handler = () => undefined;
    Reflect.defineMetadata(IS_PUBLIC, true, handler);
    const request: Record<symbol | string, unknown> = {};

    await expect(guard.canActivate(contextFor(request, handler))).resolves.toBe(true);

    expect(request[ACCESS_CONTEXT]).toBeUndefined();
    expect(sources.fake.reads).toBe(0);
  });

  it('SC-07: refuses a protected route that reached it with no authenticated user', async () => {
    const guard = new AccessContextGuard(new Reflector(), accessContextFactory());

    await expect(guard.canActivate(contextFor({}))).rejects.toEqual(
      new DomainError('UNAUTHENTICATED'),
    );
  });
});

describe('accessContextOf / @Access()', () => {
  it('refuses a request without a context instead of inventing one', () => {
    expect(() => accessContextOf({})).toThrow(new DomainError('UNAUTHENTICATED'));
  });
});
